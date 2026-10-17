import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {AgentArtsRealtimeModelGateway, QwenRealtimeModelGateway} from '../dist/index.js';

const target = 'wss://agentarts.example.test/runtimes/voice-runtime/invocations?endpoint=voice-release-1';
const tick = () => new Promise(setImmediate);
class Socket extends EventEmitter {
  static instances = [];
  static acknowledge = true;
  readyState = 0; bufferedAmount = 0; sent = [];
  constructor(url, protocols, options) {
    super(); Object.assign(this, {url, protocols, options}); Socket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1; this.emit('open'); this.receive({type: 'session.created', session: {id: 'native-session'}});
    });
  }
  send(value) {
    const frame = JSON.parse(value); this.sent.push(frame);
    if (frame.type === 'session.update' && Socket.acknowledge) {
      queueMicrotask(() => this.receive({type: 'session.updated'}));
    }
  }
  receive(value) {this.emit('message', Buffer.from(JSON.stringify(value)));}
  close() {this.readyState = 3; queueMicrotask(() => this.emit('close'));}
  terminate() {this.close();}
}
function options(overrides = {}) {
  return {websocketUrl: target,
    authorizationProvider: {read: async () => 'Bearer synthetic-outer'},
    websocketAuthorizationProvider: {read: async () => 'Bearer synthetic-agent'}, ...overrides};
}
function request(overrides = {}) {
  return {signal: new AbortController().signal, deadline: new Date(Date.now() + 30000).toISOString(),
    instructions: 'Synthetic public audio fixture', tools: [], onEvent() {}, onTool: async () => 'ok', ...overrides};
}
test.beforeEach(() => {Socket.instances = []; Socket.acknowledge = true;});

test('AgentArts sends the exact version/deadline and dual credentials with its native realtime subprotocol', async t => {
  let outerReads = 0, innerReads = 0;
  const gateway = new AgentArtsRealtimeModelGateway(options({
    authorizationProvider: {read: async () => {outerReads++; return 'Bearer synthetic-outer';}},
    websocketAuthorizationProvider: {read: async () => {innerReads++; return 'Bearer synthetic-agent';}},
  }), Socket);
  const input = request(), session = await gateway.connect(input); t.after(() => session.close());
  const socket = Socket.instances[0];
  assert.equal(socket.url, target); assert.equal(socket.protocols, 'pa.realtime.v1');
  assert.equal(outerReads, 1); assert.equal(innerReads, 1);
  assert.equal(socket.options.headers.Authorization, 'Bearer synthetic-outer');
  assert.equal(socket.options.headers['X-PA-Agent-Token'], 'Bearer synthetic-agent');
  assert.equal(socket.options.headers['x-pa-deadline'], input.deadline);
  assert.equal(socket.options.headers['x-invoke-mode'], 'published');
  assert.match(socket.options.headers['X-Hw-Agentarts-Session-Id'], /^[\w-]{1,128}$/u);
  assert.match(socket.options.headers['X-Request-Id'], /^[\w-]{1,128}$/u);
  assert.equal(socket.options.followRedirects, false); assert.equal(socket.options.rejectUnauthorized, true);
  assert.equal(socket.options.perMessageDeflate, false);
  assert.equal(socket.sent[0].type, 'session.update');
  assert.equal(socket.sent.some(frame => frame.type === 'hello' || frame.type === 'invoke'), false);
});

test('native session.created or a custom ready frame never substitutes for session.updated', async t => {
  Socket.acknowledge = false;
  const pending = new AgentArtsRealtimeModelGateway(options(), Socket).connect(request());
  let settled = false; pending.then(() => {settled = true;}, () => {settled = true;});
  await tick(); const socket = Socket.instances[0];
  assert.equal(settled, false);
  socket.receive({type: 'ready'}); await tick(); assert.equal(settled, false);
  socket.receive({type: 'session.updated'});
  const session = await pending; t.after(() => session.close());
});

test('AgentArts reuses PCM, final transcripts, once-only tools and stale-audio interruption', async t => {
  const events = []; let calls = 0;
  const session = await new AgentArtsRealtimeModelGateway(options(), Socket).connect(request({
    tools: [{name: 'read_context', description: 'Synthetic context', parameters: {type: 'object'}}],
    onEvent: event => events.push(event), onTool: async () => {calls++; return 'Synthetic retained result';},
  }));
  t.after(() => session.close()); const socket = Socket.instances[0];
  session.sendAudio(Uint8Array.of(0, 1));
  assert.equal(socket.sent.at(-1).type, 'input_audio_buffer.append');
  socket.receive({type: 'response.created', response: {id: 'r1'}});
  socket.receive({type: 'response.audio.delta', response_id: 'r1', delta: 'AAE='});
  session.interrupt();
  socket.receive({type: 'response.audio.delta', response_id: 'r1', delta: 'AAE='});
  assert.equal(events.filter(event => event.type === 'audio').length, 1);
  assert.equal(socket.sent.at(-1).type, 'response.cancel');
  socket.receive({type: 'conversation.item.input_audio_transcription.completed', item_id: 'speech_1', transcript: '合成确认'});
  assert.equal(events.find(event => event.type === 'transcript').utteranceId, 'speech_1');
  socket.receive({type: 'response.created', response: {id: 'r2'}});
  const call = {type: 'response.function_call_arguments.done', response_id: 'r2', call_id: 'once',
    name: 'read_context', arguments: '{}'};
  socket.receive(call); socket.receive(call); await tick();
  assert.equal(calls, 1); assert.equal(socket.sent.filter(frame => frame.type === 'conversation.item.create').length, 1);
  socket.receive({type: 'response.done', response: {id: 'r2', status: 'completed'}});
  assert.equal(socket.sent.filter(frame => frame.type === 'response.create').length, 1);
});

