import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {MemoryReadContext} from '@personal-agent/memory';
import type {SqliteMemoryHost} from '@personal-agent/memory/sqlite';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';
import {readWorkflowBusinessToolSource,type WorkflowBusinessToolSourceReference} from './workflow-business-tool-bridge.js';
import {readPlanExecutionIntent} from './plan-execution-source.js';
import {createMemoryProjectionApplication,createPendingImpactApplication} from './memory.js';

export interface OriginalMailSourceScope extends MemoryReadContext {parentTaskId:string;sessionId:string;
  control?:Readonly<{boundUserTaskId:string;conversationId:string;commandId:string;sourceDigest:string}>}
type SourceConfirmationScope=MemoryReadContext&{assertCurrent:()=>void;control?:OriginalMailSourceScope['control']};
type Inbox={account:string;folder:string;nextCursor:string;hasMore:false;items:Record<string,unknown>[]};
const fail=(code:string,message:string):never=>{throw new ProtocolError(code,message);};
const same=(a:{id:string;revision:number},b:{id:string;revision:number})=>a.id===b.id&&a.revision===b.revision;
const stable=(items:Record<string,unknown>[])=>items.map(({fetchedAt,...item})=>item)
  .sort((a,b)=>String(a.dedupeKey).localeCompare(String(b.dedupeKey)));
const snapshot=(value:unknown):Inbox=>{
  const inbox=value as Inbox;
  if(!inbox||inbox.hasMore!==false||!Array.isArray(inbox.items)||inbox.items.length>100
    ||!inbox.account||!inbox.folder||typeof inbox.nextCursor!=='string'||!/^\d+:/u.test(inbox.nextCursor)
    ||inbox.items.some(item=>!item||typeof item.dedupeKey!=='string'||item.source!=='mail'||item.accountRef!==inbox.account))
    fail('UNAUTHORIZED','Original complete mailbox snapshot is unavailable');
  return {account:inbox.account,folder:inbox.folder,nextCursor:inbox.nextCursor,hasMore:false,items:stable(inbox.items)};
};
function active(app:RuntimeApplication,scope:OriginalMailSourceScope) {
  if(app.profile!=='huawei_ict_agentarts'||scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))
    fail('UNAUTHORIZED','Original Competition mail source scope expired');
  const task=app.runtime.getTask(scope.parentTaskId);
  if(task.cancelRequested||app.runtime.loadCheckpoint(task.taskId,'private-copy-erasure')!==undefined)
    fail('UNAUTHORIZED','Original mailbox source was revoked');
}
/** Host-only private source. No text or hashed identity is implicitly public or authorized for export. */
export function readOriginalF08MailSource(application:RuntimeApplication,scope:OriginalMailSourceScope) {
  active(application,scope);
  const bound=application.readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId:'F08',sessionId:scope.sessionId,signal:scope.signal});
  const source=bound?.confirmedOperations.find(item=>item.nodeId==='F08_N01'&&item.toolName==='mail.inbox');
  const input=bound?.input as {businessBindingId?:unknown;inbox?:unknown}|undefined;
  if(!bound||bound.deadline!==scope.deadline||!source||typeof input?.businessBindingId!=='string')
    return fail('UNAUTHORIZED','Original F08 mailbox receipt is unavailable');
  const host=application.runtime.loadCheckpoint(source.localTaskId,'host-tool-intent') as {arguments?:unknown}|undefined;
  if(!isDeepStrictEqual(host?.arguments,input.inbox))fail('UNAUTHORIZED','Original mailbox arguments changed');
  const inbox=snapshot(source.result),configurationRef=toolArgumentsDigest(input.businessBindingId);
  const sourceRef='mail-snapshot:'+toolArgumentsDigest({configurationRef,inbox});
  return {sourceRef,configurationRef,inbox,sourceTaskId:source.localTaskId,operationId:source.operationId,
    graphTaskId:scope.parentTaskId,sessionId:scope.sessionId};
}

