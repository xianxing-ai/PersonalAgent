import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSubagentConversationList} from '../src/features/conversation/subagent-conversation-list.js';

// Explicit Fake DOM and IPC. The actual list renderer runs with no task/model/account writes.
function fixture(t, handler) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document;});
  class Element {
    constructor(tag) {this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.value = ''; this.hidden = false;}
    set textContent(value) {this.text = String(value); this.children = [];}
    get textContent() {return (this.text || '') + this.children.map(child => child.textContent).join('');}
    set innerHTML(value) {throw Error(`Unexpected HTML interpolation: ${value}`);}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {
      if (this.querySelectorAll('button').includes(document.activeElement)) document.activeElement = document.body;
      this.text = ''; this.children = [...children];
    }
    querySelectorAll(selector) {return this.children.flatMap(child => [...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector)]);}
    setAttribute(name, value) {this.attrs[name] = String(value);}
    focus(options) {document.activeElement = this; this.focusOptions = options;}
  }
  const document = {head:new Element('head'), body:new Element('body'), createElement:tag => new Element(tag)};
  document.activeElement = document.body;
  document.querySelector = () => document.head.children.find(child => 'subagentConversationList' in child.dataset);
  globalThis.document = document;
  const root = new Element('main'), calls = [];
  const control = mountSubagentConversationList(root, async (name, payload) => {calls.push({name, payload}); return handler(name, payload);});
  const page = root.children[0], header = page.children[0], search = page.children[1].children[0];
  const [collapseButton, refreshButton, closeButton] = header.children.slice(1);
  const count = page.children[2], status = page.children[3], [list, empty] = page.children[4].children, more = page.children[5];
  return {...control, root, page, search, count, status, list, empty, more, collapseButton, refreshButton, closeButton, calls, document,
    rows:() => list.querySelectorAll('button'), filter(value) {search.value = value; search.oninput();}};
}
const child = (taskId, extra = {}) => ({parentTaskId:'parent', taskId, role:'核验', modelId:'model-a',
  state:'succeeded', updatedAt:'2026-10-18T10:00:00Z', goal:'检查结果', ...extra});
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve=yes; reject=no;}); return {promise, resolve, reject};}

test('initial refresh is deduplicated and rows expose exact identity/state using literal safe text', async t => {
  const request = deferred();
  const ui = fixture(t, () => request.promise);
  const duplicate = ui.refresh(); await settle();
  assert.deepEqual(ui.calls, [{name:'subagentConversations.list',payload:{}}]);
  assert.equal(ui.refreshButton.disabled, true); assert.equal(ui.more.hidden, true);
  const unsafe = '<img src=x onerror=alert(1)>';
  request.resolve({items:[child('child-a', {role:unsafe,goal:unsafe,evidenceRefs:['private-evidence']}),
    child('child-b', {state:'failed'})]}); await duplicate;
  assert.equal(ui.rows().length, 2); assert.match(ui.rows()[0].textContent, /child-a.*parent/);
  assert.ok(ui.rows()[0].textContent.includes(unsafe)); assert.match(ui.rows()[1].textContent, /失败/);
  assert.doesNotMatch(ui.page.textContent, /private-evidence/);
  assert.equal(ui.page.querySelectorAll('img').length, 0);
  assert.equal(ui.refreshButton.disabled, false); assert.equal(ui.status.attrs['aria-live'], 'polite');
  assert.equal(ui.page.querySelectorAll('button').some(button => /删除|归档/.test(button.textContent)), false);
});

test('pagination preserves loaded rows on failure, retries the exact cursor and search states its loaded scope', async t => {
  const page = deferred(); let reads = 0;
  const ui = fixture(t, name => name === 'subagentConversations.list' && ++reads === 1
    ? {items:[child('a', {goal:'首次记录'})],nextCursor:'next-page'} : page.promise);
  await settle(); assert.equal(ui.rows().length, 1); assert.equal(ui.more.hidden, false);
  const loading = ui.more.onclick(); const duplicate = ui.more.onclick(); await settle();
  assert.equal(ui.calls.length, 2); assert.deepEqual(ui.calls[1].payload, {cursor:'next-page'});
  page.reject(Error('private cursor failure')); await Promise.all([loading, duplicate]);
  assert.equal(ui.rows().length, 1); assert.equal(ui.more.disabled, false);
  assert.match(ui.status.textContent, /已加载的记录保留/); assert.doesNotMatch(ui.status.textContent, /private/);
  ui.filter('later'); assert.equal(ui.rows().length, 0); assert.match(ui.empty.textContent, /已加载记录中/);
  assert.match(ui.search.placeholder, /仅搜索已加载记录/);
});

