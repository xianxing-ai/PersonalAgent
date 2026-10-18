import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {isEffective, type GraphSnapshot, type NodeRef} from '@personal-agent/goals';
import type {CoordinationStorePort} from '@personal-agent/goals/store';
import {CognitionError, type ImpactReport} from './impact.js';
import {buildMinimalRepairCandidate} from './minimal-repair.js';
import {selectProjectedRepairScope, type ProjectedRepairInput} from './projected-repair.js';
import {prepareReviewedRepair, type ReviewedRepairSelection} from './reviewed-repair.js';
import type {LayaActionSelection} from './laya-action-choice.js';
import {withCognitionDeadline} from './deadline.js';
import type {MeetingRescheduleEvent, MeetingDecisionReceipt, MeetingDecisionReceiptStorePort,
  MeetingReceiptRecord} from './meeting-decision.js';

export interface MeetingFactReview extends ReviewedRepairSelection {
  action: 'KEEP' | 'RECHECK' | 'REVISE';
  evaluatedAt: string;
  selection?: LayaActionSelection;
}
export interface MeetingReviewReadback {
  task: {taskId: string; state: string};
  review?: MeetingFactReview | undefined;
}
export interface MeetingRuntimeFeedback {
  status: string;
  taskId?: string | undefined;
  executionVerified?: boolean | undefined;
  graphUpdateVerified?: boolean | undefined;
  graphRevision?: number | undefined;
  updatedNodes?: readonly NodeRef[] | undefined;
  evidenceRefs?: readonly string[] | undefined;
}
export interface MeetingReviewContext {deadline: string; signal: AbortSignal;}
/** Inject the existing committed Fact/proactive review + reviewedRepair host. No tool callback from cloud. */
export interface MeetingReviewedRepairPort {
  readCommittedProjection(event: MeetingRescheduleEvent, context: MeetingReviewContext): Promise<{
    sourceRevision: string; meetingFact: NodeRef; input: ProjectedRepairInput;
  } | undefined>;
  /** Must reuse Runtime review identity by the exact committed projection; no second review loop. */
  reviewCommittedFact(request: ProjectedRepairInput & MeetingReviewContext & {
    workKey: string; at: string; meetingFact: NodeRef; sourceRevision: string;
  }): Promise<MeetingReviewReadback>;
  readReview(taskId: string): MeetingReviewReadback;
  /** Existing Goal/Fact host applies AgentArts handoff and Runtime/Policy repair. Never appendBatch here. */
  applyDecision(reviewTaskId: string, context: MeetingReviewContext): Promise<MeetingRuntimeFeedback>;
}
/** Existing fixed-scope FactHost read surface; no feed acknowledgements or graph writes. */
export interface MeetingFactReceiptReader {
  listImpactReceipts(input: {afterGraphRevision: number; limit: number}): readonly {
    completed?: {batchToken: string; report: ImpactReport}; projection: ProjectedRepairInput['projection'];
  }[];
}
const refEqual = (a: NodeRef, b: NodeRef): boolean => a.id === b.id && a.revision === b.revision;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

/** Source revision comes from an existing trusted readback, never from event text alone. */
export function createCommittedMeetingProjectionReader(options: {
  namespace: string;
  store: CoordinationStorePort;
  facts: MeetingFactReceiptReader;
  readSourceRevision(event: MeetingRescheduleEvent, context: MeetingReviewContext): Promise<{
    source: string; sourceRevision: string; meetingFact: NodeRef;
  } | undefined>;
}): MeetingReviewedRepairPort['readCommittedProjection'] {
  if (!text(options?.namespace) || typeof options.store?.read !== 'function'
    || typeof options.facts?.listImpactReceipts !== 'function' || typeof options.readSourceRevision !== 'function') {
    throw new CognitionError('INVALID_ARGUMENT');
  }
  options = {...options};
  return async (event, context) => {
    event = {...event};
    context = {...context};
    const source = await withCognitionDeadline(context,
      bounded => options.readSourceRevision({...event, ...bounded}, bounded));
    if (!source || source.source !== event.source || source.sourceRevision !== event.sourceRevision
      || source.meetingFact.id !== event.meetingFactId) return undefined;
    const snapshot = options.store.read();
    const fact = snapshot.history.findLast(node => node.id === source.meetingFact.id);
    if (snapshot.namespace !== options.namespace || !fact || fact.kind !== 'fact'
      || !refEqual(fact, source.meetingFact) || fact.sourceRef !== source.source || fact.summary !== event.newSummary) return undefined;
    const receipt = options.facts.listImpactReceipts({afterGraphRevision: fact.graphRevision - 1, limit: 1})[0];
    if (!receipt?.completed || receipt.projection.graphRevision < fact.graphRevision
      || !receipt.projection.links.some(link => refEqual(link.node, source.meetingFact))) return undefined;
    return {sourceRevision: source.sourceRevision, meetingFact: {...source.meetingFact},
      input: {graphNamespace: options.namespace, projection: structuredClone(receipt.projection)}};
  };
}

