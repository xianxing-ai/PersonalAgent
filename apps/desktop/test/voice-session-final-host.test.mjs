import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {notificationDigest as digest} from '@personal-agent/notifications';
import {createVoiceSessionFinalHost} from '../electron/voice-session-final-host.js';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';

// Injected receipts and a Live event fixture. No microphone, speaker, named pipe, or Windows UI.
const transcriptDigest = text => createHash('sha256').update(text).digest('hex');
const localPolicy = {
  mode: 'normal', maxInterruptions: null, windowMinutes: 17, silentUntilUtc: null,
  preferredChannel: 'banner', allowUrgentBreakthrough: false, digestMode: 'on_return', quietHours: null,
};

function clock() {
  let time = Date.parse('2026-11-03T02:00:00.000Z');
  const signal = new AbortController().signal;
  const session = {sessionId: 'live-session', conversationId: 'fixture-conversation',
    deadline: new Date(time + 60_000).toISOString(), signal, pendingQuestion: null};
  const policy = {revision: 2, state: 'configured', local: localPolicy};
  return {session, policy, signal, now: () => time, advance(ms) { time += ms; }};
}

function receipt(env, text, extra = {}) {
  const completed = new Date(env.now()).toISOString();
  return {
    source: 'live_input_audio', phase: 'final', origin: 'user', echo: false,
    sessionId: env.session.sessionId, conversationId: env.session.conversationId, utteranceId: 'utterance-1',
    text, transcriptDigest: transcriptDigest(text), controlRevision: env.policy.revision,
    startedAt: completed, completedAt: completed, expiresAt: new Date(env.now() + 30_000).toISOString(),
    signal: env.signal, ...extra,
  };
}

function hostFor(env, configureSettings) {
  return createVoiceSessionFinalHost({
    readSession: () => env.session,
    readPolicy: () => env.policy,
    configureSettings,
    now: env.now,
  });
}

test('ordinary final becomes current-session input and never submits settings or approval', async () => {
  const env = clock();
  let writes = 0, responses = 0;
  const host = hostFor(env, () => { writes++; });
  const result = await host.consumeFinal(receipt(env, '查一下明天的天气'));
  assert.equal(result.accepted, true);
  assert.equal(result.kind, 'user_input');
  assert.equal(result.controlRevision, 2);
  assert.equal(result.text, '查一下明天的天气');
  assert.deepEqual(host.readCurrentInput(), {kind: 'user_input', sessionId: 'live-session', conversationId: 'fixture-conversation',
    controlRevision: 2, utteranceId: 'utterance-1', text: '查一下明天的天气', transcriptDigest: transcriptDigest('查一下明天的天气'),
    expiresAt: result.expiresAt});
  env.policy = {...env.policy, revision: 3};
  assert.equal(host.readCurrentInput(), null);
  assert.equal(writes, 0);
  assert.equal(responses, 0);
});

test('exact silence and resume commands preserve the current policy and do not approve', async () => {
  const env = clock();
  const seen = [];
  const host = hostFor(env, async (settings, authority) => {
    seen.push({settings, authority});
    const command = {settings, source: authority.source, phase: 'final', origin: 'user', echo: false,
      utteranceId: authority.utteranceId, transcriptDigest: authority.transcriptDigest,
      argumentsDigest: digest(settings), expiresAt: authority.expiresAt};
    assert.equal(host.verifyVoiceCommand(command), true);
    const forged = {...command, transcriptDigest: transcriptDigest('其他句子')};
    assert.equal(host.verifyVoiceCommand(forged), false);
    assert.equal(authority.isCurrent(), true);
    env.session = {...env.session, sessionId: 'replaced'};
    assert.equal(authority.isCurrent(), false);
    env.session = {...env.session, sessionId: 'live-session'};
    return {state: 'pending', taskId: 'settings-task'};
  });
  for (const [text, mode, command] of [['保持静默。', 'silent', 'notification_silence'], ['取消静默', 'normal', 'notification_resume']]) {
    env.session = {...env.session};
    const result = await host.consumeFinal(receipt(env, text, {utteranceId: text}));
    assert.equal(result.accepted, false);
    assert.equal(result.kind, 'control_command');
    assert.equal(result.command, command);
    assert.equal(result.reason, 'awaiting_existing_authorization');
    assert.equal(result.state, 'pending');
    const last = seen.at(-1);
    assert.equal(last.settings.expectedRevision, 2);
    assert.equal(last.settings.scope.kind, 'global');
    assert.equal(last.settings.patch.mode, mode);
    assert.equal(last.settings.patch.silentUntilUtc, null);
    assert.equal(last.settings.patch.windowMinutes, 17);
    assert.equal(last.settings.patch.maxInterruptions, null);
    assert.equal(last.authority.source, 'voice');
    assert.equal(host.readCurrentInput(), null);
  }
  assert.equal(seen.length, 2);
});

