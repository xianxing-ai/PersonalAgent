import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalControl} from '../src/features/conversation/goal-view.js';

// Actual exported consumer; DOM and bridge are explicit Fake, without Runtime writes.
class Element {
  constructor(tag) { Object.assign(this, {tag, children: [], dataset: {}, attrs: {}, listeners: {}, textContent: '', value: ''}); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(key, listener) { (this.listeners[key] ??= []).push(listener); }
  showModal() { this.open = true; }
  close() { this.open = false; for (const listener of this.listeners.close ?? []) listener({}); }
  reset() {}
}
const walk = node => [node, ...node.children.flatMap(walk)];
const settle = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, tasks, handler) {
  const original = globalThis.document;
  globalThis.document = {querySelector: () => null, createElement: tag => new Element(tag), head: new Element('head')};
  t.after(() => { globalThis.document = original; });
  const calls = [];
  const ui = createGoalControl(async (name, payload) => {
    calls.push({name, payload});
    const custom = handler?.(name, payload);
    if (custom !== undefined) return custom;
    if (name === 'goal.list') return {graphRevision: 1, goals: []};
    if (name === 'goal.listTasks') return tasks;
    if (name === 'goal.readTask') return tasks.find(task => task.taskId === payload);
    throw Error(`Unexpected Fake bridge call ${name}`);
  });
  await ui.button.onclick();
  const nodes = () => walk(ui.dialog);
  const history = () => nodes().filter(node => node.tag === 'button' && node.textContent.startsWith('查看写入任务'));
  const status = () => nodes().find(node => node.tag === 'p' && node.attrs['aria-live'] && !node.dataset.state);
  return {ui, calls, nodes, history, status};
}
const task = (taskId, operation) => ({taskId, operation, revision: 4, state: 'waiting_reconciliation'});

test('Goal history and active status distinguish create/revise tasks with full accessible identity', async t => {
  const tasks = [task('11111111-aaaa-bbbb-cccc-000000000001', 'goals.create'), task('22222222-aaaa-bbbb-cccc-000000000002', 'goals.revise')];
  const f = await fixture(t, tasks);
  for (const [index, kind] of ['创建目标', '修改目标'].entries()) {
    const button = f.history()[index];
    assert.match(button.textContent, new RegExp(kind));
    assert.ok(button.textContent.includes(index ? '22222222…000002' : '11111111…000001'));
    assert.equal(button.title, `任务 ID：${tasks[index].taskId}`);
    assert.ok(button.attrs['aria-label'].includes(tasks[index].taskId));
    button.onclick(); await settle();
    assert.match(f.status().textContent, /执行异常 · 任务版本 4/);
    assert.ok(f.status().textContent.includes(kind));
    assert.ok(f.status().attrs['aria-label'].includes(tasks[index].taskId));
  }
  assert.deepEqual(f.calls.map(call => call.name), ['goal.list', 'goal.listTasks', 'goal.readTask', 'goal.readTask']);
});

test('Goal identity uses generic write wording for unknown operation and text-only hostile IDs', async t => {
  const id = '<img src=x onerror=alert(1)>', f = await fixture(t, [task(id)]);
  assert.match(f.history()[0].textContent, /目标写入/);
  assert.doesNotMatch(f.history()[0].textContent, /创建目标|修改目标/);
  assert.equal(f.history()[0].title, `任务 ID：${id}`);
  assert.equal(f.history()[0].children.length, 0);
  f.history()[0].onclick(); await settle();
  assert.ok(f.status().attrs['aria-label'].includes(id));
  assert.equal(f.status().children.length, 0);
});

test('Goal abbreviated identity collisions show distinct complete IDs', async t => {
  const ids = ['12345678-aaaa-bbbb-cccc-000000abcdef', '12345678-dddd-eeee-ffff-000000abcdef'];
  const f = await fixture(t, ids.map(id => task(id, 'goals.create')));
  assert.notEqual(f.history()[0].textContent, f.history()[1].textContent);
  for (const [index, id] of ids.entries()) assert.ok(f.history()[index].textContent.includes(id));
});

test('Goal history refresh failure replaces the previous accessible task label with the actual error', async t => {
  let fail = false;
  const f = await fixture(t, [task('fake-task-A', 'goals.create')], name => {
    if (name === 'goal.listTasks' && fail) throw Error('Explicit Fake read failure');
  });
  assert.ok(f.status().attrs['aria-label'].includes('fake-task-A'));
  f.ui.dialog.close(); fail = true; await f.ui.button.onclick();
  assert.match(f.status().textContent, /Explicit Fake read failure/);
  assert.equal(f.status().attrs['aria-label'], f.status().textContent);
  assert.equal(f.status().title, '');
});

test('late task A readback cannot replace selected task B identity or cancel target', async t => {
  const tasks = [task('fake-task-A', 'goals.create'), task('fake-task-B', 'goals.revise')];
  let resolveA;
  const f = await fixture(t, tasks, (name, payload) => {
    if (name === 'goal.readTask' && payload === 'fake-task-A') return new Promise(resolve => { resolveA = resolve; });
    if (name === 'goal.cancel') return {task: {...tasks[1], state: 'cancelled'}};
  });
  f.history()[0].onclick(); await settle();
  f.history()[1].onclick(); await settle();
  resolveA(tasks[0]); await settle();
  assert.ok(f.status().textContent.includes('修改目标 fake-task-B'));
  f.nodes().find(node => node.textContent === '取消目标任务').onclick(); await settle();
  assert.equal(f.calls.find(call => call.name === 'goal.cancel').payload, 'fake-task-B');
  assert.ok(f.status().attrs['aria-label'].includes('fake-task-B'));
  assert.equal(f.calls.some(call => ['goal.create', 'goal.revise', 'authorization.respond'].includes(call.name)), false);
});
