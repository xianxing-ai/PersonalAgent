import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, TaskSnapshot, ToolContext} from '@personal-agent/contracts';
import type {AgentToolInvocation, AgentToolPort} from '@personal-agent/agents';
import {computeSubtaskInputDigest} from '@personal-agent/agents';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {ProactiveAdvanceRequest, ProactiveControl, ProactiveContextReadback, ProactiveHostCapability,
  ProactiveHostProposal, ProactiveHostReceipt, ProactiveInputEvent, ProactiveResponsibility,
  ProactiveSourceQuote, ProactiveWorkflowResult} from '@personal-agent/agentarts';
import {proactiveWorkflowDigest as digest} from '@personal-agent/agentarts';
import type {ProactiveBatch, ProactiveContext, ProactiveEvent, ProactiveEventSink} from '@personal-agent/connector-host';
import type {KnowledgeHit, KnowledgePort} from '@personal-agent/knowledge';
import type {FactVersion, MemoryQueryPort} from '@personal-agent/memory';
import type {NodeVersion} from '@personal-agent/goals';
import type {CoordinationStorePort} from '@personal-agent/goals/store';
import type {TaskRuntime, WorkerContext} from '../index.js';
import {createRuntimeAtomicStatePort} from '../atomic-host-state.js';
import {createProactiveWorkflowSession} from './proactive-workflow-session.js';
import type {ProactiveExecutionReadback, ProactiveSessionBinding} from './proactive-workflow-session.js';
import {readRuntimeSubagentSummary, SUBAGENT_DISPATCH_TOOL_NAME} from './subagent-host.js';
import type {RuntimeNotificationHost} from './notification-host.js';

export const RUNTIME_PROACTIVE_TOOL_VERSION = '1.0.0';
const coreKinds = ['retrieve_context', 'update_item', 'schedule_wake', 'notify'] as const;
type CoreKind = typeof coreKinds[number];
export const RUNTIME_PROACTIVE_TOOLS = Object.freeze(Object.fromEntries(coreKinds.map(kind => [kind, 'proactive.' + kind])) as Record<CoreKind, string>);
type Context = {signal: AbortSignal; deadline: string};
type UnsignedEvent = Omit<ProactiveInputEvent, 'proof'>;
type UnsignedResponsibility = Omit<ProactiveResponsibility, 'proof'>;
type UnsignedReceipt = Omit<ProactiveHostReceipt, 'proof'>;
type UnsignedControl = Omit<ProactiveControl, 'proof'>;
type ToolBinding = {kind: ProactiveHostCapability['kind']; toolName: string; toolVersion: string;
  location: ProactiveHostCapability['location']; effect: ProactiveHostCapability['effect'];
  /** Trusted projection to a pre-registered tool; it cannot select an endpoint or issue a grant. */
  arguments?(proposal: ProactiveHostProposal): Record<string, unknown>};
export interface RuntimeProactiveControlCommand {
  commandId: string; action: ProactiveControl['action']; expectedControlRevision: number; sourceTaskId: string;
}
export interface RuntimeProactiveChildReport {
  eventId: string; parentTaskId: string; childTaskId: string; childRevision: number; subtaskId: string;
  state: TaskSnapshot['state']; resultSummary?: string; evidenceRefs: readonly string[]; reportRef: string;
}
export interface RuntimeProactiveControllerReceipt {
  action: 'continue' | 'summary' | 'notify_controller' | 'request_controller'; receiptRef: string;
}
export interface RuntimeProactiveWorkflowHostOptions {
  taskId: string; sessionId: string; taskDeadline: string; contractRef: string;
  advancePort(input: ProactiveAdvanceRequest): Promise<ProactiveWorkflowResult>;
  verifyAdvance(result: ProactiveWorkflowResult, input: ProactiveAdvanceRequest): boolean | Promise<boolean>;
  sign(kind: 'event' | 'responsibility' | 'receipt' | 'control', value: Record<string, unknown>, binding: ProactiveSessionBinding): unknown;
  pureAdvance?: {kind: 'signed_frontier_no_effects'};
  /** Actual device observation. A boolean supplied in an input event is never consumed here. */
  localDeviceAvailable(): boolean;
  /** Only an actual persistent host adapter may declare this readiness. Absent means unavailable. */
  cloudPersistentHost?: {ref: string; available(): boolean};
  bindings?: readonly ToolBinding[];
  context?: {publicMemory?: MemoryQueryPort; publicKnowledge?: KnowledgePort; goals?: Pick<CoordinationStorePort, 'read'>; limit: number};
  notificationHost?: RuntimeNotificationHost;
  routeConnectorEvent?(event: ProactiveEvent): Partial<Pick<UnsignedEvent, 'change' | 'previousVersion' | 'expiresAt' | 'priority' | 'responsibilityRefs' | 'goalRefs' | 'anchorRefs' | 'contractRef'>>;
  /** Authenticated native UI/final user instruction check; model/source fields cannot satisfy it. */
  verifyControlCommand?(command: RuntimeProactiveControlCommand, source: TaskSnapshot, context: Context): boolean | Promise<boolean>;
  /** Existing controller consumer. An uncertain call is read back, never automatically sent again. */
  controller?: {consume(report: RuntimeProactiveChildReport, context: Context): Promise<RuntimeProactiveControllerReceipt>;
    readReceipt(eventId: string, context: Context): Promise<RuntimeProactiveControllerReceipt | undefined>};
  /** Existing worker re-entry, supplied by the real caller when approvals suspend its worker. */
  resumeWorker?(): void;
}
interface Entry {event: UnsignedEvent; payload: unknown}
interface FrozenRequest {input: Omit<ProactiveAdvanceRequest, 'signal' | 'checkpoint'>; entryIds: string[];
  responsibilityIds: string[]; receiptIds: string[]; acknowledged: boolean}
export interface RuntimeProactiveContextSnapshot {
  sourceTexts: {quote: ProactiveSourceQuote; text: string}[]; goals: NodeVersion[]; facts: FactVersion[];
  knowledge: readonly KnowledgeHit[]; unavailable: string[];
  /** Original public query binding; revalidation never chooses a broader query or a private Vault. */
  retrieval: {knowledgeQuery: string; knowledgeLimit: number};
}
interface ApplicationState {
  version: 1; binding: ProactiveSessionBinding; conversationId: string; contractRef: string;
  entries: Record<string, Entry>; responsibilities: Record<string, UnsignedResponsibility>;
  batches: Record<string, ProactiveBatch>; delivered: Record<string, true>; receipts: Record<string, UnsignedReceipt>;
  commands: Record<string, {command: RuntimeProactiveControlCommand; revision: number; control: UnsignedControl}>;
  pendingControl?: UnsignedControl; requests: Record<string, FrozenRequest>; lastResult?: ProactiveWorkflowResult;
  contexts: Record<string, unknown>; itemStates: Record<string, unknown>; schedules: Record<string, string>;
  contextValidity?: Record<string, {state: 'needs_refresh'; reason: string; observedAt: string}>;
  controllerReports: Record<string, {report: RuntimeProactiveChildReport; state: 'pending' | 'confirmed'; receipt?: RuntimeProactiveControllerReceipt}>;
}
function fail(code: string, message: string): never {throw new ProtocolError(code, message);}
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const hashText = (value: string) => createHash('sha256').update(value).digest('hex');
const body = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_ARGUMENT', 'Expected a host object');
  return value as Record<string, unknown>;
};
const terminal = (task: TaskSnapshot) => ['succeeded', 'failed', 'cancelled', 'cancelling'].includes(task.state) || task.cancelRequested === true;

