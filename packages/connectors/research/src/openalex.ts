import { ProtocolError } from '@personal-agent/contracts';
import type { ResearchMaterial, ResearchProvider, ResearchSearchInput, ResearchSearchPage, ResearchRetrievalReceipt } from './provider.js';
import { hasCjk, matchQuery, readAbstract, sourceQuery } from './relevance.js';

export interface OpenAlexOptions {
  /** 联系邮箱：进入 OpenAlex 的 polite pool（更稳定的限速），不发送任何隐私内容。可选。 */
  mailto?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export type FetchLike = (url: string, init: {signal: AbortSignal; headers: Record<string, string>}) => Promise<FetchResponseLike>;

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

const DEFAULT_BASE = 'https://api.openalex.org';
const USER_AGENT = 'personal-agent-research/0.1.0-alpha.1';

/** OpenAlex work 的最小形状（避免第三方类型漏进公共接口；响应字段按 2026-09-08 实测）。 */
export interface OpenAlexWork {
  id?: unknown;
  doi?: unknown;
  display_name?: unknown;
  publication_date?: unknown;
  authorships?: unknown;
  primary_location?: unknown;
  cited_by_count?: unknown;
  language?: unknown;
  abstract_inverted_index?: unknown;
}

export class OpenAlexProvider implements ResearchProvider {
  readonly providerKind = 'openalex';
  /** 真实 API，但结果依赖出站网络可达。 */
  readonly verification = 'conditional' as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly mailto?: string;

  constructor(options: OpenAlexOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    if (options.mailto !== undefined) this.mailto = options.mailto;
  }

  async search(_accountRef: string, input: ResearchSearchInput & {signal?: AbortSignal}): Promise<ResearchMaterial[]> {
    return (await this.searchWithReceipt(_accountRef, input)).materials;
  }

  async searchWithReceipt(_accountRef: string, input: ResearchSearchInput): Promise<ResearchSearchPage> {
    if (typeof input.query !== 'string' || input.query.trim().length === 0) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Research query must be a non-empty string');
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 20) {
      throw new ProtocolError('INVALID_ARGUMENT', 'limit must be 1..20');
    }
    const source = sourceQuery(input.query.trim());
    const url = `${this.baseUrl}/works?search=${encodeURIComponent(source.query)}&per-page=${input.limit}`
      + (this.mailto !== undefined ? `&mailto=${encodeURIComponent(this.mailto)}` : '');
    const body = asRecord(await this.getJson(url, input.signal ?? new AbortController().signal));
    if (!Array.isArray(body?.results) || body.results.length > input.limit) {
      throw new ProtocolError('EXTERNAL_FAILURE', 'OpenAlex returned an invalid results page', true);
    }
    const results = body.results;
    const materials: ResearchMaterial[] = [];
    const matches: ResearchRetrievalReceipt['matches'] = [];
    let invalidCount = 0;
    let filteredCount = 0;
    for (const entry of results) {
      const material = readWork(entry);
      if (material === undefined) {
        invalidCount++;
        continue;
      }
      const match = matchQuery(input.query, material.title, readAbstract(asRecord(entry)?.abstract_inverted_index));
      if (match === undefined) {
        filteredCount++;
        continue;
      }
      materials.push(material);
      matches.push({externalId: material.externalId, ...match});
    }
    const outcome = materials.length > 0 ? 'matched' : results.length === 0 ? 'source_empty'
      : filteredCount > 0 ? 'filtered_empty' : 'invalid_results';
    const message = (source.rewrite === undefined ? '' : `已用可审计双语主题映射检索：${source.query}；原查询及映射见 queryRewrite。`)
      + `OpenAlex 本次页面原始 ${results.length} 条，无效 ${invalidCount} 条，本机相关度过滤 ${filteredCount} 条，返回 ${materials.length} 条。`
      + (outcome === 'filtered_empty' ? '本机词面/主题桥接未确认相关材料，不表示语料中没有相关文献；可使用明确的英文主题短语重查。'
        : outcome === 'source_empty' ? '本次源页面没有命中，不代表整个语料不存在相关文献。'
          : outcome === 'invalid_results' ? '源页面条目缺少必要标识或题名，未作为材料返回。'
            : '保留依据见 matches；词面/主题命中不等于语义相关性已验证。');
    const sourceUrl = new URL(url);
    sourceUrl.username = '';
    sourceUrl.password = '';
    sourceUrl.searchParams.delete('mailto');
    const retrieval: ResearchRetrievalReceipt = {provider: this.providerKind, sourceUrl: sourceUrl.toString(), policy: hasCjk(input.query) ? 'cjk_topic_v2' : 'provider_rank',
      rawCount: results.length, invalidCount, filteredCount, returnedCount: materials.length, outcome, message, matches};
    if (source.rewrite !== undefined) retrieval.queryRewrite = source.rewrite;
    return {materials, retrieval};
  }

