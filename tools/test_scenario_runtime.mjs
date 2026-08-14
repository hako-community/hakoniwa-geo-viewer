import assert from 'node:assert/strict';
import { generateFleetSyntheticData, FleetManager } from '../src/client/src/fleet_manager.mjs';
import {
  buildExecutionSourceUrl,
  describeExecutionSource,
  parseScenarioRuntimeOptions,
} from '../src/client/src/scenario_runtime.mjs';

const defaults = parseScenarioRuntimeOptions('');
assert.equal(defaults.scenarioMode, 'live');
assert.equal(defaults.executionSource, 'hakoniwa-core');
assert.equal(defaults.fleetSize, 10);
assert.equal(defaults.liveProfile, 'generic');

const coreKinematic = parseScenarioRuntimeOptions(
  '?scenarioMode=live&liveProfile=kinematic&fleetSize=30&seed=20260811',
);
assert.equal(coreKinematic.displayLabel, 'LIVE HAKONIWA / KINEMATIC');
assert.equal(coreKinematic.liveProfile, 'kinematic');
assert.equal(coreKinematic.executionSource, 'hakoniwa-core');

const fixture = parseScenarioRuntimeOptions('?scenarioMode=fixture&fleetSize=30&seed=42');
assert.equal(fixture.displayLabel, 'SYNTHETIC FLEET');
assert.equal(fixture.executionSource, 'browser-standalone');
assert.equal(fixture.fleetSize, 30);
assert.equal(fixture.seed, 42);
assert.equal(describeExecutionSource(fixture).label, 'Browser Standalone');
assert.equal(describeExecutionSource(fixture).requiresPdu, false);
assert.equal(describeExecutionSource(coreKinematic).label, 'Hakoniwa Core / Kinematic');
assert.equal(describeExecutionSource(coreKinematic).requiresPdu, true);

const browserUrl = new URL(buildExecutionSourceUrl(
  'browser-standalone',
  'http://localhost:18080/viewer?scenarioMode=live&liveProfile=kinematic&fleetSize=30',
));
assert.equal(browserUrl.searchParams.get('scenarioMode'), 'fixture');
assert.equal(browserUrl.searchParams.has('liveProfile'), false);
assert.equal(browserUrl.searchParams.has('autoConnect'), false);
assert.equal(browserUrl.searchParams.get('fleetSize'), '30');

const coreUrl = new URL(buildExecutionSourceUrl(
  'hakoniwa-core',
  'http://localhost:18080/viewer?scenarioMode=fixture&fleetSize=30',
));
assert.equal(coreUrl.searchParams.get('scenarioMode'), 'live');
assert.equal(coreUrl.searchParams.get('liveProfile'), 'kinematic');
assert.equal(coreUrl.searchParams.get('autoConnect'), '1');

const legacy = parseScenarioRuntimeOptions('r7Fixture=1&fleetSize=20');
assert.equal(legacy.scenarioMode, 'fixture');
assert.equal(legacy.fleetSize, 20);

const invalid = parseScenarioRuntimeOptions('scenarioMode=unknown&fleetSize=25&seed=nan');
assert.equal(invalid.scenarioMode, 'live');
assert.equal(invalid.fleetSize, 10);
assert.equal(invalid.seed, 20260811);

const fleetA = generateFleetSyntheticData(30, undefined, { seed: 123 });
const fleetB = generateFleetSyntheticData(30, undefined, { seed: 123 });
const fleetC = generateFleetSyntheticData(30, undefined, { seed: 124 });
assert.deepEqual(fleetA, fleetB);
assert.notDeepEqual(fleetA, fleetC);
assert.equal(fleetA.length, 30);
assert.equal(fleetA[0].id, 'Drone-A');
assert.equal(fleetA[25].id, 'Drone-Z');
assert.equal(fleetA[26].id, 'Drone-AA');
assert.equal(new Set(fleetA.map((drone) => drone.id)).size, 30);

const manager = new FleetManager();
assert.equal(manager.loadFleet(fleetA).length, 30);
assert.equal(manager.getDiagnostics().activeDroneCount, 30);

console.log('scenario runtime/fleet tests: PASSED');
