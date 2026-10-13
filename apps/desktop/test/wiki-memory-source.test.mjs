import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';
import {parseWikiCitationReference} from '@personal-agent/knowledge/wiki';
import {createWikiSourceMonitor} from '@personal-agent/runtime/application';
import {createKnowledgeSourceConfig} from '../electron/knowledge-source-config.js';
import {createPrivateMemoryController} from '../electron/private-memory.js';

// Explicit native-decision/encryption Fakes; all files and facts are synthetic.
const safeStorage = {isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value),
  decryptString: value => value.toString()};
const scope = () => ({deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal});
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'pa-wiki-memory-'));
  const root = join(base, 'vault'), other = join(base, 'other'), userData = join(base, 'host');
  await mkdir(root); await mkdir(other); await mkdir(userData);
  const file = join(root, 'one.md'), database = join(base, 'memory.sqlite');
  await writeFile(file, '合成来源 hello original\n');
  let selected = root, allow = true, beforeConfirm = async () => {}, beforeConsume = async () => {}, prompts = 0;
  const options = {userData, safeStorage, namespace: 'synthetic-user', hostIdentity: 'synthetic-host',
    selectDirectory: async () => selected, selectNoteFiles: async () => [], confirmPermissions: async () => false};
  let host = await createKnowledgeSourceConfig(options);
  let controller;
  const observers = [];
  const open = () => controller = createPrivateMemoryController(database, async () => {
    prompts++; await beforeConfirm(); return allow;
  }, async () => true, {knowledgeSource: () => host,
    authorizeConsumption: async () => {await beforeConsume(); return true;}});
  open();
  t.after(async () => {controller.close(); for (const observer of observers) observer.close(); host.close(); await rm(base, {recursive: true, force: true});});
  await host.select();
  const search = async () => (await controller.search('hello')).hits[0].source;
  const save = async () => controller.save(await search(), '合成确认摘要');
  return {root, other, file, database, search, save, observe: () => {
    const memory = openSqliteMemoryHost(database); observers.push(memory); return memory;
  }, get host() {return host;}, get controller() {return controller;},
    get prompts() {return prompts;}, setAllow: value => {allow = value;},
    select: value => {selected = value;}, beforeConfirm: value => {beforeConfirm = value;},
    beforeConsume: value => {beforeConsume = value;}, async restart() {
      controller.close(); host.close(); host = await createKnowledgeSourceConfig(options); open();
    }};
}

test('deleting a private fact clears volatile source indexes and aborts already acquired source leases', async t => {
  const f = await fixture(t); await f.save();
  const ref = (await f.controller.listSaved()).facts[0].ref;
  const lease = f.host.acquireWiki(f.host.snapshot(), scope());
  try {
    assert.equal((await f.controller.delete(ref)).state, 'deleted');
    assert.equal(lease.signal.aborted, true);
    assert.throws(() => lease.assertCurrent(), /撤销/);
    await assert.rejects(lease.wiki.search({query: 'hello', limit: 5, ...scope()}), error => error.code === 'SCOPE_DENIED');
    // The selected original source remains readable under a fresh lease; erased memory stays absent.
    assert.ok(await f.search());
    assert.deepEqual((await f.controller.listSaved()).facts, []);
  } finally {lease.release();}
});

test('resident source checks invalidate edited facts without opening memory UI; scan failure retries and never imports new pages',async t=>{
  const f=await fixture(t);await f.save();const fact=(await f.controller.listSaved()).facts[0];
  const memory=f.observe();let failScan=false,failAfterProjection=false;
  const monitor=createWikiSourceMonitor({source:{snapshot:()=>f.host.snapshot(),acquireWiki(expected,request){
    const lease=f.host.acquireWiki(expected,request);
    return {...lease,wiki:{scanPages:async context=>{if(failScan)throw Error('synthetic scan failure');return lease.wiki.scanPages(context);}}};
  }},revalidate:async(input,request)=>{
    await f.controller.revalidateSources(input,request);
    if(failAfterProjection)throw Error('synthetic failure after SQLite commit');
  }});t.after(()=>monitor.close());
  await monitor.refresh(scope());assert.equal(memory.readUserFactHead('desktop-private',fact.ref.id).ref.revision,1);
  await writeFile(f.file,'hello updated synthetic\n');await writeFile(join(f.root,'new.md'),'hello new unconfirmed page\n');
  failScan=true;await monitor.refresh(scope());assert.equal(monitor.snapshot().state,'retry_pending');
  assert.equal(memory.readUserFactHead('desktop-private',fact.ref.id).state,'active');
  failScan=false;failAfterProjection=true;await monitor.refresh(scope());
  assert.equal(monitor.snapshot().state,'retry_pending');
  const head=memory.readUserFactHead('desktop-private',fact.ref.id);
  assert.equal(head.state,'withdrawn');assert.equal(head.ref.revision,2);assert.equal(head.summary,fact.summary);
  failAfterProjection=false;await monitor.refresh(scope());assert.equal(monitor.snapshot().state,'ready');
  await monitor.refresh(scope());assert.equal(memory.readUserFactHead('desktop-private',fact.ref.id).ref.revision,2);
  assert.equal((await memory.listUserFactHeads('desktop-private',{at:new Date().toISOString(),limit:20,...scope()})).facts.length,1);
  assert.equal(monitor.snapshot().pageCount,2);assert.equal(f.prompts,1);
});

