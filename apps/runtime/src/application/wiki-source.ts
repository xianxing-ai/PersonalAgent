import {KnowledgeError} from '@personal-agent/knowledge';
import {parseWikiCitationReference} from '@personal-agent/knowledge/wiki';
import type {WikiPort} from '@personal-agent/knowledge/wiki';
import {MemoryQueryError} from '@personal-agent/memory';
import type {FactRef, FactVersion, MemoryReadContext} from '@personal-agent/memory';
import type {SqliteMemoryHost} from '@personal-agent/memory/sqlite';

export interface WikiFactValidation {
  readonly state: 'current' | 'withdrawn' | 'source_unavailable';
  readonly fact: FactVersion;
  readonly appended: boolean;
}

/** A fresh trusted local read lease verifies the original evidence, without inferring new private facts. */
export async function revalidateWikiFact(options: {
  readonly wiki: Pick<WikiPort, 'readReference' | 'scanPages'>;
  readonly memory: Pick<SqliteMemoryHost, 'readUserFactHead' | 'invalidateUserFactSource'>;
  readonly namespace: string;
  readonly fact: FactRef;
  readonly assertCurrent: () => void;
}, context: MemoryReadContext): Promise<WikiFactValidation> {
  const {wiki, memory, namespace, assertCurrent} = options;
  const ref = structuredClone(options.fact);
  const scope = {...context};
  const check = () => {
    if (scope.signal.aborted) throw new KnowledgeError('CANCELLED');
    if (!Number.isFinite(Date.parse(scope.deadline)) || Date.now() >= Date.parse(scope.deadline)) throw new KnowledgeError('TIMEOUT');
    assertCurrent();
  };
  check();
  const current = memory.readUserFactHead(namespace, ref.id);
  if (!current || current.ref.revision !== ref.revision) throw new MemoryQueryError('REVISION_CONFLICT');
  if (current.state === 'withdrawn') return {state: 'withdrawn', fact: current, appended: false};
  const source = parseWikiCitationReference(current.sourceRef);
  if (!source) throw new KnowledgeError('INVALID_ARGUMENT');
  try {
    await wiki.readReference({source, ...scope});
    check();
    return {state: 'current', fact: current, appended: false};
  } catch (error) {
    check();
    if (!(error instanceof KnowledgeError)) throw error;
    if (error.code === 'SCOPE_DENIED') return {state: 'source_unavailable', fact: current, appended: false};
    if (error.code === 'SOURCE_UNAVAILABLE') {
      // Only a successfully read, same-identity page at a different location proves a move.
      try {
        const pages = await wiki.scanPages(scope);
        check();
        const moved = pages.find(page => page.pageId === source.pageId && page.path !== source.path
          && page.sourceId === source.sourceId && page.namespace === source.namespace
          && page.configRevision === source.configRevision && page.dataLevel === source.dataLevel);
        if (!moved) return {state: 'source_unavailable', fact: current, appended: false};
        await wiki.readReference({source: {...source, path: moved.path, revision: moved.revision}, ...scope});
        check();
      } catch (scanError) {
        check();
        if (scanError instanceof KnowledgeError && ['SOURCE_UNAVAILABLE', 'SOURCE_CHANGED', 'SCOPE_DENIED'].includes(scanError.code)) {
          return {state: 'source_unavailable', fact: current, appended: false};
        }
        throw scanError;
      }
    } else if (error.code !== 'SOURCE_CHANGED') throw error;
    check();
    const result = memory.invalidateUserFactSource(namespace, {factId: ref.id, expectedRevision: ref.revision,
      sourceRef: current.sourceRef, observedAt: new Date().toISOString(), ...scope});
    return {state: 'withdrawn', ...result};
  }
}
