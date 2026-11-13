import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';
import {readWakePreference, wakeLeaseMs, writeWakePreference} from '../electron/wake-preference.js';
import {trayIconBuffer} from '../electron/tray-icon.js';
import {describeAction, describeScopes} from '../src/shared/scope-phrases.js';
import {approvalCards} from '../src/features/conversation/approval-card.js';
import {authorizationQuestionMarkup} from '../src/features/conversation/authorization-question-card.js';

test('scopes and actions are shown in everyday language', () => {
  assert.equal(describeScopes(['mail:read', 'workspace:write']), '读取邮件、修改工作区里的文件');
  assert.equal(describeScopes(['widget:frob']), '需要你确认的操作');
  assert.equal(describeAction('workspace.apply_text_patch'), '修改工作区文本');
  assert.equal(describeAction('<img>'), '<img>');
  const html = approvalCards({taskId:'task', state:'waiting_approval'}, [{
    approvalId:'grant', taskId:'task', action:'mail.send', scopes:['mail:send'], state:'pending', revision:1,
    expiresAt:'2030-01-01T00:00:00.000Z',
  }], Date.parse('2026-01-01T00:00:00.000Z'));
  assert.match(html, /发送邮件/);
  assert.doesNotMatch(html, /mail:send|mail\.send/);
});

test('以后都允许 appears only when the question can be saved', () => {
  const now = Date.parse('2030-01-01T00:00:00.000Z');
  const question = extra => ({questionId:'q', revision:1, state:'pending', title:'允许吗', description:'查看',
    toolName:'mail.inbox', expiresAt:'2030-01-01T01:00:00.000Z', requirements:[{requirementId:'tool', kind:'tool', summary:'查看邮件', scopes:['mail:read']}],
    sandbox:{label:'低风险自动', mode:'read-only', revision:1}, ...extra});
  assert.match(authorizationQuestionMarkup(question({canAlways:true}), {now}), /以后都允许/);
  assert.doesNotMatch(authorizationQuestionMarkup(question({canAlways:false}), {now}), /以后都允许|mail:read/);
});

test('wake duration is configurable and the tray icon is a PNG', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pa-wake-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'wake-preference.json');
  assert.equal(readWakePreference(file).enabled, false);
  assert.equal(wakeLeaseMs(writeWakePreference(file, {enabled:true, duration:'minutes30'})), 30 * 60_000);
  assert.equal(wakeLeaseMs({enabled:true, duration:'untilQuit'}), 8 * 60 * 60_000);
  assert.equal(readWakePreference(file).enabled, true);
  const png = trayIconBuffer();
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('a notification click reports the saved destination', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pa-notify-nav-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  let onClick;
  const opened = [];
  const port = createDesktopNotificationPort({storageDir: dir, onNavigate: record => opened.push(record.navigation), notifier: {
    async isSupported() { return true; },
    async show(_input, callbacks) { onClick = callbacks.onClick; callbacks.onShow(); return {close() {}}; },
  }});
  const sent = await port.sendAdvisoryNotification({id:'n-1', title:'待办', body:'有一条需要处理', navigation:{kind:'task', taskId:'task-1'}});
  assert.equal(sent.delivered, true);
  onClick();
  assert.deepEqual(opened, [{kind:'task', taskId:'task-1'}]);
  const rejected = await port.sendAdvisoryNotification({id:'n-2', title:'x', body:'y', navigation:{kind:'task', taskId:'task-1', extra:true}});
  assert.equal(rejected.delivered, false);
});

test('settings navigation keeps usage reachable and drops placeholder pages', () => {
  const view = readFileSync(new URL('../src/features/admin/view.js', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(view, /primaryPages = \['settings', 'connections', 'authorizations', 'usage'\]/);
  assert.match(view, /data-usage-budget/);
  assert.doesNotMatch(view, /items: \[[^\]]*'personalization'/);
  assert.match(main, /defaultProfileRef:'low-risk-auto'/);
  assert.match(main, /label: '打开工作台'/);
  assert.match(main, /label: '打开设置'/);
  assert.doesNotMatch(main, /打开管理后台/);
  const hide = main.slice(main.indexOf('function hidePanel'), main.indexOf('function wakePreferenceFile'));
  assert.doesNotMatch(hide, /stopWakeVoice/);
  const runtimeControls = readFileSync(new URL('../src/features/workspace/runtime-controls.js', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../src/app/renderer.js', import.meta.url), 'utf8');
  const convState = readFileSync(new URL('../src/features/conversation/state.js', import.meta.url), 'utf8');
  const liveVoice = readFileSync(new URL('../src/app/live-voice-controls.js', import.meta.url), 'utf8');
  const settingSearch = readFileSync(new URL('../src/features/admin/setting-search.js', import.meta.url), 'utf8');
  const remoteMcpView = readFileSync(new URL('../src/remote-mcp/view.js', import.meta.url), 'utf8');
  for (const [name, src] of [['runtimeControls', runtimeControls], ['renderer', renderer], ['convState', convState], ['liveVoice', liveVoice]]) {
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(codeOnly, /\bLive\b/, `${name} should not contain English Live label`);
  }
  assert.doesNotMatch(settingSearch, /Live SIS/);
  assert.doesNotMatch(remoteMcpView, /\$\{item\.id\}|\$\{state\.activeId\}|item\.serverId\+' · '/);
});
