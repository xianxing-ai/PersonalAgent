import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {proactiveWorkflowDigest as sourceDigest} from '@personal-agent/agentarts';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rawHash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw new ProtocolError(code,'原持续责任的事件授权不可用');};
const terminal=new Set(['failed','cancelled','cancelling']);
const withheld=(runtime,id)=>['private-copy-erasure','private-copy-erasure-binding']
  .some(key=>runtime.loadCheckpoint(id,key)!==undefined);

/** Native provenance adapter only. Original Runtime hosts own persistence, dispatch and readback. */
export function createDesktopHarnessEventsHost({application,createEvents,createDelivery,readConfiguration,
  readDeveloperHarnessConfiguration,resolveUserConversation,readSourceOrigin,readSourceAuthorization,
  readPersistedSessions=()=>[],readOriginalDelivery,now=Date.now}) {
  const sessions=new Map();let closed=false,started=false;
  const runtime=application.runtime;
  const rootTask=taskId=>{
    const visited=new Set();let id=taskId;
    for(;;) {
      if(visited.has(id)||withheld(runtime,id))return fail('SCOPE_DENIED');visited.add(id);
      const task=runtime.getTask(id),parent=runtime.loadCheckpoint(id,'subtask-parent');
      if(task.cancelRequested||terminal.has(task.state))return fail('CANCELLED');
      if(!parent)return task;
      if(typeof parent.parentTaskId!=='string'||!parent.parentTaskId)return fail('SCOPE_DENIED');
      application.readSubagentConversation({parentTaskId:parent.parentTaskId,taskId:id});
      id=parent.parentTaskId;
    }
  };
  function state(session) {
    const snapshot=session.host.inspect(),value=snapshot?.application?.state;
    if(!value||value.binding.taskId!==session.binding.taskId||value.binding.sessionId!==session.binding.sessionId
      ||value.binding.taskDeadline!==session.binding.taskDeadline||value.contractRef!==session.binding.contractRef)
      return fail('REVISION_CONFLICT');
    return snapshot;
  }
  function responsibility(session,event) {
    const snapshot=state(session),value=snapshot.application.state,entry=value.entries[event.eventId];
    if(!entry||!isDeepStrictEqual(entry.event,event)||event.contractRef!==value.contractRef
      ||event.conversationId!==value.conversationId)return fail('REVISION_CONFLICT');
    const ids=event.entry==='wake'?Object.keys(value.responsibilities):event.responsibilityRefs;
    const candidates=ids.map(id=>value.responsibilities[id]).filter(item=>item?.authority==='explicit_instruction'
      &&item.sourceQuotes?.some(quote=>quote.messageId===session.binding.sourceTaskId));
    if(candidates.length!==1)return fail('SCOPE_DENIED');
    const selected=candidates[0];
    if(!Number.isSafeInteger(selected.revision)||selected.revision<1||selected.conversationId!==value.conversationId)
      return fail('SCOPE_DENIED');
    for(const quote of selected.sourceQuotes) {
      const task=runtime.getTask(quote.messageId);
      if(typeof task.goal!=='string'||quote.quoteRef!=='runtime:task:'+task.taskId+':goal'
        ||quote.sha256!==rawHash(task.goal)||quote.conversationId!==task.conversationId
        ||withheld(runtime,task.taskId)||resolveUserConversation(task.taskId)!==selected.conversationId)
        return fail('SCOPE_DENIED');
    }
    return selected;
  }
  function resolveAnchor(session,event) {
    const selected=responsibility(session,event),parent=rootTask(session.binding.sourceTaskId);
    const original=event.entry==='connector'?readSourceOrigin(session.binding.taskId,event):undefined;
    const limits=[session.binding.taskDeadline,event.expiresAt,original?.selection?.grantExpiresAt].filter(value=>value!==undefined);
    if(limits.some(value=>!Number.isFinite(Date.parse(value))))return fail('SCOPE_DENIED');
    return {sourceTaskId:session.binding.sourceTaskId,parentTaskId:parent.taskId,
      deadline:new Date(Math.min(...limits.map(Date.parse))).toISOString(),responsibility:structuredClone(selected)};
  }
  function control(session) {
    const config=readConfiguration(),value=state(session).application.state;
    const nativePause=['paused','cancel_requested','cancelled'].includes(value.lastResult?.mode)
      ||['pause','cancel'].includes(value.pendingControl?.action);
    return {enabled:config?.enabled===true&&config.events?.enabled===true&&!nativePause,
      quiet:config?.events?.quiet===true,
      revision:hash([config?.revision??'unconfigured',value.binding.controlRevision,nativePause])};
  }
  function authorization(session,anchor,event,context,mode) {
    if(context.signal?.aborted)return fail('CANCELLED');
    if(!Number.isFinite(Date.parse(context.deadline))||now()>=Date.parse(context.deadline)
      ||Date.parse(context.deadline)>Date.parse(anchor.deadline))return fail('TIMEOUT');
    if(!isDeepStrictEqual(resolveAnchor(session,event),anchor))return fail('REVISION_CONFLICT');
    const snapshot=state(session),value=snapshot.application.state;
    const source=runtime.getTask(anchor.sourceTaskId),hostTask=runtime.getTask(session.binding.taskId);
    if(source.cancelRequested||terminal.has(source.state)||hostTask.cancelRequested
      ||['succeeded',...terminal].includes(hostTask.state)||withheld(runtime,hostTask.taskId))return fail('CANCELLED');
    let evidence;
    if(event.entry==='connector') {
      if(event.change!=='upsert')return fail('SCOPE_DENIED');
      evidence=readSourceAuthorization(session.binding.taskId,event);
      if(!evidence||now()>=Date.parse(evidence.expiresAt)
        ||Date.parse(anchor.deadline)>Date.parse(evidence.expiresAt))return fail('SCOPE_DENIED');
    } else if(event.entry==='wake') {
      const schedule=runtime.getSchedule(event.entityRef);
      const proposal=Object.values(snapshot.session?.state?.proposals??{}).find(item=>item.operationId===event.entityRef);
      const record=runtime.readToolExecutions(session.binding.taskId).find(item=>item.evidenceId===event.entityRef);
      const args=proposal?{sessionId:session.binding.sessionId,proposalId:proposal.proposalId}:undefined;
      if(!value.schedules[event.entityRef]||!proposal||proposal.capabilityRef!=='proactive.schedule_wake'
        ||proposal.capabilityKind!=='schedule_wake'||sourceDigest(proposal.arguments)!==value.schedules[event.entityRef]
        ||schedule.status!=='fired'||!schedule.taskId||sourceDigest(schedule)!==event.payloadDigest||sourceDigest(schedule)!==event.sourceVersion
        ||runtime.findTaskByIdempotencyKey(schedule.taskIdempotencyKey)?.taskId!==schedule.taskId
        ||resolveUserConversation(schedule.taskId)!==anchor.responsibility.conversationId
        ||record?.toolName!=='proactive.schedule_wake'||record.toolVersion!=='1.0.0'||record.state!=='confirmed'
        ||record.policyDecision!=='allow'||record.executionStarted!==true
        ||!runtime.matchesToolExecutionInput(record,{arguments:args,scopeRef:event.entityRef})
        ||runtime.loadCheckpoint(session.binding.taskId,'tool-result-'+event.entityRef)?.result?.scheduleId!==event.entityRef)
        return fail('SCOPE_DENIED');
      evidence={fence:hash([schedule,proposal,record.inputDigest])};
    }else return fail('SCOPE_DENIED');
    // Preference changes suppress new work. Readback keeps the original receipt, never resubmits.
    const settings=control(session);
    if(mode==='dispatch'&&(!settings.enabled||settings.quiet))return fail('SCOPE_DENIED');
    if(mode==='dispatch') {
      const config=readDeveloperHarnessConfiguration();if(!config)return fail('SCOPE_DENIED');config.assertCurrent?.();
    }
    return hash([anchor,event,evidence.fence,settings]);
  }
  function attach(session) {
    if(closed||sessions.has(session.binding.taskId))return;
    const assertCurrentAuthorization=(anchor,event,context,mode)=>authorization(session,anchor,event,context,mode);
    const delivery=createDelivery({runtime:()=>runtime,
      submitHarnessEventTask:input=>application.submitHarnessEventTask(input),resolveUserConversation,assertCurrentAuthorization,
      isHarnessEventTaskActive:origin=>typeof application.isHarnessEventTaskActive==='function'
        ?application.isHarnessEventTaskActive(origin):true});
    const consumer=createEvents({runtime,host:session.host,resolveAnchor:event=>resolveAnchor(session,event),
      resolveUserConversation,assertCurrentAuthorization,readControl:()=>control(session),delivery});
    sessions.set(session.binding.taskId,{session,consumer});
    if(started)void consumer.start();
  }
  const availableSessions=()=>{
    const result=new Map([...sessions].map(([id,value])=>[id,value.session]));
    for(const session of readPersistedSessions())if(!result.has(session.binding.taskId))result.set(session.binding.taskId,session);
    return [...result.values()];
  };
  const originalDelivery=(session,origin)=>readOriginalDelivery(session,origin,{runtime,
    taskId:session.binding.taskId,sessionId:session.binding.sessionId,
    resolveAnchor:event=>resolveAnchor(session,event),resolveUserConversation,
    assertCurrentAuthorization:(anchor,event,context,mode)=>authorization(session,anchor,event,context,mode),
    readControl:()=>control(session)});
  const ledgerDigest=value=>hash({origin:value.origin,ledgerState:value.ledgerState,ledgerRevision:value.ledgerRevision,
    event:value.event,anchor:value.anchor,control:value.control,deadline:value.deadline});
  return {
    attach,
    start(){if(closed)return;started=true;for(const {consumer}of sessions.values())void consumer.start();},
    flush(){if(closed)return;for(const {consumer}of sessions.values())void consumer.flush();},
    async close(){closed=true;await Promise.allSettled([...sessions.values()].map(({consumer})=>consumer.stop()));sessions.clear();},
    snapshot(){return {state:closed?'closed':started?'bound':'waiting_startup',sessions:sessions.size,
      verification:'not_run',consumers:[...sessions.values()].map(({consumer})=>consumer.inspect())};},
    canResumeHarnessEvent(query) {
      if(closed||typeof readOriginalDelivery!=='function')return undefined;
      try {
        for(const session of availableSessions()) {
          const original=originalDelivery(session,query.origin);
          if(!original||!['pending','confirmed'].includes(original.ledgerState)
            ||query.phase==='created_root'&&original.ledgerState!=='pending')continue;
          original.assertCurrent();
          const {event,anchor}=original;
          if(anchor.sourceTaskId!==query.origin.sourceTaskId||anchor.parentTaskId!==query.origin.originalParentTaskId
            ||original.origin.deliveryId!==query.origin.deliveryId||original.origin.eventDigest!==query.origin.eventDigest
            ||hash(event)!==query.origin.eventDigest||anchor.responsibility.conversationId!==query.conversationId)continue;
          const readFence=()=>{
            const task=runtime.getTask(query.taskId),current=originalDelivery(session,query.origin),settings=control(session);
            current?.assertCurrent();original.assertCurrent();
            if(task.revision!==query.expectedRevision||task.cancelRequested||!current||ledgerDigest(current)!==ledgerDigest(original)
              ||!settings.enabled||settings.quiet)return fail('REVISION_CONFLICT');
            const config=readDeveloperHarnessConfiguration();if(!config)return fail('SCOPE_DENIED');config.assertCurrent?.();
            const auth=authorization(session,anchor,event,{deadline:anchor.deadline,signal:new AbortController().signal},'dispatch');
            return {deadline:original.deadline,configurationRef:application.coordinationConfigurationRef,
              fence:hash([auth,settings,config.workspaceRef,config.maxExecutorSteps,config.configurationRef,
                readConfiguration(),query.origin,ledgerDigest(current)])};
          };
          const frozen=readFence();return {...frozen,assertCurrent(){if(!isDeepStrictEqual(readFence(),frozen))fail('REVISION_CONFLICT');}};
        }
      }catch{return undefined;}
      return undefined;
    },
  };
}
