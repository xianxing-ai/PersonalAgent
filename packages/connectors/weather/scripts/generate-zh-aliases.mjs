/**
 * Regenerates `src/locale-aliases.ts`: the offline simplified-Chinese -> searchable-spelling
 * table used when Open-Meteo's `zh` index has no entry for a foreign city.
 *
 * Why this exists: the provider's `zh` index is Traditional and incomplete, so 纽约 and 首尔
 * return zero candidates (measured 2026-10-19) and the tool answers NOT_FOUND. The GeoNames
 * exact-name tier fixes that, but it needs an account at assembly time; a shipped table keeps
 * the repository working without any per-machine configuration.
 *
 * Data path (both public, no key committed):
 *   1. GeoNames `name_equals=<Chinese name>` proves the string is a documented name of a place
 *      **in the country the candidate list expects**. The country is part of the candidate
 *      because homographs are common: 釜山 also matches Foshan (CN) and 奥克兰 also matches
 *      Oakland (US), so a population-only pick ships the wrong city under a successful-looking
 *      result. A candidate with no hit in its expected country is skipped, not guessed.
 *   2. Open-Meteo `name=<toponymName>&language=en` re-checks that the same GeoNames id is
 *      reachable and is a major seat, so the table never points at a village or a dead id.
 *
 * Usage: PA_GEONAMES_USERNAME=<account> node packages/connectors/weather/scripts/generate-zh-aliases.mjs
 * GeoNames attribution: this file contains derived place names from GeoNames (CC BY 4.0).
 */
import {writeFileSync, mkdirSync, readFileSync, existsSync} from 'node:fs';

const GEONAMES = 'https://secure.geonames.org/searchJSON';
const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const USERNAME = process.env.PA_GEONAMES_USERNAME;
if (!USERNAME) throw new Error('PA_GEONAMES_USERNAME is required');
const LIMIT = Number(process.env.LIMIT ?? '0');

/** Cities a Chinese-speaking user actually asks about; domestic names are excluded on purpose
 * because the `zh` index answers those already. */
