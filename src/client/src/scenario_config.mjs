const EXPECTED_SCHEMA_VERSION = 1;
const EXPECTED_FRAME = 'mujoco_x_north_y_minus_east_z_up';
const REQUIRED_PATHS = Object.freeze([
  'geoOrigin',
  'mapray',
  'runtimeManifest',
  'terrainGrid',
  'buildings',
  'buildingsLod1',
]);
const OPTIONAL_PATHS = Object.freeze(['operationsLayer']);

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[ScenarioConfig] ${label} must be a non-empty string`);
  }
  return value.trim();
}

function resolveSameOriginUrl(baseUrl, pathValue, label) {
  const base = new URL(baseUrl, window.location.href);
  const resolved = new URL(requireNonEmptyString(pathValue, label), base);
  if (resolved.origin !== base.origin) {
    throw new Error(`[ScenarioConfig] ${label} must remain on the viewer origin`);
  }
  return resolved.toString();
}

function requirePositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`[ScenarioConfig] ${label} must be a positive number`);
  }
  return number;
}

async function loadJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`[ScenarioConfig] failed to load ${label}: ${url}`);
  }
  return await response.json();
}

export function validateRuntimeAssetManifest(data, scenarioId) {
  if (!data || data.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error('[ScenarioConfig] unsupported runtime asset manifest schema');
  }
  if (data.scenarioId !== scenarioId) {
    throw new Error('[ScenarioConfig] runtime asset manifest scenario mismatch');
  }
  const contract = data.coordinateContract;
  if (!contract || contract.frame !== EXPECTED_FRAME) {
    throw new Error('[ScenarioConfig] runtime asset coordinate frame mismatch');
  }
  if (!Number.isFinite(Number(contract.zBaselineM))) {
    throw new Error('[ScenarioConfig] runtime asset zBaselineM must be finite');
  }
  const paths = new Set((data.files || []).map((item) => item?.path));
  for (const required of ['terrain-grid.json', 'buildings.xml', 'buildings-lod1.json']) {
    if (!paths.has(required)) {
      throw new Error(`[ScenarioConfig] runtime asset manifest is missing ${required}`);
    }
  }
  return data;
}

export function validateScenarioConfig(data) {
  if (!data || data.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error('[ScenarioConfig] unsupported scenario schema');
  }
  requireNonEmptyString(data.id, 'id');
  if (data.coordinateContract?.frame !== EXPECTED_FRAME) {
    throw new Error('[ScenarioConfig] unsupported coordinate frame');
  }
  if (data.coordinateContract?.threeModelHeight !== 'modelHeightsM') {
    throw new Error('[ScenarioConfig] Three.js must use modelHeightsM');
  }
  if (data.coordinateContract?.maprayAbsoluteHeight !== 'modelHeightsM + zBaselineM') {
    throw new Error('[ScenarioConfig] Mapray absolute-height contract is invalid');
  }
  for (const name of REQUIRED_PATHS) {
    requireNonEmptyString(data.paths?.[name], `paths.${name}`);
  }
  if (data.coverage) {
    for (const name of ['wideArea', 'localDetail']) {
      const coverage = data.coverage[name];
      requireNonEmptyString(coverage?.label, `coverage.${name}.label`);
      requirePositiveNumber(coverage?.widthM, `coverage.${name}.widthM`);
      requirePositiveNumber(coverage?.heightM, `coverage.${name}.heightM`);
      requireNonEmptyString(coverage?.dataStatus, `coverage.${name}.dataStatus`);
      requireNonEmptyString(coverage?.display, `coverage.${name}.display`);
    }
    if (data.coverage.localDetail.selectionHalfExtentM != null) {
      requirePositiveNumber(
        data.coverage.localDetail.selectionHalfExtentM,
        'coverage.localDetail.selectionHalfExtentM',
      );
    }
  }
  requireNonEmptyString(data.web3d?.root, 'web3d.root');
  requireNonEmptyString(data.web3d?.viewerConfigName, 'web3d.viewerConfigName');
  requireNonEmptyString(data.web3d?.sceneConfigPath, 'web3d.sceneConfigPath');
  return data;
}

export async function loadViewerScenarioConfig(
  viewerConfigUrl = '/config/viewer-config-shibuya.json',
) {
  const absoluteViewerConfigUrl = new URL(viewerConfigUrl, window.location.href).toString();
  const viewerConfig = await loadJson(absoluteViewerConfigUrl, 'viewer scenario config');
  if (viewerConfig?.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error('[ScenarioConfig] unsupported viewer scenario schema');
  }
  const scenarioUrl = resolveSameOriginUrl(
    absoluteViewerConfigUrl,
    viewerConfig.scenarioConfigPath,
    'scenarioConfigPath',
  );
  const scenario = validateScenarioConfig(await loadJson(scenarioUrl, 'scenario config'));
  const urls = Object.fromEntries(
    REQUIRED_PATHS.map((name) => [
      name,
      resolveSameOriginUrl(scenarioUrl, scenario.paths[name], `paths.${name}`),
    ]),
  );
  for (const name of OPTIONAL_PATHS) {
    if (scenario.paths?.[name]) {
      urls[name] = resolveSameOriginUrl(scenarioUrl, scenario.paths[name], `paths.${name}`);
    }
  }
  const runtimeManifest = validateRuntimeAssetManifest(
    await loadJson(urls.runtimeManifest, 'runtime asset manifest'),
    scenario.id,
  );
  if (runtimeManifest.coordinateContract.frame !== scenario.coordinateContract.frame) {
    throw new Error('[ScenarioConfig] scenario and runtime coordinate frames differ');
  }
  const web3d = {
    ...scenario.web3d,
    ...(viewerConfig.web3d || {}),
  };
  const sceneConfigUrl = resolveSameOriginUrl(
    absoluteViewerConfigUrl,
    web3d.sceneConfigPath,
    'web3d.sceneConfigPath',
  );
  return {
    ...scenario,
    viewerConfigUrl: absoluteViewerConfigUrl,
    scenarioUrl,
    urls,
    runtimeManifest,
    web3d: { ...web3d, sceneConfigUrl },
  };
}
