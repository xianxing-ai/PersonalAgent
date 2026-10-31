import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createKnowledgeSearchTool} from '@personal-agent/knowledge/tool';
import {createSystemObservationTool,SYSTEM_OBSERVATION_TOOL_NAME} from '@personal-agent/windows-client';
import {createRuntimeF03MemoryQueryHost,createRuntimeF04MemoryQueryHost,createRuntimeF05JointRecallHost} from '../dist/application/workflow-f04-f05-recall-host.js';
import {createRuntimeF06TodoWriteHost,createRuntimeF06NotificationDeliverHost,createRuntimeF06ReminderGuard} from '../dist/application/workflow-f06-todo-graph-host.js';
import {createRuntimeF07CalendarFreshnessHost,createRuntimeF07CalendarWriteHost} from '../dist/application/workflow-f07-calendar-graph-host.js';
import {createRuntimeF08MailArchiveHost,createRuntimeF08MailSendHost,createRuntimeF08OperationScopeHost,
  createRuntimeF08WaitReconciliationHost,createRuntimeF08VersionedReplanHost} from '../dist/application/workflow-f08-mail-graph-host.js';
import {createRuntimeF12QuietHoursHost,createRuntimeF12NotificationDeliverHost} from '../dist/application/workflow-f12-notification-graph-host.js';
import {createRuntimeF13SystemProbeHost} from '../dist/application/workflow-f13-probe-graph-host.js';
import {createRuntimeF21SourceManifestHost,createRuntimeF21ProtocolHealthHost} from '../dist/application/workflow-f21-skill-graph-host.js';
import {createRuntimeF25OutboundContextHost} from '../dist/application/workflow-f25-outbound-graph-host.js';
import {createRuntimeF27ModelCapabilitiesHost} from '../dist/application/workflow-f27-model-graph-host.js';
import {createRuntimeF28NativeConfigHost,createRuntimeF28NativeConfigGuard} from '../dist/application/workflow-f28-model-native-host.js';
import {createRuntimeF18BoundPrDiffHost,createRuntimeF18MergeGateHost,createRuntimeF18RegisteredMergeHost} from '../dist/application/workflow-f18-pr-graph-host.js';
import {createRuntimeF19IssueSnapshotHost,createRuntimeF19EnqueueRepairHost,createRuntimeF19MergedRepairReadbackHost,
  createRuntimeF19CloseIssueHost} from '../dist/application/workflow-f19-issue-graph-host.js';
import {createRuntimeF22ShadowObservationHost} from '../dist/application/workflow-f22-shadow-graph-host.js';
import {createRuntimeF26DeploymentReadbackHost} from '../dist/application/workflow-f26-deployment-graph-host.js';

function hostFixture(workflowId,nodeId,toolName,args={}){
  const now=Date.now(),deadline=new Date(now+60_000).toISOString(),signal=new AbortController().signal;
  const map=new Map(),put=(id,key,value)=>map.set(id+'|'+key,value);
  put('child','coding-repair:parent',{taskId:'parent',operationId:'operation'});
  put('child','host-tool-intent',{commandId:'operation',toolName,arguments:args,deadline});
  put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId,sessionId:'session',deadline,
    proposal:{nodeId,operationId:'operation',toolName,arguments:args}});
  const runtime={loadCheckpoint:(id,key)=>map.get(id+'|'+key),
    saveCheckpointOnce:(id,key,value)=>{const slot=id+'|'+key;if(map.has(slot))return false;map.set(slot,value);return true;},
    getTask:()=>({state:'running',cancelRequested:false})};
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'grant',scopes:['fixture:read','todo:write','computer:system:read'],deadline,signal};
  let gate=true,exportAllowed=true;
  const ports={application:{runtime},requiredScopes:['fixture:read'],assertCurrent:()=>{if(!gate)throw Error('gate');},
    authorizeExport:async()=>exportAllowed,now:()=>new Date(now),context,gateOff:()=>{gate=false;},denyExport:()=>{exportAllowed=false;}};
  return {...ports,put};
}

