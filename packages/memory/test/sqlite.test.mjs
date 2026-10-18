import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {FactChangeFeedError, MemoryQueryError} from '../dist/index.js';
import {openSqliteMemoryHost} from '../dist/sqlite.js';

const deadline = '2099-01-01T00:00:00.000Z';
const at = '2026-09-22T08:00:00.000Z';

function request(extra = {}) {
  return {deadline, signal: new AbortController().signal, ...extra};
}

function version(id, revision, options = {}) {
  return {
    ref: {id, revision},
    summary: options.summary ?? `${id}-v${revision}`,
    sourceRef: options.sourceRef ?? 'test-source',
    observedAt: '2026-09-22T07:00:00.000Z',
    validFrom: '2026-09-22T00:00:00.000Z',
    validUntil: '2027-09-22T00:00:00.000Z',
    sensitivity: options.sensitivity ?? 'public',
    state: options.state ?? 'active',
    confirmation: 'user_confirmed',
    ...(revision === 1 ? {} : {corrects: {id, revision: revision - 1}}),
  };
}

function databasePath(t) {
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-memory-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  return join(directory, 'memory.sqlite');
}

test('private admin heads include withdrawn and expired records with isolated durable pagination', async t => {
  let host;
  t.after(() => host?.close());
  const path = databasePath(t);
  host = openSqliteMemoryHost(path);
  host.provision('private-admin');
  host.provision('other');
  host.append('private-admin', version('a', 1, {sensitivity: 'private'}));
  host.append('private-admin', version('a', 2, {sensitivity: 'private', state: 'withdrawn'}));
  host.append('private-admin', {...version('b', 1, {sensitivity: 'private'}), validUntil: '2026-09-22T01:00:00.000Z'});
  host.append('private-admin', version('public', 1));
  host.append('private-admin', {...version('inferred', 1, {sensitivity: 'private'}), confirmation: 'model_inference'});
  host.append('private-admin', version('hidden', 1, {sensitivity: 'private'}));
  host.append('private-admin', version('hidden', 2, {sensitivity: 'restricted'}));
  const first = await host.listUserFactHeads('private-admin', request({at, limit: 1}));
  assert.deepEqual(first.facts.map(fact => [fact.ref.id, fact.ref.revision, fact.state]), [['a', 2, 'withdrawn']]);
  assert.ok(first.nextCursor);
  host.append('private-admin', version('c', 1, {sensitivity: 'private'}));
  host.close();
  host = openSqliteMemoryHost(path);
  const second = await host.listUserFactHeads('private-admin', request({at, limit: 1,
    snapshot: first.snapshot, cursor: first.nextCursor}));
  assert.deepEqual(second.facts.map(fact => fact.ref.id), ['b']);
  assert.equal(second.nextCursor, undefined);
  assert.deepEqual((await host.listUserFactHeads('private-admin', request({at, limit: 10})))
    .facts.map(fact => fact.ref.id), ['a', 'b', 'c']);
  const consumer = host.bind('private-admin', {allowedSensitivities: ['private']});
  assert.deepEqual((await consumer.listCurrent(request({at, limit: 10, factId: 'a'}))).facts, []);
  await assert.rejects(consumer.listCurrent(request({at, limit: 1, snapshot: first.snapshot})), {code: 'INVALID_ARGUMENT'});
  const publicPage = await consumer.listCurrent(request({at, limit: 1}));
  await assert.rejects(host.listUserFactHeads('private-admin', request({at, limit: 1,
    snapshot: publicPage.snapshot})), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(host.listUserFactHeads('other', request({at, limit: 1,
    snapshot: first.snapshot})), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(host.listUserFactHeads('private-admin', request({at, limit: 101})), {code: 'INVALID_ARGUMENT'});
  const signal = AbortSignal.abort();
  await assert.rejects(host.listUserFactHeads('private-admin', request({at, limit: 1, signal})), {code: 'CANCELLED'});
  await assert.rejects(host.listUserFactHeads('private-admin', request({at, limit: 1,
    deadline: '2000-01-01T00:00:00.000Z'})), {code: 'TIMEOUT'});
  const independent = await host.listUserFactHeads('other', request({at, limit: 1}));
  host.eraseUnboundFact('private-admin', request({factId: 'a', expectedRevision: 2, operationId: 'erase-withdrawn'}));
  await assert.rejects(host.listUserFactHeads('private-admin', request({at, limit: 1,
    snapshot: first.snapshot, cursor: first.nextCursor})), {code: 'INVALID_ARGUMENT'});
  assert.deepEqual((await host.listUserFactHeads('other', request({at, limit: 1,
    snapshot: independent.snapshot}))).facts, []);
});

test('SQLite memory keeps immutable facts and query snapshots across restart', async t => {
  const path = databasePath(t);
  let host = openSqliteMemoryHost(path);
  host.provision('personal');
  host.append('personal', version('a', 1));
  host.append('personal', version('b', 1));
  host.append('personal', version('c', 1));

  let memory = host.bind('personal', {allowedSensitivities: ['public']});
  const first = await memory.listCurrent(request({at, limit: 1}));
  assert.deepEqual(first.facts.map(item => item.ref.id), ['a']);
  assert.ok(first.nextCursor);

  host.append('personal', version('d', 1));
  assert.throws(
    () => host.append('personal', version('a', 1)),
    error => error instanceof MemoryQueryError && error.code === 'INVALID_ARGUMENT',
  );
  host.append('personal', version('a', 2, {summary: 'a corrected'}));
  host.close();

  host = openSqliteMemoryHost(path);
  memory = host.bind('personal', {allowedSensitivities: ['public']});
  const second = await memory.listCurrent(request({
    at,
    limit: 1,
    snapshot: first.snapshot,
    cursor: first.nextCursor,
  }));
  assert.deepEqual(second.facts.map(item => item.ref.id), ['b']);
  assert.ok(second.nextCursor);
  const third = await memory.listCurrent(request({
    at,
    limit: 1,
    snapshot: second.snapshot,
    cursor: second.nextCursor,
  }));
  assert.deepEqual(third.facts.map(item => item.ref.id), ['c']);
  assert.equal(third.nextCursor, undefined);

  const fresh = await memory.listCurrent(request({at, limit: 10}));
  assert.deepEqual(fresh.facts.map(item => item.ref.id), ['a', 'b', 'c', 'd']);
  assert.equal((await memory.getVersion(request({fact: {id: 'a', revision: 1}}))).summary, 'a-v1');
  const history = await memory.listHistory(request({factId: 'a', limit: 10}));
  assert.deepEqual(history.facts.map(item => item.ref), [
    {id: 'a', revision: 1},
    {id: 'a', revision: 2},
  ]);
  host.close();
});

test('host erases every version of an unbound fact and invalidates old query pages', async t => {
  const path = databasePath(t);
  let host = openSqliteMemoryHost(path);
  host.provision('personal');
  host.provision('other');
  host.append('personal', version('remove-me', 1));
  host.append('personal', version('keep-me', 1));
  host.append('personal', version('remove-me', 2));
  host.append('other', version('remove-me', 1));
  let memory = host.bind('personal', {allowedSensitivities: ['public']});
  const page = await memory.listCurrent(request({at, limit: 1}));
  assert.ok(page.nextCursor);
  const unrelated = await memory.listCurrent(request({at, limit: 10, factId: 'keep-me'}));

  assert.throws(() => host.eraseUnboundFact('personal', request({
    factId: 'remove-me', expectedRevision: 1, operationId: 'erase-stale',
  })), {code: 'REVISION_CONFLICT'});
  const cancelled = new AbortController();
  cancelled.abort();
  assert.throws(() => host.eraseUnboundFact('personal', request({
    factId: 'remove-me', expectedRevision: 2, operationId: 'erase-cancelled', signal: cancelled.signal,
  })), {code: 'CANCELLED'});
  host.eraseUnboundFact('personal', request({
    factId: 'remove-me', expectedRevision: 2, operationId: 'erase-unbound',
  }));
  await assert.rejects(memory.listCurrent(request({
    at, limit: 1, snapshot: page.snapshot, cursor: page.nextCursor,
  })), {code: 'INVALID_ARGUMENT'});
  assert.deepEqual((await memory.listCurrent(request({
    at, limit: 10, factId: 'keep-me', snapshot: unrelated.snapshot,
  }))).facts.map(f => f.ref.id), ['keep-me']);
  assert.deepEqual((await memory.listHistory(request({factId: 'remove-me', limit: 10}))).facts, []);
  assert.deepEqual((await memory.listCurrent(request({at, limit: 10}))).facts.map(f => f.ref.id), ['keep-me']);
  assert.deepEqual((await host.bind('other', {allowedSensitivities: ['public']})
    .listCurrent(request({at, limit: 10}))).facts.map(f => f.ref.id), ['remove-me']);
  host.close();

  const db = new DatabaseSync(path);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_facts WHERE namespace = ? AND fact_id = ?')
    .get('personal', 'remove-me').count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_query_snapshots WHERE token = ?')
    .get(page.snapshot).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_query_snapshots WHERE token = ?')
    .get(unrelated.snapshot).count, 1);
  db.close();

  host = openSqliteMemoryHost(path);
  memory = host.bind('personal', {allowedSensitivities: ['public']});
  assert.deepEqual((await memory.listCurrent(request({at, limit: 10}))).facts.map(f => f.ref.id), ['keep-me']);
  assert.throws(() => host.append('personal', version('remove-me', 1)), {code: 'SCOPE_DENIED'});
  assert.doesNotThrow(() => host.eraseUnboundFact('personal', request({
    factId: 'remove-me', expectedRevision: 2, operationId: 'erase-unbound',
  })));
  assert.throws(() => host.eraseUnboundFact('personal', request({
    factId: 'remove-me', expectedRevision: 2, operationId: 'other-operation',
  })), {code: 'REVISION_CONFLICT'});
  host.close();
});

test('host refuses to erase a fact after any downstream feed has been bound', async t => {
  const path = databasePath(t);
  const host = openSqliteMemoryHost(path);
  host.provision('personal');
  host.append('personal', version('a', 1));
  host.bindFeed('personal', {consumerId: 'cognition', allowedSensitivities: ['public']});
  assert.throws(() => host.eraseUnboundFact('personal', request({
    factId: 'a', expectedRevision: 1, operationId: 'bound-denied',
  })),
    {code: 'SCOPE_DENIED'});
  const memory = host.bind('personal', {allowedSensitivities: ['public']});
  assert.equal((await memory.getVersion(request({fact: {id: 'a', revision: 1}}))).summary, 'a-v1');
  host.close();
});

test('SQLite feed replays pending batches and confirmations across restart', async t => {
  const path = databasePath(t);
  let host = openSqliteMemoryHost(path);
  host.provision('personal');
  host.append('personal', version('a', 1));
  host.append('personal', version('b', 1));

  let feed = host.bindFeed('personal', {
    consumerId: 'cognition',
    allowedSensitivities: ['public'],
  });
  const first = await feed.read(request({limit: 1}));
  assert.equal(first.mode, 'bootstrap');
  assert.equal(first.entries.length, 1);
  host.close();

  host = openSqliteMemoryHost(path);
  feed = host.bindFeed('personal', {
    consumerId: 'cognition',
    allowedSensitivities: ['public'],
  });
  assert.deepEqual(await feed.read(request({limit: 1})), first);
  assert.throws(
    () => host.confirmFeedBatch('personal', 'cognition', request({
      batchToken: first.batchToken,
      expectedCheckpoint: 'wrong-checkpoint',
      handled: first.entries,
    })),
    error => error instanceof FactChangeFeedError && error.code === 'REVISION_CONFLICT',
  );
  assert.throws(
    () => host.confirmFeedBatch('personal', 'cognition', request({
      batchToken: first.batchToken,
      expectedCheckpoint: first.baseCheckpoint,
      handled: [],
    })),
    error => error instanceof FactChangeFeedError && error.code === 'INVALID_ARGUMENT',
  );
  assert.deepEqual(await feed.read(request({limit: 1})), first);
  const firstReceipt = host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: first.batchToken,
    expectedCheckpoint: first.baseCheckpoint,
    handled: first.entries,
  }));
  host.close();

  host = openSqliteMemoryHost(path);
  feed = host.bindFeed('personal', {
    consumerId: 'cognition',
    allowedSensitivities: ['public'],
  });
  assert.deepEqual(host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: first.batchToken,
    expectedCheckpoint: first.baseCheckpoint,
    handled: first.entries,
  })), firstReceipt);

  const second = await feed.read(request({limit: 1}));
  assert.equal(second.mode, 'bootstrap');
  assert.equal(second.atWatermark, true);
  host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: second.batchToken,
    expectedCheckpoint: second.baseCheckpoint,
    handled: second.entries,
  }));

  host.append('personal', version('a', 2, {summary: 'a corrected'}));
  const change = await feed.read(request({limit: 10}));
  assert.equal(change.mode, 'changes');
  assert.deepEqual(change.entries.map(entry => entry.fact), [{id: 'a', revision: 2}]);
  host.close();

  host = openSqliteMemoryHost(path);
  feed = host.bindFeed('personal', {
    consumerId: 'cognition',
    allowedSensitivities: ['public'],
  });
  assert.deepEqual(await feed.read(request({limit: 10})), change);
  host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: change.batchToken,
    expectedCheckpoint: change.baseCheckpoint,
    handled: change.entries,
  }));
  host.close();
});

