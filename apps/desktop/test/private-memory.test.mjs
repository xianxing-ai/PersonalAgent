import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';
import {createPrivateMemoryController} from '../electron/private-memory.js';

test('withdrawn private heads remain manageable after restart without becoming consumable', async t => {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-private-withdrawn-'));
  const root = join(base, 'vault');
  const database = join(base, 'private.sqlite');
  await mkdir(root);
  await writeFile(join(root, 'first.md'), '合成测试：待撤回。\n');
  await writeFile(join(root, 'second.md'), '合成测试：保留。\n');
  let controller = createPrivateMemoryController(database, async () => true, async () => true,
    {confirmWithdraw: async () => true});
  t.after(async () => {controller.close(); await rm(base, {recursive: true, force: true});});
  await controller.selectVault(root);
  const source = (await controller.search('待撤回')).hits[0].source;
  await controller.save(source, '合成原摘要');
  await controller.save(source, '合成更正摘要');
  await controller.save((await controller.search('保留')).hits[0].source, '合成保留摘要');
  const ref = (await controller.listSaved()).facts.find(fact => fact.summary === '合成更正摘要').ref;
  assert.deepEqual(await controller.withdraw(ref), {state: 'withdrawn', revision: 3});
  controller.close();
  controller = createPrivateMemoryController(database, async () => false, async () => true);
  assert.equal(controller.selected, false);
  const page = await controller.listSaved();
  const withdrawn = page.facts.find(fact => fact.ref.id === ref.id);
  assert.ok(withdrawn, 'withdrawn head must remain discoverable for deletion');
  assert.equal(withdrawn.state, 'withdrawn');
  assert.equal(withdrawn.ref.revision, 3);
  assert.equal(withdrawn.summary, '用户已撤回此私人记忆');
  const memory = openSqliteMemoryHost(database);
  try {
    const query = memory.bind('desktop-private', {allowedSensitivities: ['private']});
    const scope = () => ({deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal});
    assert.deepEqual((await query.listCurrent({at: new Date().toISOString(), limit: 20, ...scope()}))
      .facts.map(fact => fact.summary), ['合成保留摘要']);
    await assert.rejects(controller.delete(ref), /记忆版本已变化/);
    assert.deepEqual(await controller.delete(withdrawn.ref), {state: 'deleted'});
    assert.equal(memory.readUserFactHead('desktop-private', ref.id), undefined);
    assert.equal((await controller.listSaved()).facts[0].summary, '合成保留摘要');
  } finally {memory.close();}
  controller.close();
  controller = createPrivateMemoryController(database, async () => false);
  assert.deepEqual((await controller.listSaved()).facts.map(fact => fact.summary), ['合成保留摘要']);
});

test('admin confirmation is required for each private citation and correction', async t => {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-private-admin-'));
  const root = join(base, 'vault');
  const file = join(root, 'note.md');
  const database = join(base, 'private.sqlite');
  await mkdir(root);
  await writeFile(file, '合成偏好：周一查看计划。\n', 'utf8');
  let allow = false;
  const prompts = [];
  let controller = createPrivateMemoryController(database, async details => {
    prompts.push(details);
    return allow;
  });
  t.after(async () => { controller.close(); await rm(base, {recursive: true, force: true}); });

  assert.throws(() => controller.search('合成偏好'), /选择本机 Vault/);
  await controller.selectVault(root);
  const source = (await controller.search('合成偏好')).hits[0].source;
  assert.deepEqual(await controller.save(source, '周一查看计划'), {state: 'declined'});
  const memory = openSqliteMemoryHost(database);
  const query = context => memory.bind('desktop-private', {allowedSensitivities: ['private']})
    .listCurrent({at: new Date().toISOString(), limit: 5, ...context});
  const context = () => ({deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal});
  assert.equal((await query(context())).facts.length, 0);
  allow = true;
  assert.deepEqual(await controller.save(source, '周一查看计划'), {state: 'saved', revision: 1});
  assert.equal((await query(context())).facts[0].summary, '周一查看计划');
  assert.equal((await memory.bind('desktop-private', {allowedSensitivities: ['public']})
    .listCurrent({at: new Date().toISOString(), limit: 5, ...context()})).facts.length, 0);
  assert.deepEqual(await controller.save(source, '周一查看计划'), {state: 'unchanged', revision: 1});
  assert.deepEqual(await controller.save(source, '周一先查看计划'), {state: 'saved', revision: 2});
  assert.equal(prompts.length, 3);
  assert.equal(prompts[2].previous, '周一查看计划');
  assert.equal((await query(context())).facts[0].summary, '周一先查看计划');
  memory.close();

  controller.close();
  controller = createPrivateMemoryController(database, async () => false);
  await controller.selectVault(root);
  assert.deepEqual(await controller.save(source, '周一先查看计划'), {state: 'unchanged', revision: 2});
  await writeFile(file, '合成偏好：周二查看计划。\n', 'utf8');
  await assert.rejects(controller.save(source, '周二查看计划'), {code: 'SOURCE_CHANGED'});
  await assert.rejects(controller.save(source, '周一先查看计划'), {code: 'SOURCE_CHANGED'});
  const reopened = openSqliteMemoryHost(database);
  assert.equal((await reopened.bind('desktop-private', {allowedSensitivities: ['private']})
    .listCurrent({at: new Date().toISOString(), limit: 5, ...context()})).facts[0].ref.revision, 2);
  reopened.close();
});

