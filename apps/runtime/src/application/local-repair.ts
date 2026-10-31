import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, TaskSnapshot} from '@personal-agent/contracts';
import type {AgentToolPort} from '@personal-agent/agents';
import {parseCoordinationRepairCandidate} from '@personal-agent/coordination';
import type {CoordinationRepairCandidateResult} from '@personal-agent/coordination';
import {commitStoredRepair, previewStoredRepair, prepareReviewedRepair} from '@personal-agent/cognition';
import type {ReviewedRepairBinding, ReviewedRepairPreparation} from '@personal-agent/cognition';
import {createHash} from 'node:crypto';
import type {FactRef, FactVersion, MemoryQueryPort} from '@personal-agent/memory';
import type {GraphSnapshot, NodeRef, NodeVersion} from '@personal-agent/goals';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {TaskRuntime} from '../index.js';

export const LOCAL_REPAIR_TOOL = 'cognition.commit_repair';
export const LOCAL_REPAIR_CHECKPOINT = 'local-repair-intent';

/** Captured at the original projection/export, never rebound to newer refs. */
export interface LocalRepairBinding {
  fact: FactRef;
  node: NodeRef;
  graphRevision: number;
  allowedTargets: NodeRef[];
  allowedDependencies: NodeRef[];
}

export interface LocalRepairHostOptions {
  graphNamespace: string;
  bindingVersion: string;
  sourceTool?: {name: string; version: string; arguments: Record<string, unknown>};
  memory?: MemoryQueryPort;
  /** Shared with trusted Fact ingestion and projection writes for this source. */
  withSourceLock<T>(work: () => Promise<T>): Promise<T>;
  resolveBinding?(input: {sourceTaskId: string; evidenceId: string}): LocalRepairBinding;
  matchesSource?(input: {result: unknown; fact: FactVersion; node: NodeVersion}): boolean;
  /** Trusted current session resolver, never a model callback or new wire capability. */
  reviewedSource?: {resolve(input: {sourceTaskId: string; reviewTaskId: string}): ReviewedRepairPreparation | undefined};
}

interface FactRepairRequest {
  sourceTaskId: string;
  evidenceId: string;
  idempotencyKey: string;
  deadline: string;
}
interface ReviewedRepairRequest {sourceTaskId: string; reviewTaskId: string; idempotencyKey: string; deadline: string;}
export type SubmitLocalRepairRequest = FactRepairRequest | ReviewedRepairRequest;

interface FactRepairIntent extends FactRepairRequest {
  candidate: CoordinationRepairCandidateResult;
  binding: LocalRepairBinding;
  graphNamespace: string;
  bindingVersion: string;
  sourceTool: NonNullable<LocalRepairHostOptions['sourceTool']>;
}
interface ReviewedRepairIntent extends ReviewedRepairRequest {
  sourceKind: 'goal_review';
  candidate: CoordinationRepairCandidateResult;
  binding: ReviewedRepairBinding;
  graphNamespace: string;
  bindingVersion: string;
  reviewDigest: string;
  cloudCandidateDigest: string;
}
type LocalRepairIntent = FactRepairIntent | ReviewedRepairIntent;
const reviewed=(intent: LocalRepairIntent): intent is ReviewedRepairIntent => 'sourceKind' in intent && intent.sourceKind==='goal_review';

export interface ReviewedLocalRepairReceiptInput {taskId: string; sourceTaskId: string; reviewTaskId: string; graphNamespace: string;}