test('resident missing/empty scan preserves confirmed history and stays pending instead of inferring deletion',async t=>{
  const f=await fixture(t);await f.save();const fact=(await f.controller.listSaved()).facts[0],memory=f.observe();
  const monitor=createWikiSourceMonitor({source:f.host,revalidate:(input,request)=>f.controller.revalidateSources(input,request)});
  t.after(()=>monitor.close());await monitor.refresh(scope());await rm(f.file);
  await monitor.refresh(scope());assert.equal(monitor.snapshot().state,'retry_pending');assert.equal(monitor.snapshot().pageCount,1);
  assert.deepEqual(memory.readUserFactHead('desktop-private',fact.ref.id),fact);
  await writeFile(f.file,'hello restored new native identity\n');await monitor.refresh(scope());
  assert.equal(memory.readUserFactHead('desktop-private',fact.ref.id).state,'withdrawn');assert.equal(monitor.snapshot().state,'ready');
});

test('unified host leases require confirmation; renewed/restarted reads do not duplicate facts', async t => {
  const f = await fixture(t), original = await readFile(f.file);
  assert.equal(f.controller.selected, true);
  await assert.rejects(f.controller.selectVault(f.other), /统一知识源/);
  const source = await f.search(), preview = await f.controller.previewSave(source);
  assert.equal(source.sourceId, f.host.snapshot().sourceId);
  assert.ok(source.pageId); assert.equal(preview.expectedRevision, null);
  f.setAllow(false); assert.deepEqual(await f.controller.save(source, '合成确认摘要', preview), {state: 'declined'});
  assert.equal((await f.controller.listSaved()).facts.length, 0);
  f.setAllow(true); assert.deepEqual(await f.controller.save(source, '合成确认摘要', preview), {state: 'saved', revision: 1});
  const fact = (await f.controller.listSaved()).facts[0];
  assert.equal(parseWikiCitationReference(fact.sourceRef).pageId, source.pageId);
  assert.deepEqual(await f.save(), {state: 'unchanged', revision: 1});
  await f.restart(); assert.equal(f.controller.selected, true);
  assert.deepEqual(await f.save(), {state: 'unchanged', revision: 1});
  assert.equal(f.prompts, 2); assert.deepEqual(await readFile(f.file), original);
  const lease = f.host.acquireWiki(f.host.snapshot(), scope());
  await lease.wiki.readReference({source: parseWikiCitationReference(fact.sourceRef), ...scope()});
  lease.release();
  await assert.rejects(lease.wiki.readReference({source: parseWikiCitationReference(fact.sourceRef), ...scope()}), {code: 'SCOPE_DENIED'});
});