test('private deletion needs fresh native confirmation and removes only the selected fact history', async t => {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-private-delete-'));
  const root = join(base, 'vault');
  const database = join(base, 'private.sqlite');
  await mkdir(root);
  await writeFile(join(root, 'first.md'), '合成偏好：周一查看计划。\n');
  await writeFile(join(root, 'second.md'), '合成偏好：周二查看计划。\n');
  for (let index = 0; index < 20; index += 1) {
    await writeFile(join(root, `extra-${index}.md`),
      `合成记录-${String(index).padStart(2, '0')}-：独立条目。\n`);
  }
  let allowDelete = false;
  let deletePrompts = 0;
  const controller = createPrivateMemoryController(database, async () => true, async () => {
    deletePrompts += 1;
    return allowDelete;
  });
  t.after(async () => { controller.close(); await rm(base, {recursive: true, force: true}); });
  assert.deepEqual((await controller.listSaved()).facts, []);
  await controller.selectVault(root);
  const hits = (await controller.search('合成偏好')).hits;
  assert.equal(hits.length, 2);
  await controller.save(hits[0].source, '首次摘要');
  await controller.save(hits[0].source, '更正摘要');
  await controller.save(hits[1].source, '保留摘要');
  const before = await controller.listSaved();
  const target = before.facts.find(fact => fact.summary === '更正摘要');
  assert.equal(target.ref.revision, 2);
  await assert.rejects(controller.delete({id: target.ref.id, revision: 1}), /版本已变化/);
  assert.deepEqual(await controller.delete(target.ref), {state: 'declined'});
  assert.equal(deletePrompts, 1);
  assert.equal((await controller.listSaved()).facts.length, 2);
  allowDelete = true;
  assert.deepEqual(await controller.delete(target.ref), {state: 'deleted'});
  assert.equal(deletePrompts, 2);
  await assert.rejects(controller.save(hits[0].source, '不应自动重新导入'), {code: 'SCOPE_DENIED'});
  const memory = openSqliteMemoryHost(database);
  try {
    const query = memory.bind('desktop-private', {allowedSensitivities: ['private']});
    const context = () => ({deadline: new Date(Date.now() + 60_000).toISOString(),
      signal: new AbortController().signal});
    assert.deepEqual((await query.listHistory({factId: target.ref.id, limit: 20, ...context()})).facts, []);
    await assert.rejects(query.getVersion({fact: {id: target.ref.id, revision: 1}, ...context()}),
      {code: 'SCOPE_DENIED'});
    await assert.rejects(query.getVersion({fact: target.ref, ...context()}), {code: 'SCOPE_DENIED'});
    assert.deepEqual((await controller.listSaved()).facts.map(fact => fact.summary), ['保留摘要']);
    await assert.rejects(query.listCurrent({at: before.at, limit: 20,
      snapshot: before.snapshot, ...context()}), {code: 'INVALID_ARGUMENT'});
  } finally { memory.close(); }
  for (let index = 0; index < 20; index += 1) {
    const source = (await controller.search(`合成记录-${String(index).padStart(2, '0')}-`)).hits[0].source;
    await controller.save(source, `独立摘要${index}`);
  }
  const firstPage = await controller.listSaved();
  assert.equal(firstPage.facts.length, 20);
  assert.ok(firstPage.nextCursor);
  const secondPage = await controller.listSaved({at: firstPage.at,
    snapshot: firstPage.snapshot, cursor: firstPage.nextCursor});
  assert.equal(secondPage.facts.length, 1);
  assert.equal(secondPage.nextCursor, undefined);
});

test('private controller resumes a committed deletion after a blocked checkpoint and restart', async t => {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-private-recover-'));
  const root = join(base, 'vault');
  const database = join(base, 'private.sqlite');
  await mkdir(root);
  await writeFile(join(root, 'note.md'), '合成偏好：先查看计划。\n');
  let controller = createPrivateMemoryController(database, async () => true, async () => true);
  let reader;
  let reading = false;
  t.after(async () => {
    if (reading) reader.exec('ROLLBACK');
    reader?.close();
    controller.close();
    await rm(base, {recursive: true, force: true});
  });
  await controller.selectVault(root);
  const source = (await controller.search('合成偏好')).hits[0].source;
  await controller.save(source, '先查看计划');
  const ref = (await controller.listSaved()).facts[0].ref;
  reader = new DatabaseSync(database);
  reader.exec('BEGIN');
  reading = true;
  reader.prepare('SELECT count(*) AS total FROM memory_facts').get();
  await assert.rejects(controller.delete(ref), {code: 'STORAGE_UNAVAILABLE'});
  controller.close();
  controller = createPrivateMemoryController(database, async () => false);
  await assert.rejects(controller.listSaved(), {code: 'STORAGE_UNAVAILABLE'});
  reader.exec('ROLLBACK');
  reading = false;
  assert.deepEqual((await controller.listSaved()).facts, []);
});
