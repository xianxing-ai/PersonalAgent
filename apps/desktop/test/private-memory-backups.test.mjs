import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, copyFile, rm, readFile, link} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {createPrivateMemoryController} from '../electron/private-memory.js';
import {createPrivateMemoryBackupHost} from '../electron/private-memory-backups.js';
import {createPrivateMemoryErasureHost} from '../electron/private-memory-erasure-host.js';

const scope = () => ({deadline: new Date(Date.now() + 60000).toISOString(), signal: new AbortController().signal});
async function fixture(t) {
  const parent = fileURLToPath(new URL('../../../.cache/private-backup-tests/', import.meta.url));
  await mkdir(parent, {recursive: true});
  const root = await mkdtemp(join(parent, 'case-'));
  const vault = join(root, 'vault'); await mkdir(vault);
  await writeFile(join(vault, 'a.md'), 'Synthetic target');
  await writeFile(join(vault, 'b.md'), 'Synthetic unrelated');
  const active = join(root, 'active.sqlite'), directory = join(root, 'private-memory-backups');
  let confirmations = 0;
  let memory = createPrivateMemoryController(active, async () => true, async () => {confirmations++; return true;});
  await memory.selectVault(vault);
  await memory.save((await memory.search('target')).hits[0].source, 'Target private summary');
  await memory.save((await memory.search('unrelated')).hits[0].source, 'Keep unrelated summary');
  const ref = (await memory.listSaved()).facts.find(f => f.summary.startsWith('Target')).ref;
  memory.close();
  await mkdir(directory);
  const copy = join(directory, 'first.sqlite'); await copyFile(active, copy);
  const reopen = () => {
    memory = createPrivateMemoryController(active, async () => false, async () => {confirmations++; return true;});
    const backups = createPrivateMemoryBackupHost({userData: root, privateMemory: memory});
    const erasure = createPrivateMemoryErasureHost({privateMemory: memory, backups,
      consumptionHost: {releaseTask() {}}, listBindings: () => ({items: []}), cancelTask() {},
      eraseTaskCopies: async () => {}, readCopyErasureReceipt: () => null});
    return {memory, backups, erasure};
  };
  t.after(async () => {memory.close(); await rm(root, {recursive: true, force: true});});
  return {root, copy, ref, reopen, get confirmations() {return confirmations;}};
}

test('erasure rewrites managed SQLite backups, keeps unrelated facts and survives restart/older-copy restoration', async t => {
  const f = await fixture(t), host = f.reopen();
  const older = join(f.root, 'older.sqlite'); await copyFile(f.copy, older);
  host.erasure.assertReady(host.backups.inventory());
  assert.equal((await host.erasure.erase(f.ref)).state, 'deleted');
  const read = () => {
    const db = new DatabaseSync(f.copy, {readOnly: true});
    try {
      assert.equal(db.prepare('SELECT 1 FROM memory_facts WHERE fact_id=?').get(f.ref.id), undefined);
      assert.ok(db.prepare("SELECT 1 FROM memory_facts WHERE json_extract(payload,'$.summary')='Keep unrelated summary'").get());
      assert.equal(db.prepare('PRAGMA freelist_count').get().freelist_count, 0);
    } finally {db.close();}
  };
  read();
  assert.ok(!(await readFile(f.copy)).includes(Buffer.from('Target private summary')));
  host.memory.close(); await copyFile(older, f.copy);
  const restarted = f.reopen();
  assert.equal((await restarted.erasure.reconcile()).state, 'reconciled'); read();
});

test('occupied or corrupt backup remains pending after source erasure, then exact retry completes', async t => {
  const f = await fixture(t), host = f.reopen();
  const reader = new DatabaseSync(f.copy);
  reader.exec('PRAGMA journal_mode=WAL; BEGIN; SELECT * FROM memory_facts;');
  try {
    const result = await host.erasure.erase(f.ref);
    assert.equal(result.state, 'pending'); assert.deepEqual(result.pendingBackupIds, ['first.sqlite']);
    assert.deepEqual((await host.memory.listSaved()).facts.map(f => f.summary), ['Keep unrelated summary']);
  } finally {reader.exec('ROLLBACK'); reader.close();}
  assert.equal((await host.erasure.reconcile()).state, 'reconciled');
  await writeFile(join(f.root, 'private-memory-backups', 'broken.sqlite'), 'not a database');
  assert.deepEqual((await host.erasure.reconcile()).pendingBackupIds, ['broken.sqlite']);
});

test('unknown inventory refuses before consent; whole-note recovery image is preserved and never reported purged', async t => {
  const f = await fixture(t), host = f.reopen();
  await writeFile(join(f.root, 'private-memory-backups', 'unknown.txt'), 'keep');
  await assert.rejects(host.erasure.erase(f.ref), /未知/); assert.equal(f.confirmations, 0);
  await rm(join(f.root, 'private-memory-backups', 'unknown.txt'));
  const folder = join(f.root, 'knowledge-recovery', 'a'.repeat(64)); await mkdir(folder, {recursive: true});
  const note = join(folder, 'b'.repeat(64) + '.knowledge-backup'); await writeFile(note, 'Target and unrelated original note');
  const helperCopy = join(folder, 'c'.repeat(32) + '-12345678-1234-1234-1234-123456789abc.bak');
  await writeFile(helperCopy, 'Original helper recovery bytes');
  // Actual companion helper naming: these are original receipts/locks, not erasable fact backups.
  for (const name of ['d'.repeat(32) + '.inflight', 'e'.repeat(64) + '.knowledge-operation.json.tmp',
    'f'.repeat(64) + '.knowledge-finalization.json']) await writeFile(join(folder, name), '{}');
  const result = await host.erasure.erase(f.ref);
  assert.equal(result.state, 'pending'); assert.equal(result.pendingBackupIds.length, 2);
  assert.equal(await readFile(note, 'utf8'), 'Target and unrelated original note');
  assert.equal(await readFile(helperCopy, 'utf8'), 'Original helper recovery bytes');
  assert.equal((await host.erasure.reconcile()).state, 'pending');
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(host.backups.reconcile({...scope(), signal: cancelled.signal}), /取消/);
});

test('missing registered backups remain unavailable across host restart; hard-linked copies refuse before consent', async t => {
  const f = await fixture(t), host = f.reopen();
  host.backups.inventory();
  await rm(f.copy);
  assert.deepEqual((await host.backups.reconcile(scope())).pendingBackupIds, ['inventory_unavailable']);
  host.memory.close();
  const restarted = f.reopen();
  await assert.rejects(restarted.erasure.erase(f.ref), /失联/); assert.equal(f.confirmations, 0);
  await link(join(f.root, 'active.sqlite'), f.copy);
  await assert.rejects(restarted.erasure.erase(f.ref), /身份/); assert.equal(f.confirmations, 0);
});
