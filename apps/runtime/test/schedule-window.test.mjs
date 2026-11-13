import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {TaskRuntime} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/schedule-window-tests/', import.meta.url));
mkdirSync(root, {recursive: true});

test('schedule window is a read and does not fire the schedule', () => {
  const directory = mkdtempSync(join(root, 'case-'));
  const runtime = new TaskRuntime(join(directory, 'runtime.sqlite'), {now: () => new Date('2026-11-11T00:30:00.000Z')});
  try {
    runtime.createSchedule({scheduleId: 'today', goal: '下午同步周报', conversationId: 'user', runAt: '2026-11-11T06:00:00.000Z', timeZone: 'Asia/Shanghai', missedRunPolicy: 'skip', taskIdempotencyKey: 'today'});
    runtime.createSchedule({scheduleId: 'tomorrow', goal: '明天', conversationId: 'user', runAt: '2026-11-12T01:00:00.000Z', timeZone: 'Asia/Shanghai', missedRunPolicy: 'skip', taskIdempotencyKey: 'tomorrow'});
    const rows = runtime.listScheduleWindow({from: '2026-11-10T16:00:00.000Z', to: '2026-11-11T16:00:00.000Z', limit: 10});
    assert.deepEqual(rows.map(item => item.scheduleId), ['today']);
    assert.equal(runtime.getSchedule('today').status, 'pending');
    assert.equal(runtime.dispatchDueSchedules('user').length, 0);
  } finally { runtime.close(); }
});
