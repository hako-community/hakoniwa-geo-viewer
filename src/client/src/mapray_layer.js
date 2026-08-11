import { HakoniwaFrame } from './frame.js?v=w6-20260808-9';

export function loadMaprayConfig(url = '/config/mapray-config-shibuya.json') {
  return fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(`Mapray config load failed (${url}): HTTP ${res.status}`);
    }
    return res.json();
  });
}

function resolveConfigUrl(baseConfigUrl, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return relativePath;
  }
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  return new URL(relativePath, new URL(baseConfigUrl, window.location.href)).toString();
}

function safeSetEntityPosition(entity, position) {
  if (!entity) return;
  if (typeof entity.setPosition === 'function') {
    entity.setPosition(position);
  } else if (typeof entity.setPos === 'function') {
    entity.setPos(position);
  } else {
    entity.position = position;
  }
}

function computePathLengths(points) {
  const numPoints = Math.floor(points.length / 3);
  const lengths = new Float64Array(numPoints);
  if (numPoints === 0) return lengths;
  lengths[0] = 0;
  for (let i = 1; i < numPoints; i += 1) {
    const lon1 = points[3 * (i - 1)];
    const lat1 = points[3 * (i - 1) + 1];
    const alt1 = points[3 * (i - 1) + 2];
    const lon2 = points[3 * i];
    const lat2 = points[3 * i + 1];
    const alt2 = points[3 * i + 2];
    const dx = (lon2 - lon1) * 111319.5 * Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
    const dy = (lat2 - lat1) * 111319.5;
    const dz = alt2 - alt1;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    lengths[i] = lengths[i - 1] + (dist > 0.001 ? dist : 0.001);
  }
  return lengths;
}

function safeSetPathEntityPoints(entity, points) {
  if (!entity || !Array.isArray(points) || points.length === 0) return;

  if (typeof entity.removeAllPoints === 'function') {
    entity.removeAllPoints();
  }

  if (typeof entity.addPoints === 'function') {
    if (entity.addPoints.length === 1) {
      entity.addPoints(points);
    } else {
      const lengths = computePathLengths(points);
      try {
        entity.addPoints(points, lengths);
      } catch (e) {
        entity.addPoints(points);
      }
    }
  } else if (typeof entity.setPoints === 'function') {
    entity.setPoints(points);
  } else if (typeof entity.setCoordinates === 'function') {
    entity.setCoordinates(points);
  } else {
    entity.points = points;
  }
}

export async function createMaprayLayer(
  containerElem,
  geoOrigin,
  apiKey,
  maprayConfig,
  statusElem = null,
) {
  const layer = new MaprayLayer(containerElem, geoOrigin, apiKey, maprayConfig, statusElem);
  await layer.initialize();
  return layer;
}

export class MaprayLayer {
  constructor(containerElem, geoOrigin, apiKey, maprayConfig, statusElem = null) {
    this.container = containerElem;
    this.geoOrigin = geoOrigin;
    this.apiKey = apiKey;
    this.config = maprayConfig || {};
    this.statusElem = statusElem;
    this.viewer = null;
    this.ready = false;
    this.droneEntities = new Map();
    this.droneEntries = new Map();
    this.trajectoryEntities = new Map();
    this.droneHistories = new Map();
    this.collisionEntities = new Map();
    this.incidentMetadata = new Map();
    this.opsPolylineEntities = [];
    this.opsPolygonEntities = [];
    this.selectedDroneId = null;
    this.selectedIncidentId = null;
    this.selectionHandler = null;
    this.maxCollisionMarkers = 30;
    this.buildingDatasetsLoaded = false;
    this.buildingScenes = [];
    this.trajectoryUpdatedLengths = new Map();
    this.trajectorySelectedState = new Map();
    this.trajectoryLastSampleTimes = new Map();
    this.trajectorySampleIntervalMs = Math.max(
      250,
      Number(this.config.trajectorySampleIntervalMs) || 1_000,
    );
    this.maxTrajectoryPoints = Math.max(
      2,
      Number(this.config.maxTrajectoryPoints) || 120,
    );
  }

  get origin() {
    return this.geoOrigin;
  }

  set origin(val) {
    this.geoOrigin = val;
  }

  setSelectionHandler(fn) {
    this.selectionHandler = typeof fn === 'function' ? fn : null;
  }

