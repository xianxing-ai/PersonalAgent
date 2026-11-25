import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isDeepStrictEqual} from 'node:util';
import {CalDavProvider, parseCalDavEvents, zonedWallToUtc} from '../dist/index.js';
import {CalendarService} from '../dist/index.js';

const CALENDAR_URL = 'https://caldav.example.test/calendars/alice/default/';
const ACCOUNT = 'caldav-me';

function xmlResponse(body, status = 207) {
  // 207 Multi-Status 在 fetch 语义下 ok=false，提供商必须按状态码显式接受。
  return {ok: status >= 200 && status < 300, status, text: async () => body};
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function eventIcs({uid, summary, start, end, status, sequence = 0, lastModified}) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', 'BEGIN:VEVENT',
    `UID:${uid}`, `SUMMARY:${summary}`, ...(start.params ? [`DTSTART;${start.params}:${start.value}`] : [`DTSTART:${start.value}`]),
    ...(end.params ? [`DTEND;${end.params}:${end.value}`] : [`DTEND:${end.value}`]),
    ...(status ? [`STATUS:${status}`] : []), `SEQUENCE:${sequence}`,
    ...(lastModified ? [`LAST-MODIFIED:${lastModified}`] : []), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

function multistatus(responses) {
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
    + responses.map(item => `<D:response><D:href>${item.href}</D:href><D:propstat><D:prop>`
      + (item.ctag !== undefined ? `<x1:getctag xmlns:x1="urn:ietf:params:xml:ns:caldav">${item.ctag}</x1:getctag>` : '')
      + (item.etag !== undefined ? `<D:getetag>${escapeXml(item.etag)}</D:getetag>` : '')
      + (item.calendarData !== undefined ? `<C:calendar-data>${escapeXml(item.calendarData)}</C:calendar-data>` : '')
      + '</D:prop></D:propstat></D:response>').join('')
    + '</D:multistatus>';
}

function fixtureServer({propfind, report, propfindStatus = 207, reportStatus = 207}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({url, method: init.method, body: init.body, depth: init.headers.depth, auth: init.headers.authorization});
    if (init.method === 'PROPFIND') return xmlResponse(typeof propfind === 'function' ? propfind(calls.at(-1)) : propfind, propfindStatus);
    return xmlResponse(typeof report === 'function' ? report(calls.at(-1)) : report, reportStatus);
  };
  return {fetchImpl, calls};
}

const WINDOW = {fromUtc: '2026-11-01T00:00:00.000Z', toUtc: '2026-11-30T00:00:00.000Z'};

test('请求超时会中止传输并标记为可重试', async () => {
  let aborted = false;
  const provider = new CalDavProvider({
    calendarUrl: CALENDAR_URL,
    requestTimeoutMs: 5,
    fetchImpl: async (_url, {signal}) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      }, {once: true});
    }),
  });
  await assert.rejects(provider.pollChanges(), error => error.code === 'EXTERNAL_FAILURE' && error.retryable);
  assert.equal(aborted, true);
});

test('pollChanges：一次 Depth:1 PROPFIND 取回 ctag 与子资源 etag（集合本身不入 etag 表）', async () => {
  const {fetchImpl, calls} = fixtureServer({propfind: multistatus([
    {href: '/calendars/alice/default/', ctag: 'ctag-7'},
    {href: '/calendars/alice/default/a.ics', etag: '"e1"'},
    {href: '/calendars/alice/default/b.ics', etag: '"e2"'},
  ])});
  const provider = new CalDavProvider({calendarUrl: CALENDAR_URL, authorization: 'Basic dXNlcjpwYXNz', fetchImpl});
  const snapshot = await provider.pollChanges();
  assert.equal(snapshot.ctag, 'ctag-7');
  assert.deepEqual(snapshot.etags, {'/calendars/alice/default/a.ics': '"e1"', '/calendars/alice/default/b.ics': '"e2"'});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PROPFIND');
  assert.equal(calls[0].depth, '1');
  assert.equal(calls[0].auth, 'Basic dXNlcjpwYXNz');
  assert.match(calls[0].body, /getctag/);
});

