/** 资料提供商端口：实现方负责真实 API（OpenAlex）或 Fake 夹具，本包只做规范化。 */
import type { RelevanceMatch, QueryRewrite } from './relevance.js';

/** Counts describe the fetched page, not the total corpus or semantic relevance. */
export interface ResearchRetrievalReceipt {
  provider: string;
  /** Actual source request, without the optional contact address or URL credentials. */
  sourceUrl: string;
  queryRewrite?: QueryRewrite;
  policy: 'provider_rank' | 'cjk_topic_v2';
  rawCount: number;
  invalidCount: number;
  filteredCount: number;
  returnedCount: number;
  outcome: 'matched' | 'source_empty' | 'filtered_empty' | 'invalid_results';
  message: string;
  matches: RelevanceMatch[];
}

export interface ResearchSearchPage {
  materials: ResearchMaterial[];
  retrieval: ResearchRetrievalReceipt;
}

/** 一条材料：提供商侧原始形态，发布时间可有可无（诚实保留 null）。 */
export interface ResearchMaterial {
  /** 提供商内的稳定标识（OpenAlex 的 W-id 或 Fake 的 fixture id）。 */
  externalId: string;
  title: string;
  /** 发布时刻（ISO-8601 UTC）；仅日期精度归一为当日 UTC 零点；缺失为 null。 */
  publishedAt: string | null;
  authors: string[];
  venue?: string;
  url?: string;
  citedBy?: number;
  language?: string;
}

export interface ResearchSearchInput {
  query: string;
  limit: number;
  /** 宿主取消信号：实现方必须透传到出站请求（goo122/zemeng 评审后补齐）。 */
  signal?: AbortSignal;
}

export interface ResearchProvider {
  /** 提供商标识（进 manifest.accountTypes），Fake 为 'fixture'，OpenAlex 为 'openalex'。 */
  readonly providerKind: string;
  /** 诚实声明：Fake 是 mock，真实 API 是 conditional（依赖出站网络）。 */
  readonly verification: 'mock' | 'conditional';
  search(accountRef: string, input: ResearchSearchInput): Promise<ResearchMaterial[]>;
  /** Optional additive disclosure; legacy/custom providers keep their original array API. */
  searchWithReceipt?(accountRef: string, input: ResearchSearchInput): Promise<ResearchSearchPage>;
}

/** 发布时刻的精度披露：date_only（当日 UTC 零点）或 fetched_fallback（源没给发布时间）。 */
export type PublishedTimeKind = 'date_only' | 'fetched_fallback';

/** 材料新鲜度：发布时间超过 maxAgeMs 记 stale（仍返回，由消费方取舍）。 */
export type Freshness = 'fresh' | 'stale';
