import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicConnectorHost} from '../electron/public-connector-host.js';
import {OpenMeteoProvider} from '@personal-agent/weather';
import {OpenAlexProvider} from '@personal-agent/research';

test('public providers assemble without calls and only publish bounded public result fields', async () => {
  let calls = 0;
  const fetchImpl = async () => {calls++; throw Error('Unexpected network call');};
  const host = createPublicConnectorHost({weatherProvider:new OpenMeteoProvider({fetchImpl}),
    researchProvider:new OpenAlexProvider({fetchImpl})});
  try {
    assert.deepEqual(host.tools.map(tool => tool.descriptor.name), ['weather.forecast','research.search']);
    assert.equal(calls, 0);
    const policy = host.competitionToolExports.find(item => item.toolName === 'research.search');
    const context = {signal:new AbortController().signal, result:{results:[{
      record:{contentRef:'Public paper | https://doi.org/example',source:'research',accountRef:'private-account'},
      publishedAt:'2026-09-27T00:00:00.000Z',publishedTimeKind:'date_only',freshness:'fresh',ageMs:0,
    }],cache:{state:'stale',fetchedAt:'2026-09-27T00:00:00.000Z',ageMs:5,ttlMs:1,
      lastError:{code:'EXTERNAL_FAILURE',message:'private error payload',retryable:true}}}};
    const result = await policy.project(context);
    assert.equal(result.results[0].citation, context.result.results[0].record.contentRef);
    assert.equal(result.cache.state, 'stale');
    assert.doesNotMatch(JSON.stringify(result), /private|accountRef|message/);
    const large = await policy.project({...context,result:{...context.result,
      results:Array.from({length:20},()=>({...context.result.results[0],
        record:{...context.result.results[0].record,contentRef:'A public citation '.repeat(80)}}))}});
    assert.ok(Buffer.byteLength(JSON.stringify(large),'utf8')>8192);
    assert.equal(large.results.length,20);
    host.close();
    assert.equal(policy.accepts({}), false);
    await assert.rejects(policy.project(context), /unavailable/);
  } finally {host.close();}
});

/**
 * The GeoNames exact-name tier is the only path that resolves simplified-Chinese foreign city
 * names, so the default provider must pick the account up from the environment: without it
 * 纽约 and 首尔 return zero candidates and the tool answers NOT_FOUND.
 */
test('the default weather provider takes the GeoNames account from the environment', async () => {
  const previous = process.env.PA_GEONAMES_USERNAME;
  const realFetch = globalThis.fetch;
  const urls = [];
  process.env.PA_GEONAMES_USERNAME = 'acct-under-test';
  globalThis.fetch = async url => {urls.push(String(url)); return {ok: false, status: 500, json: async () => ({})};};
  const host = createPublicConnectorHost({researchProvider: new OpenAlexProvider({fetchImpl: async () => {throw Error('unused');}})});
  try {
    const tool = host.tools.find(item => item.descriptor.name === 'weather.forecast');
    await tool.execute({location: '纽约', date: '2026-10-19'}, {signal: new AbortController().signal}).catch(() => {});
    assert.ok(urls.some(url => url.includes('secure.geonames.org') && url.includes('username=acct-under-test')),
      `expected the exact-name tier to be called, got:/n${urls.join('\n')}`);
  } finally {
    host.close();
    globalThis.fetch = realFetch;
    if (previous === undefined) delete process.env.PA_GEONAMES_USERNAME;
    else process.env.PA_GEONAMES_USERNAME = previous;
  }
});

test('without the environment variable the exact-name tier is not called', async () => {
  const previous = process.env.PA_GEONAMES_USERNAME;
  const realFetch = globalThis.fetch;
  const urls = [];
  delete process.env.PA_GEONAMES_USERNAME;
  globalThis.fetch = async url => {urls.push(String(url)); return {ok: false, status: 500, json: async () => ({})};};
  const host = createPublicConnectorHost({researchProvider: new OpenAlexProvider({fetchImpl: async () => {throw Error('unused');}})});
  try {
    const tool = host.tools.find(item => item.descriptor.name === 'weather.forecast');
    await tool.execute({location: '纽约', date: '2026-10-19'}, {signal: new AbortController().signal}).catch(() => {});
    assert.ok(urls.length > 0, 'the geocoding passes still run');
    assert.ok(!urls.some(url => url.includes('secure.geonames.org')), urls.join('\n'));
  } finally {
    host.close();
    globalThis.fetch = realFetch;
    if (previous !== undefined) process.env.PA_GEONAMES_USERNAME = previous;
  }
});

