import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createWindowsDesktopControlHost} from '@personal-agent/windows-client';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createDesktopWindowsControlHost} from '../electron/windows-control-host.js';
import {createToolPresenceHost} from '../electron/tool-presence-host.js';

const clock=Date.parse('2026-10-18T20:00:00.000Z');
const context=(overrides={})=>({taskId:'task-1',runId:'run-1',deadline:new Date(clock+60000).toISOString(),signal:new AbortController().signal,authorizationRef:'grant-1',scopes:['computer:desktop:request'],...overrides});
function fixture(overrides={}){
  let confirmation,providerOptions,reads=0,releases=0,blocked=false;
  const checkpoints=new Map();
  const provider={tools:[{descriptor:{name:'computer.desktop.observe',version:'1.0.0',outputSchema:{type:'object'},requiresPresence:true}}],
    start:async()=>{},dispose:async()=>{},block(){blocked=true;},health:()=>({state:blocked?'blocked':'ready'})};
  const host=createDesktopWindowsControlHost({createControlHost:options=>{providerOptions=options;return provider;},allowObservationExport:true,now:()=>clock,
    registerConfirmation:callback=>{confirmation=callback;return()=>{releases++;};},...overrides});
  const application={runtime:{listTasks:()=>({items:[]}),readToolExecutions:()=>[],getTask:()=>({state:'running'}),
    loadCheckpoint:()=>new Date(clock+60000).toISOString(),matchesToolExecutionInput:()=>true,
    saveCheckpointOnce(taskId,key,value){const id=taskId+key;if(checkpoints.has(id))return false;checkpoints.set(id,value);return true;}}};
  host.bind(application);
  return {host,provider,application,confirm:()=>confirmation(),get options(){return providerOptions;},get releases(){return releases;},checkpoints};
}
test('request access waits for an actual local gesture without any upstream UI call or authorization issuance',async()=>{
  const f=fixture();await f.host.start(context());const request=f.host.tools.find(tool=>tool.descriptor.name==='computer.request_access');
  assert.equal(request.descriptor.requiresPresence,false);assert.equal(request.descriptor.sideEffect,'read');
  const waiting=request.execute({},context());await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.host.hasPresence('task-1'),false);assert.equal(f.host.snapshot().waitingConfirmation,true);
  const availability=f.host.competitionToolAvailability;
  // Discovery can publish schema before F9; actual tool execution and exports
  // still require the live original task receipt.
  assert.equal(await availability.find(item=>item.toolName==='computer.desktop.observe').available(context()),true);
  assert.equal(await f.options.authorizePresence(context()),false);
  f.confirm();const result=await waiting;
  assert.equal(result.authorizationGranted,false);assert.equal(result.state,'presence_confirmed');assert.equal(f.releases,1);
  assert.equal(f.host.hasPresence('task-1'),true);assert.equal(f.host.hasPresence('task-2'),false);
  assert.equal(await f.options.authorizePresence(context()),true);
  assert.equal(await availability.find(item=>item.toolName==='computer.desktop.observe').available(context()),true);
  await f.host.close();assert.equal(f.host.hasPresence('task-1'),false);
});
test('result export is explicit and stays scoped to the locally confirmed original task',async()=>{
  const denied=fixture({allowObservationExport:false});await denied.host.start(context());
  assert.deepEqual(denied.host.competitionToolExports.map(item=>item.toolName),['computer.request_access','computer.desktop.observe']);
  assert.equal(denied.host.competitionToolExports.find(item=>item.toolName==='computer.desktop.observe').accepts({taskId:'task-1'}),false);
  assert.equal(denied.host.snapshot().observationExportAllowed,false);
  assert.equal(denied.host.snapshot().providerAvailable,true);
  assert.equal(denied.host.snapshot().available,false);
  assert.equal(denied.host.snapshot().unavailableReason,'observation_export_not_authorized');
  const f=fixture();await f.host.start(context());const waiting=f.host.preparePresence(context());f.confirm();await waiting;
  const policy=f.host.competitionToolExports.find(item=>item.toolName==='computer.desktop.observe');
  assert.equal(policy.accepts({taskId:'task-1'}),true);assert.equal(policy.accepts({taskId:'task-2'}),false);
  assert.deepEqual(policy.project({taskId:'task-1',result:{state:'observed'},signal:context().signal}),{state:'observed'});
  assert.throws(()=>policy.project({taskId:'task-2',result:{},signal:context().signal}),{code:'UNAUTHORIZED'});
});
test('Runtime create-only attempt checkpoint prevents reusing a run even for another target',async()=>{
  const f=fixture();await f.host.start(context());
  const waiting=f.host.preparePresence(context());f.confirm();await waiting;
  const args={targetRef:'f74ab5a9-51ee-4c14-b592-33b60fb443dd',loc:[10,20]};
  const identity={taskId:'task-1',runId:'run-1',toolName:'computer.desktop.click',toolVersion:'1.0.0',authorizationRef:'grant-1',
    argumentsDigest:toolArgumentsDigest(args),observationDigest:'b'.repeat(64),targetRef:args.targetRef};
  f.application.runtime.readToolExecutions=()=>[{evidenceId:'run-1',taskId:'task-1',toolName:identity.toolName,toolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,state:'started'}];
  await f.options.attempts.record(identity,{...context(),arguments:args});
  await assert.rejects(f.options.attempts.record(identity,{...context(),arguments:args}),{code:'RESULT_UNKNOWN'});
  await assert.rejects(f.options.attempts.record({...identity,targetRef:'f74ab5a9-51ee-4c14-b592-33b60fb443de'},{...context(),arguments:args}),{code:'UNAUTHORIZED'});
  assert.equal(f.checkpoints.size,1);
});
test('attempt store rejects missing/denied/mismatched original executions, cancellation and changed deadline before checkpoint',async()=>{
  for(const change of [
    runtime=>{runtime.readToolExecutions=()=>[];},
    runtime=>{runtime.readToolExecutions=()=>[{evidenceId:'run-1',taskId:'task-1',toolName:'computer.desktop.click',toolVersion:'1.0.0',policyDecision:'deny',executionStarted:false,state:'started'}];},
    runtime=>{runtime.matchesToolExecutionInput=()=>false;},
    runtime=>{runtime.getTask=()=>({state:'running',cancelRequested:true});},
    runtime=>{runtime.loadCheckpoint=()=>new Date(clock+50000).toISOString();},
  ]){
    const f=fixture();await f.host.start(context());const waiting=f.host.preparePresence(context());f.confirm();await waiting;
    const args={targetRef:'f74ab5a9-51ee-4c14-b592-33b60fb443dd',loc:[10,20]};
    const identity={taskId:'task-1',runId:'run-1',toolName:'computer.desktop.click',toolVersion:'1.0.0',authorizationRef:'grant-1',argumentsDigest:toolArgumentsDigest(args),observationDigest:'b'.repeat(64),targetRef:args.targetRef};
    f.application.runtime.readToolExecutions=()=>[{evidenceId:'run-1',taskId:'task-1',toolName:identity.toolName,toolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,state:'started'}];
    change(f.application.runtime);
    await assert.rejects(f.options.attempts.record(identity,{...context(),arguments:args}),{code:'UNAUTHORIZED'});
    assert.equal(f.checkpoints.size,0);
  }
});
test('cancelled presence releases F9 and does not turn a model assertion into presence',async()=>{
  const f=fixture();await f.host.start(context());const controller=new AbortController();
  const waiting=f.host.preparePresence(context({signal:controller.signal}));controller.abort();
  await assert.rejects(waiting,{code:'CANCELLED'});assert.equal(f.host.hasPresence('task-1'),false);assert.equal(f.releases,1);
});
test('restart binding preserves an original Runtime unknown result and blocks the new provider',async()=>{
  const f=fixture();await f.host.start(context());
  f.application.runtime.listTasks=()=>({items:[{taskId:'task-1'}]});
  f.application.runtime.getTask=()=>({taskId:'task-1',state:'waiting_reconciliation'});
  f.application.runtime.readToolExecutions=()=>[{taskId:'task-1',evidenceId:'run-1',inputDigest:'a'.repeat(64),
    toolName:'computer.desktop.click',toolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,state:'unknown'}];
  f.host.bind(f.application);assert.equal(f.host.snapshot().state,'blocked');assert.deepEqual(f.host.tools,[]);
  assert.equal(f.host.snapshot().recoveryTaskId,'task-1');assert.equal(f.host.snapshot().recoveryRunId,'run-1');
});

