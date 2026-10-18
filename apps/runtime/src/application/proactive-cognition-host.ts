import {ProtocolError} from '@personal-agent/contracts';
import type {TaskSnapshot} from '@personal-agent/contracts';
import {actionArgumentsDigest, analyzeImpact, buildMinimalRepairCandidate, previewStoredRepair,
  selectGoalRevisionImpact, selectGoalAncestorImpact, selectProjectedRepairScope} from '@personal-agent/cognition';
import type {GoalRevisionSelectionRequest, GoalAncestorSelectionRequest, ImpactItem, LayaActionChoiceService,
  LayaActionSelection, ProjectedRepairInput, StoredRepairRequest} from '@personal-agent/cognition';
import type {MemoryReadContext} from '@personal-agent/memory';
import {isEffective} from '@personal-agent/goals';
import type {GraphSnapshot, NodeRef, NodeVersion} from '@personal-agent/goals';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';
import type {SqliteFactProjectionHost} from './sqlite-fact-projection.js';

const INTENT = 'proactive-cognition-intent-v1';
const REVIEW = 'proactive-cognition-review-v1';
const HANDOFF = 'proactive-cognition-handoff-v1';
const LAYA_COOLDOWN = 'proactive-cognition-laya-cooldown-v1';
type Trigger = {kind: 'fact'; input: ProjectedRepairInput}
  | {kind: 'goal'; input: GoalRevisionSelectionRequest}
  | {kind: 'goal_created'; input: GoalCreatedSelectionRequest}
  | {kind: 'goal_unplanned'; input: GoalCreatedSelectionRequest}
  | {kind: 'goal_ancestor'; input: GoalAncestorSelectionRequest & {consumers: NodeRef[]}}
  | {kind: 'expiry'; input: {graphRevision: number; facts: NodeRef[]; consumers: NodeRef[]}};
export interface GoalCreatedSelectionRequest {expectedGraphRevision: number; currentGoal: NodeRef}
interface ReviewIntent {
  version: 1; graphNamespace: string; bindingVersion: string; trigger: Trigger; evaluatedAt: string;
  retryOf?: string;
}
/** A proposed approach for AgentArts, never a local tool call or authorization. */
export interface ProactiveCognitionOption {
  id: string;
  revision: number;
  description: string;
  action: 'RECHECK' | 'REVISE';
  repair?: StoredRepairRequest;
}
export interface ProactiveCognitionReview {
  taskId: string;
  graphNamespace: string;
  graphRevision: number;
  bindingVersion: string;
  evaluatedAt: string;
  action: 'KEEP' | 'RECHECK' | 'REVISE';
  affected: ImpactItem[];
  /** Exact registered Goal awaiting initial planning; not a fabricated impact item or a created Plan. */
  subjectGoal?: NodeRef;
  options: ProactiveCognitionOption[];
  selectedOption?: ProactiveCognitionOption;
  /** Low-confidence Laya result routed to the already-offered machine RECHECK option. */
  machineReview?: {reason: 'uncertain'; action: 'RECHECK'; option: {id: string; revision: number}};
  selection?: LayaActionSelection;
  /** Structural proposals are inputs to AgentArts semantic reasoning, not completed repairs. */
  semanticReviewRequired: true;
}
/** Local host envelope. Only its explicitly export-approved goal enters CoordinationRequest. */
export interface ProactiveSelectionHandoff {
  commandId: string;
  reviewTaskId: string;
  selectionDigest: string;
  exportPolicyVersion: string;
  goal: string;
  deadline: string;
}
export interface ProactiveSelectionHandoffPort {
  /** Minimize permitted data for AgentArts; return undefined when egress scope is unavailable. */
  prepare(review: ProactiveCognitionReview, context: MemoryReadContext): Promise<{
    exportPolicyVersion: string; goal: string;
  } | undefined>;
  /** Read an already-persisted Runtime task by this exact stable command ID. No network or dispatch. */
  read(commandId: string): TaskSnapshot | undefined;
  /** Revalidate export scope, then submit to existing AgentArts Runtime orchestration with command idempotency. */
  dispatch(request: ProactiveSelectionHandoff, context: MemoryReadContext): Promise<TaskSnapshot>;
}
export interface ProactiveReviewReadback {
  task: TaskSnapshot;
  review?: ProactiveCognitionReview;
  handoff?: {state: 'submitted'; task: TaskSnapshot} | {state: 'unavailable' | 'expired' | 'pending'};
}
export interface ProactiveCognitionHostOptions {
  application: RuntimeApplication;
  facts: SqliteFactProjectionHost;
  graphNamespace: string;
  bindingVersion: string;
  chooser: Pick<LayaActionChoiceService, 'choose'>;
  now?: () => number;
  /** Optional host-authored legal approaches. Scope and every repair are validated before Laya. */
  prepareOptions?(review: ProactiveCognitionReview, context: MemoryReadContext): Promise<readonly ProactiveCognitionOption[]>;
  selectionHandoff?: ProactiveSelectionHandoffPort;
}
export interface ProactiveCognitionHost {
  consumeAndReview(request: MemoryReadContext & {at: string; limit: number; afterGraphRevision: number}): Promise<{
    reviews: ProactiveReviewReadback[]; nextGraphRevision: number; atWatermark: boolean; hasMoreReviews: boolean;
  }>;
  reviewGoalRevision(input: GoalRevisionSelectionRequest, request: MemoryReadContext & {at: string}): Promise<ProactiveReviewReadback>;
  reviewGoalCreated(input: GoalCreatedSelectionRequest, request: MemoryReadContext & {at: string}): Promise<ProactiveReviewReadback>;
  /** Compatibility: only never-reviewed, never-planned current revisions enter this additive scope. */
  reviewUnplannedGoal(input: GoalCreatedSelectionRequest, request: MemoryReadContext & {at: string}): Promise<ProactiveReviewReadback | undefined>;
  /** Additive current-head difference scope. Empty scope creates no task; old choices stay immutable. */
  reviewGoalAncestorImpact(input: GoalAncestorSelectionRequest, request: MemoryReadContext & {at: string}): Promise<ProactiveReviewReadback | undefined>;
  readReview(taskId: string): ProactiveReviewReadback;
  /** Retry the same idempotent AgentArts handoff, never rerun a saved Laya decision. */
  handoffReview(taskId: string, context: MemoryReadContext): Promise<ProactiveReviewReadback>;
  close(): void;
}