test('a durable feed delivery can contain a target fact and an unrelated fact together', async t => {
  const path = databasePath(t);
  let host = openSqliteMemoryHost(path);
  host.provision('personal');
  host.append('personal', version('erase-target', 1));
  host.append('personal', version('keep-other', 1));
  let feed = host.bindFeed('personal', {
    consumerId: 'cognition', allowedSensitivities: ['public'],
  });
  const batch = await feed.read(request({limit: 10}));
  assert.deepEqual(batch.entries.map(entry => entry.fact.id), ['erase-target', 'keep-other']);
  host.close();

  host = openSqliteMemoryHost(path);
  feed = host.bindFeed('personal', {
    consumerId: 'cognition', allowedSensitivities: ['public'],
  });
  assert.deepEqual(await feed.read(request({limit: 10})), batch);
  host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: batch.batchToken, expectedCheckpoint: batch.baseCheckpoint,
    handled: batch.entries,
  }));
  host.close();
});

test('erasure intent hides one fact and preserves an unrelated entry in the same pending batch', async t => {
  const path = databasePath(t);
  let host = openSqliteMemoryHost(path);
  host.provision('personal');
  host.provision('other');
  host.append('personal', version('erase-target', 1));
  host.append('personal', version('keep-other', 1));
  host.append('other', version('erase-target', 1));
  let memory = host.bind('personal', {allowedSensitivities: ['public']});
  const broadPage = await memory.listCurrent(request({at, limit: 10}));
  const targetPage = await memory.listCurrent(request({at, limit: 10, factId: 'erase-target'}));
  const otherPage = await memory.listCurrent(request({at, limit: 10, factId: 'keep-other'}));
  let feed = host.bindFeed('personal', {
    consumerId: 'cognition', allowedSensitivities: ['public'],
  });
  const original = await feed.read(request({limit: 10}));
  assert.throws(() => host.beginFactErasure('personal', request({
    factId: 'erase-target', expectedRevision: 2, operationId: 'stale',
  })), {code: 'REVISION_CONFLICT'});
  const cancelled = new AbortController();
  cancelled.abort();
  assert.throws(() => host.beginFactErasure('personal', request({
    factId: 'erase-target', expectedRevision: 1, operationId: 'cancelled', signal: cancelled.signal,
  })), {code: 'CANCELLED'});
  assert.deepEqual(await feed.read(request({limit: 10})), original);
  host.beginFactErasure('personal', request({
    factId: 'erase-target', expectedRevision: 1, operationId: 'erase-1',
  }));
  assert.deepEqual(host.readFeedDelivery('personal', 'cognition', request({
    batchToken: original.batchToken,
  })).entries.map(entry => entry.fact.id), ['keep-other']);
  assert.throws(() => host.readFeedDelivery('personal', 'other-consumer', request({
    batchToken: original.batchToken,
  })), {code: 'SCOPE_DENIED'});
  assert.deepEqual((await feed.read(request({limit: 10}))).entries.map(entry => entry.fact.id), ['keep-other']);
  assert.throws(() => host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: original.batchToken, expectedCheckpoint: original.baseCheckpoint,
    handled: original.entries,
  })), {code: 'INVALID_ARGUMENT'});
  const revised = await feed.read(request({limit: 10}));
  host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: revised.batchToken, expectedCheckpoint: revised.baseCheckpoint,
    handled: revised.entries,
  }));
  await assert.rejects(memory.listCurrent(request({
    at, limit: 10, factId: 'erase-target', snapshot: targetPage.snapshot,
  })), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(memory.listCurrent(request({
    at, limit: 10, snapshot: broadPage.snapshot,
  })), {code: 'INVALID_ARGUMENT'});
  assert.deepEqual((await memory.listCurrent(request({
    at, limit: 10, factId: 'keep-other', snapshot: otherPage.snapshot,
  }))).facts.map(fact => fact.ref.id), ['keep-other']);
  assert.deepEqual((await host.bind('other', {allowedSensitivities: ['public']})
    .listCurrent(request({at, limit: 10}))).facts.map(fact => fact.ref.id), ['erase-target']);
  await assert.rejects(memory.getVersion(request({fact: {id: 'erase-target', revision: 1}})),
    {code: 'SCOPE_DENIED'});
  host.close();

  host = openSqliteMemoryHost(path);
  memory = host.bind('personal', {allowedSensitivities: ['public']});
  assert.deepEqual((await memory.listCurrent(request({at, limit: 10}))).facts.map(fact => fact.ref.id),
    ['keep-other']);
  assert.deepEqual((await memory.listHistory(request({factId: 'erase-target', limit: 10}))).facts, []);
  assert.doesNotThrow(() => host.beginFactErasure('personal', request({
    factId: 'erase-target', expectedRevision: 1, operationId: 'erase-1',
  })));
  host.close();
});

