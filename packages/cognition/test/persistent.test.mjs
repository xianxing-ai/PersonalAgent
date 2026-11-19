import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FakeCoordinationStoreHost} from '@personal-agent/goals/store';
import {analyzeStoredImpact, commitStoredPlanRevision} from '../dist/index.js';

const at = '2026-09-12T09:00:00.000Z';
const node = (id, kind = 'fact', dependencies = []) => ({id, kind, dependencies,
  summary: id === 'meeting' ? 'Meeting at 15:00' : id, sourceRef: 'synthetic/meeting',
  sensitivity: 'private', state: 'active', reason: 'fixture',
  validFrom: '2026-09-12T00:00:00.000Z', validUntil: '2026-09-13T00:00:00.000Z'});
function fixture() {
  const host = new FakeCoordinationStoreHost(), store = host.provision('person-a');
  for (const input of [node('meeting'), node('goal', 'goal', [{id: 'meeting', revision: 1}]),
    node('decision', 'decision', [{id: 'goal', revision: 1}]),
    node('plan', 'plan', [{id: 'decision', revision: 1}]), node('unrelated', 'plan')]) {
    store.append(store.read().revision, input);
  }
  store.append(5, {...node('meeting'), summary: 'Meeting at 17:00', reason: 'correction'});
  return {host, store};
}
const request = revision => ({expectedGraphRevision: revision, plan: {id: 'plan', revision: 1},
  summary: 'Remind at 16:15', reason: 'explicit reviewed candidate',
  dependencies: [{id: 'decision', revision: 1}]});
const item = (report, id) => report.items.find(entry => entry.node.id === id);

test('bound-store analysis returns the exact snapshot and preserves unrelated plans', () => {
  const {store} = fixture();
  const result = analyzeStoredImpact(store, at);
  assert.equal(result.snapshot.revision, result.report.graphRevision);
  assert.equal(item(result.report, 'plan').action, 'RECHECK');
  assert.equal(item(result.report, 'unrelated').action, 'KEEP');
  result.snapshot.history[0].summary = 'outside mutation';
  assert.equal(store.read().history[0].summary, 'Meeting at 15:00');

  const source = store.read();
  const aliasingStore = {read: () => source, append: store.append};
  const isolated = analyzeStoredImpact(aliasingStore, at);
  isolated.snapshot.history[0].summary = 'another outside mutation';
  assert.equal(source.history[0].summary, 'Meeting at 15:00');
});

test('explicit commit appends one Plan version without changing task state or unrelated nodes', () => {
  const {store} = fixture();
  const before = store.read();
  const result = commitStoredPlanRevision(store, at, request(before.revision));
  assert.equal(result.kind, 'applied');
  assert.equal(result.snapshot.revision, before.revision + 1);
  assert.equal(result.snapshot.history.at(-1).id, 'plan');
  assert.equal(result.snapshot.history.at(-1).revision, 2);
  assert.equal(result.snapshot.history.at(-1).summary, 'Remind at 16:15');
  assert.equal(result.snapshot.history.at(-1).state, 'active');
  assert.deepEqual(result.snapshot.history.find(n => n.id === 'unrelated'), before.history.find(n => n.id === 'unrelated'));
  assert.equal(item(result.report, 'plan').action, 'RECHECK', 'unchanged dependencies must not pretend to repair causes');
});

test('a stale request returns fresh analysis and performs no write', () => {
  const {store} = fixture();
  const stale = request(store.read().revision);
  store.append(stale.expectedGraphRevision, node('concurrent'));
  const result = commitStoredPlanRevision(store, at, stale);
  assert.equal(result.kind, 'conflict');
  assert.equal(result.currentGraphRevision, 7);
  assert.equal(result.snapshot.revision, 7);
  assert.equal(store.read().revision, 7);
  assert.equal(item(result.report, 'plan').action, 'RECHECK');
});

