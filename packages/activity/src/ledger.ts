import {randomUUID} from 'node:crypto';
import {appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';

export const ACTIVITY_LEDGER_VERSION = 1 as const;
export const ACTIVITY_SOURCES = ['autonomy', 'proactive', 'repair', 'plugin'] as const;
export const ACTIVITY_RISKS = ['low', 'medium', 'high', 'irreversible'] as const;
export const ACTIVITY_RESULTS = ['succeeded', 'failed', 'asked', 'skipped', 'compensated'] as const;
export const COMPENSATION_ACTIONS = ['uninstall', 'disable', 'revert', 'stop_retry'] as const;

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];
export type ActivityRisk = (typeof ACTIVITY_RISKS)[number];
export type ActivityResult = (typeof ACTIVITY_RESULTS)[number];
export type CompensationActionName = (typeof COMPENSATION_ACTIONS)[number];

export interface ActivityWhy {
  readonly trigger: string;
  readonly basis: string;
}

export interface ActivityCompensation {
  readonly action: CompensationActionName;
  readonly ref: string;
}

export interface ActivityRecord {
  readonly version: typeof ACTIVITY_LEDGER_VERSION;
  readonly id: string;
  readonly at: string;
  readonly source: ActivitySource;
  readonly summary: string;
  readonly risk: ActivityRisk;
  readonly result: ActivityResult;
  readonly why: ActivityWhy;
  readonly compensation?: ActivityCompensation;
  readonly compensates?: string;
  readonly dedupeKey?: string;
}

export interface ActivityDraft {
  source: ActivitySource;
  summary: string;
  risk: ActivityRisk;
  result: ActivityResult;
  why: ActivityWhy;
  compensation?: ActivityCompensation;
  compensates?: string;
  dedupeKey?: string;
  at?: string;
}

export interface ActivityViewItem {
  readonly id: string;
  readonly at: string;
  readonly source: ActivitySource;
  readonly summary: string;
  readonly risk: ActivityRisk;
  readonly result: ActivityResult;
  readonly undoable: boolean;
  readonly why: ActivityWhy;
}

export interface ActivityPage {
  readonly items: readonly ActivityViewItem[];
  readonly earlierKept: boolean;
}

export interface ActivityLedger {
  append(draft: ActivityDraft): ActivityRecord;
  list(available: ReadonlySet<ActivitySource>, limit?: number): ActivityPage;
  undo(id: string, run: (compensation: ActivityCompensation) => void | Promise<void>): Promise<ActivityRecord>;
}

export interface ActivityLedgerOptions {
  file: string;
  now?: () => Date;
  idFactory?: () => string;
  limit?: number;
}