test('erasure intent keeps a source-filtered snapshot made before the target existed', async t => {
  const host = openSqliteMemoryHost(databasePath(t));
  host.provision('personal');
  host.append('personal', version('keep-other', 1));
  const memory = host.bind('personal', {allowedSensitivities: ['public']});
  const page = await memory.listCurrent(request({at, limit: 10, sourceRef: 'test-source'}));
  host.append('personal', version('erase-target', 1));
  host.beginFactErasure('personal', request({
    factId: 'erase-target', expectedRevision: 1, operationId: 'erase-after-snapshot',
  }));
  assert.deepEqual((await memory.listCurrent(request({
    at, limit: 10, sourceRef: 'test-source', snapshot: page.snapshot,
  }))).facts.map(fact => fact.ref.id), ['keep-other']);
  host.close();
});

test('erasure intent rebases a partly consumed bootstrap without skipping its other fact', async t => {
  const path = databasePath(t);
  const host = openSqliteMemoryHost(path);
  host.provision('personal');
  host.append('personal', version('a-before', 1));
  host.append('personal', version('b-target', 1));
  host.append('personal', version('c-after', 1));
  const feed = host.bindFeed('personal', {
    consumerId: 'cognition', allowedSensitivities: ['public'],
  });
  const first = await feed.read(request({limit: 1}));
  host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: first.batchToken, expectedCheckpoint: first.baseCheckpoint,
    handled: first.entries,
  }));
  const mixed = await feed.read(request({limit: 2}));
  assert.deepEqual(mixed.entries.map(entry => entry.fact.id), ['b-target', 'c-after']);
  host.beginFactErasure('personal', request({
    factId: 'b-target', expectedRevision: 1, operationId: 'erase-bootstrap',
  }));
  const revised = await feed.read(request({limit: 2}));
  assert.deepEqual(revised.entries.map(entry => entry.fact.id), ['c-after']);
  assert.equal(revised.atWatermark, true);
  host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: revised.batchToken, expectedCheckpoint: revised.baseCheckpoint,
    handled: revised.entries,
  }));
  assert.equal((await feed.read(request({limit: 10}))).mode, 'changes');
  host.close();
});

