import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {KnowledgeError} from '@personal-agent/knowledge';
import {createObsidianVaultPort} from '@personal-agent/knowledge/obsidian';
import {createObsidianPairingPeer} from '@personal-agent/knowledge/pairing';
import {createObsidianPairingHost} from '@personal-agent/runtime/application';
import {createKnowledgeSourceConfig} from '../electron/knowledge-source-config.js';
import {createPrivateMemoryController} from '../electron/private-memory.js';

const scope = (ms = 30000) => ({deadline: new Date(Date.now() + ms).toISOString(), signal: new AbortController().signal});
async function fixture(t) {
  const parent = path.resolve('.cache/paired-citation-tests'); mkdirSync(parent, {recursive: true});
  const base = mkdtempSync(path.join(parent, 'case-')), root = path.join(base, 'Vault');
  mkdirSync(path.join(root, 'Allowed'), {recursive: true});
  writeFileSync(path.join(root, 'Allowed/note.md'), 'synthetic target\n');
  writeFileSync(path.join(root, 'Allowed/keep.md'), 'synthetic unrelated\n');
  writeFileSync(path.join(root, 'outside.md'), 'synthetic outside\n');
  const files = ['Allowed/note.md', 'Allowed/keep.md', 'outside.md'].map(p => ({path: p,
    get stat() {const s = statSync(path.join(root, p)); return {mtime: s.mtimeMs, size: s.size};}}));
  const vault = {getMarkdownFiles: () => files, getAbstractFileByPath: p => files.find(f => f.path === p),
    read: async file => readFileSync(path.join(root, file.path), 'utf8')};
  const source = await createKnowledgeSourceConfig({userData: path.join(base, 'settings'), namespace: 'desktop-private',
    hostIdentity: 'synthetic', selectDirectory: async () => root, selectNoteFiles: async () => [],
    safeStorage: {isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString()}});
  await source.select();
  const original = source.snapshot(), pages = [], peers = [];
  const trusted = {snapshot: () => source.snapshot(), acquire(expected, signal) {
    const lease = source.acquire(expected, signal), read = lease.read;
    return {...lease, read: {search: async () => {throw Error('File search fallback forbidden');},
      readPage: async request => {pages.push(request.path); return read.readPage(request);}}};
  }};
  let host = createObsidianPairingHost({source: trusted, vaultIdentity: () => source.pairingIdentity(), confirmPairing: async () => true});
  const peer = () => {
    const port = createObsidianVaultPort({vaultId: 'b'.repeat(64), allowedFolder: 'Allowed', vault});
    const next = createObsidianPairingPeer({port, vaultId: 'b'.repeat(64), folder: 'Allowed',
      vaultIdentity: source.pairingIdentity(), bindingCurrent: () => true}); peers.push(next); return next;
  };
  let currentPeer = peer(); await host.pair(currentPeer, scope());
  let decision = async () => true, confirmations = 0, consumptions = 0;
  const database = path.join(base, 'private.sqlite');
  const controller = () => createPrivateMemoryController(database, async details => {confirmations++; return decision(details);},
    async () => true, {confirmWithdraw: async () => true, knowledgeSource: () => host.wikiSource,
      authorizeConsumption: async () => {consumptions++; return true;}});
  let memory = controller();
  t.after(() => {memory.close(); host.close(); source.close(); for (const p of peers) p.close(); rmSync(base, {recursive: true, force: true});});
  return {source, original, root, base, database, pages, get memory() {return memory;}, get host() {return host;},
    get peer() {return currentPeer;}, get confirmations() {return confirmations;}, decide: fn => {decision = fn;},
    get consumptions() {return consumptions;},
    async restart(repair = false) {
      memory.close(); host.close();
      host = createObsidianPairingHost({source: trusted, vaultIdentity: () => source.pairingIdentity(), confirmPairing: async () => true});
      memory = controller();
      if (repair) {currentPeer = peer(); await host.pair(currentPeer, scope());}
    }};
}

