import {createHash, randomUUID} from 'node:crypto';
import {ProtocolError, validateContract} from '@personal-agent/contracts';
import type {ProtocolContracts, StoragePort} from '@personal-agent/contracts';
import {prepareTriageDispatch} from '@personal-agent/cognition';
import type {LayaTriageService, LayaTriageResult, TriageDispatchRef} from '@personal-agent/cognition';

export interface InboxTriageContext {readonly deadline: string; readonly signal: AbortSignal;}
export interface InboxAnalysisFilter {readonly observedAtOrAfter?:string;readonly workKeys?:readonly string[];readonly excludeWorkKeys?:readonly string[];readonly limit?:number;}
export interface InboxTriagePage extends InboxTriageContext {
  readonly accountRef: string;
  readonly folder: string;
  readonly cursor?: string;
  readonly nextCursor: string;
  readonly hasMore: boolean;
  readonly items: readonly ProtocolContracts['connectorItem'][];
}
export interface InboxTriageMetadata {
  readonly effectiveClassification?: {readonly source:'cloud-review';readonly label:string|null;readonly route:'group'|'review'|'main_agent';
    readonly needsReview:boolean;readonly highImpactCandidate:boolean;readonly meetingCandidate:boolean};
  readonly cloudReview?: InboxCloudReview;
  readonly messageId: string;
  readonly sourceRevision: string;
  readonly mailboxId: string;
  readonly sensitivity: 'private';
  readonly headersOnly: true;
  readonly label: string | null;
  readonly route: 'group' | 'review' | 'main_agent';
  readonly needsReview: boolean;
  readonly highImpactCandidate: boolean;
  /** A classifier hint only: no confirmed meeting identity, time or Fact is created. */
  readonly meetingCandidate: boolean;
  readonly receiptId?: string;
  readonly classifierFingerprint?: string;
  /** Local classifier diagnostics only; never source text or arbitrary model fields. */
  readonly classificationReason?: LayaTriageResult['reason'];
  readonly candidateLabel?: string | null;
  readonly scores?: LayaTriageResult['scores'];
  readonly impactScores?: LayaTriageResult['impactScores'];
  /** 该行由旧分类器产出：保留结论，但回答/复核时应视为需要重新确认。 */
  readonly classifierStale?: boolean;
}
export interface InboxPendingAnalysis {
  /** First trusted local observation timestamp; absent when legacy provenance is unknown. */
  readonly observedAt?: string;
  readonly workKey: string;
  readonly messageId: string;
  readonly sourceRevision: string;
  readonly mailboxId: string;
  readonly receipt: LayaTriageResult['receipt'];
  readonly route: 'main_agent' | 'review';
  readonly state: 'pending' | 'deferred' | 'accepted';
  readonly reason?: string;
  readonly projection: {readonly headersOnly: true; readonly sensitivity: 'private'; readonly text: string};
  readonly projectionDigest: string;
  readonly taskId?: string;
}
export interface InboxAnalysisAcceptance {
  readonly workKey: string;
  readonly sourceRevision: string;
  readonly receiptId: string;
  readonly projectionDigest: string;
  readonly taskId: string;
}
export interface InboxCloudReviewResult {
  readonly version: 1;
  readonly label: string | null;
  readonly impact: 'routine' | 'high_impact' | 'unknown';
  readonly notificationRecommendation: 'notify' | 'review' | 'none';
  readonly reasonCode: 'meeting_change' | 'deadline_change' | 'transaction' | 'newsletter' | 'personal' | 'work' | 'unclear' | 'other';
}
export interface InboxCloudReview extends InboxAnalysisAcceptance {
  readonly classifierFingerprint: string;
  readonly resultDigest: string;
  readonly reviewedAt: string;
  readonly review: InboxCloudReviewResult;
}
interface StoredAnalysis extends InboxPendingAnalysis {accountRef: string; folder: string; classifierFingerprint?: string;}
interface State {
  version: 2;
  records: Record<string, InboxTriageMetadata>;
  latest: Record<string, string>;
  cursors: Record<string, string>;
  heads: Record<string, {sourceRevision: string; fetchedAt: string; firstObservedAt?: string}>;
  observed: Record<string, true>;
  analyses: Record<string, StoredAnalysis>;
}
export interface InboxTriageOptions {
  readonly storage: StoragePort;
  /** Host-owned, user-isolated namespace. Storage must atomically replace one key. */
  readonly namespace: string;
  readonly triage: Pick<LayaTriageService, 'classify'>;
  readonly labels: Readonly<Record<string, string>>;
  readonly meetingLabels?: readonly string[];
  /** Trusted model/prompt/threshold/batching policy identity; unknown classifiers cannot reuse after restart. */
  readonly classifierFingerprint?: string;
  /** Trusted current loaded-model identity. Undefined disables reuse and analysis export. */
  readonly getClassifierFingerprint?: () => string | undefined;
  /** Checks the current local processing lease, not cloud export permission. */
  readonly authorizeRead: (scope: {accountRef: string; folder: string} & InboxTriageContext) => boolean;
}
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unfinished = new Set(['unavailable', 'invalid_response', 'cancelled', 'deadline', 'insufficient_input']);
function reject(message: string): never {throw new ProtocolError('INVALID_ARGUMENT', message);}
function text(value: unknown): value is string {return typeof value === 'string' && value.trim().length > 0;}