test('erasure intent rewrites confirmed and changes batches without losing an unrelated event', async t => {
  const path = databasePath(t);
  const host = openSqliteMemoryHost(path);
  host.provision('personal');
  host.append('personal', version('erase-target', 1));
  host.append('personal', version('keep-other', 1));
  const feed = host.bindFeed('personal', {
    consumerId: 'cognition', allowedSensitivities: ['public'],
  });
  const bootstrap = await feed.read(request({limit: 10}));
  const receipt = host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: bootstrap.batchToken, expectedCheckpoint: bootstrap.baseCheckpoint,
    handled: bootstrap.entries,
  }));
  host.append('personal', version('erase-target', 2));
  host.append('personal', version('keep-other', 2));
  const changes = await feed.read(request({limit: 10}));
  assert.deepEqual(changes.entries.map(entry => entry.fact.id), ['erase-target', 'keep-other']);

  host.beginFactErasure('personal', request({
    factId: 'erase-target', expectedRevision: 2, operationId: 'erase-changes',
  }));
  assert.throws(() => host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: bootstrap.batchToken, expectedCheckpoint: bootstrap.baseCheckpoint,
    handled: bootstrap.entries,
  })), {code: 'INVALID_ARGUMENT'});
  assert.deepEqual(host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: bootstrap.batchToken, expectedCheckpoint: bootstrap.baseCheckpoint,
    handled: bootstrap.entries.filter(entry => entry.fact.id !== 'erase-target'),
  })), receipt);
  const revised = await feed.read(request({limit: 10}));
  assert.deepEqual(revised.entries.map(entry => entry.fact.id), ['keep-other']);
  assert.throws(() => host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: changes.batchToken, expectedCheckpoint: changes.baseCheckpoint,
    handled: changes.entries,
  })), {code: 'INVALID_ARGUMENT'});
  host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: revised.batchToken, expectedCheckpoint: revised.baseCheckpoint,
    handled: revised.entries,
  }));
  assert.deepEqual((await feed.read(request({limit: 10}))).entries, []);
  host.close();
});