function active(context: MemoryReadContext): void {
  if (!(context.signal instanceof AbortSignal) || !Number.isFinite(Date.parse(context.deadline))) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid cognition request');
  }
  if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Cognition request cancelled');
  if (Date.now() >= Date.parse(context.deadline)) throw new ProtocolError('TIMEOUT', 'Cognition deadline expired');
}
function evaluationTime(at: string): void {
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid cognition evaluation time');
  }
}
function localDecisionContext(snapshot: GraphSnapshot, affected: readonly ImpactItem[]): string {
  const current = new Map(snapshot.history.map(node => [node.id, node]));
  const detail = affected.map(item => ({kind: item.kind,
    summary: current.get(item.node.id)!.summary,
    changes: item.causes.map(cause => ({reason: cause.reason,
      before: snapshot.history.find(node => node.id === cause.reference.id
        && node.revision === cause.reference.revision)?.summary,
      current: current.get(cause.reference.id)?.summary,
    })),
  }));
  const context = {destination: 'AgentArts orchestration', semanticReviewRequired: true,
    affectedCount: affected.length, detail};
  return JSON.stringify(context);
}

function createdGoal(snapshot: GraphSnapshot, ref: NodeRef, at: string): NodeVersion {
  const goal = snapshot.history.findLast(node => node.id === ref.id);
  if (!goal || goal.kind !== 'goal' || goal.state !== 'active' || !isEffective(goal, at)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'New Goal is not active and effective');
  }
  if (goal.revision !== 1 || ref.revision !== 1) {
    throw new ProtocolError('REVISION_CONFLICT', 'New Goal revision changed');
  }
  return goal;
}
function goalCreatedInput(input: GoalCreatedSelectionRequest): GoalCreatedSelectionRequest {
  const ref = input?.currentGoal;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Reflect.ownKeys(input).length !== 2 || !Object.hasOwn(input, 'expectedGraphRevision')
    || !Object.hasOwn(input, 'currentGoal') || !Number.isSafeInteger(input.expectedGraphRevision)
    || input.expectedGraphRevision < 1 || !ref || typeof ref !== 'object' || Array.isArray(ref)
    || Reflect.ownKeys(ref).length !== 2 || !Object.hasOwn(ref, 'id') || !Object.hasOwn(ref, 'revision')
    || typeof ref.id !== 'string' || !ref.id.trim() || ref.revision !== 1) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid new Goal receipt');
  }
  return {expectedGraphRevision: input.expectedGraphRevision, currentGoal: {id: ref.id, revision: 1}};
}
function initialGoalContext(snapshot: GraphSnapshot, goal: NodeVersion): string {
  return JSON.stringify({destination: 'AgentArts orchestration', semanticReviewRequired: true,
    goal: {summary: goal.summary, validFrom: goal.validFrom, validUntil: goal.validUntil,
      dependencies: goal.dependencies.map(ref => {
        const node = snapshot.history.find(item => item.id === ref.id && item.revision === ref.revision)!;
        return {kind: node.kind, summary: node.summary};
      })}});
}

function unplannedGoalInput(input: GoalCreatedSelectionRequest): GoalCreatedSelectionRequest {
  const ref = input?.currentGoal;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Reflect.ownKeys(input).length !== 2 || !Object.hasOwn(input, 'expectedGraphRevision')
    || !Object.hasOwn(input, 'currentGoal') || !Number.isSafeInteger(input.expectedGraphRevision)
    || input.expectedGraphRevision < 1 || !ref || typeof ref !== 'object' || Array.isArray(ref)
    || Reflect.ownKeys(ref).length !== 2 || !Object.hasOwn(ref, 'id') || !Object.hasOwn(ref, 'revision')
    || typeof ref.id !== 'string' || !ref.id.trim() || !Number.isSafeInteger(ref.revision) || ref.revision < 2) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid unplanned Goal receipt');
  }
  return {expectedGraphRevision: input.expectedGraphRevision,
    currentGoal: {id: ref.id, revision: ref.revision}};
}
function currentUnplannedGoal(snapshot: GraphSnapshot, ref: NodeRef, at: string): NodeVersion | undefined {
  const goal = snapshot.history.findLast(node => node.id === ref.id);
  if (!goal || goal.kind !== 'goal') throw new ProtocolError('INVALID_ARGUMENT', 'Expected a Goal');
  if (goal.revision !== ref.revision) throw new ProtocolError('REVISION_CONFLICT', 'Goal revision changed');
  return goal.state === 'active' && isEffective(goal, at) ? goal : undefined;
}
// Follow exact historical dependency references; a later consumer rebind does not erase prior planning.
function dependencyGoals(snapshot: GraphSnapshot, refs: readonly NodeRef[]): Set<string> {
  const versions = new Map(snapshot.history.map(node => [refKey(node), node]));
  const found = new Set<string>(), seen = new Set<string>();
  const pending = [...refs];
  while (pending.length) {
    const ref = pending.pop()!;
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    const node = versions.get(key);
    if (!node) continue;
    if (node.kind === 'goal') found.add(node.id);
    for (const dependency of node.dependencies) pending.push(dependency);
  }
  return found;
}
function historicallyPlanned(snapshot: GraphSnapshot, goalId: string): boolean {
  return dependencyGoals(snapshot, snapshot.history.filter(node => node.kind === 'decision'
    || node.kind === 'plan')).has(goalId);
}

