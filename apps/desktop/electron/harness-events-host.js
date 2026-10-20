import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeHarnessEvents,createRuntimeHarnessEventDelivery} from '@personal-agent/runtime/application';
import {proactiveWorkflowDigest} from '@personal-agent/agentarts';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha=value=>createHash('sha256').update(value).digest('hex');
const text=value=>typeof value==='string'&&value.trim().length>0;
const fail=code=>{throw new ProtocolError(code,'Original native harness event binding unavailable');};
const sync=value=>{if(value&&typeof value.then==='function'){void Promise.resolve(value).catch(()=>{});fail('UNAUTHORIZED');}return value;};
const terminal=new Set(['succeeded','failed','cancelled','cancelling']);

/** Main-only composition. Readers are existing native ports; no source fetch, grant, timer or task store. */
export function createDesktopHarnessEventsHost({getApplication,getWorkflow,getNotifications,
  resolveUserConversation,readConfigurationRef,readWorkflowConfiguration,readNativeConfiguration,readPersistedWorkflow,readPersistedDelivery,
  namespace,readSourceBinding,readTrackingGrant,readSourceOrigin,readSourceAuthorization,readDeveloperHarnessConfiguration,now=Date.now}) {
  if(!text(namespace)||[getApplication,getWorkflow,getNotifications,resolveUserConversation,readConfigurationRef,
    readWorkflowConfiguration,readNativeConfiguration,readPersistedWorkflow,readPersistedDelivery,
    readDeveloperHarnessConfiguration].some(fn=>typeof fn!=='function'))fail('INVALID_ARGUMENT');
  const managers=new Map();let closed=false,generation=0;
  const application=()=>{const value=sync(getApplication());if(closed||!value?.runtime)fail('UNSUPPORTED_CAPABILITY');return value;};
  function configuration(binding) {
    const ref=sync(readConfigurationRef()),configured=sync(readWorkflowConfiguration());
    if(!text(ref)||!configured?.adapter||configured.contractRef!==binding.contractRef)fail('UNSUPPORTED_CAPABILITY');
    const adapter=configured.adapter,config=adapter.config;
    const image=hash({contractRef:configured.contractRef,...(config?{gatewayUrl:config.gatewayUrl,runtimeName:config.runtimeName,
      websocketUrl:config.websocketUrl,deploymentVersion:config.deploymentVersion}:{endpoint:adapter.endpoint}),
      invokeMode:adapter.invokeMode??config?.invokeMode??'published',workflowGoalInput:adapter.workflowGoalInput??config?.workflowGoalInput});
    if(binding.imageBinding!==image)fail('REVISION_CONFLICT');
    return {ref,image};
  }
  function bindings() {
    const workflow=sync(getWorkflow());if(!workflow?.maintenancePage)fail('UNSUPPORTED_CAPABILITY');
    const result=[];let beforeSequence,snapshotSequence;
    for(let pageNumber=0;pageNumber<10;pageNumber++) {
      const page=sync(workflow.maintenancePage({limit:100,...(beforeSequence===undefined?{}:{beforeSequence}),
        ...(snapshotSequence===undefined?{}:{snapshotSequence})}));
      if(!page||!Array.isArray(page.items))fail('UNSUPPORTED_CAPABILITY');
      result.push(...page.items);snapshotSequence=page.snapshotSequence;beforeSequence=page.nextBeforeSequence;
      if(beforeSequence===undefined)return result;
    }
    return fail('UNSUPPORTED_CAPABILITY');
  }
  function current(binding) {
    const app=application(),runtime=app.runtime,config=configuration(binding);
    const item=bindings().find(item=>item.binding?.taskId===binding.taskId&&item.binding?.sessionId===binding.sessionId);
    if(!item||item.withheld||!isDeepStrictEqual(item.binding,binding))fail('REVISION_CONFLICT');
    const task=runtime.getTask(binding.taskId),source=runtime.getTask(binding.sourceTaskId);
    const conversation=sync(resolveUserConversation(binding.sourceTaskId));
    if(!text(conversation)||!text(source.goal)||source.cancelRequested||['failed','cancelled','cancelling'].includes(source.state)
      ||task.cancelRequested||terminal.has(task.state)||task.conversationId!==conversation
      ||sync(resolveUserConversation(binding.taskId))!==conversation
      ||!Number.isFinite(Date.parse(binding.taskDeadline))||now()>=Date.parse(binding.taskDeadline))fail('UNAUTHORIZED');
    for(const id of [binding.taskId,binding.sourceTaskId])for(const key of ['private-copy-erasure','private-copy-erasure-binding'])
      if(runtime.loadCheckpoint(id,key)!==undefined)fail('SCOPE_DENIED');
    const saved=sync(readPersistedWorkflow(runtime,binding.taskId,binding.sessionId));
    if(!saved?.session||saved.application?.state?.binding?.taskId!==binding.taskId
      ||saved.application.state.binding.sessionId!==binding.sessionId
      ||saved.application.state.binding.taskDeadline!==binding.taskDeadline
      ||saved.application.state.contractRef!==binding.contractRef||saved.application.state.conversationId!==task.conversationId)fail('UNSUPPORTED_CAPABILITY');
    return {app,runtime,config,source,conversation,saved};
  }
  function control(binding) {
    const {saved}=current(binding),notifications=sync(getNotifications());
    const native=sync(readNativeConfiguration());
    if(!native||!text(native.revision)||typeof native.enabled!=='boolean'
      ||typeof native.events?.enabled!=='boolean'||typeof native.events.quiet!=='boolean')fail('UNSUPPORTED_CAPABILITY');
    const snapshot=sync(notifications?.snapshot?.({kind:'global'})),policy=snapshot?.policy,status=snapshot?.status;
    if(snapshot?.available!==true||!policy||!Number.isSafeInteger(policy.revision)||policy.revision<0
      ||!Array.isArray(policy.constraints)||!status||!['pausedUntil','quietUntil'].every(key=>status[key]===null
        ||typeof status[key]==='string'&&Number.isFinite(Date.parse(status[key]))))fail('UNSUPPORTED_CAPABILITY');
    const paused=status.pausedUntil!==null&&Date.parse(status.pausedUntil)>now();
    const quiet=status.quietUntil!==null&&Date.parse(status.quietUntil)>now()
      ||policy.effective?.mode==='silent'&&(policy.effective.silentUntilUtc===null||Date.parse(policy.effective.silentUntilUtc)>now());
    const versions={revision:policy.revision,local:policy.local,effective:policy.effective,
      constraints:policy.constraints,pausedUntil:status.pausedUntil,quietUntil:status.quietUntil,
      controlRevision:saved.application.state.binding.controlRevision,mode:saved.application.state.lastResult?.mode??'attended',
      pendingControl:saved.application.state.pendingControl,native};
    return {enabled:native.enabled&&native.events.enabled&&!paused&&!['paused','cancel_requested','cancelled'].includes(versions.mode)
      &&!['pause','cancel'].includes(versions.pendingControl?.action),quiet:Boolean(quiet)||native.events.quiet,revision:hash(versions)};
  }
  function owner(sourceTaskId) {
    const app=application(),seen=new Set();let id=sourceTaskId;
    for(;;) {
      if(seen.has(id))fail('SCOPE_DENIED');seen.add(id);
      const task=app.runtime.getTask(id),parent=app.runtime.loadCheckpoint(id,'subtask-parent');
      if(task.cancelRequested||['failed','cancelled','cancelling'].includes(task.state))fail('CANCELLED');
      for(const key of ['private-copy-erasure','private-copy-erasure-binding'])if(app.runtime.loadCheckpoint(id,key)!==undefined)fail('SCOPE_DENIED');
      if(!parent)return task;
      app.readSubagentConversation({parentTaskId:parent.parentTaskId,taskId:id});id=parent.parentTaskId;
    }
  }
  function anchor(binding,event) {
    const {source,conversation,saved}=current(binding),state=saved.application.state;
    const entry=state.entries[event.eventId];
    if(!entry||!isDeepStrictEqual(entry.event,event)||event.conversationId!==state.conversationId)fail('REVISION_CONFLICT');
    const candidates=Object.values(state.responsibilities).filter(value=>value.authority==='explicit_instruction'
      &&(event.responsibilityRefs.includes(value.id)||event.entry==='wake'&&state.schedules[event.entityRef])
      &&value.sourceQuotes?.some(quote=>quote.messageId===source.taskId));
    if(candidates.length!==1)fail('UNSUPPORTED_CAPABILITY');
    const responsibility=candidates[0];
    if(responsibility.conversationId!==conversation||!Number.isSafeInteger(responsibility.revision)||responsibility.revision<1
      ||!Array.isArray(responsibility.sourceQuotes)||responsibility.sourceQuotes.length!==1)fail('SCOPE_DENIED');
    const quote=responsibility.sourceQuotes[0];
    if(quote.messageId!==source.taskId||quote.conversationId!==source.conversationId
      ||quote.quoteRef!=='runtime:task:'+source.taskId+':goal'||quote.sha256!==sha(source.goal))fail('REVISION_CONFLICT');
    let deadline=binding.taskDeadline;
    if(event.entry==='connector') {
      if(typeof readTrackingGrant!=='function'||typeof readSourceOrigin!=='function')fail('UNSUPPORTED_CAPABILITY');
      let trackingTaskId=source.taskId;
      const parent=application().runtime.loadCheckpoint(trackingTaskId,'subtask-parent');
      if(parent?.parentTaskId){application().readSubagentConversation({parentTaskId:parent.parentTaskId,taskId:trackingTaskId});trackingTaskId=parent.parentTaskId;}
      const grant=sync(readTrackingGrant({namespace,sourceId:event.sourceId,taskId:trackingTaskId}));
      const original=sync(readSourceOrigin(binding.taskId,event));
      if(!Number.isFinite(Date.parse(grant?.expiresAt))||!Number.isFinite(Date.parse(original?.selection?.grantExpiresAt)))fail('UNAUTHORIZED');
      deadline=new Date(Math.min(Date.parse(deadline),Date.parse(grant.expiresAt),Date.parse(original.selection.grantExpiresAt))).toISOString();
    }
    return {sourceTaskId:source.taskId,parentTaskId:owner(source.taskId).taskId,deadline,
      responsibility:structuredClone(responsibility)};
  }
  function authorize(binding,expected,event,context,mode) {
    if(context.signal?.aborted)fail('CANCELLED');
    if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)>Date.parse(binding.taskDeadline)
      ||now()>=Date.parse(context.deadline))fail('TIMEOUT');
    const facts=current(binding),actual=anchor(binding,event);
    if(!isDeepStrictEqual(actual,expected))fail('REVISION_CONFLICT');
    const entry=facts.saved.application.state.entries[event.eventId];
    if(event.contractRef!==binding.contractRef||!Array.isArray(event.evidenceRefs)||!event.evidenceRefs.length)fail('SCOPE_DENIED');
    let developer;
    if(mode==='dispatch') {
      const settings=control(binding);if(!settings.enabled||settings.quiet)fail('SCOPE_DENIED');
      const native=sync(readDeveloperHarnessConfiguration());
      if(!native||!text(native.workspaceRef)||!text(native.configurationRef)||!Number.isSafeInteger(native.maxExecutorSteps)
        ||native.maxExecutorSteps<1||typeof native.assertCurrent!=='function')fail('SCOPE_DENIED');
      if(sync(native.assertCurrent())!==undefined)fail('UNAUTHORIZED');
      developer={workspaceRef:native.workspaceRef,configurationRef:native.configurationRef,maxExecutorSteps:native.maxExecutorSteps};
    }
    if(event.entry==='connector') {
      if(typeof readSourceBinding!=='function'||typeof readTrackingGrant!=='function'||typeof readSourceOrigin!=='function'
        ||typeof readSourceAuthorization!=='function')fail('UNSUPPORTED_CAPABILITY');
      // The original router checks exact durable heads/pending.heads plus confirmed receipt
      // provenance. Observation timestamps cannot order versions or replace that authority.
      const original=sync(readSourceOrigin(binding.taskId,event)),proof=sync(readSourceAuthorization(binding.taskId,event));
      if(event.change!=='upsert'||!original||!text(proof?.fence)||!Number.isFinite(Date.parse(proof.expiresAt))
        ||now()>=Date.parse(proof.expiresAt)||Date.parse(expected.deadline)>Date.parse(proof.expiresAt))fail('SCOPE_DENIED');
      const source=sync(readSourceBinding(event.sourceId));
      let trackingTaskId=binding.sourceTaskId;
      const parent=facts.runtime.loadCheckpoint(trackingTaskId,'subtask-parent');
      if(parent?.parentTaskId){facts.app.readSubagentConversation({parentTaskId:parent.parentTaskId,taskId:trackingTaskId});trackingTaskId=parent.parentTaskId;}
      const tracking=facts.runtime.getTask(trackingTaskId),grant=sync(readTrackingGrant({namespace,sourceId:event.sourceId,taskId:trackingTaskId}));
      if(!source||source.namespace!==namespace||source.sourceId!==event.sourceId||source.available!==true
        ||source.sensitivity!=='public'||source.containsCredentials!==false||!text(source.configurationRef)
        ||grant?.state!=='granted'||grant.publicLowRiskTracking!==true||grant.namespace!==namespace
        ||!text(grant.id)||!Number.isSafeInteger(grant.revision)||grant.revision<1||grant.sourceId!==source.sourceId
        ||grant.configurationRef!==source.configurationRef||grant.taskId!==trackingTaskId||grant.conversationId!==tracking.conversationId
        ||grant.purposeDigest!==proactiveWorkflowDigest(tracking.goal)||!Number.isFinite(Date.parse(grant.expiresAt))
        ||now()>=Date.parse(grant.expiresAt)||Date.parse(context.deadline)>Date.parse(grant.expiresAt))fail('UNAUTHORIZED');
      if(entry.payload?.connectorId!=='feeds'||entry.payload.sourceKind!=='feeds')fail('UNSUPPORTED_CAPABILITY');
      if(entry.payload.sourceId!==event.sourceId||entry.payload.sourceRevision!==event.sourceVersion
        ||entry.payload.item?.dedupeKey!==event.entityRef||event.payloadDigest!==proactiveWorkflowDigest(entry.payload.item))fail('REVISION_CONFLICT');
      const batches=Object.values(facts.saved.application.state.batches).filter(batch=>batch.sourceId===event.sourceId
        &&event.payloadRef==='runtime:proactive-batch:'+batch.batchId+':'+event.eventId
        &&event.evidenceRefs.includes('runtime:proactive-batch:'+batch.batchId)
        &&batch.events?.some(value=>isDeepStrictEqual(value,entry.payload)));
      if(batches.length!==1)fail('SCOPE_DENIED');
      return {source:structuredClone(source),grant:structuredClone(grant),original:structuredClone(original),proof:structuredClone(proof),
        batchDigest:proactiveWorkflowDigest(batches[0]),...(developer?{developer}:{})};
    }
    if(event.entry==='wake') {
      const schedule=facts.runtime.getSchedule(event.entityRef);
      const proposal=Object.values(facts.saved.session.state.proposals).find(value=>value.operationId===event.entityRef);
      const record=facts.runtime.readToolExecutions(binding.taskId).find(value=>value.evidenceId===event.entityRef);
      const args=proposal?{sessionId:binding.sessionId,proposalId:proposal.proposalId}:undefined;
      if(!facts.saved.application.state.schedules[event.entityRef]||event.sourceId!=='runtime:scheduler'||schedule.status!=='fired'
        ||!schedule.taskId||schedule.conversationId!==facts.saved.application.state.conversationId
        ||facts.runtime.findTaskByIdempotencyKey(schedule.taskIdempotencyKey)?.taskId!==schedule.taskId
        ||event.sourceVersion!==proactiveWorkflowDigest(schedule)||event.payloadDigest!==proactiveWorkflowDigest(schedule)
        ||!isDeepStrictEqual(entry.payload,schedule)||!proposal||proposal.capabilityRef!=='proactive.schedule_wake'
        ||proposal.capabilityKind!=='schedule_wake'||proactiveWorkflowDigest(proposal.arguments)!==facts.saved.application.state.schedules[event.entityRef]
        ||record?.toolName!=='proactive.schedule_wake'||record.toolVersion!=='1.0.0'||record.state!=='confirmed'
        ||record.policyDecision!=='allow'||record.executionStarted!==true
        ||!facts.runtime.matchesToolExecutionInput(record,{arguments:args,scopeRef:event.entityRef})
        ||facts.runtime.loadCheckpoint(binding.taskId,'tool-result-'+event.entityRef)?.result?.scheduleId!==event.entityRef)fail('UNAUTHORIZED');
      return {schedule,proposal,inputDigest:record.inputDigest,...(developer?{developer}:{})};
    }
    return fail('UNSUPPORTED_CAPABILITY');
  }
  function ports(binding) {
    return {runtime:application().runtime,resolveUserConversation,now,
      resolveAnchor:event=>anchor(binding,event),readControl:()=>control(binding),
      assertCurrentAuthorization:(value,event,context,mode)=>{authorize(binding,value,event,context,mode);}};
  }
  function original(rootTaskId,origin) {
    const app=application(),runtime=app.runtime,root=runtime.getTask(rootTaskId);
    if(!isDeepStrictEqual(runtime.loadCheckpoint(rootTaskId,'harness-event-origin'),origin)
      ||runtime.findTaskByIdempotencyKey('harness-event-root:'+origin.deliveryId)?.taskId!==rootTaskId)fail('SCOPE_DENIED');
    const found=[];
    for(const item of bindings()) {
      if(item.binding?.sourceTaskId!==origin.sourceTaskId||item.withheld)continue;
      const binding=item.binding;
      let saved;
      try{saved=sync(readPersistedDelivery({...ports(binding),taskId:binding.taskId,sessionId:binding.sessionId},origin));}
      catch{continue;} // An unrelated stale native session cannot hide this exact original origin.
      if(saved)found.push({binding,saved});
    }
    if(found.length!==1)fail('UNSUPPORTED_CAPABILITY');
    const {binding,saved}=found[0];
    if(sync(resolveUserConversation(rootTaskId))!==saved.anchor.responsibility.conversationId)fail('SCOPE_DENIED');
    saved.assertCurrent();
    const authority=authorize(binding,saved.anchor,saved.event,{signal:new AbortController().signal,deadline:saved.deadline},'dispatch');
    return {binding,saved,root,authority,configuration:configuration(binding)};
  }
  return {
    /** Call only after the original native workflow start/resume, never from startup classification. */
    async start(taskId,context) {
      if(!text(taskId)||!context?.signal)fail('INVALID_ARGUMENT');
      const startingGeneration=generation;
      const workflow=sync(getWorkflow()),binding=bindings().find(item=>item.binding?.taskId===taskId)?.binding;
      if(!binding)fail('UNSUPPORTED_CAPABILITY');
      const active=()=>{if(context.signal.aborted||generation!==startingGeneration||closed)fail('CANCELLED');
        if(!Number.isFinite(Date.parse(context.deadline))||now()>=Date.parse(context.deadline)
          ||Date.parse(context.deadline)>Date.parse(binding.taskDeadline))fail('TIMEOUT');};
      active();
      current(binding);
      let manager=managers.get(taskId);
      // Native maintenance may revisit a session; subscriptions and H1 progress wake the consumer.
      if(manager)return;
      if(!manager) {
        const session=await workflow.acquireMaintenance(taskId,context);active();current(binding);
        if(!isDeepStrictEqual(session.binding,binding)||session.host.taskId!==taskId||session.host.sessionId!==binding.sessionId)fail('REVISION_CONFLICT');
        const existing=managers.get(taskId);
        if(existing)return;
        const supplied=ports(binding),app=application();
        const delivery=createRuntimeHarnessEventDelivery({runtime:()=>application().runtime,
          submitHarnessEventTask:input=>application().submitHarnessEventTask(input),
          resolveUserConversation,assertCurrentAuthorization:supplied.assertCurrentAuthorization,
          ...(typeof app.isHarnessEventTaskActive==='function'?{isHarnessEventTaskActive:origin=>application().isHarnessEventTaskActive(origin)}:{})});
        manager=createRuntimeHarnessEvents({...supplied,host:session.host,delivery,now});managers.set(taskId,manager);
      }
      await manager.start();
    },
    async flush() {await Promise.all([...managers.values()].map(manager=>manager.flush()));},
    snapshot() {return {state:closed?'closed':managers.size?'bound':'waiting_startup',sessions:managers.size,
      verification:'unverified',consumers:[...managers.values()].map(manager=>manager.inspect())};},
    assertHarnessEventCurrent(rootTaskId,origin) {original(rootTaskId,origin);},
    canResumeHarnessEvent(request) {
      try {
        const facts=original(request.taskId,request.origin),{root,saved,configuration}=facts;
        if(root.revision!==request.expectedRevision||root.conversationId!==request.conversationId
          ||request.phase!==(root.state==='created'?'created_root':'continuation')
          ||request.phase==='created_root'&&saved.ledgerState!=='pending')return undefined;
        const frozen={origin:request.origin,revision:root.revision,configurationRef:configuration.ref,
          ledgerRevision:saved.ledgerRevision,lifecycleRevision:saved.lifecycleRevision,lifecycleRunning:saved.lifecycleRunning,
          control:saved.control,anchor:saved.anchor,deadline:saved.deadline,authority:facts.authority,binding:facts.binding};
        return {deadline:saved.deadline,configurationRef:configuration.ref,fence:hash(frozen),assertCurrent() {
          saved.assertCurrent();const current=original(request.taskId,request.origin);
          if(current.root.revision!==root.revision||current.root.conversationId!==request.conversationId
            ||current.configuration.ref!==configuration.ref||!isDeepStrictEqual(current.authority,facts.authority)
            ||!isDeepStrictEqual(current.binding,facts.binding))fail('REVISION_CONFLICT');
        }};
      }catch{return undefined;}
    },
    async stop(taskId) {
      generation++;
      const selected=taskId===undefined?[...managers.entries()]:[[taskId,managers.get(taskId)]];
      for(const [id,manager] of selected)if(manager){await manager.stop();managers.delete(id);}
    },
    async close() {closed=true;generation++;for(const manager of managers.values())await manager.stop();managers.clear();},
  };
}