test('host-only completion purges every target version and refuses a stale mixed delivery', async t => {
  const path = databasePath(t);
  const host = openSqliteMemoryHost(path);
  host.provision('personal');
  host.createUserFact('personal', request({factId: 'erase-target',
    operationId: 'create-erase-target', summary: 'Confirmed target', sourceRef: 'local-note',
    observedAt: at, validFrom: '2026-09-22T00:00:00.000Z',
    validUntil: '2027-09-22T00:00:00.000Z'}));
  host.append('personal', version('erase-target', 2, {sensitivity: 'private'}));
  host.append('personal', version('keep-other', 1));
  const feed = host.bindFeed('personal', {consumerId: 'cognition',
    allowedSensitivities: ['public', 'private']});
  const original = await feed.read(request({limit: 10}));
  host.beginFactErasure('personal', request({factId: 'erase-target', expectedRevision: 2,
    operationId: 'synthetic-completion'}));
  const revised = host.readFeedDelivery('personal', 'cognition', request({batchToken: original.batchToken}));
  const completion = request({factId: 'erase-target', expectedRevision: 2,
    operationId: 'synthetic-completion', runtimeReceipt: {graphNamespace: 'synthetic-graph',
      memoryNamespace: 'personal', factId: 'erase-target', operationId: 'synthetic-completion',
      expectedGraphRevision: 1, committedAt: at}});
  const db = new DatabaseSync(path);
  try {
    assert.throws(() => host.completeFactErasure('personal', {...completion,
      runtimeReceipt: {...completion.runtimeReceipt, operationId: 'wrong'}}),
    {code: 'INVALID_ARGUMENT'});
    db.prepare('UPDATE memory_feed_deliveries SET batch_json = ? WHERE batch_token = ?')
      .run(JSON.stringify(original), original.batchToken);
    assert.throws(() => host.completeFactErasure('personal', completion), {code: 'SCOPE_DENIED'});
    assert.equal(db.prepare('SELECT count(*) AS total FROM memory_facts WHERE namespace = ? AND fact_id = ?')
      .get('personal', 'erase-target').total, 2);
    db.prepare('UPDATE memory_feed_deliveries SET batch_json = ? WHERE batch_token = ?')
      .run(JSON.stringify(revised), original.batchToken);
    host.completeFactErasure('personal', completion);
    host.completeFactErasure('personal', completion);
    assert.deepEqual(db.prepare('SELECT fact_id FROM memory_facts WHERE namespace = ? ORDER BY fact_id')
      .all('personal').map(row => row.fact_id), ['keep-other']);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_user_creations').get().count, 0);
    assert.equal(db.prepare('SELECT phase FROM memory_erasure_intents WHERE namespace = ? AND fact_id = ?')
      .get('personal', 'erase-target').phase, 'completed');
    assert.deepEqual(host.readFeedDelivery('personal', 'cognition',
      request({batchToken: original.batchToken})).entries.map(entry => entry.fact.id), ['keep-other']);
  } finally {
    db.close();
    host.close();
  }
});

