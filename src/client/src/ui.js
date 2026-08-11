import { HakoniwaFrame } from './frame.js?v=w6-20260808-9';
import { loadGeoOrigin } from './geo_origin.js?v=w6-20260808-9';
import { createMaprayLayer, loadMaprayConfig } from './mapray_layer.js?v=oom-20260811-1';
import { CollisionEventTracker } from './collision_events.mjs?v=w6-20260808-9';
import { loadTerrainHeightSampler } from './terrain_height.mjs?v=r1-20260809-1';
import { loadViewerScenarioConfig } from './scenario_config.mjs?v=r2-20260809-1';
import { FlightStateStore } from './flight_state_store.mjs?v=r4-20260809-1';
import { evaluateFlightRules } from './flight_rules.mjs?v=r5-20260810-1';
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

// Fixture Default 10 Drones
const DEFAULT_10_DRONES = [
  { id: "Drone-A", name: "Drone-A", positionRos: [0.0, 0.0, 24.0], rpyDeg: [0.0, 0.0, 0.0] },
  { id: "Drone-B", name: "Drone-B", positionRos: [35.0, 25.0, 32.0], rpyDeg: [0.0, 0.0, 45.0] },
  { id: "Drone-C", name: "Drone-C", positionRos: [-42.0, 18.0, 28.0], rpyDeg: [0.0, 0.0, -35.0] },
  { id: "Drone-D", name: "Drone-D", positionRos: [-30.0, -30.0, 26.0], rpyDeg: [0.0, 0.0, 90.0] },
  { id: "Drone-E", name: "Drone-E", positionRos: [45.0, -20.0, 30.0], rpyDeg: [0.0, 0.0, -90.0] },
  { id: "Drone-F", name: "Drone-F", positionRos: [60.0, 40.0, 35.0], rpyDeg: [0.0, 0.0, 180.0] },
  { id: "Drone-G", name: "Drone-G", positionRos: [-55.0, 50.0, 29.0], rpyDeg: [0.0, 0.0, 120.0] },
  { id: "Drone-H", name: "Drone-H", positionRos: [20.0, -60.0, 31.0], rpyDeg: [0.0, 0.0, -60.0] },
  { id: "Drone-I", name: "Drone-I", positionRos: [-70.0, -40.0, 27.0], rpyDeg: [0.0, 0.0, 200.0] },
  { id: "Drone-J", name: "Drone-J", positionRos: [80.0, -10.0, 34.0], rpyDeg: [0.0, 0.0, -120.0] }
];

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
    return defaultName;
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
  const mode = new URLSearchParams(window.location.search).get('maprayMode');
  return ['base', 'dem', 'full'].includes(mode) ? mode : 'full';
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
  const res = await fetch(configUrl);
  if (!res.ok) {
    throw new Error(`[HakoniwaGeoViewer] failed to load threejs viewer config: ${configUrl}`);
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
  viewerModuleUrl.searchParams.set('v', 'r4-20260809-1');
  const viewerModule = await import(viewerModuleUrl.href);
  return {
    createDroneViewer: viewerModule.createDroneViewer,
    terrainGridEnvironmentVersion:
      Number(viewerModule.TERRAIN_GRID_ENVIRONMENT_VERSION ?? 0),
    mjcfBuildingGeometryVersion:
      Number(viewerModule.MJCF_BUILDING_GEOMETRY_VERSION ?? 0),
    selectionSyncApiVersion:
      Number(viewerModule.SELECTION_SYNC_API_VERSION ?? 0),
  };
}

