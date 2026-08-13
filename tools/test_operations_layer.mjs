import assert from 'node:assert/strict';
import { evaluateFlightRules } from '../src/client/src/flight_rules.mjs';
import {
  getOperationsExtent,
  normalizeOperationsData,
  OperationsLayerModel,
} from '../src/client/src/operations_layer.mjs';

const geojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 'allowed', type: 'geofence', rule: 'containment', minAltitudeM: 10, maxAltitudeM: 50 },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [139.0, 35.0], [139.001, 35.0], [139.001, 35.001],
          [139.0, 35.001], [139.0, 35.0],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: { id: 'restricted', type: 'geofence', rule: 'exclusion' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [139.0007, 35.0007], [139.0009, 35.0007], [139.0009, 35.0009],
          [139.0007, 35.0009], [139.0007, 35.0007],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: { id: 'base', type: 'vertiport' },
      geometry: { type: 'Point', coordinates: [139.0001, 35.0001, 20] },
    },
    {
      type: 'Feature',
      properties: { id: 'route-1', type: 'planned_route', maxDeviationM: 15 },
      geometry: { type: 'LineString', coordinates: [[139.0, 35.0005], [139.001, 35.0005]] },
    },
  ],
};

const normalized = normalizeOperationsData(geojson);
assert.equal(normalized.featureCollection.features.length, 4);
assert.equal(normalized.geofences.length, 2);
assert.equal(normalized.restrictedZones.length, 1);
assert.equal(normalized.vertiports.length, 1);
assert.equal(normalized.plannedRoutes.length, 1);
assert.deepEqual(getOperationsExtent(normalized), {
  west: 139.0,
  south: 35.0,
  east: 139.001,
  north: 35.001,
  center: { longitude: 139.0005, latitude: 35.0005 },
});

const model = new OperationsLayerModel();
assert.deepEqual(model.loadGeoJSON(geojson), normalized);
assert.equal(model.getSummary().geofencesCount, 2);
assert.equal(model.getSummary().restrictedZonesCount, 1);

const origin = { longitude: 139.0, latitude: 35.0 };
const outsideEvents = evaluateFlightRules({
  id: 'Drone-A', geo: { longitude: 139.002, latitude: 35.002, altitude: 20 },
}, geojson, origin);
assert.ok(outsideEvents.some((event) => event.type === 'GEOFENCE_BREACH'));
assert.ok(outsideEvents.some((event) => event.type === 'ROUTE_DEVIATION'));

const insideEvents = evaluateFlightRules({
  id: 'Drone-A', geo: { longitude: 139.0005, latitude: 35.0005, altitude: 20 },
}, normalized, origin);
assert.equal(insideEvents.length, 0);

console.log('operations normalization/rule tests: PASSED');
