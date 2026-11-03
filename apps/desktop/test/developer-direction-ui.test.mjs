import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createDeveloperDirectionHost, deliverDesktopNotice} from '../electron/developer-direction-host.js';

test('the settings panel exposes the four autonomy levels and the host records a report', async () => {
  const source = readFileSync(new URL('../src/features/admin/developer-direction-controls.js', import.meta.url), 'utf8');
  for (const label of ['观察', '建议', '可逆自动', '除不可逆外全自动', '全局急停', '时间线']) assert.match(source, new RegExp(label));
  const sent = [];
  const host = createDeveloperDirectionHost({now: () => Date.parse('2026-11-03T00:00:00.000Z'), channel: {name: 'desktop', async send(notice) {sent.push(notice); return {accepted: true, evidenceRef: `desktop:${notice.id}`};}}});
  const goal = await host.invoke('goal', {sentence: '修好 CI', repo: 'octo/repo'});
  const report = await host.invoke('report', {goalId: goal.id});
  assert.match(report.pullRequestBody, /## 结论/);
  const notified = await host.invoke('notify', {repo: 'octo/repo', kind: 'gate', summary: '需要确认合并'});
  assert.equal(notified.delivered, true);
  assert.equal(sent[0].title, '需要你确认');
  const board = await host.invoke('board', {});
  assert.equal(board.timeline[0].delivered, true);
  const shown = [];
  const delivered = await deliverDesktopNotice({id: 'n1', title: '需要你确认', body: '合并要确认'}, {tryNative: async () => ({accepted: false, reason: 'desktop notification unsupported'}), deliverInApp: notice => shown.push(notice.body)});
  assert.equal(delivered.accepted, true);
  assert.equal(delivered.evidenceRef, 'desktop-inapp:n1');
  assert.deepEqual(shown, ['合并要确认']);
});
