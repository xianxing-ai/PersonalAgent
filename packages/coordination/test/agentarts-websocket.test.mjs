import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AgentArtsCloudAgentPort, AgentArtsResultUnknownError, CompetitionCoordinator} from '../dist/index.js';
import {SyntheticWebSocket, identity, events} from './fixtures/websocket.mjs';

const config = {gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic', transport: 'wss',
  websocketUrl: 'wss://agentarts.example.test/runtimes/synthetic/ws'};
const request = (overrides = {}) => ({taskId: 'private-local-task', revision: 1, goal: 'Analyze synthetic data',
  deadline: new Date(Date.now() + 5000).toISOString(), signal: new AbortController().signal, ...overrides});
const answer = (frame, socket) => {
  if (frame.type === 'invoke') { socket.accepted(frame); socket.result(frame); }
};

function harness({respond = answer, autoReady = true, config: overrides = {}, beforeSend,
  beforeCatalog, authorization = () => 'Bearer synthetic-outer', appAuthorization} = {}) {
  const sockets = [], connects = [], states = [], http = [];
  let authorizationReads = 0;
  const port = new AgentArtsCloudAgentPort({...config, ...overrides},
    {read: async () => { authorizationReads++; return authorization(); }},
    async (url, init) => { http.push({url, init}); return new Response(JSON.stringify(events('HTTPS answer')),
      {headers: {'content-type': 'application/json'}}); }, beforeSend, beforeCatalog, undefined,
    {...(appAuthorization ? {authorizationProvider: {read: async () => appAuthorization()}} : {}),
      factory: (url, options) => { connects.push({url, options});
        const socket = new SyntheticWebSocket(respond, {autoReady}); sockets.push(socket); return socket; },
      onState: state => states.push(state)});
  return {port, sockets, connects, states, http, get reads() { return authorizationReads; }};
}

test('WSS reuses a session across invocations, re-reads credentials, and closes all resources', async () => {
  const h = harness({appAuthorization: () => 'Bearer synthetic-app'});
  try {
    assert.deepEqual(await h.port.invoke(request()), {kind: 'text', text: 'Synthetic answer', verification: 'unverified'});
    await h.port.invoke(request({revision: 2}));
    assert.equal(h.sockets.length, 1);
    assert.equal(h.reads, 2);
    assert.equal(h.http.length, 0);
    const {options} = h.connects[0];
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.followRedirects, false);
    assert.equal(options.perMessageDeflate, false);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-outer');
    assert.equal(options.headers['X-PA-Agent-Token'], 'Bearer synthetic-app');
    const invocations = h.sockets[0].sent.filter(frame => frame.type === 'invoke');
    assert.equal(invocations.length, 2);
    assert.notEqual(invocations[0].requestId, invocations[1].requestId);
    assert.equal(invocations[0].sessionId, invocations[1].sessionId);
    assert.equal(invocations[0].sessionId.includes('private'), false);
    assert.deepEqual(invocations[0].payload, {query: 'Analyze synthetic data'});
    assert.equal(JSON.stringify(h.states).includes('synthetic-app'), false);
  } finally { h.port.close(); }
  assert.equal(h.sockets[0].terminations, 1);
  await assert.rejects(h.port.invoke(request()), {code: 'UNSUPPORTED_CAPABILITY'});
});

test('changed credentials replace the session connection rather than reuse stale authorization', async () => {
  let token = 'Bearer first-synthetic';
  const h = harness({authorization: () => token});
  try {
    await h.port.invoke(request()); token = 'Bearer replacement-synthetic';
    await h.port.invoke(request({revision: 2}));
    assert.equal(h.sockets.length, 2);
    assert.equal(h.sockets[0].terminations, 1);
    assert.equal(h.connects[1].options.headers.Authorization, token);
  } finally { h.port.close(); }
});