test('a commit-time race is not retried and rereads the winner', () => {
  const {store} = fixture();
  const staleSnapshot = store.read();
  let firstRead = true, appendCalls = 0;
  const racing = {
    read(revision) {
      if (firstRead && revision === undefined) {
        firstRead = false;
        store.append(staleSnapshot.revision, node('winner'));
        return staleSnapshot;
      }
      return store.read(revision);
    },
    append(expected, input) { appendCalls++; return store.append(expected, input); }
  };
  const result = commitStoredPlanRevision(racing, at, request(staleSnapshot.revision));
  assert.equal(result.kind, 'conflict');
  assert.equal(result.currentGraphRevision, staleSnapshot.revision + 1);
  assert.equal(appendCalls, 1);
  assert.equal(store.read().history.filter(n => n.id === 'plan').length, 1);

  const foreignError = {code: 'REVISION_CONFLICT'};
  const failingStore = {read: () => store.read(), append: () => { throw foreignError; }};
  assert.throws(() => commitStoredPlanRevision(failingStore, at, request(store.read().revision)),
    error => error === foreignError);
});

test('invalid, unaffected and extra-field requests remain rejected before append', () => {
  const {store} = fixture();
  const revision = store.read().revision;
  for (const invalid of [{...request(revision), hiddenAuthorization: 'forged'},
    {...request(revision), dependencies: 'not-an-array'},
    {...request(revision - 1), dependencies: [{id: 'decision', revision: 1, authorizationRef: 'forged'}]},
    {...request(revision), dependencies: [{id: 'decision', revision: 1}, {id: 'decision', revision: 1}]},
    {...request(revision), dependencies: [{id: 'plan', revision: 1}]},
    {...request(revision - 1), plan: {id: 'plan', revision: 1, hidden: 'forged'}}]) {
    assert.throws(() => commitStoredPlanRevision(store, at, invalid), {code: 'INVALID_ARGUMENT'});
  }
  assert.throws(() => commitStoredPlanRevision(store, at, {...request(revision), plan: {id: 'unrelated', revision: 1}}),
    {code: 'NOT_APPLICABLE'});
  assert.throws(() => commitStoredPlanRevision(store, at, {...request(revision), plan: {id: 'plan', revision: 2}}),
    {code: 'REVISION_CONFLICT'});

  let reads = 0;
  const unreadableStore = {read: () => { reads++; throw new Error('bound snapshot must not be read'); }, append: () => {
    throw new Error('append must not be reached');
  }};
  assert.throws(() => commitStoredPlanRevision(unreadableStore, at,
    {...request(revision - 1), plan: {id: 'plan', revision: 1, hidden: 'forged'}}), {code: 'INVALID_ARGUMENT'});
  assert.equal(reads, 0);
  assert.equal(store.read().revision, revision);
});

test('request fields are validated before the bound store is read', () => {
  const {store} = fixture();
  const revision = store.read().revision;
  let reads = 0;
  const counting = {read: () => { reads++; return store.read(); },
    append: (expected, input) => store.append(expected, input)};
  for (const invalid of [{...request(revision), expectedGraphRevision: 1.5},
    {...request(revision), expectedGraphRevision: -1},
    {...request(revision), summary: '   '},
    {...request(revision), reason: ''},
    {...request(revision), plan: {id: 'plan', revision: 0}},
    {...request(revision), plan: {id: 'plan', revision: 1.5}},
    {...request(revision), plan: {id: ' ', revision: 1}},
    {...request(revision), dependencies: [{id: 'decision', revision: 0}]}]) {
    assert.throws(() => commitStoredPlanRevision(counting, at, invalid), {code: 'INVALID_ARGUMENT'});
  }
  assert.equal(reads, 0, 'validation must not touch the bound store');
  assert.equal(store.read().revision, revision);
});

test('the appended Plan version keeps the requested dependencies and reviewed reason', () => {
  const {store} = fixture();
  const before = store.read();
  const result = commitStoredPlanRevision(store, at, {...request(before.revision),
    dependencies: [{id: 'decision', revision: 1}, {id: 'goal', revision: 1}]});
  assert.equal(result.kind, 'applied');
  const appended = result.snapshot.history.at(-1);
  assert.deepEqual(appended.dependencies, [{id: 'decision', revision: 1}, {id: 'goal', revision: 1}]);
  assert.equal(appended.reason, 'explicit reviewed candidate');
  assert.equal(appended.sourceRef, before.history.find(n => n.id === 'plan').sourceRef,
    'the appended version stays the same Plan node');
  assert.deepEqual(result.proposal.plan, {id: 'plan', revision: 1});
  assert.equal(result.proposal.evaluatedAt, at);
  assert.deepEqual(result.proposal.changes,
    [{field: 'summary', before: 'plan', after: 'Remind at 16:15'}]);
  assert.equal(result.proposal.reason, 'explicit reviewed candidate');
});