/** Read the original approved CAS only. A later node version does not erase its historical effect. */
export function readReviewedLocalRepairReceipt(runtime: TaskRuntime, input: ReviewedLocalRepairReceiptInput) {
  try {
    const {taskId,sourceTaskId,reviewTaskId,graphNamespace}=input;
    const task=runtime.getTask(taskId),intent=runtime.loadCheckpoint(taskId,LOCAL_REPAIR_CHECKPOINT) as LocalRepairIntent | undefined;
    if (!intent || !reviewed(intent) || intent.sourceTaskId!==sourceTaskId || intent.reviewTaskId!==reviewTaskId
      || intent.graphNamespace!==graphNamespace || task.conversationId!==`desktop-proactive-goals:${graphNamespace}`
      || runtime.findTaskByIdempotencyKey('local-repair:'+intent.idempotencyKey)?.taskId!==taskId
      || !task.attachmentRefs?.includes('local-repair-intent:'+toolArgumentsDigest(intent))) return;
    const source=runtime.getTask(sourceTaskId),reviewTask=runtime.getTask(reviewTaskId);
    const review=runtime.loadCheckpoint(reviewTaskId,'proactive-cognition-review-v1') as import('./proactive-cognition-host.js').ProactiveCognitionReview | undefined;
    const cloud=parseCoordinationRepairCandidate(runtime.loadCheckpoint(sourceTaskId,'competition-repair-candidate'));
    if (source.state!=='succeeded' || source.conversationId!==task.conversationId
      || reviewTask.state!=='succeeded' || reviewTask.conversationId!==`proactive-cognition:${graphNamespace}`
      || !review || review.taskId!==reviewTaskId || toolArgumentsDigest(review)!==intent.reviewDigest
      || toolArgumentsDigest(cloud)!==intent.cloudCandidateDigest) return;
    const store=runtime.bindCoordinationStore(graphNamespace);
    const prepared=prepareReviewedRepair(store.read(intent.binding.graphRevision),review.evaluatedAt,review,intent.candidate.candidate);
    if (prepared.kind!=='prepared' || !isDeepStrictEqual(prepared.binding,intent.binding)) return;
    const runId='local-repair-'+taskId,record=runtime.readToolExecutions(taskId).find(item=>item.evidenceId===runId);
    if (!record || record.taskId!==taskId || record.toolName!==LOCAL_REPAIR_TOOL || record.toolVersion!=='1.0.0'
      || record.state!=='confirmed' || record.policyDecision!=='allow' || !record.executionStarted
      || !task.evidenceRefs.includes(runId)
      || !runtime.matchesToolExecutionInput(record,{arguments:{intentDigest:toolArgumentsDigest(intent)},scopeRef:runId})) return;
    const result=runtime.loadCheckpoint(taskId,'tool-result-'+runId) as {result?: {kind?: string; graphRevision?: number}} | undefined;
    const graphRevision=result?.result?.graphRevision;
    if (result?.result?.kind!=='applied' || graphRevision!==prepared.preview.after.snapshot.revision
      || !isDeepStrictEqual(store.read(graphRevision),prepared.preview.after.snapshot)) return;
    const updatedNodes=prepared.preview.inputs.map(node=>{
      const applied=prepared.preview.after.snapshot.history.findLast(item=>item.id===node.id)!;
      return Object.freeze({id:applied.id,revision:applied.revision,kind:applied.kind});
    });
    const current=store.read();
    return Object.freeze({taskId,runId,sourceTaskId,reviewTaskId,graphNamespace,graphRevision,
      currentGraphRevision:current.revision,inputDigest:record.inputDigest,candidateDigest:intent.binding.candidateDigest,
      graphUpdateVerified:updatedNodes.every(ref=>{
        const head=current.history.findLast(node=>node.id===ref.id);return !!head && sameRef(head,ref);
      }),updatedNodes:Object.freeze(updatedNodes),evidenceRefs:Object.freeze([runId])});
  } catch {return undefined;}
}

function denied(message = 'Local repair binding is invalid'): never {
  throw new ProtocolError('UNAUTHORIZED', message);
}

function active(deadline: string, signal: AbortSignal): void {
  if (signal.aborted) throw new ProtocolError('CANCELLED', 'Local repair cancelled');
  if (!Number.isFinite(Date.parse(deadline)) || Date.now() >= Date.parse(deadline)) {
    throw new ProtocolError('TIMEOUT', 'Local repair deadline expired');
  }
}

function sameRef(a: NodeRef, b: NodeRef): boolean { return a.id === b.id && a.revision === b.revision; }

