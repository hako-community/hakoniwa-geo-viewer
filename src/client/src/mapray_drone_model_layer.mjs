import {
  advanceRotorPhases,
  rosOffsetToGeoPoint,
  rotorDirectionsFromConfig,
} from './mapray_model_phase0.mjs';
import {
  composeRotorMaprayOrientation,
  hakoniwaRpyToMaprayOrientation,
  rotateRosVectorByRpy,
} from './mapray_drone_pose.mjs';

export const MAPRAY_DRONE_MODEL_LAYER_VERSION = 3;

const RENDER_MODES = new Set(['model', 'pin', 'both']);

function nowMilliseconds() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function cloneGeo(geo) {
  return {
    longitude: Number(geo.longitude),
    latitude: Number(geo.latitude),
    altitude: Number(geo.altitude),
  };
}

function normalizeRotorSpeeds(values) {
  return Array.from({ length: 4 }, (_, index) => {
    const value = Number(values?.[index]);
    return Number.isFinite(value) ? Math.abs(value) : 0;
  });
}

export class MaprayDroneModelLayer {
  constructor({
    mapray,
    uiviewer,
    cloudApi,
    config,
    airframeDatasetId,
    propellerDatasetId,
    droneId = 'fixture-1',
    onSelection = null,
    onStateChange = null,
  }) {
    this.mapray = mapray;
    this.uiviewer = uiviewer;
    this.cloudApi = cloudApi;
    this.config = config;
    this.datasetIds = { airframe: airframeDatasetId, propeller: propellerDatasetId };
    this.droneId = String(droneId);
    this.onSelection = typeof onSelection === 'function' ? onSelection : null;
    this.onStateChange = typeof onStateChange === 'function' ? onStateChange : null;
    this.state = 'idle';
    this.error = null;
    this.airframe = null;
    this.rotors = [];
    this.fallbackPin = null;
    this.fallbackEntry = null;
    this.modelEntities = [];
    this.phases = [0, 0, 0, 0];
    this.rotorSpeeds = normalizeRotorSpeeds(config.fixtureRotorSpeedsRadPerSec);
    this.directions = rotorDirectionsFromConfig(config.rotors);
    this.paused = false;
    this.rotorGeoPoints = [];
    this.positionRos = [0, 0, 0];
    this.rpyDeg = [0, 0, 0];
    this.positionGeo = cloneGeo(config.position);
    this.followEnabled = false;
    this.unsubscribeFlightState = null;
    this.renderMode = 'model';
    this.loadDurationMs = null;
    this.updateSampleCount = 0;
    this.updateTotalMs = 0;
    this.updateMaxMs = 0;
    this.cloudDatasetRequestCount = 0;
  }

  get scene() {
    return this.uiviewer.viewer.scene;
  }

