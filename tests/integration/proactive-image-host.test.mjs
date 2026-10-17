import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createAgentServer} from '@personal-agent/agentarts-runtime';
import {createProactiveWorkflowController,createProactiveHostProofs} from '@personal-agent/agentarts-runtime/proactive-controller';
import {createRuntimeApplication,createRuntimeProactiveConnectorHost,createProactiveWorkflowSession,createRuntimeNotificationHost} from '@personal-agent/runtime/application';
import {TaskRuntime,createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {ConnectorHost} from '@personal-agent/connector-host';
import {Client} from '@personal-agent/client';
import {FakeModelProvider,ModelGateway} from '@personal-agent/models';
import {proactiveWorkflowDigest as digest} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

// Offline integration: actual HTTP, Runtime/Policy/ToolGateway/Evidence, SQLite, ConnectorHost,
// NotificationService and Scheduler. Source reads and both model responses are explicit fixtures.
// No account, remote model, device notification channel, cloud deployment or autonomous quality proof.
const secret='explicit-offline-proactive-integration-secret-32',token='explicit-offline-http-fixture-token-32';
const contract={id:'offline-unqualified',version:'1',criteria:'Review actual persisted source context; candidate only until teacher',qualifiedForMain:false,
 batchIndependent:true,candidates:[{id:'notify',description:'Record notification through current host policy',action:'notify'},
  {id:'defer',description:'Defer for a later source state without a notification',action:'defer'}]};
const kinds=['retrieve_context','local_decision_batch','teacher_decision','notify','update_item','schedule_wake'];
const capabilities=kinds.map(kind=>({kind,ref:'offline.proactive.'+kind,location:kind==='local_decision_batch'?'local_device':'cloud_persistent',
 effect:['retrieve_context','local_decision_batch','teacher_decision'].includes(kind)?'read':'write'}));
const manifest={id:'offline-source',version:'1.0.0',accountTypes:['fixture'],capabilities:['fetchChanges'],configSchema:{type:'object'},
 authentication:'none',requiresPresence:false,syncStrategy:'incremental',verification:'mock'};

test('durable connector -> signed image -> Laya candidate -> teacher -> silent notification -> item update -> original Scheduler; restart/return do not replay',async t=>{
 await mkdir(join(process.cwd(),'.cache'),{recursive:true});
 const directory=await mkdtemp(join(process.cwd(),'.cache','proactive-image-host-')),path=join(directory,'runtime.sqlite');
 const proofs=createProactiveHostProofs(secret),timings=[],imageTimings=[],connectorTimings=[],notificationPoints=[],models=[],approved=[],hostTasks=[];
 let app,notificationHost,client,session,runner,anchor,binding,sequence=0,sourceReads=0,sinkAttempts=0,notificationCalls=0,sinkLostAck=true;
 const deadline=new Date(Date.now()+120000).toISOString(),signal=new AbortController().signal;
 const sourceItem={source:'offline-source',accountRef:'explicit-fixture-account',externalId:'message-one',dedupeKey:'message-one-v1',
  occurredAt:new Date(Date.now()-1000).toISOString(),fetchedAt:new Date(Date.now()-500).toISOString(),sensitivity:'private',contentRef:'fixture-source:message-one'};
 const measure=async(stage,fn)=>{const startedAtUtc=new Date().toISOString(),start=performance.now();
  try{return await fn();}finally{timings.push({stage,startedAtUtc,finishedAtUtc:new Date().toISOString(),wallMs:performance.now()-start});}};
 const sourceHost=new ConnectorHost({read:()=>undefined});
 sourceHost.register({manifest,create:()=>({manifest,connect:()=>({sessionRef:'offline-source-session',interactionRequired:false}),
  disconnect:()=>({disconnected:true,cleanupState:'complete'}),health:()=>({state:'ready'}),getCapabilities:()=>manifest.capabilities,
  fetchChanges:async()=>{sourceReads++;return {items:[structuredClone(sourceItem)],nextCursor:'fixture-cursor-one',hasMore:false};},
  search:async()=>[],getItem:async()=>sourceItem,performAction:async()=>{throw Error('Account writes prohibited in offline integration');}})},
  {proactive:[{sourceId:'offline-mail',accountRef:sourceItem.accountRef,kind:'mail',mode:'poll-only',configurationRevision:'fixture-config-one'}]});
 const controller=createProactiveWorkflowController({receiptSecret:secret,decisionContracts:[contract],onStage:event=>imageTimings.push(event)});
 const server=createAgentServer({mode:'standalone-validation',authToken:token,wssAuthToken:token,serviceControllers:{proactiveVersion:controller},
  orchestrator:{invoke:async()=>{throw Error('Proactive request must not fall through to another model route');}}});
 server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const endpoint='http://127.0.0.1:'+server.address().port+'/invocations';
 t.after(async()=>{await runner?.dispose();app?.close();await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});await rm(directory,{recursive:true,force:true});});
 const batchKey='integration:source-batch';
 const makeRunner=()=>createRuntimeProactiveConnectorHost({host:sourceHost,atomicState:createRuntimeAtomicStatePort(app.runtime,'integration-proactive-source'),
  authorize:async()=>true,onStage:event=>connectorTimings.push(event),events:{persist:async batch=>{
   sinkAttempts++;const persistedKey=batchKey+':'+batch.batchId,original=app.runtime.loadCheckpoint(anchor.taskId,persistedKey);
   if(original)assert.deepEqual(batch,original);else assert.equal(app.runtime.saveCheckpointOnce(anchor.taskId,persistedKey,batch),true);
   app.runtime.saveCheckpointOnce(anchor.taskId,batchKey,batch);
   if(sinkLostAck){sinkLostAck=false;throw Error('Explicit fixture: durable sink acknowledgement lost');}
   return {batchId:batch.batchId,durable:true};
  }}});
 const execute=async(kind,args,context)=>measure(kind,async()=>{
  if(kind==='retrieve_context'){
   const batch=app.runtime.loadCheckpoint(anchor.taskId,batchKey);assert.equal(batch.events.length,1);
   const event=batch.events[0];assert.equal(event.sourceId,args.source.sourceId);assert.equal(event.sourceRevision,args.source.version);
   return {contextRef:'sqlite:source-context:'+batch.batchId,sourceVersions:{[event.sourceId]:event.sourceRevision},sourceQuotes:[],goalRefs:[],memoryRefs:[],experienceRefs:[],scopeRefs:[]};
  }
  if(kind==='local_decision_batch'||kind==='teacher_decision'){
   const decidedBy=kind==='local_decision_batch'?'laya':'deepseek';
   const gateway=new ModelGateway(new FakeModelProvider([{kind:'final',text:JSON.stringify({selections:args.independentQuestions.map(q=>({itemId:q.itemId,candidateId:'notify',
    decisionRef:'offline-model:'+context.runId,decidedBy,uncertain:false,complex:false,importance:'normal',authorityRequired:false}))})}]));
   const response=await gateway.complete({messages:[{role:'user',content:JSON.stringify({contract:args.contract,questions:args.independentQuestions})}],tools:[],deadline:context.deadline,signal:context.signal});
   models.push({decidedBy,deployment:response.deployment.provider,verification:response.deployment.verification});
   return JSON.parse(response.response.text);
  }
  if(kind==='notify'){
   notificationCalls++;
   const ingestion=notificationHost.ingest([sourceItem],{scope:{kind:'connector',connectorId:manifest.id}});
   assert.equal(ingestion.accepted,1);assert.equal(notificationHost.drain().batches.length,0,'silent feed does not emit a device batch');
   assert.equal(notificationHost.getDigest({trigger:'on_return'}).interruptionCount,0);
   return {status:'changed',resultRef:'sqlite:notification-feed:'+sourceItem.dedupeKey,nextWake:{runAt:new Date(Date.parse(deadline)-60000).toISOString(),
    reason:'Explicit fixture source validity refresh',timeZone:'UTC',missedRunPolicy:'run_once'}};
  }
  if(kind==='update_item'){
   const itemId=args.itemId,key='integration:item:'+itemId;
   app.runtime.saveCheckpoint(anchor.taskId,key,{actualOutcome:args.actualOutcome,resultRef:args.resultRef,evidenceRefs:args.evidenceRefs});
   return {itemId,stateRef:'sqlite:'+key};
  }
  if(kind==='schedule_wake'){
   const actual=app.runtime.createSchedule({scheduleId:context.runId,goal:args.wake.reason,conversationId:'offline-proactive',runAt:args.wake.runAt,
    timeZone:args.wake.timeZone,missedRunPolicy:args.wake.missedRunPolicy,taskIdempotencyKey:args.taskIdempotencyKey});
   return {scheduleId:actual.scheduleId,runAt:actual.runAt,state:actual.status};
  }
  throw Error('Unregistered integration capability');
 });
 const tools=capabilities.map(capability=>({descriptor:{name:capability.ref,version:'1',inputSchema:{type:'object'},outputSchema:{type:'object'},
  sideEffect:capability.effect==='read'?'read':'local_write',requiredScopes:['offline:proactive'],idempotencySupport:true,recoverySupport:true,requiresPresence:false},
  execute:(args,context)=>execute(capability.kind,args,context)}));
 const openApp=async()=>{
  app=createRuntimeApplication({path,profile:'huawei_ict_agentarts',hostUserNamespace:'offline-proactive-integration',tools,
   automaticTools:tools.filter(tool=>tool.descriptor.sideEffect==='read').map(tool=>({toolName:tool.descriptor.name,toolVersion:'1'}))});
  client=new Client(app);await client.connect();
  anchor??=app.runtime.submitTask({goal:'Offline proactive responsibility anchor',conversationId:'offline-proactive',idempotencyKey:'anchor'});
  binding??={taskId:anchor.taskId,sessionId:'offline-proactive-session',controlRevision:1,taskDeadline:deadline};
  notificationHost=createRuntimeNotificationHost(app.runtime,{policy:{},settingsScopes:['notifications:settings'],verifyUserCommand:async(command)=>proofs.verify('user_settings',command,binding),
   onStage:event=>notificationPoints.push(event)});
 };
 await openApp();
 const settings={operationId:'explicit-fixture-user-silent-policy',expectedRevision:0,scope:{kind:'global'},patch:{mode:'silent',maxInterruptions:0,windowMinutes:23,
  silentUntilUtc:null,preferredChannel:'auto',allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null}};
 const command=proofs.sign('user_settings',{settings,source:'structured',phase:'final',origin:'user',echo:false,issuedAt:new Date().toISOString(),expiresAt:deadline,argumentsDigest:toolArgumentsDigest(settings)},binding);
 await measure('explicit_fixture_user_settings',()=>notificationHost.applyUserCommand(command,{taskId:anchor.taskId,runId:'fixture-user-settings',signal,deadline,authorizationRef:'explicit-fixture-host-settings',scopes:['notifications:settings'],argumentsDigest:toolArgumentsDigest(settings)}));
 runner=makeRunner();await runner.start('offline-mail',{signal,deadline});
 assert.equal((await runner.tick('offline-mail',{signal,deadline,limit:1})).state,'offline');
 assert.ok((await runner.status('offline-mail')).checkpoint.pending);assert.equal(sourceReads,1);
 const originalBatch=app.runtime.loadCheckpoint(anchor.taskId,batchKey);
 await runner.dispose();app.close();await openApp();runner=makeRunner();
 assert.equal((await runner.tick('offline-mail',{signal,deadline,limit:1})).recoveredPending,true);
 assert.equal(sourceReads,1,'restart drains original pending batch before a second source read');assert.equal(sinkAttempts,2);
 assert.deepEqual(app.runtime.loadCheckpoint(anchor.taskId,batchKey),originalBatch);
 const callImage=async input=>measure('image_http_advance',async()=>{
  const {taskId,controlRevision,taskDeadline,checkpoint,events,receipts,control}=input;
  const value={proactiveVersion:1,operation:'advance',taskId,controlRevision,taskDeadline,
   ...(checkpoint?{checkpoint}:{}),...(events?{events}:{}),...(receipts?{receipts}:{}),...(control?{control}:{}),
   hostFrame:proofs.sign('frame',{requestId:input.requestId,hostAvailability:{localDevice:true,cloudPersistentHost:true},availableCapabilities:capabilities},input)};
  const response=await fetch(endpoint,{method:'POST',signal:input.signal,headers:{'content-type':'application/json','x-pa-agent-token':'Bearer '+token,
   'x-hw-agentarts-session-id':input.sessionId,'x-request-id':input.requestId,'x-pa-deadline':input.deadline},body:JSON.stringify({query:JSON.stringify(value)})});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return JSON.parse(body[0].data.text);
 });
 const makeSession=()=>createProactiveWorkflowSession({atomicState:createRuntimeAtomicStatePort(app.runtime,'integration-proactive-session'),binding,
  assertActive:()=>{const actual=app.runtime.getTask(binding.taskId);
   // Public TaskSnapshot omits cancelRequested when false; true is the actual persisted cancellation marker.
   assert.notEqual(actual.cancelRequested,true);assert.ok(!['succeeded','failed','cancelled','cancelling'].includes(actual.state));},
  advancePort:callImage,verifyAdvance:(result,input)=>result.requestId===input.requestId&&proofs.verify('advance_result',result,input)});
 session=makeSession();
 const advance=delta=>session.advance({...binding,requestId:'integration-request-'+(++sequence),deadline,signal,...delta});
 const dispatch=async proposal=>{
  assert.deepEqual(session.inspect().state.proposals[proposal.proposalId],proposal,'image result committed before any host command');
  const capability=capabilities.find(c=>c.ref===proposal.capabilityRef);assert.ok(capability);assert.equal(proposal.taskDeadline,deadline);
  const submitted=app.submitHostToolTask({commandId:proposal.operationId,toolName:capability.ref,toolVersion:'1',arguments:proposal.arguments,deadline});
  app.runtime.saveCheckpointOnce(anchor.taskId,'integration:tool:'+proposal.operationId,{taskId:submitted.task.taskId,argumentsDigest:toolArgumentsDigest(proposal.arguments)});
  let actual;
  while(Date.now()<Date.parse(deadline)){
   actual=app.readHostToolTask(submitted.task.taskId);
   if(actual.task.state==='waiting_approval'){
    approved.push(proposal.operationId);await client.call('authorization.respond',{approvalId:actual.approval.approvalId,expectedRevision:actual.approval.revision,decision:'allow_once'});
   }
   if(['succeeded','failed','cancelled','waiting_reconciliation'].includes(actual.task.state))break;
   await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(actual.task.state,'succeeded',JSON.stringify(actual.task.error));assert.equal(actual.commandId,proposal.operationId);
  assert.equal(actual.toolName,capability.ref);assert.equal(actual.toolVersion,'1');
  const records=app.runtime.readToolExecutions(actual.task.taskId),record=records.find(r=>r.evidenceId===actual.confirmed.runId);
  assert.equal(record.state,'confirmed');assert.equal(record.executionStarted,true);assert.equal(record.policyDecision,'allow');
  assert.equal(app.runtime.matchesToolExecutionInput(record,{arguments:proposal.arguments,scopeRef:actual.confirmed.runId}),true);
  const evidence=app.runtime.readEvidence(actual.task.taskId);assert.ok(evidence.some(e=>actual.confirmed.evidenceRefs.includes(e.evidenceId)));
  hostTasks.push({taskId:actual.task.taskId,operationId:proposal.operationId,stage:proposal.stage,evidenceRefs:actual.confirmed.evidenceRefs});
  return proofs.sign('receipt',{proposalId:proposal.proposalId,operationId:proposal.operationId,argumentsDigest:proposal.argumentsDigest,state:'confirmed',
   result:actual.confirmed.result,observedAt:new Date().toISOString(),evidenceRefs:actual.confirmed.evidenceRefs},binding);
 };
 const event=originalBatch.events[0];
 const input=proofs.sign('event',{eventId:event.eventId,entry:'connector',conversationId:'offline-proactive',sourceId:event.sourceId,entityRef:event.item.externalId,
  sourceVersion:event.sourceRevision,observedAt:event.observedAt,change:'upsert',payloadRef:'sqlite:'+batchKey,payloadDigest:digest(event.item),
  anchorRefs:[originalBatch.batchId],responsibilityRefs:[],goalRefs:[],contractRef:contract.id,priority:'unknown',evidenceRefs:['sqlite:'+batchKey]},binding);
 let result=await advance({events:[input],control:proofs.sign('control',{commandId:'fixture-enter',action:'enter_unattended',evidenceRefs:['fixture-user-unattended-command']},binding)});
 const observed=[];
 while(result.proposals.length){
  assert.equal(result.proposals.length,1);observed.push(result.proposals[0].stage);
  const receipt=await dispatch(result.proposals[0]);result=await advance({receipts:[receipt]});
 }
 assert.deepEqual(observed,['retrieve','laya','teacher','action','update','wake']);assert.equal(Object.values(result.items)[0].state,'done');
 assert.deepEqual(models.map(m=>m.decidedBy),['laya','deepseek']);assert.ok(models.every(m=>m.verification==='mock'&&m.deployment==='fake'));
 assert.equal(approved.length,3,'notify/update/schedule use actual one-use Runtime approvals');assert.equal(notificationCalls,1);
 assert.equal(notificationHost.notificationFeed().items.length,1);assert.equal(notificationHost.getDigest({trigger:'on_return'}).interruptionCount,0);
 assert.equal(notificationHost.drain().batches.length,0);assert.equal(app.runtime.listSchedules('offline-proactive').length,1);
 const atomicNotifications=createRuntimeAtomicStatePort(app.runtime,'device-notifications').read('notifications:state');
 assert.deepEqual(atomicNotifications.value.interruption.rounds,{},'silent feed created no quota reservation');
 await runner.dispose();app.close();await openApp();runner=makeRunner();session=makeSession();
 result=await advance({events:[input],control:proofs.sign('control',{commandId:'fixture-return',action:'return',evidenceRefs:['fixture-user-return-command']},binding)});
 assert.equal(result.returnSummary.changed.length,1);assert.equal(result.returnSummary.replayedNotifications,0);assert.equal(result.proposals.length,0);
 const firstReturnId='integration-request-'+sequence;
 const replay=await session.advance({...binding,requestId:firstReturnId,deadline,signal,events:[input],control:proofs.sign('control',{commandId:'fixture-return',action:'return',evidenceRefs:['fixture-user-return-command']},binding)});
 assert.deepEqual(replay,result);result=await advance({control:proofs.sign('control',{commandId:'fixture-return-again',action:'return',evidenceRefs:['fixture-user-return-again-command']},binding)});
 assert.equal(result.returnSummary.newEvidenceOperationIds.length,0);assert.equal(result.proposals.length,0);assert.equal(notificationCalls,1);
 assert.equal(notificationHost.notificationFeed().items.length,1);assert.equal(app.runtime.listSchedules('offline-proactive').length,1);assert.equal(hostTasks.length,6);
 assert.equal((await runner.tick('offline-mail',{signal,deadline,limit:1})).state,'no_changes');assert.equal(sourceReads,2);
 assert.ok(timings.every(e=>e.startedAtUtc&&e.finishedAtUtc&&Number.isFinite(e.wallMs)&&e.wallMs>=0));
 assert.ok(connectorTimings.every(e=>e.startedAt&&e.endedAt&&Number.isFinite(e.durationMs)));
 assert.ok(imageTimings.some(e=>e.stage==='advance'));assert.ok(imageTimings.every(e=>e.startedAtUtc&&e.finishedAtUtc&&Number.isFinite(e.wallMs)));
 assert.ok(notificationPoints.some(e=>e.stage==='silent_notifications_retained_in_feed'));
 t.diagnostic(JSON.stringify({verification:'offline_fixture_integration',models,hostTasks:hostTasks.length,approvals:approved.length,notificationCalls,
  actualStageTimings:timings,imageStageTimings:imageTimings,connectorStageTimings:connectorTimings,notificationStagePoints:notificationPoints.map(({stage,observedAt})=>({stage,observedAt}))}));
});