  private async getJson(url: string, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new ProtocolError('CANCELLED', 'Research request cancelled', false);
    let response: FetchResponseLike;
    try {
      response = await this.fetchImpl(url, {signal, headers: {'user-agent': USER_AGENT, accept: 'application/json'}});
    } catch (error) {
      if (signal.aborted) throw new ProtocolError('CANCELLED', 'Research request cancelled', false);
      throw new ProtocolError('EXTERNAL_FAILURE', `OpenAlex request failed: ${describeError(error)}`, true);
    }
    if (response.status === 429) throw new ProtocolError('RATE_LIMITED', 'OpenAlex rate limit reached', true, 60_000);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ProtocolError('EXTERNAL_FAILURE', `OpenAlex returned malformed JSON (HTTP ${response.status}): ${describeError(error)}`, true);
    }
    if (!response.ok) {
      const body = asRecord(payload);
      const message = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
      throw new ProtocolError('EXTERNAL_FAILURE', `OpenAlex request rejected: ${message}`, response.status >= 500);
    }
    return payload;
  }
}

function readWork(entry: unknown): ResearchMaterial | undefined {
  const record = asRecord(entry);
  if (!record) return undefined;
  const id = record.id;
  const title = typeof record.display_name === 'string' ? record.display_name : typeof record.title === 'string' ? record.title : undefined;
  if (typeof id !== 'string' || id.trim().length === 0 || title === undefined || title.trim().length === 0) return undefined;
  const externalId = id.startsWith('https://openalex.org/') ? id.slice('https://openalex.org/'.length) : id;
  const material: ResearchMaterial = {externalId, title, publishedAt: null, authors: []};
  if (typeof record.publication_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.publication_date)) {
    // 2026-99-99 这类通过正则但日历不存在的值不能留给下游：Date.parse 为 NaN，
    // 后续 toISOString 会抛 RangeError。解析失败按「无发布时间」处理，诚实降级。
    const instant = Date.parse(`${record.publication_date}T00:00:00.000Z`);
    if (Number.isFinite(instant)) material.publishedAt = `${record.publication_date}T00:00:00.000Z`;
  }
  if (Array.isArray(record.authorships)) {
    for (const authorship of record.authorships) {
      const author = asRecord(authorship)?.author;
      const name = asRecord(author)?.display_name;
      if (typeof name === 'string' && name.length > 0) material.authors.push(name);
    }
  }
  const venue = asRecord(record.primary_location)?.source;
  const venueName = asRecord(venue)?.display_name;
  if (typeof venueName === 'string' && venueName.length > 0) material.venue = venueName;
  if (typeof record.doi === 'string' && record.doi.length > 0) material.url = record.doi;
  const cited = record.cited_by_count;
  if (typeof cited === 'number' && Number.isFinite(cited) && cited >= 0) material.citedBy = Math.trunc(cited);
  if (typeof record.language === 'string' && record.language.length > 0) material.language = record.language;
  return material;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