const MAX_RECORDS = 5000;
const MAX_BYTES = 2_000_000;
const SAFE_TEXT = /^[^\r\n{}]{1,160}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function parseRecord(line: string): ActivityRecord {
  let parsed: unknown;
  try { parsed = JSON.parse(line); }
  catch { throw new ProtocolError('INVALID_ARGUMENT', '活动记录不可用'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProtocolError('INVALID_ARGUMENT', '活动记录不可用');
  }
  const value = parsed as Record<string, unknown>;
  const why = value.why;
  if (!why || typeof why !== 'object' || Array.isArray(why)) throw new ProtocolError('INVALID_ARGUMENT', '活动记录不可用');
  const reason = why as Record<string, unknown>;
  if (value.version !== ACTIVITY_LEDGER_VERSION || typeof value.id !== 'string' || !RECORD_ID.test(value.id)
    || typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))
    || !includes(ACTIVITY_SOURCES, value.source)
    || typeof value.summary !== 'string' || !SAFE_TEXT.test(value.summary)
    || !includes(ACTIVITY_RISKS, value.risk)
    || !includes(ACTIVITY_RESULTS, value.result)
    || typeof reason.trigger !== 'string' || !SAFE_TEXT.test(reason.trigger)
    || typeof reason.basis !== 'string' || !SAFE_TEXT.test(reason.basis)) {
    throw new ProtocolError('INVALID_ARGUMENT', '活动记录不可用');
  }
  let compensation: ActivityCompensation | undefined;
  if (value.compensation !== undefined) {
    if (!value.compensation || typeof value.compensation !== 'object' || Array.isArray(value.compensation)) {
      throw new ProtocolError('INVALID_ARGUMENT', '活动记录不可用');
    }
    const candidate = value.compensation as Record<string, unknown>;
    if (!includes(COMPENSATION_ACTIONS, candidate.action) || typeof candidate.ref !== 'string' || !TOKEN.test(candidate.ref)
      || Object.keys(candidate).some(key => key !== 'action' && key !== 'ref')) {
      throw new ProtocolError('INVALID_ARGUMENT', '活动记录不可用');
    }
    compensation = {action: candidate.action, ref: candidate.ref};
  }
  let compensates: string | undefined;
  if (value.compensates !== undefined) {
    if (typeof value.compensates !== 'string' || !RECORD_ID.test(value.compensates)) {
      throw new ProtocolError('INVALID_ARGUMENT', '活动记录不可用');
    }
    compensates = value.compensates;
  }
  let dedupeKey: string | undefined;
  if (value.dedupeKey !== undefined) {
    if (typeof value.dedupeKey !== 'string' || value.dedupeKey.length < 1 || value.dedupeKey.length > 200) {
      throw new ProtocolError('INVALID_ARGUMENT', '活动记录不可用');
    }
    dedupeKey = value.dedupeKey;
  }
  return {
    version: ACTIVITY_LEDGER_VERSION,
    id: value.id,
    at: new Date(value.at).toISOString(),
    source: value.source,
    summary: value.summary,
    risk: value.risk,
    result: value.result,
    why: {trigger: reason.trigger, basis: reason.basis},
    ...(compensation ? {compensation} : {}),
    ...(compensates ? {compensates} : {}),
    ...(dedupeKey ? {dedupeKey} : {}),
  };
}

