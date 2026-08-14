import { HakoniwaFrame } from './frame.js?v=w6-20260808-9';
import { loadGeoOrigin } from './geo_origin.js?v=w6-20260808-9';
import { createMaprayLayer, loadMaprayConfig } from './mapray_layer.js?v=phase-e-20260813-14';
import { CollisionEventTracker } from './collision_events.mjs?v=w6-20260808-9';
import { loadTerrainHeightSampler } from './terrain_height.mjs?v=r1-20260809-1';
import { loadViewerScenarioConfig } from './scenario_config.mjs?v=phase-e-20260813-14';
import { setupLocationSelector } from './location_selector.mjs?v=phase-e-20260813-1';
import { FlightStateStore } from './flight_state_store.mjs?v=r4-20260809-1';
import { evaluateFlightRules } from './flight_rules.mjs?v=r8-20260811-1';
import { generateFleetSyntheticData } from './fleet_manager.mjs?v=r8-20260811-1';
import { getOperationsExtent, normalizeOperationsData } from './operations_layer.mjs?v=phase-e-20260813-14';
import {
  buildExecutionSourceUrl,
  describeExecutionSource,
  parseScenarioRuntimeOptions,
} from './scenario_runtime.mjs?v=demo-compare-20260814-1';
import { createWideAreaScenario } from './wide_area_scenario.mjs?v=c1-20260811-1';
import {
  BrowserPerformanceMonitor,
  downloadPerformanceReport,
  parseBenchmarkOptions,
} from './performance_monitor.mjs?v=r8-20260811-1';
import {
  PhaseDEvaluationRecorder,
  applyPhaseDTrialToGeoJson,
  downloadPhaseDResult,
  loadPhaseDEvaluationDefinition,
  parsePhaseDEvaluationOptions,
  resolvePhaseDTrial,
} from './operations_evaluation.mjs?v=phase-d-20260812-1';
import {
  computeDraggedLayout,
  computeLayoutPixels,
  normalizeLayoutMode,
} from './layout_modes.mjs?v=r4-20260809-1';

console.log("[HakoniwaGeoViewer] main.js loaded");
const leafletDrones = new Map();
const collisionTracker = new CollisionEventTracker();
const flightStateStore = new FlightStateStore({ maxIncidents: 100 });
const incidentLeafletMarkers = new Map();
const renderedIncidentIds = new Set();

window.__hakoniwaFlightStateStore = flightStateStore;
Object.defineProperty(window, '__hakoniwaCollisionEvents', {
  configurable: true,
  get: () => flightStateStore.getSnapshot().incidents,
});
const DEFAULT_THREEJS_ROOT = "/third_party/hakoniwa-web3d-drone";
const DEFAULT_VIEWER_CONFIG_NAME = "viewer-config-legacy.json";
const DEFAULT_SCENARIO_VIEWER_CONFIG = "/hakoniwa-geo-viewer/config/viewer-config-shibuya.json";
const DEFAULT_OPERATIONS_GEOJSON = "/hakoniwa-geo-viewer/config/operations/shibuya-patrol.geojson";
const scenarioRuntime = parseScenarioRuntimeOptions(window.location.search);
const benchmarkOptions = parseBenchmarkOptions(window.location.search);
const phaseDEvaluationOptions = parsePhaseDEvaluationOptions(window.location.search);
const phaseDEvaluationDefinitionPromise = phaseDEvaluationOptions.enabled
  ? loadPhaseDEvaluationDefinition(phaseDEvaluationOptions.definitionUrl)
  : Promise.resolve(null);
window.__hakoniwaRuntimeOptions = scenarioRuntime;
window.__hakoniwaPhaseDEvaluationOptions = phaseDEvaluationOptions;

const DEFAULT_SCENARIO_DRONES = generateFleetSyntheticData(
  scenarioRuntime.fleetSize,
  undefined,
  { seed: scenarioRuntime.seed },
);

function consumeMaprayApiKey() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const apiKey = hash.get('maprayApiKey') || url.searchParams.get('maprayApiKey') || url.searchParams.get('maprayToken');
  hash.delete('maprayApiKey');
  url.searchParams.delete('maprayApiKey');
  url.searchParams.delete('maprayToken');
  url.hash = hash.toString();
  if (apiKey) {
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }
  return apiKey;
}

