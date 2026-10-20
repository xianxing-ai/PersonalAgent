import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  PRODUCTIVITY_MODULE_VERSION,
  TodoService,
  applyReminderDispatches,
  buildReminderTrigger,
  localToUtc,
  register,
  reminderScheduleId,
  reminderTriggers,
} from '../dist/index.js';
import {FakeClock, FakeStorage, FakeToolHost} from '@personal-agent/testkit';
import {ProtocolError} from '@personal-agent/contracts';

const NOW = Date.parse('2026-09-07T00:00:00.000Z');

function makeService() {
  const storage = new FakeStorage().namespace('todo');
  let counter = 0;
  const service = new TodoService(storage, {now: () => NOW, idFactory: () => `t${++counter}`});
  return {service, storage};
}

test('工具创建和修改拒绝非法公历日期，原存储与revision保持不变', async () => {
  const host = new FakeToolHost(() => NOW), storage = new FakeStorage().namespace('calendar-validation');
  let counter = 0;
  const unregister = register(host, {storage, conversationId: 'calendar-validation', now: () => NOW, idFactory: () => `t${++counter}`});
  const context = {taskId: 'task', runId: 'calendar-validation', signal: new AbortController().signal,
    deadline: '2026-09-07T01:00:00.000Z', authorizationRef: 'test', scopes: ['todo:read', 'todo:write']};
  try {
    const {item} = await host.invoke('todo.create', {title: '保留原条目', remindUtc: '2026-09-08T09:00:00Z'}, context);
    const before = structuredClone(storage.get('todo:state'));
    const trigger = buildReminderTrigger(item, 'calendar-validation');
    for (const date of ['2026-02-30', '2026-02-29', '2026-04-31', '1900-02-29']) {
      for (const field of ['due', 'remind']) {
        const inputs = [{[`${field}Utc`]: `${date}T09:00:00Z`},
          {[`${field}Utc`]: `${date}T09:00:00.12+08:00`},
          {[`${field}Local`]: `${date} 09:00`, [`${field}TimeZone`]: 'Asia/Shanghai'}];
        for (const input of inputs) {
          await assert.rejects(host.invoke('todo.create', {title: '不可创建', ...input}, context), {code: 'INVALID_ARGUMENT'});
          assert.deepEqual(storage.get('todo:state'), before, 'invalid create cannot persist an item or change the index');
          await assert.rejects(host.invoke('todo.update', {id: item.id, title: '不可修改', ...input}, context), {code: 'INVALID_ARGUMENT'});
          assert.deepEqual(storage.get('todo:state'), before, 'invalid update cannot persist title, reminder or revision changes');
          const {items} = await host.invoke('todo.list', {}, context);
          assert.deepEqual(buildReminderTrigger(items[0], 'calendar-validation'), trigger, 'the original reminder trigger is unchanged');
        }
      }
    }
  } finally {unregister();}
});

test('合法闰日可经Z、数值偏移和本地时间创建与修改', async () => {
  const host = new FakeToolHost(() => NOW), storage = new FakeStorage().namespace('leap-validation');
  let counter = 0;
  const unregister = register(host, {storage, conversationId: 'leap-validation', now: () => NOW, idFactory: () => `t${++counter}`});
  const context = {taskId: 'task', runId: 'leap-validation', signal: new AbortController().signal,
    deadline: '2026-09-07T01:00:00.000Z', authorizationRef: 'test', scopes: ['todo:read', 'todo:write']};
  try {
    for (const year of ['2028', '2000']) {
      for (const input of [{remindUtc: `${year}-02-29T09:00:00.12Z`},
        {remindUtc: `${year}-02-29T17:00:00.12+08:00`},
        {remindLocal: `${year}-02-29 17:00`, remindTimeZone: 'Asia/Shanghai'}]) {
        const created = await host.invoke('todo.create', {title: '合法闰日', ...input}, context);
        const updated = await host.invoke('todo.update', {id: created.item.id, title: '合法修改', ...input}, context);
        assert.equal(updated.item.reminder.remindAt.utc, `${year}-02-29T09:00:00.${input.remindLocal ? '000' : '120'}Z`);
        assert.equal(updated.reminderTrigger.runAt, updated.item.reminder.remindAt.utc);
      }
    }
  } finally {unregister();}
});