// マップ初期化
const map = L.map('map').setView([35.6812, 139.7671], 15);
let geoOrigin = { latitude: 35.6625, longitude: 139.70625, altitude: 0.0, z_offset: 0.0 };
let maprayLayer = null;
let terrainHeightSampler = null;
let operationsData = null;
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
  for (const feature of geojsonData.features) {
    if (feature.properties?.type === 'planned_route' && feature.geometry?.type === 'LineString') {
      const latlngs = feature.geometry.coordinates.map((c) => [c[1], c[0]]);
      L.polyline(latlngs, { color: '#00bfff', weight: 4, dashArray: '8, 8', opacity: 0.8 }).addTo(map);
    } else if (feature.properties?.type === 'geofence' && feature.geometry?.type === 'Polygon') {
      const latlngs = feature.geometry.coordinates[0].map((c) => [c[1], c[0]]);
      L.polygon(latlngs, { color: '#ff8c00', weight: 2, fillOpacity: 0.1 }).addTo(map);
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
  let started = false;
  let pollingTimer = null;
  let maprayInitialization = null;
  let geoContextInitialization = null;
  let activeLayoutMode = 'operations';
  let customMapRatio = null;
  let lastSelectionSource = 'none';
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
  const droneSelect = document.getElementById("drone-select");
  const followCheckbox = document.getElementById('follow-checkbox');
  const demoCheckbox = document.getElementById('demo-flight-checkbox');
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
  const splitter = document.getElementById('splitter');

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
      const sourceLabel = event.source === 'impulse_collision' ? 'ImpulseCollision' : 'FlightRules';
      row.textContent = `${event.surfaceLabel || 'Incident'} | ${impact} m/s* | ${sourceLabel}`;
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
          : (Array.isArray(window.__hakoniwaDefaultDrones) ? window.__hakoniwaDefaultDrones : DEFAULT_10_DRONES);
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
  const isR7 = pageParams.get('r7Fixture') === '1';
  const isR4 = pageParams.get('r4Fixture') === '1';

  let demoTimer = null;
  let demoAngle = 0;
  let demoStepCount = 0;

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

    // デモ飛行開始時にストアが空であれば10機を初期化
    let currentDrones = flightStateStore.getSnapshot().drones;
    if (currentDrones.length === 0) {
      flightStateStore.updateDrones(DEFAULT_10_DRONES, { replace: true, source: 'demo-init' });
      currentDrones = flightStateStore.getSnapshot().drones;
    }

    if (!demoTimer) {
      demoTimer = setInterval(() => {
        demoAngle += 0.015;
        demoStepCount += 1;
        const snapshot = flightStateStore.getSnapshot();
        const baseDrones = Array.isArray(snapshot?.drones) && snapshot.drones.length > 0
          ? snapshot.drones
          : DEFAULT_10_DRONES;

        const updatedDrones = baseDrones.map((drone, idx) => {
          let rosX = 0;
          let rosY = 0;
          let rosZ = 25.0;

          if (idx < 5) {
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

        // Three.js インスタンスへの正規適用 (applyState を使用)
        if (viewer && typeof viewer.getDrones === 'function') {
          const vDrones = viewer.getDrones();
          vDrones.forEach((vDrone, idx) => {
            if (idx < updatedDrones.length) {
              const u = updatedDrones[idx];
              vDrone.applyState?.({
                rosPos: u.positionRos,
                rosRpyDeg: u.rpyDeg,
                rotorSpeedsRadPerSec: [60, 60, 60, 60],
              });
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
        if (demoStepCount === 5 || demoStepCount % 25 === 0) {
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
      terrainHeightSampler = await loadTerrainHeightSampler(scenario.urls.terrainGrid);

      try {
        const opsRes = await fetch(scenario.urls.operationsLayer || DEFAULT_OPERATIONS_GEOJSON);
        if (opsRes.ok) {
          operationsData = await opsRes.json();
          renderLeafletOperationsData(operationsData);
          if (maprayLayer) maprayLayer.loadOperationsData(operationsData);
        }
      } catch (err) {
        console.warn("[HakoniwaGeoViewer] Operations GeoJSON load warning:", err);
      }

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
        resolveMaprayApiKey(),
        viewerScenarioPromise.then((value) => loadMaprayConfig(value.urls.mapray)),
      ]);
      maprayConfig.terrainGridUrl = scenario.urls.terrainGrid;
      maprayConfig.loadMode = getMaprayLoadMode();

      const container = document.getElementById('mapray-container');
      if (status) status.textContent = apiKey
        ? 'Mapray Datasetへ接続中...'
        : 'Mapray API Key未設定: Leaflet表示';
      maprayLayer = await createMaprayLayer(container, geoOrigin, apiKey, maprayConfig, status);
      if (operationsData) maprayLayer.loadOperationsData(operationsData);
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
    if (viewer) {
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
        let sceneConfigPath = viewerConfig.sceneConfigPath;

        if (
          modules.terrainGridEnvironmentVersion >= 1
          && modules.mjcfBuildingGeometryVersion >= 1
        ) {
          if (isR7) {
            sceneConfigPath = new URL(
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

          viewerConfig.config.three.sceneConfigPath = sceneConfigPath;
          if (environmentStatus) {
            environmentStatus.textContent = isR7
              ? '3D環境: R7 fleet fixture (10機) を読み込み中...'
              : (isR4 ? '3D環境: R4 selection fixtureを読み込み中...' : '3D環境: Shibuya terrain + MJCF建物を読み込み中...');
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
        if (typeof viewer.getEnvironmentDiagnostics === 'function') {
          const diagnostics = viewer.getEnvironmentDiagnostics();
          const terrain = diagnostics.find((item) => item.type === 'terrain-grid');
          const buildings = diagnostics.find((item) => item.type === 'mjcf');
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
        flightStateStore.updateDrones(viewerDroneStates({ includeConfiguredPosition: true }), {
          source: 'viewer-initialize',
        });
        viewer.setFollowSelectedEnabled(followMode);
        const selectedId = flightStateStore.getSnapshot().selectedDroneId;
        if (selectedId) viewer.focusDroneById(selectedId);
        applyCurrentLayout();
      }
      if (isR4 || isR7) {
        connectBtn.textContent = 'fixture ready';
        if (connectionStatus) {
          connectionStatus.textContent = isR7
            ? 'PDU: R7 fleet fixture (10機・通信なし・選択同期の目視確認用)'
            : 'PDU: R4 fixture（通信なし・選択同期の目視確認用）';
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
      if (connectionStatus) connectionStatus.textContent = `PDU: connected (${wsUri})`;
      startPduPolling();
    } catch (e) {
      console.error(e);
      connectBtn.textContent = "error";
      connectBtn.disabled = false;
      if (connectionStatus) connectionStatus.textContent = `PDU error: ${e.message || e}`;
    }
  });
  window.__hakoniwaUiReady = true;
  if (connectionStatus) connectionStatus.textContent = 'PDU: ready to connect';
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
      const states = viewerDroneStates();
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
    if (snapshot?.selectedDroneId && viewer) {
      viewer.focusDroneById(snapshot.selectedDroneId);
    }

    const drones = Array.isArray(snapshot?.drones) ? snapshot.drones : [];

    // 選択されたドローンのプロパティパネル更新
    const selectedDrone = drones.find((d) => String(d?.id) === String(snapshot?.selectedDroneId));
    if (selectedDrone) {
      updateSelectedDronePanel(selectedDrone);
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
      focus: change.type === 'selection',
    });
    if ((change.type === 'selection' || change.selectionChanged) && snapshot?.selectedDroneId) {
      if (followMode) {
        const selectedMarker = leafletDrones.get(String(snapshot.selectedDroneId))?.marker;
        if (selectedMarker) map.panTo(selectedMarker.getLatLng());
      }
    }

    // インシデントリスト UI の確実な描画・カウントアップ更新
    updateIncidentUiList(snapshot);

    if (change.type === 'incident-selection') {
      const incidents = Array.isArray(snapshot?.incidents) ? snapshot.incidents : [];
      const event = incidents.find((item) => item?.id === snapshot?.selectedIncidentId);
      if (event) {
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
