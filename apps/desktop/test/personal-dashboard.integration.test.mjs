import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TaskRuntime} from '@personal-agent/runtime';
import {dispatchPersonalDashboardTask} from '@personal-agent/runtime/application';
import {FakeCalendarProvider} from '@personal-agent/calendar';
import {FakeMailProvider} from '@personal-agent/mail';
import {createPersonalDashboardHost} from '../electron/personal-dashboard-host.js';
import {createDesktopDashboardSources, readSpend, readTime} from '../electron/personal-dashboard-sources.js';
import {adminAuxiliaryDocument, recordFollowingNodes} from '../test-support/admin-history-dom.mjs';

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value).reverse(),
  decryptString: value => Buffer.from(value).reverse().toString(),
};

function event(partial) {
  return {
    externalId: partial.externalId, calendarId: 'cal', title: 'CANARY-TITLE',
    startUtc: partial.startUtc, endUtc: partial.endUtc, timeZone: 'UTC',
    startLocal: partial.startUtc.slice(0, 19), endLocal: partial.endUtc.slice(0, 19),
    status: partial.status ?? 'confirmed', sequence: 1, updatedUtc: '2026-03-01T00:00:00.000Z',
  };
}

function message(partial) {
  return {
    uid: partial.uid, folder: partial.folder, from: 'a@example.com', to: 'me@example.com',
    subject: 'CANARY-SUBJECT', sentAt: partial.sentAt, messageId: `<${partial.uid}@example.com>`, seen: false,
  };
}

