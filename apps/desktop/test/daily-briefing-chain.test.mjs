import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {TaskRuntime} from '@personal-agent/runtime';
import {createReminderDeliveryHost} from '@personal-agent/runtime/application';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';
import {createDailyBriefingHost} from '../electron/daily-briefing-host.js';
import {presentBriefingDecision} from '../electron/briefing-decision.js';
import {Conversations} from '../electron/conversations.js';
import {approvalCards, focusApprovalCard} from '../src/features/conversation/approval-card.js';
import {mountDailyBriefing} from '../src/features/admin/daily-briefing.js';

const cache = new URL('../../../.cache/daily-briefing-chain/', import.meta.url);
mkdirSync(cache, {recursive: true});
const secret = '机密句子不应出现';
const mail = 'secret@example.com';
async function until(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error('timed out');
}

test('startup wiring registers the real scheduler, settings IPC and approval jump', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/features/admin/view.js', import.meta.url), 'utf8');
  assert.match(main, /createDailyBriefingHost\(\{[\s\S]*?createDeliveryHost: runtimeModule\.createReminderDeliveryHost/);
  assert.match(main, /void dailyBriefingHost\.tick\(\)/);
  assert.match(main, /maintenancePoll\.run\('daily-briefing'/);
  assert.match(main, /name === 'briefing\.update'/);
  assert.match(main, /name === 'briefing\.openDecision'/);
  assert.match(main, /presentBriefingDecision/);
  assert.match(main, /onOpen: \(\) => openAdmin\('briefing'\)/);
  assert.match(preload, /invoke: \(action, payload\) => ipcRenderer\.invoke\('desktop:action'/);
  assert.match(view, /mountDailyBriefing/);
  assert.match(view, /data\.dailyBriefing/);
});

test('due scheduler writes a redacted briefing, sends one notification, and the decision opens its approval card', async () => {
  const userData = mkdtempSync(new URL('run-', cache));
  let clock = Date.parse('2026-11-11T00:30:00.000Z');
  const runtime = new TaskRuntime(join(userData, 'runtime.sqlite'), {now: () => new Date(clock)});
  const done = runtime.submitTask({goal: '整理昨日记录', conversationId: 'desktop-panel', idempotencyKey: 'done'});
  runtime.transitionTask(done.taskId, 'planning');
  runtime.transitionTask(done.taskId, 'running');
  runtime.transitionTask(done.taskId, 'verifying');
  runtime.transitionTask(done.taskId, 'succeeded', {resultSummary: secret});
  const failed = runtime.submitTask({goal: `From: ${mail}\n这是邮件正文`, conversationId: 'desktop-panel', idempotencyKey: 'failed'});
  runtime.transitionTask(failed.taskId, 'planning');
  runtime.transitionTask(failed.taskId, 'running');
  runtime.transitionTask(failed.taskId, 'failed', {error: {code: 'EXTERNAL_FAILURE', message: secret, retryable: false}});
  const waiting = runtime.submitTask({goal: '确认下午会议', conversationId: 'desktop-panel', idempotencyKey: 'waiting'});
  runtime.transitionTask(waiting.taskId, 'planning');
  runtime.transitionTask(waiting.taskId, 'running');
  const approval = runtime.requestToolApproval('approval-1', waiting.taskId, {name: 'calendar.respond', requiredScopes: ['calendar:write']}, new Date(clock + 3_600_000).toISOString(), 'a'.repeat(64));
  runtime.createSchedule({scheduleId: 'meet-1', goal: '下午同步周报', conversationId: 'desktop-panel', runAt: '2026-11-11T06:00:00.000Z', timeZone: 'Asia/Shanghai', missedRunPolicy: 'skip', taskIdempotencyKey: 'meet-1'});
  const shown = [];
  let click;
  const port = createDesktopNotificationPort({storageDir: userData, now: () => clock, notifier: {
    async isSupported() { return true; },
    async show(input, callbacks) {
      shown.push(input);
      callbacks.onShow();
      click = () => callbacks.onClick();
      return {close() {}};
    },
  }, onOutcome: outcome => host.noteOutcome(outcome)});
  const opened = [];
  const host = createDailyBriefingHost({
    userData, namespace: 'user', now: () => clock, timeZone: () => 'Asia/Shanghai',
    createDeliveryHost: createReminderDeliveryHost, getRuntime: () => runtime,
    notify: input => port.sendAdvisoryNotification(input), onOpen: () => opened.push('briefing'),
  });
  try {
    await host.tick();
    const fired = runtime.listSchedules('daily-briefing:user').find(item => item.status === 'fired');
    assert.ok(fired?.taskId, 'real scheduler must fire the briefing wake');
    assert.equal(runtime.getTask(fired.taskId).state, 'succeeded');
    const snapshot = host.snapshot();
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.localTime, '08:00');
    assert.deepEqual(snapshot.briefing.completed.map(item => item.title), ['整理昨日记录']);
    assert.equal(snapshot.briefing.decisions[0].taskId, waiting.taskId);
    assert.equal(snapshot.briefing.decisions[0].approvalId, approval.approvalId);
    assert.equal(snapshot.briefing.schedule.some(item => item.title === '下午同步周报' && item.displayTime === '14:00'), true);
    const stored = readFileSync(join(userData, 'daily-briefing.json'), 'utf8');
    assert.equal(stored.includes(secret), false);
    assert.equal(stored.includes(mail), false);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].title, '每日结果简报');
    assert.match(shown[0].body, /点开查看全文/);
    assert.equal(shown[0].body.includes(secret), false);
    await host.tick();
    assert.equal(shown.length, 1);
    click();
    assert.deepEqual(opened, ['briefing']);

    const calls = [];
    const previous = globalThis.document;
    const root = installDocument();
    try {
      const ui = mountDailyBriefing(root, async (name, payload) => {
        calls.push({name, payload});
        if (name === 'briefing.update') return host.update(payload);
        return snapshot;
      });
      ui.show(true);
      ui.render(host.snapshot());
      assert.equal(root.querySelector('button')?.textContent?.includes('保存'), false);
      assert.equal([...root.querySelectorAll('button')].some(button => /刷新|保存/.test(button.textContent)), false);
      const decision = [...root.querySelectorAll('button')].find(button => button.textContent === '查看审批卡');
      decision.click();
      assert.deepEqual(calls[0], {name: 'briefing.openDecision', payload: {taskId: waiting.taskId, approvalId: approval.approvalId}});
      const time = root.querySelector('[data-briefing=form]').elements.namedItem('localTime');
      time.value = '09:15';
      root.querySelector('[data-briefing=form]').dispatch('change');
    } finally { globalThis.document = previous; }
    assert.equal(calls.at(-1).name, 'briefing.update');
    await until(() => runtime.listSchedules('daily-briefing:user').some(item => item.scheduleId === 'daily-briefing:2026-11-12:09:15' && item.status === 'pending'));

    const conversations = new Conversations();
    conversations.add(waiting.taskId, 'panel', '确认下午会议');
    let focused;
    const openedConversation = await presentBriefingDecision({
      taskId: waiting.taskId, approvalId: approval.approvalId,
      tasks: {get: id => runtime.getTask(id)}, conversations, sourceSurface: () => 'panel',
      openPanel: async () => {}, openWorkspace: async () => {}, publish() {},
      rememberFocus: value => { focused = value; },
    });
    assert.equal(openedConversation.conversationId, 'desktop-panel');
    assert.equal(conversations.activeConversationId('panel'), 'desktop-panel');
    assert.equal(focused.taskId, waiting.taskId);
    const thread = elementFromHtml(`<div><article class="task turn" data-turn="${waiting.taskId}">${approvalCards(runtime.getTask(waiting.taskId), runtime.listApprovals({state: 'pending', limit: 10}).items, clock)}</article></div>`);
    assert.equal(focusApprovalCard(thread, waiting.taskId), true);
    const card = thread.querySelector('.approval-card');
    assert.equal(card.scrolled, true);
    assert.match(visibleText(card), /calendar\.respond/);
    assert.match(visibleText(card), /同意/);
  } finally {
    await host.close();
    runtime.close();
  }
});

