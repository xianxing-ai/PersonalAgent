import {ProtocolError} from '@personal-agent/contracts';
import {MemoryQueryError} from '@personal-agent/memory';
import type {FactVersion, MemoryQueryPort, MemoryReadContext} from '@personal-agent/memory';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';
import {isAbsolute} from 'node:path';
import type {RuntimeApplication} from './runtime-application.js';
import {createSqliteFactProjectionHost} from './sqlite-fact-projection.js';
import type {SqliteFactProjectionHost} from './sqlite-fact-projection.js';
import {createBoundPublicFactErasureApplication} from './memory-learning.js';

export interface CompetitionFactHostOptions {
  /** A separate, trusted host-owned SQLite file; never the Runtime database. */
  readonly memoryPath: string;
  readonly memoryNamespace: string;
  readonly graphNamespace: string;
  readonly consumerKey: string;
}

export interface PublicSourceKey {
  readonly vaultId: string;
  readonly path: string;
  readonly factId: string;
}

export interface TrustedPublicSource extends PublicSourceKey {
  /** SHA-256 revision obtained by independently reading the approved local source. */
  readonly sourceRevision: string;
  readonly line: number;
  readonly summary: string;
  readonly observedAt: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly expectedFactRevision: number | null;
}

export interface TrustedPublicWithdrawal extends PublicSourceKey {
  readonly withdrawalId: string;
  readonly expectedFactRevision: number;
  readonly observedAt: string;
}

export interface CompetitionFactHost extends SqliteFactProjectionHost {
  /** Fixed host namespace and public scope. Withdrawn/erased facts cannot be read through history. */
  readonly publicMemory: MemoryQueryPort;
  createPublicFactErasureApplication(options:{confirm:(ref:{id:string;revision:number})=>Promise<boolean>}): ReturnType<typeof createBoundPublicFactErasureApplication>;
  /** Host-only first phase after an independently authorized deletion decision. */
  beginFactErasure(request: MemoryReadContext & {readonly factId: string;
    readonly expectedRevision: number; readonly operationId: string}): void;
  readPublicSourceHead(key: PublicSourceKey): number | null;
  recordPublicSource(source: TrustedPublicSource, context: MemoryReadContext):
    {readonly fact: FactVersion; readonly appended: boolean};
  withdrawPublicSource(source: TrustedPublicWithdrawal, context: MemoryReadContext):
    {readonly fact: FactVersion; readonly appended: boolean};
  close(): void;
}