test('公开localToUtc拒绝不存在的公历日期，不当作DST跳跃处理', () => {
  for (const date of ['2026-02-30', '2026-02-29', '2026-04-31', '1900-02-29']) {
    assert.throws(() => localToUtc(`${date}T09:00:00`, 'Asia/Shanghai'), {code: 'INVALID_ARGUMENT'});
  }
});

test('本地时间 → UTC：北京无 DST 偏移正确', () => {
  assert.equal(localToUtc('2026-09-07T09:30:00', 'Asia/Shanghai'), Date.parse('2026-09-07T01:30:00.000Z'));
});

test('DST 回拨歧义取较早一次（纽约 2026-11-01 01:30 → 05:30Z，EDT）', () => {
  assert.equal(localToUtc('2026-11-01T01:30:00', 'America/New_York'), Date.parse('2026-11-01T05:30:00.000Z'));
});

test('DST 春季跳跃向前推（纽约 2026-03-08 02:30 不存在 → 03:30 EDT = 07:30Z）', () => {
  assert.equal(localToUtc('2026-03-08T02:30:00', 'America/New_York'), Date.parse('2026-03-08T07:30:00.000Z'));
});

test('DST 南半球跳跃（悉尼 2026-10-04 02:30 → 03:30 AEDT = 前一日 16:30Z）', () => {
  assert.equal(localToUtc('2026-10-04T02:30:00', 'Australia/Sydney'), Date.parse('2026-10-03T16:30:00.000Z'));
});

test('创建、修改、取消都可读回，revision 与时间戳正确', () => {
  const {service} = makeService();
  const created = service.create({title: '写周报', notes: '周五前', due: {localDateTime: '2026-09-11T18:00:00', timeZone: 'Asia/Shanghai'}});
  assert.equal(created.status, 'open');
  assert.equal(created.revision, 1);
  assert.equal(created.due.utc, '2026-09-11T10:00:00.000Z');
  assert.equal(created.due.localDateTime, '2026-09-11T18:00:00');
  assert.deepEqual(service.get(created.id), created);

  const renamed = service.update(created.id, {title: '写项目周报'});
  assert.equal(renamed.title, '写项目周报');
  assert.equal(renamed.revision, 2);
  assert.ok(renamed.updatedAt >= created.updatedAt);
  assert.deepEqual(service.get(created.id), renamed);

  const done = service.update(created.id, {status: 'done'});
  assert.equal(done.status, 'done');
  assert.equal(done.revision, 3);
  assert.equal(service.list({status: 'done'}).length, 1);
  assert.equal(service.list({status: 'open'}).length, 0);
});

test('终态不可再变：done → open 与 cancelled → done 都拒绝', () => {
  const {service} = makeService();
  const a = service.create({title: 'a'});
  service.update(a.id, {status: 'done'});
  assert.throws(() => service.update(a.id, {status: 'open'}), /Terminal status/);
  const b = service.create({title: 'b'});
  service.update(b.id, {status: 'cancelled'});
  assert.throws(() => service.update(b.id, {status: 'done'}), /Terminal status/);
});

test('提醒不能晚于 due；时间输入必须二选一；时区必须合法', () => {
  const {service} = makeService();
  assert.throws(() => service.create({
    title: 'x',
    due: {localDateTime: '2026-09-10T10:00:00', timeZone: 'Asia/Shanghai'},
    reminder: {remindAt: {localDateTime: '2026-09-11T10:00:00', timeZone: 'Asia/Shanghai'}},
  }), /after due/);
  assert.throws(() => service.create({title: 'x', due: {}}), /exactly one/);
  assert.throws(() => service.create({title: 'x', due: {localDateTime: '2026-09-10T10:00:00', timeZone: 'Mars/Olympus'}}), /valid IANA/);
});

