import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OpenMeteoProvider, WeatherService, WeatherConnector, register} from '../dist/index.js';
import {ZH_PLACE_ALIASES} from '../dist/locale-aliases.js';
import {FakeClock, FakeToolHost} from '@personal-agent/testkit';
import {ProtocolError, validateContract} from '@personal-agent/contracts';

const DATE = '2026-09-06';
const signal = () => new AbortController().signal;

const jsonResponse = (body, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => body});

const stubFetch = routes => {
  const calls = [];
  const impl = async url => {
    calls.push(url);
    for (const [match, handler] of routes) if (url.includes(match)) return handler(url);
    throw new Error(`Unrouted URL: ${url}`);
  };
  impl.calls = calls;
  return impl;
};

const geoRoute = results => ['geocoding-api.open-meteo.com', () => jsonResponse({results})];

const geoRoutesByLanguage = byLanguage => ['geocoding-api.open-meteo.com', url => {
  const language = new URL(url).searchParams.get('language');
  return jsonResponse({results: byLanguage[language] ?? []});
}];

/**
 * Verbatim captures from `https://geocoding-api.open-meteo.com/v1/search?count=5` on
 * 2026-09-06, trimmed to the fields the provider reads. `zh` and `en` are separate captures
 * because the endpoint returns a different result set per language — and, measured across
 * every Chinese string below, zero results for a Chinese string under `language=en`.
 */
