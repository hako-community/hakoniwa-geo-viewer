import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PhaseDEvaluationRecorder,
  applyPhaseDTrialToGeoJson,
  parsePhaseDEvaluationOptions,
  phaseDResultToCsv,
  phaseDTrialOrder,
  resolvePhaseDTrial,
} from '../src/client/src/operations_evaluation.mjs';

const definition = JSON.parse(fs.readFileSync(
  new URL('../config/evaluation/phase-d-evaluation.json', import.meta.url),
  'utf8',
));
const geojson = JSON.parse(fs.readFileSync(
  new URL('../config/operations/shibuya-wide-area-5km.geojson', import.meta.url),
  'utf8',
));

const options = parsePhaseDEvaluationOptions(
  '?phaseDEvaluation=1&evaluationMode=leaflet&participantId=P01&trialId=D-SEED-A',
);
assert.equal(options.enabled, true);
assert.equal(options.mode, 'leaflet');
assert.equal(options.participantId, 'P01');

const trial = resolvePhaseDTrial(definition, options);
assert.equal(trial.seed, 20260821);
const applied = applyPhaseDTrialToGeoJson(geojson, trial);
const incidents = applied.features.filter((feature) => feature.properties?.type === 'incident_site');
assert.equal(incidents.length, 1);
assert.equal(incidents[0].properties.targetDroneIndex, 4);
assert.deepEqual(incidents[0].geometry.coordinates, trial.incident.coordinate);
assert.deepEqual(
  phaseDTrialOrder(1).map((item) => item.mode),
  ['mapray', 'leaflet'],
);
assert.deepEqual(
  phaseDTrialOrder(2).map((item) => item.mode),
  ['leaflet', 'mapray'],
);

let nowMs = 1_000;
const recorder = new PhaseDEvaluationRecorder({
  definition,
  trial,
  options,
  now: () => nowMs,
  wallClock: () => new Date('2026-08-12T00:00:00.000Z'),
});
recorder.start();
nowMs = 2_000;
recorder.recordOperation('click', { target: 'map' });
nowMs = 16_000;
recorder.recordIncident({ incidentId: trial.correct.incidentId });
nowMs = 20_000;
recorder.markLocalAnalysis({
  selectedDroneId: trial.correct.droneId,
  selectedIncidentId: trial.correct.incidentId,
});
nowMs = 23_000;
const result = recorder.finish({
  droneId: trial.correct.droneId,
  incidentId: trial.correct.incidentId,
  incidentType: trial.correct.incidentType,
  location: trial.correct.location,
  confidence: 4,
  hesitations: 1,
});
assert.equal(result.metrics.incidentToLocalAnalysisSeconds, 4);
assert.equal(result.metrics.incidentToCompletionSeconds, 7);
assert.equal(result.metrics.operationCount, 1);
assert.equal(result.scores.idIncidentIntegrity, true);
assert.match(phaseDResultToCsv(result), /actual-human-evaluation/);
assert.match(phaseDResultToCsv(result), /P01/);

console.log('Phase D operations evaluation tests: PASSED');