test('触发定义确定性：同一条目同一提醒时刻 → 相同 scheduleId 与幂等键', () => {
  const {service} = makeService();
  const item = service.create({
    title: '体检',
    reminder: {remindAt: {localDateTime: '2026-09-15T08:00:00', timeZone: 'Asia/Shanghai'}, missedPolicy: 'skip'},
  });
  const first = buildReminderTrigger(item, 'conv-1');
  const second = buildReminderTrigger(service.get(item.id), 'conv-1');
  assert.equal(first.scheduleId, second.scheduleId);
  assert.equal(first.taskIdempotencyKey, second.taskIdempotencyKey);
  assert.equal(first.runAt, '2026-09-15T00:00:00.000Z');
  assert.equal(first.missedRunPolicy, 'skip');
  assert.equal(first.timeZone, 'Asia/Shanghai');
  assert.equal(first.conversationId, 'conv-1');
  assert.match(first.goal, /体检/);
});

test('触发定义结构与 Runtime ScheduleInput 字段一致（结构兼容，ADR-0002）', () => {
  const {service} = makeService();
  const item = service.create({title: 'x', reminder: {remindAt: {utc: '2026-09-20T01:00:00.000Z'}}});
  const trigger = buildReminderTrigger(item, 'conv');
  assert.deepEqual(Object.keys(trigger).sort(), ['conversationId', 'goal', 'missedRunPolicy', 'runAt', 'scheduleId', 'taskIdempotencyKey', 'timeZone']);
});

test('已完结或已投递的条目不再生成触发；改提醒时刻换新 scheduleId', () => {
  const {service} = makeService();
  const item = service.create({title: 'x', reminder: {remindAt: {utc: '2026-09-20T01:00:00.000Z'}}});
  assert.equal(reminderTriggers([item], 'c').length, 1);
  const done = service.update(item.id, {status: 'done'});
  assert.equal(buildReminderTrigger(done, 'c'), null);
  const updated = service.update(item.id, {title: 'x'});
  void updated;
  const moved = {...item, reminder: {remindAt: {utc: '2026-09-21T01:00:00.000Z', timeZone: 'UTC', localDateTime: '2026-09-21T01:00:00'}, missedPolicy: 'run_once', state: 'scheduled'}};
  const trigger = buildReminderTrigger(moved, 'c');
  assert.equal(trigger.scheduleId, reminderScheduleId(moved.id, '2026-09-21T01:00:00.000Z'));
  assert.notEqual(trigger.scheduleId, reminderScheduleId(item.id, '2026-09-20T01:00:00.000Z'));
});

test('dispatch 回执映射：fired → delivered，skipped → missed（不重复提醒）', () => {
  const {service} = makeService();
  const item = service.create({title: 'x', reminder: {remindAt: {utc: '2026-09-20T01:00:00.000Z'}}});
  const scheduleId = reminderScheduleId(item.id, '2026-09-20T01:00:00.000Z');
  const [updated] = applyReminderDispatches([item], [{scheduleId, status: 'fired'}], () => NOW);
  assert.equal(updated.reminder.state, 'delivered');
  assert.equal(updated.revision, item.revision + 1);
  assert.equal(buildReminderTrigger(updated, 'c'), null);
  const [missed] = applyReminderDispatches([item], [{scheduleId, status: 'skipped'}], () => NOW);
  assert.equal(missed.reminder.state, 'missed');
  service.save(updated);
  assert.throws(() => service.save(item), /Revision must increase/);
});

test('late dispatch ignores completed or cancelled todo items', () => {
  const {service} = makeService();
  for (const status of ['done', 'cancelled']) {
    const item = service.create({title: status, reminder: {remindAt: {utc: '2026-09-20T01:00:00.000Z'}}});
    const terminal = service.update(item.id, {status});
    const before = structuredClone(terminal);
    const scheduleId = reminderScheduleId(item.id, item.reminder.remindAt.utc);
    assert.deepEqual(applyReminderDispatches([terminal], [{scheduleId, status: 'fired'}], () => NOW), []);
    assert.deepEqual(terminal, before);
    assert.deepEqual(service.get(item.id), before);
  }
});

