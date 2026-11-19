import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindVoiceWake} from '../dist/index.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

const voiceSnapshot = (sessionId, overrides = {}) => Object.freeze({
  sessionId, state: 'listening', revision: 0, startedAt: new Date().toISOString(),
  deadline: new Date(Date.now() + 5_000).toISOString(), locale: 'zh-CN',
  transcriptReady: false, replyReady: false, playbackActive: false, ...overrides});

class StubVoiceManager {
  starts = [];
  listeners = new Set();
  currentSnapshot = undefined;
  startBehavior;

  start(input) {
    const call = {input, resolve: undefined, reject: undefined, promise: undefined};
    this.starts.push(call);
    if (this.startBehavior) {
      call.promise = this.startBehavior(input);
      return call.promise;
    }
    call.promise = new Promise((resolve, reject) => {call.resolve = resolve; call.reject = reject;});
    return call.promise;
  }

  current() {return this.currentSnapshot;}

  subscribe(listener) {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  }

  emit(snapshot) {
    this.currentSnapshot = snapshot;
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  resolveStart(index, sessionId, overrides = {}) {
    const snapshot = voiceSnapshot(sessionId, overrides);
    this.currentSnapshot = snapshot;
    this.starts[index].resolve(snapshot);
  }
}

class StubWakeController {
  lifecycle = Object.freeze({state: 'disabled', sessionId: null, expiresAtMs: null});
  playbackRequests = [];
  lifecycleListener = undefined;
  subscribeCalls = 0;
  unsubscribeCalls = 0;
  subscribeResult = () => {this.unsubscribeCalls++;};
  throwOnPlayback = false;

  subscribeLifecycle(listener) {
    this.subscribeCalls++;
    this.lifecycleListener = listener;
    return this.subscribeResult;
  }

  setPlaybackActive(active) {
    if (this.throwOnPlayback) throw Error('synthetic playback guard');
    this.playbackRequests.push(active);
  }