  _setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.onStateChange?.(this.getDiagnostics());
  }

  _tagEntity(entity, part) {
    entity.__hakoniwaDroneTarget = { type: 'drone', id: this.droneId, part };
    entity.setPickable?.(true);
    return entity;
  }

  _addEntity(entity) {
    this.uiviewer.addEntity(entity);
    return entity;
  }

  _removeEntity(entity) {
    if (!entity) return;
    try {
      this.scene.removeEntity(entity);
    } catch (error) {
      console.warn('[MaprayDroneModelLayer] entity removal warning:', error);
    }
  }

  _setTransform(entity, geo, scale, orientation = {}) {
    entity.altitude_mode = this.mapray.AltitudeMode.ABSOLUTE;
    entity.setPosition(new this.mapray.GeoPoint(geo.longitude, geo.latitude, geo.altitude));
    entity.setOrientation(new this.mapray.Orientation(
      orientation.heading || 0,
      orientation.tilt || 0,
      orientation.roll || 0,
    ));
    entity.setScale(scale);
  }

  _createFallbackPin() {
    if (!this.mapray.PinEntity || this.fallbackPin) return;
    const pin = this._tagEntity(new this.mapray.PinEntity(this.scene), 'fallback-pin');
    const position = new this.mapray.GeoPoint(
      this.config.position.longitude,
      this.config.position.latitude,
      this.config.position.altitude,
    );
    pin.altitude_mode = this.mapray.AltitudeMode.ABSOLUTE;
    if (typeof pin.addTextPin === 'function') this.fallbackEntry = pin.addTextPin(this.droneId, position);
    else {
      pin.setPosition?.(position);
      this.fallbackEntry = pin;
    }
    pin.setSize?.([24, 24]);
    this.fallbackPin = this._addEntity(pin);
  }

  _removeFallbackPin() {
    this._removeEntity(this.fallbackPin);
    this.fallbackPin = null;
    this.fallbackEntry = null;
  }

  async _loadModelEntity(datasetId, label, part) {
    const entities = [];
    this.cloudDatasetRequestCount += 1;
    const resource = this.cloudApi.get3DDatasetAsResource(datasetId);
    const loader = new this.mapray.SceneLoader(this.scene, resource, {
      onEntity: (_loader, entity) => {
        entities.push(this._addEntity(this._tagEntity(entity, part)));
      },
    });
    try {
      await loader.load();
    } catch (error) {
      entities.forEach((entity) => this._removeEntity(entity));
      throw error;
    }
    if (entities.length !== 1) {
      entities.forEach((entity) => this._removeEntity(entity));
      throw new Error(`${label}: expected one ModelEntity, received ${entities.length}`);
    }
    this.modelEntities.push(entities[0]);
    return entities[0];
  }

  async load({ renderMode = 'model' } = {}) {
    if (this.state !== 'idle') throw new Error(`load() is invalid while state is ${this.state}`);
    if (!RENDER_MODES.has(renderMode)) {
      throw new Error(`Unsupported drone render mode: ${renderMode}`);
    }
    this.renderMode = renderMode;
    const startedAt = nowMilliseconds();
    this._createFallbackPin();
    this._setState('loading');
    if (renderMode === 'pin') {
      this.loadDurationMs = nowMilliseconds() - startedAt;
      this._setState('ready');
      return this;
    }
    try {
      this.airframe = await this._loadModelEntity(
        this.datasetIds.airframe,
        'airframe',
        'airframe',
      );
      this._setTransform(
        this.airframe,
        this.config.position,
        this.config.airframeScale,
        hakoniwaRpyToMaprayOrientation(this.rpyDeg, this._orientationOffset()),
      );

      for (let index = 0; index < this.config.rotors.length; index += 1) {
        const rotor = await this._loadModelEntity(
          this.datasetIds.propeller,
          `propeller ${index + 1}`,
          `rotor-${index}`,
        );
        const geo = rosOffsetToGeoPoint(
          this.config.position,
          this.config.rotors[index].offsetRosM,
          this.config.visualScale,
        );
        this._setTransform(rotor, geo, this.config.propellerScale, {});
        this.rotors.push(rotor);
        this.rotorGeoPoints.push(geo);
      }
      if (renderMode !== 'both') this._removeFallbackPin();
      this._applyPose();
      this.loadDurationMs = nowMilliseconds() - startedAt;
      this._setState('ready');
      return this;
    } catch (error) {
      this.modelEntities.forEach((entity) => this._removeEntity(entity));
      this.modelEntities = [];
      this.airframe = null;
      this.rotors = [];
      this.rotorGeoPoints = [];
      this.loadDurationMs = nowMilliseconds() - startedAt;
      this._setState('error', error);
      throw error;
    }
  }

  setRotorSpeedsRadPerSec(values) {
    this.rotorSpeeds = normalizeRotorSpeeds(values);
  }

  _orientationOffset() {
    return this.config.orientationOffsetDeg || {
      heading: this.config.airframeHeadingDeg || 0,
      tilt: 0,
      roll: 0,
    };
  }

  _applyPose() {
    if (!this.airframe || this.rotors.length !== 4) return;
    this.positionGeo = rosOffsetToGeoPoint(this.config.position, this.positionRos, 1);
    const bodyOrientation = hakoniwaRpyToMaprayOrientation(
      this.rpyDeg,
      this._orientationOffset(),
    );
    this._setTransform(this.airframe, this.positionGeo, this.config.airframeScale, bodyOrientation);
    this.rotorGeoPoints = this.config.rotors.map((rotorConfig, index) => {
      const scaledOffset = rotorConfig.offsetRosM.map(
        (value) => Number(value) * Number(this.config.visualScale || 1),
      );
      const rotatedOffset = rotateRosVectorByRpy(scaledOffset, this.rpyDeg);
      const rotorPositionRos = this.positionRos.map(
        (value, axis) => Number(value) + rotatedOffset[axis],
      );
      const geo = rosOffsetToGeoPoint(this.config.position, rotorPositionRos, 1);
      const orientation = composeRotorMaprayOrientation(
        this.rpyDeg,
        this.phases[index],
        this._orientationOffset(),
      );
      this._setTransform(this.rotors[index], geo, this.config.propellerScale, orientation);
      return geo;
    });
    if (this.followEnabled) this.focus();
  }

  updateDroneState(state = {}) {
    if (Array.isArray(state.positionRos)) {
      this.positionRos = [0, 1, 2].map((index) => Number(state.positionRos[index]) || 0);
    }
    if (Array.isArray(state.rpyDeg)) {
      this.rpyDeg = [0, 1, 2].map((index) => Number(state.rpyDeg[index]) || 0);
    }
    if (Array.isArray(state.rotorSpeedsRadPerSec) && state.rotorSpeedsRadPerSec.length > 0) {
      this.setRotorSpeedsRadPerSec(state.rotorSpeedsRadPerSec);
    } else if (this.config.missingRotorSpeedMode === 'stop') {
      this.setRotorSpeedsRadPerSec([0, 0, 0, 0]);
    } else {
      this.setRotorSpeedsRadPerSec(this.config.fixtureRotorSpeedsRadPerSec);
    }
    this.positionGeo = rosOffsetToGeoPoint(this.config.position, this.positionRos, 1);
    if (this.fallbackEntry) {
      const position = new this.mapray.GeoPoint(
        this.positionGeo.longitude,
        this.positionGeo.latitude,
        this.positionGeo.altitude,
      );
      if (typeof this.fallbackEntry.setPosition === 'function') this.fallbackEntry.setPosition(position);
      else if (typeof this.fallbackEntry.setPos === 'function') this.fallbackEntry.setPos(position);
      else this.fallbackEntry.position = position;
    }
    this._applyPose();
  }

  bindFlightStateStore(store) {
    this.unsubscribeFlightState?.();
    this.unsubscribeFlightState = store.subscribe((snapshot) => {
      const state = snapshot.drones.find((drone) => String(drone.id) === this.droneId);
      if (state) this.updateDroneState(state);
    });
    return () => {
      this.unsubscribeFlightState?.();
      this.unsubscribeFlightState = null;
    };
  }

  setFollowEnabled(enabled) {
    this.followEnabled = Boolean(enabled);
    if (this.followEnabled) this.focus();
  }

  focus() {
    if (!this.positionGeo) return false;
    const camera = this.config.camera;
    const longitudeOffset = Number(camera.longitude) - Number(this.config.position.longitude);
    const latitudeOffset = Number(camera.latitude) - Number(this.config.position.latitude);
    const heightOffset = Number(camera.height) - Number(camera.lookAtHeight);
    this.uiviewer.setCameraPosition({
      longitude: this.positionGeo.longitude + longitudeOffset,
      latitude: this.positionGeo.latitude + latitudeOffset,
      height: this.positionGeo.altitude + heightOffset,
    });
    this.uiviewer.setLookAtPosition({
      longitude: this.positionGeo.longitude,
      latitude: this.positionGeo.latitude,
      height: this.positionGeo.altitude,
    }, 0);
    return true;
  }

  setPaused(paused, { resetPhases = false } = {}) {
    this.paused = Boolean(paused);
    if (resetPhases) this.phases = [0, 0, 0, 0];
  }

  update(deltaSeconds) {
    if (this.state !== 'ready') return [...this.phases];
    const startedAt = nowMilliseconds();
    if (!this.paused) {
      this.phases = advanceRotorPhases(
        this.phases,
        this.rotorSpeeds,
        deltaSeconds,
        this.directions,
        this.config.visualAngularSpeedLimitRadPerSec,
      );
    }
    this._applyPose();
    const durationMs = nowMilliseconds() - startedAt;
    this.updateSampleCount += 1;
    this.updateTotalMs += durationMs;
    this.updateMaxMs = Math.max(this.updateMaxMs, durationMs);
    return [...this.phases];
  }

  handlePick(picked) {
    const entity = picked?.entity || picked;
    const target = entity?.__hakoniwaDroneTarget;
    if (!target) return false;
    this.onSelection?.({ ...target });
    return true;
  }

  getDiagnostics() {
    return {
      implementationVersion: MAPRAY_DRONE_MODEL_LAYER_VERSION,
      state: this.state,
      error: this.error ? String(this.error.message || this.error) : null,
      droneId: this.droneId,
      renderMode: this.renderMode,
      datasetIds: { ...this.datasetIds },
      entityCount: this.modelEntities.length + (this.fallbackPin ? 1 : 0),
      modelEntityCount: this.modelEntities.length,
      cloudDatasetRequestCount: this.cloudDatasetRequestCount,
      fallbackVisible: Boolean(this.fallbackPin),
      rotorGeoPoints: this.rotorGeoPoints.map(cloneGeo),
      rotorPhasesRad: [...this.phases],
      rotorDirections: [...this.directions],
      rotorSpeedsRadPerSec: [...this.rotorSpeeds],
      rotorPaused: this.paused,
      positionRos: [...this.positionRos],
      rpyDeg: [...this.rpyDeg],
      positionGeo: cloneGeo(this.positionGeo),
      followEnabled: this.followEnabled,
      performance: {
        loadDurationMs: this.loadDurationMs,
        updateSampleCount: this.updateSampleCount,
        averageUpdateMs: this.updateSampleCount > 0
          ? this.updateTotalMs / this.updateSampleCount
          : 0,
        maxUpdateMs: this.updateMaxMs,
      },
    };
  }

  dispose() {
    this.unsubscribeFlightState?.();
    this.unsubscribeFlightState = null;
    this.modelEntities.forEach((entity) => this._removeEntity(entity));
    this._removeFallbackPin();
    this.modelEntities = [];
    this.airframe = null;
    this.rotors = [];
    this.rotorGeoPoints = [];
    this._setState('disposed');
  }
}