/** Trusted Competition composition. Only the host may assert a local source was read and checked. */
export function createCompetitionFactHost(
  application: RuntimeApplication, options: CompetitionFactHostOptions
): CompetitionFactHost {
  // Capture the host scope once; later caller config mutation cannot redirect
  // source reads or writes away from the already-bound projection.
  const {memoryPath, memoryNamespace, graphNamespace, consumerKey} = options;
  if (application.profile !== 'huawei_ict_agentarts'
    || !isAbsolute(memoryPath)
    || !memoryNamespace?.trim() || !graphNamespace?.trim() || !consumerKey?.trim()) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid Competition Fact host configuration');
  }
  const memory = openSqliteMemoryHost(memoryPath);
  let closed = false;
  const active = () => {
    if (closed) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Competition Fact host is closed');
  };
  try {
    memory.provision(memoryNamespace);
    const query = memory.bind(memoryNamespace, {allowedSensitivities: ['public']});
    const readableHead = async (factId: string, context: MemoryReadContext) => {
      active();
      const page = await query.listCurrent({factId, at: new Date().toISOString(), limit: 1,
        deadline: context.deadline, signal: context.signal});
      active();
      const head = page.facts.find(fact => fact.ref.id === factId && fact.state === 'active' && fact.sensitivity === 'public');
      if (!head) throw new MemoryQueryError('SCOPE_DENIED');
      return head;
    };
    const publicMemory: MemoryQueryPort = Object.freeze({
      listCurrent: async (request: Parameters<MemoryQueryPort['listCurrent']>[0]) => {
        active(); const page = await query.listCurrent(request); active();
        const facts: FactVersion[] = [];
        for (const fact of page.facts) {
          try {
            // An old pagination snapshot cannot retain a corrected, withdrawn or erased public source.
            const head = await readableHead(fact.ref.id, request);
            if (head.ref.revision === fact.ref.revision) facts.push(fact);
          } catch (error) {
            if (!(error instanceof MemoryQueryError) || error.code !== 'SCOPE_DENIED') throw error;
          }
        }
        active(); return {...page, facts};
      },
      listHistory: async (request: Parameters<MemoryQueryPort['listHistory']>[0]) => {
        await readableHead(request.factId, request);
        const page = await query.listHistory(request); active();
        await readableHead(request.factId, request);
        return {...page, facts: page.facts.filter(fact => fact.sensitivity === 'public' && fact.state === 'active')};
      },
      getVersion: async (request: Parameters<MemoryQueryPort['getVersion']>[0]) => {
        await readableHead(request.fact.id, request);
        const fact = await query.getVersion(request); active();
        await readableHead(request.fact.id, request);
        if (fact.sensitivity !== 'public' || fact.state !== 'active') throw new MemoryQueryError('SCOPE_DENIED');
        return fact;
      },
    });
    const projection = createSqliteFactProjectionHost({memory, runtime: application.runtime,
      memoryNamespace, graphNamespace, consumerKey});
    return Object.freeze({
      publicMemory,
      createPublicFactErasureApplication:({confirm}:{confirm:(ref:{id:string;revision:number})=>Promise<boolean>})=>{
        active();
        const erasure=createBoundPublicFactErasureApplication({profile:'huawei_ict_agentarts',memory,
          runtime:application.runtime,projection,memoryNamespace,graphNamespace,confirm});
        return Object.freeze({erase:async(request:Parameters<typeof erasure.erase>[0])=>{active();return erasure.erase(request);},
          reconcile:async(context:MemoryReadContext)=>{active();return erasure.reconcile(context);}});
      },
      beginFactErasure: (request: MemoryReadContext & {readonly factId: string;
        readonly expectedRevision: number; readonly operationId: string}) => {
        active();
        memory.beginFactErasure(memoryNamespace, request);
      },
      preflightErasure: (factId: string, request: MemoryReadContext) => {
        active();
        return projection.preflightErasure(factId, request);
      },
      resumeFactErasure: (request: Parameters<SqliteFactProjectionHost['resumeFactErasure']>[0]) => {
        active();
        return projection.resumeFactErasure(request);
      },
      readPublicSourceHead: (key: PublicSourceKey) => {
        active();
        return memory.readPublicSourceHead(memoryNamespace, key);
      },
      recordPublicSource: (source: TrustedPublicSource, context: MemoryReadContext) => {
        active();
        return memory.appendPublicSource(memoryNamespace,
          {...source, deadline: context.deadline, signal: context.signal});
      },
      withdrawPublicSource: (source: TrustedPublicWithdrawal, context: MemoryReadContext) => {
        active();
        return memory.withdrawPublicSource(memoryNamespace,
          {...source, deadline: context.deadline, signal: context.signal});
      },
      consume: (request: Parameters<SqliteFactProjectionHost['consume']>[0]) => {
        active();
        return projection.consume(request);
      },
      drain: (request: Parameters<SqliteFactProjectionHost['drain']>[0]) => {
        active();
        return projection.drain(request);
      },
      processImpacts: (request: Parameters<SqliteFactProjectionHost['processImpacts']>[0]) => {
        active();
        return projection.processImpacts(request);
      },
      readCompletedImpact: (batchToken: string) => {
        active();
        return projection.readCompletedImpact(batchToken);
      },
      listImpactReceipts: (request: Parameters<SqliteFactProjectionHost['listImpactReceipts']>[0]) => {
        active();
        return projection.listImpactReceipts(request);
      },
      close: () => {
        if (closed) return;
        closed = true;
        memory.close();
      },
    });
  } catch (error) {
    memory.close();
    throw error;
  }
}