/** Validate the whole projection before deriving a view of exactly one trusted Fact. Never a new receipt. */
export function selectMeetingRepairScope(snapshot: GraphSnapshot, at: string, input: ProjectedRepairInput, meetingFact: NodeRef) {
  selectProjectedRepairScope(snapshot, at, input);
  const links = input.projection.links.filter(link => refEqual(link.node, meetingFact));
  if (links.length !== 1) throw new CognitionError('NOT_APPLICABLE');
  return selectProjectedRepairScope(snapshot, at, {...input, projection: {...input.projection, links}});
}

/** Runtime prepareOptions callback for the committed meeting scope; summaries remain unchanged until semantic review. */
export function buildMeetingRepairOptions(snapshot: GraphSnapshot, at: string, projection: ProjectedRepairInput,
  meetingFact?: NodeRef): MeetingFactReview['options'] {
  const selected = meetingFact ?? (projection.projection.links.length === 1 ? projection.projection.links[0]?.node : undefined);
  if (!selected) throw new CognitionError('INVALID_ARGUMENT');
  const scope = selectMeetingRepairScope(snapshot, at, projection, selected);
  if (!scope.items.length) return [];
  // The optional structural candidate is bounded to 100 targets. Larger
  // scopes still retain every affected item for recheck and defer choices.
  const candidate = scope.items.length > 100 ? undefined : buildMinimalRepairCandidate(snapshot, at, {
    expectedGraphRevision: snapshot.revision, targets: scope.items.map(item => item.node),
  });
  return [
    {id: 'recheck', revision: 1, action: 'RECHECK', description: 'Verify the changed meeting Fact and affected dependencies through AgentArts before changing the plan.'},
    {id: 'defer', revision: 1, action: 'RECHECK', description: 'Keep current plan content and arrange a recheck; do not execute stale dependent steps.'},
    ...(candidate?.kind === 'candidate' ? [{id: 'revise', revision: 1, action: 'REVISE',
      description: 'Ask AgentArts to evaluate the minimal affected repair and revise plan content; this is not execution authorization.',
      repair: candidate.request}] : []),
  ];
}

