import assert from 'node:assert/strict';
import { MaprayDroneModelLayer } from '../src/client/src/mapray_drone_model_layer.mjs';
import { FlightStateStore } from '../src/client/src/flight_state_store.mjs';

class Entity {
  setPosition(value) { this.position = value; }
  setOrientation(value) { this.orientation = value; }
  setScale(value) { this.scale = value; }
  setPickable(value) { this.pickable = value; }
}

class PinEntity extends Entity {
  addTextPin(label, position) { this.label = label; this.position = position; return this; }
  setSize(value) { this.size = value; }
}

class GeoPoint {
  constructor(longitude, latitude, altitude) {
    Object.assign(this, { longitude, latitude, altitude });
  }
}

class Orientation {
  constructor(heading, tilt, roll) { Object.assign(this, { heading, tilt, roll }); }
}

function createHarness({ failAtLoad = -1 } = {}) {
  let loadCount = 0;
  const cloudRequestIds = [];
  const scene = {
    entities: [],
    removeEntity(entity) {
      this.entities = this.entities.filter((candidate) => candidate !== entity);
    },
  };
  class SceneLoader {
    constructor(_scene, resource, options) {
      this.resource = resource;
      this.options = options;
    }
    async load() {
      const index = loadCount;
      loadCount += 1;
      if (index === failAtLoad) throw new Error(`fixture load failure ${index}`);
      this.options.onEntity(this, new Entity());
    }
  }
  const mapray = {
    AltitudeMode: { ABSOLUTE: 'absolute' }, GeoPoint, Orientation, PinEntity, SceneLoader,
  };
  const uiviewer = {
    viewer: { scene },
    addEntity(entity) { scene.entities.push(entity); },
    setCameraPosition(value) { this.cameraPosition = value; },
    setLookAtPosition(value) { this.lookAtPosition = value; },
  };
  const cloudApi = { get3DDatasetAsResource: (id) => {
    cloudRequestIds.push(id);
    return { id };
  } };
  return { mapray, uiviewer, cloudApi, scene, cloudRequestIds };
}

const config = {
  position: { longitude: 139.745433, latitude: 35.658581, altitude: 180 },
  airframeHeadingDeg: 0,
  airframeScale: [0.6, 0.6, 0.6],
  propellerScale: [0.6, 0.6, 0.6],
  visualScale: 1,
  fixtureRotorSpeedsRadPerSec: [60, 60, 60, 60],
  visualAngularSpeedLimitRadPerSec: 12,
  rotors: [
    { offsetRosM: [0.5, -0.5, 0.3], spinDirection: 'cw' },
    { offsetRosM: [-0.5, 0.5, 0.3], spinDirection: 'ccw' },
    { offsetRosM: [0.5, 0.5, 0.3], spinDirection: 'cw' },
    { offsetRosM: [-0.5, -0.5, 0.3], spinDirection: 'ccw' },
  ],
};

const harness = createHarness();
let selected = null;
const states = [];
const layer = new MaprayDroneModelLayer({
  ...harness,
  config,
  airframeDatasetId: '6301326065532928',
  propellerDatasetId: '5093940311097344',
  onSelection: (target) => { selected = target; },
  onStateChange: (diagnostics) => states.push(diagnostics.state),
});
await layer.load();
assert.deepEqual(states, ['loading', 'ready']);
assert.equal(harness.scene.entities.length, 5);
assert.equal(layer.getDiagnostics().modelEntityCount, 5);
assert.equal(layer.getDiagnostics().fallbackVisible, false);
assert.equal(layer.getDiagnostics().renderMode, 'model');
assert.equal(harness.cloudRequestIds.length, 5);
assert.equal(layer.getDiagnostics().cloudDatasetRequestCount, 5);
assert.equal(layer.handlePick(layer.rotors[2]), true);
assert.deepEqual(selected, { type: 'drone', id: 'fixture-1', part: 'rotor-2' });

