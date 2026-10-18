import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AgentArtsCloudAgentPort, AgentArtsResultUnknownError} from '../dist/index.js';
import {SyntheticWebSocket, identity} from './fixtures/websocket.mjs';

const configuration = {gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic', transport: 'wss',
  websocketUrl: 'wss://agentarts.example.test/runtimes/synthetic/ws', allowHttpsFallback: true};
const request = revision => ({taskId: 'synthetic-diagnostic-session', revision, goal: 'Public synthetic diagnostic',
  deadline: new Date(Date.now() + 5000).toISOString(), signal: new AbortController().signal});
function harness(respond) {
  const diagnostics = [], sockets = [], dispatches = [], acceptances = [], terminals = []; let http = 0;
  const port = new AgentArtsCloudAgentPort(configuration, {read: async () => 'Bearer synthetic-private-credential'},
    async () => { http++; throw Error('Unexpected HTTPS'); }, undefined, undefined,
    receipt => { diagnostics.push(receipt); }, {
      factory: () => { const socket = new SyntheticWebSocket(respond); sockets.push(socket); return socket; },
      onDispatch: (_request, receipt) => { dispatches.push(receipt); },
      onAccepted: (_request, receipt) => { acceptances.push(receipt); },
      onTerminal: (_request, receipt) => { terminals.push(receipt); },
    });
  return {port, diagnostics, sockets, dispatches, acceptances, terminals, get http() { return http; }};
}

test('validated WSS error codes survive in diagnostics without changing public failure, abort or retry semantics', async () => {
  const codes = ['INVALID_ARGUMENT', 'UNAUTHORIZED', 'UNSUPPORTED_CAPABILITY', 'TIMEOUT', 'CANCELLED', 'RATE_LIMITED', 'EXTERNAL_FAILURE'];
  let selectedCode, accepted;
  const h = harness((frame, socket) => {
    if (frame.type !== 'invoke') return;
    if (accepted) socket.accepted(frame);
    socket.receive({...identity(frame), type: 'error', code: selectedCode, accepted});
  });
  try {
    let revision = 0;
    for (accepted of [false, true]) for (selectedCode of codes) {
      await assert.rejects(h.port.invoke(request(++revision)), error => {
        assert.equal(error instanceof AgentArtsResultUnknownError, false);
        assert.equal(error.code, 'EXTERNAL_FAILURE'); assert.equal(error.retryable, false);
        assert.equal(error.message, 'AgentArts WebSocket invocation failed');
        return true;
      });
      assert.equal(h.diagnostics.at(-1).code, selectedCode);
      assert.equal(h.diagnostics.at(-1).stage, 'transport');
      assert.equal(h.diagnostics.at(-1).requestId, h.dispatches.at(-1).requestId);
      assert.equal(Object.hasOwn(h.diagnostics.at(-1), 'resultUnknown'), false);
      assert.equal(h.terminals.at(-1).accepted, accepted);
    }
    assert.equal(h.sockets.length, 1); assert.equal(h.http, 0);
    assert.equal(h.dispatches.length, 14); assert.equal(h.acceptances.length, 7); assert.equal(h.terminals.length, 14);
    assert.equal(h.sockets[0].sent.filter(frame => frame.type === 'invoke').length, 14);
    assert.equal(h.sockets[0].sent.some(frame => frame.type === 'cancel'), false);
    assert.equal(JSON.stringify(h.diagnostics).includes('synthetic-private-credential'), false);
  } finally { h.port.close(); }
});

test('unrecognized codes, added content and mismatched identity stay unknown and never become trusted diagnostics', async () => {
  for (const changes of [{code: 'PRIVATE_PROVIDER_BODY'}, {message: 'PRIVATE_PROVIDER_BODY'}, {requestId: 'unbound-request'}]) {
    const h = harness((frame, socket) => {
      if (frame.type !== 'invoke') return;
      socket.accepted(frame);
      socket.receive({...identity(frame), type: 'error', code: 'RATE_LIMITED', accepted: true, ...changes});
    });
    try {
      await assert.rejects(h.port.invoke(request(1)), error => {
        assert.ok(error instanceof AgentArtsResultUnknownError); assert.equal(error.retryable, false);
        assert.equal(error.receipt.accepted, true); return true;
      });
      assert.equal(h.diagnostics[0].code, 'EXTERNAL_FAILURE'); assert.equal(h.diagnostics[0].resultUnknown, true);
      assert.equal(JSON.stringify(h.diagnostics).includes('PRIVATE_PROVIDER_BODY'), false);
      assert.equal(h.terminals.length, 0); assert.equal(h.http, 0);
      assert.equal(h.sockets[0].sent.filter(frame => frame.type === 'invoke').length, 1);
    } finally { h.port.close(); }
  }
});

