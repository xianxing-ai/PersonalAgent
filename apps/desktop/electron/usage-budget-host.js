import {createUsageBudget} from '@personal-agent/agentarts';
import {createEncryptedModuleStorage} from './encrypted-module-storage.js';

const LEDGER = 'ledger';
const POLICY = 'policy';
const NOTICES = 'notices';

function read(storage, key) {
  const value = storage.get(key);
  return value === undefined ? undefined : value;
}

/** Append-only ledger in the existing encrypted module file. Past entries are never rewritten. */
export function createUsageBudgetHost({userData, safeStorage, now, timeZone, onNotice}) {
  const storage = createEncryptedModuleStorage({userData, safeStorage, filename: 'usage-budget.json'});
  const store = {
    loadLedger() {
      const value = read(storage, LEDGER);
      if (value === undefined) return [];
      if (!Array.isArray(value)) throw Error('用量账本需要恢复');
      return value;
    },
    appendLedger(entry) {
      const current = store.loadLedger();
      if (!entry || entry.seq !== current.length + 1 || current.some(item => item.seq === entry.seq)) {
        throw Error('用量账本只能追加');
      }
      storage.set(LEDGER, [...current, entry]);
    },
    loadPolicy() { return read(storage, POLICY); },
    savePolicy(policy) { storage.set(POLICY, policy); },
    loadNotices() {
      const value = read(storage, NOTICES);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    },
    saveNotices(notices) { storage.set(NOTICES, notices); },
  };
  return createUsageBudget({store, now, timeZone, onNotice});
}
