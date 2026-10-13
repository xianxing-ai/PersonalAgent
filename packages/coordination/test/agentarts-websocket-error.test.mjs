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
