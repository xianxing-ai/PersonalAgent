import { ProtocolError, validateContract } from '@personal-agent/contracts';
import type { ProtocolContracts } from '@personal-agent/contracts';
import type { ForecastCurrent, ForecastFetch, ForecastHourlyPoint, ForecastRequest, PublishedTimeKind, ResolvedPlace, WeatherProvider, WeatherUnits } from './provider.js';

export type WeatherRecord = ProtocolContracts['connectorItem'];

export interface WeatherQuery {
  location?: string;
  date?: string;
  units?: WeatherUnits;
  /**
   * Latin or local-script spelling, searched only when `location` matched nothing usable.
   * It can change which place is resolved, so it becomes part of the record identity.
   */
  locationQuery?: string;
}

export interface ForecastPayload {
  location: string;
  date: string;
  units: WeatherUnits;
  summary: string;
  temperatureMin: number;
  temperatureMax: number;
  precipitationProbability: number | null;
  publishedTimeKind: PublishedTimeKind;
  resolved?: ResolvedPlace;
  current?: ForecastCurrent;
  hourly?: ForecastHourlyPoint[];
}

export interface CacheState {
  state: 'fresh' | 'fetched' | 'stale';
  fetchedAt: string;
  ageMs: number;
  ttlMs: number;
  lastError?: { code: string; message: string; retryable: boolean; retryAfterMs?: number };
}

export interface WeatherResult {
  record: WeatherRecord;
  forecast: ForecastPayload;
  cache: CacheState;
}

export interface WeatherServiceOptions {
  provider: WeatherProvider;
  now: () => number;
  defaultLocation?: string;
  cacheTtlMs?: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_TTL_MS = 600_000;
const UNITS: readonly WeatherUnits[] = ['metric', 'imperial'];
const STALE_FALLBACK_ERRORS = new Set(['RATE_LIMITED', 'TIMEOUT', 'EXTERNAL_FAILURE']);

const isValidDate = (date: string): boolean => {
  if (!DATE_PATTERN.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

const nextUtcDate = (date: string): string => new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);

interface CacheEntry {
  record: WeatherRecord;
  forecast: ForecastPayload;
  fetchedAtMs: number;
}

export class WeatherService {
  private readonly ttlMs: number;
  private readonly defaultLocation: string | undefined;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly options: WeatherServiceOptions) {
    this.ttlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 1) throw new Error('Invalid cache TTL');
    this.defaultLocation = options.defaultLocation?.trim() || undefined;
  }

  get providerVerification(): WeatherProvider['verification'] { return this.options.provider.verification; }