const CAPTURES = {
  '北京': {
    zh: [
      {id: 1816670, name: '北京', latitude: 39.9075, longitude: 116.39723, timezone: 'Asia/Shanghai', feature_code: 'PPLC', population: 18960744, admin1: '北京市', country: '中国'},
      {id: 8404324, name: '北京', latitude: 30.72608, longitude: 108.67483, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '重庆市', country: '中国'},
      {id: 10196578, name: '北京', latitude: 30.9699, longitude: 103.94, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '四川', country: '中国'},
    ],
    en: [],
  },
  'Beijing': {
    zh: [
      {id: 1816670, name: '北京', latitude: 39.9075, longitude: 116.39723, timezone: 'Asia/Shanghai', feature_code: 'PPLC', population: 18960744, admin1: '北京市', country: '中国'},
      {id: 1816671, name: 'Beijing', latitude: 35.20917, longitude: 110.73278, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '山西', country: '中国'},
      {id: 7636037, name: 'Beijing', latitude: 29.34644, longitude: 116.19873, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '江西', country: '中国'},
      {id: 8212997, name: '陂径', latitude: 25.07655, longitude: 114.26569, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '广东', country: '中国'},
      {id: 8404324, name: '北京', latitude: 30.72608, longitude: 108.67483, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '重庆市', country: '中国'},
    ],
    en: [
      {id: 1816670, name: 'Beijing', latitude: 39.9075, longitude: 116.39723, timezone: 'Asia/Shanghai', feature_code: 'PPLC', population: 18960744, admin1: 'Beijing Municipality', country: 'China'},
      {id: 1816671, name: 'Beijing', latitude: 35.20917, longitude: 110.73278, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: 'Shanxi', country: 'China'},
      {id: 7636037, name: 'Beijing', latitude: 29.34644, longitude: 116.19873, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: 'Jiangxi', country: 'China'},
      {id: 8212997, name: 'Beijing', latitude: 25.07655, longitude: 114.26569, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: 'Guangdong', country: 'China'},
      {id: 8404324, name: 'Beijing', latitude: 30.72608, longitude: 108.67483, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: 'Chongqing Municipality', country: 'China'},
    ],
  },
  '上海': {
    zh: [
      {id: 1796236, name: '上海', latitude: 31.22222, longitude: 121.45806, timezone: 'Asia/Shanghai', feature_code: 'PPLA', population: 24874500, admin1: '上海市', country: '中国'},
      {id: 7072498, name: '上海', latitude: 29.32955, longitude: 121.05804, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '浙江', country: '中国'},
      {id: 10138757, name: '上海', latitude: 27.0741, longitude: 100.107, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '云南', country: '中国'},
      {id: 10141134, name: '上海', latitude: 26.5058, longitude: 103.158, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '云南', country: '中国'},
      {id: 10158854, name: '上海', latitude: 26.0577, longitude: 103.282, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '云南', country: '中国'},
    ],
    en: [],
  },
  '杭州': {
    zh: [
      {id: 1808926, name: '杭州', latitude: 30.29365, longitude: 120.16142, timezone: 'Asia/Shanghai', feature_code: 'PPLA', population: 9236032, admin1: '浙江', country: '中国'},
      {id: 6976333, name: '杭州', latitude: 30.06517, longitude: 102.19527, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '四川', country: '中国'},
    ],
    en: [],
  },
  // The defect the caller-reported bug is about: simplified 东京 exists in GeoNames only as
  // two villages in Jiangsu and Zhejiang, so the timezone and the local day are wrong too.
  '东京': {
    zh: [
      {id: 8268763, name: '东京', latitude: 32.20514, longitude: 119.28653, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '江苏', country: '中国'},
      {id: 11178989, name: '东京', latitude: 28.05397, longitude: 119.4275, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '浙江', country: '中国'},
    ],
    en: [],
  },
  '伦敦': {
    zh: [
      {id: 6058560, name: '伦敦', latitude: 42.98339, longitude: -81.23304, timezone: 'America/Toronto', feature_code: 'PPL', population: 422324, admin1: '安大略', country: '加拿大'},
      {id: 4298960, name: '伦敦', latitude: 37.12898, longitude: -84.08326, timezone: 'America/New_York', feature_code: 'PPLA2', population: 8126, admin1: '肯塔基州', country: '美国'},
    ],
    en: [],
  },
  'London': {
    zh: [
      {id: 2643743, name: '倫敦', latitude: 51.50853, longitude: -0.12574, timezone: 'Europe/London', feature_code: 'PPLC', population: 8961989, admin1: '英格兰', country: '英国'},
      {id: 6058560, name: '伦敦', latitude: 42.98339, longitude: -81.23304, timezone: 'America/Toronto', feature_code: 'PPL', population: 422324, admin1: '安大略', country: '加拿大'},
      {id: 4517009, name: 'London', latitude: 39.88645, longitude: -83.44825, timezone: 'America/New_York', feature_code: 'PPLA2', population: 10060, admin1: '俄亥俄州', country: '美国'},
      {id: 4298960, name: '伦敦', latitude: 37.12898, longitude: -84.08326, timezone: 'America/New_York', feature_code: 'PPLA2', population: 8126, admin1: '肯塔基州', country: '美国'},
      {id: 4119617, name: 'London', latitude: 35.32897, longitude: -93.25296, timezone: 'America/Chicago', feature_code: 'PPL', population: 1046, admin1: '阿肯色州', country: '美国'},
    ],
    en: [
      {id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, timezone: 'Europe/London', feature_code: 'PPLC', population: 8961989, admin1: 'England', country: 'United Kingdom'},
      {id: 6058560, name: 'London', latitude: 42.98339, longitude: -81.23304, timezone: 'America/Toronto', feature_code: 'PPL', population: 422324, admin1: 'Ontario', country: 'Canada'},
      {id: 4517009, name: 'London', latitude: 39.88645, longitude: -83.44825, timezone: 'America/New_York', feature_code: 'PPLA2', population: 10060, admin1: 'Ohio', country: 'United States'},
      {id: 4298960, name: 'London', latitude: 37.12898, longitude: -84.08326, timezone: 'America/New_York', feature_code: 'PPLA2', population: 8126, admin1: 'Kentucky', country: 'United States'},
      {id: 4119617, name: 'London', latitude: 35.32897, longitude: -93.25296, timezone: 'America/Chicago', feature_code: 'PPL', population: 1046, admin1: 'Arkansas', country: 'United States'},
    ],
  },
  '罗马': {
    zh: [
      {id: 2151187, name: '罗马', latitude: -26.56741, longitude: 148.7875, timezone: 'Australia/Brisbane', feature_code: 'PPL', population: 7105, admin1: 'State of Queensland', country: '澳大利亚'},
      {id: 8365144, name: '罗马', latitude: 32.89586, longitude: 120.15334, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '江苏', country: '中国'},
      {id: 9897304, name: '罗马', latitude: 22.67436, longitude: 108.59957, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '广西', country: '中国'},
      {id: 9936080, name: '罗马', latitude: 23.29762, longitude: 109.48651, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '广西', country: '中国'},
      {id: 10046286, name: '罗马', latitude: 25.9754, longitude: 107.458, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '贵州', country: '中国'},
    ],
    en: [],
  },
  // The `zh` pass spells the capital 罗马市 and the `en` pass spells it Rome, but both carry
  // GeoNames id 3169070, so the merge collapses them and the exact-name filter can see `rome`.
  'Rome': {
    zh: [
      {id: 3169070, name: '罗马市', latitude: 41.89193, longitude: 12.51133, timezone: 'Europe/Rome', feature_code: 'PPLC', population: 2318895, admin1: '拉齐奥', country: '意大利'},
      {id: 4219762, name: 'Rome', latitude: 34.25704, longitude: -85.16467, timezone: 'America/New_York', feature_code: 'PPLA2', population: 36323, admin1: '乔治亚', country: '美国'},
      {id: 5134295, name: '羅馬', latitude: 43.21285, longitude: -75.45573, timezone: 'America/New_York', feature_code: 'PPL', population: 32573, admin1: '纽约州', country: '美国'},
      {id: 4797174, name: 'Alum Creek', latitude: 38.28676, longitude: -81.80513, timezone: 'America/New_York', feature_code: 'PPL', population: 1749, admin1: '西維吉尼亞州', country: '美国'},
      {id: 4908066, name: 'Rome', latitude: 40.88309, longitude: -89.50259, timezone: 'America/Chicago', feature_code: 'PPL', population: 1738, admin1: '伊利诺伊州', country: '美国'},
    ],
    en: [
      {id: 3169070, name: 'Rome', latitude: 41.89193, longitude: 12.51133, timezone: 'Europe/Rome', feature_code: 'PPLC', population: 2318895, admin1: 'Lazio', country: 'Italy'},
      {id: 4219762, name: 'Rome', latitude: 34.25704, longitude: -85.16467, timezone: 'America/New_York', feature_code: 'PPLA2', population: 36323, admin1: 'Georgia', country: 'United States'},
      {id: 5134295, name: 'Rome', latitude: 43.21285, longitude: -75.45573, timezone: 'America/New_York', feature_code: 'PPL', population: 32573, admin1: 'New York', country: 'United States'},
      {id: 4797174, name: 'Alum Creek', latitude: 38.28676, longitude: -81.80513, timezone: 'America/New_York', feature_code: 'PPL', population: 1749, admin1: 'West Virginia', country: 'United States'},
      {id: 4908066, name: 'Rome', latitude: 40.88309, longitude: -89.50259, timezone: 'America/Chicago', feature_code: 'PPL', population: 1738, admin1: 'Illinois', country: 'United States'},
    ],
  },
  '丽江': {
    zh: [{id: 1927565, name: '丽江', latitude: 28.62428, longitude: 113.88887, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '湖南', country: '中国'}],
    en: [],
  },
  'Lijiang': {
    zh: [
      {id: 1813253, name: '丽江市', latitude: 26.86879, longitude: 100.22072, timezone: 'Asia/Shanghai', feature_code: 'PPLA2', population: 211151, admin1: '云南', country: '中国'},
      {id: 1803670, name: '澧江', latitude: 23.5711, longitude: 102.00417, timezone: 'Asia/Shanghai', feature_code: 'PPLA3', admin1: '云南', country: '中国'},
      {id: 1803668, name: 'Lijiang', latitude: 27.83811, longitude: 115.46571, timezone: 'Asia/Shanghai', feature_code: 'PPLA4', admin1: '江西', country: '中国'},
      {id: 1803669, name: 'Lijiang', latitude: 26.60083, longitude: 112.48528, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '湖南', country: '中国'},
      {id: 1901715, name: '利江', latitude: 22.14628, longitude: 107.17142, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '广西', country: '中国'},
    ],
    en: [
      {id: 1813253, name: 'Lijiang', latitude: 26.86879, longitude: 100.22072, timezone: 'Asia/Shanghai', feature_code: 'PPLA2', population: 211151, admin1: 'Yunnan', country: 'China'},
      {id: 1803670, name: 'Lijiang', latitude: 23.5711, longitude: 102.00417, timezone: 'Asia/Shanghai', feature_code: 'PPLA3', admin1: 'Yunnan', country: 'China'},
      {id: 1803668, name: 'Lijiang', latitude: 27.83811, longitude: 115.46571, timezone: 'Asia/Shanghai', feature_code: 'PPLA4', admin1: 'Jiangxi', country: 'China'},
      {id: 1803669, name: 'Lijiang', latitude: 26.60083, longitude: 112.48528, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: 'Hunan', country: 'China'},
      {id: 1901715, name: 'Lijiangcun', latitude: 22.14628, longitude: 107.17142, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: 'Guangxi', country: 'China'},
    ],
  },
  '婺源': {
    zh: [{id: 1790863, name: '婺源', latitude: 29.24972, longitude: 117.85472, timezone: 'Asia/Shanghai', feature_code: 'PPLA3', admin1: '江西', country: '中国'}],
    en: [],
  },
  // The trap that makes the hint a fallback tier rather than an equal pool: searched on its
  // own, `Wuyuan` ranks a different county in Zhejiang first and the correct Jiangxi one second,
  // and both are administrative seats, so neither population nor feature code separates them.
  'Wuyuan': {
    zh: [
      {id: 1790862, name: 'Wuyuan', latitude: 30.51539, longitude: 120.94856, timezone: 'Asia/Shanghai', feature_code: 'PPLA3', admin1: '浙江', country: '中国'},
      {id: 1790863, name: '婺源', latitude: 29.24972, longitude: 117.85472, timezone: 'Asia/Shanghai', feature_code: 'PPLA3', admin1: '江西', country: '中国'},
      {id: 1665645, name: '武淵', latitude: 24.66, longitude: 121.7982, timezone: 'Asia/Taipei', feature_code: 'PPL', admin1: '臺灣省 or 台灣省', country: '台湾'},
      {id: 1790861, name: 'Wuyuan', latitude: 36.41667, longitude: 112.7, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '山西', country: '中国'},
      {id: 1914774, name: '伍园村', latitude: 19.36189, longitude: 110.5347, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '海南', country: '中国'},
    ],
    en: [
      {id: 1790862, name: 'Wuyuan', latitude: 30.51539, longitude: 120.94856, timezone: 'Asia/Shanghai', feature_code: 'PPLA3', admin1: 'Zhejiang', country: 'China'},
      {id: 1790863, name: 'Wuyuan', latitude: 29.24972, longitude: 117.85472, timezone: 'Asia/Shanghai', feature_code: 'PPLA3', admin1: 'Jiangxi', country: 'China'},
      {id: 1665645, name: 'Wuyuan', latitude: 24.66, longitude: 121.7982, timezone: 'Asia/Taipei', feature_code: 'PPL', admin1: 'Taiwan', country: 'Taiwan'},
      {id: 1790861, name: 'Wuyuan', latitude: 36.41667, longitude: 112.7, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: 'Shanxi', country: 'China'},
      {id: 1914774, name: 'Wuyuancun', latitude: 19.36189, longitude: 110.5347, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: 'Hainan', country: 'China'},
    ],
  },
  '纽约': {zh: [], en: []},
  'New York': {
    zh: [
      {id: 5082331, name: '约克', latitude: 40.86807, longitude: -97.592, timezone: 'America/Chicago', feature_code: 'PPLA2', population: 7864, admin1: '內布拉斯加州', country: '美国'},
      {id: 4257559, name: '佛羅倫斯', latitude: 38.78423, longitude: -84.92439, timezone: 'America/Indiana/Vevay', feature_code: 'PPL', population: 80, admin1: '印第安纳州', country: '美国'},
      {id: 2641508, name: 'New York', latitude: 53.07897, longitude: -0.14008, timezone: 'Europe/London', feature_code: 'PPL', admin1: '英格兰', country: '英国'},
      {id: 3489274, name: 'New York', latitude: 18.25397, longitude: -77.17683, timezone: 'America/Jamaica', feature_code: 'PPL', admin1: '聖安娜區', country: '牙买加'},
      {id: 3489275, name: 'New York', latitude: 18.11366, longitude: -77.12767, timezone: 'America/Jamaica', feature_code: 'PPL', admin1: '聖凱瑟琳區', country: '牙买加'},
    ],
    en: [
      {id: 5128581, name: 'New York', latitude: 40.71427, longitude: -74.00597, timezone: 'America/New_York', feature_code: 'PPL', population: 8804190, admin1: 'New York', country: 'United States'},
      {id: 5082331, name: 'York', latitude: 40.86807, longitude: -97.592, timezone: 'America/Chicago', feature_code: 'PPLA2', population: 7864, admin1: 'Nebraska', country: 'United States'},
      {id: 4257559, name: 'Florence', latitude: 38.78423, longitude: -84.92439, timezone: 'America/Indiana/Vevay', feature_code: 'PPL', population: 80, admin1: 'Indiana', country: 'United States'},
      {id: 2641508, name: 'New York', latitude: 53.07897, longitude: -0.14008, timezone: 'Europe/London', feature_code: 'PPL', admin1: 'England', country: 'United Kingdom'},
      {id: 3489274, name: 'New York', latitude: 18.25397, longitude: -77.17683, timezone: 'America/Jamaica', feature_code: 'PPL', admin1: 'Saint Ann Parish', country: 'Jamaica'},
    ],
  },
  'Tokyo': {
    zh: [
      {id: 1850147, name: '東京', latitude: 35.6895, longitude: 139.69171, timezone: 'Asia/Tokyo', feature_code: 'PPLC', population: 9733276, admin1: '东京都', country: '日本'},
      {id: 2085290, name: 'Tokyo', latitude: -8.4, longitude: 147.15, timezone: 'Pacific/Port_Moresby', feature_code: 'PPL', admin1: '中央省', country: '巴布亚新几内亚'},
      {id: 7945384, name: 'Tokyo', latitude: 29.16998, longitude: 83.16319, timezone: 'Asia/Kathmandu', feature_code: 'PPLL', admin1: 'Karnali Province', country: '尼泊尔'},
      {id: 1834300, name: 'Tonggŏch’ado-ri', latitude: 34.23806, longitude: 125.93944, timezone: 'Asia/Seoul', feature_code: 'PPL', admin1: 'Jeollanam-do', country: '韩国'},
      {id: 1850142, name: 'Tōkyō Zan', latitude: 37.94393, longitude: 138.47507, timezone: 'Asia/Tokyo', feature_code: 'MT', admin1: '新潟縣', country: '日本'},
    ],
    en: [
      {id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, timezone: 'Asia/Tokyo', feature_code: 'PPLC', population: 9733276, admin1: 'Tokyo', country: 'Japan'},
      {id: 2085290, name: 'Tokyo', latitude: -8.4, longitude: 147.15, timezone: 'Pacific/Port_Moresby', feature_code: 'PPL', admin1: 'Central Province', country: 'Papua New Guinea'},
      {id: 7945384, name: 'Tokyo', latitude: 29.16998, longitude: 83.16319, timezone: 'Asia/Kathmandu', feature_code: 'PPLL', admin1: 'Karnali Pradesh', country: 'Nepal'},
      {id: 1834300, name: 'Tonggŏch’ado-ri', latitude: 34.23806, longitude: 125.93944, timezone: 'Asia/Seoul', feature_code: 'PPL', admin1: 'Jeollanam-do', country: 'South Korea'},
      {id: 1850142, name: 'Tōkyō Zan', latitude: 37.94393, longitude: 138.47507, timezone: 'Asia/Tokyo', feature_code: 'MT', admin1: 'Niigata', country: 'Japan'},
    ],
  },
  '首尔': {zh: [], en: []},
  'Seoul': {
    zh: [
      {id: 1835848, name: '首尔特别市', latitude: 37.566, longitude: 126.9784, timezone: 'Asia/Seoul', feature_code: 'PPLC', population: 10349312, admin1: '首尔特别市', country: '韩国'},
      {id: 6730280, name: 'Séouléo', latitude: 10.85006, longitude: 14.10217, timezone: 'Africa/Douala', feature_code: 'PPL', admin1: '極北區', country: '喀麦隆'},
      {id: 2281978, name: 'Séoulétié', latitude: 7.76743, longitude: -5.51053, timezone: 'Africa/Abidjan', feature_code: 'PPL', population: 882, admin1: '邦達馬河谷區', country: '象牙海岸'},
      {id: 2355726, name: 'Séoulgué', latitude: 12.93333, longitude: -0.81667, timezone: 'Africa/Ouagadougou', feature_code: 'PPL', admin1: '中北大區', country: '布基纳法索'},
      {id: 2451346, name: 'Séoulasso', latitude: 13.2392, longitude: -4.6974, timezone: 'Africa/Bamako', feature_code: 'PPL', admin1: '塞古区', country: '马里'},
    ],
    en: [
      {id: 1835848, name: 'Seoul', latitude: 37.566, longitude: 126.9784, timezone: 'Asia/Seoul', feature_code: 'PPLC', population: 10349312, admin1: 'Seoul', country: 'South Korea'},
      {id: 6730280, name: 'Séouléo', latitude: 10.85006, longitude: 14.10217, timezone: 'Africa/Douala', feature_code: 'PPL', admin1: 'Far North', country: 'Cameroon'},
      {id: 2281978, name: 'Séoulétié', latitude: 7.76743, longitude: -5.51053, timezone: 'Africa/Abidjan', feature_code: 'PPL', population: 882, admin1: 'Vallée du Bandama District', country: 'Ivory Coast'},
      {id: 2355726, name: 'Séoulgué', latitude: 12.93333, longitude: -0.81667, timezone: 'Africa/Ouagadougou', feature_code: 'PPL', admin1: 'Centre-Nord Region', country: 'Burkina Faso'},
      {id: 2451346, name: 'Séoulasso', latitude: 13.2392, longitude: -4.6974, timezone: 'Africa/Bamako', feature_code: 'PPL', admin1: 'Ségou', country: 'Mali'},
    ],
  },
  '巴黎': {
    zh: [
      {id: 2988507, name: '巴黎', latitude: 48.85341, longitude: 2.3488, timezone: 'Europe/Paris', feature_code: 'PPLC', population: 2138551, admin1: '法兰西岛', country: '法国'},
      {id: 4303602, name: '巴黎', latitude: 38.2098, longitude: -84.25299, timezone: 'America/New_York', feature_code: 'PPLA2', population: 9870, admin1: '肯塔基州', country: '美国'},
      {id: 4125402, name: '巴黎', latitude: 35.29203, longitude: -93.72992, timezone: 'America/Chicago', feature_code: 'PPL', population: 3443, admin1: '阿肯色州', country: '美国'},
      {id: 9906771, name: '巴黎', latitude: 23.05236, longitude: 106.90179, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '广西', country: '中国'},
    ],
    en: [],
  },
  '广东': {
    zh: [{id: 8422245, name: '广东', latitude: 29.1488, longitude: 106.21889, timezone: 'Asia/Shanghai', feature_code: 'PPL', admin1: '重庆市', country: '中国'}],
    en: [],
  },
  'England': {
    zh: [],
    en: [
      {id: 4110001, name: 'England', latitude: 34.54426, longitude: -91.96903, timezone: 'America/Chicago', feature_code: 'PPL', population: 2765, admin1: 'Arkansas', country: 'United States'},
      {id: 660249, name: 'England', latitude: 63.31662, longitude: 22.47928, timezone: 'Europe/Helsinki', feature_code: 'PPL', admin1: 'Ostrobothnia', country: 'Finland'},
      {id: 2725829, name: 'Ängland', latitude: 63.4, longitude: 13.01667, timezone: 'Europe/Stockholm', feature_code: 'PPL', admin1: 'Jämtland County', country: 'Sweden'},
      {id: 2930138, name: 'England', latitude: 54.49173, longitude: 8.87844, timezone: 'Europe/Berlin', feature_code: 'PPL', admin1: 'Schleswig-Holstein', country: 'Germany'},
      {id: 2930139, name: 'England', latitude: 52.21667, longitude: 7.03333, timezone: 'Europe/Berlin', feature_code: 'PPL', admin1: 'North Rhine-Westphalia', country: 'Germany'},
    ],
  },
  'Texas': {
    zh: [],
    en: [
      {id: 4802704, name: 'Colfax', latitude: 39.43481, longitude: -80.13175, timezone: 'America/New_York', feature_code: 'PPL', admin1: 'West Virginia', country: 'United States'},
      {id: 5188085, name: 'East Texas', latitude: 40.5476, longitude: -75.5613, timezone: 'America/New_York', feature_code: 'PPL', admin1: 'Pennsylvania', country: 'United States'},
      {id: 3814142, name: 'Texas', latitude: 20.02556, longitude: -99.19556, timezone: 'America/Mexico_City', feature_code: 'PPL', population: 993, admin1: 'Hidalgo', country: 'Mexico'},
      {id: 3981722, name: 'Texas', latitude: 21.94427, longitude: -100.74501, timezone: 'America/Mexico_City', feature_code: 'PPL', population: 714, admin1: 'San Luis Potosí', country: 'Mexico'},
      {id: 5164039, name: 'Mutual', latitude: 40.07867, longitude: -83.63687, timezone: 'America/New_York', feature_code: 'PPL', population: 102, admin1: 'Ohio', country: 'United States'},
    ],
  },
  'France': {
    zh: [],
    en: [
      {id: 3017382, name: 'France', latitude: 46, longitude: 2, timezone: 'Europe/Paris', feature_code: 'PCLI', population: 66987244, country: 'France'},
      {id: 1105422, name: 'France', latitude: -21.68444, longitude: 34.70333, timezone: 'Africa/Maputo', feature_code: 'PPL', admin1: 'Inhambane Province', country: 'Mozambique'},
      {id: 2288873, name: 'France', latitude: 5.20375, longitude: -3.73905, timezone: 'Africa/Abidjan', feature_code: 'PPL', admin1: 'Lagunes District', country: 'Ivory Coast'},
      {id: 2739299, name: 'France', latitude: 41.6494, longitude: -7.47053, timezone: 'Europe/Lisbon', feature_code: 'PPL', admin1: 'Vila Real District', country: 'Portugal'},
      {id: 5593532, name: 'France', latitude: 43.97241, longitude: -111.27523, timezone: 'America/Boise', feature_code: 'PPL', admin1: 'Idaho', country: 'United States'},
    ],
  },
};

