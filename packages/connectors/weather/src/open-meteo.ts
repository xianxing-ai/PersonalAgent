import { ProtocolError } from '@personal-agent/contracts';
import type { ForecastCurrent, ForecastFetch, ForecastHourlyPoint, ForecastRequest, PlaceConfidence, ResolvedPlace, WeatherProvider } from './provider.js';
import { aliasForPlace } from './locale-aliases.js';

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init: {signal: AbortSignal; headers: Record<string, string>}) => Promise<FetchResponseLike>;

/** `strict` refuses a low-confidence match instead of accepting the provider's top ranking. */
export type LocationResolution = 'ranked' | 'strict';

export interface OpenMeteoOptions {
  fetchImpl?: FetchLike;
  language?: string;
  locationResolution?: LocationResolution;
  forecastBaseUrl?: string;
  geocodingBaseUrl?: string;
  geocodeCacheLimit?: number;
  /** Place resolution expires independently of the forecast cache. Default: 24 hours. */
  geocodeCacheTtlMs?: number;
  now?: () => number;
  /** Population floor for trusting a match that is not an administrative seat. See `assessConfidence`. */
  minCorroboratedPopulation?: number;
  /**
   * Population floor for trusting a *minor* administrative seat (PPLA2–PPLA5). Measured gap:
   * the wrong minor-seat misresolutions carry 14574 (凤凰 → Chongqing PPLA4) and 1733
   * (开罗 → Cairo, Illinois PPLA2), while the smallest correct one carries 211151 (丽江市,
   * PPLA2). 100000 falls inside that gap. A proven alternate name (GeoNames `name_equals`)
   * corroborates a minor seat regardless of population.
   */
  minMinorSeatPopulation?: number;
  /**
   * GeoNames official API account. When set, Han-script inputs get an extra exact-name tier
   * (`name_equals`) that Open-Meteo's per-language index cannot answer: its `zh` index is
   * Traditional and incomplete, so simplified foreign city names fail outright. Inject at
   * assembly from the environment; never commit an account into the repo. Failures of this
   * tier degrade to the Open-Meteo-only behaviour.
   */
  geonamesUsername?: string;
  /** Test seam for the GeoNames tier. */
  geonamesBaseUrl?: string;
}

interface GeoCandidate {
  id?: number;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  admin1?: string;
  country?: string;
  population?: number;
  featureCode?: string;
  /** True when the input string is a documented alternate name of this place (GeoNames `name_equals`). */
  exactName?: boolean;
}

/** A place after merging every language pass that returned it. */
interface MergedPlace {
  /** From the preferred language pass when it carried the place, otherwise the fallback. */
  candidate: GeoCandidate;
  /** Normalized name variants across passes, used for exact matching. */
  names: string[];
  population: number;
  featureCode: string | undefined;
  /** First-seen position, so ranking stays stable when population is unknown. */
  order: number;
  /** Set when any pass reported the query as a documented alternate name of this place. */
  exactNameMatch?: boolean;
}

const USER_AGENT = 'personal-agent-weather/0.1.0-alpha.1';
const FORECAST_BASE_URL = 'https://api.open-meteo.com';
const GEOCODING_BASE_URL = 'https://geocoding-api.open-meteo.com';
const GEONAMES_BASE_URL = 'https://secure.geonames.org';
const MS_PER_DAY = 86_400_000;
const MAX_CANDIDATES = 5;
/** GeoNames ids normalized through `/v1/get` per resolve; small on purpose, they run in parallel. */
const GEONAMES_MAX_IDS = 5;
const MAX_ALTERNATIVES = 4;
const DEFAULT_GEOCODE_CACHE_LIMIT = 500;

/**
 * Calibrated on a gap measured against the production endpoint on 2026-09-06, not on a round
 * number: the worst misresolution (伦敦 → London, Ontario) carried 422324 people, while the
 * correct non-admin-seat city (New York) carried 8804190. Anything between those two figures
 * is unmeasured territory. The two documented judgement errors are both addressed elsewhere:
 * wrong minor-seat matches by `DEFAULT_MIN_MINOR_SEAT_POPULATION`, and correct
 * no-population places by the GeoNames exact-name tier (`exactNameMatch`). The rule detects a
 * bad match; it does not repair it.
 */
