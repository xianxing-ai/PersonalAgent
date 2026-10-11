import {createHash, randomUUID} from 'node:crypto';
import {lstatSync, realpathSync, statSync} from 'node:fs';
import * as path from 'node:path';
import {KnowledgeError} from './index.js';
import type {KnowledgePort} from './index.js';
import type {ObsidianReadOnlyPort} from './obsidian.js';

export interface ObsidianPairingDescriptor {
  readonly version: 1;
  readonly pluginId: 'personal-agent-knowledge';
  readonly sessionId: string;
  readonly vaultIdentity: string;
  readonly vaultId: string;
  readonly folder: string;
}

/** Host-only peer; an untrusted descriptor is never sufficient to construct one. */
export interface ObsidianPairingPeer extends KnowledgePort {
  describe(): ObsidianPairingDescriptor;
  readonly signal: AbortSignal;
  assertCurrent(): void;
  close(): void;
}

export function isPairingPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024
    && !/[\\:\u0000-\u001f]/.test(value) && !value.startsWith('/')
    && value.split('/').every(part => part && !part.startsWith('.') && !/[. ]$/.test(part));
}

export function parseObsidianPairingDescriptor(value: unknown): ObsidianPairingDescriptor {
  const data = value as ObsidianPairingDescriptor;
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).length !== 6
    || Object.keys(data).some(key => !['version', 'pluginId', 'sessionId', 'vaultIdentity', 'vaultId', 'folder'].includes(key))
    || data.version !== 1 || data.pluginId !== 'personal-agent-knowledge'
    || typeof data.sessionId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(data.sessionId)
    || typeof data.vaultIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(data.vaultIdentity)
    || typeof data.vaultId !== 'string' || !/^[a-f0-9]{64}$/.test(data.vaultId)
    || (data.folder !== '/' && !isPairingPath(data.folder))) throw new KnowledgeError('INVALID_ARGUMENT');
  return {...data};
}

/** Same physical Vault in both trusted hosts; never use its display name as identity. */
export function localVaultPairingIdentity(value: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.startsWith('\\\\')) throw new KnowledgeError('SCOPE_DENIED');
  const full = path.resolve(value), volume = path.parse(full).root;
  if (full === volume) throw new KnowledgeError('SCOPE_DENIED');
  let cursor = volume;
  for (const part of path.relative(volume, full).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new KnowledgeError('SCOPE_DENIED');
  }
  const canonical = realpathSync.native(full), stat = statSync(canonical, {bigint: true});
  if (!stat.isDirectory()) throw new KnowledgeError('SCOPE_DENIED');
  return createHash('sha256').update(JSON.stringify([canonical, String(stat.dev), String(stat.ino), String(stat.birthtimeNs)])).digest('hex');
}

export function createObsidianPairingPeer(options: {
  readonly port: ObsidianReadOnlyPort;
  readonly vaultIdentity: string;
  readonly vaultId: string;
  readonly folder: string;
  readonly bindingCurrent: () => boolean;
}): ObsidianPairingPeer {
  const descriptor = parseObsidianPairingDescriptor({version: 1, pluginId: 'personal-agent-knowledge',
    sessionId: randomUUID(), vaultIdentity: options.vaultIdentity, vaultId: options.vaultId, folder: options.folder});
  const controller = new AbortController();
  const assertCurrent = () => {
    if (controller.signal.aborted || !options.bindingCurrent()) throw new KnowledgeError('SCOPE_DENIED');
  };
  return {
    signal: controller.signal, assertCurrent,
    describe() {assertCurrent(); return {...descriptor};},
    async search(request) {
      assertCurrent();
      const signal = AbortSignal.any([request.signal, controller.signal]);
      if (signal.aborted) throw new KnowledgeError('CANCELLED');
      const result = await options.port.search({...request, signal});
      assertCurrent();
      if (signal.aborted) throw new KnowledgeError('CANCELLED');
      return result;
    },
    close() {controller.abort(); options.port.clearIndex();},
  };
}