test('duplicate dispatch updates a todo at most once per batch', () => {
  const {service} = makeService();
  const item = service.create({title: 'once', reminder: {remindAt: {utc: '2026-09-20T01:00:00.000Z'}}});
  const scheduleId = reminderScheduleId(item.id, item.reminder.remindAt.utc);
  const staleScheduleId = reminderScheduleId(item.id, '2026-09-19T01:00:00.000Z');
  const updated = applyReminderDispatches([item], [
    {scheduleId: staleScheduleId, status: 'fired'},
    {scheduleId, status: 'fired'},
    {scheduleId, status: 'fired'},
    {scheduleId, status: 'skipped'},
  ], () => NOW);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].revision, item.revision + 1);
  assert.equal(updated[0].reminder.state, 'delivered');
  assert.deepEqual(applyReminderDispatches(updated, [{scheduleId, status: 'fired'}], () => NOW), []);
});

test('工具注册：todo.list / todo.create / todo.update 的 scope 与 schema 全部过 FakeToolHost', async () => {
  const host = new FakeToolHost(() => NOW);
  const storage = new FakeStorage().namespace('todo');
  let counter = 0;
  const unregister = register(host, {storage, conversationId: 'conv-tool', now: () => NOW, idFactory: () => `t${++counter}`});
  const context = {taskId: 'task', runId: 'run', signal: new AbortController().signal, deadline: '2026-09-07T01:00:00.000Z', authorizationRef: 'test', scopes: ['todo:read', 'todo:write']};

  const created = await host.invoke('todo.create', {title: '预订牙医', remindLocal: '2026-09-09T08:00:00', remindTimeZone: 'Asia/Shanghai', missedPolicy: 'skip'}, context);
  assert.equal(created.item.status, 'open');
  assert.equal(created.reminderTrigger.runAt, '2026-09-09T00:00:00.000Z');
  assert.equal(created.reminderTrigger.missedRunPolicy, 'skip');
  assert.equal(created.reminderTrigger.conversationId, 'conv-tool');

  const listed = await host.invoke('todo.list', {status: 'open'}, context);
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].id, created.item.id);

  const updated = await host.invoke('todo.update', {id: created.item.id, status: 'done'}, context);
  assert.equal(updated.item.status, 'done');
  assert.equal(updated.reminderTrigger, null);

  await assert.rejects(host.invoke('todo.create', {title: 'no scope'}, {...context, scopes: ['todo:read']}), err => err.code === 'SCOPE_DENIED');
  unregister();
});

test('register 缺 storage 或 conversationId 直接拒绝（不静默降级）', () => {
  const host = new FakeToolHost(() => NOW);
  assert.throws(() => register(host, {}), /storage must be explicitly provided/);
  assert.throws(() => register(host, {storage: new FakeStorage().namespace('todo')}), /conversationId/);
});

test('不存在的条目与非法输入映射为协议错误', () => {
  const {service} = makeService();
  assert.throws(() => service.get('nope'), /not found/);
  assert.throws(() => service.create({title: ' '}), /non-empty/);
  assert.throws(() => service.create({title: 'x'.repeat(201)}), /200 characters/);
  void PRODUCTIVITY_MODULE_VERSION;
  void ProtocolError;
});

test('DST 回拨歧义取较早一次：柏林 2026-10-25 02:30 → 00:30Z（CEST），不是 01:30Z（CET）', () => {
  assert.equal(localToUtc('2026-10-25T02:30:00', 'Europe/Berlin'), Date.parse('2026-10-25T00:30:00.000Z'));
});

