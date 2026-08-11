export const FLIGHT_STATE_STORE_VERSION = 1;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteVector(value, length = 3, fallback = 0) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) => finiteNumber(source[index], fallback));
}

function normalizeDroneState(raw, timestampMilliseconds) {
  const idValue = raw?.id ?? raw?.droneId ?? raw?.name;
  if (idValue == null || String(idValue).length === 0) {
    throw new Error('[FlightStateStore] drone id is required');
  }
  const pose = raw?.latestPose ?? {};
  return {
    id: String(idValue),
    name: String(raw?.name ?? raw?.cfg?.name ?? idValue),
    positionRos: finiteVector(raw?.positionRos ?? pose.rosPos),
    rpyDeg: finiteVector(raw?.rpyDeg ?? pose.rosRpyDeg),
    pwmDuty: finiteVector(raw?.pwmDuty, 4),
    rotorSpeedsRadPerSec: Array.isArray(raw?.rotorSpeedsRadPerSec)
      ? raw.rotorSpeedsRadPerSec.map((value) => finiteNumber(value))
      : [],
    collidedCounts: raw?.collidedCounts == null
      ? null
      : finiteNumber(raw.collidedCounts),
    impulseCollision: raw?.impulseCollision ?? null,
    timestampMilliseconds,
  };
}

function cloneIncident(event) {
  return {
    ...event,
    droneId: String(event.droneId),
    contactPositionRos: finiteVector(event.contactPositionRos),
    normalRos: finiteVector(event.normalRos),
    color: finiteVector(event.color),
  };
}

export class FlightStateStore {
  constructor({ maxIncidents = 100 } = {}) {
    this.maxIncidents = Math.max(1, Number(maxIncidents) || 100);
    this.drones = new Map();
    this.incidents = [];
    this.selectedDroneId = null;
    this.selectedIncidentId = null;
    this.revision = 0;
    this.listeners = new Set();
    this._isEmitting = false;
  }

  subscribe(listener, { emitCurrent = true } = {}) {
    if (typeof listener !== 'function') {
      throw new Error('[FlightStateStore] listener must be a function');
    }
    this.listeners.add(listener);
    if (emitCurrent) {
      listener(this.getSnapshot(), { type: 'snapshot', source: 'subscribe' });
    }
    return () => this.listeners.delete(listener);
  }

  _emit(change) {
    if (this._isEmitting) {
      queueMicrotask(() => this._emit(change));
      return;
    }
    this._isEmitting = true;
    try {
      this.revision += 1;
      const snapshot = this.getSnapshot();
      for (const listener of this.listeners) listener(snapshot, change);
    } finally {
      this._isEmitting = false;
    }
  }

  getSnapshot() {
    return {
      revision: this.revision,
      selectedDroneId: this.selectedDroneId,
      selectedIncidentId: this.selectedIncidentId,
      drones: Array.from(this.drones.values()).map((state) => ({ ...state })),
      incidents: this.incidents.map(cloneIncident),
    };
  }

  getDrone(droneId) {
    const state = this.drones.get(String(droneId));
    return state ? { ...state } : null;
  }

  getIncident(eventId) {
    const event = this.incidents.find((item) => item.id === String(eventId));
    return event ? cloneIncident(event) : null;
  }

  updateDrones(rawStates = [], {
    replace = true,
    source = 'pdu',
    timestampMilliseconds = Date.now(),
  } = {}) {
    const normalized = rawStates.map((raw) => normalizeDroneState(raw, timestampMilliseconds));
    if (replace) this.drones.clear();
    for (const state of normalized) this.drones.set(state.id, state);
    const selectionChanged = this.selectedDroneId == null
      || !this.drones.has(this.selectedDroneId);
    if (selectionChanged) {
      this.selectedDroneId = normalized[0]?.id ?? null;
      this.selectedIncidentId = null;
    }
    this._emit({ type: 'drones', source, selectionChanged });
    return this.getSnapshot();
  }

  selectDrone(droneId, { source = 'unknown' } = {}) {
    const id = String(droneId);
    if (!this.drones.has(id)) return false;
    if (this.selectedDroneId === id && this.selectedIncidentId == null) return true;
    this.selectedDroneId = id;
    this.selectedIncidentId = null;
    this._emit({ type: 'selection', source, droneId: id });
    return true;
  }

  addIncident(event, { source = 'collision-tracker', select = false } = {}) {
    if (!event?.id || event?.droneId == null) {
      throw new Error('[FlightStateStore] incident id and droneId are required');
    }
    const normalized = cloneIncident(event);
    if (this.incidents.some((item) => item.id === normalized.id)) return false;
    this.incidents.push(normalized);
    this.incidents = this.incidents.slice(-this.maxIncidents);
    if (select) {
      this.selectedIncidentId = normalized.id;
      this.selectedDroneId = normalized.droneId;
    }
    this._emit({ type: select ? 'incident-selection' : 'incident-added', source, eventId: normalized.id });
    return true;
  }

  selectIncident(eventId, { source = 'incident-list' } = {}) {
    const event = this.incidents.find((item) => item.id === String(eventId));
    if (!event) return false;
    this.selectedIncidentId = event.id;
    this.selectedDroneId = event.droneId;
    this._emit({
      type: 'incident-selection',
      source,
      eventId: event.id,
      droneId: event.droneId,
    });
    return true;
  }
}
