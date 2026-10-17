import assert from 'node:assert/strict';
import {link, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createWikiPort, createUnavailableWikiPort, openReadOnlyWiki,
  formatWikiCitationReference, parseWikiCitationReference} from '@personal-agent/knowledge/wiki';
import {createFakeWikiPort} from '@personal-agent/knowledge/testing';

const context = patch => ({deadline: new Date(Date.now() + 30_000).toISOString(),
  signal: new AbortController().signal, ...patch});
const binding = patch => ({sourceId: 'synthetic-source', namespace: 'synthetic-user', configRevision: 1,
  validUntil: new Date(Date.now() + 60_000).toISOString(),
  dataLevel: 'private', vaultId: 'synthetic-vault', isCurrent: () => true, ...patch});
const search = wiki => wiki.search({query: 'hello', limit: 20, ...context()});

test('durable references need a fresh grant and do not change when read leases renew', async () => {
  const initial = binding();
  const make = patch => createFakeWikiPort({...initial, ...patch, documents: [{path: 'one.md', content: 'hello world'}]});
  const source = (await search(make())).hits[0].source;
  const value = formatWikiCitationReference(source);
  assert.equal(value.includes('validUntil'), false);
  assert.equal(formatWikiCitationReference({...source, validUntil: new Date(0).toISOString()}), value);
  const renewed = make({validUntil: new Date(Date.now() + 120_000).toISOString()});
  assert.equal(await renewed.readCitation({source, ...context()}), 'hello world');
  assert.equal(await renewed.readReference({source: parseWikiCitationReference(value), ...context()}), 'hello world');
  await assert.rejects(make({isCurrent: () => false}).readReference({source: parseWikiCitationReference(value), ...context()}), {code: 'SCOPE_DENIED'});
  await assert.rejects(make({validUntil: new Date(0).toISOString()}).readReference({source: parseWikiCitationReference(value), ...context()}), {code: 'SCOPE_DENIED'});
  assert.equal(parseWikiCitationReference('legacy/path'), undefined);
  for (const invalid of ['wiki-v1:null', 'wiki-v1:{}', 'wiki-v1:[]', 'wiki-v1:{',
    'wiki-v1:' + JSON.stringify({...parseWikiCitationReference(value), extra: true})]) {
    assert.throws(() => parseWikiCitationReference(invalid), {code: 'INVALID_ARGUMENT'});
  }
});
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-wiki-'));
  const rootPath = join(base, 'vault');
  await mkdir(rootPath);
  t.after(() => rm(base, {recursive: true, force: true}));
  return {base, rootPath, path: join(rootPath, 'one.md')};
}

test('inventory separates identical pages, repeats without mutation, and reveals no absolute paths', async t => {
  const {rootPath, path} = await fixture(t);
  await writeFile(path, 'title\nhello world\n');
  await writeFile(join(rootPath, 'two.md'), 'title\nhello world\n');
  const original = await readFile(path);
  const wiki = await openReadOnlyWiki({...binding(), rootPath});
  const pages = await wiki.scanPages(context());
  assert.equal(pages.length, 2);
  assert.notEqual(pages[0].pageId, pages[1].pageId);
  assert.equal(pages[0].revision, pages[1].revision);
  assert.deepEqual(await wiki.scanPages(context()), pages);
  const result = await search(wiki);
  assert.equal(result.hits[0].source.pageId, pages[0].pageId);
  assert.equal(result.hits[0].source.dataLevel, 'private');
  assert.equal(await wiki.readCitation({source: result.hits[0].source, ...context()}), 'hello world');
  assert.equal(JSON.stringify({pages, result}).includes(rootPath), false);
  assert.deepEqual(await readFile(path), original);
});

test('a same-filesystem move keeps identity across reopen, while old location is unavailable', async t => {
  const {rootPath, path} = await fixture(t);
  await writeFile(path, 'hello world');
  const wiki = await openReadOnlyWiki({...binding(), rootPath});
  const old = (await search(wiki)).hits[0].source;
  await mkdir(join(rootPath, 'notes'));
  await rename(path, join(rootPath, 'notes', 'moved.md'));
  await assert.rejects(wiki.readCitation({source: old, ...context()}), {code: 'SOURCE_UNAVAILABLE'});
  const moved = (await search(wiki)).hits[0].source;
  assert.equal(moved.pageId, old.pageId);
  assert.equal(moved.path, 'notes/moved.md');
  assert.equal(await wiki.readCitation({source: moved, ...context()}), 'hello world');
  const reopened = await openReadOnlyWiki({...binding(), rootPath});
  assert.equal((await reopened.scanPages(context()))[0].pageId, old.pageId);
});