test('partial, echo, silence, stale revision, old session, negation and a pending card do not change settings', async () => {
  const env = clock();
  let writes = 0;
  const host = hostFor(env, () => { writes++; return {state: 'confirmed'}; });
  const samples = [
    [{phase: 'partial'}, 'stale_or_untrusted_final'],
    [{origin: 'model'}, 'stale_or_untrusted_final'],
    [{echo: true}, 'echo_rejected'],
    [{echo: 'unknown'}, 'echo_unverified'],
    [{text: '   ', transcriptDigest: transcriptDigest('   ')}, 'silence'],
    [{controlRevision: 1}, 'stale_control_revision'],
    [{sessionId: 'other'}, 'stale_session'],
    [{text: '不要保持静默', transcriptDigest: transcriptDigest('不要保持静默')}, 'user_input'],
    [{text: '同意', transcriptDigest: transcriptDigest('同意')}, 'user_input'],
  ];
  for (const [extra, reason] of samples) {
    const result = await host.consumeFinal(receipt(env, extra.text ?? '保持静默', {utteranceId: JSON.stringify(extra), ...extra}));
    if (reason === 'user_input') assert.equal(result.kind, 'user_input');
    else assert.equal(result.reason, reason);
    assert.notEqual(result.kind, 'control_command');
  }
  env.session = {...env.session, pendingQuestion: {questionId: 'card', revision: 4}};
  assert.equal((await host.consumeFinal(receipt(env, '保持静默', {utteranceId: 'card'}))).reason, 'awaiting_card');
  env.policy = {revision: 2, state: 'unconfigured', local: null};
  env.session = {...env.session, pendingQuestion: null};
  assert.equal((await host.consumeFinal(receipt(env, '开启静默', {utteranceId: 'bare'}))).reason, 'policy_unconfigured');
  const once = receipt(env, '查天气', {utteranceId: 'once', transcriptDigest: transcriptDigest('查天气')});
  env.policy = {revision: 2, state: 'configured', local: localPolicy};
  assert.equal((await host.consumeFinal(once)).accepted, true);
  assert.equal((await host.consumeFinal(once)).reason, 'duplicate_final');
  assert.equal(writes, 0);
});

test('Live production final keeps echo unknown, so silence does not reach settings', async () => {
  let writes = 0, emitted = 0;
  let host, request, frames, emittedReceipt;
  const now = Date.parse('2026-11-03T02:10:00.000Z');
  const contents = {mainFrame: {}, isDestroyed: () => false, send(_channel, message) {
    if (['start', 'stop'].includes(message.type)) queueMicrotask(() => host.receive({sender: contents, senderFrame: contents.mainFrame},
      {token: message.token, type: message.type === 'start' ? 'ready' : 'stopped'}));
  }};
  const router = createVoiceSessionFinalHost({
    readSession: () => host.readSessionBinding(),
    readPolicy: () => ({revision: 2, state: 'configured', local: localPolicy}),
    configureSettings: () => { writes++; return {state: 'confirmed'}; },
    now: () => now,
  });
  host = createLiveVoiceHost({getPanel: () => ({webContents: contents, isDestroyed: () => false, isVisible: () => true}), now: () => now,
    config: {snapshot: () => ({configured: true}), current: () => ({})}, microphoneHost: {authorize() {}, revoke: async () => {}},
    createSource: () => ({subscribe(options) { frames = options; return {ready: Promise.resolve(), closed: Promise.resolve(), unsubscribe() {}}; }, dispose: async () => {}}),
    createGateway: () => ({async connect(value) { request = value; return {sendAudio() {}, interrupt() {}, close: async () => {}}; }}),
    createConsumer: () => ({}), client: {}, readContext: () => '', onTranscript() {}, readConversationId: () => 'fixture-conversation',
    readCurrentQuestion: () => question, readControlRevision: () => 2,
    onSessionFinal: receipt => { emitted++; emittedReceipt = receipt; return router.consumeFinal(receipt); }});
  let question = null;
  await host.start();
  try {
    const binding = host.readSessionBinding();
    assert.equal(binding.conversationId, 'fixture-conversation');
    assert.equal(binding.pendingQuestion, null);
    request.onEvent({type: 'speech_started', utteranceId: 'spoken'});
    frames.onFrame({data: Uint8Array.of(1, 0)});
    request.onEvent({type: 'speech_stopped', utteranceId: 'spoken'});
    request.onEvent({type: 'transcript', id: 'spoken', utteranceId: 'spoken', role: 'user', phase: 'final', source: 'input_audio', text: '保持静默'});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(emitted, 1);
    assert.equal(writes, 0);
    assert.equal(router.readCurrentInput(), null);
    assert.equal(emittedReceipt.transcriptDigest, transcriptDigest('保持静默'));
    // Explicit Fake echo verification tests the receipt boundary, not acoustic detection.
    assert.equal((await router.consumeFinal({...emittedReceipt, echo: false})).accepted, true);
    assert.equal(writes, 1);
    question = {questionId: 'card', revision: 1, state: 'pending', taskId: 'task', sourceApprovalId: 'approval',
      expiresAt: new Date(now + 60_000).toISOString()};
    request.onEvent({type: 'speech_started', utteranceId: 'during-card'});
    frames.onFrame({data: Uint8Array.of(1, 0)});
    request.onEvent({type: 'speech_stopped', utteranceId: 'during-card'});
    request.onEvent({type: 'transcript', id: 'during-card', utteranceId: 'during-card', role: 'user', phase: 'final', source: 'input_audio', text: '保持静默'});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(emitted, 1);
    assert.equal(writes, 1);
  } finally { await host.stop(); }
});