/** Application composition over the original TaskRuntime, atomic state, Policy/ToolGateway and Scheduler.
 * The image is a signed frontier; no source/model/control payload can install a tool or grant authority.
 */
export function createRuntimeProactiveWorkflowHost(runtime: TaskRuntime, tools: AgentToolPort,
  options: RuntimeProactiveWorkflowHostOptions, now: () => number = Date.now) {
  const original = runtime.getTask(options.taskId);
  if (![options.taskId, options.sessionId, options.contractRef].every(text) || !Number.isFinite(Date.parse(options.taskDeadline))
    || typeof options.advancePort !== 'function' || typeof options.verifyAdvance !== 'function' || typeof options.sign !== 'function'
    || typeof options.localDeviceAvailable !== 'function') fail('INVALID_ARGUMENT', 'Trusted proactive host bindings required');
  const oldDeadline = runtime.loadCheckpoint(options.taskId, 'application-deadline');
  if (oldDeadline !== undefined && oldDeadline !== options.taskDeadline) fail('REVISION_CONFLICT', 'Original Runtime task deadline differs');
  runtime.saveCheckpointOnce(options.taskId, 'application-deadline', options.taskDeadline);
  const atomic = createRuntimeAtomicStatePort(runtime, 'runtime-proactive-workflows');
  const listeners = new Set<() => void>();
  const notify = () => {for (const listener of listeners) {try {listener();} catch {/* Host lifecycle diagnostics grant nothing. */}}};
  let frontierTail: Promise<void> = Promise.resolve();
  function serializeFrontier<T>(operation: () => Promise<T>): Promise<T> {
    const result = frontierTail.then(operation);
    frontierTail = result.then(() => {}, () => {});
    return result;
  }
  const key = 'application:' + digest([options.taskId, options.sessionId]);
  const initial: ApplicationState = {version: 1, binding: {taskId: options.taskId, sessionId: options.sessionId, controlRevision: 0,
    taskDeadline: options.taskDeadline}, conversationId: original.conversationId!, contractRef: options.contractRef,
    entries: {}, responsibilities: {}, batches: {}, delivered: {}, receipts: {}, commands: {}, requests: {}, contexts: {},
    itemStates: {}, schedules: {}, controllerReports: {}};
  const read = () => {
    const saved = atomic.read(key), state = (saved?.value ?? initial) as ApplicationState;
    if (state.version !== 1 || state.binding.taskId !== options.taskId || state.binding.sessionId !== options.sessionId
      || state.binding.taskDeadline !== options.taskDeadline || state.conversationId !== original.conversationId || state.contractRef !== options.contractRef)
      fail('REVISION_CONFLICT', 'Persisted proactive task/session configuration differs');
    return {revision: saved?.revision, state: structuredClone(state)};
  };
  const save = (snapshot: ReturnType<typeof read>) => {
    if (!atomic.compareAndSet(key, snapshot.revision, snapshot.state)) fail('REVISION_CONFLICT', 'Original proactive application changed');
  };
  if (!atomic.read(key)) {const snapshot = read(); save(snapshot);}
  const binding = () => read().state.binding;
  function active(context: Context, historical = false) {
    if (!(context.signal instanceof AbortSignal) || !Number.isFinite(Date.parse(context.deadline))) fail('INVALID_ARGUMENT', 'Original request lifetime required');
    if (context.signal.aborted) fail('CANCELLED', 'Proactive application request cancelled');
    if (!historical && Date.parse(context.deadline) > Date.parse(options.taskDeadline)) fail('INVALID_ARGUMENT', 'Original task deadline cannot be extended');
    if (now() >= Date.parse(context.deadline)) fail('TIMEOUT', 'Proactive application request expired');
    if (!historical && terminal(runtime.getTask(options.taskId))) fail('CANCELLED', 'Original Runtime task is no longer active');
  }
  const runtimeEvents = (taskId: string) => runtime.readEvents().filter(event => event.taskId === taskId);
  const taskEvidence = (taskId: string) => runtimeEvents(taskId).map(event => event.eventId);
  const sourceTask = (taskId: string) => {
    const task = runtime.getTask(taskId);
    if (task.conversationId !== original.conversationId || !text(task.goal)) fail('UNAUTHORIZED', 'Original user instruction belongs to another conversation');
    if (runtime.loadCheckpoint(taskId, 'private-copy-erasure') !== undefined) fail('UNAUTHORIZED', 'Original instruction was withheld');
    return task;
  };
  const quote = (task: TaskSnapshot): ProactiveSourceQuote => ({conversationId: task.conversationId!, messageId: task.taskId,
    quoteRef: 'runtime:task:' + task.taskId + ':goal', sha256: hashText(task.goal!)});
  function appendEntry(state: ApplicationState, entry: Entry) {
    const old = state.entries[entry.event.eventId];
    if (old && digest(old) !== digest(entry)) fail('REVISION_CONFLICT', 'Original proactive event identity changed');
    state.entries[entry.event.eventId] = structuredClone(entry);
  }
  function signed<T extends object>(kind: Parameters<RuntimeProactiveWorkflowHostOptions['sign']>[0], value: T, current: ProactiveSessionBinding): T & {proof: unknown} {
    const result = body(options.sign(kind, structuredClone(value) as Record<string, unknown>, current));
    const {proof, ...unsigned} = result;
    if (!Object.hasOwn(result, 'proof') || digest(unsigned) !== digest(value)) fail('UNAUTHORIZED', 'Host signer changed the original payload');
    return result as T & {proof: unknown};
  }
  function capabilities(): ProactiveHostCapability[] {
    const values: ToolBinding[] = [
      {kind: 'retrieve_context', toolName: RUNTIME_PROACTIVE_TOOLS.retrieve_context, toolVersion: RUNTIME_PROACTIVE_TOOL_VERSION, location: 'local_device', effect: 'read'},
      {kind: 'update_item', toolName: RUNTIME_PROACTIVE_TOOLS.update_item, toolVersion: RUNTIME_PROACTIVE_TOOL_VERSION, location: 'local_device', effect: 'write'},
      {kind: 'schedule_wake', toolName: RUNTIME_PROACTIVE_TOOLS.schedule_wake, toolVersion: RUNTIME_PROACTIVE_TOOL_VERSION, location: 'local_device', effect: 'write'},
      ...(options.notificationHost ? [{kind: 'notify' as const, toolName: RUNTIME_PROACTIVE_TOOLS.notify, toolVersion: RUNTIME_PROACTIVE_TOOL_VERSION, location: 'local_device' as const, effect: 'write' as const}] : []),
      ...(options.bindings ?? []),
    ];
    if (new Set(values.map(value => value.kind)).size !== values.length) fail('INVALID_ARGUMENT', 'Proactive capability binding is duplicated');
    return values.flatMap(value => {
      const descriptor = tools.list().find(tool => tool.name === value.toolName && tool.version === value.toolVersion);
      if (!descriptor) return [];
      if (value.effect === 'read' && descriptor.sideEffect !== 'read') fail('UNAUTHORIZED', 'Read capability cannot advertise a write tool');
      return [{kind: value.kind, ref: value.toolName, location: value.location, effect: value.effect}];
    });
  }
  async function resolveInvocation(proposal: ProactiveHostProposal, context: Context): Promise<AgentToolInvocation> {
    const cap = capabilities().find(value => value.kind === proposal.capabilityKind && value.ref === proposal.capabilityRef);
    if (!cap || cap.effect !== proposal.effect || cap.location !== proposal.location || proposal.argumentsDigest !== digest(proposal.arguments))
      return fail('UNAUTHORIZED', 'Proposal does not match its original registered capability');
    if (read().state.lastResult?.mode === 'paused') return fail('REVISION_CONFLICT', 'Paused workflow cannot execute new proposals');
    if (cap.location === 'local_device' && !options.localDeviceAvailable()
      || cap.location === 'cloud_persistent' && options.cloudPersistentHost?.available() !== true) return fail('UNSUPPORTED_CAPABILITY', 'Actual execution host is unavailable');
    await requireCurrentProposalContext(proposal, context);
    active(context);
    const core = coreKinds.includes(proposal.capabilityKind as CoreKind);
    const configured = options.bindings?.find(value => value.kind === proposal.capabilityKind);
    return {taskId: options.taskId, runId: proposal.operationId, authorizationRef: proposal.operationId,
      toolName: proposal.capabilityRef, toolVersion: core ? RUNTIME_PROACTIVE_TOOL_VERSION : configured!.toolVersion,
      arguments: core ? {sessionId: options.sessionId, proposalId: proposal.proposalId} : structuredClone(configured?.arguments?.(proposal) ?? proposal.arguments),
      deadline: context.deadline, signal: context.signal};
  }
  function canResumeApprovedInvocation(invocation: Omit<AgentToolInvocation, 'signal'>): boolean {
    const grant = runtime.policy.get(invocation.authorizationRef);
    return !runtime.readToolExecutions(options.taskId).some(record => record.evidenceId === invocation.runId)
      && grant?.taskId === options.taskId && grant.toolName === invocation.toolName
      && grant.argumentsDigest === toolArgumentsDigest(invocation.arguments) && Date.parse(grant.expiresAt) > now()
      && (grant.usesRemaining === undefined || grant.usesRemaining > 0);
  }
  async function readExecution(invocation: Omit<AgentToolInvocation, 'signal'>, proposal: ProactiveHostProposal): Promise<ProactiveExecutionReadback> {
    const record = runtime.readToolExecutions(options.taskId).find(value => value.evidenceId === invocation.runId);
    if (!record) return {state: 'pending', evidenceRefs: []};
    if (invocation.taskId !== options.taskId || record.toolName !== invocation.toolName || record.toolVersion !== invocation.toolVersion
      || !runtime.matchesToolExecutionInput(record, {arguments: body(invocation.arguments), scopeRef: invocation.authorizationRef}))
      return fail('UNAUTHORIZED', 'Original proactive run input/Evidence differs');
    const state = record.state === 'started' ? 'pending' : record.state;
    const cached = runtime.loadCheckpoint(options.taskId, 'tool-result-' + record.evidenceId) as {result?: unknown} | undefined;
    if (state === 'confirmed' && (!record.executionStarted || record.policyDecision !== 'allow' || !cached || !Object.hasOwn(cached, 'result')))
      return fail('UNAUTHORIZED', 'Confirmed proactive run lacks original Runtime result');
    let result = state === 'confirmed' ? structuredClone(cached!.result) : undefined;
    if (state === 'confirmed' && proposal.capabilityKind === 'delegate' && invocation.toolName === SUBAGENT_DISPATCH_TOOL_NAME) {
      const actual = readRuntimeSubagentSummary(runtime, options.taskId);
      const pending = actual.total - actual.succeeded - actual.failed - actual.cancelled;
      result = {status: pending > 0 ? 'pending' : actual.failed + actual.cancelled > 0 ? 'blocked' : 'completed',
        resultRef: 'runtime:subtask-summary:' + options.taskId + ':' + digest(actual)};
    }
    return {state, evidenceRefs: [record.evidenceId], ...(state === 'confirmed' ? {result} : {})};
  }
  function session() {
    const current = binding();
    return createProactiveWorkflowSession<ProactiveAdvanceRequest, ProactiveWorkflowResult>({atomicState: atomic, binding: current,
      assertActive: expected => {
        if (digest(binding()) !== digest(expected)) fail('REVISION_CONFLICT', 'Trusted proactive control revision changed');
        if (terminal(runtime.getTask(options.taskId))) fail('CANCELLED', 'Original Runtime task is not active');
      }, advancePort: options.advancePort, verifyAdvance: options.verifyAdvance,
      ...(options.pureAdvance ? {pureAdvance: options.pureAdvance} : {}), now,
      execution: {tools, resolveInvocation, readExecution,
        canResumeApprovedInvocation},
    });
  }
  function assertProposal(proposalId: string): ProactiveHostProposal {
    const value = session().inspect().state.proposals[proposalId] as ProactiveHostProposal | undefined;
    if (!value || value.originControlRevision !== binding().controlRevision || value.taskDeadline !== options.taskDeadline)
      return fail('UNAUTHORIZED', 'Original proposal is not committed at the current control revision');
    return value;
  }
  async function retrieve(proposal: ProactiveHostProposal, context: Context): Promise<ProactiveContextReadback> {
    active(context);
    const lifetime = {deadline: context.deadline, signal: context.signal};
    const snapshot = read(), refs = proposal.arguments.eventRefs;
    if (!Array.isArray(refs) || refs.some(ref => typeof ref !== 'string' || !snapshot.state.entries[ref])) fail('UNAUTHORIZED', 'Retrieve event binding differs');
    const entries = refs.map(ref => snapshot.state.entries[ref as string]!);
    const responsibilityIds = [...new Set(entries.flatMap(entry => entry.event.responsibilityRefs))];
    const responsibilities = responsibilityIds.map(id => snapshot.state.responsibilities[id]).filter((value): value is UnsignedResponsibility => !!value);
    const quotes = responsibilities.flatMap(value => value.sourceQuotes);
    const sourceTexts = quotes.map(ref => {
      const actual = sourceTask(ref.messageId);
      if (digest(quote(actual)) !== digest(ref)) return fail('REVISION_CONFLICT', 'Original responsibility quotation changed');
      return {quote: ref, text: actual.goal!};
    });
    const goalRefs = [...new Set(entries.flatMap(entry => entry.event.goalRefs).concat(responsibilities.flatMap(value => value.goalRefs)))];
    const graph = options.context?.goals?.read();
    const goals = goalRefs.map(ref => {
      const goal = graph?.history.findLast(value => value.kind === 'goal' && (value.id === ref || value.id + '@' + value.revision === ref));
      const head = goal && graph?.history.findLast(value => value.id === goal.id);
      if (!goal || !head || head.revision !== goal.revision || !currentPublic(head))
        return fail('UNSUPPORTED_CAPABILITY', 'Requested current public Goal is unavailable');
      return structuredClone(goal);
    });
    const at = new Date(now()).toISOString(), limit = options.context?.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('INVALID_ARGUMENT', 'Bounded public context limit required');
    const page = await options.context?.publicMemory?.listCurrent({...lifetime, at, limit});
    active(context);
    const facts = (page?.facts ?? []).filter(fact => fact.sensitivity === 'public' && fact.state === 'active'
      && Date.parse(fact.validFrom) <= now() && Date.parse(fact.validUntil) > now());
    const knowledgeQuery = sourceTexts.map(value => value.text).join('\n') || original.goal!;
    const knowledge = await options.context?.publicKnowledge?.search({...lifetime, query: knowledgeQuery, limit});
    active(context);
    const actual: RuntimeProactiveContextSnapshot = {sourceTexts, goals, facts, knowledge: knowledge?.hits ?? [],
      unavailable: [!options.context?.publicMemory && 'public_memory', !options.context?.publicKnowledge && 'public_knowledge', !options.context?.goals && 'goals'].filter((value): value is string => !!value),
      retrieval: {knowledgeQuery, knowledgeLimit: limit}};
    const contextRef = 'runtime:proactive-context:' + digest([options.taskId, options.sessionId, proposal.operationId, actual]);
    const state = read(); state.state.contexts[contextRef] = actual; save(state);
    await readCurrentContext(contextRef, context);
    return {contextRef, sourceVersions: Object.fromEntries(entries.map(entry => [entry.event.sourceId, entry.event.sourceVersion])),
      sourceQuotes: quotes, goalRefs, memoryRefs: facts.map(fact => fact.ref.id + '@' + fact.ref.revision), experienceRefs: [],
      scopeRefs: [...new Set(responsibilities.flatMap(value => value.scopeRefs))]};
  }
  function currentPublic(value: {state: string; sensitivity: string; validFrom: string; validUntil: string}): boolean {
    return value.state === 'active' && value.sensitivity === 'public'
      && Number.isFinite(Date.parse(value.validFrom)) && Number.isFinite(Date.parse(value.validUntil))
      && Date.parse(value.validFrom) <= now() && Date.parse(value.validUntil) > now();
  }
  function staleContext(contextRef: string, reason: string): never {
    const snapshot = read();
    snapshot.state.contextValidity ??= {};
    snapshot.state.contextValidity[contextRef] = {state: 'needs_refresh', reason, observedAt: new Date(now()).toISOString()};
    save(snapshot);
    return fail('REVISION_CONFLICT', 'Proactive context needs_refresh (' + reason + '); retrieve_context is required');
  }
  async function readCurrentContext(contextRef: string, context: Context): Promise<RuntimeProactiveContextSnapshot> {
    active(context);
    const lifetime = {deadline: context.deadline, signal: context.signal};
    const snapshot = read(), saved = snapshot.state.contexts[contextRef] as RuntimeProactiveContextSnapshot | undefined;
    if (!saved) return fail('NOT_FOUND', 'Original proactive context is unavailable');
    if (snapshot.state.contextValidity?.[contextRef])
      return fail('REVISION_CONFLICT', 'Proactive context needs_refresh; retrieve_context is required');
    if (!Array.isArray(saved.sourceTexts) || !Array.isArray(saved.goals) || !Array.isArray(saved.facts)
      || !Array.isArray(saved.knowledge) || !saved.retrieval || !text(saved.retrieval.knowledgeQuery)
      || !Number.isSafeInteger(saved.retrieval.knowledgeLimit) || saved.retrieval.knowledgeLimit < 1 || saved.retrieval.knowledgeLimit > 100)
      return staleContext(contextRef, 'original_query_binding_unavailable');
    for (const source of saved.sourceTexts) {
      const current = sourceTask(source.quote.messageId);
      if (digest(quote(current)) !== digest(source.quote) || current.goal !== source.text)
        return staleContext(contextRef, 'source_quote_changed');
    }
    // Search only the original authorized public query. Additional unrelated hits do not invalidate its references.
    if (saved.knowledge.length) {
      if (!options.context?.publicKnowledge) return staleContext(contextRef, 'public_knowledge_unavailable');
      let current;
      try {current = await options.context.publicKnowledge.search({...lifetime,
        query: saved.retrieval.knowledgeQuery, limit: saved.retrieval.knowledgeLimit});}
      catch (error) {
        active(context);
        if (['SOURCE_CHANGED', 'SOURCE_UNAVAILABLE', 'SCOPE_DENIED'].includes(String((error as {code?: unknown})?.code)))
          return staleContext(contextRef, 'knowledge_source_unavailable');
        throw error;
      }
      active(context);
      if (saved.knowledge.some(hit => !current.hits.some(value => digest(value.source) === digest(hit.source) && value.excerpt === hit.excerpt)))
        return staleContext(contextRef, 'knowledge_source_revision_changed');
    }
    for (const fact of saved.facts) {
      if (!currentPublic(fact) || !options.context?.publicMemory) return staleContext(contextRef, 'public_fact_unavailable');
      let current;
      try {current = await options.context.publicMemory.listCurrent({...lifetime, factId: fact.ref.id,
        at: new Date(now()).toISOString(), limit: 1});}
      catch (error) {
        active(context);
        if (['SCOPE_DENIED', 'NOT_FOUND', 'REVISION_CONFLICT', 'UNSUPPORTED_CAPABILITY'].includes(String((error as {code?: unknown})?.code)))
          return staleContext(contextRef, 'public_fact_unavailable');
        throw error;
      }
      active(context);
      if (!current.facts.some(value => value.ref.id === fact.ref.id && value.ref.revision === fact.ref.revision
        && currentPublic(value) && digest(value) === digest(fact))) return staleContext(contextRef, 'fact_head_changed_or_withdrawn');
    }
    const graph = saved.goals.length ? options.context?.goals?.read() : undefined;
    for (const goal of saved.goals) {
      const current = graph?.history.findLast(value => value.id === goal.id);
      if (!current || current.kind !== 'goal' || current.revision !== goal.revision || !currentPublic(current)
        || digest(current) !== digest(goal)) return staleContext(contextRef, 'goal_head_changed_or_unavailable');
    }
    active(context);
    if (saved.facts.some(fact => !currentPublic(fact))) return staleContext(contextRef, 'public_fact_expired');
    return structuredClone(saved);
  }
  async function requireCurrentProposalContext(proposal: ProactiveHostProposal, context: Context) {
    if (proposal.stage === 'retrieve' || proposal.stage === 'update' || proposal.stage === 'wake') return;
    const refs = proposal.stage === 'laya' || proposal.stage === 'teacher'
      ? (Array.isArray(proposal.arguments.independentQuestions) ? proposal.arguments.independentQuestions.map(value => body(value).contextRef) : [])
      : [proposal.arguments.contextRef];
    if (!refs.length || refs.some(value => !text(value))) return fail('UNAUTHORIZED', 'Original proposal context binding is unavailable');
    for (const ref of new Set(refs)) await readCurrentContext(ref as string, context);
    active(context);
  }
  async function executeCore(kind: CoreKind, proposalId: string, context: ToolContext): Promise<unknown> {
    if (context.taskId !== options.taskId || context.runId !== proposalId) fail('UNAUTHORIZED', 'Core tool must run on its original Runtime task');
    active(context);
    const proposal = assertProposal(proposalId);
    if (proposal.capabilityKind !== kind || proposal.capabilityRef !== RUNTIME_PROACTIVE_TOOLS[kind]) fail('UNAUTHORIZED', 'Core capability differs');
    if (kind === 'retrieve_context') return retrieve(proposal, context);
    const snapshot = read();
    if (kind === 'update_item') {
      const itemId = proposal.itemIds[0]!;
      snapshot.state.itemStates[itemId] = structuredClone(proposal.arguments); save(snapshot);
      return {itemId, stateRef: 'runtime:proactive-item:' + digest([options.taskId, options.sessionId, itemId, proposal.arguments])};
    }
    if (kind === 'schedule_wake') {
      const wake = body(proposal.arguments.wake);
      if (!text(wake.runAt) || Date.parse(wake.runAt) > Date.parse(options.taskDeadline)) fail('INVALID_ARGUMENT', 'Wake cannot extend original task deadline');
      const schedule = runtime.createSchedule({scheduleId: proposal.operationId, goal: String(wake.reason), conversationId: original.conversationId!,
        runAt: wake.runAt, timeZone: String(wake.timeZone), missedRunPolicy: wake.missedRunPolicy as 'run_once' | 'skip',
        taskIdempotencyKey: String(proposal.arguments.taskIdempotencyKey)});
      snapshot.state.schedules[schedule.scheduleId] = digest(proposal.arguments); save(snapshot);
      return {scheduleId: schedule.scheduleId, runAt: schedule.runAt, state: schedule.status};
    }
    if (!options.notificationHost) return fail('UNSUPPORTED_CAPABILITY', 'Original notification host is unavailable');
    const item = read().state.lastResult?.items[proposal.itemIds[0]!];
    const sourceItems = (item?.eventRefs ?? []).map(ref => snapshot.state.entries[ref]?.payload)
      .filter((payload): payload is ProactiveEvent => !!payload && typeof payload === 'object' && 'item' in payload);
    if (!sourceItems.length) return fail('UNSUPPORTED_CAPABILITY', 'Notification requires an original persisted connector item');
    options.notificationHost.ingest(sourceItems.map(value => value.item));
    const feed = options.notificationHost.notificationFeed({limit: 100});
    if (sourceItems.some(value => !feed.items.some(entry => entry.id === value.item.dedupeKey)))
      return fail('RESULT_UNKNOWN', 'Notification ingest needs original feed readback');
    return {status: 'completed', resultRef: 'runtime:notification-feed:' + digest(sourceItems.map(value => value.eventId))};
  }
  async function advanceFrontier(input: Context & {requestId: string}): Promise<ProactiveWorkflowResult> {
    active(input);
    let snapshot = read(), frozen = snapshot.state.requests[input.requestId];
    if (!text(input.requestId)) fail('INVALID_ARGUMENT', 'Stable original request identity required');
    if (!frozen) {
      if (Object.values(snapshot.state.requests).some(value => !value.acknowledged)) fail('REVISION_CONFLICT', 'Original pending proactive request must be recovered first');
      const current = snapshot.state.binding;
      const entryIds = Object.keys(snapshot.state.entries).filter(id => !snapshot.state.delivered['event:' + id]);
      const responsibilityIds = Object.keys(snapshot.state.responsibilities).filter(id => !snapshot.state.delivered['responsibility:' + id + ':' + snapshot.state.responsibilities[id]!.revision]);
      const receiptIds = Object.keys(snapshot.state.receipts).filter(id => !snapshot.state.delivered['receipt:' + digest(snapshot.state.receipts[id])]);
      const request: Omit<ProactiveAdvanceRequest, 'signal' | 'checkpoint'> = {...current, requestId: input.requestId, deadline: input.deadline,
        hostAvailability: {localDevice: options.localDeviceAvailable() === true, cloudPersistentHost: options.cloudPersistentHost?.available() === true},
        availableCapabilities: capabilities(), events: entryIds.map(id => signed('event', snapshot.state.entries[id]!.event, current)),
        responsibilities: responsibilityIds.map(id => signed('responsibility', snapshot.state.responsibilities[id]!, current)),
        receipts: receiptIds.map(id => signed('receipt', snapshot.state.receipts[id]!, current)),
        ...(snapshot.state.pendingControl ? {control: signed('control', snapshot.state.pendingControl, current)} : {})};
      frozen = {input: request, entryIds, responsibilityIds, receiptIds, acknowledged: false};
      snapshot.state.requests[input.requestId] = frozen; save(snapshot);
    } else if (frozen.input.deadline !== input.deadline || frozen.input.controlRevision !== snapshot.state.binding.controlRevision) {
      fail('REVISION_CONFLICT', 'Original proactive request lifetime/control revision differs');
    }
    const result = await session().advance({...structuredClone(frozen.input), signal: input.signal});
    snapshot = read(); const saved = snapshot.state.requests[input.requestId]!;
    for (const id of frozen.entryIds) snapshot.state.delivered['event:' + id] = true;
    for (const value of frozen.input.responsibilities ?? []) snapshot.state.delivered['responsibility:' + value.id + ':' + value.revision] = true;
    for (const value of frozen.input.receipts ?? []) {const {proof: _, ...unsigned} = value; snapshot.state.delivered['receipt:' + digest(unsigned)] = true;}
    saved.acknowledged = true;
    if (!snapshot.state.lastResult || result.advanceRevision >= snapshot.state.lastResult.advanceRevision) snapshot.state.lastResult = structuredClone(result);
    if (frozen.input.control?.commandId === snapshot.state.pendingControl?.commandId) delete snapshot.state.pendingControl;
    save(snapshot); return result;
  }
  const host = {
    taskId: options.taskId, sessionId: options.sessionId,
    get binding() {return structuredClone(binding());},
    eventSink: {async persist(batch: ProactiveBatch, context: ProactiveContext) {
      active(context);
      const snapshot = read(), old = snapshot.state.batches[batch.batchId];
      if (old && digest(old) !== digest(batch)) fail('REVISION_CONFLICT', 'Original connector batch identity changed');
      const responsibilityRefs = Object.keys(snapshot.state.responsibilities);
      for (const event of batch.events) {
        if (event.sourceId !== batch.sourceId || !text(event.eventId) || !text(event.sourceRevision)) fail('UNAUTHORIZED', 'Connector event does not belong to its durable batch');
        const route = options.routeConnectorEvent?.(structuredClone(event)) ?? {};
        appendEntry(snapshot.state, {event: {eventId: event.eventId, entry: 'connector', conversationId: original.conversationId!,
          sourceId: event.sourceId, entityRef: event.item.dedupeKey, sourceVersion: event.sourceRevision, observedAt: event.observedAt,
          change: 'upsert', payloadRef: 'runtime:proactive-batch:' + batch.batchId + ':' + event.eventId, payloadDigest: digest(event.item),
          anchorRefs: [], responsibilityRefs, goalRefs: [], contractRef: options.contractRef, priority: 'unknown',
          evidenceRefs: ['runtime:proactive-batch:' + batch.batchId], ...route}, payload: event});
      }
      snapshot.state.batches[batch.batchId] = structuredClone(batch); save(snapshot);
      notify();
      return {batchId: batch.batchId, durable: true as const};
    }} satisfies ProactiveEventSink,
    registerResponsibility(input: {id: string; revision: number; sourceTaskIds: readonly string[]; goalRefs: readonly string[];
      authority: ProactiveResponsibility['authority']; scopeRefs: readonly string[]}, context: Context) {
      active(context);
      if (!text(input.id) || !Number.isSafeInteger(input.revision) || input.revision < 1 || !['explicit_instruction', 'inferred_interest'].includes(input.authority)
        || input.authority === 'inferred_interest' && input.scopeRefs.length > 0 || input.authority === 'explicit_instruction' && !input.sourceTaskIds.length)
        fail('INVALID_ARGUMENT', 'Responsibility requires original user quotes; inferred interests cannot carry scopes');
      const value: UnsignedResponsibility = {id: input.id, revision: input.revision, conversationId: original.conversationId!,
        sourceQuotes: input.sourceTaskIds.map(id => quote(sourceTask(id))), goalRefs: [...input.goalRefs], authority: input.authority, scopeRefs: [...input.scopeRefs]};
      const snapshot = read(), old = snapshot.state.responsibilities[input.id];
      if (old && (old.revision > value.revision || old.revision === value.revision && digest(old) !== digest(value))) fail('REVISION_CONFLICT', 'Original responsibility revision changed');
      snapshot.state.responsibilities[input.id] = value; save(snapshot); notify(); return structuredClone(value);
    },
    ingestUserInstruction(input: {sourceTaskId: string; responsibilityId?: string; goalRefs?: readonly string[]}, context: Context) {
      active(context);
      const source = sourceTask(input.sourceTaskId), sourceQuote = quote(source), id = input.responsibilityId ?? 'instruction:' + source.taskId;
      host.registerResponsibility({id, revision: 1, sourceTaskIds: [source.taskId], goalRefs: input.goalRefs ?? [], authority: 'explicit_instruction', scopeRefs: []}, context);
      const snapshot = read(), eventId = 'user-instruction:' + source.taskId;
      appendEntry(snapshot.state, {event: {eventId, entry: 'user_instruction', conversationId: source.conversationId!, sourceId: 'runtime:user-instruction',
        entityRef: source.taskId, sourceVersion: sourceQuote.sha256, observedAt: runtimeEvents(source.taskId)[0]!.occurredAt, change: 'upsert',
        payloadRef: sourceQuote.quoteRef, payloadDigest: sourceQuote.sha256, anchorRefs: [sourceQuote.quoteRef], responsibilityRefs: [id],
        goalRefs: [...(input.goalRefs ?? [])], contractRef: options.contractRef, priority: 'unknown', evidenceRefs: taskEvidence(source.taskId)}, payload: {quote: sourceQuote}});
      save(snapshot); notify(); return eventId;
    },
    async ingestSubtaskFeedback(input: {childTaskId: string; expectedRevision: number}, context: Context) {
      active(context);
      const child = runtime.getTask(input.childTaskId), childBinding = runtime.loadCheckpoint(child.taskId, 'subtask-parent') as
        (import('@personal-agent/agents').SubtaskDefinition & {parentTaskId: string; parentDeadline: string}) | undefined;
      if (child.revision !== input.expectedRevision) fail('REVISION_CONFLICT', 'Child report revision changed');
      if (!childBinding || childBinding.parentTaskId !== options.taskId || childBinding.parentDeadline !== options.taskDeadline
        || child.conversationId !== 'desktop-subtask:' + options.taskId
        || runtime.findTaskByIdempotencyKey('subagent-dispatch-' + options.taskId + '-' + childBinding.subtaskId)?.taskId !== child.taskId)
        fail('UNAUTHORIZED', 'Child report is not bound to the original controller');
      const summary = readRuntimeSubagentSummary(runtime, options.taskId);
      if (!summary.subtasks.some(item => item.subtaskId === childBinding.subtaskId)) fail('UNAUTHORIZED', 'Child was not included in its original dispatch');
      const dispatches = runtime.readToolExecutions(options.taskId).filter(record => record.toolName === SUBAGENT_DISPATCH_TOOL_NAME && record.state === 'confirmed'
        && record.executionStarted && record.policyDecision === 'allow').filter(record => {
          const pending = session().inspect().state.operations;
          return Object.values(pending).some(value => value.invocation.runId === record.evidenceId && value.invocation.toolName === SUBAGENT_DISPATCH_TOOL_NAME
            && runtime.matchesToolExecutionInput(record, {arguments: body(value.invocation.arguments), scopeRef: value.invocation.authorizationRef})
            && Array.isArray(body(value.invocation.arguments).subtasks) && (body(value.invocation.arguments).subtasks as import('@personal-agent/agents').SubtaskDefinition[])
              .some(definition => computeSubtaskInputDigest(definition) === computeSubtaskInputDigest(childBinding)));
        });
      if (!dispatches.length) fail('UNAUTHORIZED', 'Child report lacks its original confirmed dispatch Evidence');
      const eventId = 'subtask-feedback:' + child.taskId + ':' + child.revision;
      const report: RuntimeProactiveChildReport = {eventId, parentTaskId: options.taskId, childTaskId: child.taskId, childRevision: child.revision,
        subtaskId: childBinding.subtaskId, state: child.state, ...(child.resultSummary ? {resultSummary: child.resultSummary} : {}),
        evidenceRefs: [...new Set([...child.evidenceRefs, ...dispatches.map(record => record.evidenceId), ...taskEvidence(child.taskId)])],
        reportRef: 'runtime:subtask-report:' + child.taskId + ':' + child.revision};
      const snapshot = read();
      appendEntry(snapshot.state, {event: {eventId, entry: 'subtask_feedback', conversationId: original.conversationId!, sourceId: 'runtime:subtasks', entityRef: child.taskId,
        sourceVersion: String(child.revision), observedAt: runtimeEvents(child.taskId).at(-1)!.occurredAt, change: 'upsert', payloadRef: report.reportRef,
        payloadDigest: digest(report), anchorRefs: [options.taskId], responsibilityRefs: [], goalRefs: [], contractRef: options.contractRef,
        priority: 'unknown', evidenceRefs: report.evidenceRefs}, payload: report});
      const old = snapshot.state.controllerReports[eventId];
      if (old?.state === 'confirmed') return structuredClone(old);
      if (old) fail('RESULT_UNKNOWN', 'Original controller report is pending; read back its existing receipt');
      snapshot.state.controllerReports[eventId] = {report, state: 'pending'}; save(snapshot);
      notify();
      runtime.recordProgress(options.taskId, {stepId: eventId, label: 'Bound child ' + childBinding.subtaskId + ': ' + child.state});
      if (!options.controller) return {report, state: 'pending' as const, unavailable: 'controller_consumer'};
      const receipt = await options.controller.consume(structuredClone(report), context); active(context);
      return confirmControllerReceipt(eventId, receipt);
    },
    async reconcileControllerReport(eventId: string, context: Context) {
      active(context, true);
      const old = read().state.controllerReports[eventId];
      if (!old) return fail('NOT_FOUND', 'Original bound controller report unavailable');
      if (old.state === 'confirmed') return structuredClone(old);
      if (!options.controller) return fail('UNSUPPORTED_CAPABILITY', 'Original controller receipt reader unavailable');
      const receipt = await options.controller.readReceipt(eventId, context); active(context, true);
      return receipt ? confirmControllerReceipt(eventId, receipt) : structuredClone(old);
    },
    ingestWake(scheduleId: string, context: Context) {
      active(context);
      const schedule = runtime.getSchedule(scheduleId), snapshot = read();
      if (!snapshot.state.schedules[scheduleId] || schedule.status !== 'fired' || !schedule.taskId
        || schedule.conversationId !== original.conversationId || runtime.findTaskByIdempotencyKey(schedule.taskIdempotencyKey)?.taskId !== schedule.taskId)
        fail('UNAUTHORIZED', 'Wake must read back the original fired Runtime schedule');
      const eventId = 'runtime-wake:' + scheduleId;
      appendEntry(snapshot.state, {event: {eventId, entry: 'wake', conversationId: original.conversationId!, sourceId: 'runtime:scheduler', entityRef: scheduleId,
        sourceVersion: digest(schedule), observedAt: runtimeEvents(schedule.taskId)[0]!.occurredAt, change: 'upsert', payloadRef: 'runtime:schedule:' + scheduleId,
        payloadDigest: digest(schedule), anchorRefs: [options.taskId, schedule.taskId], responsibilityRefs: [], goalRefs: [], contractRef: options.contractRef,
        priority: 'normal', evidenceRefs: taskEvidence(schedule.taskId)}, payload: schedule});
      save(snapshot); notify(); return eventId;
    },
    async advance(input: Context & {requestId: string}): Promise<ProactiveWorkflowResult> {
      return serializeFrontier(() => advanceFrontier(input));
    },
    async control(command: RuntimeProactiveControlCommand, context: Context): Promise<ProactiveWorkflowResult> {
      return serializeFrontier(async () => {
      active(context);
      const source = sourceTask(command.sourceTaskId);
      if (!options.verifyControlCommand || await options.verifyControlCommand(structuredClone(command), source, context) !== true)
        return fail('UNAUTHORIZED', 'Original final user control has no trusted native origin');
      active(context);
      const snapshot = read(), old = snapshot.state.commands[command.commandId];
      if (old) {
        if (digest(old.command) !== digest(command) || old.revision !== snapshot.state.binding.controlRevision) fail('REVISION_CONFLICT', 'Old control command cannot alter the current workflow');
      } else {
        if (command.expectedControlRevision !== snapshot.state.binding.controlRevision || Object.values(snapshot.state.requests).some(value => !value.acknowledged)
          || snapshot.state.pendingControl) fail('REVISION_CONFLICT', 'Original proactive control or request is pending');
        const priorSession = session().inspect(), records = runtime.readToolExecutions(options.taskId);
        const neverStarted = Object.values(priorSession.state.proposals).filter(proposal =>
          !priorSession.state.operations[proposal.operationId] && !records.some(record => record.evidenceId === proposal.operationId)
          && Object.values(snapshot.state.lastResult?.items ?? {}).some(item => item.pendingProposalId === proposal.proposalId));
        snapshot.state.binding.controlRevision++;
        if (neverStarted.length) {
          const stepId = 'proactive-control-' + digest([command.commandId, neverStarted.map(proposal => proposal.operationId)]);
          runtime.recordProgress(options.taskId, {stepId, label: 'Control revision ' + snapshot.state.binding.controlRevision
            + ' withdrew ' + neverStarted.length + ' proposals before any Runtime operation or run existed'});
          const evidenceRefs = runtimeEvents(options.taskId).filter(event => event.type === 'task.progress'
            && (event.payload as {stepId?: string}).stepId === stepId).map(event => event.eventId);
          if (!evidenceRefs.length) fail('UNAUTHORIZED', 'Original Runtime control progress evidence is unavailable');
          for (const proposal of neverStarted) snapshot.state.receipts[proposal.operationId] = {
            proposalId: proposal.proposalId, operationId: proposal.operationId, argumentsDigest: proposal.argumentsDigest,
            state: 'failed', result: {kind: 'not_performed', reason: 'control_revision_changed'},
            observedAt: new Date(now()).toISOString(), evidenceRefs,
          };
        }
        const control: UnsignedControl = {commandId: command.commandId, action: command.action, evidenceRefs: taskEvidence(source.taskId)};
        snapshot.state.commands[command.commandId] = {command: structuredClone(command), revision: snapshot.state.binding.controlRevision, control};
        snapshot.state.pendingControl = control; save(snapshot);
      }
      const result = await advanceFrontier({...context, requestId: 'control-' + digest(command.commandId)});
      if (command.action === 'cancel') runtime.requestCancel(options.taskId, 'Original proactive workflow cancelled');
      notify();
      return result;
      });
    },
    async executeProposal(proposal: ProactiveHostProposal, context: Context): Promise<ProactiveExecutionReadback> {
      active(context);
      if (runtime.getTask(options.taskId).state !== 'running') return fail('REVISION_CONFLICT', 'Original Runtime worker must be running to execute a proposal');
      if (digest(assertProposal(proposal.proposalId)) !== digest(proposal)) return fail('UNAUTHORIZED', 'Committed original proposal binding differs');
      const old = session().inspect().state.operations[proposal.operationId];
      // A pending unknown run is read back below. Only an original approval with no Runtime run may invoke again.
      if (old?.state === 'pending' && canResumeApprovedInvocation(old.invocation)) {
        await requireCurrentProposalContext(proposal, context); active(context);
      }
      const result = await session().executeProposal(proposal, context);
      if (result.state !== 'pending') storeReceipt(proposal, result);
      return result;
    },
    async reconcileOperation(operationId: string, context: Context) {
      active(context, true);
      const originalSession = session(), proposal = originalSession.inspect().state.operations[operationId]?.proposal as ProactiveHostProposal | undefined;
      const result = await originalSession.reconcileOperation(operationId, context);
      if (proposal && result.state !== 'pending') storeReceipt(proposal, result);
      notify();
      return result;
    },
    async recoverPendingRequest(requestId: string, context: Pick<Context, 'signal'>) {
      const originalRequest = read().state.requests[requestId];
      if (!originalRequest) return fail('NOT_FOUND', 'Original frozen proactive request unavailable');
      await session().recoverPendingRequest(requestId, context);
      const result = await host.advance({requestId, signal: context.signal, deadline: originalRequest.input.deadline});
      notify(); return result;
    },
    /** Existing caller owns TaskRuntime.runTask and terminal state. This returns a frontier, never task success. */
    async run(worker: WorkerContext, input: {requestId: string}) {
      if (worker.taskId !== options.taskId || worker.deadline !== options.taskDeadline) fail('UNAUTHORIZED', 'Original Runtime worker binding differs');
      const result = await host.advance({...input, signal: worker.signal, deadline: worker.deadline});
      for (const proposal of result.proposals) {
        if (runtime.getTask(options.taskId).state !== 'running') break;
        await host.executeProposal(proposal, {signal: worker.signal, deadline: worker.deadline});
      }
      return result;
    },
    resumeApproved() {if (!options.resumeWorker) return fail('UNSUPPORTED_CAPABILITY', 'Original proactive worker re-entry is unavailable'); options.resumeWorker();},
    /** Historical inspection only. Consumers about to decide or act must await readCurrentContext. */
    readContext(contextRef: string) {
      const context = read().state.contexts[contextRef];
      if (!context) return fail('NOT_FOUND', 'Original proactive context is unavailable');
      return structuredClone(context);
    },
    readCurrentContext,
    executeCore,
    subscribe(listener: () => void): () => void {listeners.add(listener); return () => {listeners.delete(listener);};},
    notifyAvailabilityChanged() {notify();},
    inspect() {return {application: read(), session: session().inspect()};},
    returnDigest() {return options.notificationHost?.getDigest({trigger: 'on_return'});},
  };
  function storeReceipt(proposal: ProactiveHostProposal, readback: ProactiveExecutionReadback) {
    const receipt: UnsignedReceipt = {proposalId: proposal.proposalId, operationId: proposal.operationId, argumentsDigest: proposal.argumentsDigest,
      state: readback.state === 'pending' ? 'unknown' : readback.state, result: readback.result ?? null, observedAt: new Date(now()).toISOString(), evidenceRefs: [...readback.evidenceRefs]};
    const snapshot = read(), old = snapshot.state.receipts[proposal.operationId];
    if (old?.state === 'confirmed' || old?.state === 'failed') {
      if (old.state !== receipt.state || digest(old.result) !== digest(receipt.result) || digest(old.evidenceRefs) !== digest(receipt.evidenceRefs)) fail('REVISION_CONFLICT', 'Original settled operation receipt differs');
      return;
    }
    snapshot.state.receipts[proposal.operationId] = receipt; save(snapshot);
  }
  function confirmControllerReceipt(eventId: string, receipt: RuntimeProactiveControllerReceipt) {
    if (!receipt || !['continue', 'summary', 'notify_controller', 'request_controller'].includes(receipt.action) || !text(receipt.receiptRef))
      return fail('UNAUTHORIZED', 'Original controller receipt lacks its binding');
    const snapshot = read(), old = snapshot.state.controllerReports[eventId];
    if (!old) return fail('NOT_FOUND', 'Original controller report is unavailable');
    if (old.receipt && digest(old.receipt) !== digest(receipt)) return fail('REVISION_CONFLICT', 'Original controller receipt changed');
    old.state = 'confirmed'; old.receipt = structuredClone(receipt); save(snapshot); return structuredClone(old);
  }
  return host;
}
export type RuntimeProactiveWorkflowHost = ReturnType<typeof createRuntimeProactiveWorkflowHost>;

