import {ProtocolError} from '@personal-agent/contracts';
import {createHash,randomUUID} from 'node:crypto';
import type {RegisteredTool, StoragePort, ProtocolContracts, ToolContext} from '@personal-agent/contracts';
import {QQMailProvider, register as registerMail} from '@personal-agent/mail';
import {LayaTriageService, LocalLayaBatchHttpTransport} from '@personal-agent/cognition';
import type {RuntimeApplication} from './runtime-application.js';
import {createInboxTriagePipeline} from './inbox-triage.js';
import type {InboxAnalysisAcceptance, InboxTriageContext} from './inbox-triage.js';
import {MAIL_READ_SESSION_CHECKPOINT} from './mail-read-session.js';

const classifierPolicy = Object.freeze({model: 'multilingual', promptVersion: 'mail-triage-v1',
  strategyVersion: 'laya-triage-v1', batching: 'multi_state' as const, chunkSize: 4,
  minimumAnswerProbability: 0.7, minimumMargin: 0.15});
/** Bump strategyVersion when interpretation changes; labels are separately bound by the pipeline. */
export const LOCAL_INBOX_CLASSIFIER_FINGERPRINT = createHash('sha256').update(JSON.stringify(classifierPolicy)).digest('hex');
export function createLocalInboxClassifier(options: {port: number; getApiKey: () => string}) {
  return new LayaTriageService(new LocalLayaBatchHttpTransport(options.port, options.getApiKey), classifierPolicy);
}

export interface QQMailTriageHostOptions {
  readonly user: string;
  readonly authCode: string;
  readonly accountRef: string;
  readonly storage: StoragePort;
  readonly namespace: string;
  readonly triage?: Pick<LayaTriageService, 'classify'>;
  readonly labels: Readonly<Record<string, string>>;
  readonly meetingLabels?: readonly string[];
  readonly classifierFingerprint?: string;
  readonly getClassifierFingerprint?: () => string | undefined;
  readonly isSessionAllowed: () => boolean;
  /** Trusted local composition only: binds the actual Runtime read task to its
   * current monitoring origin. No mail headers or credentials leave this port. */
  readonly onReadTask?: (input: {taskId: string; sessionId: string}) => void;
  /** Optional trusted composition. Configuration readiness is never an execution grant. */
  readonly batchAuthorization?: {
    canRequest(): boolean;
    preparePage(scope: MailBatchPageScope,batch: MailLocalBatchBinding,parentScope?: MailBatchPageScope): void;
    assertCurrent(batch: MailLocalBatchBinding): void;
    assertPage(scope: MailBatchPageScope,batch: MailLocalBatchBinding): void;
    assertConsumed(scope: MailBatchPageScope,batch: MailLocalBatchBinding): void;
    finish(batch: MailLocalBatchBinding): void;
  };
}
export interface MailLocalBatchBinding {
  readonly batchId:string;readonly generation:string;readonly accountRef:string;readonly folder:'INBOX';
  readonly limit:number;readonly queryDigest:string;readonly deadline:string;
}
export type MailBatchPageScope=Pick<ToolContext,'taskId'|'runId'|'deadline'|'signal'> & {readonly toolName?:string;readonly toolVersion?:string};

