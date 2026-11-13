import assert from 'node:assert/strict';
import test from 'node:test';
import {briefingNotification, buildDailyBriefing, planDailyBriefingSchedule} from '../dist/index.js';

const zone = 'Asia/Shanghai';
const now = '2026-11-11T00:30:00.000Z';

test('briefing keeps titles and drops mail bodies, summaries and approval arguments', () => {
  const document = buildDailyBriefing({
    now, timeZone: zone,
    tasks: [
      {taskId: 'done-1', conversationId: 'user', state: 'succeeded', goal: '整理昨日记录', updatedAt: now},
      {taskId: 'mail-1', conversationId: 'user', state: 'failed', goal: 'From: secret@example.com\n这是邮件正文', updatedAt: now, resultSummary: '不应出现的正文'},
      {taskId: 'stuck-1', conversationId: 'user', state: 'waiting_reconciliation', goal: '等待回执', updatedAt: '2026-11-01T00:00:00.000Z'},
      {taskId: 'wake', conversationId: 'daily-briefing:user', state: 'succeeded', goal: '生成每日结果简报', updatedAt: now},
    ],
    approvals: [
      {approvalId: 'ap-1', taskId: 'wait-1', action: 'calendar.respond', state: 'pending', argumentSummary: 'redacted', argumentsDigest: 'abc'},
      {approvalId: 'ap-2', taskId: 'done-1', action: 'mail.send', state: 'pending'},
    ],
    schedules: [
      {scheduleId: 'meet', conversationId: 'user', goal: '下午同步周报', runAt: '2026-11-11T06:00:00.000Z', status: 'pending', timeZone: zone},
      {scheduleId: 'leak', conversationId: 'user', goal: 'https://secret.example/body', runAt: '2026-11-11T07:00:00.000Z', status: 'pending', timeZone: zone},
    ],
  });
  const text = JSON.stringify(document);
  assert.equal(text.includes('secret@example.com'), false);
  assert.equal(text.includes('邮件正文'), false);
  assert.equal(text.includes('不应出现'), false);
  assert.equal(text.includes('secret.example'), false);
  assert.equal(text.includes('argumentsDigest'), false);
  assert.deepEqual(document.completed.map(item => item.title), ['整理昨日记录']);
  assert.match(document.failed.find(item => item.id === 'mail-1').title, /任务 mail-1/);
  assert.match(document.failed.find(item => item.id === 'stuck-1').title, /待核实/);
  assert.deepEqual(document.decisions.map(item => item.taskId), ['wait-1']);
  assert.equal(document.schedule[0].displayTime, '14:00');
  assert.equal(document.schedule[1].title, '日程');
  assert.equal(document.adapters.proactive, 'unavailable');
  const notice = briefingNotification(document);
  assert.equal(notice.body.includes('整理昨日记录'), false);
  assert.match(notice.body, /点开查看全文/);
});

test('optional adapters attach only when they return a real result', () => {
  const document = buildDailyBriefing({
    now, timeZone: zone,
    tasks: [{taskId: 'bad', conversationId: 'user', state: 'failed', goal: '同步失败', updatedAt: now}],
    approvals: [], schedules: [],
    proactive: {listCompletedSince: () => [{id: 'cw-1', title: '已处理日历变更', completedAt: now}]},
    risk: {grade: () => 'high'},
    recovery: {outcome: () => 'healed'},
  });
  assert.equal(document.adapters.proactive, 'connected');
  assert.equal(document.adapters.recovery, 'connected');
  assert.equal(document.failed.length, 0);
  assert.equal(document.completed.some(item => item.title.includes('已恢复') && item.riskLabel === '高'), true);
  assert.equal(document.completed.some(item => item.title === '已处理日历变更'), true);
});

test('schedule plan uses today until a briefing exists, then the next local morning', () => {
  const early = planDailyBriefingSchedule({conversationId: 'daily-briefing:user', localTime: '08:00', timeZone: zone, now: '2026-11-10T23:30:00.000Z', briefedDates: []});
  assert.equal(early.runAt, '2026-11-11T00:00:00.000Z');
  const missed = planDailyBriefingSchedule({conversationId: 'daily-briefing:user', localTime: '08:00', timeZone: zone, now, briefedDates: []});
  assert.equal(Date.parse(missed.runAt) < Date.parse(now), true);
  const next = planDailyBriefingSchedule({conversationId: 'daily-briefing:user', localTime: '09:15', timeZone: zone, now, briefedDates: ['2026-11-11']});
  assert.equal(next.scheduleId, 'daily-briefing:2026-11-12:09:15');
  assert.equal(next.taskIdempotencyKey, next.scheduleId);
  assert.equal(next.missedRunPolicy, 'run_once');
});