  emitLifecycle(lifecycle) {
    this.lifecycle = Object.freeze({...lifecycle});
    this.lifecycleListener?.(this.lifecycle);
  }
}

const wakeEvent = (sessionId, overrides = {}) => ({kind: 'wake', sessionId,
  occurredAtMs: Date.now(), ...overrides});

test('bindVoiceWake refuses a malformed composition before subscribing to either feed', () => {
  const validVoice = new StubVoiceManager();
  const wake = new StubWakeController();
  for (const options of [undefined, null, {}, {wake, voice: undefined},
    {wake: {subscribeLifecycle: () => () => {}}, voice: validVoice},
    {wake: {setPlaybackActive: () => {}}, voice: validVoice},
    {wake, voice: {start: () => {}, subscribe: () => () => {}}},
    {wake, voice: {start: () => {}, current: () => undefined}},
    {wake, voice: {current: () => undefined, subscribe: () => () => {}}}]) {
    assert.throws(() => bindVoiceWake(options),
      {code: 'INVALID_ARGUMENT', message: 'Invalid voice wake binding'});
  }
  assert.equal(wake.subscribeCalls, 0);
  assert.equal(validVoice.listeners.size, 0);
});

test('construction failures unsubscribe both feeds and never leave a subscription behind', () => {
  const wakeA = new StubWakeController();
  wakeA.subscribeResult = undefined;
  const voiceA = new StubVoiceManager();
  assert.throws(() => bindVoiceWake({wake: wakeA, voice: voiceA}), {code: 'INVALID_ARGUMENT'});
  assert.equal(voiceA.listeners.size, 0);

  const wakeB = new StubWakeController();
  const voiceB = new StubVoiceManager();
  voiceB.subscribe = () => undefined;
  assert.throws(() => bindVoiceWake({wake: wakeB, voice: voiceB}), {code: 'INVALID_ARGUMENT'});
  assert.equal(wakeB.unsubscribeCalls, 1);

  const wakeC = new StubWakeController();
  wakeC.throwOnPlayback = true;
  const voiceC = new StubVoiceManager();
  let voiceUnsubscribed = 0;
  voiceC.subscribe = listener => {voiceC.listeners.add(listener);
    return () => {voiceUnsubscribed++; voiceC.listeners.delete(listener);};};
  assert.throws(() => bindVoiceWake({wake: wakeC, voice: voiceC}), {code: 'INVALID_ARGUMENT'});
  assert.equal(wakeC.unsubscribeCalls, 1);
  assert.equal(voiceUnsubscribed, 1);
});

test('construction mirrors the current voice playback state into wake suppression', () => {
  const wake = new StubWakeController();
  const voice = new StubVoiceManager();
  voice.currentSnapshot = voiceSnapshot('current-voice', {playbackActive: true});
  bindVoiceWake({wake, voice});
  assert.deepEqual(wake.playbackRequests, [true]);
  assert.equal(wake.subscribeCalls, 1);
  assert.equal(voice.listeners.size, 1);
});

test('handleWake ignores non-wake events, foreign sessions and unusable wake expiry', async () => {
  const wake = new StubWakeController();
  const voice = new StubVoiceManager();
  const binding = bindVoiceWake({wake, voice});
  binding.handleWake(wakeEvent(9));
  binding.handleWake(null);
  binding.handleWake(undefined);
  binding.handleWake({kind: 'device_unavailable'});
  binding.handleWake({kind: 'error'});
  binding.handleWake({});
  assert.equal(voice.starts.length, 0);

  const expiresAtMs = Date.now() + 10_000;
  wake.emitLifecycle({state: 'listening', sessionId: 7, expiresAtMs});
  binding.handleWake(wakeEvent(6));
  binding.handleWake(wakeEvent(8));
  assert.equal(voice.starts.length, 0);

  for (const unusable of [null, -1, 1.5]) {
    wake.emitLifecycle({state: 'listening', sessionId: 7, expiresAtMs: unusable});
    binding.handleWake(wakeEvent(7));
    assert.equal(voice.starts.length, 0);
  }

  wake.emitLifecycle({state: 'listening', sessionId: 7, expiresAtMs});
  binding.handleWake(wakeEvent(7));
  assert.equal(voice.starts.length, 1);
  assert.equal(voice.starts[0].input.deadline, new Date(expiresAtMs).toISOString());
  assert.equal(voice.starts[0].input.signal.aborted, false);
  binding.dispose();
});

test('a synchronous start failure and an async rejection both free the binding for the next wake', async () => {
  const syncWake = new StubWakeController();
  const syncVoice = new StubVoiceManager();
  syncVoice.startBehavior = () => {throw Error('synthetic synchronous start failure');};
  const syncBinding = bindVoiceWake({wake: syncWake, voice: syncVoice});
  const expiresAtMs = Date.now() + 10_000;
  syncWake.emitLifecycle({state: 'listening', sessionId: 1, expiresAtMs});
  syncBinding.handleWake(wakeEvent(1));
  await flush();
  assert.equal(syncVoice.starts.length, 1);
  syncVoice.startBehavior = undefined;
  syncBinding.handleWake(wakeEvent(1));
  assert.equal(syncVoice.starts.length, 2);
  syncVoice.resolveStart(1, 'voice-2');
  await flush();
  assert.equal(syncVoice.currentSnapshot.sessionId, 'voice-2');
  assert.equal(syncVoice.starts[1].input.signal.aborted, false);
  syncBinding.dispose();

  const rejectedWake = new StubWakeController();
  const rejectedVoice = new StubVoiceManager();
  const rejectedBinding = bindVoiceWake({wake: rejectedWake, voice: rejectedVoice});
  rejectedWake.emitLifecycle({state: 'listening', sessionId: 2, expiresAtMs});
  rejectedBinding.handleWake(wakeEvent(2));
  assert.equal(rejectedVoice.starts.length, 1);
  rejectedVoice.starts[0].reject(Error('private start failure'));
  await flush();
  rejectedBinding.handleWake(wakeEvent(2));
  assert.equal(rejectedVoice.starts.length, 2);
  rejectedVoice.resolveStart(1, 'voice-3');
  await flush();
  assert.equal(rejectedVoice.currentSnapshot.sessionId, 'voice-3');
  rejectedBinding.dispose();
});

test('a settled start with an unusable or non-current snapshot aborts and frees the binding', async () => {
  const emptyWake = new StubWakeController();
  const emptyVoice = new StubVoiceManager();
  const emptyBinding = bindVoiceWake({wake: emptyWake, voice: emptyVoice});
  const expiresAtMs = Date.now() + 10_000;
  emptyWake.emitLifecycle({state: 'listening', sessionId: 3, expiresAtMs});
  emptyBinding.handleWake(wakeEvent(3));
  assert.equal(emptyVoice.starts.length, 1);
  emptyVoice.resolveStart(0, '');
  await flush();
  assert.equal(emptyVoice.starts[0].input.signal.aborted, true);
  emptyBinding.handleWake(wakeEvent(3));
  assert.equal(emptyVoice.starts.length, 2);
  emptyVoice.resolveStart(1, 'voice-2');
  await flush();
  assert.equal(emptyVoice.starts[1].input.signal.aborted, false);
  emptyBinding.dispose();

  const detachedWake = new StubWakeController();
  const detachedVoice = new StubVoiceManager();
  const detachedBinding = bindVoiceWake({wake: detachedWake, voice: detachedVoice});
  detachedWake.emitLifecycle({state: 'listening', sessionId: 4, expiresAtMs});
  detachedBinding.handleWake(wakeEvent(4));
  detachedVoice.currentSnapshot = voiceSnapshot('other-voice');
  detachedVoice.starts[0].resolve(voiceSnapshot('started-voice'));
  await flush();
  assert.equal(detachedVoice.starts[0].input.signal.aborted, true);
  detachedBinding.handleWake(wakeEvent(4));
  detachedVoice.resolveStart(1, 'voice-2');
  await flush();
  assert.equal(detachedVoice.starts[1].input.signal.aborted, false);
  detachedBinding.dispose();

  for (const state of ['stopped', 'cancelled', 'expired']) {
    const terminalWake = new StubWakeController();
    const terminalVoice = new StubVoiceManager();
    const terminalBinding = bindVoiceWake({wake: terminalWake, voice: terminalVoice});
    terminalWake.emitLifecycle({state: 'listening', sessionId: 5, expiresAtMs});
    terminalBinding.handleWake(wakeEvent(5));
    terminalVoice.resolveStart(0, `voice-${state}`, {state});
    await flush();
    assert.equal(terminalVoice.starts[0].input.signal.aborted, true, state);
    terminalBinding.handleWake(wakeEvent(5));
    assert.equal(terminalVoice.starts.length, 2, state);
    terminalVoice.resolveStart(1, 'voice-2');
    await flush();
    assert.equal(terminalVoice.starts[1].input.signal.aborted, false, state);
    terminalBinding.dispose();
  }
});

test('a wake lifecycle switch aborts the pending start and still permits a wake on the new session', async () => {
  const wake = new StubWakeController();
  const voice = new StubVoiceManager();
  const binding = bindVoiceWake({wake, voice});
  const firstExpiry = Date.now() + 10_000;
  wake.emitLifecycle({state: 'listening', sessionId: 11, expiresAtMs: firstExpiry});
  binding.handleWake(wakeEvent(11));
  assert.equal(voice.starts.length, 1);
  assert.equal(voice.starts[0].input.signal.aborted, false);

  wake.emitLifecycle({state: 'listening', sessionId: 12, expiresAtMs: firstExpiry});
  assert.equal(voice.starts[0].input.signal.aborted, true);

  binding.handleWake(wakeEvent(12));
  assert.equal(voice.starts.length, 2);
  assert.equal(voice.starts[1].input.signal.aborted, false);
  voice.resolveStart(1, 'voice-2');
  await flush();
  assert.equal(voice.currentSnapshot.sessionId, 'voice-2');

  wake.emitLifecycle({state: 'disabled'});
  assert.equal(voice.starts[1].input.signal.aborted, true);
  binding.dispose();
});
