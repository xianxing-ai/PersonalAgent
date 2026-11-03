import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRuntimeApplication,createCloudPersistentRuntimeHost,createRemoteRunnerService,createMemoryRunnerSecrets} from '../dist/application.js';
import {createProactiveWorkflowController} from '../../agentarts-runtime/src/proactive-controller.mjs';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

// Actual Runtime/SQLite/Policy and signed image protocol; image/model/host qualification are explicit offline fixtures.
const owner={runtimeId:'fixture-runtime',hostId:'fixture-host',deploymentVersion:'fixture-v1',contractRef:'fixture-contract',contractVersion:'1'};
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture() {
  mkdirSync('.cache',{recursive:true});const path=join(mkdtempSync(join('.cache','cloud-persistent-')),'runtime.sqlite');
  const app=createRuntimeApplication({path,profile:'huawei_ict_agentarts',proactiveWorkflows:true});
  const secret='explicit-offline-cloud-controller-secret-32';let current=true,requests=0,offline=false;
  const controller=createProactiveWorkflowController({receiptSecret:secret,decisionContracts:[{id:owner.contractRef,version:'1',qualifiedForMain:false,
    batchIndependent:true,criteria:'Offline fixture',candidates:[{id:'continue',description:'Continue',action:'continue'},{id:'defer',description:'Defer',action:'defer'}]}]});
  const fetchImpl=async(_url,init)=>{
    requests++;if(offline)throw Error('Explicit offline image fixture');
    const parsed=JSON.parse(JSON.parse(init.body).query),versioned=parsed.executionEpochVersion===1,value=versioned?JSON.parse(parsed.query):parsed;
    const result=await controller({value,sessionId:init.headers['x-hw-agentarts-session-id'],requestId:init.headers['X-Request-Id'],
      deadline:init.headers['X-PA-Deadline'],signal:init.signal});
    const answer=versioned?{executionEpochVersion:1,executionEpoch:parsed.executionEpoch,result}:result;
    return {status:200,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify([
      {event:'message',data:{text:JSON.stringify(answer)}},{event:'task_end'},{event:'end'}])};
  };
  const options={owner,qualificationEvidenceRef:'fixture:not-real-cloud',assertCurrent(){if(!current)throw Error('fixture owner lost');},
    image:{endpoint:'http://127.0.0.1:9810/runtimes/fixture/invocations?endpoint=fixture-v1',receiptSecret:secret,authorizationProvider:{read:async()=> 'Bearer fixture'},fetchImpl}};
  const host=createCloudPersistentRuntimeHost(app,options),goal='Public offline responsibility';
  const command={version:1,commandId:'submit-one',owner,deadline:new Date(Date.now()+30_000).toISOString(),operation:'submit',
    submit:{originRuntimeId:'fixture-desktop',originTaskId:'fixture-source',goal,goalDigest:hash(goal),taskDeadline:new Date(Date.now()+120_000).toISOString()}};
  return {app,host,options,command,path,get requests(){return requests;},lose:()=>{current=false;},offline:value=>{offline=value;}};
}
const signal=()=>new AbortController().signal;
const read=(f,id='read-one')=>({...f.command,commandId:id,operation:'readback',submit:undefined,originCommandId:f.command.commandId});
const readCommand=(f,id='read-one')=>{const result=read(f,id);delete result.submit;return result;};
async function settle(app){for(let i=0;i<40;i++){try{app.close();return;}catch{await new Promise(resolve=>setTimeout(resolve,5));}}throw Error('fixture worker did not settle');}