const DEFAULT_MIN_CORROBORATED_POPULATION = 500_000;

/**
 * Calibrated on the gap between the smallest correct minor seat measured (丽江市, PPLA2,
 * 211151) and the wrong minor seats the misresolutions carried (凤凰 → Chongqing PPLA4 14574,
 * `Pingyao` → Zhejiang PPLA4, `Wuyuan` → Zhejiang PPLA3, 开罗 → Illinois PPLA2 1733). Anything
 * between 14574 and 211151 is unmeasured territory.
 */
const DEFAULT_MIN_MINOR_SEAT_POPULATION = 100_000;

/** GeoNames marks every inhabited place `PPL*`; `PCLI`, `PCL*`, `ADM*` and `MT` are not places a forecast can answer for. */
const POPULATED_PLACE_PREFIX = 'PPL';

/** A capital or first-level seat is corroborated by its own record, however small its population. */
const MAJOR_ADMIN_SEAT_CODES: ReadonlySet<string> = new Set(['PPLC', 'PPLA']);
/** Minor seats (second-level and below) still need population or a proven alternate name. */
const MINOR_ADMIN_SEAT_CODES: ReadonlySet<string> = new Set(['PPLA2', 'PPLA3', 'PPLA4', 'PPLA5']);

/**
 * Han ideographs including the compatibility block. Japanese kanji match, which is intended:
 * GeoNames' `zh` index carries 東京. Kana and Hangul do not match, and their coverage is unmeasured.
 */
const HAN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function assessConfidence(featureCode: string | undefined, population: number,
  minCorroboratedPopulation: number, minMinorSeatPopulation: number, exactNameMatch: boolean): PlaceConfidence {
  if (featureCode === undefined || !featureCode.startsWith(POPULATED_PLACE_PREFIX)) return 'low';
  if (MAJOR_ADMIN_SEAT_CODES.has(featureCode)) return 'high';
  if (MINOR_ADMIN_SEAT_CODES.has(featureCode)) {
    return population >= minMinorSeatPopulation || exactNameMatch ? 'high' : 'low';
  }
  return population >= minCorroboratedPopulation || exactNameMatch ? 'high' : 'low';
}

const WMO_SUMMARY_ZH: Readonly<Record<number, string>> = {
  0: '晴', 1: '大致晴朗', 2: '局部多云', 3: '阴',
  45: '雾', 48: '沉积雾凇',
  51: '小毛毛雨', 53: '中毛毛雨', 55: '大毛毛雨', 56: '小冻毛毛雨', 57: '大冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '小冻雨', 67: '大冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '小阵雨', 81: '中阵雨', 82: '强阵雨', 85: '小阵雪', 86: '大阵雪',
  95: '雷阵雨', 96: '雷阵雨伴小冰雹', 99: '雷阵雨伴大冰雹',
};

const WMO_SUMMARY_EN: Readonly<Record<number, string>> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle', 56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain', 66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snowfall', 73: 'Moderate snowfall', 75: 'Heavy snowfall', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers', 85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};

/** Only Chinese and English summaries are authored; other `language` values localize place names and fall back to English here. */
function summaryFor(code: number | null, language: string): string {
  const zh = language.toLowerCase().startsWith('zh');
  if (code === null) return zh ? '天气状况未提供' : 'Weather condition not provided';
  const table = zh ? WMO_SUMMARY_ZH : WMO_SUMMARY_EN;
  return table[code] ?? (zh ? `未知天气代码 ${code}` : `Unknown weather code ${code}`);
}

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asNumberArray = (value: unknown): (number | null)[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const result: (number | null)[] = [];
  for (const entry of value) {
    if (entry === null) { result.push(null); continue; }
    const numeric = asFiniteNumber(entry);
    if (numeric === undefined) return undefined;
    result.push(numeric);
  }
  return result;
};

const label = (candidate: GeoCandidate): string =>
  [candidate.name, candidate.admin1, candidate.country].filter((part): part is string => typeof part === 'string' && part.length > 0).join(', ');

/**
 * The `current` block is a convenience, never the reason a forecast fails: a provider response
 * without it still answers the daily question. Values keep the request's unit system.
 */