/** Routes the endpoint by both `name` and `language`, the way the real one behaves. */
const captureRoutes = captures => ['geocoding-api.open-meteo.com', url => {
  const parsed = new URL(url);
  const results = captures[parsed.searchParams.get('name')]?.[parsed.searchParams.get('language')] ?? [];
  return jsonResponse({results});
}];

const beijingCandidates = CAPTURES['北京'].zh;

const forecastRoute = (daily, status = 200) => ['api.open-meteo.com', url => {
  const date = new URL(url).searchParams.get('start_date');
  return jsonResponse({
    latitude: 39.89, longitude: 116.36, utc_offset_seconds: 28800, timezone: 'Asia/Shanghai',
    daily_units: {time: 'iso8601', temperature_2m_min: '°C', temperature_2m_max: '°C'},
    daily: typeof daily === 'function' ? daily(date, url) : {...daily, time: [date]},
  }, status);
}];

const healthyDaily = {temperature_2m_min: [22.3], temperature_2m_max: [31.4], precipitation_probability_max: [12], weather_code: [3]};

const makeProvider = (routes, options = {}) =>
  new OpenMeteoProvider({fetchImpl: stubFetch(routes), ...options});

const makeService = (routes, options = {}, serviceOptions = {}) => {
  const clock = new FakeClock(Date.parse('2026-09-06T02:00:00.000Z'));
  const provider = makeProvider(routes, options);
  return {clock, provider, service: new WeatherService({provider, now: clock.now, ...serviceOptions})};
};

test('maps a real forecast and labels the time source honestly', async () => {
  const {service} = makeService([geoRoute(beijingCandidates), forecastRoute(healthyDaily)]);
  const result = await service.getForecast({location: '北京', date: DATE});

  assert.equal(result.record.source, 'open-meteo');
  assert.equal(result.forecast.publishedTimeKind, 'coverage_start');
  // Asia/Shanghai local midnight for 2026-09-06 is 2026-09-05T16:00Z, not the UTC day boundary.
  assert.equal(result.record.occurredAt, '2026-09-05T16:00:00.000Z');
  assert.equal(result.record.validFor, '2026-09-05T16:00:00.000Z/2026-09-06T16:00:00.000Z');
  assert.equal(result.record.fetchedAt, '2026-09-06T02:00:00.000Z');
  assert.notEqual(result.record.occurredAt, result.record.fetchedAt);
  validateContract('connectorItem', result.record);

  assert.equal(result.forecast.summary, '阴');
  assert.equal(result.forecast.temperatureMin, 22.3);
  assert.equal(result.forecast.temperatureMax, 31.4);
  assert.equal(result.forecast.precipitationProbability, 12);
});

test('local day boundaries follow DST, not a fixed offset', async () => {
  const {service} = makeService([captureRoutes(CAPTURES), forecastRoute(healthyDaily)], {language: 'en'});

  const summer = await service.getForecast({location: 'New York', date: '2026-07-15'});
  assert.equal(summer.record.occurredAt, '2026-07-15T04:00:00.000Z', 'EDT is UTC-4');
  const winter = await service.getForecast({location: 'New York', date: '2026-01-15'});
  assert.equal(winter.record.occurredAt, '2026-01-15T05:00:00.000Z', 'EST is UTC-5');
  assert.equal(summer.forecast.summary, 'Overcast', 'summary language follows the language option');
});

