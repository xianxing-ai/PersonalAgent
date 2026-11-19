import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {FrameDecoder, MAX_FRAME_BYTES} from '../dist/index.js';
import {encodeWindowsHostFrame, parseWindowsHostFrame, validateWindowsHostHandshake,
  validateWindowsHostObservation, validateWindowsHostRecoveredResult, validateWindowsHostResult,
  validateWindowsHostStatus, validateWindowsHostTargetReady} from '../dist/windows-host.js';

const t0 = '2026-09-25T12:00:00.000Z';
const t1 = '2026-09-25T12:01:00.000Z';
const base = {protocolVersion: '0.1.0', requestId: 'request-1'};
const hello = {kind: 'hello', ...base, clientNonce: '1'.repeat(32)};
const ack = {kind: 'hello_ack', ...base, clientNonce: hello.clientNonce,
  hostNonce: '2'.repeat(32), sessionId: 'session-1'};
const bind = {kind: 'bind', ...base, sessionId: ack.sessionId, hostNonce: ack.hostNonce};
const observe = {kind: 'observe', ...base, sessionId: ack.sessionId,
  deadline: t1, capability: 'notepad.replace_text'};
const observed = {kind: 'observed', ...base, sessionId: ack.sessionId,
  targetRef: 'opaque-notepad-1', expiresAt: t1, source: 'windows-uia'};
const execute = {kind: 'execute', ...base, sessionId: ack.sessionId,
  taskId: 'task-1', runId: 'run-1', toolName: 'computer.notepad.replace_text',
  toolVersion: '1.0.0', authorizationRef: 'grant-1', argumentsDigest: 'a'.repeat(64),
  targetRef: observed.targetRef, deadline: t1, expectedText: 'before', replacementText: 'after'};
const result = {kind: 'result', ...base, sessionId: ack.sessionId,
  taskId: execute.taskId, runId: execute.runId, toolName: execute.toolName,
  toolVersion: execute.toolVersion, argumentsDigest: execute.argumentsDigest,
  targetRef: execute.targetRef,
  state: 'verified', startedAt: t0, finishedAt: t1, evidenceRef: 'evidence-1'};

test('portable C# wire fixtures match the parser', () => {
  const fixtures = JSON.parse(readFileSync(new URL('../fixtures/windows-host.json', import.meta.url), 'utf8'));
  for (const frame of fixtures.valid) assert.deepEqual(parseWindowsHostFrame(frame), frame);
  for (const frame of fixtures.invalid) assert.throws(() => parseWindowsHostFrame(frame));
});

test('handshake, observation, action and JSONL frame retain their correlation', () => {
  validateWindowsHostHandshake(hello, ack, bind);
  validateWindowsHostObservation(observe, observed);
  validateWindowsHostResult(execute, result);
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(encodeWindowsHostFrame(execute)), [execute]);
  decoder.finish();
  const poll = {...result, requestId: 'poll-1'};
  validateWindowsHostResult(execute, poll, 'poll-1');
  validateWindowsHostStatus({kind: 'status', ...base, requestId: 'poll-1', sessionId: ack.sessionId,
    taskId: execute.taskId, runId: execute.runId, toolName: execute.toolName,
    toolVersion: execute.toolVersion, argumentsDigest: execute.argumentsDigest,
    targetRef: execute.targetRef}, poll);
});

test('reconnected status binds the durable run to a fresh session and historical target', () => {
  const poll = {kind: 'status', ...base, requestId: 'recovery-1', sessionId: 'new-session',
    taskId: execute.taskId, runId: execute.runId, toolName: execute.toolName,
    toolVersion: execute.toolVersion, argumentsDigest: execute.argumentsDigest,
    targetRef: execute.targetRef};
  const recovered = {...result, requestId: poll.requestId, sessionId: poll.sessionId};
  validateWindowsHostRecoveredResult(execute, poll, recovered);
  assert.throws(() => validateWindowsHostResult(execute, recovered, poll.requestId));
  for (const changed of [{taskId: 'other'}, {runId: 'other'},
    {argumentsDigest: 'b'.repeat(64)}, {targetRef: 'opaque-notepad-2'}]) {
    assert.throws(() => validateWindowsHostRecoveredResult(execute, {...poll, ...changed}, recovered));
    assert.throws(() => validateWindowsHostRecoveredResult(execute, poll, {...recovered, ...changed}));
  }
  assert.throws(() => validateWindowsHostRecoveredResult(execute, poll,
    {...recovered, sessionId: execute.sessionId}));
  assert.throws(() => validateWindowsHostRecoveredResult(execute,
    {...poll, sessionId: execute.sessionId}, {...recovered, sessionId: execute.sessionId}));
});

