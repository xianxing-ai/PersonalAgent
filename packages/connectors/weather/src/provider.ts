import { ProtocolError } from '@personal-agent/contracts';

export type WeatherUnits = 'metric' | 'imperial';

/**
 * `coverage_start` means the provider exposed no issuance timestamp, so `publishedAt`
 * is the start of the covered local day rather than a real publish instant.
 */
export type PublishedTimeKind = 'provider_published' | 'coverage_start';

/**
 * `low` means the best match is a small same-name place or a non-city record, so the
 * intended location was probably not found. It is a verdict on the match, not on the
 * weather data, and it is deliberately not corrected in place.
 */
export type PlaceConfidence = 'high' | 'low';

export interface ResolvedPlace {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone: string;
  ambiguous: boolean;
  alternatives: string[];
  confidence: PlaceConfidence;
  /** GeoNames feature class behind `confidence`, disclosed so the verdict is auditable. */
  featureCode?: string;
}

export interface ForecastRequest {
  location: string;
  date: string;
  units: WeatherUnits;
  /**
   * Latin or local-script spelling used only to search when `location` matched nothing
   * usable. The geocoding index never matches across scripts, so a Chinese `location`
   * needs this to reach the intended foreign city.
   */
  locationQuery?: string;
}

/**
 * Present conditions at the provider's own observation instant. Optional because a provider may
 * only publish a daily aggregate; when present it lets a caller answer "is it a good time to go
 * out" instead of only quoting a daily range.
 */
export interface ForecastCurrent {
  /** ISO instant the provider reports for these values. */
  observedAt: string;
  temperature: number;
  apparentTemperature: number | null;
  relativeHumidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  weatherCode: number | null;
}

/** One local hour of the requested day, in the provider's order. */
export interface ForecastHourlyPoint {
  /** Local time as `YYYY-MM-DDTHH:mm` in the resolved place's timezone. */
  time: string;
  temperature: number;
  precipitationProbability: number | null;
  weatherCode: number | null;
}

export interface ForecastFetch {
  summary: string;
  temperatureMin: number;
  temperatureMax: number;
  precipitationProbability: number | null;
  publishedAt: string;
  publishedTimeKind: PublishedTimeKind;
  coverage?: {start: string; end: string};
  resolved?: ResolvedPlace;
  current?: ForecastCurrent;
  hourly?: ForecastHourlyPoint[];
}

export interface WeatherProvider {
  readonly source: string;
  readonly verification: 'mock' | 'verified' | 'conditional';
  /**
   * Resolves a place on its own, so a caller can learn its timezone before knowing the date.
   * Providers that also resolve inside `fetchForecast` must return the same place from both
   * paths, or the date and the coordinates will disagree.
   */
  resolvePlace(location: string, locationQuery: string | undefined, signal: AbortSignal): Promise<ResolvedPlace>;
  fetchForecast(request: ForecastRequest, signal: AbortSignal): Promise<ForecastFetch>;
}

export interface FixtureForecast {
  location: string;
  date: string;
  summary: string;
  temperatureMinC: number;
  temperatureMaxC: number;
  precipitationProbability: number;
  publishedAt: string;
  /** IANA zone used to derive a default date. Without it the fixture claims no local day. */
  timezone?: string;
}

export const defaultWeatherFixtures: FixtureForecast[] = [
  {location: 'Beijing', date: '2026-09-05', summary: '晴转多云', temperatureMinC: 18, temperatureMaxC: 28, precipitationProbability: 10, publishedAt: '2026-09-05T08:30:00.000Z', timezone: 'Asia/Shanghai'},
  {location: 'Beijing', date: '2026-09-06', summary: '多云，午后局部阵雨', temperatureMinC: 17, temperatureMaxC: 26, precipitationProbability: 40, publishedAt: '2026-09-05T08:30:00.000Z', timezone: 'Asia/Shanghai'},
  {location: 'Shanghai', date: '2026-09-05', summary: '多云', temperatureMinC: 23, temperatureMaxC: 30, precipitationProbability: 20, publishedAt: '2026-09-05T08:30:00.000Z', timezone: 'Asia/Shanghai'},
  {location: 'Hangzhou', date: '2026-09-05', summary: '小雨', temperatureMinC: 22, temperatureMaxC: 27, precipitationProbability: 70, publishedAt: '2026-09-05T08:30:00.000Z', timezone: 'Asia/Shanghai'},
];

const toFahrenheit = (celsius: number): number => Math.round((celsius * 9 / 5 + 32) * 10) / 10;

export class FakeWeatherProvider implements WeatherProvider {
  readonly source = 'fixture-weather';
  readonly verification = 'mock' as const;
  private calls = 0;
  private resolves = 0;
  private failure: ProtocolError | null = null;
  constructor(private readonly fixtures: FixtureForecast[] = defaultWeatherFixtures) {}
  get fetchCalls(): number { return this.calls; }
  /** Counted separately because a cache hit still resolves the place to derive a default date. */
  get resolveCalls(): number { return this.resolves; }
  setFailure(error: ProtocolError | null): void { this.failure = error; }

  async resolvePlace(location: string, locationQuery: string | undefined): Promise<ResolvedPlace> {
    this.resolves++;
    // Deliberately ignores `failure`: this is a local fixture lookup with no I/O, while
    // `setFailure` models the forecast fetch failing. A provider whose resolution can fail
    // independently needs its own stub.
    const fixture = this.lookup(location, locationQuery);
    if (!fixture) throw new ProtocolError('NOT_FOUND', `Fixture has no place named ${location}`);
    const place: ResolvedPlace = {
      name: fixture.location,
      // The fixture set carries no geography, and these never reach a forecast payload because
      // `fetchForecast` below does not report `resolved`. They satisfy the contract, nothing more.
      latitude: 0,
      longitude: 0,
      timezone: fixture.timezone ?? 'UTC',
      ambiguous: false,
      alternatives: [],
      confidence: 'high',
    };
    return place;
  }

  async fetchForecast(request: ForecastRequest): Promise<ForecastFetch> {
    this.calls++;
    if (this.failure) throw this.failure;
    const fixture = this.lookup(request.location, request.locationQuery, request.date);
    if (!fixture) {
      throw new ProtocolError('NOT_FOUND', `Fixture has no forecast for ${request.location} on ${request.date}`);
    }
    return {
      summary: fixture.summary,
      temperatureMin: request.units === 'imperial' ? toFahrenheit(fixture.temperatureMinC) : fixture.temperatureMinC,
      temperatureMax: request.units === 'imperial' ? toFahrenheit(fixture.temperatureMaxC) : fixture.temperatureMaxC,
      precipitationProbability: fixture.precipitationProbability,
      publishedAt: fixture.publishedAt,
      publishedTimeKind: 'provider_published',
    };
  }

  /**
   * The hint is a fallback, so it is only consulted when the original spelling matched nothing.
   * `date` is omitted by `resolvePlace`, which runs before the date is known.
   */
  private lookup(location: string, locationQuery: string | undefined, date?: string): FixtureForecast | undefined {
    const byName = (name: string): FixtureForecast | undefined =>
      this.fixtures.find(item => item.location === name && (date === undefined || item.date === date));
    return byName(location) ?? (locationQuery === undefined ? undefined : byName(locationQuery));
  }
}
