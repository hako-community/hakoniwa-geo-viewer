import {
  MAPRAY_MODEL_PHASE0_VERSION,
  inspectMapray096Api,
  normalizeDatasetId,
  validatePhase0Config,
} from './mapray_model_phase0.mjs';
import { MaprayDroneFleetLayer } from './mapray_drone_fleet_layer.mjs';
import { FlightStateStore } from './flight_state_store.mjs';
import { generateFleetSyntheticData } from './fleet_manager.mjs';

const configReference = document.querySelector('meta[name="mapray-model-config"]')?.content
  || '../../../config/mapray-drone-model.json';
const CONFIG_URL = new URL(configReference, import.meta.url).toString();
const panel = document.getElementById('mapray-model-panel');
const resetViewButton = document.getElementById('reset-model-view');
const toggleRotorButton = document.getElementById('toggle-rotor-animation');
const toggleFollowButton = document.getElementById('toggle-model-follow');
const fixturePoseSelect = document.getElementById('fixture-model-pose');
const fixtureFleetSizeSelect = document.getElementById('fixture-fleet-size');
const diagnosticsElement = document.getElementById('mapray-drone-diagnostics');
let animationFrameId = null;
let droneModelLayer = null;
let followEnabled = false;
const navigationStartedAt = performance.now();

function setStatus(state, message) {
  panel.dataset.state = state;
  panel.textContent = message;
}

function publishDiagnostics(values) {
  const diagnostics = {
    implementationVersion: MAPRAY_MODEL_PHASE0_VERSION,
    configUrl: CONFIG_URL,
    ...window.__maprayDroneModelDiagnostics,
    ...values,
  };
  window.__maprayDroneModelDiagnostics = diagnostics;
  window.__maprayModelPhase0Diagnostics = diagnostics;
  if (diagnosticsElement) diagnosticsElement.textContent = JSON.stringify(diagnostics);
}

