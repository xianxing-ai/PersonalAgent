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
 *      and yields its canonical `toponymName` (the Latin spelling Open-Meteo's `en` index uses).
 *   2. Open-Meteo `name=<toponymName>&language=en` re-checks that the same GeoNames id is
 *      reachable and is a major seat, so the table never points at a village or a dead id.
 *
 * Usage: PA_GEONAMES_USERNAME=<account> node packages/connectors/weather/scripts/generate-zh-aliases.mjs
 * GeoNames attribution: this file contains derived place names from GeoNames (CC BY 4.0).
 */
import {writeFileSync} from 'node:fs';

const GEONAMES = 'https://secure.geonames.org/searchJSON';
const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const USERNAME = process.env.PA_GEONAMES_USERNAME;
if (!USERNAME) throw new Error('PA_GEONAMES_USERNAME is required');
const LIMIT = Number(process.env.LIMIT ?? '0');

/** Cities a Chinese-speaking user actually asks about; domestic names are excluded on purpose
 * because the `zh` index answers those already. */
const CANDIDATES = [
  // 亚洲
  '东京', '大阪', '京都', '名古屋', '札幌', '福冈', '冲绳', '首尔', '釜山', '仁川', '平壤',
  '曼谷', '清迈', '普吉', '新加坡', '吉隆坡', '雅加达', '巴厘岛', '马尼拉', '河内', '胡志明市',
  '金边', '万象', '仰光', '新德里', '孟买', '班加罗尔', '加尔各答', '金奈', '加德满都', '达卡',
  '科伦坡', '伊斯兰堡', '卡拉奇', '拉合尔', '德黑兰', '巴格达', '迪拜', '阿布扎比', '多哈',
  '利雅得', '伊斯坦布尔', '安卡拉', '特拉维夫', '耶路撒冷', '乌兰巴托', '塔什干', '阿拉木图',
  // 欧洲
  '伦敦', '巴黎', '柏林', '慕尼黑', '法兰克福', '汉堡', '罗马', '米兰', '威尼斯', '佛罗伦萨',
  '那不勒斯', '马德里', '巴塞罗那', '里斯本', '阿姆斯特丹', '布鲁塞尔', '维也纳', '苏黎世',
  '日内瓦', '斯德哥尔摩', '奥斯陆', '哥本哈根', '赫尔辛基', '雷克雅未克', '都柏林', '爱丁堡',
  '华沙', '布拉格', '布达佩斯', '雅典', '莫斯科', '圣彼得堡', '基辅', '明斯克', '布加勒斯特',
  '索非亚', '贝尔格莱德', '萨格勒布', '卢布尔雅那', '维尔纽斯', '里加', '塔林',
  // 北美
  '纽约', '洛杉矶', '旧金山', '西雅图', '芝加哥', '波士顿', '华盛顿', '费城', '迈阿密',
  '拉斯维加斯', '休斯敦', '达拉斯', '亚特兰大', '丹佛', '凤凰城', '圣地亚哥', '波特兰',
  '底特律', '多伦多', '温哥华', '蒙特利尔', '渥太华', '卡尔加里', '墨西哥城', '坎昆', '哈瓦那',
  // 南美
  '圣保罗', '里约热内卢', '布宜诺斯艾利斯', '利马', '波哥大', '基多', '加拉加斯',
  '蒙得维的亚', '拉巴斯',
  // 非洲
  '开罗', '亚历山大', '内罗毕', '拉各斯', '阿克拉', '亚的斯亚贝巴', '卡萨布兰卡', '突尼斯',
  '阿尔及尔', '达累斯萨拉姆', '约翰内斯堡', '开普敦', '德班', '哈拉雷', '罗安达',
  // 大洋洲
  '悉尼', '墨尔本', '布里斯班', '珀斯', '阿德莱德', '奥克兰', '惠灵顿', '基督城', '檀香山',
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

for (const name of list) {
  try {
  const search = await getJson(`${GEONAMES}?name_equals=${encodeURIComponent(name)}&maxRows=10&featureClass=P&lang=zh&username=${encodeURIComponent(USERNAME)}`);
  await sleep(120);
  const hits = Array.isArray(search.geonames) ? search.geonames : [];
  if (!hits.length) { report.push([name, 'NO_GEONAMES_HIT', '']); continue; }
  const best = hits.slice().sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];

  // The record's own English name, not GeoNames' `toponymName`: the runtime searches Open-Meteo,
  // so the stored string has to be a spelling that index actually carries (Montréal -> Montreal,
  // Washington -> Washington D.C., Saint Petersburg -> St Petersburg).
  const record = await getJson(`${GEOCODING.replace('/search', '/get')}?id=${best.geonameId}&language=en&format=json`);
  await sleep(120);
  if (!record || typeof record.name !== 'string') { report.push([name, 'NO_EN_RECORD', best.toponymName]); continue; }

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