test('a busy WAL checkpoint keeps the completed purge retryable', t => {
  const path = databasePath(t);
  const host = openSqliteMemoryHost(path);
  const reader = new DatabaseSync(path);
  let reading = false;
  try {
    host.provision('personal');
    host.append('personal', version('erase-target', 1));
    host.beginFactErasure('personal', request({factId: 'erase-target', expectedRevision: 1,
      operationId: 'synthetic-wal-retry'}));
    const completion = request({factId: 'erase-target', expectedRevision: 1,
      operationId: 'synthetic-wal-retry', runtimeReceipt: {graphNamespace: 'synthetic-graph',
        memoryNamespace: 'personal', factId: 'erase-target', operationId: 'synthetic-wal-retry',
        expectedGraphRevision: 1, committedAt: at}});
    reader.exec('BEGIN');
    reading = true;
    assert.equal(reader.prepare('SELECT count(*) AS total FROM memory_facts WHERE namespace = ?')
      .get('personal').total, 1);
    assert.throws(() => host.completeFactErasure('personal', completion),
      {code: 'STORAGE_UNAVAILABLE'});
    reader.exec('ROLLBACK');
    reading = false;
    assert.equal(reader.prepare('SELECT phase FROM memory_erasure_intents WHERE namespace = ? AND fact_id = ?')
      .get('personal', 'erase-target').phase, 'completed');
    assert.equal(reader.prepare('SELECT count(*) AS total FROM memory_facts WHERE namespace = ? AND fact_id = ?')
      .get('personal', 'erase-target').total, 0);
    assert.doesNotThrow(() => host.completeFactErasure('personal', completion));
  } finally {
    if (reading) reader.exec('ROLLBACK');
    reader.close();
    host.close();
  }
});

test('reopened unbound erasure resumes WAL maintenance before private reads', t => {
  const path = databasePath(t);
  let host = openSqliteMemoryHost(path);
  const reader = new DatabaseSync(path);
  let reading = false;
  try {
    host.provision('personal');
    host.append('personal', version('erase-target', 1));
    host.append('personal', version('keep-other', 1));
    reader.exec('BEGIN');
    reading = true;
    reader.prepare('SELECT count(*) AS total FROM memory_facts').get();
    assert.throws(() => host.eraseUnboundFact('personal', request({
      factId: 'erase-target', expectedRevision: 1, operationId: 'synthetic-unbound-retry',
    })), {code: 'STORAGE_UNAVAILABLE'});
    host.close();
    host = openSqliteMemoryHost(path);
    assert.throws(() => host.resumeCompletedErasureMaintenance('personal'),
      {code: 'STORAGE_UNAVAILABLE'});
    reader.exec('ROLLBACK');
    reading = false;
    assert.doesNotThrow(() => host.resumeCompletedErasureMaintenance('personal'));
    assert.equal(reader.prepare('SELECT count(*) AS total FROM memory_facts WHERE fact_id = ?')
      .get('erase-target').total, 0);
    assert.equal(reader.prepare('SELECT count(*) AS total FROM memory_facts WHERE fact_id = ?')
      .get('keep-other').total, 1);
    assert.doesNotThrow(() => host.resumeCompletedErasureMaintenance('personal'));
  } finally {
    if (reading) reader.exec('ROLLBACK');
    reader.close();
    host.close();
  }
});