test('optional graph hosts stay absent without trusted providers',()=>{
  assert.equal(createRuntimeF03MemoryQueryHost().tools.length,0);
  assert.equal(createRuntimeF04MemoryQueryHost().tools.length,0);
  assert.equal(createRuntimeF05JointRecallHost().tools.length,0);
  assert.equal(createRuntimeF06TodoWriteHost().tools.length,0);
  assert.equal(createRuntimeF06NotificationDeliverHost().tools.length,0);
  assert.equal(createRuntimeF06ReminderGuard().tools.length,0);
  assert.equal(createRuntimeF07CalendarFreshnessHost().tools.length,0);
  assert.equal(createRuntimeF07CalendarWriteHost().tools.length,0);
  assert.equal(createRuntimeF08MailArchiveHost().tools.length,0);
  assert.equal(createRuntimeF08MailSendHost().tools.length,0);
  assert.equal(createRuntimeF08OperationScopeHost().tools.length,0);
  assert.equal(createRuntimeF08WaitReconciliationHost().tools.length,0);
  assert.equal(createRuntimeF08VersionedReplanHost().tools.length,0);
  assert.equal(createRuntimeF12QuietHoursHost().tools.length,0);
  assert.equal(createRuntimeF12NotificationDeliverHost().tools.length,0);
  assert.equal(createRuntimeF13SystemProbeHost().tools.length,0);
  assert.equal(createRuntimeF21SourceManifestHost().tools.length,0);
  assert.equal(createRuntimeF21ProtocolHealthHost().tools.length,0);
  assert.equal(createRuntimeF25OutboundContextHost().tools.length,0);
  assert.equal(createRuntimeF27ModelCapabilitiesHost().tools.length,0);
  assert.equal(createRuntimeF28NativeConfigHost().tools.length,0);
  assert.equal(createRuntimeF28NativeConfigGuard().tools.length,0);
  assert.equal(createRuntimeF18BoundPrDiffHost().tools.length,0);
  assert.equal(createRuntimeF18MergeGateHost().tools.length,0);
  assert.equal(createRuntimeF18RegisteredMergeHost().tools.length,0);
  assert.equal(createRuntimeF19IssueSnapshotHost().tools.length,0);
  assert.equal(createRuntimeF19EnqueueRepairHost().tools.length,0);
  assert.equal(createRuntimeF19MergedRepairReadbackHost().tools.length,0);
  assert.equal(createRuntimeF19CloseIssueHost().tools.length,0);
  assert.equal(createRuntimeF22ShadowObservationHost().tools.length,0);
  assert.equal(createRuntimeF26DeploymentReadbackHost().tools.length,0);
});

test('F04 memory host reads only through injected MemoryQueryPort',async()=>{
  const f=hostFixture('F04','F04_N05','workflow.host.f04_n05');
  const memory={listCurrent:async()=>({snapshot:'snap',facts:[{ref:{id:'fact-1',revision:1},summary:'s',sourceRef:'src',
    observedAt:new Date().toISOString(),validFrom:'2020-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',
    sensitivity:'public',state:'active',confirmation:'user_confirmed'}]})};
  const host=createRuntimeF04MemoryQueryHost({...f,memory,resolveQuery:async()=>({factId:'fact-1',limit:1})});
  const result=await host.tools[0].execute({},f.context);
  assert.equal(result.facts.length,1);
  f.gateOff();await assert.rejects(host.tools[0].execute({},f.context),{code:'UNAUTHORIZED'});
});

