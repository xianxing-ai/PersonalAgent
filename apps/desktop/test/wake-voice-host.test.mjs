import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopWakeVoiceHost} from '../electron/wake-voice-host.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes;reject = no;});
  promise.catch(() => {});
  return {promise, resolve, reject};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({detectorReady = true, microphoneReady = true, releaseFailure = false,
  detectorFailure = false, detectorNeverClosed = false, authorizeFailure = false, shorterLease} = {}) {
  const calls = [], captures = [], sessions = [];
  const ready = deferred(); if (microphoneReady) ready.resolve();
  let authorization, voiceActive = false, playback, visible = true, busy = false;
  const panel = {isDestroyed: () => false, isVisible: () => visible,
    webContents: {id: 9, isDestroyed: () => false}};
  const microphoneHost = {
    authorize({deadline}) {
      calls.push('authorize');
      if (authorizeFailure) throw Error('existing private lease');
      authorization = shorterLease ?? Date.parse(deadline);
      return {authorized: true, expiresAt: new Date(authorization).toISOString()};
    },
    async revoke() {calls.push('revoke');authorization = undefined;},
    snapshot: () => ({authorized: Boolean(authorization)}),
    binding: {async start(sink) {
      calls.push('physical-start');
      await ready.promise;
      return {async release() {calls.push('physical-release');if (releaseFailure) throw Error('private release details');}};
    }},
  };
  const voiceInput = {
    hasActive: () => voiceActive,
    async beginSharedCapture(senderId, lease) {captures.push({senderId, lease});voiceActive = true;return {};},
    async cancelSharedCapture(signal) {calls.push('cancel-asr');if (captures.at(-1)?.lease.signal === signal) voiceActive = false;},
    subscribePlayback(listener) {playback = listener;listener({playbackActive: false});return () => calls.push('unsubscribe-playback');},
  };
  const host = createDesktopWakeVoiceHost({getPanel: () => panel, microphoneHost, voiceInput,
    isBusy: () => busy,
    createDetector() {
      calls.push('detector-create');
      return {
        start(options) {
          calls.push('detector-start');
          const detectorReadyReceipt = deferred(), closed = deferred();
          if (detectorReady) detectorReadyReceipt.resolve();
          const session = {options, ready: detectorReadyReceipt.promise, closed: closed.promise,
            readyReceipt: detectorReadyReceipt, closedReceipt: closed, accept() {},
            async stop() {calls.push('detector-stop');detectorReadyReceipt.reject(Error('stopped'));
              if (detectorNeverClosed) return closed.promise;
              closed.resolve();}};
          sessions.push(session);return session;
        },
        async dispose() {calls.push('detector-dispose');await Promise.all(sessions.map(session => session.stop()));
          if (detectorFailure) throw Error('private detector details');},
      };
    },
  });
  return {host, calls, captures, sessions, ready, voiceInput,
    set visible(value) {visible = value;}, set busy(value) {busy = value;},
    playback: value => playback({playbackActive: value})};
}

test('default off has no authorization or device activity and accepts only the visible panel', async () => {
  const f = fixture();
  assert.equal(f.host.snapshot().phase, 'disabled');assert.equal(f.host.hasActive(), false);
  assert.deepEqual(f.calls, []);
  await assert.rejects(f.host.enable(8), /可信面板/);
  f.visible = false;await assert.rejects(f.host.enable(9), /可信面板/);
  assert.deepEqual(f.calls, []);await f.host.dispose();
  await assert.rejects(f.host.enable(9), /可信面板/);
});

test('detector and physical capture must both be ready; a duplicate enable cannot grant again', async () => {
  const f = fixture({detectorReady: false, microphoneReady: false});
  const enabling = f.host.enable(9);
  await tick();assert.equal(f.host.snapshot().phase, 'enabling');
  assert.equal(f.calls.includes('physical-start'), false);
  await assert.rejects(f.host.enable(9), /结束/);
  f.sessions[0].readyReceipt.resolve();await tick();
  assert.equal(f.calls.filter(value => value === 'physical-start').length, 1);
  assert.equal(f.host.snapshot().state, 'disabled');
  f.ready.resolve();const result = await enabling;
  assert.equal(result.state, 'listening');assert.equal(result.phase, 'listening');
  assert.equal(result.verification, 'unverified');assert.equal(f.calls.filter(value => value === 'authorize').length, 1);
  assert.ok(result.expiresAtMs <= Date.now() + 600_000);
  await f.host.disable();assert.equal(f.host.hasActive(), false);
});

