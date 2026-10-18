import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSubagentConversations} from '../src/features/conversation/subagent-conversations.js';

// Explicit Fake DOM/IPC: only the exported view runs, with no task execution.
function fixture(t, handler = () => ({})) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.hidden = false;
      this.value = '';
    }
    set textContent(value) { this.value = String(value); this.children = []; }
    get textContent() { return this.value + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { throw Error(`Unexpected HTML interpolation: ${value}`); }
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
  const control = mountSubagentConversations(root, async (name, payload) => {
    calls.push({name, payload});
    return handler(name, payload);
  }, () => { throw Error('textContent must not be HTML escaped'); });
  const walk = node => [node, ...node.children.flatMap(walk)];
  const section = root.children[0];
  const list = section.children[0], detail = section.children[1];
  const button = label => walk(root).find(node => node.tag === 'button' && node.textContent === label);
  return {...control, root, section, list, detail, document, calls, button, walk,
    entry: index => list.children[index], status: () => detail.children[1]};
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

test('children stay compact and empty lists occupy no space or invoke the host', t => {
  const ui = fixture(t);
  ui.update([]);
  assert.equal(ui.section.hidden, true);
  ui.update([child('a'), child('b', {role: '研究', state: 'succeeded'})]);
  assert.equal(ui.section.hidden, false);
  assert.equal(ui.detail.hidden, true);
  assert.equal(ui.list.children.length, 2);
  assert.equal(ui.entry(0).type, 'button'); // Native Enter/Space activation, no pointer-only handler.
  assert.equal(ui.entry(0).attrs['aria-expanded'], 'false');
  assert.match(ui.entry(1).textContent, /研究#02已完成/);
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.document.head.children.length, 1);
});

test('opening reads the exact child, shows only persisted fields and navigates to its parent', async t => {
  const unsafe = '<img src=x onerror=alert(1)>';
  const ui = fixture(t, name => name === 'task.subagentConversation'
    ? record('a', {goal: unsafe, resultSummary: unsafe, error: {message: unsafe},
      evidenceRefs: ['private-raw-reference'], steps: [{label: unsafe, state: 'running'}]}) : {});
  ui.update([child('a')]);
  await ui.entry(0).onclick();
  await settle();
  assert.deepEqual(ui.calls, [{name: 'task.subagentConversation', payload: {parentTaskId: 'parent-1', taskId: 'a'}}]);
  assert.equal(ui.detail.hidden, false);
  assert.equal(ui.entry(0).attrs['aria-expanded'], 'true');
  assert.match(ui.detail.textContent, /完整逐轮会话暂不可读/);
  assert.match(ui.detail.textContent, /执行回执不等于独立验证/);
  assert.ok(ui.detail.textContent.includes(unsafe));
  assert.match(ui.detail.textContent, /执行记录引用 2 条/);
  assert.ok(!ui.detail.textContent.includes('private-raw-reference'));
  assert.ok(ui.walk(ui.detail).every(node => node.tag !== 'img'));
  await ui.button('返回父对话').onclick();
  assert.deepEqual(ui.calls.at(-1), {name: 'task.openConversation', payload: {taskId: 'parent-1'}});
  assert.equal(ui.detail.hidden, true);
});

test('snapshot updates retain the selected child and its read content without refetching', async t => {
  const ui = fixture(t, () => record('a'));
  ui.update([child('a')]);
  ui.entry(0).onclick();
  await settle();
  const detailContent = ui.detail.textContent;
  ui.entry(0).focus();
  ui.update([child('b'), child('a', {state: 'succeeded'})]);
  assert.equal(ui.detail.hidden, false);
  assert.equal(ui.detail.textContent, detailContent);
  assert.equal(ui.entry(1).attrs['aria-expanded'], 'true');
  assert.equal(ui.document.activeElement, ui.entry(1));
  assert.equal(ui.calls.length, 1);
  const selectedButton = ui.entry(1);
  ui.update([child('b'), child('a', {state: 'succeeded'})]);
  assert.equal(ui.entry(1), selectedButton);
});

test('same-role children have stable distinct short labels and complete task titles', t => {
  const ui = fixture(t);
  const a = child('same-prefix-child-a', {role: 'coder'}), b = child('same-prefix-child-b', {role: 'coder'});
  ui.update([a, b]);
  const firstLabel = ui.entry(0).attrs['aria-label'], secondLabel = ui.entry(1).attrs['aria-label'];
  assert.notEqual(firstLabel, secondLabel);
  assert.match(firstLabel, /coder #01/);
  assert.equal(ui.entry(0).attrs.title, '子任务 same-prefix-child-a\n父任务 parent-1');
  ui.update([b, a]);
  assert.equal(ui.entry(0).attrs['aria-label'], secondLabel);
  assert.equal(ui.entry(1).attrs['aria-label'], firstLabel);
});

test('Escape closes an open child and returns focus to its compact entry', async t => {
  const ui = fixture(t, () => record('a'));
  ui.update([child('a')]);
  ui.entry(0).onclick();
  await settle();
  const calls = [];
  ui.section.onkeydown({key: 'Escape', preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop')});
  assert.equal(ui.detail.hidden, true);
  assert.equal(ui.document.activeElement, ui.entry(0));
  assert.deepEqual(calls, ['prevent', 'stop']);
});

test('late replies cannot overwrite a newer child or reopen a closed conversation', async t => {
  const a = deferred(), b = deferred(), refreshed = deferred();
  let reads = 0;
  const ui = fixture(t, (_name, payload) => payload.taskId === 'a' ? a.promise : ++reads === 1 ? b.promise : refreshed.promise);
  ui.update([child('a'), child('b')]);
  ui.entry(0).onclick();
  ui.entry(1).onclick();
  b.resolve(record('b', {resultSummary: '新的子对话'}));
  await settle();
  a.resolve(record('a', {resultSummary: '旧回包'}));
  await settle();
  assert.match(ui.detail.textContent, /新的子对话/);
  assert.ok(!ui.detail.textContent.includes('旧回包'));
  ui.button('刷新子对话').onclick();
  ui.button('关闭子对话').onclick();
  refreshed.resolve(record('b'));
  await settle();
  assert.equal(ui.detail.hidden, true);
  assert.equal(ui.detail.textContent, '');
  assert.equal(ui.entry(1).attrs['aria-expanded'], 'false');
  assert.equal(ui.document.activeElement, ui.entry(1));
});

test('missing content and visible failures never manufacture child messages', async t => {
  let response = {...child('a'), transcriptAvailable: false};
  const ui = fixture(t, name => {
    if (name === 'task.openConversation') throw Error('父对话不可用');
    return response;
  });
  ui.update([child('a')]);
  ui.entry(0).onclick();
  await settle();
  assert.match(ui.detail.textContent, /任务目标未记录/);
  assert.match(ui.detail.textContent, /回答未记录/);
  assert.match(ui.detail.textContent, /执行步骤未记录/);
  await ui.button('返回父对话').onclick();
  assert.equal(ui.status().attrs.role, 'alert');
  assert.match(ui.status().textContent, /父对话不可用/);
  response = record('other-child');
  ui.button('刷新子对话').onclick();
  await settle();
  assert.equal(ui.status().attrs.role, 'alert');
  assert.match(ui.status().textContent, /记录与所选任务不匹配/);
  assert.ok(!ui.detail.textContent.includes('保存的回答'));
});

test('removed children invalidate pending reads and read failures remain visible', async t => {
  const pending = deferred();
  let failing = false;
  const ui = fixture(t, () => { if (failing) throw Error('读取失败'); return pending.promise; });
  ui.update([child('a')]);
  ui.entry(0).onclick();
  ui.update([]);
  pending.reject(Error('旧错误'));
  await settle();
  assert.equal(ui.section.hidden, true);
  assert.equal(ui.detail.hidden, true);
  failing = true;
  ui.update([child('a')]);
  ui.entry(0).onclick();
  await settle();
  assert.equal(ui.status().attrs.role, 'alert');
  assert.match(ui.status().textContent, /无法读取子对话：读取失败/);
});