function requireSource(runtime: TaskRuntime, intent: FactRepairIntent): unknown {
  const source = runtime.getTask(intent.sourceTaskId);
  const record = runtime.readToolExecutions(intent.sourceTaskId).find(item => item.evidenceId === intent.evidenceId);
  if (source.state !== 'succeeded' || !source.evidenceRefs.includes(intent.evidenceId)
    || !record || record.taskId !== intent.sourceTaskId || record.toolName !== intent.sourceTool.name
    || record.toolVersion !== intent.sourceTool.version || record.state !== 'confirmed'
    || record.policyDecision !== 'allow' || !record.executionStarted
    || !runtime.matchesToolExecutionInput(record, {arguments: intent.sourceTool.arguments,
      scopeRef: intent.evidenceId})) denied();
  const approval = runtime.getApproval(intent.evidenceId);
  if (approval.state !== 'allowed' || approval.taskId !== intent.sourceTaskId
    || approval.toolName !== intent.sourceTool.name
    || approval.argumentsDigest !== toolArgumentsDigest(intent.sourceTool.arguments)) denied();
  const saved = runtime.loadCheckpoint(intent.sourceTaskId, 'tool-result-' + intent.evidenceId) as {result?: unknown} | undefined;
  if (!saved || !Object.hasOwn(saved, 'result')) denied();
  return saved.result;
}

function requireReviewedSource(runtime: TaskRuntime, host: LocalRepairHostOptions, intent: ReviewedRepairIntent): void {
  if (host.graphNamespace!==intent.graphNamespace || host.bindingVersion!==intent.bindingVersion) denied();
  const source=runtime.getTask(intent.sourceTaskId),reviewTask=runtime.getTask(intent.reviewTaskId);
  const review=runtime.loadCheckpoint(intent.reviewTaskId,'proactive-cognition-review-v1') as import('./proactive-cognition-host.js').ProactiveCognitionReview | undefined;
  const cloud=parseCoordinationRepairCandidate(runtime.loadCheckpoint(intent.sourceTaskId,'competition-repair-candidate'));
  if (source.state!=='succeeded' || source.conversationId!==`desktop-proactive-goals:${host.graphNamespace}`
    || reviewTask.state!=='succeeded' || reviewTask.conversationId!==`proactive-cognition:${host.graphNamespace}`
    || !review || review.taskId!==intent.reviewTaskId || toolArgumentsDigest(review)!==intent.reviewDigest
    || toolArgumentsDigest(cloud)!==intent.cloudCandidateDigest) denied();
  const resolved=host.reviewedSource?.resolve({sourceTaskId:intent.sourceTaskId,reviewTaskId:intent.reviewTaskId});
  if (resolved?.kind!=='prepared' || !isDeepStrictEqual(resolved.binding,intent.binding)
    || !isDeepStrictEqual(resolved.request,intent.candidate.candidate)) denied();
  const prepared=prepareReviewedRepair(runtime.bindCoordinationStore(host.graphNamespace).read(),new Date().toISOString(),review,intent.candidate.candidate);
  if (prepared.kind!=='prepared' || !isDeepStrictEqual(prepared.binding,intent.binding)) denied();
  // Runtime independently translates the cloud's opaque refs; a resolver cannot substitute another candidate.
  const refs=new Map([...prepared.binding.targets,...prepared.binding.dependencies].map(ref=>
    [`${createHash('sha256').update(ref.id).digest('hex')}:${ref.revision}`,ref]));
  const local=(ref: NodeRef): NodeRef => {const result=refs.get(`${ref.id}:${ref.revision}`);if(!result) denied();return {...result};};
  const normalized={expectedGraphRevision:cloud.candidate.expectedGraphRevision,
    changes:cloud.candidate.changes.map(change=>({...change,node:local(change.node),dependencies:change.dependencies.map(local)}))};
  if (!isDeepStrictEqual(normalized,intent.candidate.candidate)) denied();
}