test('paired citation confirmation reuses stable Wiki identity, survives restart, and erases only its fact', async t => {
  const f = await fixture(t), memory = f.memory;
  const source = (await memory.search('target')).hits[0].source;
  assert.equal(source.sourceId, f.original.sourceId); assert.equal(source.dataLevel, 'private');
  assert.match(source.pageId, /^[a-f0-9]{64}$/);
  const preview = await memory.previewSave(source); assert.equal(preview.citation, 'synthetic target');
  f.decide(async () => false);
  assert.deepEqual(await memory.save(source, 'Synthetic A', preview), {state: 'declined'});
  assert.equal((await memory.listSaved()).facts.length, 0);
  f.decide(async details => {assert.equal(details.citation, 'synthetic target'); assert.equal(details.signal.aborted, false); return true;});
  assert.deepEqual(await memory.save(source, 'Synthetic A', preview), {state: 'saved', revision: 1});
  const confirmed = f.confirmations;
  assert.deepEqual(await memory.save(source, 'Synthetic A', await memory.previewSave(source)), {state: 'unchanged', revision: 1});
  assert.equal(f.confirmations, confirmed);
  assert.deepEqual(await memory.save(source, 'Synthetic B', await memory.previewSave(source)), {state: 'saved', revision: 2});
  const keep = (await memory.search('unrelated')).hits[0].source;
  f.decide(async () => true);
  await memory.save(keep, 'Synthetic keep', await memory.previewSave(keep));
  const target = (await memory.listSaved()).facts.find(f => f.summary === 'Synthetic B').ref;
  const previousBinding = f.host.source.snapshot();
  const previousLease = f.host.source.acquire(previousBinding, new AbortController().signal);
  t.after(() => previousLease.release());
  await f.restart();
  assert.throws(previousLease.assertCurrent);
  assert.equal(f.memory.selected, false); assert.equal((await f.memory.listSaved()).facts.length, 2);
  await assert.rejects(async () => f.memory.search('target'));
  await f.restart(true);
  assert.notEqual(f.host.source.snapshot().sourceId, previousBinding.sourceId);
  assert.throws(() => f.host.source.acquire(previousBinding, new AbortController().signal));
  assert.equal((await f.memory.revalidate(target)).state, 'current');
  assert.deepEqual(await f.memory.withdraw(target), {state: 'withdrawn', revision: 3});
  assert.deepEqual(await f.memory.delete({id: target.id, revision: 3}), {state: 'deleted'});
  assert.deepEqual((await f.memory.listSaved()).facts.map(f => f.summary), ['Synthetic keep']);
  assert.ok(f.pages.every(p => p.startsWith('Allowed/')));
  assert.equal(readFileSync(path.join(f.root, 'outside.md'), 'utf8'), 'synthetic outside\n');
  assert.equal(readFileSync(path.join(f.root, 'Allowed/note.md'), 'utf8'), 'synthetic target\n');
});

test('native confirmation cannot save an edited, revoked, or replaced citation', async t => {
  for (const change of ['edit', 'revoke', 'source']) await t.test(change, async t => {
    const f = await fixture(t), source = (await f.memory.search('target')).hits[0].source;
    const preview = await f.memory.previewSave(source);
    f.decide(async () => {
      if (change === 'edit') writeFileSync(path.join(f.root, 'Allowed/note.md'), 'changed synthetic\n');
      if (change === 'revoke') f.host.revoke();
      if (change === 'source') await f.source.select();
      return true;
    });
    await assert.rejects(f.memory.save(source, 'Synthetic A', preview));
    assert.equal((await f.memory.listSaved()).facts.length, 0);
  });
});

test('unknown fields, out-of-folder paths and plugin/native disagreement cannot become confirmed facts', async t => {
  const f = await fixture(t), source = (await f.memory.search('target')).hits[0].source;
  for (const patch of [{extra: true}, {path: 'outside.md'}, {pageId: 'a'.repeat(64)}, {revision: 'c'.repeat(64)}, {dataLevel: 'public'}]) {
    await assert.rejects(f.memory.previewSave({...source, ...patch}));
  }
  f.peer.readCitation = async () => 'plugin substitution';
  await assert.rejects(f.memory.save(source, 'Synthetic A'), error => error.code === 'SOURCE_UNAVAILABLE');
  assert.equal(f.confirmations, 0); assert.equal((await f.memory.listSaved()).facts.length, 0);
});

test('cancelled and expired citation leases reject late peer results; old search-only peers stay unavailable', async t => {
  const f = await fixture(t), source = (await f.memory.search('target')).hits[0].source;
  let finish, begin; const began = new Promise(resolve => {begin = resolve;});
  f.peer.readCitation = async () => {begin(); return new Promise(resolve => {finish = resolve;});};
  const controller = new AbortController(), request = {...scope(), signal: controller.signal};
  const lease = f.host.wikiSource.acquireWiki(source, request); t.after(() => lease.release());
  await assert.rejects(lease.wiki.readCitation({source: {...source, validUntil: new Date(Date.now() - 1).toISOString()}, ...request}));
  const reading = lease.wiki.readCitation({source: {...source, validUntil: request.deadline}, ...request}); const rejected = assert.rejects(reading);
  await Promise.race([began, reading.then(() => assert.fail('Citation must wait for peer'))]);
  controller.abort(); await rejected; finish('synthetic target');
  await assert.rejects(lease.wiki.readCitation({source, ...scope()}));
  delete f.peer.readCitation;
  assert.equal(f.host.wikiSource.snapshot().available, false);
  await assert.rejects(async () => f.memory.search('target'));
});

