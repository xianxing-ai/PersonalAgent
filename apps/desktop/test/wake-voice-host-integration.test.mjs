import assert from 'node:assert/strict';
import test from 'node:test';
import {createVoicePcmFrameSourcePort, VoiceSessionManager, VOICE_AUDIO_FORMAT} from '@personal-agent/voice';
import {FakeSpeechKeywordDetectorPort, FakeSpeechRecognitionPort,
  FakeSpeechOutputPort, FakeTranscriptConsumerPort} from '@personal-agent/voice/testing';
import {createMicrophoneCaptureHost} from '../electron/microphone-capture-host.js';
import {createDesktopVoiceInput} from '../electron/voice-input.js';
import {createDesktopWakeVoiceHost} from '../electron/wake-voice-host.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let count = 0; count < 500; count++) {
    if (predicate()) return;
    await turn();
  }
  assert.fail('consumer did not reach the expected bounded state');
}

/** Actual Desktop/public Voice consumers; panel, permission, keyword and speech are explicit Fakes. */
function fixture(t, options = {}) {
  const commands = [], sourceRequests = [], keywordRequests = [], keywordFrames = [];
  const detectors = [], recognitionCalls = [], recognitionStops = [], drafts = [];
  let permission, microphone, busy = false, taskCalls = 0;
  const contents = {id: 7, mainFrame: {}, isDestroyed: () => false,
    send(channel, message) {
      assert.equal(channel, 'desktop:microphone-command');
      commands.push(message);
      if (message.type === 'start' && options.autoReady !== false) queueMicrotask(() => {
        microphone.receive(event, {type: 'ready', token: message.token,
          trackLive: options.trackLive !== false, sampleRate: 16_000});
      });
      if (message.type === 'stop') queueMicrotask(() => {
        microphone.receive(event, {type: 'stopped', token: message.token,
          tracksStopped: options.tracksStopped !== false});
      });
    }};
  const panel = {webContents: contents, isDestroyed: () => false, isVisible: () => true};
  const event = {sender: contents, senderFrame: contents.mainFrame};
  microphone = createMicrophoneCaptureHost({getPanel: () => panel,
    permissionGate: {grant(lease) {
      permission = lease;
      let revoked = false;
      return () => {if (!revoked) {revoked = true; lease.onRevoke();}};
    }}});
  const authorize = microphone.authorize;
  let authorizations = 0;
  microphone.authorize = input => {
    authorizations++;
    return authorize(options.leaseMs ? {deadline: new Date(Date.now() + options.leaseMs).toISOString()} : input);
  };
  const sourceBindings = [];
  function source(binding) {
    sourceBindings.push(binding);
    const port = createVoicePcmFrameSourcePort(binding);
    const subscribe = port.subscribe.bind(port);
    return {...port, subscribe(request) {sourceRequests.push(request); return subscribe(request);}};
  }
  const recognition = {recognize(request) {
    recognitionCalls.push({request, bytes: [...request.audio]});
    return {result: options.recognitionResult ?? Promise.resolve({text: '合成语音草稿', locale: 'zh-CN'}),
      async stop(reason) {
        recognitionStops.push(reason);
        if (options.recognitionStopFails) throw Error('synthetic ASR release failed');
      }};
  }};
  const speechPorts = {recognition, output: {speak() {throw Error('dictation must not speak');}}, dispose: async () => {}};
  const voiceInput = createDesktopVoiceInput({source: source(microphone.binding), microphoneHost: microphone,
    speechPorts, enabled: true, inputMode: 'dictation', autoPlay: false,
    client: {call() {taskCalls++; throw Error('dictation must not submit Runtime work');}},
    onTranscript: value => drafts.push(value)});
  if (options.playbackManager) {
    // A public Manager playback stream injected at the host port, not a dictation playback path.
    const subscribe = voiceInput.subscribePlayback.bind(voiceInput);
    voiceInput.subscribePlayback = listener => {
      const local = subscribe(listener), playback = options.playbackManager.subscribe(listener);
      return () => {local(); playback();};
    };
  }
  const wake = createDesktopWakeVoiceHost({getPanel: () => panel, microphoneHost: microphone,
    voiceInput, isBusy: () => busy, createSource: source,
    createDetector() {
      const detector = new FakeSpeechKeywordDetectorPort({simulateUnsupported: options.keywordUnsupported?.(detectors.length) ?? false});
      const start = detector.start.bind(detector), dispose = detector.dispose.bind(detector);
      detector.start = request => {
        keywordRequests.push(request);
        const session = start(request), accept = session.accept.bind(session);
        session.accept = frame => {keywordFrames.push([...frame.data]); accept(frame);};
        return session;
      };
      detector.dispose = async () => {await dispose(); if (options.detectorDisposeFails) throw Error('synthetic keyword cleanup failed');};
      detectors.push(detector);
      return detector;
    }});
  t.after(async () => {
    await wake.dispose().catch(() => {});
    await voiceInput.dispose().catch(() => {});
  });
  return {wake, voiceInput, microphone, panel, event, commands, sourceRequests, sourceBindings,
    detectors, keywordRequests, keywordFrames, recognitionCalls, recognitionStops, drafts,
    permission: () => permission, taskCalls: () => taskCalls, authorizations: () => authorizations,
    setBusy: value => {busy = value;},
    frame(data = new Uint8Array(320).fill(3)) {
      const token = commands.findLast(command => command.type === 'start').token;
      assert.equal(microphone.receive(event, {type: 'frame', token, data}), true);
      assert.ok(data.every(byte => byte === 0));
    }};
}

