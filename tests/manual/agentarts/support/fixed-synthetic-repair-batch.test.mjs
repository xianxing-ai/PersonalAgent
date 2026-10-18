import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {runFixedSyntheticRepairBatch} from './fixed-synthetic-repair-batch.mjs';
import {buildFixedSyntheticRepairCases} from './fixed-synthetic-repair-cases.mjs';
import {appendVersion, currentNodes} from '@personal-agent/goals';

const options = () => ({deadline: new Date(Date.now() + 10_000).toISOString(),
  signal: new AbortController().signal});
function port(replies, requests = []) {
  let index = 0;
  return {async execute(request) {
    requests.push(request);
    return structuredClone(replies[index++ % replies.length]);
  }};
}
const fixtures = () => buildFixedSyntheticRepairCases();
const correct = () => fixtures().map(item => item.candidates.correct);

test('three fixed legal repairs use only input goals, unique request IDs and the original deadline', async () => {
  const data = fixtures(), requests = [], input = options();
  const result = await runFixedSyntheticRepairBatch(port(correct(), requests), input);
  assert.deepEqual(requests.map(item => item.goal), data.map(item => item.goal));
  assert.equal(new Set(requests.map(item => item.taskId)).size, 3);
  assert.ok(requests.every(item => item.revision === 1 && item.deadline === input.deadline));
  for (const [index, request] of requests.entries()) {
    assert.deepEqual(Object.keys(request), ['taskId', 'revision', 'goal', 'deadline', 'signal']);
    assert.equal(request.goal.includes(JSON.stringify(data[index].expected)), false);
    assert.doesNotMatch(request.goal, /requestedSummary|nextSummary|expectedCandidate|correct answer/i);
  }
  assert.deepEqual(result.counts, {total: 3, attempted: 3, passed: 3, failed: 0, error: 0, notRun: 0});
  assert.equal(result.accuracy, 1);
  assert.equal(result.stopReason, null);
  assert.equal(result.synthetic, true);
  assert.equal(result.verification, 'unverified');
  assert.equal(result.evaluationMode, 'proposal-only');
  assert.equal(result.readbackCounts.not_requested, 3);
  assert.equal(result.scopeSummary.correctlyRepaired, 6);
  assert.ok(result.cases.every(item => item.status === 'passed' && item.errorCode === 'NONE'));
});

test('wrong dependency, source version, scope, graph, summary and incomplete repairs fail independently', async () => {
  for (const variant of ['wrongDependency', 'wrongSourceVersion', 'nonMinimal',
    'staleGraph', 'wrongSummary', 'incomplete']) {
    const requests = [];
    const result = await runFixedSyntheticRepairBatch(port(fixtures().map(item => item.candidates[variant]), requests), options());
    assert.equal(requests.length, 3, variant);
    assert.deepEqual(result.counts, {total: 3, attempted: 3, passed: 0, failed: 3, error: 0, notRun: 0}, variant);
    assert.equal(result.accuracy, 0, variant);
    assert.ok(result.cases.every(item => item.status !== 'passed'), variant);
  }
});

test('new-revision dependencies need legal change order while independent nodes and dependencies may reorder', async () => {
  const replies = correct();
  replies[0].candidate.changes.reverse();
  replies[1].candidate.changes.reverse();
  for (const change of replies[1].candidate.changes) change.dependencies.reverse();
  const result = await runFixedSyntheticRepairBatch(port(replies), options());
  assert.equal(result.cases[0].status, 'failed');
  assert.equal(result.cases[0].checks.dependencyOrder, false);
  assert.equal(result.cases[1].status, 'passed');
  assert.equal(result.cases[2].status, 'passed');
});

