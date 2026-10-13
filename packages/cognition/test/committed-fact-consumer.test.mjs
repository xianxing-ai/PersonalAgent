import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FakeCoordinationStoreHost} from '@personal-agent/goals/store';
import {analyzeImpact, decideDurableFactProjection, previewDurableFactRepair} from '../dist/index.js';

const at = '2026-09-25T09:00:00.000Z';
const ref = (id, revision = 1) => ({id, revision});
const node = (id, kind, dependencies = [], summary = id) => ({
  id, kind, dependencies, summary, sourceRef: 'synthetic/public-meeting',
  sensitivity: 'public', state: 'active', reason: 'fixture',
  validFrom: '2026-09-25T00:00:00.000Z', validUntil: '2026-09-26T00:00:00.000Z'
});
function fixture() {
  const store = new FakeCoordinationStoreHost().provision('synthetic-graph');
  for (const input of [
    node('memory-fact:meeting', 'fact'),
    node('goal', 'goal', [ref('memory-fact:meeting')]),
    node('plan', 'plan', [ref('goal')]),
    node('unrelated', 'plan'),
    node('memory-fact:meeting', 'fact', [], 'corrected meeting')
  ]) store.append(store.read().revision, input);
  const report = analyzeImpact(store.read(), at);
  return {store, input: {
    graphNamespace: 'synthetic-graph',
    projection: {batchToken: 'confirmed-batch', graphRevision: store.read().revision,
      links: [{eventId: 'confirmed-event', fact: ref('meeting', 2),
        node: ref('memory-fact:meeting', 2)}]},
    processed: {batchToken: 'confirmed-batch', report},
    at,
    deadline: new Date(Date.now() + 5_000).toISOString(), signal: new AbortController().signal
  }};
}
const decision = {async decide({events}) { return events.map(event => ({
  eventId: event.eventId, source: event.source, intervention: 'ESCALATE_AGENTARTS',
  confidence: null, reason: 'model_unavailable', facts: event.facts,
  authorizationRevision: event.authorization.revision
})); }};
const reader = processed => ({readCompletedImpact: () => processed});

function batchFixture() {
  const store = new FakeCoordinationStoreHost().provision('synthetic-graph');
  const links = [];
  for (let index = 0; index < 5; index++) {
    const id = `memory-fact:batch-${index}`;
    store.append(store.read().revision, node(id, 'fact'));
    store.append(store.read().revision, node(`goal-${index}`, 'goal', [ref(id)]));
    store.append(store.read().revision, node(id, 'fact', [], `corrected ${index}`));
    links.push({eventId: `event-${index}`, fact: ref(`batch-${index}`, 2), node: ref(id, 2)});
  }
  const projection = {batchToken: 'completed-five-facts', graphRevision: store.read().revision, links};
  return {store, request: {graphNamespace: 'synthetic-graph', projection, at,
    deadline: new Date(Date.now() + 5_000).toISOString(), signal: new AbortController().signal},
  processed: {batchToken: projection.batchToken, report: analyzeImpact(store.read(), at)}};
}

test('a completed five-Fact batch reaches advice in bounded ordered chunks without writing', async () => {
  const {store, request, processed} = batchFixture();
  const before = store.read();
  const calls = [];
  const result = await decideDurableFactProjection(store, {async decide(input) {
    calls.push({events: structuredClone(input.events), deadline: input.deadline});
    return decision.decide(input);
  }}, reader(processed), request);
  assert.deepEqual(calls.map(call => call.events.length), [4, 1]);
  assert.ok(calls.every(call => call.deadline === request.deadline));
  assert.deepEqual(result.suggestions.map(item => item.eventId), request.projection.links.map(link => link.eventId));
  assert.deepEqual(result.scope.items.map(item => item.node.id), ['goal-0', 'goal-1', 'goal-2', 'goal-3', 'goal-4']);
  assert.deepEqual(store.read(), before);
});

test('durable advice rejects a graph change between chunks before calling the remaining chunk', async () => {
  const {store, request, processed} = batchFixture();
  let calls = 0;
  await assert.rejects(() => decideDurableFactProjection(store, {async decide(input) {
    calls++;
    store.append(store.read().revision, node('concurrent', 'fact'));
    return decision.decide(input);
  }}, reader(processed), request), {code: 'REVISION_CONFLICT'});
  assert.equal(calls, 1);
});

