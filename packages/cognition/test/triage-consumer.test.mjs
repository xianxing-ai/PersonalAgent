import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LayaTriageService, prepareTriageDispatch} from '../dist/index.js';

const labels = {work: 'Work', news: 'News'};
const messages = [
  {source: 'mail', messageId: 'routine', sourceRevision: '1', text: 'PRIVATE routine summary'},
  {source: 'mail', messageId: 'impact', sourceRevision: '2', text: 'PRIVATE appointment change', highImpact: true},
  {source: 'mail', messageId: 'uncertain', sourceRevision: '3', text: 'PRIVATE unclear summary'},
];
const answer = (choice, probabilities) => ({choice, probabilities,
  answer_confidence: Math.max(...Object.values(probabilities)), confidence: 0.42});
const request = (selected, signal = new AbortController().signal) => ({messages: selected, labels,
  deadline: new Date(Date.now() + 10_000).toISOString(), signal});
const validFake = {async infer(payload) {
  return {answers: Object.fromEntries(payload.state.events.flatMap((event, index) => [
    [`category_${index}`, answer('work', event.observation.includes('unclear')
      ? {work: 0.55, news: 0.45} : {work: 0.9, news: 0.1})],
    [`impact_${index}`, answer('routine', {routine: 0.9, high_impact: 0.1})],
  ]))};
}};
const input = (results, selected = messages) => ({namespace: 'host/mail/account-1', messages: selected, labels, results});

test('explicit other category is accepted as a review result', async () => {
  const otherLabels = {work: 'Work', other: 'Other'};
  const message = {source: 'mail', messageId: 'other', sourceRevision: '1', text: 'Unclear message'};
  const service = new LayaTriageService({async infer() {
    return {answers: {
      category_0: answer('other', {work: 0.1, other: 0.9}),
      impact_0: answer('routine', {routine: 0.9, high_impact: 0.1}),
    }};
  }});
  const results = await service.classify({...request([message]), labels: otherLabels});
  assert.equal(results[0].reason, 'unknown_category');
  const dispatch = prepareTriageDispatch({namespace: 'host/mail/account-1',
    messages: [message], labels: otherLabels, results});
  assert.deepEqual(dispatch.review.map(ref => ref.messageId), ['other']);
  assert.deepEqual(dispatch.groups, []);
});

test('blank input is retained as deferred instead of rejected by the consumer', async () => {
  const message = {source: 'mail', messageId: 'blank', sourceRevision: '1', text: '   '};
  const results = await new LayaTriageService(validFake).classify(request([message]));
  assert.equal(results[0].reason, 'insufficient_input');
  const dispatch = prepareTriageDispatch({namespace: 'host/mail/account-1',
    messages: [message], labels, results});
  assert.deepEqual(dispatch.deferred.map(ref => ref.reason), ['insufficient_input']);
});

test('meeting labels use the same high-impact rule as the classifier', async () => {
  const meetingLabels = {meeting: 'Meetings', work: 'Work'};
  const message = {source: 'mail', messageId: 'meeting', sourceRevision: '1', text: 'Calendar update'};
  const service = new LayaTriageService({async infer() {
    return {answers: {
      category_0: answer('meeting', {meeting: 0.9, work: 0.1}),
      impact_0: answer('routine', {routine: 0.9, high_impact: 0.1}),
    }};
  }});
  const results = await service.classify({...request([message]), labels: meetingLabels});
  const dispatch = prepareTriageDispatch({namespace: 'host/mail/account-1',
    messages: [message], labels: meetingLabels, results});
  assert.deepEqual(dispatch.mainAgent.map(ref => ref.messageId), ['meeting']);
  assert.throws(() => prepareTriageDispatch({namespace: 'host/mail/account-1',
    messages: [message], labels: meetingLabels,
    results: [{...results[0], candidateLabel: 'work'}]}));
});