function readCurrent(value: unknown): ForecastCurrent | undefined {
  const block = asRecord(value);
  if (!block) return undefined;
  const temperature = asFiniteNumber(block.temperature_2m);
  const observedAt = typeof block.time === 'string' ? block.time : undefined;
  if (temperature === undefined || observedAt === undefined) return undefined;
  const windDirection = asFiniteNumber(block.wind_direction_10m);
  return {
    observedAt,
    temperature,
    apparentTemperature: asFiniteNumber(block.apparent_temperature) ?? null,
    relativeHumidity: asFiniteNumber(block.relative_humidity_2m) ?? null,
    windSpeed: asFiniteNumber(block.wind_speed_10m) ?? null,
    // Open-Meteo reports 0–360°; anything outside that is an upstream fault, not a direction.
    windDirection: windDirection !== undefined && windDirection >= 0 && windDirection <= 360 ? windDirection : null,
    weatherCode: asFiniteNumber(block.weather_code) ?? null,
  };
}

/** Hourly values are aligned by index; a partial or malformed block is dropped rather than guessed. */
function readHourly(value: unknown, date: string): ForecastHourlyPoint[] {
  const block = asRecord(value);
  if (!block || !Array.isArray(block.time)) return [];
  const times = block.time;
  const temperatures = asNumberArray(block.temperature_2m);
  const precipitation = asNumberArray(block.precipitation_probability);
  const codes = asNumberArray(block.weather_code);
  const points: ForecastHourlyPoint[] = [];
  for (let index = 0; index < times.length; index++) {
    const time = times[index];
    const temperature = temperatures?.[index];
    if (typeof time !== 'string' || !time.startsWith(date) || temperature === null || temperature === undefined) continue;
    const chance = precipitation?.[index];
    const code = codes?.[index];
    points.push({
      time,
      temperature,
      precipitationProbability: chance === null || chance === undefined ? null : Math.round(chance),
      weatherCode: code === null || code === undefined ? null : code,
    });
  }
  return points;
}

/** Different coordinates under the same admin region often produce identical labels; repeating them discloses nothing. */
const distinctLabels = (labels: string[]): string[] => [...new Set(labels)];

