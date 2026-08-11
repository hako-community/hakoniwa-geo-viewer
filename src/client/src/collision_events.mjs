const DEFAULT_GROUND_THRESHOLD_M = 1.5;
const DEFAULT_VERTICAL_NORMAL_THRESHOLD = 0.65;

function finiteVector(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  return value.slice(0, 3).map((item, index) => {
    const number = Number(item);
    return Number.isFinite(number) ? number : fallback[index];
  });
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function magnitude(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize(value, fallback = [0, 0, 1]) {
  const length = magnitude(value);
  if (length < 1e-6) return [...fallback];
  return value.map((item) => item / length);
}

function distance(a, b) {
  return magnitude(subtract(a, b));
}

export function classifyCollisionSurface({
  positionRos,
  normalRos,
  terrainHeightM = null,
  groundThresholdM = DEFAULT_GROUND_THRESHOLD_M,
  verticalNormalThreshold = DEFAULT_VERTICAL_NORMAL_THRESHOLD,
}) {
  const position = finiteVector(positionRos);
  const normal = normalize(finiteVector(normalRos, [0, 0, 1]));
  const terrainHeight = terrainHeightM == null ? NaN : Number(terrainHeightM);
  const nearKnownTerrain = Number.isFinite(terrainHeight)
    && Math.abs(position[2] - terrainHeight) <= groundThresholdM;
  const nearZeroTerrain = !Number.isFinite(terrainHeight)
    && position[2] <= groundThresholdM;
  if ((nearKnownTerrain || nearZeroTerrain) && normal[2] >= 0.35) {
    return "ground";
  }
  if (Math.abs(normal[2]) >= verticalNormalThreshold) {
    return "roof";
  }
  return "wall";
}

export const COLLISION_SURFACE_STYLE = Object.freeze({
  wall: { label: "壁", color: [1.0, 0.18, 0.08] },
  roof: { label: "屋上", color: [1.0, 0.65, 0.0] },
  ground: { label: "地面", color: [0.15, 0.55, 1.0] },
});

export function collisionNormalTip(event, lengthMeters = 5) {
  const start = finiteVector(event?.contactPositionRos);
  const normal = normalize(finiteVector(event?.normalRos, [0, 0, 1]));
  const length = Math.max(0, Number(lengthMeters) || 0);
  return start.map((value, index) => value + normal[index] * length);
}

export class CollisionEventTracker {
  constructor({ dedupMilliseconds = 750, dedupDistanceMeters = 1.0 } = {}) {
    this.dedupMilliseconds = dedupMilliseconds;
    this.dedupDistanceMeters = dedupDistanceMeters;
    this.states = new Map();
  }

  update({
    droneId,
    positionRos,
    collidedCounts,
    impulseCollision = null,
    terrainHeightM = null,
    timestampMilliseconds = Date.now(),
  }) {
    const id = String(droneId);
    const position = finiteVector(positionRos);
    const now = Number(timestampMilliseconds);
    const count = Number.isFinite(Number(collidedCounts))
      ? Number(collidedCounts)
      : null;
    let state = this.states.get(id);
    if (!state) {
      state = {
        lastPosition: position,
        lastTimestamp: now,
        lastCount: count,
        impulseActive: !!impulseCollision?.collision,
        lastDetailedAt: -Infinity,
        lastEvent: null,
        sequence: 0,
      };
      this.states.set(id, state);
      return null;
    }

    const elapsedSeconds = Math.max((now - state.lastTimestamp) / 1000, 1e-3);
    const velocity = subtract(position, state.lastPosition).map(
      (value) => value / elapsedSeconds,
    );
    const speed = magnitude(velocity);
    const impulseActive = !!impulseCollision?.collision;
    let source = null;
    let normal = null;
    let eventId = null;
    let countDelta = 0;

    if (impulseActive && !state.impulseActive) {
      source = "impulse_collision";
      const detailedNormal = finiteVector(impulseCollision.normalRos);
      normal = magnitude(detailedNormal) >= 1e-6
        ? normalize(detailedNormal)
        : normalize(velocity.map((item) => -item));
      state.sequence += 1;
      eventId = `${id}:impulse:${state.sequence}`;
      state.lastDetailedAt = now;
    } else if (
      count !== null
      && state.lastCount !== null
      && count > state.lastCount
      && now - state.lastDetailedAt >= this.dedupMilliseconds
    ) {
      source = "drone_status";
      normal = normalize(velocity.map((item) => -item));
      countDelta = count - state.lastCount;
      eventId = `${id}:status:${count}`;
    }

    state.lastPosition = position;
    state.lastTimestamp = now;
    state.impulseActive = impulseActive;
    if (count !== null) state.lastCount = count;

    if (!source) return null;

    const surfaceType = classifyCollisionSurface({
      positionRos: position,
      normalRos: normal,
      terrainHeightM,
    });
    const previous = state.lastEvent;
    if (
      previous
      && now - previous.timestampMilliseconds < this.dedupMilliseconds
      && previous.surfaceType === surfaceType
      && distance(previous.contactPositionRos, position) < this.dedupDistanceMeters
    ) {
      return null;
    }

    const style = COLLISION_SURFACE_STYLE[surfaceType];
    const event = {
      id: eventId,
      droneId: id,
      source,
      timestampMilliseconds: now,
      contactPositionRos: position,
      normalRos: normal,
      impactSpeedMps: speed,
      impactMeasure: "velocity_proxy",
      collidedCounts: count,
      countDelta,
      surfaceType,
      surfaceLabel: style.label,
      color: [...style.color],
      estimated: source !== "impulse_collision",
      terrainHeightM: terrainHeightM != null && Number.isFinite(Number(terrainHeightM))
        ? Number(terrainHeightM)
        : null,
    };
    state.lastEvent = event;
    return event;
  }
}
