// #445：OpenAlex 对中文口语查询会返回与检索词毫无交集的高排名结果（实机两例：
// 「研究一下 Node.js 24 的主要新特性，要点+来源」命中《BayLing》跨语对齐论文与
// 《Intelligent Classroom Attentiveness Analysis System Based on YOLOv11》）。
// openalex.ts 现对 CJK 查询做相关度底线筛选：题名与查询既无拉丁词桥、又无足量
// 汉字二元组桥的命中不返回；拉丁查询完全不受影响（防回归边界）。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OpenAlexProvider, ResearchService} from '../dist/index.js';

const ACCOUNT = 'research-me';
const NOW = Date.parse('2026-10-20T00:00:00.000Z');

/** #445 原始现场的两条跑题命中（真实题名，公开元数据）。 */
const BAYLING = {id: 'https://openalex.org/W7222007163',
  display_name: 'BayLing: Bridging Cross-lingual Alignment and Instruction Following through Interactive Translation for Large Language Models',
  publication_date: '2023-06-19'};
const CLASSROOM = {id: 'https://openalex.org/W8000000001',
  display_name: 'Design of an Intelligent Classroom Attentiveness Analysis System Based on YOLOv11',
  publication_date: '2025-01-01'};

function openAlexReturns(results) {
  return async () => ({ok: true, status: 200, json: async () => ({results})});
}

test('#445 观察复现：Node.js 24 中文题命中两条跑题论文 → 如实返回空（不再呈现）', async () => {
  const provider = new OpenAlexProvider({fetchImpl: openAlexReturns([BAYLING, CLASSROOM])});
  const materials = await provider.search(ACCOUNT, {query: '研究一下 Node.js 24 的主要新特性，要点+来源', limit: 10});
  assert.deepEqual(materials, [], '拉丁词桥（node）与汉字二元组桥两皆不沾 → 不返回');
});

test('#445 拉丁词桥：题名含查询拉丁词（词边界）的真命中保留，跑题命中照样筛除', async () => {
  const NODEJS = {id: 'https://openalex.org/W8000000002',
    display_name: 'Node.js 24: New Features and Performance Review', publication_date: '2026-01-15'};
  const ALMOST = {id: 'https://openalex.org/W8000000003',
    display_name: 'Nodestrum: A Provenance Index for Research Data', publication_date: '2024-01-01'};
  const provider = new OpenAlexProvider({fetchImpl: openAlexReturns([BAYLING, NODEJS, ALMOST])});
  const materials = await provider.search(ACCOUNT, {query: '研究一下 Node.js 24 的主要新特性', limit: 10});
  assert.equal(materials.length, 1, '无 node.js 词边界命中 → Nodestrum/BayLing/Classroom 全部不成桥');
  assert.equal(materials[0] && materials[0].externalId, 'W8000000002');
});

test('#445 汉字二元组桥：中文文献命中保留（≥2 共享二元组），无关英文题筛除', async () => {
  const ZH_HIT = {id: 'https://openalex.org/W8000000004',
    display_name: '基于知识图谱的金融风控研究', publication_date: '2024-05-01'};
  const provider = new OpenAlexProvider({fetchImpl: openAlexReturns([ZH_HIT, CLASSROOM])});
  const materials = await provider.search(ACCOUNT, {query: '知识图谱 构建方法综述', limit: 10});
  assert.equal(materials.length, 1, '「知识/识图/图谱」共享 ≥2 二元组 → 保留');
  assert.equal(materials[0] && materials[0].externalId, 'W8000000004');
});

test('#445 短查询阈值放宽：两字查询词（≥1 共享二元组）即可成桥', async () => {
  const ZH_SHORT = {id: 'https://openalex.org/W8000000005',
    display_name: '人工智能导论', publication_date: '2023-01-01'};
  const provider = new OpenAlexProvider({fetchImpl: openAlexReturns([ZH_SHORT])});
  const materials = await provider.search(ACCOUNT, {query: '智能', limit: 5});
  assert.equal(materials.length, 1, '2 字查询门槛=1 个共享二元组');
});

test('汉字桥不跨越题名或查询中的分隔符', async t => {
  for (const separator of ['.', ' ', '\n', 'Latin']) {
    const separated = ['金', '融', '风', '控'].join(separator);
    for (const side of ['query', 'title']) await t.test(`${side}: ${JSON.stringify(separator)}`, async () => {
      const provider = new OpenAlexProvider({fetchImpl: openAlexReturns([{
        id: 'https://openalex.org/W8000000010', publication_date: '2025-01-01',
        display_name: side === 'title' ? separated : '金融风控',
      }])});
      const materials = await provider.search(ACCOUNT, {query: side === 'query' ? separated : '金融风控', limit: 10});
      assert.deepEqual(materials, [], '非相邻汉字不能因过滤分隔符被拼成相关词');
    });
  }
});