test('fetchWindow：REPORT 时间窗、TZID 事件换算、cancelled 剔除、客户端二次过滤', async () => {
  const shanghai = eventIcs({uid: 'evt-tz@test', summary: '上海时区会议',
    start: {params: 'TZID=Asia/Shanghai', value: '20261102T100000'},
    end: {params: 'TZID=Asia/Shanghai', value: '20261102T113000'}, sequence: 2});
  const utcEvent = eventIcs({uid: 'evt-utc@test', summary: 'UTC 事件',
    start: {value: '20261105T090000Z'}, end: {value: '20261105T100000Z'}});
  const cancelled = eventIcs({uid: 'evt-cancel@test', summary: '已取消',
    start: {value: '20261106T090000Z'}, end: {value: '20261106T100000Z'}, status: 'CANCELLED'});
  const outside = eventIcs({uid: 'evt-out@test', summary: '窗口外',
    start: {value: '20261201T090000Z'}, end: {value: '20261201T100000Z'}});
  const {fetchImpl, calls} = fixtureServer({propfind: multistatus([]), report: multistatus([
    {href: '/calendars/alice/default/tz.ics', etag: '"e-tz"', calendarData: shanghai},
    {href: '/calendars/alice/default/utc.ics', etag: '"e-utc"', calendarData: utcEvent},
    {href: '/calendars/alice/default/cancel.ics', etag: '"e-c"', calendarData: cancelled},
    {href: '/calendars/alice/default/out.ics', etag: '"e-out"', calendarData: outside},
  ])});
  const provider = new CalDavProvider({calendarUrl: CALENDAR_URL, fetchImpl});
  const page = await provider.fetchWindow(ACCOUNT, WINDOW);
  assert.equal(calls[0].method, 'REPORT');
  assert.match(calls[0].body, /time-range start="20261101T000000Z"\s+end="20261130T000000Z"/);
  assert.deepEqual(page.events.map(event => event.externalId), ['evt-tz@test', 'evt-utc@test']);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, undefined);
  const [shanghaiEvent] = page.events;
  assert.equal(shanghaiEvent.startUtc, '2026-11-02T02:00:00.000Z');
  assert.equal(shanghaiEvent.endUtc, '2026-11-02T03:30:00.000Z');
  assert.equal(shanghaiEvent.sequence, 2);
  assert.equal(shanghaiEvent.status, 'confirmed');
});

test('fetchWindow：非法窗口与游标拒绝；分页游标继续', async () => {
  const events = Array.from({length: 105}, (_, index) => eventIcs({
    uid: `evt-${String(index).padStart(3, '0')}@test`, summary: `批量${index}`,
    start: {value: '20261110T010000Z'}, end: {value: '20261110T010100Z'}}));
  const {fetchImpl} = fixtureServer({propfind: multistatus([]),
    report: multistatus(events.map((calendarData, index) => ({
      href: `/calendars/alice/default/e${index}.ics`, etag: `"e${index}"`, calendarData})))});
  const provider = new CalDavProvider({calendarUrl: CALENDAR_URL, fetchImpl});
  await assert.rejects(provider.fetchWindow(ACCOUNT, {fromUtc: '2026-11-01', toUtc: '2026-11-30T00:00:00.000Z'}),
    {code: 'INVALID_ARGUMENT'});
  await assert.rejects(provider.fetchWindow(ACCOUNT, WINDOW, 'x'), {code: 'INVALID_ARGUMENT'});
  const first = await provider.fetchWindow(ACCOUNT, WINDOW);
  assert.equal(first.events.length, 100);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, '100');
  const second = await provider.fetchWindow(ACCOUNT, WINDOW, '100');
  assert.equal(second.events.length, 5);
  assert.equal(second.hasMore, false);
});

test('getEvent：单条读回保留 cancelled（取消不能靠列表轮询发现）', async () => {
  const cancelled = eventIcs({uid: 'evt-cancel@test', summary: '已取消',
    start: {value: '20261106T090000Z'}, end: {value: '20261106T100000Z'}, status: 'CANCELLED'});
  const {fetchImpl, calls} = fixtureServer({propfind: multistatus([]),
    report: multistatus([{href: '/x.ics', etag: '"e"', calendarData: cancelled}])});
  const provider = new CalDavProvider({calendarUrl: CALENDAR_URL, fetchImpl});
  const found = await provider.getEvent(ACCOUNT, 'evt-cancel@test');
  assert.equal(found.status, 'cancelled');
  // 单条读回不带时间窗过滤（time-range 元素缺省），不会漏掉窗口外目标。
  assert.equal(/time-range/.test(calls[0].body), false);
  assert.equal((await provider.getEvent(ACCOUNT, 'missing@test')), undefined);
  await assert.rejects(provider.getEvent(ACCOUNT, ''), {code: 'INVALID_ARGUMENT'});
});