test('F05 joint recall delegates to memory and knowledge.search',async()=>{
  const f=hostFixture('F05','F05_N02','workflow.host.f05_n02');
  const memory={listCurrent:async()=>({snapshot:'snap',facts:[]})};
  const knowledgeSearch=createKnowledgeSearchTool({search:async()=>({hits:[],truncated:false})});
  let calls=0;
  const invokeKnowledgeSearch=async(input,context)=>{calls++;assert.equal(context,f.context);return knowledgeSearch.execute(input,context);};
  assert.equal(createRuntimeF05JointRecallHost({...f,memory,knowledgeSearch,requiredMemoryScopes:['fixture:read'],
    requiredKnowledgeScopes:['knowledge:read'],resolveMemoryQuery:async()=>({sourceRef:'src',limit:1}),
    resolveKnowledgeQuery:async()=>({query:'q',limit:1})}).tools.length,0);
  const host=createRuntimeF05JointRecallHost({...f,memory,knowledgeSearch,requiredMemoryScopes:['fixture:read'],
    requiredKnowledgeScopes:['knowledge:read'],resolveMemoryQuery:async()=>({sourceRef:'src',limit:1}),
    resolveKnowledgeQuery:async()=>({query:'q',limit:1}),invokeKnowledgeSearch});
  await assert.rejects(host.tools[0].execute({},f.context),{code:'SCOPE_DENIED'});
  assert.equal(calls,0);
  f.context.scopes.push('knowledge:read');
  const result=await host.tools[0].execute({},f.context);
  assert.deepEqual(result.knowledge.hits,[]);
});

test('F06 todo write and notification deliver enforce trusted bindings',async()=>{
  const f=hostFixture('F06','F06_N03','workflow.host.f06_n03');
  const deadline=f.context.deadline,argumentsValue={todoTitle:'t'};
  f.put('child','host-tool-intent',{commandId:'operation',toolName:'workflow.host.f06_n03',arguments:argumentsValue,deadline});
  f.put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId:'F06',sessionId:'session',deadline,
    proposal:{nodeId:'F06_N03',operationId:'operation',toolName:'workflow.host.f06_n03',arguments:argumentsValue}});
  let invoked=0;
  const invokeTodoCreate=async(scope,input,context)=>{invoked++;assert.deepEqual(input,{title:'t'});
    assert.deepEqual(context.scopes,f.context.scopes);return {item:{id:'todo-1',revision:1}};};
  let binding=true;
  assert.equal(createRuntimeF06TodoWriteHost({...f,todoCreate:{descriptor:{name:'todo.create'},execute:async()=>({})},verifyWriteBinding:async()=>true}).tools.length,0);
  const write=createRuntimeF06TodoWriteHost({...f,invokeTodoCreate,verifyWriteBinding:async()=>binding});
  const created=await write.tools[0].execute({todoTitle:'t'},f.context);
  assert.equal(created.todoId,'todo-1');assert.equal(created.revision,1);assert.equal(created.opKey,'operation');assert.equal(invoked,1);
  assert.deepEqual(f.application.runtime.loadCheckpoint('parent','f06:n03-todo:session'),
    {sessionId:'session',operationId:'operation',todoId:'todo-1',revision:1,item:{id:'todo-1',revision:1}});
  await assert.rejects(write.tools[0].execute({todoTitle:'changed'},f.context),{code:'UNAUTHORIZED'});
  binding=false;await assert.rejects(write.tools[0].execute({todoTitle:'t'},f.context),{code:'UNAUTHORIZED'});
  assert.equal(invoked,1);
  const f5=hostFixture('F06','F06_N05','workflow.host.f06_n05');
  const deliveryInput={notification:{id:'n1'}},deliveryDeadline=f5.context.deadline;
  f5.put('child','host-tool-intent',{commandId:'operation',toolName:'workflow.host.f06_n05',arguments:deliveryInput,deadline:deliveryDeadline});
  f5.put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId:'F06',sessionId:'session',deadline:deliveryDeadline,
    proposal:{nodeId:'F06_N05',operationId:'operation',toolName:'workflow.host.f06_n05',arguments:deliveryInput}});
  const deliver=createRuntimeF06NotificationDeliverHost({...f5,verifyReminderReady:async()=>true,
    deliverNotification:async()=>({delivered:false})});
  assert.deepEqual(await deliver.tools[0].execute(deliveryInput,f5.context),{delivered:false});
  await assert.rejects(deliver.tools[0].execute({notification:{id:'other'}},f5.context),{code:'UNAUTHORIZED'});
});