test('cross-session, nonce, run, target and request substitution is refused', () => {
  assert.throws(() => validateWindowsHostHandshake(hello, {...ack, clientNonce: '3'.repeat(32)}, bind));
  assert.throws(() => validateWindowsHostHandshake(hello, ack, {...bind, hostNonce: '3'.repeat(32)}));
  assert.throws(() => validateWindowsHostObservation(observe, {...observed, sessionId: 'other'}));
  assert.throws(() => validateWindowsHostStatus({kind: 'status', ...base, sessionId: ack.sessionId,
    taskId: execute.taskId, runId: execute.runId, toolName: execute.toolName,
    toolVersion: execute.toolVersion, argumentsDigest: execute.argumentsDigest,
    targetRef: execute.targetRef}, {kind: 'status_reply', ...base, sessionId: ack.sessionId,
    taskId: execute.taskId, runId: 'another-run', state: 'not_found'}));
  for (const changed of [{requestId: 'other'}, {sessionId: 'other'}, {taskId: 'other'},
    {runId: 'other'}, {targetRef: 'opaque-notepad-2'}]) {
    assert.throws(() => validateWindowsHostResult(execute, {...result, ...changed}));
  }
});

test('observation can refuse an absent or ambiguous target without a transport failure', () => {
  const refusal = {kind: 'observation_refused', ...base, sessionId: ack.sessionId,
    errorCode: 'TARGET_AMBIGUOUS'};
  validateWindowsHostObservation(observe, refusal);
  assert.throws(() => validateWindowsHostObservation(observe, {...refusal, requestId: 'other'}));
  assert.throws(() => parseWindowsHostFrame({...refusal, errorCode: 'SUCCESS'}));
  assert.throws(() => parseWindowsHostFrame({...refusal, hwnd: 123}));
  assert.throws(() => validateWindowsHostObservation(observe,
    {kind: 'status_reply', ...base, sessionId: ack.sessionId,
      taskId: 'task-1', runId: 'run-1', state: 'not_found'}));
});

test('malformed and capability-forged frames fail closed', () => {
  for (const frame of [
    {...hello, hwnd: 1}, {...observe, capability: 'computer.shell'},
    {...execute, authorizationRef: undefined}, {...execute, argumentsDigest: 'not-a-digest'},
    {...execute, toolName: 'computer.shell'}, {...execute, deadline: '2026-02-30T12:00:00.000Z'},
    {...result, state: 'verified', evidenceRef: undefined},
    {...result, state: 'refused', evidenceRef: undefined},
    {...result, finishedAt: '2026-09-25T11:59:00.000Z'},
  ]) assert.throws(() => parseWindowsHostFrame(frame));
  assert.deepEqual(parseWindowsHostFrame({...result, state: 'result_unknown', errorCode: 'RESULT_UNKNOWN'}).state, 'result_unknown');
});

test('target readiness stays correlated and fail-closed before approval', () => {
  const request = {kind: 'target_ready', ...base, sessionId: ack.sessionId,
    targetRef: observed.targetRef, deadline: t1};
  const fresh = {kind: 'target_ready_result', ...base, sessionId: ack.sessionId,
    targetRef: observed.targetRef, ready: true, expiresAt: t1};
  const stale = {kind: 'target_ready_result', ...base, sessionId: ack.sessionId,
    targetRef: observed.targetRef, ready: false, errorCode: 'TARGET_STALE'};
  const expired = {...stale, errorCode: 'TIMEOUT'};
  validateWindowsHostTargetReady(request, fresh);
  validateWindowsHostTargetReady(request, stale);
  validateWindowsHostTargetReady(request, expired);
  assert.deepEqual(parseWindowsHostFrame(fresh).ready, true);
  assert.equal(parseWindowsHostFrame(stale).errorCode, 'TARGET_STALE');
  for (const changed of [{requestId: 'other'}, {sessionId: 'other'},
    {targetRef: 'opaque-notepad-2'}, {protocolVersion: '0.0.0'}]) {
    assert.throws(() => validateWindowsHostTargetReady(request, {...fresh, ...changed}),
      {code: 'INVALID_ARGUMENT'});
  }
  for (const forged of [
    {...fresh, errorCode: 'TARGET_STALE'},
    {...stale, expiresAt: t1},
    {...fresh, ready: 'true'},
    {...stale, errorCode: 'SUCCESS'},
    {...request, hwnd: 1},
    {...fresh, text: 'private-window'},
    {...request, deadline: '2026-02-30T12:00:00.000Z'},
  ]) assert.throws(() => parseWindowsHostFrame(forged), {code: 'INVALID_ARGUMENT'});
});

test('private action frame enforces the common 1 MiB JSONL bound', () => {
  assert.ok(encodeWindowsHostFrame(execute).length < MAX_FRAME_BYTES);
  assert.throws(() => encodeWindowsHostFrame({...execute, replacementText: 'x'.repeat(4097)}));
  assert.throws(() => new FrameDecoder().push(new Uint8Array(MAX_FRAME_BYTES + 1)));
});
