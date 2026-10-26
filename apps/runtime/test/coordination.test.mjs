import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {AgentArtsBeforeInvokeError, AgentArtsTerminalError} from '@personal-agent/coordination';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication} from '../dist/application.js';

async function fixture(coordination, run, options = {}) {
  const base = new URL('../../../.cache/competition-tests/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('case-', base));
  const app = createRuntimeApplication({path: directory + '/runtime.sqlite', profile: 'huawei_ict_agentarts', coordination, ...options});
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    await run(app, client);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
}

async function terminal(app, id) {
  for (let i = 0; i < 200; i++) {
    const task = app.runtime.getTask(id);
    if (['succeeded', 'failed', 'cancelled'].includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('Task did not settle');
}
const submit = (client, key = 'one') => client.call('task.submit', {goal: '你好', conversationId: 'competition'}, {idempotencyKey: key});

test('competition submission uses only injected port, persists text and deduplicates', async () => {
  const port = new FakeCoordinationPort(r => '离线回答：' + r.goal);
  await fixture(port, async (app, client) => {
    const [a, b] = await Promise.all([submit(client), submit(client)]);
    assert.equal(a.taskId, b.taskId);
    const task = await terminal(app, a.taskId);
    assert.equal(task.state, 'succeeded');
    assert.match(task.resultSummary, /离线回答：你好/);
    assert.match(task.resultSummary, /verification=mock/);
    assert.deepEqual(task.evidenceRefs, []);
    assert.equal(port.requests.length, 1);
    assert.deepEqual(Object.keys(port.requests[0]).sort(), ['deadline', 'goal', 'revision', 'signal', 'taskId']);
    assert.equal(app.runtime.loadCheckpoint(a.taskId, 'application-profile'), 'huawei_ict_agentarts');
    assert.throws(() => app.configureText({mode: 'fake'}), /unavailable/);
    assert.throws(() => app.testTextConnection(), /unavailable/);
    assert.throws(() => app.deployment, /unavailable/);
  });
});

test('missing competition port fails without local fallback', async () => {
  await fixture(undefined, async (app, client) => {
    const task = await terminal(app, (await submit(client)).taskId);
    assert.equal(task.state, 'failed');
    assert.equal(task.error.code, 'UNSUPPORTED_CAPABILITY');
    assert.equal(task.resultSummary, undefined);
  });
});

test('mixed profile configuration is rejected before opening a database', () => {
  for (const options of [{profile: 'huawei_ict_agentarts', text: {mode: 'fake'}},
    {coordination: new FakeCoordinationPort(() => 'text')},
    {profile: 'unknown'}]) {
    assert.throws(() => createRuntimeApplication({path: 'must-not-open.sqlite', ...options}), /Choose explicit/);
  }
});

test('cancel aborts port and ignores its late text result', async () => {
  let finish;
  const port = new FakeCoordinationPort(() => new Promise(resolve => {finish = resolve;}));
  await fixture(port, async (app, client) => {
    const {taskId} = await submit(client);
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    await client.call('task.cancel', {taskId});
    assert.equal((await terminal(app, taskId)).state, 'cancelled');
    assert.equal(port.requests[0].signal.aborted, true);
    finish('late answer');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(app.runtime.getTask(taskId).resultSummary, undefined);
  });
});

test('request deadline reaches port and timeout settles a non-cooperative adapter', async () => {
  // Freeze the request clock so parallel SQLite startup cannot exhaust the
  // budget before the adapter starts. runTask still uses its real timeout timer.
  const startedAt = Date.now();
  const port = new FakeCoordinationPort(() => new Promise(() => {}));
  await fixture(port, async app => {
    const deadline = new Date(startedAt + 100).toISOString();
    const response = await app.send({kind: 'request', protocolVersion: '1.0.0', requestId: 'deadline-request',
      operation: 'task.submit', deadline, idempotencyKey: 'deadline',
      payload: {goal: 'wait', conversationId: 'competition'}}, new AbortController().signal);
    assert.equal(response.outcome, 'ok');
    const task = await terminal(app, response.data.taskId);
    assert.equal(task.error.code, 'TIMEOUT');
    assert.equal(port.requests[0].deadline, deadline);
    assert.equal(port.requests[0].signal.aborted, true);
  }, {now: () => new Date(startedAt)});
});

test('adapter errors are sanitized instead of persisted verbatim', async () => {
  await fixture({execute: async () => {throw Error('secret-credential');}}, async (app, client) => {
    const task = await terminal(app, (await submit(client)).taskId);
    assert.equal(task.state, 'failed');
    assert.equal(task.error.code, 'EXTERNAL_FAILURE');
    const diagnostic = app.runtime.loadCheckpoint(task.taskId, 'competition-coordination-failure');
    assert.deepEqual(diagnostic, {version: '1.0', phase: 'initial', kind: 'unknown_error', code: 'EXTERNAL_FAILURE'});
    assert.doesNotMatch(JSON.stringify({events: app.readEvents(), diagnostic}), /secret-credential/);
  });
});

test('adapter diagnostics retain only allowlisted protocol codes without changing public failure semantics', async () => {
  for (const code of ['INVALID_ARGUMENT', 'UNAUTHORIZED', 'UNSUPPORTED_CAPABILITY', 'REVISION_CONFLICT', 'TIMEOUT', 'CANCELLED', 'private-code-canary']) {
    await fixture({execute: async () => {throw new ProtocolError(code, 'private-message-canary');}}, async (app, client) => {
      const task = await terminal(app, (await submit(client)).taskId);
      assert.equal(task.state, 'failed');
      assert.deepEqual(task.error, {code: 'EXTERNAL_FAILURE', message: 'Coordination adapter failed', retryable: false});
      const diagnostic = app.runtime.loadCheckpoint(task.taskId, 'competition-coordination-failure');
      assert.deepEqual(diagnostic, {version: '1.0', phase: 'initial', kind: 'protocol_error',
        code: code === 'private-code-canary' ? 'EXTERNAL_FAILURE' : code});
      assert.doesNotMatch(JSON.stringify({task, events: app.readEvents(), diagnostic}), /private-.*canary/);
    });
  }
});

test('adapter diagnostics identify transport error classes without retaining arbitrary error properties', async () => {
  const cases = [
    [new AgentArtsBeforeInvokeError('authorization'), 'agentarts_before_invoke', 'UNAUTHORIZED'],
    [new AgentArtsTerminalError({sessionId: 'synthetic-session', requestId: 'synthetic-request',
      idempotencyKey: 'synthetic-key', payloadDigest: 'a'.repeat(64), accepted: true}, 'RATE_LIMITED'), 'agentarts_terminal', 'EXTERNAL_FAILURE', 'RATE_LIMITED'],
    [{code: 'UNAUTHORIZED', message: 'private-message-canary'}, 'unknown_error', 'EXTERNAL_FAILURE'],
    [Object.defineProperty(new ProtocolError('UNAUTHORIZED', 'private-message-canary'), 'code',
      {get() {throw Error('private-getter-canary');}}), 'unknown_error', 'EXTERNAL_FAILURE'],
  ];
  for (const [error, kind, code, remoteCode] of cases) {
    await fixture({execute: async () => {throw error;}}, async (app, client) => {
      const task = await terminal(app, (await submit(client)).taskId);
      assert.equal(task.state, 'failed');
      assert.equal(task.error.code, 'EXTERNAL_FAILURE');
      const diagnostic = app.runtime.loadCheckpoint(task.taskId, 'competition-coordination-failure');
      assert.deepEqual(diagnostic, {version: '1.0', phase: 'initial', kind, code,
        ...(remoteCode === undefined ? {} : {remoteCode})});
      assert.doesNotMatch(JSON.stringify({task, events: app.readEvents(), diagnostic}), /private-.*canary|synthetic-(session|request|key)/);
    });
  }
});

test('tool and evidence claims cannot mark a task succeeded', async () => {
  for (const result of [{kind: 'tool_proposal', tool: 'sendMail'},
    {kind: 'text', text: 'done', verification: 'verified'},
    {kind: 'text', text: 'done', verification: 'mock', evidenceRefs: ['forged']}]) {
    await fixture({execute: async () => result}, async (app, client) => {
      const task = await terminal(app, (await submit(client)).taskId);
      assert.equal(task.state, 'failed');
      assert.equal(task.error.code, 'INVALID_ARGUMENT');
      assert.deepEqual(task.evidenceRefs, []);
    });
  }
});