/** Compile the entire immutable intent before starting a worker. */
export function prepareLocalRepair(
  runtime: TaskRuntime, host: LocalRepairHostOptions, request: SubmitLocalRepairRequest,
): TaskSnapshot {
  if ('reviewTaskId' in request) {
    if (Object.keys(request).length!==4 || Object.keys(request).some(key=>!['sourceTaskId','reviewTaskId','idempotencyKey','deadline'].includes(key))
      || Object.values(request).some(value=>typeof value!=='string'||!value.trim()) || !Number.isFinite(Date.parse(request.deadline))) denied();
    const prior=runtime.findTaskByIdempotencyKey('local-repair:'+request.idempotencyKey);
    if (prior) {
      const saved=runtime.loadCheckpoint(prior.taskId,LOCAL_REPAIR_CHECKPOINT) as LocalRepairIntent | undefined;
      if (!saved || !reviewed(saved) || saved.sourceTaskId!==request.sourceTaskId || saved.reviewTaskId!==request.reviewTaskId
        || saved.deadline!==request.deadline || saved.graphNamespace!==host.graphNamespace || saved.bindingVersion!==host.bindingVersion
        || !prior.attachmentRefs?.includes('local-repair-intent:'+toolArgumentsDigest(saved))) {
        throw new ProtocolError('REVISION_CONFLICT','Local repair intent conflict or missing checkpoint');
      }
      return prior;
    }
    const prepared=host.reviewedSource?.resolve({sourceTaskId:request.sourceTaskId,reviewTaskId:request.reviewTaskId});
    if (prepared?.kind!=='prepared' || prepared.binding.reviewTaskId!==request.reviewTaskId) denied();
    const cloud=parseCoordinationRepairCandidate(runtime.loadCheckpoint(request.sourceTaskId,'competition-repair-candidate'));
    const review=runtime.loadCheckpoint(request.reviewTaskId,'proactive-cognition-review-v1');
    if (!review || typeof review!=='object') denied();
    const intent: ReviewedRepairIntent={...request,sourceKind:'goal_review',binding:structuredClone(prepared.binding),
      candidate:parseCoordinationRepairCandidate({...cloud,candidate:prepared.request}),graphNamespace:host.graphNamespace,
      bindingVersion:host.bindingVersion,reviewDigest:toolArgumentsDigest(review as Record<string,unknown>),cloudCandidateDigest:toolArgumentsDigest(cloud)};
    requireReviewedSource(runtime,host,intent);
    return persistIntent(runtime,intent);
  }
  if (!host.sourceTool || !host.memory || !host.resolveBinding || !host.matchesSource) denied('Fact repair source is unavailable');
  if (Object.keys(request).some(key => !['sourceTaskId', 'evidenceId', 'idempotencyKey', 'deadline'].includes(key))
    || Object.values(request).some(value => typeof value !== 'string' || !value.trim())
    || !Number.isFinite(Date.parse(request.deadline))) denied();
  const candidate = parseCoordinationRepairCandidate(runtime.loadCheckpoint(request.sourceTaskId, 'competition-repair-candidate'));
  const binding = structuredClone(host.resolveBinding({sourceTaskId: request.sourceTaskId, evidenceId: request.evidenceId}));
  const intent: FactRepairIntent = {...request, candidate, binding,
    graphNamespace: host.graphNamespace, bindingVersion: host.bindingVersion, sourceTool: structuredClone(host.sourceTool)};
  requireSource(runtime, intent);
  return persistIntent(runtime,intent,()=>validateSelection(intent,runtime.bindCoordinationStore(host.graphNamespace).read()));
}
function persistIntent(runtime: TaskRuntime,intent: LocalRepairIntent,validate?:()=>void): TaskSnapshot {
  const request=intent;
  const digest = toolArgumentsDigest(intent);
  const key = 'local-repair:' + request.idempotencyKey;
  const taskInput = {goal: 'Apply explicitly approved plan repair',
    conversationId: runtime.getTask(request.sourceTaskId).conversationId ?? 'local-repair',
    attachmentRefs: ['local-repair-intent:' + digest], idempotencyKey: key};
  const prior = runtime.findTaskByIdempotencyKey(key);
  if (prior) {
    const saved = runtime.loadCheckpoint(prior.taskId, LOCAL_REPAIR_CHECKPOINT);
    if (!prior.attachmentRefs?.includes('local-repair-intent:' + digest)
      || (saved !== undefined && toolArgumentsDigest(saved) !== digest)
      || (saved === undefined && prior.state !== 'created')) {
      throw new ProtocolError('REVISION_CONFLICT', 'Local repair intent conflict or missing checkpoint');
    }
    return saved === undefined
      ? runtime.submitTaskWithCheckpoint(taskInput, LOCAL_REPAIR_CHECKPOINT, intent)
      : prior;
  }
  validate?.();return runtime.submitTaskWithCheckpoint(taskInput, LOCAL_REPAIR_CHECKPOINT, intent);
}