test('修改截止时间时重验既有提醒：due 提前到提醒之后 → 拒绝，要求同步调整提醒', () => {
  const {service} = makeService();
  const item = service.create({
    title: '交付',
    due: {localDateTime: '2026-09-20T18:00:00', timeZone: 'Asia/Shanghai'},
    reminder: {remindAt: {localDateTime: '2026-09-20T08:00:00', timeZone: 'Asia/Shanghai'}},
  });
  // 把 due 提前到 07:00（早于 08:00 的提醒）而不动提醒 → 拒绝
  assert.throws(() => service.update(item.id, {due: {localDateTime: '2026-09-20T07:00:00', timeZone: 'Asia/Shanghai'}}), /after due/);
  // 连带把提醒改到 06:00 → 允许
  const moved = service.update(item.id, {
    due: {localDateTime: '2026-09-20T07:00:00', timeZone: 'Asia/Shanghai'},
    reminder: {remindAt: {localDateTime: '2026-09-20T06:00:00', timeZone: 'Asia/Shanghai'}},
  });
  assert.equal(moved.due.utc, '2026-09-19T23:00:00.000Z');
  assert.equal(moved.reminder.remindAt.utc, '2026-09-19T22:00:00.000Z');
  // 清除提醒后再改 due 不受影响
  const cleared = service.update(service.create({title: 'x', reminder: {remindAt: {utc: '2026-09-25T00:00:00.000Z'}}}).id, {clearReminder: true, due: {utc: '2026-09-21T00:00:00.000Z'}});
  assert.equal(cleared.due.utc, '2026-09-21T00:00:00.000Z');
});

test('原子性：唯一写入点注入异常 → 悬空索引不可能存在，重建服务后既有条目照常可查', () => {
  const makeFlakyStorage = (failOn) => {
    const inner = new FakeStorage().namespace('todo');
    let calls = 0;
    return {
      get: key => inner.get(key),
      set: (key, value) => {
        calls += 1;
        if (calls === failOn) throw new Error('injected storage failure at write');
        inner.set(key, value);
      },
      delete: key => inner.delete(key),
    };
  };
  let counter = 0;
  const idFactory = () => `t${++counter}`;

  // goo122 复现路径：第一次创建（写入 1 成功），第二次变更（写入 2）失败 →
  // 旧实现 ids 已写、条目缺失；单键实现下失败整体不生效
  const flaky = makeFlakyStorage(2);
  const service1 = new TodoService(flaky, {now: () => NOW, idFactory});
  const first = service1.create({title: '已有条目'});
  assert.throws(() => service1.update(first.id, {title: '改标题'}), /injected storage failure/);
  const rebuilt = new TodoService(flaky, {now: () => NOW, idFactory});
  assert.equal(rebuilt.list().length, 1, '重建后既有条目仍可列出');
  assert.equal(rebuilt.get(first.id).title, '已有条目', '内容为失败前的旧值');
  // 重试同一变更成功
  assert.equal(rebuilt.update(first.id, {title: '改标题'}).title, '改标题');
  assert.equal(rebuilt.list().length, 1);
});

test('输入桥接：数值偏移 UTC、缺秒与空格分隔的本地时间全部规范化', async () => {
  const host = new FakeToolHost(() => NOW);
  const ctx = () => ({deadline: new Date(NOW + 60_000).toISOString(), signal: new AbortController().signal,
    scopes: ['todo:write'], authorizationRef: 'test', runId: 'test-bridge'});
  const storage = new FakeStorage().namespace('todo-bridge');
  let counter = 0;
  const unregister = register(host, {storage, conversationId: 'conv-bridge', now: () => NOW, idFactory: () => `t${++counter}`});
  try {
    const created = await host.invoke('todo.create', {title: '偏移形态',
      remindUtc: '2026-09-07T08:41:00+08:00'}, ctx());
    assert.equal(created.item.reminder.remindAt.utc, '2026-09-07T00:41:00.000Z');
    assert.equal(created.item.reminder.remindAt.timeZone, 'Etc/GMT-8');
    assert.equal(created.item.reminder.remindAt.localDateTime, '2026-09-07T08:41:00');
    const loose = await host.invoke('todo.create', {title: '宽松本地形态',
      remindLocal: '2026-09-07 09:30', remindTimeZone: 'Asia/Shanghai'}, ctx());
    assert.equal(loose.item.reminder.remindAt.utc, '2026-09-07T01:30:00.000Z');
    assert.equal(loose.item.reminder.remindAt.localDateTime, '2026-09-07T09:30:00');
    const offsetDue = await host.invoke('todo.create', {title: '偏移到期',
      dueUtc: '2026-09-08T23:59:59.500+09:30'}, ctx());
    assert.equal(offsetDue.item.due.utc, '2026-09-08T14:29:59.500Z');
  } finally { unregister(); }
});

