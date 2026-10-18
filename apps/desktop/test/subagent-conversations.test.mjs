import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSubagentConversations, mountSubagentConversationPage} from '../src/features/conversation/subagent-conversations.js';

// Explicit Fake DOM/IPC: real renderers execute without models, microphones or task writes.
function fixture(t, kind = 'workspace', handler = () => ({})) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.hidden = false; this.value = '';
    }
    set textContent(value) { this.value = String(value); this.children = []; }
    get textContent() { return this.value + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { throw Error('Unexpected HTML interpolation: ' + value); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.value = ''; this.children = [...children]; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
  }
  const head = new Element('head');
  const document = {head, activeElement: null, createElement: tag => new Element(tag),
    querySelector: () => head.children.find(child => 'subagentConversations' in child.dataset)};
  globalThis.document = document;
  const root = new Element('main'), calls = [];
  const invoke = async (name, payload) => {
    calls.push({name, payload});
    return handler(name, payload);
  };
  const control = kind === 'page' ? mountSubagentConversationPage(root, invoke)
    : mountSubagentConversations(root, invoke, () => { throw Error('textContent must not be HTML escaped'); });
  const walk = element => [element, ...element.children.flatMap(walk)];
  const section = root.children[0];
  const button = label => walk(root).find(element => element.tag === 'button' && element.textContent === label);
  return {...control, root, section, document, calls, button, walk,
    list: section.children[0], entry: index => section.children[0].children[index],
    status: () => section.children[1], content: () => section.children[2]};
}

const child = (taskId, overrides = {}) => ({parentTaskId: 'parent-1', taskId, role: '核验',
  state: 'running', modelId: 'recorded-model', ...overrides});
const record = (taskId, overrides = {}) => ({...child(taskId), goal: '保存的目标',
  resultSummary: '保存的回答', reasoningEffort: 'high', evidenceRefCount: 2,
  steps: [{label: '读取原记录', state: 'succeeded'}], transcriptAvailable: false, ...overrides});
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

test('workspace retains caller recency order, shows at most six entries and stays empty without children', t => {
  const ui = fixture(t);
  ui.update([]);
  assert.equal(ui.section.hidden, true);
  const tasks = Array.from({length: 10}, (_, index) => child('task-' + index));
  ui.update([null, {taskId: 'invalid'}, ...tasks]);
  assert.equal(ui.section.hidden, false);
  assert.equal(ui.list.children.length, 6);
  assert.match(ui.entry(0).attrs.title, /子任务 task-0/);
  assert.match(ui.entry(5).attrs.title, /子任务 task-5/);
  assert.equal(ui.entry(0).type, 'button'); // Native Enter/Space activation.
  assert.equal(ui.section.children.length, 2); // Entries + status, no inline detail.
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.document.head.children.length, 1);
});

test('workspace opens the exact independent child and suppresses duplicate pending clicks', async t => {
  const pending = deferred();
  const ui = fixture(t, 'workspace', () => pending.promise);
  ui.update([child('a', {goal: '目标不应铺开', resultSummary: '回答不应铺开'})]);
  const first = ui.entry(0);
  const opening = first.onclick();
  await first.onclick();
  assert.equal(ui.calls.length, 1);
  assert.deepEqual(ui.calls[0], {name: 'task.openSubagentConversation', payload: {parentTaskId: 'parent-1', taskId: 'a'}});
  assert.equal(first.disabled, true);
  assert.equal(first.attrs['aria-busy'], 'true');
  ui.update([child('a', {state: 'succeeded'})]);
  assert.equal(ui.entry(0).disabled, true);
  pending.resolve({});
  await opening;
  assert.equal(ui.entry(0).disabled, false);
  assert.ok(!ui.root.textContent.includes('回答不应铺开'));
  assert.ok(!ui.root.textContent.includes('目标不应铺开'));
});

