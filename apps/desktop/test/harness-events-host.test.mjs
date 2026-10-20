import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TaskRuntime,createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {Client} from '@personal-agent/client';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {proactiveWorkflowDigest as digest} from '@personal-agent/agentarts';
import {readPersistedRuntimeProactiveWorkflow} from '../../runtime/dist/application/proactive-workflow-application.js';
import {readPersistedHarnessOriginalDelivery} from '../../runtime/dist/application/harness-events.js';
import {createDesktopHarnessEventsHost} from '../electron/harness-events-host.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const image=configured=>sha(JSON.stringify({contractRef:configured.contractRef,gatewayUrl:configured.adapter.config.gatewayUrl,
  runtimeName:configured.adapter.config.runtimeName,websocketUrl:configured.adapter.config.websocketUrl,
  deploymentVersion:configured.adapter.config.deploymentVersion,invokeMode:'published'}));

async function fixture(t,{unknown=false,kind='connector',sourceChild=false,wakeConversation='desktop-panel',workflowConversation='desktop-panel'}={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'pa-native-harness-'));
  let gateway;
  const runtime=new TaskRuntime(path.join(directory,'runtime.sqlite'),{createToolGateway:policy=>{
    gateway=new ToolGateway({policy});return gateway;
  }});let adapter;
  t.after(async()=>{await adapter?.close();runtime.close();await rm(directory,{recursive:true,force:true});});
  const tracking=runtime.submitTask({goal:'Track this public feed and continue my work',conversationId:'desktop-panel',idempotencyKey:'source'});
  let source=tracking;
  if(sourceChild) {
    runtime.transitionTask(tracking.taskId,'planning');runtime.transitionTask(tracking.taskId,'running');
    runtime.transitionTask(tracking.taskId,'verifying');runtime.transitionTask(tracking.taskId,'succeeded');
    source=runtime.submitTask({goal:tracking.goal,conversationId:'desktop-subtask:'+tracking.taskId,idempotencyKey:'source-owner'});
    runtime.saveCheckpointOnce(source.taskId,'subtask-parent',{parentTaskId:tracking.taskId,subtaskId:'user-work'});
  }
  runtime.transitionTask(source.taskId,'planning');runtime.transitionTask(source.taskId,'running');
  runtime.transitionTask(source.taskId,'verifying');runtime.transitionTask(source.taskId,'succeeded');
  const hostTask=runtime.submitTask({goal:source.goal,conversationId:workflowConversation,idempotencyKey:'workflow'});
  runtime.transitionTask(hostTask.taskId,'planning');runtime.transitionTask(hostTask.taskId,'running');
  const deadline=new Date(Date.now()+120000).toISOString(),grantDeadline=new Date(Date.now()+90000).toISOString();
  let configured={contractRef:'contract',adapter:{config:{gatewayUrl:'https://fixture.invalid',runtimeName:'fixture',deploymentVersion:'v1'}}};
  let configurationRef='configuration-v1',grantState='granted',grantRevision=1,notificationRevision=1,quiet=false,submissions=0,acquisitions=0,
    nativeEnabled=true,nativeRevision='native-v1',nativeProof=true,nativeProofRevision=1,developerAllowed=true,developerRevision=1;
  const binding={version:1,taskId:hostTask.taskId,sessionId:'original-session',sourceTaskId:source.taskId,
    taskDeadline:deadline,contractRef:'contract',contractVersion:'1',imageBinding:image(configured)};
  const responsibility={id:'instruction:'+source.taskId,revision:1,conversationId:'desktop-panel',authority:'explicit_instruction',scopeRefs:[],goalRefs:[],
    sourceQuotes:[{conversationId:source.conversationId,messageId:source.taskId,quoteRef:'runtime:task:'+source.taskId+':goal',sha256:sha(source.goal)}]};
  const payload={eventId:'confirmed-feed-fixture',kind:'source.changed',sourceId:'feed',connectorId:'feeds',sourceKind:'feeds',
    sourceRevision:'version-1',item:{dedupeKey:'item',title:'Explicit public fixture'},observedAt:new Date().toISOString()};
  const event={eventId:payload.eventId,entry:kind,conversationId:'desktop-panel',sourceId:'feed',entityRef:'item',sourceVersion:'version-1',
    observedAt:payload.observedAt,change:'upsert',payloadRef:'runtime:proactive-batch:fixture:'+payload.eventId,payloadDigest:digest(payload.item),
    anchorRefs:[],responsibilityRefs:[responsibility.id],goalRefs:[],contractRef:'contract',priority:'normal',evidenceRefs:['runtime:proactive-batch:fixture']};
  const nativeHead={eventId:event.eventId,revision:event.sourceVersion};
  const state={version:1,binding:{taskId:hostTask.taskId,sessionId:binding.sessionId,taskDeadline:deadline,controlRevision:0},
    conversationId:'desktop-panel',contractRef:'contract',entries:{[event.eventId]:{event,payload}},responsibilities:{[responsibility.id]:responsibility},
    batches:{fixture:{batchId:'fixture',sourceId:'feed',events:[payload],observedAt:payload.observedAt}},schedules:{},requests:{}};
  const atomic=createRuntimeAtomicStatePort(runtime,'runtime-proactive-workflows');
  atomic.storage.set('application:'+digest([binding.taskId,binding.sessionId]),state);
  atomic.storage.set('proactive.session:'+digest({taskId:binding.taskId,sessionId:binding.sessionId}),
    {version:1,binding:state.binding,requests:{},proposals:{},operations:{}});
  if(kind==='wake') {
    const operationId='wake-operation',proposalId='wake-proposal',args={sessionId:binding.sessionId,proposalId};
    const proposal={operationId,proposalId,capabilityRef:'proactive.schedule_wake',capabilityKind:'schedule_wake',
      arguments:{wake:{runAt:new Date(Date.now()-1000).toISOString(),reason:'Original native wake',timeZone:'UTC',missedRunPolicy:'run_once'},
        taskIdempotencyKey:'original-wake-task'}};
    gateway.register({descriptor:{name:'proactive.schedule_wake',version:'1.0.0',inputSchema:{type:'object'},outputSchema:{},
      sideEffect:'local_write',requiredScopes:['schedule:write'],idempotencySupport:true,recoverySupport:true,requiresPresence:false},
      execute:async()=>({scheduleId:runtime.createSchedule({scheduleId:operationId,goal:proposal.arguments.wake.reason,
        conversationId:wakeConversation,runAt:proposal.arguments.wake.runAt,timeZone:'UTC',missedRunPolicy:'run_once',
        taskIdempotencyKey:proposal.arguments.taskIdempotencyKey}).scheduleId})});
    runtime.policy.grant({authorizationRef:operationId,taskId:hostTask.taskId,toolName:'proactive.schedule_wake',
      scopes:['schedule:write'],expiresAt:deadline,argumentsDigest:toolArgumentsDigest(args)});
    const client=new Client(runtime);await client.connect();
    const result=await client.call('tool.invoke',{toolName:'proactive.schedule_wake',toolVersion:'1.0.0',arguments:args,scopeRef:operationId},
      {taskId:hostTask.taskId,idempotencyKey:operationId});assert.equal(result.state,'confirmed');
    runtime.dispatchDueSchedules(wakeConversation);const schedule=runtime.getSchedule(operationId);
    Object.assign(event,{eventId:'runtime-wake:'+operationId,sourceId:'runtime:scheduler',entityRef:operationId,
      sourceVersion:digest(schedule),payloadRef:'runtime:schedule:'+operationId,payloadDigest:digest(schedule),responsibilityRefs:[]});
    state.entries={[event.eventId]:{event,payload:schedule}};state.schedules[operationId]=digest(proposal.arguments);
    atomic.storage.set('application:'+digest([binding.taskId,binding.sessionId]),state);
    atomic.storage.set('proactive.session:'+digest({taskId:binding.taskId,sessionId:binding.sessionId}),
      {version:1,binding:state.binding,requests:{},proposals:{[proposalId]:proposal},operations:{}});
  }
  const listeners=new Set();
  const workflow={maintenancePage:()=>({items:[{binding:structuredClone(binding),state:runtime.getTask(binding.taskId).state,
    conversationId:'desktop-panel',withheld:false}],snapshotSequence:1}),
    async acquireMaintenance(){acquisitions++;return {binding:structuredClone(binding),host:{taskId:binding.taskId,sessionId:binding.sessionId,
      get binding(){return readPersistedRuntimeProactiveWorkflow(runtime,binding.taskId,binding.sessionId).application.state.binding;},
      inspect:()=>readPersistedRuntimeProactiveWorkflow(runtime,binding.taskId,binding.sessionId),
      subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}}};}};
  const resolveUserConversation=id=>{
    const task=runtime.getTask(id);return task.conversationId.startsWith('desktop-subtask:')?'desktop-panel':task.conversationId;
  };
  // The native handoff is explicit Fake; all tasks, original checkpoints and H6 ledger use real SQLite.
  const parentReads=[];
  const application={runtime,readSubagentConversation(input){
    assert.equal(runtime.loadCheckpoint(input.taskId,'subtask-parent')?.parentTaskId,input.parentTaskId);parentReads.push(input);
  },submitHarnessEventTask(input){submissions++;
    const root=runtime.submitTaskWithCheckpoint({goal:input.goal,conversationId:input.conversationId,idempotencyKey:input.idempotencyKey},
      'harness-event-origin',input.origin);
    adapter.assertHarnessEventCurrent(root.taskId,input.origin);
    if(!unknown) {
      runtime.saveCheckpointOnce(root.taskId,'required-subagent-delegation:v1',{parentTaskId:root.taskId,subtask:{subtaskId:'user-work'}});
      const child=runtime.submitTask({goal:'Original user-work',conversationId:'desktop-subtask:'+root.taskId,
        idempotencyKey:'subagent-dispatch-'+root.taskId+'-user-work'});
      runtime.saveCheckpointOnce(child.taskId,'subtask-parent',{parentTaskId:root.taskId,subtaskId:'user-work'});
    }
    return runtime.getTask(root.taskId);
  }};
  const options={getApplication:()=>application,getWorkflow:()=>workflow,namespace:'fixture',resolveUserConversation,
    readConfigurationRef:()=>configurationRef,readWorkflowConfiguration:()=>configured,
    readNativeConfiguration:()=>({version:1,revision:nativeRevision,enabled:true,events:{enabled:nativeEnabled,quiet:false}}),
    // Explicit native router/developer authority fixtures, independent of the durable H6 batch.
    readSourceOrigin:()=>({receiptId:'original-native-receipt',batchId:'fixture',origin:{taskId:tracking.taskId,runId:'original-source-read'},
      selection:{grantExpiresAt:grantDeadline,grantRevision:1}}),
    readSourceAuthorization:(_taskId,value)=>nativeProof&&value.eventId===nativeHead.eventId&&value.sourceVersion===nativeHead.revision
      ?{expiresAt:grantDeadline,fence:'original-confirmed-policy-source-'+nativeProofRevision}:undefined,
    readDeveloperHarnessConfiguration:()=>developerAllowed?{workspaceRef:'native-workspace',maxExecutorSteps:7,
      configurationRef:'native-developer-'+developerRevision,assertCurrent(){if(!developerAllowed)throw Error('Native workspace revoked');}}:undefined,
    readPersistedWorkflow:readPersistedRuntimeProactiveWorkflow,readPersistedDelivery:readPersistedHarnessOriginalDelivery,
    getNotifications:()=>({snapshot:()=>({available:true,policy:{state:'configured',revision:notificationRevision,local:{},
      effective:{mode:'normal'},constraints:[]},status:{pausedUntil:null,quietUntil:quiet?deadline:null}})}),
    readSourceBinding:()=>({namespace:'fixture',sourceId:'feed',available:true,sensitivity:'public',containsCredentials:false,configurationRef:'feed-config'}),
    readTrackingGrant:()=>({state:grantState,id:'native-grant',revision:grantRevision,namespace:'fixture',publicLowRiskTracking:true,
      sourceId:'feed',configurationRef:'feed-config',taskId:tracking.taskId,conversationId:'desktop-panel',purposeDigest:digest(tracking.goal),expiresAt:grantDeadline})};
  adapter=createDesktopHarnessEventsHost(options);
  const context={signal:new AbortController().signal,deadline};
  const ledger=()=>{
    const store=runtime.bindTrustedHostState('runtime-harness-events');
    // Public TaskRuntime host state is read by its known original event identity below.
    const scope=sha(JSON.stringify([binding.taskId,binding.sessionId]));
    const key='delivery:'+sha(JSON.stringify([scope,event.sourceId,event.entityRef,event.sourceVersion]));
    return store.get(key)?.value;
  };
  return {runtime,source,tracking,parentReads,hostTask,binding,context,adapter,options,ledger,state,event,atomic,workflow,
    counts:()=>({submissions,acquisitions}),revoke(){grantState='revoked';grantRevision++;},
    quiet(){quiet=true;notificationRevision++;},changeConfiguration(){configurationRef='configuration-v2';configured={...configured,adapter:{config:{...configured.adapter.config,deploymentVersion:'v2'}}};},
    disable(){nativeEnabled=false;nativeRevision='native-v2';},
    denySourceProof(){nativeProof=false;},changeSourceProof(){nativeProofRevision++;},
    denyDeveloper(){developerAllowed=false;},changeDeveloper(){developerRevision++;},
    save(){atomic.storage.set('application:'+digest([binding.taskId,binding.sessionId]),state);}};
}

