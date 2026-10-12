import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import type {KnowledgeNotePatch, KnowledgeWriteReceipt} from '@personal-agent/knowledge/write';
import type {KnowledgeToolTaskBindings} from './knowledge-tools.js';

export interface KnowledgeWriteProjectionPort {
  /** Revalidate existing facts only. Never writes source text or confirms new facts. */
  revalidate(input: {sourceId: string; configRevision: number; path: string},
    context: Pick<ToolContext, 'signal' | 'deadline'>): Promise<void>;
}
interface PendingProjection {
  runId: string; argumentsDigest: string; binding: string;
  sourceId: string; configRevision: number; path: string;
  state: 'unknown' | 'pending' | 'complete'; operationId?: string;
}
const key = 'knowledge-write-projections-v1';

/** Uses the original TaskRuntime checkpoint, separate from the durable source-write receipt. */
export function createKnowledgeWriteProjection(port: KnowledgeWriteProjectionPort,
  application: () => KnowledgeToolTaskBindings | undefined,
  acquire: (input: {sourceId: string; configRevision: number}, signal: AbortSignal) => {
    signal: AbortSignal; assertCurrent(): void; release(): void;
  }, binding: () => string) {
  const active = new Map<string, Promise<{pending: number; unknown: number}>>();
  const runtime = () => {
    const value = application()?.runtime;
    if (!value) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Knowledge projection is unbound');
    return value;
  };
  const load = (taskId: string): PendingProjection[] =>
    structuredClone((runtime().loadCheckpoint(taskId, key) ?? []) as PendingProjection[]);
  const save = (taskId: string, entries: PendingProjection[]) => runtime().saveCheckpoint(taskId, key, entries);
  return {
    prepare(input: KnowledgeNotePatch, context: ToolContext) {
      const entries = load(context.taskId);
      const prior = entries.find(item => item.runId === context.runId);
      if (prior) throw new ProtocolError('RESULT_UNKNOWN', 'Knowledge projection already tracks this execution');
      if (!context.argumentsDigest) throw new ProtocolError('INVALID_ARGUMENT', 'Knowledge execution digest is missing');
      entries.push({runId: context.runId, argumentsDigest: context.argumentsDigest, binding: binding(),
        sourceId: input.sourceId, configRevision: input.configRevision, path: input.path, state: 'unknown'});
      save(context.taskId, entries);
    },
    accept(taskId: string, runId: string, argumentsDigest: string, receipt: Pick<KnowledgeWriteReceipt,
      'operationId' | 'state' | 'changed'>, originalInput?: KnowledgeNotePatch) {
      const entries = load(taskId), item = entries.find(entry => entry.runId === runId);
      if (!item) return; // Executions predating projection checkpoints remain compatible.
      // A finalized original run acknowledges its old checkpoint, not a new read permit.
      // Normal tool receipts still require the current binding; recovery always checks it below.
      const sameSource = originalInput
        ? item.sourceId === originalInput.sourceId && item.configRevision === originalInput.configRevision
          && item.path === originalInput.path
        : item.binding === binding();
      if (item.argumentsDigest !== argumentsDigest || !sameSource) {
        throw new ProtocolError('SCOPE_DENIED', 'Knowledge projection execution binding changed');
      }
      if (item.state === 'complete') return;
      item.operationId = receipt.operationId;
      item.state = receipt.state === 'verified' && receipt.changed ? 'pending' : 'complete';
      save(taskId, entries);
    },
    recover(taskId: string, context: Pick<ToolContext, 'signal' | 'deadline'>) {
      const running = active.get(taskId);
      if (running) return running;
      const work = (async () => {
        for (const item of load(taskId).filter(entry => entry.state === 'pending')) {
          // Failed projection never changes a known source-write result. Keep its checkpoint for recovery.
          try {
            if (item.binding !== binding()) continue;
            const lease = acquire(item, context.signal);
            try {
              const check = () => {
                if (lease.signal.aborted) throw new ProtocolError('CANCELLED', 'Knowledge projection cancelled');
                if (!Number.isFinite(Date.parse(context.deadline)) || Date.now() >= Date.parse(context.deadline)) {
                  throw new ProtocolError('TIMEOUT', 'Knowledge projection deadline expired');
                }
                lease.assertCurrent();
              };
              check();
              await port.revalidate({sourceId: item.sourceId, configRevision: item.configRevision, path: item.path},
                {...context, signal: lease.signal});
              check();
              const entries = load(taskId), current = entries.find(entry => entry.runId === item.runId);
              if (!isDeepStrictEqual(current, item)) continue;
              current!.state = 'complete'; save(taskId, entries);
            } finally {lease.release();}
          } catch { /* The body may already be changed. Only this read/projection is recoverable. */ }
        }
        const entries = load(taskId);
        return {pending: entries.filter(item => item.state === 'pending').length,
          unknown: entries.filter(item => item.state === 'unknown').length};
      })().finally(() => active.delete(taskId));
      active.set(taskId, work); return work;
    },
  };
}
