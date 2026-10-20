import { ProtocolError } from '@personal-agent/contracts';
import type { RegisteredTool, ToolDescriptor, ToolHost } from '@personal-agent/contracts';
import { WeatherConnector, WEATHER_CONNECTOR_VERSION } from './connector.js';
export { WeatherConnector, WEATHER_CONNECTOR_VERSION } from './connector.js';
export { FakeWeatherProvider, defaultWeatherFixtures } from './provider.js';
export type { FixtureForecast, ForecastFetch, ForecastRequest, PlaceConfidence, PublishedTimeKind, ResolvedPlace, WeatherProvider, WeatherUnits } from './provider.js';
export { OpenMeteoProvider } from './open-meteo.js';
export type { FetchLike, FetchResponseLike, LocationResolution, OpenMeteoOptions } from './open-meteo.js';
export { WeatherService } from './service.js';
export type { CacheState, ForecastPayload, WeatherQuery, WeatherRecord, WeatherResult, WeatherServiceOptions } from './service.js';
import { WeatherService } from './service.js';
import type { WeatherQuery, WeatherServiceOptions } from './service.js';
import type { WeatherProvider } from './provider.js';

const PROTOCOL_ID = 'https://personalagent.local/protocol/1.0.0';

const forecastInputSchema: ToolDescriptor['inputSchema'] = {
  type: 'object',
  description: '查询某地某日的天气预报。地名来自 Open-Meteo/GeoNames，其索引不跨文字匹配：中文串只在 language=zh 下可检索，而该索引的简繁覆盖逐条不可预测，简体外国城市名常只命中同名小镇（伦敦→加拿大安大略、东京→中国江苏）。外国城市请同时在 locationQuery 给出英文或当地名以免同名误中；若地点匹配置信度低，工具会拒绝猜测，不要根据该结果回答天气，先向用户询问英文或当地名称，再通过 locationQuery 重试。天气结果只包含天气本身（地点、日期、摘要、温度、降水概率），不附带地名解析、置信度等技术性说明，回答时请直接转述天气内容。内置离线别名表已覆盖 140 个常见外国城市，当简体输入在索引中零命中时（纽约/首尔等）会自动改用其英文名重查，无需额外配置；表外的简体外国城市名仍请用 locationQuery 给出英文名。装配层配置 geonamesUsername 后，汉字地名会先经 GeoNames name_equals 精确名检索层解析，覆盖面进一步扩大到任意已知别名。',
  properties: {
    location: {type: 'string', minLength: 1, description: '用户原始的地名表述，同时作为缓存与记录身份的基准。'},
    locationQuery: {
      type: 'string', minLength: 1,
      description: '可选。同一地名的英文或当地文字书写形式，仅在 location 未能匹配到可信地点时用于再次检索。例如 location=纽约 配 New York，location=丽江 配 Lijiang。它不能替代 location；两者都给出时以 location 为身份基准。',
    },
    date: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'},
    units: {enum: ['metric', 'imperial']},
  },
  additionalProperties: false,
};

const forecastOutputSchema: ToolDescriptor['outputSchema'] = {
  type: 'object',
  required: ['record', 'forecast', 'cache'],
  additionalProperties: false,
  properties: {
    record: {$ref: `${PROTOCOL_ID}#/definitions/ConnectorItem`},
    forecast: {
      type: 'object',
      required: ['location', 'date', 'units', 'summary', 'temperatureMin', 'temperatureMax', 'precipitationProbability', 'publishedTimeKind'],
      additionalProperties: false,
      properties: {
        location: {type: 'string', minLength: 1},
        date: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'},
        units: {enum: ['metric', 'imperial']},
        summary: {type: 'string', minLength: 1},
        temperatureMin: {type: 'number'},
        temperatureMax: {type: 'number'},
        precipitationProbability: {type: ['integer', 'null'], minimum: 0, maximum: 100},
        publishedTimeKind: {enum: ['provider_published', 'coverage_start']},
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
            retryAfterMs: {type: 'integer', minimum: 0},
          },
        },
      },
    },
  },
};

export interface WeatherModuleOptions {
  provider: WeatherProvider;
  now?: () => number;
  defaultLocation?: string;
  cacheTtlMs?: number;
}

export function register(host: ToolHost, options: WeatherModuleOptions): () => void {
  if (!options?.provider) throw new ProtocolError('INVALID_ARGUMENT', 'Weather provider must be explicitly configured; fake providers are test-only');
  const serviceOptions: WeatherServiceOptions = {
    provider: options.provider,
    now: options.now ?? Date.now,
  };
  if (options.defaultLocation !== undefined) serviceOptions.defaultLocation = options.defaultLocation;
  if (options.cacheTtlMs !== undefined) serviceOptions.cacheTtlMs = options.cacheTtlMs;
  const service = new WeatherService(serviceOptions);
  const connector = new WeatherConnector(service, WEATHER_CONNECTOR_VERSION);

  const tool: RegisteredTool = {
    descriptor: {
      name: 'weather.forecast',
      version: WEATHER_CONNECTOR_VERSION,
      inputSchema: forecastInputSchema,
      outputSchema: forecastOutputSchema,
      sideEffect: 'read',
      requiredScopes: ['weather:read'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (input: unknown, context) => {
      const raw = input as {location?: string; locationQuery?: string; date?: string; units?: string};
      const query: WeatherQuery = {};
      if (typeof raw.location === 'string') query.location = raw.location;
      if (typeof raw.locationQuery === 'string') query.locationQuery = raw.locationQuery;
      if (typeof raw.date === 'string') query.date = raw.date;
      if (raw.units === 'metric' || raw.units === 'imperial') query.units = raw.units;
      const result = await service.getForecast(query, context.signal);
      // 对话可见的结果只说天气：地名解析与置信度留在 service/provider 内部供质量门槛使用，
      // 不进入智能体读到的工具结果，避免回答里冒出解析标记与置信度字样。
      const forecast = {...result.forecast};
      delete forecast.resolved;
      return {...result, forecast};
    },
  };

  const unregister = host.register(tool);
  return () => {
    unregister();
    connector.disconnect();
  };
}
