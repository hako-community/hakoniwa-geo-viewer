export const PHASE_D_EVALUATION_VERSION = 1;
export const PHASE_D_RESULT_SCHEMA_VERSION = 1;
export const PHASE_D_EVALUATION_MODES = Object.freeze(['mapray', 'leaflet']);

function toSearchParams(value) {
  if (value instanceof URLSearchParams) return value;
  const text = String(value ?? '');
  return new URLSearchParams(text.startsWith('?') ? text.slice(1) : text);
}

function cleanIdentifier(value, fallback = '') {
  const cleaned = String(value ?? '').trim().replace(/[^a-zA-Z0-9_.-]+/g, '-');
  return cleaned || fallback;
}

function round(value, digits = 3) {
  if (!Number.isFinite(Number(value))) return null;
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function parsePhaseDEvaluationOptions(search = '') {
  const params = toSearchParams(search);
  const requestedMode = params.get('evaluationMode');
  return Object.freeze({
    enabled: params.get('phaseDEvaluation') === '1',
    mode: PHASE_D_EVALUATION_MODES.includes(requestedMode) ? requestedMode : 'mapray',
    participantId: cleanIdentifier(params.get('participantId'), 'PENDING'),
    trialId: cleanIdentifier(params.get('trialId')) || null,
    definitionUrl: String(
      params.get('evaluationConfig')
      || '/hakoniwa-geo-viewer/config/evaluation/phase-d-evaluation.json',
    ),
  });
}

export async function loadPhaseDEvaluationDefinition(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('[PhaseD] fetch is unavailable');
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`[PhaseD] definition load failed: HTTP ${response.status}`);
  const definition = await response.json();
  if (definition?.schemaVersion !== 1 || !Array.isArray(definition?.trials)) {
    throw new Error('[PhaseD] unsupported evaluation definition');
  }
  return definition;
}

export function resolvePhaseDTrial(definition, { trialId = null, seed = null } = {}) {
  const trials = Array.isArray(definition?.trials) ? definition.trials : [];
  const byId = trialId ? trials.find((trial) => String(trial.trialId) === String(trialId)) : null;
  const selected = byId || trials.find((trial) => Number(trial.seed) === Number(seed));
  if (!selected) throw new Error(`[PhaseD] trial not found (trialId=${trialId}, seed=${seed})`);
  return clone(selected);
}

export function applyPhaseDTrialToGeoJson(geojson, trial) {
  const data = clone(geojson);
  const features = Array.isArray(data?.features) ? data.features : [];
  const incidentIndex = features.findIndex(
    (feature) => feature?.properties?.type === 'incident_site' && feature?.geometry?.type === 'Point',
  );
  if (incidentIndex < 0) throw new Error('[PhaseD] base incident_site is missing');
  const source = features[incidentIndex];
  features[incidentIndex] = {
    ...source,
    properties: {
      ...source.properties,
      id: String(trial.incident.id),
      name: String(trial.incident.name),
      incidentType: String(trial.incident.type),
      severity: String(trial.incident.severity || 'HIGH'),
      triggerAtSeconds: Number(trial.triggerAtSeconds),
      targetDroneIndex: Number(trial.targetDroneIndex),
      evaluationTrialId: String(trial.trialId),
      evaluationSeed: Number(trial.seed),
    },
    geometry: { type: 'Point', coordinates: trial.incident.coordinate.map(Number) },
  };
  data.features = features;
  data.properties = {
    ...(data.properties || {}),
    evaluationTrialId: String(trial.trialId),
    evaluationSeed: Number(trial.seed),
  };
  return data;
}

