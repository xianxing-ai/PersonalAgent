import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createGoalPlanHost} from '../electron/goal-plan-host.js';
import {mountGoalCloudControls} from '../src/app/goal-cloud-controls.js';

const goal = {id: 'goal-1', revision: 2, state: 'active', summary: '先收集材料；再写出提纲'};

test('decomposition assigns subtasks and a matching child marks one done', () => {
  let children = [];
  const host = createGoalPlanHost({
    listGoals: () => ({goals: [goal]}),
    readChildren: () => children,
  });
  assert.deepEqual(host.snapshot().subtasks, []);
  const plan = host.decompose('goal-1');
  assert.equal(plan.subtasks[0].state, 'assigned');
  assert.equal(plan.subtasks[1].assignee, 'fast');
  children = [{goal: '再写出提纲', state: 'succeeded'}];
  const synced = host.snapshot();
  assert.equal(synced.subtasks[0].state, 'assigned');
  assert.equal(synced.subtasks[1].state, 'done');
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

test('startup publishes the plan on the existing goal snapshot and preload action channel', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /goalPlan = createGoalPlanHost/);
  assert.match(main, /name === 'goal\.decompose'/);
  assert.match(main, /plan:goalPlan\?\.snapshot\(\)/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
});
