import path from 'node:path';
import {
  createActivityLedger,
  fromAutonomyAudit,
  fromPluginAction,
  fromProactiveOutcome,
  fromRepairDecision,
} from '@personal-agent/activity';

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;
const REASON_CODE_RE = /^[A-Za-z0-9_:. -]{1,120}$/;
const REPAIR_STRATEGIES = new Set([
  'backoff_retry', 'change_arguments', 'change_tool', 'degrade_readonly',
  'request_parent_replan', 'reconcile_status', 'stop',
]);
const REPAIR_CLASSES = new Set(['transient', 'correctable', 'unrecoverable']);
const REPAIR_ATTEMPT_RESULTS = new Set(['selected', 'awaiting_approval', 'held_for_backoff', 'stopped', 'reconcile']);

function sanitizeToken(value, fallback = 'unknown') {
  const cleaned = String(value ?? '').replace(/[^A-Za-z0-9._:-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 81);
  return TOKEN_RE.test(cleaned) ? cleaned : fallback;
}

/**
 * Projects a persisted `repair-decision:v1` checkpoint into a safe `fromRepairDecision`
 * payload without copying any FailureSignal message text.
 */
export function projectRepairActivityFromCheckpoint(taskId, checkpoint, toolName) {
  if (!checkpoint || typeof checkpoint !== 'object' || checkpoint.version !== 1) return undefined;
  const attempts = checkpoint.trace?.attempts;
  if (!Array.isArray(attempts) || attempts.length === 0) return undefined;
  const latest = attempts.at(-1);
  if (!latest || typeof latest !== 'object') return undefined;
  const strategy = REPAIR_STRATEGIES.has(latest.strategy) ? latest.strategy : undefined;
  const classification = REPAIR_CLASSES.has(latest.classification) ? latest.classification : undefined;
  const attemptResult = REPAIR_ATTEMPT_RESULTS.has(latest.result) ? latest.result : undefined;
  if (!strategy || !classification || !attemptResult) return undefined;
  const risk = checkpoint.risk === 'high' ? 'high' : 'ordinary';
  const recoveryState = typeof checkpoint.recovery?.state === 'string' && /^[a-z_]+$/.test(checkpoint.recovery.state)
    ? checkpoint.recovery.state : 'recorded';
  const safeReason = typeof latest.reason === 'string' && REASON_CODE_RE.test(latest.reason)
    ? latest.reason
    : `repair:${classification}:${strategy}:${recoveryState}`;
  const safeTaskToken = sanitizeToken(taskId, 'task');
  const fingerprint = sanitizeToken(`${safeTaskToken}:${Number.isSafeInteger(latest.attempt) ? latest.attempt : attempts.length}`, 'repair');
  const safeTool = typeof toolName === 'string' && TOKEN_RE.test(toolName) ? toolName : undefined;
  const canStopRetry = strategy !== 'stop' && attemptResult === 'selected' && TOKEN_RE.test(String(taskId ?? ''));
  return {
    ...(typeof latest.observedAt === 'string' && !Number.isNaN(Date.parse(latest.observedAt)) ? {at: latest.observedAt} : {}),
    fingerprint,
    strategy,
    classification,
    risk,
    attemptResult,
    reason: safeReason,
    ...(safeTool ? {toolName: safeTool} : {}),
    ...(canStopRetry ? {compensationRef: String(taskId)} : {}),
  };
}

/** Desktop owner of the append-only activity ledger. Compensation stays unavailable unless bound. */
export function createActivityHost({file, onUpdate = () => {}, now, idFactory} = {}) {
  const ledger = createActivityLedger({file, ...(now ? {now} : {}), ...(idFactory ? {idFactory} : {})});
  let plugin;
  let autonomy;
  let repair;
  let mute = false;

  function note(notice) {
    if (mute || !notice) return;
    ledger.append(fromPluginAction({
      pluginId: notice.pluginId,
      action: notice.action,
      risk: notice.riskLevel,
      result: 'succeeded',
      generation: notice.generation,
    }));
    onUpdate();
  }

  function recordFailure(notice) {
    if (!notice) return;
    ledger.append(fromPluginAction({
      pluginId: notice.pluginId,
      action: notice.action,
      risk: notice.riskLevel,
      result: 'failed',
    }));
    onUpdate();
  }

  function recordAutonomy(input) {
    if (mute || !input || typeof input !== 'object') return undefined;
    const entry = ledger.append(fromAutonomyAudit({
      ...(input.at !== undefined ? {at: input.at} : {}),
      auditId: input.auditId,
      toolName: input.toolName,
      tier: input.tier,
      ...(input.irreversible !== undefined ? {irreversible: input.irreversible} : {}),
      disposition: input.disposition,
      compensatable: Boolean(input.compensatable),
      rollback: input.rollback,
      reason: input.reason,
      ...(input.compensationToolName !== undefined ? {compensationToolName: input.compensationToolName} : {}),
      ...(input.result !== undefined ? {result: input.result} : {}),
    }));
    onUpdate();
    return entry;
  }

  function recordProactive(input) {
    if (mute || !input || typeof input !== 'object') return undefined;
    // Never forward SourceChangeEvent.summary or message bodies into the activity ledger.
    const entry = ledger.append(fromProactiveOutcome({
      ...(input.at !== undefined ? {at: input.at} : {}),
      eventId: sanitizeToken(input.eventId, 'event'),
      source: input.source,
      ...(input.kind !== undefined ? {kind: input.kind} : {}),
      status: input.status,
      ...(input.ruleId !== undefined ? {ruleId: input.ruleId} : {}),
      risk: input.risk === 'high' ? 'high' : 'low',
      ...(input.compensationRef !== undefined ? {compensationRef: input.compensationRef} : {}),
    }));
    onUpdate();
    return entry;
  }

  function recordRepair(input) {
    if (mute || !input || typeof input !== 'object') return undefined;
    // Never forward FailureSignal.message; only fixed decision codes enter the ledger.
    const entry = ledger.append(fromRepairDecision({
      ...(input.at !== undefined ? {at: input.at} : {}),
      fingerprint: input.fingerprint,
      strategy: input.strategy,
      classification: input.classification,
      risk: input.risk,
      attemptResult: input.attemptResult,
      reason: input.reason,
      ...(input.toolName !== undefined ? {toolName: input.toolName} : {}),
      ...(input.compensationRef !== undefined ? {compensationRef: input.compensationRef} : {}),
    }));
    onUpdate();
    return entry;
  }

  return {
    note,
    recordFailure,
    recordAutonomy,
    recordProactive,
    recordRepair,
    bindPlugin(port) { plugin = port; },
    bindAutonomy(port) { autonomy = port; },
    bindRepair(port) { repair = port; },
    snapshot() {
      const undoable = new Set();
      if (plugin) undoable.add('plugin');
      if (autonomy) undoable.add('autonomy');
      if (repair) undoable.add('repair');
      return ledger.list(undoable);
    },
    async undo(id) {
      if (typeof id !== 'string') throw Error('撤销请求无效');
      await ledger.undo(id, async compensation => {
        if (compensation.action === 'uninstall' || compensation.action === 'disable') {
          if (!plugin) throw Error('这条记录的补偿还没有接入');
          mute = true;
          try {
            if (compensation.action === 'uninstall') plugin.uninstall(compensation.ref);
            else plugin.disable(compensation.ref);
          } finally {
            mute = false;
          }
          return;
        }
        if (compensation.action === 'revert') {
          if (!autonomy || typeof autonomy.revert !== 'function') throw Error('这条记录的补偿还没有接入');
          mute = true;
          try { await autonomy.revert(compensation.ref); }
          finally { mute = false; }
          return;
        }
        if (compensation.action === 'stop_retry') {
          if (!repair || typeof repair.stopRetry !== 'function') throw Error('这条记录的补偿还没有接入');
          mute = true;
          try { await repair.stopRetry(compensation.ref); }
          finally { mute = false; }
          return;
        }
        throw Error('这条记录的补偿还没有接入');
      });
      onUpdate();
      return this.snapshot();
    },
  };
}

/** Product wiring used by the desktop startup path. The ledger file lives in userData. */
export function openDesktopActivity({userData, onUpdate = () => {}} = {}) {
  if (typeof userData !== 'string' || userData.length === 0) throw Error('活动记录目录无效');
  const host = createActivityHost({file: path.join(userData, 'activity-ledger.jsonl'), onUpdate});
  return {
    snapshot: () => host.snapshot(),
    note: notice => host.note(notice),
    recordFailure: notice => host.recordFailure(notice),
    recordAutonomy: input => host.recordAutonomy(input),
    recordProactive: input => host.recordProactive(input),
    recordRepair: input => host.recordRepair(input),
    bindPlugin(port) { host.bindPlugin(port); },
    bindAutonomy(port) { host.bindAutonomy(port); },
    bindRepair(port) { host.bindRepair(port); },
    handle(name, payload) {
      if (name !== 'activity.undo') return undefined;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || typeof payload.id !== 'string' || Object.keys(payload).some(key => key !== 'id')) {
        throw Error('撤销请求无效');
      }
      return host.undo(payload.id);
    },
  };
}
