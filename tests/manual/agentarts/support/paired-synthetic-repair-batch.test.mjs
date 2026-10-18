import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runPairedSyntheticRepairBatch} from './paired-synthetic-repair-batch.mjs';
import {buildFixedSyntheticRepairCases} from './fixed-synthetic-repair-cases.mjs';
import {appendVersion, currentNodes} from '@personal-agent/goals';

const options = () => ({deadline: new Date(Date.now() + 10_000).toISOString(), signal: new AbortController().signal});
const cases = buildFixedSyntheticRepairCases();
function port(variant, calls, choose = item => item.candidates.correct) {
  return {async execute(request) {
    calls.push({variant, request});
    return structuredClone(choose(cases.find(item => item.goal === request.goal), request));
  }};
}
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => {resolve = yes;});
  return {promise, resolve};
};

test('compares complete fixed repair batches without sending evaluator expectations', async () => {
  const calls = [], input = options();
  const result = await runPairedSyntheticRepairBatch({candidate: port('candidate', calls),
    baseline: port('baseline', calls, item => item.candidates.wrongDependency)}, input);
  assert.equal(result.requestedPairs, 1);
  assert.equal(result.completedPairs, 1);
  assert.equal(result.stopReason, null);
  assert.deepEqual(result.pairedRepairQuality, {total: 3, candidateCorrect: 3, baselineCorrect: 0,
    candidateAccuracy: 1, baselineAccuracy: 0, accuracyDelta: 1});
  assert.deepEqual(calls.map(item => item.variant), ['candidate', 'candidate', 'candidate', 'baseline', 'baseline', 'baseline']);
  assert.equal(new Set(calls.map(item => item.request.taskId)).size, 6);
  for (const {request} of calls) {
    assert.equal(request.deadline, input.deadline);
    assert.equal(request.revision, 1);
    assert.deepEqual(Object.keys(request), ['taskId', 'revision', 'goal', 'deadline', 'signal']);
    const fixture = cases.find(item => item.goal === request.goal);
    assert.ok(fixture);
    assert.equal(request.goal.includes(JSON.stringify(fixture.expected)), false);
    assert.doesNotMatch(request.goal, /requestedSummary|nextSummary|expectedCandidate/);
  }
  assert.ok(Number.isInteger(result.durationMs) && result.durationMs >= 0);
  assert.ok(result.pairs.every(item => Number.isInteger(item.candidateDurationMs) && item.candidateDurationMs >= 0
    && Number.isInteger(item.baselineDurationMs) && item.baselineDurationMs >= 0));
  assert.doesNotMatch(JSON.stringify(result), /"goal"|"candidateVersion"|"expectedGraphRevision"|"changes"|traceId|tokens|evidenceRefs/);
  assert.equal(result.evaluationMode, 'proposal-only');
  assert.equal(result.pairedScopeQuality.candidate.correctlyRepaired, 6);
  assert.equal(result.pairedScopeQuality.baseline.unrepaired, 3);
});

test('both sides can fail differently without either becoming a successful comparison', async () => {
  const result = await runPairedSyntheticRepairBatch({candidate: port('candidate', [], item => item.candidates.nonMinimal),
    baseline: port('baseline', [], item => item.candidates.wrongSummary)}, options());
  assert.equal(result.completedPairs, 1);
  assert.equal(result.pairedRepairQuality.candidateAccuracy, 0);
  assert.equal(result.pairedRepairQuality.baselineAccuracy, 0);
  assert.equal(result.pairedRepairQuality.accuracyDelta, 0);
  assert.ok(result.batches[0].result.cases.every(item => item.status === 'failed' && !item.checks.nodeSet));
  assert.ok(result.batches[1].result.cases.every(item => item.status === 'failed' && !item.checks.summaries));
  assert.equal(result.pairedScopeQuality.candidate.unrelated, 3);
  assert.equal(result.pairedScopeQuality.candidate.missed, 0);
  assert.equal(result.pairedScopeQuality.baseline.unrelated, 0);
  assert.equal(result.pairedScopeQuality.baseline.unrepaired, 3);
});

