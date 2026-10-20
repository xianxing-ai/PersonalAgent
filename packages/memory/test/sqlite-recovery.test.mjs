import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {FactChangeFeedError} from '../dist/index.js';
import {openSqliteMemoryHost, SqliteMemoryHost} from '../dist/sqlite.js';

const request = extra => ({
  deadline: '2099-01-01T00:00:00.000Z', signal: new AbortController().signal, ...extra,
});
const binding = {consumerId: 'cognition', allowedSensitivities: ['public']};
const confirmation = batch => request({
  batchToken: batch.batchToken, expectedCheckpoint: batch.baseCheckpoint, handled: batch.entries,
});

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'memory-recovery-'));
  const path = join(directory, 'memory.sqlite');
  const state = {path, host: openSqliteMemoryHost(path)};
  t.after(() => { state.host.close(); rmSync(directory, {recursive: true, force: true}); });
  state.host.provision('personal');
  state.host.append('personal', {
    ref: {id: 'meeting', revision: 1}, summary: 'Synthetic meeting',
    sourceRef: 'test-fixture', observedAt: '2026-09-22T07:00:00.000Z',
    validFrom: '2026-09-22T00:00:00.000Z', validUntil: '2027-09-22T00:00:00.000Z',
    sensitivity: 'public', state: 'active', confirmation: 'user_confirmed',
  });
  const feed = state.host.bindFeed('personal', binding);
  return {state, feed, batch: await feed.read(request({limit: 10}))};
}

function waitForWriterLock(writer) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      writer.removeListener('message', onMessage);
      writer.removeListener('exit', onExit);
      writer.removeListener('error', onError);
      if (error) reject(error); else resolve();
    };
    const onMessage = message => finish(message === 'locked' ? undefined : new Error('Writer lock setup returned an unexpected message'));
    const onExit = (code, signal) => finish(new Error(`Writer lock setup exited before acquiring the lock (code=${code}, signal=${signal})`));
    const onError = error => finish(new Error('Writer lock setup process failed', {cause: error}));
    const timer = setTimeout(() => finish(new Error('Writer lock setup did not acquire the lock within 8000ms')), 8000);
    writer.once('message', onMessage);
    writer.once('exit', onExit);
    writer.once('error', onError);
  });
}

async function withWriterLock(path, action) {
  const writer = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {DatabaseSync} from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA busy_timeout = 2000');
    db.exec('BEGIN IMMEDIATE');
    process.on('message', () => setTimeout(() => {
      db.exec('ROLLBACK');
      db.close();
      process.disconnect();
    }, 350));
    process.send('locked');
  `, path], {stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true});
  const closed = new Promise(resolve => writer.once('close', (code, signal) => resolve([code, signal])));
  try {
    await waitForWriterLock(writer);
    writer.send('release');
    await action(new Date(Date.now() + 100).toISOString());
    assert.deepEqual(await closed, [0, null]);
  } finally {
    if (writer.exitCode === null && writer.signalCode === null && writer.pid !== undefined) writer.kill();
    await closed;
  }
}

test('writer lock setup reports an early child exit instead of waiting for the test timeout', {timeout: 10000}, async () => {
  const writer = spawn(process.execPath, ['--eval', 'process.exit(23)'],
    {stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true});
  const closed = new Promise(resolve => writer.once('close', resolve));
  try {
    await assert.rejects(waitForWriterLock(writer), /Writer lock setup exited before acquiring the lock \(code=23, signal=null\)/);
  } finally {
    if (writer.exitCode === null && writer.signalCode === null && writer.pid !== undefined) writer.kill();
    await closed;
  }
});

test('confirmation expires while waiting for a writer without consuming the batch', {timeout: 10000}, async t => {
  const {state, feed, batch} = await fixture(t);
  await withWriterLock(state.path, deadline => {
    assert.throws(() => state.host.confirmFeedBatch('personal', 'cognition', {
      ...confirmation(batch), deadline,
    }), error => error instanceof FactChangeFeedError && error.code === 'TIMEOUT');
  });
  assert.deepEqual(await feed.read(request({limit: 10})), batch);
});

test('expired feed read does not persist a stale delivery while waiting for a writer', {timeout: 10000}, async t => {
  const {state, feed, batch} = await fixture(t);
  state.host.confirmFeedBatch('personal', 'cognition', confirmation(batch));
  await withWriterLock(state.path, deadline => assert.rejects(
    feed.read(request({limit: 10, deadline})),
    error => error instanceof FactChangeFeedError && error.code === 'TIMEOUT',
  ));
  const memory = state.host.bind('personal', {allowedSensitivities: ['public']});
  const first = await memory.getVersion(request({fact: {id: 'meeting', revision: 1}}));
  state.host.append('personal', {...first, ref: {id: 'meeting', revision: 2}, corrects: first.ref});
  const change = await feed.read(request({limit: 10}));
  assert.deepEqual(change.entries.map(entry => entry.fact), [{id: 'meeting', revision: 2}]);
});

test('failed receipt write rolls back checkpoint and pending batch across restart', async t => {
  const {state, batch} = await fixture(t);
  const db = new DatabaseSync(state.path);
  db.exec(`CREATE TRIGGER reject_receipt BEFORE UPDATE ON memory_feed_deliveries
    BEGIN SELECT RAISE(ABORT, 'injected test failure'); END`);
  try {
    assert.throws(() => state.host.confirmFeedBatch('personal', 'cognition', confirmation(batch)),
      error => error instanceof FactChangeFeedError && !error.message.includes('injected'));
  } finally {
    db.exec('DROP TRIGGER reject_receipt');
    db.close();
  }
  state.host.close();
  state.host = openSqliteMemoryHost(state.path);
  const feed = state.host.bindFeed('personal', binding);
  assert.deepEqual(await feed.read(request({limit: 10})), batch);
  const receipt = state.host.confirmFeedBatch('personal', 'cognition', confirmation(batch));
  assert.deepEqual(state.host.confirmFeedBatch('personal', 'cognition', confirmation(batch)), receipt);
  assert.equal((await feed.read(request({limit: 10}))).mode, 'changes');
});

test('cancellation before commit rolls back the written checkpoint and receipt', async t => {
  const {state, batch} = await fixture(t);
  state.host.close();
  const db = new DatabaseSync(state.path);
  state.host = new SqliteMemoryHost(db);
  const controller = new AbortController();
  db.function('cancel_confirmation', () => { controller.abort(); return 0; });
  db.exec(`CREATE TEMP TRIGGER cancel_receipt AFTER UPDATE ON memory_feed_deliveries
    BEGIN SELECT cancel_confirmation(); END`);
  assert.throws(() => state.host.confirmFeedBatch('personal', 'cognition', {
    ...confirmation(batch), signal: controller.signal,
  }), error => error instanceof FactChangeFeedError && error.code === 'CANCELLED');
  db.exec('DROP TRIGGER cancel_receipt');
  const feed = state.host.bindFeed('personal', binding);
  assert.deepEqual(await feed.read(request({limit: 10})), batch);
  const receipt = state.host.confirmFeedBatch('personal', 'cognition', confirmation(batch));
  assert.deepEqual(state.host.confirmFeedBatch('personal', 'cognition', confirmation(batch)), receipt);
});
