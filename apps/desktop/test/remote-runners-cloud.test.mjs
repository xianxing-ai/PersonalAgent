import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRemoteRunners} from '../src/features/conversation/remote-runners.js';

function fixture(t, handler) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document;});
  class Element {
    constructor(tag) {this.tag = tag; this.children = []; this.value = ''; this.disabled = false; this.attrs = {};}
    set textContent(value) {this.text = String(value); this.children = [];}
    get textContent() {return (this.text ?? '') + this.children.map(child => child.textContent).join('');}
    set innerHTML(_) {throw Error('HTML interpolation is forbidden');}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children = children;}
    setAttribute(key, value) {this.attrs[key] = String(value);}
  }
  globalThis.document = {createElement: tag => new Element(tag)};
  const root = new Element('main'), calls = [];
  const ui = mountRemoteRunners(root, async (name, payload) => {calls.push({name, payload}); return handler(name, payload);});
  const all = (node = root) => [node, ...node.children.flatMap(child => all(child))];
  return {ui, root, calls, all, button: name => all().find(node => node.tag === 'button' && node.textContent === name),
    field: label => all().find(node => node.attrs['aria-label'] === label)};
}
const host = {id: 'cloud-host', name: 'cloud', user: 'runner', address: 'cloud.example', port: 22, enabled: true};
const source = {taskId: 'source-task', goal: '<原始目标>'};
const approval = {approvalId: 'approval-1', revision: 3, action: 'calendar.create', arguments: {title: '<待确认>', calendarId: 'work'},
  argumentsDigest: 'sha256:original-arguments', expiresAt: '2099-01-01T00:00:00Z', state: 'pending'};
const session = () => ({sourceTaskId: source.taskId, commandId: 'original-submit', transportState: 'confirmed', lastReply: {
  target: {taskId: 'cloud-task', sessionId: 'cloud-session'}, owner: {hostId: host.id}, controlRevision: 8,
  task: {state: 'waiting_approval', revision: 4, cancelRequested: false}, approvals: [structuredClone(approval)]}});
const snapshot = (sessions = []) => ({state: 'configured_not_verified', hostId: host.id, sourceTasks: [source], sessions});

test('cloud card uses selected original goal and an explicit deadline, only on its enabled host', async t => {
  let state = snapshot();
  const ui = fixture(t, (name) => name === 'runner.hosts.list' ? {hosts: [host, {...host, id: 'other'}]} :
    name === 'proactive.workflow.cloud.status' ? state : {state: 'unknown'});
  await ui.ui.refresh();
  assert.equal(ui.all().filter(node => node.attrs['aria-label'] === '云持续会话').length, 1);
  assert.match(ui.root.textContent, /不迁移已有会话/);
  assert.equal(ui.field('原任务目标').children[0].textContent, source.goal);
  assert.equal(ui.calls.some(call => call.name.endsWith('.start')), false);
  ui.field('云会话期限（分钟）').value = '0';
  await ui.button('新建云持续会话').onclick();
  assert.equal(ui.calls.some(call => call.name.endsWith('.start')), false);
  ui.field('云会话期限（分钟）').value = '15';
  const before = Date.now();
  await ui.button('新建云持续会话').onclick();
  const submitted = ui.calls.find(call => call.name.endsWith('.start')).payload;
  assert.deepEqual(Object.keys(submitted).sort(), ['commandId', 'sourceTaskId', 'taskDeadline']);
  assert.equal(submitted.sourceTaskId, source.taskId);
  assert.match(submitted.commandId, /^[a-f0-9-]{36}$/);
  assert.ok(Date.parse(submitted.taskDeadline) >= before + 15 * 60_000);
  assert.equal(ui.button('新建云持续会话').disabled, true);
  state = {...snapshot(), sourceTasks: []};
  await ui.ui.refresh();
  assert.match(ui.root.textContent, /没有可用的原用户任务/);
  assert.equal(ui.button('新建云持续会话'), undefined);
  state = {...snapshot(), hostId: 'unmatched-host'};
  await ui.ui.refresh();
  assert.equal(ui.field('云持续会话'), undefined);
  assert.match(ui.root.textContent, /尚未配置可用宿主/);
});