test('discloses an ambiguous place instead of silently picking one', async () => {
  const fetchImpl = stubFetch([geoRoute(beijingCandidates), forecastRoute(healthyDaily)]);
  const service = new WeatherService({provider: new OpenMeteoProvider({fetchImpl}), now: () => Date.parse('2026-09-06T02:00:00.000Z')});
  const result = await service.getForecast({location: '北京', date: DATE});

  assert.equal(result.forecast.resolved.ambiguous, true);
  assert.equal(result.forecast.resolved.name, '北京');
  assert.equal(result.forecast.resolved.admin1, '北京市');
  assert.equal(result.forecast.resolved.timezone, 'Asia/Shanghai');
  assert.equal(result.forecast.resolved.confidence, 'high', 'a national capital is corroborated by its own record');
  assert.equal(result.forecast.resolved.featureCode, 'PPLC');
  assert.deepEqual(result.forecast.resolved.alternatives, ['北京, 重庆市, 中国', '北京, 四川, 中国']);
});

test('confidence separates the intended city from a same-name village', async () => {
  const provider = makeProvider([captureRoutes(CAPTURES)]);
  const sig = signal();
  const cases = [
    {location: '北京', confidence: 'high'},
    {location: '上海', confidence: 'high'},
    {location: '杭州', confidence: 'high'},
    {location: '巴黎', confidence: 'high'},
    {location: '婺源', confidence: 'low'},
    {location: 'New York', confidence: 'high'},
    {location: 'London', confidence: 'high'},
    {location: 'Seoul', confidence: 'high'},
    // Every one of these is the misresolution the caller reported: a small same-name place
    // carrying the wrong timezone, and therefore the wrong local day.
    {location: '东京', confidence: 'low'},
    {location: '伦敦', confidence: 'low'},
    {location: '罗马', confidence: 'low'},
    {location: '丽江', confidence: 'low'},
    {location: '广东', confidence: 'low'},
    {location: 'England', language: 'en', confidence: 'low'},
    {location: 'Texas', language: 'en', confidence: 'low'},
    {location: 'France', language: 'en', confidence: 'low'},
  ];
  for (const testCase of cases) {
    const resolved = await provider.resolvePlace(testCase.location, undefined, sig);
    assert.equal(resolved.confidence, testCase.confidence, `${testCase.location} should be ${testCase.confidence}`);
  }
});

test('a large city that is not an administrative seat is still trusted', async () => {
  const provider = makeProvider([captureRoutes(CAPTURES)]);
  const resolved = await provider.resolvePlace('New York', undefined, signal());
  assert.equal(resolved.featureCode, 'PPL', 'GeoNames does not mark New York City as a seat');
  assert.equal(resolved.confidence, 'high', 'its 8804190 people clear the population floor');
});

test('a non-inhabited record is never trusted, whatever the population floor', async () => {
  const lenient = makeProvider([captureRoutes(CAPTURES)], {language: 'en', minCorroboratedPopulation: 0});
  const france = await lenient.resolvePlace('France', undefined, signal());
  assert.equal(france.featureCode, 'PCLI');
  assert.equal(france.confidence, 'low', 'a country is not a place a forecast can answer for');
});

test('the population floor is configurable and its boundary is the measured gap', async () => {
  // 伦敦 resolves to London, Ontario: 422324 people, the largest misresolution measured.
  const below = makeProvider([captureRoutes(CAPTURES)], {minCorroboratedPopulation: 422_324});
  assert.equal((await below.resolvePlace('伦敦', undefined, signal())).confidence, 'high');
  const above = makeProvider([captureRoutes(CAPTURES)], {minCorroboratedPopulation: 422_325});
  assert.equal((await above.resolvePlace('伦敦', undefined, signal())).confidence, 'low');
});

// Minor seats (PPLA2–PPLA5) no longer ride the seat exemption unconditionally: the wrong minor
// seats the misresolutions carried (凤凰 → PPLA4 14574, Pingyao → PPLA4, 开罗 → PPLA2 1733) all
// sit below 丽江市's 211151, the smallest correct one measured. The floor splits that gap.
test('minor administrative seats carry their own population floor', async () => {
  const seat = population => [({id: 1, name: '某县城', latitude: 30, longitude: 120,
    timezone: 'Asia/Shanghai', feature_code: 'PPLA4', population})];
  assert.equal((await makeProvider([geoRoutesByLanguage({zh: seat(99_999)})])
    .resolvePlace('某县城', undefined, signal())).confidence, 'low');
  assert.equal((await makeProvider([geoRoutesByLanguage({zh: seat(100_000)})])
    .resolvePlace('某县城', undefined, signal())).confidence, 'high');
  const lowered = makeProvider([geoRoutesByLanguage({zh: seat(50_000)})], {minMinorSeatPopulation: 50_000});
  assert.equal((await lowered.resolvePlace('某县城', undefined, signal())).confidence, 'high');
});

// The documented worst hint case: 开罗 matched Cairo, Illinois (PPLA2, 1733 people) as an
// unconditional high, which hid the hint tier entirely. With the minor-seat floor the primary
// is low, the hint runs, and the Egyptian capital wins by exact name plus population.
test('a small minor-seat misresolution no longer hides the hint tier', async () => {
  const illinois = {id: 4227970, name: '开罗', latitude: 37.00533, longitude: -89.18342,
    timezone: 'America/Chicago', feature_code: 'PPLA2', population: 1733, admin1: '伊利诺伊州', country: '美国'};
  const egypt = {id: 360630, name: 'Cairo', latitude: 30.06263, longitude: 31.24967,
    timezone: 'Africa/Cairo', feature_code: 'PPLC', population: 9606916, admin1: 'Cairo', country: 'Egypt'};
  const captures = {
    '开罗': {zh: [illinois], en: []},
    'Cairo': {zh: [], en: [egypt, {...illinois, name: 'Cairo', admin1: 'Illinois', country: 'United States'}]},
  };
  const provider = makeProvider([captureRoutes(captures)]);
  const sig = signal();
  const unhinted = await provider.resolvePlace('开罗', undefined, sig);
  assert.equal(unhinted.timezone, 'America/Chicago');
  assert.equal(unhinted.confidence, 'low', 'the Illinois PPLA2 is no longer vouched for');
  const hinted = await provider.resolvePlace('开罗', 'Cairo', sig);
  assert.equal(hinted.timezone, 'Africa/Cairo', 'the hint tier can finally run');
  assert.equal(hinted.confidence, 'high');
});

// The no-population false positives (阳朔, 同里 — plain PPL records GeoNames carries no
// population for) are corroborated by the exact-name tier once an account is configured.
test('a proven alternate name corroborates a place GeoNames carries no population for', async () => {
  const yangshuo = {id: 1803512, name: '阳朔', latitude: 24.73333, longitude: 110.48889,
    timezone: 'Asia/Shanghai', feature_code: 'PPL', country: '中国'};
  const searchAndGet = (captures, recordsById) => ['geocoding-api.open-meteo.com', url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/v1/get')) {
      const record = recordsById[parsed.searchParams.get('id')];
      return record === undefined ? jsonResponse({error: true, reason: 'Id not found'}, 404) : jsonResponse(record);
    }
    const entry = captures[parsed.searchParams.get('name')] ?? {};
    return jsonResponse({results: entry[parsed.searchParams.get('language')] ?? []});
  }];
  const provider = makeProvider(
    [geonamesRoute({'阳朔': [1803512]}, 'acct'), searchAndGet({'阳朔': {zh: [yangshuo], en: []}}, {1803512: yangshuo})],
    {geonamesUsername: 'acct'},
  );
  const place = await provider.resolvePlace('阳朔', undefined, signal());
  assert.equal(place.featureCode, 'PPL');
  assert.equal(place.confidence, 'high', 'name_equals proved the query is a documented name of this place');
});

test('a candidate carrying no feature classification is not vouched for', async () => {
  const routes = geoRoutesByLanguage({
    zh: [{id: 1, name: '无分类', latitude: 30, longitude: 120, timezone: 'Asia/Shanghai', population: 20_000_000}],
  });
  const resolved = await makeProvider([routes]).resolvePlace('无分类', undefined, signal());
  assert.equal(resolved.confidence, 'low', 'population alone cannot corroborate an unclassified record');
  assert.equal(resolved.featureCode, undefined);
});

// Constructed, not a capture: it pins the invariant that the disclosed classification is the
// one the verdict was computed from, whichever pass supplied it.
test('the disclosed feature code is the one the verdict was computed from', async () => {
  const same = {id: 7, latitude: 30, longitude: 120, timezone: 'Asia/Shanghai'};
  const routes = geoRoutesByLanguage({
    zh: [{...same, name: '某地'}],
    en: [{...same, name: 'Somewhere', feature_code: 'PPLA'}],
  });
  const resolved = await makeProvider([routes]).resolvePlace('某地', undefined, signal());
  assert.equal(resolved.name, '某地', 'the configured language still supplies the display name');
  assert.equal(resolved.confidence, 'high');
  assert.equal(resolved.featureCode, 'PPLA', 'a high verdict with no disclosed classification is unauditable');
});

test('strict accepts a corroborated city instead of refusing every duplicate name', async () => {
  const strict = makeProvider([captureRoutes(CAPTURES)], {locationResolution: 'strict'});
  const sig = signal();
  const beijing = await strict.resolvePlace('北京', undefined, sig);
  assert.equal(beijing.name, '北京');
  assert.equal(beijing.ambiguous, true, 'the other places named 北京 stay disclosed');
  assert.equal((await strict.resolvePlace('巴黎', undefined, sig)).timezone, 'Europe/Paris');
  assert.equal((await strict.resolvePlace('London', undefined, sig)).timezone, 'Europe/London');
  assert.equal((await strict.resolvePlace('New York', undefined, sig)).timezone, 'America/New_York');
});

