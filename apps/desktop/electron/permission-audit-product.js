import {appendAudit, verifyAudit} from '@personal-agent/policy';
import {randomUUID} from 'node:crypto';
import {closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

/** Write JSON atomically in the target directory: unique temp file -> fsync -> rename. */
function atomicWriteJson(file, value) {
  mkdirSync(path.dirname(file), {recursive: true});
  const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let fd;
  let renamed = false;
  try {
    fd = openSync(tempFile, 'w');
    writeFileSync(fd, JSON.stringify(value), 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tempFile, file);
    renamed = true;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
    if (!renamed && existsSync(tempFile)) {
      try { rmSync(tempFile, {force: true}); } catch {}
    }
  }
}

/**
 * One permission list for the assistant, plus a hash-chained operation log.
 * Revocation still calls the existing sandbox rule and goal-cloud revoke ports.
 */
export function createPermissionAuditProduct({userData, list, revoke, now, onUpdate} = {}) {
  const file = userData ? path.join(userData, 'permission-audit.json') : '';
  let events = [];
  let unreadable = false;
  let skippedCount = 0;
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed)) throw Error('shape');
      events = parsed;
    } catch {
      unreadable = true;
    }
  }
  const clock = now ?? (() => new Date());
  function save(next) {
    if (file && !unreadable) atomicWriteJson(file, next);
    events = next;
  }
  function record(action, subject) {
    if (unreadable || !verifyAudit(events).intact) {
      skippedCount += 1;
      onUpdate?.();
      return false;
    }
    save(appendAudit(events, {at: clock().toISOString(), action, subject}));
    return true;
  }
  function auditView() {
    if (unreadable) {
      return {
        intact: false,
        brokenAt: 0,
        count: 0,
        unreadable: true,
        recordingStopped: true,
        skippedCount,
        warning: `审计日志无法读取，已停止追加新记录（${skippedCount} 条未写入）`,
      };
    }
    const checked = verifyAudit(events);
    return {
      intact: checked.intact,
      brokenAt: checked.brokenAt,
      count: events.length,
      unreadable: false,
      recordingStopped: !checked.intact,
      skippedCount,
      ...(!checked.intact
        ? {warning: `审计链在第 ${checked.brokenAt} 条损坏，已停止追加新记录（${skippedCount} 条未写入）`}
        : {}),
    };
  }
  function failureStatus(error) {
    if (error?.code === 'TIMEOUT') return 'timeout';
    if (error?.code === 'UNAUTHORIZED' || error?.code === 'SCOPE_DENIED') return 'denied';
    if (error?.code === 'CANCELLED') return 'cancelled';
    return 'failed';
  }
  return {
    observeTools(tools) {
      if (!Array.isArray(tools)) throw Error('工具列表无效');
      return tools.map(tool => ({
        get descriptor() { return tool.descriptor; },
        execute: async (input, context) => {
          const name = tool.descriptor?.name ?? 'tool';
          const effect = tool.descriptor?.sideEffect ?? 'unknown';
          let settled = false;
          const signal = context?.signal;
          const onAbort = () => {
            if (settled) return;
            settled = true;
            const status = signal?.reason === 'timeout' ? 'timeout' : 'aborted';
            record('tool', `${name}:${effect}:${status}`.slice(0, 180));
          };
          signal?.addEventListener?.('abort', onAbort, {once: true});
          try {
            const result = await tool.execute(input, context);
            if (!settled) {
              settled = true;
              const state = result && typeof result === 'object' ? result.state : undefined;
              const outcome = ['failed', 'denied', 'cancelled', 'timeout', 'unknown'].includes(state) ? state : 'ok';
              record('tool', `${name}:${effect}:${outcome}`.slice(0, 180));
            }
            return result;
          } catch (error) {
            if (!settled) {
              settled = true;
              record('tool', `${name}:${effect}:${failureStatus(error)}`.slice(0, 180));
            }
            throw error;
          } finally {
            signal?.removeEventListener?.('abort', onAbort);
          }
        },
      }));
    },
    recordEvent(action, subject) {
      if (typeof action !== 'string' || !action.trim() || typeof subject !== 'string' || !subject.trim()) return false;
      return record(action.slice(0, 64), subject.slice(0, 180));
    },
    snapshot() {
      const grants = typeof list === 'function' ? list() : [];
      if (!Array.isArray(grants)) throw Error('权限列表无效');
      return {grants, audit: auditView()};
    },
    handleAction(name, payload) {
      if (name === 'assistantPermissions.state') {
        if (payload !== undefined) throw Error('权限状态不接受参数');
        return this.snapshot();
      }
      if (name === 'assistantPermissions.revoke') {
        const grants = typeof list === 'function' ? list() : [];
        const grant = grants.find(item => item.id === payload?.id && item.kind === payload.kind);
        if (!grant?.revocable) throw Error('这项许可不能撤销');
        if (grant.revision !== payload?.revision) throw Error('许可已变化，请刷新');
        const result = revoke?.(grant);
        const recorded = record('revoke', `${grant.kind}:${grant.id}`.slice(0, 180));
        return {...this.snapshot(), recorded, result: result ?? {revoked: true}};
      }
      throw Error('不支持的权限操作');
    },
  };
}
