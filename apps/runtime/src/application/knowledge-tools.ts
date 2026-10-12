import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext, ToolHost} from '@personal-agent/contracts';
import type {KnowledgePort} from '@personal-agent/knowledge';
import {createKnowledgeSearchTool} from '@personal-agent/knowledge/tool';
import {createKnowledgeWriteTool} from '@personal-agent/knowledge/write';
import type {KnowledgeNotePatch, KnowledgeWriteReceipt, KnowledgeWritePort, KnowledgeWriteFinalizationAcceptance} from '@personal-agent/knowledge/write';
import {createKnowledgeWriteProjection} from './knowledge-write-projection.js';
import type {KnowledgeWriteProjectionPort} from './knowledge-write-projection.js';

export interface TrustedKnowledgeBinding {
  sourceId: string; namespace: string; configRevision: number; available: boolean;
  writeAvailable: boolean; dataLevel: 'private' | 'public'; cloudExportAllowed: boolean;
  publicQueries: readonly string[];
  allowedNotePaths: readonly string[];
}
export interface TrustedKnowledgeSource {
  snapshot(): TrustedKnowledgeBinding;
  acquire(expected: {sourceId: string; configRevision: number}, signal: AbortSignal): {
    binding: TrustedKnowledgeBinding; read: KnowledgePort; write?: KnowledgeWritePort;
    reconcileWrite?: KnowledgeWritePort['reconcile'];
    finalizeWrite?: KnowledgeWritePort['finalize'];
    signal: AbortSignal; assertCurrent(): void; release(): void;
  };
}
export interface KnowledgeToolTaskBindings {
  runtime: {
    loadCheckpoint(taskId: string, key: string): unknown;
    saveCheckpoint(taskId: string, key: string, value: unknown): void;
  };
}

