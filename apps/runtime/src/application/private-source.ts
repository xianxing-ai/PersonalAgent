import {KnowledgeError, type KnowledgeSource} from '@personal-agent/knowledge';
import type {ReadOnlyVaultPort} from '@personal-agent/knowledge/filesystem';
import {formatWikiCitationReference} from '@personal-agent/knowledge/wiki';
import type {WikiSource} from '@personal-agent/knowledge/wiki';
import type {MemoryReadContext} from '@personal-agent/memory';
import type {SqliteMemoryHost} from '@personal-agent/memory/sqlite';

export interface ConfirmedPrivateFact {
  readonly operationId: string;
  readonly summary: string;
}

/** Trusted host only; the callback must obtain a real user decision for this exact citation. */
export async function ingestConfirmedPrivateCitation(options: {
  readonly vault: Pick<ReadOnlyVaultPort, 'readCitation'>;
  readonly memory: Pick<SqliteMemoryHost, 'createUserFact' | 'reviseUserFact'>;
  readonly namespace: string;
  readonly factId: string;
  readonly expectedRevision: number | null;
  readonly source: KnowledgeSource;
  readonly observedAt: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly confirm: (citation: string) => Promise<ConfirmedPrivateFact | null>;
}, context: MemoryReadContext) {
  // Keep the confirmed source and write target stable across injected async ports.
  const {vault, memory, namespace, factId, expectedRevision, observedAt,
    validFrom, validUntil, confirm} = options;
  const source = structuredClone(options.source);
  const scope = {deadline: context.deadline, signal: context.signal};
  const read = () => vault.readCitation({source: structuredClone(source), ...scope});
  const citation = await read();
  const decision = await confirm(citation);
  if (decision === null) return null;
  const {operationId, summary} = decision;
  if (await read() !== citation) {
    throw new KnowledgeError('SOURCE_CHANGED');
  }
  const sourceRef = 'pageId' in source ? formatWikiCitationReference(source as WikiSource)
    : `${source.vaultId}/${source.path}#L${source.line}@${source.revision}`;
  const fields = {factId, operationId, summary, sourceRef, observedAt,
    validFrom, validUntil, ...scope};
  return expectedRevision === null
    ? memory.createUserFact(namespace, fields)
    : memory.reviseUserFact(namespace,
      {...fields, expectedRevision, sensitivity: 'private', state: 'active'});
}
