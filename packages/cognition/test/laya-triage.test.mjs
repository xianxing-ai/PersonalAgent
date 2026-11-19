import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getEventListeners} from 'node:events';
import {LayaTriageService, LocalLayaBatchHttpTransport} from '../dist/index.js';

const answer = (choice, probabilities) => ({choice, probabilities,
  answer_confidence: Math.max(...Object.values(probabilities)), confidence: 0.42});
const result = (label = 'work', impact = 'routine') => ({answers: {
  category_0: answer(label, {work: label === 'work' ? 0.9 : 0.1, news: label === 'news' ? 0.9 : 0.1}),
  impact_0: answer(impact, {routine: impact === 'routine' ? 0.9 : 0.1, high_impact: impact === 'high_impact' ? 0.9 : 0.1}),
}});
const messages = Array.from({length: 6}, (_, i) => ({source: 'mail', messageId: `m${i}`,
  sourceRevision: `r${i}`, text: `PRIVATE header summary ${i}`}));
const request = (selected = messages, signal = new AbortController().signal) => ({messages: selected,
  labels: {work: 'Work-related messages', news: 'Subscriptions and news'},
  deadline: new Date(Date.now() + 10_000).toISOString(), signal});

test('classification cancellation keeps the original signal reason after caller swaps its request', async () => {
  let entered;
  const started = new Promise(resolve => {entered = resolve;});
  const service = new LayaTriageService({infer: async () => {entered(); return new Promise(() => {});}});
  const controller = new AbortController(), input = request(messages.slice(0, 1), controller.signal);
  const pending = service.classify(input);
  await started;
  input.signal = new AbortController().signal;
  controller.abort();
  const output = await pending;
  assert.equal(output[0].reason, 'cancelled');
  assert.equal(output[0].abstained, true);
});

test('classification removes the original signal listener after a successful inference', async () => {
  let entered, release;
  const started = new Promise(resolve => {entered = resolve;});
  const waiting = new Promise(resolve => {release = resolve;});
  const service = new LayaTriageService({async infer() {entered(); await waiting; return result();}});
  const controller = new AbortController(), input = request(messages.slice(0, 1), controller.signal);
  const baseline = getEventListeners(controller.signal, 'abort').length;
  const pending = service.classify(input);
  await started;
  assert.equal(getEventListeners(controller.signal, 'abort').length, baseline + 1);
  input.signal = new AbortController().signal;
  release();
  assert.equal((await pending)[0].reason, 'classified');
  assert.equal(getEventListeners(controller.signal, 'abort').length, baseline);
});

test('later classification chunks retain the submitted deadline and original inference hooks stay live', async () => {
  let entered, release, liveCalls = 0;
  const started = new Promise(resolve => {entered = resolve;});
  const waiting = new Promise(resolve => {release = resolve;});
  const payloads = [];
  const response = payload => ({items: payload.items.map(item => ({requestId: item.requestId, result: result()}))});
  const inference = {infer: () => assert.fail('No batch fallback'), async inferBatch(payload) {
    payloads.push(payload); entered(); await waiting; return response(payload);
  }};
  const service = new LayaTriageService(inference, {batching: 'multi_state', chunkSize: 1});
  const input = request(messages.slice(0, 2)), deadline = input.deadline;
  const pending = service.classify(input);
  await started;
  input.deadline = new Date(Date.now() + 60_000).toISOString();
  inference.inferBatch = async payload => {liveCalls++; payloads.push(payload); return response(payload);};
  release();
  assert.ok((await pending).every(item => item.reason === 'classified'));
  assert.deepEqual(payloads.map(payload => payload.deadline), [deadline, deadline]);
  assert.equal(liveCalls, 1);
});

test('batch triage keeps stable revisions, partial abstention, score semantics and cancellation without fallback', async () => {
  const calls = [];
  const transport = new LocalLayaBatchHttpTransport(8123, () => 'synthetic-test-key', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8123/v1/systemone/batch');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body); calls.push(body);
    if (calls.length === 2) throw Error('provider unavailable');
    assert.equal(body.items.length, 4);
    assert.equal(Object.keys(body.questions).length, 2);
    assert.deepEqual(Object.keys(body.questions.category_0.criteria), ['work', 'news']);
    assert.equal(body.items[1].state.events[0].index, 0);
    return Response.json({items: [...body.items].reverse().map(item => ({requestId: item.requestId,
      result: item.requestId === 'item_1' ? result('news', 'high_impact') : item.requestId === 'item_2' ? {answers: {}} : result()}))});
  });
  const service = new LayaTriageService(transport, {batching: 'multi_state'});
  const output = await service.classify(request());
  assert.equal(calls.length, 2);
  assert.deepEqual(output.map(item => [item.messageId, item.sourceRevision]), messages.map(item => [item.messageId, item.sourceRevision]));
  assert.equal(output[0].route, 'group'); assert.equal(output[0].label, 'work');
  assert.equal(output[0].scores.answerConfidence, 0.9);
  assert.equal(output[0].scores.entropyConcentration, 0.42);
  assert.equal(output[0].calibrated, false);
  assert.equal(output[1].route, 'main_agent'); assert.equal(output[1].label, 'news');
  assert.equal(output[2].reason, 'invalid_response');
  assert.equal(output[3].route, 'group');
  assert.deepEqual(output.slice(4).map(item => item.reason), ['unavailable', 'unavailable']);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE header/);
  assert.deepEqual(output[0].receipt.candidateLabels, ['work', 'news']);
  assert.equal(output[0].receipt.contextDigest.length, 64);
  const abort = new AbortController(); abort.abort();
  const cancelled = await service.classify(request(messages, abort.signal));
  assert.equal(calls.length, 2);
  assert.ok(cancelled.every(item => item.reason === 'cancelled' && item.abstained));
  const duplicate = new LayaTriageService({...transport,
    infer() { assert.fail('silent fallback'); },
    async inferBatch() { return {items: [{requestId: 'item_0', result: result()}, {requestId: 'item_0', result: result()}]}; },
  }, {batching: 'multi_state'});
  assert.ok((await duplicate.classify(request(messages.slice(0, 2)))).every(item => item.abstained));
  const microCalls = [];
  const micro = new LayaTriageService({async infer(payload) {
    microCalls.push(payload);
    return {answers: Object.fromEntries(payload.state.events.flatMap((_, index) => [
      [`category_${index}`, result().answers.category_0], [`impact_${index}`, result().answers.impact_0],
    ]))};
  }});
  const microOutput = await micro.classify(request(messages.slice(0, 3)));
  assert.equal(microCalls.length, 1); assert.equal(Object.keys(microCalls[0].questions).length, 6);
  assert.ok(microOutput.every(item => item.batching === 'multi_question' && item.route === 'group'));
});

