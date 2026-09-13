import { MaprayDroneModelLayer } from './mapray_drone_model_layer.mjs';

export const MAPRAY_DRONE_FLEET_LAYER_VERSION = 1;

function createSharedCloudApi(cloudApi, onCreate) {
  const resources = new Map();
  return {
    get3DDatasetAsResource(datasetId) {
      const key = String(datasetId);
      if (!resources.has(key)) {
        resources.set(key, cloudApi.get3DDatasetAsResource(datasetId));
        onCreate(key);
      }
      return resources.get(key);
    },
  };
}

export class MaprayDroneFleetLayer {
  constructor({
    mapray,
    uiviewer,
    cloudApi,
    config,
    airframeDatasetId,
    propellerDatasetId,
    renderMode = 'model',
    staleTimeoutMs = 5000,
    onSelection = null,
    onStateChange = null,
    layerFactory = (options) => new MaprayDroneModelLayer(options),
    now = () => Date.now(),
  }) {
    this.mapray = mapray;
    this.uiviewer = uiviewer;
    this.config = config;
    this.airframeDatasetId = airframeDatasetId;
    this.propellerDatasetId = propellerDatasetId;
    this.renderMode = renderMode;
    this.staleTimeoutMs = Math.max(0, Number(staleTimeoutMs) || 0);
    this.onSelection = typeof onSelection === 'function' ? onSelection : null;
    this.onStateChange = typeof onStateChange === 'function' ? onStateChange : null;
    this.layerFactory = layerFactory;
    this.now = now;
    this.entries = new Map();
    this.selectedDroneId = null;
    this.followEnabled = false;
    this.unsubscribeFlightState = null;
    this.disposed = false;
    this.errors = [];
    this.resourceDatasetIds = [];
    this.createdDroneCount = 0;
    this.disposedDroneCount = 0;
    this.reconcilePromise = Promise.resolve();
    this.sharedCloudApi = renderMode === 'pin' ? null : createSharedCloudApi(
      cloudApi,
      (datasetId) => this.resourceDatasetIds.push(datasetId),
    );
  }

  _publish() {
    this.onStateChange?.(this.getDiagnostics());
  }

  _createLayer(droneId) {
    return this.layerFactory({
      mapray: this.mapray,
      uiviewer: this.uiviewer,
      cloudApi: this.sharedCloudApi,
      config: this.config,
      airframeDatasetId: this.airframeDatasetId,
      propellerDatasetId: this.propellerDatasetId,
      droneId,
      onSelection: (target) => this.onSelection?.(target),
    });
  }

  async reconcile(snapshot, { removeMissing = true, timestampMilliseconds = this.now() } = {}) {
    if (this.disposed) return this.getDiagnostics();
    const drones = Array.isArray(snapshot?.drones) ? snapshot.drones : [];
    const incomingIds = new Set(drones.map((drone) => String(drone.id)));
    if (removeMissing) {
      for (const droneId of this.entries.keys()) {
        if (!incomingIds.has(droneId)) this.removeDrone(droneId);
      }
    }
    for (const state of drones) {
      const droneId = String(state.id);
      let entry = this.entries.get(droneId);
      if (!entry) {
        const layer = this._createLayer(droneId);
        entry = { layer, lastSeenMilliseconds: timestampMilliseconds };
        this.entries.set(droneId, entry);
        this.createdDroneCount += 1;
        try {
          await layer.load({ renderMode: this.renderMode });
        } catch (error) {
          this.errors.push({ droneId, error: String(error?.message || error) });
        }
        if (this.disposed || this.entries.get(droneId) !== entry) {
          layer.dispose();
          continue;
        }
      }
      entry.lastSeenMilliseconds = timestampMilliseconds;
      entry.layer.updateDroneState(state);
    }
    this.selectedDroneId = snapshot?.selectedDroneId == null
      ? (drones[0]?.id == null ? null : String(drones[0].id))
      : String(snapshot.selectedDroneId);
    this._applyFollowSelection();
    this._publish();
    return this.getDiagnostics();
  }

  enqueueReconcile(snapshot, options) {
    this.reconcilePromise = this.reconcilePromise
      .then(() => this.reconcile(snapshot, options))
      .catch((error) => {
        this.errors.push({ droneId: null, error: String(error?.message || error) });
        this._publish();
      });
    return this.reconcilePromise;
  }