test('an interrupted read-only Laya suggestion does not masquerade as an unknown desktop input',async()=>{
  const f=fixture();await f.host.start(context());
  f.application.runtime.listTasks=()=>({items:[{taskId:'task-1'}]});
  f.application.runtime.getTask=()=>({taskId:'task-1',state:'waiting_reconciliation'});
  f.application.runtime.readToolExecutions=()=>[{taskId:'task-1',evidenceId:'run-1',inputDigest:'a'.repeat(64),
    toolName:'computer.desktop.suggest_control',toolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,state:'unknown'}];
  f.host.bind(f.application);
  assert.equal(f.host.snapshot().state,'ready');
  assert.equal(f.host.snapshot().recoveryTaskId,undefined);
  await f.host.close();
});

test('real persisted non-form unknown retains its original recovery task/run after active provider work is empty and restart',async()=>{
  const base=path.resolve('.cache/windows-control-recovery');await mkdir(base,{recursive:true});
  const directory=await mkdtemp(path.join(base,'case-')),database=path.join(directory,'runtime.sqlite');
  let executions=0,app,host;
  const descriptor={name:'computer.desktop.click',version:'1.0.0',sideEffect:'external_write',
    requiredScopes:['computer:desktop:control'],requiresPresence:true,idempotencySupport:false,recoverySupport:false,
    inputSchema:{type:'object',properties:{targetRef:{type:'string'},loc:{type:'array',items:{type:'integer'},minItems:2,maxItems:2}},
      required:['targetRef','loc'],additionalProperties:false},outputSchema:{type:'object'}};
  function open(){
    let blocked=false;
    host=createDesktopWindowsControlHost({isFullAccess:()=>true,createControlHost:options=>({
      tools:[{descriptor,async execute(args,scope){
        executions++;
        await options.attempts.record({taskId:scope.taskId,runId:scope.runId,toolName:descriptor.name,toolVersion:descriptor.version,
          authorizationRef:scope.authorizationRef,argumentsDigest:scope.argumentsDigest,targetRef:args.targetRef,observationDigest:'b'.repeat(64)},
        {...scope,arguments:args});
        blocked=true;throw new ProtocolError('RESULT_UNKNOWN','Synthetic dispatched action lost its acknowledgement');
      }}],activeTasks:()=>[],start:async()=>{},stop:async()=>{},dispose:async()=>{},block(){blocked=true;},
      health:()=>({state:blocked?'blocked':'ready'})})});
    app=createRuntimeApplication({path:database,profile:'huawei_ict_agentarts',tools:host.tools,isUserPresent:id=>host.hasPresence(id)});
    host.bind(app);return {app,host};
  }
  try {
    open();const runtime=app.runtime;
    const task=runtime.submitTask({goal:'Synthetic private recovery goal',conversationId:'ordinary-chat-not-a-form',idempotencyKey:randomUUID()});
    const deadline=new Date(Date.now()+60000).toISOString(),runId=randomUUID(),args={targetRef:randomUUID(),loc:[10,20]};
    runtime.saveCheckpoint(task.taskId,'application-deadline',deadline);
    runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
    await host.start({deadline,signal:new AbortController().signal});
    await host.preparePresence({taskId:task.taskId,deadline,signal:new AbortController().signal});
    const pending=runtime.requestToolApproval(runId,task.taskId,descriptor,deadline,toolArgumentsDigest(args));
    runtime.respondApproval(runId,'allow_once',pending.revision);runtime.transitionTask(task.taskId,'running');
    const result=await runtime.send({kind:'request',protocolVersion:'1.0.0',requestId:randomUUID(),taskId:task.taskId,
      deadline,idempotencyKey:runId,operation:'tool.invoke',payload:{toolName:descriptor.name,toolVersion:descriptor.version,
        arguments:args,scopeRef:runId}},new AbortController().signal);
    assert.equal(result.outcome,'ok');assert.equal(result.data.state,'unknown');
    assert.deepEqual(host.activeTasks(),[]);assert.equal(app.activeTaskCount,0);
    const originalTask=runtime.getTask(task.taskId),originalRuns=runtime.readToolExecutions(task.taskId);
    assert.equal(originalTask.state,'waiting_reconciliation');assert.equal(originalRuns[0].state,'unknown');
    assert.equal(originalRuns[0].executionStarted,true);assert.equal(originalRuns[0].policyDecision,'allow');
    assert(runtime.loadCheckpoint(task.taskId,'windows-desktop-attempt:'+runId));
    assert.equal(host.snapshot().recoveryTaskId,task.taskId);assert.equal(host.snapshot().recoveryRunId,runId);
    assert.equal(host.snapshot().activeTaskId,undefined);
    assert.doesNotMatch(JSON.stringify(host.snapshot()),/Synthetic private recovery goal|ordinary-chat-not-a-form|argumentsDigest|observationDigest/);
    await host.close();app.close();app=undefined;

    open();assert.deepEqual(host.activeTasks(),[]);assert.equal(app.activeTaskCount,0);
    assert.equal(host.snapshot().state,'blocked');assert.equal(host.snapshot().recoveryTaskId,task.taskId);
    assert.equal(host.snapshot().recoveryRunId,runId);assert.equal(host.snapshot().activeTaskId,undefined);
    assert.deepEqual(app.runtime.getTask(task.taskId),originalTask);assert.deepEqual(app.runtime.readToolExecutions(task.taskId),originalRuns);
    assert.deepEqual(host.tools,[]);await host.start({deadline,signal:new AbortController().signal});assert.equal(executions,1);
  }finally{
    await host?.close();app?.close();await rm(directory,{recursive:true,force:true});
  }
});

