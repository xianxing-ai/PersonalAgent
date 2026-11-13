import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRepairAttempt, classifyFailure, decideRepair, emptyRepairTrace, replayRepairTrace, summarizeRepairFailure,
} from '../dist/repair-policy.js';

const deadline = () => new Date(Date.now() + 60_000).toISOString();
const active = () => ({signal: new AbortController().signal, deadline: deadline()});
const readTimeout = (extra = {}) => ({effect: 'read', outcome: 'failed', signal: {code: 'TIMEOUT'}, parentCanReplan: false, ...extra});
const policy = (now, extra = {}) => ({now: () => now, baseDelayMs: 100, maxDelayMs: 10_000, maxAttempts: 8, maxElapsedMs: 60_000, ...extra});

function walk(observation, options, limit = 8) {
  let trace = emptyRepairTrace();
  const decisions = [];
  for (let i = 0; i < limit; i++) {
    const decision = decideRepair(observation, trace, options);
    decisions.push(decision);
    trace = appendRepairAttempt(trace, decision);
    if (!decision.record || decision.terminal) break;
  }
  return {trace, decisions};
}

test('classifies timeout, rate limit and network as transient', () => {
  for (const signal of [
    {code: 'TIMEOUT'}, {code: 'RATE_LIMITED'}, {code: 'ECONNRESET'}, {httpStatus: 429}, {httpStatus: 503},
    {message: 'socket hang up'}, {retryable: true},
  ]) assert.equal(classifyFailure(signal), 'transient', JSON.stringify(signal));
});

test('classifies parameter, selector and insufficient permission as correctable', () => {
  for (const signal of [
    {code: 'INVALID_ARGUMENT'}, {code: 'SELECTOR_STALE'}, {code: 'PERMISSION_INSUFFICIENT'},
    {httpStatus: 422}, {parameterError: true}, {selectorMiss: true}, {permissionInsufficient: true},
    {code: 'FORBIDDEN', permissionInsufficient: true}, {message: 'element not found'},
  ]) assert.equal(classifyFailure(signal), 'correctable', JSON.stringify(signal));
});

test('classifies cancellation, missing targets and a bare attestation as unrecoverable', () => {
  for (const signal of [
    {code: 'CANCELLED'}, {code: 'NOT_FOUND'}, {code: 'EXTERNAL_FAILURE', retryable: false},
    {code: 'FORBIDDEN'}, {httpStatus: 404}, {},
  ]) assert.equal(classifyFailure(signal), 'unrecoverable', JSON.stringify(signal));
  const decision = decideRepair({effect: 'read', outcome: 'failed', retrySafe: true, signal: {code: 'EXTERNAL_FAILURE', retryable: false}, parentCanReplan: false}, emptyRepairTrace());
  assert.equal(decision.strategy, 'stop');
  assert.match(decision.reason, /attestation is not a retry/);
  assert.equal(decision.executable, false);
});

test('transient reads use exponential backoff and do not stack another attempt before the delay', () => {
  let trace = emptyRepairTrace();
  const delays = [];
  let now = 1_000;
  for (let i = 0; i < 3; i++) {
    const decision = decideRepair(readTimeout(), trace, policy(now));
    assert.equal(decision.strategy, 'backoff_retry');
    assert.equal(decision.executable, true);
    assert.equal(decision.effect, 'read');
    delays.push(decision.delayMs);
    trace = appendRepairAttempt(trace, decision);
    const held = decideRepair(readTimeout(), trace, policy(now + decision.delayMs - 1));
    assert.equal(held.record, false);
    assert.equal(held.result, 'held_for_backoff');
    assert.equal(held.executable, false);
    assert.equal(appendRepairAttempt(trace, held).attempts.length, trace.attempts.length);
    now += decision.delayMs + 1;
  }
  assert.deepEqual(delays, [100, 200, 400]);
});