test('trusted Wake readiness and dictated draft share one physical microphone and original lease', async t => {
  const f = fixture(t, {autoReady: false});
  assert.equal(f.wake.hasActive(), false);
  assert.equal(f.commands.length, 0);
  assert.equal(f.sourceRequests.length, 0);
  assert.equal(f.microphone.snapshot().subscriberCount, 0);
  await assert.rejects(async () => f.wake.enable(99));
  f.panel.isVisible = () => false;
  await assert.rejects(async () => f.wake.enable(7));
  f.panel.isVisible = () => true;
  assert.equal(f.authorizations(), 0);
  const enabling = f.wake.enable(f.panel.webContents.id);
  enabling.catch(() => {});
  await until(() => f.commands.some(command => command.type === 'start'));
  assert.equal(f.wake.snapshot().phase, 'enabling');
  assert.notEqual(f.wake.snapshot().state, 'listening');
  f.microphone.receive(f.event, {type: 'ready', token: f.commands[0].token, trackLive: true, sampleRate: 16_000});
  await enabling;
  assert.equal(f.wake.snapshot().phase, 'listening');
  assert.equal(f.wake.snapshot().verification, 'unverified');
  const expiresAtMs = f.wake.snapshot().expiresAtMs;
  assert.equal(Date.parse(f.keywordRequests[0].deadline), expiresAtMs);
  f.detectors[0].sessions[0].emitDetected();
  await until(() => f.microphone.snapshot().subscriberCount === 2 && f.voiceInput.snapshot().status === 'listening');
  assert.equal(f.authorizations(), 1);
  assert.equal(f.commands.filter(command => command.type === 'start').length, 1);
  assert.ok(f.sourceBindings.every(binding => binding === f.microphone.binding));
  assert.ok(f.sourceRequests.every(request => Date.parse(request.deadline) <= expiresAtMs));
  f.frame();
  await turn();
  const result = await f.voiceInput.finishCapture(f.panel.webContents.id);
  assert.equal(result.text, '合成语音草稿');
  assert.equal(f.recognitionCalls.length, 1);
  assert.equal(Date.parse(f.recognitionCalls[0].request.deadline), expiresAtMs);
  assert.deepEqual(f.recognitionCalls[0].bytes, f.keywordFrames[0]);
  assert.equal(f.microphone.snapshot().subscriberCount, 1);
  assert.equal(f.commands.filter(command => command.type === 'stop').length, 0);
  assert.equal(f.drafts.length, 1);
  assert.equal(f.taskCalls(), 0);
  await f.wake.disable();
  assert.equal(f.microphone.snapshot().lastRelease.verified, true);
  assert.equal(f.wake.hasActive(), false);
});

