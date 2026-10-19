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

test('the weather public projection publishes only the weather, never the place resolution', async () => {
  const host = createPublicConnectorHost({researchProvider: new OpenAlexProvider({fetchImpl: async () => {throw Error('unused');}})});
  try {
    const policy = host.competitionToolExports.find(item => item.toolName === 'weather.forecast');
    const result = await policy.project({signal: new AbortController().signal, result: {
      forecast: {location: '北京', date: '2026-10-19', units: 'metric', summary: '晴',
        temperatureMin: 8, temperatureMax: 19, precipitationProbability: 12, publishedTimeKind: 'coverage_start',
        resolved: {name: '北京', latitude: 39.9, longitude: 116.4, timezone: 'Asia/Shanghai', ambiguous: true,
          alternatives: ['北京, 重庆市, 中国', '北京, 四川省, 中国'], confidence: 'high', featureCode: 'PPLC'}},
      record: {source: 'open-meteo', occurredAt: '2026-10-19T00:00:00.000Z'},
      cache: {state: 'fresh', fetchedAt: '2026-10-19T00:00:00.000Z', ageMs: 0, ttlMs: 1},
    }});
    assert.equal(result.forecast.location, '北京');
    assert.equal(result.forecast.temperatureMax, 19);
    assert.ok(!('resolved' in result.forecast), 'projection strips the resolution block even if the service payload had one');
    assert.ok(!JSON.stringify(result).includes('Asia/Shanghai') && !JSON.stringify(result).includes('"confidence"'),
      'no resolution marker or confidence wording may leak into the public projection');
  } finally {host.close();}
});
