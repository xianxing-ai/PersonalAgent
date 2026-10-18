import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FakeCoordinationStoreHost} from '@personal-agent/goals/store';
import {selectGoalRevisionImpact, selectGoalAncestorImpact, previewGoalRevisionRepair} from '../dist/index.js';

const at = '2026-09-25T09:00:00.000Z';
const ref = (id, revision = 1) => ({id, revision});
const node = (id, kind, dependencies = [], summary = id) => ({
  id, kind, dependencies, summary, sourceRef: 'synthetic/meeting',
  sensitivity: 'private', state: 'active', reason: 'fixture',
  validFrom: '2026-09-25T00:00:00.000Z', validUntil: '2026-09-26T00:00:00.000Z'
});

test('current Goal ancestor scope is the uncovered difference, including mixed-item exclusion', () => {
  const store = new FakeCoordinationStoreHost().provision('synthetic-ancestors');
  const append = input => store.append(store.read().revision, input);
  append(node('goal', 'goal'));
  append(node('older-decision', 'decision', [ref('goal')]));
  append(node('older-plan', 'plan', [ref('older-decision')]));
  append(node('goal', 'goal', [], 'Goal2'));
  append(node('latest-decision', 'decision', [ref('goal', 2)]));
  append(node('latest-plan', 'plan', [ref('latest-decision')]));
  append(node('mixed-plan', 'plan', [ref('older-decision'), ref('latest-decision')]));
  append(node('other-fact', 'fact'));
  append(node('other-plan', 'plan', [ref('other-fact')]));
  append(node('other-fact', 'fact', [], 'changed unrelated Fact'));
  append(node('goal', 'goal', [], 'Goal3'));
  const snapshot = store.read(), before = structuredClone(snapshot);
  const input = {expectedGraphRevision: snapshot.revision, currentGoal: ref('goal', 3)};
  const ancestor = selectGoalAncestorImpact(snapshot, at, input);
  assert.deepEqual(ancestor.items.map(item => item.node.id), ['older-decision', 'older-plan']);
  const consecutive = {expectedGraphRevision: snapshot.revision, previousGoal: ref('goal', 2), currentGoal: ref('goal', 3)};
  assert.deepEqual(selectGoalRevisionImpact(snapshot, at, consecutive).items.map(item => item.node.id),
    ['latest-decision', 'latest-plan', 'mixed-plan']);
  assert.throws(() => selectGoalRevisionImpact(snapshot, at, {...consecutive, previousGoal: ref('goal')}),
    {code: 'INVALID_ARGUMENT'});
  assert.deepEqual(store.read(), before);
  ancestor.items[0].node.id = 'outside mutation';
  assert.equal(selectGoalAncestorImpact(snapshot, at, input).items[0].node.id, 'older-decision');
  assert.throws(() => selectGoalAncestorImpact(snapshot, at, {...input, expectedGraphRevision: snapshot.revision - 1}),
    {code: 'REVISION_CONFLICT'});
  assert.throws(() => selectGoalAncestorImpact(snapshot, at, {...input, currentGoal: ref('goal', 2)}),
    {code: 'REVISION_CONFLICT'});
  assert.throws(() => selectGoalAncestorImpact(snapshot, at, {...input, extra: 'forged'}), {code: 'INVALID_ARGUMENT'});
});

test('single Goal revision has no ancestor difference and does not relax Goal identity', () => {
  const snapshot = fixture().read();
  assert.deepEqual(selectGoalAncestorImpact(snapshot, at,
    {expectedGraphRevision: snapshot.revision, currentGoal: ref('goal', 2)}).items, []);
  assert.throws(() => selectGoalAncestorImpact(snapshot, at,
    {expectedGraphRevision: snapshot.revision, currentGoal: ref('other-fact', 2)}), {code: 'NOT_APPLICABLE'});
  assert.throws(() => selectGoalAncestorImpact(snapshot, at,
    {expectedGraphRevision: snapshot.revision, currentGoal: ref('goal')}), {code: 'INVALID_ARGUMENT'});
});

function fixture() {
  const store = new FakeCoordinationStoreHost().provision('synthetic-person');
  for (const input of [
    node('meeting', 'fact'),
    node('goal', 'goal', [ref('meeting')]),
    node('decision', 'decision', [ref('goal')]),
    node('plan', 'plan', [ref('decision')]),
    node('other-fact', 'fact'),
    node('other-plan', 'plan', [ref('other-fact')]),
    node('other-fact', 'fact', [], 'changed other fact'),
    node('goal', 'goal', [ref('meeting')], 'revised goal')
  ]) store.append(store.read().revision, input);
  return store;
}

const scope = revision => ({expectedGraphRevision: revision,
  previousGoal: ref('goal'), currentGoal: ref('goal', 2)});
const change = () => ({node: ref('decision'), summary: 'reconsider revised goal',
  reason: 'explicit candidate', dependencies: [ref('goal', 2)]});

test('selects only the current RECHECK subtree caused by the stated Goal revision', () => {
  const snapshot = fixture().read();
  const before = JSON.stringify(snapshot);
  const result = selectGoalRevisionImpact(snapshot, at, scope(snapshot.revision));
  assert.deepEqual(result.items.map(item => item.node.id), ['decision', 'plan']);
  assert.ok(result.items.every(item => item.action === 'RECHECK'));
  assert.equal(JSON.stringify(snapshot), before);
  result.items[0].causes[0].reference.id = 'outside mutation';
  assert.equal(selectGoalRevisionImpact(snapshot, at, scope(snapshot.revision))
    .items[0].causes[0].reference.id, 'goal');
});

test('previews only an explicit affected change without writing or claiming complete repair', () => {
  const store = fixture();
  const snapshot = store.read();
  const result = previewGoalRevisionRepair(store, at,
    {...scope(snapshot.revision), changes: [change()]});
  assert.deepEqual(result.impact.items.map(item => item.node.id), ['decision', 'plan']);
  assert.equal(result.repair.before.snapshot.revision, snapshot.revision);
  assert.equal(result.repair.after.snapshot.revision, snapshot.revision + 1);
  assert.equal(result.repair.after.report.items.find(item => item.node.id === 'plan').action,
    'RECHECK', 'a pinned Plan still needs an explicit revision');
  assert.equal(store.read().revision, snapshot.revision);
});

test('rejects stale or forged Goal pairs and unrelated repair targets', () => {
  const store = fixture();
  const revision = store.read().revision;
  for (const bad of [
    {...scope(revision), expectedGraphRevision: revision - 1},
    {...scope(revision), previousGoal: ref('goal', 2), currentGoal: ref('goal', 3)}
  ]) assert.throws(() => selectGoalRevisionImpact(store.read(), at, bad),
    {code: 'REVISION_CONFLICT'});
  for (const bad of [
    {...scope(revision), previousGoal: ref('other-fact')},
    {...scope(revision), currentGoal: ref('goal')},
    {...scope(revision), currentGoal: ref('goal', 3)},
    {...scope(revision), extra: 'forged'}
  ]) assert.throws(() => selectGoalRevisionImpact(store.read(), at, bad),
    {code: 'INVALID_ARGUMENT'});
  assert.throws(() => previewGoalRevisionRepair(store, at, {...scope(revision),
    changes: [{node: ref('other-plan'), summary: 'unrelated candidate',
      reason: 'must stay outside scope', dependencies: [ref('other-fact', 2)]}]}),
  {code: 'NOT_APPLICABLE'});
});
