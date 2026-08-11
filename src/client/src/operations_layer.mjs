/**
 * Flight operations state & data management.
 * Manages flight history trajectories (last 60s), planned routes, and geofence areas.
 */

export class OperationsLayerModel {
  constructor({ maxHistorySeconds = 60, maxHistoryPoints = 120 } = {}) {
    this.maxHistorySeconds = maxHistorySeconds;
    this.maxHistoryPoints = maxHistoryPoints;
    this.trajectories = new Map(); // droneId -> Array<{ time: number, positionRos: Array, geo: Object }>
    this.plannedRoutes = [];
    this.geofences = [];
  }

  loadGeoJSON(geojsonData) {
    if (!geojsonData || !Array.isArray(geojsonData.features)) return;
    this.plannedRoutes = [];
    this.geofences = [];

    for (const feature of geojsonData.features) {
      const type = feature.properties?.type;
      if (type === 'planned_route') {
        this.plannedRoutes.push(feature);
      } else if (type === 'geofence') {
        this.geofences.push(feature);
      }
    }
  }

  appendTrajectoryPoint(droneId, geo, positionRos = [0, 0, 0], timestamp = Date.now()) {
    const id = String(droneId);
    let points = this.trajectories.get(id);
    if (!points) {
      points = [];
      this.trajectories.set(id, points);
    }

    points.push({ time: timestamp, positionRos, geo });

    // Prune points older than maxHistorySeconds or exceeding maxHistoryPoints
    const cutoffTime = timestamp - this.maxHistorySeconds * 1000;
    while (points.length > 0 && points[0].time < cutoffTime) {
      points.shift();
    }
    if (points.length > this.maxHistoryPoints) {
      points.splice(0, points.length - this.maxHistoryPoints);
    }

    return points;
  }

  getTrajectory(droneId) {
    return this.trajectories.get(String(droneId)) || [];
  }

  clearTrajectory(droneId) {
    if (droneId != null) {
      this.trajectories.delete(String(droneId));
    } else {
      this.trajectories.clear();
    }
  }

  getSummary() {
    return {
      activeTrajectories: this.trajectories.size,
      plannedRoutesCount: this.plannedRoutes.length,
      geofencesCount: this.geofences.length,
    };
  }
}
