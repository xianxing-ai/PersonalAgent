import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createActivityHost} from '../electron/activity-host.js';
import {activityTimelineHtml} from '../src/features/admin/activity-timeline.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

test('the timeline shows why on every row and undo only when compensation can run', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'activity-desktop-'));
  const removed = [];
  const host = createActivityHost({file: path.join(root, 'ledger.jsonl'), onUpdate() {}});
  host.note({pluginId: 'skill.notes', action: 'install', riskLevel: 'low', generation: 1});
  host.note({pluginId: 'skill.notes', action: 'enable', riskLevel: 'high', generation: 2});
  host.recordFailure({pluginId: 'skill.other', action: 'install', riskLevel: 'medium'});
  const hidden = host.snapshot();
  assert.equal(hidden.items.every(item => item.undoable === false), true);
  host.bindPlugin({
    uninstall(id) { removed.push(id); },
    disable() { throw Error('不应停用'); },
  });
  const page = host.snapshot();
  const html = activityTimelineHtml(page, escape);
  assert.equal(html.includes('它替我做了什么'), true);
  assert.equal(html.includes('刷新'), false);
  assert.equal(html.includes('保存'), false);
  assert.equal(html.includes('筛选'), false);
  assert.equal((html.match(/data-activity-why=/g) ?? []).length, 3);
  assert.equal((html.match(/data-activity-undo=/g) ?? []).length, 2);
  assert.equal(html.includes('安装插件 skill.notes'), true);
  assert.equal(html.includes('操作没有完成'), false);
  const install = page.items.find(item => item.summary === '安装插件 skill.notes');
  const after = await host.undo(install.id);
  assert.deepEqual(removed, ['skill.notes']);
  assert.equal(after.items[0].result, 'compensated');
  assert.equal(after.items.some(item => item.id === install.id && item.undoable), false);
  const undone = activityTimelineHtml(after, escape, new Set([after.items[0].id]));
  assert.match(undone, /触发：用户撤销/);
  assert.equal((undone.match(/data-activity-undo=/g) ?? []).length, 1);
  rmSync(root, {recursive: true, force: true});
});

test('why text is escaped and a row without compensation has no undo button', () => {
  const html = activityTimelineHtml({
    items: [{
      id: '00000000-0000-4000-8000-000000000001',
      at: '2026-11-11T04:15:00.000Z',
      source: 'repair',
      summary: '失败自愈：停止重试',
      risk: 'medium',
      result: 'skipped',
      undoable: false,
      why: {trigger: '失败类型 <transient>', basis: 'stop: no compensation'},
    }],
  }, escape, new Set(['00000000-0000-4000-8000-000000000001']));
  assert.equal(html.includes('data-activity-undo'), false);
  assert.equal(html.includes('失败类型 &lt;transient&gt;'), true);
  assert.equal(html.includes('<transient>'), false);
});
