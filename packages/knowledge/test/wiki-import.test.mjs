import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {compileWiki, openWikiImportStore, wikiImportHash, WikiImportError} from '../dist/wiki-import/index.js';

const context = (assertCurrent = () => {}) => ({deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal, assertCurrent});
function fixture(text = '青岛出行计划：穿蓝色外套，预算 2500 元。', sourceId = 'source-a') {
  const bytes = Buffer.from(text);
  return {bytes, document: {sourceId, revision: wikiImportHash(bytes), name: `${sourceId}.md`, format: 'markdown',
    units: [{id: 'paragraph-1', locator: '第 1 段', text, kind: 'text', status: 'processed'}],
    coverage: {total: 1, processed: 1, issues: []}}};
}
function fakeModel(change) {
  const calls = [];
  return {fingerprint: 'explicit-fake-wiki-v1', calls, async invoke(request) {
    calls.push(request);
    const input = JSON.parse(request.input);
    const output = request.stage === 'extract' ? {claims: input.units.map(unit => ({text: unit.text, kind: 'fact', topic: '出行计划',
      entities: ['青岛'], evidence: [{sourceId: unit.sourceId, revision: unit.revision, unitId: unit.unitId, quote: unit.text.slice(0, 2000)}]}))}
      : {pages: [{title: '出行综合', kind: 'synthesis', claimIds: input.claims.map(claim => claim.id), relatedTitles: ['青岛']}]};
    return {output: change ? change(output, request) : output, usage: {inputTokens: 10, outputTokens: 10}};
  }};
}
const budget = {maxCalls: 30, maxInputCharacters: 1_000_000, maxOutputCharacters: 300_000};
const compile = (documents, extra = {}) => compileWiki({documents, model: fakeModel(), context: context(), budget, ...extra});
function library(t) {
  const rootPath = mkdtempSync(join(tmpdir(), 'personalagent-wiki-'));
  const store = openWikiImportStore({rootPath, isCurrent: () => true});
  t.after(() => {store.close(); rmSync(rootPath, {recursive: true, force: true});});
  return {rootPath, store};
}

test('compiles linked source, topic, entity and synthesis pages with precise original evidence', async () => {
  const first = fixture(), second = fixture('青岛出行计划：天气有雨，应携带雨伞。', 'source-b');
  const result = await compile([first.document, second.document]);
  assert.equal(result.claims.length, 2);
  assert.deepEqual(result.coverage, {total: 2, processed: 2, issues: []});
  assert.ok(result.pages.some(page => page.path === 'index.md'));
  const topic = result.pages.find(page => page.title === '出行计划');
  assert.deepEqual(topic.sourceIds, ['source-a', 'source-b']);
  assert.match(topic.markdown, /2500/);
  assert.match(topic.markdown, /携带雨伞/);
  assert.match(topic.markdown, new RegExp(first.document.revision));
  assert.ok(result.pages.some(page => page.kind === 'entity' && page.title === '青岛'));
  assert.ok(result.pages.some(page => page.kind === 'synthesis'));
  const byPath = new Set(result.pages.map(page => page.path));
  for (const page of result.pages) for (const [, link] of page.markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = link.startsWith('../') ? link.slice(3) : page.path.includes('/') ? `${page.path.split('/')[0]}/${link}` : link;
    assert.ok(byPath.has(target), `unresolved link ${page.path}: ${link}`);
  }
});

test('reports nonempty source with no extracted claims as incomplete when published', async t => {
  const {document, bytes} = fixture(), {store} = library(t), ctx = context();
  const model = fakeModel((output, request) => request.stage === 'extract' ? {claims: []} : output);
  const result = await compile([document], {model});
  assert.equal(result.claims.length, 0);
  assert.deepEqual(result.coverage.issues.map(({sourceId, unitId}) => ({sourceId, unitId})),
    [{sourceId: document.sourceId, unitId: document.units[0].id}]);
  assert.match(result.pages.find(page => page.path === 'report.md').markdown, /需处理/);
  store.saveSource(document, bytes, ctx);
  assert.equal(store.publish({operationId: 'empty-extraction', expectedGeneration: null, compiled: result}, ctx).complete, false);
});