/** Trusted composition: only the registered tool touches IMAP, after Runtime/Policy authorization. */
export function createQQMailTriageHost(options: QQMailTriageHostOptions) {
  const provider = new QQMailProvider({user: options.user, authCode: options.authCode});
  let application: RuntimeApplication | undefined;
  let sessionId: string | undefined;
  let controller = new AbortController();
  let closed = false, refreshing = false, reading = 0, status = options.triage ? 'ready' : 'unavailable';
  let taskId: string | undefined, cursor: string | undefined, deadline = '';
  let analysisSessionId: string | undefined;
  let expiredCursor: string | undefined;
  let submittingPage=false;
  let batch:MailLocalBatchBinding|undefined,firstPageScope:MailBatchPageScope|undefined,pageScope:MailBatchPageScope|undefined;
  const canRequest=()=>!closed&&(options.batchAuthorization?options.batchAuthorization.canRequest():options.isSessionAllowed());
  const batchCurrent=()=>{if(closed||controller.signal.aborted)return false;if(!options.batchAuthorization)return options.isSessionAllowed();
    if(!batch)return false;try{options.batchAuthorization.assertCurrent(batch);return true;}catch{return false;}};
  const allowed = () => {if(!options.batchAuthorization)return !closed&&options.isSessionAllowed();
    if(!batchCurrent()||!batch||!firstPageScope)return false;
    try{options.batchAuthorization.assertConsumed(firstPageScope,batch);return true;}catch{return false;}};
  const pipeline = options.triage ? createInboxTriagePipeline({storage: options.storage,
    namespace: options.namespace, triage: options.triage, labels: options.labels,
    ...(options.meetingLabels ? {meetingLabels: options.meetingLabels} : {}),
    ...(options.classifierFingerprint ? {classifierFingerprint: options.classifierFingerprint} : {}),
    ...(options.getClassifierFingerprint !== undefined ? {getClassifierFingerprint: options.getClassifierFingerprint} : {}),
    // Local cursor metadata is only read after an explicit manual start; provider access is
    // guarded separately by the exact page receipt, never this configuration readiness.
    authorizeRead: scope => canRequest() && scope.accountRef === options.accountRef && scope.folder === 'INBOX'}) : undefined;
  const tools: RegisteredTool[] = [];
  const disposeRegistration = registerMail({register(implementation) {
    if (implementation.descriptor.name !== 'mail.inbox') return () => {};
    tools.push({descriptor: implementation.descriptor, async execute(input, context) {
      const args = input as {account?: unknown; folder?: unknown};
      const permitted=()=>{if(!options.batchAuthorization)return !closed&&options.isSessionAllowed();
        if(!batchCurrent()||!batch)return false;try{options.batchAuthorization.assertPage(context,batch);return true;}catch{return false;}};
      if (!permitted() || !pipeline || !sessionId || context.taskId !== taskId
        || args.account !== options.accountRef || args.folder !== 'INBOX') {
        throw new ProtocolError('UNAUTHORIZED', 'Inbox read is outside its local session');
      }
      const signal = AbortSignal.any([context.signal, controller.signal]);
      if (signal.aborted) throw new ProtocolError('CANCELLED', 'Inbox read cancelled');
      const abort = () => {void provider.dispose();};
      signal.addEventListener('abort', abort, {once: true});
      reading++;
      try {
        pageScope={...context,toolName:implementation.descriptor.name,toolVersion:implementation.descriptor.version};
        firstPageScope??=pageScope;
        const result = await implementation.execute(input, {...context, signal});
        if (!permitted() || signal.aborted) throw new ProtocolError('CANCELLED', 'Inbox read revoked');
        return result;
      } finally {
        signal.removeEventListener('abort', abort);
        reading--;
        // connect() may have finished after dispose() saw no current client.
        if (signal.aborted || !permitted()) await provider.dispose();
        if (controller.signal.aborted && reading === 0) status = 'disabled';
      }
    }});
    return () => {tools.length = 0;};
  }}, {provider, accountRef: options.accountRef});
  const snapshot = () => {
    const summary = pipeline?.snapshot();
    return {configured: true, status: controller.signal.aborted && reading > 0 ? 'stop_unconfirmed' : status,
      headersOnly: true, counts: {total: summary?.total ?? 0, needsReview: summary?.needsReview ?? 0,
        highImpactCandidates: summary?.highImpactCandidates ?? 0, meetingCandidates: summary?.meetingCandidates ?? 0,
        groups: summary?.groups ?? {}},
      reason: !pipeline ? '本地 Laya 服务未配置，尚未读取邮箱'
        : status === 'resync_required' ? '邮箱分页游标已失效；下次主动读取将从当前邮箱重新同步，已有记录保留' : undefined};
  };
  const next = () => {
    if (!application || !sessionId) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Inbox Runtime is not bound');
    let page:ReturnType<RuntimeApplication['nextMailReadSession']>;
    submittingPage=true;
    try{page=application.nextMailReadSession(sessionId);}finally{submittingPage=false;}
    if (page.state === 'submitted') {
      taskId = page.page.task.taskId; status = 'reading';
      try {options.onReadTask?.({taskId,sessionId});}
      catch {
        application.stopMailReadSession(sessionId);sessionId=undefined;
        analysisSessionId=undefined;controller.abort();void provider.dispose();
        status='disabled';throw new ProtocolError('UNAUTHORIZED','Inbox source origin could not be bound');
      }
    }
    else if (page.state === 'done') {
      if(batch)options.batchAuthorization?.finish(batch);
      application.stopMailReadSession(sessionId); sessionId = undefined; taskId = undefined; status = 'complete';
    } else status = page.state;
  };
  const cancel = async () => {
    controller.abort();
    if(batch)options.batchAuthorization?.finish(batch);
    batch=undefined;firstPageScope=undefined;pageScope=undefined;
    analysisSessionId = undefined;
    if (application && sessionId) application.stopMailReadSession(sessionId);
    sessionId = undefined;
    status = reading > 0 ? 'stop_unconfirmed' : 'disabled';
    await provider.dispose();
    return snapshot();
  };
  const analysisContext = (context: InboxTriageContext) => {
    if (!context || !(context.signal instanceof AbortSignal) || !Number.isFinite(Date.parse(context.deadline))) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Invalid inbox analysis context');
    }
    if (!allowed() || controller.signal.aborted || !analysisSessionId || Date.now() >= Date.parse(deadline)) {
      throw new ProtocolError('UNAUTHORIZED', 'Local inbox analysis session is no longer valid');
    }
    return {deadline: new Date(Math.min(Date.parse(context.deadline), Date.parse(deadline))).toISOString(),
      signal: AbortSignal.any([context.signal, controller.signal])};
  };
  return Object.freeze({
    tools: Object.freeze([...tools]), snapshot,
    prepareAuthorization(scope:MailBatchPageScope) {
      if(!options.batchAuthorization||scope.toolName!=='mail.inbox')return;
      if(!batch||!sessionId||batch.batchId!==sessionId||scope.deadline!==batch.deadline||!batchCurrent())
        throw new ProtocolError('UNAUTHORIZED','Mail page is outside the original manual batch');
      if(scope.taskId!==taskId){
        if(!submittingPage||application?.runtime.loadCheckpoint(scope.taskId,MAIL_READ_SESSION_CHECKPOINT)!==sessionId)
          throw new ProtocolError('UNAUTHORIZED','Mail page has no original session membership');
        taskId=scope.taskId;
      }
      options.batchAuthorization.preparePage(scope,batch,firstPageScope);
    },
    /** Local-only projections. Root must separately authorize every cloud send. */
    pendingAnalyses(context: InboxTriageContext) {
      const current = analysisContext(context);
      return (pipeline?.pendingAnalyses(current) ?? []).map(item => ({...item, sessionId: analysisSessionId!}));
    },
    /** Synchronous current-head read, including accepted items, for beforeCompetitionSend. */
    readAnalysis(workKey: string, context: InboxTriageContext) {
      const current = analysisContext(context);
      const item = pipeline?.readAnalysis(workKey, current);
      return item ? {...item, sessionId: analysisSessionId!} : undefined;
    },
    confirmAnalysisAccepted(input: InboxAnalysisAcceptance & {readonly sessionId: string}, context: InboxTriageContext) {
      const current = analysisContext(context);
      if (!input || input.sessionId !== analysisSessionId || !pipeline) {
        throw new ProtocolError('UNAUTHORIZED', 'Inbox analysis belongs to a different session');
      }
      return {...pipeline.confirmAnalysisAccepted(input, current), sessionId: analysisSessionId!};
    },
    bindApplication(value: RuntimeApplication) {
      if (application && application !== value) throw Error('Inbox host is already bound');
      application = value;
    },
    startBatch({expiresAt}: {expiresAt: string}) {
      if (!application || !pipeline) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Local inbox classification is unavailable');
      if (!canRequest()) throw new ProtocolError('UNAUTHORIZED', 'Inbox configuration or question route is unavailable');
      if (sessionId || reading > 0) throw new ProtocolError('REVISION_CONFLICT', 'Inbox batch is already active');
      const scope = {accountRef: options.accountRef, folder: 'INBOX', deadline: expiresAt, signal: new AbortController().signal};
      if (expiredCursor !== undefined) pipeline.resetExpiredCursor({...scope, expectedCursor: expiredCursor});
      const savedCursor = pipeline.readCursor(scope);
      const session = application.startMailReadSession({accountRef: options.accountRef, folder: 'INBOX', expiresAt,
        ...(savedCursor ? {cursor: savedCursor} : {})});
      sessionId = session.sessionId; analysisSessionId = session.sessionId;
      deadline = expiresAt; cursor = savedCursor; expiredCursor = undefined; controller = new AbortController();
      firstPageScope=undefined;pageScope=undefined;
      batch={batchId:session.sessionId,generation:randomUUID(),accountRef:options.accountRef,folder:'INBOX',limit:session.limit,
        queryDigest:createHash('sha256').update(JSON.stringify({folder:'INBOX',startCursor:savedCursor??null})).digest('hex'),deadline:session.expiresAt};
      next();
      return snapshot();
    },
    async refresh() {
      if (!application || !sessionId || !taskId || !pipeline || refreshing || status === 'classification_unavailable') return snapshot();
      if (!batchCurrent() || Date.now() >= Date.parse(deadline)) return cancel();
      let read;
      try { read = application.readHostToolTask(taskId); }
      catch (error) { await cancel(); throw error; }
      if (!read.confirmed) {
        status = read.task.state;
        if (['failed', 'cancelled'].includes(status)) {
          const stale = read.task.state === 'failed' && read.task.error?.code === 'CURSOR_EXPIRED' && cursor;
          await cancel();
          if (stale) {expiredCursor = cursor; status = 'resync_required';}
          return snapshot();
        }
        return snapshot();
      }
      const page = read.confirmed.result as {account: string; folder: string; items: ProtocolContracts['connectorItem'][];
        nextCursor: string; hasMore: boolean};
      if (!page || page.account !== options.accountRef || page.folder !== 'INBOX') {
        await cancel();
        throw new ProtocolError('EXTERNAL_FAILURE', 'Confirmed inbox scope mismatch');
      }
      refreshing = true; status = 'classifying';
      try {
        if(options.batchAuthorization){if(!batch||!pageScope)throw new ProtocolError('UNAUTHORIZED','Confirmed page authorization is absent');
          options.batchAuthorization.assertConsumed(pageScope,batch);}
        const result = await pipeline.processPage({accountRef: options.accountRef, folder: 'INBOX',
          ...(cursor ? {cursor} : {}), nextCursor: page.nextCursor, hasMore: page.hasMore, items: page.items,
          deadline, signal: controller.signal});
        if (!result.complete) {status = 'classification_unavailable'; return snapshot();}
        cursor = page.nextCursor;
        if (allowed() && !controller.signal.aborted) next();
      } catch {status = controller.signal.aborted ? 'disabled' : 'classification_unavailable';}
      finally {refreshing = false;}
      return snapshot();
    },
    retryClassification() {if (status === 'classification_unavailable' && allowed()) status = 'reading'; return snapshot();},
    cancel,
    async close() {closed = true; await cancel(); disposeRegistration();},
  });
}
