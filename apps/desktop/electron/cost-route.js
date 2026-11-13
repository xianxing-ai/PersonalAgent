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

function displayModelLabel(modelId, catalog, featured = FEATURED_MODELS) {
  if (typeof modelId !== 'string' || !modelId.trim()) return '目录模型';
  const meta = featured.find(item => item.id === modelId);
  if (meta?.tier === 'flagship') return '旗舰强力模型';
  if (meta?.tier === 'fast') return '轻量快速模型';
  const inCatalog = Array.isArray(catalog?.models) ? catalog.models.find(item => item?.id === modelId) : undefined;
  const rank = tier(modelId).rank;
  if (rank === 0) return '轻量快速模型';
  if (rank === 2) return '旗舰强力模型';
  return inCatalog ? '标准均衡模型' : '目录模型';
}

export function createCostRouteProduct({readCatalog, readBudget, complete, assertCloudSend, onUpdate, featured = FEATURED_MODELS} = {}) {
  const goals = new Map();
  const selections = new Map();
  const runs = [];
  let last = {state: 'idle', reason: '尚未按难度选择模型'};
  let lastReplay = null;
  function catalog() { return readCatalog?.() ?? null; }
  function budget() { return readBudget?.() ?? null; }
  return {
    noteGoal(conversationId, goal) {
      if (typeof conversationId === 'string' && conversationId) goals.set(conversationId, String(goal ?? '').slice(0, 4000));
    },
    apply(preference, executionModel, conversationId) {
      const current = catalog();
      const routed = routeModel({goal: goals.get(conversationId) ?? '', catalog: current, featured, preference, budget: budget()});
      last = routed.state === 'selected'
        ? {...routed, modelLabel: displayModelLabel(routed.modelId, current, featured)}
        : routed;
      if (routed.state === 'blocked') throw Error(routed.reason);
      if (routed.state !== 'selected') return {preference, executionModel};
      if (typeof conversationId === 'string') selections.set(conversationId, routed.executionModel);
      return {
        preference: {...preference, modelId: routed.modelId, executionModel: routed.executionModel},
        executionModel: routed.executionModel,
      };
    },
    noteRun(task, fallbackModelId) {
      if (!task?.taskId || !['succeeded', 'failed', 'cancelled'].includes(task.state)) return;
      const selection = selections.get(task.conversationId);
      const record = {
        taskId: task.taskId,
        conversationId: typeof task.conversationId === 'string' ? task.conversationId : '',
        goal: goals.get(task.conversationId) ?? (typeof task.goal === 'string' ? task.goal.slice(0, 4000) : ''),
        modelId: selection?.modelId || (typeof fallbackModelId === 'string' ? fallbackModelId : ''),
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
          ? {state: last.state, tier: last.tier, tierLabel: last.tierLabel, modelId: last.modelId, modelLabel: last.modelLabel ?? displayModelLabel(last.modelId, current, featured), estimatedYuan: last.estimatedYuan, reason: last.reason}
          : {state: last.state, reason: last.reason ?? ''},
        runs: runs.map(run => {
          const alt = alternateModel(run.modelId, current, featured);
          return {
            ...run,
            modelLabel: displayModelLabel(run.modelId, current, featured),
            alternateModelId: alt,
            alternateModelLabel: alt ? displayModelLabel(alt, current, featured) : '',
          };
        }),
        replay: lastReplay ? structuredClone(lastReplay) : null,
      };
    },
    async handleAction(name, payload) {
      if (name === 'costRoute.state') {
        if (payload !== undefined) throw Error('成本路由状态不接受参数');
        return this.snapshot();
      }
      if (name === 'costRoute.cancelReplay') {
        if (payload !== undefined) throw Error('取消回放不接受参数');
        lastReplay = null;
        onUpdate?.();
        return this.snapshot();
      }
      if (name !== 'costRoute.replay') throw Error('不支持的成本路由操作');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).some(key => !['taskId', 'modelId', 'confirmed'].includes(key))
        || typeof payload.taskId !== 'string' || typeof payload.modelId !== 'string'
        || (payload.confirmed !== undefined && typeof payload.confirmed !== 'boolean')) {
        throw Error('回放参数无效');
      }
      const run = runs.find(item => item.taskId === payload.taskId);
      if (!run) throw Error('没有可回放的历史任务');
      const current = catalog();
      const routed = routeModel({goal: run.goal, catalog: current, featured, preference: {modelId: payload.modelId}, budget: budget()});
      if (routed.state === 'blocked') {
        lastReplay = {state: 'blocked', taskId: run.taskId, reason: routed.reason};
        onUpdate?.();
        return lastReplay;
      }
      if (routed.state !== 'selected') {
        lastReplay = {state: routed.state, taskId: run.taskId, reason: routed.reason ?? '候选模型当前不可用'};
        onUpdate?.();
        return lastReplay;
      }
      try {
        await assertCloudSend?.({taskId: run.taskId, conversationId: run.conversationId ?? '', goal: run.goal, executionModel: routed.executionModel});
      } catch (error) {
        lastReplay = {
          state: 'failed',
          taskId: run.taskId,
          reason: error instanceof Error && error.message ? error.message : '云端外发校验未通过',
        };
        onUpdate?.();
        return lastReplay;
      }
      const baselineLabel = displayModelLabel(run.modelId, current, featured);
      const candidateLabel = displayModelLabel(routed.executionModel.modelId, current, featured);
      if (payload.confirmed !== true) {
        lastReplay = {
          state: 'confirm_required',
          taskId: run.taskId,
          modelId: routed.executionModel.modelId,
          baselineLabel,
          candidateLabel,
          estimatedYuan: routed.estimatedYuan,
          reason: `确认将任务发送到云端「${candidateLabel}」对比回放？预计费用约 ${routed.estimatedYuan} 元（按估算单价）`,
        };
        onUpdate?.();
        return lastReplay;
      }
      if (typeof complete !== 'function') {
        lastReplay = {state: 'unavailable', taskId: run.taskId, reason: '回放需要已配置的模型端口，未发起付费调用', executionModel: routed.executionModel};
        onUpdate?.();
        return lastReplay;
      }
      try {
        const output = await complete({executionModel: routed.executionModel, goal: run.goal});
        const text = typeof output?.text === 'string' ? output.text.slice(0, 2000) : '';
        lastReplay = {
          state: 'compared',
          taskId: run.taskId,
          same: text === run.output,
          baseline: {modelId: run.modelId, label: baselineLabel, output: run.output},
          candidate: {modelId: routed.executionModel.modelId, label: candidateLabel, output: text},
        };
        onUpdate?.();
        return lastReplay;
      } catch (error) {
        lastReplay = {
          state: 'failed',
          taskId: run.taskId,
          reason: error instanceof Error && error.message ? error.message : '回放执行失败',
        };
        onUpdate?.();
        return lastReplay;
      }
    },
  };
}