test('Main adapter consumes original public events through real H6/SQLite and checks native authority before handoff',async t=>{
  const f=await fixture(t);await f.adapter.start(f.binding.taskId,f.context);
  assert.equal(f.ledger().state,'confirmed');assert.equal(f.counts().submissions,1);
  const origin=f.runtime.loadCheckpoint(f.ledger().receipt.parentTaskId,'harness-event-origin');
  f.adapter.assertHarnessEventCurrent(f.ledger().receipt.parentTaskId,origin);
  await f.adapter.flush();assert.equal(f.counts().submissions,1);
  f.revoke();assert.throws(()=>f.adapter.assertHarnessEventCurrent(f.ledger().receipt.parentTaskId,origin));
});

test('startup and waiting delivery reads are synchronous, preserve unknown and never reacquire or dispatch',async t=>{
  const f=await fixture(t,{unknown:true});await f.adapter.start(f.binding.taskId,f.context);
  assert.equal(f.ledger().state,'pending');assert.equal(f.counts().submissions,1);
  const root=f.runtime.findTaskByIdempotencyKey('harness-event-root:'+f.ledger().deliveryId);
  const origin=f.runtime.loadCheckpoint(root.taskId,'harness-event-origin');
  const request={taskId:root.taskId,expectedRevision:root.revision,conversationId:'desktop-panel',origin,phase:'created_root'};
  const counts=f.counts(),scope=f.adapter.canResumeHarnessEvent(request);assert.ok(scope);
  assert.equal(typeof scope.then,'undefined');assert.equal(scope.configurationRef,'configuration-v1');scope.assertCurrent();
  assert.deepEqual(f.counts(),counts);await f.adapter.flush();assert.equal(f.counts().submissions,1);
  assert.equal(f.ledger().state,'pending');
  f.runtime.transitionTask(root.taskId,'planning');f.runtime.transitionTask(root.taskId,'running');
  f.runtime.transitionTask(root.taskId,'waiting_reconciliation');
  const waitingRequest={...request,expectedRevision:f.runtime.getTask(root.taskId).revision,phase:'continuation'};
  const waitingScope=f.adapter.canResumeHarnessEvent(waitingRequest);assert.ok(waitingScope);waitingScope.assertCurrent();
  await f.adapter.flush();assert.equal(f.runtime.getTask(root.taskId).state,'waiting_reconciliation');assert.deepEqual(f.counts(),counts);
  f.quiet();assert.throws(()=>waitingScope.assertCurrent());assert.equal(f.adapter.canResumeHarnessEvent(waitingRequest),undefined);
  assert.equal(f.ledger().state,'pending');assert.equal(f.counts().submissions,1);
});