test('reports omitted source evidence on fresh and cached model outputs', async () => {
  const first = fixture(), second = fixture('青岛出行计划：周五有雨。', 'source-b');
  const model = fakeModel((output, request) => request.stage === 'extract' ? {claims: output.claims.slice(0, 1)} : output);
  const values = new Map(), cache = {get: key => values.get(key), set: (key, value) => values.set(key, value)};
  const original = await compile([first.document, second.document], {model, cache});
  const firstCalls = model.calls.length;
  const cached = await compile([first.document, second.document], {model, cache});
  assert.ok(firstCalls > 0);
  assert.equal(model.calls.length, firstCalls);
  assert.ok(cached.usage.cacheHits > 0);
  for (const result of [original, cached]) {
    assert.deepEqual(result.coverage.issues.map(({sourceId, unitId}) => ({sourceId, unitId})),
      [{sourceId: second.document.sourceId, unitId: second.document.units[0].id}]);
  }
});

test('does not report model extraction gaps for an empty unit', async () => {
  const {document} = fixture('');
  const empty = {...document, units: [{...document.units[0], status: 'empty'}],
    coverage: {total: 1, processed: 0, issues: []}};
  const model = fakeModel();
  const result = await compile([empty], {model});
  assert.equal(model.calls.length, 0);
  assert.deepEqual(result.coverage.issues, []);
});

test('rejects invented quotes, unknown schema fields and fabricated claim references', async () => {
  const {document} = fixture();
  const invented = fakeModel((output, request) => {
    if (request.stage === 'extract') output.claims[0].evidence[0].quote = '原文没有这个证据';
    return output;
  });
  await assert.rejects(compile([document], {model: invented}), {code: 'INVALID_MODEL_OUTPUT'});
  const extra = fakeModel(output => ({...output, execute: 'malicious instruction'}));
  await assert.rejects(compile([document], {model: extra}), {code: 'INVALID_MODEL_OUTPUT'});
  const reference = fakeModel((output, request) => {
    if (request.stage === 'organize') output.pages[0].claimIds = ['f'.repeat(64)];
    return output;
  });
  await assert.rejects(compile([document], {model: reference}), {code: 'INVALID_MODEL_OUTPUT'});
});

test('repairs only returned invalid model output within the original budget and keeps strict evidence', async () => {
  const {document} = fixture();
  let extraction = 0;
  const model = fakeModel((output, request) => {
    if (request.stage === 'extract' && ++extraction === 1) output.claims[0].evidence[0].quote = '捏造的引用';
    else if (request.stage === 'extract' && extraction === 2) output.claims[0].unknown = true;
    return output;
  });
  const result = await compile([document], {model});
  const calls = model.calls.filter(request => request.stage === 'extract');
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map(request => request.requestId)).size, 3);
  assert.equal(result.usage.calls, 4);
  assert.equal(result.usage.inputTokens, 40);
  assert.equal(result.usage.outputTokens, 40);
  assert.equal(result.claims[0].evidence[0].quote, document.units[0].text);
  assert.ok(result.usage.inputCharacters > calls[0].system.length + calls[0].input.length);

  const invalid = fakeModel((output, request) => {
    if (request.stage === 'extract') output.claims[0].evidence[0].quote = '捏造的引用';
    return output;
  });
  await assert.rejects(compile([document], {model: invalid, budget: {...budget, maxCalls: 2}}), {code: 'BUDGET_EXCEEDED'});
  assert.equal(invalid.calls.length, 2);
  const failed = fakeModel(() => {throw new Error('transport result unknown');});
  await assert.rejects(compile([document], {model: failed}), /transport result unknown/);
  assert.equal(failed.calls.length, 1);
});

test('renders long source text with many Markdown fences without dropping content or overflowing the call stack',async()=>{
  const value='x`'.repeat(150_000),{document}=fixture(value);
  const model={fingerprint:'synthetic-fence',async invoke(){return {output:{claims:[]}};}};
  const result=await compileWiki({documents:[document],model,context:context(),
    budget:{maxCalls:100,maxInputCharacters:2_000_000,maxOutputCharacters:100_000}});
  const source=result.pages.find(page=>page.kind==='source'&&page.markdown.includes(value));
  assert.ok(source);assert.equal(result.coverage.processed,1);
});