const refKey = (ref: NodeRef): string => JSON.stringify([ref.id, ref.revision]);
// Ancestor identity is an exact ref multiset, independent of process locale.
// Canonicalize stored intents too so the existing fallback retains legacy IDs.
// Leave earlier Goal trigger identities and their ordering contracts unchanged.
const ancestorRefs = (refs: readonly NodeRef[]): NodeRef[] => refs.map(ref => ({id: ref.id, revision: ref.revision}))
  .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : left.revision - right.revision);
// Expiry uses the same exact multiset ordering, with its own legacy identity lookup.
const expiryRefs = ancestorRefs;
function expiredPublicFactScope(snapshot: GraphSnapshot, at: string): {facts: NodeRef[]; items: ImpactItem[]} {
  const current = new Map(snapshot.history.map(node => [node.id, node]));
  const expired = [...current.values()].filter(node => node.kind === 'fact' && node.state === 'active'
    && node.sensitivity === 'public' && Date.parse(node.validUntil) <= Date.parse(at));
  const facts = expired.map(node => ({id: node.id, revision: node.revision}));
  const keys = new Set(facts.map(refKey));
  const items = analyzeImpact(snapshot, at).items.filter(item => item.action === 'RECHECK'
    && item.causes.some(cause => cause.reason === 'not_effective'
      && cause.currentRevision === cause.reference.revision && keys.has(refKey(cause.reference))));
  const used = new Set(items.flatMap(item => item.causes.filter(cause => cause.reason === 'not_effective'
    && cause.currentRevision === cause.reference.revision && keys.has(refKey(cause.reference)))
    .map(cause => refKey(cause.reference))));
  return {facts: facts.filter(ref => used.has(refKey(ref))).sort((a, b) => refKey(a).localeCompare(refKey(b))), items};
}

function uncertainRecheck(review: ProactiveCognitionReview): ProactiveCognitionReview['machineReview'] {
  const selection = review.selection;
  if (selection?.state !== 'review' || selection.reason !== 'uncertain'
    || selection.eligibleForRuntime !== false || !selection.selected
    || !review.options.some(option => option.id === selection.selected!.id
      && option.revision === selection.selected!.revision)) return undefined;
  const recheck = review.options.filter(option => option.id === 'recheck' && option.action === 'RECHECK'
    && option.repair === undefined && Number.isSafeInteger(option.revision) && option.revision > 0);
  return recheck.length === 1 ? {reason: 'uncertain', action: 'RECHECK',
    option: {id: recheck[0]!.id, revision: recheck[0]!.revision}} : undefined;
}

