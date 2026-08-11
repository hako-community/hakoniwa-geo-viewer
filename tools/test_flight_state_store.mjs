import assert from 'node:assert/strict';
import { FlightStateStore } from '../src/client/src/flight_state_store.mjs';
import { computeDraggedLayout, computeLayoutPixels } from '../src/client/src/layout_modes.mjs';

const store = new FlightStateStore({ maxIncidents: 2 });
const changes = [];
store.subscribe((snapshot, change) => changes.push({ snapshot, change }));
store.updateDrones([
  { id: 'Drone-1', positionRos: [1, 2, 3], rpyDeg: [4, 5, 6] },
  { id: 'Drone-2', positionRos: [7, 8, 9], rpyDeg: [10, 11, 12] },
]);
assert.equal(store.getSnapshot().selectedDroneId, 'Drone-1');
assert.equal(store.selectDrone('Drone-2', { source: 'mapray' }), true);
assert.equal(store.getSnapshot().selectedDroneId, 'Drone-2');
store.addIncident({
  id: 'event-1', droneId: 'Drone-1', contactPositionRos: [1, 2, 3],
  normalRos: [0, 1, 0], color: [1, 0, 0],
});
assert.equal(store.selectIncident('event-1'), true);
assert.equal(store.getSnapshot().selectedDroneId, 'Drone-1');
assert.equal(store.getSnapshot().selectedIncidentId, 'event-1');
assert.equal(changes.at(-1).change.type, 'incident-selection');

assert.deepEqual(computeLayoutPixels(1000, 'operations'), {
  mode: 'operations', mapHeight: 716, threeHeight: 278, splitterVisible: true,
});
assert.deepEqual(computeLayoutPixels(1000, 'offline'), {
  mode: 'offline', mapHeight: 0, threeHeight: 1000, splitterVisible: false,
});
assert.deepEqual(computeDraggedLayout(1000, 500), {
  mode: 'custom', mapHeight: 500, threeHeight: 494, splitterVisible: true,
});
console.log('flight state store/layout tests: PASSED');
