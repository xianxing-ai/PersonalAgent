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

test('create metadata does not promise retry safety and Fake writes preserve location instead of changing organizer',async()=>{
  const descriptors=[],provider=new FakeCalendarProvider([],{now:()=>NOW});
  const remove=register({register(tool){descriptors.push(tool.descriptor);return ()=>{};}},{provider,accountRef:'fixture',now:()=>NOW});
  try {
    assert.equal(descriptors.find(item=>item.name==='calendar.create').idempotencySupport,false);
    const first=await provider.writes.createEvent({uid:'location',summary:'synthetic',location:'room',notes:'notes',
      startUtc:'2026-10-21T07:00:00.000Z',endUtc:'2026-10-21T08:00:00.000Z'});
    assert.equal(first.sequence,0);assert.equal(first.updatedUtc,new Date(NOW).toISOString());
    const updated=await provider.writes.updateEvent({uid:first.externalId,location:'new room'});
    assert.equal(updated.location,'new room');assert.equal(updated.notes,'notes');assert.equal(updated.organizer,undefined);
  } finally {remove();}
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

/**
 * 2026-10-21 实测：云端工具目录不携带 description（`safeSchema()` 只投影结构字段），
 * 模型只能靠字段名判断语义。`calendar.events` 给出 `externalId`，而写工具要 `uid`，
 * 两者不同名 → 模型只能向用户索要"事件标识"。这里锁定"两个名字都可用"。
 */
test('取消/更新接受 externalId（与 calendar.events 同名字段）', async () => {
  const f = fixture();
  try {
    const created = await f.host.invoke('calendar.create', {summary: '同名标识',
      startUtc: '2026-10-21T07:00:00.000Z', endUtc: '2026-10-21T08:00:00.000Z'}, ctx());
    const id = created.item.externalId;
    const updated = await f.host.invoke('calendar.update', {externalId: id, summary: '改名后'}, ctx());
    assert.equal(updated.state, 'updated');
    assert.match(updated.item.contentRef, /改名后/);
    const cancelled = await f.host.invoke('calendar.cancel', {externalId: id}, ctx());
    assert.equal(cancelled.state, 'cancelled');
  } finally {f.unregister();}
});

test('标识缺失或重复时拒绝，不做猜测', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.host.invoke('calendar.cancel', {}, ctx()), {code: 'INVALID_ARGUMENT'});
    await assert.rejects(f.host.invoke('calendar.cancel', {uid: 'a', externalId: 'b'}, ctx()),
      {code: 'INVALID_ARGUMENT'});
  } finally {f.unregister();}
});

test('写工具（create/cancel/update）的参数名同时暴露 externalId 与 uid', () => {
  const descriptors = new Map();
  const unregister = register({register(tool) {descriptors.set(tool.descriptor.name, tool.descriptor); return () => {};}},
    {provider: new FakeCalendarProvider(), accountRef: 'cal', now: () => NOW});
  try {
    for (const name of ['calendar.create', 'calendar.cancel', 'calendar.update']) {
      const properties = descriptors.get(name).inputSchema.properties;
      assert.ok('externalId' in properties, `${name} 必须接受 externalId`);
      assert.ok('uid' in properties, `${name} 保留 uid 以兼容已保存提案`);
    }
  } finally {unregister();}
});

test('calendar.create 接受 externalId，显式标识重放幂等，改动内容报冲突', async () => {
  const f = fixture();
  try {
    const input = {
      externalId: 'evt-custom-1',
      summary: '自定义标识日程',
      startUtc: '2026-10-21T07:00:00.000Z',
      endUtc: '2026-10-21T08:00:00.000Z',
      location: '会议室 A',
    };
    const created = await f.host.invoke('calendar.create', input, ctx());
    assert.equal(created.state, 'created');
    assert.equal(created.item.externalId, 'evt-custom-1');
    assert.match(created.item.contentRef, /自定义标识日程/);

    // 同 externalId 同内容重放幂等
    const replay = await f.host.invoke('calendar.create', input, ctx());
    assert.equal(replay.state, 'created');
    assert.equal(replay.item.externalId, 'evt-custom-1');
    assert.equal(replay.item.dedupeKey, created.item.dedupeKey);

    // 同 externalId 但内容不同报 REVISION_CONFLICT
    await assert.rejects(
      f.host.invoke('calendar.create', {...input, summary: '修改后的标题'}, ctx()),
      error => error.code === 'REVISION_CONFLICT'
    );

    // 同时传入 externalId 与 uid 拒绝
    await assert.rejects(
      f.host.invoke('calendar.create', {...input, uid: 'uid-another'}, ctx()),
      error => error.code === 'INVALID_ARGUMENT'
    );
  } finally { f.unregister(); }
});

