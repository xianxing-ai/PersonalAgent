import {AsyncLocalStorage} from 'node:async_hooks';
import {createUsageBudgetHost} from './usage-budget-host.js';

export const PROACTIVE_SOURCE_TASK_CHECKPOINT = 'desktop-proactive-source-v1';

export function isAutonomousConversationId(conversationId) {
  return typeof conversationId === 'string'
    && (conversationId.startsWith('desktop-proactive') || conversationId.startsWith('proactive-source:'));
}

export function isAutonomousRuntimeTask(runtime, taskId) {
  if (!runtime || typeof taskId !== 'string' || !taskId) return false;
  const isDirectAutonomous = id => {
    try {
      const task = runtime.getTask(id);
      if (isAutonomousConversationId(task?.conversationId)) return true;
    } catch {
      return false;
    }
    return runtime.loadCheckpoint(id, 'desktop-proactive-workflow-v1') != null
      || runtime.loadCheckpoint(id, PROACTIVE_SOURCE_TASK_CHECKPOINT) != null;
  };
  if (isDirectAutonomous(taskId)) return true;
  let cursorTaskId = taskId;
  const visited = new Set([cursorTaskId]);
  while (visited.size < 16) {
    const parent = runtime.loadCheckpoint(cursorTaskId, 'subtask-parent');
    const parentId = typeof parent?.parentTaskId === 'string' ? parent.parentTaskId : '';
    if (!parentId || visited.has(parentId)) break;
    visited.add(parentId);
    cursorTaskId = parentId;
    if (isDirectAutonomous(parentId)) return true;
  }
  return false;
}

const HEATMAP_WEEKS = 26;
const HEATMAP_DAYS = HEATMAP_WEEKS * 7;
const ONE_DAY_MS = 86_400_000;
const MAX_TASK_DURATION_MS = 2 * 3600_000;

function resolveDayFormatter(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      ...(timeZone ? {timeZone} : {}),
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch {
    return new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit'});
  }
}

function formatLocalDay(date, formatter) {
  const parts = formatter.formatToParts(date);
  const read = type => parts.find(part => part.type === type)?.value ?? '';
  const day = `${read('year')}-${read('month')}-${read('day')}`;
  return /^\d{4}-\d{2}-\d{2}$/u.test(day) ? day : '';
}

function parseUtcNoon(dayKey) {
  return Date.parse(`${dayKey}T12:00:00.000Z`);
}

function dayKeyFromUtcMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function heatLevel(value, peak) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(peak) || peak <= 0) return 1;
  const ratio = value / peak;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/** Pure local usage dashboard aggregator over encrypted ledger + structural task metadata. */