test('startup registers the real scheduler, reads calendar and mail, encrypts the summary, and the board is reachable', async t => {
  const userData = mkdtempSync(path.join(tmpdir(), 'personal-dashboard-'));
  let clock = Date.parse('2026-03-11T12:00:00.000Z');
  const runtime = new TaskRuntime(path.join(userData, 'runtime.sqlite'), {now: () => new Date(clock)});
  t.after(() => runtime.close());
  let calendarReads = 0;
  let mailReads = 0;
  let notices = 0;
  const sources = createDesktopDashboardSources({
    calendarConfig: {
      binding: () => ({accountRef: 'acct-1', calendarUrl: 'https://calendar.example/dav/', calendarName: 'Work'}),
      readAuthorization: () => 'Basic fixture',
      snapshot: () => ({sessionAllowed: true}),
    },
    meetingSnapshot: () => ({sessionAllowed: true}),
    mailConfig: {
      current: () => ({user: 'me@example.com', authCode: 'fixture-code', revision: 3}),
      isSessionAllowed: revision => revision === 3,
    },
    createCalendarProvider() {
      const provider = new FakeCalendarProvider([
        event({externalId: 'now', startUtc: '2026-03-10T10:00:00.000Z', endUtc: '2026-03-10T11:30:00.000Z'}),
        event({externalId: 'earlier', startUtc: '2026-03-03T10:00:00.000Z', endUtc: '2026-03-03T11:00:00.000Z'}),
        event({externalId: 'gone', startUtc: '2026-03-10T12:00:00.000Z', endUtc: '2026-03-10T13:00:00.000Z', status: 'cancelled'}),
      ], {pageSize: 1});
      const fetchWindow = provider.fetchWindow.bind(provider);
      provider.fetchWindow = (...args) => { calendarReads += 1; return fetchWindow(...args); };
      return provider;
    },
    createMailProvider() {
      const provider = new FakeMailProvider({
        inbox: [
          message({uid: 1, folder: 'INBOX', sentAt: '2026-03-10T01:00:00.000Z'}),
          message({uid: 2, folder: 'INBOX', sentAt: '2026-03-11T01:00:00.000Z'}),
          message({uid: 3, folder: 'INBOX', sentAt: '2026-03-03T01:00:00.000Z'}),
        ],
        sent: [message({uid: 1, folder: 'Sent Messages', sentAt: '2026-03-10T02:00:00.000Z'})],
      }, {pageSize: 1});
      const fetchPage = provider.fetchPage.bind(provider);
      provider.fetchPage = (...args) => { mailReads += 1; return fetchPage(...args); };
      return provider;
    },
    spendLedger: {isAuthorized: () => false, async list() { throw new Error('账单接口未授权'); }},
    budgetCap: {read: async () => ({connected: false})},
    activity: {read: async () => ({connected: false})},
    dailyBriefing: {read: async () => ({connected: false})},
    now: () => clock,
  });
  const host = createPersonalDashboardHost({
    userData, safeStorage, namespace: 'desk-user', runtime, dispatchTask: dispatchPersonalDashboardTask,
    now: () => clock, timeZone: 'UTC', sources,
    onNotification(item) { notices += 1; assert.equal(item.title, '个人数据已汇总'); assert.doesNotMatch(item.body, /CANARY/); },
  });
  await host.start();
  const before = runtime.listSchedules('personal-dashboard:desk-user');
  assert.equal(before.length, 1);
  assert.equal(before[0].status, 'pending');
  assert.equal(before[0].runAt, '2026-03-16T00:00:00.000Z');
  assert.equal(before[0].missedRunPolicy, 'run_once');
  assert.equal(host.snapshot().cards.length, 0);
  assert.equal(calendarReads, 0);
  assert.equal(mailReads, 0);

  clock = Date.parse('2026-03-16T00:00:01.000Z');
  await host.tick(true);
  const fired = runtime.getSchedule(before[0].scheduleId);
  assert.equal(fired.status, 'fired');
  assert.equal(runtime.getTask(fired.taskId).state, 'succeeded');
  assert.match(runtime.getTask(fired.taskId).resultSummary, /时间 1\.5小时/);
  assert.match(runtime.getTask(fired.taskId).resultSummary, /邮件 3封/);
  const view = host.snapshot();
  assert.equal(view.period, 'weekly');
  assert.equal(view.cards.find(card => card.id === 'time').value, '1.5');
  assert.equal(view.cards.find(card => card.id === 'mail').value, '3');
  assert.equal(view.cards.some(card => card.id === 'spend'), false);
  assert.equal(view.cards.some(card => card.id === 'briefing'), false);
  assert.ok(calendarReads > 1, 'calendar window read goes through CalendarService pagination');
  assert.ok(mailReads > 1, 'mail read goes through MailService pagination');
  assert.equal(notices, 1);
  const raw = readFileSync(path.join(userData, 'personal-dashboard.json'), 'utf8');
  const envelope = JSON.parse(raw);
  assert.equal(envelope.version, 1);
  assert.equal(typeof envelope.encrypted, 'string');
  assert.doesNotMatch(raw, /CANARY-SUBJECT|CANARY-TITLE|个人数据已汇总/);
  const decrypted = safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'));
  assert.match(decrypted, /个人数据已汇总/);
  assert.doesNotMatch(decrypted, /CANARY-SUBJECT|CANARY-TITLE/);
  const next = runtime.listSchedules('personal-dashboard:desk-user').find(item => item.status === 'pending');
  assert.equal(next.runAt, '2026-03-23T00:00:00.000Z');

  const daily = host.setPeriod({period: 'daily'});
  assert.equal(daily.period, 'daily');
  assert.equal(runtime.listSchedules('personal-dashboard:desk-user').find(item => item.status === 'pending').runAt, '2026-03-17T00:00:00.000Z');

  const globals = ['window', 'document', 'matchMedia'];
  const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const key of globals) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  globalThis.window = {addEventListener() {}};
  globalThis.document = adminAuxiliaryDocument();
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}});
  const {mountAdmin} = await import('../src/features/admin/view.js');
  const element = () => ({dataset: {}, textContent: '', value: '', addEventListener() {}, setAttribute() {}, insertBefore() {}, after: recordFollowingNodes});
  const nodes = new Map(['.admin-bar', '#admin-close', 'nav', '#admin-search', '.advanced-nav', '.main', '#page-title', '#connection', '#content', '#error'].map(key => [key, element()]));
  nodes.get('#admin-search').value = '';
  nodes.get('.advanced-nav').open = false;
  const period = {value: 'daily', listener: undefined, addEventListener(_name, fn) { this.listener = fn; }};
  const root = {
    innerHTML: '',
    querySelector: key => key === '#dashboard-period' && String(nodes.get('#content').innerHTML).includes('id="dashboard-period"') ? period : nodes.get(key) ?? null,
    querySelectorAll: () => [],
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const render = mountAdmin(root, async (name, payload) => {
    assert.equal(name, 'personalDashboard.period');
    return host.setPeriod(payload);
  }, escape);
  assert.match(root.innerHTML, /data-page="dashboard"/);
  assert.match(root.innerHTML, /数据看板/);
  render({tasks: [], approvals: [], capabilities: [], health: [], connection: 'fixture', personalDashboard: host.snapshot(),
    adminNavigation: {page: 'dashboard', revision: 1}});
  const html = () => nodes.get('#content').innerHTML;
  assert.match(html(), /1\.5/);
  assert.match(html(), /邮件/);
  assert.match(html(), /id="dashboard-period"/);
  assert.doesNotMatch(html(), /刷新|保存|花销|简报|CANARY/);
  period.value = 'monthly';
  await period.listener();
  assert.equal(host.snapshot().period, 'monthly');
  assert.match(html(), /每月/);
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action', action, payload\)/);
  assert.match(main, /personalDashboardHost\.start\(\)/);
  assert.match(main, /dispatchPersonalDashboardTask/);
  assert.match(main, /personalDashboard\.period/);
});