test('no query leaves during handshake; dynamic directory and final export permission are rechecked after ready', async () => {
  let allowed = true, checks = 0;
  const tools = [{name: 'fixture.read', version: '1.0.0', inputSchema: {type: 'object'}}];
  const h = harness({autoReady: false, config: {responseMode: 'tool-proposal-json', initialRequestMode: 'goal-with-tools-json'},
    beforeCatalog: async () => { checks++; }, beforeSend: () => { if (!allowed) throw Error('private denial'); }});
  try {
    const pending = h.port.invoke(request({availableTools: tools}));
    while (h.sockets.length === 0) await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.sockets[0].sent.length, 0); assert.equal(checks, 0);
    allowed = false; h.sockets[0].ready();
    await assert.rejects(pending, error => error.code === 'UNAUTHORIZED' && !error.message.includes('private denial'));
    assert.equal(checks, 1); assert.equal(h.sockets[0].sent.length, 0); assert.equal(h.http.length, 0);
  } finally { h.port.close(); }
});

test('an invoke-never-sent connection error visibly uses the same HTTPS target when opted in', async () => {
  const h = harness({autoReady: false, config: {allowHttpsFallback: true}});
  try {
    const pending = h.port.invoke(request());
    while (h.sockets.length === 0) await new Promise(resolve => setImmediate(resolve));
    h.sockets[0].emit('error', Error('private transport failure'));
    assert.equal((await pending).text, 'HTTPS answer');
    assert.equal(h.http.length, 1);
    assert.equal(h.http[0].url, 'https://agentarts.example.test/runtimes/synthetic/invocations');
    assert.equal(h.http[0].init.headers['X-PA-Agent-Token'], 'Bearer synthetic-outer');
    assert.deepEqual(JSON.parse(h.http[0].init.body), {query: 'Analyze synthetic data'});
    assert.equal(h.states.some(state => state.state === 'https_fallback'), true);
  } finally { h.port.close(); }
});

test('no fallback when disabled, on authentication rejection, or on incompatible protocol', async t => {
  for (const mode of ['disabled', '401', '403', 'protocol']) await t.test(mode, async () => {
    const h = harness({autoReady: false, config: {allowHttpsFallback: mode !== 'disabled'}});
    try {
      const pending = h.port.invoke(request());
      while (h.sockets.length === 0) await new Promise(resolve => setImmediate(resolve));
      if (mode === 'disabled') h.sockets[0].emit('error', Error('network'));
      else if (mode === 'protocol') h.sockets[0].ready({protocolVersion: '9.0.0'});
      else h.sockets[0].emit('unexpected-response', {}, {statusCode: Number(mode), resume() {}});
      await assert.rejects(pending, {code: mode === '401' || mode === '403' ? 'UNAUTHORIZED' : 'EXTERNAL_FAILURE'});
      assert.equal(h.http.length, 0); assert.equal(h.sockets[0].sent.length, 0);
    } finally { h.port.close(); }
  });
});

test('a sent invocation without a result remains unknown with or without an accepted receipt; no HTTP replay', async t => {
  for (const accepted of [false, true]) await t.test(`accepted=${accepted}`, async () => {
    const h = harness({config: {allowHttpsFallback: true}, respond: (frame, socket) => {
      if (frame.type === 'invoke') { if (accepted) socket.accepted(frame); socket.disconnect(); }
    }});
    try {
      await assert.rejects(new CompetitionCoordinator(h.port).execute(request()), error => {
        assert.ok(error instanceof AgentArtsResultUnknownError);
        assert.equal(error.retryable, false); assert.equal(error.receipt.accepted, accepted);
        assert.equal('payload' in error.receipt, false); assert.equal('authorization' in error.receipt, false);
        return true;
      });
      assert.equal(h.http.length, 0); assert.equal(h.states.some(state => state.state === 'result_unknown'), true);
    } finally { h.port.close(); }
  });
});

