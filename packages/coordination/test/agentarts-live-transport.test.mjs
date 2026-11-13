import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket, {WebSocketServer} from 'ws';
import {AgentArtsCloudAgentPort, AgentArtsResultUnknownError, formatAgentArtsFailureDetail} from '../dist/index.js';
import {version, identity} from './fixtures/websocket.mjs';

// Real loopback sockets with synthetic payloads. These do not validate Huawei's gateway or TLS proxy.
const configuration = {gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic',
  transport: 'wss', websocketUrl: 'wss://agentarts.example.test/runtimes/synthetic/ws', allowHttpsFallback: true};
const request = (signal = new AbortController().signal, ms = 1500) => ({taskId: 'loopback-session', revision: 1,
  goal: 'Public loopback transport verification', deadline: new Date(Date.now() + ms).toISOString(), signal});
const IGNORED_CLOSE_ERROR_CODES = new Set(['ECONNRESET', 'ECONNABORTED', 'EPIPE']);

function isIgnorableCloseError(error, socket, closing) {
  const isClosing = closing || (socket !== undefined && socket.readyState >= WebSocket.CLOSING);
  return isClosing && Boolean(error && typeof error === 'object' && 'code' in error && IGNORED_CLOSE_ERROR_CODES.has(error.code));
}

async function websocketFixture(t, respond) {
  const server = new WebSocketServer({host: '127.0.0.1', port: 0});
  let closing = false;
  let serverError;
  const sockets = new Set();
  server.on('error', error => {
    if (!isIgnorableCloseError(error, undefined, closing)) serverError ??= error;
  });
  await once(server, 'listening');
  let invokes = 0, fallbacks = 0;
  const diagnostics = [];
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', error => {
      if (!isIgnorableCloseError(error, socket, closing)) serverError ??= error;
    });
    socket.send(JSON.stringify({protocolVersion: version, type: 'ready', serverInstanceId: 'synthetic-instance',
      capabilities: ['invoke', 'status', 'cancel', 'ephemeral-replay'], restartRecovery: false, heartbeatMs: 15000}));
    socket.on('message', raw => {
      const frame = JSON.parse(raw);
      if (frame.type === 'invoke') {
        invokes++;
        socket.send(JSON.stringify({...identity(frame), type: 'accepted', deadline: frame.deadline}));
      }
      respond(frame, socket);
    });
  });
  const port = new AgentArtsCloudAgentPort(configuration, {read: async () => 'Bearer synthetic'},
    async () => { fallbacks++; throw Error('Unexpected HTTPS replay'); }, undefined, undefined,
    receipt => diagnostics.push(receipt), {factory: () => new WebSocket(`ws://127.0.0.1:${server.address().port}`)});
  t.after(async () => {
    closing = true;
    const closePromises = [...sockets].map(socket => socket.readyState === WebSocket.CLOSED
      ? Promise.resolve()
      : new Promise(resolve => socket.once('close', resolve)));
    port.close();
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.CLOSED) {
        try { socket.terminate(); } catch { /* Best-effort socket cleanup after client port close. */ }
      }
    }
    await Promise.all(closePromises);
    await new Promise(resolve => server.close(resolve));
    if (serverError) throw serverError;
  });
  return {port, diagnostics, counts: () => ({invokes, fallbacks})};
}

test('real peer close preserves safe code and phase without replay or remote close text', {timeout: 5000}, async t => {
  for (const abnormal of [false, true]) await t.test(abnormal ? 'abnormal 1006' : 'server 1011', async t => {
    const h = await websocketFixture(t, (frame, socket) => {
      if (frame.type === 'invoke') abnormal ? socket.terminate() : socket.close(1011, 'PRIVATE_TOKEN=synthetic-secret');
    });
    await assert.rejects(h.port.invoke(request()), error => {
      assert.ok(error instanceof AgentArtsResultUnknownError); assert.equal(error.receipt.accepted, true);
      assert.equal(formatAgentArtsFailureDetail(error), `cloud: transport=wss phase=wss_invoke close=${abnormal ? 1006 : 1011}`
        + ` reason=${abnormal ? 'abnormal' : 'server_error'}`);
      return true;
    });
    assert.equal(h.diagnostics[0].closeCode, abnormal ? 1006 : 1011);
    assert.equal(h.diagnostics[0].closeReason, abnormal ? 'abnormal' : 'server_error');
    assert.equal(h.diagnostics[0].transportPhase, 'wss_invoke');
    assert.equal(h.diagnostics[0].resultUnknown, true);
    assert.match(h.diagnostics[0].requestId, /^[0-9a-f-]{36}$/);
    assert.equal(JSON.stringify(h.diagnostics).includes('PRIVATE_TOKEN'), false);
    assert.deepEqual(h.counts(), {invokes: 1, fallbacks: 0});
  });
});

test('real stalled WS settles at original deadline and caller cancellation sends cancel', {timeout: 5000}, async t => {
  for (const cancel of [false, true]) await t.test(cancel ? 'caller cancellation' : 'deadline', async t => {
    let sent, cancelled;
    const invoked = new Promise(resolve => { sent = resolve; });
    const cancellation = new Promise(resolve => { cancelled = resolve; });
    const h = await websocketFixture(t, (frame) => {
      if (frame.type === 'invoke') sent();
      if (frame.type === 'cancel') cancelled();
    });
    const controller = new AbortController();
    const result = assert.rejects(h.port.invoke(request(controller.signal, cancel ? 2000 : 200)), {code: cancel ? 'CANCELLED' : 'TIMEOUT'});
    await invoked;
    if (cancel) controller.abort();
    await result;
    await cancellation;
    assert.deepEqual(h.counts(), {invokes: 1, fallbacks: 0});
  });
});

test('real ws client automatically answers server ping while invocation is pending', {timeout: 5000}, async t => {
  let pong;
  const receivedPong = new Promise(resolve => { pong = resolve; });
  const h = await websocketFixture(t, (frame, socket) => {
    if (frame.type !== 'invoke') return;
    socket.once('pong', () => { pong(); socket.send(JSON.stringify({...identity(frame), type: 'result',
      events: [{event: 'message', data: {text: 'pong verified'}}, {event: 'task_end'}, {event: 'end'}]})); });
    socket.ping();
  });
  assert.equal((await h.port.invoke(request())).text, 'pong verified');
  await receivedPong;
});

test('real HTTP stall respects original deadline and earlier caller cancellation', {timeout: 5000}, async t => {
  for (const cancel of [false, true]) await t.test(cancel ? 'caller cancellation' : 'deadline', async t => {
    let entered;
    const arrival = new Promise(resolve => { entered = resolve; });
    const server = createServer((req, res) => { req.on('error', () => {}); req.resume(); entered(); });
    let httpError;
    server.on('error', error => { httpError ??= error; });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = new AgentArtsCloudAgentPort({gatewayUrl: configuration.gatewayUrl, runtimeName: configuration.runtimeName},
      {read: async () => 'Bearer synthetic'}, (_url, init) => fetch(`http://127.0.0.1:${server.address().port}`, init));
    t.after(async () => {
      port.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      if (httpError) throw httpError;
    });
    const controller = new AbortController();
    const result = assert.rejects(port.invoke(request(controller.signal, cancel ? 2000 : 200)), {code: cancel ? 'CANCELLED' : 'TIMEOUT'});
    await arrival;
    if (cancel) controller.abort();
    await result;
  });
});