/** Local encrypted derived metadata/outbox. Single owner per namespace; no mail or Fact writes. */
export function createInboxTriagePipeline(options: InboxTriageOptions) {
  if (!text(options.namespace) || !options.storage || typeof options.triage?.classify !== 'function'
    || typeof options.authorizeRead !== 'function') reject('Inbox triage host configuration is invalid');
  const labels = structuredClone(options.labels);
  if (!labels || Object.keys(labels).length < 2 || Object.values(labels).some(value => !text(value))) {
    reject('Inbox labels must contain at least two definitions');
  }
  const meetingLabels = new Set(options.meetingLabels ?? []);
  if ([...meetingLabels].some(label => !Object.hasOwn(labels, label))) reject('Unknown meeting label');
  const storageKey = `inbox-triage:v1:${hash([options.namespace, labels, [...meetingLabels].sort()])}`;
  if (options.classifierFingerprint !== undefined && !text(options.classifierFingerprint)) reject('Invalid classifier fingerprint');
  if (options.getClassifierFingerprint !== undefined && typeof options.getClassifierFingerprint !== 'function') reject('Invalid classifier identity getter');
  const fallbackFingerprint = options.classifierFingerprint ?? randomUUID();
  const readFingerprint = (): string | undefined => {
    if (options.getClassifierFingerprint === undefined) return fallbackFingerprint;
    let value: unknown;
    try {value = options.getClassifierFingerprint();} catch {return undefined;}
    return text(value) && value.length <= 256 ? value : undefined;
  };
  const checkFingerprint = (expected: string): void => {
    if (readFingerprint() !== expected) throw new ProtocolError('REVISION_CONFLICT', 'Inbox classifier identity changed');
  };
  let busy = false;
  let cachedState: State | undefined;
  const analysisKeys = new Map<string, Set<string>>();
  const load = (): State => {
    if(cachedState)return cachedState;
    const saved = options.storage.get(storageKey);
    if (saved === undefined || saved === null) return cachedState={version: 2, records: {}, latest: {}, cursors: {}, heads: {}, observed: {}, analyses: {}};
    const state = structuredClone(saved) as State;
    // Keep old classifications/cursors. A newly read page reclassifies legacy rows
    // without receipt IDs; old metadata alone cannot create an analysis envelope.
    if ((state as {version: number})?.version === 1) {
      state.version = 2; state.heads = {}; state.analyses = {};
      state.observed = Object.fromEntries(Object.keys(state.records ?? {}).map(key => [key, true as const]));
    }
    if (!state || state.version !== 2 || !state.records || !state.latest || !state.cursors || !state.heads || !state.analyses || !state.observed
      || Array.isArray(state.records) || Array.isArray(state.latest) || Array.isArray(state.cursors)
      || Array.isArray(state.heads) || Array.isArray(state.analyses) || Array.isArray(state.observed)
      || Object.values(state.observed).some(value => value !== true)
      || Object.values(state.records).some(item => !item || item.sensitivity !== 'private' || item.headersOnly !== true)
      || Object.values(state.latest).some(key => typeof key !== 'string' || !state.records[key])
      || Object.values(state.cursors).some(value => typeof value !== 'string')
      || Object.values(state.heads).some(head => !head || !text(head.sourceRevision) || !Number.isFinite(Date.parse(head.fetchedAt))
        ||head.firstObservedAt!==undefined&&!Number.isFinite(Date.parse(head.firstObservedAt)))
      || Object.entries(state.analyses).some(([key, item]) => !item || item.workKey !== key
        || !text(item.messageId) || !text(item.sourceRevision) || !text(item.accountRef) || !text(item.folder)
        || !['pending', 'deferred', 'accepted'].includes(item.state) || !['review', 'main_agent'].includes(item.route)
        || !item.receipt || !text(item.receipt.id) || item.projection?.headersOnly !== true
        || item.projection.sensitivity !== 'private' || !text(item.projection.text)
        || item.projectionDigest !== hash(item.projection)
        || (item.state === 'accepted' && !text(item.taskId)))) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Inbox triage state needs recovery');
    }
    for(const [key,item]of Object.entries(state.analyses)){
      const keys=analysisKeys.get(item.messageId)??new Set<string>();keys.add(key);analysisKeys.set(item.messageId,keys);
    }
    return cachedState=state;
  };
  const save = (state: State): void => {
    try{options.storage.set(storageKey,structuredClone(state));}
    catch(error){cachedState=undefined;analysisKeys.clear();summaryReady=false;throw error;}
  };
  const removeAnalysis=(state:State,key:string)=>{const item=state.analyses[key];if(!item)return;
    analysisKeys.get(item.messageId)?.delete(key);delete state.analyses[key];};
  const visible = new Map<string, InboxTriageMetadata>();
  let summaryFingerprint: string | undefined, summaryReady=false;
  const counts={total:0,needsReview:0,highImpactCandidates:0,meetingCandidates:0,cloudReviewed:0,groups:Object.create(null) as Record<string,number>};
  const countRow=(row:InboxTriageMetadata,direction:number)=>{
    const effective=row.effectiveClassification??row;
    counts.total+=direction;counts.cloudReviewed+=Number(Boolean(row.effectiveClassification))*direction;
    counts.needsReview+=Number(effective.needsReview)*direction;
    counts.highImpactCandidates+=Number(effective.highImpactCandidate)*direction;counts.meetingCandidates+=Number(effective.meetingCandidate)*direction;
    if(effective.label!==null){counts.groups[effective.label]=(counts.groups[effective.label]??0)+direction;if(!counts.groups[effective.label])delete counts.groups[effective.label];}
  };
  const effectiveReview=(state:State,row:InboxTriageMetadata):InboxTriageMetadata['effectiveClassification']=>{
    const saved=row.cloudReview,review=saved?.review,item=saved?state.analyses[saved.workKey]:undefined;
    const fingerprint=row.classifierFingerprint;
    if(!saved||!review||!fingerprint||saved.classifierFingerprint!==fingerprint
      ||state.heads[row.messageId]?.sourceRevision!==row.sourceRevision||saved.sourceRevision!==row.sourceRevision
      ||!item||item.state!=='accepted'||item.messageId!==row.messageId||item.sourceRevision!==row.sourceRevision
      ||item.classifierFingerprint!==fingerprint||item.taskId!==saved.taskId||item.receipt.id!==saved.receiptId
      ||row.receiptId!==saved.receiptId||item.mailboxId!==row.mailboxId||item.mailboxId!==hash([item.accountRef,item.folder])
      ||item.projectionDigest!==hash(item.projection)||item.projectionDigest!==saved.projectionDigest||saved.resultDigest!==hash(review)
      ||review.version!==1||!(review.label===null||Object.hasOwn(labels,review.label))
      ||!['routine','high_impact','unknown'].includes(review.impact)||!['notify','review','none'].includes(review.notificationRecommendation))return;
    const needsReview=review.label===null||review.impact==='unknown'||review.notificationRecommendation==='review';
    const highImpactCandidate=review.impact==='high_impact',meetingCandidate=review.label!==null&&meetingLabels.has(review.label);
    return {source:'cloud-review',label:review.label,route:highImpactCandidate||meetingCandidate?'main_agent':needsReview?'review':'group',
      needsReview,highImpactCandidate,meetingCandidate};
  };
  const updateSummary=(ids:Iterable<string>)=>{
    const state=load(),fingerprint=readFingerprint();
    if(!summaryReady||summaryFingerprint!==fingerprint){
      visible.clear();counts.total=counts.needsReview=counts.highImpactCandidates=counts.meetingCandidates=counts.cloudReviewed=0;
      for(const key of Object.keys(counts.groups))delete counts.groups[key];
      summaryReady=true;summaryFingerprint=fingerprint;ids=Object.keys(state.latest);
    }
    for(const id of ids){const previous=visible.get(id);if(previous){countRow(previous,-1);visible.delete(id);}
      const row=state.records[state.latest[id]!];
      if(!row||(state.heads[id]&&state.heads[id]!.sourceRevision!==row.sourceRevision))continue;
      const effectiveClassification=effectiveReview(state,row);
      const projected=fingerprint&&row.classifierFingerprint===fingerprint
        ?{...row,...(effectiveClassification?{effectiveClassification}:{})}
        :{...row,classifierStale:true,highImpactCandidate:false,meetingCandidate:false,...(effectiveClassification?{effectiveClassification}:{})};
      visible.set(id,projected);countRow(projected,1);
    }
  };
  const summary=()=>{updateSummary([]);return structuredClone(counts);};
  const checkContext = (page: InboxTriageContext): void => {
    if (!page || !(page.signal instanceof AbortSignal) || !Number.isFinite(Date.parse(page.deadline))) reject('Invalid inbox context');
    if (page.signal.aborted) throw new ProtocolError('CANCELLED', 'Inbox triage cancelled');
    if (Date.now() >= Date.parse(page.deadline)) throw new ProtocolError('TIMEOUT', 'Inbox triage deadline expired');
  };
  const check = (page: InboxTriageContext & {accountRef: string; folder: string}): void => {
    checkContext(page);
    if (options.authorizeRead({accountRef: page.accountRef, folder: page.folder,
      deadline: page.deadline, signal: page.signal}) !== true) {
      throw new ProtocolError('UNAUTHORIZED', 'Local inbox processing is not authorized');
    }
  };
  const currentAnalysis = (state: State, key: string, classifierFingerprint: string | undefined): StoredAnalysis | undefined => {
    const item = state.analyses[key];
    return classifierFingerprint && item && item.classifierFingerprint === classifierFingerprint
      && state.heads[item.messageId]?.sourceRevision === item.sourceRevision ? item : undefined;
  };
  // Cached cloud review uses the original durable classifier receipt, never a new
  // model identity or an ephemeral local-reading batch. This is a trusted-host
  // source port only; cloud export still requires its separate Runtime grant.
  const reviewAnalysis = (state: State, key: string): StoredAnalysis | undefined => {
    const item=state.analyses[key],row=item?state.records[state.latest[item.messageId]!]:undefined;
    return item&&text(item.classifierFingerprint)&&row
      &&state.heads[item.messageId]?.sourceRevision===item.sourceRevision
      &&row.messageId===item.messageId&&row.sourceRevision===item.sourceRevision
      &&item.mailboxId===hash([item.accountRef,item.folder])&&row.mailboxId===item.mailboxId&&row.receiptId===item.receipt.id
      &&row.classifierFingerprint===item.classifierFingerprint&&item.projectionDigest===hash(item.projection)?item:undefined;
  };
  const publicAnalysis = (item: StoredAnalysis): InboxPendingAnalysis => {
    const {accountRef: _accountRef, folder: _folder, classifierFingerprint: _fingerprint, ...result} = item;
    return structuredClone(result);
  };
  const readAnalysis = (workKey: string, context: InboxTriageContext): InboxPendingAnalysis | undefined => {
    checkContext(context);
    const item = currentAnalysis(load(), workKey, readFingerprint());
    if (!item) return undefined;
    if(busy&&item.state!=='accepted')return undefined;
    check({...context, accountRef: item.accountRef, folder: item.folder});
    return publicAnalysis(item);
  };
  const pendingAnalyses = (context: InboxTriageContext, filter: InboxAnalysisFilter | undefined, cached=false): readonly InboxPendingAnalysis[] => {
    checkContext(context);
    if(busy)return [];
    const state=load(),fingerprint=cached?undefined:readFingerprint();
    const select=(key:string)=>cached?reviewAnalysis(state,key):currentAnalysis(state,key,fingerprint);
    if(filter!==undefined){
      if(!filter||Object.keys(filter).some(key=>!['observedAtOrAfter','workKeys','excludeWorkKeys','limit'].includes(key))
        ||filter.observedAtOrAfter!==undefined&&!Number.isFinite(Date.parse(filter.observedAtOrAfter))
        ||filter.workKeys!==undefined&&(!Array.isArray(filter.workKeys)||filter.workKeys.some(key=>!text(key)))
        ||filter.excludeWorkKeys!==undefined&&(!Array.isArray(filter.excludeWorkKeys)||filter.excludeWorkKeys.some(key=>!text(key)))
        ||filter.limit!==undefined&&(!Number.isSafeInteger(filter.limit)||filter.limit<1))reject('Invalid inbox analysis filter');
      const keys=new Set(filter.workKeys??[]),excluded=new Set(filter.excludeWorkKeys??[]),watermark=filter.observedAtOrAfter===undefined?undefined:Date.parse(filter.observedAtOrAfter);
      const result:InboxPendingAnalysis[]=[];
      for(const key in state.analyses){
        const item=select(key);
        if(!item||excluded.has(key)||item.state!=='pending'||!(keys.has(key)||watermark!==undefined&&item.observedAt!==undefined
          &&Number.isFinite(Date.parse(item.observedAt))&&Date.parse(item.observedAt)>=watermark)
          ||!options.authorizeRead({accountRef:item.accountRef,folder:item.folder,...context}))continue;
        result.push(publicAnalysis(item));if(result.length>=(filter.limit??Number.MAX_SAFE_INTEGER))break;
      }
      return result;
    }
    return Object.keys(state.analyses).sort().flatMap(key=>{
      const item=select(key);
      if(!item||item.state==='accepted'||!options.authorizeRead({accountRef:item.accountRef,folder:item.folder,...context}))return [];
      return [publicAnalysis(item)];
    });
  };
  const snapshot = () => {
    const totals=summary();return {...totals,records:structuredClone([...visible.values()])};
  };
  const confirmAnalysisAccepted = (input: InboxAnalysisAcceptance, context: InboxTriageContext, cached=false): InboxPendingAnalysis => {
      checkContext(context);
      if (busy) throw new ProtocolError('REVISION_CONFLICT', 'Inbox page is still processing');
      if (!input || ![input.workKey, input.sourceRevision, input.receiptId, input.projectionDigest, input.taskId].every(text)) {
        reject('Invalid inbox analysis acceptance');
      }
      const state = load(), item = cached?reviewAnalysis(state,input.workKey):currentAnalysis(state, input.workKey, readFingerprint());
      if (!item || item.sourceRevision !== input.sourceRevision || item.receipt.id !== input.receiptId
        || item.projectionDigest !== input.projectionDigest || item.state === 'deferred'
        || (item.taskId !== undefined && item.taskId !== input.taskId)) {
        throw new ProtocolError('REVISION_CONFLICT', 'Inbox analysis is stale or not ready');
      }
      check({...context, accountRef: item.accountRef, folder: item.folder});
      if(!cached)checkFingerprint(item.classifierFingerprint!);
      if (item.state !== 'accepted') {
        state.analyses[input.workKey] = {...item, state: 'accepted', taskId: input.taskId}; save(state);
      }
      return publicAnalysis(state.analyses[input.workKey]!);
    };
  const applyAnalysisReview = (input: InboxAnalysisAcceptance & {readonly review: InboxCloudReviewResult}, context: InboxTriageContext, cached=false): InboxTriageMetadata => {
      checkContext(context);
      if (busy) throw new ProtocolError('REVISION_CONFLICT', 'Inbox page is still processing');
      if (!input || Object.keys(input).sort().join(',') !== 'projectionDigest,receiptId,review,sourceRevision,taskId,workKey'
        || ![input.workKey,input.sourceRevision,input.receiptId,input.projectionDigest,input.taskId].every(text)) reject('Invalid inbox review binding');
      const review = input.review;
      if (!review || Object.keys(review).sort().join(',') !== 'impact,label,notificationRecommendation,reasonCode,version'
        || review.version !== 1 || !(review.label === null || typeof review.label === 'string' && Object.hasOwn(labels,review.label))
        || !['routine','high_impact','unknown'].includes(review.impact)
        || !['notify','review','none'].includes(review.notificationRecommendation)
        || !['meeting_change','deadline_change','transaction','newsletter','personal','work','unclear','other'].includes(review.reasonCode)) reject('Invalid inbox review result');
      const state=load(),item=cached?reviewAnalysis(state,input.workKey):currentAnalysis(state,input.workKey,readFingerprint());
      if (!item || item.state !== 'accepted' || item.taskId !== input.taskId || item.sourceRevision !== input.sourceRevision
        || item.receipt.id !== input.receiptId || item.projectionDigest !== input.projectionDigest) {
        throw new ProtocolError('REVISION_CONFLICT','Inbox review is stale or not accepted');
      }
      check({...context,accountRef:item.accountRef,folder:item.folder});if(!cached)checkFingerprint(item.classifierFingerprint!);
      const key=state.latest[item.messageId],row=key?state.records[key]:undefined;
      if (!row || row.sourceRevision !== item.sourceRevision || row.classifierFingerprint !== item.classifierFingerprint)
        throw new ProtocolError('REVISION_CONFLICT','Inbox review source changed');
      const fixedReview: InboxCloudReviewResult={version:1,label:review.label,impact:review.impact,
        notificationRecommendation:review.notificationRecommendation,reasonCode:review.reasonCode};
      const resultDigest=hash(fixedReview);
      if (row.cloudReview) {
        if (row.cloudReview.taskId !== input.taskId || row.cloudReview.workKey !== input.workKey || row.cloudReview.resultDigest !== resultDigest)
          throw new ProtocolError('REVISION_CONFLICT','Inbox review result changed');
        return structuredClone(row);
      }
      const cloudReview: InboxCloudReview={workKey:input.workKey,sourceRevision:input.sourceRevision,receiptId:input.receiptId,
        projectionDigest:input.projectionDigest,taskId:input.taskId,classifierFingerprint:item.classifierFingerprint!,
        resultDigest,reviewedAt:new Date().toISOString(),review:fixedReview};
      state.records[key!]={...row,cloudReview};save(state);updateSummary([item.messageId]);
      return structuredClone(state.records[key!]!);
    };
  return Object.freeze({
    snapshot,summary,
    /** Trusted local host only. Contents have no implicit cloud export permission. */
    pendingAnalyses: (context:InboxTriageContext,filter?:InboxAnalysisFilter)=>pendingAnalyses(context,filter),
    readAnalysis,
    confirmAnalysisAccepted: (input:InboxAnalysisAcceptance,context:InboxTriageContext)=>confirmAnalysisAccepted(input,context),
    /** Trusted host calls only after the original Runtime task succeeded and its JSON was validated. */
    applyAnalysisReview: (input:InboxAnalysisAcceptance & {readonly review:InboxCloudReviewResult},context:InboxTriageContext)=>applyAnalysisReview(input,context),
    /** Cached header projections: trusted Runtime host only, separately authorized for every cloud send. */
    pendingReviewAnalyses: (context:InboxTriageContext,filter?:InboxAnalysisFilter)=>pendingAnalyses(context,filter,true),
    readReviewAnalysis(workKey:string,context:InboxTriageContext):InboxPendingAnalysis|undefined {
      checkContext(context);
      const item=reviewAnalysis(load(),workKey);
      if(!item||busy&&item.state!=='accepted')return undefined;
      check({...context,accountRef:item.accountRef,folder:item.folder});return publicAnalysis(item);
    },
    confirmCachedAnalysisAccepted: (input:InboxAnalysisAcceptance,context:InboxTriageContext)=>confirmAnalysisAccepted(input,context,true),
    applyCachedAnalysisReview: (input:InboxAnalysisAcceptance & {readonly review:InboxCloudReviewResult},context:InboxTriageContext)=>applyAnalysisReview(input,context,true),
    /** Trusted composition only, after proving the previous task ended before any cloud send. */
    retryCachedAnalysis(input:Omit<InboxAnalysisAcceptance,'taskId'> & {readonly previousTaskId:string},context:InboxTriageContext):InboxPendingAnalysis {
      checkContext(context);
      if(busy)throw new ProtocolError('REVISION_CONFLICT','Inbox page is still processing');
      if(!input||Object.keys(input).sort().join(',')!=='previousTaskId,projectionDigest,receiptId,sourceRevision,workKey'
        ||![input.workKey,input.sourceRevision,input.receiptId,input.projectionDigest,input.previousTaskId].every(text))
        reject('Invalid inbox review retry binding');
      const state=load(),item=reviewAnalysis(state,input.workKey),row=item?state.records[state.latest[item.messageId]!]:undefined;
      if(!item||item.state!=='accepted'||item.taskId!==input.previousTaskId||item.sourceRevision!==input.sourceRevision
        ||item.receipt.id!==input.receiptId||item.projectionDigest!==input.projectionDigest||!row||row.cloudReview)
        throw new ProtocolError('REVISION_CONFLICT','Inbox review cannot be retried');
      check({...context,accountRef:item.accountRef,folder:item.folder});
      const {taskId:_taskId,...remaining}=item;
      state.analyses[input.workKey]={...remaining,state:'pending'};save(state);
      return publicAnalysis(state.analyses[input.workKey]!);
    },
    cursor: (accountRef: string, folder: string): string | undefined => load().cursors[hash([accountRef, folder])],
    readCursor(scope: {accountRef: string; folder: string} & InboxTriageContext): string | undefined {
      check(scope);
      return load().cursors[hash([scope.accountRef, scope.folder])];
    },
    /** Only after authoritative CURSOR_EXPIRED, on a fresh user read lease. Outbox and classifications are preserved. */
    resetExpiredCursor(scope: {accountRef: string; folder: string; expectedCursor: string} & InboxTriageContext): void {
      check(scope);
      if (busy) throw new ProtocolError('REVISION_CONFLICT', 'Inbox page is still processing');
      const state = load(), key = hash([scope.accountRef, scope.folder]);
      if (state.cursors[key] !== scope.expectedCursor) throw new ProtocolError('REVISION_CONFLICT', 'Inbox cursor has changed');
      delete state.cursors[key]; save(state);
    },
    async processPage(input: InboxTriagePage) {
      if (busy) throw new ProtocolError('REVISION_CONFLICT', 'Inbox triage is already processing a page');
      if (!input || !text(input.accountRef) || !text(input.folder) || typeof input.nextCursor !== 'string'
        || (input.cursor !== undefined && typeof input.cursor !== 'string') || typeof input.hasMore !== 'boolean'
        || !Array.isArray(input.items) || input.items.length > 100 || !(input.signal instanceof AbortSignal)
        || !Number.isFinite(Date.parse(input.deadline))) reject('Invalid inbox page');
      const page: InboxTriagePage = {...input, items: structuredClone(input.items)};
      check(page);
      const classifierFingerprint = readFingerprint();
      if (classifierFingerprint === undefined) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Loaded inbox classifier identity is unavailable');
      const mailboxId = hash([page.accountRef, page.folder]);
      const messages = page.items.map(item => {
        validateContract('connectorItem', item);
        if (item.source !== 'mail' || item.sensitivity !== 'private' || item.accountRef !== page.accountRef
          || !item.externalId.startsWith(`${page.folder}:`)) reject('Inbox source must remain private and bound to its mailbox');
        const messageId = hash([page.accountRef, page.folder, item.externalId, item.dedupeKey]);
        // Missing Date headers use fetchedAt; refetch time is not a source change.
        const sourceRevision = hash([item.dedupeKey, item.contentRef,
          item.occurredAt === item.fetchedAt ? null : item.occurredAt]);
        return {source: 'mail', messageId, sourceRevision, text: item.contentRef};
      });
      const revisions = new Map<string, string>();
      for (const message of messages) {
        if (revisions.has(message.messageId) && revisions.get(message.messageId) !== message.sourceRevision) {
          reject('An inbox page contains conflicting versions');
        }
        revisions.set(message.messageId, message.sourceRevision);
      }
      busy = true;
      let dirtyState: State | undefined;
      try {
        const state = load();
        const storedCursor = state.cursors[mailboxId];
        const storedParts = storedCursor?.match(/^(\d+):(\d+)$/);
        const pageParts = page.nextCursor.match(/^(\d+):(\d+)$/);
        // A fresh process-local read session starts at INBOX's first page. Replaying
        // confirmed earlier pages may refresh classifications but cannot rewind progress.
        const historical = Boolean(storedParts && pageParts && storedParts[1] === pageParts[1]
          && BigInt(storedParts[2]!) > BigInt(pageParts[2]!));
        if (!historical && storedCursor !== (page.cursor || undefined) && storedCursor !== page.nextCursor) {
          throw new ProtocolError('REVISION_CONFLICT', 'Inbox page does not match the persisted cursor');
        }
        const unique = [...new Map(messages.map(message => [message.messageId, message])).values()];
        const fetchedAt = new Map(messages.map((message, index) => [message.messageId, page.items[index]!.fetchedAt]));
        let sourceChanged=false;
        const current = unique.filter(message => {
          const key = hash([message.messageId, message.sourceRevision]);
          const head = state.heads[message.messageId];
          const priorRevision = head?.sourceRevision ?? state.records[state.latest[message.messageId]!]?.sourceRevision;
          const observedAt = fetchedAt.get(message.messageId)!;
          // A replay of a known historical revision never reactivates an old analysis.
          if (priorRevision && priorRevision !== message.sourceRevision
            && (state.observed[key] || (head && Date.parse(observedAt) < Date.parse(head.fetchedAt)))) return false;
          const latestFetchedAt=head&&Date.parse(head.fetchedAt)>Date.parse(observedAt)?head.fetchedAt:observedAt;
          if(!head||head.sourceRevision!==message.sourceRevision||head.fetchedAt!==latestFetchedAt||!state.observed[key])sourceChanged=true;
          // Re-reading/reclassifying known mail cannot give historical headers a
          // fresh cloud-export watermark. Legacy unknown provenance stays unknown.
          const firstObservedAt=head?.firstObservedAt??(!head&&!state.latest[message.messageId]
            &&!analysisKeys.has(message.messageId)&&!state.observed[key]?observedAt:undefined);
          state.heads[message.messageId] = {sourceRevision: message.sourceRevision,fetchedAt:latestFetchedAt,
            ...(firstObservedAt!==undefined?{firstObservedAt}:{})};
          state.observed[key] = true;
          if (priorRevision !== message.sourceRevision) {
            for (const workKey of analysisKeys.get(message.messageId)??[])removeAnalysis(state,workKey);
          }
          return true;
        });
        // Invalidate superseded work before inference can yield to a cloud sender.
        try {
          updateSummary(current.map(message=>message.messageId));
          check(page); checkFingerprint(classifierFingerprint);if(sourceChanged)save(state);
        } catch(error) {
          // Unpublished source changes must not survive a denied/expired lease
          // in memory: the next attempt must reload and invalidate disk first.
          cachedState=undefined;analysisKeys.clear();summaryReady=false;throw error;
        }
        const pending = current.filter(message => {
          const row = state.records[hash([message.messageId, message.sourceRevision])];
          return !row?.receiptId || row.classifierFingerprint !== classifierFingerprint;
        });
        let classified = 0;
        let incomplete = false;
        // The public Laya service bounds each batch; persist completed chunks before proceeding.
        for (let index = 0; index < pending.length; index += 4) {
          check(page); checkFingerprint(classifierFingerprint);
          const batch = pending.slice(index, index + 4);
          const results = await options.triage.classify({messages: batch, labels,
            deadline: page.deadline, signal: page.signal});
          check(page); checkFingerprint(classifierFingerprint);
          if (!Array.isArray(results) || results.length !== batch.length) {
            throw new ProtocolError('EXTERNAL_FAILURE', 'Inbox classifier returned an invalid batch');
          }
          for(let offset=0;offset<batch.length;offset++){
            const message=batch[offset]!,result=results[offset]!;
            if(!result||result.source!==message.source||result.messageId!==message.messageId||result.sourceRevision!==message.sourceRevision
              ||!['group','review','main_agent'].includes(result.route)||(result.label!==null&&!Object.hasOwn(labels,result.label)))
              throw new ProtocolError('EXTERNAL_FAILURE','Inbox classifier correlation failed');
          }
          let dispatch;
          try { dispatch = prepareTriageDispatch({namespace: options.namespace, messages: batch, labels, results}); }
          catch { throw new ProtocolError('EXTERNAL_FAILURE', 'Inbox classifier receipt validation failed'); }
          const queue = (ref: TriageDispatchRef, route: 'main_agent' | 'review', deferredReason?: string) => {
            const message = batch.find(item => item.messageId === ref.messageId)!;
            // Changed classifier policy cannot reopen work already handed to Runtime.
            if ([...(analysisKeys.get(message.messageId)??[])].some(key => state.analyses[key]?.sourceRevision === message.sourceRevision
              && state.analyses[key]?.state === 'accepted')) return;
            const projection = {headersOnly: true as const, sensitivity: 'private' as const, text: message.text};
            for (const key of analysisKeys.get(message.messageId)??[])if(key!==ref.workKey)removeAnalysis(state,key);
            state.analyses[ref.workKey] = {...ref, accountRef: page.accountRef, folder: page.folder, mailboxId, classifierFingerprint,
              ...(state.heads[message.messageId]?.firstObservedAt!==undefined
                ?{observedAt:state.heads[message.messageId]!.firstObservedAt}:{}),
              route, state: deferredReason ? 'deferred' : 'pending',
              ...(deferredReason ? {reason: deferredReason} : {}), projection, projectionDigest: hash(projection)};
            const keys=analysisKeys.get(message.messageId)??new Set<string>();keys.add(ref.workKey);analysisKeys.set(message.messageId,keys);
          };
          dispatch.mainAgent.forEach(ref => queue(ref, 'main_agent'));
          dispatch.review.forEach(ref => queue(ref, 'review'));
          dispatch.deferred.forEach(ref => queue(ref, ref.requiredRoute, ref.reason));
          for (let offset = 0; offset < batch.length; offset++) {
            const message = batch[offset]!;
            const result = results[offset]!;
            if (!result || result.source !== message.source || result.messageId !== message.messageId
              || result.sourceRevision !== message.sourceRevision
              || !['group', 'review', 'main_agent'].includes(result.route)
              || (result.label !== null && !Object.hasOwn(labels, result.label))) {
              throw new ProtocolError('EXTERNAL_FAILURE', 'Inbox classifier correlation failed');
            }
            if (unfinished.has(result.reason)) {incomplete = true; continue;}
            const key = hash([message.messageId, message.sourceRevision]);
            const copyScores = (scores: LayaTriageResult['scores'], choices: readonly string[]) => {
              if (!scores || !choices.includes(scores.choice)) return undefined;
              const numbers = [scores.answerConfidence, scores.entropyConcentration, scores.margin,
                ...choices.map(choice => scores.probabilities[choice])];
              if (!numbers.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) return undefined;
              return {choice: scores.choice, probabilities: Object.fromEntries(choices.map(choice => [choice, scores.probabilities[choice]!])),
                answerConfidence: scores.answerConfidence, entropyConcentration: scores.entropyConcentration, margin: scores.margin};
            };
            const scores = copyScores(result.scores, Object.keys(labels));
            const impactScores = copyScores(result.impactScores, ['routine', 'high_impact']);
            const reasons: readonly string[] = ['classified','high_impact','uncertain','invalid_response','insufficient_input',
              'unknown_category','unavailable','cancelled','deadline'];
            state.records[key] = {messageId: message.messageId, sourceRevision: message.sourceRevision, mailboxId,
              sensitivity: 'private', headersOnly: true, label: result.label, route: result.route,
              needsReview: result.route !== 'group' || result.abstained
                || (result.label !== null && meetingLabels.has(result.label)),
              highImpactCandidate: result.route === 'main_agent',
              meetingCandidate: result.label !== null && meetingLabels.has(result.label), receiptId: result.receipt.id, classifierFingerprint,
              ...(reasons.includes(result.reason) ? {classificationReason: result.reason} : {}),
              ...(result.candidateLabel === null || typeof result.candidateLabel === 'string' && Object.hasOwn(labels,result.candidateLabel)
                ? {candidateLabel:result.candidateLabel} : {}),
              ...(scores ? {scores} : {}), ...(impactScores ? {impactScores} : {})};
            // A successful ordinary group has no pending machine analysis.
            if (result.route === 'group') {
              for (const workKey of analysisKeys.get(message.messageId)??[])if(state.analyses[workKey]?.state!=='accepted')removeAnalysis(state,workKey);
            }
            state.latest[message.messageId] = key;
            classified++;
          }
          updateSummary(batch.map(message=>message.messageId));dirtyState=state;
          check(page); checkFingerprint(classifierFingerprint);
          // Four inference chunks per durable checkpoint. A cancelled page flushes
          // completed receipts below, but never advances its unfinished page cursor.
          if((index+batch.length)%16===0){dirtyState=undefined;save(state);}
        }
        // Cached revisions must also become the latest visible observation after replay.
        let latestChanged=false;
        for (const message of current) {
          const key = hash([message.messageId, message.sourceRevision]);
          if (state.records[key]) {if(state.latest[message.messageId]!==key)latestChanged=true;state.latest[message.messageId] = key;}
          else incomplete = true;
        }
        updateSummary(current.map(message=>message.messageId));
        check(page); checkFingerprint(classifierFingerprint);
        const cursorChanged=!incomplete&&!historical&&state.cursors[mailboxId]!==page.nextCursor;
        if(cursorChanged)state.cursors[mailboxId]=page.nextCursor;
        const persist=Boolean(dirtyState)||latestChanged||cursorChanged;
        dirtyState=undefined;if(persist)save(state);
        return {classified, reused: current.length - pending.length, ignoredStale: unique.length - current.length, complete: !incomplete,
          cursorAdvanced: !incomplete && !historical, nextCursor: state.cursors[mailboxId], hasMore: page.hasMore,
          summary: summary()};
      } finally {try{if(dirtyState)save(dirtyState);}finally{busy = false;}}
    },
  });
}