test('F06 explicit reminder time reaches todo.create and its original schedule is persisted',async()=>{
  const args={todoTitle:'Reminder',due:'2026-11-01T10:00:00.000Z',remindUtc:'2026-11-01T09:00:00.000Z'};
  const f=hostFixture('F06','F06_N03','workflow.host.f06_n03',args),scheduleId='todo-reminder:todo-1:'+args.remindUtc;
  const write=createRuntimeF06TodoWriteHost({...f,verifyWriteBinding:async()=>true,
    invokeTodoCreate:async(_scope,input)=>{assert.deepEqual(input,{title:args.todoTitle,dueUtc:args.due,remindUtc:args.remindUtc});
      return {item:{id:'todo-1',revision:1},reminderTrigger:{scheduleId}};}});
  await write.tools[0].execute(args,f.context);
  assert.equal(f.application.runtime.loadCheckpoint('parent','f06:n03-todo:session').reminderScheduleId,scheduleId);
  assert.deepEqual(f.application.runtime.loadCheckpoint('parent','f06:n03-todo:session').reminderTrigger,{scheduleId});
  const missing=createRuntimeF06TodoWriteHost({...f,verifyWriteBinding:async()=>true,
    invokeTodoCreate:async()=>({item:{id:'todo-1',revision:1},reminderTrigger:null})});
  await assert.rejects(missing.tools[0].execute(args,f.context),{code:'RESULT_UNKNOWN'});
});

test('F06 guard rechecks original intent, scope, cancellation and state across export consent',async()=>{
  const args={workflowId:'F06',nodeId:'F06_N05',input:{},predecessorOutputs:{F06_N04:{shouldFireAlarm:false}},predecessorStates:{F06_N04:'completed'}};
  const f=hostFixture('F06','F06_N05','workflow.guard.f06_n05',args);let state='skipped';
  const guard=createRuntimeF06ReminderGuard({...f,resolveReminderState:async()=>state});
  assert.deepEqual(await guard.tools[0].execute(args,f.context),{state:'skipped'});
  await assert.rejects(guard.tools[0].execute({...args,nodeId:'F07_N05'},f.context));
  await assert.rejects(guard.tools[0].execute(args,{...f.context,scopes:[]}),{code:'SCOPE_DENIED'});
  await assert.rejects(guard.tools[0].execute(args,{...f.context,signal:AbortSignal.abort()}),{code:'CANCELLED'});
  state='unknown';await assert.rejects(guard.tools[0].execute(args,f.context),{code:'RESULT_UNKNOWN'});
  state='skipped';const changing=createRuntimeF06ReminderGuard({...f,resolveReminderState:async()=>state,
    authorizeExport:async()=>{state='selected';return true;}});
  await assert.rejects(changing.authorizeReceipt({context:f.context,result:{state:'skipped'}}),{code:'REVISION_CONFLICT'});
  state='skipped';f.denyExport();await assert.rejects(guard.authorizeReceipt({context:f.context,result:{state:'skipped'}}),{code:'UNAUTHORIZED'});
  f.gateOff();await assert.rejects(guard.tools[0].execute(args,f.context),{code:'UNAUTHORIZED'});
});