test('missing, malformed or revoked credentials never create a socket or leak credential errors', async t => {
  for (const [name, override] of [
    ['missing inner provider', {websocketAuthorizationProvider: undefined}],
    ['empty outer', {authorizationProvider: {read: async () => ''}}],
    ['outer header injection', {authorizationProvider: {read: async () => 'Bearer SECRET\r\nInjected: SECRET'}}],
    ['outer non-header text', {authorizationProvider: {read: async () => 'SECRET私密'}}],
    ['outer revoked', {authorizationProvider: {read: async () => {throw Error('SECRET revoked');}}}],
    ['empty inner', {websocketAuthorizationProvider: {read: async () => ''}}],
    ['non-Bearer inner', {websocketAuthorizationProvider: {read: async () => 'SECRET'}}],
  ]) await t.test(name, async () => {
    await assert.rejects(new AgentArtsRealtimeModelGateway(options(override), Socket).connect(request()), error => {
      assert.equal(error.code, 'UNAUTHORIZED'); assert.doesNotMatch(error.message, /SECRET|Injected/); return true;
    });
    assert.equal(Socket.instances.length, 0);
  });
});

test('credentials are read again for a later connection and revocation cannot fall back to direct Qwen', async () => {
  let credential = 'Bearer synthetic-agent';
  const gateway = new AgentArtsRealtimeModelGateway(options({websocketAuthorizationProvider: {read: async () => credential}}), Socket);
  const first = await gateway.connect(request()); await first.close(); credential = '';
  await assert.rejects(gateway.connect(request()), {code: 'UNAUTHORIZED'});
  assert.equal(Socket.instances.length, 1);
});

test('credential waits are bounded by abort even when the provider ignores its signal', async () => {
  let resolve, providerSignal;
  const controller = new AbortController();
  const gateway = new AgentArtsRealtimeModelGateway(options({authorizationProvider: {read: signal => {
    providerSignal = signal; return new Promise(yes => {resolve = yes;});
  }}}), Socket);
  const pending = gateway.connect(request({signal: controller.signal}));
  const rejected = assert.rejects(pending, /取消|关闭|期限/u);
  await tick(); controller.abort(); await rejected;
  assert.equal(providerSignal.aborted, true);
  resolve('Bearer synthetic-late'); await tick(); assert.equal(Socket.instances.length, 0);
});

test('the original deadline expires during a stuck credential read without opening a socket', async t => {
  t.mock.timers.enable({apis: ['setTimeout', 'Date']});
  let providerSignal;
  const gateway = new AgentArtsRealtimeModelGateway(options({authorizationProvider: {read: signal => {
    providerSignal = signal; return new Promise(() => {});
  }}}), Socket);
  const pending = gateway.connect(request()), rejected = assert.rejects(pending, /到期|期限/u);
  await tick(); t.mock.timers.tick(30001); await rejected;
  assert.equal(providerSignal.aborted, true); assert.equal(Socket.instances.length, 0);
});

test('HTTP-only construction stays available as a connect port but cannot open native realtime', async () => {
  const gateway = new AgentArtsRealtimeModelGateway(options({websocketUrl: undefined}), Socket);
  assert.equal(typeof gateway.connect, 'function');
  await assert.rejects(gateway.connect(request()), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.equal(Socket.instances.length, 0);
});

test('ambiguous version URLs, insecure targets and constructor failures fail before any fallback', async t => {
  for (const url of [target.replace('wss:', 'ws:'), target.replace('?endpoint=voice-release-1', ''),
    `${target}&endpoint=other`, `${target}&model=other`, `${target}#secret`,
    target.replace('agentarts.example.test', 'user:SECRET@agentarts.example.test')]) await t.test(url.replace(/SECRET/gu, 'redacted'), async () => {
    await assert.rejects(new AgentArtsRealtimeModelGateway(options({websocketUrl: url}), Socket).connect(request()), {code: 'INVALID_ARGUMENT'});
    assert.equal(Socket.instances.length, 0);
  });
  class ThrowingSocket {constructor() {throw Error('SECRET socket error');}}
  await assert.rejects(new AgentArtsRealtimeModelGateway(options(), ThrowingSocket).connect(request()), error => {
    assert.equal(error.code, 'EXTERNAL_FAILURE'); assert.doesNotMatch(error.message, /SECRET/u); return true;
  });
});

test('the existing direct Qwen constructor retains its validation and API-only endpoint', async t => {
  class DirectSocket extends Socket {
    constructor(url, directOptions) {super(url, undefined, directOptions);}
  }
  assert.throws(() => new QwenRealtimeModelGateway({workspaceId: '', apiKey: ''}, DirectSocket), /百炼/u);
  const session = await new QwenRealtimeModelGateway({workspaceId: 'original-api', apiKey: 'synthetic-direct-key'}, DirectSocket).connect(request());
  t.after(() => session.close()); const socket = Socket.instances[0];
  assert.equal(new URL(socket.url).hostname, 'original-api.cn-beijing.maas.aliyuncs.com');
  assert.equal(socket.options.headers.Authorization, 'Bearer synthetic-direct-key');
  assert.equal(socket.protocols, undefined);
});
