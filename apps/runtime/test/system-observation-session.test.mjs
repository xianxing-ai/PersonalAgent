import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeApplication} from '../dist/application.js';

const descriptor = {name: 'computer.system.observe', version: '1.0.0',
  inputSchema: {type: 'object', additionalProperties: false, properties: {}},
  outputSchema: {type: 'object', additionalProperties: false, required: ['sample'], properties: {sample: {type: 'integer'}}},
  sideEffect: 'read', requiredScopes: ['computer:system:read'], idempotencySupport: true,
  recoverySupport: true, requiresPresence: false};
async function idle(app) {
  for (let i = 0; i < 200; i++) {
    if (app.activeTaskCount === 0) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Runtime did not become idle');
}
async function setup(execute, toolDescriptor = descriptor) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pa-observation-lease-'));
  let time = Date.now();
  const options = {path: path.join(directory, 'runtime.sqlite'), profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'fixture-user', now: () => new Date(time), tools: [{descriptor: toolDescriptor, execute}]};
  const app = createRuntimeApplication(options);
  return {app, options, advance: ms => { time += ms; },
    request: () => ({expiresAt: new Date(time + 60_000).toISOString(), intervalMs: 1000}),
    async dispose(current = app) { await idle(current); current.close(); await rm(directory, {recursive: true, force: true}); }};
}

test('fixed read-only consent creates independent Policy-backed samples and durable Evidence', async () => {
  let count = 0;
  const f = await setup(async (_input, context) => {
    assert.deepEqual(context.scopes, ['computer:system:read']); return {sample: ++count};
  });
  try {
    assert.throws(() => f.app.startSystemObservationSession({...f.request(), toolName: 'other'}), {code: 'INVALID_ARGUMENT'});
    const session = f.app.startSystemObservationSession(f.request());
    assert.throws(() => f.app.startSystemObservationSession(f.request()), {code: 'REVISION_CONFLICT'});
    const first = f.app.sampleSystemObservationSession(session.sessionId);
    assert.equal(first.state, 'sampled');
    await idle(f.app);
    const read = f.app.readHostToolTask(first.sample.task.taskId);
    assert.equal(read.task.state, 'succeeded');
    assert.deepEqual(read.confirmed.result, {sample: 1});
    assert.equal(read.approval, undefined);
    const record = f.app.runtime.readToolExecutions(read.task.taskId)[0];
    assert.equal(record.policyDecision, 'allow'); assert.equal(record.state, 'confirmed');
    assert.equal(f.app.runtime.policy.get(read.confirmed.runId).usesRemaining, 0);
    assert.equal(f.app.sampleSystemObservationSession(session.sessionId).state, 'not_due');
    f.advance(1000);
    const second = f.app.sampleSystemObservationSession(session.sessionId);
    await idle(f.app);
    assert.notEqual(second.sample.task.taskId, first.sample.task.taskId);
    assert.equal(count, 2);
    assert.equal(f.app.stopSystemObservationSession(session.sessionId).stopped, true);
    assert.throws(() => f.app.sampleSystemObservationSession(session.sessionId), {code: 'UNAUTHORIZED'});
  } finally { await f.dispose(); }
});

test('current observation readback binds only confirmed node metrics to the active consent lease', async () => {
  const observationDescriptor = {...descriptor, outputSchema: {type: 'object', additionalProperties: true}};
  const f = await setup(async () => ({source: 'node:os', capturedAt: new Date().toISOString(),
    cpu: {logicalProcessorCount: 4, utilizationPercent: 92},
    memory: {totalBytes: 1000, freeBytes: 250, usedBytes: 750, utilizationPercent: 75},
    uptimeSeconds: 10, unavailable: ['process_breakdown', 'disk_io', 'thermal', 'network_activity']}), observationDescriptor);
  try {
    const session = f.app.startSystemObservationSession(f.request());
    const first = f.app.sampleSystemObservationSession(session.sessionId);
    await idle(f.app);
    const confirmed = f.app.readHostToolTask(first.sample.task.taskId).confirmed;
    assert.deepEqual(f.app.readCurrentSystemObservationSample(first.sample.task.taskId), {
      taskId: first.sample.task.taskId, source: 'node:os',
      timestamp: confirmed.result.capturedAt,
      cpuPercent: 92, memoryPercent: 75, samplingIntervalMs: 1000,
      evidenceRefs: confirmed.evidenceRefs,
    });

    f.advance(1000);
    const second = f.app.sampleSystemObservationSession(session.sessionId);
    await idle(f.app);
    assert.ok(f.app.readCurrentSystemObservationSample(first.sample.task.taskId),
      'older confirmed samples remain valid while their consent lease is active');
    assert.equal(f.app.readCurrentSystemObservationSample(second.sample.task.taskId).samplingIntervalMs, 1000);
    f.app.stopSystemObservationSession(session.sessionId);
    assert.equal(f.app.readCurrentSystemObservationSample(first.sample.task.taskId), undefined);
    assert.equal(f.app.readCurrentSystemObservationSample(second.sample.task.taskId), undefined);
  } finally { await f.dispose(); }
});