test('a pending card suppresses the Live session final, and a direct voice settings call cannot approve itself', async () => {
  const responses = [];
  const channel = {readDeliveryOutcome: () => undefined, sendAdvisoryNotification: async () => {}, dispose() {}};
  const time = Date.now();
  let finalHost;
  const notifications = createDesktopNotificationApplicationHost({
    namespace: 'voice-final-fixture', channel, now: () => Date.now(),
    verifyVoiceFinal: command => finalHost.verifyVoiceCommand(command) === true,
  });
  const app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts', hostUserNamespace: 'voice-final-fixture',
    tools: notifications.tools, now: () => new Date()});
  const client = new Client(app, () => Date.now());
  await client.connect();
  const raw = client.call.bind(client);
  client.call = async (operation, ...rest) => { responses.push(operation); return raw(operation, ...rest); };
  notifications.bindApplication(app, client);
  const configured = await notifications.configureSettings({operationId: 'typed-policy', expectedRevision: 0, scope: {kind: 'global'}, patch: localPolicy});
  assert.equal(configured.state, 'confirmed');
  const before = responses.filter(name => name === 'authorization.respond').length;
  assert.equal(before, 1);
  const snapshot = notifications.snapshot({kind: 'global'});
  let session = {sessionId: 'live-session', conversationId: 'fixture-conversation', deadline: new Date(time + 60_000).toISOString(),
    signal: new AbortController().signal, pendingQuestion: null};
  finalHost = createVoiceSessionFinalHost({
    readSession: () => session,
    readPolicy: () => ({revision: snapshot.policy.revision, state: snapshot.policy.state, local: snapshot.policy.local}),
    configureSettings: (settings, authority) => notifications.configureSettings(settings, authority),
    now: () => Date.now(),
  });
  const text = '保持静默';
  const spoken = new Date().toISOString();
  const result = await finalHost.consumeFinal({
    source: 'live_input_audio', phase: 'final', origin: 'user', echo: false,
    sessionId: session.sessionId, conversationId: session.conversationId, utteranceId: 'real-final',
    text, transcriptDigest: transcriptDigest(text), controlRevision: snapshot.policy.revision,
    startedAt: spoken, completedAt: spoken, expiresAt: new Date(Date.now() + 120).toISOString(), signal: session.signal,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'awaiting_existing_authorization');
  assert.equal(responses.filter(name => name === 'authorization.respond').length, before);
  assert.equal(notifications.snapshot({kind: 'global'}).policy.effective.mode, 'normal');
  let forged;
  try {
    forged = await notifications.configureSettings({
      operationId: 'forged-voice', expectedRevision: snapshot.policy.revision, scope: {kind: 'global'},
      patch: {...localPolicy, mode: 'silent', silentUntilUtc: null},
    }, {source: 'voice', utteranceId: 'forged', transcriptDigest: digest('伪造'), expiresAt: new Date(Date.now() + 200).toISOString(), isCurrent: () => true});
  } catch (error) {
    forged = {state: 'rejected', message: error.message};
  }
  assert.notEqual(forged.state, 'confirmed');
  assert.equal(notifications.snapshot({kind: 'global'}).policy.effective.mode, 'normal');
  assert.equal(responses.filter(name => name === 'authorization.respond').length, before);
  notifications.dispose();
  await new Promise(resolve => setTimeout(resolve, 20));
  app.close();
});