test('recovery discovery reads original paginated records without an active-task filter and clears only its view after original resolution',async()=>{
  const f=fixture();await f.host.start(context());
  const original={taskId:'original-task',evidenceId:'original-run',inputDigest:'c'.repeat(64),toolName:'computer.desktop.type',
    toolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,state:'unknown'};
  let resolved=false;const calls=[];
  f.application.runtime.listTasks=input=>{calls.push(input);return input.beforeSequence===undefined
    ?{items:[{taskId:'newer-task'}],snapshotSequence:100,nextBeforeSequence:50}
    :{items:[{taskId:'original-task'}],snapshotSequence:100};};
  f.application.runtime.getTask=taskId=>({taskId,state:taskId==='original-task'?'failed':'running'});
  f.application.runtime.readToolExecutions=taskId=>taskId==='original-task'?[{...original,state:resolved?'confirmed':'unknown'}]
    :[{...original,taskId:'newer-task',toolName:'browser.click'}];
  f.host.bind(f.application);
  assert.equal(f.host.snapshot().recoveryTaskId,'original-task');assert.equal(f.host.snapshot().recoveryRunId,'original-run');
  assert(calls.every(input=>input.states===undefined));assert(calls.some(input=>input.beforeSequence===50));
  resolved=true;
  assert.equal(f.host.snapshot().recoveryTaskId,undefined);assert.equal(f.host.snapshot().recoveryRunId,undefined);
  assert.equal(f.host.snapshot().state,'blocked','a navigation projection never unblocks the provider or reconciles a task');
  await f.host.close();
});