async function resolveMaprayApiKey() {
  const urlKey = consumeMaprayApiKey();
  if (urlKey) return urlKey;

  const response = await fetch('/__runtime/mapray-config', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Mapray runtime config load failed: HTTP ${response.status}`);
  }
  const runtimeConfig = await response.json();
  return String(runtimeConfig.apiKey || '').trim() || null;
}

function getThreejsRootFromQuery(defaultRoot = DEFAULT_THREEJS_ROOT) {
  const params = new URLSearchParams(window.location.search);
  const root = params.get("threejsRoot");
  if (!root || root.trim().length === 0) {
    return defaultRoot;
  }
  return root.endsWith("/") ? root.slice(0, -1) : root;
}

function getViewerConfigNameFromQuery(defaultName = DEFAULT_VIEWER_CONFIG_NAME) {
  const params = new URLSearchParams(window.location.search);
  const name = params.get("viewerConfigName");
  if (!name || name.trim().length === 0) {
    return scenarioRuntime.isLive && scenarioRuntime.liveProfile === 'kinematic'
      ? 'viewer-config-fleets.json'
      : defaultName;
  }
  return name;
}

function getScenarioViewerConfigFromQuery() {
  const value = new URLSearchParams(window.location.search).get('scenarioConfig');
  return value && value.trim().length > 0
    ? value.trim()
    : DEFAULT_SCENARIO_VIEWER_CONFIG;
}

function getMaprayLoadMode() {
  if (benchmarkOptions.enabled && benchmarkOptions.mode === 'mapray-base') return 'base';
  if (benchmarkOptions.enabled && benchmarkOptions.mode === 'mapray-full') return 'full';
  const mode = new URLSearchParams(window.location.search).get('maprayMode');
  return ['base', 'dem', 'full'].includes(mode) ? mode : 'full';
}

function getMaprayBuildingSourceMode(defaultMode = 'public-wide') {
  const mode = new URLSearchParams(window.location.search).get('maprayBuildings');
  return ['public-wide', 'private-local', 'hybrid', 'none'].includes(mode)
    ? mode
    : defaultMode;
}

function isLeafletOnlyMode() {
  return (benchmarkOptions.enabled && benchmarkOptions.mode === 'leaflet-fallback')
    || (phaseDEvaluationOptions.enabled && phaseDEvaluationOptions.mode === 'leaflet');
}

function resolveByBase(baseUrl, pathValue) {
  const absoluteBase = new URL(baseUrl, window.location.href).toString();
  return new URL(pathValue, absoluteBase).toString();
}

function resolvePathForThreejsRoot(threejsRoot, configUrl, pathValue) {
  if (typeof pathValue !== "string" || pathValue.length === 0) {
    return pathValue;
  }
  if (pathValue.startsWith("/")) {
    return new URL(`${threejsRoot}${pathValue}`, window.location.href).toString();
  }
  return resolveByBase(configUrl, pathValue);
}

async function loadThreejsViewerConfig(threejsRoot, viewerConfigName) {
  const configUrl = new URL(`${threejsRoot}/config/${viewerConfigName}`, window.location.href).toString();
  const res = await fetch(configUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`[HakoniwaGeoViewer] failed to load threejs viewer config: HTTP ${res.status} ${configUrl}`);
  }
  const cfg = await res.json();
  if (!cfg?.three?.sceneConfigPath || !cfg?.pdu?.pduDefPath) {
    throw new Error(`[HakoniwaGeoViewer] invalid viewer config: ${configUrl}`);
  }
  const resolvedSceneConfigPath = resolvePathForThreejsRoot(threejsRoot, configUrl, cfg.three.sceneConfigPath);
  const resolvedPduDefPath = resolvePathForThreejsRoot(threejsRoot, configUrl, cfg.pdu.pduDefPath);
  const normalizedConfig = JSON.parse(JSON.stringify(cfg));
  normalizedConfig.three.sceneConfigPath = resolvedSceneConfigPath;
  normalizedConfig.pdu.pduDefPath = resolvedPduDefPath;
  return {
    configUrl,
    config: normalizedConfig,
    sceneConfigPath: resolvedSceneConfigPath,
    pduDefPath: resolvedPduDefPath,
    wireVersion: cfg?.pdu?.wireVersion ?? "v2",
    wsUri: cfg?.pdu?.wsUri ?? "ws://127.0.0.1:8765",
  };
}

async function loadThreejsModules(threejsRoot) {
  const viewerModuleUrl = new URL(
    `${threejsRoot}/src/public/drone_viewer.js`,
    window.location.href,
  );
  viewerModuleUrl.searchParams.set('v', 'phase-e-20260813-13');
  const viewerModule = await import(viewerModuleUrl.href);
  return {
    createDroneViewer: viewerModule.createDroneViewer,
    terrainGridEnvironmentVersion:
      Number(viewerModule.TERRAIN_GRID_ENVIRONMENT_VERSION ?? 0),
    mjcfBuildingGeometryVersion:
      Number(viewerModule.MJCF_BUILDING_GEOMETRY_VERSION ?? 0),
    lod1CityEnvironmentVersion:
      Number(viewerModule.LOD1_CITY_ENVIRONMENT_VERSION ?? 0),
    plateau3dTilesEnvironmentVersion:
      Number(viewerModule.PLATEAU_3DTILES_ENVIRONMENT_VERSION ?? 0),
    selectionSyncApiVersion:
      Number(viewerModule.SELECTION_SYNC_API_VERSION ?? 0),
  };
}

// マップ初期化
const map = L.map('map').setView([35.6625, 139.70625], 16);
let geoOrigin = { latitude: 35.6625, longitude: 139.70625, altitude: 0.0, z_offset: 0.0 };
let maprayLayer = null;
let terrainHeightSampler = null;
let operationsData = null;
let operationsFeatureCollectionForDisplay = null;
let wideAreaScenario = null;
let scenarioCoverage = {
  wideArea: { label: '5km overview', display: 'standard map + DEM' },
  localDetail: {
    label: '600m detail',
    display: 'PLATEAU LOD1 + textured B3D',
    selectionHalfExtentM: 320,
  },
};
const operationsLeafletLayers = [];
const viewerScenarioPromise = loadViewerScenarioConfig(getScenarioViewerConfigFromQuery());
let ORIGIN_LAT = 35.6625;
let ORIGIN_LON = 139.70625;
const TRAIL_KEEP_MS = 60_000;
const TRAIL_SAMPLE_INTERVAL_MS = 500;
const TRAIL_MAX_POINTS = 120;
let followMode = true;
const droneIcon = L.icon({
  iconUrl: '/hakoniwa-geo-viewer/images/drone.svg',
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

// OSMタイル
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

console.log("[HakoniwaGeoViewer] Map initialized");

function renderLeafletOperationsData(geojsonData) {
  if (!geojsonData || !Array.isArray(geojsonData.features)) return;
  for (const layer of operationsLeafletLayers.splice(0)) map.removeLayer(layer);
  function add(layer, tooltip) {
    layer.addTo(map);
    if (tooltip) layer.bindTooltip(tooltip);
    operationsLeafletLayers.push(layer);
  }
  for (const feature of geojsonData.features) {
    if (feature.properties?.type === 'planned_route' && feature.geometry?.type === 'LineString') {
      const latlngs = feature.geometry.coordinates.map((c) => [c[1], c[0]]);
      add(
        L.polyline(latlngs, {
          color: feature.properties?.color || '#00bfff',
          weight: 4,
          dashArray: '8, 8',
          opacity: 0.85,
        }),
        feature.properties?.name,
      );
    } else if (feature.properties?.type === 'geofence' && feature.geometry?.type === 'Polygon') {
      const latlngs = feature.geometry.coordinates[0].map((c) => [c[1], c[0]]);
      const exclusion = feature.properties?.rule === 'exclusion';
      add(
        L.polygon(latlngs, {
          color: exclusion ? '#e11d48' : '#0284c7',
          weight: exclusion ? 3 : 2,
          dashArray: exclusion ? null : '12, 8',
          fillColor: exclusion ? '#ef4444' : '#38bdf8',
          fillOpacity: exclusion ? 0.22 : 0.05,
        }),
        feature.properties?.name,
      );
    } else if (feature.properties?.type === 'local_analysis_area' && feature.geometry?.type === 'Polygon') {
      const latlngs = feature.geometry.coordinates[0].map((c) => [c[1], c[0]]);
      add(
        L.polygon(latlngs, {
          color: '#f59e0b',
          weight: 3,
          dashArray: '5, 5',
          fillColor: '#fbbf24',
          fillOpacity: 0.12,
        }),
        feature.properties?.name,
      );
    } else if (feature.properties?.type === 'vertiport' && feature.geometry?.type === 'Point') {
      const coordinate = feature.geometry.coordinates;
      add(
        L.circleMarker([coordinate[1], coordinate[0]], {
          radius: 8,
          color: '#14532d',
          fillColor: '#22c55e',
          fillOpacity: 0.9,
          weight: 2,
        }),
        `[BASE] ${feature.properties?.name || 'Operations base'}`,
      );
    } else if (feature.properties?.type === 'incident_site' && feature.geometry?.type === 'Point') {
      const coordinate = feature.geometry.coordinates;
      add(
        L.circleMarker([coordinate[1], coordinate[0]], {
          radius: 10,
          color: '#7f1d1d',
          fillColor: '#ef4444',
          fillOpacity: 0.9,
          weight: 3,
        }),
        `[INCIDENT] ${feature.properties?.name || 'Incident site'}`,
      );
    } else if (feature.properties?.type === 'landmark' && feature.geometry?.type === 'Point') {
      const coordinate = feature.geometry.coordinates;
      add(
        L.circleMarker([coordinate[1], coordinate[0]], {
          radius: 9,
          color: '#713f12',
          fillColor: '#facc15',
          fillOpacity: 0.95,
          weight: 3,
        }),
        `[LANDMARK] ${feature.properties?.name || 'Landmark'}`,
      );
    }
  }
}

function getOrCreateDroneState(id) {
  const normalizedId = String(id);
  let st = leafletDrones.get(normalizedId);
  if (!st) {
    st = {
      marker: null,
      trail: [],
      trailPolyline: null,
      lastState: null,
    };
    leafletDrones.set(normalizedId, st);
  }
  return st;
}

function updateDroneMarker(droneId, lat, lon, yawDeg) {
  const st = getOrCreateDroneState(droneId);
  const latlng = [lat, lon];

  if (!st.marker) {
    st.marker = L.marker(latlng, {
      icon: droneIcon,
    }).addTo(map);
    st.marker.on('click', () => {
      flightStateStore.selectDrone(String(droneId), { source: 'leaflet' });
    });
  } else {
    st.marker.setLatLng(latlng);
    st.marker.setRotationAngle(-yawDeg);
  }
}

function updateDroneTrail(droneId, lat, lon) {
  const st = getOrCreateDroneState(droneId);
  const lastP = st.trail[st.trail.length - 1];
  const now = Date.now();
  if (
    lastP &&
    (
      now - lastP.t < TRAIL_SAMPLE_INTERVAL_MS
      || (
        Math.abs(lastP.lat - lat) < 1e-6
        && Math.abs(lastP.lon - lon) < 1e-6
      )
    )
  ) {
    return;
  }
  st.trail.push({ lat, lon, t: now });

  const cutoff = now - TRAIL_KEEP_MS;
  st.trail = st.trail
    .filter(p => p.t >= cutoff)
    .slice(-TRAIL_MAX_POINTS);

  if (st.trail.length < 2) return;

  const latlngs = st.trail.map(p => [p.lat, p.lon]);
  if (!st.trailPolyline) {
    st.trailPolyline = L.polyline(latlngs, {
      color: '#ff4500',
      weight: 4,
      opacity: 0.85
    }).addTo(map);
  } else {
    st.trailPolyline.setLatLngs(latlngs);
  }
}

function evaluateDroneRuleAndCollisions(drone) {
  const [rosX, rosY, rosZ] = drone.positionRos;
  if (!drone.geo) {
    const [enuX, enuY] = HakoniwaFrame.rosToEnuFrame(rosX, rosY, rosZ);
    const [lat, lon] = HakoniwaFrame.ENUToLatLon(ORIGIN_LAT, ORIGIN_LON, enuX, enuY);
    drone.geo = { latitude: lat, longitude: lon, altitude: geoOrigin.altitude + rosZ + (geoOrigin.z_offset || 0) };
  }

  if (operationsData && drone.geo) {
    const ruleEvents = evaluateFlightRules(drone, operationsData, geoOrigin);
    for (const ev of ruleEvents) {
      const existing = flightStateStore.getSnapshot().incidents.find((i) => i.id === ev.id);
      if (!existing) {
        flightStateStore.addIncident({
          id: ev.id,
          droneId: String(ev.droneId),
          surfaceLabel: ev.title,
          surfaceType: 'rule_violation',
          impactSpeedMps: 0,
          color: ev.severity === 'HIGH' ? [1.0, 0.1, 0.1] : [1.0, 0.6, 0.1],
          contactPositionRos: [rosX, rosY, rosZ],
          contactNormalRos: [0, 0, 1],
          time: ev.timestamp,
          source: 'flight_rules',
        });
      }
    }
  }
}

function initializeUi() {
  let viewer = null;
  let threeEnvironmentScope = 'wide';
  let started = false;
  let pollingTimer = null;
  let maprayInitialization = null;
  let geoContextInitialization = null;
  let activeLayoutMode = 'operations';
  let customMapRatio = null;
  let lastSelectionSource = 'none';
  let comparisonViewState = {
    scope: 'wide',
    targetLabel: '5km center',
    source: 'initial',
  };
  window.__hakoniwaR4Diagnostics = () => ({
    snapshot: flightStateStore.getSnapshot(),
    selectionSource: lastSelectionSource,
    threeFocusedDroneId: viewer?.getFocusedDroneId?.() ?? null,
    mapray: maprayLayer?.getSelectionDiagnostics?.() ?? null,
    layout: window.__hakoniwaLayoutDiagnostics ?? null,
  });

  const wsUriInput = document.getElementById('ws-uri-input');
  const viewerConfigNameInput = document.getElementById('viewer-config-name');
  const droneProfileSelect = document.getElementById('drone-profile-select');
  const environmentModeSelect = document.getElementById('environment-mode-select');
  const connectBtn = document.getElementById('connect-btn');
  const connectionStatus = document.getElementById('connection-status');
  const environmentStatus = document.getElementById('environment-status');
  const scenarioModeStatus = document.getElementById('scenario-mode-status');
  const locationSelect = document.getElementById('location-select');
  const executionSourceSelect = document.getElementById('execution-source-select');
  const executionSourceStatus = document.getElementById('execution-source-status');
  const comparisonSyncStatus = document.getElementById('comparison-sync-status');
  const benchmarkWarmupInput = document.getElementById('benchmark-warmup-sec');
  const benchmarkDurationInput = document.getElementById('benchmark-duration-sec');
  const benchmarkStartBtn = document.getElementById('benchmark-start-btn');
  const benchmarkStopBtn = document.getElementById('benchmark-stop-btn');
  const benchmarkDownloadBtn = document.getElementById('benchmark-download-btn');
  const benchmarkStatus = document.getElementById('benchmark-status');
  const droneSelect = document.getElementById("drone-select");
  const followCheckbox = document.getElementById('follow-checkbox');
  const demoCheckbox = document.getElementById('demo-flight-checkbox');
  const focusWideAreaBtn = document.getElementById('focus-wide-area-btn');
  const focusIncidentBtn = document.getElementById('focus-incident-btn');
  const focusLocalAreaBtn = document.getElementById('focus-local-area-btn');
  const focusSelectedDroneBtn = document.getElementById('focus-selected-drone-btn');
  const wideAreaStatus = document.getElementById('wide-area-status');
  const triggerTestCollisionBtn = document.getElementById('trigger-test-collision-btn');
  const latInput = document.getElementById('origin-lat');
  const lonInput = document.getElementById('origin-lon');
  const applyOriginBtn = document.getElementById('apply-origin-btn');
  const collisionSummary = document.getElementById('collision-summary');
  const collisionList = document.getElementById('collision-list');
  const collisionDetail = document.getElementById('collision-detail');
  const selectionStatus = document.getElementById('selection-status');
  const layoutModeSelect = document.getElementById('layout-mode-select');
  const layoutStatus = document.getElementById('layout-status');
  const rightContainer = document.getElementById('right-container');
  const mapContainer = document.getElementById('map-container');
  const threeContainer = document.getElementById('three-container');
  const threeLocalStatus = document.getElementById('three-local-status');
  const splitter = document.getElementById('splitter');
  const phaseDPanel = document.getElementById('phase-d-evaluation-panel');
  const phaseDTrialLabel = document.getElementById('phase-d-evaluation-trial');
  const phaseDParticipantInput = document.getElementById('phase-d-participant-id');
  const phaseDStartBtn = document.getElementById('phase-d-start-btn');
  const phaseDFinishBtn = document.getElementById('phase-d-finish-btn');
  const phaseDStatus = document.getElementById('phase-d-evaluation-status');
  const phaseDAnswerFields = document.getElementById('phase-d-answer-fields');
  const phaseDAnswerDrone = document.getElementById('phase-d-answer-drone');
  const phaseDAnswerIncident = document.getElementById('phase-d-answer-incident');
  const phaseDAnswerType = document.getElementById('phase-d-answer-type');
  const phaseDAnswerLocation = document.getElementById('phase-d-answer-location');
  const phaseDHesitations = document.getElementById('phase-d-hesitations');
  const phaseDConfidence = document.getElementById('phase-d-confidence');
  const phaseDUsefulInformation = document.getElementById('phase-d-useful-information');
  const phaseDUnnecessaryDisplay = document.getElementById('phase-d-unnecessary-display');
  const phaseDDownloadCsv = document.getElementById('phase-d-download-csv');
  const phaseDDownloadJson = document.getElementById('phase-d-download-json');
  let phaseDDefinition = null;
  let phaseDTrial = null;
  let phaseDRecorder = null;
  let phaseDResult = null;
  let phaseDTimer = null;

  async function ensurePhaseDTrial() {
    if (!phaseDEvaluationOptions.enabled) return null;
    if (phaseDTrial) return phaseDTrial;
    phaseDDefinition = await phaseDEvaluationDefinitionPromise;
    phaseDTrial = resolvePhaseDTrial(phaseDDefinition, {
      trialId: phaseDEvaluationOptions.trialId,
      seed: scenarioRuntime.seed,
    });
    if (Number(phaseDTrial.seed) !== Number(scenarioRuntime.seed)) {
      throw new Error(`Phase D trial seed ${phaseDTrial.seed} does not match URL seed ${scenarioRuntime.seed}`);
    }
    return phaseDTrial;
  }

  function fillSelect(select, choices, placeholder = '選択してください') {
    if (!select) return;
    select.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = placeholder;
    select.appendChild(blank);
    for (const choice of choices) {
      const option = document.createElement('option');
      option.value = String(choice.value);
      option.textContent = String(choice.label);
      select.appendChild(option);
    }
  }

  async function setupPhaseDEvaluation() {
    if (!phaseDEvaluationOptions.enabled) return;
    document.body.classList.add('phase-d-evaluation');
    if (phaseDPanel) phaseDPanel.hidden = false;
    if (demoCheckbox) demoCheckbox.disabled = true;
    if (triggerTestCollisionBtn) triggerTestCollisionBtn.disabled = true;
    try {
      const trial = await ensurePhaseDTrial();
      if (phaseDParticipantInput) {
        phaseDParticipantInput.value = phaseDEvaluationOptions.participantId === 'PENDING'
          ? '' : phaseDEvaluationOptions.participantId;
      }
      if (phaseDTrialLabel) {
        phaseDTrialLabel.textContent = `${phaseDEvaluationOptions.mode.toUpperCase()} / ${trial.trialId} / seed ${trial.seed}`;
      }
      fillSelect(
        phaseDAnswerDrone,
        DEFAULT_SCENARIO_DRONES.map((drone) => ({
          value: drone.id,
          label: drone.id,
        })),
      );
      fillSelect(
        phaseDAnswerIncident,
        phaseDDefinition.trials.map((item) => ({
          value: item.correct.incidentId,
          label: item.correct.incidentId,
        })),
      );
      fillSelect(phaseDAnswerType, phaseDDefinition.answerOptions.incidentTypes);
      fillSelect(phaseDAnswerLocation, phaseDDefinition.answerOptions.locations);
      if (phaseDStatus) phaseDStatus.textContent = 'ready / start trialを押してください';
    } catch (error) {
      if (phaseDStatus) phaseDStatus.textContent = `setup error: ${error.message || error}`;
      if (phaseDStartBtn) phaseDStartBtn.disabled = true;
      throw error;
    }
  }

  async function startPhaseDEvaluation() {
    const trial = await ensurePhaseDTrial();
    const participantId = String(phaseDParticipantInput?.value || '').trim();
    if (!/^[a-zA-Z0-9_.-]+$/.test(participantId)) {
      throw new Error('Evaluator IDを半角英数字で入力してください');
    }
    await ensureGeoContext();
    await ensureMaprayInitialized();
    if (phaseDEvaluationOptions.mode === 'mapray' && !maprayLayer?.ready) {
      throw new Error('Maprayが利用可能な状態ではありません。API Keyと接続状態を確認してください');
    }
    phaseDRecorder = new PhaseDEvaluationRecorder({
      definition: phaseDDefinition,
      trial,
      options: { ...phaseDEvaluationOptions, participantId },
    });
    phaseDRecorder.start();
    window.__hakoniwaPhaseDEvaluationRecorder = phaseDRecorder;
    if (phaseDStartBtn) phaseDStartBtn.disabled = true;
    if (phaseDFinishBtn) phaseDFinishBtn.disabled = false;
    if (phaseDAnswerFields) phaseDAnswerFields.hidden = false;
    if (phaseDParticipantInput) phaseDParticipantInput.disabled = true;
    if (demoCheckbox) {
      demoCheckbox.checked = true;
      updateDemoFlight();
    }
    if (phaseDStatus) phaseDStatus.textContent = 'running / 異常発生を待って運航判断を行ってください';
    phaseDTimer = setInterval(() => {
      if (!phaseDRecorder || phaseDRecorder.state !== 'running' || !phaseDStatus) return;
      const elapsed = (performance.now() - phaseDRecorder.startedAtMs) / 1_000;
      phaseDStatus.textContent = `running ${elapsed.toFixed(1)}s / operations ${phaseDRecorder.operations.length}`;
    }, 250);
  }

  function finishPhaseDEvaluation() {
    if (!phaseDRecorder || phaseDRecorder.state !== 'running') return;
    const required = [phaseDAnswerDrone, phaseDAnswerIncident, phaseDAnswerType, phaseDAnswerLocation];
    if (required.some((select) => !select?.value)) {
      throw new Error('異常機ID、インシデントID、異常種別、異常地点をすべて回答してください');
    }
    phaseDResult = phaseDRecorder.finish({
      droneId: phaseDAnswerDrone.value,
      incidentId: phaseDAnswerIncident.value,
      incidentType: phaseDAnswerType.value,
      location: phaseDAnswerLocation.value,
      hesitations: phaseDHesitations?.value,
      confidence: phaseDConfidence?.value,
      usefulInformation: phaseDUsefulInformation?.value,
      unnecessaryDisplay: phaseDUnnecessaryDisplay?.value,
    });
    window.__hakoniwaPhaseDEvaluationResult = phaseDResult;
    if (phaseDTimer) clearInterval(phaseDTimer);
    phaseDTimer = null;
    if (demoCheckbox) {
      demoCheckbox.checked = false;
      updateDemoFlight();
    }
    if (phaseDFinishBtn) phaseDFinishBtn.disabled = true;
    if (phaseDDownloadCsv) phaseDDownloadCsv.disabled = false;
    if (phaseDDownloadJson) phaseDDownloadJson.disabled = false;
    if (phaseDStatus) {
      const correct = Object.values(phaseDResult.scores).filter(Boolean).length;
      phaseDStatus.textContent = `complete / score ${correct}/6 / CSVとJSONを保存してください`;
    }
  }

  phaseDStartBtn?.addEventListener('click', () => {
    void startPhaseDEvaluation().catch((error) => {
      if (phaseDStatus) phaseDStatus.textContent = `start error: ${error.message || error}`;
    });
  });
  phaseDFinishBtn?.addEventListener('click', () => {
    try {
      finishPhaseDEvaluation();
    } catch (error) {
      if (phaseDStatus) phaseDStatus.textContent = `finish error: ${error.message || error}`;
    }
  });
  phaseDDownloadCsv?.addEventListener('click', () => downloadPhaseDResult(phaseDResult, 'csv'));
  phaseDDownloadJson?.addEventListener('click', () => downloadPhaseDResult(phaseDResult, 'json'));
  document.addEventListener('click', (event) => {
    if (!event.isTrusted || !phaseDRecorder || phaseDRecorder.state !== 'running') return;
    if (phaseDPanel?.contains(event.target)) return;
    const target = event.target?.closest?.('[id],button,select,canvas') || event.target;
    phaseDRecorder.recordOperation('click', {
      target: target?.id || target?.tagName?.toLowerCase?.() || 'unknown',
    });
  }, { capture: true });
  void setupPhaseDEvaluation().catch((error) => {
    console.error('[PhaseD] setup failed:', error);
  });

  const executionSourceDetails = describeExecutionSource(scenarioRuntime);
  if (scenarioModeStatus) {
    scenarioModeStatus.textContent = `STATE: ${executionSourceDetails.label} / ${scenarioRuntime.fleetSize}機 / seed ${scenarioRuntime.seed}`;
    scenarioModeStatus.dataset.scenarioMode = scenarioRuntime.scenarioMode;
  }
  if (executionSourceSelect) {
    executionSourceSelect.value = executionSourceDetails.id;
    executionSourceSelect.addEventListener('change', () => {
      const nextUrl = buildExecutionSourceUrl(executionSourceSelect.value, window.location.href);
      window.location.assign(nextUrl);
    });
  }
  if (executionSourceStatus) {
    const requirement = executionSourceDetails.requiresPdu
      ? 'Core launcherとPDU接続が必要です。'
      : 'このページだけで実行できます。';
    executionSourceStatus.textContent = `${executionSourceDetails.label}: ${executionSourceDetails.detail}。${requirement}`;
  }
  setupLocationSelector(
    locationSelect,
    window.location.href,
    (url) => window.location.assign(url),
  );

  function updateComparisonSyncStatus({
    scope = threeEnvironmentScope,
    targetLabel = comparisonViewState.targetLabel,
    source = comparisonViewState.source,
  } = {}) {
    comparisonViewState = { scope, targetLabel, source };
    const selectedDroneId = flightStateStore.getSnapshot().selectedDroneId;
    const scopeLabel = scope === 'local' ? '600m local' : '5km wide';
    const selectedLabel = selectedDroneId ? ` / selected ${selectedDroneId}` : '';
    if (comparisonSyncStatus) {
      comparisonSyncStatus.textContent = `SYNC TARGET: ${scopeLabel} / ${targetLabel}${selectedLabel}`;
    }
    window.__hakoniwaComparisonDiagnostics = () => ({
      displayComparison: {
        mapray: 'Mapray 3D GIS / DEM / imagery / B3D / operations',
        directPlateau: 'Direct PLATEAU / Three.js / LOD1 / local DEM',
      },
      executionSource: executionSourceDetails,
      view: { ...comparisonViewState, selectedDroneId },
      mapray: maprayLayer?.getSelectionDiagnostics?.() ?? null,
      three: {
        environmentScope: viewer?.getEnvironmentScope?.() ?? threeEnvironmentScope,
        focusedDroneId: viewer?.getFocusedDroneId?.() ?? null,
      },
    });
  }
  updateComparisonSyncStatus();

  window.__hakoniwaDiagnostics = () => {
    const snapshot = flightStateStore.getSnapshot();
    let leafletTrailPointCount = 0;
    let maximumLeafletTrailLength = 0;
    let leafletTrajectoryCount = 0;
    for (const state of leafletDrones.values()) {
      const count = Array.isArray(state.trail) ? state.trail.length : 0;
      leafletTrailPointCount += count;
      maximumLeafletTrailLength = Math.max(maximumLeafletTrailLength, count);
      if (state.trailPolyline) leafletTrajectoryCount += 1;
    }
    return {
      runtime: scenarioRuntime,
      store: flightStateStore.getDiagnostics(),
      leaflet: {
        droneCount: leafletDrones.size,
        trajectoryCount: leafletTrajectoryCount,
        incidentCount: incidentLeafletMarkers.size,
        trailPointCount: leafletTrailPointCount,
        maximumTrailLength: maximumLeafletTrailLength,
        limits: {
          maxTrailPointsPerDrone: TRAIL_MAX_POINTS,
          trailKeepMs: TRAIL_KEEP_MS,
          trailSampleIntervalMs: TRAIL_SAMPLE_INTERVAL_MS,
        },
      },
      mapray: maprayLayer?.getDiagnostics?.() ?? null,
      three: {
        configuredDroneCount: viewer?.getDrones?.()?.length ?? 0,
        focusedDroneId: viewer?.getFocusedDroneId?.() ?? null,
        environmentScope: viewer?.getEnvironmentScope?.() ?? threeEnvironmentScope,
        environments: viewer?.getEnvironmentDiagnostics?.() ?? [],
      },
      comparison: window.__hakoniwaComparisonDiagnostics?.() ?? null,
      snapshotRevision: snapshot.revision,
    };
  };

  let latestBenchmarkReport = null;
  const performanceMonitor = new BrowserPerformanceMonitor({
    diagnosticsProvider: () => window.__hakoniwaDiagnostics?.() ?? null,
    onUpdate: (sample) => {
      if (!benchmarkStatus) return;
      const elapsed = sample.phase === 'warmup'
        ? sample.elapsedTotalSeconds
        : sample.elapsedMeasurementSeconds;
      const target = sample.phase === 'warmup'
        ? Number(benchmarkWarmupInput?.value || benchmarkOptions.warmupSeconds)
        : Number(benchmarkDurationInput?.value || benchmarkOptions.durationSeconds);
      const heap = Number.isFinite(sample.jsHeapUsedMb) ? ` / heap ${sample.jsHeapUsedMb.toFixed(1)} MB` : '';
      benchmarkStatus.textContent = `${sample.phase} ${elapsed.toFixed(0)}/${target}s / ${sample.pageFps.toFixed(1)} page FPS${heap}`;
    },
    onComplete: (report) => {
      latestBenchmarkReport = report;
      window.__hakoniwaLatestBenchmarkReport = report;
      if (benchmarkStatus) {
        const fps = report.summary?.pageFps?.median;
        benchmarkStatus.textContent = `complete / page FPS median ${fps ?? 'n/a'} / errors ${report.errors.length}`;
      }
      if (benchmarkStartBtn) benchmarkStartBtn.disabled = false;
      if (benchmarkStopBtn) benchmarkStopBtn.disabled = true;
      if (benchmarkDownloadBtn) benchmarkDownloadBtn.disabled = false;
      if (benchmarkOptions.autoDownload) downloadPerformanceReport(report);
    },
  });

  function startBenchmark() {
    const warmupSeconds = Number(benchmarkWarmupInput?.value ?? benchmarkOptions.warmupSeconds);
    const durationSeconds = Number(benchmarkDurationInput?.value ?? benchmarkOptions.durationSeconds);
    latestBenchmarkReport = null;
    if (benchmarkStartBtn) benchmarkStartBtn.disabled = true;
    if (benchmarkStopBtn) benchmarkStopBtn.disabled = false;
    if (benchmarkDownloadBtn) benchmarkDownloadBtn.disabled = true;
    performanceMonitor.start({
      warmupSeconds,
      durationSeconds,
      runId: benchmarkOptions.runId,
      metadata: {
        sdk: { mapray: '0.9.6', three: '0.160.0', leaflet: '1.9.4' },
        runtime: scenarioRuntime,
        benchmarkMode: benchmarkOptions.mode,
        pageUrl: window.location.href.replace(/([?&](?:maprayApiKey|maprayToken)=)[^&#]*/gi, '$1<redacted>'),
      },
    });
  }

  if (benchmarkWarmupInput) benchmarkWarmupInput.value = benchmarkOptions.warmupSeconds;
  if (benchmarkDurationInput) benchmarkDurationInput.value = benchmarkOptions.durationSeconds;
  if (benchmarkStatus) benchmarkStatus.textContent = `${benchmarkOptions.mode} / actual browser metrics`;
  benchmarkStartBtn?.addEventListener('click', startBenchmark);
  benchmarkStopBtn?.addEventListener('click', () => performanceMonitor.stop('manual'));
  benchmarkDownloadBtn?.addEventListener('click', () => {
    if (latestBenchmarkReport) downloadPerformanceReport(latestBenchmarkReport);
  });
  window.__hakoniwaBenchmark = {
    options: benchmarkOptions,
    start: startBenchmark,
    stop: (reason = 'diagnostic-api') => performanceMonitor.stop(reason),
    getLatestReport: () => latestBenchmarkReport,
    downloadLatest: () => downloadPerformanceReport(latestBenchmarkReport),
    markMilestone: (name, detail = null) => performanceMonitor.markMilestone(name, detail),
  };

  // パネルの数値プロパティ DOM
  const propX = document.getElementById('prop-x');
  const propY = document.getElementById('prop-y');
  const propZ = document.getElementById('prop-z');
  const propRoll = document.getElementById('prop-roll');
  const propPitch = document.getElementById('prop-pitch');
  const propYaw = document.getElementById('prop-yaw');

  function updateSelectedDronePanel(selectedDrone) {
    if (!selectedDrone) return;
    const [x, y, z] = selectedDrone.positionRos || [0, 0, 0];
    const [roll, pitch, yaw] = selectedDrone.rpyDeg || [0, 0, 0];

    if (propX) propX.textContent = Number(x).toFixed(3);
    if (propY) propY.textContent = Number(y).toFixed(3);
    if (propZ) propZ.textContent = Number(z).toFixed(3);
    if (propRoll) propRoll.textContent = Number(roll).toFixed(1);
    if (propPitch) propPitch.textContent = Number(pitch).toFixed(1);
    if (propYaw) propYaw.textContent = Number(yaw).toFixed(1);
  }

  function updateIncidentUiList(snapshot) {
    const summaryElem = document.getElementById('collision-summary');
    const listElem = document.getElementById('collision-list');
    if (!summaryElem || !listElem) return;

    const safeSnapshot = snapshot || flightStateStore.getSnapshot();
    const incidents = Array.isArray(safeSnapshot?.incidents) ? safeSnapshot.incidents : [];
    const count = incidents.length;
    if (count === 0) {
      summaryElem.textContent = '0件';
      return;
    }

    const latest = incidents[count - 1];
    const impact = Number(latest?.impactSpeedMps || 0).toFixed(1);
    summaryElem.textContent = `${count}件 / 最新: ${latest?.surfaceLabel || 'Incident'} ${impact} m/s*`;

    for (const event of incidents) {
      if (!event || !event.id || renderedIncidentIds.has(event.id)) continue;
      renderedIncidentIds.add(event.id);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'collision-event';
      row.dataset.eventId = event.id;
      row.dataset.surfaceType = event.surfaceType || 'building';
      const eventImpact = Number(event?.impactSpeedMps || 0).toFixed(1);
      const sourceLabel = event.source === 'impulse_collision'
        ? 'ImpulseCollision'
        : (event.source === 'synthetic_scenario'
          ? 'Scenario'
          : (event.source === 'hakoniwa_core_kinematic' ? 'HakoniwaCore' : 'FlightRules'));
      const metric = ['synthetic_scenario', 'hakoniwa_core_kinematic'].includes(event.source)
        ? event.severity || 'HIGH'
        : `${eventImpact} m/s*`;
      row.textContent = `${event.surfaceLabel || 'Incident'} | ${metric} | ${sourceLabel}`;
      row.addEventListener('click', () => {
        flightStateStore.selectIncident(event.id, { source: 'incident-list' });
        applyLayoutMode('incident');
      });
      listElem.prepend(row);
      while (listElem.children.length > 15) {
        listElem.lastElementChild.remove();
      }
    }
  }

  // 衝突テスト手動発火ボタンの確実なイベント登録
  let testCollisionCounter = 0;
  if (triggerTestCollisionBtn) {
    triggerTestCollisionBtn.onclick = () => {
      try {
        testCollisionCounter += 1;
        const snapshot = flightStateStore.getSnapshot();
        const drones = Array.isArray(snapshot?.drones) && snapshot.drones.length > 0
          ? snapshot.drones
          : (Array.isArray(window.__hakoniwaDefaultDrones) ? window.__hakoniwaDefaultDrones : DEFAULT_SCENARIO_DRONES);
        const targetDroneId = snapshot?.selectedDroneId || drones[0]?.id || 'Drone-A';
        const targetDrone = drones.find((d) => String(d?.id) === String(targetDroneId)) || drones[0] || {
          id: 'Drone-A',
          positionRos: [168.9, -253.9, 23.8],
        };
        const pos = Array.isArray(targetDrone?.positionRos) ? targetDrone.positionRos : [168.9, -253.9, 23.8];
        const collisionId = `user-test-collision-${Date.now()}-${testCollisionCounter}`;

        flightStateStore.addIncident({
          id: collisionId,
          droneId: String(targetDrone.id || targetDroneId),
          surfaceLabel: `Building Contact (${targetDrone.id || targetDroneId})`,
          surfaceType: 'building',
          impactSpeedMps: (3.2 + (testCollisionCounter % 4) * 0.5).toFixed(1),
          color: [1.0, 0.15, 0.1],
          contactPositionRos: [...pos],
          contactNormalRos: [0, 1, 0],
          time: Date.now(),
          source: 'impulse_collision',
        }, { select: true });

        updateIncidentUiList(flightStateStore.getSnapshot());
      } catch (err) {
        console.error('[HakoniwaGeoViewer] triggerTestCollisionBtn failed:', err);
        const stackSnippet = String(err?.stack || '').split('\n').slice(0, 4).join('\n');
        alert(`衝突テスト発火エラー: ${err?.message || err}\n${stackSnippet}`);
      }
    };
  }

  const pageParams = new URLSearchParams(window.location.search);
  const isR7 = scenarioRuntime.isFixture || scenarioRuntime.isReplay;
  const isCoreKinematic = scenarioRuntime.isLive && scenarioRuntime.liveProfile === 'kinematic';
  const isR4 = pageParams.get('r4Fixture') === '1';
  const autoDemoFlight = isR7
    && !phaseDEvaluationOptions.enabled
    && pageParams.get('demoFlight') === '1';
  const localPresentationMode = autoDemoFlight
    && pageParams.get('localPresentation') === '1';
  const autoCameraTour = pageParams.get('autoCameraTour') === '1';
  if (isR7) {
    followMode = false;
    if (followCheckbox) followCheckbox.checked = false;
  }

  let demoTimer = null;
  let demoAngle = 0;
  let demoStepCount = 0;
  let demoStartedAtMilliseconds = 0;
  let wideAreaIncidentRecorded = false;
  let wideAreaCameraStage = 0;

  // 実際の MJCF ビル群（X=150m〜230m, Y=-200m〜-300m, Z=23m 付近）を通るパトロールルート
  const buildingWaypoints = [
    { x: 168.9, y: -253.9, z: 23.8 },
    { x: 224.2, y: -266.5, z: 23.2 },
    { x: 181.7, y: -266.7, z: 23.8 },
    { x: 231.4, y: -265.5, z: 23.2 },
  ];

  function updateDemoFlight() {
    if (demoTimer) {
      clearInterval(demoTimer);
      demoTimer = null;
    }
    if (!demoCheckbox?.checked) {
      return;
    }

    demoStartedAtMilliseconds = performance.now();
    wideAreaIncidentRecorded = false;
    wideAreaCameraStage = 0;
    if (isR7) {
      if (localPresentationMode) void focusLocalAreaView({ source: 'presentation-start' });
      else void focusWideAreaView({ source: 'scenario-start' });
    }

    // デモ飛行開始時にストアが空であればURL指定の機数を初期化
    let currentDrones = flightStateStore.getSnapshot().drones;
    if (currentDrones.length === 0) {
      flightStateStore.updateDrones(DEFAULT_SCENARIO_DRONES, { replace: true, source: 'demo-init' });
      currentDrones = flightStateStore.getSnapshot().drones;
    }

    if (!demoTimer) {
      demoTimer = setInterval(() => {
        demoAngle += 0.015;
        demoStepCount += 1;
        const elapsedSeconds = Math.max(0, (performance.now() - demoStartedAtMilliseconds) / 1_000);

function setThreeDroneVisible(vDrone, visible) {
  if (!vDrone) return;
  if (vDrone.root?.object3d) vDrone.root.object3d.visible = visible;
  if (vDrone.visualRoot) vDrone.visualRoot.visible = visible;
  if (vDrone.model?.object3d) vDrone.model.object3d.visible = visible;
  if (vDrone.operationalVisualization) {
    if (vDrone.operationalVisualization.marker) vDrone.operationalVisualization.marker.visible = visible;
    if (vDrone.operationalVisualization.beacon) vDrone.operationalVisualization.beacon.visible = visible;
    if (vDrone.operationalVisualization.trailLine) vDrone.operationalVisualization.trailLine.visible = visible;
  }
}

        if (isR7 && wideAreaScenario && !localPresentationMode) {
          const updatedDrones = wideAreaScenario.sample(elapsedSeconds);
          if (viewer && typeof viewer.getDrones === 'function') {
            viewer.getDrones().forEach((vDrone, idx) => {
              const state = updatedDrones[idx];
              if (state) {
                setThreeDroneVisible(vDrone, true);
                vDrone.applyState?.({
                  rosPos: state.positionRos,
                  rosRpyDeg: state.rpyDeg,
                  rotorSpeedsRadPerSec: [60, 60, 60, 60],
                });
              } else {
                setThreeDroneVisible(vDrone, false);
              }
            });
          }
          flightStateStore.updateDrones(updatedDrones, {
            replace: true,
            source: 'synthetic-wide-area',
          });
          updatedDrones.forEach(evaluateDroneRuleAndCollisions);

          const incident = wideAreaScenario.incident;
          if (incident && elapsedSeconds >= incident.triggerAtSeconds && !wideAreaIncidentRecorded) {
            wideAreaIncidentRecorded = true;
            const target = updatedDrones[incident.targetDroneIndex];
            if (target) {
              const eventId = `${incident.id}-${scenarioRuntime.seed}`;
              flightStateStore.addIncident({
                id: eventId,
                droneId: String(target.id),
                surfaceLabel: `${incident.name} (${target.id})`,
                surfaceType: 'route_deviation',
                severity: incident.severity,
                impactSpeedMps: 0,
                color: [1.0, 0.15, 0.1],
                contactPositionRos: [...target.positionRos],
                contactNormalRos: [0, 0, 1],
                time: Date.now(),
                source: 'synthetic_scenario',
              }, { select: autoCameraTour && !phaseDEvaluationOptions.enabled });
              phaseDRecorder?.recordIncident({
                incidentId: eventId,
                droneId: String(target.id),
                scenarioElapsedSeconds: elapsedSeconds,
              });
            }
          }

          if (autoCameraTour && !phaseDEvaluationOptions.enabled
            && incident && elapsedSeconds >= incident.triggerAtSeconds && wideAreaCameraStage === 0) {
            wideAreaCameraStage = 1;
            void focusIncidentView({ source: 'automatic', selectTarget: true });
          } else if (incident && elapsedSeconds >= incident.triggerAtSeconds + 8 && wideAreaCameraStage === 1) {
            wideAreaCameraStage = 2;
            void focusLocalAreaView({ source: 'automatic' });
          } else if (incident && elapsedSeconds >= incident.triggerAtSeconds + 20 && wideAreaCameraStage === 2) {
            wideAreaCameraStage = 3;
            void focusWideAreaView({ source: 'automatic-return' });
          }
          return;
        }

        const snapshot = flightStateStore.getSnapshot();
        const baseDrones = Array.isArray(snapshot?.drones) && snapshot.drones.length > 0
          ? snapshot.drones
          : DEFAULT_SCENARIO_DRONES;

        const updatedDrones = baseDrones.map((drone, idx) => {
          let rosX = 0;
          let rosY = 0;
          let rosZ = 25.0;

          if (localPresentationMode) {
            const routeBand = idx % 3;
            const memberIndex = Math.floor(idx / 3);
            const radius = 85.0 + routeBand * 55.0;
            const angle = demoAngle * (0.34 + routeBand * 0.025)
              + memberIndex * (Math.PI * 2 / 10)
              + routeBand * Math.PI / 6;
            rosX = Math.cos(angle) * radius;
            rosY = Math.sin(angle) * radius;
            rosZ = 90.0 + routeBand * 15.0 + Math.sin(demoAngle * 1.5 + idx) * 3.0;
          } else if (idx < 5) {
            const wp = buildingWaypoints[idx % buildingWaypoints.length];
            const orbitRadius = 12.0 + idx * 3.0;
            const angle = demoAngle * 0.8 + idx * (Math.PI / 3);
            rosX = wp.x + Math.cos(angle) * orbitRadius;
            rosY = wp.y + Math.sin(angle) * orbitRadius;
            rosZ = wp.z + Math.sin(demoAngle * 2 + idx) * 3.0;
          } else {
            const radius = 25.0 + (idx - 5) * 8.0;
            const angle = demoAngle * 0.7 + idx * (Math.PI / 4);
            rosX = Math.cos(angle) * radius;
            rosY = Math.sin(angle) * radius;
            rosZ = 26.0 + Math.cos(demoAngle * 2 + idx) * 4.0;
          }

          const yawDeg = ((demoAngle * 50.0 + idx * 30.0) % 360.0 + 360.0) % 360.0;
          const rollDeg = Math.sin(demoAngle * 3 + idx) * 6.0;
          const pitchDeg = Math.cos(demoAngle * 3 + idx) * 6.0;

          return {
            ...drone,
            id: String(drone.id),
            positionRos: [rosX, rosY, rosZ],
            rpyDeg: [rollDeg, pitchDeg, yawDeg],
          };
        });

        // Three.js インスタンスへの正規適用 (applyState を使用 & 未使用機体を非表示)
        if (viewer && typeof viewer.getDrones === 'function') {
          const vDrones = viewer.getDrones();
          vDrones.forEach((vDrone, idx) => {
            if (idx < updatedDrones.length) {
              const u = updatedDrones[idx];
              setThreeDroneVisible(vDrone, true);
              vDrone.applyState?.({
                rosPos: u.positionRos,
                rosRpyDeg: u.rpyDeg,
                rotorSpeedsRadPerSec: [60, 60, 60, 60],
              });
            } else {
              setThreeDroneVisible(vDrone, false);
            }
          });
        }

        flightStateStore.updateDrones(updatedDrones, { replace: true, source: 'demo-flight' });

        // 運航ルール違反判定
        if (Array.isArray(snapshot?.drones)) {
          snapshot.drones.forEach((drone) => {
            evaluateDroneRuleAndCollisions(drone);
          });
        }

        // デモ飛行中、約2.5秒（25ステップ）ごとに確実にビル衝突インシデントを追加・カウントアップ
        if (!localPresentationMode && (demoStepCount === 5 || demoStepCount % 25 === 0)) {
          const incidentIndex = Math.floor(demoStepCount / 25);
          const targetIndex = incidentIndex % baseDrones.length;
          const targetDrone = baseDrones[targetIndex];
          if (targetDrone) {
            const collisionId = `demo-contact-${demoStepCount}-${targetDrone.id}`;
            flightStateStore.addIncident({
              id: collisionId,
              droneId: String(targetDrone.id),
              surfaceLabel: `Building Contact (${targetDrone.id})`,
              surfaceType: 'building',
              impactSpeedMps: (2.3 + (targetIndex % 4) * 0.7).toFixed(1),
              color: [1.0, 0.2, 0.1],
              contactPositionRos: [...targetDrone.positionRos],
              contactNormalRos: [0, 1, 0],
              time: Date.now(),
              source: 'impulse_collision',
            });
          }
        }
      }, 100);
    }
  }

  if (demoCheckbox) {
    demoCheckbox.addEventListener('change', updateDemoFlight);
    if (isCoreKinematic) {
      demoCheckbox.checked = false;
      demoCheckbox.disabled = true;
      demoCheckbox.title = '箱庭コアがシナリオ時刻と状態を生成します';
    }
  }

  if (droneProfileSelect) {
    droneProfileSelect.value = pageParams.get('droneProfile') ?? 'base';
  }
  if (environmentModeSelect) {
    environmentModeSelect.value = pageParams.get('environmentMode') ?? 'physics';
  }
  activeLayoutMode = normalizeLayoutMode(pageParams.get('layoutMode'));
  if (layoutModeSelect) layoutModeSelect.value = activeLayoutMode;

  latInput.value = ORIGIN_LAT;
  lonInput.value = ORIGIN_LON;

  function applyPaneLayout(layout, { notify = true, resizeMapray = true } = {}) {
    const mapVisible = layout.splitterVisible;
    mapContainer.style.display = mapVisible ? 'block' : 'none';
    splitter.style.display = mapVisible ? 'block' : 'none';
    mapContainer.style.height = `${layout.mapHeight}px`;
    threeContainer.style.height = `${layout.threeHeight}px`;
    if (layoutStatus) {
      const mapPercent = rightContainer.clientHeight > 0
        ? Math.round(layout.mapHeight / rightContainer.clientHeight * 100)
        : 0;
      layoutStatus.textContent = mapVisible
        ? `Layout: ${layout.mode} (map ${mapPercent}% / 3D ${100 - mapPercent}%)`
        : 'Layout: offline (3D only)';
    }
    window.__hakoniwaLayoutDiagnostics = {
      ...layout,
      selectedMode: activeLayoutMode,
      mapray: maprayLayer?.getSelectionDiagnostics?.() ?? null,
    };
    if (!notify) return;
    requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      const three = viewer?.resize?.() ?? null;
      const mapray = resizeMapray ? maprayLayer?.resize?.() ?? null : null;
      window.__hakoniwaLayoutDiagnostics = {
        ...window.__hakoniwaLayoutDiagnostics,
        three,
        mapray,
      };
    });
  }

  function applyLayoutMode(mode, { notify = true } = {}) {
    activeLayoutMode = normalizeLayoutMode(mode);
    customMapRatio = null;
    if (layoutModeSelect) layoutModeSelect.value = activeLayoutMode;
    applyPaneLayout(computeLayoutPixels(rightContainer.clientHeight, activeLayoutMode), { notify });
    if (activeLayoutMode !== 'offline') void ensureMaprayInitialized();
  }

  function applyCurrentLayout({ notify = true, resizeMapray = true } = {}) {
    const layout = customMapRatio == null
      ? computeLayoutPixels(rightContainer.clientHeight, activeLayoutMode)
      : computeDraggedLayout(
        rightContainer.clientHeight,
        rightContainer.clientHeight * customMapRatio,
      );
    applyPaneLayout(layout, { notify: false });
    if (!notify) return;
    requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      const three = viewer?.resize?.() ?? null;
      const mapray = resizeMapray ? maprayLayer?.resize?.() ?? null : null;
      window.__hakoniwaLayoutDiagnostics = {
        ...window.__hakoniwaLayoutDiagnostics,
        three,
        mapray,
      };
    });
  }

  function ensureGeoContext() {
    if (geoContextInitialization) return geoContextInitialization;
    geoContextInitialization = (async () => {
      const scenario = await viewerScenarioPromise;
      scenarioCoverage = {
        wideArea: { ...scenarioCoverage.wideArea, ...(scenario.coverage?.wideArea || {}) },
        localDetail: { ...scenarioCoverage.localDetail, ...(scenario.coverage?.localDetail || {}) },
      };
      if (focusWideAreaBtn) focusWideAreaBtn.textContent = scenarioCoverage.wideArea.label;
      if (focusLocalAreaBtn) {
        focusLocalAreaBtn.textContent = scenarioCoverage.localDetail.label;
        focusLocalAreaBtn.title = scenarioCoverage.localDetail.dataStatus === 'ready'
          ? scenarioCoverage.localDetail.display
          : `${scenarioCoverage.localDetail.display}（下段は5km表示を維持します）`;
      }
      if (wideAreaStatus) {
        wideAreaStatus.textContent = `${scenarioCoverage.wideArea.label}: ${scenarioCoverage.wideArea.display} / ${scenarioCoverage.localDetail.label}: ${scenarioCoverage.localDetail.dataStatus}`;
      }
      const originConfig = await loadGeoOrigin(scenario.urls.geoOrigin);
      window.__hakoniwaScenario = scenario;
      geoOrigin = {
        ...(originConfig.origin || originConfig),
        z_offset: Number(originConfig.z_offset || 0),
      };
      ORIGIN_LAT = Number(geoOrigin.latitude);
      ORIGIN_LON = Number(geoOrigin.longitude);
      latInput.value = ORIGIN_LAT;
      lonInput.value = ORIGIN_LON;
      map.setView([ORIGIN_LAT, ORIGIN_LON], 16);
      terrainHeightSampler = scenario.urls.terrainGrid
        ? await loadTerrainHeightSampler(scenario.urls.terrainGrid)
        : null;

      try {
        const opsRes = await fetch(scenario.urls.operationsLayer || DEFAULT_OPERATIONS_GEOJSON);
        if (opsRes.ok) {
          let operationsGeoJson = await opsRes.json();
          if (phaseDEvaluationOptions.enabled) {
            const trial = await ensurePhaseDTrial();
            operationsGeoJson = applyPhaseDTrialToGeoJson(operationsGeoJson, trial);
          }
          operationsData = normalizeOperationsData(operationsGeoJson);
          operationsFeatureCollectionForDisplay = phaseDEvaluationOptions.enabled
            ? {
              ...operationsData.featureCollection,
              features: operationsData.featureCollection.features.filter(
                (feature) => feature?.properties?.type !== 'incident_site',
              ),
            }
            : operationsData.featureCollection;
          renderLeafletOperationsData(operationsFeatureCollectionForDisplay);
          wideAreaScenario = createWideAreaScenario({
            operationsData,
            fleet: DEFAULT_SCENARIO_DRONES,
            geoOrigin,
            seed: scenarioRuntime.seed,
          });
          window.__hakoniwaWideAreaScenario = wideAreaScenario;
          if (maprayLayer) maprayLayer.loadOperationsData(operationsFeatureCollectionForDisplay);
        }
      } catch (err) {
        console.warn("[HakoniwaGeoViewer] Operations GeoJSON load warning:", err);
      }

      performanceMonitor.markMilestone('geo-context-ready', {
        scenarioId: scenario.id,
        operationsRoutes: operationsData?.plannedRoutes?.length ?? 0,
        operationsAreas: operationsData?.geofences?.length ?? 0,
      });

      return scenario;
    })();
    return geoContextInitialization;
  }

  async function initializeMapray() {
    const status = document.querySelector('.mapray-status');
    try {
      if (status) status.textContent = 'Mapray設定を読み込み中...';
      const [scenario, apiKey, maprayConfig] = await Promise.all([
        ensureGeoContext(),
        isLeafletOnlyMode()
          ? Promise.resolve(null)
          : resolveMaprayApiKey(),
        viewerScenarioPromise.then((value) => loadMaprayConfig(value.urls.mapray)),
      ]);
      if (scenario.urls.terrainGrid) maprayConfig.terrainGridUrl = scenario.urls.terrainGrid;
      maprayConfig.loadMode = getMaprayLoadMode();
      maprayConfig.buildingSourceMode = getMaprayBuildingSourceMode(
        maprayConfig.buildingSourceMode,
      );

      const container = document.getElementById('mapray-container');
      if (status) status.textContent = apiKey
        ? 'Mapray Datasetへ接続中...'
        : (isLeafletOnlyMode()
          ? (phaseDEvaluationOptions.enabled ? 'Phase D: Leaflet condition' : 'Benchmark: Leaflet fallback')
          : 'Mapray API Key未設定: Leaflet表示');
      maprayLayer = await createMaprayLayer(container, geoOrigin, apiKey, maprayConfig, status);
      if (operationsFeatureCollectionForDisplay) {
        maprayLayer.loadOperationsData(operationsFeatureCollectionForDisplay);
      }
      maprayLayer.setSelectionHandler((target) => {
        if (target.type === 'drone') {
          flightStateStore.selectDrone(target.id, { source: 'mapray' });
        } else if (target.type === 'incident') {
          flightStateStore.selectIncident(target.id, { source: 'mapray' });
          applyLayoutMode('incident');
        }
      });
      const snapshot = flightStateStore.getSnapshot();
      for (const drone of snapshot.drones) {
        const [x, y, z] = drone.positionRos;
        maprayLayer.update(drone.id, x, y, z);
      }
      for (const incident of snapshot.incidents) maprayLayer.addCollision(incident);
      maprayLayer.setSelectedDroneId(snapshot.selectedDroneId);
      if (maprayLayer && maprayLayer.ready) {
        document.getElementById('map-container')?.classList.add('mapray-active');
      } else {
        document.getElementById('map-container')?.classList.remove('mapray-active');
      }
      performanceMonitor.markMilestone('map-layer-ready', {
        benchmarkMode: benchmarkOptions.mode,
        maprayReady: Boolean(maprayLayer?.ready),
      });
      applyCurrentLayout();
    } catch (error) {
      console.error('[HakoniwaGeoViewer] Mapray initialization failed:', error);
      document.getElementById('map-container')?.classList.remove('mapray-active');
      if (status) status.textContent = `Mapray エラー (Leaflet表示): ${error.message || error}`;
    }
  }

  function ensureMaprayInitialized() {
    if (!maprayInitialization) maprayInitialization = initializeMapray();
    return maprayInitialization;
  }

  function featureBounds(feature) {
    const coordinates = feature?.geometry?.coordinates?.[0] || [];
    const latlngs = coordinates
      .filter((coordinate) => Number.isFinite(Number(coordinate?.[0])) && Number.isFinite(Number(coordinate?.[1])))
      .map((coordinate) => [Number(coordinate[1]), Number(coordinate[0])]);
    return latlngs.length >= 3 ? L.latLngBounds(latlngs) : null;
  }

  function setThreeEnvironmentScope(scope) {
    const localReady = scenarioCoverage.localDetail.dataStatus === 'ready';
    threeEnvironmentScope = scope === 'local' && localReady ? 'local' : 'wide';
    viewer?.setEnvironmentScope?.(threeEnvironmentScope);
    updateComparisonSyncStatus({ scope: threeEnvironmentScope, source: 'environment-scope' });
    if (!threeLocalStatus) return;
    if (threeEnvironmentScope === 'wide') {
      threeLocalStatus.dataset.coverage = scope === 'local' && !localReady ? 'outside' : 'overview';
      threeLocalStatus.textContent = scope === 'local' && !localReady
        ? `WIDE 5km / ${scenarioCoverage.localDetail.label} DATA PREPARATION PENDING`
        : 'WIDE 5km / PLATEAU LOD1 STREAMING';
    } else {
      threeLocalStatus.dataset.coverage = 'inside';
      threeLocalStatus.textContent = 'LOCAL 600m / PLATEAU LOD1 + MuJoCo';
    }
  }

  function updateThreeCoverageBadge() {
    if (!threeLocalStatus || threeEnvironmentScope !== 'wide' || !viewer?.getEnvironmentDiagnostics) return;
    const wide = viewer.getEnvironmentDiagnostics().find((item) => item.type === 'plateau-3dtiles');
    if (!wide) return;
    const error = wide.errorCount > 0 ? ` / ERR ${wide.errorCount}` : '';
    const localPending = scenarioCoverage.localDetail.dataStatus !== 'ready'
      ? ' / 600m DETAIL PENDING'
      : '';
    threeLocalStatus.textContent = `WIDE 5km / PLATEAU LOD1 / ${wide.readySourceCount}/${wide.sourceCount} sources / ${wide.loadedModelCount} models / ${wide.visibleTileCount} visible${error}${localPending}`;
    threeLocalStatus.dataset.coverage = wide.errorCount > 0 ? 'outside' : 'overview';
  }
  setInterval(updateThreeCoverageBadge, 1_000);

  async function focusWideAreaView({ source = 'button' } = {}) {
    await ensureGeoContext();
    followMode = false;
    if (followCheckbox) followCheckbox.checked = false;
    setThreeEnvironmentScope('wide');
    const extent = getOperationsExtent(operationsData);
    if (extent) {
      map.fitBounds([[extent.south, extent.west], [extent.north, extent.east]], { padding: [24, 24] });
      await ensureMaprayInitialized();
      maprayLayer?.focusWideArea?.(extent);
    }
    if (wideAreaStatus) {
      wideAreaStatus.textContent = `VIEW: ${scenarioCoverage.wideArea.label} (${source}) / ${scenarioCoverage.wideArea.display}`;
      wideAreaStatus.dataset.coverage = scenarioCoverage.wideArea.dataStatus || 'unknown';
    }
    updateComparisonSyncStatus({ scope: 'wide', targetLabel: '5km center', source });
    performanceMonitor.markMilestone('camera-wide-area', { source });
  }

  async function focusIncidentView({ source = 'button', selectTarget = true } = {}) {
    await ensureGeoContext();
    const feature = operationsData?.incidentSites?.[0];
    const coordinate = feature?.geometry?.coordinates;
    if (!coordinate) return;
    setThreeEnvironmentScope('local');
    map.setView([coordinate[1], coordinate[0]], 16);
    await ensureMaprayInitialized();
    maprayLayer?.focusGeoPoint?.({
      longitude: coordinate[0], latitude: coordinate[1], height: coordinate[2] || 0,
    }, { cameraHeightOffset: 700 });
    let synchronizedTarget = null;
    if (selectTarget && wideAreaScenario?.incident) {
      const target = flightStateStore.getSnapshot().drones[wideAreaScenario.incident.targetDroneIndex];
      if (target) {
        synchronizedTarget = target;
        flightStateStore.selectDrone(target.id, { source: 'wide-area-incident' });
      }
    }
    applyLayoutMode('incident');
    if (wideAreaStatus) wideAreaStatus.textContent = `VIEW: incident (${source}) / route deviation`;
    if (synchronizedTarget) {
      focusSelectedDroneView({ source: `${source}-incident-target` });
    }
    updateComparisonSyncStatus({
      scope: 'local',
      targetLabel: synchronizedTarget
        ? `drone ${synchronizedTarget.id}`
        : (feature?.properties?.name || 'incident'),
      source,
    });
    performanceMonitor.markMilestone('camera-incident', { source });
  }

  async function focusLocalAreaView({ source = 'button' } = {}) {
    await ensureGeoContext();
    const feature = operationsData?.localAnalysisAreas?.[0];
    const bounds = featureBounds(feature);
    if (!bounds) return;
    setThreeEnvironmentScope('local');
    map.fitBounds(bounds, { padding: [24, 24] });
    const center = bounds.getCenter();
    await ensureMaprayInitialized();
    maprayLayer?.focusGeoPoint?.({ longitude: center.lng, latitude: center.lat, height: 30 }, {
      cameraHeightOffset: localPresentationMode ? 650 : 1_000,
    });
    applyLayoutMode('inspection');
    if (phaseDEvaluationOptions.enabled && source === 'button') {
      const snapshot = flightStateStore.getSnapshot();
      phaseDRecorder?.markLocalAnalysis({
        selectedDroneId: snapshot.selectedDroneId,
        selectedIncidentId: snapshot.selectedIncidentId,
      });
    }
    if (wideAreaStatus) {
      wideAreaStatus.textContent = `VIEW: ${scenarioCoverage.localDetail.label} (${source}) / ${scenarioCoverage.localDetail.display}`;
      wideAreaStatus.dataset.coverage = scenarioCoverage.localDetail.dataStatus || 'unknown';
    }
    updateComparisonSyncStatus({ scope: 'local', targetLabel: '600m center', source });
    performanceMonitor.markMilestone('camera-local-area', { source });
  }

  function focusSelectedDroneView({ source = 'button' } = {}) {
    const snapshot = flightStateStore.getSnapshot();
    const selectedDroneId = snapshot.selectedDroneId;
    if (!selectedDroneId) {
      if (comparisonSyncStatus) comparisonSyncStatus.textContent = 'SYNC TARGET: 機体を選択してください';
      return false;
    }
    viewer?.focusDroneById?.(selectedDroneId);
    maprayLayer?.setSelectedDroneId?.(selectedDroneId, { focus: true });
    const marker = leafletDrones.get(String(selectedDroneId))?.marker;
    if (marker) map.panTo(marker.getLatLng());
    updateComparisonSyncStatus({
      scope: threeEnvironmentScope,
      targetLabel: `drone ${selectedDroneId}`,
      source,
    });
    return true;
  }

  focusWideAreaBtn?.addEventListener('click', () => void focusWideAreaView());
  focusIncidentBtn?.addEventListener('click', () => void focusIncidentView());
  focusLocalAreaBtn?.addEventListener('click', () => void focusLocalAreaView());
  focusSelectedDroneBtn?.addEventListener('click', () => focusSelectedDroneView());
  window.__hakoniwaWideAreaCamera = {
    wide: focusWideAreaView,
    incident: focusIncidentView,
    local: focusLocalAreaView,
    selected: focusSelectedDroneView,
  };

  if (activeLayoutMode !== 'offline') void ensureMaprayInitialized();
  void ensureGeoContext().catch((error) => {
    console.error('[HakoniwaGeoViewer] geo context initialization failed:', error);
    if (connectionStatus) connectionStatus.textContent = `Geo context error: ${error.message}`;
  });

  function populateDroneSelect(snapshot) {
    const drones = Array.isArray(snapshot?.drones) ? snapshot.drones : [];
    const knownIds = Array.from(droneSelect.options || []).map((option) => option.value);
    const nextIds = drones.map((drone) => drone.id);
    if (knownIds.join('\0') !== nextIds.join('\0')) {
      droneSelect.innerHTML = '';
      drones.forEach((drone) => {
        const opt = document.createElement("option");
        opt.value = drone.id;
        opt.textContent = drone.name;
        droneSelect.appendChild(opt);
      });
    }
    droneSelect.value = snapshot?.selectedDroneId ?? '';
  }

  droneSelect.addEventListener("change", () => {
    const selectedId = String(droneSelect.value);
    flightStateStore.selectDrone(selectedId, { source: 'panel' });
    if (viewer && followMode && threeEnvironmentScope === 'local') {
      viewer.focusDroneById(selectedId);
    }
  });

  function viewerDroneStates({ includeConfiguredPosition = false } = {}) {
    const states = viewer?.getDroneStates?.() ?? [];
    if (states.length > 0 || !includeConfiguredPosition) return states;
    return (viewer?.getDrones?.() ?? []).map((drone, index) => ({
      id: drone.droneId ?? index,
      name: drone.cfg?.name ?? String(drone.droneId ?? index),
      positionRos: drone.latestPose?.rosPos ?? drone.cfg?.pos ?? [0, 0, 0],
      rpyDeg: drone.latestPose?.rosRpyDeg ?? drone.cfg?.hpr ?? [0, 0, 0],
      pwmDuty: drone.pwmDuty ?? [],
      rotorSpeedsRadPerSec: drone.rotorSpeeds ?? [],
      collidedCounts: drone.collidedCounts,
      impulseCollision: drone.impulseCollision,
    }));
  }

  if (!connectBtn) {
    console.warn("connect-btn not found");
    return;
  }

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = "connecting...";
    if (connectionStatus) connectionStatus.textContent = 'PDU: Three.jsを初期化中...';
    const wsUri = (document.getElementById('ws-uri-input')?.value || "").trim() || "ws://127.0.0.1:8765";

    try {
      if (!viewer) {
        const scenario = await ensureGeoContext();
        const threejsRoot = getThreejsRootFromQuery(scenario.web3d.root);
        const viewerConfigName = getViewerConfigNameFromQuery(
          scenario.web3d.viewerConfigName,
        );
        const modules = await loadThreejsModules(threejsRoot);
        const viewerConfig = await loadThreejsViewerConfig(threejsRoot, viewerConfigName);
        if (isCoreKinematic) {
          viewerConfig.config.stateInput = {
            mode: 'fleets',
            fleets: {
              ...(viewerConfig.config.stateInput?.fleets || {}),
              roleMap: { visual_state_array: 'hako_msgs/DroneVisualStateArray' },
              dynamicSpawn: true,
              templateDroneIndex: 0,
              maxDynamicDrones: scenarioRuntime.fleetSize,
            },
          };
        }
        let sceneConfigPath = viewerConfig.sceneConfigPath;

        if (
          modules.terrainGridEnvironmentVersion >= 1
          && modules.mjcfBuildingGeometryVersion >= 1
          && modules.lod1CityEnvironmentVersion >= 1
          && modules.plateau3dTilesEnvironmentVersion >= 1
        ) {
          if (isR7) {
            sceneConfigPath = scenario.web3d.fixtureSceneConfigUrl
              || new URL(
                './web3d-scene-r7-fleet-fixture.json',
                scenario.web3d.sceneConfigUrl,
              ).toString();
          } else if (isR4) {
            sceneConfigPath = new URL(
              './web3d-scene-r4-selection-fixture.json',
              scenario.web3d.sceneConfigUrl,
            ).toString();
          } else {
            sceneConfigPath = scenario.web3d.sceneConfigUrl;
          }

          const versionedSceneConfigUrl = new URL(sceneConfigPath, window.location.href);
          versionedSceneConfigUrl.searchParams.set('v', 'phase-e-20260813-14');
          sceneConfigPath = versionedSceneConfigUrl.toString();
          viewerConfig.config.three.sceneConfigPath = sceneConfigPath;
          if (environmentStatus) {
            environmentStatus.textContent = isR7
              ? `3D環境: PLATEAU LOD1 + fleet fixture (${scenarioRuntime.fleetSize}機) を読み込み中...`
              : (isR4 ? '3D環境: R4 selection fixtureを読み込み中...' : `3D環境: ${scenario.displayName}を読み込み中...`);
          }
        } else if (modules.terrainGridEnvironmentVersion >= 1) {
          sceneConfigPath = new URL(
            '/config/web3d-scene-shibuya-terrain-only.json',
            window.location.href,
          ).toString();
          viewerConfig.config.three.sceneConfigPath = sceneConfigPath;
          if (environmentStatus) {
            environmentStatus.textContent =
              '3D環境: submodule更新前のためterrainのみ表示';
          }
        } else if (environmentStatus) {
          environmentStatus.textContent =
            '3D環境: submodule更新前のためbase-floorへフォールバック';
        }
        viewer = modules.createDroneViewer();
        viewer.configure(viewerConfig.config);
        if (typeof viewer.listDroneProfiles === 'function' && droneProfileSelect) {
          const catalog = await viewer.listDroneProfiles({ droneConfigPath: sceneConfigPath });
          if (catalog.profiles.length > 0) {
            const requestedProfile = pageParams.get('droneProfile');
            droneProfileSelect.innerHTML = '';
            for (const profile of catalog.profiles) {
              const option = document.createElement('option');
              option.value = profile.id;
              option.textContent = profile.label;
              option.title = profile.note || '';
              droneProfileSelect.appendChild(option);
            }
            droneProfileSelect.value = requestedProfile
              ?? catalog.defaultProfileId
              ?? catalog.profiles[0].id;
          }
        }
        await viewer.initialize({
          droneConfigPath: sceneConfigPath,
          droneProfileId: droneProfileSelect?.value || null,
          environmentMode: environmentModeSelect?.value || 'physics',
        });
        viewer.setEnvironmentScope?.(threeEnvironmentScope);
        performanceMonitor.markMilestone('threejs-ready', {
          configuredDroneCount: viewer?.getDrones?.()?.length ?? 0,
        });
        if (typeof viewer.getEnvironmentDiagnostics === 'function') {
          const diagnostics = viewer.getEnvironmentDiagnostics();
          const terrain = diagnostics.find((item) => item.type === 'terrain-grid');
          const buildings = diagnostics.find((item) => item.type === 'mjcf');
          const lod1City = diagnostics.find((item) => item.type === 'lod1-city');
          const wideLod1 = diagnostics.find((item) => item.type === 'plateau-3dtiles');
          if (environmentStatus) {
            const parts = [];
            if (terrain) {
              parts.push(
                `地形 ${terrain.vertexCount.toLocaleString()}頂点 / `
                + `Z ${terrain.minimumModelHeightM.toFixed(2)}–`
                + `${terrain.maximumModelHeightM.toFixed(2)} m`,
              );
            }
            if (buildings) {
              parts.push(`建物 ${buildings.buildingCount.toLocaleString()} boxes`);
            }
            if (lod1City) {
              parts.push(`PLATEAU LOD1 ${lod1City.buildingCount.toLocaleString()}棟`);
            }
            if (wideLod1) {
              parts.push(`5km簡略LOD1 ${wideLod1.sourceCount.toLocaleString()}自治体 streaming`);
            }
            environmentStatus.textContent = parts.length > 0
              ? `3D環境: ${parts.join(' / ')}`
              : `3D環境: ${environmentModeSelect?.value ?? 'physics'}`;
          }
          window.__hakoniwaEnvironmentDiagnostics = diagnostics;
        }
        if (viewerConfigNameInput) {
          viewerConfigNameInput.value = viewerConfigName;
        }
        if (droneProfileSelect) droneProfileSelect.disabled = true;
        if (environmentModeSelect) environmentModeSelect.disabled = true;
        if (wsUriInput && (!wsUriInput.value || wsUriInput.value.trim().length === 0)) {
          wsUriInput.value = viewerConfig.wsUri;
        }
      }
      if (!started) {
        started = true;
        const initialStates = isR7
          ? DEFAULT_SCENARIO_DRONES
          : viewerDroneStates({ includeConfiguredPosition: true });
        flightStateStore.updateDrones(initialStates, {
          source: isR7 ? scenarioRuntime.scenarioMode : 'viewer-initialize',
        });
        if (viewer && typeof viewer.getDrones === 'function') {
          const vDrones = viewer.getDrones();
          vDrones.forEach((vDrone, idx) => {
            if (idx < initialStates.length) {
              setThreeDroneVisible(vDrone, true);
            } else {
              setThreeDroneVisible(vDrone, false);
            }
          });
        }
        viewer.setFollowSelectedEnabled(followMode);
        const selectedId = flightStateStore.getSnapshot().selectedDroneId;
        if (selectedId && followMode) viewer.focusDroneById(selectedId);
        applyCurrentLayout();
      }
      if (isR4 || isR7) {
        connectBtn.textContent = 'fixture ready';
        if (connectionStatus) {
          connectionStatus.textContent = isR7
            ? `PDU: ${scenarioRuntime.displayLabel} (${scenarioRuntime.fleetSize}機・通信なし)`
            : 'PDU: R4 fixture（通信なし・選択同期の目視確認用）';
        }
        if (autoDemoFlight && demoCheckbox && !demoCheckbox.checked) {
          demoCheckbox.checked = true;
          updateDemoFlight();
        }
        return;
      }
      connectBtn.textContent = "connecting...";
      if (connectionStatus) connectionStatus.textContent = `PDU: ${wsUri}へ接続中...`;
      const ok = await viewer.connectPdu({ wsUri });
      if (!ok) throw new Error("Hakoniwa.connect() failed");

      await viewer.initDronePdu();
      wsUriInput.disabled = true;
      if (viewerConfigNameInput) {
        viewerConfigNameInput.disabled = true;
      }
      connectBtn.textContent = "connected";
      if (connectionStatus) {
        connectionStatus.textContent = isCoreKinematic
          ? `PDU: LIVE HAKONIWA / KINEMATIC (${scenarioRuntime.fleetSize}機・集約PDU)`
          : `PDU: connected (${wsUri})`;
      }
      if (isCoreKinematic) void focusWideAreaView({ source: 'core-connected' });
      startPduPolling();
    } catch (e) {
      console.error(e);
      connectBtn.textContent = "error";
      connectBtn.disabled = false;
      if (connectionStatus) connectionStatus.textContent = `PDU error: ${e.message || e}`;
    }
  });
  window.__hakoniwaUiReady = true;
  performanceMonitor.markMilestone('ui-ready');
  if (connectionStatus) connectionStatus.textContent = 'PDU: ready to connect';
  if (isR7 || (scenarioRuntime.isLive && pageParams.get('autoConnect') === '1')) {
    setTimeout(() => connectBtn.click(), 0);
  }
  if (benchmarkOptions.autoStart) setTimeout(startBenchmark, 0);
  if (applyOriginBtn) {
    applyOriginBtn.addEventListener('click', () => {
      const lat = parseFloat(latInput.value);
      const lon = parseFloat(lonInput.value);

      if (isNaN(lat) || isNaN(lon)) {
        alert("緯度・経度の入力が正しくありません");
        return;
      }

      ORIGIN_LAT = lat;
      ORIGIN_LON = lon;
      geoOrigin.latitude = lat;
      geoOrigin.longitude = lon;
      if (maprayLayer) maprayLayer.origin = geoOrigin;
      map.panTo([ORIGIN_LAT, ORIGIN_LON]);
    });
  }
  followCheckbox.addEventListener('change', () => {
    followMode = followCheckbox.checked;
    if (viewer) {
      viewer.setFollowSelectedEnabled(followMode);
    }
    if (followMode) focusSelectedDroneView({ source: 'follow-enabled' });
  });

  function renderCollisionEvent(event, incidentCount) {
    if (!event || !event.id) return;
    maprayLayer?.addCollision(event);
    if (!maprayLayer?.ready) {
      const [x, y, z] = event.contactPositionRos;
      const [east, north] = HakoniwaFrame.rosToEnuFrame(x, y, z);
      const [latitude, longitude] = HakoniwaFrame.ENUToLatLon(
        ORIGIN_LAT, ORIGIN_LON, east, north,
      );
      const marker = L.circleMarker(
        [latitude, longitude],
        { radius: 8, color: '#ff3518', fillOpacity: 0.85 }
      ).addTo(map);
      marker.bindTooltip(`${event.surfaceLabel}`);
      marker.on('click', () => {
        flightStateStore.selectIncident(event.id, { source: 'leaflet-incident' });
        applyLayoutMode('incident');
      });
      incidentLeafletMarkers.set(String(event.id), marker);
    }
    console.info('[HakoniwaGeoViewer] collision event:', event);
  }

  function startPduPolling() {
    if (pollingTimer) return;
    pollingTimer = setInterval(() => {
      if (!viewer) return;
      let states = viewerDroneStates();
      if (isCoreKinematic) {
        const sourceDiagnostics = viewer.getStateSourceDiagnostics?.() ?? null;
        const sequenceId = Math.max(1, Number(sourceDiagnostics?.sequenceId) || 1);
        const elapsedSeconds = Math.max(0, (sequenceId - 1) * 0.02);
        const configuredDroneCount = viewer.getDrones?.()?.length ?? 0;
        const transportDiagnostics = sourceDiagnostics?.transport?.transport ?? null;
        const diagnosticError = sourceDiagnostics?.lastError || transportDiagnostics?.lastError;
        const diagnosticText = diagnosticError
          ? `PDU receive error: ${diagnosticError}`
          : `PDU: LIVE HAKONIWA / KINEMATIC (WS ${transportDiagnostics?.messageCount ?? 0}/${transportDiagnostics?.dataPacketCount ?? 0} / seq ${sequenceId} / PDU ${sourceDiagnostics?.validCount ?? 0}機 / Three ${sourceDiagnostics?.stateCount ?? 0}/${configuredDroneCount}機)`;
        if (connectionStatus && connectionStatus.textContent !== diagnosticText) {
          connectionStatus.textContent = diagnosticText;
        }
        window.__hakoniwaCoreFleetDiagnostics = {
          ...sourceDiagnostics,
          scenarioElapsedSeconds: elapsedSeconds,
          expectedFleetSize: scenarioRuntime.fleetSize,
          receivedFleetSize: states.length,
          configuredDroneCount,
        };
        if (states.length === 0) return;
        const routes = operationsData?.plannedRoutes || [];
        const incident = wideAreaScenario?.incident;
        states = states.map((state, index) => ({
          ...state,
          routeId: String(routes[index % Math.max(1, routes.length)]?.properties?.id || `route-${index % 3 + 1}`),
          status: incident && index === incident.targetDroneIndex && elapsedSeconds >= incident.triggerAtSeconds
            ? (elapsedSeconds < incident.triggerAtSeconds + 2.8 ? 'WARNING' : 'HIGH')
            : 'NORMAL',
          isSynthetic: false,
          scenarioElapsedSeconds: elapsedSeconds,
          runtimeSource: 'hakoniwa-core-kinematic',
        }));
        if (
          incident
          && elapsedSeconds >= incident.triggerAtSeconds
          && !wideAreaIncidentRecorded
        ) {
          wideAreaIncidentRecorded = true;
          const target = states[incident.targetDroneIndex];
          if (target) {
            flightStateStore.addIncident({
              id: `core-${incident.id}-${scenarioRuntime.seed}`,
              droneId: String(target.id),
              surfaceLabel: `${incident.name} (${target.id})`,
              surfaceType: 'route_deviation',
              severity: incident.severity,
              impactSpeedMps: 0,
              color: [1.0, 0.15, 0.1],
              contactPositionRos: [...target.positionRos],
              contactNormalRos: [0, 0, 1],
              time: Date.now(),
              source: 'hakoniwa_core_kinematic',
            }, { source: 'hakoniwa-core', select: autoCameraTour });
          }
        }
        if (autoCameraTour && incident && elapsedSeconds >= incident.triggerAtSeconds && wideAreaCameraStage === 0) {
          wideAreaCameraStage = 1;
          void focusIncidentView({ source: 'hakoniwa-core', selectTarget: true });
        } else if (incident && elapsedSeconds >= incident.triggerAtSeconds + 8 && wideAreaCameraStage === 1) {
          wideAreaCameraStage = 2;
          void focusLocalAreaView({ source: 'hakoniwa-core' });
        } else if (incident && elapsedSeconds >= incident.triggerAtSeconds + 20 && wideAreaCameraStage === 2) {
          wideAreaCameraStage = 3;
          void focusWideAreaView({ source: 'hakoniwa-core-return' });
        }
      }
      if (states.length === 0) return;
      flightStateStore.updateDrones(states, { source: 'pdu' });
      states.forEach((drone) => {
        const [rosX, rosY, rosZ] = drone.positionRos;
        const collisionEvent = collisionTracker.update({
          droneId: drone.id,
          positionRos: [rosX, rosY, rosZ],
          collidedCounts: drone.collidedCounts,
          impulseCollision: drone.impulseCollision,
          terrainHeightM: terrainHeightSampler?.sample(rosX, rosY),
        });
        if (collisionEvent) flightStateStore.addIncident(collisionEvent);

        evaluateDroneRuleAndCollisions(drone);
      });
    }, 100);
  }

  flightStateStore.subscribe((snapshot, change) => {
    window.__hakoniwaFlightSnapshot = snapshot;
    viewer?.setSelectedDroneId?.(snapshot?.selectedDroneId ?? null);
    if (change.eventId && ['incident-added', 'incident-selection'].includes(change.type)) {
      const event = snapshot.incidents.find((item) => item.id === change.eventId);
      if (event) renderCollisionEvent(event, snapshot.incidents.length);
    }
    populateDroneSelect(snapshot);
    if (
      change.type === 'selection'
      || change.type === 'incident-selection'
      || change.selectionChanged
    ) {
      lastSelectionSource = change.source;
    }
    if (selectionStatus) {
      selectionStatus.textContent = snapshot?.selectedDroneId
        ? `Selected: ${snapshot.selectedDroneId} (${lastSelectionSource})`
        : 'Selected: none';
    }

    // カメラフォーカス同期の確実な実行
    if (
      snapshot?.selectedDroneId
      && viewer
      && (followMode || change.type === 'incident-selection')
    ) {
      viewer.focusDroneById(snapshot.selectedDroneId);
    }

    const drones = Array.isArray(snapshot?.drones) ? snapshot.drones : [];

    // 選択されたドローンのプロパティパネル更新
    const selectedDrone = drones.find((d) => String(d?.id) === String(snapshot?.selectedDroneId));
    if (selectedDrone) {
      updateSelectedDronePanel(selectedDrone);
      if (threeLocalStatus && threeEnvironmentScope === 'local') {
        const [north, minusEast] = selectedDrone.positionRos || [Infinity, Infinity];
        const halfExtentM = Number(scenarioCoverage.localDetail.selectionHalfExtentM || 320);
        const insideLocalDetail = Math.abs(north) <= halfExtentM && Math.abs(minusEast) <= halfExtentM;
        threeLocalStatus.dataset.coverage = insideLocalDetail ? 'inside' : 'outside';
        threeLocalStatus.textContent = insideLocalDetail
          ? `LOCAL 600m / PLATEAU LOD1 / ${selectedDrone.id}`
          : `OUTSIDE LOCAL DETAIL / ${selectedDrone.id} / incidentを選択`;
      }
    }

    for (const drone of drones) {
      if (!drone || !Array.isArray(drone.positionRos) || !Array.isArray(drone.rpyDeg)) continue;
      const [rosX, rosY, rosZ] = drone.positionRos;
      const [rollDeg, pitchDeg, yawDeg] = drone.rpyDeg;
      const [enuX, enuY] = HakoniwaFrame.rosToEnuFrame(rosX, rosY, rosZ);
      const [lat, lon] = HakoniwaFrame.ENUToLatLon(ORIGIN_LAT, ORIGIN_LON, enuX, enuY);
      drone.geo = { latitude: lat, longitude: lon, altitude: geoOrigin.altitude + rosZ + (geoOrigin.z_offset || 0) };
      updateDroneMarker(drone.id, lat, lon, yawDeg);
      updateDroneTrail(drone.id, lat, lon);
      maprayLayer?.update(drone.id, rosX, rosY, rosZ);
    }
    for (const [id, state] of leafletDrones) {
      const selected = String(id) === String(snapshot?.selectedDroneId);
      state.marker?.setOpacity(selected ? 1 : 0.55);
      state.marker?.setZIndexOffset(selected ? 1000 : 0);
    }
    maprayLayer?.setSelectedDroneId(snapshot?.selectedDroneId, {
      focus: change.type === 'selection'
        && followMode,
    });
    if ((change.type === 'selection' || change.selectionChanged) && snapshot?.selectedDroneId) {
      if (followMode) {
        const selectedMarker = leafletDrones.get(String(snapshot.selectedDroneId))?.marker;
        if (selectedMarker) map.panTo(selectedMarker.getLatLng());
      }
      updateComparisonSyncStatus({
        scope: threeEnvironmentScope,
        targetLabel: followMode ? `drone ${snapshot.selectedDroneId}` : comparisonViewState.targetLabel,
        source: change.source || 'selection',
      });
    }

    // インシデントリスト UI の確実な描画・カウントアップ更新
    updateIncidentUiList(snapshot);

    if (change.type === 'incident-selection') {
      const incidents = Array.isArray(snapshot?.incidents) ? snapshot.incidents : [];
      const event = incidents.find((item) => item?.id === snapshot?.selectedIncidentId);
      if (event) {
        setThreeEnvironmentScope('local');
        const impact = Number(event.impactSpeedMps || 0).toFixed(1);
        if (collisionDetail) {
          collisionDetail.textContent =
            `選択: ${event.surfaceLabel} / Drone ${event.droneId} / ${impact} m/s*`;
        }
        for (const row of collisionList?.querySelectorAll('.collision-event') ?? []) {
          row.classList.toggle('selected', row.dataset.eventId === event.id);
        }
        maprayLayer?.setSelectedDroneId(event.droneId);
        maprayLayer?.focusIncident(event.id);
        viewer?.focusDroneById?.(event.droneId);
        incidentLeafletMarkers.get(String(event.id))?.openTooltip();
      }
    }
  });

  if (layoutModeSelect) {
    layoutModeSelect.addEventListener('change', () => applyLayoutMode(layoutModeSelect.value));
  }
  let dragging = false;
  splitter.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    splitter.setPointerCapture?.(event.pointerId);
  });
  window.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = rightContainer.getBoundingClientRect();
    const layout = computeDraggedLayout(rect.height, event.clientY - rect.top);
    customMapRatio = rect.height > 0 ? layout.mapHeight / rect.height : null;
    applyPaneLayout(layout, { notify: false });
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    applyCurrentLayout();
  });
  window.addEventListener('resize', () => applyCurrentLayout({ resizeMapray: false }));
  applyLayoutMode(activeLayoutMode);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeUi, { once: true });
} else {
  initializeUi();
}