/** Trusted Competition composition: choose locally, then hand off to AgentArts. No local execution shortcut. */
export function createProactiveCognitionHost(options: ProactiveCognitionHostOptions): ProactiveCognitionHost {
  const {application, facts, graphNamespace, bindingVersion, chooser, now = Date.now,
    prepareOptions, selectionHandoff: handoff} = options;
  if (application.profile !== 'huawei_ict_agentarts' || !graphNamespace?.trim() || !bindingVersion?.trim()) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid proactive cognition binding');
  }
  const runtime = application.runtime;
  const store = runtime.bindCoordinationStore(graphNamespace);
  const controllers = new Set<AbortController>();
  let closed = false;
  const open = () => {
    if (closed) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Cognition host is closed');
  };
  const readReview = (taskId: string): ProactiveReviewReadback => {
    open();
    const task = runtime.getTask(taskId);
    const intent = runtime.loadCheckpoint(taskId, INTENT) as ReviewIntent | undefined;
    if (!intent || intent.version !== 1 || intent.graphNamespace !== graphNamespace || intent.bindingVersion !== bindingVersion) {
      throw new ProtocolError('UNAUTHORIZED', 'Cognition review is outside this host binding');
    }
    const review = runtime.loadCheckpoint(taskId, REVIEW) as ProactiveCognitionReview | undefined;
    return {task, ...(review ? {review: structuredClone(review)} : {})};
  };
  const goalIdentity = (trigger: Trigger): string | undefined => trigger.kind === 'goal_created' || trigger.kind === 'goal_unplanned'
    ? JSON.stringify([trigger.kind, trigger.input.currentGoal.id, trigger.input.currentGoal.revision])
    : trigger.kind === 'goal' ? JSON.stringify([trigger.kind,
      trigger.input.previousGoal.id, trigger.input.previousGoal.revision,
      trigger.input.currentGoal.id, trigger.input.currentGoal.revision])
      : trigger.kind === 'goal_ancestor' ? JSON.stringify([trigger.kind,
        trigger.input.currentGoal.id, trigger.input.currentGoal.revision,
        ancestorRefs(trigger.input.consumers).map(ref => [ref.id, ref.revision])]) : undefined;
  const expiryIdentity = (trigger: Trigger): string | undefined => trigger.kind === 'expiry'
    ? JSON.stringify([trigger.kind, expiryRefs(trigger.input.facts).map(ref => [ref.id, ref.revision]),
      expiryRefs(trigger.input.consumers).map(ref => [ref.id, ref.revision])]) : undefined;
  const goalTasks = (context: MemoryReadContext, reviewedGoals?: Set<string>): Map<string, TaskSnapshot> => {
    const found = new Map<string, TaskSnapshot>();
    let beforeSequence: number | undefined;
    let snapshotSequence: number | undefined;
    do {
      open(); active(context);
      const page = runtime.listTasks({conversationId: 'proactive-cognition:' + graphNamespace,
        limit: 100, ...(snapshotSequence === undefined ? {} : {snapshotSequence}),
        ...(beforeSequence === undefined ? {} : {beforeSequence})});
      snapshotSequence = page.snapshotSequence;
      for (const task of page.items) {
        const intent = runtime.loadCheckpoint(task.taskId, INTENT) as ReviewIntent | undefined;
        if (intent?.version !== 1 || intent.graphNamespace !== graphNamespace) continue;
        if (reviewedGoals) {
          const trigger = intent.trigger;
          if (trigger.kind === 'goal' || trigger.kind === 'goal_created'
            || trigger.kind === 'goal_ancestor' || trigger.kind === 'goal_unplanned') {
            reviewedGoals.add(trigger.input.currentGoal.id);
          } else {
            const snapshot = store.read(trigger.kind === 'fact'
              ? trigger.input.projection.graphRevision : trigger.input.graphRevision);
            const refs = trigger.kind === 'fact'
              ? selectProjectedRepairScope(snapshot, intent.evaluatedAt, trigger.input).items.map(item => item.node)
              : trigger.input.consumers;
            for (const id of dependencyGoals(snapshot, refs)) reviewedGoals.add(id);
          }
        }
        if (intent.bindingVersion !== bindingVersion || intent.retryOf) continue;
        const identity = goalIdentity(intent.trigger) ?? expiryIdentity(intent.trigger);
        if (identity && !found.has(identity)) found.set(identity, task);
      }
      beforeSequence = page.nextBeforeSequence;
    } while (beforeSequence !== undefined);
    return found;
  };
  const latestGoalTask = (task: TaskSnapshot): TaskSnapshot => {
    const seen = new Set<string>();
    while (!seen.has(task.taskId)) {
      seen.add(task.taskId);
      const successor = runtime.findTaskByIdempotencyKey('proactive-cognition-retry:'
        + toolArgumentsDigest({graphNamespace, bindingVersion, retryOf: task.taskId}));
      if (!successor) return task;
      task = successor;
    }
    throw new ProtocolError('EXTERNAL_FAILURE', 'Cognition retry chain is invalid');
  };
  const goalNeedsReview = (task: TaskSnapshot): boolean => {
    task = latestGoalTask(task);
    if (task.state === 'created' || task.state === 'waiting_reconciliation') return true;
    if (task.state !== 'succeeded') return false;
    const review = readReview(task.taskId).review;
    if (!review || review.action === 'KEEP') return false;
    const handoffIntent = runtime.loadCheckpoint(task.taskId, HANDOFF) as ProactiveSelectionHandoff | undefined;
    if (handoffIntent) return Boolean(handoff && !handoff.read(handoffIntent.commandId)
      && Date.parse(handoffIntent.deadline) > Date.now());
    if (review.selection?.state === 'abstain' && review.selection.reason === 'unavailable'
      && review.selection.eligibleForRuntime === false) {
      const cooldown = runtime.loadCheckpoint(task.taskId, LAYA_COOLDOWN) as {notBefore: number} | undefined;
      return !cooldown || now() >= cooldown.notBefore;
    }
    return Boolean(handoff && (review.selectedOption || review.machineReview));
  };
  const handoffWork = async (taskId: string, context: MemoryReadContext): Promise<ProactiveReviewReadback> => {
    open(); active(context);
    const readback = readReview(taskId);
    let result = readback.review;
    if (readback.task.state !== 'succeeded' || !result) return readback;
    let intent = runtime.loadCheckpoint(taskId, HANDOFF) as ProactiveSelectionHandoff | undefined;
    const machineReview = result.selectedOption ? undefined : uncertainRecheck(result);
    if (!result.selectedOption && !machineReview) return readback;
    if (result.machineReview && JSON.stringify(result.machineReview) !== JSON.stringify(machineReview)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Invalid persisted machine review');
    }
    if (!handoff) return {...readback, handoff: {state: 'unavailable'}};
    if (!intent) {
      if (machineReview && !result.machineReview) {
        result = {...result, machineReview};
        runtime.saveCheckpoint(taskId, REVIEW, result);
        readback.review = structuredClone(result);
      }
      const projected = await handoff.prepare(structuredClone(result), {...context});
      active(context); open();
      if (!projected) return {...readback, handoff: {state: 'unavailable'}};
      if (typeof projected.exportPolicyVersion !== 'string' || !projected.exportPolicyVersion.trim()
        || typeof projected.goal !== 'string' || !projected.goal.trim()) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Invalid cognition export projection');
      }
      const proposed: ProactiveSelectionHandoff = {
        commandId: 'proactive-' + toolArgumentsDigest({graphNamespace, bindingVersion, taskId}),
        reviewTaskId: taskId, selectionDigest: toolArgumentsDigest(result),
        exportPolicyVersion: projected.exportPolicyVersion, goal: projected.goal, deadline: context.deadline,
      };
      // An overlapping caller may have persisted an envelope while prepare awaited.
      intent = runtime.loadCheckpoint(taskId, HANDOFF) as ProactiveSelectionHandoff | undefined;
      if (!intent) { intent = proposed; runtime.saveCheckpoint(taskId, HANDOFF, intent); }
    }
    const prior = handoff.read(intent.commandId);
    if (prior) return {...readback, handoff: {state: 'submitted', task: prior}};
    if (Date.parse(intent.deadline) <= Date.now()) return {...readback, handoff: {state: 'expired'}};
    active(context); open();
    const deadline = new Date(Math.min(Date.parse(context.deadline), Date.parse(intent.deadline))).toISOString();
    const task = await handoff.dispatch(structuredClone(intent), {...context, deadline});
    // Submission may have committed before cancellation; return its real receipt.
    return {...readback, handoff: {state: 'submitted', task}};
  };
  const handoffReview = async (taskId: string, request: MemoryReadContext): Promise<ProactiveReviewReadback> => {
    open(); active(request);
    const initial = readReview(taskId);
    const controller = new AbortController();
    controllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); },
      Math.min(Date.parse(request.deadline) - Date.now(), 2_147_483_647));
    const signal = AbortSignal.any([request.signal, controller.signal]);
    let stop = () => {};
    try {
      const interrupted = new Promise<never>((_resolve, reject) => {
        stop = () => reject(new ProtocolError(timedOut ? 'TIMEOUT' : 'CANCELLED', 'Cognition handoff interrupted'));
        signal.addEventListener('abort', stop, {once: true});
      });
      return await Promise.race([interrupted, handoffWork(taskId, {...request, signal})]);
    } catch (error) {
      if (signal.aborted && handoff) {
        const intent = runtime.loadCheckpoint(taskId, HANDOFF) as ProactiveSelectionHandoff | undefined;
        if (intent) {
          const submitted = handoff.read(intent.commandId);
          // Once dispatch may have started, cancellation is not proof of no
          // submission. Preserve the exact journal and expose reconciliation.
          return {...initial, handoff: submitted ? {state: 'submitted', task: submitted} : {state: 'pending'}};
        }
      }
      throw error;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); controllers.delete(controller); }
  };
  const review = async (trigger: Trigger, request: MemoryReadContext & {at: string},
    knownGoalTasks?: ReadonlyMap<string, TaskSnapshot>): Promise<ProactiveReviewReadback> => {
    open(); active(request); evaluationTime(request.at);
    const identity = trigger.kind === 'expiry' ? {kind: trigger.kind, facts: expiryRefs(trigger.input.facts),
      consumers: expiryRefs(trigger.input.consumers)} : trigger.kind === 'goal_created' || trigger.kind === 'goal_unplanned'
        ? {kind: trigger.kind, currentGoal: trigger.input.currentGoal} : trigger.kind === 'goal'
          ? {kind: trigger.kind, previousGoal: trigger.input.previousGoal,
            currentGoal: trigger.input.currentGoal} : trigger.kind === 'goal_ancestor'
            ? {kind: trigger.kind, currentGoal: trigger.input.currentGoal,
              consumers: trigger.input.consumers} : trigger;
    let key = 'proactive-cognition:' + toolArgumentsDigest({graphNamespace, bindingVersion, trigger: identity});
    let existing = runtime.findTaskByIdempotencyKey(key);
    if (!existing) {
      const goalKey = goalIdentity(trigger) ?? expiryIdentity(trigger);
      if (goalKey) existing = (knownGoalTasks ?? goalTasks(request)).get(goalKey);
    }
    let retryOf: string | undefined;
    const visited = new Set<string>();
    while (existing && existing.state !== 'created') {
      open(); active(request);
      if (visited.has(existing.taskId)) throw new ProtocolError('EXTERNAL_FAILURE', 'Cognition retry chain is invalid');
      visited.add(existing.taskId);
      let saved = readReview(existing.taskId);
      if (existing.state === 'waiting_reconciliation') {
        runtime.reconcileTask(existing.taskId, saved.review ? 'confirmed' : 'not_performed');
        saved = readReview(existing.taskId);
      }
      const selection = saved.review?.selection;
      const handoffIntent = runtime.loadCheckpoint(existing.taskId, HANDOFF);
      const layaUnavailable = saved.task.state === 'succeeded' && selection?.state === 'abstain'
        && selection.reason === 'unavailable' && selection.eligibleForRuntime === false;
      if (layaUnavailable && handoffIntent) return saved;
      const unavailable = layaUnavailable && !handoffIntent;
      if (!unavailable) return handoffReview(existing.taskId, request);
      let cooldown = runtime.loadCheckpoint(existing.taskId, LAYA_COOLDOWN) as {notBefore: number} | undefined;
      const current = now();
      if (!Number.isSafeInteger(current) || current < 0) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid cognition clock');
      if (!cooldown) {
        cooldown = {notBefore: current + 30_000};
        runtime.saveCheckpoint(existing.taskId, LAYA_COOLDOWN, cooldown);
      }
      if (!Number.isSafeInteger(cooldown.notBefore) || current < cooldown.notBefore) {
        throw new ProtocolError('EXTERNAL_FAILURE', 'Laya is unavailable; cognition review will retry');
      }
      retryOf = existing.taskId;
      const previousIntent = runtime.loadCheckpoint(existing.taskId, INTENT) as ReviewIntent;
      trigger = structuredClone(previousIntent.trigger);
      key = 'proactive-cognition-retry:' + toolArgumentsDigest({graphNamespace, bindingVersion, retryOf});
      existing = runtime.findTaskByIdempotencyKey(key);
    }
    const persisted = existing ? runtime.loadCheckpoint(existing.taskId, INTENT) as ReviewIntent : undefined;
    if (persisted) { request = {...request, at: persisted.evaluatedAt}; trigger = persisted.trigger; }
    const revision = trigger.kind === 'fact' ? trigger.input.projection.graphRevision
      : trigger.kind === 'goal' || trigger.kind === 'goal_created' || trigger.kind === 'goal_unplanned' || trigger.kind === 'goal_ancestor'
        ? trigger.input.expectedGraphRevision : trigger.input.graphRevision;
    const snapshot = store.read(revision);
    const scope = trigger.kind === 'fact'
      ? selectProjectedRepairScope(snapshot, request.at, trigger.input)
      : trigger.kind === 'goal' ? selectGoalRevisionImpact(snapshot, request.at, trigger.input)
        : trigger.kind === 'goal_ancestor' ? selectGoalAncestorImpact(snapshot, request.at, {
          expectedGraphRevision: trigger.input.expectedGraphRevision, currentGoal: trigger.input.currentGoal})
        : trigger.kind === 'goal_created' || trigger.kind === 'goal_unplanned' ? {items: [] as ImpactItem[]}
        : {items: expiredPublicFactScope(snapshot, request.at).items.filter(item =>
          trigger.input.consumers.some(ref => refKey(ref) === refKey(item.node)))};
    if (trigger.kind === 'goal_ancestor'
      && JSON.stringify(ancestorRefs(scope.items.map(item => item.node)))
        !== JSON.stringify(ancestorRefs(trigger.input.consumers))) {
      throw new ProtocolError('REVISION_CONFLICT', 'Goal ancestor scope changed');
    }
    const subject = trigger.kind === 'goal_created'
      ? createdGoal(snapshot, trigger.input.currentGoal, request.at)
      : trigger.kind === 'goal_unplanned' ? currentUnplannedGoal(snapshot, trigger.input.currentGoal, request.at) : undefined;
    const intent: ReviewIntent = {version: 1, graphNamespace, bindingVersion, trigger: structuredClone(trigger),
      evaluatedAt: request.at, ...(retryOf ? {retryOf} : {})};
    const task = existing ?? runtime.submitTaskWithCheckpoint({goal: subject
      ? 'Choose an initial planning approach for the registered Goal'
      : 'Choose an approach for trusted dependency changes',
      conversationId: 'proactive-cognition:' + graphNamespace, idempotencyKey: key}, INTENT, intent);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, {once: true});
    controllers.add(controller);
    try {
      await runtime.runTask(task.taskId, async worker => {
        const context = {signal: AbortSignal.any([worker.signal, controller.signal, request.signal]), deadline: request.deadline};
        active(context);
        const result: ProactiveCognitionReview = {taskId: task.taskId, graphNamespace,
          graphRevision: snapshot.revision, bindingVersion, evaluatedAt: request.at,
          action: scope.items.length || subject ? 'RECHECK' : 'KEEP', affected: structuredClone(scope.items),
          ...(subject ? {subjectGoal: {id: subject.id, revision: subject.revision}} : {}),
          options: [], semanticReviewRequired: true};
        if (scope.items.length || subject) {
          // The optional candidate has a 100-target bound; larger full scopes
          // still choose between the original recheck and defer approaches.
          const candidate = trigger.kind === 'expiry' || subject || scope.items.length > 100 ? undefined : buildMinimalRepairCandidate(snapshot, request.at, {
            expectedGraphRevision: snapshot.revision, targets: scope.items.map(item => item.node),
          });
          result.options = subject ? [
            {id: 'plan', revision: 1, action: 'RECHECK', description: 'Ask AgentArts to draft an initial plan for this registered Goal; no Plan has been created.'},
            {id: 'recheck', revision: 1, action: 'RECHECK', description: 'Ask AgentArts to verify background and constraints before planning this Goal.'},
            {id: 'defer', revision: 1, action: 'RECHECK', description: 'Defer initial planning for this Goal.'},
          ] : [
            {id: 'recheck', revision: 1, action: 'RECHECK', description: 'Ask AgentArts to verify the changed sources and affected dependencies before deciding a plan.'},
            {id: 'defer', revision: 1, action: 'RECHECK', description: 'Ask AgentArts to retain the current plan and arrange a later recheck without executing the stale plan.'},
            ...(candidate?.kind === 'candidate' ? [{id: 'revise', revision: 1, action: 'REVISE' as const,
              description: 'Ask AgentArts to evaluate this minimal dependency repair and revise affected plan content as needed; the candidate is not yet executed.',
              repair: candidate.request}] : []),
          ];
          if (prepareOptions) result.options = structuredClone([...await prepareOptions(structuredClone(result), {...context})]);
          active(context);
          if (result.options.length < 2 || result.options.length > 16) throw new ProtocolError('INVALID_ARGUMENT', 'Expected bounded cognition options');
          const seen = new Set<string>();
          for (const option of result.options) {
            if (!option || seen.has(option.id) || !['RECHECK', 'REVISE'].includes(option.action)
              || ((trigger.kind === 'expiry' || subject)
                && (option.action !== 'RECHECK' || option.repair !== undefined))
              || Object.keys(option).some(key => !['id', 'revision', 'description', 'action', 'repair'].includes(key))) {
              throw new ProtocolError('INVALID_ARGUMENT', 'Invalid cognition option');
            }
            seen.add(option.id);
            if (option.repair) {
              if (option.action !== 'REVISE' || option.repair.expectedGraphRevision !== snapshot.revision
                || option.repair.changes.some(change => !scope.items.some(item =>
                  item.node.id === change.node.id && item.node.revision === change.node.revision))) {
                throw new ProtocolError('INVALID_ARGUMENT', 'Repair option exceeds affected scope');
              }
              previewStoredRepair({read: () => structuredClone(snapshot), append: () => { throw Error('Read-only preview'); }}, request.at, option.repair);
            }
          }
          result.selection = await chooser.choose({
            // Local-only source/plan excerpts help choose an approach. They do
            // not become a cloud payload; handoff.prepare separately controls egress.
            context: subject ? initialGoalContext(snapshot, subject) : localDecisionContext(snapshot, scope.items),
            candidates: result.options.map(option => ({id: option.id, revision: option.revision, description: option.description,
              kind: 'escalate' as const, sources: [], scopeRef: key, expiresAt: request.deadline, risk: 'low' as const,
              argumentsDigest: actionArgumentsDigest({})})), ...context,
          });
          active(context);
          if (result.selection.state === 'selected') {
            const selected = result.options.find(option => option.id === result.selection!.selected?.id
              && option.revision === result.selection!.selected?.revision);
            if (selected) { result.action = selected.action; result.selectedOption = structuredClone(selected); }
          }
          const machineReview = uncertainRecheck(result);
          if (machineReview) result.machineReview = machineReview;
        }
        active(context);
        worker.saveCheckpoint(REVIEW, result);
        return {resultSummary: subject
          ? 'Initial Goal planning approach recorded for AgentArts orchestration; no Plan created'
          : 'Laya approach recorded for AgentArts orchestration; no plan executed'};
      }, {deadline: request.deadline, sideEffect: 'read'});
      const completed = readReview(task.taskId);
      if (completed.task.state === 'succeeded' && completed.review?.selection?.state === 'abstain'
        && completed.review.selection.reason === 'unavailable'
        && completed.review.selection.eligibleForRuntime === false
        && !runtime.loadCheckpoint(task.taskId, HANDOFF)) {
        const current = now();
        if (!Number.isSafeInteger(current) || current < 0) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid cognition clock');
        runtime.saveCheckpoint(task.taskId, LAYA_COOLDOWN, {notBefore: current + 30_000});
        throw new ProtocolError('EXTERNAL_FAILURE', 'Laya is unavailable; cognition review will retry');
      }
      return handoffReview(task.taskId, request);
    } finally { controllers.delete(controller); request.signal.removeEventListener('abort', abort); }
  };
  return Object.freeze({
    consumeAndReview: async (request: MemoryReadContext & {at: string; limit: number; afterGraphRevision: number}) => {
      open(); active(request); evaluationTime(request.at);
      facts.listImpactReceipts({afterGraphRevision: request.afterGraphRevision, limit: request.limit});
      const consumed = await facts.consume({limit: request.limit, deadline: request.deadline, signal: request.signal});
      facts.processImpacts({at: request.at, limit: request.limit, deadline: request.deadline, signal: request.signal});
      const receipts = facts.listImpactReceipts({afterGraphRevision: request.afterGraphRevision, limit: request.limit});
      const reviews: ProactiveReviewReadback[] = [];
      let nextGraphRevision = request.afterGraphRevision;
      for (const receipt of receipts) {
        active(request);
        if (!receipt.completed) break;
        reviews.push(await review({kind: 'fact', input: {graphNamespace, projection: receipt.projection}}, request));
        nextGraphRevision = receipt.projection.graphRevision;
      }
      const hasMoreReviews = facts.listImpactReceipts({afterGraphRevision: nextGraphRevision, limit: 1}).length > 0;
      if (consumed.batch.atWatermark && !hasMoreReviews && reviews.length === 0) {
        const snapshot = store.read();
        const heads = new Map(snapshot.history.map(node => [node.id, node]));
        // Freeze namespace-wide intent evidence before this pass can create a revision KEEP task.
        const reviewedGoals = new Set<string>();
        const recorded = goalTasks(request, reviewedGoals);
        const recordedGoal = (node: NodeVersion): boolean => recorded.has(JSON.stringify(['goal_unplanned', node.id, node.revision]))
          || recorded.has(node.revision === 1
          ? JSON.stringify(['goal_created', node.id, node.revision])
          : JSON.stringify(['goal', node.id, node.revision - 1, node.id, node.revision]));
        const expiry = expiredPublicFactScope(snapshot, request.at);
        const expiryTrigger = expiry.items.length ? {kind: 'expiry' as const, input: {
          graphRevision: snapshot.revision, facts: expiryRefs(expiry.facts),
          consumers: expiryRefs(expiry.items.map(item => item.node)),
        }} : undefined;
        const unrecordedExpiry = expiryTrigger && !runtime.findTaskByIdempotencyKey('proactive-cognition:'
          + toolArgumentsDigest({graphNamespace, bindingVersion, trigger: {kind: 'expiry',
            facts: expiryTrigger.input.facts, consumers: expiryTrigger.input.consumers}}))
          && !recorded.has(expiryIdentity(expiryTrigger)!);
        let expiryReviewed = false;
        const reviewExpiry = async (): Promise<void> => {
          if (!expiryTrigger || expiryReviewed || reviews.length >= request.limit) return;
          reviews.push(await review(expiryTrigger, request, recorded));
          expiryReviewed = true;
        };
        const goals = [...heads.values()].filter(node => node.kind === 'goal'
          && (node.revision > 1 || (node.state === 'active' && isEffective(node, request.at))))
          .sort((a, b) => Number(recordedGoal(a)) - Number(recordedGoal(b))
            || (a.revision === 1 ? 0 : 1) - (b.revision === 1 ? 0 : 1)
            || a.graphRevision - b.graphRevision);
        for (const goal of goals) {
          open(); active(request);
          // New local expiry work must not wait for an older Goal's cloud grant.
          // Recorded expiry work keeps the original fallback, so an unavailable
          // expiry handoff cannot in turn starve pending Goal recovery at limit 1.
          if (recordedGoal(goal) && unrecordedExpiry) await reviewExpiry();
          if (reviews.length >= request.limit) break;
          const currentGoal = {id: goal.id, revision: goal.revision};
          if (goal.revision > 1) {
            const unplanned: Trigger = {kind: 'goal_unplanned', input: {expectedGraphRevision: snapshot.revision, currentGoal}};
            const priorUnplanned = recorded.get(goalIdentity(unplanned)!);
            const changedConsumers = selectGoalRevisionImpact(snapshot, request.at, {
              expectedGraphRevision: snapshot.revision, previousGoal: {id: goal.id, revision: goal.revision - 1}, currentGoal}).items.length
              || selectGoalAncestorImpact(snapshot, request.at, {expectedGraphRevision: snapshot.revision, currentGoal}).items.length;
            // A saved initial choice cannot hide consumers subsequently pinned to an older Goal.
            if (priorUnplanned || (goal.state === 'active' && isEffective(goal, request.at)
              && !reviewedGoals.has(goal.id) && !historicallyPlanned(snapshot, goal.id))) {
              if (!priorUnplanned || (!changedConsumers && goalNeedsReview(priorUnplanned))) {
                reviews.push(await review(unplanned, request, recorded));
              }
              if (!changedConsumers) continue;
              if (reviews.length >= request.limit) break;
            }
          }
          let trigger: Trigger;
          if (goal.revision === 1) {
            if ([...heads.values()].some(node => (node.kind === 'decision' || node.kind === 'plan')
              && node.dependencies.some(ref => refKey(ref) === refKey(currentGoal)))) continue;
            trigger = {kind: 'goal_created', input: {expectedGraphRevision: snapshot.revision, currentGoal}};
          } else {
            const previousGoal = {id: goal.id, revision: goal.revision - 1};
            trigger = {kind: 'goal', input: {expectedGraphRevision: snapshot.revision,
              previousGoal, currentGoal}};
          }
          const prior = recorded.get(goalIdentity(trigger)!);
          const ancestorScope = goal.revision > 1 ? selectGoalAncestorImpact(snapshot, request.at,
            {expectedGraphRevision: snapshot.revision, currentGoal}) : undefined;
          const ancestor: Trigger | undefined = ancestorScope?.items.length ? {kind: 'goal_ancestor', input: {
            expectedGraphRevision: snapshot.revision, currentGoal,
            consumers: ancestorRefs(ancestorScope.items.map(item => item.node)),
          }} : undefined;
          const previousAncestor = ancestor && recorded.get(goalIdentity(ancestor)!);
          // Newly uncovered local work precedes an older pending handoff at the same request bound.
          if (prior && ancestor && !previousAncestor) {
            reviews.push(await review(ancestor, request, recorded));
            if (reviews.length >= request.limit) break;
          }
          if (!prior || goalNeedsReview(prior)) reviews.push(await review(trigger, request, recorded));
          if (ancestor && reviews.length < request.limit && !(prior && !previousAncestor)
            && (!previousAncestor || goalNeedsReview(previousAncestor))) {
            reviews.push(await review(ancestor, request, recorded));
          }
        }
        if (reviews.length === 0) await reviewExpiry();
      }
      return {reviews, nextGraphRevision, atWatermark: consumed.batch.atWatermark, hasMoreReviews};
    },
    reviewGoalRevision: (input: GoalRevisionSelectionRequest, request: MemoryReadContext & {at: string}) =>
      review({kind: 'goal', input: structuredClone(input)}, request),
    reviewGoalCreated: (input: GoalCreatedSelectionRequest, request: MemoryReadContext & {at: string}) => {
      open(); active(request); evaluationTime(request.at);
      const selected = goalCreatedInput(input);
      const snapshot = store.read();
      if (snapshot.revision !== selected.expectedGraphRevision) {
        throw new ProtocolError('REVISION_CONFLICT', 'Goal graph revision changed');
      }
      createdGoal(snapshot, selected.currentGoal, request.at);
      return review({kind: 'goal_created', input: selected}, request);
    },
    reviewUnplannedGoal: (input: GoalCreatedSelectionRequest, request: MemoryReadContext & {at: string}) => {
      open(); active(request); evaluationTime(request.at);
      const selected = unplannedGoalInput(input), snapshot = store.read();
      if (snapshot.revision !== selected.expectedGraphRevision) {
        throw new ProtocolError('REVISION_CONFLICT', 'Goal graph revision changed');
      }
      const goal = currentUnplannedGoal(snapshot, selected.currentGoal, request.at);
      const reviewedGoals = new Set<string>(), recorded = goalTasks(request, reviewedGoals);
      const trigger: Trigger = {kind: 'goal_unplanned', input: selected};
      // Recover this exact scope before treating its own trusted intent as prior review evidence.
      if (recorded.has(goalIdentity(trigger)!)) return review(trigger, request, recorded);
      if (!goal || reviewedGoals.has(goal.id) || historicallyPlanned(snapshot, goal.id)) return Promise.resolve(undefined);
      return review(trigger, request, recorded);
    },
    reviewGoalAncestorImpact: (input: GoalAncestorSelectionRequest, request: MemoryReadContext & {at: string}) => {
      open(); active(request); evaluationTime(request.at);
      const snapshot = store.read();
      const scope = selectGoalAncestorImpact(snapshot, request.at, structuredClone(input));
      if (!scope.items.length) return Promise.resolve(undefined);
      return review({kind: 'goal_ancestor', input: {
        expectedGraphRevision: scope.graphRevision, currentGoal: scope.currentGoal,
        consumers: ancestorRefs(scope.items.map(item => item.node)),
      }}, request);
    },
    readReview, handoffReview,
    close: () => { closed = true; for (const controller of controllers) controller.abort(); },
  });
}
