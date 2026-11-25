import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {buildUsageDashboard} from '../electron/usage-budget-product.js';
import {createModelApiConfig} from '../electron/model-api-config.js';
import {DesktopState} from '../electron/desktop-state.js';
import {profilePage} from '../src/features/admin/profile.js';
import {usageDashboardHtml} from '../src/features/admin/usage-dashboard.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value).reverse(),
  decryptString: value => Buffer.from(value).reverse().toString(),
};

test('buildUsageDashboard computes accurate real ledger and task metrics and honors empty defaults', () => {
  const empty = buildUsageDashboard([], {tasks: [], now: new Date('2026-11-21T08:00:00.000Z'), timeZone: 'Asia/Shanghai'});
  assert.equal(empty.totalTokens, 0);
  assert.equal(empty.totalYuan, 0);
  assert.equal(empty.activeDays, 0);
  assert.equal(empty.streakDays, 0);
  assert.equal(empty.daily.length, 182);
  assert.equal(empty.monthLabels.length, 26);
  assert.deepEqual(empty.byModel, []);
  assert.deepEqual(empty.byTool, []);
  assert.equal(empty.hasActivity, false);

  const ledger = [
    {seq: 1, at: '2026-11-19T06:00:00.000Z', kind: 'model', origin: 'user', modelId: 'qwen-max', tokens: 600_000, estimatedYuan: 4.8},
    {seq: 2, at: '2026-11-20T06:00:00.000Z', kind: 'model', origin: 'user', modelId: 'qwen-max', tokens: 1_400_000, estimatedYuan: 11.2},
    {seq: 3, at: '2026-11-21T03:00:00.000Z', kind: 'model', origin: 'autonomous', modelId: 'qwen-turbo', tokens: 500_000, estimatedYuan: 0.15},
    {seq: 4, at: '2026-11-21T04:00:00.000Z', kind: 'cloud_runtime', origin: 'user', durationMs: 120_000, estimatedYuan: 0.04},
  ];
  const tasks = [
    {taskId: 't1', state: 'succeeded', createdAt: '2026-11-21T03:00:00.000Z', updatedAt: '2026-11-21T03:05:00.000Z', resultSummary: 'tokens=999999999'},
    {taskId: 't2', state: 'failed', createdAt: '2026-11-20T06:00:00.000Z', updatedAt: '2026-11-20T06:02:00.000Z'},
  ];

  const stats = buildUsageDashboard(ledger, {tasks, now: new Date('2026-11-21T08:00:00.000Z'), timeZone: 'Asia/Shanghai'});
  assert.equal(stats.totalTokens, 2_500_000);
  assert.equal(stats.totalYuan, 16.19);
  assert.equal(stats.activeDays, 3);
  assert.equal(stats.streakDays, 3);
  assert.equal(stats.peakDayTokens, 1_400_000);
  assert.equal(stats.topModel, 'qwen-max');
  assert.equal(stats.messageCount, 2);
  assert.equal(stats.activeDurationMs, 540_000);
  assert.equal(stats.byModel[0].name, 'qwen-max');
  assert.equal(stats.byModel[0].tokens, 2_000_000);
  assert.equal(stats.byModel[0].percent, 80);
  assert.equal(stats.byModel[1].name, 'qwen-turbo');
  assert.equal(stats.byModel[1].percent, 20);
  assert.ok(stats.byTool.some(row => row.name === '对话与辅助模型'));
  assert.ok(stats.byTool.some(row => row.name === '自主后台任务'));
  assert.ok(stats.byTool.some(row => row.name === 'AgentArts 云端'));
});

test('usageDashboardHtml renders clean markup without inline styles and escapes untrusted names', () => {
  const html = usageDashboardHtml({
    totalTokens: 2_500_000,
    totalYuan: 53.3,
    activeDays: 12,
    streakDays: 4,
    activeDurationMs: 3_900_000,
    peakDayTokens: 1_500_000,
    peakDayYuan: 24.5,
    topModel: 'gpt-<test>',
    messageCount: 18,
    daily: new Array(182).fill(0).map((_, index) => ({
      date: `2026-11-${String((index % 28) + 1).padStart(2, '0')}`,
      tokens: index === 181 ? 1_500_000 : 0,
      yuan: index === 181 ? 24.5 : 0,
      count: index === 181 ? 1 : 0,
      tokenLevel: index === 181 ? 4 : 0,
      costLevel: index === 181 ? 4 : 0,
    })),
    monthLabels: new Array(26).fill('').map((_, i) => (i === 0 ? '6月' : i === 25 ? '11月' : '')),
    byModel: [{name: 'gpt-<test>', tokens: 2_500_000, yuan: 53.3, calls: 3, percent: 100, costPercent: 100}],
    byTool: [{name: '对话与辅助模型', tokens: 2_500_000, yuan: 53.3, calls: 3, percent: 100, costPercent: 100}],
  }, {usageLine: '今日 10 token'}, escape, {metric: 'tokens'});

  assert.doesNotMatch(html, /style="/);
  assert.doesNotMatch(html, /Token 总量/);
  assert.doesNotMatch(html, /<test>/);
  assert.match(html, /gpt-&lt;test&gt;/);
  assert.match(html, /2\.5M/);
  assert.match(html, /¥53\.30/);
  assert.match(html, /1h 5m/);
  assert.match(html, /data-ud-metric="cost"/);

  const costHtml = usageDashboardHtml({totalYuan: 53.3, peakDayYuan: 24.5, daily: [], monthLabels: [], byModel: [], byTool: []}, {}, escape, {metric: 'cost'});
  assert.match(costHtml, /花费活动/);
  assert.match(costHtml, /¥24\.50/);
});

test('profilePage embeds the usage dashboard directly underneath profile identity', t => {
  globalThis.localStorage = {getItem: () => null};
  t.after(() => delete globalThis.localStorage);
  const html = profilePage({
    tasks: [{taskId: 'a', state: 'succeeded'}],
    usageDashboard: {totalTokens: 1200, totalYuan: 0.05, activeDays: 1, streakDays: 1, activeDurationMs: 60_000, peakDayTokens: 1200, peakDayYuan: 0.05, topModel: 'qwen-plus', messageCount: 1, daily: [], monthLabels: [], byModel: [], byTool: []},
    usageBudget: {usageLine: '今日 0.05 元'},
  }, escape);
  assert.match(html, /profile-header-card/);
  assert.match(html, /使用仪表盘/);
  assert.match(html, /1\.2K/);
  assert.match(html, /<span>已完成<\/span><b>1<\/b>/);
  assert.doesNotMatch(html, /style="/);
});

test('functional defaults auto-enable safe Harness planning and read-only shadow preview without bypassing security', t => {
  const root = fileURLToPath(new URL('../.cache/', import.meta.url));
  mkdirSync(root, {recursive: true});
  const dir = mkdtempSync(path.join(root, 'defaults-check-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));

  const state = new DesktopState(path.join(dir, 'desktop-state.json'));
  assert.equal(state.value.settings.shadowPreview, true);

  const modelApi = createModelApiConfig({userData: dir, safeStorage});
  t.after(() => modelApi.dispose());
  const harness = modelApi.readHarnessConfiguration();
  assert.equal(harness.revision, 'unconfigured');
  assert.equal(harness.enabled, true);
  assert.equal(harness.maxExecutorSteps, 32);
  assert.equal(harness.context.enabled, false);
  assert.equal(harness.events.enabled, false);
});