const CANDIDATES = [
  // 亚洲
  ['东京', 'JP'], ['大阪', 'JP'], ['京都', 'JP'], ['名古屋', 'JP'], ['札幌', 'JP'], ['福冈', 'JP'], ['冲绳', 'JP'],
  ['首尔', 'KR'], ['釜山', 'KR'], ['仁川', 'KR'], ['平壤', 'KP'],
  ['曼谷', 'TH'], ['清迈', 'TH'], ['普吉', 'TH'], ['新加坡', 'SG'], ['吉隆坡', 'MY'], ['雅加达', 'ID'],
  ['巴厘岛', 'ID'], ['马尼拉', 'PH'], ['河内', 'VN'], ['胡志明市', 'VN'],
  ['金边', 'KH'], ['万象', 'LA'], ['仰光', 'MM'], ['新德里', 'IN'], ['孟买', 'IN'], ['班加罗尔', 'IN'],
  ['加尔各答', 'IN'], ['金奈', 'IN'], ['加德满都', 'NP'], ['达卡', 'BD'],
  ['科伦坡', 'LK'], ['伊斯兰堡', 'PK'], ['卡拉奇', 'PK'], ['拉合尔', 'PK'], ['德黑兰', 'IR'], ['巴格达', 'IQ'],
  ['迪拜', 'AE'], ['阿布扎比', 'AE'], ['多哈', 'QA'],
  ['利雅得', 'SA'], ['伊斯坦布尔', 'TR'], ['安卡拉', 'TR'], ['特拉维夫', 'IL'], ['耶路撒冷', 'IL'],
  ['乌兰巴托', 'MN'], ['塔什干', 'UZ'], ['阿拉木图', 'KZ'],
  // 欧洲
  ['伦敦', 'GB'], ['巴黎', 'FR'], ['柏林', 'DE'], ['慕尼黑', 'DE'], ['法兰克福', 'DE'], ['汉堡', 'DE'],
  ['罗马', 'IT'], ['米兰', 'IT'], ['威尼斯', 'IT'], ['佛罗伦萨', 'IT'],
  ['那不勒斯', 'IT'], ['马德里', 'ES'], ['巴塞罗那', 'ES'], ['里斯本', 'PT'], ['阿姆斯特丹', 'NL'],
  ['布鲁塞尔', 'BE'], ['维也纳', 'AT'], ['苏黎世', 'CH'],
  ['日内瓦', 'CH'], ['斯德哥尔摩', 'SE'], ['奥斯陆', 'NO'], ['哥本哈根', 'DK'], ['赫尔辛基', 'FI'],
  ['雷克雅未克', 'IS'], ['都柏林', 'IE'], ['爱丁堡', 'GB'],
  ['华沙', 'PL'], ['布拉格', 'CZ'], ['布达佩斯', 'HU'], ['雅典', 'GR'], ['莫斯科', 'RU'], ['圣彼得堡', 'RU'],
  ['基辅', 'UA'], ['明斯克', 'BY'], ['布加勒斯特', 'RO'],
  ['索非亚', 'BG'], ['贝尔格莱德', 'RS'], ['萨格勒布', 'HR'], ['卢布尔雅那', 'SI'], ['维尔纽斯', 'LT'],
  ['里加', 'LV'], ['塔林', 'EE'],
  // 北美
  ['纽约', 'US'], ['洛杉矶', 'US'], ['旧金山', 'US'], ['西雅图', 'US'], ['芝加哥', 'US'], ['波士顿', 'US'],
  ['华盛顿', 'US'], ['费城', 'US'], ['迈阿密', 'US'],
  ['拉斯维加斯', 'US'], ['休斯敦', 'US'], ['达拉斯', 'US'], ['亚特兰大', 'US'], ['丹佛', 'US'], ['凤凰城', 'US'],
  ['圣地亚哥', 'CL'], ['波特兰', 'US'],
  ['底特律', 'US'], ['多伦多', 'CA'], ['温哥华', 'CA'], ['蒙特利尔', 'CA'], ['渥太华', 'CA'], ['卡尔加里', 'CA'],
  ['墨西哥城', 'MX'], ['坎昆', 'MX'], ['哈瓦那', 'CU'],
  // 南美
  ['圣保罗', 'BR'], ['里约热内卢', 'BR'], ['布宜诺斯艾利斯', 'AR'], ['利马', 'PE'], ['波哥大', 'CO'],
  ['基多', 'EC'], ['加拉加斯', 'VE'],
  ['蒙得维的亚', 'UY'], ['拉巴斯', 'BO'],
  // 非洲
  ['开罗', 'EG'], ['亚历山大', 'EG'], ['内罗毕', 'KE'], ['拉各斯', 'NG'], ['阿克拉', 'GH'], ['亚的斯亚贝巴', 'ET'],
  ['卡萨布兰卡', 'MA'], ['突尼斯', 'TN'],
  ['阿尔及尔', 'DZ'], ['达累斯萨拉姆', 'TZ'], ['约翰内斯堡', 'ZA'], ['开普敦', 'ZA'], ['德班', 'ZA'],
  ['哈拉雷', 'ZW'], ['罗安达', 'AO'],
  // 大洋洲
  ['悉尼', 'AU'], ['墨尔本', 'AU'], ['布里斯班', 'AU'], ['珀斯', 'AU'], ['阿德莱德', 'AU'], ['奥克兰', 'NZ'],
  ['惠灵顿', 'NZ'], ['基督城', 'NZ'], ['檀香山', 'US'],
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {headers: {'user-agent': 'personal-agent-weather-generator/0.1.0'}});
      if (response.status === 429 || response.status >= 500) throw new Error(`${response.status} ${url}`);
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}

