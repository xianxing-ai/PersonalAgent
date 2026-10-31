import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRuntimeOwnedWorkflowTools,
} from '../dist/application/owned-workflow-application.js';
import {
  voiceFinalTranscriptDigest,
  VOICE_FINAL_TRANSCRIPT_UNAVAILABLE_REASON,
} from '@personal-agent/agentarts';

test('owned workflow tools omit F02_N03 without an injected final port', () => {
  assert.deepEqual(createRuntimeOwnedWorkflowTools({}), []);
  assert.deepEqual(createRuntimeOwnedWorkflowTools({voiceFinalTranscript: {}}), []);
});

test('injected final port registers workflow.host.f02_n03 and rejects Fake partial success', async () => {
  const text = '确认';
  const receipt = {
    source: 'live_input_audio', phase: 'final', origin: 'user', echo: false,
    sessionId: 's1', utteranceId: 'u1', text,
    transcriptDigest: voiceFinalTranscriptDigest(text),
    questionId: 'q', questionRevision: 1,
    startedAt: new Date(Date.now() - 10).toISOString(),
    completedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const tools = createRuntimeOwnedWorkflowTools({
    voiceFinalTranscript: {
      port: {async readFinal() {return {state: 'completed', receipt};}},
      requiredScopes: ['voice.final_transcript'],
    },
  });
  assert.equal(tools.length, 1);
  assert.equal(tools[0].descriptor.name, 'workflow.host.f02_n03');
  const context = {
    taskId: 't', runId: 'r', signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    authorizationRef: 'auth', scopes: ['voice.final_transcript'],
  };
  const ok = await tools[0].execute({}, context);
  assert.equal(ok.state, 'completed');
  assert.equal(ok.text, text);

  const missing = createRuntimeOwnedWorkflowTools({
    voiceFinalTranscript: {
      port: {async readFinal() {
        return {state: 'unavailable', reason: VOICE_FINAL_TRANSCRIPT_UNAVAILABLE_REASON};
      }},
      requiredScopes: ['voice.final_transcript'],
    },
  });
  const denied = await missing[0].execute({}, context);
  assert.equal(denied.state, 'unavailable');
  assert.match(denied.reason, /unavailable|Desktop voice final/i);
});