test('respond：只读首片显式 UNSUPPORTED_CAPABILITY', () => {
  const provider = new CalDavProvider({calendarUrl: CALENDAR_URL, fetchImpl: async () => xmlResponse('')});
  assert.throws(() => provider.respond({accountRef: ACCOUNT, externalId: 'x', response: 'accepted', idempotencyKey: 'k'}),
    {code: 'UNSUPPORTED_CAPABILITY'});
});

test('错误映射：429/5xx/网络失败可重试，401 拒绝认证，400 不可重试', async () => {
  const cases = [
    {status: 408, expected: {code: 'TIMEOUT', retryable: true}},
    {status: 429, expected: {code: 'RATE_LIMITED', retryable: true}},
    {status: 503, expected: {code: 'EXTERNAL_FAILURE', retryable: true}},
    {status: 401, expected: {code: 'UNAUTHORIZED', retryable: false}},
    {status: 400, expected: {code: 'EXTERNAL_FAILURE', retryable: false}},
  ];
  for (const {status, expected} of cases) {
    const provider = new CalDavProvider({calendarUrl: CALENDAR_URL,
      fetchImpl: async () => xmlResponse('x', status)});
    await assert.rejects(provider.pollChanges(), error => error.code === expected.code && error.retryable === expected.retryable
      || (assert.fail(`HTTP ${status}: ${error.code}/${error.retryable}`), false));
  }
  const network = new CalDavProvider({calendarUrl: CALENDAR_URL, fetchImpl: async () => { throw Error('reset'); }});
  await assert.rejects(network.pollChanges(), {code: 'EXTERNAL_FAILURE', retryable: true});
  const badCert = new CalDavProvider({calendarUrl: CALENDAR_URL, fetchImpl: async () => {
    throw Object.assign(new Error('cert expired'), {code: 'CERT_HAS_EXPIRED'});
  }});
  await assert.rejects(badCert.pollChanges(), {code: 'EXTERNAL_FAILURE', retryable: false});
  const malformed = new CalDavProvider({calendarUrl: CALENDAR_URL, fetchImpl: async () => xmlResponse('<html>not caldav</html>')});
  await assert.rejects(malformed.pollChanges(), {code: 'EXTERNAL_FAILURE', retryable: false});
  const empty = new CalDavProvider({calendarUrl: CALENDAR_URL, fetchImpl: async () => xmlResponse('   ')});
  await assert.rejects(empty.pollChanges(), {code: 'EXTERNAL_FAILURE', retryable: false});
});

test('构造：HTTPS 强制、URL 尾斜杠规范化、207 作为成功状态、verification=conditional', async () => {
  assert.throws(() => new CalDavProvider({calendarUrl: 'http://insecure.test/cal/'}), {code: 'INVALID_ARGUMENT'});
  const {fetchImpl, calls} = fixtureServer({propfind: multistatus([{href: '/cal/', ctag: 'c'}])});
  const provider = new CalDavProvider({calendarUrl: 'https://caldav.example.test/calendars/alice/default', fetchImpl});
  await provider.pollChanges();
  assert.equal(calls[0].url, CALENDAR_URL);
  assert.equal(provider.verification, 'conditional');
  assert.equal(provider.providerKind, 'caldav');
  assert.deepEqual(provider.listCalendars(), [{id: 'caldav', name: 'default', timeZone: 'UTC'}]);
});

test('zonedWallToUtc：固定偏移、DST 回拨歧义取较早、春季空洞收敛、非法时区拒绝', () => {
  assert.equal(zonedWallToUtc('20261102T100000', 'Asia/Shanghai'),
    Date.parse('2026-11-02T02:00:00.000Z'));
  // 纽约 2026-11-01 01:30 在回拨后出现两次；收敛到较早的 EDT(-04:00)。
  assert.equal(zonedWallToUtc('20261101T013000', 'America/New_York'),
    Date.parse('2026-11-01T05:30:00.000Z'));
  // 回拨前一小时（00:30，仅 EDT）唯一。
  assert.equal(zonedWallToUtc('20261101T003000', 'America/New_York'),
    Date.parse('2026-11-01T04:30:00.000Z'));
  // 春季空洞 02:30 不存在：收敛到偏移切换后的等价瞬间（EST -05:00 → 07:30Z）。
  assert.equal(zonedWallToUtc('20260308T023000', 'America/New_York'),
    Date.parse('2026-03-08T07:30:00.000Z'));
  assert.equal(zonedWallToUtc('20261102T100000', 'Not/A_Zone'), undefined);
});

