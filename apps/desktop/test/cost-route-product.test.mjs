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

test('replay uses another catalog model and does not call it after the budget cap refuses', async () => {
  let calls = 0;
  const product = createCostRouteProduct({
    readCatalog: () => catalog,
    readBudget: () => ({decide: () => ({allowed: false, prompt: '已超过用量上限'})}),
    complete: async () => { calls += 1; return {text: '另一模型'}; },
  });
  product.noteGoal('conversation-1', '你好');
  const open = createCostRouteProduct({readCatalog: () => catalog, complete: async () => ({text: '另一模型'})});
  open.noteGoal('conversation-1', '你好');
  open.apply({modelSelection: 'default'}, undefined, 'conversation-1');
  open.noteRun({taskId: 'task-1', conversationId: 'conversation-1', state: 'succeeded', resultSummary: '第一遍'});
  const compared = await open.handleAction('costRoute.replay', {taskId: 'task-1', modelId: 'qwen3.8-max'});
  assert.equal(compared.state, 'compared');
  assert.equal(compared.baseline.modelId, 'qwen3.8-flash');
  assert.equal(compared.candidate.modelId, 'qwen3.8-max');
  assert.equal(compared.same, false);
  product.noteGoal('conversation-1', '你好');
  product.noteRun({taskId: 'task-1', conversationId: 'conversation-1', state: 'succeeded', resultSummary: '第一遍'});
  const refused = await product.handleAction('costRoute.replay', {taskId: 'task-1', modelId: 'qwen3.8-max'});
  assert.equal(refused.state, 'blocked');
  assert.equal(calls, 0);
  assert.throws(() => product.apply({}, undefined, 'conversation-1'), /已超过用量上限/);
});

test('the workspace shows the selected tier and replays only when an alternate model exists', () => {
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
    renderCostRoute(node, {route: {state: 'selected', tierLabel: '快速', modelId: 'qwen3.8-flash'}, runs: [{taskId: 'task-1', alternateModelId: 'qwen3.8-max'}]}, (name, payload) => calls.push({name, payload}));
    assert.equal(node.hidden, false);
    assert.match(node.children[0].textContent, /快速 · qwen3.8-flash/);
    node.children[1].onclick();
    assert.deepEqual(calls, [{name: 'costRoute.replay', payload: {taskId: 'task-1', modelId: 'qwen3.8-max'}}]);
  } finally {
    if (original) globalThis.document = original;
    else delete globalThis.document;
  }
});

test('startup records the goal before submit and reads the route through the existing preload', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /costRoute=createCostRouteProduct/);
  assert.match(main, /readBudget:\(\)=>costRouteBudget/);
  assert.match(main, /typeof costRoute !== 'undefined' && costRoute\) costRoute\.noteGoal\(conversationId, goal\)/);
  assert.match(main, /costRoute\?\.apply\(preference, executionModel, conversationId\)/);
  assert.match(main, /name === 'costRoute\.replay'/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
});