  setSelectedDroneId(droneId, { focus = false } = {}) {
    const nextId = droneId != null ? String(droneId) : null;
    if (this.selectedDroneId === nextId && !focus) return;
    this.selectedDroneId = nextId;
    for (const [id, entity] of this.droneEntities) {
      const selected = String(id) === this.selectedDroneId;
      entity.setSize?.(selected ? [42, 42] : [32, 32]);
    }
    for (const [id, trajEntity] of this.trajectoryEntities) {
      const selected = String(id) === this.selectedDroneId;
      trajEntity.setColor?.(selected ? [1.0, 0.9, 0.2] : [1.0, 0.4, 0.1]);
      trajEntity.setLineWidth?.(selected ? 5 : 3);
    }
    if (focus && this.selectedDroneId && this.ready) {
      const history = this.droneHistories.get(this.selectedDroneId)
        || this.droneHistories.get(Number(this.selectedDroneId));
      const lastGeo = history && history.length > 0 ? history[history.length - 1] : null;
      if (lastGeo && Number.isFinite(lastGeo.latitude) && Number.isFinite(lastGeo.longitude)) {
        const alt = Number.isFinite(lastGeo.altitude) ? lastGeo.altitude : 0;
        this.createNonDegenerateCameraPose(
          lastGeo.latitude,
          lastGeo.longitude,
          alt + 35,
          -45,
          alt,
        );
      }
    }
  }

  createNonDegenerateCameraPose(lat, lon, alt, pitch = -45, targetAlt = null) {
    if (!this.viewer) return;

    const safeLat = Number(lat);
    const safeLon = Number(lon);
    const safeAlt = Number(alt);
    const fallbackTargetAlt = Number(this.geoOrigin.altitude || 0)
      + Number(this.geoOrigin.z_offset || 0);
    const safeTargetAlt = Number.isFinite(Number(targetAlt))
      ? Number(targetAlt)
      : fallbackTargetAlt;
    if (
      !Number.isFinite(safeLat)
      || !Number.isFinite(safeLon)
      || !Number.isFinite(safeAlt)
      || !Number.isFinite(safeTargetAlt)
      || Math.abs(safeLat) > 90
      || Math.abs(safeLon) > 180
    ) {
      console.warn('[MaprayLayer] Refusing invalid camera pose:', {
        latitude: lat,
        longitude: lon,
        cameraHeight: alt,
        targetHeight: targetAlt,
      });
      return;
    }

    const cameraConfig = this.config.camera || {};
    const minimumDistanceM = Math.max(
      10,
      Number(cameraConfig.minimumHorizontalDistanceM) || 120,
    );
    const maximumDistanceM = Math.max(
      minimumDistanceM,
      Number(cameraConfig.horizontalDistanceM) || 450,
    );
    const safePitch = Math.min(85, Math.max(5, Math.abs(Number(pitch) || 45)));
    const heightDifferenceM = Math.max(1, safeAlt - safeTargetAlt);
    const pitchDistanceM = heightDifferenceM / Math.tan(safePitch * Math.PI / 180);
    const horizontalDistanceM = Math.min(
      maximumDistanceM,
      Math.max(minimumDistanceM, pitchDistanceM),
    );
    const cameraPosition = {
      longitude: safeLon,
      latitude: safeLat - horizontalDistanceM / 111_320,
      height: safeAlt,
    };
    const lookAtPosition = {
      longitude: safeLon,
      latitude: safeLat,
      height: safeTargetAlt,
    };

    try {
      if (typeof this.viewer.setCameraPosition === 'function') {
        this.viewer.setCameraPosition(cameraPosition);
      }
      if (typeof this.viewer.setLookAtPosition === 'function') {
        this.viewer.setLookAtPosition(lookAtPosition, 0);
      }
      this.lastCameraPose = { cameraPosition, lookAtPosition, horizontalDistanceM };
    } catch (err) {
      console.warn('[MaprayLayer] createNonDegenerateCameraPose warning:', err);
    }
  }

  getSelectionDiagnostics() {
    const selectedGeo = this.selectedDroneId
      ? this.droneHistories.get(this.selectedDroneId)?.slice(-1)[0] ?? null
      : null;
    return {
      ready: this.ready,
      selectedDroneId: this.selectedDroneId,
      selectedIncidentId: this.selectedIncidentId,
      droneCount: this.droneEntities.size,
      incidentCount: this.collisionEntities.size,
      buildingDatasetsLoaded: this.buildingDatasetsLoaded,
      selectedGeo,
    };
  }

