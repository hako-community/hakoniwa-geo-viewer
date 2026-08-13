import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateFleetSyntheticData } from '../src/client/src/fleet_manager.mjs';
import { normalizeOperationsData } from '../src/client/src/operations_layer.mjs';
import {
  createWideAreaScenario,
  geoCoordinateToRos,
} from '../src/client/src/wide_area_scenario.mjs';

const geojson = JSON.parse(fs.readFileSync(
  new URL('../config/operations/shibuya-wide-area-5km.geojson', import.meta.url),
  'utf8',
));
const operationsData = normalizeOperationsData(geojson);
const geoOrigin = { latitude: 35.6625, longitude: 139.70625, altitude: 0 };
const fleet = generateFleetSyntheticData(30, undefined, { seed: 20260811 });
const scenario = createWideAreaScenario({ operationsData, fleet, geoOrigin, seed: 20260811 });

assert.equal(scenario.diagnostics.routeCount, 3);
assert.equal(scenario.diagnostics.fleetSize, 30);
assert.equal(scenario.incident.triggerAtSeconds, 35);
assert.deepEqual(scenario.sample(12), scenario.sample(12), 'same seed and time must be deterministic');

const before = scenario.sample(34.9);
assert.equal(before.length, 30);
assert.equal(new Set(before.map((drone) => drone.routeId)).size, 3);
assert.ok(before.every((drone) => drone.status === 'NORMAL' && drone.isSynthetic));

const after = scenario.sample(45);
const target = after[scenario.incident.targetDroneIndex];
assert.equal(target.status, 'HIGH');
assert.ok(after.filter((drone) => drone.status === 'NORMAL').length >= 29);
assert.deepEqual(
  target.positionRos,
  geoCoordinateToRos(geoOrigin, scenario.incident.coordinate),
  'target must reach the deterministic incident site after diversion',
);

console.log('wide-area deterministic scenario tests: PASSED');