test('remindInMinutes：执行期解析为绝对时刻，与绝对输入互斥且边界拒绝', async () => {
  const host = new FakeToolHost(() => NOW);
  const ctx = () => ({deadline: new Date(NOW + 60_000).toISOString(), signal: new AbortController().signal,
    scopes: ['todo:write'], authorizationRef: 'test', runId: 'test-relative'});
  const storage = new FakeStorage().namespace('todo-relative');
  let counter = 0;
  const unregister = register(host, {storage, conversationId: 'conv-relative', now: () => NOW, idFactory: () => `t${++counter}`});
  try {
    const created = await host.invoke('todo.create', {title: '两分钟后', remindInMinutes: 2}, ctx());
    assert.equal(created.item.reminder.remindAt.utc, '2026-09-07T00:02:00.000Z');
    assert.equal(created.item.reminder.remindAt.timeZone, 'UTC');
    const updated = await host.invoke('todo.update', {id: created.item.id, remindInMinutes: 60}, ctx());
    assert.equal(updated.item.reminder.remindAt.utc, '2026-09-07T01:00:00.000Z');
    await assert.rejects(
      host.invoke('todo.create', {title: '互斥', remindUtc: '2026-09-07T00:05:00.000Z', remindInMinutes: 5}, ctx()),
      {code: 'INVALID_ARGUMENT'});
    await assert.rejects(host.invoke('todo.create', {title: '越界', remindInMinutes: 0}, ctx()), {code: 'INVALID_ARGUMENT'});
    await assert.rejects(host.invoke('todo.create', {title: '越界上限', remindInMinutes: 525601}, ctx()), {code: 'INVALID_ARGUMENT'});
  } finally { unregister(); }
});

test('time bridges preserve fractional seconds and safely handle extreme fixed offsets through tools', async () => {
  const host = new FakeToolHost(() => NOW);
  const scope = () => ({deadline: new Date(NOW + 60_000).toISOString(), signal: new AbortController().signal,
    scopes: ['todo:write'], authorizationRef: 'test', runId: 'time-boundaries'});
  const unregister = register(host, {storage: new FakeStorage().namespace('time-boundaries'), conversationId: 'time-boundaries', now: () => NOW});
  try {
    const created = await host.invoke('todo.create', {title: 'short fraction', remindUtc: '2026-09-07T00:05:00.1Z'}, scope());
    assert.equal(created.item.reminder.remindAt.utc, '2026-09-07T00:05:00.100Z');
    const updated = await host.invoke('todo.update', {id: created.item.id, remindUtc: '2026-09-07T00:05:00.12Z'}, scope());
    assert.equal(updated.item.reminder.remindAt.utc, '2026-09-07T00:05:00.120Z');
    for (const offset of ['-13:00', '-14:00', '+14:00', '+05:30']) {
      const input = `2026-09-07T12:30:00.500${offset}`;
      const result = await host.invoke('todo.create', {title: offset, dueUtc: input}, scope());
      assert.equal(result.item.due.utc, new Date(input).toISOString());
      assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', {timeZone: result.item.due.timeZone}));
    }
    for (const offset of ['+15:00', '-15:00', '+14:01', '-14:30', '+08:60'])
      await assert.rejects(host.invoke('todo.create', {title: offset, remindUtc: `2026-09-07T12:30:00${offset}`}, scope()), {code: 'INVALID_ARGUMENT'});
  } finally { unregister(); }
});