/** Production meeting consumer reads committed Facts. All repair execution stays in existing Runtime. */
export class ReviewedMeetingFactConsumer {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly options: {
    store: CoordinationStorePort;
    receiptStore: MeetingDecisionReceiptStorePort;
    namespace: string;
    reviewedRepair?: MeetingReviewedRepairPort | undefined;
    now?: (() => number) | undefined;
  }) {
    if (!text(options?.namespace) || typeof options.store?.read !== 'function'
      || typeof options.receiptStore?.loadReceipt !== 'function' || typeof options.receiptStore.saveReceipt !== 'function') {
      throw new CognitionError('INVALID_ARGUMENT');
    }
    this.options = {...options};
  }
  private now(): number {return (this.options.now ?? Date.now)();}
  private active(context: MeetingReviewContext): void {
    if (!(context?.signal instanceof AbortSignal) || context.signal.aborted
      || !Number.isFinite(Date.parse(context.deadline)) || this.now() >= Date.parse(context.deadline)) {
      throw new CognitionError('INVALID_ARGUMENT');
    }
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(work); this.tail = operation.then(() => {}, () => {}); return operation;
  }
  async getReceipt(eventId: string, source?: string): Promise<MeetingDecisionReceipt | undefined> {
    return (await this.options.receiptStore.loadReceipt({eventId, namespace: this.options.namespace,
      ...(source ? {source} : {})}))?.receipt;
  }
  async listReceipts(filter?: {status?: string; source?: string}): Promise<readonly MeetingReceiptRecord[]> {
    return await this.options.receiptStore.listReceipts?.({...filter, namespace: this.options.namespace}) ?? [];
  }
  private async save(record: MeetingReceiptRecord, receipt: MeetingDecisionReceipt): Promise<MeetingDecisionReceipt> {
    // These optional fields are cleared by the consumer, while the existing
    // host-state checkpoint requires their absent representation in JSON.
    receipt = {...receipt};
    for (const key of ['retryableInference', 'selection', 'repairTaskId'] as const) {
      if (receipt[key] === undefined) delete receipt[key];
    }
    await this.options.receiptStore.saveReceipt({...record, status: receipt.status, receipt,
      updatedAt: new Date(this.now()).toISOString()});
    return receipt;
  }
  processEvent(event: MeetingRescheduleEvent): Promise<MeetingDecisionReceipt> {
    // Snapshot the request before queueing so an emitter cannot swap the source identity.
    const input = {...event};
    return this.serialize(() => this.processSerial(input));
  }
  private async processSerial(event: MeetingRescheduleEvent): Promise<MeetingDecisionReceipt> {
    this.active(event);
    if (![event.eventId, event.source, event.meetingFactId, event.sourceRevision,
      event.originalSummary, event.newSummary].every(text) || !Number.isFinite(Date.parse(event.detectedAt))) {
      throw new CognitionError('INVALID_ARGUMENT');
    }
    const inputDigest = hash({eventId: event.eventId, source: event.source, meetingFactId: event.meetingFactId,
      originalSummary: event.originalSummary, newSummary: event.newSummary, sourceRevision: event.sourceRevision,
      expectedBaseRevision: event.expectedBaseRevision});
    const existing = await this.options.receiptStore.loadReceipt({eventId: event.eventId,
      source: event.source, namespace: this.options.namespace});
    const snapshot = this.options.store.read();
    if (existing && existing.inputDigest !== inputDigest) {
      return {...existing.receipt, status: 'conflict', reason: '相同事件身份绑定了不同的输入，需要来源核实'};
    }
    if (existing?.receipt.status === 'applied' || existing?.receipt.status === 'already_processed') {
      return {...existing.receipt, status: 'already_processed'};
    }
    // Legacy receipts, including unresolved writes, cannot turn into a new model/tool attempt.
    if (existing && !existing.receipt.reviewTaskId && !existing.receipt.retryableInference) return existing.receipt;
    if (existing?.receipt.reviewTaskId) return this.refreshSerial(existing, event);
    let receipt: MeetingDecisionReceipt = {
      eventId: event.eventId, source: event.source, sourceRevision: event.sourceRevision, meetingFactId: event.meetingFactId,
      selectedCandidateId: 'recheck', actionId: 'review_committed_fact', status: 'requires_review', confidence: null,
      reason: '等待已提交 Fact 与既有 Runtime 认知端口', graphRevisionBefore: snapshot.revision,
      graphRevisionAfter: snapshot.revision, evaluatedAt: event.detectedAt, decisionAction: 'RECHECK',
      executionVerified: false, graphUpdateVerified: false, retryableInference: true,
    };
    const record: MeetingReceiptRecord = {eventId: event.eventId, source: event.source, namespace: this.options.namespace,
      sourceRevision: event.sourceRevision, inputDigest, status: receipt.status, receipt, updatedAt: event.detectedAt};
    const host = this.options.reviewedRepair;
    if (!host) return this.save(record, receipt);
    const bound = await withCognitionDeadline(event, context => host.readCommittedProjection({...event, ...context}, context), () => this.now());
    this.active(event);
    const current = this.options.store.read();
    const fact = current.history.findLast(node => node.id === event.meetingFactId);
    if (!bound || bound.input.graphNamespace !== this.options.namespace || bound.sourceRevision !== event.sourceRevision
      || !fact || fact.kind !== 'fact' || fact.sourceRef !== event.source || fact.summary !== event.newSummary
      || !refEqual(fact, bound.meetingFact) || !isEffective(fact, event.detectedAt)
      || !bound.input.projection.links.some(link => refEqual(link.node, bound.meetingFact))) {
      return this.save(record, {...receipt, reason: '当前会议 Fact 尚无匹配的持久投影；先由受控来源读回并提交'});
    }
    // Current graph scope is authoritative; never create a prospective Fact or rewrite unrelated nodes.
    const scope = selectMeetingRepairScope(current, event.detectedAt, {...bound.input,
      projection: {...bound.input.projection, graphRevision: current.revision}}, bound.meetingFact);
    receipt = {...receipt, graphRevisionBefore: current.revision,
      graphRevisionAfter: current.revision, reviewScopeDigest: hash(scope.items)};
    if (!scope.items.length) return this.save(record, {...receipt, status: 'kept', decisionAction: 'KEEP',
      retryableInference: undefined, reason: '当前已提交事实未造成相关计划失效，保留现有图谱'});
    // Save before handing off. Host resolves the same projection to the existing
    // Runtime review checkpoint if this process crashes before saving its task ID.
    await this.save(record, receipt);
    const result = await withCognitionDeadline(event, context => host.reviewCommittedFact({...bound.input, workKey: `meeting-review:${hash([
      this.options.namespace, event.source, event.eventId, inputDigest])}`, at: event.detectedAt,
      meetingFact: {...bound.meetingFact}, sourceRevision: bound.sourceRevision,
      ...context}), () => this.now());
    this.active(event);
    const review = result.review;
    if (result.task.state !== 'succeeded' || !review || review.taskId !== result.task.taskId
      || review.graphNamespace !== this.options.namespace || review.graphRevision !== current.revision
      || !isDeepStrictEqual(review.affected, scope.items)) {
      return this.save(record, {...receipt, retryableInference: undefined, reviewTaskId: result.task.taskId,
        reason: '认知任务尚未完成或来源范围已变化；保留原任务等待核实'});
    }
    // RECHECK/uncertain has no execution binding. REVISE reuses the canonical preflight.
    if (review.action === 'REVISE' && prepareReviewedRepair(current, event.detectedAt, review).kind !== 'prepared') {
      throw new CognitionError('NOT_APPLICABLE');
    }
    const chosen: MeetingDecisionReceipt = await this.save(record, {...receipt, reviewTaskId: review.taskId,
      retryableInference: undefined, selectedCandidateId: review.selectedOption?.id ?? 'recheck',
      selection: review.selection, confidence: review.selection?.answerConfidence ?? null,
      decisionAction: review.action, status: review.action === 'KEEP' ? 'kept' : 'proposal',
      reason: '既有 Runtime 已记录 Laya 选择；等待 AgentArts 编排和受控工具结果'});
    // Current host authorization controls whether applyDecision can hand off/submit.
    // This call itself grants no authority, and uncertainty stays RECHECK.
    return this.refreshSerial({...record, receipt: chosen, status: chosen.status}, event);
  }
  applyApprovedProposal(query: {eventId: string; source: string; namespace?: string},
    context: MeetingReviewContext): Promise<MeetingDecisionReceipt> {
    query = {...query};
    context = {...context};
    return this.serialize(async () => {
      this.active(context);
      if (query.namespace !== undefined && query.namespace !== this.options.namespace) throw new CognitionError('INVALID_ARGUMENT');
      const record = await this.options.receiptStore.loadReceipt({...query, namespace: this.options.namespace});
      if (!record) throw new CognitionError('NOT_APPLICABLE');
      return this.refreshSerial(record, context);
    });
  }
  private async refreshSerial(record: MeetingReceiptRecord, context: MeetingReviewContext): Promise<MeetingDecisionReceipt> {
    this.active(context);
    const host = this.options.reviewedRepair;
    let receipt = record.receipt;
    if (receipt.status === 'applied' || receipt.status === 'already_processed' || receipt.status === 'kept') return receipt;
    if (!host || !receipt.reviewTaskId) return receipt;
    const readback = host.readReview(receipt.reviewTaskId), review = readback.review;
    if (readback.task.state !== 'succeeded' || !review || review.taskId !== receipt.reviewTaskId
      || review.graphNamespace !== this.options.namespace) return receipt;
    if (review.graphRevision !== receipt.graphRevisionBefore || !receipt.reviewScopeDigest
      || hash(review.affected) !== receipt.reviewScopeDigest) return receipt;
    // A pending review may finish after restart. Preserve its actual choice,
    // including uncertainty, without another model call or a new tool identity.
    receipt = {...receipt, selection: review.selection, confidence: review.selection?.answerConfidence ?? null,
      selectedCandidateId: review.selectedOption?.id ?? 'recheck', decisionAction: review.action};
    if (review.action === 'KEEP') return this.save(record, {...receipt, status: 'kept'});
    // Existing host must read an outstanding/unknown tool receipt before any resubmit.
    const feedback = await withCognitionDeadline(context, bounded => host.applyDecision(receipt.reviewTaskId!, bounded), () => this.now());
    const current = this.options.store.read();
    const applied = feedback.status === 'applied' && feedback.executionVerified === true
      && feedback.graphUpdateVerified === true && Array.isArray(feedback.evidenceRefs) && feedback.evidenceRefs.length > 0
      && feedback.graphRevision !== undefined && feedback.graphRevision <= current.revision
      && !!feedback.updatedNodes?.length && feedback.updatedNodes.every(ref => {
        const node = current.history.findLast(item => item.id === ref.id);
        return !!node && refEqual(node, ref) && review.affected.some(item => item.node.id === ref.id);
      });
    const status: MeetingDecisionReceipt['status'] = applied ? 'applied'
      : feedback.status === 'waiting_approval' ? 'waiting_approval'
        : ['waiting_reconciliation', 'pending'].includes(feedback.status) ? 'waiting_reconciliation'
          : ['submitted', 'created', 'running'].includes(feedback.status) ? 'submitted' : 'requires_review';
    return this.save(record, {...receipt, status, graphRevisionAfter: current.revision,
      repairTaskId: feedback.taskId, decisionAction: review.action,
      executionVerified: applied, graphUpdateVerified: applied,
      ...(applied ? {evidenceRefs: feedback.evidenceRefs, appliedNodeRevisions: feedback.updatedNodes} : {}),
      reason: applied ? 'Runtime/Policy 工具执行证据与当前图谱版本均已读回'
        : status === 'waiting_reconciliation' ? '执行或受理结果未知，沿原任务核实，不重复写入'
          : '保留原 Runtime 任务；授权、编排或结果读回尚未完成'});
  }
}
