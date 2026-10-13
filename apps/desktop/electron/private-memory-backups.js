import {existsSync, lstatSync, readdirSync, realpathSync, readFileSync, writeFileSync, renameSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';

/** Host-owned copies only. A note recovery image is not a per-fact SQLite backup. */
export function createPrivateMemoryBackupHost({userData, privateMemory}) {
  const root = path.resolve(userData);
  const directory = path.join(root, 'private-memory-backups');
  const recovery = path.join(root, 'knowledge-recovery');
  const manifest = path.join(root, 'private-memory-backups-inventory.json');
  const safe = (file, folder = false) => {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || (folder ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
      || path.resolve(realpathSync.native(file)).toLowerCase() !== path.resolve(file).toLowerCase()) {
      throw Error('应用备份身份不安全');
    }
  };
  const validateDatabase = file => {
    const probe = new DatabaseSync(file, {readOnly: true});
    try {
      for (const table of ['memory_facts', 'memory_erasure_intents', 'memory_user_creations', 'memory_feed_bindings']) {
        if (!probe.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
          throw Error('不是记忆备份');
        }
      }
      if (probe.prepare("SELECT 1 FROM memory_feed_bindings WHERE namespace='desktop-private' LIMIT 1").get()) {
        throw Error('备份存在绑定投影，不能按独立事实清理');
      }
    } finally {probe.close();}
  };
  function inventory() {
    safe(root, true);
    const copies = [];
    if (existsSync(directory)) {
      safe(directory, true);
      for (const name of readdirSync(directory).sort()) {
        if (!/^[A-Za-z0-9_-]{1,128}\.sqlite(?:-wal|-shm)?$/.test(name)) throw Error('存在未知应用备份');
        safe(path.join(directory, name));
        if (name.endsWith('.sqlite')) copies.push({kind: 'private_memory_backup', id: name});
        else if (!existsSync(path.join(directory, name.replace(/-(wal|shm)$/, '')))) throw Error('应用备份缺少原库');
      }
    }
    if (existsSync(recovery)) {
      safe(recovery, true);
      for (const key of readdirSync(recovery).sort()) {
        if (!/^[a-f0-9]{64}$/.test(key)) throw Error('知识备份清单未知');
        const folder = path.join(recovery, key); safe(folder, true);
        for (const name of readdirSync(folder).sort()) {
          safe(path.join(folder, name));
          if (/^[a-f0-9]{64}\.knowledge-backup$/.test(name)
            || /^[a-f0-9]{32}-[a-f0-9-]{36}\.bak$/.test(name)) {
            copies.push({kind: 'note_recovery_backup', id: key + '/' + name});
          } else if (!/^[a-f0-9]{64}\.(knowledge-operation\.json(?:\.tmp)?|knowledge-finalization\.json(?:\.[a-f0-9]{32}\.tmp)?|knowledge-pending)$/.test(name)
            && !/^[a-f0-9]{32}\.inflight$/.test(name)) {
            throw Error('知识备份格式未知');
          }
        }
      }
    }
    if (copies.length > 256) throw Error('应用备份数量超限');
    let previous = [];
    if (existsSync(manifest)) {
      safe(manifest);
      if (lstatSync(manifest).size > 65536) throw Error('应用备份登记超限');
      const saved = JSON.parse(readFileSync(manifest, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.copies) || saved.copies.length > 256
        || saved.copies.some(copy => !copy || !['private_memory_backup', 'note_recovery_backup'].includes(copy.kind)
          || typeof copy.id !== 'string' || Object.keys(copy).sort().join(',') !== 'id,kind')) {
        throw Error('应用备份登记损坏');
      }
      previous = saved.copies;
      if (previous.some(copy => !copies.some(current => current.kind === copy.kind && current.id === copy.id))) {
        throw Error('已登记应用备份失联，无法证明清除');
      }
    }
    if (JSON.stringify(previous) !== JSON.stringify(copies)) {
      if (existsSync(manifest + '.tmp')) safe(manifest + '.tmp');
      writeFileSync(manifest + '.tmp', JSON.stringify({version: 1, copies}), {mode: 0o600});
      renameSync(manifest + '.tmp', manifest);
    }
    return copies;
  }
  return Object.freeze({
    inventory,
    assertReady(copies) {
      if (JSON.stringify(copies) !== JSON.stringify(inventory())) throw Error('应用备份清单已变化');
      for (const copy of copies) {
        if (copy.kind === 'private_memory_backup') validateDatabase(path.join(directory, copy.id));
      }
    },
    async reconcile(scope) {
      const pendingBackupIds = [];
      let copies;
      try {copies = inventory();} catch {return {pendingBackupIds: ['inventory_unavailable']};}
      for (const copy of copies) {
        if (scope.signal.aborted || Date.parse(scope.deadline) <= Date.now()) throw Error('备份清理已取消或过期');
        if (copy.kind === 'note_recovery_backup') { pendingBackupIds.push(copy.id); continue; }
        const file = path.join(directory, copy.id);
        let store;
        try {
          safe(file);
          // Do not initialize/migrate arbitrary files to manufacture a valid backup.
          validateDatabase(file);
          store = openSqliteMemoryHost(file);
          privateMemory.filterRestoredHost(store, scope);
          // Filter uses exact tombstones and TRUNCATE WAL readback. VACUUM also removes older free pages.
          store.close(); store = undefined;
          const compact = new DatabaseSync(file);
          try {
            compact.exec('PRAGMA secure_delete=ON; VACUUM;');
            const result = compact.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
            if (result.busy !== 0 || result.log !== 0 || result.checkpointed !== 0) throw Error('备份仍被占用');
          } finally {compact.close();}
          safe(file);
        } catch {pendingBackupIds.push(copy.id);}
        finally {store?.close();}
      }
      return {pendingBackupIds};
    },
  });
}