export function createActivityLedger(options: ActivityLedgerOptions): ActivityLedger {
  const file = options.file;
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const defaultLimit = options.limit ?? 40;

  function readAll(): ActivityRecord[] {
    if (!existsSync(file)) return [];
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_BYTES) {
      throw new ProtocolError('INVALID_ARGUMENT', '活动记录不可用');
    }
    const body = readFileSync(file, 'utf8');
    if (body.length === 0) return [];
    return body.split('\n').filter(line => line.length > 0).map(parseRecord);
  }

  function seal(draft: ActivityDraft): ActivityRecord {
    if (!includes(ACTIVITY_SOURCES, draft.source) || !includes(ACTIVITY_RISKS, draft.risk) || !includes(ACTIVITY_RESULTS, draft.result)) {
      throw new ProtocolError('INVALID_ARGUMENT', '活动记录无效');
    }
    if (typeof draft.summary !== 'string' || !SAFE_TEXT.test(draft.summary)
      || typeof draft.why?.trigger !== 'string' || !SAFE_TEXT.test(draft.why.trigger)
      || typeof draft.why?.basis !== 'string' || !SAFE_TEXT.test(draft.why.basis)) {
      throw new ProtocolError('INVALID_ARGUMENT', '活动记录无效');
    }
    const when = draft.at ?? now().toISOString();
    if (Number.isNaN(Date.parse(when))) throw new ProtocolError('INVALID_ARGUMENT', '时间无效');
    const id = idFactory();
    if (!RECORD_ID.test(id)) throw new ProtocolError('INVALID_ARGUMENT', '活动记录标识无效');
    if (draft.compensation && (!includes(COMPENSATION_ACTIONS, draft.compensation.action) || !TOKEN.test(draft.compensation.ref))) {
      throw new ProtocolError('INVALID_ARGUMENT', '补偿动作无效');
    }
    if (draft.compensates !== undefined && !RECORD_ID.test(draft.compensates)) {
      throw new ProtocolError('INVALID_ARGUMENT', '补偿目标无效');
    }
    if (draft.dedupeKey !== undefined && (draft.dedupeKey.length < 1 || draft.dedupeKey.length > 200)) {
      throw new ProtocolError('INVALID_ARGUMENT', '活动记录无效');
    }
    return {
      version: ACTIVITY_LEDGER_VERSION,
      id,
      at: new Date(when).toISOString(),
      source: draft.source,
      summary: draft.summary,
      risk: draft.risk,
      result: draft.result,
      why: {trigger: draft.why.trigger, basis: draft.why.basis},
      ...(draft.compensation ? {compensation: {action: draft.compensation.action, ref: draft.compensation.ref}} : {}),
      ...(draft.compensates ? {compensates: draft.compensates} : {}),
      ...(draft.dedupeKey ? {dedupeKey: draft.dedupeKey} : {}),
    };
  }

  function write(record: ActivityRecord) {
    const parent = path.dirname(file);
    mkdirSync(parent, {recursive: true});
    if ((existsSync(file) && lstatSync(file).isSymbolicLink()) || (existsSync(parent) && lstatSync(parent).isSymbolicLink())) {
      throw new ProtocolError('INVALID_ARGUMENT', '活动记录不可用');
    }
    appendFileSync(file, `${JSON.stringify(record)}\n`, {encoding: 'utf8', flag: 'a'});
  }

  function append(draft: ActivityDraft): ActivityRecord {
    const existing = readAll();
    if (draft.dedupeKey) {
      const prior = existing.find(item => item.dedupeKey === draft.dedupeKey);
      if (prior) {
        if (prior.summary !== draft.summary || prior.result !== draft.result || prior.source !== draft.source) {
          throw new ProtocolError('REVISION_CONFLICT', '活动记录与已有条目冲突');
        }
        return prior;
      }
    }
    if (existing.length >= MAX_RECORDS) throw new ProtocolError('CAPACITY', '活动记录已满');
    const record = seal(draft);
    write(record);
    return record;
  }

  function list(available: ReadonlySet<ActivitySource>, limit = defaultLimit): ActivityPage {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ProtocolError('INVALID_ARGUMENT', '活动记录范围无效');
    const records = readAll();
    const undone = new Set(records.filter(item => item.compensates && item.result === 'compensated').map(item => item.compensates));
    const visible = records.slice().reverse().slice(0, limit);
    return {
      earlierKept: records.length > visible.length,
      items: visible.map(item => ({
        id: item.id,
        at: item.at,
        source: item.source,
        summary: item.summary,
        risk: item.risk,
        result: item.result,
        why: {trigger: item.why.trigger, basis: item.why.basis},
        undoable: Boolean(item.compensation) && item.result === 'succeeded' && !item.compensates
          && !undone.has(item.id) && available.has(item.source),
      })),
    };
  }

  async function undo(id: string, run: (compensation: ActivityCompensation) => void | Promise<void>): Promise<ActivityRecord> {
    if (!RECORD_ID.test(id)) throw new ProtocolError('INVALID_ARGUMENT', '活动记录标识无效');
    const existing = readAll();
    const target = existing.find(item => item.id === id);
    if (!target) throw new ProtocolError('NOT_FOUND', '活动记录不存在');
    if (!target.compensation || target.result !== 'succeeded' || target.compensates) {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', '这条记录没有补偿动作');
    }
    if (existing.some(item => item.compensates === id && item.result === 'compensated')) {
      throw new ProtocolError('REVISION_CONFLICT', '这条记录已经撤销');
    }
    await run(target.compensation);
    return append({
      source: target.source,
      summary: `撤销：${target.summary}`,
      risk: target.risk,
      result: 'compensated',
      why: {trigger: '用户撤销', basis: `补偿动作 ${target.compensation.action}`},
      compensates: id,
      dedupeKey: `undo:${id}`,
    });
  }

  return {append, list, undo};
}