test('later pages deduplicate identities and a fresh refresh supersedes a delayed older page', async t => {
  const oldPage = deferred(), fresh = deferred(); let reads = 0;
  const ui = fixture(t, () => ++reads === 1 ? {items:[child('a')],nextCursor:'p2'}
    : reads === 2 ? {items:[child('a'),child('b')],nextCursor:'p3'}
      : reads === 3 ? oldPage.promise : fresh.promise);
  await settle(); await ui.more.onclick();
  assert.equal(ui.rows().length, 2); assert.match(ui.count.textContent, /已加载 2 条/);
  const pending = ui.more.onclick(); await settle();
  const refreshing = ui.refresh(); await settle();
  assert.equal(ui.rows().length, 2, 'refresh retains existing history until readback');
  fresh.resolve({items:[child('latest')],nextCursor:'new-page'}); await refreshing;
  oldPage.resolve({items:[child('stale')],nextCursor:'stale-page'}); await pending;
  assert.equal(ui.rows().length, 1); assert.match(ui.rows()[0].textContent, /latest/);
  assert.doesNotMatch(ui.page.textContent, /stale/);
  ui.filter('latest'); assert.match(ui.count.textContent, /匹配 1 条/);
  ui.filter('核验'); assert.equal(ui.rows().length, 1);
  ui.filter('检查结果'); assert.equal(ui.rows().length, 1);
});

test('opening binds the exact parent/child, prevents duplicate requests and isolates older open failures', async t => {
  const first = deferred(), second = deferred();
  const ui = fixture(t, (name, payload) => name === 'subagentConversations.list'
    ? {items:[child('a'),child('b', {parentTaskId:'other-parent'})]}
    : payload.taskId === 'a' ? first.promise : second.promise);
  await settle();
  const a = ui.rows()[0].onclick(); await ui.rows()[0].onclick();
  assert.equal(ui.calls.length, 2); assert.equal(ui.rows()[0].disabled, true);
  const b = ui.rows()[1].onclick();
  assert.deepEqual(ui.calls.slice(1), [
    {name:'subagentConversations.open',payload:{parentTaskId:'parent',taskId:'a'}},
    {name:'subagentConversations.open',payload:{parentTaskId:'other-parent',taskId:'b'}},
  ]);
  second.reject(Error('new private error')); await b;
  const feedback = ui.status.textContent;
  first.reject(Error('old private error')); await a;
  assert.equal(ui.status.textContent, feedback); assert.doesNotMatch(feedback, /private/);
  assert.ok(ui.rows().every(button => !button.disabled));
});

test('invalid refresh data cannot replace valid history and a later success clears only its read error', async t => {
  let response = {items:[child('a')]};
  const ui = fixture(t, () => response); await settle();
  response = {items:[child('b'),{taskId:'forged'}]}; await ui.refresh();
  assert.equal(ui.rows().length, 1); assert.match(ui.rows()[0].textContent, /a/);
  assert.equal(ui.status.attrs.role, 'alert');
  response = {items:[child('c')]}; await ui.refresh();
  assert.equal(ui.rows().length, 1); assert.match(ui.rows()[0].textContent, /子任务 c/);
  assert.equal(ui.status.textContent, ''); assert.equal(ui.status.attrs.role, 'status');
});

test('an older page read cannot clear newer navigation failure feedback', async t => {
  const pending = deferred(); let reads = 0;
  const ui = fixture(t, name => {
    if (name === 'subagentConversations.open') throw Error('private navigation error');
    return ++reads === 1 ? {items:[child('a')],nextCursor:'more'} : pending.promise;
  });
  await settle(); const more = ui.more.onclick(); await settle();
  await ui.rows()[0].onclick(); const error = ui.status.textContent;
  assert.match(error, /无法打开/);
  pending.resolve({items:[child('b')]}); await more;
  assert.equal(ui.rows().length, 2); assert.equal(ui.status.textContent, error);
});

test('close sends no parameters, blocks duplicates and discards late data while allowing an explicit failed-close retry', async t => {
  const late = deferred(), closing = deferred(); let closeFails = true, reads = 0;
  const ui = fixture(t, name => name === 'subagentConversations.list'
    ? ++reads === 1 ? {items:[child('a')],nextCursor:'next'} : late.promise
    : closeFails ? closing.promise : {});
  await settle(); const page = ui.more.onclick(); await settle();
  const close = ui.closeButton.onclick(); await ui.closeButton.onclick();
  assert.deepEqual(ui.calls.at(-1), {name:'subagentConversations.close',payload:undefined});
  assert.equal(ui.calls.filter(call => call.name === 'subagentConversations.close').length, 1);
  late.resolve({items:[child('late')]}); await page;
  closing.reject(Error('private close error')); await close;
  assert.match(ui.status.textContent, /无法关闭/); assert.doesNotMatch(ui.page.textContent, /private|子任务 late/);
  assert.equal(ui.closeButton.disabled, false);
  closeFails = false; await ui.closeButton.onclick();
  const count = ui.calls.length; await ui.refresh(); await ui.rows()[0].onclick();
  assert.equal(ui.calls.length, count, 'closed page never reads or opens further tasks');
});