export function phaseDTrialOrder(participantNumber) {
  const number = Math.max(1, Math.trunc(Number(participantNumber) || 1));
  return number % 2 === 1
    ? [
      { sequence: 1, trialId: 'D-SEED-A', seed: 20260821, mode: 'mapray' },
      { sequence: 2, trialId: 'D-SEED-B', seed: 20260822, mode: 'leaflet' },
    ]
    : [
      { sequence: 1, trialId: 'D-SEED-A', seed: 20260821, mode: 'leaflet' },
      { sequence: 2, trialId: 'D-SEED-B', seed: 20260822, mode: 'mapray' },
    ];
}

export class PhaseDEvaluationRecorder {
  constructor({ definition, trial, options, now = () => performance.now(), wallClock = () => new Date() }) {
    this.definition = definition;
    this.trial = trial;
    this.options = options;
    this.now = now;
    this.wallClock = wallClock;
    this.state = 'idle';
    this.operations = [];
    this.startedAtMs = null;
    this.incidentAtMs = null;
    this.localAnalysisAtMs = null;
    this.localAnalysisContext = null;
    this.result = null;
  }

  start() {
    if (this.state !== 'idle') throw new Error('[PhaseD] evaluation already started');
    this.state = 'running';
    this.startedAtMs = this.now();
    this.startedAt = this.wallClock().toISOString();
  }

  recordOperation(action, detail = null) {
    if (this.state !== 'running') return false;
    this.operations.push({
      action: String(action || 'click'),
      elapsedSeconds: round((this.now() - this.startedAtMs) / 1_000),
      detail: detail == null ? null : clone(detail),
    });
    return true;
  }

  recordIncident(detail = null) {
    if (this.state !== 'running' || this.incidentAtMs != null) return false;
    this.incidentAtMs = this.now();
    this.incidentDetail = detail == null ? null : clone(detail);
    return true;
  }

  markLocalAnalysis(context = null) {
    if (this.state !== 'running' || this.localAnalysisAtMs != null) return false;
    this.localAnalysisAtMs = this.now();
    this.localAnalysisContext = context == null ? null : clone(context);
    return true;
  }

  finish(answers = {}) {
    if (this.state !== 'running') throw new Error('[PhaseD] evaluation is not running');
    const finishedAtMs = this.now();
    const correct = this.trial.correct || {};
    const localContext = this.localAnalysisContext || {};
    const normalizedAnswers = {
      droneId: String(answers.droneId || ''),
      incidentId: String(answers.incidentId || ''),
      incidentType: String(answers.incidentType || ''),
      location: String(answers.location || ''),
      confidence: Math.max(1, Math.min(5, Math.trunc(Number(answers.confidence) || 1))),
      hesitations: Math.max(0, Math.trunc(Number(answers.hesitations) || 0)),
      usefulInformation: String(answers.usefulInformation || '').trim(),
      unnecessaryDisplay: String(answers.unnecessaryDisplay || '').trim(),
    };
    const scores = {
      droneCorrect: normalizedAnswers.droneId === String(correct.droneId),
      incidentCorrect: normalizedAnswers.incidentId === String(correct.incidentId),
      incidentTypeCorrect: normalizedAnswers.incidentType === String(correct.incidentType),
      locationCorrect: normalizedAnswers.location === String(correct.location),
      localAnalysisReached: this.localAnalysisAtMs != null,
      idIncidentIntegrity: normalizedAnswers.droneId === String(correct.droneId)
        && normalizedAnswers.incidentId === String(correct.incidentId)
        && String(localContext.selectedDroneId || '') === String(correct.droneId)
        && String(localContext.selectedIncidentId || '') === String(correct.incidentId),
    };
    this.state = 'complete';
    this.result = Object.freeze({
      schemaVersion: PHASE_D_RESULT_SCHEMA_VERSION,
      measurementKind: 'actual-human-evaluation',
      estimated: false,
      evaluationId: String(this.definition.evaluationId),
      participantId: String(this.options.participantId),
      trialId: String(this.trial.trialId),
      mode: String(this.options.mode),
      seed: Number(this.trial.seed),
      fleetSize: Number(this.definition.fleetSize),
      startedAt: this.startedAt,
      completedAt: this.wallClock().toISOString(),
      metrics: {
        trialDurationSeconds: round((finishedAtMs - this.startedAtMs) / 1_000),
        incidentToCompletionSeconds: this.incidentAtMs == null
          ? null : round((finishedAtMs - this.incidentAtMs) / 1_000),
        incidentToLocalAnalysisSeconds: this.incidentAtMs == null || this.localAnalysisAtMs == null
          ? null : round((this.localAnalysisAtMs - this.incidentAtMs) / 1_000),
        operationCount: this.operations.length,
        hesitations: normalizedAnswers.hesitations,
        confidence: normalizedAnswers.confidence,
      },
      answers: normalizedAnswers,
      correct,
      scores,
      localAnalysisContext: this.localAnalysisContext,
      operations: this.operations.slice(),
    });
    return this.result;
  }
}