test('reuses validated cache without model calls and invalidates changed source content', async () => {
  const memory = new Map(), cache = {get: key => memory.get(key), set: (key, value) => memory.set(key, value)};
  const first = fixture(), model = fakeModel();
  const initial = await compile([first.document], {cache, model});
  const repeated = await compile([first.document], {cache, model});
  assert.equal(repeated.fingerprint, initial.fingerprint);
  assert.equal(repeated.usage.calls, 0);
  assert.equal(repeated.usage.cacheHits, 2);
  assert.equal(model.calls.length, 2);
  await compile([fixture('青岛预算调整为 3000 元。').document], {cache, model});
  assert.equal(model.calls.length, 4);
  const firstKey = memory.keys().next().value;
  memory.set(firstKey, {claims: [{text: 'cache forgery'}]});
  await assert.rejects(compile([first.document], {cache, model}), {code: 'INVALID_MODEL_OUTPUT'});
});

test('stops before exceeding budget and rejects late model output after cancellation', async () => {
  const {document} = fixture(), model = fakeModel();
  await assert.rejects(compile([document], {model, budget: {...budget, maxInputCharacters: 1}}), {code: 'BUDGET_EXCEEDED'});
  assert.equal(model.calls.length, 0);
  await assert.rejects(compile([document], {model, budget: {...budget, maxCalls: 1}}), {code: 'BUDGET_EXCEEDED'});
  assert.equal(model.calls.length, 1);
  const controller = new AbortController(), cancelledModel = fakeModel(output => {controller.abort(); return output;});
  await assert.rejects(compile([document], {model: cancelledModel, context: {...context(), signal: controller.signal}}), {code: 'CANCELLED'});
  assert.equal(cancelledModel.calls.length, 1);
});

test('publishes durable complete versions, reopens, queries Chinese and returns source units', async t => {
  const {rootPath, store} = library(t), {document, bytes} = fixture(), ctx = context();
  store.saveSource(document, bytes, ctx);
  const compiled = await compile([document], {cache: store.cache});
  const receipt = store.publish({operationId: 'publish-1', expectedGeneration: null, compiled}, ctx);
  assert.equal(receipt.verified, true); assert.equal(receipt.complete, true);
  assert.equal(store.status().pages.length, compiled.pages.length);
  assert.equal(store.readPage('index.md', ctx).generation, receipt.generation);
  assert.ok(store.search('青岛预算', ctx).hits.length);
  assert.equal(store.readSource({sourceId: document.sourceId, revision: document.revision, unitId: 'paragraph-1', generation: receipt.generation}, ctx).unit.text,
    document.units[0].text);
  assert.deepEqual(Buffer.from(store.readRawSource(document.sourceId, document.revision, ctx)), bytes);
  assert.deepEqual(store.publish({operationId: 'publish-1', expectedGeneration: null, compiled}, ctx), receipt);
  store.close();
  const reopened = openWikiImportStore({rootPath, isCurrent: () => true});
  try {
    assert.equal(reopened.status().generation, receipt.generation);
    assert.equal(reopened.reconcile('publish-1', ctx).state, 'published');
  } finally {reopened.close();}
});

test('updates changed sources incrementally, blocks stale reads and does not resurrect revoked versions', async t => {
  const {store} = library(t), first = fixture(), ctx = context();
  store.saveSource(first.document, first.bytes, ctx);
  const a = store.publish({operationId: 'a', expectedGeneration: null, compiled: await compile([first.document])}, ctx);
  const second = fixture('青岛出行预算变更为 3200 元。');
  store.saveSource(second.document, second.bytes, ctx);
  assert.equal(store.status().stale, true);
  assert.throws(() => store.readPage('index.md', ctx), {code: 'SOURCE_CHANGED'});
  const b = store.publish({operationId: 'b', expectedGeneration: a.generation, compiled: await compile([second.document])}, ctx);
  assert.equal(store.status().stale, false);
  assert.throws(() => store.rollback(a.generation, b.generation, ctx), {code: 'SOURCE_CHANGED'});
  store.revokeSource(second.document.sourceId, ctx);
  assert.equal(store.search('青岛', ctx).hits.length, 0);
  assert.throws(() => store.readPage('index.md', ctx), {code: 'SOURCE_CHANGED'});
  assert.throws(() => store.rollback(b.generation, b.generation, ctx), {code: 'SOURCE_CHANGED'});
});