test('different valid reason wording is accepted without exposing response, expected values or graph material', async () => {
  const replies = correct();
  for (const response of replies) {
    for (const change of response.candidate.changes) change.reason = 'private-response-canary';
  }
  const result = await runFixedSyntheticRepairBatch(port(replies), options());
  assert.equal(result.counts.passed, 3);
  assert.doesNotMatch(JSON.stringify(result), /private-response-canary|expectedGraphRevision|"dependencies":\s*\[|"summary"|"reason"|"snapshot"|traceId|totalTokens|evidenceRefs|taskId/);
  assert.deepEqual(Object.keys(result.cases[0]), ['caseId', 'runIndex', 'status', 'verification',
    'errorCode', 'checks', 'scope', 'readback', 'durationMs']);
});

test('non-repair kinds and invalid candidates never count as matched repairs', async () => {
  const replies = correct();
  replies[0] = {kind: 'text', text: 'private-reply-canary', verification: 'unverified'};
  replies[1].candidate.changes[0].evidenceRefs = ['forged'];
  const result = await runFixedSyntheticRepairBatch(port(replies), options());
  assert.deepEqual(result.counts, {total: 3, attempted: 3, passed: 1, failed: 1, error: 1, notRun: 0});
  assert.equal(result.cases[0].errorCode, 'RESULT_KIND_MISMATCH');
  assert.equal(result.cases[1].errorCode, 'INVALID_ARGUMENT');
  assert.equal(result.accuracy, 1 / 3);
  assert.doesNotMatch(JSON.stringify(result), /private-reply-canary|forged/);
});

test('three repetitions await one exchange at a time and capture the original port and options', async () => {
  const data = correct(), input = {...options(), repetitions: 3}, originalDeadline = input.deadline;
  const requests = [];
  let index = 0, active = 0, maximumActive = 0;
  const source = {async execute(request) {
    requests.push(request); active++; maximumActive = Math.max(maximumActive, active);
    input.deadline = new Date(0).toISOString(); input.signal = new AbortController().signal;
    input.repetitions = 1; source.execute = () => {throw Error('replacement-private-canary');};
    await new Promise(resolve => setTimeout(resolve, 5));
    active--; return data[index++ % 3];
  }};
  const result = await runFixedSyntheticRepairBatch(source, input);
  assert.equal(maximumActive, 1);
  assert.equal(requests.length, 9);
  assert.equal(new Set(requests.map(item => item.taskId)).size, 9);
  assert.ok(requests.every(item => item.deadline === originalDeadline));
  assert.deepEqual(result.cases.map(item => item.runIndex), [1, 1, 1, 2, 2, 2, 3, 3, 3]);
  assert.deepEqual(result.counts, {total: 9, attempted: 9, passed: 9, failed: 0, error: 0, notRun: 0});
  assert.ok(result.durationMs >= 35);
  assert.ok(result.cases.every(item => Number.isInteger(item.durationMs) && item.durationMs >= 0));
  assert.doesNotMatch(JSON.stringify(result), /replacement-private-canary/);
});

test('provider failures are fixed errors, retain attempted counts and continue without retry', async () => {
  const data = correct(); let calls = 0;
  const result = await runFixedSyntheticRepairBatch({execute() {
    if (calls++ === 0) throw Error('provider-private-canary');
    return data[calls - 1];
  }}, options());
  assert.equal(calls, 3);
  assert.deepEqual(result.counts, {total: 3, attempted: 3, passed: 2, failed: 0, error: 1, notRun: 0});
  assert.equal(result.cases[0].errorCode, 'EXTERNAL_FAILURE');
  assert.equal(result.accuracy, 2 / 3);
  assert.doesNotMatch(JSON.stringify(result), /provider-private-canary/);
});

test('caller cancellation stops non-cooperative execution and ignores a late correct candidate', {timeout: 5000}, async () => {
  const controller = new AbortController(); let calls = 0, arrive, release, seenSignal;
  const ready = new Promise(resolve => {arrive = resolve;});
  const pending = runFixedSyntheticRepairBatch({execute(request) {
    calls++; seenSignal = request.signal; arrive(); return new Promise(resolve => {release = resolve;});
  }}, {...options(), signal: controller.signal, repetitions: 3});
  await ready; controller.abort(); const result = await pending;
  assert.equal(calls, 1); assert.equal(seenSignal.aborted, true);
  assert.equal(result.stopReason, 'CANCELLED');
  assert.deepEqual(result.counts, {total: 9, attempted: 1, passed: 0, failed: 0, error: 1, notRun: 8});
  assert.equal(result.accuracy, 0);
  release(correct()[0]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.counts.passed, 0); assert.equal(result.cases.length, 1);
});

test('the original deadline bounds a non-cooperative port and never starts later cases', {timeout: 5000}, async () => {
  let calls = 0, arrive, seenSignal;
  const ready = new Promise(resolve => {arrive = resolve;});
  const pending = runFixedSyntheticRepairBatch({execute(request) {
    calls++; seenSignal = request.signal; arrive(); return new Promise(() => {});
  }}, {...options(), deadline: new Date(Date.now() + 250).toISOString(), repetitions: 3});
  await Promise.race([ready, pending]); const result = await pending;
  assert.equal(result.stopReason, 'TIMEOUT'); assert.ok(calls <= 1);
  assert.equal(result.counts.passed, 0); assert.equal(result.counts.attempted, calls);
  assert.equal(result.counts.notRun, 9 - calls);
  if (calls) {assert.equal(seenSignal.aborted, true); assert.equal(result.cases[0].errorCode, 'TIMEOUT');}
});

test('pre-cancelled batches record no invented attempts or accuracy', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const result = await runFixedSyntheticRepairBatch({execute() {calls++;}},
    {...options(), signal: controller.signal});
  assert.equal(calls, 0); assert.equal(result.stopReason, 'CANCELLED');
  assert.deepEqual(result.counts, {total: 3, attempted: 0, passed: 0, failed: 0, error: 0, notRun: 3});
  assert.equal(result.accuracy, null); assert.deepEqual(result.cases, []);
});

