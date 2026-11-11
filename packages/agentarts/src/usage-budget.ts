/** Competition usage budget (MOD-31/32). Estimates are not invoices and this port is not frozen. */

export const USAGE_BUDGET_APPROACH_RATIO = 0.8;
/** Declared estimate for cloud invocation wall time. Not a platform bill. */
export const CLOUD_YUAN_PER_MINUTE = 0.02;

export type UsageOrigin = 'user' | 'autonomous';
export type UsageBudgetAction = 'degrade' | 'pause';

export interface UsageLedgerEntry {
  seq: number;
  at: string;
  kind: 'model' | 'cloud_runtime';
  origin: UsageOrigin;
  modelId?: string;
  tokens?: number;
  durationMs?: number;
  estimatedYuan: number;
}

export interface UsageBudgetPolicy {
  version: 1;
  dailyLimitYuan: number | null;
  monthlyLimitYuan: number | null;
  action: UsageBudgetAction;
}

export interface UsageBudgetNotices {
  approachDay?: string;
  approachMonth?: string;
  exceededDay?: string;
  exceededMonth?: string;
}

export interface UsageBudgetStore {
  loadLedger(): UsageLedgerEntry[];
  appendLedger(entry: UsageLedgerEntry): void;
  loadPolicy(): UsageBudgetPolicy | undefined;
  savePolicy(policy: UsageBudgetPolicy): void;
  loadNotices(): UsageBudgetNotices;
  saveNotices(notices: UsageBudgetNotices): void;
}

export interface UsageBudgetSnapshot {
  dailyLimitYuan: number | null;
  monthlyLimitYuan: number | null;
  action: UsageBudgetAction;
  usageLine: string;
}

export interface UsageDecision {
  allowed: boolean;
  modelId?: string;
  prompt?: string;
}

export interface UsageNotice {
  id: string;
  body: string;
}

interface Tier {rank: number; yuanPerMillion: number}

const DEFAULT_POLICY: UsageBudgetPolicy = {version: 1, dailyLimitYuan: null, monthlyLimitYuan: null, action: 'degrade'};

