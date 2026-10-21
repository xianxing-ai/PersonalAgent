// Explicit manual public GET only: node packages/connectors/research/test/live-mixed-query.mjs
// No accounts, model, desktop database, full-text download, or default test invocation.
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, relative} from 'node:path';
import {OpenAlexProvider, ResearchService, RESEARCH_SEARCH_VERSION} from '../dist/index.js';

const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const output = resolve(root, '.cache/issue473');
await mkdir(output, {recursive: true});
const queries = ['搜一下 C++ 内存分配器优化的论文', 'C++ 内存池 优化 论文',
  'C++ 内存分配器 调优', 'C++ 动态内存分配 论文', 'C++ memory allocator',
  'memory allocator optimization', 'jemalloc'].slice(0, process.argv.includes('--covered-only') ? 4 : 7);
const receipt = {version: 1, kind: 'real_public_openalex_get', startedAt: new Date().toISOString(),
  node: process.version, toolVersion: RESEARCH_SEARCH_VERSION, limit: 5,
  source: 'https://api.openalex.org/works', sourceSha256: {}, rows: []};
for (const name of ['index', 'openalex', 'provider', 'relevance', 'service']) {
  const path = `packages/connectors/research/src/${name}.ts`;
  receipt.sourceSha256[path] = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
}
for (const [number, query] of queries.entries()) {
  const row = {query, startedAt: new Date().toISOString()};
  const started = performance.now();
  const provider = new OpenAlexProvider({fetchImpl: async (url, init) => {
    row.requestUrl = url;
    const response = await fetch(url, init);
    row.httpStatus = response.status;
    const text = await response.text();
    row.bodySha256 = createHash('sha256').update(text).digest('hex');
    await writeFile(resolve(output, `raw-${number + 1}.json`), text);
    const body = JSON.parse(text);
    if (Array.isArray(body?.results)) row.rawWorks = body.results.map(work => ({
      externalId: typeof work?.id === 'string' ? work.id.replace(/^https:\/\/openalex.org\//, '') : null,
      title: typeof work?.display_name === 'string' ? work.display_name : null,
      doi: typeof work?.doi === 'string' ? work.doi : null,
      abstractSha256: work?.abstract_inverted_index === undefined || work.abstract_inverted_index === null
        ? null : createHash('sha256').update(JSON.stringify(work.abstract_inverted_index)).digest('hex'),
    }));
    return {ok: response.ok, status: response.status, json: async () => body};
  }});
  try {
    const result = await new ResearchService(provider, {now: Date.now}).search('public', query,
      {limit: 5, signal: AbortSignal.timeout(20_000)});
    row.retrieval = result.retrieval;
    row.results = result.results.map(item => ({externalId: item.record.externalId,
      contentRef: item.record.contentRef, fetchedAt: item.record.fetchedAt, publishedAt: item.publishedAt}));
  } catch (error) {
    row.error = {code: typeof error?.code === 'string' ? error.code : 'RUNNER_ERROR',
      message: error instanceof Error ? error.message : String(error)};
  }
  row.completedAt = new Date().toISOString();
  row.wallMs = Math.round(performance.now() - started);
  receipt.rows.push(row);
  await writeFile(resolve(output, 'live-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({query, status: row.httpStatus, retrieval: row.retrieval, error: row.error}));
}
receipt.completedAt = new Date().toISOString();
await writeFile(resolve(output, 'live-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`Receipt: ${relative(root, resolve(output, 'live-receipt.json'))}`);
process.exitCode = receipt.rows.some(row => row.error !== undefined) ? 1 : 0;
