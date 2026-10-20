import { ProtocolError } from '@personal-agent/contracts';
import type { ResearchMaterial, ResearchProvider, ResearchSearchInput } from './provider.js';

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
    if (typeof input.query !== 'string' || input.query.trim().length === 0) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Research query must be a non-empty string');
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 20) {
      throw new ProtocolError('INVALID_ARGUMENT', 'limit must be 1..20');
    }
    const url = `${this.baseUrl}/works?search=${encodeURIComponent(input.query.trim())}&per-page=${input.limit}`
      + (this.mailto !== undefined ? `&mailto=${encodeURIComponent(this.mailto)}` : '');
    const body = asRecord(await this.getJson(url, input.signal ?? new AbortController().signal));
    const results = Array.isArray(body?.results) ? body.results : [];
    const materials: ResearchMaterial[] = [];
    for (const entry of results) {
      const material = readWork(entry);
      if (material !== undefined) materials.push(material);
    }
    // 中文查询做相关度底线筛选（#445）：OpenAlex 对 CJK 口语查询会返回与检索词毫无
    // 交集的高排名结果（实机两例：Node.js 24 题命中《BayLing》与 YOLOv11 教室论文）。
    // 两桥皆空的命中不返回——诚实未命中优于呈现无关材料；拉丁查询不受影响。
    if (hasCjk(input.query)) {
      return materials.filter(material => bridgedToCjkQuery(input.query, material.title));
    }
    return materials;
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
  if (typeof id !== 'string' || id.length === 0 || title === undefined || title.length === 0) return undefined;
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

// —— 中文（CJK）查询的相关度桥接（#445，2026-10-20 实机证据）——
// OpenAlex /works?search= 对中文口语查询的跨语言召回会给出与检索词毫无交集的高排名
// 结果（实机收据：Node.js 24 题命中《BayLing: Bridging Cross-lingual Alignment…》
// 与《Design of an Intelligent Classroom Attentiveness Analysis System Based on
// YOLOv11》）。桥接判据（命中其一才保留，都在题名上判定）：
// ① 拉丁词桥：查询里的拉丁词（产品名/术语，如 node.js）在题名按词边界出现；
// ② 汉字二元组桥：题名与查询共享 ≥2 个连续汉字二元组（查询仅 2-3 个汉字时放宽为 ≥1，
//    否则两字查询词永远无法构成桥）。
// 两桥皆空 → 视为不相关，不返回：诚实未命中优于呈现无关材料。
// 拉丁查询不经此筛选：OpenAlex 自排质量已可用，且词面桥接会误伤合法英文结果
//（如「LLM」题名不含「large language models」字面）。日语假名/韩文/query 语义级
// rerank 均为后续增强（见 README 已知限制）。
const CJK_CHAR = /[\u3400-\u9fff]/;
const LATIN_TERM = /[a-z][a-z0-9+#.]*/g;
const LATIN_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'for', 'with', 'on', 'in', 'to', 'is', 'are', 'be',
  'by', 'as', 'at', 'vs', 'via', 'using', 'based', 'new', 'how',
]);

function hasCjk(text: string): boolean {
  return CJK_CHAR.test(text);
}

/** 查询里的拉丁判据词（小写）：纯数字（如「24」）不构成判据——在任意题名里都过度命中，
 * 只会放水；虚词丢弃；长度 <2 丢弃。 */
function latinQueryTerms(query: string): string[] {
  const terms: string[] = [];
  for (const match of query.toLowerCase().matchAll(LATIN_TERM)) {
    const raw = match[0];
    if (raw === undefined) continue;
    // 只剥尾部句点；+/# 是 C++/C# 判据词的字面本体（#447 评审 P2）——剥掉后只剩单字母
    // 被长度门槛丢弃，这类题就永远只剩汉字桥，英文题名命中全筛掉。
    const term = raw.replace(/[.]+$/, '');
    if (term.length < 2 || LATIN_STOPWORDS.has(term)) continue;
    terms.push(term);
  }
  return terms;
}

function containsLatinTerm(lowerTitle: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 边界把 +/# 视为词内字符（#447 评审 P3）：c++/c# 是完整词元，不受半边界系统
  // 另外 C++11/C#12 这类紧邻数字的版本化写法也能整体命中。
  return new RegExp(`(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`).test(lowerTitle);
}

function cjkBigrams(text: string): Set<string> {
  const chars = Array.from(text).filter(ch => CJK_CHAR.test(ch));
  const bigrams = new Set<string>();
  for (let i = 0; i + 1 < chars.length; i++) {
    const head = chars[i];
    const tail = chars[i + 1];
    if (head === undefined || tail === undefined) continue;
    bigrams.add(head + tail);
  }
  return bigrams;
}

function bridgedToCjkQuery(query: string, title: string): boolean {
  const lowerTitle = title.toLowerCase();
  if (latinQueryTerms(query).some(term => containsLatinTerm(lowerTitle, term))) return true;
  const queryBigrams = cjkBigrams(query);
  if (queryBigrams.size === 0) return false;
  const titleBigrams = cjkBigrams(title);
  let shared = 0;
  for (const bigram of queryBigrams) if (titleBigrams.has(bigram)) shared++;
  const queryCjkCount = Array.from(query).filter(ch => CJK_CHAR.test(ch)).length;
  return shared >= (queryCjkCount >= 4 ? 2 : 1);
}
