import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getEventListeners} from 'node:events';
import {LayaActionChoiceService, actionArgumentsDigest} from '../dist/index.js';

const choiceRequest = () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  return {context: 'Work update', deadline: expiresAt, signal: new AbortController().signal,
    candidates: ['keep', 'defer'].map((id, index) => ({id, revision: 1, kind: index ? 'defer' : 'noop',
      description: id, sources: [], scopeRef: 'local', expiresAt, risk: 'low', argumentsDigest: actionArgumentsDigest({})}))};
};
const validChoice = () => ({answers: {action: {choice: 'candidate_0',
  probabilities: {candidate_0: 0.9, candidate_1: 0.1}, answer_confidence: 0.9, confidence: 0.7}}});

test('a caller cannot renew the submitted choice deadline before an overdue model result settles', async () => {
  const request = choiceRequest(), deadline = Date.now() + 50;
  request.deadline = new Date(deadline).toISOString();
  let calls = 0;
  const service = new LayaActionChoiceService({infer() {
    calls++;
    while (Date.now() <= deadline) {}
    return Promise.resolve(validChoice());
  }});
  const pending = service.choose(request);
  request.deadline = new Date(Date.now() + 60_000).toISOString();
  const selected = await pending;
  assert.equal(calls, 1);
  assert.equal(selected.reason, 'deadline');
  assert.equal(selected.state, 'abstain');
  assert.equal(selected.eligibleForRuntime, false);
});

test('choice cancellation and listener cleanup retain the original submitted signal', async () => {
  for (const mode of ['cancelled', 'completed']) {
    let entered, release;
    const started = new Promise(resolve => {entered = resolve;});
    const waiting = new Promise(resolve => {release = resolve;});
    const service = new LayaActionChoiceService({async infer() {entered(); await waiting; return validChoice();}});
    const controller = new AbortController(), request = {...choiceRequest(), signal: controller.signal};
    const baseline = getEventListeners(controller.signal, 'abort').length;
    const pending = service.choose(request);
    await started;
    assert.equal(getEventListeners(controller.signal, 'abort').length, baseline + 1);
    request.signal = new AbortController().signal;
    if (mode === 'cancelled') controller.abort();
    release();
    const output = await pending;
    assert.equal(output.reason, mode === 'cancelled' ? 'cancelled' : 'selected');
    assert.equal(output.eligibleForRuntime, mode === 'completed');
    assert.equal(getEventListeners(controller.signal, 'abort').length, baseline);
  }
});

test('concrete candidates retain scores and binding; unauthorized, duplicate, changed and expired actions cannot execute', async () => {
  const expiresAt = new Date(Date.now() + 30_000).toISOString();
  const args = {folder: 'local-metadata', category: 'work'};
  const candidate = {id: 'group-work', revision: 2, kind: 'tool', description: 'Group this message in local work metadata',
    sources: [{id: 'message-1', revision: 3}], scopeRef: 'local-metadata-only', expiresAt, risk: 'low',
    tool: {name: 'inbox.classification.save', version: '1.0.0', arguments: args}, argumentsDigest: actionArgumentsDigest(args),
    authorization: {state: 'granted', refDigest: 'a'.repeat(64), scopeRef: 'local-metadata-only', argumentsDigest: actionArgumentsDigest(args), expiresAt}};
  const noop = {id: 'leave-unchanged', revision: 1, kind: 'noop', description: 'Keep current metadata unchanged',
    sources: candidate.sources, scopeRef: candidate.scopeRef, expiresAt, risk: 'low', argumentsDigest: actionArgumentsDigest({})};
  const revoked = {...candidate, id: 'revoked', authorization: {...candidate.authorization, state: 'revoked'}};
  let calls = 0;
  const service = new LayaActionChoiceService({async infer(payload) {
    calls++;
    assert.equal(Object.keys(payload.questions.action.criteria).length, 2);
    assert.doesNotMatch(JSON.stringify(payload), /aaaaaaaa|local-metadata-only|"arguments"/);
    return {answers: {action: {choice: 'candidate_0', probabilities: {candidate_0: 0.9, candidate_1: 0.1},
      answer_confidence: 0.9, confidence: 0.42}}};
  }});
  const request = candidates => ({context: 'A new work message arrived', candidates,
    deadline: expiresAt, signal: new AbortController().signal});
  const selected = await service.choose(request([candidate, noop, revoked]));
  assert.equal(selected.state, 'selected'); assert.equal(selected.eligibleForRuntime, true);
  assert.deepEqual(selected.selected, {id: 'group-work', revision: 2});
  assert.deepEqual(selected.scores.map(item => item.probability), [0.9, 0.1, null]);
  assert.equal(selected.receipt.candidates[2].exclusion, 'unauthorized');
  assert.equal(selected.calibrated, false);
  const highRisk = await service.choose(request([{...candidate, risk: 'high'}, noop]));
  assert.equal(highRisk.state, 'review'); assert.equal(highRisk.eligibleForRuntime, false);
  await assert.rejects(service.choose(request([candidate, candidate])), /duplicate/);
  await assert.rejects(service.choose(request([{...candidate, tool: {...candidate.tool, arguments: {folder: 'changed'}}}, noop])), /digest mismatch/);
  await assert.rejects(service.choose(request([{...candidate, authorization: {...candidate.authorization, scopeRef: 'another-scope'}}, noop])), /binding mismatch/);
  const expired = {...candidate, expiresAt: '2000-01-01T00:00:00.000Z'};
  const noFakeChoice = await service.choose(request([expired, noop]));
  assert.equal(noFakeChoice.reason, 'insufficient_candidates'); assert.equal(calls, 2);
  const fullContext = 'A detailed source update. '.repeat(200);
  const detailed = await service.choose({...request([{...candidate,
    description: 'Explain the affected local metadata. '.repeat(30)}, noop]), context: fullContext});
  assert.equal(detailed.state, 'selected', 'ordinary context must not hit the old demo text caps');
  assert.equal(calls, 3);
  const fabricated = new LayaActionChoiceService({async infer() {
    return {answers: {action: {choice: 'revoked', probabilities: {candidate_0: 0.9, candidate_1: 0.1}, answer_confidence: 0.9, confidence: 1}}};
  }});
  assert.equal((await fabricated.choose(request([candidate, noop, revoked]))).eligibleForRuntime, false);
});