test('strict refuses a weak match and says what to pass instead', async () => {
  const strict = makeProvider([captureRoutes(CAPTURES)], {locationResolution: 'strict'});
  await assert.rejects(strict.resolvePlace('东京', undefined, signal()), error => {
    assert.equal(error.code, 'INVALID_ARGUMENT');
    assert.match(error.message, /Refusing to guess/);
    assert.match(error.message, /locationQuery/, 'names the escape hatch');
    assert.match(error.message, /江苏/, 'lists the candidate it declined');
    return true;
  });

  const english = makeProvider([captureRoutes(CAPTURES)], {locationResolution: 'strict', language: 'en'});
  await assert.rejects(english.resolvePlace('England', undefined, signal()), error => {
    assert.equal(error.code, 'INVALID_ARGUMENT');
    assert.match(error.message, /population 2765/, 'states the evidence');
    return true;
  });
});

test('strict accepts a weak match once a hint corroborates it', async () => {
  const strict = makeProvider([captureRoutes(CAPTURES)], {locationResolution: 'strict'});
  const tokyo = await strict.resolvePlace('东京', 'Tokyo', signal());
  assert.equal(tokyo.timezone, 'Asia/Tokyo');
  assert.equal(tokyo.confidence, 'high');
});

test('a hint is a fallback tier and never outranks a good original match', async () => {
  const provider = makeProvider([captureRoutes(CAPTURES)]);
  const sig = signal();

  // 婺源 still resolves to the right county in Jiangxi, but as a populationless PPLA3 it is no
  // longer vouched for unconditionally: the minor-seat tightening leaves it low until the
  // GeoNames exact-name tier corroborates it. The wrong hint cannot rescue it either — searched
  // on its own, `Wuyuan` ranks Zhejiang first, and that PPLA3 carries no population either.
  const wuyuan = await provider.resolvePlace('婺源', 'Wuyuan', sig);
  assert.equal(wuyuan.admin1, '江西', 'the wrong hint is ignored');
  assert.equal(wuyuan.confidence, 'low', 'a populationless minor seat is not vouched for');
  const hintAlone = await provider.resolvePlace('Wuyuan', undefined, sig);
  assert.equal(hintAlone.admin1, '浙江', 'which is what acting on it would have produced');

  const lijiang = await provider.resolvePlace('丽江', 'Lijiang', sig);
  assert.equal(lijiang.admin1, '云南', 'the hint rescues the Yunnan prefecture from the Hunan village');
  assert.equal(lijiang.latitude, 26.86879);
  assert.equal(lijiang.confidence, 'high');

  const tokyo = await provider.resolvePlace('东京', 'Tokyo', sig);
  assert.equal(tokyo.timezone, 'Asia/Tokyo', 'not Asia/Shanghai');
  assert.equal(tokyo.confidence, 'high');

  const london = await provider.resolvePlace('伦敦', 'London', sig);
  assert.equal(london.timezone, 'Europe/London', 'not America/Toronto');

  const rome = await provider.resolvePlace('罗马', 'Rome', sig);
  assert.equal(rome.timezone, 'Europe/Rome', 'not Australia/Brisbane');
  assert.equal(rome.confidence, 'high');
  // The spelling comes from the hint's own pass order, so it is 罗马市 rather than the 罗马 typed in.
  assert.equal(rome.name, '罗马市');
  assert.equal(rome.country, '意大利');
});

test('a place the Chinese index does not carry resolves through the shipped alias, and a hint still works', async () => {
  const provider = makeProvider([captureRoutes(CAPTURES)]);
  const sig = signal();
  // Previously NOT_FOUND: the alias table is what makes the repository usable with no account.
  const unhinted = await provider.resolvePlace('纽约', undefined, sig);
  assert.equal(unhinted.latitude, 40.71427);
  assert.equal(unhinted.timezone, 'America/New_York');
  assert.equal(unhinted.confidence, 'high');

  const hinted = await provider.resolvePlace('纽约', 'New York', sig);
  assert.equal(hinted.timezone, 'America/New_York');
  assert.equal(hinted.confidence, 'high');
  assert.equal((await provider.resolvePlace('首尔', 'Seoul', sig)).timezone, 'Asia/Seoul');
});

test('a blank hint is treated as no hint and never queried', async () => {
  const fetchImpl = stubFetch([captureRoutes(CAPTURES)]);
  const provider = new OpenMeteoProvider({fetchImpl});
  await provider.resolvePlace('丽江', '   ', signal());
  assert.ok(!fetchImpl.calls.some(url => url.includes('name=Lijiang') || url.includes('name=%20')));
  assert.equal(fetchImpl.calls.filter(url => url.includes('name=')).length, 2, 'one pass per language on the original input');
});

test('the geocode cache keeps a hinted lookup separate from an unhinted one', async () => {
  const fetchImpl = stubFetch([captureRoutes(CAPTURES)]);
  const provider = new OpenMeteoProvider({fetchImpl});
  const sig = signal();
  const unhinted = await provider.resolvePlace('丽江', undefined, sig);
  const hinted = await provider.resolvePlace('丽江', 'Lijiang', sig);
  assert.equal(unhinted.admin1, '湖南');
  assert.equal(hinted.admin1, '云南', 'the two lookups mean different places');

  const calls = fetchImpl.calls.length;
  await provider.resolvePlace('丽江', 'Lijiang', sig);
  await provider.resolvePlace('丽江', undefined, sig);
  assert.equal(fetchImpl.calls.length, calls, 'both are cached under their own key');
});

test('geocoding is cached per location', async () => {
  const fetchImpl = stubFetch([geoRoute(beijingCandidates), forecastRoute(healthyDaily)]);
  const provider = new OpenMeteoProvider({fetchImpl});
  const service = new WeatherService({provider, now: () => Date.parse('2026-09-06T02:00:00.000Z'), cacheTtlMs: 1});
  await service.getForecast({location: '北京', date: DATE, units: 'metric'});
  await service.getForecast({location: '北京', date: DATE, units: 'imperial'});
  const geocoding = fetchImpl.calls.filter(url => url.includes('geocoding-api'));
  assert.equal(geocoding.length, 2, 'one pass per language on the first resolution');
  assert.equal(geocoding.filter(url => url.includes('language=zh')).length, 1);
  assert.equal(geocoding.filter(url => url.includes('language=en')).length, 1);
  assert.equal(fetchImpl.calls.filter(url => url.includes('api.open-meteo.com/v1/forecast')).length, 2);
});

test('a Chinese place resolves under an English configuration', async () => {
  const fetchImpl = stubFetch([captureRoutes(CAPTURES)]);
  const provider = new OpenMeteoProvider({fetchImpl, language: 'en'});
  const resolved = await provider.resolvePlace('北京', undefined, signal());

  assert.equal(resolved.timezone, 'Asia/Shanghai');
  assert.equal(resolved.confidence, 'high');
  assert.equal(resolved.name, '北京', 'the en pass returns nothing for a Chinese string, so zh supplies the name');

  const geocoding = fetchImpl.calls.filter(url => url.includes('geocoding-api'));
  assert.equal(geocoding.length, 2, 'the pass set follows the input script, not the configured language');
  assert.equal(geocoding.filter(url => url.includes('language=zh')).length, 1);
  assert.equal(geocoding.filter(url => url.includes('language=en')).length, 1);
});

test('a Latin place under an English configuration issues a single pass', async () => {
  const fetchImpl = stubFetch([captureRoutes(CAPTURES)]);
  const provider = new OpenMeteoProvider({fetchImpl, language: 'en'});
  await provider.resolvePlace('London', undefined, signal());
  const geocoding = fetchImpl.calls.filter(url => url.includes('geocoding-api'));
  assert.equal(geocoding.length, 1);
  assert.equal(geocoding.filter(url => url.includes('language=en')).length, 1);
});

test('a place missing from the configured language index still resolves via the English pass', async () => {
  const {service} = makeService([captureRoutes(CAPTURES), forecastRoute(healthyDaily)]);
  const result = await service.getForecast({location: 'New York', date: DATE});

  assert.equal(result.forecast.resolved.name, 'New York');
  assert.equal(result.forecast.resolved.admin1, 'New York');
  assert.equal(result.forecast.resolved.country, 'United States');
  assert.equal(result.forecast.resolved.timezone, 'America/New_York', 'not Europe/London');
  assert.equal(result.forecast.resolved.latitude, 40.71427);
  assert.equal(result.forecast.resolved.confidence, 'high');
  assert.equal(result.forecast.resolved.ambiguous, true, 'the other same-name places stay disclosed');
  assert.deepEqual(result.forecast.resolved.alternatives, [
    'New York, 英格兰, 英国', 'New York, 聖安娜區, 牙买加', 'New York, 聖凱瑟琳區, 牙买加',
  ]);
});

test('the Chinese index alone would have picked a village in England', async () => {
  const zhOnly = geoRoutesByLanguage({zh: CAPTURES['New York'].zh, en: []});
  const resolved = await makeProvider([zhOnly]).resolvePlace('New York', undefined, signal());
  assert.equal(resolved.country, '英国');
  assert.equal(resolved.timezone, 'Europe/London');
  assert.equal(resolved.confidence, 'low', 'and is now labelled as the weak match it is');
});

test('both passes returning the same place collapse into one and keep the localized name', async () => {
  const {service} = makeService([captureRoutes(CAPTURES), forecastRoute(healthyDaily)]);
  const result = await service.getForecast({location: 'Beijing', date: DATE});
  assert.equal(result.forecast.resolved.name, '北京', 'the configured zh pass supplies the display name');
  assert.equal(result.forecast.resolved.admin1, '北京市');
  assert.equal(result.forecast.resolved.country, '中国');
  assert.equal(result.forecast.resolved.confidence, 'high');
  assert.equal(result.forecast.resolved.ambiguous, true, 'merged by GeoNames id, not duplicated per language');
  assert.deepEqual(result.forecast.resolved.alternatives, [
    'Beijing, 山西, 中国', 'Beijing, 江西, 中国', '陂径, 广东, 中国', '北京, 重庆市, 中国',
  ]);
});