test('one inflight sample only; stopping aborts the tool and revokes its grant', async () => {
  let signal;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const f = await setup(async (_input, context) => {
    signal = context.signal;
    markStarted();
    return new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(Error('aborted')), {once: true}));
  });
  try {
    const session = f.app.startSystemObservationSession(f.request());
    const first = f.app.sampleSystemObservationSession(session.sessionId);
    assert.equal(f.app.sampleSystemObservationSession(session.sessionId).state, 'busy');
    await started;
    f.app.stopSystemObservationSession(session.sessionId);
    await idle(f.app);
    assert.equal(signal.aborted, true);
    assert.equal(f.app.runtime.policy.get(`host-tool-${first.sample.task.taskId}`), undefined);
    assert.equal(f.app.runtime.getTask(first.sample.task.taskId).state, 'cancelled');
  } finally { await f.dispose(); }
});

test('expiry and application close end consent without refresh', async () => {
  const f = await setup(async () => ({sample: 1}));
  let closed = false;
  try {
    const session = f.app.startSystemObservationSession(f.request());
    f.advance(60_000);
    assert.throws(() => f.app.sampleSystemObservationSession(session.sessionId), {code: 'TIMEOUT'});
    assert.throws(() => f.app.sampleSystemObservationSession(session.sessionId), {code: 'UNAUTHORIZED'});
    const second = f.app.startSystemObservationSession(f.request());
    f.app.close(); closed = true;
    assert.throws(() => f.app.sampleSystemObservationSession(second.sessionId), {code: 'UNAUTHORIZED'});
  } finally {
    // Reopen only for fixture cleanup; no consent is reconstructed.
    if (closed) await f.dispose(createRuntimeApplication(f.options)); else await f.dispose();
  }
});

test('restart rejects saved lease and unconsumed grant even through generic tool.invoke', async () => {
  let count = 0;
  const f = await setup(async () => ({sample: ++count}));
  let app = f.app;
  try {
    const session = app.startSystemObservationSession(f.request());
    // Simulate interruption after durable intent/grant and before dispatch.
    const task = app.runtime.submitTaskWithCheckpoint({goal: 'interrupted sample', conversationId: 'fixture', idempotencyKey: 'interrupted-sample'},
      'system-observation-session', session.sessionId);
    const ref = `host-tool-${task.taskId}`;
    app.runtime.policy.grant({authorizationRef: ref, taskId: task.taskId, toolName: descriptor.name,
      scopes: descriptor.requiredScopes, expiresAt: f.request().expiresAt, maxUses: 1, argumentsDigest: toolArgumentsDigest({})});
    app.runtime.transitionTask(task.taskId, 'planning');
    app.runtime.transitionTask(task.taskId, 'running');
    app.close();
    app = createRuntimeApplication(f.options);
    assert.throws(() => app.sampleSystemObservationSession(session.sessionId), {code: 'UNAUTHORIZED'});
    const client = new Client(app); await client.connect();
    await assert.rejects(client.call('tool.invoke', {toolName: descriptor.name, toolVersion: descriptor.version,
      arguments: {}, scopeRef: ref}, {taskId: task.taskId, idempotencyKey: ref}), {code: 'UNAUTHORIZED'});
    assert.equal(count, 0);
    assert.equal(app.runtime.readToolExecutions(task.taskId)[0].policyDecision, 'deny');
  } finally { await f.dispose(app); }
});
