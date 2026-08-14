import assert from 'node:assert/strict';
import {
  LOCATION_CATALOG,
  buildLocationUrl,
  getLocationId,
} from '../src/client/src/location_selector.mjs';

const current = 'http://localhost:18080/hakoniwa-geo-viewer/src/client/index.html?scenarioMode=fixture&fleetSize=30&seed=20260811';
assert.equal(LOCATION_CATALOG.length, 2);
assert.equal(
  getLocationId('/hakoniwa-geo-viewer/config/viewer-config-tokyo-tower.json', current),
  'tokyo-tower',
);
const selected = new URL(buildLocationUrl('tokyo-tower', current));
assert.equal(selected.searchParams.get('scenarioMode'), 'fixture');
assert.equal(selected.searchParams.get('fleetSize'), '30');
assert.equal(selected.searchParams.get('seed'), '20260811');
assert.equal(
  selected.searchParams.get('scenarioConfig'),
  '/hakoniwa-geo-viewer/config/viewer-config-tokyo-tower.json',
);
assert.throws(() => buildLocationUrl('unknown', current), /unknown location/);

console.log('location selector tests: PASSED');
