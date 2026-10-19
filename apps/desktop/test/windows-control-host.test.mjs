import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createWindowsDesktopControlHost} from '@personal-agent/windows-client';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createDesktopWindowsControlHost} from '../electron/windows-control-host.js';

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
  assert.deepEqual(denied.host.competitionToolExports.map(item=>item.toolName),['computer.request_access']);
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
  f.application.runtime.readToolExecutions=()=>[{toolName:'computer.desktop.click',executionStarted:true,state:'unknown'}];
  f.host.bind(f.application);assert.equal(f.host.snapshot().state,'blocked');assert.deepEqual(f.host.tools,[]);
});
test('shared broker receipt is authoritative even before a local lease expires',async()=>{
  let current=false;
  const broker={async requestPresence(input){current=true;return {taskId:input.taskId,expiresAt:new Date(clock+30000).toISOString()};},isUserPresent(){return current;}};
  const f=fixture({presenceHost:broker});await f.host.start(context());await f.host.preparePresence(context());
  assert.equal(f.host.hasPresence('task-1'),true);
  current=false;assert.equal(f.host.hasPresence('task-1'),false);
  const policy=f.host.competitionToolExports.find(item=>item.toolName==='computer.desktop.observe');
  assert.equal(policy.accepts({taskId:'task-1'}),false);
});
test('public provider factory is consumed through request access, gesture, observation and original Runtime attempt',async()=>{
  const calls=[],checkpoints=new Map();let gesture,current=false;
  const broker={async requestPresence(input){await new Promise(resolve=>{gesture=resolve;});current=true;return {taskId:input.taskId,expiresAt:new Date(clock+30000).toISOString()};},isUserPresent(){return current;}};
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