test('durable advice cancellation and later failure never return a partial batch', async () => {
  for (const mode of ['cancelled', 'later-failure']) {
    const {store, request, processed} = batchFixture();
    const before = store.read();
    const controller = new AbortController();
    request.signal = controller.signal;
    let calls = 0;
    await assert.rejects(() => decideDurableFactProjection(store, {async decide(input) {
      calls++;
      if (mode === 'cancelled') controller.abort();
      if (calls === 2) throw new Error('Second decision chunk unavailable');
      return decision.decide(input);
    }}, reader(processed), request), mode === 'cancelled' ? {code: 'CANCELLED'} : /Second decision chunk unavailable/);
    assert.equal(calls, mode === 'cancelled' ? 1 : 2);
    assert.deepEqual(store.read(), before);
  }
});

test('missing advice in the first or last chunk rejects the complete batch without graph changes', async () => {
  for (const missingChunk of [1, 2]) {
    const {store, request, processed} = batchFixture();
    const before = store.read();
    let calls = 0;
    await assert.rejects(() => decideDurableFactProjection(store, {async decide(input) {
      calls++;
      const suggestions = await decision.decide(input);
      return calls === missingChunk ? suggestions.slice(0, -1) : suggestions;
    }}, reader(processed), request), /Invalid projected fact decision result/);
    assert.equal(calls, missingChunk, 'a missing answer stops the batch before any later call');
    assert.deepEqual(store.read(), before);
  }
});
test('caller mutation during advice cannot replace the next chunk Fact binding', async () => {
  const {store, request, processed} = batchFixture();
  const calls = [];
  const result = await decideDurableFactProjection(store, {async decide(input) {
    calls.push(structuredClone(input.events));
    if (calls.length === 1) {
      request.projection.links[4].eventId = 'replaced-event';
      request.projection.links[4].fact = ref('replaced-fact', 99);
    }
    return decision.decide(input);
  }}, reader(processed), request);
  assert.equal(calls[1][0].eventId, 'event-4');
  assert.deepEqual(calls[1][0].facts, [ref('batch-4', 2)]);
  assert.equal(result.suggestions[4].eventId, 'event-4');
});

test('completed batch reaches only its affected scope and bounded advice', async () => {
  const {store, input} = fixture();
  const before = store.read().revision;
  const {processed, ...request} = input;
  const result = await decideDurableFactProjection(store, decision, reader(processed), request);
  assert.deepEqual(result.scope.items.map(item => item.node.id), ['goal', 'plan']);
  assert.deepEqual(result.suggestions.map(item => item.intervention), ['ESCALATE_AGENTARTS']);
  assert.equal(store.read().revision, before, 'consumer must not write');
});

test('unrelated completion and forged report cannot be treated as this batch', async () => {
  const {store, input} = fixture();
  let calls = 0;
  const forbidden = {decide() { calls++; throw new Error('must not run'); }};
  const {processed, ...request} = input;
  await assert.rejects(() => decideDurableFactProjection(store, forbidden,
    reader({...processed, batchToken: 'another-batch'}), request), {code: 'INVALID_ARGUMENT'});
  const forged = structuredClone(input.processed.report);
  forged.items[0].action = 'KEEP';
  await assert.rejects(() => decideDurableFactProjection(store, forbidden,
    reader({...processed, report: forged}), request), {code: 'INVALID_ARGUMENT'});
  assert.equal(calls, 0);
});

test('completed historical batch rechecks the current graph after later unrelated projection', async () => {
  const {store, input} = fixture();
  const {processed, ...request} = input;
  store.append(store.read().revision, node('later', 'fact'));
  const actual = await decideDurableFactProjection(store, decision, reader(processed), request);
  assert.equal(actual.scope.graphRevision, store.read().revision);
  assert.deepEqual(actual.scope.items.map(item => item.node.id), ['goal', 'plan']);
});