test('SQLite feed invalidates a binding when a visible fact becomes hidden', async t => {
  const path = databasePath(t);
  const host = openSqliteMemoryHost(path);
  host.provision('personal');
  host.append('personal', version('a', 1));

  const feed = host.bindFeed('personal', {
    consumerId: 'public-view',
    allowedSensitivities: ['public'],
  });
  const pending = await feed.read(request({limit: 10}));
  host.append('personal', version('a', 2, {sensitivity: 'restricted'}));

  await assert.rejects(
    feed.read(request({limit: 10})),
    error => error instanceof FactChangeFeedError && error.code === 'REBUILD_REQUIRED',
  );
  assert.throws(
    () => host.confirmFeedBatch('personal', 'public-view', request({
      batchToken: pending.batchToken,
      expectedCheckpoint: pending.baseCheckpoint,
      handled: pending.entries,
    })),
    error => error instanceof FactChangeFeedError && error.code === 'REBUILD_REQUIRED',
  );
  host.close();
});

test('user correction and withdrawal are durable, idempotent and retain exact history', async t => {
  const path = databasePath(t);
  let host = openSqliteMemoryHost(path);
  host.provision('personal');
  host.append('personal', version('preference', 1));
  let feed = host.bindFeed('personal', {
    consumerId: 'cognition', allowedSensitivities: ['public', 'private'],
  });
  const initial = await feed.read(request({limit: 10}));
  host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: initial.batchToken, expectedCheckpoint: initial.baseCheckpoint,
    handled: initial.entries,
  }));
  const correction = request({
    factId: 'preference', expectedRevision: 1, operationId: 'user-correction-1',
    summary: 'Corrected preference', sourceRef: 'user-action-1',
    observedAt: '2026-09-22T08:00:00.000Z',
    validFrom: '2026-09-22T00:00:00.000Z', validUntil: '2027-09-22T00:00:00.000Z',
    sensitivity: 'private', state: 'active',
  });
  assert.equal(host.reviseUserFact('personal', correction).appended, true);
  host.close();

  host = openSqliteMemoryHost(path);
  feed = host.bindFeed('personal', {
    consumerId: 'cognition', allowedSensitivities: ['public', 'private'],
  });
  const changed = await feed.read(request({limit: 10}));
  assert.deepEqual(changed.entries.map(entry => entry.fact), [{id: 'preference', revision: 2}]);
  host.confirmFeedBatch('personal', 'cognition', request({
    batchToken: changed.batchToken, expectedCheckpoint: changed.baseCheckpoint,
    handled: changed.entries,
  }));
  assert.deepEqual(host.reviseUserFact('personal', correction), {
    fact: {...version('preference', 2, {summary: 'Corrected preference',
      sourceRef: 'user-action-1', sensitivity: 'private'}),
      observedAt: correction.observedAt},
    appended: false,
  });
  assert.throws(() => host.reviseUserFact('personal', {...correction, summary: 'Changed retry'}),
    {code: 'REVISION_CONFLICT'});
  assert.throws(() => host.reviseUserFact('personal', {...correction, operationId: 'stale-operation'}),
    {code: 'REVISION_CONFLICT'});

  const withdrawal = {...correction, expectedRevision: 2, operationId: 'user-withdrawal-1',
    summary: 'User withdrew preference', sourceRef: 'user-action-2', state: 'withdrawn'};
  assert.equal(host.reviseUserFact('personal', withdrawal).fact.ref.revision, 3);
  assert.deepEqual((await feed.read(request({limit: 10}))).entries.map(entry => entry.fact),
    [{id: 'preference', revision: 3}]);
  const memory = host.bind('personal', {allowedSensitivities: ['private']});
  assert.deepEqual((await memory.listCurrent(request({at, limit: 10}))).facts, []);
  const history = await memory.listHistory(request({factId: 'preference', limit: 10}));
  assert.deepEqual(history.facts.map(item => [item.ref.revision, item.state, item.confirmation]), [
    [2, 'active', 'user_confirmed'], [3, 'withdrawn', 'user_confirmed'],
  ]);
  const db = new DatabaseSync(path);
  assert.equal(db.prepare('SELECT sequence FROM memory_namespaces WHERE namespace = ?')
    .get('personal').sequence, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_user_revisions').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_facts WHERE namespace = ?')
    .get('personal').count, 3);
  db.close();
  host.close();
});

