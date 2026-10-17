import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createAgentArtsRuntimeApplication, createRuntimeApplication} from '../dist/application.js';

const target = {gatewayUrl: 'https://agentarts.example.test', runtimeName: 'voice-runtime', transport: 'wss',
  websocketUrl: 'wss://agentarts.example.test/runtimes/voice-runtime/ws?endpoint=voice-release-1'};
class Socket extends EventEmitter {
  static instances = [];
  readyState = 0; bufferedAmount = 0; sent = [];
  constructor(url, protocols, options) {
    super(); Object.assign(this, {url, protocols, options}); Socket.instances.push(this);
    queueMicrotask(() => {this.readyState = 1; this.emit('open'); this.receive({type: 'session.created'});});
  }
  send(value) {
    const frame = JSON.parse(value); this.sent.push(frame);
    if (frame.type === 'session.update') queueMicrotask(() => this.receive({type: 'session.updated'}));
  }
  receive(frame) {this.emit('message', Buffer.from(JSON.stringify(frame)));}
  close() {this.readyState = 3; queueMicrotask(() => this.emit('close'));}
  terminate() {this.close();}
}
function request() {
  return {signal: new AbortController().signal, deadline: new Date(Date.now() + 30000).toISOString(),
    instructions: 'Synthetic Runtime realtime fixture', tools: [], onEvent() {}, onTool: async () => 'ok'};
}
test.beforeEach(() => {Socket.instances = [];});

test('Competition factory binds Live to the same AgentArts version and ignores legacy API secrets', async () => {
  let outerReads = 0, innerReads = 0, fetches = 0;
  const app = createAgentArtsRuntimeApplication({...target, path: ':memory:', realtimeSocket: Socket,
    authorizationProvider: {read: async () => {outerReads++; return 'Bearer synthetic-outer';}},
    websocketAuthorizationProvider: {read: async () => {innerReads++; return 'Bearer synthetic-agent';}},
    fetchImpl: async () => {fetches++; throw Error('No HTTP call is permitted in the synthetic Live fixture');}});
  let session;
  try {
    session = await app.createLiveVoiceModel({workspaceId: 'legacy-api-setting', apiKey: 'LOCAL_BAILIAN_SECRET'}).connect(request());
    const socket = Socket.instances[0];
    assert.equal(socket.url, target.websocketUrl); assert.equal(socket.protocols, 'pa.realtime.v1');
    assert.equal(outerReads, 1); assert.equal(innerReads, 1); assert.equal(fetches, 0);
    assert.doesNotMatch(JSON.stringify(socket.options), /LOCAL_BAILIAN_SECRET|legacy-api-setting/u);
    session.sendAudio(Uint8Array.of(0, 1)); assert.equal(socket.sent.at(-1).type, 'input_audio_buffer.append');
  } finally {await session?.close(); app.close();}
});

test('HTTP-only known destination returns a Live port but connect is unsupported without key reads or network', async () => {
  let reads = 0, fetches = 0;
  const app = createAgentArtsRuntimeApplication({path: ':memory:', gatewayUrl: target.gatewayUrl, runtimeName: target.runtimeName,
    authorizationProvider: {read: async () => {reads++; return 'Bearer synthetic-outer';}},
    realtimeSocket: Socket, fetchImpl: async () => {fetches++; throw Error('Unexpected HTTP fallback');}});
  try {
    const gateway = app.createLiveVoiceModel({workspaceId: 'synthetic', apiKey: 'LOCAL_BAILIAN_SECRET'});
    assert.equal(typeof gateway.connect, 'function');
    await assert.rejects(gateway.connect(request()), {code: 'UNSUPPORTED_CAPABILITY'});
    assert.equal(reads, 0); assert.equal(fetches, 0); assert.equal(Socket.instances.length, 0);
  } finally {app.close();}
});

test('missing AgentArts inner credentials reject Live instead of using the local API config', async () => {
  const app = createAgentArtsRuntimeApplication({...target, path: ':memory:', realtimeSocket: Socket,
    authorizationProvider: {read: async () => 'Bearer synthetic-outer'},
    fetchImpl: async () => {throw Error('Unexpected fallback');}});
  try {
    await assert.rejects(app.createLiveVoiceModel({workspaceId: 'legacy-api-setting', apiKey: 'LOCAL_BAILIAN_SECRET'}).connect(request()),
      error => error.code === 'UNAUTHORIZED' && !error.message.includes('LOCAL_BAILIAN_SECRET'));
    assert.equal(Socket.instances.length, 0);
  } finally {app.close();}
});

test('generic Competition construction without the trusted realtime port cannot silently create direct Qwen', async () => {
  const app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts'});
  try {
    await assert.rejects(app.createLiveVoiceModel({workspaceId: 'legacy-api-setting', apiKey: 'LOCAL_BAILIAN_SECRET'}).connect(request()),
      {code: 'UNSUPPORTED_CAPABILITY'});
  } finally {app.close();}
});

test('the trusted factory rejects a realtime URL for another gateway or runtime before composition', () => {
  for (const websocketUrl of [target.websocketUrl.replace('agentarts.example.test', 'other.example.test'),
    target.websocketUrl.replace('/voice-runtime/', '/other-runtime/')]) {
    assert.throws(() => createAgentArtsRuntimeApplication({...target, websocketUrl, path: ':memory:', realtimeSocket: Socket,
      authorizationProvider: {read: async () => 'Bearer synthetic-outer'},
      websocketAuthorizationProvider: {read: async () => 'Bearer synthetic-agent'}}), {code: 'INVALID_ARGUMENT'});
  }
  const local = createRuntimeApplication({path: ':memory:'});
  try {assert.throws(() => local.createLiveVoiceModel(), {code: 'UNSUPPORTED_CAPABILITY'});} finally {local.close();}
});