test('identical alternative labels are disclosed once', async () => {
  // Real `zh` result for 上海: the municipality, one place in Zhejiang and three in Yunnan whose
  // labels are indistinguishable, so repeating them would disclose nothing.
  const {service} = makeService([captureRoutes(CAPTURES), forecastRoute(healthyDaily)]);
  const result = await service.getForecast({location: '上海', date: DATE});
  assert.equal(result.forecast.resolved.admin1, '上海市');
  assert.equal(result.forecast.resolved.confidence, 'high');
  assert.equal(result.forecast.resolved.ambiguous, true);
  assert.deepEqual(result.forecast.resolved.alternatives, ['上海, 浙江, 中国', '上海, 云南, 中国']);
});

test('requests fahrenheit only for imperial units', async () => {
  const fetchImpl = stubFetch([geoRoute(beijingCandidates), forecastRoute(healthyDaily)]);
  const provider = new OpenMeteoProvider({fetchImpl});
  await provider.fetchForecast({location: '北京', date: DATE, units: 'metric'}, signal());
  await provider.fetchForecast({location: '北京', date: DATE, units: 'imperial'}, signal());
  const forecastCalls = fetchImpl.calls.filter(url => url.includes('/v1/forecast'));
  assert.match(forecastCalls[0], /temperature_unit=celsius/);
  assert.match(forecastCalls[1], /temperature_unit=fahrenheit/);
});

test('the hint reaches the geocoding query from the forecast request', async () => {
  const fetchImpl = stubFetch([captureRoutes(CAPTURES), forecastRoute(healthyDaily)]);
  const provider = new OpenMeteoProvider({fetchImpl});
  const result = await provider.fetchForecast({location: '丽江', date: DATE, units: 'metric', locationQuery: 'Lijiang'}, signal());
  assert.equal(result.resolved.admin1, '云南');
  assert.ok(fetchImpl.calls.some(url => url.includes('name=Lijiang')));
  assert.match(fetchImpl.calls.find(url => url.includes('/v1/forecast')), /latitude=26.86879/);
});

test('does not invent precipitation data the provider omitted', async () => {
  const {service} = makeService([geoRoute(beijingCandidates), forecastRoute({...healthyDaily, precipitation_probability_max: [null]})]);
  const result = await service.getForecast({location: '北京', date: DATE});
  assert.equal(result.forecast.precipitationProbability, null);
});

test('reports unknown weather codes as codes rather than made-up text', async () => {
  const provider = makeProvider([geoRoute(beijingCandidates), forecastRoute({...healthyDaily, weather_code: [42]})]);
  const result = await provider.fetchForecast({location: '北京', date: DATE, units: 'metric'}, signal());
  assert.equal(result.summary, '未知天气代码 42');
  const noCode = makeProvider([geoRoute(beijingCandidates), forecastRoute({...healthyDaily, weather_code: [null]})]);
  assert.equal((await noCode.fetchForecast({location: '北京', date: DATE, units: 'metric'}, signal())).summary, '天气状况未提供');
});

test('maps provider failures onto protocol error codes', async () => {
  const cases = [
    {name: 'no geocoding match', routes: [geoRoute([]), forecastRoute(healthyDaily)], query: {location: 'Zzqqxx', date: DATE}, code: 'NOT_FOUND'},
    {
      name: 'date outside model horizon',
      routes: [geoRoute(beijingCandidates), ['api.open-meteo.com', () => jsonResponse({error: true, reason: "Parameter 'start_date' is out of allowed range from 2026-06-05 to 2026-09-21"}, 400)]],
      query: {location: '北京', date: DATE}, code: 'NOT_FOUND',
    },
    {
      name: 'bad parameter',
      routes: [geoRoute(beijingCandidates), ['api.open-meteo.com', () => jsonResponse({error: true, reason: 'Cannot initialize DailyParameter'}, 400)]],
      query: {location: '北京', date: DATE}, code: 'INVALID_ARGUMENT',
    },
    {name: 'rate limited', routes: [geoRoute(beijingCandidates), ['api.open-meteo.com', () => jsonResponse({}, 429)]], query: {location: '北京', date: DATE}, code: 'RATE_LIMITED', retryable: true},
    {name: 'upstream error', routes: [geoRoute(beijingCandidates), ['api.open-meteo.com', () => jsonResponse({}, 503)]], query: {location: '北京', date: DATE}, code: 'EXTERNAL_FAILURE', retryable: true},
  ];
  for (const testCase of cases) {
    const {service} = makeService(testCase.routes);
    await assert.rejects(service.getForecast(testCase.query), error => {
      assert.equal(error.code, testCase.code, testCase.name);
      assert.ok(error instanceof ProtocolError, testCase.name);
      if (testCase.retryable !== undefined) assert.equal(error.retryable, testCase.retryable, testCase.name);
      return true;
    }, testCase.name);
  }
});

test('a date outside the horizon surfaces the provider allowed range', async () => {
  const {service} = makeService([geoRoute(beijingCandidates),
    ['api.open-meteo.com', () => jsonResponse({error: true, reason: "Parameter 'start_date' is out of allowed range from 2026-06-05 to 2026-09-21"}, 400)]]);
  await assert.rejects(service.getForecast({location: '北京', date: DATE}), {code: 'NOT_FOUND', message: /2026-06-05 to 2026-09-21/});
});

test('network failure is retryable and cancellation is distinct', async () => {
  const offline = makeProvider([geoRoute(beijingCandidates), ['api.open-meteo.com', () => { throw new Error('ENOTFOUND'); }]]);
  await assert.rejects(offline.fetchForecast({location: '北京', date: DATE, units: 'metric'}, signal()), {code: 'EXTERNAL_FAILURE', retryable: true});

  const aborted = new AbortController();
  aborted.abort();
  const provider = makeProvider([geoRoute(beijingCandidates), forecastRoute(healthyDaily)]);
  await assert.rejects(provider.fetchForecast({location: '北京', date: DATE, units: 'metric'}, aborted.signal), {code: 'CANCELLED'});
});

test('a malformed forecast payload is not passed through as data', async () => {
  const missing = makeProvider([geoRoute(beijingCandidates), ['api.open-meteo.com', () => jsonResponse({latitude: 39.9})]]);
  await assert.rejects(missing.fetchForecast({location: '北京', date: DATE, units: 'metric'}, signal()), {code: 'EXTERNAL_FAILURE'});

  const nullTemps = makeProvider([geoRoute(beijingCandidates), forecastRoute({...healthyDaily, temperature_2m_min: [null]})]);
  await assert.rejects(nullTemps.fetchForecast({location: '北京', date: DATE, units: 'metric'}, signal()), {code: 'NOT_FOUND'});
});

test('an empty location is refused rather than resolved to somewhere', async () => {
  const provider = makeProvider([geoRoute(beijingCandidates), forecastRoute(healthyDaily)]);
  await assert.rejects(provider.fetchForecast({location: '   ', date: DATE, units: 'metric'}, signal()), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(provider.resolvePlace('   ', undefined, signal()), {code: 'INVALID_ARGUMENT'});
});

test('the connector advertises conditional verification for the real provider', () => {
  const provider = makeProvider([geoRoute(beijingCandidates), forecastRoute(healthyDaily)]);
  assert.equal(provider.verification, 'conditional');
  const connector = new WeatherConnector(new WeatherService({provider, now: Date.now}));
  assert.equal(connector.manifest.verification, 'conditional');
  assert.equal(connector.manifest.authentication, 'none');
  assert.equal(connector.manifest.configSchema.properties.minCorroboratedPopulation.type, 'integer');
  validateContract('connector', connector.manifest);
});

test('tool output from the real provider passes the declared output schema', async () => {
  const fetchImpl = stubFetch([geoRoute(beijingCandidates), forecastRoute({...healthyDaily, precipitation_probability_max: [null]})]);
  const clock = new FakeClock(Date.parse('2026-09-06T02:00:00.000Z'));
  const host = new FakeToolHost(clock.now);
  const dispose = register(host, {provider: new OpenMeteoProvider({fetchImpl}), now: clock.now});
  const context = {
    taskId: 't', runId: 'r', authorizationRef: 'fixture',
    signal: new AbortController().signal,
    deadline: new Date(clock.now() + 60_000).toISOString(),
    scopes: ['weather:read'],
  };

  const result = await host.invoke('weather.forecast', {location: '北京', date: DATE}, context);
  assert.equal(result.record.source, 'open-meteo');
  assert.equal(result.forecast.publishedTimeKind, 'coverage_start');
  assert.equal(result.forecast.precipitationProbability, null);
  assert.ok(!('resolved' in result.forecast), 'the tool answer carries the weather only, not the place resolution');

  dispose();
  await assert.rejects(host.invoke('weather.forecast', {location: '北京', date: DATE}, context), {code: 'UNSUPPORTED_CAPABILITY'});
});

test('the hint stays a record-identity switch while the tool answer remains weather-only', async () => {
  const clock = new FakeClock(Date.parse('2026-09-06T02:00:00.000Z'));
  const context = {
    taskId: 't', runId: 'r', authorizationRef: 'fixture',
    signal: new AbortController().signal,
    deadline: new Date(clock.now() + 60_000).toISOString(),
    scopes: ['weather:read'],
  };

  const weak = new FakeToolHost(clock.now);
  const disposeWeak = register(weak, {provider: makeProvider([captureRoutes(CAPTURES), forecastRoute(healthyDaily)]), now: clock.now});
  const unhinted = await weak.invoke('weather.forecast', {location: '伦敦', date: DATE}, context);
  const hinted = await weak.invoke('weather.forecast', {location: '伦敦', locationQuery: 'London', date: DATE}, context);
  assert.notEqual(unhinted.record.dedupeKey, hinted.record.dedupeKey, 'the hint changes which place the record is about');
  assert.ok(!('resolved' in unhinted.forecast) && !('resolved' in hinted.forecast), 'no place resolution is disclosed in the answer');
  disposeWeak();

  const guarded = new FakeToolHost(clock.now);
  const disposeGuarded = register(guarded, {
    provider: makeProvider([captureRoutes(CAPTURES), forecastRoute(healthyDaily)], {locationResolution: 'strict'}),
    now: clock.now,
  });
  await assert.rejects(guarded.invoke('weather.forecast', {location: '伦敦', date: DATE}, context), {code: 'INVALID_ARGUMENT'});
  await guarded.invoke('weather.forecast', {location: '伦敦', locationQuery: 'London', date: DATE}, context);
  disposeGuarded();
});

/** Captured from `https://secure.geonames.org/searchJSON?name_equals=伦敦&lang=zh` and `/v1/get` on 2026-09-07. */
const geonamesRoute = (idsByQuery, username) => ['secure.geonames.org', url => {
  const parsed = new URL(url);
  if (parsed.searchParams.get('username') !== username) return jsonResponse({status: {message: 'user does not exist.', value: 10}}, 401);
  const ids = idsByQuery[parsed.searchParams.get('name_equals')] ?? [];
  return jsonResponse({totalResultsCount: ids.length, geonames: ids.map(id => ({geonameId: id, name: String(id), lng: 0, lat: 0}))});
}];

const v1getRoute = recordsById => ['geocoding-api.open-meteo.com', url => {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('/v1/get')) {
    const record = recordsById[parsed.searchParams.get('id')];
    return record === undefined ? jsonResponse({error: true, reason: 'Id not found'}, 404) : jsonResponse(record);
  }
  const captures = CAPTURES[parsed.searchParams.get('name')] ?? {};
  return jsonResponse({results: captures[parsed.searchParams.get('language')] ?? []});
}];