function roundYuan(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function tier(modelId: string): Tier {
  const id = modelId.toLowerCase();
  if (/flash|turbo|lite|mini/.test(id)) return {rank: 0, yuanPerMillion: 0.3};
  if (/plus/.test(id)) return {rank: 1, yuanPerMillion: 2};
  if (/max|pro/.test(id)) return {rank: 2, yuanPerMillion: 8};
  return {rank: 1, yuanPerMillion: 4};
}

export function estimateModelYuan(modelId: string, tokens: number): number {
  if (typeof modelId !== 'string' || !modelId.trim()) throw new Error('模型标识无效');
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('token 数无效');
  return roundYuan(tokens * tier(modelId).yuanPerMillion / 1_000_000);
}

export function estimateCloudYuan(durationMs: number): number {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw new Error('云端时长无效');
  return roundYuan(durationMs / 60_000 * CLOUD_YUAN_PER_MINUTE);
}

/** Strictly cheaper published estimate. Same price does not count as a downgrade. */
export function cheaperModel(modelId: string, candidates: readonly string[]): string | undefined {
  const current = tier(modelId);
  const cheaper = candidates.filter(id => {
    if (typeof id !== 'string' || !id || id === modelId) return false;
    const next = tier(id);
    return next.rank < current.rank || (next.rank === current.rank && next.yuanPerMillion < current.yuanPerMillion);
  });
  cheaper.sort((left, right) => tier(left).rank - tier(right).rank
    || tier(left).yuanPerMillion - tier(right).yuanPerMillion
    || (left < right ? -1 : left > right ? 1 : 0));
  return cheaper[0];
}

function periodOf(date: Date, timeZone: string): {day: string; month: string} {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  const day = `${read('year')}-${read('month')}-${read('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('用量日期无效');
  return {day, month: day.slice(0, 7)};
}

function assertEntry(value: unknown, seq: number): UsageLedgerEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('用量账本需要恢复');
  const entry = value as UsageLedgerEntry;
  if (entry.seq !== seq || (entry.kind !== 'model' && entry.kind !== 'cloud_runtime')
    || (entry.origin !== 'user' && entry.origin !== 'autonomous')
    || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at))
    || typeof entry.estimatedYuan !== 'number' || !Number.isFinite(entry.estimatedYuan) || entry.estimatedYuan < 0) {
    throw new Error('用量账本需要恢复');
  }
  if (entry.kind === 'model' && (typeof entry.modelId !== 'string' || !entry.modelId
    || typeof entry.tokens !== 'number' || !Number.isSafeInteger(entry.tokens) || entry.tokens < 0)) {
    throw new Error('用量账本需要恢复');
  }
  if (entry.kind === 'cloud_runtime' && (typeof entry.durationMs !== 'number' || !Number.isSafeInteger(entry.durationMs) || entry.durationMs < 0)) {
    throw new Error('用量账本需要恢复');
  }
  return entry;
}

function readLedger(store: UsageBudgetStore): UsageLedgerEntry[] {
  const loaded = store.loadLedger();
  if (!Array.isArray(loaded)) throw new Error('用量账本需要恢复');
  return loaded.map((entry, index) => assertEntry(entry, index + 1));
}

function parseLimit(value: unknown, name: string): number | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10_000_000) {
    throw new Error(`${name}须为大于 0 的金额，或留空表示不限制`);
  }
  return roundYuan(value);
}

function readPolicy(store: UsageBudgetStore): UsageBudgetPolicy {
  const loaded = store.loadPolicy();
  if (loaded === undefined) return {...DEFAULT_POLICY};
  if (!loaded || loaded.version !== 1 || (loaded.action !== 'degrade' && loaded.action !== 'pause')
    || (loaded.dailyLimitYuan !== null && (typeof loaded.dailyLimitYuan !== 'number' || loaded.dailyLimitYuan <= 0))
    || (loaded.monthlyLimitYuan !== null && (typeof loaded.monthlyLimitYuan !== 'number' || loaded.monthlyLimitYuan <= 0))) {
    throw new Error('用量设置需要恢复');
  }
  return {version: 1, dailyLimitYuan: loaded.dailyLimitYuan, monthlyLimitYuan: loaded.monthlyLimitYuan, action: loaded.action};
}

function level(used: number, limit: number | null): 'none' | 'approach' | 'exceeded' {
  if (limit === null || limit <= 0) return 'none';
  const ratio = used / limit;
  if (ratio >= 1) return 'exceeded';
  if (ratio >= USAGE_BUDGET_APPROACH_RATIO) return 'approach';
  return 'none';
}

function yuanText(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function durationText(durationMs: number): string {
  if (durationMs <= 0) return '0 分钟';
  if (durationMs < 6_000) return `${Math.max(1, Math.round(durationMs / 1000))} 秒`;
  return `${(durationMs / 60_000).toFixed(1)} 分钟`;
}

export interface UsageBudget {
  snapshot(): UsageBudgetSnapshot;
  configure(input: unknown): UsageBudgetSnapshot;
  calendarDay(): string;
  recordModel(input: {modelId: string; tokens: number; origin?: UsageOrigin; at?: string}): void;
  recordCloud(input: {durationMs: number; origin?: UsageOrigin; at?: string}): void;
  decide(input: {origin: UsageOrigin; modelId?: string; candidates?: readonly string[]}): UsageDecision;
  exceededNotice(): UsageNotice | undefined;
}

export function createUsageBudget(options: {
  store: UsageBudgetStore;
  now?: () => Date;
  timeZone?: string;
  onNotice?: (notice: UsageNotice) => void;
}): UsageBudget {
  if (!options?.store || typeof options.store.loadLedger !== 'function' || typeof options.store.appendLedger !== 'function'
    || typeof options.store.loadPolicy !== 'function' || typeof options.store.savePolicy !== 'function'
    || typeof options.store.loadNotices !== 'function' || typeof options.store.saveNotices !== 'function') {
    throw new Error('用量存储无效');
  }
  const store = options.store;
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone ?? 'Asia/Shanghai';
  const onNotice = options.onNotice;

  function clock(at?: string): Date {
    const date = at === undefined ? now() : new Date(at);
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('用量日期无效');
    return date;
  }

  function totals(entries: UsageLedgerEntry[], date: Date) {
    const period = periodOf(date, timeZone);
    let dayYuan = 0, monthYuan = 0, dayTokens = 0, monthTokens = 0, dayCloud = 0, monthCloud = 0;
    for (const entry of entries) {
      const entryPeriod = periodOf(new Date(entry.at), timeZone);
      const inMonth = entryPeriod.month === period.month;
      const inDay = entryPeriod.day === period.day;
      if (!inMonth) continue;
      monthYuan = roundYuan(monthYuan + entry.estimatedYuan);
      if (entry.kind === 'model') monthTokens += entry.tokens ?? 0;
      else monthCloud += entry.durationMs ?? 0;
      if (!inDay) continue;
      dayYuan = roundYuan(dayYuan + entry.estimatedYuan);
      if (entry.kind === 'model') dayTokens += entry.tokens ?? 0;
      else dayCloud += entry.durationMs ?? 0;
    }
    return {period, dayYuan, monthYuan, dayTokens, monthTokens, dayCloud, monthCloud};
  }

  function statusText(policy: UsageBudgetPolicy, dayLevel: ReturnType<typeof level>, monthLevel: ReturnType<typeof level>): string {
    const worst = dayLevel === 'exceeded' || monthLevel === 'exceeded' ? 'exceeded'
      : dayLevel === 'approach' || monthLevel === 'approach' ? 'approach' : 'none';
    if (worst === 'exceeded' && policy.action === 'pause') return ' 已超过上限：非必要自主任务会暂停，手动任务仍会执行。';
    if (worst === 'exceeded') return ' 已超过上限：后续调用会改用更便宜的已公布模型，手动任务仍会执行。';
    if (worst === 'approach') return ' 已接近上限。';
    return '';
  }

  function lineFor(policy: UsageBudgetPolicy, view: ReturnType<typeof totals>): string {
    const dayLimit = policy.dailyLimitYuan === null ? `${yuanText(view.dayYuan)} 元（未设每日上限）` : `${yuanText(view.dayYuan)}/${yuanText(policy.dailyLimitYuan)} 元`;
    const monthLimit = policy.monthlyLimitYuan === null ? `${yuanText(view.monthYuan)} 元（未设每月上限）` : `${yuanText(view.monthYuan)}/${yuanText(policy.monthlyLimitYuan)} 元`;
    const dayLevel = level(view.dayYuan, policy.dailyLimitYuan);
    const monthLevel = level(view.monthYuan, policy.monthlyLimitYuan);
    return `今日 ${dayLimit} · ${view.dayTokens} token · 云端 ${durationText(view.dayCloud)}；本月 ${monthLimit}。估算，不是账单。${statusText(policy, dayLevel, monthLevel)}`;
  }

  function viewAt(at?: string) {
    const date = clock(at);
    return {date, policy: readPolicy(store), ...totals(readLedger(store), date)};
  }

  function noticeFor(kind: 'approach' | 'exceeded', view: ReturnType<typeof viewAt>): UsageNotice | undefined {
    const dayLevel = level(view.dayYuan, view.policy.dailyLimitYuan);
    const monthLevel = level(view.monthYuan, view.policy.monthlyLimitYuan);
    if (kind === 'exceeded' && dayLevel !== 'exceeded' && monthLevel !== 'exceeded') return undefined;
    if (kind === 'approach' && dayLevel !== 'approach' && monthLevel !== 'approach') return undefined;
    const parts: string[] = [];
    if (kind === 'exceeded' ? dayLevel === 'exceeded' : dayLevel === 'approach') {
      parts.push(`今日 ${Math.floor(view.dayYuan / (view.policy.dailyLimitYuan ?? 1) * 100)}%`);
    }
    if (kind === 'exceeded' ? monthLevel === 'exceeded' : monthLevel === 'approach') {
      parts.push(`本月 ${Math.floor(view.monthYuan / (view.policy.monthlyLimitYuan ?? 1) * 100)}%`);
    }
    const id = `usage-budget-${kind}-${dayLevel === kind ? view.period.day : 'na'}-${monthLevel === kind ? view.period.month : 'na'}`;
    const body = kind === 'exceeded'
      ? `已超过用量上限（${parts.join('，')}）。${view.policy.action === 'pause' ? '非必要的自主任务会暂停。' : '后续调用会改用更便宜的模型。'}手动发起的任务仍会执行。`
      : `用量已接近上限（${parts.join('，')}）。`;
    return {id, body};
  }

  function publishIfNew(view: ReturnType<typeof viewAt>): void {
    const notices = {...(store.loadNotices() ?? {})};
    const exceeded = noticeFor('exceeded', view);
    const approach = exceeded ? undefined : noticeFor('approach', view);
    const notice = exceeded ?? approach;
    if (!notice) return;
    const dayLevel = level(view.dayYuan, view.policy.dailyLimitYuan);
    const monthLevel = level(view.monthYuan, view.policy.monthlyLimitYuan);
    if (exceeded) {
      if (dayLevel === 'exceeded' && notices.exceededDay === view.period.day
        && (monthLevel !== 'exceeded' || notices.exceededMonth === view.period.month)) return;
      if (monthLevel === 'exceeded' && dayLevel !== 'exceeded' && notices.exceededMonth === view.period.month) return;
      if (dayLevel === 'exceeded') notices.exceededDay = view.period.day;
      if (monthLevel === 'exceeded') notices.exceededMonth = view.period.month;
      if (dayLevel !== 'none') notices.approachDay = view.period.day;
      if (monthLevel !== 'none') notices.approachMonth = view.period.month;
    } else if (approach) {
      const dayNew = dayLevel === 'approach' && notices.approachDay !== view.period.day;
      const monthNew = monthLevel === 'approach' && notices.approachMonth !== view.period.month;
      if (!dayNew && !monthNew) return;
      if (dayNew) notices.approachDay = view.period.day;
      if (monthNew) notices.approachMonth = view.period.month;
    }
    store.saveNotices(notices);
    onNotice?.(notice);
  }

  function append(entry: Omit<UsageLedgerEntry, 'seq' | 'estimatedYuan'> & {estimatedYuan: number}, at: string): void {
    const current = readLedger(store);
    const seq = current.length + 1;
    store.appendLedger({...entry, seq, at, estimatedYuan: entry.estimatedYuan});
    publishIfNew(viewAt(at));
  }

  return {
    calendarDay: () => periodOf(clock(), timeZone).day,
    snapshot() {
      const view = viewAt();
      return {dailyLimitYuan: view.policy.dailyLimitYuan, monthlyLimitYuan: view.policy.monthlyLimitYuan, action: view.policy.action, usageLine: lineFor(view.policy, view)};
    },
    configure(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('用量设置无效');
      const record = input as Record<string, unknown>;
      if (Object.keys(record).some(key => !['dailyLimitYuan', 'monthlyLimitYuan', 'action'].includes(key))) throw new Error('用量设置无效');
      if (record.action !== 'degrade' && record.action !== 'pause') throw new Error('超限处理无效');
      const policy: UsageBudgetPolicy = {
        version: 1,
        dailyLimitYuan: parseLimit(record.dailyLimitYuan, '每日上限'),
        monthlyLimitYuan: parseLimit(record.monthlyLimitYuan, '每月上限'),
        action: record.action,
      };
      store.savePolicy(policy);
      return this.snapshot();
    },
    recordModel(input) {
      const at = clock(input.at).toISOString();
      const tokens = input.tokens;
      append({
        at, kind: 'model', origin: input.origin ?? 'user', modelId: input.modelId, tokens,
        estimatedYuan: estimateModelYuan(input.modelId, tokens),
      }, at);
    },
    recordCloud(input) {
      const at = clock(input.at).toISOString();
      append({
        at, kind: 'cloud_runtime', origin: input.origin ?? 'user', durationMs: input.durationMs,
        estimatedYuan: estimateCloudYuan(input.durationMs),
      }, at);
    },
    decide(input) {
      if (input.origin !== 'user' && input.origin !== 'autonomous') throw new Error('用量来源无效');
      const view = viewAt();
      const over = level(view.dayYuan, view.policy.dailyLimitYuan) === 'exceeded'
        || level(view.monthYuan, view.policy.monthlyLimitYuan) === 'exceeded';
      if (!over) return {allowed: true, ...(input.modelId ? {modelId: input.modelId} : {})};
      if (view.policy.action === 'pause' && input.origin === 'autonomous') {
        return {allowed: false, prompt: '已超过用量上限，已暂停这项非必要的自主任务。'};
      }
      const next = input.modelId && view.policy.action === 'degrade'
        ? cheaperModel(input.modelId, input.candidates ?? []) ?? input.modelId : input.modelId;
      const switched = Boolean(next && input.modelId && next !== input.modelId);
      const prompt = view.policy.action === 'degrade'
        ? switched ? '已超过用量上限，已改用更便宜的模型。这次仍会执行。' : '已超过用量上限，没有更便宜的可用模型。这次仍会执行。'
        : '已超过用量上限。这次仍会执行。';
      return {allowed: true, ...(next ? {modelId: next} : {}), prompt};
    },
    exceededNotice() {
      return noticeFor('exceeded', viewAt());
    },
  };
}