test('an edit changes revision and refuses old citations without changing the page identity', async t => {
  const {rootPath, path} = await fixture(t);
  await writeFile(path, 'hello old');
  const wiki = await openReadOnlyWiki({...binding(), rootPath});
  const old = (await search(wiki)).hits[0].source;
  await writeFile(path, 'hello new');
  await assert.rejects(wiki.readCitation({source: old, ...context()}), {code: 'SOURCE_CHANGED'});
  const fresh = (await search(wiki)).hits[0].source;
  assert.equal(fresh.pageId, old.pageId);
  assert.notEqual(fresh.revision, old.revision);
  assert.equal(await wiki.readCitation({source: fresh, ...context()}), 'hello new');
});

test('a new file at an old path cannot reuse an identical-content citation', async t => {
  const {rootPath, path, base} = await fixture(t);
  await writeFile(path, 'hello world');
  const wiki = await openReadOnlyWiki({...binding(), rootPath});
  const old = (await search(wiki)).hits[0].source;
  await rename(path, join(base, 'retained.md'));
  await writeFile(path, 'hello world');
  await assert.rejects(wiki.readCitation({source: old, ...context()}), {code: 'SOURCE_CHANGED'});
  const fresh = (await search(wiki)).hits[0].source;
  assert.equal(fresh.revision, old.revision);
  assert.notEqual(fresh.pageId, old.pageId);
});

test('bindings reject source/configuration/classification substitution and revoked leases', async t => {
  const {rootPath, path} = await fixture(t);
  await writeFile(path, 'hello world');
  let current = true;
  const options = {...binding({isCurrent: () => current}), rootPath};
  const wiki = await openReadOnlyWiki(options);
  options.configRevision = 2;
  const old = (await search(wiki)).hits[0].source;
  assert.equal(old.configRevision, 1);
  for (const patch of [{sourceId: 'other'}, {namespace: 'other'}, {configRevision: 2},
    {dataLevel: 'public'}, {vaultId: 'other'}, {validUntil: new Date(0).toISOString()}]) {
    await assert.rejects(wiki.readCitation({source: {...old, ...patch}, ...context()}), {code: 'SCOPE_DENIED'});
  }
  for (const patch of [{path: '../escape.md'}, {path: 'C:/escape.md'}, {rootPath},
    {pageId: 'invalid'}, {line: 0}]) {
    await assert.rejects(wiki.readCitation({source: {...old, ...patch}, ...context()}), {code: 'INVALID_ARGUMENT'});
  }
  current = false;
  await assert.rejects(search(wiki), {code: 'SCOPE_DENIED'});
  await assert.rejects(wiki.scanPages(context()), {code: 'SCOPE_DENIED'});
  await assert.rejects(wiki.readCitation({source: old, ...context()}), {code: 'SCOPE_DENIED'});
  await assert.rejects(openReadOnlyWiki({...binding({isCurrent: () => false}), rootPath}), {code: 'SCOPE_DENIED'});
  await assert.rejects(openReadOnlyWiki({...binding({validUntil: new Date(0).toISOString()}), rootPath}), {code: 'SCOPE_DENIED'});
});

test('a replaced root or a failed scan is an error, never an empty deletion inventory', async t => {
  const {rootPath, path, base} = await fixture(t);
  await writeFile(path, 'hello world');
  const wiki = await openReadOnlyWiki({...binding(), rootPath});
  const pages = await wiki.scanPages(context());
  await rename(rootPath, join(base, 'original'));
  await assert.rejects(wiki.scanPages(context()), {code: 'SOURCE_UNAVAILABLE'});
  assert.equal(pages.length, 1);
  await mkdir(rootPath);
  await writeFile(path, 'hello world');
  await assert.rejects(wiki.scanPages(context()), {code: 'SCOPE_DENIED'});
  await assert.rejects(search(wiki), {code: 'SCOPE_DENIED'});
});

