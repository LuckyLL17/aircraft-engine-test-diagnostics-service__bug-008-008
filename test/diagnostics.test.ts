import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseVibration } from '../src/domain/vibration/fuse.ts';
import { estimateRemainingLife } from '../src/domain/life/estimate.ts';
import { evaluatePerformance } from '../src/domain/performance/evaluate.ts';
import { replayTelemetry } from '../src/domain/timeline/replay.ts';
import { inferRootCauses } from '../src/domain/root-cause/infer.ts';

test('replay is deterministic and removes duplicate event ids', () => {
  const events = [
    { runId: 'run-1', eventId: 'b', sampleTimeMs: 2, receivedTimeMs: 4, sequence: 2, sensor: 'rpm', value: 900, unit: 'rpm' },
    { runId: 'run-1', eventId: 'a', sampleTimeMs: 1, receivedTimeMs: 3, sequence: 1, sensor: 'rpm', value: 800, unit: 'rpm' },
    { runId: 'run-1', eventId: 'b', sampleTimeMs: 2, receivedTimeMs: 4, sequence: 2, sensor: 'rpm', value: 900, unit: 'rpm' },
  ] as any;
  assert.deepEqual(replayTelemetry(events).map((item) => item.eventId), ['a', 'b']);
});

test('performance produces physical normalized indicators', () => {
  const result = evaluatePerformance({ rpm: 9_000, fuelFlowKgPerSecond: 2, compressorOutletPressureKpa: 900, turbineInletTemperatureK: 1_000, ambientPressureKpa: 101.3, ambientTemperatureK: 288, inletPressureKpa: 100, referenceRpm: 10_000, referenceTemperatureK: 288, referencePressureKpa: 101.3 });
  assert.ok(result.pressureRatio > 1);
  assert.ok(result.compressorEfficiency >= 0 && result.compressorEfficiency <= 1);
});

test('vibration evidence is grouped by correlated source', () => {
  const result = diagnoseVibration([
    { evidenceId: 'a', sensorId: 's1', sourceGroup: 'g1', windowStartMs: 0, windowEndMs: 100, feature: 'bearing-envelope', fault: 'bearing', likelihoodRatio: 4, amplitude: 2 },
    { evidenceId: 'b', sensorId: 's1', sourceGroup: 'g1', windowStartMs: 20, windowEndMs: 80, feature: 'broadband', fault: 'bearing', likelihoodRatio: 4, amplitude: 2 },
    { evidenceId: 'c', sensorId: 's2', sourceGroup: 'g2', windowStartMs: 200, windowEndMs: 300, feature: 'bearing-envelope', fault: 'bearing', likelihoodRatio: 3, amplitude: 2 },
  ]);
  assert.equal(result[0].evidenceIds.length, 2);
});

test('life estimate is reproducible for a fixed seed', () => {
  const input = { initialHealth: { compressorEfficiency: 0.95, turbineFlowCapacity: 0.96, bearingFriction: 0.02, hotSectionMargin: 0.9, elapsedHours: 100, version: 1 }, horizonHours: 10_000, samples: 100, seed: 42, meanDegradationPerHour: 0.0002, deviation: 0.00003, temperatureStress: 0.2, vibrationStress: 0.1, failureThreshold: 0.4, correlation: [[1, 0.3], [0.3, 1]] as [[number, number], [number, number]] };
  assert.deepEqual(estimateRemainingLife(input), estimateRemainingLife(input));
});

test('root cause inference ranks upstream causes with propagation delay and distance', () => {
  const result = inferRootCauses(
    [{ id: 'obs-1', node: 'symptom', observedAtMs: 1_000, score: 0.8, evidenceIds: ['e1'] }],
    [
      { from: 'near-root', to: 'symptom', weight: 0.9, delayMs: 10 },
      { from: 'far-root', to: 'middle', weight: 0.9, delayMs: 10 },
      { from: 'middle', to: 'symptom', weight: 0.9, delayMs: 10 },
    ],
  );

  assert.deepEqual(result.ranking.map((item) => item.node), ['near-root', 'far-root']);
  assert.deepEqual(result.ranking[0].paths, [['symptom', 'near-root']]);
  assert.deepEqual(result.ranking[1].paths, [['symptom', 'middle', 'far-root']]);
  assert.equal(result.rejectedCycles.length, 0);
});

test('root cause inference only rejects paths that enter a cycle', () => {
  const result = inferRootCauses(
    [{ id: 'obs-1', node: 'symptom', observedAtMs: 1_000, score: 0.8, evidenceIds: ['e1'] }],
    [
      { from: 'cycle-a', to: 'cycle-b', weight: 0.9, delayMs: 1 },
      { from: 'cycle-b', to: 'cycle-a', weight: 0.9, delayMs: 1 },
      { from: 'cycle-a', to: 'symptom', weight: 0.9, delayMs: 1 },
      { from: 'valid-root', to: 'symptom', weight: 0.5, delayMs: 1 },
    ],
  );

  assert.deepEqual(result.ranking.map((item) => item.node), ['valid-root']);
  assert.deepEqual(result.ranking[0].paths, [['symptom', 'valid-root']]);
  assert.deepEqual(result.rejectedCycles, [['symptom', 'cycle-a', 'cycle-b', 'cycle-a']]);
});

test('root cause inference merges multiple observations under one stable upstream cause', () => {
  const result = inferRootCauses(
    [
      { id: 'obs-1', node: 'symptom-a', observedAtMs: 1_000, score: 0.8, evidenceIds: ['e1'] },
      { id: 'obs-2', node: 'symptom-b', observedAtMs: 1_200, score: 0.6, evidenceIds: ['e2'] },
    ],
    [
      { from: 'root', to: 'symptom-a', weight: 0.8, delayMs: 10 },
      { from: 'root', to: 'symptom-b', weight: 0.8, delayMs: 10 },
    ],
  );

  assert.deepEqual(result.ranking.map((item) => item.node), ['root']);
  assert.equal(result.ranking[0].paths.length, 2);
  assert.deepEqual(result.ranking[0].paths, [['symptom-a', 'root'], ['symptom-b', 'root']]);
});

test('root cause inference does not rank a source-less observation as its own cause', () => {
  const result = inferRootCauses(
    [{ id: 'obs-1', node: 'symptom', observedAtMs: 1_000, score: 0.8, evidenceIds: ['e1'] }],
    [],
  );

  assert.deepEqual(result.ranking, []);
});