/** Verify actual original reads and effects before preserving a change. Never accepts a model-authored change reason. */
export function recordOriginalF08MailChange(application:RuntimeApplication,scope:OriginalMailSourceScope,reference:WorkflowBusinessToolSourceReference) {
  const baseline=readOriginalF08MailSource(application,scope),proof=readWorkflowBusinessToolSource(application,scope,reference,'mail.inbox');
  const actions:Record<string,string>={'f08.mail.plan-check':'F08_N10','f08.mail.send-check':'F08_N07',
    'f08.mail.receipt-check':'F08_N07','f08.mail.change-check':'F08_N13'};
  if(proof.graph.workflowId!=='F08'||actions[proof.actionKey]!==proof.graph.nodeId)
    fail('UNAUTHORIZED','Mailbox change does not belong to an original F08 source check');
  const current=snapshot(proof.receipt.result),effects=[];
  let expected=baseline.inbox.items;
  for(const kind of ['archive','send'] as const){
    const saved=application.runtime.loadCheckpoint(scope.parentTaskId,'f08:original-child:'+kind+':'+scope.sessionId) as WorkflowBusinessToolSourceReference|undefined;
    if(!saved)continue;
    const effect=readWorkflowBusinessToolSource(application,scope,saved,'mail.'+kind),result=effect.receipt.result as {state?:string};
    if(effect.graph.workflowId!=='F08'||effect.actionKey!=='f08.mail.'+kind||effect.graph.nodeId!==(kind==='archive'?'F08_N03':'F08_N07'))
      fail('UNAUTHORIZED','Original mailbox effect chain changed');
    effects.push({taskId:effect.receipt.taskId,runId:effect.receipt.runId,toolName:effect.receipt.toolName,
      result:effect.receipt.result,evidenceRefs:effect.receipt.evidenceRefs});
    if(kind==='archive'&&result.state==='confirmed')expected=expected.filter(item=>item.externalId!==effect.receipt.arguments.folder+':'+effect.receipt.arguments.uid);
  }
  if(current.account!==baseline.inbox.account||current.folder!==baseline.inbox.folder)
    fail('UNAUTHORIZED','A different mailbox cannot invalidate the original source');
  if(current.nextCursor.split(':')[0]===baseline.inbox.nextCursor.split(':')[0]&&isDeepStrictEqual(current.items,expected))return;
  const change={version:1 as const,...baseline,current,readTaskId:proof.receipt.taskId,readRunId:proof.receipt.runId,
    actionKey:proof.actionKey,observedAt:proof.record.finishedAt!,effects,planSource:proof.planSource??null};
  const key='f08:mail-source-change:'+proof.receipt.runId;
  if(!application.runtime.saveCheckpointOnce(scope.parentTaskId,key,change)
    &&!isDeepStrictEqual(application.runtime.loadCheckpoint(scope.parentTaskId,key),change))fail('REVISION_CONFLICT','Original mailbox change evidence changed');
  return structuredClone(change);
}