test('configuration, responsibility quote and cross-conversation drift reject an original root',async t=>{
  const f=await fixture(t,{unknown:true});await f.adapter.start(f.binding.taskId,f.context);
  const root=f.runtime.findTaskByIdempotencyKey('harness-event-root:'+f.ledger().deliveryId);
  const origin=f.runtime.loadCheckpoint(root.taskId,'harness-event-origin');
  assert.throws(()=>f.adapter.assertHarnessEventCurrent(root.taskId,{...origin,sourceTaskId:'foreign'}));
  const scope=f.adapter.canResumeHarnessEvent({taskId:root.taskId,expectedRevision:root.revision,conversationId:'desktop-panel',origin,phase:'created_root'});
  assert.equal(f.adapter.canResumeHarnessEvent({taskId:root.taskId,expectedRevision:root.revision,conversationId:'foreign',origin,phase:'created_root'}),undefined);
  const responsibility=Object.values(f.state.responsibilities)[0];responsibility.sourceQuotes[0].sha256='a'.repeat(64);f.save();
  assert.throws(()=>f.adapter.assertHarnessEventCurrent(root.taskId,origin));
  responsibility.sourceQuotes[0].sha256=sha(f.source.goal);f.save();
  f.changeConfiguration();assert.throws(()=>scope.assertCurrent());assert.throws(()=>f.adapter.assertHarnessEventCurrent(root.taskId,origin));
  assert.equal(f.counts().submissions,1);
});