const ukLondon = {id: 2643743, name: '倫敦', latitude: 51.50853, longitude: -0.12574, timezone: 'Europe/London', feature_code: 'PPLC', population: 8961989, country: '英国', admin1: '英格兰'};

test('the GeoNames tier resolves simplified names the zh index lacks', async () => {
  const provider = makeProvider(
    [geonamesRoute({'伦敦': [2643743]}, 'acct'), v1getRoute({2643743: ukLondon})],
    {geonamesUsername: 'acct'},
  );
  const place = await provider.resolvePlace('伦敦', undefined, signal());

  assert.equal(place.name, '倫敦');
  assert.equal(place.timezone, 'Europe/London');
  assert.equal(place.confidence, 'high');
  assert.equal(place.featureCode, 'PPLC');
  assert.equal(place.ambiguous, true, 'Canada, Ontario stays disclosed as an alternative');
  assert.ok(place.alternatives.some(entry => entry.includes('安大略')), JSON.stringify(place.alternatives));
});

test('rankPlaces treats the alternate-name relation as exact: 倫敦 outranks the 伦敦 collision', async () => {
  const provider = makeProvider(
    [geonamesRoute({'伦敦': [2643743]}, 'acct'), v1getRoute({2643743: ukLondon})],
    {geonamesUsername: 'acct'},
  );
  const calls = [];
  const place = await provider.resolvePlace('伦敦', undefined, signal());
  void calls;
  assert.equal(place.timezone, 'Europe/London', 'PPLC 8.9M beats the exact-spelling Canadian town via the exact pool');
});

test('without a username the tier never runs and behaviour is unchanged', async () => {
  const fetchImpl = stubFetch([captureRoutes(CAPTURES)]);
  const provider = new OpenMeteoProvider({fetchImpl});
  const place = await provider.resolvePlace('伦敦', undefined, signal());
  assert.ok(!fetchImpl.calls.some(url => url.includes('secure.geonames.org')));
  assert.equal(place.timezone, 'America/Toronto', 'the pre-tier misresolution, disclosed as low');
  assert.equal(place.confidence, 'low');
});

test('a GeoNames failure skips the tier instead of failing the query', async () => {
  const rejected = makeProvider(
    [geonamesRoute({'伦敦': [2643743]}, 'acct'), v1getRoute({}), captureRoutes(CAPTURES)],
    {geonamesUsername: 'acct'},
  );
  const place = await rejected.resolvePlace('伦敦', undefined, signal());
  assert.equal(place.timezone, 'America/Toronto', '401 from GeoNames degrades to Open-Meteo-only');

  const softError = makeProvider(
    [v1getRoute({}), ['secure.geonames.org', () => jsonResponse({status: {message: 'the daily limit of 30000 credits for acct has been exceeded', value: 18}})]],
    {geonamesUsername: 'acct'},
  );
  const degraded = await softError.resolvePlace('北京', undefined, signal());
  assert.equal(degraded.name, '北京');
});

test('a dropped /v1/get id removes only that candidate', async () => {
  const cairoEgypt = {id: 360630, name: '开罗', latitude: 30.06263, longitude: 31.24967, timezone: 'Africa/Cairo', feature_code: 'PPLC', population: 9606916, country: '埃及'};
  const provider = makeProvider(
    [geonamesRoute({'开罗': [9999999, 360630]}, 'acct'), v1getRoute({360630: cairoEgypt}), captureRoutes(CAPTURES)],
    {geonamesUsername: 'acct'},
  );
  const place = await provider.resolvePlace('开罗', undefined, signal());
  assert.equal(place.timezone, 'Africa/Cairo', 'the 404 id vanishes, Egypt Cairo survives with high confidence');
});

test('cancellation during the GeoNames tier is not swallowed', async () => {
  const controller = new AbortController();
  controller.abort();
  const provider = makeProvider(
    [geonamesRoute({'伦敦': [2643743]}, 'acct'), v1getRoute({2643743: ukLondon}), captureRoutes(CAPTURES)],
    {geonamesUsername: 'acct'},
  );
  await assert.rejects(provider.resolvePlace('伦敦', undefined, controller.signal), {code: 'CANCELLED'});
});

const LIVE = process.env.PA_WEATHER_LIVE === '1';
const LIVE_SKIP = LIVE ? false : 'set PA_WEATHER_LIVE=1 to run the real provider read-back';
const GEONAMES_USER = process.env.PA_GEONAMES_USERNAME;
const GEONAMES_LIVE_SKIP = LIVE && GEONAMES_USER ? false : 'set PA_WEATHER_LIVE=1 and PA_GEONAMES_USERNAME=<geonames account> to run the tier against the real APIs';

test('live GeoNames tier resolves simplified names end to end', {skip: GEONAMES_LIVE_SKIP}, async () => {
  const provider = new OpenMeteoProvider({language: 'zh', geonamesUsername: GEONAMES_USER});
  for (const [query, timezone] of [['纽约', 'America/New_York'], ['首尔', 'Asia/Seoul'], ['开罗', 'Africa/Cairo']]) {
    const place = await provider.resolvePlace(query, undefined, signal());
    assert.equal(place.timezone, timezone, `${query} -> ${timezone}`);
    assert.equal(place.confidence, 'high');
  }
});

test('live read-back against Open-Meteo', {skip: LIVE_SKIP}, async () => {
  const date = new Date().toISOString().slice(0, 10);
  const service = new WeatherService({provider: new OpenMeteoProvider(), now: Date.now});
  const result = await service.getForecast({location: '北京', date});

  assert.equal(result.record.source, 'open-meteo');
  validateContract('connectorItem', result.record);

  assert.equal(result.forecast.publishedTimeKind, 'coverage_start');
  assert.equal(result.forecast.resolved.timezone, 'Asia/Shanghai');
  assert.equal(result.forecast.resolved.confidence, 'high');
  assert.equal(result.forecast.resolved.featureCode, 'PPLC');
  assert.ok(result.forecast.resolved.latitude > 39 && result.forecast.resolved.latitude < 41);
  assert.ok(result.forecast.summary.length > 0);
  assert.ok(Number.isFinite(result.forecast.temperatureMin));
  assert.ok(Number.isFinite(result.forecast.temperatureMax));
  assert.ok(result.forecast.temperatureMin <= result.forecast.temperatureMax);

  const [coverageStart, coverageEnd] = result.record.validFor.split('/');
  assert.equal(result.record.occurredAt, coverageStart, 'occurredAt is the coverage start for this provider');
  assert.equal(Date.parse(coverageEnd) - Date.parse(coverageStart), 86_400_000, 'Asia/Shanghai has no DST');
  assert.notEqual(result.record.occurredAt, result.record.fetchedAt);

  const cached = await service.getForecast({location: '北京', date});
  assert.equal(cached.cache.state, 'fresh', 'a second call within TTL must not hit the network');
  assert.deepEqual(cached.forecast, result.forecast);

  console.log('live read-back:', JSON.stringify({
    occurredAt: result.record.occurredAt, fetchedAt: result.record.fetchedAt, validFor: result.record.validFor,
    summary: result.forecast.summary, min: result.forecast.temperatureMin, max: result.forecast.temperatureMax,
    precip: result.forecast.precipitationProbability, resolved: result.forecast.resolved,
  }));
});

test('live read-back defaults the date to the destination local day', {skip: LIVE_SKIP}, async () => {
  const now = Date.now();
  const service = new WeatherService({provider: new OpenMeteoProvider(), now: () => now});
  // Cross-checked through a different locale and `format()` rather than the `formatToParts` path
  // the implementation uses, so the assertion cannot agree with a bug in that path.
  const localDay = timeZone => new Intl.DateTimeFormat('zh-CN', {timeZone, year: 'numeric', month: 'numeric', day: 'numeric'})
    .format(now).split('/').map(part => part.padStart(2, '0')).join('-');
  const utcDay = new Date(now).toISOString().slice(0, 10);
  const report = {utcDay};

  for (const [location, timeZone] of [['北京', 'Asia/Shanghai'], ['New York', 'America/New_York']]) {
    const result = await service.getForecast({location});
    assert.equal(result.forecast.resolved.timezone, timeZone, `${location} resolved where expected`);
    assert.equal(result.forecast.date, localDay(timeZone), `${location} defaults to its own local day`);
    assert.ok(result.record.dedupeKey.endsWith(`:${result.forecast.date}:metric`), 'the identity carries the local day');
    report[location] = {localDay: localDay(timeZone), forecastDate: result.forecast.date, differsFromUtcDay: result.forecast.date !== utcDay};
  }

  console.log('live default-date read-back:', JSON.stringify(report));
});