test('correctable failures walk arguments, tool, read-only fallback, then the parent replan', () => {
  const observation = {
    effect: 'read', outcome: 'failed', signal: {code: 'INVALID_ARGUMENT'}, parentCanReplan: true,
    alternatives: {
      arguments: [{digest: 'args-a'}, {digest: 'args-b'}],
      tools: [{name: 'other.tool', version: '1.0.0'}],
      readOnlyFallback: {toolName: 'read.only', argumentsDigest: 'fallback'},
    },
  };
  const {trace, decisions} = walk(observation, policy(0, {maxAttempts: 8}));
  assert.deepEqual(decisions.map(decision => decision.strategy), [
    'change_arguments', 'change_arguments', 'change_tool', 'degrade_readonly', 'request_parent_replan',
  ]);
  assert.deepEqual(decisions.map(decision => decision.alternateDigest ?? decision.toolName), [
    'args-a', 'args-b', 'other.tool', 'fallback', undefined,
  ]);
  assert.equal(decisions[3].toolName, 'read.only');
  assert.equal(decisions.at(-1).terminal, true);
  assert.equal(summarizeRepairFailure(trace).requiresParentReplan, true);
});

test('attempt, elapsed, step and token budgets stop the loop', () => {
  const attempt = decideRepair(readTimeout(), emptyRepairTrace(), policy(0, {maxAttempts: 0}));
  assert.equal(attempt.strategy, 'stop');
  assert.equal(attempt.budgetExhausted, true);
  let trace = emptyRepairTrace();
  trace = appendRepairAttempt(trace, decideRepair(readTimeout(), trace, policy(1_000, {maxElapsedMs: 500, baseDelayMs: 0, maxDelayMs: 0})));
  const elapsed = decideRepair(readTimeout(), trace, policy(1_500, {maxElapsedMs: 500, baseDelayMs: 0, maxDelayMs: 0}));
  assert.equal(elapsed.budgetExhausted, true);
  assert.match(elapsed.reason, /budget_exhausted/);
  const steps = decideRepair(readTimeout({stepsUsed: 3}), emptyRepairTrace(), policy(0, {maxSteps: 3}));
  const tokens = decideRepair(readTimeout({tokensUsed: 20}), emptyRepairTrace(), policy(0, {maxTokens: 20}));
  assert.equal(steps.budgetExhausted, true);
  assert.equal(tokens.budgetExhausted, true);
  const handed = decideRepair(readTimeout({parentCanReplan: true}), trace, policy(1_500, {maxElapsedMs: 500, baseDelayMs: 0, maxDelayMs: 0}));
  assert.equal(handed.strategy, 'request_parent_replan');
  assert.equal(handed.budgetExhausted, true);
  assert.equal(handed.executable, false);
});

test('unknown or non-idempotent writes are never blindly retried', () => {
  const unknown = decideRepair({effect: 'write', outcome: 'unknown', signal: {code: 'TIMEOUT'}}, emptyRepairTrace(), policy(0));
  assert.equal(unknown.strategy, 'reconcile_status');
  assert.equal(unknown.executable, false);
  const trace = appendRepairAttempt(emptyRepairTrace(), unknown);
  const repeated = decideRepair({effect: 'write', outcome: 'unknown', signal: {code: 'TIMEOUT'}}, trace, policy(1));
  assert.equal(repeated.record, false);
  assert.equal(appendRepairAttempt(trace, repeated).attempts.length, 1);
  const stillUnknown = decideRepair({effect: 'write', outcome: 'unknown', signal: {code: 'TIMEOUT'}, write: {status: 'unknown'}}, trace, policy(2));
  assert.equal(stillUnknown.strategy, 'stop');
  assert.match(stillUnknown.reason, /blind retry refused/);
  const applied = decideRepair({effect: 'write', outcome: 'unknown', write: {status: 'applied', idempotencyKey: 'key-1'}}, trace, policy(3));
  assert.match(applied.reason, /write_already_applied/);
  const unsafe = decideRepair({effect: 'write', outcome: 'failed', signal: {code: 'TIMEOUT'}, write: {status: 'not_applied'}, parentCanReplan: false}, emptyRepairTrace(), policy(0));
  assert.notEqual(unsafe.strategy, 'backoff_retry');
  assert.match(unsafe.reason, /blind retry refused/);
  for (const write of [{idempotent: true}, {idempotencyKey: 'key-1'}, {compensationRef: 'comp-1'}]) {
    const safe = decideRepair({effect: 'write', outcome: 'failed', signal: {code: 'TIMEOUT'}, write: {...write, status: 'not_applied'}}, emptyRepairTrace(), policy(0));
    assert.equal(safe.strategy, 'backoff_retry', JSON.stringify(write));
    assert.equal(safe.writeRetrySafe, true);
    assert.equal(safe.executable, true);
  }
  const probed = decideRepair({effect: 'write', outcome: 'unknown', signal: {code: 'TIMEOUT'}, write: {status: 'not_applied', idempotencyKey: 'key-1'}}, trace, policy(4));
  assert.notEqual(probed.strategy, 'backoff_retry');
});

