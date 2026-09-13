export const MAPRAY_MODEL_PHASE0_VERSION = 1;
export const REQUIRED_MAPRAY_VERSION = '0.9.6';
export const DEFAULT_ROTOR_DIRECTIONS = Object.freeze([-1, 1, -1, 1]);

const REQUIRED_MAPRAY_APIS = Object.freeze([
  ['mapray.ModelEntity', (mapray) => mapray?.ModelEntity],
  ['mapray.SceneLoader', (mapray) => mapray?.SceneLoader],
  ['mapray.GeoPoint', (mapray) => mapray?.GeoPoint],
  ['mapray.Orientation', (mapray) => mapray?.Orientation],
  ['mapray.cloud.CloudApiV2', (mapray) => mapray?.cloud?.CloudApiV2],
  ['mapray.cloud.CloudApi.TokenType.API_KEY', (mapray) => mapray?.cloud?.CloudApi?.TokenType?.API_KEY],
  ['maprayui.StandardUIViewer', (_mapray, maprayui) => maprayui?.StandardUIViewer],
]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function inspectMapray096Api(mapray, maprayui) {
  const missing = REQUIRED_MAPRAY_APIS
    .filter(([, resolve]) => resolve(mapray, maprayui) == null)
    .map(([name]) => name);
  return {
    requiredVersion: REQUIRED_MAPRAY_VERSION,
    ok: missing.length === 0,
    missing,
  };
}

export function normalizeDatasetId(value) {
  const normalized = String(value ?? '').trim();
  return /^\d+$/.test(normalized) ? normalized : '';
}

export function validatePhase0Config(config) {
  if (!config || config.schemaVersion !== 1) {
    throw new Error('[MaprayModelPhase0] unsupported config schema');
  }
  if (config.sdkVersion !== REQUIRED_MAPRAY_VERSION) {
    throw new Error(`[MaprayModelPhase0] sdkVersion must be ${REQUIRED_MAPRAY_VERSION}`);
  }
  const position = config.position || {};
  for (const name of ['longitude', 'latitude', 'altitude']) {
    if (!Number.isFinite(Number(position[name]))) {
      throw new Error(`[MaprayModelPhase0] position.${name} must be finite`);
    }
  }
  if (!Number.isFinite(Number(config.airframeHeadingDeg ?? 0))) {
    throw new Error('[MaprayModelPhase0] airframeHeadingDeg must be finite');
  }
  for (const name of ['heading', 'tilt', 'roll']) {
    if (!Number.isFinite(Number(config.orientationOffsetDeg?.[name] ?? 0))) {
      throw new Error(`[MaprayModelPhase0] orientationOffsetDeg.${name} must be finite`);
    }
  }
  if (config.missingRotorSpeedMode != null
    && !['fixture', 'stop'].includes(config.missingRotorSpeedMode)) {
    throw new Error('[MaprayModelPhase0] missingRotorSpeedMode must be fixture or stop');
  }
  if (config.camera?.minZoomDistanceMeters != null
    && (!Number.isFinite(Number(config.camera.minZoomDistanceMeters))
      || Number(config.camera.minZoomDistanceMeters) < 1)) {
    throw new Error('[MaprayModelPhase0] camera.minZoomDistanceMeters must be at least 1');
  }
  if (!Array.isArray(config.rotors) || config.rotors.length !== 4) {
    throw new Error('[MaprayModelPhase0] exactly four rotors are required');
  }
  config.rotors.forEach((rotor, index) => {
    if (!Array.isArray(rotor?.offsetRosM) || rotor.offsetRosM.length !== 3
      || rotor.offsetRosM.some((value) => !Number.isFinite(Number(value)))) {
      throw new Error(`[MaprayModelPhase0] rotors[${index}].offsetRosM must contain three finite values`);
    }
    if (!['cw', 'ccw'].includes(rotor.spinDirection)) {
      throw new Error(`[MaprayModelPhase0] rotors[${index}].spinDirection must be cw or ccw`);
    }
  });
  return config;
}

export function advanceRotorPhases(
  phases,
  angularSpeedsRadPerSec,
  deltaSeconds,
  directions = DEFAULT_ROTOR_DIRECTIONS,
  visualSpeedLimitRadPerSec = Number.POSITIVE_INFINITY,
) {
  const safeDt = Math.min(0.1, Math.max(0, finiteNumber(deltaSeconds)));
  const limit = Math.max(0, finiteNumber(visualSpeedLimitRadPerSec, Number.POSITIVE_INFINITY));
  return Array.from({ length: 4 }, (_, index) => {
    const phase = finiteNumber(phases?.[index]);
    const rawSpeed = Math.abs(finiteNumber(angularSpeedsRadPerSec?.[index]));
    const speed = Math.min(rawSpeed, limit);
    const direction = finiteNumber(directions?.[index], DEFAULT_ROTOR_DIRECTIONS[index]) < 0 ? -1 : 1;
    const next = (phase + direction * speed * safeDt) % (Math.PI * 2);
    return next < 0 ? next + Math.PI * 2 : next;
  });
}

export function rotorDirectionsFromConfig(rotors) {
  return rotors.map((rotor) => rotor.spinDirection === 'cw' ? -1 : 1);
}

export function rosOffsetToGeoPoint(origin, offsetRosM, visualScale = 1) {
  const latitude = finiteNumber(origin?.latitude);
  const longitude = finiteNumber(origin?.longitude);
  const altitude = finiteNumber(origin?.altitude);
  const scale = Math.max(0, finiteNumber(visualScale, 1));
  const northM = finiteNumber(offsetRosM?.[0]) * scale;
  const eastM = -finiteNumber(offsetRosM?.[1]) * scale;
  const upM = finiteNumber(offsetRosM?.[2]) * scale;
  const latitudeRadians = latitude * Math.PI / 180;
  const longitudeMetersPerDegree = 111_319.5 * Math.max(0.01, Math.cos(latitudeRadians));
  return {
    longitude: longitude + eastM / longitudeMetersPerDegree,
    latitude: latitude + northM / 111_319.5,
    altitude: altitude + upM,
  };
}