test('a changed saved source withdraws its fact, while a missing peer leaves evidence unavailable', async t => {
  const f = await fixture(t), source = (await f.memory.search('target')).hits[0].source;
  await f.memory.save(source, 'Synthetic A', await f.memory.previewSave(source));
  const ref = (await f.memory.listSaved()).facts[0].ref;
  f.peer.readCitation = async () => 'plugin substitution';
  assert.equal((await f.memory.revalidate(ref)).state, 'source_unavailable', 'untrusted substitutions cannot withdraw confirmed history');
  f.peer.readCitation = async () => {throw new KnowledgeError('SOURCE_UNAVAILABLE');};
  assert.equal((await f.memory.revalidate(ref)).state, 'source_unavailable');
  f.peer.readCitation = async () => {throw new KnowledgeError('SOURCE_CHANGED');};
  assert.equal((await f.memory.revalidate(ref)).state, 'source_unavailable', 'plugin cannot self-report authoritative fact withdrawal');
  writeFileSync(path.join(f.root, 'Allowed/note.md'), 'changed synthetic\n');
  assert.equal((await f.memory.revalidate(ref)).state, 'withdrawn');
  assert.equal((await f.memory.listSaved()).facts[0].ref.revision, 2);
});

test('re-pairing after an offline edit withdraws only the old fact and blocks consumption before authorization', async t => {
  const f = await fixture(t), source = (await f.memory.search('target')).hits[0].source;
  await f.memory.save(source, 'Synthetic A', await f.memory.previewSave(source));
  const keep = (await f.memory.search('unrelated')).hits[0].source;
  await f.memory.save(keep, 'Synthetic keep', await f.memory.previewSave(keep));
  const saved = (await f.memory.listSaved()).facts, target = saved.find(fact => fact.summary === 'Synthetic A');
  const preserved = saved.find(fact => fact.summary === 'Synthetic keep');
  await f.restart();
  writeFileSync(path.join(f.root, 'Allowed/note.md'), 'changed synthetic\n');
  await assert.rejects(f.memory.revalidate(target.ref));
  assert.deepEqual((await f.memory.listSaved()).facts, saved, 'disconnect does not infer a changed fact');
  await f.restart(true);
  const invalidated = await f.memory.revalidate(target.ref);
  assert.equal(invalidated.state, 'withdrawn'); assert.equal(invalidated.appended, true);
  assert.equal(invalidated.fact.ref.revision, 2);
  await assert.rejects(f.memory.consumeConfirmed({refs: [target.ref], taskId: 'synthetic-stale',
    destination: 'agentarts', configurationRef: 'synthetic-only', ...scope()}));
  await assert.rejects(f.memory.consumeConfirmed({refs: [invalidated.fact.ref], taskId: 'synthetic-withdrawn',
    destination: 'agentarts', configurationRef: 'synthetic-only', ...scope()}));
  await assert.rejects(f.memory.previewSave(source));
  assert.equal(f.consumptions, 0); assert.equal(f.confirmations, 2, 'source observations never confirm new content');
  const final = (await f.memory.listSaved()).facts;
  assert.equal(final.length, 2); assert.equal(final.find(fact => fact.ref.id === target.ref.id).state, 'withdrawn');
  assert.deepEqual(final.find(fact => fact.ref.id === preserved.ref.id), preserved);
  assert.equal((await f.memory.revalidate(invalidated.fact.ref)).appended, false);
});

for (const change of ['rename', 'outside', 'missing']) test(`re-paired ${change} source remains unavailable until its original path is restored`, async t => {
  const f = await fixture(t), source = (await f.memory.search('target')).hits[0].source;
  await f.memory.save(source, 'Synthetic A', await f.memory.previewSave(source));
  const keep = (await f.memory.search('unrelated')).hits[0].source;
  await f.memory.save(keep, 'Synthetic keep', await f.memory.previewSave(keep));
  const saved = (await f.memory.listSaved()).facts, target = saved.find(fact => fact.summary === 'Synthetic A');
  const preserved = saved.find(fact => fact.summary === 'Synthetic keep');
  const from = path.join(f.root, 'Allowed/note.md');
  const moved = change === 'rename' ? path.join(f.root, 'Allowed/renamed.md')
    : change === 'outside' ? path.join(f.root, 'outside-note.md') : path.join(f.base, 'held-note.md');
  await f.restart(); renameSync(from, moved); await f.restart(true);
  const unavailable = await f.memory.revalidate(target.ref);
  assert.equal(unavailable.state, 'source_unavailable'); assert.equal(unavailable.appended, false);
  await assert.rejects(f.memory.consumeConfirmed({refs: [target.ref], taskId: 'synthetic-unavailable',
    destination: 'agentarts', configurationRef: 'synthetic-only', ...scope()}));
  await assert.rejects(f.memory.previewSave(source));
  assert.equal(f.consumptions, 0); assert.deepEqual((await f.memory.listSaved()).facts, saved);
  const allowed = await f.memory.consumeConfirmed({refs: [preserved.ref], taskId: 'synthetic-preserved',
    destination: 'agentarts', configurationRef: 'synthetic-only', ...scope()});
  assert.equal(allowed.state, 'authorized'); assert.deepEqual(allowed.facts, [{ref: preserved.ref, summary: preserved.summary}]);
  renameSync(moved, from);
  assert.equal((await f.memory.revalidate(target.ref)).state, 'current');
  assert.deepEqual((await f.memory.listSaved()).facts, saved, 'temporary absence is not a deletion or new revision');
  assert.equal(f.confirmations, 2);
});
