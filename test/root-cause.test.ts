import test from 'node:test';
import assert from 'node:assert/strict';
import { inferRootCauses } from '../src/domain/root-cause/infer.ts';
import type { CausalEdge, CausalObservation } from '../src/domain/types.ts';

function observation(node: string, score = 1, id = node): CausalObservation {
  return { id, node, observedAtMs: 1000, score, evidenceIds: [`${id}-evidence`] };
}

test('ranks upstream root causes instead of downstream observed symptoms', () => {
  const edges: CausalEdge[] = [
    { from: 'fuel-pump', to: 'fuel-flow', weight: 0.9, delayMs: 100 },
    { from: 'fuel-flow', to: 'flameout', weight: 0.9, delayMs: 100 },
  ];

  const result = inferRootCauses([observation('flameout')], edges);

  assert.deepEqual(result.ranking.map((item) => item.node), ['fuel-pump']);
  assert.deepEqual(result.ranking[0].paths, [['flameout', 'fuel-flow', 'fuel-pump']]);
  assert.ok(result.ranking[0].score > 0);
});

test('edge weight, propagation distance, and cumulative delay all affect path score', () => {
  const direct = inferRootCauses(
    [observation('symptom-direct')],
    [{ from: 'direct-root', to: 'symptom-direct', weight: 0.5, delayMs: 0 }],
  ).ranking[0];

  const distant = inferRootCauses(
    [observation('symptom-distant')],
    [
      { from: 'distant-root', to: 'intermediate', weight: 0.5, delayMs: 0 },
      { from: 'intermediate', to: 'symptom-distant', weight: 1, delayMs: 0 },
    ],
  ).ranking[0];

  const delayed = inferRootCauses(
    [observation('symptom-delayed')],
    [{ from: 'delayed-root', to: 'symptom-delayed', weight: 0.5, delayMs: 1000 }],
  ).ranking[0];
  const weak = inferRootCauses(
    [observation('symptom-weak')],
    [{ from: 'weak-root', to: 'symptom-weak', weight: 0.3, delayMs: 0 }],
  ).ranking[0];

  assert.ok(direct.score > distant.score);
  assert.ok(direct.score > delayed.score);
  assert.ok(direct.score > weak.score);
});

test('rejects only the cyclic branch while retaining legal upstream paths', () => {
  const edges: CausalEdge[] = [
    { from: 'bearing', to: 'vibration', weight: 0.8, delayMs: 50 },
    { from: 'feedback', to: 'vibration', weight: 0.7, delayMs: 50 },
    { from: 'vibration', to: 'feedback', weight: 0.6, delayMs: 50 },
    { from: 'lubrication', to: 'bearing', weight: 0.9, delayMs: 50 },
  ];

  const result = inferRootCauses([observation('vibration')], edges);

  assert.deepEqual(result.ranking.map((item) => item.node), ['lubrication']);
  assert.deepEqual(result.ranking[0].paths, [['vibration', 'bearing', 'lubrication']]);
  assert.deepEqual(result.rejectedCycles, [['vibration', 'feedback', 'vibration']]);
});

test('merges multiple observations converging on the same root cause stably', () => {
  const edges: CausalEdge[] = [
    { from: 'shaft-crack', to: 'vibration', weight: 0.8, delayMs: 10 },
    { from: 'shaft-crack', to: 'noise', weight: 0.7, delayMs: 20 },
  ];
  const observations = [observation('vibration', 0.9, 'obs-vibration'), observation('noise', 0.8, 'obs-noise')];

  const result = inferRootCauses(observations, edges);
  const repeated = inferRootCauses(observations, edges);

  assert.equal(result.ranking.length, 1);
  assert.equal(result.ranking[0].node, 'shaft-crack');
  assert.deepEqual(result.ranking[0].paths, [
    ['vibration', 'shaft-crack'],
    ['noise', 'shaft-crack'],
  ]);
  assert.equal(result.ranking[0].score, repeated.ranking[0].score);
});
