import assert from 'node:assert/strict';
import test from 'node:test';
import {createDesktopVoiceInputCore} from '../electron/voice-input-core.js';
import {VoiceSessionManager, createVoicePcmBuffer, createVoicePcmFrameSourcePort} from '@personal-agent/voice';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function fixture({recognizeError, speakError, autoPlay = false} = {}) {
  const calls = [];
  const fixedNow = Date.parse('2026-09-25T00:00:00.000Z');
  const ready = deferred();
  const closed = deferred();
  let options;
  const subscription = {ready: ready.promise, closed: closed.promise,
    unsubscribe: () => { calls.push('unsubscribe'); }};
  const source = {subscribe: value => { calls.push('subscribe'); options = value; return subscription; },
    dispose: async () => { calls.push('dispose-source'); }};
  const microphoneHost = {authorize: () => { calls.push('authorize'); },
    snapshot: () => ({subscriberCount: 0}), revoke: async () => { calls.push('revoke'); }};
  class Manager {
    async start(options) { calls.push(['session-start', options.deadline]); return {sessionId: 'session-1'}; }
    current() { return {sessionId: 'session-1', state: 'listening', revision: 1}; }
    async recognizeAudio(_id, clip) {
      calls.push(['recognize', [...clip.data]]);
      if (recognizeError) throw recognizeError;
      return {transcriptId: 'transcript-1'};
    }
    async consumeTranscript(_id, receipt, consumer) { calls.push(['consume', receipt, consumer]); return {replyId: 'reply-1'}; }
    async speakReply(_id, receipt) {
      calls.push(['speak', receipt]);
      if (speakError) throw speakError;
      return {completed: true, interrupted: false};
    }
    async stop() { calls.push('session-stop');return {sessionId: 'session-1', state: 'stopped', reason: 'user', stopped: true, resourcesReleased: true}; }
    async stopSpeaking() { calls.push('stop-speaking'); return {playbackStopped: true, resourcesReleased: true}; }
  }
  const input = createDesktopVoiceInputCore({source, microphoneHost, client: {call: () => {}},
    createBuffer: options => {
      calls.push(['buffer-deadline', options.deadline]);
      const data = [];
      return {append: chunk => { calls.push('append'); data.push(...chunk); },
        finish: () => { calls.push('finish-buffer');
          if (!data.length) throw Object.assign(Error('private empty buffer detail'), {code: 'INVALID_STATE'});
          return {data: Uint8Array.from(data),
          format: {encoding: 'pcm_s16le', sampleRateHz: 16000, channels: 1}, durationMs: data.length / 32}; },
        dispose: () => { calls.push('dispose-buffer'); }};
    },
    VoiceSessionManager: Manager, createConsumer: () => ({kind: 'consumer'}),
    createSpeechPorts: () => ({recognition: {}, output: {}, dispose: async () => { calls.push('dispose-ports'); }}),
    enabled: true, autoPlay, now: () => fixedNow});
  return {input, calls, ready, closed, get options() { return options; }};
}

test('explicit voice path waits for physical ready and release before ASR; playback stays explicit', async () => {
  const f = fixture();
  const pending = f.input.beginCapture(3);
  await Promise.resolve();
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'session-start'), false);
  f.ready.resolve();
  await pending;
  assert.equal(f.input.snapshot().status, 'listening');
  const captureDeadline = Date.parse(f.options.deadline);
  const sessionDeadline = Date.parse(f.calls.find(call => Array.isArray(call) && call[0] === 'session-start')[1]);
  assert.equal(captureDeadline - Date.parse('2026-09-25T00:00:00.000Z'), 60_000);
  assert.equal(sessionDeadline - captureDeadline, 9 * 60_000);
  assert.equal(f.calls.find(call => Array.isArray(call) && call[0] === 'buffer-deadline')[1], new Date(sessionDeadline).toISOString());
  f.options.onFrame({data: Uint8Array.of(1, 2)});
  const finishing = f.input.finishCapture(3);
  await Promise.resolve();
  assert.equal(f.calls.includes('unsubscribe'), true);
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'recognize'), false);
  f.closed.resolve();
  await finishing;
  assert.equal(f.input.snapshot().status, 'awaiting_speech');
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'speak'), false);
  await f.input.playReply(3);
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'speak'), true);
  assert.equal(f.calls.some(call => call === 'task.cancel'), false);
});

