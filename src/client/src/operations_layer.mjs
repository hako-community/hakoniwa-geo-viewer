/**
 * Flight operations state & data management.
 * Manages flight history trajectories (last 60s), planned routes, and geofence areas.
 */

export function normalizeOperationsData(geojsonData) {
  const features = Array.isArray(geojsonData?.features)
    ? geojsonData.features.filter((feature) => feature && typeof feature === 'object')
    : [];
  const featureCollection = {
    ...(geojsonData && typeof geojsonData === 'object' ? geojsonData : {}),
    type: 'FeatureCollection',
    features,
  };
  const plannedRoutes = [];
  const geofences = [];
  const restrictedZones = [];
  const vertiports = [];
  const incidentSites = [];
  const localAnalysisAreas = [];

  for (const feature of features) {
    const type = feature.properties?.type;
    if (type === 'planned_route' && feature.geometry?.type === 'LineString') {
      plannedRoutes.push(feature);
    } else if (type === 'geofence' && feature.geometry?.type === 'Polygon') {
      geofences.push(feature);
      if (feature.properties?.rule === 'exclusion') restrictedZones.push(feature);
    } else if (type === 'vertiport' && feature.geometry?.type === 'Point') {
      vertiports.push(feature);
    } else if (type === 'incident_site' && feature.geometry?.type === 'Point') {
      incidentSites.push(feature);
    } else if (type === 'local_analysis_area' && feature.geometry?.type === 'Polygon') {
      localAnalysisAreas.push(feature);
    }
  }

  return {
    featureCollection,
    plannedRoutes,
    geofences,
    restrictedZones,
    vertiports,
    incidentSites,
    localAnalysisAreas,
  };
}

export function getOperationsExtent(operationsData) {
  const normalized = Array.isArray(operationsData?.featureCollection?.features)
    ? operationsData
    : normalizeOperationsData(operationsData);
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  function visit(value) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      const longitude = Number(value[0]);
      const latitude = Number(value[1]);
      west = Math.min(west, longitude);
      south = Math.min(south, latitude);
      east = Math.max(east, longitude);
      north = Math.max(north, latitude);
      return;
    }
    for (const item of value) visit(item);
  }

  for (const feature of normalized.featureCollection.features) visit(feature.geometry?.coordinates);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return {
    west, south, east, north,
    center: { longitude: (west + east) / 2, latitude: (south + north) / 2 },
  };
}

export class OperationsLayerModel {
  constructor({ maxHistorySeconds = 60, maxHistoryPoints = 120 } = {}) {
    this.maxHistorySeconds = maxHistorySeconds;
    this.maxHistoryPoints = maxHistoryPoints;
    this.trajectories = new Map(); // droneId -> Array<{ time: number, positionRos: Array, geo: Object }>
    this.plannedRoutes = [];
    this.geofences = [];
    this.restrictedZones = [];
    this.vertiports = [];
    this.incidentSites = [];
    this.localAnalysisAreas = [];
  }

  loadGeoJSON(geojsonData) {
    const normalized = normalizeOperationsData(geojsonData);
    this.plannedRoutes = normalized.plannedRoutes;
    this.geofences = normalized.geofences;
    this.restrictedZones = normalized.restrictedZones;
    this.vertiports = normalized.vertiports;
    this.incidentSites = normalized.incidentSites;
    this.localAnalysisAreas = normalized.localAnalysisAreas;
    return normalized;
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
      restrictedZonesCount: this.restrictedZones.length,
      vertiportsCount: this.vertiports.length,
      incidentSitesCount: this.incidentSites.length,
      localAnalysisAreasCount: this.localAnalysisAreas.length,
    };
  }
}
