import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {createKnowledgeFeedReceiptFromConfirmedExecution} from '@personal-agent/runtime/application';
import {proactiveWorkflowDigest as digest} from '@personal-agent/agentarts';
import {assertFeedSourceReceiptMatches} from '@personal-agent/feeds';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
const terminal=new Set(['succeeded','failed','cancelled','cancelling']);
const PREPARED_SOURCE='desktop-proactive-feed-origin-v1';

/** Main-only adapter from original confirmed read Evidence to the original durable proactive sink.
 * It does not fetch a source, grant tracking, advance a provider cursor or create a connector registry.
 */
export function createDesktopProactiveConfirmedSourceRouter({getApplication,getWorkflow,namespace,
  resolveUserConversation,readSourceBinding,readTrackingGrant,now=Date.now}) {
  if(!namespace||[getApplication,getWorkflow,resolveUserConversation,readSourceBinding,readTrackingGrant].some(value=>typeof value!=='function'))
    throw Error('Original Runtime, public feed bindings and native tracking grant readers required');
  const stores=new WeakMap(),tails=new Map();
  function trackingTask(application,binding) {
    const saved=application.runtime.loadCheckpoint(binding.sourceTaskId,'subtask-parent');
    if(saved?.parentTaskId){
      application.readSubagentConversation({parentTaskId:saved.parentTaskId,taskId:binding.sourceTaskId});
      return saved.parentTaskId;
    }
    return binding.sourceTaskId;
  }
  function active(application,binding,input,context,selected) {
    if(context.signal?.aborted)fail('CANCELLED','Original source delivery cancelled');
    if(!Number.isFinite(Date.parse(context.deadline))||now()>=Date.parse(context.deadline)
      ||now()>=Date.parse(binding.taskDeadline))fail('TIMEOUT','Original source delivery expired');
    const original=application.runtime.getTask(binding.taskId);
    if(original.cancelRequested||terminal.has(original.state))fail('CANCELLED','Original responsibility is no longer active');
    const trackingTaskId=input.trackingTaskId??trackingTask(application,binding);
    if(trackingTaskId!==trackingTask(application,binding))fail('SCOPE_DENIED','Tracking grant is not bound to the original instruction');
    for(const taskId of [binding.sourceTaskId,input.taskId,trackingTaskId])if(
      application.runtime.loadCheckpoint(taskId,'private-copy-erasure')!==undefined
      ||application.runtime.loadCheckpoint(taskId,'private-copy-erasure-binding')!==undefined)
      fail('SCOPE_DENIED','Original source instruction or read was withheld');
    const conversation=resolveUserConversation(binding.sourceTaskId);
    if(!conversation||resolveUserConversation(trackingTaskId)!==conversation)
      fail('SCOPE_DENIED','Tracking instruction belongs to another user conversation');
    const readTask=application.runtime.getTask(input.taskId);
    if(readTask.conversationId===`host-tool:${namespace}`) {
      const origin=application.runtime.loadCheckpoint(input.taskId,PREPARED_SOURCE);
      const intent=application.runtime.loadCheckpoint(input.taskId,'host-tool-intent');
      if(!origin||origin.version!==1||origin.namespace!==namespace||origin.taskId!==input.taskId
        ||origin.trackingTaskId!==trackingTaskId||origin.sourceId!==input.arguments.subscriptionId
        ||origin.argumentsDigest!==toolArgumentsDigest(input.arguments)||origin.toolVersion!==input.toolVersion
        ||origin.commandId!==intent?.commandId||intent?.namespace!==namespace||intent?.toolName!=='feeds.collect'
        ||intent?.toolVersion!==input.toolVersion||intent?.argumentsDigest!==origin.argumentsDigest
        ||!isDeepStrictEqual(intent?.arguments,input.arguments)||input.runId!==`host-tool-${input.taskId}`
        ||input.scopeRef!==input.runId)fail('SCOPE_DENIED','Host source read has no original prepared tracking binding');
    } else if(resolveUserConversation(input.taskId)!==conversation)
      fail('SCOPE_DENIED','Source read belongs to another user conversation');
    const source=readSourceBinding(input.arguments.subscriptionId);
    const grant=readTrackingGrant({namespace,sourceId:input.arguments.subscriptionId,taskId:trackingTaskId});
    if(!source||source.namespace!==namespace||source.sourceId!==input.arguments.subscriptionId||source.available!==true
      ||source.sensitivity!=='public'||source.containsCredentials!==false||!source.configurationRef
      ||grant?.state!=='granted'||grant.publicLowRiskTracking!==true||grant.namespace!==namespace
      ||typeof grant.id!=='string'||!grant.id||!Number.isSafeInteger(grant.revision)||grant.revision<1
      ||grant.sourceId!==source.sourceId||grant.configurationRef!==source.configurationRef
      ||grant.taskId!==trackingTaskId||grant.conversationId!==application.runtime.getTask(trackingTaskId).conversationId
      ||grant.purposeDigest!==digest(application.runtime.getTask(trackingTaskId).goal)||!(Date.parse(grant.expiresAt)>now()))
      fail('UNSUPPORTED_CAPABILITY','Current public source tracking grant is unavailable');
    const selection={sourceId:source.sourceId,configurationRef:source.configurationRef,trackingTaskId,
      grantId:grant.id,grantRevision:grant.revision,grantExpiresAt:grant.expiresAt};
    if(selected&&!isDeepStrictEqual(selection,selected))fail('REVISION_CONFLICT','Original public source grant changed during delivery');
    return selection;
  }
  function stateStore(application) {
    let store=stores.get(application.runtime);
    if(!store){store=createRuntimeAtomicStatePort(application.runtime,'desktop-proactive-source-router');stores.set(application.runtime,store);}
    return store;
  }
  // Only exact pending source keys, in the original Runtime host state; no source/config registry.
  function recoveryIndex(store,workflowTaskId,sourceId,add) {
    const key='pending:'+digest(workflowTaskId);
    for(let attempt=0;attempt<8;attempt++) {
      const old=store.read(key),value=structuredClone(old?.value??{version:1,sources:[]});
      if(value.version!==1||!Array.isArray(value.sources))fail('REVISION_CONFLICT','Original source recovery index changed');
      const sources=new Set(value.sources);if(add)sources.add(sourceId);else sources.delete(sourceId);
      if(sources.size>64)fail('REVISION_CONFLICT','Bounded pending source delivery requires reconciliation');
      value.sources=[...sources];if(store.compareAndSet(key,old?.revision,value))return;
    }
    fail('REVISION_CONFLICT','Original pending source index changed concurrently');
  }
  function originalPendingInput(workflowTaskId,pending,application) {
    const origin=pending.origin,intent=application.runtime.loadCheckpoint(origin.taskId,'host-tool-intent');
    const args=intent?.arguments??origin.arguments,toolVersion=intent?.toolVersion??origin.toolVersion;
    if(!args||!toolVersion||origin.receiptId!==pending.receiptId)
      fail('RESULT_UNKNOWN','Original pending source invocation cannot be read back');
    return {workflowTaskId,taskId:origin.taskId,runId:origin.runId,scopeRef:origin.scopeRef,
      toolVersion,arguments:structuredClone(args),trackingTaskId:pending.selection.trackingTaskId};
  }
  function confirmed(application,input,selection) {
    const receipt=createKnowledgeFeedReceiptFromConfirmedExecution({namespace,sourceId:selection.sourceId,
      taskId:input.taskId,runId:input.runId,toolVersion:input.toolVersion,query:input.arguments,scopeRef:input.scopeRef,runtime:application.runtime});
    if(!receipt)return {reason:'original_complete_confirmed_feed_receipt'};
    const raw=application.runtime.loadCheckpoint(input.taskId,'tool-result-'+input.runId)?.result;
    if(!raw?.sourceReceipt||raw.sourceReceipt.publicFetch!==true||raw.sourceReceipt.transport?.nativeFetch!==true
      ||raw.sourceReceipt.transport?.credentialFree!==true)return {reason:'original_public_transport_receipt'};
    assertFeedSourceReceiptMatches(raw.sourceReceipt,raw,{subscriptionId:selection.sourceId,configBinding:selection.configurationRef});
    return {receipt,raw};
  }
  function enqueue(input,context,recoveryOnly=false) {
    const key=digest([input.workflowTaskId,input.arguments.subscriptionId]),prior=tails.get(key)??Promise.resolve();
    const result=prior.catch(()=>{}).then(()=>route(structuredClone(input),context,recoveryOnly));
    const tracked=result.finally(()=>{if(tails.get(key)===tracked)tails.delete(key);});tails.set(key,tracked);return tracked;
  }
  async function route(input,context,recoveryOnly=false) {
    const application=getApplication(),workflow=getWorkflow();
    if(!application?.runtime||!workflow||workflow.snapshot().state!=='configured_not_verified')
      return {state:'unavailable',reason:'original_proactive_host'};
    const session=await workflow.acquireMaintenance(input.workflowTaskId,context),{binding,host}=session;
    const selected=active(application,binding,input,context);
    const proof=confirmed(application,input,selected);
    if(!proof.receipt)return {state:'unavailable',reason:proof.reason};
    const {receipt,raw}=proof,store=stateStore(application);
    const key=digest([binding.taskId,selected.sourceId]);
    let saved=store.read(key),state=saved?.value??{version:1,sourceId:selected.sourceId,configurationRef:selected.configurationRef,
      heads:{},deliveries:{},deliveryOrder:[]};
    if(state.version!==1||state.sourceId!==selected.sourceId||state.configurationRef!==selected.configurationRef)
      fail('REVISION_CONFLICT','Original source configuration requires reconciliation');
    state=structuredClone(state);
    const save=()=>{if(!store.compareAndSet(key,saved?.revision,state))fail('REVISION_CONFLICT','Original source delivery changed');saved=store.read(key);};
    async function finish() {
      const pending=state.pending;
      const originalInput=originalPendingInput(binding.taskId,pending,application);
      active(application,binding,originalInput,context,pending.selection);
      const originalProof=confirmed(application,originalInput,pending.selection);
      if(originalProof.receipt?.receiptId!==pending.receiptId)fail('RESULT_UNKNOWN','Original pending source Evidence changed');
      const acknowledgement=await host.eventSink.persist(structuredClone(pending.batch),context);
      if(acknowledgement?.durable!==true||acknowledgement.batchId!==pending.batch.batchId)
        fail('RESULT_UNKNOWN','Original source batch durable acknowledgement is unavailable');
      active(application,binding,originalInput,context,pending.selection);
      Object.assign(state.heads,pending.heads);
      if(Object.keys(state.heads).length>1000)fail('REVISION_CONFLICT','Bounded source history requires reconciliation');
      state.lastObservedAt=pending.observedAt;state.deliveries[pending.receiptId]=pending.batch.batchId;
      state.deliveryOrigins??={};
      state.deliveryOrigins[pending.receiptId]={origin:structuredClone(pending.origin),selection:structuredClone(pending.selection)};
      state.deliveryOrder.push(pending.receiptId);
      if(state.deliveryOrder.length>64){const removed=state.deliveryOrder.shift();delete state.deliveries[removed];delete state.deliveryOrigins[removed];}
      delete state.pending;save();recoveryIndex(store,binding.taskId,selected.sourceId,false);
    }
    if(state.pending)await finish(); // Recover only the exact original batch; never collect again.
    if(recoveryOnly)return {state:'recovered',receiptId:receipt.receiptId};
    if(state.deliveries[receipt.receiptId])return {state:'already_persisted',batchId:state.deliveries[receipt.receiptId]};
    if(state.lastObservedAt&&Date.parse(receipt.observedAt)<Date.parse(state.lastObservedAt))
      fail('REVISION_CONFLICT','An older source observation cannot replace the current source head');
    const events=[],heads={};
    for(let index=0;index<raw.items.length;index++) {
      const item=raw.items[index].record,citation=raw.sourceReceipt.citations[index],itemKey=digest(item.dedupeKey);
      if(state.heads[itemKey]?.revision===citation.contentSha256)continue;
      const eventId='confirmed-feed-'+digest([selected.sourceId,item.dedupeKey,citation.contentSha256]);
      events.push({eventId,kind:'source.changed',sourceId:selected.sourceId,connectorId:'feeds',accountRef:selected.sourceId,
        sourceKind:'feeds',sourceRevision:citation.contentSha256,sourceRevisionKind:'item_projection_digest',item:structuredClone(item),
        cursor:raw.nextCursor,observedAt:receipt.observedAt});
      heads[itemKey]={revision:citation.contentSha256,eventId};
    }
    if(Object.keys({...state.heads,...heads}).length>1000)fail('REVISION_CONFLICT','Bounded source history requires reconciliation');
    const batch={batchId:'confirmed-feed-batch-'+digest([binding.taskId,receipt.receiptId,selected.configurationRef]),
      sourceId:selected.sourceId,cursor:raw.nextCursor,hasMore:raw.hasMore,events,observedAt:receipt.observedAt};
    state.pending={batch,heads,selection:selected,receiptId:receipt.receiptId,observedAt:receipt.observedAt,
      origin:{taskId:input.taskId,runId:input.runId,scopeRef:input.scopeRef,receiptId:receipt.receiptId,
        arguments:structuredClone(input.arguments),toolVersion:input.toolVersion}};
    recoveryIndex(store,binding.taskId,selected.sourceId,true);save();
    await finish();return {state:'persisted',batchId:batch.batchId,eventCount:events.length};
  }
  return {
  /** Pure native readback of the original durable routing receipt, not a new source capability.
   * Older entries without an invocation identity remain unavailable rather than inferred from text.
   */
  readHarnessSourceOrigin(workflowTaskId,event) {
    const application=getApplication();if(!application?.runtime||event?.entry!=='connector')return undefined;
    const state=stateStore(application).read(digest([workflowTaskId,event.sourceId]))?.value;
    if(state?.version!==1||state.sourceId!==event.sourceId)return undefined;
    for(const [receiptId,batchId]of Object.entries(state.deliveries??{})) {
      const original=state.deliveryOrigins?.[receiptId];
      if(event.payloadRef!=='runtime:proactive-batch:'+batchId+':'+event.eventId||!original
        ||original.origin.receiptId!==receiptId||original.selection.sourceId!==event.sourceId)continue;
      return structuredClone({receiptId,batchId,...original});
    }
    return undefined;
  },
  readHarnessSourceAuthorization(workflowTaskId,event) {
    const application=getApplication(),original=this.readHarnessSourceOrigin(workflowTaskId,event);
    if(!application?.runtime||!original)return undefined;
    try {
      const binding=application.runtime.loadCheckpoint(workflowTaskId,'desktop-proactive-workflow-v1');
      if(binding?.version!==1||binding.taskId!==workflowTaskId)return undefined;
      const input=originalPendingInput(workflowTaskId,original,application);
      active(application,binding,input,{deadline:binding.taskDeadline,signal:new AbortController().signal},original.selection);
      const proof=confirmed(application,input,original.selection);
      if(proof.receipt?.receiptId!==original.receiptId)return undefined;
      const item=proof.raw.items.find((item,index)=>item.record.dedupeKey===event.entityRef
        &&digest(item.record)===event.payloadDigest&&proof.raw.sourceReceipt.citations[index]?.contentSha256===event.sourceVersion);
      if(!item)return undefined;
      return {expiresAt:original.selection.grantExpiresAt,
        fence:digest({original,source:readSourceBinding(event.sourceId),receiptId:proof.receipt.receiptId,
          eventDigest:digest(event)})};
    }catch{return undefined;}
  },
  /** Bind only the original still-created host read before finalizeHostToolTask executes it.
   * Main calls this solely from its native-interest task admission, never background collection. */
  bindPreparedFeedRead(input) {
    const application=getApplication(),runtime=application?.runtime;
    if(!runtime||!input?.taskId||!input.trackingTaskId||!input.commandId||!input.toolVersion
      ||typeof input.arguments?.subscriptionId!=='string')fail('INVALID_ARGUMENT','Original prepared source binding required');
    const task=runtime.getTask(input.taskId),preparation=runtime.loadCheckpoint(input.taskId,'host-tool-preparation');
    if(task.conversationId!==`host-tool:${namespace}`||preparation?.namespace!==namespace
      ||preparation?.commandId!==input.commandId||preparation?.toolName!=='feeds.collect'
      ||preparation?.toolVersion!==input.toolVersion||!(Date.parse(preparation.deadline)>now())
      ||runtime.loadCheckpoint(input.taskId,'host-tool-intent')!==undefined
      ||!resolveUserConversation(input.trackingTaskId))fail('SCOPE_DENIED','Original source read is not preparable');
    const value={version:1,namespace,taskId:input.taskId,trackingTaskId:input.trackingTaskId,
      commandId:input.commandId,sourceId:input.arguments.subscriptionId,toolVersion:input.toolVersion,
      argumentsDigest:toolArgumentsDigest(input.arguments)};
    if(!runtime.saveCheckpointOnceForCreatedTask(task.taskId,PREPARED_SOURCE,value,input.expectedTaskRevision)
      &&!isDeepStrictEqual(runtime.loadCheckpoint(task.taskId,PREPARED_SOURCE),value))
      fail('REVISION_CONFLICT','Prepared source tracking binding changed');
  },
  matchesTrackingTask(sourceTaskId,trackingTaskId) {
    try{return trackingTask(getApplication(),{sourceTaskId})===trackingTaskId;}catch{return false;}
  },
  routeConfirmedFeed(input,context) {
    if(!input||!input.workflowTaskId||!input.taskId||!input.runId||!input.toolVersion||!input.scopeRef
      ||typeof input.arguments?.subscriptionId!=='string')return Promise.resolve({state:'unavailable',reason:'original_feed_invocation'});
    return enqueue(input,context);
  },
  async recoverPending(workflowTaskId,context) {
    const application=getApplication();if(!application?.runtime)return {state:'unavailable',reason:'original_runtime'};
    const store=stateStore(application),index=store.read('pending:'+digest(workflowTaskId))?.value;
    if(!index)return {state:'recovered',deliveries:[]};
    if(index.version!==1||!Array.isArray(index.sources)||index.sources.length>64)
      return {state:'unavailable',reason:'original_pending_source_index'};
    const deliveries=[];
    for(const sourceId of index.sources) {
      try {
        const pending=store.read(digest([workflowTaskId,sourceId]))?.value?.pending;
        if(!pending){recoveryIndex(store,workflowTaskId,sourceId,false);continue;}
        const input=originalPendingInput(workflowTaskId,pending,application);
        if(input.arguments?.subscriptionId!==sourceId)fail('REVISION_CONFLICT','Original pending source identity changed');
        deliveries.push({sourceId,...await enqueue(input,context,true)});
      }catch(error){deliveries.push({sourceId,state:'unavailable',code:
        ['CANCELLED','TIMEOUT','SCOPE_DENIED','REVISION_CONFLICT','RESULT_UNKNOWN','UNSUPPORTED_CAPABILITY'].includes(error?.code)?error.code:'HOST_UNAVAILABLE'});}
    }
    return {state:deliveries.some(item=>item.state==='unavailable')?'unavailable':'recovered',deliveries};
  }};
}