test('waiting reply remains independent of actual child feedback and due wake; correction and retraction retain pending source versions',async t=>{
 await mkdir(join(process.cwd(),'.cache'),{recursive:true});const directory=await mkdtemp(join(process.cwd(),'.cache','proactive-feedback-'));
 const runtime=new TaskRuntime(join(directory,'runtime.sqlite'));t.after(async()=>{runtime.close();await rm(directory,{recursive:true,force:true});});
 const anchor=runtime.submitTask({goal:'Explicit source feedback fixture',conversationId:'feedback',idempotencyKey:'anchor'});
 const child=runtime.submitTaskWithCheckpoint({goal:'Explicit fixture child',conversationId:'feedback',idempotencyKey:'child'},'subtask-parent',{parentTaskId:anchor.taskId,subtaskId:'fixture-child'});
 const binding={taskId:anchor.taskId,sessionId:'feedback-session',controlRevision:1,taskDeadline:new Date(Date.now()+60000).toISOString()},signal=new AbortController().signal;
 const proofs=createProactiveHostProofs(secret),choices=['request_user','delegate','defer'];
 const controller=createProactiveWorkflowController({receiptSecret:secret,decisionContracts:[{id:'feedback',version:'1',criteria:'Use persisted state',qualifiedForMain:false,batchIndependent:true,
  candidates:choices.map(action=>({id:action,description:action,action}))}]});
 const caps=['retrieve_context','local_decision_batch','teacher_decision','request_user','delegate','update_item'].map(kind=>({kind,ref:'fixture.'+kind,location:'local_device',effect:['retrieve_context','local_decision_batch','teacher_decision'].includes(kind)?'read':'write'}));
 const session=createProactiveWorkflowSession({binding,atomicState:createRuntimeAtomicStatePort(runtime,'feedback-fixture'),assertActive:()=>assert.equal(runtime.getTask(anchor.taskId).state,'created'),
  advancePort:input=>controller({sessionId:input.sessionId,requestId:input.requestId,deadline:input.deadline,signal:input.signal,value:{proactiveVersion:1,operation:'advance',
   taskId:input.taskId,controlRevision:input.controlRevision,taskDeadline:input.taskDeadline,...(input.checkpoint?{checkpoint:input.checkpoint}:{}),events:input.events??[],receipts:input.receipts??[],
   hostFrame:proofs.sign('frame',{requestId:input.requestId,hostAvailability:{localDevice:true,cloudPersistentHost:false},availableCapabilities:caps},binding)}}),
  verifyAdvance:(result,input)=>result.requestId===input.requestId&&proofs.verify('advance_result',result,binding)});
 let sequence=0;
 const advance=delta=>session.advance({...binding,deadline:binding.taskDeadline,signal,requestId:'feedback-'+(++sequence),...delta});
 const event=(id,sourceId,entry='connector',extra={})=>{
  const stored={eventId:id,entry,conversationId:'feedback',sourceId,entityRef:'entity',sourceVersion:'1',observedAt:new Date().toISOString(),change:'upsert',
   payloadRef:'sqlite:fixture-source:'+id,payloadDigest:digest(id),anchorRefs:['fixture-source:'+id],responsibilityRefs:[],goalRefs:[],contractRef:'feedback',priority:'important',evidenceRefs:['fixture-source:'+id],...extra};
  runtime.saveCheckpointOnce(anchor.taskId,'fixture-source:'+id,stored);return proofs.sign('event',stored,binding);
 };
 // Receipts below are explicitly synthetic decision/host-result fixtures. Actual child/Scheduler state is read from Runtime.
 const ack=(proposal,result)=>proofs.sign('receipt',{proposalId:proposal.proposalId,operationId:proposal.operationId,argumentsDigest:proposal.argumentsDigest,
  state:'confirmed',result,observedAt:new Date().toISOString(),evidenceRefs:['fixture-host-readback:'+proposal.operationId]},binding);
 const context=(proposal,extra={})=>({contextRef:'sqlite:context:'+proposal.operationId,sourceVersions:{[proposal.arguments.source.sourceId]:proposal.arguments.source.version},
  sourceQuotes:[],goalRefs:[],memoryRefs:[],experienceRefs:[],scopeRefs:[],...extra});
 const select=(proposal,stage,result)=>ack(proposal,{selections:proposal.itemIds.map(itemId=>({itemId,candidateId:result.items[itemId].sourceId==='mail'?'request_user':'delegate',
  decisionRef:'fixture-model:'+proposal.operationId,decidedBy:stage==='laya'?'laya':'deepseek',uncertain:false,complex:false,importance:'important',authorityRequired:false}))});
 let result=await advance({events:[event('mail-inbound','mail'),event('ci-inbound','ci')]});assert.equal(result.proposals.length,2);
 result=await advance({receipts:result.proposals.map(p=>ack(p,context(p)))});assert.equal(result.proposals[0].stage,'laya');
 result=await advance({receipts:result.proposals.map(p=>select(p,'laya',result))});assert.equal(result.proposals[0].stage,'teacher');
 result=await advance({receipts:result.proposals.map(p=>select(p,'teacher',result))});
 const mailItem=Object.values(result.items).find(i=>i.sourceId==='mail').itemId,ciItem=Object.values(result.items).find(i=>i.sourceId==='ci').itemId;
 result=await advance({receipts:result.proposals.map(p=>ack(p,{status:p.itemIds[0]===mailItem?'waiting_user':'pending',resultRef:p.itemIds[0]===mailItem?'fixture:waiting-original-user':'task:'+child.taskId}))});
 for(const p of result.proposals)runtime.saveCheckpoint(anchor.taskId,'fixture-item:'+p.itemIds[0],p.arguments);
 result=await advance({receipts:result.proposals.map(p=>ack(p,{itemId:p.itemIds[0],stateRef:'sqlite:fixture-item:'+p.itemIds[0]}))});
 assert.equal(result.items[mailItem].state,'waiting_user');assert.equal(result.items[ciItem].state,'waiting_host');
 const completed=await runtime.runTask(child.taskId,async()=>({resultSummary:'Explicit offline child finished'}),{deadline:binding.taskDeadline});
 assert.equal(completed.state,'succeeded');assert.equal(runtime.loadCheckpoint(child.taskId,'subtask-parent').parentTaskId,anchor.taskId);
 const actual=runtime.getTask(child.taskId);
 result=await advance({events:[event('actual-child-feedback','child:'+child.taskId,'subtask_feedback',{sourceVersion:String(actual.revision),payloadRef:'task:'+actual.taskId})]});
 result=await advance({receipts:result.proposals.map(p=>ack(p,context(p,{itemReadbacks:[{itemId:ciItem,status:'completed',resultRef:'task:'+actual.taskId}]})))});
 assert.equal(result.items[ciItem].state,'done');assert.equal(result.items[mailItem].state,'waiting_user','waiting for user does not block child completion');
 const due=runtime.createSchedule({scheduleId:'fixture-expiry',goal:'Refresh expired responsibility',conversationId:'feedback',runAt:new Date(Date.now()-1000).toISOString(),
  timeZone:'UTC',missedRunPolicy:'run_once',taskIdempotencyKey:'fixture-expiry'});
 assert.equal(runtime.dispatchDueSchedules('feedback').length,1);assert.equal(runtime.getSchedule(due.scheduleId).status,'fired');assert.deepEqual(runtime.dispatchDueSchedules('feedback'),[]);
 result=await advance({events:[event('actual-due-wake','schedule:'+due.scheduleId,'wake',{expiresAt:new Date(Date.now()-1).toISOString()})]});
 assert.ok(result.proposals.some(p=>p.stage==='retrieve'&&p.arguments.needsRefresh));
 const correction=event('mail-correction','mail','connector',{sourceVersion:'2',previousVersion:'1',change:'correction'});
 result=await advance({events:[correction,correction]});const changed=Object.values(result.items).find(i=>i.sourceId==='mail'&&i.sourceVersion==='2');
 assert.ok(changed);assert.equal(Object.values(result.items).filter(i=>i.sourceId==='mail'&&i.sourceVersion==='2').length,1);
 assert.equal(result.items[mailItem].state,'blocked','superseded waiting reply is retained, not presented as current');
 result=await advance({events:[event('mail-retract','mail','connector',{sourceVersion:'3',previousVersion:'2',change:'retract'})]});
 assert.equal(result.items[changed.itemId].state,'waiting_reconciliation','do not replay outstanding old-version operation');
 assert.ok(Object.values(result.items).some(i=>i.sourceId==='mail'&&i.sourceVersion==='3'));
 assert.equal(result.items[ciItem].state,'done');
});