export const PHASE_D_CSV_COLUMNS = Object.freeze([
  'schema_version', 'measurement_kind', 'estimated', 'evaluation_id', 'participant_id',
  'trial_id', 'mode', 'seed', 'fleet_size', 'started_at', 'completed_at',
  'trial_duration_seconds', 'incident_to_completion_seconds',
  'incident_to_local_analysis_seconds', 'operation_count', 'hesitations', 'confidence',
  'answer_drone_id', 'answer_incident_id', 'answer_incident_type', 'answer_location',
  'drone_correct', 'incident_correct', 'incident_type_correct', 'location_correct',
  'local_analysis_reached', 'id_incident_integrity', 'useful_information', 'unnecessary_display',
]);

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[\r\n,"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function phaseDResultToCsv(result, { includeHeader = true } = {}) {
  const row = {
    schema_version: result.schemaVersion,
    measurement_kind: result.measurementKind,
    estimated: result.estimated,
    evaluation_id: result.evaluationId,
    participant_id: result.participantId,
    trial_id: result.trialId,
    mode: result.mode,
    seed: result.seed,
    fleet_size: result.fleetSize,
    started_at: result.startedAt,
    completed_at: result.completedAt,
    trial_duration_seconds: result.metrics.trialDurationSeconds,
    incident_to_completion_seconds: result.metrics.incidentToCompletionSeconds,
    incident_to_local_analysis_seconds: result.metrics.incidentToLocalAnalysisSeconds,
    operation_count: result.metrics.operationCount,
    hesitations: result.metrics.hesitations,
    confidence: result.metrics.confidence,
    answer_drone_id: result.answers.droneId,
    answer_incident_id: result.answers.incidentId,
    answer_incident_type: result.answers.incidentType,
    answer_location: result.answers.location,
    drone_correct: result.scores.droneCorrect,
    incident_correct: result.scores.incidentCorrect,
    incident_type_correct: result.scores.incidentTypeCorrect,
    location_correct: result.scores.locationCorrect,
    local_analysis_reached: result.scores.localAnalysisReached,
    id_incident_integrity: result.scores.idIncidentIntegrity,
    useful_information: result.answers.usefulInformation,
    unnecessary_display: result.answers.unnecessaryDisplay,
  };
  const values = PHASE_D_CSV_COLUMNS.map((column) => csvEscape(row[column])).join(',');
  return includeHeader ? `${PHASE_D_CSV_COLUMNS.join(',')}\r\n${values}\r\n` : `${values}\r\n`;
}

export function downloadPhaseDResult(result, format = 'csv') {
  if (!result) return false;
  const extension = format === 'json' ? 'json' : 'csv';
  const contents = extension === 'json'
    ? `${JSON.stringify(result, null, 2)}\n`
    : phaseDResultToCsv(result);
  const blob = new Blob([contents], {
    type: extension === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `phase-d-${cleanIdentifier(result.participantId)}-${cleanIdentifier(result.trialId)}-${result.mode}.${extension}`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}
