import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dashboardScheduleInput, dueDashboardBoundary, nextDashboardBoundary, summarizePersonalDashboard,
} from '../dist/index.js';

const zone = 'UTC';
const none = {connected: false};
const wednesday = Date.parse('2026-03-11T12:00:00.000Z');

test('weekly, daily and monthly boundaries follow the local calendar', () => {
  assert.equal(new Date(nextDashboardBoundary('weekly', wednesday, zone)).toISOString(), '2026-03-16T00:00:00.000Z');
  assert.equal(new Date(dueDashboardBoundary('weekly', wednesday, zone)).toISOString(), '2026-03-16T00:00:00.000Z');
  assert.equal(new Date(nextDashboardBoundary('daily', wednesday, zone)).toISOString(), '2026-03-12T00:00:00.000Z');
  assert.equal(new Date(nextDashboardBoundary('monthly', wednesday, zone)).toISOString(), '2026-04-01T00:00:00.000Z');
  const monday = Date.parse('2026-03-16T00:00:00.000Z');
  assert.equal(new Date(dueDashboardBoundary('weekly', monday, zone)).toISOString(), '2026-03-16T00:00:00.000Z');
  assert.equal(new Date(nextDashboardBoundary('weekly', monday, zone)).toISOString(), '2026-03-23T00:00:00.000Z');
  const shanghaiMidnight = Date.parse('2026-03-10T16:00:00.000Z');
  assert.equal(new Date(nextDashboardBoundary('daily', shanghaiMidnight, 'Asia/Shanghai')).toISOString(), '2026-03-11T16:00:00.000Z');
});

test('summary unions occupied time, counts mail and sums spend; disconnected sources stay hidden', () => {
  const summary = summarizePersonalDashboard({
    period: 'weekly', runAtMs: Date.parse('2026-03-16T00:00:00.000Z'), timeZone: zone,
    generatedAt: '2026-03-16T00:00:01.000Z',
    readings: {
      time: {connected: true, samples: [
        {startUtc: '2026-03-10T10:00:00.000Z', endUtc: '2026-03-10T11:30:00.000Z', status: 'confirmed'},
        {startUtc: '2026-03-10T11:00:00.000Z', endUtc: '2026-03-10T12:00:00.000Z', status: 'confirmed'},
        {startUtc: '2026-03-10T12:00:00.000Z', endUtc: '2026-03-10T13:00:00.000Z', status: 'cancelled'},
        {startUtc: '2026-03-03T10:00:00.000Z', endUtc: '2026-03-03T11:00:00.000Z', status: 'confirmed'},
      ]},
      mail: {connected: false},
      spend: {connected: true, samples: [
        {occurredAt: '2026-03-10T08:00:00.000Z', amountMinor: 150, currency: 'CNY'},
        {occurredAt: '2026-03-03T08:00:00.000Z', amountMinor: 100, currency: 'CNY'},
      ]},
      briefing: {connected: false},
    },
  });
  assert.deepEqual(summary.cards.map(card => card.id), ['time', 'spend']);
  assert.equal(summary.cards[0].value, '2.0');
  assert.equal(summary.cards[0].delta, '+1.0');
  assert.deepEqual(summary.cards[0].series, [0, 0, 1, 2]);
  assert.equal(summary.cards[1].value, '1.50');
  assert.equal(summary.cards[1].unit, 'CNY');
  assert.equal(summary.cards[1].delta, '+0.50');
  assert.doesNotMatch(summary.headline, /邮件|简报/);
});

test('an authorized empty source still shows its card and a missing one does not', () => {
  const summary = summarizePersonalDashboard({
    period: 'weekly', runAtMs: Date.parse('2026-03-16T00:00:00.000Z'), timeZone: zone,
    generatedAt: '2026-03-16T00:00:01.000Z',
    readings: {
      time: none,
      mail: {connected: true, samples: [], coverage: 'inbound'},
      spend: none,
      briefing: {connected: true, samples: [{occurredAt: '2026-03-10T00:00:00.000Z', count: 2}]},
    },
  });
  assert.deepEqual(summary.cards.map(card => [card.id, card.value, card.caption]), [
    ['mail', '0', '只统计已授权的收件'],
    ['briefing', '2', undefined],
  ]);
});

test('schedule identity is stable for one period boundary', () => {
  const runAtMs = Date.parse('2026-03-16T00:00:00.000Z');
  const first = dashboardScheduleInput({namespace: 'desk-user', period: 'weekly', runAtMs, timeZone: zone});
  const second = dashboardScheduleInput({namespace: 'desk-user', period: 'weekly', runAtMs, timeZone: zone});
  assert.deepEqual(first, second);
  assert.equal(first.conversationId, 'personal-dashboard:desk-user');
  assert.equal(first.missedRunPolicy, 'run_once');
  assert.equal(first.taskIdempotencyKey, first.scheduleId);
  assert.equal(first.runAt, '2026-03-16T00:00:00.000Z');
});
