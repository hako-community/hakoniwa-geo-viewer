/**
 * Phase R7 Fleet Manager Module.
 * Manages deterministic multi-drone synthetic fleet state for performance benchmarking.
 */

function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function droneSuffix(index) {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
}

export function generateFleetSyntheticData(
  count = 10,
  originGeo = { longitude: 139.7016357, latitude: 35.6580339 },
  { seed = 20260811 } = {},
) {
  const fleetSize = Math.max(1, Math.min(30, Math.trunc(Number(count) || 10)));
  const random = createSeededRandom(seed);
  const drones = [];
  for (let i = 0; i < fleetSize; i++) {
    const routeIndex = i % 3;
    const routeMemberIndex = Math.floor(i / 3);
    const routeMemberCount = Math.ceil((fleetSize - routeIndex) / 3);
    const angle = (routeMemberIndex / routeMemberCount) * Math.PI * 2
      + routeIndex * Math.PI / 6
      + (random() - 0.5) * 0.025;
    const radiusM = 85.0 + routeIndex * 55.0 + (random() - 0.5) * 4.0;
    const rosX = Math.cos(angle) * radiusM;
    const rosY = Math.sin(angle) * radiusM;
    const rosZ = 15.0 + (i % 5) * 3.0;
    const suffix = droneSuffix(i);
    drones.push({
      id: `Drone-${suffix}`,
      name: `Synthetic Fleet Drone ${suffix}`,
      positionRos: [rosX, rosY, rosZ],
      rpyDeg: [0, 0, (angle * 180 / Math.PI + 90) % 360],
      isSynthetic: true,
      status: 'NORMAL',
      routeId: `route-${routeIndex + 1}`,
      scenarioSeed: Number(seed),
      originGeo,
    });
  }
  return drones;
}

export class FleetManager {
  constructor({ maxDrones = 30 } = {}) {
    this.maxDrones = maxDrones;
    this.dronesMap = new Map();
  }

  loadFleet(dronesArray) {
    this.dronesMap.clear();
    for (const drone of dronesArray.slice(0, this.maxDrones)) {
      this.dronesMap.set(String(drone.id), drone);
    }
    return Array.from(this.dronesMap.values());
  }

  updateDronePose(id, positionRos, rpyDeg) {
    const key = String(id);
    const existing = this.dronesMap.get(key);
    if (existing) {
      existing.positionRos = positionRos;
      existing.rpyDeg = rpyDeg;
    }
  }

  getDrone(id) {
    return this.dronesMap.get(String(id));
  }

  getAllDrones() {
    return Array.from(this.dronesMap.values());
  }

  getDiagnostics() {
    return {
      activeDroneCount: this.dronesMap.size,
      maxDrones: this.maxDrones,
      droneIds: Array.from(this.dronesMap.keys()),
    };
  }
}