test('preserves manual edits and rejects arbitrary publication paths', async t => {
  const {rootPath, store} = library(t), {document, bytes} = fixture(), ctx = context();
  store.saveSource(document, bytes, ctx);
  const compiled = await compile([document]);
  const bad = structuredClone(compiled); bad.pages[0].path = '../../outside.md';
  assert.throws(() => store.publish({operationId: 'bad', expectedGeneration: null, compiled: bad}, ctx), {code: 'INVALID_ARGUMENT'});
  assert.equal(store.status().generation, null);
  const first = store.publish({operationId: 'good', expectedGeneration: null, compiled}, ctx);
  const path = join(rootPath, 'wiki/generations', first.generation, 'index.md');
  writeFileSync(path, '用户自己修改了这里');
  assert.throws(() => store.readPage('index.md', ctx), {code: 'MANUAL_EDIT_CONFLICT'});
  assert.throws(() => store.publish({operationId: 'next', expectedGeneration: first.generation, compiled}, ctx), {code: 'MANUAL_EDIT_CONFLICT'});
  assert.equal(readFileSync(path, 'utf8'), '用户自己修改了这里');
});

test('resumes a staged generation after interruption without publishing a partial tree', async t => {
  const {rootPath, store} = library(t), {document, bytes} = fixture(), ctx = context();
  store.saveSource(document, bytes, ctx);
  const compiled = await compile([document]), operationId = 'recover';
  const generation = wikiImportHash(`${operationId}\n${compiled.fingerprint}`);
  const interrupted = context(() => {
    if (existsSync(join(rootPath, 'wiki/generations', generation, 'index.md'))) throw new WikiImportError('CANCELLED');
  });
  assert.throws(() => store.publish({operationId, expectedGeneration: null, compiled}, interrupted), {code: 'CANCELLED'});
  assert.equal(store.status().generation, null);
  assert.deepEqual(store.status().pendingOperations, [operationId]);
  assert.equal(store.reconcile(operationId, ctx).state, 'incomplete');
  store.close();
  const reopened = openWikiImportStore({rootPath, isCurrent: () => true});
  try {
    const receipt = reopened.publish({operationId, expectedGeneration: null, compiled}, ctx);
    assert.equal(receipt.generation, generation);
    assert.equal(reopened.status().pendingOperations.length, 0);
  } finally {reopened.close();}
});

test('reports unsupported coverage without false complete publication', async t => {
  const {store} = library(t), {document, bytes} = fixture();
  const partial = {...document, units: [], coverage: {total: 1, processed: 0, issues: [{reason: 'OCR_NOT_CONFIGURED'}]}};
  const model = fakeModel(), compiled = await compile([partial], {model});
  assert.equal(model.calls.length, 0);
  store.saveSource(partial, bytes, context());
  assert.equal(store.publish({operationId: 'partial', expectedGeneration: null, compiled}, context()).complete, false);
});

test('rejects directory links and revoked host configuration before writing', t => {
  const outer = mkdtempSync(join(tmpdir(), 'wiki-link-'));
  t.after(() => rmSync(outer, {recursive: true, force: true}));
  const target = join(outer, 'target'), rootPath = join(outer, 'library');
  mkdirSync(target); mkdirSync(rootPath);
  symlinkSync(target, join(rootPath, 'raw'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => openWikiImportStore({rootPath, isCurrent: () => true}), {code: 'SCOPE_DENIED'});
  const clean = join(outer, 'clean'); mkdirSync(clean);
  assert.throws(() => openWikiImportStore({rootPath: clean, isCurrent: () => false}), {code: 'SCOPE_DENIED'});
  assert.equal(existsSync(join(clean, '.personalagent')), false);
});
