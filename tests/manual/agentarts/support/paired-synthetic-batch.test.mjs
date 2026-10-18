import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPairedSyntheticBatch} from './paired-synthetic-batch.mjs';

const labels = ['RECHECK', 'KEEP', 'REJECT'];
const options = () => ({deadline: new Date(Date.now() + 10_000).toISOString(), signal: new AbortController().signal});
function port(variant, calls, replies = labels) {
  let index = 0;
  return {async execute(request) {
    calls.push({variant, request});
    return {kind: 'text', text: replies[index++ % 3], verification: 'mock'};
  }};
}

test('defaults to one sequential paired batch using the existing strict classifications', async () => {
  const calls = [];
  const input = options();
  const result = await runPairedSyntheticBatch({candidate: port('candidate', calls),
    baseline: port('baseline', calls, ['RECHECK', 'KEEP with private explanation', 'REJECT'])}, input);
  assert.equal(result.requestedPairs, 1);
  assert.equal(result.completedPairs, 1);
  assert.equal(result.stopReason, null);
  assert.deepEqual(calls.map(call => call.variant), ['candidate', 'candidate', 'candidate', 'baseline', 'baseline', 'baseline']);
  assert.equal(new Set(calls.map(call => call.request.taskId)).size, 6);
  assert.ok(calls.every(call => call.request.deadline === input.deadline && call.request.revision === 1));
  assert.deepEqual(result.pairedClassification, {total: 3, candidateCorrect: 3, baselineCorrect: 2,
    candidateAccuracy: 1, baselineAccuracy: 2 / 3, accuracyDelta: 1 / 3});
  assert.equal(result.batches.length, 2);
  assert.ok(result.pairs.every(pair => Number.isInteger(pair.candidateDurationMs) && pair.candidateDurationMs >= 0
    && Number.isInteger(pair.baselineDurationMs) && pair.baselineDurationMs >= 0));
  assert.ok(Number.isInteger(result.durationMs) && result.durationMs >= 0);
  assert.doesNotMatch(JSON.stringify(result), /private explanation|traceId|totalTokens|evidenceRefs|roleConformance/);
});

test('three repetitions alternate first port, await one exchange at a time, and preserve all actual batches', async () => {
  const calls = [];
  let active = 0, maximumActive = 0;
  const makePort = variant => {
    const original = port(variant, calls);
    return {async execute(request) {
      active++; maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--; return original.execute(request);
    }};
  };
  const result = await runPairedSyntheticBatch({candidate: makePort('candidate'), baseline: makePort('baseline')},
    {...options(), repetitions: 3});
  assert.equal(maximumActive, 1);
  assert.equal(result.completedPairs, 3);
  assert.equal(result.batches.length, 6);
  assert.equal(calls.length, 18);
  assert.equal(new Set(calls.map(call => call.request.taskId)).size, 18);
  assert.deepEqual(result.batches.map(batch => batch.variant), ['candidate', 'baseline', 'baseline', 'candidate', 'candidate', 'baseline']);
  assert.deepEqual(result.pairedClassification, {total: 9, candidateCorrect: 9, baselineCorrect: 9,
    candidateAccuracy: 1, baselineAccuracy: 1, accuracyDelta: 0});
  assert.ok(result.durationMs >= 50);
  assert.ok(result.batches.every(batch => batch.result.durationMs >= 10));
});

test('ordinary provider failures retain fixed batch errors and continue the other port and repetitions', async () => {
  const calls = [];
  const candidate = port('candidate', calls);
  const original = candidate.execute;
  let index = 0;
  candidate.execute = async request => {
    const result = await original.call(candidate, request);
    if (index++ === 0) throw Error('private-provider-canary');
    return result;
  };
  const result = await runPairedSyntheticBatch({candidate, baseline: port('baseline', calls)}, {...options(), repetitions: 2});
  assert.equal(calls.length, 12);
  assert.equal(result.completedPairs, 2);
  assert.equal(result.batches[0].result.cases[0].errorCode, 'EXTERNAL_FAILURE');
  assert.equal(result.pairedClassification.candidateCorrect, 5);
  assert.equal(result.pairedClassification.baselineCorrect, 6);
  assert.doesNotMatch(JSON.stringify(result), /private-provider-canary/);
});