test('first user-confirmed private fact is idempotent across restart and erased with its receipt', async t => {
  const path = databasePath(t);
  let host = openSqliteMemoryHost(path);
  host.provision('personal');
  const creation = request({
    factId: 'confirmed-note', operationId: 'confirm-note-1', summary: 'Confirmed excerpt',
    sourceRef: 'local-note@revision-1', observedAt: at,
    validFrom: '2026-09-22T00:00:00.000Z', validUntil: '2027-09-22T00:00:00.000Z',
  });
  const first = host.createUserFact('personal', creation);
  assert.equal(first.appended, true);
  assert.equal(first.fact.sensitivity, 'private');
  assert.equal(first.fact.confirmation, 'user_confirmed');
  assert.deepEqual((await host.bind('personal', {allowedSensitivities: ['public']})
    .listCurrent(request({at, limit: 10}))).facts, []);
  assert.deepEqual((await host.bind('personal', {allowedSensitivities: ['private']})
    .listCurrent(request({at, limit: 10}))).facts.map(item => item.ref),
  [{id: creation.factId, revision: 1}]);
  host.close();

  host = openSqliteMemoryHost(path);
  assert.deepEqual(host.createUserFact('personal', creation), {fact: first.fact, appended: false});
  assert.throws(() => host.createUserFact('personal', {...creation, summary: 'Altered retry'}),
    {code: 'REVISION_CONFLICT'});
  assert.throws(() => host.createUserFact('personal', {...creation, factId: 'other-note'}),
    {code: 'REVISION_CONFLICT'});
  assert.throws(() => host.createUserFact('personal', {...creation, operationId: 'another-operation'}),
    {code: 'REVISION_CONFLICT'});
  host.eraseUnboundFact('personal', request({
    factId: creation.factId, expectedRevision: 1, operationId: 'erase-confirmed-note',
  }));
  const db = new DatabaseSync(path);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_user_creations').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_facts').get().count, 0);
  db.close();
  assert.throws(() => host.createUserFact('personal', creation), {code: 'SCOPE_DENIED'});
  host.close();
});

test('first user-confirmed receipt failure rolls back fact and feed sequence', t => {
  const path = databasePath(t);
  const host = openSqliteMemoryHost(path);
  const db = new DatabaseSync(path);
  host.provision('personal');
  const creation = request({
    factId: 'confirmed-note', operationId: 'confirm-note-failed', summary: 'Confirmed excerpt',
    sourceRef: 'local-note@revision-1', observedAt: at,
    validFrom: '2026-09-22T00:00:00.000Z', validUntil: '2027-09-22T00:00:00.000Z',
  });
  db.exec(`CREATE TRIGGER fail_creation_receipt BEFORE INSERT ON memory_user_creations
    BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END`);
  assert.throws(() => host.createUserFact('personal', creation), {code: 'INVALID_ARGUMENT'});
  assert.equal(db.prepare('SELECT sequence FROM memory_namespaces WHERE namespace = ?')
    .get('personal').sequence, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_facts').get().count, 0);
  db.exec('DROP TRIGGER fail_creation_receipt');
  assert.equal(host.createUserFact('personal', creation).appended, true);
  db.close();
  host.close();
});

test('user revision receipt failure rolls back fact, event and sequence', t => {
  const path = databasePath(t);
  const host = openSqliteMemoryHost(path);
  const db = new DatabaseSync(path);
  host.provision('personal');
  host.append('personal', version('preference', 1));
  const correction = request({
    factId: 'preference', expectedRevision: 1, operationId: 'user-correction-failed',
    summary: 'Corrected preference', sourceRef: 'user-action-1',
    observedAt: '2026-09-22T08:00:00.000Z',
    validFrom: '2026-09-22T00:00:00.000Z', validUntil: '2027-09-22T00:00:00.000Z',
    sensitivity: 'public', state: 'active',
  });
  db.exec(`CREATE TRIGGER fail_user_receipt BEFORE INSERT ON memory_user_revisions
    BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END`);
  assert.throws(() => host.reviseUserFact('personal', correction), {code: 'INVALID_ARGUMENT'});
  assert.equal(db.prepare('SELECT sequence FROM memory_namespaces WHERE namespace = ?')
    .get('personal').sequence, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_facts').get().count, 1);
  db.exec('DROP TRIGGER fail_user_receipt');
  assert.equal(host.reviseUserFact('personal', correction).appended, true);
  assert.equal(db.prepare('SELECT sequence FROM memory_namespaces WHERE namespace = ?')
    .get('personal').sequence, 2);
  db.close();
  host.close();
});

test('unbound erasure purges user revision receipts with the fact', t => {
  const path = databasePath(t);
  const host = openSqliteMemoryHost(path);
  const db = new DatabaseSync(path);
  host.provision('personal');
  host.append('personal', version('preference', 1));
  host.reviseUserFact('personal', request({
    factId: 'preference', expectedRevision: 1, operationId: 'user-correction-erase',
    summary: 'Corrected preference', sourceRef: 'user-action-1',
    observedAt: '2026-09-22T08:00:00.000Z',
    validFrom: '2026-09-22T00:00:00.000Z', validUntil: '2027-09-22T00:00:00.000Z',
    sensitivity: 'public', state: 'active',
  }));
  host.eraseUnboundFact('personal', request({
    factId: 'preference', expectedRevision: 2, operationId: 'erase-user-correction',
  }));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_user_revisions').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_facts').get().count, 0);
  db.close();
  host.close();
});