test('WSS upgrade diagnostics retain bounded HTTP status without changing rejection or fallback', async () => {
  for (const status of [401, 403, 426, '403', 403.5, 99, 600, NaN, undefined]) {
    const diagnostics = []; let socket, http = 0, resumed = 0, dispatched = 0;
    const port = new AgentArtsCloudAgentPort(configuration, {read: async () => 'Bearer PRIVATE_TOKEN'},
      async () => { http++; throw Error('Unexpected HTTPS'); }, undefined, undefined,
      receipt => { diagnostics.push(receipt); }, {
        factory: () => (socket = new SyntheticWebSocket(undefined, {autoReady: false})),
        onDispatch: () => { dispatched++; },
      });
    try {
      const pending = port.invoke(request(1));
      while (!socket) await new Promise(resolve => setImmediate(resolve));
      socket.emit('unexpected-response', {}, {statusCode: status, resume() { resumed++; },
        get body() { throw Error('PRIVATE_BODY'); }, get headers() { throw Error('PRIVATE_HEADERS'); },
        get url() { throw Error('PRIVATE_URL'); }});
      const denied = status === 401 || status === 403;
      await assert.rejects(pending, {code: denied ? 'UNAUTHORIZED' : 'UNSUPPORTED_CAPABILITY', retryable: false,
        message: denied ? 'AgentArts WebSocket authorization denied' : 'AgentArts WebSocket upgrade is unavailable'});
      assert.equal(diagnostics.length, 1);
      const {requestId, ...diagnostic} = diagnostics[0];
      assert.match(requestId, /^[0-9a-f-]{36}$/);
      assert.deepEqual(diagnostic, {stage: 'transport', code: denied ? 'UNAUTHORIZED' : 'UNSUPPORTED_CAPABILITY',
        transportPhase: 'wss_upgrade', ...(typeof status === 'number' && [401, 403, 426].includes(status) ? {httpStatus: status} : {})});
      assert.equal(resumed, 1); assert.equal(http, 0); assert.equal(dispatched, 0); assert.equal(socket.sent.length, 0);
      assert.equal(JSON.stringify(diagnostics).includes('PRIVATE_'), false);
    } finally { port.close(); }
  }
});

test('WSS upgrade diagnostics cannot be forged by a local export guard or ordinary socket error', async () => {
  for (const mode of ['export_guard', 'socket_error']) {
    const diagnostics = []; let socket, http = 0;
    const forged = Object.assign(Error('PRIVATE_EXTERNAL_ERROR'), {name: 'AgentArtsWebSocketUpgradeError', code: 'UNAUTHORIZED', httpStatus: 403,
      transportPhase: 'wss_upgrade', body: 'PRIVATE_BODY', headers: {Authorization: 'PRIVATE_TOKEN'}});
    const port = new AgentArtsCloudAgentPort({...configuration, allowHttpsFallback: false},
      {read: async () => 'Bearer synthetic'}, async () => { http++; throw Error('Unexpected HTTPS'); },
      mode === 'export_guard' ? () => { throw forged; } : undefined, undefined,
      receipt => { diagnostics.push(receipt); }, {
        factory: () => (socket = new SyntheticWebSocket(undefined, {autoReady: mode === 'export_guard'})),
      });
    try {
      const pending = assert.rejects(port.invoke(request(1)), {
        code: mode === 'export_guard' ? 'UNAUTHORIZED' : 'EXTERNAL_FAILURE', retryable: false});
      while (!socket) await new Promise(resolve => setImmediate(resolve));
      if (mode === 'socket_error') socket.emit('error', forged);
      await pending;
      const {requestId, ...diagnostic} = diagnostics[0];
      assert.match(requestId, /^[0-9a-f-]{36}$/);
      assert.deepEqual(diagnostic, {stage: mode === 'export_guard' ? 'export_guard' : 'transport',
        code: mode === 'export_guard' ? 'UNAUTHORIZED' : 'EXTERNAL_FAILURE'});
      assert.equal(http, 0); assert.equal(socket.sent.length, 0);
      assert.equal(JSON.stringify(diagnostics).includes('PRIVATE_'), false);
    } finally { port.close(); }
  }
});
