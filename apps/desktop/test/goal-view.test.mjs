import test from 'node:test';
import assert from 'node:assert/strict';
import {appliedGoalRef, createGoalControl} from '../src/features/conversation/goal-view.js';

test('Goal UI requires a confirmed applied task before attempting Goal readback', () => {
  const task = {state: 'succeeded', result: {kind: 'applied', currentGoal: {id: 'goal-1', revision: 2}},
    evidenceRefs: ['evidence-1']};
  assert.deepEqual(appliedGoalRef(task), {id: 'goal-1', revision: 2});
  assert.equal(appliedGoalRef({...task, state: 'waiting_approval'}), null);
  assert.equal(appliedGoalRef({...task, state: 'cancelling'}), null);
  assert.equal(appliedGoalRef({...task, state: 'waiting_reconciliation'}), null);
  assert.equal(appliedGoalRef({...task, evidenceRefs: []}), null);
  assert.equal(appliedGoalRef({...task, result: {...task.result, kind: 'conflict'}}), null);
});

// Explicit Fake DOM/bridge: the actual exported renderer runs without Runtime writes.
class FakeElement {
  constructor(tag) {
    this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {};
    this.value = ''; this.textContent = ''; this.listeners = {};
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
  emit(name) { for (const listener of this.listeners[name] ?? []) listener({}); }
  reset() { for (const node of walk(this)) if (['input', 'textarea', 'select'].includes(node.tag)) node.value = ''; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
}
const walk = element => [element, ...element.children.flatMap(walk)];
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const goal = id => ({id, revision: 1, summary: `Summary ${id}`, reason: `Reason ${id}`,
  sourceRef: `synthetic/source/${id}`, validFrom: '2026-10-07T00:00:00.000Z',
  validUntil: '2026-10-08T00:00:00.000Z', sensitivity: 'private', state: 'active', dependencies: []});
const goals = [goal('synthetic-A'), goal('synthetic-B')];
const applied = (id = 'synthetic-A') => ({taskId: `task-${id}`, revision: 3, state: 'succeeded',
  evidenceRefs: ['synthetic-evidence'], result: {kind: 'applied', graphRevision: 2,
    previousGoal: null, currentGoal: {id, revision: 1}}});
const pending = id => ({taskId: id, revision: 1, state: 'waiting_approval',
  approval: {state: 'pending', approvalId: `approval-${id}`, revision: 1,
    expiresAt: '2099-01-01T00:00:00.000Z'}});

function expiryClock(t) {
  const originalNow = Date.now, originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let now = Date.parse('2026-10-08T00:00:00.000Z'), next = 0;
  const timers = new Map();
  Date.now = () => now;
  globalThis.setTimeout = (callback, delay) => {
    const id = ++next;
    timers.set(id, {callback() {timers.delete(id); callback();}, delay});
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  t.after(() => {Date.now = originalNow; globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;});
  return {timers, now: () => now, advance: amount => {now += amount;}};
}
const documents = new WeakMap();
function fixture(t, handler, tasks = []) {
  if (!documents.has(t)) {
    const original = globalThis.document;
    documents.set(t, original);
    t.after(() => { globalThis.document = original; });
  }
  globalThis.document = {querySelector: () => null, createElement: tag => new FakeElement(tag), head: new FakeElement('head')};
  const calls = [];
  const control = createGoalControl(async (name, payload) => {
    calls.push({name, payload: structuredClone(payload)});
    const custom = handler?.(name, payload);
    if (custom !== undefined) return custom;
    if (name === 'goal.list') return {graphRevision: 2, goals};
    if (name === 'goal.listTasks') return tasks;
    if (name === 'goal.get') return {graphRevision: 2, goal: goals.find(item => item.id === payload)};
    if (name === 'goal.readTask') return tasks.find(item => item.taskId === payload);
    throw Error(`Unexpected Fake bridge call: ${name}`);
  });
  const nodes = () => walk(control.dialog);
  const button = text => nodes().find(node => node.tag === 'button' && node.textContent === text);
  const field = name => nodes().find(node => node.attrs['aria-label'] === name);
  const status = () => nodes().find(node => node.tag === 'p' && node.dataset.state)?.textContent;
  const select = async index => {
    nodes().filter(node => node.tag === 'button' && node.textContent === '修订')[index].onclick();
    await settle();
  };
  const history = async index => {
    nodes().filter(node => node.tag === 'button' && node.textContent.startsWith('查看写入任务'))[index].onclick();
    await settle();
  };
  const submit = () => nodes().find(node => node.tag === 'form').onsubmit({preventDefault() {}});
  return {...control, open: () => control.button.onclick(), calls, button, field, status, select, history, submit};
}

test('summary-only Goal revisions preserve exact UTC validity, including DST overlap, while edited times use local input', async t => {
  const {FakeCoordinationStoreHost} = await import('@personal-agent/goals/store');
  const {createGoal} = await import('@personal-agent/goals/commands');
  const {createGoalHost} = await import('../electron/goal-host.js');
  const previousTZ = process.env.TZ;
  t.after(() => { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; });
  process.env.TZ = 'America/New_York';
  for (const variant of ['sub-minute', 'DST-overlap', 'edited']) {
    const namespace = `synthetic-validity-${variant}`;
    const store = new FakeCoordinationStoreHost().provision(namespace);
    const original = {...goal('synthetic-precision'), sourceRef: 'synthetic/source',
      validFrom: variant === 'sub-minute' ? '2026-01-01T00:00:45.123Z' : '2026-11-01T06:30:45.123Z',
      validUntil: variant === 'sub-minute' ? '2026-01-01T00:00:45.789Z' : '2099-01-01T00:00:45.789Z'};
    delete original.revision;
    createGoal(store, 0, original);
    const host = createGoalHost(namespace);
    let request;
    host.bind({runtime: {provisionCoordinationStore: () => store,
      listTasks: () => ({snapshotSequence: 0, items: []})},
    submitHostToolTask(value) {
      request = value;
      return {commandId: value.commandId, toolName: value.toolName, toolVersion: value.toolVersion,
        task: {taskId: 'synthetic-validity-task', state: 'waiting_approval', revision: 1,
          updatedAt: '2026-10-07T00:00:00.000Z'}};
    }});
    const ui = fixture(t, (name, payload) => {
      if (name === 'goal.list') return host.list();
      if (name === 'goal.listTasks') return host.listTasks();
      if (name === 'goal.get') return host.get(payload);
      if (name === 'goal.revise') return host.revise(payload);
    });
    await ui.open();
    await ui.select(0);
    assert.equal(ui.field('开始时间').step, '0.001');
    assert.equal(ui.field('截止时间').step, '0.001');
    assert.match(ui.field('开始时间').value, /:45\.123$/);
    ui.field('目标内容').value = 'Explicit summary-only edit';
    let expectedFrom = original.validFrom;
    if (variant === 'edited') {
      ui.field('开始时间').value = '2026-11-02T01:30:12.345';
      expectedFrom = new Date(ui.field('开始时间').value).toISOString();
    }
    await ui.submit();
    assert.ok(request, `${variant} must submit a valid revision`);
    assert.equal(request.arguments.expectedGraphRevision, 1);
    assert.equal(request.arguments.expectedGoalRevision, 1);
    assert.equal(request.arguments.goal.validFrom, expectedFrom);
    assert.equal(request.arguments.goal.validUntil, original.validUntil);
    // Actual public Goal tool/store consume the request; Policy/task/DOM/bridge are explicit Fake.
    const outcome = await host.tools.find(tool => tool.descriptor.name === request.toolName)
      .execute(request.arguments, {scopes: ['goals:write']});
    assert.equal(outcome.kind, 'applied');
    const committed = host.get(original.id);
    assert.equal(committed.graphRevision, 2);
    assert.equal(committed.goal.revision, 2);
    assert.equal(committed.goal.summary, 'Explicit summary-only edit');
    assert.equal(committed.goal.validFrom, expectedFrom);
    assert.equal(committed.goal.validUntil, original.validUntil);
  }
});

test('verified history after a lost submit reply distinguishes its confirmation from the still unknown submission', async t => {
  let tasks = [];
  const ui = fixture(t, (name, payload) => {
    if (name === 'goal.revise') throw Error('explicit Fake IPC lost acceptance reply');
    if (name === 'goal.listTasks') return tasks;
    if (name === 'goal.readTask') return tasks.find(task => task.taskId === payload);
  });
  await ui.open();
  await ui.select(0);
  await ui.submit();
  tasks = [applied()];
  ui.button('关闭').onclick();
  await ui.open();
  await ui.history(0);
  assert.match(ui.status(), /所选历史任务的目标已确认并读回/);
  assert.match(ui.status(), /先前提交结果仍待核实/);
  assert.match(ui.status(), /请勿重复提交/);
  assert.equal(ui.button('保存修订').disabled, true);
  ui.button('新建目标').onclick();
  assert.equal(ui.button('保存目标').disabled, true);
  await ui.submit();
  assert.equal(ui.calls.filter(call => ['goal.create', 'goal.revise'].includes(call.name)).length, 1);
});

test('late applied Task A readback cannot mix its identity with selected Goal B', async t => {
  const read = deferred();
  const ui = fixture(t, (name, id) => {
    if (name === 'goal.get' && id === goals[0].id) return read.promise;
    if (name === 'goal.revise') return pending('accepted-B');
  }, [applied()]);
  await ui.open();
  await ui.history(0);
  await ui.select(1);
  read.resolve({graphRevision: 2, goal: goals[0]});
  await settle();
  assert.equal(ui.field('目标 ID').value, goals[1].id);
  assert.equal(ui.field('目标内容').value, goals[1].summary);
  await ui.submit();
  const request = ui.calls.find(call => call.name === 'goal.revise').payload;
  assert.equal(request.goal.id, goals[1].id);
  assert.equal(request.goal.summary, goals[1].summary);
  assert.equal(request.expectedGoalRevision, 1);
  assert.equal(request.expectedGraphRevision, 2);
});

test('out-of-order Goal selection cannot replace the newer draft or allow submission during its read', async t => {
  const read = deferred();
  const ui = fixture(t, (name, id) => name === 'goal.get' && id === goals[0].id ? read.promise : undefined);
  await ui.open();
  void ui.select(0);
  await ui.submit();
  assert.equal(ui.calls.some(call => ['goal.create', 'goal.revise'].includes(call.name)), false);
  await ui.select(1);
  read.resolve({graphRevision: 2, goal: goals[0]});
  await settle();
  assert.equal(ui.field('目标 ID').value, goals[1].id);
  assert.equal(ui.field('目标内容').value, goals[1].summary);
});

test('closed and reopened drafts reject late applied readback success and failure', async t => {
  for (const fail of [false, true]) {
    const read = deferred();
    const ui = fixture(t, (name, id) => name === 'goal.get' && id === goals[0].id ? read.promise : undefined, [applied()]);
    await ui.open();
    await ui.history(0);
    ui.button('关闭').onclick();
    await ui.open();
    ui.button('新建目标').onclick();
    await ui.select(1);
    const before = ui.status();
    if (fail) read.reject(Error('synthetic old read failure'));
    else read.resolve({graphRevision: 2, goal: goals[0]});
    await settle();
    assert.equal(ui.field('目标 ID').value, goals[1].id);
    assert.equal(ui.status(), before);
    assert.equal(ui.button('保存修订').disabled, false);
  }
});

test('editing the current draft cancels a pending selection without leaving Save locked', async t => {
  const read = deferred();
  const ui = fixture(t, (name, id) => {
    if (name === 'goal.get' && id === goals[0].id) return read.promise;
    if (name === 'goal.revise') return pending('accepted-B');
  });
  await ui.open();
  await ui.select(1);
  void ui.select(0);
  ui.field('目标内容').value = 'User edited B while A read was pending';
  walk(ui.dialog).find(node => node.tag === 'form').emit('input');
  assert.equal(ui.button('保存修订').disabled, false);
  read.resolve({graphRevision: 2, goal: goals[0]});
  await settle();
  await ui.submit();
  const request = ui.calls.find(call => call.name === 'goal.revise').payload;
  assert.equal(request.goal.id, goals[1].id);
  assert.equal(request.goal.summary, 'User edited B while A read was pending');
});

test('reopening cancels an abandoned Goal selection while preserving the prior usable draft', async t => {
  const read = deferred();
  const ui = fixture(t, (name, id) => name === 'goal.get' && id === goals[0].id ? read.promise : undefined);
  await ui.open();
  await ui.select(1);
  void ui.select(0);
  ui.button('关闭').onclick();
  await ui.open();
  assert.equal(ui.button('保存修订').disabled, false);
  read.resolve({graphRevision: 2, goal: goals[0]});
  await settle();
  assert.equal(ui.field('目标 ID').value, goals[1].id);
  assert.equal(ui.field('目标内容').value, goals[1].summary);
});

test('late cancel and approval success or failure cannot replace a newer task selection', async t => {
  for (const action of ['取消目标任务', '批准一次']) {
    for (const fail of [false, true]) {
      const reply = deferred();
      const tasks = [pending('pending-A'), pending('pending-B')];
      const ui = fixture(t, name => {
        if (name === 'goal.cancel' || name === 'authorization.respond') return reply.promise;
      }, tasks);
      await ui.open();
      ui.button(action).onclick();
      await ui.history(1);
      const before = ui.status();
      if (fail) reply.reject(Error('synthetic old task feedback failure'));
      else reply.resolve(action === '取消目标任务' ? {task: {...tasks[0], state: 'cancelling'}, cancelAccepted: true} : {});
      await settle();
      assert.equal(ui.status(), before);
      ui.button('刷新任务状态').onclick();
      await settle();
      assert.equal(ui.calls.filter(call => call.name === 'goal.readTask').at(-1).payload, 'pending-B');
      assert.equal(ui.calls.filter(call => call.name === 'goal.readTask').some(call => call.payload === 'pending-A'), false);
    }
  }
});

test('accepted write after reopen keeps the real task and prevents duplicate submission without replacing the draft', async t => {
  const reply = deferred();
  const accepted = pending('accepted-A');
  const ui = fixture(t, (name, id) => {
    if (name === 'goal.revise') return reply.promise;
    if (name === 'goal.readTask' && id === accepted.taskId) return accepted;
  });
  await ui.open();
  await ui.select(0);
  const submit = ui.submit();
  ui.button('关闭').onclick();
  await ui.open();
  await ui.select(1);
  const before = ui.status();
  reply.resolve(accepted);
  await submit;
  assert.equal(ui.field('目标 ID').value, goals[1].id);
  assert.equal(ui.status(), before);
  assert.equal(ui.button('保存修订').disabled, true);
  await ui.submit();
  assert.equal(ui.calls.filter(call => call.name === 'goal.revise').length, 1);
  ui.button('查看已受理目标任务：等待授权 · 目标写入 accepted-A').onclick();
  await settle();
  assert.equal(ui.calls.filter(call => call.name === 'goal.readTask').at(-1).payload, accepted.taskId);
  ui.button('关闭').onclick();
  await ui.open();
  assert.equal(ui.button('保存修订').disabled, true);
  ui.button('刷新任务状态').onclick();
  await settle();
  assert.equal(ui.calls.filter(call => call.name === 'goal.readTask').at(-1).payload, accepted.taskId);
});

test('unknown acceptance remains locked across reopening and restores the actual pending task', async t => {
  const restored = pending('restored');
  let submitted = false;
  const ui = fixture(t, name => {
    if (name === 'goal.revise') { submitted = true; return Promise.reject(Error('synthetic unknown transport')); }
    if (name === 'goal.listTasks') return submitted ? [restored] : [];
  });
  await ui.open();
  await ui.select(0);
  await ui.submit();
  ui.button('关闭').onclick();
  await ui.open();
  assert.equal(ui.button('保存修订').disabled, true);
  await ui.submit();
  assert.equal(ui.calls.filter(call => call.name === 'goal.revise').length, 1);
  ui.button('刷新任务状态').onclick();
  await settle();
  assert.equal(ui.calls.filter(call => call.name === 'goal.readTask').at(-1).payload, restored.taskId);
});

test('refreshing the same task preserves in-flight cancel and approval locks, and older replies do not unlock another task', async t => {
  for (const action of ['取消目标任务', '批准一次']) {
    const replies = [deferred(), deferred()];
    let requested = 0;
    const tasks = [pending('pending-A'), pending('pending-B')];
    const ui = fixture(t, name => {
      if (name === 'goal.cancel' || name === 'authorization.respond') return replies[requested++].promise;
    }, tasks);
    await ui.open();
    ui.button(action).onclick();
    ui.button('刷新任务状态').onclick();
    await settle();
    assert.equal(ui.button(action).disabled, true);
    ui.button(action).onclick();
    assert.equal(requested, 1);
    await ui.history(1);
    assert.equal(ui.button(action).disabled, false);
    ui.button(action).onclick();
    replies[0].resolve(action === '取消目标任务' ? {task: tasks[0], cancelAccepted: true} : {});
    await settle();
    assert.equal(ui.button(action).disabled, true);
    assert.equal(requested, 2);
    replies[1].resolve(action === '取消目标任务' ? {task: tasks[1], cancelAccepted: true} : {});
    await settle();
    assert.equal(ui.button(action).disabled, false);
  }
});

test('normal confirmed save reads the full exact Goal revision and can revise it again', async t => {
  const saved = {...goals[1], revision: 2, summary: 'Confirmed B', reason: 'Confirmed reason',
    dependencies: [{id: 'synthetic-fact', revision: 3}]};
  let written = false;
  const task = {...applied(goals[1].id), result: {kind: 'applied', graphRevision: 3,
    previousGoal: {id: saved.id, revision: 1}, currentGoal: {id: saved.id, revision: 2}}};
  const ui = fixture(t, (name, id) => {
    if (name === 'goal.revise') { written = true; return task; }
    if (name === 'goal.get' && written && id === saved.id) return {graphRevision: 3, goal: saved};
    if (name === 'goal.list' && written) return {graphRevision: 3, goals: [goals[0], saved]};
  });
  await ui.open();
  await ui.select(1);
  await ui.submit();
  assert.match(ui.status(), /已确认并读回/);
  assert.equal(ui.field('目标内容').value, saved.summary);
  assert.equal(ui.field('创建或修订原因').value, saved.reason);
  assert.equal(ui.button('保存修订').disabled, false);
  await ui.submit();
  const next = ui.calls.filter(call => call.name === 'goal.revise').at(-1).payload;
  assert.equal(next.expectedGraphRevision, 3);
  assert.equal(next.expectedGoalRevision, 2);
  assert.deepEqual(next.goal.dependencies, saved.dependencies);
});

test('expired, missing or invalid Goal approval deadlines hide decisions without unlocking accepted writes', async t => {
  for (const expiresAt of ['2000-01-01T00:00:00.000Z', undefined, 'invalid', 0]) {
    const task = pending('expired');
    if (expiresAt === undefined) delete task.approval.expiresAt;
    else task.approval.expiresAt = expiresAt;
    const ui = fixture(t, undefined, [task]); await ui.open();
    assert.equal(ui.button('批准一次').hidden, true, String(expiresAt));
    assert.equal(ui.button('拒绝').hidden, true);
    assert.equal(ui.button('批准一次').disabled, true);
    assert.equal(ui.button('保存目标').disabled, true);
    assert.equal(ui.button('取消目标任务').hidden, false);
    assert.equal(ui.button('刷新任务状态').disabled, false);
    assert.match(ui.status(), expiresAt === '2000-01-01T00:00:00.000Z' ? /过期/ : /期限无法核实/);
    ui.button('批准一次').onclick(); ui.button('拒绝').onclick(); await settle();
    assert.equal(ui.calls.some(call => call.name === 'authorization.respond'), false);
    ui.button('关闭').onclick();
  }
});

test('a visible Goal approval expires while open and a delayed callback cannot bypass the click deadline guard', async t => {
  const clock = expiryClock(t), task = pending('future');
  task.approval.expiresAt = new Date(clock.now() + 100).toISOString();
  const ui = fixture(t, undefined, [task]); await ui.open();
  assert.equal(ui.button('批准一次').hidden, false);
  assert.equal(ui.button('批准一次').disabled, false);
  assert.equal(clock.timers.size, 1);
  const callback = [...clock.timers.values()][0].callback;
  clock.advance(100);
  ui.button('批准一次').onclick(); await settle();
  assert.equal(ui.calls.some(call => call.name === 'authorization.respond'), false);
  assert.equal(ui.button('批准一次').hidden, true);
  callback();
  assert.match(ui.status(), /过期/);
  assert.equal(ui.button('保存目标').disabled, true);
  ui.button('关闭').onclick(); assert.equal(clock.timers.size, 0);
});

test('Goal expiry callbacks cannot replace newer draft feedback or another approval revision and close clears them', async t => {
  const clock = expiryClock(t), tasks = [pending('same')];
  tasks[0].approval.expiresAt = new Date(clock.now() + 100).toISOString();
  const ui = fixture(t, undefined, tasks); await ui.open();
  const old = [...clock.timers.values()][0].callback;
  ui.button('新建目标').onclick(); const drafting = ui.status();
  clock.advance(100); old();
  assert.equal(ui.status(), drafting);
  assert.equal(ui.button('批准一次').hidden, true);
  tasks[0] = {...tasks[0], approval: {...tasks[0].approval, revision: 2,
    expiresAt: new Date(clock.now() + 100).toISOString()}};
  ui.button('刷新任务状态').onclick(); await settle();
  const newer = ui.status(); old();
  assert.equal(ui.status(), newer);
  assert.equal(ui.button('批准一次').hidden, false);
  const callback = [...clock.timers.values()][0].callback;
  ui.button('关闭').onclick(); assert.equal(clock.timers.size, 0);
  clock.advance(100); callback();
  assert.equal(ui.status(), newer);
  assert.equal(ui.calls.some(call => call.name === 'authorization.respond'), false);
});
