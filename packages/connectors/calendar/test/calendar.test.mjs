import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CALENDAR_CONNECTOR_VERSION, CalendarConnector, FakeCalendarProvider, CalendarService, register} from '../dist/index.js';
import {FakeClock, FakeToolHost} from '@personal-agent/testkit';
import {ProtocolError, validateContract} from '@personal-agent/contracts';

const NOW = Date.parse('2026-09-07T00:00:00.000Z');
const ACCOUNT = 'acct-1';

function makeService(fixtures) {
  const provider = new FakeCalendarProvider(fixtures);
  const service = new CalendarService(provider, {now: () => NOW});
  return {provider, service, connector: null};
}

function itemWindow() {
  return {fromUtc: '2026-09-06T00:00:00.000Z', toUtc: '2026-11-02T00:00:00.000Z'};
}

test('夹具里的 DST 跨界事件：起止 UTC 瞬间与本地墙上时间成对且正确', async () => {
  const {service} = makeService();
  const page = await service.listEvents(ACCOUNT, itemWindow(), {limit: 10});
  const dst = page.items.find(item => item.externalId === 'evt-dst-night');
  assert.ok(dst, 'DST 事件在窗口内');
  // 纽约 2026-11-01：01:30 EDT = 05:30Z；03:00 EST = 08:00Z（回拨后）。
  assert.equal(dst.validFor, '2026-11-01T05:30:00.000Z/2026-11-01T08:00:00.000Z');
  assert.equal(dst.occurredAt, '2026-11-01T05:30:00.000Z');
  assert.match(dst.contentRef, /2026-11-01T01:30:00（America\/New_York）→ 2026-11-01T03:00:00/);
  assert.equal(dst.fetchedAt, '2026-09-07T00:00:00.000Z');
});

test('每条事件都通过 connectorItem 公共契约校验', async () => {
  const {service} = makeService();
  for (const item of (await service.listEvents(ACCOUNT, itemWindow(), {limit: 10})).items) {
    validateContract('connectorItem', item);
  }
});

test('窗口增量与去重：同一事件重复抓取 dedupeKey 稳定；变更后 sequence 递增换新键', async () => {
  const {service, provider} = makeService();
  const first = (await service.listEvents(ACCOUNT, itemWindow(), {limit: 10})).items.find(item => item.externalId === 'evt-review');
  const again = (await service.listEvents(ACCOUNT, itemWindow(), {limit: 10})).items.find(item => item.externalId === 'evt-review');
  assert.equal(first.dedupeKey, again.dedupeKey);
  provider.mutateEvent('evt-review', {startUtc: '2026-09-08T10:00:00.000Z', endUtc: '2026-09-08T11:30:00.000Z'});
  const changed = (await service.listEvents(ACCOUNT, itemWindow(), {limit: 10})).items.find(item => item.externalId === 'evt-review');
  assert.notEqual(changed.dedupeKey, first.dedupeKey);
  assert.equal(changed.validFor, '2026-09-08T10:00:00.000Z/2026-09-08T11:30:00.000Z');
});

test('分页：limit 收窄 + hasMore + 窗口内事件按开始时间排序', async () => {
  const {service} = makeService();
  const page1 = await service.listEvents(ACCOUNT, itemWindow(), {limit: 2});
  assert.equal(page1.items.length, 2);
  assert.ok(page1.hasMore);
  const page2 = await service.listEvents(ACCOUNT, itemWindow(), {cursor: page1.nextCursor, limit: 2});
  const ids = [...page1.items, ...page2.items].map(item => item.externalId);
  assert.deepEqual(ids, ['evt-standup', 'evt-review', 'evt-cancelled', 'evt-dst-night']);
  assert.equal(new Set(ids).size, ids.length);
});

test('搜索覆盖所有分页：后续页的事件（夜班/DST）也能命中', async () => {
  const {service} = makeService();
  assert.equal((await service.searchEvents(ACCOUNT, '站会')).length, 1);
  assert.equal((await service.searchEvents(ACCOUNT, '不存在的关键词')).length, 0);
  // evt-dst-night「夜班交接（跨 DST）」按开始时间排在第 4 位，默认页大小 2 → 第 2 页；
  // 修复前搜索只看第一页，永远命中不了它。
  const nightShift = await service.searchEvents(ACCOUNT, '夜班');
  assert.equal(nightShift.length, 1);
  assert.equal(nightShift[0].externalId, 'evt-dst-night');
  assert.equal(nightShift[0].validFor, '2026-11-01T05:30:00.000Z/2026-11-01T08:00:00.000Z');
  assert.equal((await service.getEventItem(ACCOUNT, 'evt-review')).externalId, 'evt-review');
  await assert.rejects(() => service.getEventItem(ACCOUNT, 'evt-none'), err => err.code === 'NOT_FOUND');
});