test('revoking the original microphone lease cancels in-flight ASR without delivering a late draft', async t => {
  let resolveRecognition;
  const recognitionResult = new Promise(resolve => {resolveRecognition = resolve;});
  const f = fixture(t, {recognitionResult});
  await f.wake.enable(7);
  await f.wake.beginCapture(7);
  f.frame(); await turn();
  const finishing = f.voiceInput.finishCapture(7);
  const failed = assert.rejects(finishing);
  await until(() => f.recognitionCalls.length === 1);
  f.permission().onRevoke();
  await failed;
  await until(() => !f.wake.hasActive());
  assert.equal(f.recognitionCalls[0].request.signal.aborted, true);
  assert.equal(f.recognitionStops.length, 1);
  resolveRecognition({text: 'late synthetic text', locale: 'zh-CN'});
  await turn();
  assert.equal(f.drafts.length, 0);
  assert.equal(f.taskCalls(), 0);
  assert.equal(f.microphone.snapshot().lastRelease.verified, true);
});

test('source lease expiry bounds ASR and never renews authorization for shared capture', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: Date.now()});
  // Synthetic trusted lease and clock; production keeps its existing ten-minute authorization.
  const f = fixture(t, {leaseMs: 400, recognitionResult: new Promise(() => {})});
  await f.wake.enable(7);
  const expiresAtMs = f.wake.snapshot().expiresAtMs;
  await f.wake.beginCapture(7);
  f.frame(); await turn();
  const finishing = f.voiceInput.finishCapture(7);
  const failed = assert.rejects(finishing);
  await until(() => f.recognitionCalls.length === 1);
  assert.equal(Date.parse(f.recognitionCalls[0].request.deadline), expiresAtMs);
  t.mock.timers.tick(401);
  await failed;
  await until(() => !f.wake.hasActive());
  assert.equal(f.authorizations(), 1);
  assert.equal(f.recognitionCalls[0].request.signal.aborted, true);
  assert.equal(f.recognitionStops.length, 1);
  assert.equal(f.drafts.length, 0);
});

test('shared cancellation cannot stop an unrelated manual capture after the Wake lease ended', async t => {
  const f = fixture(t);
  await f.wake.enable(7);
  await f.wake.beginCapture(7);
  await f.voiceInput.cancelSharedCapture(new AbortController().signal);
  assert.equal(f.voiceInput.hasActive(), true);
  assert.equal(f.microphone.snapshot().subscriberCount, 2);
  const previousDetection = f.keywordRequests[0].onDetected;
  const previousSignal = f.keywordRequests[0].signal;
  await f.wake.disable();
  await f.voiceInput.beginCapture(7);
  await f.voiceInput.cancelSharedCapture(previousSignal);
  previousDetection();
  await turn();
  assert.equal(f.voiceInput.hasActive(), true);
  assert.equal(f.microphone.snapshot().subscriberCount, 1);
  assert.equal(f.authorizations(), 2);
  await f.voiceInput.cancelCapture(7);
  assert.equal(f.microphone.snapshot().lastRelease.verified, true);
});

test('failed keyword readiness never attaches microphone and a confirmed cleanup permits a fresh attempt', async t => {
  const f = fixture(t, {keywordUnsupported: attempt => attempt === 0});
  await assert.rejects(async () => f.wake.enable(7));
  assert.equal(f.commands.filter(command => command.type === 'start').length, 0);
  assert.equal(f.microphone.snapshot().subscriberCount, 0);
  assert.equal(f.detectors[0].disposed, true);
  assert.equal(f.wake.hasActive(), false);
  await f.wake.enable(7);
  assert.equal(f.wake.snapshot().phase, 'listening');
  assert.equal(f.commands.filter(command => command.type === 'start').length, 1);
  await f.wake.disable();
});