test('unsupported producers and quiet native control never dispatch',async t=>{
  const f=await fixture(t,{kind:'unsupported'});await f.adapter.start(f.binding.taskId,f.context);assert.equal(f.counts().submissions,0);
  const quiet=await fixture(t);quiet.quiet();await quiet.adapter.start(quiet.binding.taskId,quiet.context);
  assert.equal(quiet.ledger().state,'suppressed');assert.equal(quiet.ledger().reason,'quiet');assert.equal(quiet.counts().submissions,0);
  const disabled=await fixture(t);disabled.disable();await disabled.adapter.start(disabled.binding.taskId,disabled.context);
  assert.equal(disabled.ledger().reason,'disabled');assert.equal(disabled.counts().submissions,0);
  const unsupported=await fixture(t);unsupported.state.entries[unsupported.event.eventId].payload.connectorId='unregistered';unsupported.save();
  await unsupported.adapter.start(unsupported.binding.taskId,unsupported.context);
  assert.equal(unsupported.counts().submissions,0);assert.equal(unsupported.adapter.snapshot().consumers[0].lastError,'UNSUPPORTED_CAPABILITY');
});

test('stop during native maintenance acquisition cannot attach a late event consumer',async t=>{
  const f=await fixture(t);const acquire=f.workflow.acquireMaintenance;let release,entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  f.workflow.acquireMaintenance=async(...args)=>{entered();await new Promise(resolve=>{release=resolve;});return acquire(...args);};
  const starting=f.adapter.start(f.binding.taskId,f.context);await waiting;await f.adapter.stop();release();
  await assert.rejects(starting,{code:'CANCELLED'});assert.equal(f.counts().submissions,0);assert.equal(f.ledger(),undefined);
});