test('recovery identifiers are never guessed from provider health, pending UI task IDs or unrelated/denied original records',async()=>{
  const f=fixture({isFullAccess:()=>true});await f.host.start(context());await f.host.preparePresence(context());
  f.provider.block();f.application.runtime.listTasks=()=>({items:[{taskId:'task-1'}]});
  f.application.runtime.getTask=()=>({taskId:'task-1',state:'waiting_reconciliation'});
  const record={taskId:'task-1',evidenceId:'run-1',inputDigest:'d'.repeat(64),toolName:'computer.desktop.click',
    toolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,state:'unknown'};
  for(const change of [{policyDecision:'deny'},{executionStarted:false},{taskId:'foreign-task'},{inputDigest:'not-an-original-digest'},
    {state:'confirmed'},{toolName:'browser.click'}]){
    f.application.runtime.readToolExecutions=()=>[{...record,...change}];
    assert.equal(f.host.snapshot().recoveryTaskId,undefined);assert.equal(f.host.snapshot().recoveryRunId,undefined);
  }
  await f.host.close();
});
test('shared broker receipt is authoritative even before a local lease expires',async()=>{
  let current=false;
  const broker={async requestPresence(input){current=true;return {taskId:input.taskId,expiresAt:new Date(clock+30000).toISOString(),source:'native-gesture'};},isUserPresent(){return current;}};
  const f=fixture({presenceHost:broker});await f.host.start(context());await f.host.preparePresence(context());
  assert.equal(f.host.hasPresence('task-1'),true);
  current=false;assert.equal(f.host.hasPresence('task-1'),false);
  const policy=f.host.competitionToolExports.find(item=>item.toolName==='computer.desktop.observe');
  assert.equal(policy.accepts({taskId:'task-1'}),false);
});
test('public provider factory is consumed through request access, gesture, observation and original Runtime attempt',async()=>{
  const calls=[],checkpoints=new Map();let gesture,current=false;
  const broker={async requestPresence(input){await new Promise(resolve=>{gesture=resolve;});current=true;return {taskId:input.taskId,expiresAt:new Date(clock+30000).toISOString(),source:'native-gesture'};},isUserPresent(){return current;}};
  const backend={source:'synthetic',start:async()=>{},close:async()=>{},async call(name,args){
    calls.push({name,args});return {content:[{type:'text',text:name==='Snapshot'?JSON.stringify([
      'Focused Window:\nName    Depth  Status    Width  Height  Handle\n----  -------  ------  -------  ------  ------\nEditor      0  Normal      800     600    1234\n\nOpened Windows:\nEditor\n\nUI Tree:\nButton: Save (10,20)']):'Click sent.'}]};
  }};
  const host=createDesktopWindowsControlHost({createControlHost:createWindowsDesktopControlHost,presenceHost:broker,
    allowObservationExport:true,now:()=>clock,providerOptions:{backend,now:()=>clock}});
  host.bind({runtime:{listTasks:()=>({items:[]}),getTask:()=>({state:'running'}),
    loadCheckpoint:()=>new Date(clock+60000).toISOString(),
    readToolExecutions:()=>[{taskId:'task-1',evidenceId:'run-1',toolName:'computer.desktop.click',toolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,state:'started'}],
    matchesToolExecutionInput:(_record,input)=>input.scopeRef==='grant-1'&&input.arguments.loc[0]===10,
    saveCheckpointOnce(taskId,key,value){
    const id=taskId+key;if(checkpoints.has(id))return false;checkpoints.set(id,value);return true;
  }}});await host.start(context());
  const request=host.tools.find(tool=>tool.descriptor.name==='computer.request_access');
  const waiting=request.execute({},context());await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[]);gesture();await waiting;
  const observe=host.tools.find(tool=>tool.descriptor.name==='computer.desktop.observe');
  const seen=await observe.execute({},context({scopes:['computer:desktop:control']}));
  const args={targetRef:seen.targetRef,loc:[10,20]};
  const canonical=value=>value!==null&&typeof value==='object'?(Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`):JSON.stringify(value);
  const argumentsDigest=createHash('sha256').update(canonical(args)).digest('hex');
  const result=await host.tools.find(tool=>tool.descriptor.name==='computer.desktop.click').execute(args,
    context({scopes:['computer:desktop:control'],argumentsDigest}));
  assert.equal(result.state,'action_observed');assert.equal(result.source,'synthetic');assert.equal(result.goalVerified,false);
  assert.deepEqual(calls.map(item=>item.name),['Snapshot','Snapshot','Click','Snapshot']);
  assert.equal(checkpoints.size,1);assert.equal([...checkpoints.values()][0].argumentsDigest,argumentsDigest);
  current=false;assert.equal(host.hasPresence('task-1'),false);await host.close();
});

test('captured provider policies become available in Full access and revoke immediately on restricted mode',async()=>{
  let full=false,current=false,requests=0;
  const broker={async requestPresence(input){requests++;current=true;return{taskId:input.taskId,
    expiresAt:new Date(clock+30000).toISOString(),source:'full-access-policy'};},isUserPresent(){return current&&full;}};
  const f=fixture({allowObservationExport:false,isFullAccess:()=>full,presenceHost:broker,
    registerConfirmation:()=>assert.fail('Full access must not register F9')});
  // Root captures both arrays before mode changes; no second registration occurs.
  const policies=f.host.competitionToolExports,availability=f.host.competitionToolAvailability;
  const policy=policies.find(item=>item.toolName==='computer.desktop.observe');assert.ok(policy);
  const available=availability.find(item=>item.toolName==='computer.desktop.observe');
  await f.host.start(context());assert.equal(await available.available(context()),false);assert.equal(policy.accepts({taskId:'task-1'}),false);
  full=true;assert.equal(await available.available(context()),true);
  const request=f.host.tools.find(item=>item.descriptor.name==='computer.request_access'),result=await request.execute({},context());
  assert.equal(result.state,'policy_allowed');assert.equal(result.authorizationGranted,false);assert.equal(requests,1);
  assert.equal(f.host.snapshot().waitingConfirmation,false);assert.doesNotMatch(f.host.snapshot().reason,/F9|已收到.*确认/u);
  assert.equal(f.host.snapshot().presenceTasks[0].source,'full-access-policy');
  assert.equal(policy.accepts({taskId:'task-1'}),true);assert.equal(policy.accepts({taskId:'task-2'}),false);
  assert.deepEqual(policy.project({taskId:'task-1',result:{state:'observed'},signal:context().signal}),{state:'observed'});
  full=false;
  assert.equal(await available.available(context()),false);assert.equal(policy.accepts({taskId:'task-1'}),false);
  assert.throws(()=>policy.project({taskId:'task-1',result:{},signal:context().signal}),{code:'UNAUTHORIZED'});
  assert.equal(f.host.hasPresence('task-1'),false);assert.equal(f.host.snapshot().available,false);
  full=true;assert.equal(f.host.hasPresence('task-1'),false,'an observed policy revocation cannot revive an old local lease');
  await f.host.close();
});

test('full policy never claims an earlier native gesture and malformed broker sources fail closed',async()=>{
  let full=false;
  const broker={async requestPresence(input){return{taskId:input.taskId,expiresAt:new Date(clock+30000).toISOString(),
    source:full?'full-access-policy':'native-gesture'};},isUserPresent:()=>true};
  const f=fixture({isFullAccess:()=>full,presenceHost:broker});await f.host.start(context());
  const request=f.host.tools.find(item=>item.descriptor.name==='computer.request_access');
  assert.equal((await request.execute({},context())).state,'presence_confirmed');
  full=true;assert.equal((await request.execute({},context())).state,'policy_allowed');
  for(const source of [undefined,'model-claimed','full-access-policy']){
    const invalid=fixture({presenceHost:{requestPresence:async input=>({taskId:input.taskId,expiresAt:new Date(clock+30000).toISOString(),source}),
      isUserPresent:()=>true}});await invalid.host.start(context());
    await assert.rejects(invalid.host.preparePresence(context()),{code:'UNAUTHORIZED'});assert.equal(invalid.host.hasPresence('task-1'),false);
    await invalid.host.close();
  }
  await f.host.close();
});

test('trusted Full access policy does not weaken original Runtime attempt identity or unknown replay protection',async()=>{
  const f=fixture({isFullAccess:()=>true,allowObservationExport:false,registerConfirmation:()=>assert.fail('no F9 in Full access')});
  await f.host.start(context());
  const result=await f.host.tools.find(item=>item.descriptor.name==='computer.request_access').execute({},context());
  assert.equal(result.state,'policy_allowed');assert.equal(result.authorizationGranted,false);
  const args={targetRef:'f74ab5a9-51ee-4c14-b592-33b60fb443dd',loc:[10,20]};
  const identity={taskId:'task-1',runId:'run-1',toolName:'computer.desktop.click',toolVersion:'1.0.0',authorizationRef:'grant-1',
    argumentsDigest:toolArgumentsDigest(args),observationDigest:'b'.repeat(64),targetRef:args.targetRef};
  const record={evidenceId:'run-1',taskId:'task-1',toolName:identity.toolName,toolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,state:'started'};
  f.application.runtime.readToolExecutions=()=>[{...record,policyDecision:'deny'}];
  await assert.rejects(f.options.attempts.record(identity,{...context(),arguments:args}),{code:'UNAUTHORIZED'});
  f.application.runtime.readToolExecutions=()=>[record];
  await assert.rejects(f.options.attempts.record({...identity,targetRef:'f74ab5a9-51ee-4c14-b592-33b60fb443de'},{...context(),arguments:args}),{code:'UNAUTHORIZED'});
  await assert.rejects(f.options.attempts.record(identity,{...context({deadline:new Date(clock+50000).toISOString()}),arguments:args}),{code:'UNAUTHORIZED'});
  await f.options.attempts.record(identity,{...context(),arguments:args});
  await assert.rejects(f.options.attempts.record(identity,{...context(),arguments:args}),{code:'RESULT_UNKNOWN'});
  assert.equal(f.checkpoints.size,1);await f.host.close();
});

function renewablePresenceFixture({fullAccess=true}={}) {
  let time=clock,binding='sandbox:1:full-access',conversation='original-ui',taskState='running',cancelRequested=false;
  let native,requests=0,timerId=0;const timers=new Map();
  const record={taskId:'task-1',evidenceId:'run-1',toolName:'computer.request_access',toolVersion:'1.0.0',
    inputDigest:'e'.repeat(64),policyDecision:'allow',executionStarted:true,state:'started'};
  const broker=createToolPresenceHost({now:()=>time,isFullAccess:()=>fullAccess,readPolicyBinding:()=>binding,
    isTaskCurrent:taskId=>taskId==='task-1'&&['running','waiting_approval'].includes(taskState)&&!cancelRequested,
    readTaskBinding:taskId=>taskId==='task-1'?conversation:undefined,onPrompt:()=>{},
    registerNativeShortcut:callback=>{native=callback;return()=>{native=undefined;};},
    setTimer:(callback,delay)=>{const id=++timerId;timers.set(id,{at:time+delay,callback});return id;},clearTimer:id=>timers.delete(id)});
  const request=broker.requestPresence.bind(broker);broker.requestPresence=scope=>{requests++;return request(scope);};
  const f=fixture({presenceHost:broker,isFullAccess:()=>fullAccess,readPolicyBinding:()=>binding,now:()=>time});
  f.application.readToolConversation=()=>conversation;
  f.application.runtime.getTask=taskId=>({taskId,conversationId:conversation,state:taskState,cancelRequested});
  f.application.runtime.readToolExecutions=()=>[record];
  f.application.runtime.matchesToolExecutionInput=(_run,input)=>input.scopeRef==='grant-1'&&toolArgumentsDigest(input.arguments)===toolArgumentsDigest({});
  const scope=()=>context({deadline:new Date(clock+120000).toISOString()});
  f.application.runtime.loadCheckpoint=()=>scope().deadline;
  return {...f,broker,record,scope,get requests(){return requests;},
    advance(milliseconds){time+=milliseconds;for(const [id,timer]of [...timers])if(timer.at<=time){timers.delete(id);timer.callback();}},
    set full(value){fullAccess=value;},set binding(value){binding=value;},set conversation(value){conversation=value;},
    set taskState(value){taskState=value;},set cancelled(value){cancelRequested=value;},fire:()=>native?.(),
    async requestAccess(){const pending=f.host.tools.find(tool=>tool.descriptor.name==='computer.request_access').execute({},scope());
      if(!fullAccess){await new Promise(resolve=>setImmediate(resolve));native();}
      const result=await pending;record.state='confirmed';return result;},
    async close(){await f.host.close();broker.close();}};
}

test('original Full access request refreshes at 29.9s through a new broker receipt and exports after the old 30s limit',async()=>{
  const f=renewablePresenceFixture();try {
    await f.host.start(f.scope());const first=await f.requestAccess();assert.equal(first.state,'policy_allowed');assert.equal(f.requests,1);
    const exportPolicy=f.host.competitionToolExports.find(item=>item.toolName==='computer.desktop.observe');
    f.advance(29900);
    const fresh=await f.host.refreshPolicyPresence(f.scope());assert.equal(f.requests,2);
    assert.equal(fresh.source,'full-access-policy');assert.equal(fresh.expiresAt,new Date(clock+59900).toISOString());
    f.advance(300);assert.equal(f.host.hasPresence('task-1'),true);
    assert.deepEqual(exportPolicy.project({taskId:'task-1',result:{state:'observed'},signal:f.scope().signal}),{state:'observed'});
    assert.equal(f.record.state,'confirmed');assert.equal(f.host.snapshot().presenceTasks[0].expiresAt,fresh.expiresAt);
  }finally{await f.close();}
});

test('expired short policy receipt may renew only from the existing original request and same task binding',async()=>{
  const f=renewablePresenceFixture();try {
    await f.host.start(f.scope());await f.requestAccess();f.advance(31000);assert.equal(f.host.hasPresence('task-1'),false);
    await assert.rejects(f.host.refreshPolicyPresence({...f.scope(),taskId:'task-2'}),{code:'UNAUTHORIZED'});assert.equal(f.requests,1);
    const fresh=await f.host.refreshPolicyPresence(f.scope());assert.equal(f.requests,2);
    assert.equal(fresh.expiresAt,new Date(clock+61000).toISOString());assert.equal(f.host.hasPresence('task-1'),true);
  }finally{await f.close();}
});

test('unrequested or direct prepared policy presence cannot seed automatic renewal',async()=>{
  const f=renewablePresenceFixture();try {
    await f.host.start(f.scope());
    await assert.rejects(f.host.refreshPolicyPresence(f.scope()),{code:'UNAUTHORIZED'});assert.equal(f.requests,0);
    await f.host.preparePresence(f.scope());assert.equal(f.requests,1);
    await assert.rejects(f.host.refreshPolicyPresence(f.scope()),{code:'UNAUTHORIZED'});assert.equal(f.requests,1);
    f.record.policyDecision='deny';await f.requestAccess();
    await assert.rejects(f.host.refreshPolicyPresence(f.scope()),{code:'UNAUTHORIZED'});
  }finally{await f.close();}
});

test('restricted F9 receipt remains its original 30s and never becomes renewable after switching to Full access',async()=>{
  const f=renewablePresenceFixture({fullAccess:false});try {
    await f.host.start(f.scope());const first=await f.requestAccess();assert.equal(first.state,'presence_confirmed');
    f.advance(29900);await assert.rejects(f.host.refreshPolicyPresence(f.scope()),{code:'UNAUTHORIZED'});
    assert.equal(f.host.hasPresence('task-1'),true,'refusing renewal must not shorten a valid F9 receipt');assert.equal(f.requests,1);
    f.full=true;await assert.rejects(f.host.refreshPolicyPresence(f.scope()),{code:'UNAUTHORIZED'});assert.equal(f.requests,1);
    f.advance(200);assert.equal(f.host.hasPresence('task-1'),false);
  }finally{await f.close();}
});

test('policy revision, restricted mode, conversation change, original request failure and unknown task revoke renewal eligibility',async()=>{
  for(const change of [f=>{f.binding='sandbox:2:full-access';},f=>{f.full=false;},f=>{f.conversation='another-ui';},
    f=>{f.record.state='unknown';},f=>{f.taskState='waiting_reconciliation';},f=>{f.cancelled=true;},f=>{f.provider.block();}]) {
    const f=renewablePresenceFixture();try {
      await f.host.start(f.scope());await f.requestAccess();f.advance(29900);change(f);
      await assert.rejects(f.host.refreshPolicyPresence(f.scope()),{code:'UNAUTHORIZED'});assert.equal(f.requests,1);
      f.binding='sandbox:1:full-access';f.full=true;f.conversation='original-ui';f.record.state='confirmed';f.taskState='running';f.cancelled=false;
      await assert.rejects(f.host.refreshPolicyPresence(f.scope()),{code:'UNAUTHORIZED'});assert.equal(f.requests,1);
    }finally{await f.close();}
  }
});

test('stop, original deadline changes and cancelled refresh cannot extend an earlier policy presence',async()=>{
  for(const kind of ['stop','deadline','cancelled']) {
    const f=renewablePresenceFixture();try {
      await f.host.start(f.scope());await f.requestAccess();
      const scope=f.scope();
      if(kind==='stop')await f.host.stop();
      if(kind==='deadline')scope.deadline=new Date(clock+119000).toISOString();
      if(kind==='cancelled'){const controller=new AbortController();controller.abort();scope.signal=controller.signal;}
      await assert.rejects(f.host.refreshPolicyPresence(scope),{code:kind==='cancelled'?'CANCELLED':'UNAUTHORIZED'});
      assert.equal(f.requests,1);
    }finally{await f.close();}
  }
});

test('production preflight retains current browser policy and restricted F9 receipts without signing new presence',async()=>{
  for(const fullAccess of [false,true]){
    const f=renewablePresenceFixture({fullAccess});try{
      await f.host.start(f.scope());
      if(fullAccess)await f.host.preparePresence(f.scope());else await f.requestAccess();
      f.advance(29900);
      const receipt=await f.host.prepareToolPresence(f.scope());
      assert.equal(receipt.source,fullAccess?'full-access-policy':'native-gesture');
      assert.equal(receipt.expiresAt,new Date(clock+30000).toISOString());assert.equal(f.requests,1);
      f.advance(200);await assert.rejects(f.host.prepareToolPresence(f.scope()),{code:'UNAUTHORIZED'});
      assert.equal(f.requests,1,'An expired unseeded receipt cannot be renewed by a tool preflight');
    }finally{await f.close();}
  }
});

test('production preflight renews only the original confirmed seed and fails closed on a changed binding',async()=>{
  const f=renewablePresenceFixture();try{
    await f.host.start(f.scope());await f.requestAccess();f.advance(31000);
    const receipt=await f.host.prepareToolPresence(f.scope());assert.equal(f.requests,2);
    assert.equal(receipt.expiresAt,new Date(clock+61000).toISOString());
    f.binding='sandbox:2:full-access';
    await assert.rejects(f.host.prepareToolPresence(f.scope()),{code:'UNAUTHORIZED'});assert.equal(f.requests,2);
    f.binding='sandbox:1:full-access';
    await assert.rejects(f.host.prepareToolPresence(f.scope()),{code:'UNAUTHORIZED'});assert.equal(f.requests,2);
  }finally{await f.close();}
});