test('same-call Fake results become stable metadata-only groups and reasoning routes', async () => {
  const results = await new LayaTriageService(validFake).classify(request(messages));
  const dispatch = prepareTriageDispatch(input(results));
  assert.deepEqual(dispatch.groups.map(group => [group.label, group.refs.map(ref => ref.messageId)]),
    [['work', ['routine']]]);
  assert.deepEqual(dispatch.mainAgent.map(ref => ref.messageId), ['impact']);
  assert.deepEqual(dispatch.review.map(ref => ref.messageId), ['uncertain']);
  assert.deepEqual(dispatch.deferred, []);
  assert.doesNotMatch(JSON.stringify(dispatch), /PRIVATE|observation|scores|probabilities/);
  const reordered = prepareTriageDispatch(input([...results].reverse(), [...messages].reverse()));
  assert.deepEqual(reordered, dispatch);
  assert.notEqual(prepareTriageDispatch({...input(results), namespace: 'host/mail/account-2'})
    .groups[0].refs[0].workKey, dispatch.groups[0].refs[0].workKey);
});

test('rejects changed receipt, source version, route downgrade, label and duplicate identity', async () => {
  const results = await new LayaTriageService(validFake).classify(request(messages));
  const replace = (index, patch) => results.map((item, i) => i === index ? {...item, ...patch} : item);
  assert.throws(() => prepareTriageDispatch(input(replace(0, {receipt: {...results[0].receipt, id: '0'.repeat(64)}}))));
  assert.throws(() => prepareTriageDispatch(input(replace(0, {receipt: {...results[0].receipt, contextDigest: '0'.repeat(64)}}))));
  assert.throws(() => prepareTriageDispatch(input(replace(0, {receipt: {...results[0].receipt, criteriaDigest: '0'.repeat(64)}}))));
  assert.throws(() => prepareTriageDispatch(input(replace(0, {sourceRevision: 'stale'}))));
  assert.throws(() => prepareTriageDispatch(input(replace(1, {route: 'group', reason: 'classified'}))));
  assert.throws(() => prepareTriageDispatch(input(replace(0, {label: 'unapproved'}))));
  assert.throws(() => prepareTriageDispatch(input([results[0], results[0], results[2]])));
  assert.throws(() => prepareTriageDispatch(input(results,
    [messages[0], {...messages[0], sourceRevision: 'new', text: 'PRIVATE new'}, messages[2]])));
});

test('cancelled, deadline, unavailable and malformed response stay deferred', async () => {
  const selected = [0, 1, 2, 3].map(index => ({source: 'mail', messageId: `d${index}`,
    sourceRevision: '1', text: `PRIVATE deferred ${index}`, ...(index === 0 ? {highImpact: true} : {})}));
  const abort = new AbortController(); abort.abort();
  const cancelled = await new LayaTriageService(validFake).classify(request(selected.slice(0, 1), abort.signal));
  const expired = await new LayaTriageService(validFake).classify({...request(selected.slice(1, 2)),
    deadline: new Date(Date.now() - 1000).toISOString()});
  const unavailable = await new LayaTriageService({async infer() { throw Error('offline'); }})
    .classify(request(selected.slice(2, 3)));
  const malformed = await new LayaTriageService({async infer() { return {answers: {}}; }})
    .classify(request(selected.slice(3, 4)));
  const dispatch = prepareTriageDispatch(input([...cancelled, ...expired, ...unavailable, ...malformed], selected));
  assert.deepEqual(dispatch.deferred.map(ref => ref.reason),
    ['cancelled', 'deadline', 'unavailable', 'invalid_response']);
  assert.deepEqual(dispatch.deferred.map(ref => ref.requiredRoute),
    ['main_agent', 'review', 'review', 'review']);
  assert.deepEqual(dispatch.groups, []);
  assert.deepEqual(dispatch.mainAgent, []);
  assert.deepEqual(dispatch.review, []);
});

