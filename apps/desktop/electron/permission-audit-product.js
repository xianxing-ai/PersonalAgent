import {appendAudit, verifyAudit} from '@personal-agent/policy';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

/**
 * One permission list for the assistant, plus a hash-chained operation log.
 * Revocation still calls the existing sandbox rule and goal-cloud revoke ports.
 */
export function createPermissionAuditProduct({userData, list, revoke, now} = {}) {
  const file = userData ? path.join(userData, 'permission-audit.json') : '';
  let events = [];
  let unreadable = false;
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
    events = next;
    if (!file || unreadable) return;
    mkdirSync(path.dirname(file), {recursive: true});
    writeFileSync(file, JSON.stringify(events));
  }
  function record(action, subject) {
    if (unreadable || !verifyAudit(events).intact) return false;
    save(appendAudit(events, {at: clock().toISOString(), action, subject}));
    return true;
  }
  function auditView() {
    if (unreadable) return {intact: false, brokenAt: 0, count: 0, unreadable: true};
    const checked = verifyAudit(events);
    return {intact: checked.intact, brokenAt: checked.brokenAt, count: events.length, unreadable: false};
  }
  return {
    observeTools(tools) {
      if (!Array.isArray(tools)) throw Error('工具列表无效');
      return tools.map(tool => ({
        get descriptor() { return tool.descriptor; },
        execute: async (input, context) => {
          const result = await tool.execute(input, context);
          const name = tool.descriptor?.name ?? 'tool';
          const effect = tool.descriptor?.sideEffect ?? 'unknown';
          record('tool', `${name}:${effect}`.slice(0, 180));
          return result;
        },
      }));
    },
    snapshot() {
      const grants = typeof list === 'function' ? list() : [];
      if (!Array.isArray(grants)) throw Error('权限列表无效');
      return {grants, audit: auditView()};
    },
    handleAction(name, payload) {
      if (name === 'assistantPermissions.state') {
        if (payload !== undefined) throw Error('权限状态不接受参数');
        record('read', 'permissions');
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