test('cloud voice conversation automatically speaks after recognition and Runtime completion', async () => {
  const f = fixture({autoPlay: true});
  const started = f.input.beginCapture(3);
  f.ready.resolve();
  await started;
  f.options.onFrame({data: Uint8Array.of(1, 2)});
  const finished = f.input.finishCapture(3);
  f.closed.resolve();
  const result = await finished;
  assert.equal(result.completed, true);
  assert.equal(f.input.hasActive(), false);
  const ordered = f.calls.filter(Array.isArray).map(call => call[0]);
  assert.ok(ordered.indexOf('recognize') < ordered.indexOf('consume'));
  assert.ok(ordered.indexOf('consume') < ordered.indexOf('speak'));
  assert.equal(f.calls.includes('revoke'), true);
});

test('unconfirmed PCM release blocks recognition and reports failure', async () => {
  const f = fixture();
  const pending = f.input.beginCapture(4);
  f.ready.resolve();
  await pending;
  f.options.onFrame({data: Uint8Array.of(1, 2)});
  const finishing = f.input.finishCapture(4);
  f.closed.reject(Error('track stop failed'));
  await assert.rejects(finishing, /麦克风释放未确认/);
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'recognize'), false);
  assert.deepEqual(f.input.snapshot().failure, {
    stage: 'pcm_release', code: 'EXTERNAL_FAILURE', message: '麦克风释放未确认',
  });
});

test('automatic playback failure retains its stage without provider secrets', async () => {
  const f = fixture({autoPlay: true, speakError: Object.assign(Error('private token response'), {code: 'TIMEOUT'})});
  const started = f.input.beginCapture(3);
  f.ready.resolve();
  await started;
  f.options.onFrame({data: Uint8Array.of(1, 2)});
  const finished = f.input.finishCapture(3);
  f.closed.resolve();
  await assert.rejects(finished, /语音操作已超时/);
  assert.equal(f.input.hasActive(), false);
  assert.deepEqual(f.input.snapshot().failure, {stage: 'playback', code: 'TIMEOUT', message: '语音操作已超时'});
  assert.equal(JSON.stringify(f.input.snapshot()).includes('private'), false);
});

test('dictation delivers an editable transcript without a Runtime task or speech reply', async () => {
  let subscribed, draft, revoked = false;
  const closed = deferred();
  const input = createDesktopVoiceInputCore({
    source: {subscribe(options) { subscribed = options; return {ready: Promise.resolve(),
      closed: closed.promise, unsubscribe: () => closed.resolve()}; }},
    microphoneHost: {authorize() {}, snapshot: () => ({subscriberCount: 0}), revoke: async () => {revoked = true;}},
    client: {call: () => assert.fail('dictation must not submit a task')},
    createConsumer: () => ({consume: () => assert.fail('dictation must not consume through Runtime')}),
    createBuffer: createVoicePcmBuffer, VoiceSessionManager,
    createSpeechPorts: () => ({recognition: {recognize: () => ({
      result: Promise.resolve({text: '请帮我整理今天的计划。', locale: 'zh-CN'}), stop: async () => {},
    })}, output: {speak: () => assert.fail('dictation must not speak')}, dispose: async () => {}}),
    enabled: true, inputMode: 'dictation', onTranscript: result => {draft = result;},
  });
  await input.beginCapture(9);
  subscribed.onFrame({data: new Uint8Array(3200)});
  const result = await input.finishCapture(9);
  assert.equal(result.text, '请帮我整理今天的计划。');
  assert.deepEqual(draft, {senderId: 9, text: result.text});
  assert.equal(input.hasActive(), false);
  assert.equal(revoked, true);
  await input.dispose();
});