/** Public Runtime composition factory. All execution still enters the existing ToolGateway/Policy. */
export function createTrustedKnowledgeTools(source: TrustedKnowledgeSource, projectionPort?: KnowledgeWriteProjectionPort) {
  let application: KnowledgeToolTaskBindings | undefined;
  const key = 'knowledge-source-binding-v1';
  const token = (binding: TrustedKnowledgeBinding): string => `${binding.namespace}:${binding.sourceId}:${binding.configRevision}`;
  const projection = projectionPort ? createKnowledgeWriteProjection(projectionPort, () => application,
    (input, signal) => source.acquire(input, signal), () => token(source.snapshot())) : undefined;
  const bound = (taskId: string, claim = false): boolean => {
    const current = source.snapshot();
    if (!current.available || !application || !taskId) return false;
    if (claim && application.runtime.loadCheckpoint(taskId, key) === undefined) {
      application.runtime.saveCheckpoint(taskId, key, token(current));
    }
    return application.runtime.loadCheckpoint(taskId, key) === token(current);
  };
  const readTemplate = createKnowledgeSearchTool({search: async () => {throw Error('Unbound knowledge');}});
  const writeTemplate = createKnowledgeWriteTool({apply: async () => {throw Error('Unbound knowledge');},
    reconcile: async () => {throw Error('Unbound knowledge');}, finalize: async () => {throw Error('Unbound knowledge');}});
  const searchDescriptor: RegisteredTool['descriptor'] = {...readTemplate.descriptor,
    version: '1.0.0', inputSchema: {...readTemplate.descriptor.inputSchema,
      required: ['query', 'limit', 'sourceId', 'configRevision'], properties: {
        ...(readTemplate.descriptor.inputSchema.properties as Record<string, unknown>),
        sourceId: {type: 'string', minLength: 1, maxLength: 128},
        configRevision: {type: 'integer', minimum: 1}
      }}};
  const describe = (descriptor: RegisteredTool['descriptor'], writing: boolean): RegisteredTool['descriptor'] => {
    const current = source.snapshot();
    if (!current.available || current.dataLevel !== 'public' || !current.cloudExportAllowed) return descriptor;
    // Only explicitly public scalar enums enter the Competition catalog. They enable exact proposal binding.
    return {...descriptor, inputSchema: {...descriptor.inputSchema, properties: {...(descriptor.inputSchema.properties as Record<string, unknown>),
      sourceId: {type: 'string', enum: [current.sourceId]},
      configRevision: {type: 'integer', enum: [current.configRevision]},
      ...(writing ? current.allowedNotePaths.length ? {path: {type: 'string', enum: [...current.allowedNotePaths]}} : {}
        : {query: {type: 'string', enum: [...current.publicQueries]}, limit: {type: 'integer', minimum: 1, maximum: 5}})
    }}};
  };
  const search: RegisteredTool = {get descriptor() {return describe(searchDescriptor, false);},
    execute: (input, context) => run(input, context, false)};
  const write: RegisteredTool = {get descriptor() {return describe(writeTemplate.descriptor, true);},
    execute: (input, context) => run(input, context, true)};
  async function run(input: unknown, context: ToolContext, writing: boolean): Promise<unknown> {
    validateToolValue(writing ? write.descriptor.inputSchema : search.descriptor.inputSchema, input);
    const args = input as {sourceId: string; configRevision: number; query: string; limit: number};
    if (!bound(context.taskId, true)) throw new ProtocolError('SCOPE_DENIED', 'Knowledge task binding was revoked');
    const lease = source.acquire(args, context.signal);
    try {
      lease.assertCurrent();
      const active = {...context, signal: lease.signal};
      let result: unknown;
      if (writing) {
        if (!lease.binding.writeAvailable || !lease.write) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Knowledge write unavailable');
        projection?.prepare(input as KnowledgeNotePatch, active);
        result = await createKnowledgeWriteTool(lease.write).execute(input, active);
        validateToolValue(writeTemplate.descriptor.outputSchema, result);
        projection?.accept(context.taskId, context.runId, context.argumentsDigest!, result as KnowledgeWriteReceipt);
        await projection?.recover(context.taskId, active);
      } else result = await createKnowledgeSearchTool(lease.read).execute({query: args.query, limit: args.limit}, active);
      lease.assertCurrent(); return result;
    } finally {lease.release();}
  }
  // Private results can never enter cloud continuation, even if they were truncated.
  const permitted = (taskId: string): boolean => {
    const current = source.snapshot();
    return current.dataLevel === 'public' && current.cloudExportAllowed && bound(taskId);
  };
  const tools = [search, write];
  const availability = tools.map(tool => ({
    toolName: tool.descriptor.name, toolVersion: tool.descriptor.version,
    publicEnumPaths: tool === search ? ['/sourceId', '/configRevision', '/query'] : ['/sourceId', '/configRevision', '/path'],
    available: ({taskId, signal}: {taskId: string; revision: number; deadline: string; signal: AbortSignal}) => !signal.aborted && source.snapshot().dataLevel === 'public'
      && source.snapshot().cloudExportAllowed && (tool === search || source.snapshot().writeAvailable)
      && bound(taskId, true)
  }));
  const exports = tools.map(tool => ({
    toolName: tool.descriptor.name, toolVersion: tool.descriptor.version,
    exportPolicyVersion: 'knowledge-explicit-public-query-v1',
    accepts: ({taskId, arguments: args}: {taskId: string; proposalId: string; arguments: Record<string, unknown>}) => {
      const current = source.snapshot();
      if (!permitted(taskId) || args.sourceId !== current.sourceId || args.configRevision !== current.configRevision) return false;
      if (tool === write) return current.writeAvailable && typeof args.path === 'string' && current.allowedNotePaths.includes(args.path);
      return typeof args.query === 'string' && current.publicQueries.includes(args.query)
        && Number.isSafeInteger(args.limit) && Number(args.limit) >= 1 && Number(args.limit) <= 5;
    },
    project: ({taskId, result, signal}: {taskId: string; proposalId: string; result: unknown; signal: AbortSignal}) => {
      if (signal.aborted || !permitted(taskId)) throw new ProtocolError('SCOPE_DENIED', 'Knowledge cloud export revoked');
      if (tool === write) {
        const value = result as {sourceId?: string; configRevision?: number; state?: string; changed?: boolean};
        const current = source.snapshot();
        if (value?.sourceId !== current.sourceId || value.configRevision !== current.configRevision
          || !['verified', 'conflict'].includes(value.state ?? '') || typeof value.changed !== 'boolean') {
          throw new ProtocolError('INVALID_ARGUMENT', 'Invalid knowledge receipt');
        }
        // No note path, hashes, operation/backup IDs or Evidence leave the host.
        return {state: value.state, changed: value.changed};
      }
      validateToolValue(readTemplate.descriptor.outputSchema, result);
      const value = result as {hits: {source: {vaultId: string; path: string; line: number; revision: string}; excerpt: string}[]; truncated: boolean};
      const current = source.snapshot();
      if (value.hits.some(hit => hit.source.vaultId !== current.sourceId || hit.source.path.includes('\\')
        || hit.source.path.includes(':') || hit.source.path.split('/').some(part => !part || part === '.' || part === '..'))) {
        throw new ProtocolError('SCOPE_DENIED', 'Knowledge result is outside the public binding');
      }
      const projection = {hits: value.hits.slice(0, 5).map(hit => ({
        source: {vaultId: current.sourceId, path: hit.source.path, line: hit.source.line, revision: hit.source.revision},
        excerpt: hit.excerpt.slice(0, 200)})), truncated: value.truncated || value.hits.length > 5};
      if (Buffer.byteLength(JSON.stringify(projection), 'utf8') > 16384) throw new ProtocolError('INVALID_ARGUMENT', 'Knowledge projection too large');
      return projection;
    }
  }));
  return {tools, competitionToolAvailability: availability, competitionToolExports: exports,
    /** Trusted startup/admin recovery. Unknown writes require the original reconciliation adapter first. */
    recoverProjection: (taskId: string, context: Pick<ToolContext, 'signal' | 'deadline'>) =>
      projection?.recover(taskId, context) ?? Promise.resolve({pending: 0, unknown: 0}),
    bindApplication(value: KnowledgeToolTaskBindings) {application = value;},
    /** Trusted local submitters pin the same checkpoint before requesting approval. */
    bindTask(taskId: string): boolean {return bound(taskId, true);},
    /** Host-only readback. Never changes Runtime records, approves, retries or restores a note. */
    async reconcileWrite(input: {sourceId: string; configRevision: number;
      taskId: string; runId: string; argumentsDigest: string},
    context: Pick<ToolContext, 'signal' | 'deadline'>) {
      if (!input || Object.keys(input).some(name => !['sourceId', 'configRevision', 'taskId', 'runId', 'argumentsDigest'].includes(name))
        || typeof input.taskId !== 'string' || !input.taskId || typeof input.runId !== 'string' || !input.runId
        || !/^[a-f0-9]{64}$/.test(input.argumentsDigest)) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Invalid knowledge readback identity');
      }
      const lease = source.acquire(input, context.signal);
      try {
        if (!lease.reconcileWrite) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Knowledge readback unavailable');
        lease.assertCurrent();
        const result = await lease.reconcileWrite({taskId: input.taskId, runId: input.runId,
          argumentsDigest: input.argumentsDigest}, {...context, signal: lease.signal});
        lease.assertCurrent(); return result;
      } finally {lease.release();}
    },
    /** Runtime-only finalization; do not expose this method through Renderer IPC or model tools. */
    async finalizeWrite(input: {sourceId: string; configRevision: number; acceptedOriginal: KnowledgeWriteFinalizationAcceptance},
    context: Pick<ToolContext, 'signal' | 'deadline'>) {
      if (!input || Object.keys(input).some(name => !['sourceId', 'configRevision', 'acceptedOriginal'].includes(name))) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Invalid knowledge finalization binding');
      }
      const lease = source.acquire(input, context.signal);
      try {
        if (!lease.finalizeWrite) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Knowledge finalization unavailable');
        lease.assertCurrent();
        const result = await lease.finalizeWrite(input.acceptedOriginal, {...context, signal: lease.signal});
        lease.assertCurrent();
        if (result.state === 'finalized' && result.operationId === input.acceptedOriginal.operationId
          && result.outcome === input.acceptedOriginal.outcome
          && result.currentSha256 === input.acceptedOriginal.currentSha256) {
          const accepted = input.acceptedOriginal;
          projection?.accept(accepted.taskId, accepted.runId, accepted.argumentsDigest, {
            operationId: result.operationId, state: result.outcome === 'applied' ? 'verified' : 'conflict',
            changed: result.outcome === 'applied' && result.currentSha256 !==
              (accepted.originalInput as KnowledgeNotePatch).expectedSha256}, accepted.originalInput as KnowledgeNotePatch);
          // Commit the original Runtime result before callers independently recover projections.
        }
        return result;
      } finally {lease.release();}
    },
    register(host: ToolHost) {
      const undo: (() => void)[] = [];
      try {for (const tool of tools) undo.push(host.register(tool));}
      catch (error) {for (const dispose of undo.reverse()) dispose(); throw error;}
      return () => {for (const dispose of undo.reverse()) dispose();};
    }
  };
}