test('wake and manual dictation consume one host lease and suppress duplicate or playback wakes', async () => {
  const f = fixture();await f.host.enable(9);
  f.playback(true);f.sessions[0].options.onDetected();await tick();assert.equal(f.captures.length, 0);
  f.playback(false);f.sessions[0].options.onDetected();await tick();
  assert.equal(f.captures.length, 1);assert.equal(f.captures[0].senderId, 9);
  assert.equal(Date.parse(f.captures[0].lease.deadline), f.host.snapshot().expiresAtMs);
  f.sessions[0].options.onDetected();await tick();assert.equal(f.captures.length, 1);
  assert.equal(f.calls.filter(value => value === 'authorize').length, 1);
  await f.host.disable();assert.equal(f.captures[0].lease.signal.aborted, true);
  assert.equal(f.voiceInput.hasActive(), false);
});

test('disable during late physical readiness releases the returned attachment and cannot resurrect', async () => {
  const f = fixture({microphoneReady: false});const enabling = f.host.enable(9);
  const rejected = assert.rejects(enabling, /唤醒/);
  await tick();const stopping = f.host.disable();
  await tick();assert.equal(f.host.snapshot().phase, 'disabling');
  f.ready.resolve();await stopping;await rejected;
  assert.ok(f.calls.includes('physical-release'));
  assert.equal(f.host.snapshot().phase, 'disabled');assert.equal(f.host.hasActive(), false);
  await f.host.dispose();
});

test('missing detector readiness never opens a microphone and permits an explicit retry after release', async () => {
  const f = fixture({detectorReady: false});const enabling = f.host.enable(9);
  const rejected = assert.rejects(enabling, /唤醒来源不可用/);
  await tick();f.sessions[0].readyReceipt.reject(Error('UNSUPPORTED_CAPABILITY private'));
  await rejected;
  assert.equal(f.calls.includes('physical-start'), false);
  assert.equal(f.host.snapshot().phase, 'unavailable');assert.equal(f.host.hasActive(), false);
  const retry = f.host.enable(9);
  await tick();f.sessions[1].readyReceipt.resolve();await retry;
  assert.equal(f.host.snapshot().phase, 'listening');
  await f.host.disable();
});

for (const kind of ['releaseFailure', 'detectorFailure']) {
  test(`${kind} tries every release step and permanently blocks reauthorization`, async () => {
    const f = fixture({[kind]: true});await f.host.enable(9);
    await assert.rejects(f.host.disable(), /释放未确认/);
    assert.equal(f.host.snapshot().phase, 'release_unconfirmed');assert.equal(f.host.hasActive(), true);
    for (const call of ['physical-release', 'detector-dispose', 'cancel-asr', 'revoke']) assert.ok(f.calls.includes(call), call);
    await assert.rejects(f.host.enable(9), /释放未确认/);
    await assert.rejects(f.host.disable(), /释放未确认/);
    assert.equal(f.calls.filter(value => value === 'authorize').length, 1);
    assert.equal(JSON.stringify(f.host.snapshot()).includes('private'), false);
  });
}

test('a failed grant must not revoke another microphone owner', async () => {
  const f = fixture({authorizeFailure: true});await assert.rejects(f.host.enable(9), /唤醒/);
  assert.equal(f.calls.includes('revoke'), false);assert.equal(f.calls.includes('physical-start'), false);
});

test('lease expiry stops its ASR, clears listening, and does not restore permission', async () => {
  const f = fixture({shorterLease: Date.now() + 1000});await f.host.enable(9);
  await f.host.beginCapture(9);
  await new Promise(resolve => setTimeout(resolve, 1100));await tick();
  assert.equal(f.captures[0].lease.signal.aborted, true);assert.equal(f.voiceInput.hasActive(), false);
  assert.equal(f.host.hasActive(), false);assert.notEqual(f.host.snapshot().state, 'listening');
  assert.equal(f.calls.filter(value => value === 'authorize').length, 1);
});

test('a detector that never closes times out after five seconds and late errors cannot unlock capture', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture({detectorNeverClosed: true});await f.host.enable(9);
  const stopping = f.host.disable(), rejected = assert.rejects(stopping, /释放未确认/);
  await tick();t.mock.timers.tick(4999);await tick();
  assert.equal(f.host.snapshot().phase, 'disabling');assert.equal(f.host.hasActive(), true);
  t.mock.timers.tick(1);await rejected;
  assert.equal(f.host.snapshot().phase, 'release_unconfirmed');assert.equal(f.host.hasActive(), true);
  for (const call of ['physical-release', 'detector-dispose', 'cancel-asr', 'revoke']) assert.ok(f.calls.includes(call), call);
  await assert.rejects(f.host.enable(9), /释放未确认/);
  f.sessions[0].closedReceipt.reject(Error('private late close error'));
  await tick();assert.equal(f.host.snapshot().phase, 'release_unconfirmed');
});
