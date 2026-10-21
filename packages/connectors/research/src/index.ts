import { ProtocolError } from '@personal-agent/contracts';
import type { RegisteredTool, ToolDescriptor, ToolHost } from '@personal-agent/contracts';
import { ResearchConnector, RESEARCH_CONNECTOR_VERSION } from './connector.js';
import { ResearchService } from './service.js';
import type { ResearchProvider } from './provider.js';
import type { MaterialResult, ResearchResult } from './service.js';
import { FakeResearchProvider } from './fake-provider.js';

export { ResearchConnector, RESEARCH_CONNECTOR_VERSION } from './connector.js';
export { ResearchService } from './service.js';
export type { MaterialResult, ResearchResult, ResearchServiceOptions } from './service.js';
export { FakeResearchProvider, defaultResearchFixtures } from './fake-provider.js';
export { OpenAlexProvider } from './openalex.js';
export type { FetchLike, FetchResponseLike, OpenAlexOptions, OpenAlexWork } from './openalex.js';
export type { Freshness, PublishedTimeKind, ResearchMaterial, ResearchProvider, ResearchSearchInput, ResearchSearchPage, ResearchRetrievalReceipt } from './provider.js';
export type { RelevanceMatch, QueryRewrite } from './relevance.js';

export const RESEARCH_MODULE_VERSION = '0.1.0-alpha.1';
/** Tool output contract revision; old strict alpha.1 descriptors reject retrieval. */
export const RESEARCH_SEARCH_VERSION = '0.1.0-alpha.2';

const PROTOCOL_ID = 'https://personalagent.local/protocol/1.0.0';

const searchInputSchema: ToolDescriptor['inputSchema'] = {
  type: 'object',
  description: '联网检索学术与公开资料（当前提供商为 OpenAlex 学术库）。每条结果披露来源（DOI/venue）、发布时间与获取时间；过旧材料仍返回并标 stale。提供商故障的旧缓存附 lastError。完整覆盖的中文主题可审计地改为英文源检索词，queryRewrite 披露原词/实际词/映射；未知条件保持原文。中文查询仍按题名词边界、有意义汉字及有限双语主题/摘要筛选，泛词不成桥。OpenAlex 返回 retrieval 原始/无效/过滤/保留条数及依据：filtered_empty 表示本机筛空，source_empty 表示本次源页面空，均不能声称语料不存在相关文献。matches 是词面线索，不是语义相关性或已读全文证明。纯拉丁查询保留提供商排序。',
  properties: {
    query: {type: 'string', minLength: 1, description: '检索词。'},
    limit: {type: 'integer', minimum: 1, maximum: 20, description: '返回条数上限，默认 10。'},
  },
  required: ['query'],
  additionalProperties: false,
};