function validateSelection(intent: FactRepairIntent, graph: GraphSnapshot): void {
  const {binding, candidate} = intent;
  if (!binding || graph.revision !== binding.graphRevision
    || candidate.candidate.expectedGraphRevision !== binding.graphRevision
    || !Array.isArray(binding.allowedTargets) || !Array.isArray(binding.allowedDependencies)) denied();
  for (const change of candidate.candidate.changes) {
    if (!binding.allowedTargets.some(ref => sameRef(ref, change.node))
      || change.dependencies.some(ref => !binding.allowedDependencies.some(allowed => sameRef(ref, allowed)))) denied('Repair candidate exceeds selected nodes');
    const original = graph.history.findLast(item => item.id === change.node.id);
    if (!original || !sameRef(original, change.node)
      || original.dependencies.length !== change.dependencies.length
      || original.dependencies.some(ref => !change.dependencies.some(next => next.id === ref.id))) {
      denied('Repair candidate changes the selected dependency identities');
    }
  }
}

export function createLocalRepairTool(getRuntime: () => TaskRuntime, host: LocalRepairHostOptions): RegisteredTool {
  return {
    descriptor: {
      name: LOCAL_REPAIR_TOOL, version: '1.0.0',
      inputSchema: {type: 'object', required: ['intentDigest'], additionalProperties: false,
        properties: {intentDigest: {type: 'string', pattern: '^[a-f0-9]{64}$'}}},
      outputSchema: {type: 'object', required: ['kind', 'graphRevision'], additionalProperties: false,
        properties: {kind: {enum: ['applied', 'rejected']}, graphRevision: {type: 'integer', minimum: 0}}},
      sideEffect: 'local_write', requiredScopes: ['cognition:repair'], idempotencySupport: true,
      recoverySupport: true, requiresPresence: false,
    },
    async execute(input, context) {
      const runtime = getRuntime();
      const intent = runtime.loadCheckpoint(context.taskId, LOCAL_REPAIR_CHECKPOINT) as LocalRepairIntent | undefined;
      if (!intent || (input as {intentDigest?: string}).intentDigest !== toolArgumentsDigest(intent)) denied();
      return host.withSourceLock(async () => {
      const store = runtime.bindCoordinationStore(intent.graphNamespace);
      if (reviewed(intent)) {
        try {
          active(context.deadline,context.signal);
          requireReviewedSource(runtime,host,intent);
          const grant=runtime.policy.get(context.authorizationRef);
          if (!grant || grant.taskId!==context.taskId || grant.toolName!==LOCAL_REPAIR_TOOL
            || Date.parse(grant.expiresAt)<=Date.now() || !grant.scopes.includes('cognition:repair')
            || grant.argumentsDigest!==toolArgumentsDigest(input)) denied();
          active(context.deadline,context.signal);
        } catch {return {kind:'rejected',graphRevision:store.read().revision};}
        return commitAndReadBack(store,intent.candidate.candidate);
      }
      // A pre-write rejection is a confirmed no-write result, not an unknown write.
      let fact: FactVersion;
      try {
        active(context.deadline, context.signal);
        if (!host.memory || !host.resolveBinding || !host.matchesSource || !host.sourceTool) denied();
        const page = await host.memory.listCurrent({factId: intent.binding.fact.id,
          at: new Date().toISOString(), limit: 1, deadline: context.deadline, signal: context.signal});
        if (page.nextCursor || page.facts.length !== 1) denied();
        fact = page.facts[0]!;
        // No asynchronous operation is allowed from this guard through CAS/readback.
        active(context.deadline, context.signal);
        if (host.bindingVersion !== intent.bindingVersion || host.graphNamespace !== intent.graphNamespace
          || !isDeepStrictEqual(host.sourceTool, intent.sourceTool)
          || !isDeepStrictEqual(host.resolveBinding({sourceTaskId: intent.sourceTaskId, evidenceId: intent.evidenceId}), intent.binding)) denied();
        const sourceResult = requireSource(runtime, intent);
        const graph = store.read();
        if (graph.namespace !== intent.graphNamespace) denied();
        validateSelection(intent, graph);
        const node = graph.history.findLast(item => item.id === intent.binding.node.id);
        const now = Date.now();
        const grant = runtime.policy.get(context.authorizationRef);
        // Check revocation/expiry without consuming the already-used allow_once again.
        if (!grant || grant.taskId !== context.taskId || grant.toolName !== LOCAL_REPAIR_TOOL
          || Date.parse(grant.expiresAt) <= now || !grant.scopes.includes('cognition:repair')
          || grant.argumentsDigest !== toolArgumentsDigest(input)) denied();
        if (graph.revision !== intent.binding.graphRevision || !node || node.kind !== 'fact'
          || !sameRef(node, intent.binding.node) || !sameRef(fact.ref, intent.binding.fact)
          || fact.state !== 'active' || node.state !== 'active' || fact.confirmation === 'model_inference'
          || Date.parse(fact.validFrom) > now || Date.parse(fact.validUntil) <= now
          || fact.sourceRef !== 'tool-evidence:' + intent.evidenceId || node.sourceRef !== fact.sourceRef
          || node.summary !== fact.summary || node.validFrom !== fact.validFrom || node.validUntil !== fact.validUntil
          || host.matchesSource({result: structuredClone(sourceResult), fact: structuredClone(fact), node: structuredClone(node)}) !== true) denied();
        previewStoredRepair(store, new Date(now).toISOString(), intent.candidate.candidate);
        active(context.deadline, context.signal);
      } catch {
        return {kind: 'rejected', graphRevision: store.read().revision};
      }
      // Synchronous CAS followed by durable version readback. If the process dies
      // here, Runtime's already-persisted started record prevents automatic replay.
      return commitAndReadBack(store,intent.candidate.candidate);
      });
    },
  };
}