test('ordinary errors remain in complete paired denominators and never disclose provider messages', async () => {
  let index = 0;
  const candidate = {async execute(request) {
    if (index++ === 0) throw new Error('private-paired-provider-canary');
    return structuredClone(cases.find(item => item.goal === request.goal).candidates.correct);
  }};
  const result = await runPairedSyntheticRepairBatch({candidate, baseline: port('baseline', [])}, options());
  assert.equal(result.completedPairs, 1);
  assert.equal(result.pairedRepairQuality.total, 3);
  assert.equal(result.pairedRepairQuality.candidateAccuracy, 2 / 3);
  assert.equal(result.pairedRepairQuality.baselineAccuracy, 1);
  assert.equal(result.pairs[0].candidateErrors, 1);
  assert.equal(result.batches[0].result.counts.attempted, 3);
  assert.doesNotMatch(JSON.stringify(result), /private-paired-provider-canary/);
});

test('three bounded pairs alternate batch order, serialize requests and capture the original execute methods', async () => {
  const calls = [];
  let active = 0, maximumActive = 0;
  const make = variant => {
    const result = {async execute(request) {
      assert.equal(this, result);
      active++; maximumActive = Math.max(maximumActive, active);
      result.execute = () => {throw new Error('replacement must not run');};
      await new Promise(resolve => setImmediate(resolve));
      active--;
      calls.push({variant, request});
      return structuredClone(cases.find(item => item.goal === request.goal).candidates.correct);
    }};
    return result;
  };
  const result = await runPairedSyntheticRepairBatch({candidate: make('candidate'), baseline: make('baseline')}, {...options(), repetitions: 3});
  assert.equal(maximumActive, 1);
  assert.equal(calls.length, 18);
  assert.equal(new Set(calls.map(item => item.request.taskId)).size, 18);
  assert.deepEqual(result.batches.map(item => item.variant), ['candidate', 'baseline', 'baseline', 'candidate', 'candidate', 'baseline']);
  assert.equal(result.completedPairs, 3);
  assert.deepEqual(result.pairedRepairQuality, {total: 9, candidateCorrect: 9, baselineCorrect: 9,
    candidateAccuracy: 1, baselineAccuracy: 1, accuracyDelta: 0});
});

test('caller cancellation preserves the completed first batch and excludes the unfinished other side', async () => {
  const caller = new AbortController(), ready = deferred(), late = deferred();
  let baselineCalls = 0;
  const pending = runPairedSyntheticRepairBatch({candidate: port('candidate', []), baseline: {execute() {
    baselineCalls++; ready.resolve(); return late.promise;
  }}}, {...options(), signal: caller.signal, repetitions: 3});
  const terminal = pending.then(result => result);
  await Promise.race([ready.promise, terminal]);
  caller.abort();
  const result = await terminal;
  assert.equal(result.stopReason, 'CANCELLED');
  assert.equal(baselineCalls, 1);
  assert.equal(result.batches.length, 2);
  assert.equal(result.batches[0].result.counts.passed, 3);
  assert.deepEqual(result.batches[1].result.counts, {total: 3, attempted: 1, passed: 0, failed: 0, error: 1, notRun: 2});
  assert.equal(result.completedPairs, 0);
  assert.equal(result.pairedRepairQuality.total, 0);
  assert.equal(result.pairedRepairQuality.candidateAccuracy, null);
  assert.equal(result.pairedRepairQuality.baselineAccuracy, null);
  assert.equal(result.pairedRepairQuality.accuracyDelta, null);
  const snapshot = structuredClone(result);
  late.resolve(cases[0].candidates.correct);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result, snapshot);
});

test('both sides share one original deadline even when each would fit its own renewed budget', async () => {
  const originalNow = Date.now;
  let now = originalNow(), calls = 0;
  Date.now = () => now;
  try {
    const deadline = new Date(now + 250).toISOString();
    const make = () => ({async execute(request) {
      assert.equal(request.deadline, deadline);
      calls++; now += 50;
      return structuredClone(cases.find(item => item.goal === request.goal).candidates.correct);
    }});
    const result = await runPairedSyntheticRepairBatch({candidate: make(), baseline: make()},
      {deadline, signal: new AbortController().signal, repetitions: 3});
    assert.equal(calls, 5);
    assert.equal(result.stopReason, 'TIMEOUT');
    assert.equal(result.batches[0].result.counts.passed, 3);
    assert.deepEqual(result.batches[1].result.counts, {total: 3, attempted: 2, passed: 1, failed: 0, error: 1, notRun: 1});
    assert.equal(result.completedPairs, 0);
    assert.equal(result.pairedRepairQuality.candidateAccuracy, null);
    assert.equal(result.pairedRepairQuality.baselineAccuracy, null);
  } finally { Date.now = originalNow; }
});

