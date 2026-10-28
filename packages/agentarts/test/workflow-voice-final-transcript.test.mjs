import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVoiceFinalTranscriptService,
  createVoiceFinalTranscriptAdapter,
  voiceFinalTranscriptDigest,
  VOICE_FINAL_TRANSCRIPT_UNAVAILABLE_REASON,
} from '../dist/workflow-voice-final-transcript.js';
import {OwnedWorkflowEngine} from '../dist/owned-workflows.js';

const scopes = ['voice.final_transcript'];
const context = () => ({
  taskId: 'fixture-task', runId: 'fixture-run', signal: new AbortController().signal,
  deadline: new Date(Date.now() + 60_000).toISOString(),
  authorizationRef: 'existing-runtime-authorization', scopes,
});

function receipt(text = '同意', extra = {}) {
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const completedAt = new Date().toISOString();
  return {
    source: 'live_input_audio', phase: 'final', origin: 'user', echo: false,
    sessionId: 'live-session', utteranceId: 'utt-1', text,
    transcriptDigest: voiceFinalTranscriptDigest(text),
    questionId: 'q-1', questionRevision: 2,
    startedAt, completedAt, expiresAt: new Date(Date.now() + 30_000).toISOString(),
    ...extra,
  };
}

test('missing Desktop final port stays unavailable with an explicit reason; never Fake ASR success', async () => {
  const service = createVoiceFinalTranscriptService({requiredScopes: scopes});
  assert.equal(service.status().state, 'unavailable');
  assert.equal(service.status().reason, VOICE_FINAL_TRANSCRIPT_UNAVAILABLE_REASON);
  const adapter = createVoiceFinalTranscriptAdapter(service);
  assert.equal(adapter.descriptor.name, 'workflow.host.f02_n03');
  assert.equal(adapter.descriptor.sideEffect, 'read');
  const result = await adapter.execute({}, context());
  assert.equal(result.state, 'unavailable');
  assert.equal(result.capability, 'voice.final_transcript');
  assert.equal(result.nodeId, 'F02_N03');
  assert.match(result.reason, /Desktop voice final receipt port unavailable/);
  assert.equal(result.text, undefined);
});

test('injected trusted final receipt completes; partial echo empty and digest mismatch stay unavailable', async () => {
  let last;
  const port = {
    async readFinal(request) {
      last = request;
      return {state: 'completed', receipt: receipt()};
    },
  };
  const adapter = createVoiceFinalTranscriptAdapter(
    createVoiceFinalTranscriptService({port, requiredScopes: scopes}));
  const ok = await adapter.execute({questionId: 'q-1', questionRevision: 2}, context());
  assert.equal(ok.state, 'completed');
  assert.equal(ok.text, '同意');
  assert.equal(ok.phase, 'final');
  assert.equal(ok.echo, false);
  assert.equal(last.workflowId, 'F02');
  assert.equal(last.nodeId, 'F02_N03');

  for (const bad of [
    {phase: 'partial'},
    {echo: true},
    {origin: 'model'},
    {text: '   ', transcriptDigest: voiceFinalTranscriptDigest('   ')},
    {transcriptDigest: '0'.repeat(64)},
  ]) {
    const rejecting = createVoiceFinalTranscriptAdapter(createVoiceFinalTranscriptService({
      port: {async readFinal() {return {state: 'completed', receipt: receipt('同意', bad)};}},
      requiredScopes: scopes,
    }));
    const result = await rejecting.execute({}, context());
    assert.equal(result.state, 'unavailable', JSON.stringify(bad));
    assert.match(result.reason, /untrusted_or_partial_voice_receipt_rejected/);
  }
});

test('F02 engine without published F02_N03 adapter cannot settle as Fake success', async () => {
  const engine = new OwnedWorkflowEngine({
    checkpointSecret: 'synthetic-voice-final-checkpoint-key-32b',
    externalHost: true,
    decisionTool: {name: 'decision.choose_candidate', version: '1.0.0'},
    prepareCandidates: async () => [{id: 'review', description: 'no evidence', value: null, abstain: true}],
  });
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const request = {
    workflowId: 'F02', taskId: 'f02-task', sessionId: 'f02-session',
    controlRevision: 1, requestId: 'f02-req', input: {goal: 'fixture voice confirm'},
    deadline, taskDeadline: deadline, signal: new AbortController().signal,
    availableTools: [], mode: 'main',
  };
  let last = await engine.advance(request);
  for (let step = 0; step < 20 && last.state === 'progress'; step++) {
    last = await engine.advance({...request, checkpoint: last.checkpoint});
  }
  assert.notEqual(last.state, 'settled', 'missing voice.final_transcript adapter must not Fake-complete F02');
  assert.equal(last.state, 'unavailable');
  assert.ok(
    last.unavailable?.some(item => item.nodeId === 'F02_N03'
      || item.capabilities?.some(cap => String(cap).includes('voice.final_transcript')))
    || last.nodes.F02_N03?.state === 'unavailable'
    || Object.values(last.nodes).some(node => node.state === 'unavailable'),
  );
});