test('wake dispatch requires the original fired schedule and confirmed Policy/Gateway proposal',async t=>{
  const f=await fixture(t,{kind:'wake'});await f.adapter.start(f.binding.taskId,f.context);
  assert.equal(f.ledger().state,'confirmed');assert.equal(f.counts().submissions,1);
  const origin=f.runtime.loadCheckpoint(f.ledger().receipt.parentTaskId,'harness-event-origin');
  f.adapter.assertHarnessEventCurrent(f.ledger().receipt.parentTaskId,origin);
  f.state.schedules[f.event.entityRef]='substituted-proposal';f.save();
  assert.throws(()=>f.adapter.assertHarnessEventCurrent(f.ledger().receipt.parentTaskId,origin));
  assert.equal(f.counts().submissions,1);
});

test('Synthetic wake from canonical user-work keeps the original workflow user conversation',async t=>{
  const f=await fixture(t,{kind:'wake',sourceChild:true});await f.adapter.start(f.binding.taskId,f.context);
  assert.notEqual(f.source.conversationId,f.hostTask.conversationId);
  assert.equal(f.ledger().state,'confirmed');assert.equal(f.counts().submissions,1);
  const root=f.ledger().receipt.parentTaskId,origin=f.runtime.loadCheckpoint(root,'harness-event-origin');
  assert.equal(origin.sourceTaskId,f.source.taskId);assert.equal(origin.originalParentTaskId,f.tracking.taskId);
  f.adapter.assertHarnessEventCurrent(root,origin);
  assert.ok(f.parentReads.some(value=>value.parentTaskId===f.tracking.taskId&&value.taskId===f.source.taskId));
  f.runtime.saveCheckpoint(f.source.taskId,'private-copy-erasure',{withheld:true});
  assert.throws(()=>f.adapter.assertHarnessEventCurrent(root,origin),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(f.counts().submissions,1);
});

test('Synthetic wake rejects a confirmed schedule or workflow from another user conversation',async t=>{
  const wrongSchedule=await fixture(t,{kind:'wake',sourceChild:true,wakeConversation:'foreign-ui'});
  await wrongSchedule.adapter.start(wrongSchedule.binding.taskId,wrongSchedule.context);
  assert.equal(wrongSchedule.counts().submissions,0);
  assert.equal(wrongSchedule.adapter.snapshot().consumers[0].lastError,'UNAUTHORIZED');
  const wrongWorkflow=await fixture(t,{kind:'wake',sourceChild:true,workflowConversation:'foreign-ui'});
  await assert.rejects(wrongWorkflow.adapter.start(wrongWorkflow.binding.taskId,wrongWorkflow.context),{code:'UNAUTHORIZED'});
  assert.equal(wrongWorkflow.counts().submissions,0);
});

test('Synthetic equal observation times admit only the exact native router head',async t=>{
  const f=await fixture(t,{unknown:true}),current=f.state.entries[f.event.eventId];
  const older=structuredClone(current);older.event.eventId='older-confirmed-feed';older.event.sourceVersion='version-0';
  older.event.payloadRef='runtime:proactive-batch:fixture:'+older.event.eventId;
  older.payload.eventId=older.event.eventId;older.payload.sourceRevision=older.event.sourceVersion;
  f.state.entries={[older.event.eventId]:older,[f.event.eventId]:current};
  f.state.batches.fixture.events.unshift(older.payload);f.save();
  assert.equal(older.event.observedAt,f.event.observedAt);
  assert.equal(f.options.readSourceAuthorization(f.binding.taskId,older.event),undefined);
  assert.ok(f.options.readSourceAuthorization(f.binding.taskId,f.event));
  await f.adapter.start(f.binding.taskId,f.context);
  assert.equal(f.ledger().state,'pending');assert.equal(f.counts().submissions,1);
  const root=f.runtime.findTaskByIdempotencyKey('harness-event-root:'+f.ledger().deliveryId);
  f.adapter.assertHarnessEventCurrent(root.taskId,f.runtime.loadCheckpoint(root.taskId,'harness-event-origin'));
  const deliveries=f.runtime.bindTrustedHostState('runtime-harness-events');
  const key='delivery:'+sha(JSON.stringify([sha(JSON.stringify([f.binding.taskId,f.binding.sessionId])),
    older.event.sourceId,older.event.entityRef,older.event.sourceVersion]));
  assert.equal(deliveries.get(key).value.state,'suppressed');
  f.denySourceProof();assert.throws(()=>f.adapter.assertHarnessEventCurrent(root.taskId,f.runtime.loadCheckpoint(root.taskId,'harness-event-origin')));
  assert.equal(f.counts().submissions,1);
});

test('native source provenance resolves the actual user-work parent and cannot be replaced by a durable batch alone',async t=>{
  const f=await fixture(t,{unknown:true,sourceChild:true});await f.adapter.start(f.binding.taskId,f.context);
  assert.equal(f.ledger().state,'pending');
  const root=f.runtime.findTaskByIdempotencyKey('harness-event-root:'+f.ledger().deliveryId);
  const origin=f.runtime.loadCheckpoint(root.taskId,'harness-event-origin');
  assert.equal(origin.sourceTaskId,f.source.taskId);assert.equal(origin.originalParentTaskId,f.tracking.taskId);
  assert.ok(f.parentReads.some(value=>value.parentTaskId===f.tracking.taskId&&value.taskId===f.source.taskId));
  f.adapter.assertHarnessEventCurrent(root.taskId,origin);f.denySourceProof();
  assert.throws(()=>f.adapter.assertHarnessEventCurrent(root.taskId,origin));
  assert.equal(f.counts().submissions,1);assert.equal(f.ledger().state,'pending');
});

test('original created native fence rejects router Evidence, developer workspace and ledger revision drift',async t=>{
  for(const change of ['changeSourceProof','changeDeveloper','denyDeveloper','ledger']) {
    const f=await fixture(t,{unknown:true});await f.adapter.start(f.binding.taskId,f.context);
    const root=f.runtime.findTaskByIdempotencyKey('harness-event-root:'+f.ledger().deliveryId);
    const origin=f.runtime.loadCheckpoint(root.taskId,'harness-event-origin');
    const scope=f.adapter.canResumeHarnessEvent({taskId:root.taskId,expectedRevision:root.revision,conversationId:'desktop-panel',origin,phase:'created_root'});
    assert.ok(scope);scope.assertCurrent();
    if(change==='ledger') {
      const store=createRuntimeAtomicStatePort(f.runtime,'runtime-harness-events');
      const key='delivery:'+sha(JSON.stringify([sha(JSON.stringify([f.binding.taskId,f.binding.sessionId])),f.event.sourceId,f.event.entityRef,f.event.sourceVersion]));
      const saved=store.read(key);assert.equal(store.compareAndSet(key,saved.revision,saved.value),true);
    }else f[change]();
    assert.throws(()=>scope.assertCurrent());assert.equal(f.counts().submissions,1);
  }
});