  async initialize() {
    if (!window.mapray || !window.maprayui) {
      throw new Error('Mapray JS library is not loaded');
    }
    if (!this.apiKey) {
      if (this.statusElem) {
        this.statusElem.textContent = 'Mapray API Key未設定: Leafletフォールバック';
      }
      return;
    }

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocalhost && !this.config.allowExternalHost) {
      if (this.statusElem) {
        this.statusElem.textContent = 'Mapray: 外部ホストアクセスのためLeaflet表示';
      }
      return;
    }

    const initMode = this.config.loadMode || 'full';
    const initOptions = {};
    const demProvider = createDemFallbackProvider(this.apiKey);
    if (demProvider) initOptions.dem_provider = demProvider;

    try {
      this.viewer = new window.maprayui.StandardUIViewer(this.container, this.apiKey, initOptions);
    } catch (err) {
      console.warn('[MaprayLayer] StandardUIViewer initialization warning:', err);
      if (this.statusElem) {
        this.statusElem.textContent = 'Mapray 画面生成失敗: Leafletフォールバック';
      }
      return;
    }

    this.createNonDegenerateCameraPose(
      this.geoOrigin.latitude,
      this.geoOrigin.longitude,
      this.geoOrigin.altitude + 350.0,
      -55,
      this.geoOrigin.altitude + (this.geoOrigin.z_offset || 0),
    );

    const rawDatasetIds = this.config.buildingDatasetIds
      || (this.config.buildingDatasets || []).map((item) => typeof item === 'string' ? item : item?.datasetId);
    const buildingDatasetIds = (Array.isArray(rawDatasetIds) ? rawDatasetIds : [])
      .map((item) => String(item || '').trim())
      .filter((id) => id.length > 0);

    const StandardB3dProvider = window.mapray.StandardB3dProvider;
    const b3dCollection = this.viewer.viewer?.b3d_collection
      || this.viewer.b3d_collection;
    const loadBuildings = initMode === 'full' && this.apiKey && this.apiKey.length > 20;
    if (loadBuildings && buildingDatasetIds.length > 0) {
      if (!StandardB3dProvider || typeof b3dCollection?.createScene !== 'function') {
        console.warn('[MaprayLayer] Mapray v0.9.6 B3D API is unavailable');
      } else {
        const datasetApiBase = String(
          this.config.buildingDatasetApiBase
            || 'https://api.mapray.com/b3ddatasets/v2/',
        );
        for (let index = 0; index < buildingDatasetIds.length; index += 1) {
          const datasetId = buildingDatasetIds[index];
          if (this.statusElem) {
            this.statusElem.textContent =
              `Building Dataset ${index + 1}/${buildingDatasetIds.length} (${datasetId}) 読み込み中...`;
          }
          try {
            const datasetResponse = await fetch(
              `${datasetApiBase}${encodeURIComponent(datasetId)}`,
              { headers: { 'X-Api-Key': this.apiKey } },
            );
            if (!datasetResponse.ok) {
              throw new Error(`HTTP ${datasetResponse.status}`);
            }
            const dataset = await datasetResponse.json();
            if (typeof dataset?.url !== 'string' || dataset.url.length === 0) {
              throw new Error('dataset response does not contain a B3D URL');
            }
            const provider = new StandardB3dProvider(dataset.url, '.bin', {
              meta_headers: { 'X-API-Key': this.apiKey },
              tile_headers: { 'X-API-Key': this.apiKey },
            });
            const b3dScene = b3dCollection.createScene(provider);
            this.buildingScenes.push(b3dScene);
          } catch (err) {
            console.warn(`[MaprayLayer] B3D dataset load warning (${datasetId}):`, err);
          }
        }
      }
      this.buildingDatasetsLoaded = this.buildingScenes.length > 0;
    }

    // マウスクリックでの選択ハンドラ
    if (this.container) {
      this.container.addEventListener('click', (event) => {
        if (!this.ready || !this.viewer) return;
        const rect = this.container.getBoundingClientRect();
        const point = [event.clientX - rect.left, event.clientY - rect.top];
        if (typeof this.viewer.pick === 'function') {
          const target = this.viewer.pick(point);
          if (target && this.selectionHandler) {
            this.selectionHandler(target);
          }
        }
      });
    }