test('caller cancellation stops an uncooperative batch and excludes incomplete pairs', {timeout: 5000}, async () => {
  const controller = new AbortController();
  let arrive, release, calls = 0, baselineCalls = 0;
  const ready = new Promise(resolve => {arrive = resolve;});
  const pending = runPairedSyntheticBatch({candidate: {execute() {
    calls++; arrive(); return new Promise(resolve => {release = resolve;});
  }}, baseline: {execute() {baselineCalls++; throw Error('must not invoke');}}},
  {...options(), signal: controller.signal, repetitions: 3});
  await ready; controller.abort();
  const result = await pending;
  assert.equal(result.stopReason, 'CANCELLED');
  assert.equal(result.completedPairs, 0);
  assert.equal(result.batches.length, 1);
  assert.deepEqual(result.batches[0].result.counts, {total: 3, passed: 0, failed: 0, error: 1, notRun: 2});
  assert.equal(result.pairedClassification.candidateAccuracy, null);
  assert.equal(result.pairedClassification.accuracyDelta, null);
  release({kind: 'text', text: 'RECHECK', verification: 'mock'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(baselineCalls, 0);
  assert.equal(result.batches.length, 1);
});

test('one original deadline stops a noncooperative port without starting a baseline or another pair', {timeout: 5000}, async () => {
  let calls = 0, baselineCalls = 0, arrive;
  const ready = new Promise(resolve => {arrive = resolve;});
  const pending = runPairedSyntheticBatch({candidate: {execute() {calls++; arrive(); return new Promise(() => {});}},
    baseline: {execute() {baselineCalls++; throw Error('must not invoke');}}},
  {...options(), deadline: new Date(Date.now() + 400).toISOString(), repetitions: 3});
  await Promise.race([ready, pending]);
  const result = await pending;
  assert.equal(result.stopReason, 'TIMEOUT');
  assert.equal(result.completedPairs, 0);
  assert.ok(calls <= 1); assert.equal(baselineCalls, 0);
  assert.ok(result.batches.length <= 1);
  if (result.batches.length) assert.equal(result.batches[0].result.cases[0].errorCode, 'TIMEOUT');
});

test('captures both port methods and original options before awaiting the first batch', async () => {
  const calls = [];
  const input = {...options(), repetitions: 2};
  const originalDeadline = input.deadline;
  const baseline = port('baseline', calls);
  const candidate = port('candidate', calls);
  const execute = candidate.execute;
  candidate.execute = async request => {
    input.deadline = new Date(0).toISOString(); input.signal = new AbortController().signal; input.repetitions = 3;
    baseline.execute = () => {throw Error('replacement-private-canary');};
    return execute.call(candidate, request);
  };
  const result = await runPairedSyntheticBatch({candidate, baseline}, input);
  assert.equal(result.completedPairs, 2);
  assert.equal(calls.length, 12);
  assert.ok(calls.every(call => call.request.deadline === originalDeadline));
  assert.doesNotMatch(JSON.stringify(result), /replacement-private-canary/);
});

test('rejects absent ports, noncanonical deadlines and repetitions outside 1..3 before any call', async () => {
  let calls = 0, getterCalls = 0;
  const source = {execute() {calls++; throw Error('must not invoke');}};
  const ports = {candidate: source, baseline: source};
  for (const repetitions of [0, 4, 1.5, '2', null]) {
    await assert.rejects(runPairedSyntheticBatch(ports, {...options(), repetitions}), {code: 'INVALID_ARGUMENT'});
  }
  for (const deadline of ['2026-02-30T00:00:00.000Z', '2030-01-01T00:00:00+00:00', '2000-01-01T00:00:00.000Z']) {
    await assert.rejects(runPairedSyntheticBatch(ports, {...options(), deadline}), {code: 'INVALID_ARGUMENT'});
  }
  await assert.rejects(runPairedSyntheticBatch({candidate: source}, options()), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(runPairedSyntheticBatch({...ports, baseline: {}}, options()), {code: 'INVALID_ARGUMENT'});
  const hostile = Object.defineProperty(options(), 'repetitions', {enumerable: true, get() {getterCalls++; throw Error('private-getter-canary');}});
  await assert.rejects(runPairedSyntheticBatch(ports, hostile), error => error.code === 'INVALID_ARGUMENT'
    && !error.message.includes('private-getter-canary'));
  assert.equal(calls, 0); assert.equal(getterCalls, 0);
});

test('an already cancelled caller has no attempted batches or invented paired scores', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const source = {execute() {calls++; throw Error('must not invoke');}};
  const result = await runPairedSyntheticBatch({candidate: source, baseline: source}, {...options(), signal: controller.signal});
  assert.equal(result.stopReason, 'CANCELLED'); assert.equal(result.completedPairs, 0);
  assert.deepEqual(result.batches, []); assert.deepEqual(result.pairs, []);
  assert.equal(result.pairedClassification.total, 0); assert.equal(result.pairedClassification.accuracyDelta, null);
  assert.equal(calls, 0);
});
