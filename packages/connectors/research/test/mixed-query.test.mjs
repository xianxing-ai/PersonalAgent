import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OpenAlexProvider, ResearchService, FakeResearchProvider, RESEARCH_SEARCH_VERSION, register} from '../dist/index.js';
import {FakeClock, FakeToolHost} from '@personal-agent/testkit';
import {validateToolValue} from '@personal-agent/contracts';

const work = (id, title, extra = {}) => ({id: `https://openalex.org/${id}`, display_name: title, ...extra});
const returns = results => async () => ({ok: true, status: 200, json: async () => ({results})});
const index = words => Object.fromEntries(words.map((word, position) => [word, [position]]));

test('#473 one auditable source query maps covered topics and keeps unknown constraints intact', async () => {
  for (const [query, expected] of [
    ['搜一下 C++ 内存分配器优化的论文', 'C++ memory allocator optimization'],
    ['C++ 内存池 优化 论文', 'C++ memory pool optimization'],
    ['C++ 动态内存分配 论文', 'C++ dynamic memory allocation'],
    ['C++ 内存池 不要垃圾回收', 'C++ 内存池 不要垃圾回收'],
    ['C++ 内存池 2020年以前', 'C++ 内存池 2020年以前'],
    ['C++ 内存池 线程安全', 'C++ 内存池 线程安全'],
    ['C++11 内存序与原子操作', 'C++11 内存序与原子操作'],
  ]) {
    const calls = [];
    const provider = new OpenAlexProvider({fetchImpl: async url => {calls.push(url); return returns([])();}});
    const page = await provider.searchWithReceipt('public', {query, limit: 5});
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]).searchParams.get('search'), expected);
    assert.equal(new URL(page.retrieval.sourceUrl).searchParams.get('search'), expected);
    assert.equal(page.retrieval.queryRewrite?.originalQuery, expected === query ? undefined : query);
  }
});

test('#473 mixed subjects bridge to English topics without requiring literal C++ in the title', async t => {
  for (const [query, title] of [
    ['C++ 内存分配器 调优', 'StarMalloc: Verifying a Modern, Hardened Memory Allocator'],
    ['C++ 动态内存分配 论文', 'A study of dynamic memory allocation'],
    ['C++ 内存池 优化 论文', 'Region-based memory pools for real-time software'],
    ['Rust 垃圾回收 方法研究', 'Concurrent garbage collection with bounded pauses'],
    ['知识图谱 构建方法综述', 'Scalable knowledge graphs for scientific discovery'],
  ]) await t.test(query, async () => {
    const provider = new OpenAlexProvider({fetchImpl: returns([work('W-subject', title),
      work('W-generic', 'K近邻优化的密度峰值搜索聚类算法', {cited_by_count: 100000,
        primary_location: {source: {display_name: 'Famous venue'}}})])});
    const page = await provider.searchWithReceipt('public', {query, limit: 5});
    assert.deepEqual(page.materials.map(item => item.externalId), ['W-subject']);
    assert.equal(page.retrieval.filteredCount, 1, 'venue/citations/shared generic words cannot establish the subject');
    assert.equal(page.retrieval.matches[0].basis, 'title_topic');
  });
});

test('#473 abstract topic can support an English title, but malformed/gapped abstracts cannot invent a phrase', async () => {
  const provider = new OpenAlexProvider({fetchImpl: returns([
    work('W-abstract', 'A real-time systems technique', {abstract_inverted_index: index(['A', 'memory', 'pool', 'reduces', 'latency'])}),
    work('W-gap', 'Unrelated title', {abstract_inverted_index: {memory: [0], pool: [2]}}),
    work('W-collision', 'Unrelated title', {abstract_inverted_index: {memory: [0], pool: [0]}}),
    work('W-oversize', 'Unrelated title', {abstract_inverted_index: {['x'.repeat(4097)]: [0], 'memory pool': [1]}}),
  ])});
  const page = await provider.searchWithReceipt('public', {query: '内存池 调优 论文', limit: 5});
  assert.deepEqual(page.materials.map(item => item.externalId), ['W-abstract']);
  assert.equal(page.retrieval.matches[0].basis, 'abstract_topic');
  assert.ok(page.retrieval.matches[0].terms.includes('memory pool'));
});

test('#473 language name alone does not imply allocator, and generic CJK overlap is rejected', async () => {
  const provider = new OpenAlexProvider({fetchImpl: returns([
    work('W-allocation', 'Memory allocators for safe software'),
    work('W-generic', '一种搜索聚类算法的性能优化方法研究'),
  ])});
  const page = await provider.searchWithReceipt('public', {query: 'C++ 编译器 性能优化 论文研究', limit: 5});
  assert.deepEqual(page.materials, []);
  assert.equal(page.retrieval.outcome, 'filtered_empty');
  assert.equal(page.retrieval.rawCount, 2);
  const specific = new OpenAlexProvider({fetchImpl: returns([
    work('W-language', 'C++ parser generators'), work('W-overlap', '无线资源分配器优化方法'),
  ])});
  assert.deepEqual(await specific.search('public', {query: 'C++ 内存分配器 优化', limit: 5}), []);
});