export function buildUsageDashboard(ledger = [], {tasks = [], now = new Date(), timeZone} = {}) {
  const formatter = resolveDayFormatter(timeZone);
  const currentDate = now instanceof Date ? now : new Date(now);
  const todayKey = formatLocalDay(Number.isFinite(currentDate.getTime()) ? currentDate : new Date(), formatter) || dayKeyFromUtcMs(Date.now());
  const todayNoon = parseUtcNoon(todayKey);
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeLedger = Array.isArray(ledger) ? ledger : [];

  const dayMap = new Map();
  const ensureDay = key => {
    let row = dayMap.get(key);
    if (!row) { row = {tokens: 0, yuan: 0, count: 0, durationMs: 0}; dayMap.set(key, row); }
    return row;
  };

  let totalTokens = 0;
  let totalYuan = 0;
  let activeDurationMs = 0;
  const modelMap = new Map();
  const toolMap = new Map();
  const addTool = (name, {tokens = 0, yuan = 0, calls = 0}) => {
    const bucket = toolMap.get(name) ?? {name, tokens: 0, yuan: 0, calls: 0};
    bucket.tokens += tokens;
    bucket.yuan += yuan;
    bucket.calls += calls;
    toolMap.set(name, bucket);
  };

  for (const entry of safeLedger) {
    if (!entry || typeof entry !== 'object') continue;
    const parsedAt = typeof entry.at === 'string' ? Date.parse(entry.at) : NaN;
    const dayKey = Number.isFinite(parsedAt) ? formatLocalDay(new Date(parsedAt), formatter) : '';
    const tokens = Number.isSafeInteger(entry.tokens) && entry.tokens > 0 ? entry.tokens : 0;
    const yuan = typeof entry.estimatedYuan === 'number' && Number.isFinite(entry.estimatedYuan) && entry.estimatedYuan >= 0 ? entry.estimatedYuan : 0;
    const durationMs = Number.isSafeInteger(entry.durationMs) && entry.durationMs > 0 ? entry.durationMs : 0;
    totalTokens += tokens;
    totalYuan += yuan;
    activeDurationMs += durationMs;
    if (dayKey) {
      const cell = ensureDay(dayKey);
      cell.tokens += tokens;
      cell.yuan += yuan;
      cell.count += 1;
      cell.durationMs += durationMs;
    }
    if (entry.kind === 'model' && typeof entry.modelId === 'string' && entry.modelId.trim()) {
      const id = entry.modelId.trim();
      const bucket = modelMap.get(id) ?? {name: id, tokens: 0, yuan: 0, calls: 0};
      bucket.tokens += tokens;
      bucket.yuan += yuan;
      bucket.calls += 1;
      modelMap.set(id, bucket);
    }
    if (entry.kind === 'cloud_runtime') {
      addTool('AgentArts 云端', {tokens: 0, yuan, calls: 1});
    } else if (entry.kind === 'model') {
      addTool(entry.origin === 'autonomous' ? '自主后台任务' : '对话与辅助模型', {tokens, yuan, calls: 1});
    }
  }

  for (const task of safeTasks) {
    if (!task || typeof task !== 'object') continue;
    const createdMs = typeof task.createdAt === 'string' ? Date.parse(task.createdAt) : NaN;
    const updatedMs = typeof task.updatedAt === 'string' ? Date.parse(task.updatedAt) : NaN;
    if (Number.isFinite(createdMs) && Number.isFinite(updatedMs) && updatedMs > createdMs) {
      const span = updatedMs - createdMs;
      if (span <= MAX_TASK_DURATION_MS && activeDurationMs < MAX_TASK_DURATION_MS * 1000) {
        activeDurationMs += span;
      }
    }
    const taskTime = Number.isFinite(createdMs) ? createdMs : updatedMs;
    if (Number.isFinite(taskTime)) {
      const dayKey = formatLocalDay(new Date(taskTime), formatter);
      if (dayKey) ensureDay(dayKey).count += 1;
    }
  }

  let activeDays = 0;
  let peakDayTokens = 0;
  let peakDayYuan = 0;
  for (const row of dayMap.values()) {
    if (row.tokens > 0 || row.yuan > 0 || row.count > 0) activeDays += 1;
    if (row.tokens > peakDayTokens) peakDayTokens = row.tokens;
    if (row.yuan > peakDayYuan) peakDayYuan = row.yuan;
  }

  const isDayActive = key => {
    const row = dayMap.get(key);
    return Boolean(row && (row.tokens > 0 || row.yuan > 0 || row.count > 0));
  };
  let streakDays = 0;
  let cursor = isDayActive(todayKey) ? todayNoon : todayNoon - ONE_DAY_MS;
  for (let i = 0; i < 3660; i += 1) {
    if (!isDayActive(dayKeyFromUtcMs(cursor))) break;
    streakDays += 1;
    cursor -= ONE_DAY_MS;
  }

  const todayDow = new Date(todayNoon).getUTCDay();
  const gridEndNoon = todayNoon + (6 - todayDow) * ONE_DAY_MS;
  const gridStartNoon = gridEndNoon - (HEATMAP_DAYS - 1) * ONE_DAY_MS;
  const daily = [];
  const monthLabels = new Array(HEATMAP_WEEKS).fill('');
  let lastMonthLabeled = '';
  for (let i = 0; i < HEATMAP_DAYS; i += 1) {
    const cellNoon = gridStartNoon + i * ONE_DAY_MS;
    const date = dayKeyFromUtcMs(cellNoon);
    const data = dayMap.get(date);
    const tokens = data?.tokens ?? 0;
    const yuan = Math.round((data?.yuan ?? 0) * 10_000) / 10_000;
    const count = data?.count ?? 0;
    daily.push({
      date,
      tokens,
      yuan,
      count,
      tokenLevel: heatLevel(tokens > 0 ? tokens : count, peakDayTokens > 0 ? peakDayTokens : 5),
      costLevel: heatLevel(yuan, peakDayYuan),
    });
    if (i % 7 === 0) {
      const weekIndex = i / 7;
      const monthKey = date.slice(0, 7);
      if (monthKey !== lastMonthLabeled) {
        const monthNum = Number(date.slice(5, 7));
        monthLabels[weekIndex] = `${monthNum}月`;
        lastMonthLabeled = monthKey;
      }
    }
  }

  const byModelRaw = [...modelMap.values()]
    .sort((a, b) => b.tokens - a.tokens || b.yuan - a.yuan || b.calls - a.calls || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, 5);
  const totalModelCalls = byModelRaw.reduce((sum, item) => sum + item.calls, 0);
  const byModel = byModelRaw.map(item => ({
    ...item,
    yuan: Math.round(item.yuan * 10_000) / 10_000,
    percent: totalTokens > 0 ? Number(((item.tokens / totalTokens) * 100).toFixed(1))
      : totalModelCalls > 0 ? Number(((item.calls / totalModelCalls) * 100).toFixed(1)) : 0,
    costPercent: totalYuan > 0 ? Number(((item.yuan / totalYuan) * 100).toFixed(1)) : 0,
  }));

  let byToolRaw = [...toolMap.values()];
  if (!byToolRaw.length && safeTasks.length > 0) {
    const taskBuckets = new Map();
    for (const task of safeTasks) {
      const stateKey = task?.state === 'succeeded' ? '已完成对话任务'
        : task?.state === 'failed' ? '失败对话任务'
          : '对话与执行任务';
      const bucket = taskBuckets.get(stateKey) ?? {name: stateKey, tokens: 0, yuan: 0, calls: 0};
      bucket.calls += 1;
      taskBuckets.set(stateKey, bucket);
    }
    byToolRaw = [...taskBuckets.values()];
  }
  byToolRaw.sort((a, b) => b.tokens - a.tokens || b.yuan - a.yuan || b.calls - a.calls || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  byToolRaw = byToolRaw.slice(0, 5);
  const totalToolTokens = byToolRaw.reduce((sum, item) => sum + item.tokens, 0);
  const totalToolCalls = byToolRaw.reduce((sum, item) => sum + item.calls, 0);
  const totalToolYuan = byToolRaw.reduce((sum, item) => sum + item.yuan, 0);
  const byTool = byToolRaw.map(item => ({
    ...item,
    yuan: Math.round(item.yuan * 10_000) / 10_000,
    percent: totalToolTokens > 0 ? Number(((item.tokens / totalToolTokens) * 100).toFixed(1))
      : totalToolCalls > 0 ? Number(((item.calls / totalToolCalls) * 100).toFixed(1)) : 0,
    costPercent: totalToolYuan > 0 ? Number(((item.yuan / totalToolYuan) * 100).toFixed(1))
      : totalToolCalls > 0 ? Number(((item.calls / totalToolCalls) * 100).toFixed(1)) : 0,
  }));

  const roundedYuan = Math.round(totalYuan * 10_000) / 10_000;
  const messageCount = safeTasks.length > 0 ? safeTasks.length : safeLedger.length;
  return {
    totalTokens,
    totalYuan: roundedYuan,
    activeDays,
    streakDays,
    activeDurationMs,
    peakDayTokens,
    peakDayYuan: Math.round(peakDayYuan * 10_000) / 10_000,
    topModel: byModel[0]?.name ?? '',
    messageCount,
    daily,
    monthLabels,
    byModel,
    byTool,
    hasActivity: totalTokens > 0 || roundedYuan > 0 || messageCount > 0,
  };
}

/**
 * Desktop startup adapter. main.js constructs this once and passes the same
 * hooks into model calls, cloud transport, proactive admission and IPC.
 */
export function createUsageBudgetProduct({userData, safeStorage, now, timeZone, onUpdate, candidates, Notification}) {
  const sent = new Set();
  const originStore = new AsyncLocalStorage();
  const currentOrigin = () => originStore.getStore() === 'autonomous' ? 'autonomous' : 'user';
  let readRuntime;
  let notifier = async notice => {
    if (Notification?.isSupported?.()) new Notification({title: 'PersonalAgent 用量', body: notice.body}).show();
  };
  const budget = createUsageBudgetHost({
    userData, safeStorage, now, timeZone,
    onNotice: notice => { void emit(notice); },
  });
  async function emit(notice) {
    if (!notice?.id || sent.has(notice.id)) return;
    sent.add(notice.id);
    try { await notifier(notice); onUpdate?.(); }
    catch { sent.delete(notice.id); }
  }
  function changed() { try { onUpdate?.(); } catch { /* UI refresh must not affect the ledger. */ } }
  return {
    snapshot() {
      try { return budget.snapshot(); }
      catch (error) { return {dailyLimitYuan: null, monthlyLimitYuan: null, action: 'degrade', usageLine: error?.message || '用量账本需要恢复'}; }
    },
    dashboard({tasks = []} = {}) {
      try {
        return buildUsageDashboard(budget.readLedger(), {tasks, now: now?.() ?? new Date(), timeZone});
      } catch {
        return buildUsageDashboard([], {tasks: [], now: now?.() ?? new Date(), timeZone});
      }
    },
    bindNotifier(port) {
      if (!port || typeof port.sendAdvisoryNotification !== 'function') throw Error('用量通知端口无效');
      notifier = async notice => {
        await port.sendAdvisoryNotification({id: notice.id, title: 'PersonalAgent 用量', body: notice.body, source: 'usage-budget'});
      };
    },
    decide(input) { return budget.decide({...input, candidates: input.candidates ?? candidates?.() ?? []}); },
    beforeLocalCall(info) {
      const origin = currentOrigin();
      const decision = budget.decide({origin, modelId: info.modelId, candidates: info.models ?? []});
      if (!decision.allowed) throw Error(decision.prompt || '已超过用量上限');
      if (decision.prompt) void emit(budget.exceededNotice());
      return decision;
    },
    recordLocal(info) {
      const usage = info?.usage ?? {};
      const tokens = Number.isSafeInteger(usage.totalTokens) ? usage.totalTokens
        : (Number.isSafeInteger(usage.promptTokens) ? usage.promptTokens : 0) + (Number.isSafeInteger(usage.completionTokens) ? usage.completionTokens : 0);
      budget.recordModel({modelId: info.modelId, tokens, origin: currentOrigin()});
      changed();
    },
    degradeSelection(selection, resolve) {
      if (!selection?.modelId || typeof resolve !== 'function') return selection;
      const decision = budget.decide({origin: currentOrigin(), modelId: selection.modelId, candidates: candidates?.() ?? []});
      if (!decision.modelId || decision.modelId === selection.modelId) return selection;
      try { return resolve({modelId: decision.modelId, ...(selection.reasoningEffort ? {reasoningEffort: selection.reasoningEffort} : {})}); }
      catch {
        if (selection.reasoningEffort) {
          try { return resolve({modelId: decision.modelId}); } catch {}
        }
        return selection;
      }
    },
    beforeCloudSend({userInitiated, modelId}) {
      const decision = budget.decide({origin: userInitiated ? 'user' : 'autonomous', modelId, candidates: candidates?.() ?? []});
      if (!decision.allowed) throw Error(decision.prompt || '已超过用量上限');
      if (userInitiated && decision.prompt) void emit(budget.exceededNotice());
    },
    bindRuntime(getter) {
      if (getter !== undefined && typeof getter !== 'function') throw Error('用量运行时读取器无效');
      readRuntime = getter;
    },
    recordCloud(info) {
      if (!info || !Number.isSafeInteger(info.durationMs) || info.durationMs < 0) return;
      const origin = info.origin === 'autonomous' || info.origin === 'user'
        ? info.origin
        : (info.taskId && isAutonomousRuntimeTask(readRuntime?.(), info.taskId) ? 'autonomous' : currentOrigin());
      budget.recordCloud({durationMs: info.durationMs, origin});
      changed();
    },
    noteUserSubmit() {
      const notice = budget.exceededNotice();
      if (notice) void emit(notice);
    },
    async withOrigin(next, fn) {
      const normalized = next === 'autonomous' ? 'autonomous' : 'user';
      return originStore.run(normalized, fn);
    },
    handleAction(name, payload) {
      if (name === 'usageBudget.state') {
        if (payload !== undefined) throw Error('用量状态不接受参数');
        return this.snapshot();
      }
      if (name === 'usageBudget.configure') {
        const result = budget.configure(payload);
        changed();
        return result;
      }
      throw Error('不支持的用量操作');
    },
  };
}

/** Shared by the startup model gateway and the integration test. Not a test double. */
export function modelApiUsageHooks(product) {
  return {
    beforeCall: info => product.beforeLocalCall(info),
    onModelUsage: info => product.recordLocal(info),
  };
}