test('live read-back labels the reported misresolutions and the hint that repairs them', {skip: LIVE_SKIP}, async () => {
  const provider = new OpenMeteoProvider();
  const sig = signal();
  const report = {};

  for (const location of ['东京', '伦敦', '罗马', '丽江', '广东']) {
    const resolved = await provider.resolvePlace(location, undefined, sig);
    assert.equal(resolved.confidence, 'low', `${location} must be labelled weak`);
    report[location] = {name: resolved.name, admin1: resolved.admin1, timezone: resolved.timezone, confidence: resolved.confidence};
  }

  const repairs = [['东京', 'Tokyo', 'Asia/Tokyo'], ['伦敦', 'London', 'Europe/London'], ['罗马', 'Rome', 'Europe/Rome'], ['丽江', 'Lijiang', 'Asia/Shanghai'], ['纽约', 'New York', 'America/New_York'], ['首尔', 'Seoul', 'Asia/Seoul']];
  for (const [location, hint, timezone] of repairs) {
    const resolved = await provider.resolvePlace(location, hint, sig);
    assert.equal(resolved.timezone, timezone, `${location} + ${hint}`);
    assert.equal(resolved.confidence, 'high', `${location} + ${hint}`);
    report[`${location}+${hint}`] = {name: resolved.name, admin1: resolved.admin1, timezone: resolved.timezone};
  }

  const english = new OpenMeteoProvider({language: 'en'});
  const beijing = await english.resolvePlace('北京', undefined, sig);
  assert.equal(beijing.timezone, 'Asia/Shanghai', 'a Chinese place resolves under an English configuration');
  assert.equal(beijing.confidence, 'high');
  for (const region of ['England', 'Texas', 'France']) {
    assert.equal((await english.resolvePlace(region, undefined, sig)).confidence, 'low', `${region} is a region, not a city`);
  }

  const strict = new OpenMeteoProvider({locationResolution: 'strict'});
  assert.equal((await strict.resolvePlace('北京', undefined, sig)).confidence, 'high');
  assert.equal((await strict.resolvePlace('巴黎', undefined, sig)).timezone, 'Europe/Paris');
  await assert.rejects(strict.resolvePlace('东京', undefined, sig), {code: 'INVALID_ARGUMENT'});

  console.log('live geocoding read-back:', JSON.stringify(report, null, 1));
});

/**
 * Measured 2026-10-19: `name=纽约` and `name=首尔` return zero results under every language pass,
 * because the provider's `zh` index is Traditional and incomplete. A bare "found no place named"
 * left the caller with nothing to do, so the message has to name the cause and the recovering call.
 */
test('a zero-candidate Han query names the script mismatch and the recovering call', async () => {
  const provider = makeProvider([geoRoutesByLanguage({})]);
  await assert.rejects(provider.resolvePlace('纽约', undefined, signal()), error => {
    assert.equal(error.code, 'NOT_FOUND');
    assert.match(error.message, /Traditional-Chinese index/);
    assert.match(error.message, /locationQuery/);
    assert.match(error.message, /New York/);
    return true;
  });
});

test('a zero-candidate Latin query keeps a short spelling hint', async () => {
  const provider = makeProvider([geoRoutesByLanguage({})]);
  await assert.rejects(provider.resolvePlace('Nowhereville', undefined, signal()), error => {
    assert.equal(error.code, 'NOT_FOUND');
    assert.match(error.message, /Check the spelling/);
    assert.doesNotMatch(error.message, /Traditional-Chinese/);
    return true;
  });
});

test('an unmatched hint is reported as such instead of repeating the retry advice', async () => {
  const provider = makeProvider([geoRoutesByLanguage({})]);
  await assert.rejects(provider.resolvePlace('纽约', 'Niuyue', signal()), error => {
    assert.match(error.message, /Neither that name nor the hint "Niuyue"/);
    return true;
  });
});

/** Captured from `https://geocoding-api.open-meteo.com/v1/search?name=New+York&language=en`. */
const newYorkCity = {id: 5128581, name: 'New York', latitude: 40.71427, longitude: -74.00597, timezone: 'America/New_York', feature_code: 'PPL', population: 8804190, admin1: '纽约州', country: '美国'};

const nameRoutes = byName => ['geocoding-api.open-meteo.com', url => {
  const parsed = new URL(url);
  const byLanguage = byName[parsed.searchParams.get('name')] ?? {};
  return jsonResponse({results: byLanguage[parsed.searchParams.get('language')] ?? []});
}];

test('a shipped alias resolves 纽约 with no account and no caller hint', async () => {
  const provider = makeProvider([nameRoutes({'纽约': {zh: [], en: []}, 'New York': {zh: [], en: [newYorkCity]}})]);
  const place = await provider.resolvePlace('纽约', undefined, signal());

  assert.equal(place.name, 'New York');
  assert.equal(place.timezone, 'America/New_York');
  assert.equal(place.confidence, 'high');
  assert.equal(place.ambiguous, false, 'a single major seat leaves nothing to disclose');
});

test('the alias tier stays idle when the first pass already resolves a major seat', async () => {
  const fetchImpl = stubFetch([captureRoutes(CAPTURES)]);
  const provider = new OpenMeteoProvider({fetchImpl});
  const place = await provider.resolvePlace('北京', undefined, signal());

  assert.equal(place.confidence, 'high');
  assert.equal(fetchImpl.calls.length, 2, 'zh + en only; no alias pass for a name that resolved');
});

/**
 * Review finding on #417: the first generated table mapped 釜山 to Foshan (CN) and 奥克兰 to
 * Oakland (US) — `name_equals` returns homographs abroad and the generator had ranked by
 * population only. Entries are now bound to the country the candidate list meant.
 */
test('the shipped table never crosses the border on a homograph', () => {
  assert.equal(ZH_PLACE_ALIASES['釜山'], 'Busan');
  assert.equal(ZH_PLACE_ALIASES['奥克兰'], undefined, 'no New Zealand hit, so no entry rather than Oakland');
  assert.equal(ZH_PLACE_ALIASES['上海'], undefined, 'domestic names are answered by the zh index and stay out of the table');
});

test('釜山 resolves to Korea, not to its Chinese homograph', async () => {
  const busan = {id: 1838524, name: 'Busan', latitude: 35.10278, longitude: 129.04028, timezone: 'Asia/Seoul', feature_code: 'PPLA', population: 3285147, admin1: '釜山广域市', country: '韩国'};
  const provider = makeProvider([nameRoutes({'釜山': {zh: [], en: []}, 'Busan': {zh: [], en: [busan]}})]);
  const place = await provider.resolvePlace('釜山', undefined, signal());

  assert.equal(place.name, 'Busan');
  assert.equal(place.country, '韩国');
  assert.equal(place.timezone, 'Asia/Seoul');
  assert.equal(place.confidence, 'high');
});

test('奥克兰 stays unresolved rather than answering for Oakland', async () => {
  const oakland = {id: 5378538, name: 'Oakland', latitude: 37.80437, longitude: -122.2708, timezone: 'America/Los_Angeles', feature_code: 'PPLA2', population: 419267, admin1: '加州', country: '美国'};
  const provider = makeProvider([nameRoutes({'奥克兰': {zh: [], en: []}, 'Oakland': {zh: [], en: [oakland]}})]);
  await assert.rejects(provider.resolvePlace('奥克兰', undefined, signal()), {code: 'NOT_FOUND'});
});

test('reads present conditions and the requested day hourly curve when the provider publishes them', async () => {
  const route = ['api.open-meteo.com', url => {
    const date = new URL(url).searchParams.get('start_date');
    assert.match(url, /[?&]current=/);
    assert.match(url, /[?&]hourly=/);
    return jsonResponse({
      latitude: 39.89, longitude: 116.36, timezone: 'Asia/Shanghai',
      daily: {time: [date], temperature_2m_min: [22.3], temperature_2m_max: [31.4],
        precipitation_probability_max: [12], weather_code: [3]},
      current: {time: '2026-09-06T11:00', temperature_2m: 26.4, apparent_temperature: 27.1,
        relative_humidity_2m: 58, wind_speed_10m: 9.7, wind_direction_10m: 135, weather_code: 3},
      hourly: {time: ['2026-09-06T00:00', '2026-09-06T01:00', '2026-09-07T00:00'],
        temperature_2m: [22.5, 22.1, 21.0], precipitation_probability: [5, 10, 0], weather_code: [3, 3, 1]},
    });
  }];
  const {service} = makeService([geoRoute(beijingCandidates), route]);
  const result = await service.getForecast({location: '北京', date: DATE});
  assert.deepEqual(result.forecast.current, {observedAt: '2026-09-06T11:00', temperature: 26.4,
    apparentTemperature: 27.1, relativeHumidity: 58, windSpeed: 9.7, windDirection: 135, weatherCode: 3});
  assert.equal(result.forecast.hourly.length, 2, 'hours outside the requested local day are dropped');
  assert.deepEqual(result.forecast.hourly[0], {time: '2026-09-06T00:00', temperature: 22.5,
    precipitationProbability: 5, weatherCode: 3});
});

test('a provider without present conditions still answers the daily forecast', async () => {
  const {service} = makeService([geoRoute(beijingCandidates), forecastRoute(healthyDaily)]);
  const result = await service.getForecast({location: '北京', date: DATE});
  assert.equal(result.forecast.current, undefined);
  assert.equal(result.forecast.hourly, undefined);
});
