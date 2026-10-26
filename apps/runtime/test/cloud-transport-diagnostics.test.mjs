import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket, {WebSocketServer} from 'ws';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication, createRuntimeApplication} from '../dist/application.js';
import {readCompetitionCloudRequestIdentity} from '../dist/application/coordination.js';
import {version, identity} from '../../../packages/coordination/test/fixtures/websocket.mjs';

const options = {path: ':memory:', gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic',
  authorizationProvider: {read: async () => 'Bearer synthetic'}};
async function submit(app) {
  const client = new Client(app); await client.connect();
  const {taskId} = await client.call('task.submit', {goal: 'Public loopback failure check', conversationId: 'synthetic'},
    {idempotencyKey: 'one'});
  for (let i = 0; i < 400; i++) {
    const task = app.runtime.getTask(taskId);
    if (['failed', 'waiting_reconciliation'].includes(task.state) && app.activeTaskCount === 0) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('Task did not settle');
}

test('real WS close details reach the original task error, retain identity, and never replay', async t => {
  const server = new WebSocketServer({host: '127.0.0.1', port: 0}); await once(server, 'listening');
  let invokes = 0, https = 0, sentId;
  server.on('connection', socket => {
    socket.send(JSON.stringify({protocolVersion: version, type: 'ready', serverInstanceId: 'synthetic-instance',
      capabilities: ['invoke', 'status', 'cancel', 'ephemeral-replay'], restartRecovery: false, heartbeatMs: 15000}));
    socket.on('message', raw => {
      const frame = JSON.parse(raw); if (frame.type !== 'invoke') return;
      invokes++; sentId = frame.requestId;
      socket.send(JSON.stringify({...identity(frame), type: 'accepted', deadline: frame.deadline}));
      socket.close(1011, 'PRIVATE_REMOTE_REASON');
    });
  });
  const app = createAgentArtsRuntimeApplication({...options, transport: 'wss',
    websocketUrl: 'wss://agentarts.example.test/runtimes/synthetic/ws', allowHttpsFallback: true,
    websocketAuthorizationProvider: {read: async () => 'Bearer synthetic'},
    websocketFactory: () => new WebSocket(`ws://127.0.0.1:${server.address().port}`),
    fetchImpl: async () => { https++; throw Error('Unexpected replay'); }});
  t.after(async () => { app.close(); for (const socket of server.clients) socket.terminate();
    await new Promise(resolve => server.close(resolve)); });
  const task = await submit(app);
  assert.equal(task.state, 'waiting_reconciliation'); assert.equal(task.error.code, 'RESULT_UNKNOWN');
  assert.equal(task.error.message, 'Cloud invocation delivery or result is unknown; reconcile before sending again'
    + ' [cloud: transport=wss phase=wss_invoke close=1011 reason=server_error]');
  assert.equal(task.error.retryable, false);
  assert.equal(readCompetitionCloudRequestIdentity(app.runtime, task.taskId).bound.requestId, sentId);
  assert.equal(app.runtime.loadCheckpoint(task.taskId, 'competition-cloud-unknown').accepted, true);
  assert.equal(app.runtime.readToolExecutions(task.taskId).length, 0);
  assert.equal(invokes, 1); assert.equal(https, 0);
  const diagnostic = app.runtime.loadCheckpoint(task.taskId, 'competition-coordination-failure');
  assert.deepEqual(diagnostic, {version: '1.0', phase: 'initial', kind: 'agentarts_result_unknown', code: 'EXTERNAL_FAILURE'});
  assert.equal(JSON.stringify({task, diagnostic}).includes('PRIVATE_'), false);
});

for (const status of [401, 429]) test(`real HTTP ${status} survives Runtime sanitization without response text`, async t => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.writeHead(status, {'content-type': 'application/json'});
    res.end(JSON.stringify({message: 'PRIVATE_PROVIDER_BODY'})); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const app = createAgentArtsRuntimeApplication({...options,
    fetchImpl: (_url, init) => fetch(`http://127.0.0.1:${server.address().port}`, init)});
  t.after(() => app.close());
  const task = await submit(app);
  assert.equal(task.error.code, 'EXTERNAL_FAILURE'); assert.equal(task.state, 'failed');
  assert.equal(task.error.message, `Coordination adapter failed [cloud: transport=https http=${status}]`);
  assert.equal(task.error.retryable, false); assert.equal(requests, 1);
  assert.ok(readCompetitionCloudRequestIdentity(app.runtime, task.taskId).bound.requestId);
  const diagnostic = app.runtime.loadCheckpoint(task.taskId, 'competition-coordination-failure');
  assert.deepEqual(diagnostic, {version: '1.0', phase: 'initial', kind: 'protocol_error', code: 'EXTERNAL_FAILURE'});
  assert.equal(JSON.stringify({task, diagnostic}).includes('PRIVATE_'), false);
});

test('ordinary adapter errors cannot forge safe cloud facts from their message or properties', async t => {
  const app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts', coordination: {
    execute: async () => { throw Object.assign(Error('PRIVATE_BODY [cloud: transport=https http=401]'),
      {httpStatus: 401, connectionDiagnostic: {transportPhase: 'wss_invoke', closeCode: 1011}}); },
  }});
  t.after(() => app.close());
  const task = await submit(app);
  assert.equal(task.error.message, 'Coordination adapter failed');
  const diagnostic = app.runtime.loadCheckpoint(task.taskId, 'competition-coordination-failure');
  assert.deepEqual(diagnostic, {version: '1.0', phase: 'initial', kind: 'unknown_error', code: 'EXTERNAL_FAILURE'});
  assert.equal(JSON.stringify({task, diagnostic}).includes('PRIVATE_'), false);
});