async function loadJson(url, label) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const apiInspection = inspectMapray096Api(window.mapray, window.maprayui);
  publishDiagnostics({ state: 'api-inspection', apiInspection, entityCount: 0 });
  if (!apiInspection.ok) {
    setStatus('error', `Mapray 0.9.6 API不足\n${apiInspection.missing.join('\n')}`);
    return;
  }

  const [runtimeConfig, rawConfig] = await Promise.all([
    loadJson('/__runtime/mapray-config', 'Mapray API Key'),
    loadJson(CONFIG_URL, 'Mapray drone model config'),
  ]);
  const config = validatePhase0Config(rawConfig);
  const params = new URLSearchParams(window.location.search);
  const requestedRenderMode = params.get('droneRender') || 'model';
  const renderMode = ['model', 'pin', 'both'].includes(requestedRenderMode)
    ? requestedRenderMode
    : 'model';
  const modelRequired = renderMode !== 'pin';
  const requestedFleetSize = Number(params.get('fleetSize') || 1);
  const fleetSize = [1, 5, 10].includes(requestedFleetSize) ? requestedFleetSize : 1;
  const lifecycleTest = params.get('lifecycleTest') === '1';
  if (fixtureFleetSizeSelect) fixtureFleetSizeSelect.value = String(fleetSize);
  fixtureFleetSizeSelect?.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('fleetSize', fixtureFleetSizeSelect.value);
    window.location.assign(url.toString());
  });
  let rotorPaused = params.get('pauseRotors') === '1';
  const airframeDatasetId = normalizeDatasetId(
    params.get('airframeDatasetId') || config.airframeDatasetId,
  );
  const propellerDatasetId = normalizeDatasetId(
    params.get('propellerDatasetId') || config.propellerDatasetId,
  );
  const fleetCamera = fleetSize === 1 ? config.camera : {
    ...config.camera,
    longitude: config.position.longitude - 0.00032,
    latitude: config.position.latitude - 0.00026,
    height: config.position.altitude + 55,
    lookAtHeight: config.position.altitude + 12,
  };

  const uiviewer = new window.maprayui.StandardUIViewer('mapray-container', runtimeConfig.apiKey);
  await uiviewer.viewer.init_promise;
  const resetView = () => {
    followEnabled = false;
    droneModelLayer?.setFollowEnabled(false);
    if (toggleFollowButton) toggleFollowButton.textContent = '機体を追従';
    uiviewer.setCameraPosition(fleetCamera);
    uiviewer.setLookAtPosition({
      longitude: config.position.longitude,
      latitude: config.position.latitude,
      height: fleetCamera.lookAtHeight,
    }, 0);
  };
  uiviewer.setCameraZoomLimit?.(config.camera.minZoomDistanceMeters);
  resetViewButton?.addEventListener('click', resetView);
  resetView();

  if (modelRequired && (!airframeDatasetId || !propellerDatasetId)) {
    publishDiagnostics({
      state: 'awaiting-dataset-ids', apiInspection, entityCount: 0,
      datasetIdsConfigured: false,
    });
    setStatus('blocked', 'Mapray 0.9.6 API: OK\n3D Dataset IDが未設定です。');
    return;
  }

  setStatus('loading', renderMode === 'pin'
    ? 'Mapray 0.9.6 API: OK\n比較用Pinを準備中...'
    : 'Mapray 0.9.6 API: OK\n機体本体とプロペラをロード中...');
  const cloudApi = modelRequired
    ? new window.mapray.cloud.CloudApiV2({
      tokenType: window.mapray.cloud.CloudApi.TokenType.API_KEY,
      token: runtimeConfig.apiKey,
    })
    : null;
  const flightStateStore = new FlightStateStore();
  const baseFleet = generateFleetSyntheticData(fleetSize, config.position, { seed: 20260913 })
    .map((drone, index) => ({
      ...drone,
      positionRos: fleetSize === 1
        ? [0, 0, 0]
        : [
          drone.positionRos[0] * 0.18,
          drone.positionRos[1] * 0.18,
          8 + (index % 5) * 2,
        ],
    }));
  const fixturePoses = {
    level: [0, 0, 0],
    yaw90: [0, 0, 90],
    yaw180: [0, 0, 180],
    roll10: [10, 0, 0],
    pitch10: [0, 10, 0],
  };
  let fixturePoseMode = 'flight';
  const buildFixtureFleet = (elapsedSeconds = 0) => baseFleet.map((drone, index) => {
    const orbit = elapsedSeconds * (0.10 + index * 0.002) + index * 0.7;
    const positionRos = [
      drone.positionRos[0] + Math.cos(orbit) * 4,
      drone.positionRos[1] + Math.sin(orbit) * 4,
      drone.positionRos[2] + Math.sin(orbit * 0.5) * 1.5,
    ];
    const rpyDeg = fixturePoseMode === 'flight'
      ? [Math.sin(orbit) * 4, Math.cos(orbit) * 3, (drone.rpyDeg[2] + elapsedSeconds * 8) % 360]
      : [...(fixturePoses[fixturePoseMode] || fixturePoses.level)];
    const baseSpeed = 48 + index * 2;
    return {
      ...drone,
      positionRos,
      rpyDeg,
      rotorSpeedsRadPerSec: [baseSpeed, baseSpeed + 3, baseSpeed + 6, baseSpeed + 9],
      scenarioElapsedSeconds: elapsedSeconds,
    };
  });
  flightStateStore.updateDrones(buildFixtureFleet(), { source: 'fleet-fixture' });
  fixturePoseSelect?.addEventListener('change', () => {
    fixturePoseMode = fixturePoseSelect.value;
    flightStateStore.updateDrones(buildFixtureFleet(), { source: 'fixture-pose-control' });
  });
  window.__maprayDroneFlightStateStore = flightStateStore;
  droneModelLayer = new MaprayDroneFleetLayer({
    mapray: window.mapray,
    uiviewer,
    cloudApi,
    config,
    airframeDatasetId,
    propellerDatasetId,
    renderMode,
    onSelection: (target) => {
      flightStateStore.selectDrone(target.id, { source: 'mapray' });
      publishDiagnostics({ selectedTarget: target });
    },
  });
  const layerLoadStartedAt = performance.now();
  droneModelLayer.bindFlightStateStore(flightStateStore);
  await droneModelLayer.whenIdle();
  window.__maprayDroneFleetLayer = droneModelLayer;
  if (lifecycleTest && fleetSize > 1) {
    const retainedCount = Math.ceil(fleetSize / 2);
    window.setTimeout(() => {
      flightStateStore.updateDrones(buildFixtureFleet().slice(0, retainedCount), {
        source: 'fleet-lifecycle-remove',
      });
    }, 250);
    window.setTimeout(() => {
      flightStateStore.updateDrones(buildFixtureFleet(), {
        source: 'fleet-lifecycle-restore',
      });
    }, 750);
  }
  const loadWindowResources = (performance.getEntriesByType?.('resource') || [])
    .filter((entry) => entry.startTime >= layerLoadStartedAt);
  const loadWindowPerformance = {
    resourceCount: loadWindowResources.length,
    transferBytes: loadWindowResources.reduce(
      (total, entry) => total + (Number(entry.transferSize) || 0),
      0,
    ),
  };
  droneModelLayer.setPaused(rotorPaused, { resetPhases: rotorPaused });

  const updateFollowButton = () => {
    if (toggleFollowButton) toggleFollowButton.textContent = followEnabled
      ? '追従を解除'
      : '機体を追従';
  };
  toggleFollowButton?.addEventListener('click', () => {
    followEnabled = !followEnabled;
    droneModelLayer.setFollowEnabled(followEnabled);
    updateFollowButton();
  });
  updateFollowButton();

  const maprayContainer = document.getElementById('mapray-container');
  maprayContainer?.addEventListener('click', (event) => {
    if (typeof uiviewer.pick !== 'function') return;
    const rect = maprayContainer.getBoundingClientRect();
    droneModelLayer.handlePick(uiviewer.pick([
      event.clientX - rect.left,
      event.clientY - rect.top,
    ]));
  });

  let previousTimestamp = performance.now();
  let frameCount = 0;
  let frameWindowStartedAt = previousTimestamp;
  let measuredFps = null;
  let lastFixtureUpdateMs = previousTimestamp;
  const updateRotorButton = () => {
    if (toggleRotorButton) {
      toggleRotorButton.textContent = rotorPaused
        ? '回転を再開'
        : '回転を停止（基準角）';
    }
  };
  toggleRotorButton?.addEventListener('click', () => {
    rotorPaused = !rotorPaused;
    droneModelLayer.setPaused(rotorPaused, { resetPhases: true });
    previousTimestamp = performance.now();
    updateRotorButton();
  });
  updateRotorButton();
  const firstReadyMs = performance.now() - navigationStartedAt;
  const animate = (timestamp) => {
    const deltaSeconds = (timestamp - previousTimestamp) / 1000;
    previousTimestamp = timestamp;
    frameCount += 1;
    const frameWindowMs = timestamp - frameWindowStartedAt;
    if (frameWindowMs >= 1000) {
      measuredFps = (frameCount * 1000) / frameWindowMs;
      frameCount = 0;
      frameWindowStartedAt = timestamp;
    }
    if (!lifecycleTest && timestamp - lastFixtureUpdateMs >= 100) {
      flightStateStore.updateDrones(buildFixtureFleet(timestamp / 1000), {
        source: 'fleet-fixture-animation',
      });
      lastFixtureUpdateMs = timestamp;
    }
    droneModelLayer.update(deltaSeconds);
    const layerDiagnostics = droneModelLayer.getDiagnostics();
    const resourceEntries = performance.getEntriesByType?.('resource') || [];
    publishDiagnostics({
      ...layerDiagnostics,
      state: 'ready',
      fleetSize,
      datasetIdsConfigured: !modelRequired || Boolean(airframeDatasetId && propellerDatasetId),
      browserPerformance: {
        firstReadyMs,
        fps: measuredFps,
        resourceCount: resourceEntries.length,
        loadWindowResourceCount: loadWindowPerformance.resourceCount,
        loadWindowTransferBytes: loadWindowPerformance.transferBytes,
        usedJsHeapBytes: Number(performance.memory?.usedJSHeapSize) || null,
      },
      camera: {
        minZoomDistanceMeters: config.camera.minZoomDistanceMeters,
        nearPlaneMinimumMeters: 1,
      },
      rotorOffsetsRosM: config.rotors.map((rotor) => [...rotor.offsetRosM]),
    });
    animationFrameId = requestAnimationFrame(animate);
  };
  animationFrameId = requestAnimationFrame(animate);
  setStatus(
    'ready',
    `Mapray 0.9.6 Drone Fleet: READY\n描画モード: ${renderMode}\n機体数: ${fleetSize}\n`
    + `Entity: ${droneModelLayer.getDiagnostics().entityCount}\n`
    + `プロペラ: ${modelRequired ? 'CW/CCW回転中' : '非表示'}\n`
    + `安全ズーム距離: ${config.camera.minZoomDistanceMeters} m以上`,
  );
}

window.addEventListener('beforeunload', () => {
  if (animationFrameId != null) cancelAnimationFrame(animationFrameId);
  droneModelLayer?.dispose();
});

main().catch((error) => {
  console.error('[MaprayDroneModelDemo]', error);
  publishDiagnostics({
    ...(droneModelLayer?.getDiagnostics() || { state: 'error', entityCount: 0 }),
    error: String(error?.message || error),
  });
  setStatus('error', `Mapray drone model error\n${String(error?.message || error)}`);
});
