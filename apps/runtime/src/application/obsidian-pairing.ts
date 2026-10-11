import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import {createKnowledgeSearchTool} from '@personal-agent/knowledge/tool';
import {isPairingPath, parseObsidianPairingDescriptor} from '@personal-agent/knowledge/pairing';
import type {ObsidianPairingDescriptor, ObsidianPairingPeer} from '@personal-agent/knowledge/pairing';
import type {TrustedKnowledgeBinding, TrustedKnowledgeSource} from './knowledge-tools.js';

export interface ObsidianPairingOptions {
  readonly source: TrustedKnowledgeSource;
  /** Obtained from the native-selected source, never from the peer. */
  readonly vaultIdentity: () => string | undefined;
  readonly confirmPairing: (request: {
    readonly sourceId: string; readonly configRevision: number;
    readonly peer: ObsidianPairingDescriptor; readonly signal: AbortSignal;
  }) => Promise<boolean>;
}

/** A composition port, not a network endpoint or Policy authorization issuer. */
export function createObsidianPairingHost(options: ObsidianPairingOptions) {
  let closed = false, pairing = false;
  let controller: AbortController | undefined, expiration: NodeJS.Timeout | undefined;
  let active: {peer: ObsidianPairingPeer; descriptor: ObsidianPairingDescriptor;
    binding: TrustedKnowledgeBinding; lease: ReturnType<TrustedKnowledgeSource['acquire']>;
    original: TrustedKnowledgeBinding; expiresAt: number} | undefined;
  const revoke = () => {
    controller?.abort(); clearTimeout(expiration);
    const previous = active; active = undefined;
    try {previous?.lease.release();} catch { /* Capability is already disabled. */ }
    try {previous?.peer.close();} catch { /* An untrusted peer cannot prevent revocation. */ }
  };
  const check = () => {
    if (!active) throw new ProtocolError('SCOPE_DENIED', 'Obsidian pairing unavailable');
    if (closed || controller?.signal.aborted || Date.now() >= active.expiresAt) {
      revoke(); throw new ProtocolError('SCOPE_DENIED', 'Obsidian pairing unavailable');
    }
    try {
      active.lease.assertCurrent(); active.peer.assertCurrent();
      if (!isDeepStrictEqual(options.source.snapshot(), active.original)
        || options.vaultIdentity() !== active.descriptor.vaultIdentity
        || !isDeepStrictEqual(parseObsidianPairingDescriptor(active.peer.describe()), active.descriptor)) throw Error();
    } catch {revoke(); throw new ProtocolError('SCOPE_DENIED', 'Obsidian pairing changed');}
    return active;
  };
  const empty = (): TrustedKnowledgeBinding => ({sourceId: '', namespace: '', configRevision: 0,
    available: false, writeAvailable: false, dataLevel: 'private', cloudExportAllowed: false,
    publicQueries: [], allowedNotePaths: []});
  const source: TrustedKnowledgeSource = {
    snapshot() {try {return structuredClone(check().binding);} catch {return empty();}},
    acquire(expected, signal) {
      const session = check();
      if (expected.sourceId !== session.binding.sourceId || expected.configRevision !== session.binding.configRevision
        || signal.aborted) throw new ProtocolError('SCOPE_DENIED', 'Obsidian pairing binding mismatch');
      const local = new AbortController();
      const combined = AbortSignal.any([signal, local.signal, controller!.signal, session.lease.signal, session.peer.signal]);
      const assertCurrent = () => {
        if (combined.aborted || check() !== session) throw new ProtocolError('SCOPE_DENIED', 'Obsidian pairing revoked');
      };
      return {binding: structuredClone(session.binding), signal: combined, assertCurrent,
        release: () => local.abort(), read: {async search(request) {
          assertCurrent();
          const template = createKnowledgeSearchTool(session.peer).descriptor;
          validateToolValue(template.inputSchema, {query: request.query, limit: request.limit});
          const result = structuredClone(await bounded(signal => session.peer.search({...request, signal}),
            request.deadline, AbortSignal.any([request.signal, combined])));
          assertCurrent(); validateToolValue(template.outputSchema, result);
          if (result.hits.length > request.limit || result.hits.some(hit => hit.source.vaultId !== session.descriptor.vaultId
            || !isPairingPath(hit.source.path) || !/\.md$/i.test(hit.source.path)
            || session.descriptor.folder !== '/' && !hit.source.path.startsWith(session.descriptor.folder + '/'))) {
            throw new ProtocolError('SCOPE_DENIED', 'Obsidian result outside paired folder');
          }
          return {truncated: result.truncated, hits: result.hits.map(hit => ({excerpt: hit.excerpt,
            source: {...hit.source, vaultId: session.binding.sourceId}}))};
        }}};
    },
  };
  return {
    source, revoke,
    async pair(peer: ObsidianPairingPeer, context: {deadline: string; signal: AbortSignal}) {
      if (closed || pairing) throw new ProtocolError('SCOPE_DENIED', 'Obsidian pairing busy or closed');
      const descriptor = parseObsidianPairingDescriptor(peer.describe()), original = structuredClone(options.source.snapshot());
      if (!original.available || descriptor.vaultIdentity !== options.vaultIdentity()) {
        throw new ProtocolError('SCOPE_DENIED', 'Select the same local Vault before pairing');
      }
      revoke(); pairing = true; controller = new AbortController();
      const attempt = controller;
      let lease: ReturnType<TrustedKnowledgeSource['acquire']> | undefined;
      try {
        lease = options.source.acquire(original, attempt.signal);
        if (!Number.isFinite(Date.parse(context.deadline))) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid pairing deadline');
        const deadline = new Date(Math.min(Date.parse(context.deadline), Date.now() + 30_000)).toISOString();
        const signal = AbortSignal.any([context.signal, attempt.signal, lease.signal, peer.signal]);
        lease.assertCurrent(); peer.assertCurrent();
        const confirmed = await bounded(signal => options.confirmPairing({sourceId: original.sourceId,
          configRevision: original.configRevision, peer: {...descriptor}, signal}), deadline, signal);
        lease.assertCurrent(); peer.assertCurrent();
        if (!confirmed || signal.aborted || closed || attempt.signal.aborted
          || !isDeepStrictEqual(original, options.source.snapshot()) || options.vaultIdentity() !== descriptor.vaultIdentity
          || !isDeepStrictEqual(descriptor, parseObsidianPairingDescriptor(peer.describe()))) {
          throw new ProtocolError('SCOPE_DENIED', 'Obsidian pairing not confirmed or changed');
        }
        const binding: TrustedKnowledgeBinding = {...empty(), sourceId: randomUUID(), namespace: original.namespace,
          configRevision: 1, available: true};
        active = {peer, descriptor, binding, original, lease, expiresAt: Date.now() + 15 * 60_000};
        expiration = setTimeout(revoke, 15 * 60_000); expiration.unref();
        return structuredClone(binding);
      } catch (error) {
        attempt.abort();
        try {lease?.release();} catch { /* Failed attempts grant no capability. */ }
        try {peer.close();} catch { /* Preserve the original failure. */ }
        throw error;
      }
      finally {pairing = false;}
    },
    close() {closed = true; revoke();},
  };
}

async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, deadline: string, signal: AbortSignal): Promise<T> {
  const remaining = Date.parse(deadline) - Date.now();
  if (!Number.isFinite(remaining)) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid pairing deadline');
  if (signal.aborted) throw new ProtocolError('CANCELLED', 'Pairing cancelled');
  if (remaining <= 0) throw new ProtocolError('TIMEOUT', 'Pairing timed out');
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let timer: NodeJS.Timeout | undefined, abort: () => void = () => {};
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (combined.aborted) throw new ProtocolError('CANCELLED', 'Pairing cancelled');
      return run(combined);
    }), new Promise<never>((_, reject) => {
      abort = () => reject(new ProtocolError('CANCELLED', 'Pairing cancelled'));
      signal.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => {reject(new ProtocolError('TIMEOUT', 'Pairing timed out')); controller.abort();}, remaining);
    })]);
  } finally {clearTimeout(timer); signal.removeEventListener('abort', abort);}
}