export interface CompetitionMailSourceChangesOptions {
  application:RuntimeApplication;memory:SqliteMemoryHost;memoryNamespace:string;graphNamespace:string;consumerKey:string;
  /** The real host configuration/permission guard; synchronous and checked after asynchronous confirmation/projection. */
  assertCurrent:()=>void;
}
/** Fixed private projection; it does not broaden the existing public Fact host or select a Plan. */
export function createCompetitionMailSourceChanges(options:CompetitionMailSourceChangesOptions) {
  const {application,memory,memoryNamespace,graphNamespace,consumerKey,assertCurrent}=options;
  if(application.profile!=='huawei_ict_agentarts'||![memoryNamespace,graphNamespace,consumerKey].every(value=>typeof value==='string'&&value.trim())
    ||typeof assertCurrent!=='function')fail('INVALID_ARGUMENT','Invalid Competition private mail source configuration');
  memory.provision(memoryNamespace);
  const query=memory.bind(memoryNamespace,{allowedSensitivities:['private']}),projection=application.runtime.provisionFactProjectionStore(graphNamespace);
  const project=createMemoryProjectionApplication({consumerKey,memoryNamespace,memory:query,projection,
    feed:memory.bindFeed(memoryNamespace,{consumerId:consumerKey,allowedSensitivities:['private']}),
    confirmation:{confirm:request=>memory.confirmFeedBatch(memoryNamespace,consumerKey,request),
      readBatch:request=>memory.readFeedDelivery(memoryNamespace,consumerKey,request)}});
  const impacts=createPendingImpactApplication({coordination:application.runtime.bindCoordinationStore(graphNamespace),projection,
    scope:{consumerKey,memoryNamespace}});
  const check=(scope:OriginalMailSourceScope)=>{active(application,scope);const result:unknown=assertCurrent();
    if(result!==undefined){void Promise.resolve(result).catch(()=>{});fail('UNAUTHORIZED','Mail source guard must be synchronous');}};
  const erasureContext=(scope:MemoryReadContext)=>{
    if(scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))
      fail('UNAUTHORIZED','Private mail Fact erasure expired');};
  return Object.freeze({
    readSource(scope:OriginalMailSourceScope){check(scope);return readOriginalF08MailSource(application,scope);},
    /** Existing explicit private Fact creation, never a model approval or inferred summary. */
    async rememberSource(scope:OriginalMailSourceScope,input:{factId:string;operationId:string;summary:string;validFrom:string;validUntil:string},
      confirm:(request:Readonly<{source:ReturnType<typeof readOriginalF08MailSource>;input:typeof input}>,scope:SourceConfirmationScope)=>Promise<boolean>){
      check(scope);const source=readOriginalF08MailSource(application,scope),request=structuredClone({source,input});
      const key='f08:mail-fact-confirmation:'+toolArgumentsDigest(input.operationId);
      const requestDigest=toolArgumentsDigest(request);
      const existing=application.runtime.loadCheckpoint(scope.parentTaskId,key) as {requestDigest:string;observedAt:string}|undefined;
      if(existing&&existing.requestDigest!==requestDigest)fail('REVISION_CONFLICT','Original private Fact confirmation changed');
      const assertSource=()=>{check(scope);if(!isDeepStrictEqual(readOriginalF08MailSource(application,scope),source))
        fail('REVISION_CONFLICT','Original mailbox source changed during confirmation');};
      if(!existing&&(typeof confirm!=='function'||await confirm(structuredClone(request),{deadline:scope.deadline,signal:scope.signal,
        ...(scope.control?{control:scope.control}:{}),assertCurrent:assertSource})!==true))return;
      check(scope);if(!isDeepStrictEqual(readOriginalF08MailSource(application,scope),source))fail('REVISION_CONFLICT','Mailbox changed during private Fact confirmation');
      const intent=existing??{requestDigest,observedAt:new Date().toISOString()};
      if(!existing&&!application.runtime.saveCheckpointOnce(scope.parentTaskId,key,intent))fail('REVISION_CONFLICT','Private Fact confirmation is already recorded');
      const result=memory.createUserFact(memoryNamespace,{...request.input,sourceRef:source.sourceRef,observedAt:intent.observedAt,
        deadline:scope.deadline,signal:scope.signal});
      const projected=await project.consume({limit:100,deadline:scope.deadline,signal:scope.signal});check(scope);
      return {fact:result.fact,projection:projected.projection};
    },
    async recordChange(scope:OriginalMailSourceScope,reference:WorkflowBusinessToolSourceReference){
      check(scope);const change=recordOriginalF08MailChange(application,scope,reference);if(!change)return;
      const requiresReview=(reason:string)=>({state:'requires_review' as const,reason,change});
      if(!change.planSource||change.planSource.graphNamespace!==graphNamespace)return requiresReview('original_plan_source_missing');
      const original=readPlanExecutionIntent(application.runtime,change.planSource.rootTaskId);
      if(!original||original.sourceDigest!==change.planSource.sourceDigest)return fail('UNAUTHORIZED','Original selected Plan changed');
      const candidates=original.source.facts.filter(item=>item.memoryNamespace===memoryNamespace).map(item=>({binding:item,
        head:memory.readUserFactHead(memoryNamespace,item.fact.id)})).filter(({head})=>head?.sourceRef===change.sourceRef);
      if(candidates.length!==1)return requiresReview('original_private_fact_mapping_missing');
      const {binding,head}=candidates[0]!;
      if(!head)return requiresReview('original_private_fact_mapping_missing');
      const saved=projection.readNodeFact(binding.node);
      if(!isDeepStrictEqual(saved,binding))fail('UNAUTHORIZED','Original Plan Fact projection changed');
      const previous=await query.getVersion({fact:binding.fact,deadline:scope.deadline,signal:scope.signal});check(scope);
      if(toolArgumentsDigest(previous)!==binding.contentHash||!isDeepStrictEqual(memory.readUserFactHead(memoryNamespace,head.ref.id),head))
        fail('REVISION_CONFLICT','Original private Fact changed during validation');
      // Persist the exact invalidation before Memory commits, allowing read-only recovery of its lost acknowledgement.
      const intentKey='f08:mail-fact-invalidation:'+change.readRunId,intent={changeDigest:toolArgumentsDigest(change),binding,observedAt:change.observedAt};
      if(!application.runtime.saveCheckpointOnce(scope.parentTaskId,intentKey,intent)
        &&!isDeepStrictEqual(application.runtime.loadCheckpoint(scope.parentTaskId,intentKey),intent))fail('REVISION_CONFLICT','Original Fact invalidation changed');
      if(same(head.ref,binding.fact)){
        if(toolArgumentsDigest(head)!==binding.contentHash||head.state!=='active'||head.confirmation!=='user_confirmed')
          fail('REVISION_CONFLICT','Original private Fact is no longer current');
        check(scope);memory.invalidateUserFactSource(memoryNamespace,{factId:head.ref.id,expectedRevision:head.ref.revision,
          sourceRef:head.sourceRef,observedAt:intent.observedAt,deadline:scope.deadline,signal:scope.signal});
      }else if(!isDeepStrictEqual(head,{...previous,ref:{id:binding.fact.id,revision:binding.fact.revision+1},corrects:binding.fact,
        state:'withdrawn',confirmation:'external_observation',observedAt:intent.observedAt}))
        fail('REVISION_CONFLICT','A different private Fact revision cannot be consumed');
      check(scope);await project.consume({limit:100,deadline:scope.deadline,signal:scope.signal});check(scope);
      impacts.processReceipts({at:change.observedAt,limit:100,deadline:scope.deadline,signal:scope.signal});check(scope);
      const fact=memory.readUserFactHead(memoryNamespace,head.ref.id)!;
      const receipt=projection.listImpactReceipts({consumerKey,memoryNamespace,afterGraphRevision:original.source.graphRevision,limit:100})
        .find(item=>item.projection.links.some(link=>same(link.fact,fact.ref)));
      if(!receipt?.completed)return {...requiresReview('original_fact_projection_pending'),fact};
      return {...requiresReview('competition_mail_review_required'),fact,projection:receipt.projection,impact:receipt.completed};
    },
    listSources(context:MemoryReadContext){erasureContext(context);return memory.listUserFactHeads(memoryNamespace,{at:new Date().toISOString(),limit:100,...context});},
    async withdrawSource(request:MemoryReadContext&{factId:string;expectedRevision:number;operationId:string},
      confirm:(fact:NonNullable<ReturnType<SqliteMemoryHost['readUserFactHead']>>,scope:SourceConfirmationScope)=>Promise<boolean>){
      erasureContext(request);const current=memory.readUserFactHead(memoryNamespace,request.factId);
      if(!current||current.ref.revision!==request.expectedRevision)fail('REVISION_CONFLICT','Private mail Fact head changed');
      if(typeof confirm!=='function'||await confirm(current!,{deadline:request.deadline,signal:request.signal,assertCurrent:()=>{
        erasureContext(request);if(!isDeepStrictEqual(memory.readUserFactHead(memoryNamespace,request.factId),current))fail('REVISION_CONFLICT','Original private Fact changed');
      }})!==true)return {state:'declined' as const};
      erasureContext(request);
      const result=memory.reviseUserFact(memoryNamespace,{...request,summary:current!.summary,sourceRef:current!.sourceRef,
        observedAt:new Date().toISOString(),validFrom:current!.validFrom,validUntil:current!.validUntil,sensitivity:'private',state:'withdrawn'});
      await project.consume({limit:100,deadline:request.deadline,signal:request.signal});
      return {state:'withdrawn' as const,fact:result.fact};
    },
    /** Independent native erasure intent. Original mailbox tool history is not a copy created from this Fact. */
    async eraseSource(request:MemoryReadContext&{factId:string;expectedRevision:number;operationId:string},
      confirm:(fact:NonNullable<ReturnType<SqliteMemoryHost['readUserFactHead']>>,scope:SourceConfirmationScope)=>Promise<boolean>){
      erasureContext(request);
      const markers=memory.listFactErasures(memoryNamespace,{limit:100,deadline:request.deadline,signal:request.signal}),existing=markers.find(item=>item.factId===request.factId);
      if(existing&&(existing.operationId!==request.operationId||existing.expectedRevision!==request.expectedRevision))
        fail('REVISION_CONFLICT','Original private mail erasure changed');
      if(!existing){const current=memory.readUserFactHead(memoryNamespace,request.factId);
        if(!current||current.ref.revision!==request.expectedRevision)fail('REVISION_CONFLICT','Private mail Fact head changed');
        if(typeof confirm!=='function'||await confirm(current!,{deadline:request.deadline,signal:request.signal,assertCurrent:()=>{
          erasureContext(request);if(!isDeepStrictEqual(memory.readUserFactHead(memoryNamespace,request.factId),current))fail('REVISION_CONFLICT','Original private Fact changed');
        }})!==true)return {state:'declined' as const};
        erasureContext(request);memory.beginFactErasure(memoryNamespace,request);
      }
      if(existing?.phase!=='completed'){
        const readDelivery=(consumer:string,batchToken:string,context:MemoryReadContext)=>{
          if(consumer!==consumerKey)fail('UNAUTHORIZED','Another private Fact consumer needs its own erasure proof');
          return memory.readFeedDelivery(memoryNamespace,consumer,{batchToken,...context});};
        const readVersion=(fact:{id:string;revision:number},context:MemoryReadContext)=>query.getVersion({fact,...context});
        const prior=projection.readErasureReceipt(memoryNamespace,request.factId);
        const expectedGraphRevision=prior?.expectedGraphRevision??(await projection.preflightErasure({memoryNamespace,factId:request.factId,
          deadline:request.deadline,signal:request.signal,readDelivery,readVersion})).graphRevision;
        await projection.commitErasure({memoryNamespace,factId:request.factId,operationId:request.operationId,expectedGraphRevision,
          deadline:request.deadline,signal:request.signal,readDelivery,readVersion});
        projection.checkpointErasureWal();
        memory.completeFactErasure(memoryNamespace,{...request,runtimeReceipt:projection.readErasureReceipt(memoryNamespace,request.factId)!});
      }
      memory.resumeCompletedErasureMaintenance(memoryNamespace);erasureContext(request);
      const history=await query.listHistory({factId:request.factId,limit:1,deadline:request.deadline,signal:request.signal});
      if(history.facts.length)fail('EXTERNAL_FAILURE','Private mail Fact erasure readback failed');
      return {state:'deleted' as const,coverage:'original_private_fact_and_bound_graph' as const};
    },
  });
}
