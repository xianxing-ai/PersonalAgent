import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication,createDesktopSubagentDispatchTool} from '../dist/application.js';
import {projectSubagentResult} from '../../desktop/electron/subagent-result-projection.js';
import {SyntheticWebSocket,identity} from '../../../packages/coordination/test/fixtures/websocket.mjs';
async function fixture({childTool=false,childFailure=false,wss=false}={}){
  let app,clock=Date.now(),calls=0,invalid=true,hold;
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const read={name:'fixture.read',version:'1.0.0',sideEffect:'read',requiredScopes:['read'],requiresPresence:false,idempotencySupport:true,recoverySupport:true,
    inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{},additionalProperties:false}};
  const binding={toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version,exportPolicyVersion:'original-v1',accepts:()=>true,
    project:async input=>{if(hold)await hold;if(invalid)return {...input.result,invalid:undefined};return projectSubagentResult(input);}};
  const response=query=>{
    calls++;
    if(childFailure && (query.goal?.includes('terminal child') && !childTool || query.continuation))throw Error('Synthetic received model failure');
    return query.continuation?{kind:'text',text:'56'}:query.goal?.includes('terminal child')?
      childTool?{kind:'tool_proposal',proposalId:'child-read',toolName:read.name,toolVersion:read.version,arguments:{}}:{kind:'text',text:'56'}:
      {kind:'tool_proposal',proposalId:'original-proposal',toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version,
        arguments:{subtasks:[{subtaskId:'one',role:'coder',goal:'terminal child'}]}};
  };
  app=createAgentArtsRuntimeApplication({path:':memory:',now:()=>new Date(clock),gatewayUrl:'https://agentarts.example.test',runtimeName:'termination',
    ...(wss?{transport:'wss',websocketUrl:'wss://agentarts.example.test/runtimes/termination/ws',
      websocketAuthorizationProvider:{read:async()=>'Bearer synthetic-inner'},websocketFactory:()=>new SyntheticWebSocket((frame,socket)=>{
        if(frame.type!=='invoke')return;socket.accepted(frame);
        try{socket.result(frame,JSON.stringify(response(JSON.parse(frame.payload.query))));}
        catch{socket.receive({...identity(frame),type:'error',accepted:true,code:'EXTERNAL_FAILURE'});}
      })}:{}),
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',authorizationProvider:{read:async()=>'Bearer synthetic'},
    tools:[dispatch,{descriptor:read,execute:async()=>({})}],automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version},
      ...(childTool?[{toolName:read.name,toolVersion:read.version}]:[])],
    competitionToolExports:[binding,{toolName:read.name,toolVersion:read.version,exportPolicyVersion:'read-v1',accepts:()=>true,project:({result})=>result}],
    competitionToolAvailability:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version,available:({taskId})=>!app.runtime.getTask(taskId).conversationId.startsWith('desktop-subtask:')},
      {toolName:read.name,toolVersion:read.version,available:()=>true}],fetchImpl:async(_url,init)=>{
      if(wss)throw Error('Unexpected HTTP fallback');
      const value=response(JSON.parse(JSON.parse(init.body).query));
      return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(value),index:0}}),{status:200,headers:{'content-type':'application/json'}});
    }});
  const client=new Client(app,Date.now);await client.connect();
  const {taskId}=await client.call('task.submit',{goal:'Delegate',conversationId:'desktop-panel'},{idempotencyKey:'termination',timeoutMs:60000});
  for(let index=0;index<200 && app.activeTaskCount;index++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(app.runtime.getTask(taskId).state,'waiting_reconciliation');assert.equal(calls,childTool?3:2);
  const child=app.readSubagentTasks(taskId)[0],runId=`competition-tool-${taskId}-1`;
  invalid=false;
  return {app,taskId,child,runId,calls:()=>calls,expire:()=>{clock+=120000;},invalid:()=>{invalid=true;},hold:value=>{hold=value;}};
}
for(const cancelled of [false,true])test(`confirmed local receipt terminates ${cancelled?'cancelled':'expired'} without sending or altering records`,async()=>{
  const f=await fixture();try{
    const before=f.app.runtime.readToolExecutions(f.taskId),cache=f.app.runtime.loadCheckpoint(f.taskId,'tool-result-'+f.runId);
    if(cancelled)f.app.runtime.requestCancel(f.taskId);else f.expire();
    const result=await f.app.reconcileConfirmedSubagentTermination(f.taskId);
    assert.equal(result.state,cancelled?'cancelled':'failed');if(!cancelled)assert.equal(result.error.code,'TIMEOUT');
    assert.equal(f.calls(),2);assert.deepEqual(f.app.runtime.readToolExecutions(f.taskId),before);
    assert.deepEqual(f.app.runtime.loadCheckpoint(f.taskId,'tool-result-'+f.runId),cache);
    assert.equal(f.app.runtime.loadCheckpoint(f.taskId,'competition-export-withheld').withheld,true);
    assert.equal(f.app.runtime.loadCheckpoint(f.taskId,'subagent-terminal-reconciliation').cloudResent,false);
    await assert.rejects(f.app.reconcileConfirmedSubagentTermination(f.taskId),{code:'UNAUTHORIZED'});
  }finally{f.app.close();}
});
const receipt={sessionId:'legacy-session',requestId:'legacy-request',idempotencyKey:'legacy-request',payloadDigest:'a'.repeat(64),accepted:true};
function legacyPair(f){f.app.runtime.saveCheckpoint(f.child.taskId,'competition-cloud-inflight',receipt);f.app.runtime.saveCheckpoint(f.child.taskId,'competition-cloud-received',receipt);}
test('actual WSS terminal error is consumed as durable local failure on the child path',async()=>{
  const f=await fixture({wss:true,childFailure:true});try{
    assert.equal(f.child.state,'failed');assert.equal(f.app.runtime.loadCheckpoint(f.child.taskId,'competition-cloud-inflight'),null);
    const consumed=f.app.runtime.loadCheckpoint(f.child.taskId,'competition-cloud-received-failure');
    assert.equal(consumed.classification,'transport_terminal_error');assert.equal(consumed.cloudBusinessSuccess,false);
    const before=f.app.runtime.getTask(f.child.taskId);f.expire();await f.app.reconcileConfirmedSubagentTermination(f.taskId);
    assert.deepEqual(f.app.runtime.getTask(f.child.taskId),before);assert.equal(f.calls(),2);
  }finally{f.app.close();}
});
test('historical paired child failure consumes only inside atomic parent termination and preserves original failure',async()=>{
  const f=await fixture({childFailure:true});try{
    legacyPair(f);f.expire();const before=f.app.runtime.getTask(f.child.taskId),records=f.app.runtime.readToolExecutions(f.taskId);
    assert.equal(f.app.runtime.readReceivedCloudFailureBinding(f.child.taskId),undefined);
    await f.app.reconcileConfirmedSubagentTermination(f.taskId);
    assert.deepEqual(f.app.runtime.getTask(f.child.taskId),before);assert.deepEqual(f.app.runtime.readToolExecutions(f.taskId),records);
    const consumed=f.app.runtime.loadCheckpoint(f.child.taskId,'competition-cloud-received-failure');
    assert.equal(consumed.classification,'historical_durable_local_failure');assert.equal(consumed.cloudBusinessSuccess,false);
    assert.equal(f.app.runtime.loadCheckpoint(f.child.taskId,'competition-cloud-inflight'),null);assert.equal(f.calls(),2);
  }finally{f.app.close();}
});
for(const fault of ['accepted','identity','instance','invalid-instance','unknown','active','unconfirmed-tool','wrong-marker'])test(`historical received failure refuses ${fault} and retains receipt pair`,async()=>{
  const f=await fixture({childFailure:true,childTool:fault==='unconfirmed-tool'});try{
    legacyPair(f);f.expire();
    if(fault==='accepted'||fault==='identity')f.app.runtime.saveCheckpoint(f.child.taskId,'competition-cloud-received',{...receipt,...(fault==='accepted'?{accepted:false}:{requestId:'different'})});
    if(fault==='instance' || fault==='invalid-instance') {
      const serverInstanceId=fault==='instance'?'instance-a':'invalid/instance';
      f.app.runtime.saveCheckpoint(f.child.taskId,'competition-cloud-inflight',{...receipt,serverInstanceId});
      f.app.runtime.saveCheckpoint(f.child.taskId,'competition-cloud-received',
        {...receipt,serverInstanceId:fault==='instance'?'instance-b':serverInstanceId});
    }
    if(fault==='unknown')f.app.runtime.saveCheckpoint(f.child.taskId,'competition-cloud-unknown',receipt);
    if(fault==='active')f.app.activeTextTasks.set(f.child.taskId,Promise.resolve());
    if(fault==='wrong-marker')f.app.runtime.saveCheckpoint(f.child.taskId,'competition-cloud-terminal-error',{
      version:'1.0',kind:'wss_terminal_error',receipt:{...receipt,requestId:'wrong-marker-request'}});
    if(fault==='unconfirmed-tool'){
      const record=f.app.runtime.readToolExecutions(f.child.taskId)[0];f.app.runtime.saveToolExecution({...record,state:'unknown'});
    }
    const parent=f.app.runtime.getTask(f.taskId),child=f.app.runtime.getTask(f.child.taskId),pair=f.app.runtime.loadCheckpoint(f.child.taskId,'competition-cloud-received');
    await assert.rejects(f.app.reconcileConfirmedSubagentTermination(f.taskId));
    assert.deepEqual(f.app.runtime.getTask(f.taskId),parent);assert.deepEqual(f.app.runtime.getTask(f.child.taskId),child);
    assert.deepEqual(f.app.runtime.loadCheckpoint(f.child.taskId,'competition-cloud-received'),pair);
    assert.equal(f.app.runtime.loadCheckpoint(f.child.taskId,'competition-cloud-received-failure'),undefined);
  }finally{f.app.activeTextTasks.clear();f.app.close();}
});
test('historical receipt pair mutation during projection is rejected without consuming either receipt',async()=>{
  const f=await fixture({childFailure:true});try{
    legacyPair(f);f.expire();let release;f.hold(new Promise(resolve=>{release=resolve;}));
    const before=f.app.runtime.getTask(f.taskId),operation=f.app.reconcileConfirmedSubagentTermination(f.taskId);
    f.app.runtime.saveCheckpoint(f.child.taskId,'competition-cloud-received',{...receipt,accepted:false});release();
    await assert.rejects(operation);assert.deepEqual(f.app.runtime.getTask(f.taskId),before);
    assert.deepEqual(f.app.runtime.loadCheckpoint(f.child.taskId,'competition-cloud-inflight'),receipt);
    assert.equal(f.app.runtime.loadCheckpoint(f.child.taskId,'competition-cloud-received-failure'),undefined);assert.equal(f.calls(),2);
  }finally{f.app.close();}
});
for(const fault of ['unknown','inflight','cache','child-active','running-child','not-expired','invalid-projection'])test(`termination refuses ${fault} without changing original state`,async()=>{
  const f=await fixture();try{
    if(fault!=='not-expired')f.expire();
    if(fault==='unknown'||fault==='inflight')f.app.runtime.saveCheckpoint(f.taskId,'competition-cloud-'+fault,{requestId:'unresolved'});
    if(fault==='cache')f.app.runtime.saveCheckpoint(f.taskId,'tool-result-'+f.runId,{result:{total:999}});
    if(fault==='child-active')f.app.activeTextTasks?.set(f.child.taskId,Promise.resolve());
    if(fault==='running-child'){
      const child=f.app.runtime.submitTask({goal:'unresolved extra child',conversationId:`desktop-subtask:${f.taskId}`,idempotencyKey:'extra-child'});
      f.app.runtime.transitionTask(child.taskId,'planning');f.app.runtime.transitionTask(child.taskId,'running');
    }
    if(fault==='invalid-projection')f.invalid();
    const before=f.app.runtime.getTask(f.taskId);
    await assert.rejects(f.app.reconcileConfirmedSubagentTermination(f.taskId));
    assert.deepEqual(f.app.runtime.getTask(f.taskId),before);assert.equal(f.calls(),2);
    assert.equal(f.app.runtime.loadCheckpoint(f.taskId,'subagent-terminal-reconciliation'),undefined);
  }finally{f.app.activeTextTasks?.clear();f.app.close();}
});
test('concurrent termination callers and revision changes during projection cannot commit twice',async()=>{
  const f=await fixture();try{
    f.expire();let release;const blocked=new Promise(resolve=>{release=resolve;});f.hold(blocked);
    const first=f.app.reconcileConfirmedSubagentTermination(f.taskId);
    await assert.rejects(f.app.reconcileConfirmedSubagentTermination(f.taskId),{code:'REVISION_CONFLICT'});
    f.app.runtime.requestCancel(f.taskId);release();
    await assert.rejects(first,{code:'REVISION_CONFLICT'});
    assert.equal(f.app.runtime.getTask(f.taskId).state,'waiting_reconciliation');assert.equal(f.calls(),2);
    f.hold(undefined);assert.equal((await f.app.reconcileConfirmedSubagentTermination(f.taskId)).state,'cancelled');
  }finally{f.app.close();}
});
for(const mutation of ['child-cache','child-binding','progress'])test(`projection await rejects ${mutation} mutation without a task revision change`,async()=>{
  const f=await fixture({childTool:true});try{
    f.expire();let release;f.hold(new Promise(resolve=>{release=resolve;}));
    const before=f.app.runtime.getTask(f.taskId),operation=f.app.reconcileConfirmedSubagentTermination(f.taskId);
    if(mutation==='child-cache'){
      const record=f.app.runtime.readToolExecutions(f.child.taskId)[0];
      f.app.runtime.saveCheckpoint(f.child.taskId,'tool-result-'+record.evidenceId,{result:{changed:true}});
    }else if(mutation==='child-binding'){
      const value=f.app.runtime.loadCheckpoint(f.child.taskId,'subtask-parent');
      f.app.runtime.saveCheckpoint(f.child.taskId,'subtask-parent',{...value,parentDeadline:new Date(Date.now()+999999).toISOString()});
    }else {
      const value=f.app.runtime.loadCheckpoint(f.taskId,'subtask-progress-records');
      f.app.runtime.saveCheckpoint(f.taskId,'subtask-progress-records',{...value,unrelated:{state:'pending'}});
    }
    release();await assert.rejects(operation);
    assert.deepEqual(f.app.runtime.getTask(f.taskId),before);assert.equal(f.calls(),3);
    assert.equal(f.app.runtime.loadCheckpoint(f.taskId,'subagent-terminal-reconciliation'),undefined);
  }finally{f.app.close();}
});