function commitAndReadBack(store: import('@personal-agent/goals/store').AtomicCoordinationStorePort,
  request: import('@personal-agent/cognition').StoredRepairRequest): {kind:'applied'|'rejected';graphRevision:number} {
  const result=commitStoredRepair(store,new Date().toISOString(),request);
  if(result.kind!=='applied') return {kind:'rejected',graphRevision:result.currentGraphRevision};
  if(!isDeepStrictEqual(store.read(result.snapshot.revision),result.snapshot)) throw new ProtocolError('RESULT_UNKNOWN','Repair commit requires reconciliation');
  return {kind:'applied',graphRevision:result.snapshot.revision};
}

export function startLocalRepairTask(
  runtime: TaskRuntime, tools: AgentToolPort, taskId: string, resume = false,
): Promise<TaskSnapshot> {
  const intent = runtime.loadCheckpoint(taskId, LOCAL_REPAIR_CHECKPOINT) as LocalRepairIntent | undefined;
  if (!intent) throw new ProtocolError('NOT_FOUND', 'Local repair intent is missing');
  return runtime.runTask(taskId, async context => {
    const runId = 'local-repair-' + taskId;
    const result = await tools.invoke({taskId, runId, authorizationRef: runId,
      toolName: LOCAL_REPAIR_TOOL, toolVersion: '1.0.0', arguments: {intentDigest: toolArgumentsDigest(intent)},
      deadline: context.deadline, signal: context.signal});
    if (result.state === 'pending') return {resultSummary: 'Local plan repair awaits approval', evidenceRefs: result.evidenceRefs};
    if (result.state === 'unknown') return {resultSummary: 'Local plan repair requires reconciliation', evidenceRefs: result.evidenceRefs};
    if ((result.result as {kind?: string})?.kind !== 'applied') {
      throw new ProtocolError('REVISION_CONFLICT', 'Local repair source, scope or graph changed; no write performed');
    }
    return {resultSummary: 'Approved local plan repair committed and read back', evidenceRefs: result.evidenceRefs};
  }, {deadline: intent.deadline, sideEffect: 'local_write', ...(resume ? {resume: true} : {})});
}
