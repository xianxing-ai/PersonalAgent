import {FEATURED_MODELS} from './featured-model-choices.js';

/** Same published tiers as usage budget #636. An estimate is not an invoice. */
function tier(modelId) {
  const id = modelId.toLowerCase();
  if (/flash|turbo|lite|mini/.test(id)) return {rank: 0, yuanPerMillion: 0.3};
  if (/plus/.test(id)) return {rank: 1, yuanPerMillion: 2};
  if (/max|pro/.test(id)) return {rank: 2, yuanPerMillion: 8};
  return {rank: 1, yuanPerMillion: 4};
}
function roundYuan(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
export function estimateModelYuan(modelId, tokens) {
  if (typeof modelId !== 'string' || !modelId.trim()) throw Error('模型标识无效');
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw Error('token 数无效');
  return roundYuan(tokens * tier(modelId).yuanPerMillion / 1_000_000);
}

export function taskDifficulty(goal) {
  const text = String(goal ?? '');
  let score = 0;
  if (text.length > 180) score += 1;
  if (text.length > 600) score += 1;
  if (/然后|并且|同时|步骤|计划|对比|分析|实现|修复|设计/.test(text)) score += 1;
  if ((text.match(/[；;\n]/g) ?? []).length >= 2) score += 1;
  return score;
}

function textModels(catalog) {
  if (!catalog || !Array.isArray(catalog.models)) return [];
  return catalog.models.filter(model => model && typeof model.id === 'string' && model.type === 'text'
    && model.availability !== 'unavailable' && model.available !== false);
}

function pickTier(models, featured, tierName) {
  const ids = new Set(models.map(model => model.id));
  return featured.find(item => item.tier === tierName && ids.has(item.id))?.id
    ?? models.find(model => (tierName === 'fast' ? /flash|turbo|lite|mini/i : /max|pro/i).test(model.id))?.id;
}

/**
 * Prefer the fast/flagship catalog entry for the difficulty, then obey a usage-budget decide()
 * with the same shape as #636. A blocked decision never falls through to a more expensive model.
 */
export function routeModel({goal, catalog, featured = FEATURED_MODELS, preference, budget, tokens = 2000}) {
  const models = textModels(catalog);
  if (!catalog?.revision || !models.length) return {state: 'unavailable', reason: '目录里没有可执行的文本模型'};
  const explicit = Boolean(preference?.modelId || preference?.executionModel?.modelId);
  const wanted = taskDifficulty(goal) >= 2 ? 'flagship' : 'fast';
  let modelId = explicit
    ? (preference.executionModel?.modelId || preference.modelId)
    : (pickTier(models, featured, wanted) ?? catalog.defaultModelId);
  if (!models.some(model => model.id === modelId)) return {state: 'unavailable', reason: '所选模型不在当前文本目录中'};
  const candidates = models.map(model => model.id);
  if (budget && typeof budget.decide === 'function') {
    const decision = budget.decide({origin: 'user', modelId, candidates});
    if (!decision || typeof decision.allowed !== 'boolean') throw Error('用量上限返回无效');
    if (!decision.allowed) return {state: 'blocked', reason: decision.prompt || '已超过用量上限', modelId};
    if (typeof decision.modelId === 'string' && candidates.includes(decision.modelId)) modelId = decision.modelId;
  }
  const meta = featured.find(item => item.id === modelId);
  const reasoningEffort = explicit && preference?.executionModel?.modelId === modelId ? preference.executionModel.reasoningEffort : undefined;
  return {
    state: 'selected',
    tier: meta?.tier ?? wanted,
    tierLabel: meta?.tier === 'flagship' ? '旗舰' : meta?.tier === 'fast' ? '快速' : '目录模型',
    modelId,
    estimatedYuan: estimateModelYuan(modelId, tokens),
    reason: explicit ? '沿用已选模型，并服从用量上限' : (wanted === 'flagship' ? '任务较难，选用旗舰' : '任务较轻，选用快速模型'),
    executionModel: {catalogRevision: catalog.revision, modelId, ...(reasoningEffort ? {reasoningEffort} : {})},
  };
}

export function alternateModel(modelId, catalog, featured = FEATURED_MODELS) {
  const models = textModels(catalog);
  const meta = featured.find(item => item.id === modelId);
  const want = meta?.tier === 'flagship' ? 'fast' : 'flagship';
  const ids = new Set(models.map(model => model.id));
  return featured.find(item => item.vendor === meta?.vendor && item.tier === want && ids.has(item.id))?.id
    ?? featured.find(item => item.tier === want && ids.has(item.id))?.id
    ?? '';
}

export function createCostRouteProduct({readCatalog, readBudget, complete, featured = FEATURED_MODELS} = {}) {
  const goals = new Map();
  const selections = new Map();
  const runs = [];
  let last = {state: 'idle', reason: '尚未按难度选择模型'};
  function catalog() { return readCatalog?.() ?? null; }
  function budget() { return readBudget?.() ?? null; }
  return {
    noteGoal(conversationId, goal) {
      if (typeof conversationId === 'string' && conversationId) goals.set(conversationId, String(goal ?? '').slice(0, 4000));
    },
    apply(preference, executionModel, conversationId) {
      const routed = routeModel({goal: goals.get(conversationId) ?? '', catalog: catalog(), featured, preference, budget: budget()});
      last = routed;
      if (routed.state === 'blocked') throw Error(routed.reason);
      if (routed.state !== 'selected') return {preference, executionModel};
      if (typeof conversationId === 'string') selections.set(conversationId, routed.executionModel);
      return {
        preference: {...preference, modelId: routed.modelId, executionModel: routed.executionModel},
        executionModel: routed.executionModel,
      };
    },
    noteRun(task) {
      if (!task?.taskId || !['succeeded', 'failed', 'cancelled'].includes(task.state)) return;
      const selection = selections.get(task.conversationId);
      const record = {
        taskId: task.taskId,
        goal: goals.get(task.conversationId) ?? (typeof task.goal === 'string' ? task.goal.slice(0, 4000) : ''),
        modelId: selection?.modelId ?? '',
        output: typeof task.resultSummary === 'string' ? task.resultSummary.slice(0, 2000) : '',
        state: task.state,
      };
      const existing = runs.find(item => item.taskId === record.taskId);
      if (existing) Object.assign(existing, record);
      else runs.push(record);
      if (runs.length > 20) runs.shift();
    },
    snapshot() {
      const current = catalog();
      return {
        route: last.state === 'selected'
          ? {state: last.state, tier: last.tier, tierLabel: last.tierLabel, modelId: last.modelId, estimatedYuan: last.estimatedYuan, reason: last.reason}
          : {state: last.state, reason: last.reason ?? ''},
        runs: runs.map(run => ({...run, alternateModelId: alternateModel(run.modelId, current, featured)})),
      };
    },
    async handleAction(name, payload) {
      if (name === 'costRoute.state') {
        if (payload !== undefined) throw Error('成本路由状态不接受参数');
        return this.snapshot();
      }
      if (name !== 'costRoute.replay') throw Error('不支持的成本路由操作');
      if (!payload || Object.keys(payload).some(key => !['taskId', 'modelId'].includes(key)) || typeof payload.taskId !== 'string' || typeof payload.modelId !== 'string') {
        throw Error('回放参数无效');
      }
      const run = runs.find(item => item.taskId === payload.taskId);
      if (!run) throw Error('没有可回放的历史任务');
      const routed = routeModel({goal: run.goal, catalog: catalog(), featured, preference: {modelId: payload.modelId}, budget: budget()});
      if (routed.state === 'blocked') return {state: 'blocked', reason: routed.reason};
      if (routed.state !== 'selected') return routed;
      if (typeof complete !== 'function') return {state: 'unavailable', reason: '回放需要已配置的模型端口，未发起付费调用', executionModel: routed.executionModel};
      const output = await complete({executionModel: routed.executionModel, goal: run.goal});
      const text = typeof output?.text === 'string' ? output.text.slice(0, 2000) : '';
      return {state: 'compared', baseline: {modelId: run.modelId, output: run.output}, candidate: {modelId: routed.executionModel.modelId, output: text}, same: text === run.output};
    },
  };
}
