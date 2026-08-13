const EARTH_RADIUS_M = 6_378_137.0;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function hashUnit(seed, index) {
  let value = (Number(seed) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function segmentLengthMeters(a, b) {
  const meanLatitude = ((Number(a[1]) + Number(b[1])) * 0.5) * Math.PI / 180;
  const east = (Number(b[0]) - Number(a[0])) * Math.PI / 180
    * EARTH_RADIUS_M * Math.cos(meanLatitude);
  const north = (Number(b[1]) - Number(a[1])) * Math.PI / 180 * EARTH_RADIUS_M;
  const up = Number(b[2] || 0) - Number(a[2] || 0);
  return Math.hypot(east, north, up);
}

function prepareRoute(feature) {
  const coordinates = feature?.geometry?.coordinates || [];
  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    cumulative.push(cumulative[i - 1] + segmentLengthMeters(coordinates[i - 1], coordinates[i]));
  }
  return {
    feature,
    coordinates,
    cumulative,
    lengthMeters: cumulative[cumulative.length - 1] || 0,
    id: String(feature?.properties?.id || feature?.properties?.name || 'route'),
    cycleSeconds: Math.max(30, Number(feature?.properties?.cycleSeconds) || 240),
  };
}

function sampleRoute(route, progress) {
  if (!route || route.coordinates.length === 0) return null;
  if (route.coordinates.length === 1 || route.lengthMeters <= 0) {
    return { coordinate: [...route.coordinates[0]], tangent: [0, 1] };
  }
  const distance = clamp01(progress) * route.lengthMeters;
  let segment = 1;
  while (segment < route.cumulative.length - 1 && route.cumulative[segment] < distance) {
    segment += 1;
  }
  const a = route.coordinates[segment - 1];
  const b = route.coordinates[segment];
  const startDistance = route.cumulative[segment - 1];
  const segmentDistance = Math.max(0.001, route.cumulative[segment] - startDistance);
  const ratio = clamp01((distance - startDistance) / segmentDistance);
  return {
    coordinate: [
      Number(a[0]) + (Number(b[0]) - Number(a[0])) * ratio,
      Number(a[1]) + (Number(b[1]) - Number(a[1])) * ratio,
      Number(a[2] || 0) + (Number(b[2] || 0) - Number(a[2] || 0)) * ratio,
    ],
    tangent: [Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1])],
  };
}

export function geoCoordinateToRos(origin, coordinate) {
  const originLatitude = Number(origin?.latitude || 0);
  const originLongitude = Number(origin?.longitude || 0);
  const latitude = Number(coordinate?.[1] || 0);
  const longitude = Number(coordinate?.[0] || 0);
  const north = (latitude - originLatitude) * Math.PI / 180 * EARTH_RADIUS_M;
  const east = (longitude - originLongitude) * Math.PI / 180
    * EARTH_RADIUS_M * Math.cos(((latitude + originLatitude) * 0.5) * Math.PI / 180);
  return [north, -east, Number(coordinate?.[2] || 0)];
}

export function createWideAreaScenario({
  operationsData,
  fleet,
  geoOrigin,
  seed = 20260811,
} = {}) {
  const routes = (operationsData?.plannedRoutes || []).map(prepareRoute)
    .filter((route) => route.coordinates.length >= 2 && route.lengthMeters > 0);
  if (routes.length === 0) throw new Error('[WideAreaScenario] planned route is required');

  const drones = Array.isArray(fleet) ? fleet.map((drone) => ({ ...drone })) : [];
  const incidentFeature = operationsData?.incidentSites?.[0] || null;
  const incidentCoordinate = incidentFeature?.geometry?.coordinates || null;
  const triggerAtSeconds = Math.max(0, Number(incidentFeature?.properties?.triggerAtSeconds) || 35);
  const targetDroneIndex = Math.max(
    0,
    Math.min(drones.length - 1, Math.trunc(Number(incidentFeature?.properties?.targetDroneIndex) || 0)),
  );
  const diversionSeconds = 8;

  function sample(elapsedSeconds = 0) {
    const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    return drones.map((template, index) => {
      const route = routes[index % routes.length];
      const membersOnRoute = Math.ceil((drones.length - (index % routes.length)) / routes.length);
      const memberIndex = Math.floor(index / routes.length);
      const phase = memberIndex / Math.max(1, membersOnRoute) + hashUnit(seed, index) * 0.015;
      const progress = positiveModulo(elapsed / route.cycleSeconds + phase, 1);
      const routeSample = sampleRoute(route, progress);
      let coordinate = routeSample.coordinate;
      let status = 'NORMAL';
      let incidentActive = false;

      if (index === targetDroneIndex && incidentCoordinate && elapsed >= triggerAtSeconds) {
        const diversion = clamp01((elapsed - triggerAtSeconds) / diversionSeconds);
        coordinate = [
          coordinate[0] + (Number(incidentCoordinate[0]) - coordinate[0]) * diversion,
          coordinate[1] + (Number(incidentCoordinate[1]) - coordinate[1]) * diversion,
          coordinate[2] + (Number(incidentCoordinate[2] || coordinate[2]) - coordinate[2]) * diversion,
        ];
        status = diversion < 0.35 ? 'WARNING' : 'HIGH';
        incidentActive = true;
      }

      const tangentEast = routeSample.tangent[0]
        * Math.cos(Number(coordinate[1]) * Math.PI / 180);
      const tangentNorth = routeSample.tangent[1];
      const yawDeg = positiveModulo(Math.atan2(-tangentEast, tangentNorth) * 180 / Math.PI, 360);
      return {
        ...template,
        id: String(template.id),
        positionRos: geoCoordinateToRos(geoOrigin, coordinate),
        rpyDeg: [0, 0, yawDeg],
        routeId: route.id,
        status,
        isSynthetic: true,
        scenarioElapsedSeconds: elapsed,
        incidentActive,
      };
    });
  }

  return {
    sample,
    incident: incidentFeature ? {
      id: String(incidentFeature.properties?.id || 'wide-area-incident'),
      name: String(incidentFeature.properties?.name || 'Route deviation'),
      severity: String(incidentFeature.properties?.severity || 'HIGH'),
      triggerAtSeconds,
      targetDroneIndex,
      coordinate: [...incidentCoordinate],
    } : null,
    diagnostics: {
      routeCount: routes.length,
      fleetSize: drones.length,
      seed: Number(seed),
      triggerAtSeconds,
      targetDroneIndex,
    },
  };
}
