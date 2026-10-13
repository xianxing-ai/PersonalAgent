import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '../dist/application.js';
import {SyntheticWebSocket} from '../../../packages/coordination/test/fixtures/websocket.mjs';

const target = {gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic', transport: 'wss',
  websocketUrl: 'wss://agentarts.example.test/runtimes/synthetic/ws', allowHttpsFallback: true};
async function waitState(app, taskId, states) {
  for (let i = 0; i < 200; i++) {
    const task = app.runtime.getTask(taskId);
    if (states.includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('Synthetic task did not settle');
}
function factory(path, respond, extras = {}) {
  const sockets = [], fetches = [], states = [];
  const app = createAgentArtsRuntimeApplication({...target, path,
    authorizationProvider: {read: async () => 'Bearer synthetic-outer'},
    websocketAuthorizationProvider: {read: async () => 'Bearer synthetic-app'},
    websocketFactory: () => { const socket = new SyntheticWebSocket(respond); sockets.push(socket); return socket; },
    onTransportState: state => states.push(state),
    fetchImpl: async (...args) => { fetches.push(args); throw Error('Unexpected HTTPS fallback'); }, ...extras});
  return {app, sockets, fetches, states};
}

const syntheticProposal = {kind: 'tool_proposal', proposalId: 'synthetic-read', toolName: 'fixture.read',
  toolVersion: '1.0.0', arguments: {id: 'synthetic'}};
const syntheticDescriptor = {name: syntheticProposal.toolName, version: syntheticProposal.toolVersion,
  inputSchema: {type: 'object', required: ['id'], properties: {id: {type: 'string'}}},
  outputSchema: {type: 'object', required: ['value'], properties: {value: {type: 'string'}}},
  sideEffect: 'read', requiredScopes: ['fixture:read'], idempotencySupport: true,
  recoverySupport: true, requiresPresence: false};
function syntheticToolOptions(execute) {
  return {responseMode: 'tool-proposal-json',
    competitionToolExports: [{toolName: syntheticProposal.toolName, toolVersion: syntheticProposal.toolVersion,
      exportPolicyVersion: 'synthetic-v1', accepts: () => true, project: ({result}) => ({value: result.value})}],
    tools: [{descriptor: syntheticDescriptor, execute}]};
}

test('trusted Runtime runs WSS as Competition, clears its send intent, and disposes reusable sessions', async () => {
  let application;
  const h = factory(':memory:', (frame, socket) => {
    if (frame.type !== 'invoke') return;
    const taskId = application.runtime.listTasks({}).items[0].taskId;
    const intent = application.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight');
    assert.equal(intent.requestId, frame.requestId);
    assert.equal(intent.payloadDigest, frame.payloadDigest);
    assert.equal('payload' in intent, false);
    socket.accepted(frame); socket.result(frame, 'Synthetic WSS analysis');
  });
  application = h.app;
  const saveCheckpoint = h.app.runtime.saveCheckpoint.bind(h.app.runtime);
  let received = 0;
  h.app.runtime.saveCheckpoint = (taskId, key, value) => {
    if (key === 'competition-cloud-received' && value) {
      received++;
      assert.ok(h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight'));
      assert.equal(h.app.runtime.getTask(taskId).state, 'running');
      assert.doesNotMatch(JSON.stringify(value), /Synthetic WSS analysis|Bearer|payload"/);
    }
    if (key === 'competition-cloud-inflight' && value === null) {
      assert.equal(h.app.runtime.getTask(taskId).state, 'succeeded');
      assert.match(h.app.runtime.getTask(taskId).resultSummary, /Synthetic WSS analysis/);
    }
    return saveCheckpoint(taskId, key, value);
  };
  try {
    const client = new Client(h.app); await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Synthetic WSS analysis', conversationId: 'wss'},
      {idempotencyKey: 'wss-runtime-success'});
    const task = await waitState(h.app, taskId, ['succeeded', 'failed']);
    assert.equal(task.state, 'succeeded'); assert.match(task.resultSummary, /profile=huawei_ict_agentarts/);
    assert.equal(h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight'), null);
    assert.equal(h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-unknown'), undefined);
    assert.equal(h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-received'), null);
    assert.equal(received, 1);
    assert.equal(h.fetches.length, 0); assert.deepEqual(task.evidenceRefs, []);
  } finally { h.app.close(); }
  assert.equal(h.sockets[0].terminations, 1);
});

test('parsed proposals are committed before intent clears and confirmed continuation clears only after task success', async () => {
  let invocations = 0, executions = 0, clears = 0;
  const h = factory(':memory:', (frame, socket) => {
    if (frame.type !== 'invoke') return;
    invocations++; socket.accepted(frame);
    socket.result(frame, JSON.stringify(invocations === 1 ? syntheticProposal : {kind: 'text', text: 'Synthetic continuation consumed'}));
  }, syntheticToolOptions(async () => { executions++; return {value: 'synthetic local value'}; }));
  const saveCheckpoint = h.app.runtime.saveCheckpoint.bind(h.app.runtime);
  h.app.runtime.saveCheckpoint = (taskId, key, value) => {
    if (key === 'competition-cloud-inflight' && value === null) {
      clears++;
      if (clears === 1) {
        assert.equal(h.app.runtime.getTask(taskId).state, 'running');
        assert.equal(h.app.runtime.loadCheckpoint(taskId, 'competition-loop').pending.proposalId, syntheticProposal.proposalId);
        assert.equal(executions, 0);
      } else {
        assert.equal(h.app.runtime.getTask(taskId).state, 'succeeded');
        assert.match(h.app.runtime.getTask(taskId).resultSummary, /Synthetic continuation consumed/);
      }
    }
    return saveCheckpoint(taskId, key, value);
  };
  try {
    const client = new Client(h.app); await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Consume a synthetic continuation', conversationId: 'wss'},
      {idempotencyKey: 'wss-consumed-continuation'});
    assert.equal((await waitState(h.app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
    assert.equal(h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight'), null);
    const approval = (await client.call('approval.list', {taskId})).items[0];
    await client.call('authorization.respond', {approvalId: approval.approvalId,
      expectedRevision: approval.revision, decision: 'allow_once'});
    const task = await waitState(h.app, taskId, ['succeeded', 'failed', 'waiting_reconciliation']);
    assert.equal(task.state, 'succeeded'); assert.equal(executions, 1); assert.equal(invocations, 2); assert.equal(clears, 2);
    assert.equal(h.app.runtime.readToolExecutions(taskId)[0].state, 'confirmed');
    assert.equal(h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight'), null);
    assert.equal(h.fetches.length, 0);
  } finally { h.app.close(); }
});

test('a valid wire terminal with an invalid application result retains its send hold', async t => {
  for (const continuation of [false, true]) await t.test(`continuation=${continuation}`, async () => {
    let invocations = 0, executions = 0;
    const privateMarker = 'synthetic-rejected-cloud-body';
    const h = factory(':memory:', (frame, socket) => {
      if (frame.type !== 'invoke') return;
      invocations++; socket.accepted(frame);
      socket.result(frame, JSON.stringify(continuation && invocations === 1 ? syntheticProposal
        : {kind: 'text', text: privateMarker, verification: 'verified'}));
    }, syntheticToolOptions(async () => { executions++; return {value: 'synthetic local value'}; }));
    try {
      const client = new Client(h.app); await client.connect();
      const {taskId} = await client.call('task.submit', {goal: 'Reject a synthetic application claim', conversationId: 'wss'},
        {idempotencyKey: `wss-invalid-application-${continuation}`});
      if (continuation) {
        assert.equal((await waitState(h.app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
        const approval = (await client.call('approval.list', {taskId})).items[0];
        await client.call('authorization.respond', {approvalId: approval.approvalId,
          expectedRevision: approval.revision, decision: 'allow_once'});
      }
      const task = await waitState(h.app, taskId, ['failed', 'waiting_reconciliation']);
      assert.equal(task.resultSummary, undefined);
      const inflight = h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight');
      const received = h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-received');
      assert.ok(inflight); assert.equal(received.requestId, inflight.requestId); assert.equal(received.accepted, true);
      assert.doesNotMatch(JSON.stringify(received), new RegExp(privateMarker + '|Bearer|payload"'));
      assert.throws(() => h.app.resumeTask(taskId), {code: 'RESULT_UNKNOWN'});
      assert.throws(() => h.app.resumeConfirmedTask(taskId), {code: 'RESULT_UNKNOWN'});
      assert.equal(invocations, continuation ? 2 : 1); assert.equal(executions, continuation ? 1 : 0);
      assert.equal(h.fetches.length, 0); assert.equal(h.app.readEvents().some(event => event.type === 'task.completed'), false);
    } finally { h.app.close(); }
  });
});

// A separate process exits after SQLite commits the receipt, before the socket
// resolves the response or any Runtime consumer can commit the application result.
const terminalCrashProgram = `
import {writeFileSync} from 'node:fs';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from ${JSON.stringify(new URL('../dist/application.js', import.meta.url).href)};
import {SyntheticWebSocket} from ${JSON.stringify(new URL('../../../packages/coordination/test/fixtures/websocket.mjs', import.meta.url).href)};
const [path, roundText] = process.argv.slice(1), crashRound = Number(roundText);
const proposal = ${JSON.stringify(syntheticProposal)}, descriptor = ${JSON.stringify(syntheticDescriptor)};
let invocations = 0, executions = 0, received = 0;
const app = createAgentArtsRuntimeApplication({...${JSON.stringify(target)}, path,
  authorizationProvider: {read: async () => 'Bearer synthetic'}, responseMode: 'tool-proposal-json',
  websocketFactory: () => new SyntheticWebSocket((frame, socket) => {
    if (frame.type !== 'invoke') return;
    invocations++; socket.accepted(frame);
    socket.result(frame, JSON.stringify(crashRound === 2 && invocations === 1 ? proposal
      : {kind: 'text', text: 'Synthetic terminal not yet consumed'}));
  }), fetchImpl: async () => { throw Error('Unexpected fallback'); },
  competitionToolExports: [{toolName: proposal.toolName, toolVersion: proposal.toolVersion,
    exportPolicyVersion: 'synthetic-v1', accepts: () => true, project: ({result}) => ({value: result.value})}],
  tools: [{descriptor, execute: async () => { executions++; return {value: 'synthetic local value'}; }}]});
const save = app.runtime.saveCheckpoint.bind(app.runtime);
app.runtime.saveCheckpoint = (taskId, key, value) => {
  save(taskId, key, value);
  if (key === 'competition-cloud-received' && value && ++received === crashRound) {
    writeFileSync(path + '.crash.json', JSON.stringify({taskId, invocations, executions, received}));
    process.exit(86);
  }
};
const client = new Client(app); await client.connect();
const {taskId} = await client.call('task.submit', {goal: 'Synthetic terminal crash', conversationId: 'wss'},
  {idempotencyKey: 'wss-terminal-crash-' + crashRound});
if (crashRound === 2) {
  for (let i = 0; i < 200 && app.runtime.getTask(taskId).state !== 'waiting_approval'; i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  const approval = (await client.call('approval.list', {taskId})).items[0];
  await client.call('authorization.respond', {approvalId: approval.approvalId,
    expectedRevision: approval.revision, decision: 'allow_once'});
}
await new Promise(resolve => setTimeout(resolve, 5000));
throw Error('Terminal crash hook was not reached');
`;

function runTerminalCrash(path, round) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', terminalCrashProgram, path, String(round)],
      {stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true});
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const timeout = setTimeout(() => child.kill(), 60_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', (status, signal) => { clearTimeout(timeout); resolve({status, signal, stderr}); });
  });
}

test('a process crash after terminal receipt cannot resend an initial result or confirmed continuation on restart', async t => {
  for (const round of [1, 2]) await t.test(`terminalRound=${round}`, async () => {
    const base = new URL('../../../.cache/agentarts-websocket-runtime-tests/', import.meta.url);
    await mkdir(base, {recursive: true});
    const directory = await mkdtemp(new URL('terminal-crash-', base));
    const path = directory + '/runtime.sqlite';
    let reopened;
    try {
      const child = await runTerminalCrash(path, round);
      assert.equal(child.signal, null);
      assert.equal(child.status, 86, child.stderr);
      const crash = JSON.parse(await readFile(path + '.crash.json', 'utf8'));
      assert.equal(crash.invocations, round); assert.equal(crash.received, round); assert.equal(crash.executions, round - 1);
      let resumedExecutions = 0;
      reopened = factory(path, () => { throw Error('A received terminal must not be resent'); },
        syntheticToolOptions(async () => { resumedExecutions++; return {value: 'must not reread'}; }));
      const {app} = reopened;
      assert.equal(app.runtime.getTask(crash.taskId).state, 'running');
      assert.equal(app.runtime.recoverInterruptedTasks().length, 1);
      const task = app.runtime.getTask(crash.taskId);
      assert.equal(task.state, 'waiting_reconciliation'); assert.equal(task.error.code, 'RESULT_UNKNOWN');
      const inflight = app.runtime.loadCheckpoint(task.taskId, 'competition-cloud-inflight');
      const received = app.runtime.loadCheckpoint(task.taskId, 'competition-cloud-received');
      assert.ok(inflight); assert.equal(received.requestId, inflight.requestId); assert.equal(received.accepted, true);
      assert.doesNotMatch(JSON.stringify(received), /Synthetic terminal|Bearer|payload"/);
      assert.equal(app.runtime.loadCheckpoint(task.taskId, 'competition-cloud-unknown'), undefined);
      if (round === 2) {
        const loop = app.runtime.loadCheckpoint(task.taskId, 'competition-loop');
        assert.equal(loop.pending, undefined); assert.equal(loop.continuation.proposalId, syntheticProposal.proposalId);
        assert.equal(loop.receipts.length, 1); assert.equal(app.runtime.readToolExecutions(task.taskId)[0].state, 'confirmed');
      }
      assert.throws(() => app.resumeTask(task.taskId), {code: 'RESULT_UNKNOWN'});
      assert.throws(() => app.resumeConfirmedTask(task.taskId), {code: 'RESULT_UNKNOWN'});
      const client = new Client(app); await client.connect();
      const duplicate = await client.call('task.submit', {goal: 'Synthetic terminal crash', conversationId: 'wss'},
        {idempotencyKey: 'wss-terminal-crash-' + round});
      assert.equal(duplicate.taskId, task.taskId);
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(reopened.sockets.length, 0); assert.equal(reopened.fetches.length, 0); assert.equal(resumedExecutions, 0);
      assert.equal(app.readEvents().some(event => event.type === 'task.completed'), false);
    } finally { reopened?.app.close(); await rm(directory, {recursive: true, force: true}); }
  });
});

test('post-send disconnect enters waiting_reconciliation and persists only correlation identity across restart', async () => {
  const base = new URL('../../../.cache/agentarts-websocket-runtime-tests/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('unknown-', base));
  const path = directory + '/runtime.sqlite';
  const h = factory(path, (frame, socket) => {
    if (frame.type === 'invoke') { socket.accepted(frame); socket.disconnect(); }
  });
  let taskId;
  try {
    const client = new Client(h.app); await client.connect();
    ({taskId} = await client.call('task.submit', {goal: 'Synthetic disconnected invocation', conversationId: 'wss'},
      {idempotencyKey: 'wss-runtime-unknown'}));
    const task = await waitState(h.app, taskId, ['waiting_reconciliation', 'failed']);
    assert.equal(task.state, 'waiting_reconciliation'); assert.equal(task.error.code, 'RESULT_UNKNOWN');
    assert.equal(h.app.readEvents().some(event => event.type === 'task.completed'), false);
    const unknown = h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-unknown');
    assert.equal(unknown.accepted, true); assert.equal(typeof unknown.requestId, 'string');
    assert.doesNotMatch(JSON.stringify(unknown), /Bearer|Synthetic disconnected invocation|payload"/);
    assert.throws(() => h.app.resumeTask(taskId), {code: 'RESULT_UNKNOWN'});
    assert.throws(() => h.app.resumeConfirmedTask(taskId), {code: 'RESULT_UNKNOWN'});
    assert.equal(h.fetches.length, 0); assert.equal(h.sockets.length, 1);
  } finally { h.app.close(); }
  const reopened = factory(path, () => { throw Error('Recovered request must not resend'); });
  try {
    assert.equal(reopened.app.runtime.getTask(taskId).state, 'waiting_reconciliation');
    assert.throws(() => reopened.app.resumeTask(taskId), {code: 'RESULT_UNKNOWN'});
    assert.throws(() => reopened.app.resumeConfirmedTask(taskId), {code: 'RESULT_UNKNOWN'});
    assert.equal(reopened.sockets.length, 0); assert.equal(reopened.fetches.length, 0);
  } finally { reopened.app.close(); await rm(directory, {recursive: true, force: true}); }
});

test('cancelling after WSS dispatch keeps the unresolved invocation in reconciliation', async () => {
  const h = factory(':memory:', (frame, socket) => {
    if (frame.type === 'invoke') socket.accepted(frame);
  });
  try {
    const client = new Client(h.app); await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Synthetic cancelled invocation', conversationId: 'wss'},
      {idempotencyKey: 'wss-runtime-cancel-unknown'});
    for (let i = 0; i < 200 && !h.sockets[0]?.sent.some(frame => frame.type === 'invoke'); i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(h.sockets[0]?.sent.some(frame => frame.type === 'invoke'), true);
    await client.call('task.cancel', {taskId, reason: 'Synthetic cancellation'});
    const task = await waitState(h.app, taskId, ['waiting_reconciliation', 'cancelled', 'failed']);
    assert.equal(task.state, 'waiting_reconciliation'); assert.equal(task.error.code, 'RESULT_UNKNOWN');
    const inflight = h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight');
    const unknown = h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-unknown');
    assert.equal(unknown.requestId, inflight.requestId); assert.equal(unknown.payloadDigest, inflight.payloadDigest);
    assert.equal(inflight.accepted, true); assert.equal(unknown.accepted, true);
    assert.equal(h.sockets[0].sent.filter(frame => frame.type === 'invoke').length, 1);
    assert.equal(h.sockets[0].sent.filter(frame => frame.type === 'cancel').length, 1);
    assert.throws(() => h.app.resumeTask(taskId), {code: 'RESULT_UNKNOWN'});
    assert.equal(h.fetches.length, 0);
    for (let i = 0; i < 200 && h.app.activeTaskCount; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(h.app.activeTaskCount, 0);
  } finally { h.app.close(); }
});

test('a confirmed local tool receipt cannot resend an unknown cloud continuation, including an interrupted-send intent', async t => {
  for (const inputHooks of [false, true]) await t.test(`inputHooks=${inputHooks}`, async () => {
  let executions = 0, invocations = 0;
  const proposal = {kind: 'tool_proposal', proposalId: 'synthetic-read', toolName: 'fixture.read',
    toolVersion: '1.0.0', arguments: {id: 'synthetic'}};
  const h = factory(':memory:', (frame, socket) => {
    if (frame.type !== 'invoke') return;
    invocations++; socket.accepted(frame);
    if (invocations === 1) socket.result(frame, JSON.stringify(proposal));
    else socket.disconnect();
  }, {responseMode: 'tool-proposal-json',
    ...(inputHooks ? {coordinationInput: {beforeCoordinationSend: () => {}}} : {}),
    competitionToolExports: [{toolName: proposal.toolName, toolVersion: proposal.toolVersion,
      exportPolicyVersion: 'synthetic-v1', accepts: () => true, project: ({result}) => ({value: result.value})}],
    tools: [{descriptor: {name: proposal.toolName, version: proposal.toolVersion,
      inputSchema: {type: 'object', required: ['id'], properties: {id: {type: 'string'}}},
      outputSchema: {type: 'object', required: ['value'], properties: {value: {type: 'string'}}},
      sideEffect: 'read', requiredScopes: ['fixture:read'], idempotencySupport: true,
      recoverySupport: true, requiresPresence: false},
      execute: async () => { executions++; return {value: 'confirmed local data'}; }}]});
  try {
    const client = new Client(h.app); await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Read synthetic item', conversationId: 'wss'},
      {idempotencyKey: 'wss-confirmed-tool'});
    assert.equal((await waitState(h.app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
    const approval = (await client.call('approval.list', {taskId})).items[0];
    await client.call('authorization.respond', {approvalId: approval.approvalId,
      expectedRevision: approval.revision, decision: 'allow_once'});
    const task = await waitState(h.app, taskId, ['waiting_reconciliation', 'failed']);
    assert.equal(task.state, 'waiting_reconciliation'); assert.equal(task.error.code, 'RESULT_UNKNOWN');
    assert.equal(h.app.runtime.loadCheckpoint(taskId, 'competition-export-withheld'), undefined);
    assert.equal(executions, 1); assert.equal(invocations, 2);
    assert.equal(h.app.runtime.readToolExecutions(taskId)[0].state, 'confirmed');
    assert.throws(() => h.app.resumeConfirmedTask(taskId), {code: 'RESULT_UNKNOWN'});
    assert.equal(invocations, 2); assert.equal(executions, 1);
    // The durable pre-send intent independently blocks the restart window,
    // even if no transport-error callback got a chance to write cloud-unknown.
    h.app.runtime.saveCheckpoint(taskId, 'competition-cloud-unknown', null);
    assert.ok(h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight'));
    assert.throws(() => h.app.resumeTask(taskId), {code: 'RESULT_UNKNOWN'});
    assert.throws(() => h.app.resumeConfirmedTask(taskId), {code: 'RESULT_UNKNOWN'});
    assert.equal(invocations, 2); assert.equal(h.fetches.length, 0);
  } finally { h.app.close(); }
  });
});

test('HTTPS fallback delivery ambiguity uses the same durable unknown guard instead of reopening the loop', async () => {
  const sockets = [], fetches = [];
  const app = createAgentArtsRuntimeApplication({...target, path: ':memory:',
    authorizationProvider: {read: async () => 'Bearer synthetic'},
    websocketFactory: () => {
      const socket = new SyntheticWebSocket(undefined, {autoReady: false}); sockets.push(socket);
      queueMicrotask(() => socket.emit('error', Error('synthetic network'))); return socket;
    },
    fetchImpl: async (_url, init) => { fetches.push(init);
      const taskId = app.runtime.listTasks({}).items[0].taskId;
      assert.equal(app.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight').requestId, init.headers['X-Request-Id']);
      throw Error('Synthetic HTTP delivery unknown'); }});
  try {
    const client = new Client(app); await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Synthetic HTTP fallback', conversationId: 'wss'},
      {idempotencyKey: 'https-fallback-unknown'});
    const task = await waitState(app, taskId, ['waiting_reconciliation', 'failed']);
    assert.equal(task.state, 'waiting_reconciliation'); assert.equal(task.error.code, 'RESULT_UNKNOWN');
    assert.equal(fetches.length, 1); assert.equal(sockets[0].sent.length, 0);
    assert.throws(() => app.resumeTask(taskId), {code: 'RESULT_UNKNOWN'});
    assert.equal(fetches.length, 1);
  } finally { app.close(); }
});


test('refused close preserves an accepted active WSS task and its original result', async () => {
  let originalFrame, originalSocket;
  const h = factory(':memory:', (frame, socket) => {
    if (frame.type !== 'invoke') return;
    originalFrame = frame; originalSocket = socket; socket.accepted(frame);
  });
  let taskId;
  try {
    const client = new Client(h.app); await client.connect();
    ({taskId} = await client.call('task.submit', {goal: 'Synthetic active close guard', conversationId: 'wss'},
      {idempotencyKey: 'wss-close-refused'}));
    for (let i = 0; i < 200 && !originalFrame; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(originalFrame);
    assert.equal(h.app.runtime.getTask(taskId).state, 'running');
    assert.equal(h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight').accepted, true);
    assert.throws(() => h.app.close(), {code: 'REVISION_CONFLICT'});
    assert.equal(originalSocket.terminations, 0);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(h.app.runtime.getTask(taskId).state, 'running');
    assert.equal(h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-unknown'), undefined);
    originalSocket.result(originalFrame, 'Original accepted task completed');
    const task = await waitState(h.app, taskId, ['succeeded', 'failed', 'waiting_reconciliation']);
    assert.equal(task.state, 'succeeded');
    assert.match(task.resultSummary, /Original accepted task completed/);
    assert.equal(h.app.runtime.loadCheckpoint(taskId, 'competition-cloud-inflight'), null);
    assert.equal(h.fetches.length, 0);
  } finally {
    if (originalFrame && originalSocket.terminations === 0) originalSocket.result(originalFrame, 'Cleanup original result');
    if (taskId) await waitState(h.app, taskId, ['succeeded', 'failed', 'waiting_reconciliation']);
    h.app.close();
  }
  assert.equal(originalSocket.terminations, 1);
});

test('idle WSS application close requires no connection or HTTP fallback', () => {
  const h = factory(':memory:', () => {throw Error('unexpected invocation');});
  h.app.close();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.fetches.length, 0);
});