test('F07 calendar freshness compares trusted live source version',async()=>{
  const f=hostFixture('F07','F07_N04','workflow.host.f07_n04');
  const setArgs=args=>{const deadline=f.context.deadline;
    f.put('child','host-tool-intent',{commandId:'operation',toolName:'workflow.host.f07_n04',arguments:args,deadline});
    f.put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId:'F07',sessionId:'session',deadline,
      proposal:{nodeId:'F07_N04',operationId:'operation',toolName:'workflow.host.f07_n04',arguments:args}});};
  const host=createRuntimeF07CalendarFreshnessHost({...f,application:{...f.application,readHostToolTask:()=>({})},
    readSourceVersion:async()=>'v2',verifyReadBinding:async()=>true});
  const current={calendarVersionAtRead:'v2',calendarVersionNow:'v2'};setArgs(current);
  assert.deepEqual(await host.tools[0].execute(current,f.context),
    {versionConsistent:true,sourceVersion:'v2'});
  const input={calendarVersionAtRead:'v1',calendarVersionNow:'v2'};setArgs(input);
  const stale=await host.tools[0].execute(input,f.context);
  assert.equal(stale.versionConsistent,false);
});

test('F07 calendar write delegates to calendar.create under binding',async()=>{
  const f=hostFixture('F07','F07_N05','workflow.host.f07_n05');
  const args={title:'meet',slot:{startUtc:'2026-01-01T00:00:00.000Z',endUtc:'2026-01-01T01:00:00.000Z'}};
  f.put('child','host-tool-intent',{commandId:'operation',toolName:'workflow.host.f07_n05',arguments:args,deadline:f.context.deadline});
  f.put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId:'F07',sessionId:'session',deadline:f.context.deadline,
    proposal:{nodeId:'F07_N05',operationId:'operation',toolName:'workflow.host.f07_n05',arguments:args}});
  const calendarCreate={descriptor:{name:'calendar.create',requiredScopes:['calendar:write']},
    execute:async()=>({state:'created'})};
  let binding=true;
  let calls=0;
  assert.equal(createRuntimeF07CalendarWriteHost({...f,calendarCreate,requiredScopes:['calendar:write'],verifyWriteBinding:async()=>true}).tools.length,0);
  const host=createRuntimeF07CalendarWriteHost({...f,calendarCreate,requiredScopes:['calendar:write'],
    verifyWriteBinding:async()=>binding,invokeCalendarCreate:async(input,context)=>{calls++;assert.equal(context,f.context);return calendarCreate.execute(input,context);}});
  await assert.rejects(host.tools[0].execute(args,f.context),{code:'SCOPE_DENIED'});
  assert.equal(calls,0);
  f.context.scopes.push('calendar:write');
  assert.deepEqual(await host.tools[0].execute(args,f.context),
    {eventCreated:true,externalInviteHeld:false});
  await assert.rejects(host.tools[0].execute({...args,title:'changed'},f.context),{code:'UNAUTHORIZED'});
  binding=false;
  await assert.rejects(host.tools[0].execute({title:'meet',slot:{startUtc:'2026-01-01T00:00:00.000Z',endUtc:'2026-01-01T01:00:00.000Z'}},f.context),{code:'UNAUTHORIZED'});
});

test('F08 does not substitute mark seen for archive or draft for send',async()=>{
  const archiveFixture=hostFixture('F08','F08_N03','workflow.host.f08_n03');
  let calls=0;
  const mailMarkSeen={descriptor:{name:'mail.mark_seen',requiredScopes:['mail:write']},execute:async()=>{calls++;return {state:'confirmed'};}};
  const archive=createRuntimeF08MailArchiveHost({...archiveFixture,mailMarkSeen,requiredScopes:['mail:write'],
    verifyArchiveBinding:async()=>true});
  assert.deepEqual(archive.tools,[]);
  assert.equal(archive.unavailable,'f08_mail_archive_trusted_ports_unavailable');

  const sendFixture=hostFixture('F08','F08_N07','workflow.host.f08_n07');
  const mailSend={descriptor:{name:'mail.save_draft',requiredScopes:['mail:write']},
    execute:async()=>{calls++;return {state:'confirmed'};}};
  const send=createRuntimeF08MailSendHost({...sendFixture,mailSend,requiredScopes:['mail:write'],verifySendBinding:async()=>true});
  assert.deepEqual(send.tools,[]);
  assert.equal(send.unavailable,'f08_mail_send_trusted_ports_unavailable');
  assert.equal(calls,0);

  const digest=createHash('sha256').update('{}').digest('hex');
  const scopeArgs={authorizationRef:'grant',toolName:'mail.save_draft',toolVersion:'1.0.0',argumentsDigest:digest};
  const scopeFixture=hostFixture('F08','F08_N10','workflow.host.f08_n10',scopeArgs);
  const scope=createRuntimeF08OperationScopeHost({...scopeFixture,
    verifyOperationScope:async()=>({ready:false,blockingReason:'needs approval'})});
  assert.deepEqual(await scope.tools[0].execute(scopeArgs,scopeFixture.context),
    {ready:false,blockingReason:'needs approval'});
  await assert.rejects(scope.tools[0].execute({...scopeArgs,authorizationRef:'substituted'},scopeFixture.context),{code:'UNAUTHORIZED'});
});