test('unauthorized calendar and mail stay hidden, while budget and activity adapters can supply a card', async () => {
  let calendarProviders = 0;
  const hidden = createDesktopDashboardSources({
    calendarConfig: {binding: () => undefined, snapshot: () => ({sessionAllowed: false})},
    meetingSnapshot: () => ({sessionAllowed: false}),
    mailConfig: {current: () => undefined, isSessionAllowed: () => false},
    createCalendarProvider() { calendarProviders += 1; return new FakeCalendarProvider([]); },
    createMailProvider() { throw new Error('邮件未授权'); },
    spendLedger: {isAuthorized: () => false, async list() { throw new Error('账单未授权'); }},
    budgetCap: {read: async () => ({connected: false})},
    activity: {read: async () => ({connected: false})},
    dailyBriefing: {read: async () => ({connected: false})},
  });
  const signal = new AbortController().signal;
  const window = {fromUtc: '2026-03-09T00:00:00.000Z', toUtc: '2026-03-16T00:00:00.000Z'};
  assert.deepEqual(await hidden.readTime(window, signal), {connected: false});
  assert.deepEqual(await hidden.readMail(window, signal), {connected: false});
  assert.deepEqual(await hidden.readSpend(window, signal), {connected: false});
  assert.equal(calendarProviders, 0);
  const activity = await readTime({
    isAuthorized: () => false,
    createService() { throw new Error('日历未授权'); },
    activity: {read: async () => ({connected: true, samples: [{startUtc: '2026-03-10T10:00:00.000Z', endUtc: '2026-03-10T11:00:00.000Z', status: 'confirmed'}]})},
  }, window, signal);
  assert.equal(activity.connected, true);
  assert.equal(activity.samples.length, 1);
  const spend = await readSpend({
    ledger: {isAuthorized: () => false, async list() { throw new Error('不应读取未授权账本'); }},
    budgetCap: {read: async () => ({connected: true, samples: [{occurredAt: '2026-03-10T00:00:00.000Z', amountMinor: 250, currency: 'CNY'}]})},
  }, window, signal);
  assert.equal(spend.connected, true);
  assert.equal(spend.samples[0].amountMinor, 250);
});
