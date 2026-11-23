import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGoalPlanHost} from '../electron/goal-plan-host.js';
import {mountGoalCloudControls} from '../src/app/goal-cloud-controls.js';

const goal = {id: 'goal-1', revision: 2, state: 'active', summary: '先收集材料；再写出提纲'};

test('plans persist across restarts and match children strictly by taskId/subtaskId rather than 40-char text matching', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pa-goal-plan-'));
  let children = [];
  const host = createGoalPlanHost({
    userData: dir,
    listGoals: () => ({goals: [goal]}),
    readChildren: () => children,
  });
  assert.deepEqual(host.snapshot().subtasks, []);
  const plan = host.decompose('goal-1');
  assert.equal(plan.subtasks[0].id, 'step-1');
  assert.equal(plan.subtasks[0].state, 'assigned');
  assert.equal(plan.subtasks[1].id, 'step-2');
  assert.equal(plan.subtasks[1].assignee, 'fast');
  assert.deepEqual(readdirSync(dir), ['goal-plans.json']);

  // A child whose goal happens to contain the step text WITHOUT matching taskId/subtaskId must NOT match.
  children = [{taskId: 'unrelated-task', goal: '再写出提纲', state: 'succeeded'}];
  const unmatched = host.snapshot();
  assert.equal(unmatched.subtasks[1].state, 'assigned');

  // Matching by subtaskId ('step-2') marks step-2 done and persists across reload.
  children = [{taskId: 'child-task-2', subtaskId: 'step-2', goal: '完全不同的标题', state: 'succeeded'}];
  const synced = host.snapshot();
  assert.equal(synced.subtasks[0].state, 'assigned');
  assert.equal(synced.subtasks[1].state, 'done');
  assert.equal(synced.subtasks[1].taskId, 'child-task-2');

  // Explicitly bind step-1 to child-task-1, then reload a fresh host instance from userData.
  host.bindChild({goalId: 'goal-1', stepId: 'step-1', taskId: 'child-task-1'});
  children = [
    {taskId: 'child-task-1', goal: '无文本重合的子任务', state: 'running'},
    {taskId: 'child-task-2', subtaskId: 'step-2', goal: '完全不同的标题', state: 'succeeded'},
  ];
  const reloaded = createGoalPlanHost({
    userData: dir,
    listGoals: () => ({goals: [goal]}),
    readChildren: () => children,
  });
  const afterReload = reloaded.snapshot();
  assert.equal(afterReload.goalId, 'goal-1');
  assert.equal(afterReload.subtasks[0].taskId, 'child-task-1');
  assert.equal(afterReload.subtasks[0].state, 'running');
  assert.equal(afterReload.subtasks[1].state, 'done');
});

test('the existing goal section splits the current goal through invoke', async () => {
  const fields = Object.fromEntries(['open', 'disable', 'status', 'plan', 'decompose'].map(key => [key, {
    disabled: false, hidden: false, textContent: '', attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); },
  }]));
  const section = {setAttribute() {}, querySelector(selector) { const match = /data-goal-cloud="([^"]+)"/.exec(selector); return match ? fields[match[1]] : undefined; }};
  const original = globalThis.document;
  globalThis.document = {createElement: () => section};
  const calls = [];
  try {
    const controls = mountGoalCloudControls({append() {}}, async (name, payload) => {
      calls.push({name, payload});
      return {subtasks: [{summary: '先收集材料', assignee: 'plan', state: 'assigned'}, {summary: '再写出提纲', assignee: 'fast', state: 'assigned'}]};
    });
    controls.render({available: true, sessionAllowed: false, reason: '本会话目标云访问未开启', plan: {goalId: 'goal-1', revision: 2, subtasks: []}});
    assert.equal(fields.decompose.hidden, false);
    await fields.decompose.onclick();
    assert.deepEqual(calls, [{name: 'goal.decompose', payload: {goalId: 'goal-1'}}]);
    assert.match(fields.plan.textContent, /先收集材料 · 主计划 · 已分派/);
    assert.equal(fields.decompose.hidden, true);
  } finally {
    if (original) globalThis.document = original;
    else delete globalThis.document;
  }
});

test('startup persists plans in userData, binds children by ID, and publishes on the existing goal snapshot', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /goalPlan = createGoalPlanHost\(\{[\s\S]*?userData:\s*app\.getPath\('userData'\)/);
  assert.match(main, /subtaskId:\s*binding\.subtaskId/);
  assert.match(main, /name === 'goal\.decompose'/);
  assert.match(main, /name === 'goal\.plan\.bind'/);
  assert.match(main, /plan:goalPlan\?\.snapshot\(\)/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
});