test('cloud admission persists one original session; approval stays in original Policy and readback survives restart',async()=>{
  const f=fixture();const first=await f.host.handle(f.command,signal());
  assert.equal(first.owner.runtimeId,owner.runtimeId);assert.equal(f.app.runtime.policy.get('missing'),undefined);
  const duplicate=await f.host.handle(f.command,signal());assert.equal(duplicate.target.taskId,first.target.taskId);
  await new Promise(resolve=>setTimeout(resolve,25));
  const observed=await f.host.handle(readCommand(f),signal());
  assert.equal(observed.task.state,'waiting_approval');assert.equal(observed.approvals.length,1);
  const approval=observed.approvals[0];assert.equal(toolArgumentsDigest(approval.arguments),approval.argumentsDigest);
  const bad={version:1,commandId:'bad-approval',owner,deadline:f.command.deadline,operation:'approval',target:first.target,
    approval:{approvalId:approval.approvalId,expectedRevision:approval.revision,argumentsDigest:'0'.repeat(64),expiresAt:approval.expiresAt,decision:'allow_once'}};
  await assert.rejects(f.host.handle(bad,signal()),{code:'RESULT_UNKNOWN'});
  assert.equal(f.app.runtime.getApproval(approval.approvalId).state,'pending');
  await assert.rejects(f.host.handle({...f.command,submit:{...f.command.submit,goal:'changed'}},signal()),{code:'REVISION_CONFLICT'});
  await settle(f.app);
  const restarted=createRuntimeApplication({path:f.path,profile:'huawei_ict_agentarts',proactiveWorkflows:true});
  const host=createCloudPersistentRuntimeHost(restarted,f.options);
  assert.deepEqual((await host.handle(readCommand(f,'read-after-restart'),signal())).target,first.target);
  await assert.rejects(host.handle({...readCommand(f),owner:{...owner,runtimeId:'other'}},signal()),{code:'REVISION_CONFLICT'});
  restarted.close();
});
test('absent qualification and lost owner fail closed without a second image call',async()=>{
  const f=fixture();
  assert.throws(()=>createCloudPersistentRuntimeHost(f.app,{...f.options,qualificationEvidenceRef:''}),{code:'UNSUPPORTED_CAPABILITY'});
  f.lose();await assert.rejects(f.host.handle(f.command,signal()));assert.equal(f.requests,0);f.app.close();
});
test('interrupted describe retains the original instruction and offline cancel commits before platform response',async()=>{
  const f=fixture();f.offline(true);await assert.rejects(f.host.handle(f.command,signal()),{code:'RESULT_UNKNOWN'});
  const observed=await f.host.handle(readCommand(f),signal());
  assert.ok(observed.target.taskId);assert.equal(observed.task.state,'created');
  f.offline(false);await f.host.tick();await new Promise(resolve=>setTimeout(resolve,25));
  const calls=f.requests;await f.host.tick();await f.host.tick();assert.equal(f.requests,calls,'maintenance must not reinject or notify an existing instruction');
  await settle(f.app);
  const restarted=createRuntimeApplication({path:f.path,profile:'huawei_ict_agentarts',proactiveWorkflows:true});
  const restored=createCloudPersistentRuntimeHost(restarted,f.options);restarted.runtime.recoverInterruptedTasks();f.offline(true);
  await assert.rejects(restored.handle({version:1,commandId:'cancel-offline',owner,deadline:f.command.deadline,operation:'control',
    target:observed.target,control:{action:'cancel',expectedControlRevision:0}},signal()),{code:'RESULT_UNKNOWN'});
  assert.equal(restarted.runtime.getTask(observed.target.taskId).cancelRequested,true);
  await settle(restarted);
});
test('cloud transport keeps the exact host and never selects local fallback',async()=>{
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'}),runtime=app.runtime;
  const source=runtime.submitTask({goal:'Original public transport fixture',conversationId:'fixture-user',idempotencyKey:'fixed-host-source'});
  let connected=0,local=0;
  const runner=createRemoteRunnerService({getRuntime:()=>runtime,secrets:createMemoryRunnerSecrets(),
    transport:{async connect(){connected++;throw Error('must not choose another host');}},localExecute:async()=>{local++;return {};}});
  const job={kind:'cloud-persistent',hostId:'absent-owner',taskId:source.taskId,idempotencyKey:'fixed-command',payload:{owner:{hostId:'absent-owner'}},
    signal:signal(),deadline:new Date(Date.now()+30_000).toISOString(),assertCurrent(){}};
  const result=await runner.submit(job);assert.equal(result.accepted,false);assert.equal(result.location,'remote');
  assert.equal(result.receipt.state,'rejected');assert.equal(connected,0);assert.equal(local,0);
  await assert.rejects(runner.submit({...job,hostId:'replacement',payload:{owner:{hostId:'replacement'}}}),{code:'REVISION_CONFLICT'});app.close();
});