/** Register at the existing ToolGateway construction boundary; execution re-reads the committed proposal. */
export function createRuntimeProactiveWorkflowTools(resolveHost: (taskId: string, sessionId: string) => RuntimeProactiveWorkflowHost | undefined): RegisteredTool[] {
  return coreKinds.map(kind => ({descriptor: {name: RUNTIME_PROACTIVE_TOOLS[kind], version: RUNTIME_PROACTIVE_TOOL_VERSION,
    inputSchema: {type: 'object', required: ['sessionId', 'proposalId'], additionalProperties: false,
      properties: {sessionId: {type: 'string', minLength: 1}, proposalId: {type: 'string', minLength: 1}}}, outputSchema: {type: 'object'},
    sideEffect: kind === 'retrieve_context' ? 'read' : 'local_write', requiredScopes: [kind === 'retrieve_context' ? 'proactive:read' : 'proactive:write'],
    idempotencySupport: true, recoverySupport: true, requiresPresence: false}, execute: async (input: unknown, context: ToolContext) => {
      const args = body(input), host = resolveHost(context.taskId, String(args.sessionId));
      if (!host) return fail('UNSUPPORTED_CAPABILITY', 'Original proactive application session is unavailable');
      return host.executeCore(kind, String(args.proposalId), context);
    }}));
}