test('F08 wait reconciliation and versioned replan stay honest',async()=>{
  const waitFixture=hostFixture('F08','F08_N12','workflow.host.f08_n12');
  const mailReconcile={descriptor:{name:'mail.reconcile_send',requiredScopes:['mail:write']},execute:async()=>({state:'unknown'})};
  waitFixture.application.runtime.readToolExecutions=()=>[];
  const wait=createRuntimeF08WaitReconciliationHost({...waitFixture,mailReconcile,requiredScopes:['mail:write'],
    resolveOriginalSend:async()=>({taskId:'parent',runId:'run-1',messageId:'<mid>',idempotencyKey:'idem'})});
  assert.deepEqual(wait.tools,[]);
  assert.equal(wait.unavailable,'f08_wait_reconciliation_trusted_ports_unavailable');

  const replanArgs={changeReason:'scope drift',priorOperationId:'prior-op'};
  const replanFixture=hostFixture('F08','F08_N13','workflow.host.f08_n13',replanArgs);
  const replan=createRuntimeF08VersionedReplanHost({...replanFixture,
    submitVersionedReplan:async(_scope,input)=>({changeReason:input.changeReason,originalEffectChain:['mail.save_draft']})});
  assert.deepEqual(await replan.tools[0].execute(replanArgs,replanFixture.context),
    {changeReason:'scope drift',originalEffectChain:['mail.save_draft']});
  await assert.rejects(replan.tools[0].execute({...replanArgs,priorOperationId:'unrelated'},replanFixture.context),{code:'UNAUTHORIZED'});
});

test('F08 reconciliation only confirms the original send and remains unknown without readback',async()=>{
  const args={sendOperationId:'original-send'},f=hostFixture('F08','F08_N12','workflow.host.f08_n12',args);
  const original={taskId:'smtp-child',runId:'host-tool-smtp-child',messageId:'<fixture@example.invalid>',
    idempotencyKey:'host-tool-smtp-child',operationId:'original-send'};
  f.application.readHostToolTask=()=>({toolName:'mail.send',task:{state:'succeeded'},confirmed:{runId:original.runId,result:{externalId:original.messageId}}});
  let state='unknown';
  const host=createRuntimeF08WaitReconciliationHost({...f,mailReconcile:{descriptor:{name:'mail.reconcile_send'}},
    resolveOriginalSend:async()=>original,readReconciliation:async()=>({state})});
  await assert.rejects(host.tools[0].execute(args,f.context),{code:'RESULT_UNKNOWN'});
  state='confirmed';assert.deepEqual(await host.tools[0].execute(args,f.context),{reconciliationState:'confirmed',originalSendIdentity:original.runId});
  original.idempotencyKey='another-run';await assert.rejects(host.tools[0].execute(args,f.context),{code:'UNAUTHORIZED'});
});