test('capture deadline finalizes audio while the session keeps time for ASR and Runtime', async () => {
  const f = fixture();
  const pending = f.input.beginCapture(5);
  f.ready.resolve();
  await pending;
  f.options.onFrame({data: Uint8Array.of(1, 2)});
  f.options.onEnd('deadline');
  f.closed.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'recognize'), true);
  assert.equal(f.input.snapshot().status, 'awaiting_speech');
});

test('automatic deadline retains a bounded ASR failure after cleanup', async () => {
  const sensitive = Object.assign(Error('private transcript and provider credentials'),
    {code: 'UNSUPPORTED_CAPABILITY'});
  const f = fixture({recognizeError: sensitive});
  const pending = f.input.beginCapture(6);
  f.ready.resolve();
  await pending;
  f.options.onFrame({data: Uint8Array.of(1, 2)});
  f.options.onEnd('deadline');
  f.closed.resolve();
  await new Promise(resolve => setImmediate(resolve));
  const state = f.input.snapshot();
  assert.equal(state.status, 'error');
  assert.deepEqual(state.failure, {
    stage: 'recognition', code: 'UNSUPPORTED_CAPABILITY', message: '语音适配器当前不可用',
  });
  assert.equal(state.reason, state.failure.message);
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'consume'), false);
  assert.equal(JSON.stringify(state).includes('private transcript'), false);
  assert.equal(f.input.hasActive(), false);
});

test('automatic deadline reports PCM release failure before ASR', async () => {
  const f = fixture();
  const pending = f.input.beginCapture(7);
  f.ready.resolve();
  await pending;
  f.options.onFrame({data: Uint8Array.of(1, 2)});
  f.options.onEnd('deadline');
  f.closed.reject(Error('private device detail'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.input.snapshot().status, 'error');
  assert.deepEqual(f.input.snapshot().failure, {
    stage: 'pcm_release', code: 'EXTERNAL_FAILURE', message: '麦克风释放未确认',
  });
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'recognize'), false);
  assert.equal(JSON.stringify(f.input.snapshot()).includes('private device detail'), false);
});

test('automatic deadline reports an empty PCM buffer without invoking ASR', async () => {
  const f = fixture();
  const pending = f.input.beginCapture(8);
  f.ready.resolve();
  await pending;
  f.options.onEnd('deadline');
  f.closed.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.input.snapshot().status, 'error');
  assert.deepEqual(f.input.snapshot().failure, {
    stage: 'audio_buffer', code: 'INVALID_STATE', message: '语音处理失败',
  });
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'recognize'), false);
  assert.equal(JSON.stringify(f.input.snapshot()).includes('private empty buffer detail'), false);
});

function sharedFixture({recognitionPending = false, recognitionStopFailure = false, managerClosed,
  mode = 'dictation', authorized = true, clockNow = Date.now, subscriberCount = 1, revokeGate} = {}) {
  let sink, draft, request, recognitionStops = 0, grants = 0, revokes = 0;
  const recognition = deferred();
  const revokeEntered = deferred();
  class ClosingManager extends VoiceSessionManager {
    async stop(...args) {
      const receipt = await super.stop(...args);
      await managerClosed?.promise;
      return receipt;
    }
  }
  const source = createVoicePcmFrameSourcePort({async start(value) {sink = value;return {async release() {}};}});
  const input = createDesktopVoiceInputCore({source,
    microphoneHost: {authorize() {grants++;}, snapshot: () => ({authorized, subscriberCount}), async revoke() {
      revokes++; revokeEntered.resolve(); await revokeGate?.promise;
    }},
    client: {call: () => assert.fail('shared dictation cannot submit Runtime tasks')},
    createConsumer: () => ({consume: () => assert.fail('shared dictation cannot consume through Runtime')}),
    createBuffer: createVoicePcmBuffer, VoiceSessionManager: ClosingManager,
    createSpeechPorts: () => ({
      recognition: {recognize(value) {request = value;return {
        result: recognitionPending ? recognition.promise : Promise.resolve({text: '下一条草稿', locale: 'zh-CN'}),
        async stop() {recognitionStops++;if (recognitionStopFailure) throw Error('private stop details');},
      };}},
      output: {speak: () => assert.fail('shared dictation cannot speak')}, dispose: async () => {},
    }), enabled: true, inputMode: mode, now: clockNow, onTranscript: value => {draft = value;},
  });
  return {input, recognition, revokeEntered, feed: () => sink.onFrame(new Uint8Array(3200)),
    get draft() {return draft;}, get request() {return request;},
    get recognitionStops() {return recognitionStops;},get grants() {return grants;},get revokes() {return revokes;}};
}

