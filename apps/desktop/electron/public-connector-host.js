import * as weather from '@personal-agent/weather';
import * as research from '@personal-agent/research';
import {createProductToolsComposition} from './product-tools-composition.js';

const cacheProjection = cache => ({state:cache.state, fetchedAt:cache.fetchedAt,
  ageMs:cache.ageMs, ttlMs:cache.ttlMs,
  ...(cache.lastError ? {lastError:{code:cache.lastError.code, retryable:cache.lastError.retryable}} : {})});

const researchRetrievalProjection = receipt => ({provider:receipt.provider, sourceUrl:receipt.sourceUrl,
  policy:receipt.policy, rawCount:receipt.rawCount, invalidCount:receipt.invalidCount,
  filteredCount:receipt.filteredCount, returnedCount:receipt.returnedCount, outcome:receipt.outcome,
  message:receipt.message, matches:receipt.matches.slice(0,20).map(match=>({externalId:match.externalId,
    basis:match.basis, terms:match.terms.slice(0,20)})),
  ...(receipt.queryRewrite ? {queryRewrite:{strategy:receipt.queryRewrite.strategy,
    originalQuery:receipt.queryRewrite.originalQuery, effectiveQuery:receipt.queryRewrite.effectiveQuery,
    mappings:receipt.queryRewrite.mappings.map(mapping=>({source:mapping.source,target:mapping.target}))}} : {}),
});

/**
 * The GeoNames exact-name tier is the only path that resolves simplified-Chinese foreign city
 * names: Open-Meteo's `zh` index is Traditional and incomplete, so 纽约 and 首尔 match nothing at
 * all (measured 2026-10-19) and the query fails as NOT_FOUND. The account is read from the
 * environment at construction, never committed; without it the tier is skipped and behaviour is
 * exactly the previous Open-Meteo-only one.
 */
const defaultWeatherProvider = () => new weather.OpenMeteoProvider({
  locationResolution: 'strict',
  ...(process.env.PA_GEONAMES_USERNAME ? {geonamesUsername: process.env.PA_GEONAMES_USERNAME} : {}),
});

/** Real public providers are constructed here; nothing is called until Runtime/Policy permits it.
 * Private mail, workspace contents and machine inventory are not exported by this host.
 */
export function createPublicConnectorHost({systemObservationFactory,
  weatherProvider = defaultWeatherProvider(),
  researchProvider = new research.OpenAlexProvider()} = {}) {
  const publicResult = (name, version, project) => ({toolName:name, toolVersion:version,
    exportPolicyVersion:'public-connector-summary-v1', accepts:() => true,
    project:({result, signal}) => {
      if (signal.aborted) throw Error('Public connector projection cancelled');
      const summary = project(result);
      if (Buffer.byteLength(JSON.stringify(summary), 'utf8') > 960 * 1024) {
        throw Error('Public result is too large; request fewer results');
      }
      return summary;
    }});
  const composition = createProductToolsComposition({
    modules:{weather, research, windows:{createSystemObservationTool:systemObservationFactory}},
    systemObservation:typeof systemObservationFactory === 'function',
    connectors:{
      weather:{enabled:true, options:{provider:weatherProvider}, available:() => true},
      research:{enabled:true, options:{provider:researchProvider}, available:() => true},
    },
    exports:[
      publicResult('weather.forecast', weather.WEATHER_CONNECTOR_VERSION, result => ({
        forecast:{location:result.forecast.location, date:result.forecast.date,
          units:result.forecast.units, summary:result.forecast.summary,
          temperatureMin:result.forecast.temperatureMin, temperatureMax:result.forecast.temperatureMax,
          precipitationProbability:result.forecast.precipitationProbability,
          publishedTimeKind:result.forecast.publishedTimeKind,
          // Present conditions and the day's hourly curve are what let an answer judge
          // "适合跑步吗" instead of only quoting a daily range.
          ...(result.forecast.current ? {current:{observedAt:result.forecast.current.observedAt,
            temperature:result.forecast.current.temperature,
            apparentTemperature:result.forecast.current.apparentTemperature,
            relativeHumidity:result.forecast.current.relativeHumidity,
            windSpeed:result.forecast.current.windSpeed,
            windDirection:result.forecast.current.windDirection,
            weatherCode:result.forecast.current.weatherCode}} : {}),
          ...(Array.isArray(result.forecast.hourly) && result.forecast.hourly.length ? {hourly:
            result.forecast.hourly.slice(0,24).map(point => ({time:point.time, temperature:point.temperature,
              precipitationProbability:point.precipitationProbability, weatherCode:point.weatherCode}))} : {}),
        },
        source:result.record.source, occurredAt:result.record.occurredAt, cache:cacheProjection(result.cache),
      })),
      {...publicResult('research.search', research.RESEARCH_SEARCH_VERSION, result => ({
        results:result.results.map(item => ({citation:item.record.contentRef,
          source:item.record.source, publishedAt:item.publishedAt,
          publishedTimeKind:item.publishedTimeKind, freshness:item.freshness, ageMs:item.ageMs})),
        cache:cacheProjection(result.cache),
        ...(result.retrieval ? {retrieval:researchRetrievalProjection(result.retrieval)} : {}),
      })), exportPolicyVersion:'public-research-retrieval-v2'},
    ],
  });
  return Object.freeze({...composition, competitionToolAvailability:Object.freeze(
    composition.competitionToolAvailability.map(binding=>binding.toolName==='weather.forecast'
      ? {...binding,publicEnumPaths:['/units']} : binding))});
}
