import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createCostRouteProduct, estimateModelYuan, routeModel} from '../electron/cost-route.js';
import {renderCostRoute} from '../src/features/workspace/cost-route-status.js';

const catalog = {version: '1.0', revision: 'a'.repeat(64), defaultModelId: 'qwen3.8-flash', models: [
  {id: 'qwen3.8-flash', type: 'text', availability: 'available'},
  {id: 'qwen3.8-max', type: 'text', availability: 'available'},
]};
const hard = `请先分析现状，然后实现修复；并且对比两种方案\n${'步骤'.repeat(80)}`;

test('estimates match the usage-budget tiers and easy work stays on the fast model', () => {
  assert.equal(estimateModelYuan('qwen3.8-flash', 1_000_000), 0.3);
  assert.equal(estimateModelYuan('qwen3.8-max', 1_000_000), 8);
  const easy = routeModel({goal: '你好', catalog});
  assert.equal(easy.executionModel.modelId, 'qwen3.8-flash');
  assert.equal(easy.tier, 'fast');
  const difficult = routeModel({goal: hard, catalog});
  assert.equal(difficult.modelId, 'qwen3.8-max');
  assert.equal(difficult.tier, 'flagship');
});

test('an explicit model is kept until the budget cap downgrades or blocks it', () => {
  const kept = routeModel({goal: '你好', catalog, preference: {modelId: 'qwen3.8-max'}});
  assert.equal(kept.modelId, 'qwen3.8-max');
  const downgraded = routeModel({goal: hard, catalog, budget: {decide({modelId, candidates}) {
    assert.equal(modelId, 'qwen3.8-max');
    return {allowed: true, modelId: candidates.find(id => id.includes('flash'))};
  }}});
  assert.equal(downgraded.modelId, 'qwen3.8-flash');
  const blocked = routeModel({goal: hard, catalog, budget: {decide: () => ({allowed: false, prompt: '已超过用量上限'})}});
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.reason, '已超过用量上限');
});

test('replay requires cloud guard and explicit fee confirmation before calling complete', async () => {
  let calls = 0;
  let updates = 0;
  const product = createCostRouteProduct({
    readCatalog: () => catalog,
    readBudget: () => ({decide: () => ({allowed: false, prompt: '已超过用量上限'})}),
    complete: async () => { calls += 1; return {text: '另一模型'}; },
  });
  product.noteGoal('conversation-1', '你好');
  let openCalls = 0;
  const open = createCostRouteProduct({
    readCatalog: () => catalog,
    onUpdate: () => { updates += 1; },
    assertCloudSend: ({taskId}) => {
      if (taskId === 'task-private') throw Error('原任务包含私人记忆外发授权，回放需在新对话重新确认，已拦截');
    },
    complete: async () => { openCalls += 1; return {text: '另一模型'}; },
  });
  open.noteGoal('conversation-1', '你好');
  open.apply({modelSelection: 'default'}, undefined, 'conversation-1');
  open.noteRun({taskId: 'task-1', conversationId: 'conversation-1', state: 'succeeded', resultSummary: '第一遍'});
  open.noteRun({taskId: 'task-private', conversationId: 'conversation-1', state: 'succeeded', resultSummary: '私人结果'});

  const blockedCloud = await open.handleAction('costRoute.replay', {taskId: 'task-private', modelId: 'qwen3.8-max', confirmed: true});
  assert.equal(blockedCloud.state, 'failed');
  assert.match(blockedCloud.reason, /私人记忆/);
  assert.equal(openCalls, 0);

  const confirm = await open.handleAction('costRoute.replay', {taskId: 'task-1', modelId: 'qwen3.8-max'});
  assert.equal(confirm.state, 'confirm_required');
  assert.equal(openCalls, 0);
  assert.ok(updates >= 2);

  const compared = await open.handleAction('costRoute.replay', {taskId: 'task-1', modelId: 'qwen3.8-max', confirmed: true});
  assert.equal(compared.state, 'compared');
  assert.equal(compared.baseline.modelId, 'qwen3.8-flash');
  assert.equal(compared.candidate.modelId, 'qwen3.8-max');
  assert.equal(compared.same, false);
  assert.equal(openCalls, 1);
  assert.equal(open.snapshot().replay.state, 'compared');

  await open.handleAction('costRoute.cancelReplay');
  assert.equal(open.snapshot().replay, null);

  product.noteGoal('conversation-1', '你好');
  product.noteRun({taskId: 'task-1', conversationId: 'conversation-1', state: 'succeeded', resultSummary: '第一遍'});
  const refused = await product.handleAction('costRoute.replay', {taskId: 'task-1', modelId: 'qwen3.8-max', confirmed: true});
  assert.equal(refused.state, 'blocked');
  assert.equal(calls, 0);
  assert.throws(() => product.apply({}, undefined, 'conversation-1'), /已超过用量上限/);
});