test('requires an explicit port, canonical future deadline, signal and bounded repetitions', async () => {
  let calls = 0; const source = {execute() {calls++;}};
  await assert.rejects(runFixedSyntheticRepairBatch(undefined, options()), {code: 'INVALID_ARGUMENT'});
  for (const repetitions of [0, 4, 1.5, '2', null]) {
    await assert.rejects(runFixedSyntheticRepairBatch(source, {...options(), repetitions}), {code: 'INVALID_ARGUMENT'});
  }
  for (const input of [{}, {...options(), deadline: 'tomorrow'}, {...options(), deadline: new Date(0).toISOString()},
    {...options(), deadline: '2027-02-30T00:00:00.000Z'}, {...options(), signal: undefined},
    {...options(), privateInput: 'must not be sent'}]) {
    await assert.rejects(runFixedSyntheticRepairBatch(source, input), {code: 'INVALID_ARGUMENT'});
  }
  assert.equal(calls, 0);
});

test('importing the module selects no service and performs no automatic network call', () => {
  const url = new URL('./fixed-synthetic-repair-batch.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `globalThis.fetch=()=>{throw Error('unexpected network')};await import(${JSON.stringify(url)});`],
  {encoding: 'utf8', timeout: 5000});
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, ''); assert.equal(child.stderr, '');
});

function appliedGraph(fixture) {
  let graph = fixture.snapshot;
  for (const change of fixture.expected.changes) {
    const {revision, graphRevision, ...node} = currentNodes(graph).find(node => node.id === change.node.id);
    graph = appendVersion(graph, graph.revision, {...node, summary: change.summary,
      reason: change.reason, dependencies: change.dependencies});
  }
  return graph;
}

