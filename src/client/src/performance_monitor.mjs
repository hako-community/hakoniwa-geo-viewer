export const PERFORMANCE_MONITOR_VERSION = 1;
export const PERFORMANCE_REPORT_SCHEMA_VERSION = 1;
export const SUPPORTED_BENCHMARK_MODES = Object.freeze([
  'mapray-full',
  'mapray-base',
  'leaflet-fallback',
]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function safeClone(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { error: 'diagnostics-not-serializable' };
  }
}

export function percentile(values, percent) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.max(0, Math.min(1, Number(percent) / 100)) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function linearTrendPerMinute(samples, valueKey) {
  const points = samples
    .map((sample) => ({ x: Number(sample.elapsedMeasurementSeconds), y: Number(sample[valueKey]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  return denominator > 0 ? numerator / denominator * 60 : null;
}

export function summarizePerformanceData({ samples = [], frameDurationsMs = [], longTasks = [] } = {}) {
  const measurementSamples = samples.filter((sample) => sample.phase === 'measurement');
  const fpsValues = measurementSamples.map((sample) => sample.pageFps).filter(Number.isFinite);
  const heapSamples = measurementSamples.filter((sample) => Number.isFinite(sample.jsHeapUsedMb));
  const heapValues = heapSamples.map((sample) => sample.jsHeapUsedMb);
  return {
    pageFps: {
      median: round(percentile(fpsValues, 50)),
      p5: round(percentile(fpsValues, 5)),
      minimum: round(percentile(fpsValues, 0)),
    },
    frameTimeMs: {
      median: round(percentile(frameDurationsMs, 50)),
      p95: round(percentile(frameDurationsMs, 95)),
      p99: round(percentile(frameDurationsMs, 99)),
      maximum: round(percentile(frameDurationsMs, 100)),
    },
    longTasks: {
      count: longTasks.length,
      totalDurationMs: round(longTasks.reduce((sum, task) => sum + finiteNumber(task.durationMs), 0)),
      maximumDurationMs: round(percentile(longTasks.map((task) => task.durationMs), 100)),
    },
    jsHeapMb: {
      available: heapValues.length > 0,
      initial: round(heapValues[0]),
      final: round(heapValues.at(-1)),
      maximum: round(percentile(heapValues, 100)),
      trendMbPerMinute: round(linearTrendPerMinute(heapSamples, 'jsHeapUsedMb')),
    },
  };
}

export function parseBenchmarkOptions(search = '') {
  const text = String(search ?? '');
  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(text.startsWith('?') ? text.slice(1) : text);
  const requestedMode = params.get('benchmarkMode');
  return Object.freeze({
    enabled: params.has('benchmarkMode') || params.get('benchmarkAutoStart') === '1',
    mode: SUPPORTED_BENCHMARK_MODES.includes(requestedMode) ? requestedMode : 'mapray-full',
    warmupSeconds: clampInteger(params.get('benchmarkWarmupSec'), 0, 600, 120),
    durationSeconds: clampInteger(params.get('benchmarkDurationSec'), 10, 3_600, 600),
    autoStart: params.get('benchmarkAutoStart') === '1',
    autoDownload: params.get('benchmarkAutoDownload') === '1',
    runId: String(params.get('benchmarkRunId') || '').trim() || null,
  });
}

function browserEnvironment() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.userAgentData?.platform || navigator.platform || null,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGb: navigator.deviceMemory ?? null,
    screen: {
      width: window.screen?.width ?? null,
      height: window.screen?.height ?? null,
      colorDepth: window.screen?.colorDepth ?? null,
      devicePixelRatio: window.devicePixelRatio,
    },
  };
}

export function downloadPerformanceReport(report, filename = null) {
  if (!report) return false;
  const safeRunId = String(report.config?.runId || report.startedAt || 'run')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-');
  const outputName = filename || `mapray-operations-benchmark-${safeRunId}.json`;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = outputName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}

export class BrowserPerformanceMonitor {
  constructor({ diagnosticsProvider = null, onUpdate = null, onComplete = null } = {}) {
    this.diagnosticsProvider = typeof diagnosticsProvider === 'function' ? diagnosticsProvider : null;
    this.onUpdate = typeof onUpdate === 'function' ? onUpdate : null;
    this.onComplete = typeof onComplete === 'function' ? onComplete : null;
    this.state = 'idle';
    this.latestReport = null;
    this.milestones = [];
    this._boundError = (event) => this._recordError('error', event?.message || 'unknown error');
    this._boundRejection = (event) => this._recordError(
      'unhandledrejection', event?.reason?.message || String(event?.reason || 'unknown rejection'),
    );
    this._boundContextLost = () => this._recordError('webglcontextlost', 'WebGL context lost');
  }

  markMilestone(name, detail = null) {
    this.milestones.push({
      name: String(name),
      navigationElapsedMs: round(performance.now()),
      at: new Date().toISOString(),
      detail: safeClone(detail),
    });
  }

  _recordError(type, message) {
    if (!this._errors) return;
    this._errors.push({
      type,
      message: String(message),
      measurementElapsedSeconds: round((performance.now() - this._measurementStartedAt) / 1_000),
      at: new Date().toISOString(),
    });
  }

  start({ warmupSeconds = 120, durationSeconds = 600, metadata = {}, runId = null } = {}) {
    if (this.state === 'running') throw new Error('[PerformanceMonitor] measurement is already running');
    const now = performance.now();
    this.state = 'running';
    this.latestReport = null;
    this._config = {
      warmupSeconds: clampInteger(warmupSeconds, 0, 600, 120),
      durationSeconds: clampInteger(durationSeconds, 10, 3_600, 600),
      runId: runId || `run-${Date.now()}`,
    };
    this._metadata = safeClone(metadata) || {};
    this._startedAt = now;
    this._measurementStartedAt = now + this._config.warmupSeconds * 1_000;
    this._deadline = this._measurementStartedAt + this._config.durationSeconds * 1_000;
    this._lastFrameAt = null;
    this._lastSampleAt = now;
    this._framesSinceSample = 0;
    this._samples = [];
    this._frameDurationsMs = [];
    this._longTasks = [];
    this._errors = [];

    window.addEventListener('error', this._boundError);
    window.addEventListener('unhandledrejection', this._boundRejection);
    document.addEventListener('webglcontextlost', this._boundContextLost, true);
    if (typeof PerformanceObserver === 'function') {
      try {
        this._longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.startTime < this._measurementStartedAt) continue;
            this._longTasks.push({
              startTimeMs: round(entry.startTime),
              durationMs: round(entry.duration),
            });
          }
        });
        this._longTaskObserver.observe({ type: 'longtask', buffered: true });
      } catch {
        this._longTaskObserver = null;
      }
    }

    const frame = (timestamp) => {
      if (this.state !== 'running') return;
      if (this._lastFrameAt != null) {
        const duration = timestamp - this._lastFrameAt;
        if (timestamp >= this._measurementStartedAt && this._frameDurationsMs.length < 250_000) {
          this._frameDurationsMs.push(duration);
        }
      }
      this._lastFrameAt = timestamp;
      this._framesSinceSample += 1;
      this._rafId = requestAnimationFrame(frame);
    };
    this._rafId = requestAnimationFrame(frame);
    this._sampleTimer = setInterval(() => this._sample(), 1_000);
    this.markMilestone('benchmark-start', this._config);
    this._sample();
    return this._config;
  }

  _sample() {
    if (this.state !== 'running') return;
    const now = performance.now();
    const intervalSeconds = Math.max(0.001, (now - this._lastSampleAt) / 1_000);
    const phase = now < this._measurementStartedAt ? 'warmup' : 'measurement';
    let diagnostics = null;
    try {
      diagnostics = safeClone(this.diagnosticsProvider?.());
    } catch (error) {
      diagnostics = { error: String(error?.message || error) };
    }
    const memory = performance.memory;
    const sample = {
      phase,
      elapsedTotalSeconds: round((now - this._startedAt) / 1_000),
      elapsedMeasurementSeconds: round(Math.max(0, now - this._measurementStartedAt) / 1_000),
      pageFps: round(this._framesSinceSample / intervalSeconds),
      jsHeapUsedMb: memory ? round(memory.usedJSHeapSize / 1_048_576) : null,
      jsHeapTotalMb: memory ? round(memory.totalJSHeapSize / 1_048_576) : null,
      jsHeapLimitMb: memory ? round(memory.jsHeapSizeLimit / 1_048_576) : null,
      diagnostics,
    };
    this._samples.push(sample);
    this._framesSinceSample = 0;
    this._lastSampleAt = now;
    this.onUpdate?.(safeClone(sample));
    if (now >= this._deadline) this.stop('duration-complete');
  }

  stop(reason = 'manual') {
    if (this.state !== 'running') return this.latestReport;
    this.state = 'stopped';
    clearInterval(this._sampleTimer);
    cancelAnimationFrame(this._rafId);
    this._longTaskObserver?.disconnect();
    window.removeEventListener('error', this._boundError);
    window.removeEventListener('unhandledrejection', this._boundRejection);
    document.removeEventListener('webglcontextlost', this._boundContextLost, true);
    const endedAt = performance.now();
    const report = {
      schemaVersion: PERFORMANCE_REPORT_SCHEMA_VERSION,
      measurementKind: 'actual-browser',
      estimated: false,
      startedAt: new Date(performance.timeOrigin + this._startedAt).toISOString(),
      endedAt: new Date(performance.timeOrigin + endedAt).toISOString(),
      stopReason: reason,
      config: this._config,
      metadata: this._metadata,
      environment: browserEnvironment(),
      milestones: safeClone(this.milestones),
      summary: summarizePerformanceData({
        samples: this._samples,
        frameDurationsMs: this._frameDurationsMs,
        longTasks: this._longTasks,
      }),
      stability: {
        uncaughtErrorCount: this._errors.filter((error) => error.type === 'error').length,
        unhandledRejectionCount: this._errors.filter((error) => error.type === 'unhandledrejection').length,
        webglContextLostCount: this._errors.filter((error) => error.type === 'webglcontextlost').length,
      },
      errors: safeClone(this._errors),
      longTasks: safeClone(this._longTasks),
      samples: safeClone(this._samples),
    };
    this.latestReport = report;
    this.onComplete?.(safeClone(report));
    return report;
  }
}