test('F12 quiet hours and delivery require trusted notification ports',async()=>{
  const quietFixture=hostFixture('F12','F12_N02','workflow.host.f12_n02');
  const notificationHost={getInterruptionPolicy:()=>({state:'configured',effective:{mode:'quiet',digestMode:'off',allowUrgentBreakthrough:false}})};
  const quiet=createRuntimeF12QuietHoursHost({...quietFixture,notificationHost,resolveScope:()=>({operationId:'operation'})});
  assert.equal((await quiet.tools[0].execute({},quietFixture.context)).mode,'quiet');

  const deliverFixture=hostFixture('F12','F12_N04','workflow.host.f12_n04');
  const args={roundId:'r1',itemId:'i1',channel:'banner'};
  deliverFixture.put('child','host-tool-intent',{commandId:'operation',toolName:'workflow.host.f12_n04',arguments:args,deadline:deliverFixture.context.deadline});
  deliverFixture.put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId:'F12',sessionId:'session',deadline:deliverFixture.context.deadline,
    proposal:{nodeId:'F12_N04',operationId:'operation',toolName:'workflow.host.f12_n04',arguments:args}});
  let saved;
  deliverFixture.application.readHostToolTask=()=>({commandId:'operation',toolName:'workflow.host.f12_n04',task:{state:'succeeded'},
    confirmed:{runId:'host-tool-child',evidenceRefs:['host-tool-child'],result:saved}});
  let receipt={state:'unknown',evidenceRefs:[]};
  const host={getInterruptionRound:()=>({attempts:{banner:receipt}})};
  let binding=true;
  const deliver=createRuntimeF12NotificationDeliverHost({...deliverFixture,notificationHost:host,
    verifyDeliveryBinding:async()=>binding,
    resolveDeliveryReceipt:async()=>structuredClone(receipt)});
  await assert.rejects(deliver.tools[0].execute(args,deliverFixture.context),{code:'RESULT_UNKNOWN'});
  receipt={state:'delivered',evidenceRefs:['device-receipt-r1']};
  saved=await deliver.tools[0].execute(args,deliverFixture.context);
  assert.deepEqual(saved,{delivered:true,roundId:'r1'});
  await deliver.authorizeReceipt({context:deliverFixture.context,result:saved});
  await assert.rejects(deliver.authorizeReceipt({context:deliverFixture.context,result:{delivered:false,roundId:'r1'}}),{code:'UNAUTHORIZED'});
  await assert.rejects(deliver.tools[0].execute({...args,itemId:'other'},deliverFixture.context),{code:'UNAUTHORIZED'});
  host.getInterruptionRound=()=>undefined;
  await assert.rejects(deliver.tools[0].execute(args,deliverFixture.context),{code:'RESULT_UNKNOWN'});
  binding=false;
  await assert.rejects(deliver.tools[0].execute(args,deliverFixture.context),{code:'UNAUTHORIZED'});
});

test('F13 probe aliases system observation through trusted resolver',async()=>{
  const f=hostFixture('F13','F13_N02','workflow.host.f13_n02');
  const args={checks:['cpu']};
  f.put('child','host-tool-intent',{commandId:'operation',toolName:'workflow.host.f13_n02',arguments:args,deadline:f.context.deadline});
  f.put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId:'F13',sessionId:'session',deadline:f.context.deadline,
    proposal:{nodeId:'F13_N02',operationId:'operation',toolName:'workflow.host.f13_n02',arguments:args}});
  const systemObserve=createSystemObservationTool({});
  assert.equal(systemObserve.descriptor.name,SYSTEM_OBSERVATION_TOOL_NAME);
  let calls=0;
  assert.equal(createRuntimeF13SystemProbeHost({...f,systemObserve,resolveProbeOutcome:async()=>({})}).tools.length,0);
  const host=createRuntimeF13SystemProbeHost({...f,systemObserve,invokeSystemObserve:async(context)=>{calls++;assert.equal(context,f.context);return systemObserve.execute({},context);},resolveProbeOutcome:async(_scope,checks)=>{
    if(checks.includes('cloudAlive'))return Promise.reject(Object.assign(new Error('unsupported'),{code:'UNSUPPORTED_CAPABILITY'}));
    return {cloudAlive:true,quotaNormal:true,staleLockFound:false};}});
  const withoutSystemScope={...f.context,scopes:['fixture:read']};
  await assert.rejects(host.tools[0].execute(args,withoutSystemScope),{code:'SCOPE_DENIED'});
  assert.equal(calls,0);
  assert.deepEqual(await host.tools[0].execute(args,f.context),{cloudAlive:true,quotaNormal:true,staleLockFound:false});
  await assert.rejects(host.tools[0].execute({checks:['cloudAlive']},f.context),{code:'UNAUTHORIZED'});
});