test('lost submission reply only permits original readback and never resubmits', async t => {
  let state = snapshot(), submitted;
  const ui = fixture(t, (name, payload) => {
    if (name === 'runner.hosts.list') return {hosts: [host]};
    if (name.endsWith('.status')) return state;
    if (name.endsWith('.start')) {submitted = payload; throw Error('synthetic lost reply');}
    if (name.endsWith('.read')) {
      state = snapshot([{...session(), commandId: submitted.commandId}]);
      return {state: 'confirmed'};
    }
    throw Error('Unexpected operation');
  });
  await ui.ui.refresh();
  await ui.button('新建云持续会话').onclick();
  assert.match(ui.root.textContent, /unknown/);
  await ui.button('新建云持续会话').onclick();
  assert.equal(ui.calls.filter(call => call.name.endsWith('.start')).length, 1);
  assert.equal(ui.button('暂停'), undefined);
  await ui.button('读回原会话').onclick();
  const read = ui.calls.find(call => call.name.endsWith('.read')).payload;
  assert.equal(read.originCommandId, submitted.commandId);
  assert.equal(read.sourceTaskId, submitted.sourceTaskId);
  assert.notEqual(read.commandId, submitted.commandId);
  assert.equal('target' in read, false);
  assert.equal(ui.button('暂停').disabled, false);
});

test('controls and manual approvals bind the readback target and revisions with complete safe parameters', async t => {
  const current = session();
  const ui = fixture(t, name => name === 'runner.hosts.list' ? {hosts: [host]} : name.endsWith('.status') ? snapshot([current]) : {state: 'confirmed'});
  await ui.ui.refresh();
  assert.equal(ui.calls.some(call => call.name.endsWith('.approval')), false);
  assert.equal(ui.all().find(node => node.tag === 'pre').textContent, JSON.stringify(approval.arguments, null, 2));
  assert.match(ui.root.textContent, /sha256:original-arguments/);
  await ui.button('暂停').onclick();
  const control = ui.calls.find(call => call.name.endsWith('.control')).payload;
  assert.deepEqual(control.target, current.lastReply.target);
  assert.deepEqual(control.control, {action: 'pause', expectedControlRevision: 8});
  assert.equal(control.originCommandId, current.commandId);
  for (const [label, decision] of [['允许一次', 'allow_once'], ['拒绝', 'deny']]) {
    await ui.button(label).onclick();
    const sent = ui.calls.filter(call => call.name.endsWith('.approval')).at(-1).payload;
    assert.deepEqual(sent.target, current.lastReply.target);
    assert.equal(sent.originCommandId, current.commandId);
    assert.deepEqual(sent.approval, {approvalId: approval.approvalId, expectedRevision: approval.revision,
      argumentsDigest: approval.argumentsDigest, expiresAt: approval.expiresAt, decision});
  }
  const ids = ui.calls.filter(call => /\.(control|approval)$/.test(call.name)).map(call => call.payload.commandId);
  assert.equal(new Set(ids).size, ids.length);
  current.transportState = 'unknown';
  await ui.ui.refresh();
  assert.equal(ui.button('暂停'), undefined);
  assert.equal(ui.button('允许一次').disabled, true);
  current.transportState = 'confirmed';
  delete current.lastReply.approvals[0].arguments;
  await ui.ui.refresh();
  assert.equal(ui.button('允许一次').disabled, true);
  assert.match(ui.root.textContent, /审批参数未读回/);
  current.lastReply.approvals[0].arguments = {};
  current.lastReply.approvals[0].expiresAt = '2000-01-01T00:00:00Z';
  await ui.ui.refresh();
  assert.equal(ui.button('允许一次').disabled, true);
});

test('pending operations prevent double dispatch and an unavailable status removes cloud controls', async t => {
  let finish, unavailable = false;
  const ui = fixture(t, name => {
    if (name === 'runner.hosts.list') return {hosts: [host]};
    if (name.endsWith('.status')) {if (unavailable) throw Error('unavailable'); return snapshot([session()]);}
    if (name.endsWith('.control')) return new Promise(resolve => {finish = resolve;});
    throw Error('Unexpected operation');
  });
  await ui.ui.refresh();
  const button = ui.button('暂停'), pending = button.onclick();
  await button.onclick();
  assert.equal(ui.calls.filter(call => call.name.endsWith('.control')).length, 1);
  finish({state: 'unknown'});
  await pending;
  assert.equal(ui.button('暂停'), undefined);
  assert.equal(ui.button('新建云持续会话').disabled, true);
  unavailable = true;
  await ui.ui.refresh();
  assert.equal(ui.field('云持续会话'), undefined);
  assert.match(ui.root.textContent, /云持续会话不可用/);
});