test('edited source withdraws only its confirmed projection, remains manageable, and needs new confirmation', async t => {
  const f = await fixture(t); await f.save();
  const original = (await f.controller.listSaved()).facts[0];
  const memory = f.observe();
  const query = memory.bind('desktop-private', {allowedSensitivities: ['private']});
  const feed = memory.bindFeed('desktop-private', {consumerId: 'explicit-synthetic-test', allowedSensitivities: ['private']});
  const first = await feed.read({...scope(), limit: 20});
  memory.confirmFeedBatch('desktop-private', 'explicit-synthetic-test', {...scope(), batchToken: first.batchToken,
    expectedCheckpoint: first.baseCheckpoint, handled: first.entries});
  await writeFile(f.file, '合成来源 hello updated\n');
  const page = await f.controller.listSaved(), withdrawn = page.facts[0];
  assert.equal(withdrawn.ref.id, original.ref.id); assert.equal(withdrawn.ref.revision, 2);
  assert.equal(withdrawn.state, 'withdrawn'); assert.equal(withdrawn.confirmation, 'external_observation');
  assert.equal(withdrawn.summary, original.summary); assert.equal(withdrawn.sourceRef, original.sourceRef);
  assert.equal((await query.listCurrent({...scope(), at: new Date().toISOString(), limit: 20})).facts.length, 0);
  assert.equal((await f.controller.revalidate(withdrawn.ref)).appended, false);
  const change = await feed.read({...scope(), limit: 20});
  assert.deepEqual(change.entries.map(entry => entry.fact), [withdrawn.ref]);
  memory.confirmFeedBatch('desktop-private', 'explicit-synthetic-test', {...scope(), batchToken: change.batchToken,
    expectedCheckpoint: change.baseCheckpoint, handled: change.entries});
  assert.equal((await feed.read({...scope(), limit: 20})).entries.length, 0);
  f.setAllow(false); assert.equal((await f.save()).state, 'declined');
  f.setAllow(true); assert.deepEqual(await f.save(), {state: 'saved', revision: 3});
  assert.equal((await f.controller.listSaved()).facts[0].ref.id, original.ref.id);
  assert.equal((await query.listHistory({...scope(), factId: original.ref.id, limit: 20})).facts.length, 3);
});

test('same-file move invalidates old location; missing file and empty scan do not infer deletion', async t => {
  const f = await fixture(t); await f.save();
  const original = (await f.controller.listSaved()).facts[0];
  const moved = join(f.root, 'moved.md'); await rename(f.file, moved);
  assert.equal((await f.controller.revalidate(original.ref)).state, 'withdrawn');
  assert.deepEqual(await f.save(), {state: 'saved', revision: 3});
  const current = (await f.controller.listSaved()).facts[0];
  assert.equal(current.ref.id, original.ref.id);
  await rename(moved, join(f.other, 'retained.md'));
  const absent = await f.controller.revalidate(current.ref);
  assert.equal(absent.state, 'source_unavailable'); assert.equal(absent.appended, false);
  assert.deepEqual((await f.controller.listSaved()).facts[0].ref, current.ref);
});

test('changing source configuration during native confirmation prevents saving', async t => {
  const f = await fixture(t), source = await f.search();
  f.beforeConfirm(async () => {f.select(f.other); await f.host.select();});
  await assert.rejects(f.controller.save(source, '合成确认摘要'), /变化|撤销/);
  assert.equal((await f.controller.listSaved()).facts.length, 0);
  await assert.rejects(f.controller.previewSave(source));
  await f.host.revoke(); assert.equal(f.controller.selected, false);
  assert.throws(() => f.controller.search('hello'));
});

test('body changes during native save/consumption approval never grant stale data', async t => {
  const f = await fixture(t), source = await f.search();
  f.beforeConfirm(async () => writeFile(f.file, '合成来源 hello changed during save\n'));
  await assert.rejects(f.controller.save(source, '合成确认摘要'), {code: 'SOURCE_CHANGED'});
  assert.equal((await f.controller.listSaved()).facts.length, 0);
  f.beforeConfirm(async () => {}); await f.save();
  const ref = (await f.controller.listSaved()).facts[0].ref;
  f.beforeConsume(async () => writeFile(f.file, '合成来源 hello changed during consume\n'));
  await assert.rejects(f.controller.consumeConfirmed({refs: [ref], taskId: 'synthetic-task', destination: 'local',
    configurationRef: 'synthetic', ...scope()}), /来源已变化|版本已变化/);
  assert.equal((await f.controller.listSaved()).facts[0].state, 'withdrawn');
});

test('source-invalidated heads remain discoverable for physical deletion after restart', async t => {
  const f = await fixture(t); await f.save();
  await writeFile(f.file, '合成来源 hello changed\n');
  const withdrawn = (await f.controller.listSaved()).facts[0];
  await f.restart();
  assert.deepEqual((await f.controller.listSaved()).facts[0].ref, withdrawn.ref);
  assert.deepEqual(await f.controller.delete(withdrawn.ref), {state: 'deleted'});
  assert.equal((await f.controller.listSaved()).facts.length, 0);
});
