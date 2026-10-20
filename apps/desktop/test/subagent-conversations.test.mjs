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
    status: () => section.children[1], content: () => section.children[2],
    input: () => walk(root).find(element => element.tag === 'textarea'),
    sendStatus: () => walk(root).find(element => element.className === 'subagent-conversation-composer')?.children[1]};
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

test('workspace retains caller recency order, shows at most six entries and keeps empty history accessible', t => {
  const ui = fixture(t);
  ui.update([]);
  assert.equal(ui.section.hidden, false);
  assert.equal(ui.list.hidden, true);
  const tasks = Array.from({length: 10}, (_, index) => child('task-' + index));
  ui.update([null, {taskId: 'invalid'}, ...tasks]);
  assert.equal(ui.section.hidden, false);
  assert.equal(ui.list.children.length, 6);
  assert.match(ui.entry(0).attrs.title, /子任务 task-0/);
  assert.match(ui.entry(5).attrs.title, /子任务 task-5/);
  assert.equal(ui.entry(0).type, 'button'); // Native Enter/Space activation.
  assert.equal(ui.section.children.length, 4); // Entries + status + history link + collapse, no inline detail.
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
  assert.equal(ui.section.hidden, false);
  assert.equal(ui.list.hidden, true);
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

test('send accepts a new task once, clears only its sent draft, and waits for recorded replies', async t => {
  const accepted = deferred();
  let hasAccepted = false;
  const ui = fixture(t, 'page', name => {
    if (name === 'subagentConversation.submit') return accepted.promise;
    return record('original', {canSubmit: !hasAccepted, activeTaskId: hasAccepted ? 'follow-1' : undefined,
      messages: hasAccepted ? [{taskId: 'follow-1', userText: '真实追加消息', state: 'running'}] : []});
  });
  await settle();
  ui.input().value = '真实追加消息'; ui.input().oninput();
  const sending = ui.button('发送').onclick();
  await ui.button('发送').onclick();
  assert.equal(ui.calls.filter(call => call.name === 'subagentConversation.submit').length, 1);
  const request = ui.calls.find(call => call.name === 'subagentConversation.submit').payload;
  assert.deepEqual(Object.keys(request).sort(), ['requestId', 'text']);
  assert.equal(request.text, '真实追加消息');
  assert.match(request.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(ui.button('发送').disabled, true);
  hasAccepted = true;
  accepted.resolve({acceptedTaskId: 'follow-1'});
  await sending;
  assert.equal(ui.input().value, '');
  assert.match(ui.sendStatus().textContent, /消息已受理：follow-1/);
  assert.match(ui.content().textContent, /真实追加消息/);
  assert.match(ui.content().textContent, /回答尚未记录/);
  assert.equal(ui.button('停止').disabled, false);
});

test('send failures preserve the draft and same-input retry ID; a new accepted message gets a new ID', async t => {
  let submissions = 0;
  const requests = [];
  const ui = fixture(t, 'page', (name, payload) => {
    if (name === 'subagentConversation.submit') {
      requests.push(payload); submissions++;
      if (submissions === 1) throw Error('受理回包丢失');
      return {acceptedTaskId: 'follow-' + submissions};
    }
    return record('original', {canSubmit: true, messages: []});
  });
  await settle();
  ui.input().value = '保留这份草稿'; ui.input().oninput();
  await ui.button('发送').onclick();
  assert.equal(ui.input().value, '保留这份草稿');
  assert.match(ui.sendStatus().textContent, /发送失败，草稿已保留/);
  await ui.button('发送').onclick();
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.equal(ui.input().value, '');
  ui.input().value = '保留这份草稿'; ui.input().oninput();
  await ui.button('发送').onclick();
  assert.notEqual(requests[1].requestId, requests[2].requestId);
});

test('snapshots do not replace an unsent draft or overwrite a newer send result', async t => {
  const oldRead = deferred(), accepted = deferred();
  let reads = 0;
  const ui = fixture(t, 'page', name => {
    if (name === 'subagentConversation.submit') return accepted.promise;
    return ++reads === 2 ? oldRead.promise : record('original', {canSubmit: true, messages: []});
  });
  await settle();
  ui.input().value = '第一条消息'; ui.input().oninput();
  const oldRefresh = ui.refresh();
  const sending = ui.button('发送').onclick();
  ui.input().value = '发送途中准备的下一条草稿'; ui.input().oninput();
  oldRead.resolve(record('other-identity', {canSubmit: true}));
  await oldRefresh;
  assert.ok(!ui.status().textContent.includes('窗口不匹配'));
  accepted.resolve({acceptedTaskId: 'follow-1'});
  await sending;
  assert.equal(ui.input().value, '发送途中准备的下一条草稿');
  await ui.refresh();
  assert.equal(ui.input().value, '发送途中准备的下一条草稿');
});

test('stop targets only the latest active follow-up, never the original terminal task', async t => {
  let stopped = false;
  const ui = fixture(t, 'page', (name, payload) => {
    const snapshot = record('original-terminal', {state: 'succeeded', canSubmit: stopped,
      activeTaskId: stopped ? undefined : 'active-followup', messages: [{taskId: 'active-followup',
        userText: '继续处理', replyText: stopped ? '已保存的部分结果' : '', state: stopped ? 'cancelled' : 'running'}]});
    if (name === 'subagentConversation.cancel') {
      assert.deepEqual(payload, {taskId: 'active-followup'});
      stopped = true;
      return {taskId: payload.taskId, cancelAccepted: true};
    }
    return snapshot;
  });
  await settle();
  assert.equal(ui.button('停止').disabled, false);
  await ui.button('停止').onclick();
  assert.deepEqual(ui.calls.find(call => call.name === 'subagentConversation.cancel').payload,
    {taskId: 'active-followup'});
  assert.match(ui.sendStatus().textContent, /停止请求已受理/);
  assert.equal(ui.button('停止').disabled, true);
  assert.match(ui.content().textContent, /已保存的部分结果/);
});

test('history displays actual follow-up messages, errors, and missing replies as plain text', async t => {
  const unsafe = '<script>leak()</script>';
  const ui = fixture(t, 'page', () => record('original', {canSubmit: true,
    messages: [{taskId: 'm1', userText: unsafe, replyText: '真实已保存回答', state: 'succeeded'},
      {taskId: 'm2', userText: '第二条', state: 'failed', error: {message: unsafe}},
      {userText: '无任务绑定的消息不得显示'}]}));
  await settle();
  assert.match(ui.content().textContent, /真实已保存回答/);
  assert.match(ui.content().textContent, /回答尚未记录/);
  assert.ok(ui.content().textContent.includes(unsafe));
  assert.ok(!ui.content().textContent.includes('无任务绑定的消息不得显示'));
  assert.ok(ui.walk(ui.root).every(element => element.tag !== 'script'));
  assert.equal(ui.content().children[0].tag, 'details');
  assert.notEqual(ui.content().children[0].open, true);
});

test('a rejected cancellation is shown without claiming the task stopped', async t => {
  const ui = fixture(t, 'page', name => name === 'subagentConversation.cancel'
    ? {taskId: 'active-followup', cancelAccepted: false}
    : record('original', {canSubmit: false, activeTaskId: 'active-followup', messages: []}));
  await settle();
  await ui.button('停止').onclick();
  assert.match(ui.sendStatus().textContent, /未接受停止请求/);
  assert.ok(!ui.sendStatus().textContent.includes('已受理'));
});

test('Enter sends, Shift+Enter keeps a newline, and IME composition never sends', async t => {
  const ui = fixture(t, 'page', name => name === 'subagentConversation.submit'
    ? {acceptedTaskId: 'follow-1'} : record('original', {canSubmit: true, messages: []}));
  await settle();
  ui.input().value = '输入法草稿'; ui.input().oninput();
  let prevented = 0;
  const enter = extra => ui.input().onkeydown({key: 'Enter', preventDefault: () => { prevented++; }, ...extra});
  enter({shiftKey: true});
  enter({isComposing: true});
  enter({keyCode: 229});
  assert.equal(prevented, 0);
  assert.equal(ui.calls.filter(call => call.name === 'subagentConversation.submit').length, 0);
  assert.equal(ui.input().value, '输入法草稿');
  enter({});
  await settle();
  assert.equal(prevented, 1);
  assert.equal(ui.calls.filter(call => call.name === 'subagentConversation.submit').length, 1);
});

test('availability reasons and active-task notices preserve failed-send feedback and drafts', async t => {
  let unavailable = false, active = false;
  const ui = fixture(t, 'page', name => {
    if (name === 'subagentConversation.submit') { unavailable = true; throw Error('发送失败的原始反馈'); }
    return record('original', {canSubmit: !unavailable, messages: [],
      activeTaskId: active ? 'follow-1' : undefined,
      submitUnavailableReason: unavailable ? '当前模型未配置，请先配置模型。' : undefined});
  });
  await settle();
  ui.input().value = '需要保留的草稿'; ui.input().oninput();
  await ui.button('发送').onclick();
  const feedback = ui.sendStatus().textContent;
  assert.match(feedback, /发送失败的原始反馈/);
  assert.match(ui.root.textContent, /当前模型未配置，请先配置模型/);
  assert.equal(ui.button('发送').disabled, true);
  assert.equal(ui.input().value, '需要保留的草稿');
  active = true;
  await ui.refresh();
  assert.equal(ui.sendStatus().textContent, feedback);
  assert.match(ui.root.textContent, /当前任务正在执行或等待结果/);
  assert.equal(ui.input().value, '需要保留的草稿');
});

test('more opens all historical children without payload even when the current cache is empty', async t => {
  const ui = fixture(t);
  ui.update([]);
  assert.equal(ui.section.hidden, false);
  assert.equal(ui.button('更多').attrs['aria-label'], '查看全部子智能体');
  await ui.button('更多').onclick();
  assert.deepEqual(ui.calls, [{name: 'subagentConversations.openAll', payload: undefined}]);
});

test('stop truncates locally: send is usable before the host confirms and survives a stale refresh', async t => {
  const pending = deferred();
  const ui = fixture(t, 'page', name => name === 'subagentConversation.cancel'
    ? pending.promise
    : record('original', {canSubmit: false, activeTaskId: 'active-followup', messages: []}));
  await settle();
  ui.input().value = '停止后要发的新消息'; ui.input().oninput();
  assert.equal(ui.button('发送').disabled, true);
  const stopping = ui.button('停止').onclick();
  assert.equal(ui.button('发送').disabled, false, 'send is released while the stop request is still in flight');
  assert.match(ui.sendStatus().textContent, /可以继续发送新消息/);
  pending.resolve({taskId: 'active-followup', cancelAccepted: true});
  await stopping; await settle();
  assert.equal(ui.button('发送').disabled, false, 'a snapshot still naming the stopped task keeps the composer usable');
});

test('a bare stop message cancels the running follow-up instead of submitting text', async t => {
  const ui = fixture(t, 'page', name => name === 'subagentConversation.cancel'
    ? {taskId: 'active-followup', cancelAccepted: true}
    : record('original', {canSubmit: false, activeTaskId: 'active-followup', messages: []}));
  await settle();
  ui.input().value = '停止'; ui.input().oninput();
  await ui.button('发送').onclick();
  assert.ok(!ui.calls.some(call => call.name === 'subagentConversation.submit'), 'stop is not sent as a message');
  assert.deepEqual(ui.calls.find(call => call.name === 'subagentConversation.cancel').payload, {taskId: 'active-followup'});
});

test('a stop message with nothing running says so without calling the host', async t => {
  const ui = fixture(t, 'page', () => record('original', {canSubmit: true, messages: []}));
  await settle();
  ui.input().value = '停止'; ui.input().oninput();
  await ui.button('发送').onclick();
  assert.ok(!ui.calls.some(call => call.name === 'subagentConversation.submit'));
  assert.match(ui.sendStatus().textContent, /当前没有正在执行的任务/);
});

test('workspace collapse closes every child window in one action', async t => {
  const ui = fixture(t, 'workspace', () => ({closed: 3}));
  ui.update([child('a')]);
  await ui.button('收起').onclick();
  assert.deepEqual(ui.calls.at(-1), {name: 'subagentConversations.collapseAll', payload: undefined});
  assert.match(ui.status().textContent, /已收起 3 个子对话窗口/);
});