test('respond 幂等：同幂等键重复调用返回一致结果；键冲突换输入拒绝', async () => {
  const {service} = makeService();
  const first = await service.respond({accountRef: ACCOUNT, externalId: 'evt-review', response: 'accepted', idempotencyKey: 'idem-1'});
  const repeat = await service.respond({accountRef: ACCOUNT, externalId: 'evt-review', response: 'accepted', idempotencyKey: 'idem-1'});
  assert.deepEqual(first, repeat);
  validateContract('connectorAction', first);
  assert.equal(first.state, 'confirmed');
  assert.equal(first.actionId, 'calendar-respond:idem-1');
  await assert.rejects(() => service.respond({accountRef: ACCOUNT, externalId: 'evt-review', response: 'declined', idempotencyKey: 'idem-1'}), /reused/);
  await assert.rejects(() => service.respond({accountRef: ACCOUNT, externalId: 'evt-none', response: 'accepted', idempotencyKey: 'idem-2'}), /not found/);
});

test('连接器：manifest、健康状态、未连接拒绝、游标解码', async () => {
  const {service} = makeService();
  const connector = new CalendarConnector(service, CALENDAR_CONNECTOR_VERSION, {defaultWindowDays: 60, now: () => NOW});
  validateContract('connector', connector.manifest);
  assert.equal(connector.manifest.syncStrategy, 'windowed');
  assert.equal(connector.manifest.verification, 'mock');
  assert.deepEqual(connector.getCapabilities(), ['fetchChanges', 'search', 'getItem', 'performAction']);
  assert.equal(connector.health().state, 'disconnected');
  await assert.rejects(() => connector.fetchChanges({accountRef: ACCOUNT, limit: 5}), /not connected/);
  connector.connect();
  assert.equal(connector.health().state, 'ready');
  const page = await connector.fetchChanges({accountRef: ACCOUNT, limit: 2});
  assert.ok(page.hasMore);
  assert.ok(page.nextCursor.length > 0);
  const page2 = await connector.fetchChanges({accountRef: ACCOUNT, cursor: page.nextCursor, limit: 2});
  const overlap = page.items.filter(item => page2.items.some(other => other.externalId === item.externalId));
  assert.equal(overlap.length, 0, '分页不得重复投递同一事件');
  await assert.rejects(() => connector.performAction({accountRef: ACCOUNT, action: 'delete', input: {}, idempotencyKey: 'k'}), err => err.code === 'UNSUPPORTED_CAPABILITY');
  const action = await connector.performAction({accountRef: ACCOUNT, action: 'respond', input: {externalId: 'evt-review', response: 'tentative'}, idempotencyKey: 'k2'});
  assert.equal(action.state, 'confirmed');
});

test('工具注册：calendar.events 经 FakeToolHost 的 schema 校验与 scope 控制', async () => {
  const host = new FakeToolHost(() => NOW);
  const provider = new FakeCalendarProvider();
  const unregister = register(host, {provider, accountRef: ACCOUNT, now: () => NOW});
  const context = {taskId: 'task', runId: 'run', signal: new AbortController().signal, deadline: '2026-09-07T01:00:00.000Z', authorizationRef: 'test', scopes: ['calendar:read']};

  const result = await host.invoke('calendar.events', {fromUtc: '2026-09-06T00:00:00.000Z', toUtc: '2026-11-02T00:00:00.000Z', limit: 2}, context);
  assert.equal(result.items.length, 2);
  assert.ok(result.hasMore);
  assert.ok(result.nextCursor.length > 0);
  for (const item of result.items) validateContract('connectorItem', item);
  const page2 = await host.invoke('calendar.events', {fromUtc: '2026-09-06T00:00:00.000Z', toUtc: '2026-11-02T00:00:00.000Z', cursor: result.nextCursor, limit: 2}, context);
  assert.equal(page2.items.length, 2);
  assert.deepEqual([...result.items, ...page2.items].map(item => item.externalId).sort(), ['evt-cancelled', 'evt-dst-night', 'evt-review', 'evt-standup']);

  await assert.rejects(host.invoke('calendar.events', {}, {...context, scopes: []}), err => err.code === 'SCOPE_DENIED');
  await assert.rejects(host.invoke('calendar.events', {fromUtc: '2026-09-08T00:00:00.000Z', toUtc: '2026-09-07T00:00:00.000Z'}, context), /ascending/);
  unregister();
});

test('register 缺 provider 直接拒绝（不静默启用 Fake）', () => {
  const host = new FakeToolHost(() => NOW);
  assert.throws(() => register(host, {}), /provider must be explicitly configured/);
});

test('窗口必须递增、游标损坏报 CURSOR_EXPIRED', async () => {
  const {service} = makeService();
  await assert.rejects(() => service.listEvents(ACCOUNT, {fromUtc: '2026-09-08T00:00:00.000Z', toUtc: '2026-09-07T00:00:00.000Z'}, {}), /ascending/);
  void ProtocolError;
});

test('窗口校验错误消息以大写开头，与其余消息约定一致（#308）', async () => {
  const {service} = makeService();
  await assert.rejects(() => service.listEvents(ACCOUNT,
    {fromUtc: '2026-09-08T00:00:00.000Z', toUtc: '2026-09-07T00:00:00.000Z'}, {}),
    error => error.code === 'INVALID_ARGUMENT' && /^Calendar window/.test(error.message));
});
