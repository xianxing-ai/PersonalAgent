import {isDeepStrictEqual} from 'node:util';
import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import type {FactRef} from '@personal-agent/memory';
import type {KnowledgeNotePatch, KnowledgeWriteReceipt} from '@personal-agent/knowledge/write';
import type {KnowledgeToolTaskBindings} from './knowledge-tools.js';

export interface KnowledgeFactRevalidationReceipt {
  version: 1; sourceId: string; configRevision: number; path: string; sourceRevision: string;
  memoryNamespace: string; coverage: 'observed_active_heads';
  facts: {previous: FactRef; current: FactRef; sourceDigest: string; sourceRevision: string; state: 'current' | 'withdrawn'; appended: boolean}[];
}
export interface KnowledgeWriteProjectionPort {
  /** Revalidate existing facts only. Never writes source text or confirms new facts. */
  revalidate(input: {sourceId: string; configRevision: number; path: string; expectedSha256?: string},
    context: Pick<ToolContext, 'signal' | 'deadline'>): Promise<KnowledgeFactRevalidationReceipt | void>;
}
interface PendingProjection {
  runId: string; argumentsDigest: string; binding: string;
  sourceId: string; configRevision: number; path: string;
  state: 'unknown' | 'pending' | 'complete'; operationId?: string;
  beforeSha256?: string; afterSha256?: string; factReadback?: KnowledgeFactRevalidationReceipt;
}
const key = 'knowledge-write-projections-v1';
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const factRef={type:'object',required:['id','revision'],additionalProperties:false,
  properties:{id:{type:'string',minLength:1},revision:{type:'integer',minimum:1}}};
const receiptSchema={type:'object',additionalProperties:false,
  required:['version','sourceId','configRevision','path','sourceRevision','memoryNamespace','coverage','facts'],properties:{
    version:{const:1},sourceId:{type:'string',minLength:1},configRevision:{type:'integer',minimum:1},path:{type:'string',minLength:1},
    sourceRevision:sha,memoryNamespace:{type:'string',minLength:1},coverage:{const:'observed_active_heads'},
    facts:{type:'array',items:{type:'object',additionalProperties:false,required:['previous','current','sourceDigest','sourceRevision','state','appended'],
      properties:{previous:factRef,current:factRef,sourceDigest:sha,sourceRevision:sha,state:{enum:['current','withdrawn']},appended:{type:'boolean'}}}}}};

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
        sourceId: input.sourceId, configRevision: input.configRevision, path: input.path, beforeSha256:input.expectedSha256,state: 'unknown'});
      save(context.taskId, entries);
    },
    accept(taskId: string, runId: string, argumentsDigest: string, receipt: Pick<KnowledgeWriteReceipt,
      'operationId' | 'state' | 'changed'> & Partial<Pick<KnowledgeWriteReceipt,'afterSha256'>>, originalInput?: KnowledgeNotePatch) {
      const entries = load(taskId), item = entries.find(entry => entry.runId === runId);
      if (!item) return; // Executions predating projection checkpoints remain compatible.
      // A finalized original run acknowledges its old checkpoint, not a new read permit.
      // Normal tool receipts still require the current binding; recovery always checks it below.
      const sameSource = originalInput
        ? item.sourceId === originalInput.sourceId && item.configRevision === originalInput.configRevision
          && item.path === originalInput.path
        : item.binding === binding();
      if (item.argumentsDigest !== argumentsDigest || !sameSource
        || item.operationId!==undefined && item.operationId!==receipt.operationId
        || item.afterSha256!==undefined && receipt.afterSha256!==undefined && item.afterSha256!==receipt.afterSha256) {
        throw new ProtocolError('SCOPE_DENIED', 'Knowledge projection execution binding changed');
      }
      if (item.state === 'complete') return;
      item.operationId = receipt.operationId;
      if (receipt.afterSha256!==undefined) {
        validateToolValue(sha,receipt.afterSha256);item.afterSha256=receipt.afterSha256;
      }
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
              const receipt=await port.revalidate({sourceId: item.sourceId, configRevision: item.configRevision, path: item.path,
                ...(item.afterSha256?{expectedSha256:item.afterSha256}:{})},
                {...context, signal: lease.signal});
              check();
              if (receipt!==undefined) {
                validateToolValue(receiptSchema,receipt);
                if (!item.afterSha256 || receipt.sourceRevision!==item.afterSha256 || receipt.sourceId!==item.sourceId
                  || receipt.configRevision!==item.configRevision || receipt.path!==item.path
                  || new Set(receipt.facts.map(fact=>fact.previous.id)).size!==receipt.facts.length
                  || receipt.facts.some(fact=>fact.previous.id!==fact.current.id
                    || fact.current.revision!==fact.previous.revision+(fact.appended?1:0)
                    || fact.appended!==(fact.state==='withdrawn'))) {
                  throw new ProtocolError('SCOPE_DENIED','Knowledge Fact readback changed its original source or versions');
                }
              }
              const entries = load(taskId), current = entries.find(entry => entry.runId === item.runId);
              if (!isDeepStrictEqual(current, item)) continue;
              if (receipt!==undefined) current!.factReadback=structuredClone(receipt);
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