test('triage service rejects malformed construction and request envelopes before inference', async () => {
  let calls = 0;
  const inference = {async infer() {calls++; return result();}};
  for (const bad of [
    {chunkSize: 0},
    {chunkSize: 5},
    {minimumAnswerProbability: 1.2},
    {minimumMargin: -0.1},
    {batching: 'multi_state'},
  ]) assert.throws(() => new LayaTriageService(inference, bad), /Invalid local triage request/);
  const service = new LayaTriageService(inference);
  const base = {messages: messages.slice(0, 1), labels: {work: 'Work', news: 'News'},
    deadline: new Date(Date.now() + 10_000).toISOString(), signal: new AbortController().signal};
  for (const bad of [
    {...base, messages: 'not-an-array'},
    {...base, labels: {work: 'Only one category'}},
    {...base, labels: Object.fromEntries(Array.from({length: 17}, (_, i) => [`label${i}`, 'Synthetic']))},
    {...base, labels: {'1bad': 'Work', ok: 'News'}},
    {...base, labels: {work: 'Work', news: '   '}},
    {...base, deadline: 'not-a-date'},
    {...base, signal: {}},
  ]) await assert.rejects(service.classify(bad), /Invalid local triage request/);
  for (const bad of [
    [...base.messages, null],
    [{...base.messages[0], source: 's'.repeat(257)}],
    [{...base.messages[0], messageId: 5}],
    [{...base.messages[0], text: 'x'.repeat(4001)}],
    [{...base.messages[0], highImpact: 'yes'}],
    [base.messages[0], {...base.messages[0]}],
  ]) await assert.rejects(service.classify({...base, messages: bad}), /Invalid local triage request/);
  assert.equal(calls, 0, 'validation must happen before any inference');
});

test('model answers cannot self-promote an untop choice and honest other stays unclassified', async () => {
  const inference = {async infer(payload) {
    const observation = payload.state.events[0].observation;
    const answers = {};
    for (const [key, question] of Object.entries(payload.questions)) {
      const criteriaKeys = Object.keys(question.criteria);
      if (key.startsWith('category_') && observation === 'PROMOTION') {
        answers[key] = {choice: 'work',
          probabilities: Object.fromEntries(criteriaKeys.map(id => [id, id === 'news' ? 0.8 : 0.2])),
          answer_confidence: 0.8, confidence: 0.7};
      } else if (key.startsWith('category_') && observation === 'SUM') {
        answers[key] = {choice: 'work',
          probabilities: Object.fromEntries(criteriaKeys.map(id => [id, id === 'work' ? 0.5 : 0.4])),
          answer_confidence: 0.5, confidence: 0.7};
      } else {
        const choice = key.startsWith('category_') && observation === 'OTHER' ? 'other'
          : key.startsWith('category_') ? 'work' : 'routine';
        answers[key] = {choice,
          probabilities: Object.fromEntries(criteriaKeys.map(id => [id, id === choice ? 0.9
            : Number((0.1 / (criteriaKeys.length - 1)).toFixed(4))])),
          answer_confidence: 0.9, confidence: 0.7};
      }
    }
    return {answers};
  }};
  const service = new LayaTriageService(inference);
  const at = (messageId, text) => request([{...messages[0], messageId, text}]);
  const promotion = await service.classify(at('promo', 'PROMOTION'));
  assert.equal(promotion[0].reason, 'invalid_response');
  assert.equal(promotion[0].abstained, true);
  assert.equal(promotion[0].label, null);
  const sum = await service.classify(at('sum', 'SUM'));
  assert.equal(sum[0].reason, 'invalid_response');
  assert.equal(sum[0].abstained, true);
  const other = await service.classify({...at('other', 'OTHER'),
    labels: {work: 'Work', news: 'News', other: 'Everything else'}});
  assert.equal(other[0].reason, 'unknown_category');
  assert.equal(other[0].candidateLabel, 'other');
  assert.equal(other[0].label, null);
  assert.equal(other[0].route, 'review');
  assert.equal(other[0].abstained, true);
});

test('batch responses with foreign request ids abstain as unavailable without single fallback', async () => {
  let inferCalled = false;
  const inference = {infer: () => {inferCalled = true; return result();},
    async inferBatch() {return {items: [{requestId: 'item_foreign', result: result()}]};}};
  const service = new LayaTriageService(inference, {batching: 'multi_state'});
  const output = await service.classify(request(messages.slice(0, 1)));
  assert.equal(output[0].reason, 'unavailable');
  assert.equal(output[0].abstained, true);
  assert.equal(inferCalled, false, 'multi_state batching must not fall back to single-question inference');
});