test('physical track failure remains unknown and prevents microphone or Wake restart', async t => {
  const f = fixture(t, {tracksStopped: false});
  await f.wake.enable(7);
  await assert.rejects(async () => f.wake.disable());
  assert.equal(f.microphone.snapshot().lastRelease.verified, false);
  assert.equal(f.wake.snapshot().phase, 'release_unconfirmed');
  assert.equal(f.wake.hasActive(), true);
  await assert.rejects(async () => f.wake.enable(7));
  assert.throws(() => f.microphone.authorize(), /释放未确认/);
  assert.equal(f.commands.filter(command => command.type === 'start').length, 1);
});

test('keyword cleanup failure locks restart even when physical microphone release is confirmed', async t => {
  const f = fixture(t, {detectorDisposeFails: true});
  await f.wake.enable(7);
  await assert.rejects(async () => f.wake.disable());
  assert.equal(f.microphone.snapshot().lastRelease.verified, true);
  assert.equal(f.wake.snapshot().phase, 'release_unconfirmed');
  assert.equal(f.wake.hasActive(), true);
  await assert.rejects(async () => f.wake.enable(7));
  assert.equal(f.authorizations(), 1);
});

test('failed in-flight ASR release cannot be hidden by confirmed microphone track shutdown', async t => {
  const f = fixture(t, {recognitionStopFails: true, recognitionResult: new Promise(() => {})});
  await f.wake.enable(7);
  await f.wake.beginCapture(7);
  f.frame(); await turn();
  const finishing = f.voiceInput.finishCapture(7);
  const failed = assert.rejects(finishing);
  await until(() => f.recognitionCalls.length === 1);
  await assert.rejects(async () => f.wake.disable());
  await failed;
  assert.equal(f.microphone.snapshot().lastRelease.verified, true);
  assert.equal(f.wake.snapshot().phase, 'release_unconfirmed');
  assert.equal(f.wake.hasActive(), true);
  assert.equal(f.recognitionCalls[0].request.signal.aborted, true);
  assert.equal(f.drafts.length, 0);
  await assert.rejects(async () => f.wake.enable(7));
});

test('Live ownership predicate blocks Wake acquisition and shared capture while preserving the existing lease', async t => {
  const f = fixture(t);
  f.setBusy(true);
  await assert.rejects(async () => f.wake.enable(7));
  assert.equal(f.authorizations(), 0);
  assert.equal(f.commands.length, 0);
  f.setBusy(false);
  await f.wake.enable(7);
  f.setBusy(true);
  await assert.rejects(async () => f.wake.beginCapture(7));
  assert.equal(f.authorizations(), 1);
  assert.equal(f.microphone.snapshot().subscriberCount, 1);
  f.setBusy(false);
  await f.wake.disable();
});

test('actual VoiceSessionManager playback updates suppress Wake without pretending dictation has playback', async t => {
  const output = new FakeSpeechOutputPort(() => new Promise(() => {}));
  const manager = new VoiceSessionManager({output,
    recognition: new FakeSpeechRecognitionPort(() => ({text: 'synthetic playback request', locale: 'zh-CN'}))});
  t.after(async () => {if (manager.current()) await manager.stop(manager.current().sessionId).catch(() => {});});
  const f = fixture(t, {playbackManager: manager});
  await f.wake.enable(7);
  const session = await manager.start({signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString(), locale: 'zh-CN'});
  const transcript = await manager.recognizeAudio(session.sessionId,
    {data: new Uint8Array(320), format: VOICE_AUDIO_FORMAT, durationMs: 10});
  const reply = await manager.consumeTranscript(session.sessionId, transcript.transcriptId,
    new FakeTranscriptConsumerPort(() => ({replyText: 'synthetic reply', locale: 'zh-CN'})));
  const speaking = manager.speakReply(session.sessionId, reply.replyId);
  await until(() => f.wake.snapshot().playbackActive === true);
  f.detectors[0].sessions[0].emitDetected();
  await turn();
  assert.equal(f.voiceInput.hasActive(), false);
  assert.equal(f.microphone.snapshot().subscriberCount, 1);
  assert.equal(f.recognitionCalls.length, 0);
  assert.equal(output.calls.length, 1);
  await manager.stopSpeaking(session.sessionId);
  await speaking;
  assert.equal(f.wake.snapshot().playbackActive, false);
  assert.equal(output.activeOperations, 0);
  await f.wake.disable();
});