  whenIdle() {
    return this.reconcilePromise;
  }

  bindFlightStateStore(store) {
    this.unsubscribeFlightState?.();
    this.unsubscribeFlightState = store.subscribe((snapshot) => {
      this.enqueueReconcile(snapshot);
    });
    return () => {
      this.unsubscribeFlightState?.();
      this.unsubscribeFlightState = null;
    };
  }

  removeDrone(droneId) {
    const key = String(droneId);
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    entry.layer.dispose();
    this.disposedDroneCount += 1;
    if (this.selectedDroneId === key) this.selectedDroneId = null;
    return true;
  }

  pruneStale(timestampMilliseconds = this.now()) {
    const removed = [];
    for (const [droneId, entry] of this.entries) {
      if (timestampMilliseconds - entry.lastSeenMilliseconds > this.staleTimeoutMs) {
        this.removeDrone(droneId);
        removed.push(droneId);
      }
    }
    if (removed.length > 0) this._publish();
    return removed;
  }

  _applyFollowSelection() {
    for (const [droneId, entry] of this.entries) {
      entry.layer.setFollowEnabled(this.followEnabled && droneId === this.selectedDroneId);
    }
  }

  setFollowEnabled(enabled) {
    this.followEnabled = Boolean(enabled);
    this._applyFollowSelection();
  }

  focusSelected() {
    return this.entries.get(this.selectedDroneId)?.layer.focus() || false;
  }

  handlePick(picked) {
    const entity = picked?.entity || picked;
    const target = entity?.__hakoniwaDroneTarget;
    if (!target || target.type !== 'drone' || !this.entries.has(String(target.id))) return false;
    this.onSelection?.({ ...target });
    return true;
  }

  setPaused(paused, options) {
    for (const entry of this.entries.values()) entry.layer.setPaused(paused, options);
  }

  update(deltaSeconds) {
    for (const entry of this.entries.values()) entry.layer.update(deltaSeconds);
  }

  getDiagnostics() {
    const layers = Array.from(this.entries.entries()).map(([droneId, entry]) => ({
      droneId,
      ...entry.layer.getDiagnostics(),
    }));
    const layerPerformance = layers.map((layer) => layer.performance || {});
    return {
      implementationVersion: MAPRAY_DRONE_FLEET_LAYER_VERSION,
      renderMode: this.renderMode,
      activeDroneCount: layers.length,
      selectedDroneId: this.selectedDroneId,
      followEnabled: this.followEnabled,
      entityCount: layers.reduce((total, layer) => total + layer.entityCount, 0),
      modelEntityCount: layers.reduce((total, layer) => total + layer.modelEntityCount, 0),
      expectedModelEntityCount: this.renderMode === 'pin' ? 0 : layers.length * 5,
      cloudDatasetRequestCount: layers.reduce(
        (total, layer) => total + Number(layer.cloudDatasetRequestCount || 0),
        0,
      ),
      cloudResourceCreateCount: this.resourceDatasetIds.length,
      sharedResourceDatasetIds: [...this.resourceDatasetIds],
      createdDroneCount: this.createdDroneCount,
      disposedDroneCount: this.disposedDroneCount,
      performance: {
        loadDurationMs: Math.max(0, ...layerPerformance.map(
          (value) => Number(value.loadDurationMs) || 0,
        )),
        updateSampleCount: layerPerformance.length > 0
          ? Math.min(...layerPerformance.map(
            (value) => Number(value.updateSampleCount) || 0,
          ))
          : 0,
        averageUpdateMs: layerPerformance.reduce(
          (total, value) => total + (Number(value.averageUpdateMs) || 0),
          0,
        ),
        maxUpdateMs: Math.max(0, ...layerPerformance.map(
          (value) => Number(value.maxUpdateMs) || 0,
        )),
      },
      errors: this.errors.map((error) => ({ ...error })),
      layers,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeFlightState?.();
    this.unsubscribeFlightState = null;
    for (const entry of this.entries.values()) {
      entry.layer.dispose();
      this.disposedDroneCount += 1;
    }
    this.entries.clear();
    this._publish();
  }
}