function installDocument() {
  globalThis.document = {createElement: tag => new Element(tag), activeElement: null};
  return new Element('main');
}

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map();
    this.className = ''; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.textContent = '';
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
    if (name === 'value') this.value = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  set innerHTML(value) { this.children = []; parseHtml(value, this); }
  get innerHTML() { return ''; }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part.startsWith('.')) return this.className.split(/\s+/).includes(part.slice(1));
      const attr = part.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/u);
      if (attr) return this.attributes.has(attr[1]) && (attr[2] === undefined || this.attributes.get(attr[1]) === attr[2]);
      return part === this.tag;
    });
  }
  querySelectorAll(selector) {
    if (selector.includes(' ')) {
      const [head, ...rest] = selector.split(/\s+/u);
      return this.querySelectorAll(head).flatMap(node => node.querySelectorAll(rest.join(' ')));
    }
    if (selector.startsWith('button')) return this.children.flatMap(child => [...(child.tag === 'button' && !child.disabled ? [child] : []), ...child.querySelectorAll(selector)]);
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  get elements() { return {namedItem: name => this.querySelectorAll('input,select,textarea').find(node => node.attributes.get('name') === name) ?? null}; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { this.listeners.get(type)?.({target: this}); }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  click() { let node = this; while (node && !node.listeners.get('click')) node = node.parentElement; node?.listeners.get('click')?.({target: this}); }
  scrollIntoView() { this.scrolled = true; }
  focus() { this.focused = true; }
}

function parseHtml(value, parent) {
  const stack = [parent];
  for (const token of value.match(/<[^>]+>|[^<]+/gu) ?? []) {
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (!token.startsWith('<')) { stack.at(-1).textContent += token; continue; }
    const tag = token.match(/^<([\w-]+)/u)?.[1];
    if (!tag) continue;
    const node = new Element(tag);
    for (const match of token.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/gu)) node.setAttribute(match[1], match[2] ?? '');
    if (node.attributes.has('class')) node.className = node.attributes.get('class');
    stack.at(-1).append(node);
    if (!['input', 'br', 'hr', 'img'].includes(tag) && !token.endsWith('/>')) stack.push(node);
  }
}

function visibleText(node) {
  return `${node.textContent ?? ''}${node.children?.map(visibleText).join('') ?? ''}`;
}

function elementFromHtml(html) {
  const root = new Element('div');
  root.innerHTML = html;
  return root;
}