function offsetAt(utcMs: number, timeZone: string): number {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const fields: Record<string, string> = {};
  for (const part of format.formatToParts(new Date(utcMs))) fields[part.type] = part.value;
  const year = fields.year; const month = fields.month; const day = fields.day;
  const hour = fields.hour; const minute = fields.minute; const second = fields.second;
  if (!year || !month || !day || !hour || !minute || !second) throw new ProtocolError('EXTERNAL_FAILURE', `Cannot resolve timezone ${timeZone}`, false);
  return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`) - utcMs;
}

/**
 * Resolved through Intl rather than the API's `utc_offset_seconds`, which reflects the
 * offset now and would shift local-day boundaries by an hour across a DST transition.
 */
function zonedDayStartUtc(date: string, timeZone: string): number {
  const naive = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(naive)) throw new ProtocolError('EXTERNAL_FAILURE', `Cannot map ${date} in ${timeZone}`, false);
  const corrected = naive - offsetAt(naive - offsetAt(naive, timeZone), timeZone);
  const result = new Date(corrected);
  if (Number.isNaN(result.getTime())) throw new ProtocolError('EXTERNAL_FAILURE', `Cannot map ${date} in ${timeZone}`, false);
  return corrected;
}

const nextCalendarDate = (date: string): string => new Date(Date.parse(`${date}T00:00:00.000Z`) + MS_PER_DAY).toISOString().slice(0, 10);

const describeError = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class OpenMeteoProvider implements WeatherProvider {
  readonly source = 'open-meteo';
  /** Real provider, but results require outbound network access to succeed. */
  readonly verification = 'conditional' as const;
  private readonly fetchImpl: FetchLike;
  private readonly language: string;
  private readonly locationResolution: LocationResolution;
  private readonly forecastBaseUrl: string;
  private readonly geocodingBaseUrl: string;
  private readonly geocodeCacheLimit: number;
  private readonly minCorroboratedPopulation: number;
  private readonly minMinorSeatPopulation: number;
  private readonly geonamesUsername: string | undefined;
  private readonly geonamesBaseUrl: string;
  private readonly geocodeCache = new Map<string, {place: ResolvedPlace; fetchedAtMs: number}>();
  private readonly geocodeCacheTtlMs: number;
  private readonly now: () => number;

  constructor(options: OpenMeteoOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.language = options.language ?? 'zh';
    this.locationResolution = options.locationResolution ?? 'ranked';
    this.forecastBaseUrl = (options.forecastBaseUrl ?? FORECAST_BASE_URL).replace(/\/+$/, '');
    this.geocodingBaseUrl = (options.geocodingBaseUrl ?? GEOCODING_BASE_URL).replace(/\/+$/, '');
    const limit = options.geocodeCacheLimit ?? DEFAULT_GEOCODE_CACHE_LIMIT;
    if (!Number.isInteger(limit) || limit < 1) throw new Error('geocodeCacheLimit must be a positive integer');
    this.geocodeCacheLimit = limit;
    this.geocodeCacheTtlMs = options.geocodeCacheTtlMs ?? 86_400_000;
    if (!Number.isSafeInteger(this.geocodeCacheTtlMs) || this.geocodeCacheTtlMs < 1) {
      throw new ProtocolError('INVALID_ARGUMENT', 'geocodeCacheTtlMs must be a positive integer');
    }
    this.now = options.now ?? Date.now;
    const floor = options.minCorroboratedPopulation ?? DEFAULT_MIN_CORROBORATED_POPULATION;
    if (!Number.isFinite(floor) || floor < 0) throw new Error('minCorroboratedPopulation must be a non-negative number');
    this.minCorroboratedPopulation = floor;
    const minorFloor = options.minMinorSeatPopulation ?? DEFAULT_MIN_MINOR_SEAT_POPULATION;
    if (!Number.isFinite(minorFloor) || minorFloor < 0) throw new Error('minMinorSeatPopulation must be a non-negative number');
    this.minMinorSeatPopulation = minorFloor;
    this.geonamesUsername = options.geonamesUsername;
    this.geonamesBaseUrl = (options.geonamesBaseUrl ?? GEONAMES_BASE_URL).replace(/\/+$/, '');
  }

  async fetchForecast(request: ForecastRequest, signal: AbortSignal): Promise<ForecastFetch> {
    const place = await this.resolvePlace(request.location, request.locationQuery, signal);
    const temperatureUnit = request.units === 'imperial' ? 'fahrenheit' : 'celsius';
    const url = `${this.forecastBaseUrl}/v1/forecast`
      + `?latitude=${place.latitude}&longitude=${place.longitude}`
      + '&daily=temperature_2m_min,temperature_2m_max,precipitation_probability_max,weather_code'
      // Present conditions and the requested day's hourly curve are what turn a daily range into
      // an actionable answer ("下午适合跑步吗"). Both blocks are optional on read-back.
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code'
      + '&hourly=temperature_2m,precipitation_probability,weather_code'
      + `&timezone=${encodeURIComponent(place.timezone)}`
      + `&start_date=${request.date}&end_date=${request.date}`
      + `&temperature_unit=${temperatureUnit}`;
    const payload = await this.getJson(url, signal);
    const body = asRecord(payload);
    const daily = asRecord(body?.daily);
    if (!body || !daily) throw new ProtocolError('EXTERNAL_FAILURE', 'Open-Meteo forecast response is missing the daily block', true);

    const times = daily.time;
    if (!Array.isArray(times) || times.length !== 1 || times[0] !== request.date) {
      throw new ProtocolError('NOT_FOUND', `Open-Meteo returned no daily forecast for ${place.name} on ${request.date}`, false);
    }
    const temperatureMin = asNumberArray(daily.temperature_2m_min)?.[0] ?? null;
    const temperatureMax = asNumberArray(daily.temperature_2m_max)?.[0] ?? null;
    if (temperatureMin === null || temperatureMax === null) {
      throw new ProtocolError('NOT_FOUND', `Open-Meteo has no temperature values for ${place.name} on ${request.date}`, false);
    }

    const precipitationRaw = asNumberArray(daily.precipitation_probability_max)?.[0] ?? null;
    if (precipitationRaw !== null && (precipitationRaw < 0 || precipitationRaw > 100)) {
      throw new ProtocolError('EXTERNAL_FAILURE', `Open-Meteo precipitation probability out of range: ${precipitationRaw}`, true);
    }
    const codes = asNumberArray(daily.weather_code);
    const code = codes?.[0] ?? null;

    const dayStart = zonedDayStartUtc(request.date, place.timezone);
    const coverageStart = new Date(dayStart).toISOString();
    const fetch: ForecastFetch = {
      summary: summaryFor(code, this.language),
      temperatureMin,
      temperatureMax,
      precipitationProbability: precipitationRaw === null ? null : Math.round(precipitationRaw),
      publishedAt: coverageStart,
      publishedTimeKind: 'coverage_start',
      coverage: {start: coverageStart, end: new Date(zonedDayStartUtc(nextCalendarDate(request.date), place.timezone)).toISOString()},
      resolved: place,
    };
    const current = readCurrent(body.current);
    if (current) fetch.current = current;
    const hourly = readHourly(body.hourly, request.date);
    if (hourly.length) fetch.hourly = hourly;
    return fetch;
  }

  /**
   * Resolves a place name, disclosing how much the match can be trusted.
   *
   * The hint is a fallback tier and never an equal one: measured on 2026-09-06, `婺源`
   * resolves correctly from Chinese while its Latin hint `Wuyuan` ranks a different county
   * in Zhejiang first. Merging both pools would let a wrong hint outrank a right input, so
   * the hint is only consulted when the original matched nothing or matched weakly.
   */
  async resolvePlace(location: string, locationQuery: string | undefined, signal: AbortSignal): Promise<ResolvedPlace> {
    const trimmed = location.trim();
    if (!trimmed) throw new ProtocolError('INVALID_ARGUMENT', 'Weather location must not be empty; refusing to guess', false);
    const hint = locationQuery?.trim() || undefined;
    // The hint changes which place a string resolves to, so it has to be part of the key.
    if (signal.aborted) throw new ProtocolError('CANCELLED', 'Weather resolution cancelled');
    const cacheKey = JSON.stringify([this.language, normalize(location), normalize(hint ?? '')]);
    const cached = this.geocodeCache.get(cacheKey);
    if (cached && this.now() >= cached.fetchedAtMs && this.now() - cached.fetchedAtMs < this.geocodeCacheTtlMs) {
      return structuredClone(cached.place);
    }
    this.geocodeCache.delete(cacheKey);

    let ranked = rankPlaces(await this.searchPasses(trimmed, signal), normalize(trimmed));
    if (hint !== undefined && (ranked[0] === undefined || this.confidenceOf(ranked[0]) === 'low')) {
      const hinted = rankPlaces(await this.searchPasses(hint, signal), normalize(hint));
      if (hinted[0] !== undefined && this.confidenceOf(hinted[0]) === 'high') ranked = hinted;
    }
    // Offline tier, consulted only when nothing matched at all and after the caller's own hint,
    // so an explicit spelling always wins and no existing low-confidence verdict is rewritten.
    // The shipped table exists because the `zh` index answers neither 纽约 nor 首尔 at all, and
    // the GeoNames tier that would cover them needs an account at assembly time; a repository
    // that only works once every machine exports an environment variable is not fixed.
    if (ranked[0] === undefined) {
      const alias = aliasForPlace(trimmed);
      if (alias !== undefined) {
        const aliased = rankPlaces(await this.searchPasses(alias, signal), normalize(alias));
        if (aliased[0] !== undefined && this.confidenceOf(aliased[0]) === 'high') ranked = aliased;
      }
    }

    const top = ranked[0];
    if (!top) throw new ProtocolError('NOT_FOUND', noPlaceFound(location, hint), false);

    const confidence = this.confidenceOf(top);
    if (confidence === 'low' && this.locationResolution === 'strict') {
      throw new ProtocolError('INVALID_ARGUMENT', strictRefusal(location, top, ranked), false);
    }

    const best = top.candidate;
    const place: ResolvedPlace = {
      name: best.name,
      latitude: best.latitude,
      longitude: best.longitude,
      timezone: best.timezone,
      ambiguous: ranked.length > 1,
      alternatives: distinctLabels(ranked.slice(1).map(entry => label(entry.candidate))).slice(0, MAX_ALTERNATIVES),
      confidence,
    };
    if (best.admin1 !== undefined) place.admin1 = best.admin1;
    if (best.country !== undefined) place.country = best.country;
    // From the merged entry, not the display candidate: this is the value `confidence` was
    // computed from, and disclosing a different one would make the verdict unauditable.
    if (top.featureCode !== undefined) place.featureCode = top.featureCode;

    if (this.geocodeCache.size >= this.geocodeCacheLimit) {
      const oldest = this.geocodeCache.keys().next().value;
      if (oldest !== undefined) this.geocodeCache.delete(oldest);
    }
    this.geocodeCache.set(cacheKey, {place, fetchedAtMs: this.now()});
    return structuredClone(place);
  }

  private confidenceOf(place: MergedPlace): PlaceConfidence {
    return assessConfidence(place.featureCode, place.population,
      this.minCorroboratedPopulation, this.minMinorSeatPopulation, place.exactNameMatch === true);
  }

  /**
   * Open-Meteo indexes place names per language and never matches across scripts. Measured on
   * 2026-09-06: a Chinese string returns zero results under `language=en` — including the
   * traditional spellings 東京 and 倫敦 — and `zh-TW`/`zh-Hant` are empty as well. So the pass set
   * has to follow the input's script, not the configured language; the previous single pass under
   * an English configuration made every Chinese input fail outright.
   *
   * Merge order is the display-name preference: the GeoNames exact-name tier first, then the
   * configured language, then `zh` for Han input, then `en`. The tier runs before the language
   * passes so a place found only there still supplies the display name from `/v1/get`. This
   * still does not make resolution script-independent without an account — the `zh` index is
   * incomplete in both directions, which is what the hint tier exists for.
   */
  private async searchPasses(query: string, signal: AbortSignal): Promise<MergedPlace[]> {
    const han = HAN_PATTERN.test(query);
    const languages: string[] = [];
    for (const language of [this.language, ...(han ? ['zh'] : []), 'en']) {
      if (!languages.some(known => known.toLowerCase() === language.toLowerCase())) languages.push(language);
    }
    const passes = await Promise.all([
      han ? this.geonamesPass(query, signal) : Promise.resolve([] as GeoCandidate[]),
      ...languages.map(language => this.searchPlaces(query, language, signal)),
    ]);
    return mergePlaces(passes);
  }

  private async searchPlaces(location: string, language: string, signal: AbortSignal): Promise<GeoCandidate[]> {
    const url = `${this.geocodingBaseUrl}/v1/search`
      + `?name=${encodeURIComponent(location)}&count=${MAX_CANDIDATES}`
      + `&language=${encodeURIComponent(language)}&format=json`;
    const body = asRecord(await this.getJson(url, signal));
    return readCandidates(body?.results);
  }

  /**
   * Exact-name tier over the GeoNames official API, gated on an assembly-provided account.
   * `name_equals` matches documented alternate names in any script, so simplified Chinese
   * queries reach places Open-Meteo's Traditional-and-incomplete `zh` index lacks (纽约,
   * 首尔, 开罗 …). Each hit is normalized through Open-Meteo's `/v1/get` by the GeoNames id
   * both sources share. Best-effort: any failure skips the tier and the resolve degrades to
   * the Open-Meteo-only behaviour instead of failing the query. A GeoNames error payload is
   * `{"status": {...}}` with a non-2xx HTTP status, so it surfaces as a thrown error here.
   */
  private async geonamesPass(query: string, signal: AbortSignal): Promise<GeoCandidate[]> {
    if (this.geonamesUsername === undefined) return [];
    try {
      const url = `${this.geonamesBaseUrl}/searchJSON`
        + `?name_equals=${encodeURIComponent(query)}&maxRows=${GEONAMES_MAX_IDS}`
        + `&featureClass=P&lang=${encodeURIComponent(this.language)}`
        + `&username=${encodeURIComponent(this.geonamesUsername)}`;
      const body = asRecord(await this.getJson(url, signal));
      if (body?.status !== undefined) return [];
      const ids = readGeonamesIds(body?.geonames);
      const normalized = await Promise.all(ids.map(id => this.fetchNormalizedById(id, signal)));
      return normalized
        .filter((candidate): candidate is GeoCandidate => candidate !== undefined)
        .map(candidate => ({...candidate, exactName: true}));
    } catch (error) {
      if (error instanceof ProtocolError && error.code === 'CANCELLED') throw error;
      return [];
    }
  }

  /** `/v1/get` returns the same field names as `/v1/search`, keyed by the shared GeoNames id. */
  private async fetchNormalizedById(id: number, signal: AbortSignal): Promise<GeoCandidate | undefined> {
    const url = `${this.geocodingBaseUrl}/v1/get?id=${id}&language=${encodeURIComponent(this.language)}&format=json`;
    try {
      const body = asRecord(await this.getJson(url, signal));
      return body === undefined ? undefined : readCandidates([body])[0];
    } catch (error) {
      if (error instanceof ProtocolError && error.code === 'NOT_FOUND') return undefined;
      throw error;
    }
  }

  private async getJson(url: string, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new ProtocolError('CANCELLED', 'Weather request cancelled', false);
    let response: FetchResponseLike;
    try {
      response = await this.fetchImpl(url, {signal, headers: {'user-agent': USER_AGENT, accept: 'application/json'}});
    } catch (error) {
      if (signal.aborted) throw new ProtocolError('CANCELLED', 'Weather request cancelled', false);
      throw new ProtocolError('EXTERNAL_FAILURE', `Open-Meteo request failed: ${describeError(error)}`, true);
    }
    if (response.status === 429) throw new ProtocolError('RATE_LIMITED', 'Open-Meteo rate limit reached', true, 60_000);
    if (response.status === 404) throw new ProtocolError('NOT_FOUND', 'Open-Meteo has no data for this request', false);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (!response.ok) throw new ProtocolError('EXTERNAL_FAILURE', `Open-Meteo returned HTTP ${response.status}`, response.status >= 500);
      throw new ProtocolError('EXTERNAL_FAILURE', `Open-Meteo returned malformed JSON: ${describeError(error)}`, true);
    }
    const body = asRecord(payload);
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;
    if (!response.ok || body?.error === true) throw providerFailure(response.status, reason);
    return payload;
  }
}

/**
 * A 400 carrying "out of allowed range" means the date sits outside the model horizon,
 * i.e. no forecast exists for it — not that the caller sent a malformed date.
 */
function providerFailure(status: number, reason: string | undefined): ProtocolError {
  if (reason && /out of allowed range/i.test(reason)) {
    return new ProtocolError('NOT_FOUND', `Open-Meteo has no forecast for the requested date (${reason})`, false);
  }
  if (status === 400) return new ProtocolError('INVALID_ARGUMENT', `Open-Meteo rejected the request: ${reason ?? 'unspecified reason'}`, false);
  return new ProtocolError('EXTERNAL_FAILURE', `Open-Meteo returned HTTP ${status}${reason ? `: ${reason}` : ''}`, status >= 500);
}

function readCandidates(value: unknown): GeoCandidate[] {
  if (!Array.isArray(value)) return [];
  const candidates: GeoCandidate[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const name = record.name; const timezone = record.timezone;
    const latitude = asFiniteNumber(record.latitude); const longitude = asFiniteNumber(record.longitude);
    if (typeof name !== 'string' || name.length === 0) continue;
    if (typeof timezone !== 'string' || timezone.length === 0) continue;
    if (latitude === undefined || longitude === undefined) continue;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;
    const candidate: GeoCandidate = {name, latitude, longitude, timezone};
    const id = asFiniteNumber(record.id);
    if (id !== undefined) candidate.id = Math.trunc(id);
    if (typeof record.admin1 === 'string' && record.admin1.length > 0) candidate.admin1 = record.admin1;
    if (typeof record.country === 'string' && record.country.length > 0) candidate.country = record.country;
    const population = asFiniteNumber(record.population);
    if (population !== undefined && population >= 0) candidate.population = population;
    if (typeof record.feature_code === 'string' && record.feature_code.length > 0) candidate.featureCode = record.feature_code;
    candidates.push(candidate);
  }
  return candidates;
}

/** GeoNames search entries carry `geonameId`; everything else is re-fetched normalized. */
function readGeonamesIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids: number[] = [];
  for (const entry of value) {
    const id = asFiniteNumber(asRecord(entry)?.geonameId);
    if (id !== undefined && Number.isSafeInteger(id) && id > 0) ids.push(Math.trunc(id));
  }
  return ids;
}

/**
 * Keyed by GeoNames id, falling back to rounded coordinates for entries without one, so the
 * same place returned by several language passes collapses into a single candidate. Passes are
 * consumed in display-preference order, so the first one carrying a place supplies its name.
 */
function mergePlaces(passes: GeoCandidate[][]): MergedPlace[] {
  const byKey = new Map<string, MergedPlace>();
  let order = 0;
  for (const pass of passes) {
    for (const candidate of pass) {
      const key = candidate.id !== undefined
        ? `id:${candidate.id}`
        : `co:${candidate.latitude.toFixed(2)},${candidate.longitude.toFixed(2)}`;
      const existing = byKey.get(key);
      if (!existing) {
        const entry: MergedPlace = {
          candidate,
          names: [normalize(candidate.name)],
          population: candidate.population ?? 0,
          featureCode: candidate.featureCode,
          order: order++,
        };
        if (candidate.exactName === true) entry.exactNameMatch = true;
        byKey.set(key, entry);
        continue;
      }
      const variant = normalize(candidate.name);
      if (!existing.names.includes(variant)) existing.names.push(variant);
      if (existing.population === 0 && candidate.population !== undefined) existing.population = candidate.population;
      if (existing.featureCode === undefined && candidate.featureCode !== undefined) existing.featureCode = candidate.featureCode;
      if (candidate.exactName === true) existing.exactNameMatch = true;
    }
  }
  return [...byKey.values()];
}

/**
 * Exact name matches outrank the provider's fuzzy ones, and population breaks ties because the
 * provider's own ranking is unreliable across languages: for "New York" the `zh` pass puts
 * York, Nebraska first and omits New York City, which only the `en` pass returns.
 *
 * A place the GeoNames tier reports — `name_equals` proved the query is a documented alternate
 * name of it — counts as exact even when its display name spells differently (伦敦 vs 倫敦):
 * the alternate-name relation is stronger evidence than a spelling collision such as London,
 * Ontario.
 *
 * Region names are deliberately not matched against `admin1` or `country`. Doing so let
 * `Texas` or `France` masquerade as an exact place match; those lookups are surfaced as
 * low confidence by `assessConfidence` instead of being quietly promoted here.
 */
function rankPlaces(places: MergedPlace[], query: string): MergedPlace[] {
  const exact = places.filter(place => place.names.includes(query) || place.exactNameMatch === true);
  const pool = exact.length > 0 ? exact : places;
  return [...pool].sort((a, b) => b.population - a.population || a.order - b.order);
}

/**
 * A zero-candidate Han query is almost always a script mismatch, not a missing city: the
 * provider's `zh` index is Traditional and incomplete, so 纽约 and 首尔 match nothing at all
 * (measured 2026-10-19). Saying which cause applies and which call fixes it is the difference
 * between a caller that recovers on the next attempt and one that reports "not found".
 */
function noPlaceFound(location: string, hint: string | undefined): string {
  const head = `Open-Meteo geocoding found no place named "${location}".`;
  if (!HAN_PATTERN.test(location)) return `${head} Check the spelling.`;
  const cause = ' A Han-script query is matched only against the provider\'s Traditional-Chinese index, which is incomplete, so this is usually a script mismatch rather than a missing place.';
  const next = hint === undefined
    ? ' Retry once with locationQuery set to the English or local spelling (纽约 -> New York, 首尔 -> Seoul).'
    : ` Neither that name nor the hint "${hint}" matched; retry with the English or local spelling.`;
  return `${head}${cause}${next}`;
}

/**
 * Names the evidence behind the refusal so the caller can act on it. Listing candidates
 * without saying why none of them was trusted reads as an arbitrary rejection.
 */
function strictRefusal(location: string, top: MergedPlace, ranked: MergedPlace[]): string {
  const reason = top.featureCode === undefined
    ? 'the best match carries no feature classification'
    : top.featureCode.startsWith(POPULATED_PLACE_PREFIX)
      ? `the best match is a ${top.featureCode} with population ${top.population}`
      : `the best match is a ${top.featureCode} record, not an inhabited place`;
  const options = ranked.slice(0, MAX_ALTERNATIVES + 1).map(place => label(place.candidate)).join(' / ');
  return `Refusing to guess a location for "${location}": ${reason} (${label(top.candidate)}). `
    + `Pass locationQuery with the English or local spelling to search again, or name one of: ${options}`;
}
