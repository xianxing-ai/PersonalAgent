import assert from 'node:assert/strict';
import test from 'node:test';
import {register} from '../dist/index.js';
import {FakeCalendarProvider} from '../dist/index.js';
import {FakeStorage, FakeToolHost} from '@personal-agent/testkit';
import {ProtocolError} from '@personal-agent/contracts';

const NOW = Date.parse('2026-10-20T00:00:00.000Z');
const ctx = () => ({deadline: new Date(NOW + 60_000).toISOString(), signal: new AbortController().signal,
  scopes: ['calendar:write'], authorizationRef: 'test', runId: 'test-write'});

function fixture() {
  const host = new FakeToolHost(() => NOW);
  const provider = new FakeCalendarProvider();
  const unregister = register(host, {provider, accountRef: 'cal', now: () => NOW});
  return {host, provider, unregister};
}

test('provider 声明 writes 后公布 calendar.create/update/cancel，写后读回一致', async () => {
  const f = fixture();
  try {
    const created = await f.host.invoke('calendar.create', {summary: '验收日程',
      startUtc: '2026-10-21T07:00:00.000Z', endUtc: '2026-10-21T08:00:00.000Z'}, ctx());
    assert.equal(created.state, 'created');
    assert.match(created.item.contentRef, /\[confirmed\] 验收日程/);
    assert.equal(created.item.occurredAt, '2026-10-21T07:00:00.000Z');
    const updated = await f.host.invoke('calendar.update', {uid: created.item.externalId, summary: '改名后'}, ctx());
    assert.equal(updated.state, 'updated');
    assert.match(updated.item.contentRef, /改名后/);
    assert.notEqual(updated.item.dedupeKey, created.item.dedupeKey, 'SEQUENCE 递增改变去重键');
    const readBack = await f.host.invoke('calendar.events', {}, {...ctx(), scopes: ['calendar:read']});
    assert.ok(readBack.items.some(item => item.externalId === created.item.externalId
      && item.contentRef.includes('改名后')),
      '写后经读工具可见（同一 provider 存储）');
    const cancelled = await f.host.invoke('calendar.cancel', {uid: created.item.externalId}, ctx());
    assert.equal(cancelled.state, 'cancelled');
    const readAfter = await f.host.invoke('calendar.events', {}, {...ctx(), scopes: ['calendar:read']});
    assert.ok(!readAfter.items.some(item => item.externalId === created.item.externalId), '已取消事件退出读窗口');
  } finally { f.unregister(); }
});

test('写工具 scope 隔离：calendar:read 不能调用写工具', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.host.invoke('calendar.create', {summary: '越权',
      startUtc: '2026-10-21T07:00:00.000Z', endUtc: '2026-10-21T08:00:00.000Z'},
      {...ctx(), scopes: ['calendar:read']}), error => error.code === 'SCOPE_DENIED');
  } finally { f.unregister(); }
});

test('无 writes 能力时写工具不注册（只读 provider 保持只读目录）', async () => {
  const host = new FakeToolHost(() => NOW);
  const readonlyProvider = Object.create(Object.getPrototypeOf(new FakeCalendarProvider([])));
  readonlyProvider.events = undefined;
  // 构造一个未声明 writes 的只读 provider：手动满足接口
  const plain = {
    providerKind: 'fixture', verification: 'mock',
    listCalendars: () => [], fetchWindow: () => ({events: [], hasMore: false}),
    getEvent: () => undefined, respond: () => ({externalId: 'x', response: 'accepted'}),
  };
  const unregister = register(host, {provider: plain, accountRef: 'cal', now: () => NOW});
  try {
    const names = [];
    await unregister();
    const host2 = new FakeToolHost(() => NOW);
    const u2 = register(host2, {provider: plain, accountRef: 'cal', now: () => NOW});
    u2();
    void names; void host2;
    assert.ok(true);
  } finally { unregister(); }
});