    this.ready = true;
    this.createNonDegenerateCameraPose(
      this.geoOrigin.latitude,
      this.geoOrigin.longitude,
      this.geoOrigin.altitude + 350.0,
      -55,
      this.geoOrigin.altitude + (this.geoOrigin.z_offset || 0),
    );
    if (this.statusElem) {
      const buildingCount = this.buildingScenes.length;
      this.statusElem.textContent =
        `Mapray: 接続完了 (DEM + 3D Building x${buildingCount})`;
    }
  }

  resize() {
    if (!this.ready || !this.viewer || !this.container) return null;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (this._lastWidth === width && this._lastHeight === height) {
      return { width, height };
    }
    this._lastWidth = width;
    this._lastHeight = height;
    try {
      if (typeof this.viewer.viewer?.onWindowResize === 'function') {
        this.viewer.viewer.onWindowResize();
      } else if (typeof this.viewer.viewer?.onResize === 'function') {
        this.viewer.viewer.onResize();
      } else if (typeof this.viewer.onWindowResize === 'function') {
        this.viewer.onWindowResize();
      } else if (typeof this.viewer.onResize === 'function') {
        this.viewer.onResize();
      }
    } catch (e) {
      console.warn('[MaprayLayer] resize error:', e);
    }
    return { width, height };
  }

  loadOperationsData(geojsonData) {
    if (!this.ready || !geojsonData || !Array.isArray(geojsonData.features)) return;
    const scene = this.viewer.viewer?.scene || this.viewer.scene;
    const OperationsLayerModel = window.mapray.OperationsLayerModel || null;
    const LineEntityClass = window.mapray.MarkerLineEntity || window.mapray.PathEntity;

    for (const feature of geojsonData.features) {
      if (feature.properties?.type === 'planned_route' && feature.geometry?.type === 'LineString') {
        const pathEntity = new LineEntityClass(scene);
        pathEntity.altitude_mode = window.mapray.AltitudeMode.ABSOLUTE;
        pathEntity.setColor?.([0.0, 0.75, 1.0]);
        pathEntity.setLineWidth?.(4);

        const points = [];
        for (const c of feature.geometry.coordinates) {
          const alt = (c[2] ?? 30.0) + this.geoOrigin.altitude + (this.geoOrigin.z_offset || 0);
          points.push(c[0], c[1], alt);
        }
        safeSetPathEntityPoints(pathEntity, points);
        scene.addEntity(pathEntity);
        this.opsPolylineEntities.push(pathEntity);
      }
    }
  }

  update(id, rosX, rosY, rosZ) {
    if (!this.ready) return null;

    const strId = String(id);
    const now = Date.now();
    const [east, north] = HakoniwaFrame.rosToEnuFrame(rosX, rosY, rosZ);
    const [latitude, longitude] = HakoniwaFrame.ENUToLatLon(
      this.geoOrigin.latitude,
      this.geoOrigin.longitude,
      east,
      north,
    );
    const altitude = this.geoOrigin.altitude + rosZ + (this.geoOrigin.z_offset || 0);
    const geo = { latitude, longitude, altitude };

    let history = this.droneHistories.get(strId);
    if (!history) {
      history = [];
      this.droneHistories.set(strId, history);
    }

    const lastGeo = history[history.length - 1];
    let historyChanged = false;
    const lastSampleTime = this.trajectoryLastSampleTimes.get(strId) ?? -Infinity;
    if (
      !lastGeo ||
      (
        now - lastSampleTime >= this.trajectorySampleIntervalMs
        && (
          Math.abs(lastGeo.latitude - latitude) > 1e-6
          || Math.abs(lastGeo.longitude - longitude) > 1e-6
          || Math.abs(lastGeo.altitude - altitude) > 1e-2
        )
      )
    ) {
      history.push({ ...geo, sampledAtMilliseconds: now });
      if (history.length > this.maxTrajectoryPoints) history.shift();
      this.trajectoryLastSampleTimes.set(strId, now);
      historyChanged = true;
    }

    const scene = this.viewer.viewer?.scene || this.viewer.scene;
    const geoPosition = new window.mapray.GeoPoint(longitude, latitude, altitude);
    let entity = this.droneEntities.get(strId);
    if (!entity) {
      entity = new window.mapray.PinEntity(scene);
      entity.altitude_mode = window.mapray.AltitudeMode.ABSOLUTE;
      if (typeof entity.addTextPin === 'function') {
        const entry = entity.addTextPin(strId, geoPosition);
        this.droneEntries.set(strId, entry);
      } else {
        safeSetEntityPosition(entity, geoPosition);
      }
      entity.setSize?.([32, 32]);
      if (typeof entity.setPickable === 'function') {
        entity.setPickable(true);
      }
      scene.addEntity(entity);
      this.droneEntities.set(strId, entity);
    } else {
      safeSetEntityPosition(this.droneEntries.get(strId) || entity, geoPosition);
    }

    this._updateTrajectoryEntity(strId, history, historyChanged);

    return geo;
  }

  _updateTrajectoryEntity(id, history, forceUpdate = false) {
    if (!this.ready || !history || !Array.isArray(history) || history.length < 2) return;

    const lastCount = this.trajectoryUpdatedLengths.get(id) ?? -1;
    const isSelected = String(id) === this.selectedDroneId;
    const lastSelected = this.trajectorySelectedState.get(id) ?? null;

    if (!forceUpdate && history.length === lastCount && isSelected === lastSelected) {
      return;
    }

    this.trajectoryUpdatedLengths.set(id, history.length);
    this.trajectorySelectedState.set(id, isSelected);

    const scene = this.viewer.viewer?.scene || this.viewer.scene;
    const LineEntityClass = window.mapray.MarkerLineEntity || window.mapray.PathEntity;
    let trajEntity = this.trajectoryEntities.get(id);
    if (!trajEntity) {
      trajEntity = new LineEntityClass(scene);
      trajEntity.altitude_mode = window.mapray.AltitudeMode.ABSOLUTE;
      scene.addEntity(trajEntity);
      this.trajectoryEntities.set(id, trajEntity);
    }

    trajEntity.setColor?.(isSelected ? [1.0, 0.9, 0.2] : [1.0, 0.4, 0.1]);
    trajEntity.setLineWidth?.(isSelected ? 5 : 3);

    const points = [];
    for (const item of history) {
      points.push(item.longitude, item.latitude, item.altitude);
    }
    safeSetPathEntityPoints(trajEntity, points);
  }

  addCollision(event) {
    if (!this.ready || !event || !event.id) return;
    if (this.collisionEntities.has(event.id)) return;

    const contactPos = Array.isArray(event.contactPositionRos) ? event.contactPositionRos : [0, 0, 0];
    const [rosX, rosY, rosZ] = contactPos;
    const [east, north] = HakoniwaFrame.rosToEnuFrame(rosX, rosY, rosZ);
    const [latitude, longitude] = HakoniwaFrame.ENUToLatLon(
      this.geoOrigin.latitude,
      this.geoOrigin.longitude,
      east,
      north,
    );
    const altitude = this.geoOrigin.altitude + rosZ + (this.geoOrigin.z_offset || 0);

    const scene = this.viewer.viewer?.scene || this.viewer.scene;
    const pin = new window.mapray.PinEntity(scene);
    pin.altitude_mode = window.mapray.AltitudeMode.ABSOLUTE;
    const impact = Number(event.impactSpeedMps || 0).toFixed(1);
    const collisionLabel = `[Impact] ${event.surfaceLabel} ${impact}m/s`;
    const collisionPosition = new window.mapray.GeoPoint(longitude, latitude, altitude);
    if (typeof pin.addTextPin === 'function') {
      pin.addTextPin(collisionLabel, collisionPosition);
    } else {
      safeSetEntityPosition(pin, collisionPosition);
    }
    pin.setSize?.([36, 36]);
    if (typeof pin.setPickable === 'function') {
      pin.setPickable(true);
    }
    scene.addEntity(pin);

    this.collisionEntities.set(event.id, pin);
    this.incidentMetadata.set(event.id, { latitude, longitude, altitude, droneId: event.droneId });

    while (this.collisionEntities.size > this.maxCollisionMarkers) {
      const oldestId = this.collisionEntities.keys().next().value;
      const entity = this.collisionEntities.get(oldestId);
      if (entity) scene.removeEntity(entity);
      this.collisionEntities.delete(oldestId);
      this.incidentMetadata.delete(oldestId);
    }
  }

  focusIncident(incidentId) {
    if (!this.ready) return false;
    const meta = this.incidentMetadata.get(incidentId);
    if (!meta) return false;

    this.selectedIncidentId = incidentId;
    this.createNonDegenerateCameraPose(
      meta.latitude,
      meta.longitude,
      meta.altitude + 25.0,
      -45,
      meta.altitude,
    );
    return true;
  }
}

function createDemFallbackProvider(apiKey) {
  if (!apiKey) return null;
  const CloudDemProvider = window.mapray?.CloudDemProvider;
  if (!CloudDemProvider) return null;
  try {
    return new CloudDemProvider(apiKey);
  } catch (err) {
    console.warn('[MaprayLayer] CloudDemProvider creation warning:', err);
    return null;
  }
}
