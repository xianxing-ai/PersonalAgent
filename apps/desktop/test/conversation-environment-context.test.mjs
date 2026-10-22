import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationEnvironmentContext} from '../electron/conversation-environment-context.js';

test('Synthetic current clock is sampled afresh, with local calendar date and IANA DST semantics', () => {
  let instant = '2026-10-21T16:30:00.000Z';
  const read = createConversationEnvironmentContext({now:() => new Date(instant), readTimeZone:() => 'Asia/Shanghai'});
  const first = JSON.parse(read());
  assert.equal(first.time.sampledAtUtc, instant);
  assert.equal(first.time.localDateTime, '2026-10-22T00:30:00');
  assert.equal(first.time.utcOffsetMinutes, 480);
  assert.equal(first.time.timeZone, 'Asia/Shanghai');
  instant = '2026-10-22T16:30:00.000Z';
  assert.equal(JSON.parse(read()).time.localDateTime, '2026-10-23T00:30:00');
  const ny = createConversationEnvironmentContext({now:() => new Date(instant), readTimeZone:() => 'America/New_York'});
  assert.equal(JSON.parse(ny()).time.utcOffsetMinutes, -240);
  instant = '2026-11-22T16:30:00.000Z';
  assert.equal(JSON.parse(ny()).time.utcOffsetMinutes, -300);
  assert.match(first.interpretation.join(' '), /never reuse this offset/);
});

test('Synthetic missing IANA zone is explicit offset-only, and unknown clock is never fabricated', () => {
  const read = createConversationEnvironmentContext({now:() => new Date('2026-10-21T01:00:00Z'),
    readTimeZone:() => 'not-a-zone', readUtcOffsetMinutes:() => 330});
  const value = JSON.parse(read());
  assert.equal(value.time.timeZoneKind, 'offset_at_sample_only');
  assert.equal(value.time.utcOffsetMinutes, 330);
  assert.equal(value.time.timeZone, undefined);
  assert.match(value.time.guidance, /确认时区/);
  assert.throws(createConversationEnvironmentContext({now:() => new Date(NaN)}), /clock is unavailable/);
});

test('Synthetic todo consent guidance is metadata only, refreshed after enable/revoke and free of private items', () => {
  let allowed = false;
  const read = createConversationEnvironmentContext({now:() => new Date('2026-10-21T01:00:00Z'),
    readTimeZone:() => 'Asia/Shanghai', readTodoState:() => ({registered:true,availability:allowed?'ready':'consent_required',
      items:[{title:'Synthetic private title'}],secretRef:'Synthetic-private-reference'})});
  const first = JSON.parse(read()).capabilityGuidance[0];
  assert.equal(first.state, 'authorization_required');
  assert.equal(first.callable, false);
  assert.match(first.guidance, /若当前工具目录实际公布 todo.create/);
  assert.match(first.guidance, /宿主在执行前显示当前对话提问卡/);
  assert.match(first.guidance, /不要编造授权工具或调用授权 IPC/);
  assert.match(first.guidance, /本次\/永久/);
  assert.match(first.relativeReminder, /remindInMinutes/);
  assert.doesNotMatch(read(), /Synthetic private|Synthetic-private-reference|secretRef|items/);
  allowed = true;
  assert.equal(JSON.parse(read()).capabilityGuidance[0].state, 'check_task_catalog');
  allowed = false;
  assert.equal(JSON.parse(read()).capabilityGuidance[0].state, 'authorization_required');
  assert.deepEqual(JSON.parse(createConversationEnvironmentContext({readTodoState:() => undefined})()).capabilityGuidance, []);
  const missing = JSON.parse(createConversationEnvironmentContext({readTodoState:() => ({registered:true,
    availability:'configuration_required',reasonCode:'Synthetic-private-detail'})})()).capabilityGuidance[0];
  assert.equal(missing.state,'configuration_required');
  assert.match(missing.guidance,/授权卡不能替代/);
  assert.doesNotMatch(JSON.stringify(missing),/Synthetic-private-detail/);
  let configured = false;
  const calendar = createConversationEnvironmentContext({readCalendarState:()=>({registered:true,configured,
    calendarName:'Synthetic private calendar',password:'Synthetic-only'})});
  assert.equal(JSON.parse(calendar()).capabilityGuidance[0].state,'configuration_required');
  assert.doesNotMatch(calendar(),/Synthetic private calendar|Synthetic-only|password/);
  configured = true;
  assert.equal(JSON.parse(calendar()).capabilityGuidance[0].state,'check_task_catalog');
});
