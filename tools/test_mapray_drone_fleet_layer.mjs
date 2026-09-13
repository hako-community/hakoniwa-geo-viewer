import assert from 'node:assert/strict';
import { MaprayDroneFleetLayer } from '../src/client/src/mapray_drone_fleet_layer.mjs';
import { FlightStateStore } from '../src/client/src/flight_state_store.mjs';

const cloudRequests = [];
const disposed = [];
class FakeLayer {
  constructor(options) {
    this.options = options;
    this.state = {};
    this.entityCount = 0;
    this.modelEntityCount = 0;
    this.phases = [0, 0, 0, 0];
  }
  async load({ renderMode }) {
    if (renderMode !== 'pin') {
      this.options.cloudApi.get3DDatasetAsResource(this.options.airframeDatasetId);
      for (let index = 0; index < 4; index += 1) {
        this.options.cloudApi.get3DDatasetAsResource(this.options.propellerDatasetId);
      }
    }
    this.entityCount = renderMode === 'pin' ? 1 : (renderMode === 'both' ? 6 : 5);
    this.modelEntityCount = renderMode === 'pin' ? 0 : 5;
  }
  updateDroneState(state) { this.state = { ...state }; }
  setFollowEnabled(value) { this.follow = value; }
  setPaused(value) { this.paused = value; }
  update() { this.phases[0] += Number(this.state.rotorSpeedsRadPerSec?.[0] || 0); }
  focus() { this.focused = true; return true; }
  dispose() { disposed.push(this.options.droneId); }
  getDiagnostics() {
    return {
      entityCount: this.entityCount,
      modelEntityCount: this.modelEntityCount,
      rotorSpeedsRadPerSec: [...(this.state.rotorSpeedsRadPerSec || [])],
      rotorPhasesRad: [...this.phases],
    };
  }
}

let now = 1000;
let selected = null;
const fleet = new MaprayDroneFleetLayer({
  cloudApi: { get3DDatasetAsResource(id) { cloudRequests.push(id); return { id }; } },
  config: {},
  airframeDatasetId: 'airframe',
  propellerDatasetId: 'propeller',
  layerFactory: (options) => new FakeLayer(options),
  staleTimeoutMs: 100,
  now: () => now,
  onSelection: (target) => { selected = target; },
});
const store = new FlightStateStore();
store.updateDrones([
  { id: 'A', positionRos: [1, 0, 0], rotorSpeedsRadPerSec: [10, 11, 12, 13] },
  { id: 'B', positionRos: [2, 0, 0], rotorSpeedsRadPerSec: [20, 21, 22, 23] },
]);
fleet.bindFlightStateStore(store);
await fleet.whenIdle();
let diagnostics = fleet.getDiagnostics();
assert.equal(diagnostics.activeDroneCount, 2);
assert.equal(diagnostics.modelEntityCount, 10);
assert.equal(diagnostics.entityCount, 10);
assert.equal(diagnostics.cloudResourceCreateCount, 2);
assert.equal(diagnostics.createdDroneCount, 2);
assert.deepEqual(cloudRequests, ['airframe', 'propeller']);
assert.deepEqual(diagnostics.layers[0].rotorSpeedsRadPerSec, [10, 11, 12, 13]);
assert.deepEqual(diagnostics.layers[1].rotorSpeedsRadPerSec, [20, 21, 22, 23]);

fleet.update(0.1);
diagnostics = fleet.getDiagnostics();
assert.notEqual(diagnostics.layers[0].rotorPhasesRad[0], diagnostics.layers[1].rotorPhasesRad[0]);
store.updateDrones([{ id: 'B', positionRos: [3, 0, 0], rotorSpeedsRadPerSec: [30, 31, 32, 33] }]);
await fleet.whenIdle();
assert.equal(fleet.getDiagnostics().activeDroneCount, 1);
assert.ok(disposed.includes('A'));

await fleet.reconcile({ drones: [{ id: 'C', rotorSpeedsRadPerSec: [1, 2, 3, 4] }] }, {
  removeMissing: false, timestampMilliseconds: now,
});
now += 101;
assert.deepEqual(fleet.pruneStale(now).sort(), ['B', 'C']);
assert.equal(fleet.getDiagnostics().entityCount, 0);
assert.equal(fleet.getDiagnostics().disposedDroneCount, 3);

await fleet.reconcile({ drones: [{ id: 'D' }], selectedDroneId: 'D' });
const picked = { __hakoniwaDroneTarget: { type: 'drone', id: 'D', part: 'airframe' } };
assert.equal(fleet.handlePick(picked), true);
assert.equal(selected.id, 'D');
fleet.setFollowEnabled(true);
assert.equal(fleet.focusSelected(), true);
fleet.dispose();
assert.equal(fleet.getDiagnostics().activeDroneCount, 0);
assert.equal(fleet.getDiagnostics().createdDroneCount, 4);
assert.equal(fleet.getDiagnostics().disposedDroneCount, 4);
assert.equal(fleet.getDiagnostics().cloudResourceCreateCount, 2);

console.log('Mapray drone fleet layer tests: PASSED');
