/**
 * Pure rule evaluation logic for drone flight operations.
 * Evaluates geofence breaches, path deviations, and low altitude warnings.
 */

import { normalizeOperationsData } from './operations_layer.mjs?v=r8-20260811-1';

const METERS_PER_LATITUDE_DEGREE = 111_320;

export function geoToLocalMeters(geoPoint, originGeo) {
  const meanLat = (Number(geoPoint.latitude) + Number(originGeo.latitude)) * 0.5;
  const cosLat = Math.cos(meanLat * Math.PI / 180);
  const x = (Number(geoPoint.longitude) - Number(originGeo.longitude)) * METERS_PER_LATITUDE_DEGREE * cosLat;
  const y = (Number(geoPoint.latitude) - Number(originGeo.latitude)) * METERS_PER_LATITUDE_DEGREE;
  const z = Number(geoPoint.altitude ?? geoPoint.height ?? 0);
  return { x, y, z };
}

export function isPointIn2DPolygon(longitude, latitude, polygonCoords) {
  let inside = false;
  const x = Number(longitude);
  const y = Number(latitude);
  for (let i = 0, j = polygonCoords.length - 1; i < polygonCoords.length; j = i++) {
    const xi = polygonCoords[i][0], yi = polygonCoords[i][1];
    const xj = polygonCoords[j][0], yj = polygonCoords[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distanceToSegment2DMeters(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

export function evaluateFlightRules(droneState, operationsData = {}, originGeo = { longitude: 139.7016357, latitude: 35.6580339 }) {
  const events = [];
  if (!droneState || !droneState.geo) return events;

  const droneGeo = droneState.geo;
  const dronePosM = geoToLocalMeters(droneGeo, originGeo);
  const droneId = String(droneState.id);

  // 1. Geofence Check
  const normalizedOperations = Array.isArray(operationsData?.featureCollection?.features)
    ? operationsData
    : normalizeOperationsData(operationsData);
  const geofences = normalizedOperations.geofences || [];
  for (const fence of geofences) {
    if (fence.geometry?.type === 'Polygon') {
      const coords = fence.geometry.coordinates[0];
      const isInside = isPointIn2DPolygon(droneGeo.longitude, droneGeo.latitude, coords);
      const minAlt = fence.properties?.minAltitudeM ?? 0;
      const maxAlt = fence.properties?.maxAltitudeM ?? 150;
      const alt = Number(droneGeo.altitude ?? droneGeo.height ?? 0);
      const rule = fence.properties?.rule === 'exclusion' ? 'exclusion' : 'containment';

      if ((rule === 'containment' && !isInside) || (rule === 'exclusion' && isInside)) {
        const isExclusion = rule === 'exclusion';
        events.push({
          id: `rule-geofence-${isExclusion ? 'entry' : 'out'}-${droneId}-${fence.properties.id}`,
          droneId,
          type: 'GEOFENCE_BREACH',
          severity: 'HIGH',
          title: isExclusion ? '進入禁止区域への侵入' : '区域外飛行検出',
          message: isExclusion
            ? `機体 ${droneId} が進入禁止区域 (${fence.properties.name || fence.properties.id}) に入りました`
            : `機体 ${droneId} が許可区域外 (${fence.properties.name || fence.properties.id}) に出ました`,
          timestamp: Date.now(),
        });
      } else if (rule === 'containment' && isInside && (alt < minAlt || alt > maxAlt)) {
        events.push({
          id: `rule-geofence-alt-${droneId}-${fence.properties.id}`,
          droneId,
          type: 'ALTITUDE_LIMIT_BREACH',
          severity: 'WARNING',
          title: '高度制限違反',
          message: `機体 ${droneId} の高度 (${alt.toFixed(1)}m) が制限範囲 [${minAlt}m, ${maxAlt}m] から逸脱しています`,
          timestamp: Date.now(),
        });
      }
    }
  }

  // 2. Planned Route Deviation Check
  const allRoutes = normalizedOperations.plannedRoutes || [];
  const assignedRoutes = droneState.routeId
    ? allRoutes.filter((route) => String(route.properties?.id) === String(droneState.routeId))
    : allRoutes;
  let nearest = null;
  for (const route of assignedRoutes) {
    if (route.geometry?.type !== 'LineString') continue;
    const coords = route.geometry.coordinates;
    let minDistance = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
      const pA = geoToLocalMeters({ longitude: coords[i][0], latitude: coords[i][1] }, originGeo);
      const pB = geoToLocalMeters({ longitude: coords[i + 1][0], latitude: coords[i + 1][1] }, originGeo);
      minDistance = Math.min(minDistance, distanceToSegment2DMeters(dronePosM, pA, pB));
    }
    if (!nearest || minDistance < nearest.distanceM) nearest = { route, distanceM: minDistance };
  }
  if (nearest) {
    const maxDeviation = nearest.route.properties?.maxDeviationM ?? 15;
    if (nearest.distanceM > maxDeviation) {
      events.push({
        id: `rule-route-dev-${droneId}-${nearest.route.properties.id}`,
        droneId,
        type: 'ROUTE_DEVIATION',
        severity: 'WARNING',
        title: '計画経路逸脱',
        message: `機体 ${droneId} が計画経路から ${nearest.distanceM.toFixed(1)}m 逸脱しています (許容: ${maxDeviation}m)`,
        timestamp: Date.now(),
      });
    }
  }

  return events;
}