test('shared dictation uses the existing lease, bounds ASR, and delivers only an editable draft', async () => {
  const f = sharedFixture(), parent = new AbortController();
  const deadline = new Date(Date.now() + 2000).toISOString();
  await f.input.beginSharedCapture(9, {signal: parent.signal, deadline});
  assert.equal(f.grants, 0);f.feed();
  const result = await f.input.finishCapture(9);
  assert.equal(f.request.deadline, deadline);assert.equal(result.text, '下一条草稿');
  assert.deepEqual(f.draft, {senderId: 9, text: result.text});
  assert.equal(f.revokes, 0);assert.equal(f.input.hasActive(), false);
  await f.input.dispose();
});

test('lease revocation terminates in-flight ASR, prevents a late draft, and preserves unrelated cancellation scope', async () => {
  const f = sharedFixture({recognitionPending: true}), parent = new AbortController();
  await f.input.beginSharedCapture(9, {signal: parent.signal, deadline: new Date(Date.now() + 2000).toISOString()});
  assert.deepEqual(await f.input.cancelSharedCapture(new AbortController().signal), {cancelled: false});
  assert.equal(f.input.hasActive(), true);f.feed();
  const finishing = f.input.finishCapture(9), rejected = assert.rejects(finishing, /取消/);
  await new Promise(resolve => setImmediate(resolve));assert.ok(f.request);
  parent.abort();await f.input.cancelSharedCapture(parent.signal);await rejected;
  assert.ok(f.recognitionStops > 0);assert.equal(f.input.hasActive(), false);assert.equal(f.draft, undefined);
  f.recognition.resolve({text: '迟到私有文本', locale: 'zh-CN'});
  await new Promise(resolve => setImmediate(resolve));assert.equal(f.draft, undefined);
  await f.input.dispose();
});

test('shared capture rejects expired or extended leases, missing authorization and conversation mode', async () => {
  const parent = new AbortController();
  const f = sharedFixture();
  for (const deadline of ['invalid', new Date(Date.now() - 1).toISOString(), new Date(Date.now() + 700_000).toISOString()]) {
    await assert.rejects(f.input.beginSharedCapture(9, {signal: parent.signal, deadline}), /租约无效/);
  }
  parent.abort();await assert.rejects(f.input.beginSharedCapture(9, {signal: parent.signal, deadline: new Date(Date.now() + 2000).toISOString()}), /租约无效/);
  assert.equal(f.grants, 0);await f.input.dispose();
  for (const options of [{authorized: false}, {mode: 'conversation'}]) {
    const other = sharedFixture(options);
    await assert.rejects(other.input.beginSharedCapture(9, {signal: new AbortController().signal,
      deadline: new Date(Date.now() + 2000).toISOString()}), /租约无效/);
    assert.equal(other.grants, 0);await other.input.dispose();
  }
});

test('a terminal ASR state with a failed stop retains the lease release failure after active capture clears', async () => {
  const f = sharedFixture({recognitionPending: true, recognitionStopFailure: true}), parent = new AbortController();
  await f.input.beginSharedCapture(9, {signal: parent.signal, deadline: new Date(Date.now() + 2000).toISOString()});
  f.feed();const finishing = f.input.finishCapture(9), rejected = assert.rejects(finishing, /释放未确认/);
  await new Promise(resolve => setImmediate(resolve));parent.abort();
  await assert.rejects(f.input.cancelSharedCapture(parent.signal), /释放未确认/);await rejected;
  assert.equal(f.input.hasActive(), false);assert.equal(f.draft, undefined);
  await assert.rejects(f.input.cancelSharedCapture(parent.signal), /释放未确认/);
  await assert.rejects(f.input.beginSharedCapture(9, {signal: parent.signal,
    deadline: new Date(Date.now() + 2000).toISOString()}), /释放未确认/);
  assert.equal(JSON.stringify(f.input.snapshot()).includes('private'), false);
  await f.input.dispose();
});