test('F21 skill manifest and protocol health read injected ports only',async()=>{
  const mFixture=hostFixture('F21','F21_N01','workflow.host.f21_n01');
  const manifest=createRuntimeF21SourceManifestHost({...mFixture,readSourceManifest:async()=>({toolId:'skill-x',transport:'mcp',version:'1'})});
  assert.deepEqual(await manifest.tools[0].execute({},mFixture.context),{toolId:'skill-x',transport:'mcp',version:'1'});
  const hFixture=hostFixture('F21','F21_N03','workflow.host.f21_n03');
  const health=createRuntimeF21ProtocolHealthHost({...hFixture,readProtocolHealth:async()=>({connectionAlive:false,latencyMs:12})});
  assert.deepEqual(await health.tools[0].execute({},hFixture.context),{connectionAlive:false,latencyMs:12});
});

test('F25 outbound check and F27 model capabilities fail closed on export gates',async()=>{
  const f25=hostFixture('F25','F25_N03','workflow.host.f25_n03',{testPayloadContainsPrivate:true});
  const outbound=createRuntimeF25OutboundContextHost({...f25});
  assert.deepEqual(await outbound.tools[0].execute({testPayloadContainsPrivate:true},f25.context),
    {filteredOut:['private_marker'],cleanPayloadReady:false});
  await assert.rejects(outbound.tools[0].execute({testPayloadContainsPrivate:false},f25.context),{code:'UNAUTHORIZED'});
  const f27=hostFixture('F27','F27_N01','workflow.host.f27_n01');
  const models={revision:'r',models:[{id:'m',verification:'conditional',capabilities:{text:true,streaming:false,toolCalling:true,structuredOutput:false,vision:false}}]};
  const host=createRuntimeF27ModelCapabilitiesHost({...f27,readModels:async()=>models});
  const result=await host.tools[0].execute({},f27.context);
  assert.equal(result.models[0].id,'m');
  f27.denyExport();await assert.rejects(host.authorizeReceipt({context:f27.context,result}),{code:'UNAUTHORIZED'});
});

test('F28 native config host and guard use trusted readbacks',async()=>{
  const hostFixture28=hostFixture('F28','F28_N03','workflow.host.f28_n03',{check:'roles'});
  const config=createRuntimeF28NativeConfigHost({...hostFixture28,
    readNativeConfig:async(_scope,input)=>({check:input.check,research:true,analysis:false,coder:false})});
  assert.deepEqual(await config.tools[0].execute({check:'roles'},hostFixture28.context),
    {check:'roles',research:true,analysis:false,coder:false});
  await assert.rejects(config.tools[0].execute({check:'changed'},hostFixture28.context),{code:'UNAUTHORIZED'});
  const guardInput={workflowId:'F28',nodeId:'F28_N03',input:{check:'roles'},
    predecessorOutputs:{F28_N02:{selectedId:'original'}},predecessorStates:{F28_N02:'completed'}};
  const guardFixture=hostFixture('F28','F28_N03','workflow.guard.f28_n03',guardInput);
  const guard=createRuntimeF28NativeConfigGuard({...guardFixture,resolveGuardState:async()=>'skipped'});
  assert.deepEqual(await guard.tools[0].execute(guardInput,guardFixture.context),{state:'skipped'});
  await assert.rejects(guard.tools[0].execute({...guardInput,predecessorOutputs:{}},guardFixture.context),{code:'UNAUTHORIZED'});
});
