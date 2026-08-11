/**
 * Phase R7 Fleet Manager Module.
 * Manages multi-drone synthetic fleet state (5, 10, 20 drones) for performance benchmarking.
 */

export function generateFleetSyntheticData(count = 5, originGeo = { longitude: 139.7016357, latitude: 35.6580339 }) {
  const drones = [];
  const radiusM = 150.0;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const rosX = Math.cos(angle) * radiusM;
    const rosY = Math.sin(angle) * radiusM;
    const rosZ = 15.0 + (i % 5) * 3.0;
    drones.push({
      id: `Drone-${String.fromCharCode(65 + i)}`,
      name: `Synthetic Fleet Drone ${String.fromCharCode(65 + i)}`,
      positionRos: [rosX, rosY, rosZ],
      rpyDeg: [0, 0, (angle * 180 / Math.PI + 90) % 360],
      isSynthetic: true,
      status: 'NORMAL',
    });
  }
  return drones;
}

export class FleetManager {
  constructor({ maxDrones = 20 } = {}) {
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