/** The table stores a *search string*, so verification asks what a search returns, not whether
 * the GeoNames id exists in the other index: a major seat found under the same spelling is
 * exactly what the runtime lookup will do with this value. */
const isMajorSeat = record =>
  ['PPLC', 'PPLA', 'PPLG'].includes(record.feature_code)
  || (['PPLA2', 'PPLA3', 'PPLA4', 'PPLA5'].includes(record.feature_code) && (record.population ?? 0) >= 100_000)
  || (record.feature_code === 'PPL' && (record.population ?? 0) >= 500_000);

const sameSpelling = (record, spelling) =>
  String(record.name ?? '').trim().toLowerCase() === spelling.trim().toLowerCase();

/** Mirrors `rankPlaces`: exact-spelling matches win, then population decides. */
const runtimeWinner = (results, spelling) => {
  const exact = results.filter(record => sameSpelling(record, spelling));
  const pool = exact.length > 0 ? exact : results;
  return pool.slice().sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
};

const list = LIMIT > 0 ? CANDIDATES.slice(0, LIMIT) : CANDIDATES;
const accepted = {};
const report = [];

/**
 * GeoNames answers a throttled account with HTTP 200 and `{"status": {...}}`, which the previous
 * version read as "no hits" — a truncated table then looked like a successful run. Fail loudly,
 * and cache per query so re-runs and reviews cost no extra credits (the free tier allows 1000
 * credits per hour, and one full pass spends roughly 150).
 */
const GEONAMES_CACHE = new URL('../.cache/geonames/', import.meta.url);
async function geonamesSearch(name) {
  mkdirSync(GEONAMES_CACHE, {recursive: true});
  const file = new URL(`${encodeURIComponent(name)}.json`, GEONAMES_CACHE);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const body = await getJson(`${GEONAMES}?name_equals=${encodeURIComponent(name)}&maxRows=10&featureClass=P&lang=zh&username=${encodeURIComponent(USERNAME)}`);
  if (body && typeof body.status === 'object') {
    throw new Error(`GeoNames ${body.status.value}: ${body.status.message}`);
  }
  writeFileSync(file, JSON.stringify(body));
  await sleep(120);
  return body;
}

for (const [name, country] of list) {
  try {
  const search = await geonamesSearch(name);
  const hits = Array.isArray(search.geonames) ? search.geonames : [];
  if (!hits.length) { report.push([name, 'NO_GEONAMES_HIT', '']); continue; }
  // Bind the country the candidate list meant. `name_equals` also matches homographs abroad —
  // 釜山 returns Foshan (CN) and 奥克兰 returns Oakland (US) — and picking by population alone
  // silently ships the wrong city, which then looks like a successful forecast.
  const inCountry = hits.filter(hit => hit.countryCode === country);
  if (!inCountry.length) {
    const seen = [...new Set(hits.map(hit => hit.countryCode))].join('/');
    report.push([name, 'COUNTRY_MISMATCH', `expected ${country}, hits only ${seen}`]);
    continue;
  }
  const best = inCountry.slice().sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];

  // The record's own English name, not GeoNames' `toponymName`: the runtime searches Open-Meteo,
  // so the stored string has to be a spelling that index actually carries (Montréal -> Montreal,
  // Washington -> Washington D.C., Saint Petersburg -> St Petersburg).
  const record = await getJson(`${GEOCODING.replace('/search', '/get')}?id=${best.geonameId}&language=en&format=json`);
  await sleep(120);
  if (!record || typeof record.name !== 'string') { report.push([name, 'NO_EN_RECORD', best.toponymName]); continue; }
  if (record.country_code !== country) {
    report.push([name, 'EN_RECORD_COUNTRY', `${record.name} ${record.country_code ?? '??'} != ${country}`]);
    continue;
  }

  const local = await getJson(`${GEOCODING}?name=${encodeURIComponent(record.name)}&count=5&language=en&format=json`);
  await sleep(120);
  let winner = runtimeWinner(local.results ?? [], record.name);
  // `/v1/get` and `/v1/search` can disagree on a record's name (Washington vs Washington D.C.).
  // If the search already carries this id under another spelling, verify that spelling instead.
  if (winner !== undefined && winner.id !== record.id) {
    const sameId = (local.results ?? []).find(candidate => candidate.id === record.id);
    if (sameId && sameId.name !== record.name) {
      const retry = await getJson(`${GEOCODING}?name=${encodeURIComponent(sameId.name)}&count=5&language=en&format=json`);
      await sleep(120);
      const retryWinner = runtimeWinner(retry.results ?? [], sameId.name);
      if (retryWinner !== undefined && retryWinner.id === sameId.id) {
        record.name = sameId.name;
        winner = retryWinner;
      }
    }
  }
  if (!winner) { report.push([name, 'NOT_IN_EN_INDEX', record.name]); continue; }
  if (winner.id !== record.id) { report.push([name, 'RUNTIME_PICKS_OTHER', `${record.name} -> ${winner.name} ${winner.feature_code} ${winner.population ?? 0}`]); continue; }
  if (!isMajorSeat(winner)) { report.push([name, 'MINOR_PLACE', `${record.name} ${winner.feature_code} ${winner.population ?? 0}`]); continue; }
  accepted[name] = record.name;
  report.push([name, 'OK', `${record.name} ${winner.feature_code} ${winner.population ?? 0}`]);
  } catch (error) {
    report.push([name, 'REQUEST_FAILED', String(error && error.message ? error.message : error).slice(0, 120)]);
  }
}

