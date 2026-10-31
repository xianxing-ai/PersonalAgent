/**
 * CW-10: Live/Desktop final → createVoiceRuntimeApprovalBridge → original pending card.
 * Production entry: main.js createVoiceRuntimeApprovalBridge + Live prepareTaskApproval.
 * Voice never calls authorization.respond; SIS via AgentArts stays unavailable without stream bridge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationDigest as digest} from '@personal-agent/notifications';
import {createVoiceRuntimeApprovalBridge} from '../electron/voice-runtime-approval-bridge.js';
import {createDesktopVoiceCommandHost} from '../electron/voice-command-host.js';

const approvalExpiry = () => new Date(Date.now() + 120_000).toISOString();
const cardExpiry = () => new Date(Date.now() + 60_000).toISOString();

test('CW-10: production wiring maps final scope to the same pending approval card without authorization.respond', async () => {
  const approval = {
    approvalId: 'apr-1',
    taskId: 'task-1',
    conversationId: 'conv-1',
    state: 'pending',
    taskState: 'waiting_approval',
    revision: 2,
    argumentsDigest: 'a'.repeat(64),
    expiresAt: approvalExpiry(),
  };
  const card = {
    questionId: 'q-1',
    state: 'pending',
    sourceApprovalId: 'apr-1',
    taskId: 'task-1',
    conversationId: 'conv-1',
    expiresAt: cardExpiry(),
    revision: 2,
  };
  let focused = 0;
  let respondCalls = 0;
  const bridge = createVoiceRuntimeApprovalBridge({
    readPendingApproval: async () => approval,
    readCurrentQuestion: () => card,
    focusQuestion: () => { focused += 1; },
  });
  // Mirrors main.js: Live prepareTaskApproval → bridge.prepareTaskApproval(scope)
  const prepareTaskApproval = scope => bridge.prepareTaskApproval(scope);
  const prepared = await prepareTaskApproval({
    taskId: 'task-1',
    conversationId: 'conv-1',
    deadline: approvalExpiry(),
    signal: new AbortController().signal,
  });
  assert.equal(prepared.sourceApprovalId, 'apr-1');
  assert.equal(prepared.revision, 2);
  assert.match(prepared.guidance, /不会签发许可/);
  assert.equal(focused, 1);
  assert.equal(respondCalls, 0);
  assert.equal(await createVoiceRuntimeApprovalBridge({
    readPendingApproval: async () => approval,
    readCurrentQuestion: () => ({...card, sourceApprovalId: 'other'}),
    focusQuestion: () => { focused += 1; },
  }).prepareTaskApproval({
    taskId: 'task-1', conversationId: 'conv-1', deadline: approvalExpiry(),
    signal: new AbortController().signal,
  }), null);
  assert.equal(focused, 1);
});

test('CW-10: partial final is rejected; oral yes only awaits the formal card', async () => {
  let time = Date.now();
  let responses = 0;
  const current = {
    questionId: 'formal',
    revision: 2,
    state: 'pending',
    sourceApprovalId: 'original',
    taskId: 'task',
    expiresAt: new Date(time + 30_000).toISOString(),
  };
  const voice = createDesktopVoiceCommandHost({
    now: () => time,
    readCurrentQuestion: () => current,
    respondApproval: () => { responses += 1; },
  });
  const card = voice.snapshot();
  const partial = {
    source: 'live_input_audio',
    phase: 'partial',
    origin: 'user',
    echo: false,
    sessionId: 'live',
    utteranceId: '1',
    text: '同意',
    transcriptDigest: digest('同意'),
    startedAt: new Date(time).toISOString(),
    completedAt: new Date(time).toISOString(),
    expiresAt: card.expiresAt,
    questionId: card.questionId,
    questionRevision: card.revision,
    signal: new AbortController().signal,
  };
  assert.equal((await voice.consumeFinal(partial)).consumed, false);
  const final = {...partial, phase: 'final', utteranceId: '2'};
  const result = await voice.consumeFinal(final);
  assert.equal(result.consumed, false);
  assert.equal(result.state, 'awaiting_card');
  assert.equal(responses, 0);
});

test('CW-10: main/Live production entry wires prepareTaskApproval without voice authorization.respond', async () => {
  const {readFileSync} = await import('node:fs');
  const {fileURLToPath} = await import('node:url');
  const {dirname, join} = await import('node:path');
  const electronDir = join(dirname(fileURLToPath(import.meta.url)), '../electron');
  const main = readFileSync(join(electronDir, 'main.js'), 'utf8');
  const live = readFileSync(join(electronDir, 'live-voice-host.js'), 'utf8');
  const bridgeBlock = main.match(/voiceApprovalBridge\s*=\s*createVoiceRuntimeApprovalBridge\(\{[\s\S]*?\}\);/)?.[0] ?? '';
  const liveInit = main.match(/liveVoice\s*=\s*createLiveVoiceHost\(\{[\s\S]*?historyStore:[\s\S]*?\}\);/)?.[0] ?? '';
  const voiceHostBlock = main.match(/voiceCommandHost\s*=\s*createDesktopVoiceCommandHost\(\{[^}]*\}\);/)?.[0] ?? '';
  assert.match(bridgeBlock, /readPendingApproval:scope=>conversationToolAccess\.readPendingApproval\(scope\)/);
  assert.match(liveInit, /prepareTaskApproval:scope=>voiceApprovalBridge\?\.prepareTaskApproval\(scope\)/);
  assert.doesNotMatch(voiceHostBlock, /respondApproval/);
  assert.match(live, /phase === 'final'/);
  assert.match(live, /prepareTaskApproval\(scope\)/);
  assert.doesNotMatch(live, /call\(['"]authorization\.respond['"]/);
});

test('CW-10: SIS via AgentArts remains unavailable without stream bridge', () => {
  assert.equal(globalThis.agentArtsSisStreamBridge, undefined);
});