test('cancellation sends a bound cancel, drops a late result, and preserves the reusable connection', async () => {
  let first;
  const h = harness({respond: (frame, socket) => {
    if (frame.type !== 'invoke') return;
    socket.accepted(frame);
    if (!first) first = frame; else socket.result(frame);
  }});
  try {
    const controller = new AbortController();
    const pending = h.port.invoke(request({signal: controller.signal}));
    while (!first) await new Promise(resolve => setImmediate(resolve));
    controller.abort(); await assert.rejects(pending, {code: 'CANCELLED'});
    const cancel = h.sockets[0].sent.find(frame => frame.type === 'cancel');
    assert.deepEqual(identity(cancel), identity(first));
    h.sockets[0].result(first, 'late private text');
    assert.equal((await h.port.invoke(request({revision: 2}))).text, 'Synthetic answer');
    assert.equal(h.sockets.length, 1);
  } finally { h.port.close(); }
});

test('the original deadline bounds a non-answering WSS request and setup cleans up on cancellation', async () => {
  const h = harness({respond: () => {}});
  try {
    await assert.rejects(h.port.invoke(request({deadline: new Date(Date.now() + 50).toISOString()})), {code: 'TIMEOUT'});
    assert.equal(h.http.length, 0);
    assert.equal(h.sockets[0].sent.some(frame => frame.type === 'cancel'), true);
  } finally { h.port.close(); }
  const setup = harness({autoReady: false});
  const controller = new AbortController();
  try {
    const pending = setup.port.invoke(request({signal: controller.signal}));
    while (setup.sockets.length === 0) await new Promise(resolve => setImmediate(resolve));
    controller.abort(); await assert.rejects(pending, {code: 'CANCELLED'});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(setup.sockets[0].terminations, 1);
  } finally { setup.port.close(); }
});

test('correlation tampering rejects and never turns a cloud result into trusted verification', async () => {
  const h = harness({respond: (frame, socket) => {
    if (frame.type === 'invoke') { socket.accepted(frame); socket.receive({...identity(frame), type: 'result',
      payloadDigest: '0'.repeat(64), events: events('tampered')}); }
  }});
  try { await assert.rejects(h.port.invoke(request()), AgentArtsResultUnknownError); assert.equal(h.http.length, 0); }
  finally { h.port.close(); }
  const app = harness({config: {responseMode: 'tool-proposal-json'}, respond: (frame, socket) => {
    if (frame.type === 'invoke') { socket.accepted(frame); socket.result(frame,
      JSON.stringify({kind: 'text', text: 'untrusted', verification: 'verified'})); }
  }});
  try { await assert.rejects(app.port.invoke(request()), {code: 'EXTERNAL_FAILURE'}); }
  finally { app.port.close(); }
});

test('invalid WSS targets fail before any credentials or connection', () => {
  for (const websocketUrl of ['ws://agentarts.example.test/runtimes/synthetic/ws',
    'wss://different.example.test/runtimes/synthetic/ws',
    'wss://agentarts.example.test/runtimes/other/ws',
    'wss://agentarts.example.test/runtimes/synthetic/invocations/other/ws',
    'wss://agentarts.example.test/runtimes/synthetic/ws/',
    'wss://agentarts.example.test/runtimes/other/../synthetic/ws',
    'wss://secret@agentarts.example.test/runtimes/synthetic/ws',
    `${config.websocketUrl}?token=secret`]) {
    assert.throws(() => new AgentArtsCloudAgentPort({...config, websocketUrl}, {read: async () => 'unused'}),
      {code: 'INVALID_ARGUMENT'});
  }
});

test('an explicitly configured PREFIX_MATCH candidate uses that exact WSS path without guessing another', async () => {
  const websocketUrl = 'wss://agentarts.example.test/runtimes/synthetic/invocations/ws';
  const h = harness({config: {websocketUrl}});
  try {
    assert.equal((await h.port.invoke(request())).text, 'Synthetic answer');
    assert.equal(h.connects.length, 1); assert.equal(h.connects[0].url, websocketUrl);
    assert.equal(h.http.length, 0);
  } finally { h.port.close(); }
});

test('a terminal replay must preserve the ordered accepted event before its exact result', async () => {
  const h = harness({respond: (frame, socket) => { if (frame.type === 'invoke') socket.result(frame, 'Cached completed result'); }});
  try { await assert.rejects(h.port.invoke(request()), AgentArtsResultUnknownError); assert.equal(h.http.length, 0); }
  finally { h.port.close(); }
});