test('parent cancellation while the final session closed receipt is delayed prevents a late shared draft', async () => {
  const closed = deferred(), f = sharedFixture({managerClosed: closed}), parent = new AbortController();
  await f.input.beginSharedCapture(9, {signal: parent.signal, deadline: new Date(Date.now() + 2000).toISOString()});
  f.feed();const finishing = f.input.finishCapture(9);
  const rejected = assert.rejects(finishing, /取消/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.input.snapshot().session.state, 'cancelled');assert.equal(f.draft, undefined);
  parent.abort();closed.resolve();await rejected;
  assert.equal(f.draft, undefined);assert.equal(f.input.hasActive(), false);
  await f.input.dispose();
});

test('lease deadline reached during a delayed final closed receipt prevents a late shared draft', async () => {
  let clock = Date.now();
  const expiresAt = clock + 5000, closed = deferred(), parent = new AbortController();
  const f = sharedFixture({managerClosed: closed, clockNow: () => clock});
  await f.input.beginSharedCapture(9, {signal: parent.signal, deadline: new Date(expiresAt).toISOString()});
  f.feed();const finishing = f.input.finishCapture(9), rejected = assert.rejects(finishing, /取消/);
  await new Promise(resolve => setImmediate(resolve));assert.equal(f.draft, undefined);
  clock = expiresAt;closed.resolve();await rejected;
  assert.equal(parent.signal.aborted, false);assert.equal(f.draft, undefined);
  await f.input.dispose();
});

for (const action of ['complete', 'cancel', 'dispose', 'deadline']) {
  test(`manual dictation ${action} during delayed revoke delivers only a still-valid draft`, async t => {
    let clock = Date.now();
    const revokeGate = deferred();
    const f = sharedFixture({subscriberCount: 0, revokeGate, clockNow: () => clock});
    t.after(async () => { revokeGate.resolve(); await f.input.dispose(); });
    await f.input.beginCapture(9); f.feed();
    const finishing = f.input.finishCapture(9);
    const rejected = action === 'complete' ? undefined : assert.rejects(finishing, /取消/);
    await f.revokeEntered.promise;
    assert.equal(f.draft, undefined);
    let stopping;
    if (action === 'cancel') stopping = f.input.cancelCapture(9);
    if (action === 'dispose') stopping = f.input.dispose();
    if (action === 'deadline') clock += 10 * 60_000;
    revokeGate.resolve();
    if (action === 'complete') {
      assert.equal((await finishing).text, '下一条草稿');
      assert.deepEqual(f.draft, {senderId: 9, text: '下一条草稿'});
    } else {
      await rejected;
      await stopping;
      assert.equal(f.draft, undefined);
    }
    assert.equal(f.revokes, 1);
    assert.equal(f.recognitionStops, 1);
    assert.equal(f.input.hasActive(), false);
  });
}

test('explicit shared cancellation during final cleanup discards a draft without requiring parent abort', async t => {
  const closed = deferred(), f = sharedFixture({managerClosed: closed}), parent = new AbortController();
  t.after(async () => { closed.resolve(); await f.input.dispose(); });
  await f.input.beginSharedCapture(9, {signal: parent.signal, deadline: new Date(Date.now() + 2000).toISOString()});
  f.feed(); const finishing = f.input.finishCapture(9), rejected = assert.rejects(finishing, /取消/);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await f.input.cancelSharedCapture(new AbortController().signal), {cancelled: false});
  const cancelling = f.input.cancelSharedCapture(parent.signal);
  closed.resolve();
  assert.deepEqual(await cancelling, {cancelled: true});
  await rejected;
  assert.equal(parent.signal.aborted, false);
  assert.equal(f.draft, undefined);
  assert.equal(f.input.hasActive(), false);
});