test('#473 registered tool exposes filtered-empty receipt and preserves it through fresh/stale cache', async () => {
  const clock = new FakeClock(Date.parse('2026-10-21T12:00:00Z'));
  let calls = 0;
  const provider = new OpenAlexProvider({fetchImpl: async () => {
    calls++;
    if (calls > 1) return {ok: false, status: 503, json: async () => ({error: 'fixture outage'})};
    return returns([work('W-nope', 'An unrelated astronomy paper'), {id: 'W-invalid'}])();
  }});
  const host = new FakeToolHost(clock.now);
  let descriptor;
  const originalRegister = host.register.bind(host);
  host.register = tool => {descriptor = tool.descriptor; return originalRegister(tool);};
  const dispose = register(host, {provider, now: clock.now, cacheTtlMs: 1000});
  assert.equal(descriptor.version, RESEARCH_SEARCH_VERSION);
  assert.equal(descriptor.version, '0.1.0-alpha.2');
  const context = {taskId: 't', runId: 'r', signal: new AbortController().signal,
    deadline: '2026-10-21T13:00:00.000Z', authorizationRef: 'fixture', scopes: ['research:read']};
  const query = 'C++ 内存池 优化 论文';
  const first = await host.invoke('research.search', {query, limit: 5}, context);
  assert.deepEqual(first.results, []);
  assert.deepEqual([first.retrieval.rawCount, first.retrieval.invalidCount,
    first.retrieval.filteredCount, first.retrieval.returnedCount], [2, 1, 1, 0]);
  assert.equal(first.retrieval.outcome, 'filtered_empty');
  assert.match(first.retrieval.message, /本机.*不表示语料/);
  const originalReceipt = structuredClone(first.retrieval);
  const oldSchema = structuredClone(descriptor.outputSchema);
  delete oldSchema.properties.retrieval;
  assert.throws(() => validateToolValue(oldSchema, first), 'strict old descriptors cannot silently accept the new output');
  const legacy = {results: [], cache: first.cache};
  validateToolValue(descriptor.outputSchema, legacy);
  first.retrieval.rawCount = 999;
  const fresh = await host.invoke('research.search', {query, limit: 5}, context);
  assert.equal(calls, 1);
  assert.deepEqual(fresh.retrieval, originalReceipt, 'caller mutation cannot rewrite cached evidence');
  clock.advance(1001);
  const stale = await host.invoke('research.search', {query, limit: 5}, context);
  assert.equal(stale.cache.state, 'stale');
  assert.equal(stale.cache.lastError.code, 'EXTERNAL_FAILURE');
  assert.deepEqual(stale.retrieval, originalReceipt, 'failed refresh must not fabricate new source counts');
  dispose();
});

test('#473 empty source, invalid source, and malformed envelope remain distinct', async () => {
  for (const [rows, expected] of [[[], 'source_empty'], [[{id: 'W-no-title'}], 'invalid_results']]) {
    const service = new ResearchService(new OpenAlexProvider({fetchImpl: returns(rows)}), {now: Date.now});
    const result = await service.search('public', '内存分配器', {limit: 5});
    assert.equal(result.retrieval.outcome, expected);
    assert.equal(result.retrieval.filteredCount, 0);
    assert.equal(result.retrieval.rawCount, rows.length);
  }
  const malformed = new OpenAlexProvider({fetchImpl: async () => ({ok: true, status: 200, json: async () => ({})})});
  await assert.rejects(malformed.search('public', {query: 'anything', limit: 5}), {code: 'EXTERNAL_FAILURE'});
  const legacyProvider = new FakeResearchProvider();
  const legacy = new ResearchService(legacyProvider, {now: Date.now});
  for (const state of ['fetched', 'fresh']) {
    const result = await legacy.search('fixture', 'agent', {limit: 5});
    assert.equal(result.cache.state, state);
    assert.ok(!Object.hasOwn(result, 'retrieval'), 'legacy cached pages do not acquire fabricated source counts');
    if (state === 'fetched') legacyProvider.searchWithReceipt = async () => {throw Error('must serve the old cache without invented counts');};
  }
  const contact = new OpenAlexProvider({mailto: 'private@example.test', fetchImpl: returns([])});
  const page = await contact.searchWithReceipt('public', {query: 'anything', limit: 5});
  assert.doesNotMatch(page.retrieval.sourceUrl, /mailto|private/);
});