const searchOutputSchema: ToolDescriptor['outputSchema'] = {
  type: 'object',
  required: ['results', 'cache'],
  additionalProperties: false,
  properties: {
    retrieval: {
      type: 'object', additionalProperties: false,
      description: '本次源页面的来源与本机过滤披露。随 cache 原样保留；stale 时不是新一次源请求。',
      required: ['provider', 'sourceUrl', 'policy', 'rawCount', 'invalidCount', 'filteredCount', 'returnedCount', 'outcome', 'message', 'matches'],
      properties: {
        provider: {type: 'string', minLength: 1},
        sourceUrl: {type: 'string', minLength: 1},
        queryRewrite: {type: 'object', additionalProperties: false,
          required: ['strategy', 'originalQuery', 'effectiveQuery', 'mappings'], properties: {
            strategy: {const: 'bilingual_topics_v1'}, originalQuery: {type: 'string', minLength: 1},
            effectiveQuery: {type: 'string', minLength: 1},
            mappings: {type: 'array', minItems: 1, items: {type: 'object', additionalProperties: false,
              required: ['source', 'target'], properties: {source: {type: 'string', minLength: 1}, target: {type: 'string', minLength: 1}}}},
          }},
        policy: {enum: ['provider_rank', 'cjk_topic_v2']},
        rawCount: {type: 'integer', minimum: 0, maximum: 20},
        invalidCount: {type: 'integer', minimum: 0, maximum: 20},
        filteredCount: {type: 'integer', minimum: 0, maximum: 20},
        returnedCount: {type: 'integer', minimum: 0, maximum: 20},
        outcome: {enum: ['matched', 'source_empty', 'filtered_empty', 'invalid_results']},
        message: {type: 'string', minLength: 1},
        matches: {type: 'array', maxItems: 20, items: {
          type: 'object', additionalProperties: false, required: ['externalId', 'basis', 'terms'],
          properties: {
            externalId: {type: 'string', minLength: 1},
            basis: {enum: ['provider_rank', 'title_latin', 'title_cjk', 'title_topic', 'abstract_topic']},
            terms: {type: 'array', items: {type: 'string', minLength: 1}},
          },
        }},
      },
    },
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['record', 'freshness', 'publishedAt', 'publishedTimeKind', 'ageMs'],
        additionalProperties: false,
        properties: {
          record: {$ref: `${PROTOCOL_ID}#/definitions/ConnectorItem`},
          freshness: {enum: ['fresh', 'stale']},
          publishedAt: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$'},
          publishedTimeKind: {enum: ['date_only', 'fetched_fallback']},
          ageMs: {type: 'integer', minimum: 0},
        },
      },
    },
    cache: {
      type: 'object',
      required: ['state', 'fetchedAt', 'ageMs', 'ttlMs'],
      additionalProperties: false,
      properties: {
        state: {enum: ['fresh', 'fetched', 'stale']},
        fetchedAt: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$'},
        ageMs: {type: 'integer', minimum: 0},
        ttlMs: {type: 'integer', minimum: 1},
        lastError: {
          type: 'object',
          required: ['code', 'message', 'retryable'],
          additionalProperties: false,
          properties: {
            code: {type: 'string', minLength: 1},
            message: {type: 'string', minLength: 1},
            retryable: {type: 'boolean'},
          },
        },
      },
    },
  },
};

export interface ResearchModuleOptions {
  provider: ResearchProvider;
  accountRef?: string;
  now?: () => number;
  maxAgeMs?: number;
  cacheTtlMs?: number;
}

export function register(host: ToolHost, options: ResearchModuleOptions): () => void {
  if (!options?.provider) throw new ProtocolError('INVALID_ARGUMENT', 'Research provider must be explicitly configured; fake providers are test-only');
  const accountRef = options.accountRef ?? 'openalex';
  const serviceOptions: {now: () => number; maxAgeMs?: number; cacheTtlMs?: number} = {now: options.now ?? Date.now};
  if (options.maxAgeMs !== undefined) serviceOptions.maxAgeMs = options.maxAgeMs;
  if (options.cacheTtlMs !== undefined) serviceOptions.cacheTtlMs = options.cacheTtlMs;
  const service = new ResearchService(options.provider, serviceOptions);
  const connector = new ResearchConnector(service, RESEARCH_CONNECTOR_VERSION);
  connector.connect();

  const tool: RegisteredTool = {
    descriptor: {
      name: 'research.search',
      version: RESEARCH_SEARCH_VERSION,
      inputSchema: searchInputSchema,
      outputSchema: searchOutputSchema,
      sideEffect: 'read',
      requiredScopes: ['research:read'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (input: unknown, context) => {
      const raw = input as {query?: string; limit?: number};
      if (typeof raw.query !== 'string' || raw.query.trim().length === 0) {
        throw new ProtocolError('INVALID_ARGUMENT', 'query is required');
      }
      const searchArgs: {limit?: number; signal?: AbortSignal} = {signal: context.signal};
      if (raw.limit !== undefined) searchArgs.limit = raw.limit;
      const result = await service.search(accountRef, raw.query, searchArgs);
      return result;
    },
  };

  const unregister = host.register(tool);
  return () => {
    unregister();
    connector.disconnect();
  };
}

export type {ToolDescriptor};
