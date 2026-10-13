import {connectObsidianBridge, parseObsidianBridgeCode} from '@personal-agent/knowledge/bridge';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';

/** Root composition only: search grants and durable citation identities have separate leases. */
export function createDesktopObsidianPairing({source, createPairingHost, ui, userData, changed = () => {}}) {
  let mode = 'filesystem', busy = false, closed = false, epoch = new AbortController(), attempt;
  const file = userData && path.join(userData, 'obsidian-pairing-selection.json');
  if (file && existsSync(file)) {
    try {
      const text = readFileSync(file, 'utf8'); if (text.length > 1024) throw Error();
      const data = JSON.parse(text);
      if (!data || Object.keys(data).length !== 2 || data.version !== 1 || !['filesystem', 'plugin'].includes(data.mode)) throw Error();
      mode = data.mode;
    } catch {mode = 'plugin';} // A corrupt selection cannot silently restore file access.
  }
  const selectMode = next => {
    if (file) {
      mkdirSync(userData, {recursive: true});
      writeFileSync(file + '.tmp', JSON.stringify({version: 1, mode: next}), {mode: 0o600}); renameSync(file + '.tmp', file);
    }
    mode = next;
  };
  const host = createPairingHost({source, vaultIdentity: () => source.pairingIdentity(),
    confirmPairing: request => ui.confirm({...request, displayName: source.snapshot().displayName})});
  const invalidate = () => {epoch.abort(); epoch = new AbortController(); attempt?.abort(); host.revoke();};
  const selected = () => mode === 'plugin' ? host.source : source;
  const effectiveSource = {
    snapshot: () => selected().snapshot(),
    acquire(expected, signal) {
      if (closed) throw Error('知识桥接已关闭');
      const generation = epoch;
      const lease = selected().acquire(expected, AbortSignal.any([signal, generation.signal]));
      return {...lease, assertCurrent() {
        if (generation.signal.aborted || generation !== epoch) throw Error('知识来源已切换');
        lease.assertCurrent();
      }};
    },
  };
  const memorySource = {
    snapshot: () => (mode === 'plugin' ? host.wikiSource : source).snapshot(),
    clearIndex() {invalidate(); source.clearIndex?.(); changed();},
    acquireWiki(expected, context) {
      if (closed) throw Error('知识桥接已关闭');
      const generation = epoch;
      const lease = (mode === 'plugin' ? host.wikiSource : source).acquireWiki(expected,
        {...context, signal: AbortSignal.any([context.signal, generation.signal])});
      return {...lease, assertCurrent() {
        if (generation.signal.aborted || generation !== epoch) throw Error('知识来源已切换');
        lease.assertCurrent();
      }};
    },
  };
  return {
    source: effectiveSource, memorySource,
    snapshot() {return {mode, busy, available: !closed && mode === 'plugin' && host.source.snapshot().available,
      reason: busy ? '正在进行本机配对' : mode === 'plugin' ? host.source.snapshot().available
        ? 'Obsidian 已配对：私人、只读，最多 15 分钟' : 'Obsidian 配对未就绪或已失效，请重新配对或显式撤销' : '当前使用所选文件源'};},
    async pair() {
      if (closed || busy || !source.snapshot().available) throw Error('请先选择并启用同一个知识库');
      busy = true; attempt = new AbortController(); const current = attempt; changed();
      let peer;
      try {
        let code = await ui.requestCode(current.signal);
        if (!code || current.signal.aborted || closed) return;
        const descriptor = parseObsidianBridgeCode(code).descriptor;
        if (descriptor.vaultIdentity !== source.pairingIdentity()) throw Error('请选择与 Obsidian 相同的 Vault');
        // Cancel original task leases before selecting the plugin; failed pairing stays unavailable.
        epoch.abort(); epoch = new AbortController(); host.revoke(); selectMode('plugin'); changed();
        peer = await connectObsidianBridge(code, {deadline: new Date(Date.now() + 5000).toISOString(), signal: current.signal});
        code = undefined;
        await host.pair(peer, {deadline: new Date(Date.now() + 30000).toISOString(), signal: current.signal});
        peer.signal.addEventListener('abort', () => {host.revoke(); changed();}, {once: true});
      } catch {
        peer?.close(); host.revoke();
        throw Error('未能配对：请检查所选 Vault、配对码期限与原生确认，重新生成配对码后再试');
      } finally {busy = false; changed();}
    },
    useFilesystem() {invalidate(); selectMode('filesystem'); changed();},
    close() {closed = true; invalidate(); host.close(); ui.close();},
  };
}