const failed = report.filter(([, status]) => status !== 'OK');
console.error(`accepted ${Object.keys(accepted).length}/${list.length}`);
for (const [name, status, detail] of failed) console.error(`  SKIP ${name} ${status} ${detail}`);

// A throttled or broken run must not be mistaken for a smaller table.
const hardFailures = report.filter(([, status]) => status === 'REQUEST_FAILED');
if (hardFailures.length > 0) {
  console.error(`refusing to write src/locale-aliases.ts: ${hardFailures.length} lookup(s) failed`);
  process.exit(1);
}

const entries = Object.entries(accepted).sort(([a], [b]) => a.localeCompare(b, 'zh'));
const body = entries.map(([name, spelling]) => `  '${name}': '${spelling}',`).join('\n');
const header = `/**
 * Offline fallback for simplified-Chinese queries the provider's \`zh\` index cannot answer.
 *
 * Open-Meteo indexes place names per language and never matches across scripts; its \`zh\` index
 * is Traditional and incomplete, so 纽约 and 首尔 return zero candidates (measured 2026-10-19)
 * and the tool answered NOT_FOUND. The GeoNames exact-name tier fixes that but needs an account
 * at assembly time, so this table keeps the repository usable with no configuration at all.
 *
 * Every entry was proven twice by \`scripts/generate-zh-aliases.mjs\`: GeoNames \`name_equals\`
 * showed the Chinese string is a documented name of the place, and the place was re-read from
 * Open-Meteo's \`en\` index by the same GeoNames id and confirmed to be a major seat. Do not add
 * entries by hand; regenerate and review the report instead.
 *
 * Contains derived place names from GeoNames (CC BY 4.0, https://www.geonames.org/).
 */
export const ZH_PLACE_ALIASES: Readonly<Record<string, string>> = {
${body}
};

/** Normalized lookup: the table is keyed by the trimmed, space-collapsed query. */
export function aliasForPlace(query: string): string | undefined {
  return ZH_PLACE_ALIASES[query.trim().replace(/\\s+/g, ' ')] ?? undefined;
}
`;
writeFileSync(new URL('../src/locale-aliases.ts', import.meta.url), header);
console.log(`wrote src/locale-aliases.ts with ${entries.length} entries`);