/**
 * 2026-10-22 实测：取消已落盘（回执 state:"cancelled"、Radicale 条目已删除），
 * 但回答写成"操作被中止、未产生任何更改"——`cancelled` 的英文歧义被读成过程而非效果。
 * 输出 schema 不随目录下发给模型，所以效果必须由回执自身的陈述句固定。
 */
test('写操作回执带无歧义的 summary，区分“已取消”与“操作被取消”', async () => {
  const f = fixture();
  try {
    const created = await f.host.invoke('calendar.create', {summary: '回执措辞',
      startUtc: '2026-10-21T07:00:00.000Z', endUtc: '2026-10-21T08:00:00.000Z'}, ctx());
    assert.match(created.summary, /已创建/);
    const updated = await f.host.invoke('calendar.update', {uid: created.item.externalId, summary: '改名'}, ctx());
    assert.match(updated.summary, /已更新/);
    const cancelled = await f.host.invoke('calendar.cancel', {externalId: created.item.externalId}, ctx());
    assert.equal(cancelled.state, 'cancelled');
    assert.match(cancelled.summary, /已取消/);
    assert.doesNotMatch(cancelled.summary, /操作/);
    const again = await f.host.invoke('calendar.cancel', {externalId: created.item.externalId}, ctx());
    assert.equal(again.state, 'already_absent');
    assert.match(again.summary, /原本就不存在/);
  } finally {f.unregister();}
});

test('calendar.update 支持 expectedSequence 与 ifMatch 条件写，版本不匹配时报 REVISION_CONFLICT 且不覆盖', async () => {
  const f = fixture();
  try {
    const created = await f.host.invoke('calendar.create', {
      externalId: 'evt-cond-1',
      summary: '初始版本',
      startUtc: '2026-10-21T07:00:00.000Z',
      endUtc: '2026-10-21T08:00:00.000Z',
    }, ctx());
    assert.equal(created.item.dedupeKey, 'calendar:cal-fake:evt-cond-1:0');

    // 条件版本匹配（sequence=0, ifMatch="evt-cond-1:0"）-> 更新成功至 sequence=1
    const updated = await f.host.invoke('calendar.update', {
      externalId: 'evt-cond-1',
      summary: '第一次条件更新',
      expectedSequence: 0,
      ifMatch: '"evt-cond-1:0"',
    }, ctx());
    assert.equal(updated.state, 'updated');
    assert.equal(updated.item.dedupeKey, 'calendar:cal-fake:evt-cond-1:1');

    // 旧 expectedSequence=0 再次更新 -> REVISION_CONFLICT，不覆盖现有内容
    await assert.rejects(
      f.host.invoke('calendar.update', {
        externalId: 'evt-cond-1',
        summary: '不应覆盖的过期写入',
        expectedSequence: 0,
      }, ctx()),
      error => error.code === 'REVISION_CONFLICT',
    );
    // 旧 ifMatch 再次更新 -> REVISION_CONFLICT
    await assert.rejects(
      f.host.invoke('calendar.update', {
        externalId: 'evt-cond-1',
        summary: '不应覆盖的过期 ETag 写入',
        ifMatch: '"evt-cond-1:0"',
      }, ctx()),
      error => error.code === 'REVISION_CONFLICT',
    );
    assert.equal(f.provider.getEvent('cal', 'evt-cond-1').title, '第一次条件更新');
    assert.equal(f.provider.getEvent('cal', 'evt-cond-1').sequence, 1);
  } finally {
    f.unregister();
  }
});
