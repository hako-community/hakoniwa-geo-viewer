export const SCENARIO_RUNTIME_VERSION = 1;
export const SUPPORTED_FLEET_SIZES = Object.freeze([10, 20, 30]);
export const SUPPORTED_SCENARIO_MODES = Object.freeze(['fixture', 'replay', 'live']);
export const SUPPORTED_LIVE_PROFILES = Object.freeze(['generic', 'kinematic', 'mujoco']);

const DEFAULT_SEED = 20260811;
const MODE_LABELS = Object.freeze({
  fixture: 'SYNTHETIC FLEET',
  replay: 'REPLAY',
  live: 'LIVE HAKONIWA',
});
const LIVE_PROFILE_LABELS = Object.freeze({
  generic: 'LIVE HAKONIWA',
  kinematic: 'LIVE HAKONIWA / KINEMATIC',
  mujoco: 'LIVE HAKONIWA / MUJOCO',
});

function toSearchParams(value) {
  if (value instanceof URLSearchParams) return value;
  const text = String(value ?? '');
  return new URLSearchParams(text.startsWith('?') ? text.slice(1) : text);
}

function parseFleetSize(value) {
  const size = Number(value);
  return SUPPORTED_FLEET_SIZES.includes(size) ? size : 10;
}

function parseSeed(value) {
  if (value == null || String(value).trim() === '') return DEFAULT_SEED;
  const seed = Number(value);
  return Number.isSafeInteger(seed) ? seed : DEFAULT_SEED;
}

export function parseScenarioRuntimeOptions(search = '') {
  const params = toSearchParams(search);
  const requestedMode = params.get('scenarioMode');
  const legacyFixture = params.get('r7Fixture') === '1';
  const scenarioMode = SUPPORTED_SCENARIO_MODES.includes(requestedMode)
    ? requestedMode
    : (legacyFixture ? 'fixture' : 'live');
  const fleetSize = parseFleetSize(params.get('fleetSize'));
  const seed = parseSeed(params.get('seed'));
  const requestedLiveProfile = params.get('liveProfile');
  const liveProfile = SUPPORTED_LIVE_PROFILES.includes(requestedLiveProfile)
    ? requestedLiveProfile
    : 'generic';

  return Object.freeze({
    fleetSize,
    seed,
    scenarioMode,
    liveProfile,
    executionSource: scenarioMode === 'live' ? 'hakoniwa-core' : 'browser-standalone',
    displayLabel: scenarioMode === 'live'
      ? LIVE_PROFILE_LABELS[liveProfile]
      : MODE_LABELS[scenarioMode],
    isFixture: scenarioMode === 'fixture',
    isReplay: scenarioMode === 'replay',
    isLive: scenarioMode === 'live',
  });
}