test('high-risk retries stay behind approval and do not become executable', () => {
  const observation = {effect: 'read', outcome: 'failed', risk: 'high', signal: {code: 'TIMEOUT'}, parentCanReplan: false};
  const waiting = decideRepair(observation, emptyRepairTrace(), policy(0, {baseDelayMs: 0, maxDelayMs: 0}));
  assert.equal(waiting.result, 'awaiting_approval');
  assert.equal(waiting.executable, false);
  assert.equal(waiting.requiresApproval, true);
  const trace = appendRepairAttempt(emptyRepairTrace(), waiting);
  assert.equal(decideRepair(observation, trace, policy(1, {baseDelayMs: 0, maxDelayMs: 0})).record, false);
  const approved = decideRepair({...observation, approvalGranted: true}, trace, policy(2, {baseDelayMs: 0, maxDelayMs: 0}));
  assert.equal(approved.strategy, 'backoff_retry');
  assert.equal(approved.executable, true);
  assert.equal(approved.record, true);
});

test('replay reconstructs the decision timeline and emits no tool, model or write', () => {
  const safeWrite = decideRepair({
    effect: 'write', outcome: 'failed', signal: {code: 'TIMEOUT'}, write: {status: 'not_applied', idempotencyKey: 'key-1'}, parentCanReplan: false,
  }, emptyRepairTrace(), policy(0));
  const trace = appendRepairAttempt(emptyRepairTrace(), safeWrite);
  const calls = {tools: 0, writes: 0};
  const replay = replayRepairTrace(trace, active());
  assert.equal(replay.actualToolCalls, 0);
  assert.equal(replay.actualWrites, 0);
  assert.equal(replay.actualModelCalls, 0);
  assert.equal(replay.sideEffectsReplayed, false);
  assert.equal(replay.authority, 'data_only_decision_replay');
  assert.equal(calls.tools, 0);
  assert.equal(calls.writes, 0);
  assert.ok(replay.timeline.every(item => item.executedDuringReplay === false && item.sideEffectsEmitted === 0));
  const summary = summarizeRepairFailure(trace);
  assert.equal(summary.classification, 'transient');
  assert.equal(summary.lastStrategy, 'backoff_retry');
  assert.equal(summary.unknownWriteBlindRetry, false);
  assert.match(summary.lastReason, /idempotent write/);
  const tampered = structuredClone(trace);
  tampered.attempts[0].sideEffectsEmitted = 1;
  assert.throws(() => replayRepairTrace(tampered, active()), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => replayRepairTrace(trace, {...active(), deadline: '2020-01-01T00:00:00.000Z'}), {code: 'TIMEOUT'});
  const stop = new AbortController();
  stop.abort();
  assert.throws(() => replayRepairTrace(trace, {...active(), signal: stop.signal}), {code: 'CANCELLED'});
});
