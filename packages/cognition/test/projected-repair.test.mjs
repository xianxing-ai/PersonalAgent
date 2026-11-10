import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FakeCoordinationStoreHost} from '@personal-agent/goals/store';
import {selectProjectedRepairScope, previewProjectedRepair} from '../dist/index.js';

const at = '2026-09-25T09:00:00.000Z';
const ref = (id, revision = 1) => ({id, revision});
const node = (id, kind, dependencies = [], summary = id) => ({
  id, kind, dependencies, summary, sourceRef: 'synthetic/meeting',
  sensitivity: 'private', state: 'active', reason: 'fixture',
  validFrom: '2026-09-25T00:00:00.000Z', validUntil: '2026-09-26T00:00:00.000Z'
});
function fixture() {
  const store = new FakeCoordinationStoreHost().provision('synthetic-person');
  for (const input of [
    node('memory-fact:meeting', 'fact'),
    node('goal', 'goal', [ref('memory-fact:meeting')]),
    node('decision', 'decision', [ref('goal')]),
    node('plan', 'plan', [ref('decision')]),
    node('unrelated', 'plan'),
    node('memory-fact:meeting', 'fact', [], 'corrected meeting')
  ]) store.append(store.read().revision, input);
  const projection = {batchToken: 'synthetic-batch', graphRevision: store.read().revision,
    links: [{eventId: 'synthetic-event', fact: ref('meeting', 2),
      node: ref('memory-fact:meeting', 2)}]};
  return {store, input: {graphNamespace: 'synthetic-person', projection}};
}

test('selects the committed Fact change and previews only its affected graph nodes', () => {
  const {store, input} = fixture();
  const scope = selectProjectedRepairScope(store.read(), at, input);
  assert.deepEqual(scope.items.map(item => item.node.id), ['goal', 'decision', 'plan']);
  const before = store.read();
  const preview = previewProjectedRepair(store, at, {...input, changes: [{
    node: ref('goal'), summary: 'goal for corrected meeting', reason: 'explicit candidate',
    dependencies: [ref('memory-fact:meeting', 2)]
  }]});
  assert.equal(preview.repair.after.snapshot.revision, before.revision + 1);
  assert.equal(preview.repair.after.report.items.find(item => item.node.id === 'plan').action,
    'RECHECK');
  assert.equal(store.read().revision, before.revision);
});

test('rejects stale projection and repair outside its RECHECK subset', () => {
  const {store, input} = fixture();
  assert.throws(() => selectProjectedRepairScope(store.read(), at, {...input,
    projection: {...input.projection, graphRevision: input.projection.graphRevision - 1}}),
  {code: 'REVISION_CONFLICT'});
  assert.throws(() => previewProjectedRepair(store, at, {...input, changes: [{
    node: ref('unrelated'), summary: 'unrelated edit', reason: 'not affected', dependencies: []
  }]}), {code: 'NOT_APPLICABLE'});
});

test('rejects projections whose namespace or committed Fact links do not match the stored graph', () => {
  const {store, input} = fixture();
  assert.throws(() => selectProjectedRepairScope(store.read(), at, {...input, graphNamespace: 'other-person'}),
    {code: 'INVALID_ARGUMENT'});
  assert.throws(() => selectProjectedRepairScope(store.read(), at, {...input,
    projection: {...input.projection, links: [{eventId: 'synthetic-event', fact: ref('meeting', 2),
      node: ref('missing-fact', 1)}]}}), {code: 'NOT_APPLICABLE'});
  assert.throws(() => selectProjectedRepairScope(store.read(), at, {...input,
    projection: {...input.projection, links: [{eventId: 'synthetic-event', fact: ref('meeting', 2),
      node: ref('goal', 1)}]}}), {code: 'NOT_APPLICABLE'});
});

test('rejects malformed projection receipts before the graph is read', () => {
  const {store, input} = fixture();
  const projection = input.projection;
  const malformed = [
    {...input, graphNamespace: ' '},
    {...input, unexpected: 'field'},
    {...input, projection: {...projection, batchToken: ' '}},
    {...input, projection: {...projection, graphRevision: -1}},
    {...input, projection: {...projection, graphRevision: 1.5}},
    {...input, projection: {...projection, links: 'not-an-array'}},
    {...input, projection: {...projection, extra: 'field'}},
    {...input, projection: {...projection, links: [{eventId: 'synthetic-event',
      node: ref('memory-fact:meeting', 2)}]}},
    {...input, projection: {...projection, links: [{eventId: 'synthetic-event', fact: ref('meeting', 0),
      node: ref('memory-fact:meeting', 2)}]}},
    {...input, projection: {...projection, links: [{eventId: 'synthetic-event', fact: ref('meeting', 2),
      node: ref('memory-fact:meeting', 2), extra: 'field'}]}},
    {...input, projection: {...projection, links: [{eventId: 'first', fact: ref('meeting', 2),
      node: ref('memory-fact:meeting', 2)}, {eventId: 'first', fact: ref('meeting', 2),
      node: ref('memory-fact:meeting', 2)}]}},
  ];
  for (const request of malformed) {
    assert.throws(() => selectProjectedRepairScope(store.read(), at, request), {code: 'INVALID_ARGUMENT'});
  }
  const hundred = Array.from({length: 100}, (_, index) => ({eventId: `event-${index}`,
    fact: ref('meeting', 2), node: ref('memory-fact:meeting', 2)}));
  assert.deepEqual(
    selectProjectedRepairScope(store.read(), at, {...input, projection: {...projection, links: hundred}}).items,
    selectProjectedRepairScope(store.read(), at, input).items);
  assert.throws(() => selectProjectedRepairScope(store.read(), at, {...input,
    projection: {...projection, links: [...hundred, {eventId: 'event-100', fact: ref('meeting', 2),
      node: ref('memory-fact:meeting', 2)}]}}), {code: 'INVALID_ARGUMENT'});
});

test('previewing on a store without a readable bound snapshot is not applicable', () => {
  const {input} = fixture();
  assert.throws(() => previewProjectedRepair({}, at, {...input, changes: [{
    node: ref('goal'), summary: 'goal for corrected meeting', reason: 'explicit candidate',
    dependencies: [ref('memory-fact:meeting', 2)]
  }]}), {code: 'NOT_APPLICABLE'});
});