test('parseCalDavEvents：非法 TZID 或缺起止的事件剔除，全天事件排他日界', () => {
  const events = parseCalDavEvents([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:bad-tz', 'SUMMARY:坏时区',
    'DTSTART;TZID=Nowhere/Bogus:20261102T100000', 'DTEND;TZID=Nowhere/Bogus:20261102T110000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:no-end', 'SUMMARY:缺DTEND', 'DTSTART:20261102T100000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:allday', 'SUMMARY:全天',
    'DTSTART;VALUE=DATE:20261103', 'DTEND;VALUE=DATE:20261103', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  assert.deepEqual(events.map(event => event.uid), ['allday']);
  assert.equal(events[0].startMs, Date.parse('2026-11-03T00:00:00.000Z'));
  assert.equal(events[0].endMs, Date.parse('2026-11-04T00:00:00.000Z'));
  assert.equal(events[0].allDay, true);
});

test('经 CalendarService 规范化：dedupeKey 携带 sequence，occurredAt=开始时刻', async () => {
  const ics = eventIcs({uid: 'svc@test', summary: '服务层',
    start: {params: 'TZID=Asia/Tokyo', value: '20261102T090000'},
    end: {params: 'TZID=Asia/Tokyo', value: '20261102T100000'}, sequence: 3});
  const {fetchImpl} = fixtureServer({propfind: multistatus([]),
    report: multistatus([{href: '/svc.ics', etag: '"s"', calendarData: ics}])});
  const provider = new CalDavProvider({calendarUrl: CALENDAR_URL, fetchImpl});
  const service = new CalendarService(provider, {now: () => Date.parse('2026-11-01T00:00:00.000Z')});
  const page = await service.listEvents(ACCOUNT, WINDOW);
  assert.equal(page.items.length, 1);
  const [item] = page.items;
  assert.equal(item.source, 'calendar');
  assert.equal(item.externalId, 'svc@test');
  assert.equal(item.occurredAt, '2026-11-02T00:00:00.000Z');
  assert.equal(item.dedupeKey, 'calendar:caldav:svc@test:3');
  assert.equal(item.validFor, '2026-11-02T00:00:00.000Z/2026-11-02T01:00:00.000Z');
  assert.match(item.contentRef, /\[confirmed\] 服务层｜2026-11-02T09:00:00（Asia\/Tokyo）→ 2026-11-02T10:00:00/);
});

const liveSkip = process.env.PA_CALDAV_LIVE === '1' && process.env.PA_CALDAV_URL
  ? false
  : 'set PA_CALDAV_LIVE=1 and PA_CALDAV_URL=<calendar collection url> (plus PA_CALDAV_USER/PA_CALDAV_PASSWORD when the server requires auth) to run against a real CalDAV server';

test('live CalDAV read-back: ctag/etag poll, wide window, single-event roundtrip', {skip: liveSkip}, async () => {
  const authorization = process.env.PA_CALDAV_USER !== undefined && process.env.PA_CALDAV_PASSWORD !== undefined
    ? `Basic ${Buffer.from(`${process.env.PA_CALDAV_USER}:${process.env.PA_CALDAV_PASSWORD}`, 'utf8').toString('base64')}`
    : undefined;
  const calendarUrl = process.env.PA_CALDAV_URL;
  // 本机回环的明文 http://（本地 Radicale 等验收服务器）需显式放行；其余仍要求 HTTPS。
  const allowLoopbackHttp = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/u.test(calendarUrl);
  const provider = new CalDavProvider({calendarUrl, authorization, allowLoopbackHttp});

  const snapshot = await provider.pollChanges();
  // ctag 是 Apple 扩展（Radicale 不支持）；至少要有一种变更信号：ctag 或非空 etag 表。
  assert.ok(typeof snapshot.ctag === 'string' && snapshot.ctag.length > 0
    || Object.keys(snapshot.etags).length > 0, 'poll must return a ctag or a non-empty etag map');
  console.log('live CalDAV ctag:', snapshot.ctag ?? '(unsupported by server)',
    '/ etag entries:', Object.keys(snapshot.etags).length);

  const page = await provider.fetchWindow('live', {fromUtc: '2000-01-01T00:00:00.000Z', toUtc: '2100-01-01T00:00:00.000Z'});
  console.log('live CalDAV events in first page:', page.events.length);
  if (page.events.length === 0) return; // 空日历：轮询与查询路径已验证，单条读回无目标可查。

  const first = page.events[0];
  assert.match(first.startUtc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  // 记录时区必须是合法 IANA 名（Intl 可构造），且墙上时间在该时区下换算回的 UTC 瞬间与 startUtc 一致
  // （DST 回拨歧义时刻允许两次出现，差值不超过一小时）。
  new Intl.DateTimeFormat('en-US', {timeZone: first.timeZone});
  const wallDigits = first.startLocal.replace(/[-:]/g, '').slice(0, 15);
  const roundTrip = zonedWallToUtc(wallDigits, first.timeZone);
  const delta = Math.abs(roundTrip - Date.parse(first.startUtc));
  assert.ok(delta === 0 || delta <= 3_600_000, 'event wall time does not match its UTC instant');
  console.log('live event time-zone round-trip passed');

  const readback = await provider.getEvent('live', first.externalId);
  assert.ok(isDeepStrictEqual(readback, first), 'single-event readback differs from the window result');
});

test('live CalDAV wrong credentials are refused as UNAUTHORIZED without retry', {
  skip: process.env.PA_CALDAV_LIVE === '1' && process.env.PA_CALDAV_URL && process.env.PA_CALDAV_USER !== undefined
    ? false
    : 'requires PA_CALDAV_LIVE=1, PA_CALDAV_URL and PA_CALDAV_USER (a server that enforces authentication)',
}, async () => {
  const calendarUrl = process.env.PA_CALDAV_URL;
  const allowLoopbackHttp = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/u.test(calendarUrl);
  const provider = new CalDavProvider({calendarUrl,
    allowLoopbackHttp,
    authorization: `Basic ${Buffer.from('definitely-not:the-password', 'utf8').toString('base64')}`});
  await assert.rejects(provider.pollChanges(), error => {
    assert.equal(error.code, 'UNAUTHORIZED');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('connector manifest follows the provider kind instead of a stale fixture example', async () => {
  const {CalendarConnector, CalendarService, FakeCalendarProvider, ICalSubscriptionProvider} = await import('../dist/index.js');
  const fixtureConnector = new CalendarConnector(new CalendarService(new FakeCalendarProvider(), {now: () => 0}));
  assert.deepEqual(fixtureConnector.manifest.accountTypes, ['fixture']);
  assert.equal(fixtureConnector.manifest.authentication, 'none');
  assert.ok(fixtureConnector.manifest.capabilities.includes('performAction'), 'Fake keeps respond');

  const {fetchImpl} = fixtureServer({propfind: multistatus([{href: '/cal/', ctag: 'c'}])});
  const real = new CalendarConnector(new CalendarService(
    new CalDavProvider({calendarUrl: 'https://caldav.example.test/cal/', fetchImpl}), {now: () => 0}));
  assert.deepEqual(real.manifest.accountTypes, ['caldav'], 'real providers are no longer labelled fixture');
  assert.equal(real.manifest.authentication, 'basic');
  assert.equal(real.manifest.verification, 'conditional');
  assert.ok(!real.manifest.capabilities.includes('performAction'),
    'read-only providers must not advertise respond');

  const subscription = new CalendarConnector(new CalendarService(
    new ICalSubscriptionProvider({url: 'https://calendar.example.test/feed.ics'}), {now: () => 0}));
  assert.deepEqual(subscription.manifest.accountTypes, ['ical-subscription']);
  assert.equal(subscription.manifest.authentication, 'none');
  assert.equal(subscription.manifest.verification, 'conditional');
  assert.ok(!subscription.manifest.capabilities.includes('performAction'));
});

test('loopback plain HTTP is opt-in and localhost-only', async () => {
  assert.throws(() => new CalDavProvider({calendarUrl: 'http://localhost:5232/user/cal/'}), {code: 'INVALID_ARGUMENT'});
  const {fetchImpl, calls} = fixtureServer({propfind: multistatus([{href: '/user/cal/', ctag: 'c'}])});
  const provider = new CalDavProvider({calendarUrl: 'http://127.0.0.1:5232/user/cal',
    allowLoopbackHttp: true, fetchImpl});
  await provider.pollChanges();
  assert.equal(calls[0].url, 'http://127.0.0.1:5232/user/cal/');
  assert.throws(() => new CalDavProvider({calendarUrl: 'http://192.168.1.5/cal/', allowLoopbackHttp: true}),
    {code: 'INVALID_ARGUMENT'}, 'non-loopback plaintext stays refused');
});
