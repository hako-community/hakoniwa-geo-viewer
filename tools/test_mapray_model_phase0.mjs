import assert from 'node:assert/strict';
import {
  advanceRotorPhases,
  inspectMapray096Api,
  normalizeDatasetId,
  rosOffsetToGeoPoint,
  rotorDirectionsFromConfig,
  validatePhase0Config,
} from '../src/client/src/mapray_model_phase0.mjs';

const mapray = {
  ModelEntity: class {}, SceneLoader: class {}, GeoPoint: class {}, Orientation: class {},
  cloud: { CloudApiV2: class {}, CloudApi: { TokenType: { API_KEY: 'api-key' } } },
};
const maprayui = { StandardUIViewer: class {} };
assert.deepEqual(inspectMapray096Api(mapray, maprayui), {
  requiredVersion: '0.9.6', ok: true, missing: [],
});
assert.equal(inspectMapray096Api({}, {}).ok, false);
assert.equal(normalizeDatasetId(' 123456 '), '123456');
assert.equal(normalizeDatasetId('not-an-id'), '');

const config = validatePhase0Config({
  schemaVersion: 1, sdkVersion: '0.9.6',
  position: { longitude: 139.7, latitude: 35.6, altitude: 100 },
  rotors: [
    { offsetRosM: [1, -1, 0.2], spinDirection: 'cw' },
    { offsetRosM: [-1, 1, 0.2], spinDirection: 'ccw' },
    { offsetRosM: [1, 1, 0.2], spinDirection: 'cw' },
    { offsetRosM: [-1, -1, 0.2], spinDirection: 'ccw' },
  ],
});
assert.deepEqual(rotorDirectionsFromConfig(config.rotors), [-1, 1, -1, 1]);

const phases = advanceRotorPhases([0, 0, 0, 0], [2, 2, 2, 2], 0.5, [-1, 1, -1, 1], 10);
// deltaSeconds is intentionally clamped to 0.1 seconds.
assert.ok(Math.abs(phases[0] - (Math.PI * 2 - 0.2)) < 1e-12);
assert.ok(Math.abs(phases[1] - 0.2) < 1e-12);
const limited = advanceRotorPhases([0, 0, 0, 0], [100, 100, 100, 100], 0.1, [1, 1, 1, 1], 12);
assert.ok(limited.every((value) => Math.abs(value - 1.2) < 1e-12));
const stopped = advanceRotorPhases([1, 2, 3, 4], [0, 0, 0, 0], 0.1);
assert.deepEqual(stopped, [1, 2, 3, 4]);

const origin = { longitude: 139.7, latitude: 35.6, altitude: 100 };
const north = rosOffsetToGeoPoint(origin, [1, 0, 0]);
assert.ok(north.latitude > origin.latitude);
assert.equal(north.longitude, origin.longitude);
const west = rosOffsetToGeoPoint(origin, [0, 1, 0]);
assert.ok(west.longitude < origin.longitude);
const up = rosOffsetToGeoPoint(origin, [0, 0, 2], 3);
assert.equal(up.altitude, 106);

console.log('Mapray model Phase 0 tests: PASSED');
