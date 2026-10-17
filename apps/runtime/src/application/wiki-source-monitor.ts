import {KnowledgeError} from '@personal-agent/knowledge';
import type {WikiPage, WikiPort} from '@personal-agent/knowledge/wiki';
import type {MemoryReadContext} from '@personal-agent/memory';
import type {TrustedKnowledgeBinding} from './knowledge-tools.js';

type Binding = Pick<TrustedKnowledgeBinding, 'sourceId' | 'namespace' | 'configRevision' | 'dataLevel' | 'available'>;
export interface WikiSourceMonitorOptions {
  source: {
    snapshot(): Binding;
    acquireWiki(expected: Binding, context: MemoryReadContext): {
      wiki: Pick<WikiPort, 'scanPages'>; signal: AbortSignal; assertCurrent(): void; release(): void;
    };
  };
  /** Missing paths on the first scan means validate all existing facts in this binding. */
  revalidate(input: {sourceId: string; configRevision: number; paths?: readonly string[]},
    context: MemoryReadContext): Promise<void>;
}
export interface WikiSourceMonitorStatus {
  state: 'idle' | 'checking' | 'ready' | 'retry_pending' | 'unavailable' | 'closed';
  pageCount: number;
  lastCheckedAt?: string;
}

/** Read-only resident service. The host's existing timer calls tick; no new timer or task store. */
export function createWikiSourceMonitor(options: WikiSourceMonitorOptions) {
  const lifetime = new AbortController();
  let status: WikiSourceMonitorStatus = {state: 'idle', pageCount: 0};
  let inventory: Map<string, WikiPage> | undefined;
  let bindingKey = '', nextCheckAt = 0;
  let active: Promise<void> | undefined;
  const key = (binding: Binding) => JSON.stringify([binding.namespace, binding.sourceId,
    binding.configRevision, binding.dataLevel]);
  const updateBinding = () => {
    const binding = options.source.snapshot();
    if (key(binding) !== bindingKey) {
      bindingKey = key(binding); inventory = undefined; nextCheckAt = 0;
      status = {state: 'idle', pageCount: 0};
    }
    return binding;
  };
  function refresh(context: MemoryReadContext): Promise<void> {
    if (lifetime.signal.aborted) return Promise.resolve();
    if (active) return active;
    const binding = updateBinding(), expectedKey = bindingKey;
    if (!binding.available) {status = {state: 'unavailable', pageCount: 0}; return Promise.resolve();}
    nextCheckAt = Date.now() + 30_000;
    status = {...status, state: 'checking'};
    const scope = {...context, signal: AbortSignal.any([context.signal, lifetime.signal])};
    const work = (async () => {
      let lease: ReturnType<WikiSourceMonitorOptions['source']['acquireWiki']> | undefined;
      try {
        lease = options.source.acquireWiki(binding, scope);
        scope.signal = AbortSignal.any([scope.signal, lease.signal]);
        const check = () => {
          if (scope.signal.aborted) throw new KnowledgeError('CANCELLED');
          if (!Number.isFinite(Date.parse(scope.deadline)) || Date.now() >= Date.parse(scope.deadline)) throw new KnowledgeError('TIMEOUT');
          if (key(options.source.snapshot()) !== expectedKey || !options.source.snapshot().available) throw new KnowledgeError('SCOPE_DENIED');
          lease!.assertCurrent();
        };
        check();
        const pages = await lease.wiki.scanPages(scope); check();
        const current = new Map(pages.map(page => [page.pageId, {...page}]));
        const paths = new Set<string>();
        if (inventory) {
          for (const [id, page] of current) {
            const prior = inventory.get(id);
            if (!prior || prior.path !== page.path || prior.revision !== page.revision) {
              paths.add(page.path); if (prior) paths.add(prior.path);
            }
          }
          for (const [id, page] of inventory) if (!current.has(id)) paths.add(page.path);
        }
        if (!inventory || paths.size) {
          await options.revalidate({sourceId: binding.sourceId, configRevision: binding.configRevision,
            ...(inventory ? {paths: [...paths]} : {})}, scope);
        }
        check();
        inventory = current;
        status = {state: 'ready', pageCount: current.size, lastCheckedAt: new Date().toISOString()};
      } catch {
        if (!lifetime.signal.aborted) {
          // Never expose private paths or exception text; failed scans do not advance the inventory.
          status = {...status, state: options.source.snapshot().available ? 'retry_pending' : 'unavailable'};
        }
      } finally {lease?.release();}
    })().finally(() => {active = undefined;});
    active = work; return work;
  }
  return {
    snapshot(): WikiSourceMonitorStatus {return {...status};},
    refresh,
    async tick(): Promise<boolean> {
      if (lifetime.signal.aborted || active) return false;
      const previous = JSON.stringify(status), binding = updateBinding();
      if (!binding.available) {
        status = {state: 'unavailable', pageCount: 0};
        return previous !== JSON.stringify(status);
      }
      if (Date.now() < nextCheckAt) return false;
      await refresh({deadline: new Date(Date.now() + 30_000).toISOString(), signal: lifetime.signal});
      return true;
    },
    close() {
      lifetime.abort(); inventory = undefined;
      status = {state: 'closed', pageCount: 0};
    },
  };
}
