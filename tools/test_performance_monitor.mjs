import assert from 'node:assert/strict';
import {
  linearTrendPerMinute,
  parseBenchmarkOptions,
  percentile,
  summarizePerformanceData,
} from '../src/client/src/performance_monitor.mjs';

assert.equal(percentile([10, 20, 30, 40], 50), 25);
assert.equal(percentile([10, 20, 30, 40], 95), 38.5);
assert.equal(percentile([], 50), null);

const options = parseBenchmarkOptions(
  '?benchmarkMode=mapray-base&benchmarkWarmupSec=10&benchmarkDurationSec=30'
  + '&benchmarkAutoStart=1&benchmarkAutoDownload=1&benchmarkRunId=test-1',
);
assert.equal(options.enabled, true);
assert.equal(options.mode, 'mapray-base');
assert.equal(options.warmupSeconds, 10);
assert.equal(options.durationSeconds, 30);
assert.equal(options.autoStart, true);
assert.equal(options.autoDownload, true);
assert.equal(options.runId, 'test-1');

const samples = [
  { phase: 'warmup', elapsedMeasurementSeconds: 0, pageFps: 1, jsHeapUsedMb: 99 },
  { phase: 'measurement', elapsedMeasurementSeconds: 0, pageFps: 50, jsHeapUsedMb: 100 },
  { phase: 'measurement', elapsedMeasurementSeconds: 60, pageFps: 40, jsHeapUsedMb: 102 },
  { phase: 'measurement', elapsedMeasurementSeconds: 120, pageFps: 30, jsHeapUsedMb: 104 },
];
assert.equal(linearTrendPerMinute(samples.slice(1), 'jsHeapUsedMb'), 2);
const summary = summarizePerformanceData({
  samples,
  frameDurationsMs: [10, 20, 30, 40],
  longTasks: [{ durationMs: 55 }, { durationMs: 65 }],
});
assert.equal(summary.pageFps.median, 40);
assert.equal(summary.pageFps.p5, 31);
assert.equal(summary.longTasks.count, 2);
assert.equal(summary.longTasks.totalDurationMs, 120);
assert.equal(summary.jsHeapMb.trendMbPerMinute, 2);

console.log('performance monitor tests: PASSED');