test('same-role workspace labels and keyboard focus survive reordered snapshots', t => {
  const ui = fixture(t);
  const a = child('same-prefix-a', {role: 'coder'}), b = child('same-prefix-b', {role: 'coder'});
  ui.update([a, b]);
  const firstLabel = ui.entry(0).attrs['aria-label'], secondLabel = ui.entry(1).attrs['aria-label'];
  assert.notEqual(firstLabel, secondLabel);
  assert.match(firstLabel, /coder #01/);
  assert.match(ui.entry(0).attrs.title, /子任务 same-prefix-a\n父任务 parent-1/);
  ui.entry(0).focus();
  ui.update([b, a]);
  assert.equal(ui.entry(0).attrs['aria-label'], secondLabel);
  assert.equal(ui.entry(1).attrs['aria-label'], firstLabel);
  assert.equal(ui.document.activeElement, ui.entry(1));
  const retained = ui.entry(1);
  ui.update([b, a]);
  assert.equal(ui.entry(1), retained);
});

test('workspace reports current open failures and ignores replies for removed entries', async t => {
  const pending = deferred();
  let failing = false;
  const ui = fixture(t, 'workspace', () => {
    if (failing) throw Error('窗口不可用');
    return pending.promise;
  });
  ui.update([child('a')]);
  const opening = ui.entry(0).onclick();
  ui.update([]);
  pending.reject(Error('旧错误'));
  await opening;
  assert.equal(ui.section.hidden, true);
  assert.equal(ui.status().textContent, '');
  failing = true;
  ui.update([child('a')]);
  await ui.entry(0).onclick();
  assert.equal(ui.status().attrs.role, 'alert');
  assert.match(ui.status().textContent, /无法打开子对话：窗口不可用/);
  assert.equal(ui.entry(0).disabled, false);
});

test('independent page reads only its fixed snapshot and renders persisted text without HTML or raw refs', async t => {
  const unsafe = '<img src=x onerror=alert(1)>';
  const ui = fixture(t, 'page', () => record('child-12345678', {
    goal: unsafe, resultSummary: unsafe, error: {message: unsafe},
    evidenceRefs: ['private-raw-reference'], steps: [{label: unsafe, state: 'running'}],
  }));
  await settle();
  assert.deepEqual(ui.calls, [{name: 'subagentConversation.snapshot', payload: undefined}]);
  assert.match(ui.root.textContent, /完整逐轮会话暂不可读/);
  assert.match(ui.root.textContent, /执行回执不等于独立验证/);
  assert.match(ui.root.textContent, /执行记录引用 2 条/);
  assert.ok(ui.content().textContent.includes(unsafe));
  assert.ok(!ui.root.textContent.includes('private-raw-reference'));
  assert.ok(ui.walk(ui.root).every(element => element.tag !== 'img'));
  assert.match(ui.section.children[0].children[0].textContent, /12345678/);
  assert.equal(ui.content().attrs['aria-busy'], 'false');
});

test('missing persisted page content is explicit and missing identity is rejected visibly', async t => {
  let response = child('a');
  const ui = fixture(t, 'page', () => response);
  await settle();
  assert.match(ui.content().textContent, /任务目标未记录/);
  assert.match(ui.content().textContent, /回答未记录/);
  assert.match(ui.content().textContent, /执行步骤未记录/);
  response = {resultSummary: '不可信的新回答'};
  await ui.refresh();
  assert.equal(ui.status().attrs.role, 'alert');
  assert.match(ui.status().textContent, /缺少任务标识/);
  assert.ok(!ui.content().textContent.includes('不可信的新回答'));
});

test('refreshes ignore older replies and reject a different child identity', async t => {
  const old = deferred();
  let reads = 0;
  const ui = fixture(t, 'page', () => ++reads === 1 ? old.promise
    : reads === 2 ? record('a', {resultSummary: '新快照'})
      : record('different', {resultSummary: '其他子任务回答'}));
  await ui.refresh();
  old.resolve(record('a', {resultSummary: '旧快照'}));
  await settle();
  assert.match(ui.content().textContent, /新快照/);
  assert.ok(!ui.content().textContent.includes('旧快照'));
  await ui.button('刷新子对话').onclick();
  assert.match(ui.status().textContent, /当前窗口不匹配/);
  assert.ok(!ui.content().textContent.includes('其他子任务回答'));
});

test('page navigation uses its own main and close actions without task parameters', async t => {
  const late = deferred();
  let reads = 0;
  const ui = fixture(t, 'page', name => name === 'subagentConversation.snapshot'
    ? ++reads === 1 ? record('a') : late.promise : {});
  await settle();
  await ui.button('返回主对话').onclick();
  assert.deepEqual(ui.calls.at(-1), {name: 'subagentConversation.main', payload: undefined});
  const refresh = ui.refresh();
  await ui.button('关闭子对话').onclick();
  assert.deepEqual(ui.calls.at(-1), {name: 'subagentConversation.close', payload: undefined});
  late.resolve(record('a', {resultSummary: '关闭后的迟到回答'}));
  await refresh;
  assert.ok(!ui.content().textContent.includes('关闭后的迟到回答'));
  const count = ui.calls.length;
  await ui.refresh();
  assert.equal(ui.calls.length, count);
});

test('page read and navigation errors stay visible and permit retry', async t => {
  let failRead = true, failNavigation = true;
  const ui = fixture(t, 'page', name => {
    if (name === 'subagentConversation.snapshot') {
      if (failRead) throw Error('读取不可用');
      return record('a');
    }
    if (failNavigation) throw Error('主对话不可用');
    return {};
  });
  await settle();
  assert.match(ui.status().textContent, /无法读取子对话：读取不可用/);
  failRead = false;
  await ui.refresh();
  assert.equal(ui.status().attrs.role, 'status');
  assert.match(ui.content().textContent, /保存的回答/);
  await ui.button('返回主对话').onclick();
  assert.match(ui.status().textContent, /无法返回主对话：主对话不可用/);
  assert.equal(ui.button('刷新子对话').disabled, false);
  assert.equal(ui.button('关闭子对话').disabled, false);
  failNavigation = false;
  await ui.button('返回主对话').onclick();
  assert.match(ui.status().textContent, /已返回主对话/);
});