test('the workspace hides raw English modelId and displays replay confirmation, comparison, and failure reason', async () => {
  const original = globalThis.document;
  globalThis.document = {createElement() {
    const node = {textContent: '', type: '', children: []};
    node.append = (...children) => node.children.push(...children);
    node.replaceChildren = () => { node.children = []; };
    return node;
  }};
  try {
    const node = {hidden: true, children: [], dataset: {}, append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; }};
    const calls = [];
    renderCostRoute(node, {
      route: {state: 'selected', tierLabel: '快速', modelId: 'qwen3.8-flash', modelLabel: '轻量快速模型'},
      runs: [{taskId: 'task-1', alternateModelId: 'qwen3.8-max'}],
    }, async (name, payload) => { calls.push({name, payload}); });
    assert.equal(node.hidden, false);
    assert.match(node.children[0].textContent, /快速 · 轻量快速模型/);
    assert.doesNotMatch(node.children[0].textContent, /qwen3\.8/);
    node.children[1].onclick();
    await Promise.resolve();
    assert.deepEqual(calls, [{name: 'costRoute.replay', payload: {taskId: 'task-1', modelId: 'qwen3.8-max'}}]);

    renderCostRoute(node, {
      route: {state: 'selected', tierLabel: '快速', modelLabel: '轻量快速模型'},
      runs: [{taskId: 'task-1', alternateModelId: 'qwen3.8-max'}],
      replay: {state: 'confirm_required', taskId: 'task-1', modelId: 'qwen3.8-max', reason: '确认发送到云端？预计费用 0.01 元'},
    }, async (name, payload) => { calls.push({name, payload}); });
    assert.equal(node.children.map(child => child.textContent).join('\n').includes('qwen3.8'), false);
    assert.equal(node.children[2].textContent, '确认费用并回放');
    node.children[2].onclick();
    await Promise.resolve();
    assert.deepEqual(calls.at(-1), {name: 'costRoute.replay', payload: {taskId: 'task-1', modelId: 'qwen3.8-max', confirmed: true}});

    renderCostRoute(node, {
      route: {state: 'selected', tierLabel: '快速', modelLabel: '轻量快速模型'},
      runs: [{taskId: 'task-1', alternateModelId: 'qwen3.8-max'}],
      replay: {
        state: 'compared',
        same: false,
        baseline: {modelId: 'qwen3.8-flash', label: '轻量快速模型', output: '第一遍答案'},
        candidate: {modelId: 'qwen3.8-max', label: '旗舰强力模型', output: '第二遍答案'},
      },
    }, async () => {});
    const comparedText = node.children.map(child => child.textContent).join('\n');
    assert.match(comparedText, /对比结果：两种方案输出存在差异/);
    assert.match(comparedText, /原方案（轻量快速模型）：第一遍答案/);
    assert.match(comparedText, /对比方案（旗舰强力模型）：第二遍答案/);
    assert.doesNotMatch(comparedText, /qwen3\.8/);

    renderCostRoute(node, {
      route: {state: 'selected', tierLabel: '快速', modelLabel: '轻量快速模型'},
      runs: [{taskId: 'task-1', alternateModelId: 'qwen3.8-max'}],
      replay: {state: 'failed', reason: '原任务包含私人记忆外发授权'},
    }, async () => {});
    assert.match(node.children.map(child => child.textContent).join('\n'), /回放失败：原任务包含私人记忆外发授权/);
  } finally {
    if (original) globalThis.document = original;
    else delete globalThis.document;
  }
});

test('startup wires cloud egress guard, subagent/schedule goal recording, and replay actions through existing preload', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /costRoute=createCostRouteProduct/);
  assert.match(main, /readBudget:\(\)=>costRouteBudget/);
  assert.match(main, /assertCloudSend:\(\{taskId, conversationId\}\)=>\{/);
  assert.match(main, /PRIVATE_MEMORY_CONSUMPTION_CHECKPOINT/);
  assert.match(main, /typeof costRoute !== 'undefined' && costRoute\) costRoute\.noteGoal\(conversationId, goal\)/);
  assert.match(main, /event\.type === 'task\.created'/);
  assert.match(main, /costRoute\.noteGoal\(task\.conversationId, task\.goal\)/);
  assert.match(main, /costRoute\?\.apply\(preference, executionModel, conversationId\)/);
  assert.match(main, /costRoute\.cancelReplay/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
});
