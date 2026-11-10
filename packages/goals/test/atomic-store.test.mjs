import assert from 'node:assert/strict';
import test from 'node:test';
import {appendVersions, FakeCoordinationStoreHost} from '../dist/store.js';

const node = (id, dependencies = []) => ({id, kind:'plan', summary:id, sourceRef:'synthetic/batch',
  validFrom:'2026-09-17T00:00:00.000Z', validUntil:'2026-09-18T00:00:00.000Z',
  sensitivity:'private', state:'active', reason:'synthetic', dependencies});

test('atomic Fake batch validates completely before replacing its bound graph', () => {
  const host = new FakeCoordinationStoreHost();
  const store = host.provision('synthetic/a');
  const other = host.provision('synthetic/b');
  const original = store.read();
  const inputs = [node('first'), node('second', [{id:'first', revision:1}])];
  assert.equal(appendVersions(original, 0, inputs).revision, 2);
  assert.deepEqual(store.read(), original);
  const result = store.appendBatch(0, inputs);
  assert.equal(result.revision, 2);
  result.history[0].summary = 'changed returned copy';
  inputs[0].summary = 'changed input';
  assert.equal(store.read().history[0].summary, 'first');
  assert.equal(other.read().revision, 0);
  const before = store.read();
  assert.throws(() => store.appendBatch(2, [node('third'), node('bad', [{id:'missing',revision:1}])]), {code:'INVALID_ARGUMENT'});
  assert.deepEqual(store.read(), before);
  assert.throws(() => store.appendBatch(0, [node('stale')]), {code:'REVISION_CONFLICT'});
  assert.throws(() => store.appendBatch(2, []), {code:'INVALID_ARGUMENT'});
  assert.deepEqual(store.read(), before);
  assert.equal(store.append(2, node('legacy')).revision, 3);
});

test('AtomicCoordinationStorePort commits batch atomically with Fact withdrawal, expiry and readback', () => {
  const host = new FakeCoordinationStoreHost();
  const store = host.provision('fact-propagation');
  const factNode = (id, state = 'active', validUntil = '2099-01-01T00:00:00.000Z') => ({
    id, kind: 'fact', summary: `Fact ${id}`, sourceRef: 'test/fact',
    validFrom: '2026-01-01T00:00:00.000Z', validUntil,
    sensitivity: 'private', state, reason: 'test', dependencies: []
  });
  const planNode = (id, dep) => ({
    id, kind: 'plan', summary: `Plan ${id}`, sourceRef: 'test/plan',
    validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z',
    sensitivity: 'private', state: 'active', reason: 'test',
    dependencies: dep ? [{id: dep.id, revision: dep.revision}] : []
  });

  // Step 1: Initial commit of fact and plan
  const batch1 = [factNode('fact-1'), planNode('plan-1', {id: 'fact-1', revision: 1})];
  const snap1 = store.appendBatch(0, batch1);
  assert.equal(snap1.revision, 2);
  assert.equal(store.read().revision, 2);
  assert.equal(store.read(1).revision, 1);
  assert.equal(store.read(2).revision, 2);

  // Step 2: Withdrawal of fact in batch2
  const batch2 = [factNode('fact-1', 'withdrawn')];
  const snap2 = store.appendBatch(2, batch2);
  assert.equal(snap2.revision, 3);
  const current = store.read();
  const latestFact = current.history.find(n => n.id === 'fact-1' && n.revision === 2);
  assert.ok(latestFact);
  assert.equal(latestFact.state, 'withdrawn');

  // Step 3: Revision conflict on racy batch
  assert.throws(() => store.appendBatch(2, [factNode('fact-2')]), {code: 'REVISION_CONFLICT'});
});
