/**
 * Phase R6 Incident Scenario Logic.
 * Manages disturbance injection (wind, rotor failure) and collision/anomaly scenario evaluation.
 */

export function createDisturbancePayload({ droneId = 0, wind = [0, 0, 0], rotorLoss = [0, 0, 0, 0] } = {}) {
  return {
    droneId: String(droneId),
    type: 'DISTURBANCE_INJECTION',
    timestamp: Date.now(),
    wind: {
      forceX: Number(wind[0] || 0),
      forceY: Number(wind[1] || 0),
      forceZ: Number(wind[2] || 0),
    },
    rotorLossRatio: rotorLoss.map(v => Math.max(0, Math.min(1, Number(v || 0)))),
  };
}

export class IncidentScenarioEvaluator {
  constructor({ scenarioId = 'shibuya-incident-e2e' } = {}) {
    this.scenarioId = scenarioId;
    this.injectedEvents = [];
    this.detectedIncidents = [];
  }

  injectDisturbance(payload) {
    this.injectedEvents.push(payload);
    return payload;
  }

  evaluateTelemetry(telemetryState) {
    const incidents = [];
    if (!telemetryState) return incidents;

    const droneId = String(telemetryState.droneId ?? 0);
    const collidedCounts = telemetryState.collidedCounts;

    // Check collision count increase
    if (collidedCounts && (collidedCounts.ground > 0 || collidedCounts.wall > 0 || collidedCounts.object > 0)) {
      const surfaceType = collidedCounts.ground > 0 ? 'ground' : (collidedCounts.wall > 0 ? 'wall' : 'object');
      const surfaceLabel = surfaceType === 'ground' ? '地面接触' : (surfaceType === 'wall' ? '建物壁接触' : '障害物接触');
      
      incidents.push({
        id: `incident-e2e-${droneId}-${Date.now()}`,
        droneId,
        type: 'COLLISION_EVENT',
        surfaceType,
        surfaceLabel,
        impactSpeedMps: Number(telemetryState.impactSpeed || 2.5),
        color: surfaceType === 'ground' ? [0.9, 0.5, 0.1] : [0.95, 0.15, 0.15],
        contactPositionRos: telemetryState.positionRos || [0, 0, 0],
        time: Date.now(),
        source: 'telemetry_evaluator',
      });
    }

    this.detectedIncidents.push(...incidents);
    return incidents;
  }

  getSummary() {
    return {
      scenarioId: this.scenarioId,
      injectedCount: this.injectedEvents.length,
      detectedCount: this.detectedIncidents.length,
      latestInjected: this.injectedEvents[this.injectedEvents.length - 1] || null,
      latestDetected: this.detectedIncidents[this.detectedIncidents.length - 1] || null,
    };
  }
}