test('graph advance during advice invalidates the returned current scope', async () => {
  const {store, input} = fixture();
  const {processed, ...request} = input;
  await assert.rejects(() => decideDurableFactProjection(store, {
    async decide({events}) {
      store.append(store.read().revision, node('concurrent', 'fact'));
      return decision.decide({events});
    }
  }, reader(processed), request), {code: 'REVISION_CONFLICT'});
});

test('a superseded projected Fact is stale for advice and repair preview', async () => {
  const {store, input} = fixture();
  const {processed, ...request} = input;
  store.append(store.read().revision, node('memory-fact:meeting', 'fact', [], 'newer correction'));
  const forbidden = {decide() { throw new Error('must not run'); }};
  await assert.rejects(() => decideDurableFactProjection(store, forbidden,
    reader(processed), request), {code: 'REVISION_CONFLICT'});
  assert.throws(() => previewDurableFactRepair(store, reader(processed), at, {
    graphNamespace: request.graphNamespace, projection: request.projection,
    changes: [{node: ref('goal'), summary: 'new goal', reason: 'candidate',
      dependencies: [ref('memory-fact:meeting', 2)]}]
  }), {code: 'REVISION_CONFLICT'});
});

test('durable preview accepts unrelated graph advance but rejects changed dependency identity', () => {
  const {store, input} = fixture();
  const before = store.read().revision;
  const {processed, ...request} = input;
  store.append(store.read().revision, node('other', 'fact'));
  const candidate = {graphNamespace: request.graphNamespace, projection: request.projection,
    changes: [{node: ref('goal'), summary: 'goal after correction', reason: 'explicit candidate',
      dependencies: [ref('memory-fact:meeting', 2)]}]};
  const preview = previewDurableFactRepair(store, reader(processed), at, candidate);
  assert.equal(preview.scope.graphRevision, before + 1);
  assert.deepEqual(preview.scope.items.map(item => item.node.id), ['goal', 'plan']);
  assert.equal(store.read().revision, before + 1, 'preview must not write');
  assert.throws(() => previewDurableFactRepair(store, reader(processed), at, {
    ...candidate, changes: [{...candidate.changes[0], dependencies: [ref('other')]}]
  }), {code: 'NOT_APPLICABLE'});
});

test('durable preview rejects a candidate for a superseded target version', () => {
  const {store, input} = fixture();
  const {processed, ...request} = input;
  store.append(store.read().revision, node('goal', 'goal',
    [ref('memory-fact:meeting', 2)], 'newer goal'));
  assert.throws(() => previewDurableFactRepair(store, reader(processed), at, {
    graphNamespace: request.graphNamespace, projection: request.projection,
    changes: [{node: ref('goal'), summary: 'stale candidate', reason: 'candidate',
      dependencies: [ref('memory-fact:meeting', 2)]}]
  }), {code: 'REVISION_CONFLICT'});
});

test('current evaluation cannot precede the durable impact time', async () => {
  const {store, input} = fixture();
  const {processed, ...request} = input;
  const forbidden = {decide() { throw new Error('must not run'); }};
  await assert.rejects(() => decideDurableFactProjection(store, forbidden, reader(processed), {
    ...request, at: '2026-09-25T08:59:59.000Z'
  }), {code: 'INVALID_ARGUMENT'});
});

test('durable reader gates pending and foreign batches before advice', async () => {
  const {store, input} = fixture();
  let calls = 0;
  const forbidden = {decide() { calls++; throw new Error('must not run'); }};
  const {processed, ...request} = input;
  await assert.rejects(() => decideDurableFactProjection(store, forbidden,
    {readCompletedImpact: () => undefined}, request), {code: 'NOT_APPLICABLE'});
  await assert.rejects(() => decideDurableFactProjection(store, forbidden,
    {readCompletedImpact: () => { const error = new Error('foreign batch');
      error.code = 'NOT_FOUND'; throw error; }}, request), {code: 'NOT_FOUND'});
  assert.equal(calls, 0);
  const actual = await decideDurableFactProjection(store, decision,
    {readCompletedImpact: token => token === processed.batchToken ? processed : undefined}, request);
  assert.deepEqual(actual.scope.items.map(item => item.node.id), ['goal', 'plan']);
});