test('pre-cancelled callers perform no batches and invalid bounded options call neither port', async () => {
  let calls = 0;
  const p = {execute() {calls++; throw new Error('must not run');}}, caller = new AbortController();
  caller.abort();
  const cancelled = await runPairedSyntheticRepairBatch({candidate: p, baseline: p}, {...options(), signal: caller.signal});
  assert.equal(cancelled.stopReason, 'CANCELLED');
  assert.deepEqual(cancelled.batches, []);
  assert.equal(cancelled.completedPairs, 0);
  assert.equal(cancelled.pairedRepairQuality.candidateAccuracy, null);
  for (const repetitions of [0, 4, 1.5, '2']) {
    await assert.rejects(runPairedSyntheticRepairBatch({candidate: p, baseline: p}, {...options(), repetitions}), {code: 'INVALID_ARGUMENT'});
  }
  assert.equal(calls, 0);
});

test('importing the paired repair module performs no automatic network call', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {calls++; throw new Error('must not run');};
  try {
    const imported = await import(`./paired-synthetic-repair-batch.mjs?no-auto-call=${Date.now()}`);
    assert.equal(typeof imported.runPairedSyntheticRepairBatch, 'function');
    assert.equal(calls, 0);
  } finally {globalThis.fetch = original;}
});

test('paired local observations stay separate from the unchanged proposal accuracy', async () => {
  const reader = applied => ({read(request) {
    const fixture = cases.find(item => item.caseId === request.caseId);
    let after = fixture.snapshot;
    if (applied) for (const change of fixture.expected.changes) {
      const {revision, graphRevision, ...node} = currentNodes(after).find(node => node.id === change.node.id);
      after = appendVersion(after, after.revision, {...node, summary: change.summary,
        reason: change.reason, dependencies: change.dependencies});
    }
    return {taskId: request.taskId, before: fixture.snapshot, after};
  }});
  const result = await runPairedSyntheticRepairBatch({candidate: port('candidate', []), baseline: port('baseline', [])},
    {...options(), readbacks: {candidate: reader(true), baseline: reader(false)}});
  assert.equal(result.evaluationMode, 'local-readback');
  assert.equal(result.pairedRepairQuality.candidateAccuracy, 1);
  assert.equal(result.pairedRepairQuality.baselineAccuracy, 1);
  assert.equal(result.pairedReadbackQuality.candidate.counts.passed, 3);
  assert.equal(result.pairedReadbackQuality.baseline.counts.passed, 0);
  assert.equal(result.pairedReadbackQuality.baseline.counts.failed, 3);
  assert.equal(result.pairedReadbackQuality.baseline.scope.unrepaired, 6);
  assert.equal(result.verification, 'unverified');
});

test('paired readback mode requires both explicitly supplied readers before either model is called', async () => {
  let calls = 0;
  const p = {execute() {calls++;}};
  for (const readbacks of [undefined, null, {}, {candidate: {read() {}}},
    {candidate: {read() {}}, baseline: {}}, {candidate: {read() {}}, baseline: {read() {}}, extra: {}}]) {
    await assert.rejects(runPairedSyntheticRepairBatch({candidate: p, baseline: p},
      {...options(), readbacks}), {code: 'INVALID_ARGUMENT'});
  }
  assert.equal(calls, 0);
});

test('paired runs capture both local reader methods before the first observation', async () => {
  const reads = [];
  const readbacks = Object.fromEntries(['candidate', 'baseline'].map(variant => [variant, {read(request) {
    reads.push(variant);
    readbacks.candidate.read = readbacks.baseline.read = () => {throw Error('replacement must not run');};
    const fixture = cases.find(item => item.caseId === request.caseId);
    return {taskId: request.taskId, before: fixture.snapshot, after: fixture.snapshot};
  }}]));
  const result = await runPairedSyntheticRepairBatch({candidate: port('candidate', []), baseline: port('baseline', [])},
    {...options(), readbacks});
  assert.deepEqual(reads, ['candidate', 'candidate', 'candidate', 'baseline', 'baseline', 'baseline']);
  assert.equal(result.pairedReadbackQuality.candidate.counts.error, 0);
  assert.equal(result.pairedReadbackQuality.baseline.counts.error, 0);
});
