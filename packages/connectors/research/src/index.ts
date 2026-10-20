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
export type { Freshness, PublishedTimeKind, ResearchMaterial, ResearchProvider, ResearchSearchInput } from './provider.js';

export const RESEARCH_MODULE_VERSION = '0.1.0-alpha.1';

const PROTOCOL_ID = 'https://personalagent.local/protocol/1.0.0';

const searchInputSchema: ToolDescriptor['inputSchema'] = {
  type: 'object',
  description: '联网检索学术与公开资料（当前提供商为 OpenAlex 学术库）。每条结果披露来源（DOI/ venue）、发布时间（日期精度，无发布时间时回退抓取时刻并显式标注）与获取时间；发布时间超过 maxAgeMs 的材料标 freshness: stale（仍返回，由调用方取舍）。检索失败照实报错；提供商故障且缓存未过期时返回 stale 结果并附 lastError，不用旧结果冒充新结果。中文查询另做相关度底线筛选：结果题名与检索词既无拉丁词交集、又无足量连续汉字交集时不返回（宁可如实未命中，不呈现无关材料）；拉丁查询不受影响。',
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
      version: RESEARCH_CONNECTOR_VERSION,
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