test('only an explicit local reader can supply separately scored task-bound graph observations', async () => {
  const calls = [], data = fixtures();
  const result = await runFixedSyntheticRepairBatch(port(correct()), {...options(), readback: {read(request) {
    calls.push(request);
    assert.deepEqual(Object.keys(request), ['taskId', 'caseId', 'runIndex', 'deadline', 'signal']);
    const fixture = data.find(item => item.caseId === request.caseId);
    return {taskId: request.taskId, before: fixture.snapshot, after: appliedGraph(fixture)};
  }}});
  assert.equal(result.evaluationMode, 'local-readback');
  assert.equal(result.counts.passed, 3);
  assert.equal(result.readbackCounts.passed, 3);
  assert.equal(result.readbackScopeSummary.correctlyRepaired, 6);
  assert.equal(new Set(calls.map(item => item.taskId)).size, 3);
  assert.equal(result.verification, 'unverified');
  assert.doesNotMatch(JSON.stringify(result), /"history"|"summary"|"dependencies"\s*:\s*\[|"taskId"|"namespace"\s*:\s*"/);
});

test('a correct proposal with an unchanged readback never becomes an applied repair result', async () => {
  const result = await runFixedSyntheticRepairBatch(port(correct()), {...options(), readback: {read(request) {
    const fixture = fixtures().find(item => item.caseId === request.caseId);
    return {taskId: request.taskId, before: fixture.snapshot, after: fixture.snapshot};
  }}});
  assert.equal(result.counts.passed, 3); // Preserved proposal-quality meaning.
  assert.equal(result.readbackCounts.passed, 0);
  assert.equal(result.readbackCounts.failed, 3);
  assert.equal(result.readbackScopeSummary.missed, 6);
  assert.equal(result.readbackScopeSummary.unrepaired, 6);
});

test('local read failures retain proposal scores but are sanitized and never counted as readback success', async () => {
  const result = await runFixedSyntheticRepairBatch(port(correct()), {...options(), readback: {read() {
    throw Error('private-local-store-canary');
  }}});
  assert.equal(result.counts.passed, 3);
  assert.equal(result.readbackCounts.error, 3);
  assert.ok(result.cases.every(item => item.readback.errorCode === 'EVALUATION_READBACK_FAILED'));
  assert.doesNotMatch(JSON.stringify(result), /private-local-store-canary/);
});

test('cancellation bounds a noncooperative local read without starting another model case', async () => {
  const controller = new AbortController(), entered = Promise.withResolvers(), late = Promise.withResolvers();
  const calls = []; let seenSignal;
  const pending = runFixedSyntheticRepairBatch(port(correct(), calls), {...options(), signal: controller.signal,
    readback: {read(request) {seenSignal = request.signal; entered.resolve(); return late.promise;}}});
  await entered.promise; controller.abort();
  const result = await pending;
  assert.equal(calls.length, 1);
  assert.equal(seenSignal.aborted, true);
  assert.equal(result.stopReason, 'CANCELLED');
  assert.equal(result.readbackCounts.error, 1);
  assert.equal(result.cases[0].readback.errorCode, 'CANCELLED');
  const frozen = structuredClone(result);
  late.resolve({taskId: calls[0].taskId, before: fixtures()[0].snapshot, after: appliedGraph(fixtures()[0])});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result, frozen);
});

test('a late readback past the original deadline is discarded even before its timer runs', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const deadline = new Date(now + 10_000).toISOString(), calls = [];
  const result = await runFixedSyntheticRepairBatch(port(correct(), calls), {...options(), deadline,
    readback: {read(request) {
      const fixture = fixtures()[0]; now += 10_000;
      return {taskId: request.taskId, before: fixture.snapshot, after: appliedGraph(fixture)};
    }}});
  assert.equal(calls.length, 1);
  assert.equal(result.stopReason, 'TIMEOUT');
  assert.equal(result.cases[0].readback.errorCode, 'TIMEOUT');
  assert.equal(result.readbackCounts.passed, 0);
});

test('cancellation or expiry during observation validation cannot publish a successful readback', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  for (const code of ['CANCELLED', 'TIMEOUT']) {
    const controller = new AbortController(), calls = [];
    const result = await runFixedSyntheticRepairBatch(port(correct(), calls), {...options(), signal: controller.signal,
      readback: {read(request) {
        const fixture = fixtures()[0];
        return new Proxy({taskId: request.taskId, before: fixture.snapshot, after: appliedGraph(fixture)}, {
          ownKeys(target) {
            if (code === 'CANCELLED') controller.abort();
            else now += 10_000;
            return Reflect.ownKeys(target);
          },
        });
      }}});
    assert.equal(result.stopReason, code);
    assert.equal(calls.length, 1);
    assert.equal(result.cases[0].readback.status, 'error');
    assert.equal(result.cases[0].readback.errorCode, code);
    assert.equal(result.readbackCounts.passed, 0);
    assert.equal(result.readbackScopeSummary.scoredCases, 0);
  }
});