test('dispatch input shapes are validated before any grouping', async () => {
  const results = await new LayaTriageService(validFake).classify(request(messages));
  const seventeenLabels = Object.fromEntries(Array.from({length: 17},
    (_, index) => [`label${index}`, `Label ${index}`]));
  const cases = [
    ['null input', () => prepareTriageDispatch(null)],
    ['array input', () => prepareTriageDispatch([input(results)])],
    ['blank namespace', () => prepareTriageDispatch({...input(results), namespace: '  '})],
    ['single label', () => prepareTriageDispatch({...input(results), labels: {work: 'Work'}})],
    ['seventeen labels', () => prepareTriageDispatch({...input(results), labels: seventeenLabels})],
    ['invalid label key', () => prepareTriageDispatch({...input(results), labels: {'1bad': 'Bad', news: 'News'}})],
    ['blank label text', () => prepareTriageDispatch({...input(results), labels: {work: ' ', news: 'News'}})],
    ['oversized label text', () => prepareTriageDispatch({...input(results),
      labels: {work: 'W'.repeat(501), news: 'News'}})],
    ['result count mismatch', () => prepareTriageDispatch({...input(results), results: results.slice(0, -1)})],
    ['duplicate message identity', () => prepareTriageDispatch(input(results, [...messages, messages[0]]))],
    ['result without a message', () => prepareTriageDispatch(input([...results, results[0]],
      [...messages, {source: 'mail', messageId: 'ghost', sourceRevision: '1', text: 'PRIVATE ghost'}]))],
    ['oversized source', () => prepareTriageDispatch(input(results,
      [{...messages[0], source: 'm'.repeat(257)}, ...messages.slice(1)]))],
    ['blank message ID', () => prepareTriageDispatch(input(results,
      [{...messages[0], messageId: ''}, ...messages.slice(1)]))],
    ['oversized text', () => prepareTriageDispatch(input(results,
      [{...messages[0], text: 'x'.repeat(4001)}, ...messages.slice(1)]))],
    ['non-boolean high impact', () => prepareTriageDispatch(input(results,
      [{...messages[0], highImpact: 'yes'}, ...messages.slice(1)]))],
  ];
  for (const [name, run] of cases) assert.throws(run, undefined, name);
  assert.deepEqual(prepareTriageDispatch(input(results)).groups[0].refs[0].messageId, 'routine');
});

test('receipt metadata beyond the digests is also part of the accepted result identity', async () => {
  const results = await new LayaTriageService(validFake).classify(request(messages));
  const replace = (index, patch) => results.map((item, i) => i === index ? {...item, ...patch} : item);
  for (const patch of [
    {receipt: {...results[0].receipt, promptVersion: 'mail-triage-v2'}},
    {receipt: {...results[0].receipt, model: 'large'}},
    {receipt: {...results[0].receipt, candidateLabels: ['news', 'work']}},
    {receipt: {...results[0].receipt, candidateLabels: ['work']}},
    {batching: 'multi_question_v2'},
    {calibrated: true},
    {scores: undefined},
    {impactScores: undefined},
  ]) assert.throws(() => prepareTriageDispatch(input(replace(0, patch))));
});

test('high-impact impact answers keep abstained and classified results on the main agent', async () => {
  const impactMessages = [
    {source: 'mail', messageId: 'reschedule', sourceRevision: '1', text: 'PRIVATE reschedule summary'},
    {source: 'mail', messageId: 'unclear-impact', sourceRevision: '2', text: 'PRIVATE unclear summary'},
  ];
  const service = new LayaTriageService({async infer(payload) {
    return {answers: Object.fromEntries(payload.state.events.flatMap((eventItem, index) => [
      [`category_${index}`, answer('work', eventItem.observation.includes('unclear')
        ? {work: 0.55, news: 0.45} : {work: 0.9, news: 0.1})],
      [`impact_${index}`, answer('high_impact', {routine: 0.1, high_impact: 0.9})],
    ]))};
  }});
  const results = await service.classify(request(impactMessages));
  assert.deepEqual(results.map(item => [item.reason, item.route, item.abstained, item.label]), [
    ['high_impact', 'main_agent', false, 'work'],
    ['high_impact', 'main_agent', true, null],
  ]);
  const dispatch = prepareTriageDispatch(input(results, impactMessages));
  assert.deepEqual(dispatch.mainAgent.map(ref => ref.messageId), ['reschedule', 'unclear-impact']);
  assert.deepEqual(dispatch.groups, []);
  assert.deepEqual(dispatch.review, []);
  assert.throws(() => prepareTriageDispatch(input(
    results.map((item, i) => i === 0 ? {...item, label: 'news'} : item), impactMessages)));
});