  async getForecast(query: WeatherQuery, signal?: AbortSignal): Promise<WeatherResult> {
    const location = (query.location ?? this.defaultLocation ?? '').trim();
    if (!location) throw new ProtocolError('INVALID_ARGUMENT', 'Weather location must come from the request or a configured default; refusing to guess');
    if (query.units !== undefined && !UNITS.includes(query.units)) throw new ProtocolError('INVALID_ARGUMENT', 'units must be metric or imperial');
    const now = this.options.now();
    if (signal?.aborted) throw new ProtocolError('CANCELLED', 'Weather query cancelled');
    const units: WeatherUnits = query.units ?? 'metric';
    const locationQuery = query.locationQuery?.trim() || undefined;
    const identity = locationQuery === undefined ? location : `${location}|${locationQuery}`;
    const abortSignal = signal ?? new AbortController().signal;

    let date: string;
    if (query.date === undefined) {
      // "Today" belongs to the destination, not to UTC: after 16:00Z it is already tomorrow in
      // Beijing and before 05:00Z still yesterday in New York. Resolving first means the cache
      // key is not known until the provider answers, so a failure here cannot fall back to
      // stale data — there is no key to look an entry up by.
      date = localDate((await this.options.provider.resolvePlace(location, locationQuery, abortSignal)).timezone, now);
    } else {
      date = query.date;
      if (!isValidDate(date)) throw new ProtocolError('INVALID_ARGUMENT', 'date must be a valid YYYY-MM-DD calendar date');
    }

    const key = `${identity}|${date}|${units}`;
    const entry = this.cache.get(key);
    if (entry && now - entry.fetchedAtMs < this.ttlMs) {
      return {record: structuredClone(entry.record), forecast: structuredClone(entry.forecast), cache: cacheState('fresh', entry, now, this.ttlMs)};
    }

    const request: ForecastRequest = {location, date, units};
    if (locationQuery !== undefined) request.locationQuery = locationQuery;

    let fetch: ForecastFetch;
    try {
      fetch = await this.options.provider.fetchForecast(request, abortSignal);
    } catch (error) {
      if (signal?.aborted) throw new ProtocolError('CANCELLED', 'Weather query cancelled');
      if (entry && error instanceof ProtocolError && STALE_FALLBACK_ERRORS.has(error.code)) {
        const stale = cacheState('stale', entry, now, this.ttlMs);
        stale.lastError = {code: error.code, message: error.message, retryable: error.retryable};
        if (error.retryAfterMs !== undefined) stale.lastError.retryAfterMs = error.retryAfterMs;
        return {record: structuredClone(entry.record), forecast: structuredClone(entry.forecast), cache: stale};
      }
      throw error;
    }

    if (signal?.aborted) throw new ProtocolError('CANCELLED', 'Weather query cancelled');
    const fetchedAtMs = this.options.now();
    const validFor = fetch.coverage
      ? `${fetch.coverage.start}/${fetch.coverage.end}`
      : `${date}T00:00:00.000Z/${nextUtcDate(date)}T00:00:00.000Z`;
    const record: WeatherRecord = {
      source: this.options.provider.source,
      accountRef: 'weather',
      externalId: `${identity}|${date}|${units}`,
      occurredAt: fetch.publishedAt,
      fetchedAt: new Date(fetchedAtMs).toISOString(),
      contentRef: `weather://forecast/${encodeURIComponent(identity)}/${date}?units=${units}`,
      sensitivity: 'public',
      dedupeKey: `${this.options.provider.source}:${identity}:${date}:${units}`,
      validFor,
    };
    validateContract('connectorItem', record);
    const forecast: ForecastPayload = {
      location, date, units,
      summary: fetch.summary,
      temperatureMin: fetch.temperatureMin,
      temperatureMax: fetch.temperatureMax,
      precipitationProbability: fetch.precipitationProbability,
      publishedTimeKind: fetch.publishedTimeKind,
    };
    if (fetch.resolved) forecast.resolved = fetch.resolved;
    if (fetch.current) forecast.current = fetch.current;
    if (fetch.hourly?.length) forecast.hourly = fetch.hourly;
    const fresh: CacheEntry = {record, forecast, fetchedAtMs};
    this.cache.set(key, fresh);
    return {record: structuredClone(fresh.record), forecast: structuredClone(fresh.forecast), cache: cacheState('fetched', fresh, fetchedAtMs, this.ttlMs)};
  }
}

function cacheState(state: CacheState['state'], entry: CacheEntry, now: number, ttlMs: number): CacheState {
  return {state, fetchedAt: new Date(entry.fetchedAtMs).toISOString(), ageMs: Math.max(0, now - entry.fetchedAtMs), ttlMs};
}

/**
 * Assembled from `formatToParts` rather than a locale format shortcut such as `en-CA`, whose
 * field order is implementation-defined. The zone arrives from the provider, so a platform that
 * cannot resolve it is an upstream data fault rather than a bad argument.
 */
function localDate(timeZone: string, nowMs: number): string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'});
  } catch {
    throw new ProtocolError('EXTERNAL_FAILURE', `Cannot resolve timezone ${timeZone}`, false);
  }
  const fields: Record<string, string> = {};
  for (const part of format.formatToParts(new Date(nowMs))) fields[part.type] = part.value;
  const year = fields.year; const month = fields.month; const day = fields.day;
  if (!year || !month || !day) throw new ProtocolError('EXTERNAL_FAILURE', `Cannot resolve timezone ${timeZone}`, false);
  return `${year}-${month}-${day}`;
}
