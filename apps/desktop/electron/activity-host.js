import path from 'node:path';
import {createActivityLedger, fromPluginAction} from '@personal-agent/activity';

/** Desktop owner of the append-only activity ledger. Compensation for unmerged sources stays unavailable. */
export function createActivityHost({file, onUpdate = () => {}, now, idFactory} = {}) {
  const ledger = createActivityLedger({file, ...(now ? {now} : {}), ...(idFactory ? {idFactory} : {})});
  let plugin;
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

  return {
    note,
    recordFailure,
    bindPlugin(port) { plugin = port; },
    snapshot() {
      return ledger.list(new Set(plugin ? ['plugin'] : []));
    },
    async undo(id) {
      if (typeof id !== 'string') throw Error('撤销请求无效');
      await ledger.undo(id, async compensation => {
        if (!plugin || (compensation.action !== 'uninstall' && compensation.action !== 'disable')) {
          throw Error('这条记录的补偿还没有接入');
        }
        mute = true;
        try {
          if (compensation.action === 'uninstall') plugin.uninstall(compensation.ref);
          else plugin.disable(compensation.ref);
        } finally {
          mute = false;
        }
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
    bindPlugin(port) { host.bindPlugin(port); },
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