test('links and hard links cannot turn the bound directory into another source', async t => {
  const {rootPath, base} = await fixture(t);
  const outside = join(base, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'secret.md'), 'hello synthetic');
  const wiki = await openReadOnlyWiki({...binding(), rootPath});
  await link(join(outside, 'secret.md'), join(rootPath, 'linked.md'));
  await assert.rejects(wiki.scanPages(context()), {code: 'SCOPE_DENIED'});
  await rm(join(rootPath, 'linked.md'));
  await symlink(outside, join(rootPath, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(search(wiki), {code: 'SCOPE_DENIED'});
});

test('explicit Fake retains binding checks and unavailable never supplies fixtures', async () => {
  const wiki = createFakeWikiPort({...binding(), documents: [{path: 'one.md', content: 'hello fake'},
    {path: 'two.md', content: 'hello fake'}]});
  const result = await search(wiki);
  assert.notEqual(result.hits[0].source.pageId, result.hits[1].source.pageId);
  assert.equal(await wiki.readCitation({source: result.hits[0].source, ...context()}), 'hello fake');
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(wiki.scanPages(context({signal: cancelled.signal})), {code: 'CANCELLED'});
  await assert.rejects(wiki.scanPages(context({deadline: new Date(0).toISOString()})), {code: 'TIMEOUT'});
  await assert.rejects(wiki.scanPages(context({deadline: 'tomorrow'})), {code: 'INVALID_ARGUMENT'});
  const unavailable = createUnavailableWikiPort();
  await assert.rejects(search(unavailable), {code: 'SOURCE_UNAVAILABLE'});
  await assert.rejects(unavailable.scanPages(context()), {code: 'SOURCE_UNAVAILABLE'});
});

test('revocation, cancellation and expiry during an awaited reader discard returned content', async () => {
  for (const action of ['revoke', 'cancel', 'expire']) {
    let resolve;
    let current = true;
    const controller = new AbortController();
    const waiting = new Promise(r => { resolve = r; });
    const wiki = createWikiPort({...binding({isCurrent: () => current}), reader: {
      scanPages: () => waiting, search: async () => ({hits: [], truncated: false}),
      readPage: async () => { throw new Error('unused'); }
    }});
    const request = context({signal: controller.signal,
      ...(action === 'expire' ? {deadline: new Date(Date.now() + 30).toISOString()} : {})});
    const pending = wiki.scanPages(request);
    pending.catch(() => {});
    if (action === 'revoke') current = false;
    if (action === 'cancel') controller.abort();
    if (action === 'expire') await new Promise(r => setTimeout(r, 50));
    resolve([]);
    await assert.rejects(pending, {code: {revoke: 'SCOPE_DENIED', cancel: 'CANCELLED', expire: 'TIMEOUT'}[action]});
  }
});

test('a file changed between search and page validation yields no stale result', async () => {
  const fixture = createFakeWikiPort({...binding(), documents: [{path: 'one.md', content: 'hello fake'}]});
  const result = await search(fixture);
  const wiki = createWikiPort({...binding(), reader: {
    search: async () => result, scanPages: async () => [], readPage: async () => ({path: 'one.md',
      pageId: result.hits[0].source.pageId, content: 'hello changed', revision: 'a'.repeat(64)})
  }});
  await assert.rejects(search(wiki), {code: 'SOURCE_CHANGED'});
});

test('caller mutation during an awaited read cannot substitute a new revision', async () => {
  const options = binding();
  const fixture = createFakeWikiPort({...options, documents: [{path: 'one.md', content: 'hello fake'}]});
  const source = (await search(fixture)).hits[0].source;
  let resolve;
  const wiki = createWikiPort({...options, reader: {
    search: async () => ({hits: [], truncated: false}), scanPages: async () => [],
    readPage: () => new Promise(r => { resolve = r; })
  }});
  const pending = wiki.readCitation({source, ...context()});
  source.revision = 'a'.repeat(64);
  resolve({path: source.path, pageId: source.pageId, revision: source.revision, content: 'hello changed'});
  await assert.rejects(pending, {code: 'SOURCE_CHANGED'});
});
