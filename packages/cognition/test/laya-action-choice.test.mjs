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

test('choice requests and candidate payloads are gated before any model access', async () => {
  let calls = 0;
  const service = new LayaActionChoiceService({async infer() {calls++; return validChoice();}});
  const base = choiceRequest();
  await assert.rejects(service.choose({...base, candidates: base.candidates.slice(0, 1)}), /Invalid action choice request/,
    'a single option is a rubber stamp, not a choice');
  const many = Array.from({length: 17}, (_, index) => ({...base.candidates[0], id: `extra-${index}`}));
  await assert.rejects(service.choose({...base, candidates: many}), /Invalid action choice request/);
  await assert.rejects(service.choose({...base, context: '   '}), /Invalid action choice request/);
  await assert.rejects(service.choose({...base, deadline: 'not-a-date'}), /Invalid action choice request/);
  await assert.rejects(service.choose({...base, signal: undefined}), /Invalid action choice request/);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const args = {folder: 'work'};
  const tool = {name: 'inbox.classification.save', version: '1.0.0', arguments: args};
  const digest = actionArgumentsDigest(args);
  const sources = [{id: 'message-1', revision: 3}];
  const toolCandidate = {id: 'with-tool', revision: 1, kind: 'tool', description: 'Group this message',
    sources, scopeRef: 'local', expiresAt, risk: 'low', tool, argumentsDigest: digest};
  await assert.rejects(service.choose({...base, candidates: [{...toolCandidate, tool: undefined}, base.candidates[0]]}),
    /Tool candidate is not executable/);
  await assert.rejects(service.choose({...base, candidates: [{...base.candidates[0], tool}, base.candidates[1]]}),
    /Non-tool candidate cannot hide a tool/, 'noop or defer carriers must not smuggle executable tools');
  assert.equal(calls, 0, 'validation failures must never reach the model');
});

test('model probability answers are re-verified against the eligible set before any selection', async () => {
  for (const [name, answer] of [
    ['missing probability key', {choice: 'candidate_0', probabilities: {candidate_0: 1}, answer_confidence: 1, confidence: 0.5}],
    ['out-of-range probability', {choice: 'candidate_0', probabilities: {candidate_0: 1.5, candidate_1: -0.5}, answer_confidence: 1, confidence: 0.5}],
    ['mass not conserved', {choice: 'candidate_0', probabilities: {candidate_0: 0.9, candidate_1: 0.2}, answer_confidence: 0.9, confidence: 0.5}],
    ['chosen is not top ranked', {choice: 'candidate_0', probabilities: {candidate_0: 0.3, candidate_1: 0.7}, answer_confidence: 0.7, confidence: 0.5}],
    ['confidence disagrees with the top candidate', {choice: 'candidate_0', probabilities: {candidate_0: 0.9, candidate_1: 0.1}, answer_confidence: 0.5, confidence: 0.5}],
  ]) {
    const service = new LayaActionChoiceService({async infer() {return {answers: {action: answer}};}});
    const result = await service.choose(choiceRequest());
    assert.equal(result.reason, 'invalid_response', name);
    assert.equal(result.state, 'abstain', name);
    assert.equal(result.eligibleForRuntime, false, name);
    assert.deepEqual(result.scores.map(item => item.probability), [null, null], name);
  }
});

test('a candidate expiring during inference abstains with its scores intact and thin margins stay in review', async () => {
  const expiresAt = new Date(Date.now() + 120).toISOString();
  const args = {folder: 'expiring'};
  const digest = actionArgumentsDigest(args);
  const expiring = {id: 'expiring-tool', revision: 1, kind: 'tool', description: 'File into expiring metadata',
    sources: [], scopeRef: 'local', expiresAt, risk: 'low',
    tool: {name: 'inbox.classification.save', version: '1.0.0', arguments: args}, argumentsDigest: digest,
    authorization: {state: 'granted', refDigest: 'b'.repeat(64), scopeRef: 'local', argumentsDigest: digest, expiresAt}};
  const noop = {id: 'leave', revision: 1, kind: 'noop', description: 'Keep as is', sources: [], scopeRef: 'local',
    expiresAt: new Date(Date.now() + 60_000).toISOString(), risk: 'low', argumentsDigest: actionArgumentsDigest({})};
  const service = new LayaActionChoiceService({infer() {
    while (Date.parse(expiresAt) > Date.now()) {}
    return Promise.resolve(validChoice());
  }});
  const expired = await service.choose({context: 'Expiring work', candidates: [expiring, noop],
    deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal});
  assert.equal(expired.reason, 'candidate_expired');
  assert.equal(expired.state, 'abstain');
  assert.equal(expired.eligibleForRuntime, false, 'an expired selection can never reach Runtime');
  assert.deepEqual(expired.scores.map(item => item.probability), [0.9, 0.1], 'the model answer is still reported');
  assert.equal(expired.answerConfidence, 0.9);
  assert.equal(expired.receipt.candidates[0].exclusion, undefined, 'the candidate was eligible at submission time');
  const thin = new LayaActionChoiceService({async infer() {return {answers: {action: {choice: 'candidate_1',
    probabilities: {candidate_0: 0.4, candidate_1: 0.5, candidate_2: 0.1}, answer_confidence: 0.5, confidence: 0.5}}};}});
  const review = await thin.choose({context: 'Thin margin', candidates: [noop,
    {...noop, id: 'leave-other'}, {...noop, id: 'leave-third'}], deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal});
  assert.equal(review.state, 'review');
  assert.equal(review.reason, 'uncertain', 'a 0.10 margin cannot reach Runtime even as the top-ranked choice');
  assert.equal(review.eligibleForRuntime, false);
  assert.deepEqual(review.selected, {id: 'leave-other', revision: 1});
});