const moving = layer.update(0.1);
assert.ok(moving[0] > 5 && moving[1] > 1);
layer.setRotorSpeedsRadPerSec([0, 0, 0, 0]);
assert.deepEqual(layer.update(0.1), moving);
layer.setPaused(true, { resetPhases: true });
assert.deepEqual(layer.update(0.1), [0, 0, 0, 0]);
assert.ok(layer.getDiagnostics().performance.updateSampleCount >= 3);

const store = new FlightStateStore();
layer.bindFlightStateStore(store);
store.updateDrones([{
  id: 'fixture-1',
  positionRos: [10, 20, 30],
  rpyDeg: [0, 0, 90],
  rotorSpeedsRadPerSec: [0, 10, 20, 30],
}]);
const live = layer.getDiagnostics();
assert.deepEqual(live.positionRos, [10, 20, 30]);
assert.deepEqual(live.rpyDeg, [0, 0, 90]);
assert.deepEqual(live.rotorSpeedsRadPerSec, [0, 10, 20, 30]);
assert.ok(layer.airframe.orientation.heading < -89.9);
assert.ok(live.positionGeo.latitude > config.position.latitude);
assert.ok(live.positionGeo.longitude < config.position.longitude);
assert.ok(live.rotorGeoPoints[0].longitude < live.positionGeo.longitude);
layer.setFollowEnabled(true);
assert.equal(layer.getDiagnostics().followEnabled, true);
assert.ok(harness.uiviewer.lookAtPosition.latitude > config.position.latitude);

layer.dispose();
assert.equal(harness.scene.entities.length, 0);
assert.equal(layer.getDiagnostics().state, 'disposed');

const pinHarness = createHarness();
const pinLayer = new MaprayDroneModelLayer({
  ...pinHarness,
  config,
  airframeDatasetId: null,
  propellerDatasetId: null,
});
await pinLayer.load({ renderMode: 'pin' });
pinLayer.update(0.1);
assert.equal(pinLayer.getDiagnostics().renderMode, 'pin');
assert.equal(pinLayer.getDiagnostics().entityCount, 1);
assert.equal(pinLayer.getDiagnostics().fallbackVisible, true);
assert.equal(pinHarness.cloudRequestIds.length, 0);
assert.equal(pinLayer.getDiagnostics().cloudDatasetRequestCount, 0);
assert.ok(pinLayer.getDiagnostics().performance.loadDurationMs >= 0);
pinLayer.dispose();
assert.equal(pinHarness.scene.entities.length, 0);

const bothHarness = createHarness();
const bothLayer = new MaprayDroneModelLayer({
  ...bothHarness,
  config,
  airframeDatasetId: '6301326065532928',
  propellerDatasetId: '5093940311097344',
});
await bothLayer.load({ renderMode: 'both' });
assert.equal(bothLayer.getDiagnostics().entityCount, 6);
assert.equal(bothLayer.getDiagnostics().fallbackVisible, true);
bothLayer.dispose();

const invalidHarness = createHarness();
const invalidLayer = new MaprayDroneModelLayer({
  ...invalidHarness,
  config,
  airframeDatasetId: null,
  propellerDatasetId: null,
});
await assert.rejects(invalidLayer.load({ renderMode: 'wireframe' }), /Unsupported drone render mode/);

const failingHarness = createHarness({ failAtLoad: 2 });
const failingLayer = new MaprayDroneModelLayer({
  ...failingHarness,
  config,
  airframeDatasetId: '6301326065532928',
  propellerDatasetId: '5093940311097344',
});
await assert.rejects(failingLayer.load(), /fixture load failure/);
assert.equal(failingLayer.getDiagnostics().state, 'error');
assert.equal(failingLayer.getDiagnostics().fallbackVisible, true);
assert.equal(failingHarness.scene.entities.length, 1);
failingLayer.updateDroneState({ positionRos: [5, -2, 7], rpyDeg: [0, 0, 0] });
assert.ok(failingLayer.fallbackEntry.position.latitude > config.position.latitude);
failingLayer.dispose();
assert.equal(failingHarness.scene.entities.length, 0);

console.log('Mapray drone model layer tests: PASSED');