test('多个连续汉字片段仍可各自提供真实相邻二元组', async () => {
  const provider = new OpenAlexProvider({fetchImpl: openAlexReturns([{
    id: 'https://openalex.org/W8000000011', publication_date: '2025-01-01',
    display_name: '知识图谱：金融风控研究',
  }])});
  const materials = await provider.search(ACCOUNT, {query: '知识图谱 金融风控', limit: 10});
  assert.deepEqual(materials.map(item => item.externalId), ['W8000000011']);
});

test('#445 防回归边界：纯拉丁查询不做任何筛选，OpenAlex 原序原样透传', async () => {
  const provider = new OpenAlexProvider({fetchImpl: openAlexReturns([BAYLING, CLASSROOM])});
  const materials = await provider.search(ACCOUNT, {query: 'cross-lingual alignment instruction following', limit: 10});
  assert.equal(materials.length, 2, '拉丁查询词面桥接会误伤（如 LLM vs large language models），不改行为');
  assert.ok(materials.length === 2 && materials[0] && materials[1]);
  assert.equal(materials[0].externalId, 'W7222007163');
  assert.equal(materials[1].externalId, 'W8000000001');
});

test('#447 评审整改（zemeng P2）：C++/C# 判据词保留，不再被尾部清洗削成单字母', async () => {
  const CPP = {id: 'https://openalex.org/W8000000006',
    display_name: 'Modern C++ Memory Model for Concurrency Review', publication_date: '2025-03-01'};
  const CS = {id: 'https://openalex.org/W8000000007',
    display_name: 'C# Async Programming Patterns in Practice', publication_date: '2025-06-01'};
  const provider = new OpenAlexProvider({fetchImpl: openAlexReturns([CPP, CS])});
  const materials = await provider.search(ACCOUNT, {query: '研究一下 C++ 内存模型与 C# 异步编程', limit: 10});
  assert.equal(materials.length, 2, '整改前 strip 会把 c++/c# 削成 c 而丢弃 → 两条全被筛走；整改后拉丁词桥各自成桥');
  assert.equal(materials[0] && materials[0].externalId, 'W8000000006');
  assert.equal(materials[1] && materials[1].externalId, 'W8000000007');
});

test('#447 评审整改（P3 边界）：C++11 紧邻数字写法整体成判据词元，命中版本化题名', async () => {
  const CPPT = {id: 'https://openalex.org/W8000000008',
    display_name: 'C++11 Memory Order and Atomics in Practice', publication_date: '2024-11-01'};
  const provider = new OpenAlexProvider({fetchImpl: openAlexReturns([CPPT])});
  const materials = await provider.search(ACCOUNT, {query: 'C++11 内存序与原子操作 实践综述', limit: 10});
  assert.equal(materials.length, 1, 'c++11 词元在题名词边界命中 → 保留');
  assert.equal(materials[0] && materials[0].externalId, 'W8000000008');
});

test('#447 评审整改（P3 边界负例）：版本化查询不命中无对应词元的题名', async () => {
  const NOPE = {id: 'https://openalex.org/W8000000009',
    display_name: 'Modern C++ Memory Model for Concurrency Review', publication_date: '2025-03-01'};
  const provider = new OpenAlexProvider({fetchImpl: openAlexReturns([NOPE])});
  const materials = await provider.search(ACCOUNT, {query: 'C++11 内存序与原子操作 实践综述', limit: 10});
  assert.equal(materials.length, 0, '题名只有 c++ 无 c++11 词元、又无共享汉字二元组 → 不放行');
});

test('#445 service 层：筛选后为空仍是合法 envelope（results=[] + cache），且同查询走缓存', async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    return openAlexReturns([BAYLING, CLASSROOM])();
  };
  const provider = new OpenAlexProvider({fetchImpl});
  const service = new ResearchService(provider, {now: () => NOW});
  const first = await service.search(ACCOUNT, '研究一下 Node.js 24 的主要新特性，要点+来源', {limit: 10});
  assert.deepEqual(first.results, []);
  assert.equal(first.cache.state, 'fetched');
  assert.ok(first.cache.ttlMs >= 1);
  const second = await service.search(ACCOUNT, '研究一下 Node.js 24 的主要新特性，要点+来源', {limit: 10});
  assert.equal(providerCalls, 1, '空结果同等入缓存（TTL 内不重复出站）');
  assert.equal(second.cache.state, 'fresh');
  assert.deepEqual(second.results, []);
});