test('the default weather provider refuses weak place matches and accepts a location hint', async () => {
  const previous = process.env.PA_GEONAMES_USERNAME;
  const realFetch = globalThis.fetch;
  const urls = [];
  delete process.env.PA_GEONAMES_USERNAME;
  globalThis.fetch = async input => {
    const url = String(input);
    urls.push(url);
    const parsed = new URL(url);
    if (parsed.hostname === 'geocoding-api.open-meteo.com') {
      const name = parsed.searchParams.get('name');
      const language = parsed.searchParams.get('language');
      const weakLondon = {id: 6058560, name: '伦敦', latitude: 42.98339, longitude: -81.23304,
        timezone: 'America/Toronto', feature_code: 'PPL', population: 422324, admin1: '安大略', country: '加拿大'};
      const london = {id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574,
        timezone: 'Europe/London', feature_code: 'PPLC', population: 8961989, admin1: 'England', country: 'United Kingdom'};
      const results = name === '伦敦' && language === 'zh' ? [weakLondon]
        : name === 'London' && language === 'en' ? [london, weakLondon] : [];
      return {ok: true, status: 200, json: async () => ({results})};
    }
    if (parsed.hostname === 'api.open-meteo.com') {
      const date = parsed.searchParams.get('start_date');
      return {ok: true, status: 200, json: async () => ({
        timezone: parsed.searchParams.get('timezone'),
        daily: {time: [date], temperature_2m_min: [12], temperature_2m_max: [20],
          precipitation_probability_max: [10], weather_code: [3]},
      })};
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const host = createPublicConnectorHost({researchProvider: new OpenAlexProvider({fetchImpl: async () => {throw Error('unused');}})});
  try {
    const tool = host.tools.find(item => item.descriptor.name === 'weather.forecast');
    const context = {signal: new AbortController().signal};
    await assert.rejects(tool.execute({location: '伦敦', date: '2026-10-19'}, context),
      error => error.code === 'INVALID_ARGUMENT' && /locationQuery/.test(error.message));
    assert.ok(!urls.some(url => new URL(url).hostname === 'api.open-meteo.com'), 'weak matches must not fetch a forecast');

    const result = await tool.execute({location: '伦敦', locationQuery: 'London', date: '2026-10-19'}, context);
    assert.equal(result.forecast.location, '伦敦');
    assert.equal(result.forecast.temperatureMax, 20);
    assert.equal(new URL(urls.find(url => new URL(url).hostname === 'api.open-meteo.com')).searchParams.get('timezone'), 'Europe/London');
    assert.ok(!('resolved' in result.forecast));
    assert.doesNotMatch(JSON.stringify(result), /Europe\/London|confidence|timezone/);
  } finally {
    host.close();
    globalThis.fetch = realFetch;
    if (previous !== undefined) process.env.PA_GEONAMES_USERNAME = previous;
  }
});

test('the weather public projection publishes only the weather, never the place resolution', async () => {
  const host = createPublicConnectorHost({researchProvider: new OpenAlexProvider({fetchImpl: async () => {throw Error('unused');}})});
  try {
    const policy = host.competitionToolExports.find(item => item.toolName === 'weather.forecast');
    const result = await policy.project({signal: new AbortController().signal, result: {
      forecast: {location: '北京', date: '2026-10-19', units: 'metric', summary: '晴',
        temperatureMin: 8, temperatureMax: 19, precipitationProbability: 12, publishedTimeKind: 'coverage_start',
        current:{observedAt:'2026-10-19T12:00',temperature:18,apparentTemperature:17,relativeHumidity:50,windSpeed:5,windDirection:90,weatherCode:0,privateField:'omit'},
        hourly:Array.from({length:30},(_,index)=>({time:`hour-${index}`,temperature:18,precipitationProbability:12,weatherCode:0,privateField:'omit'})),
        resolved: {name: '北京', latitude: 39.9, longitude: 116.4, timezone: 'Asia/Shanghai', ambiguous: true,
          alternatives: ['北京, 重庆市, 中国', '北京, 四川省, 中国'], confidence: 'high', featureCode: 'PPLC'}},
      record: {source: 'open-meteo', occurredAt: '2026-10-19T00:00:00.000Z'},
      cache: {state: 'fresh', fetchedAt: '2026-10-19T00:00:00.000Z', ageMs: 0, ttlMs: 1},
    }});
    assert.equal(result.forecast.location, '北京');
    assert.equal(result.forecast.temperatureMax, 19);
    assert.equal(result.forecast.current.temperature,18);
    assert.equal(result.forecast.hourly.length,24,'bounded hourly weather survives the main conflict resolution');
    assert.doesNotMatch(JSON.stringify(result),/privateField/);
    assert.ok(!('resolved' in result.forecast), 'projection strips the resolution block even if the service payload had one');
    assert.ok(!JSON.stringify(result).includes('Asia/Shanghai') && !JSON.stringify(result).includes('"confidence"'),
      'no resolution marker or confidence wording may leak into the public projection');
  } finally {host.close();}
});
