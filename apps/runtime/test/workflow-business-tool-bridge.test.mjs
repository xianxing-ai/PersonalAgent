import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeApplication,createRuntimeOwnedWorkflowHost,createWorkflowBusinessToolBridge} from '../dist/application.js';

// Actual SQLite, Runtime, Policy, ToolGateway and HostBridge; only the business
// service and graph proposal are Synthetic. No platform or account acceptance.
const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const inputSchema=schema({title:{type:'string',minLength:1}});
const outputSchema=schema({item:schema({id:{type:'string'},revision:{type:'integer',minimum:1}})});
const wait=async check=>{const end=Date.now()+10000;while(Date.now()<end){const value=check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Synthetic original child did not settle');};
async function setup(t,{unknown=false,pending=false,readOnly=false,approvalHost=false}={}) {
  const root=fileURLToPath(new URL('../../../.cache/workflow-business-bridge/',import.meta.url));mkdirSync(root,{recursive:true});
  const folder=mkdtempSync(path.join(root,'run-')),database=path.join(folder,'runtime.sqlite');
  let app,bridge,client,sourceContext,clock=Date.now(),allowed=true,calls=0,receipt,businessSignal;
  const decisions=new Map();
  const request={actionKey:'F06_N03.todo-create',input:{title:'Synthetic original todo'}};
  const business={descriptor:{name:'todo.create',version:'1.0.0',inputSchema,outputSchema,sideEffect:readOnly?'read':'local_write',
    requiredScopes:['todo:write'],requiresPresence:false,idempotencySupport:false,recoverySupport:false},execute:async(_input,context)=>{
    calls++;businessSignal=context.signal;
    if(unknown)throw new ProtocolError('RESULT_UNKNOWN','Synthetic service accepted without a final receipt');
    if(pending)await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));
    return {item:{id:'synthetic-todo',revision:1}};
  }};
  const outer={descriptor:{name:'workflow.host.f06_n03',version:'1.0.0',inputSchema,outputSchema,sideEffect:'local_write',
    requiredScopes:['workflow:f06'],requiresPresence:false,idempotencySupport:false,recoverySupport:false},execute:async(input,context)=>{
    sourceContext=context;receipt=await bridge.invoke({...request,input},context);return receipt.result;
  }};
  const open=async()=>{
    app=createRuntimeApplication({path:database,profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-business-user',
      now:()=>new Date(clock),tools:[outer,business],...(approvalHost?{requestToolAuthorization:scope=>new Promise((resolve,reject)=>{
        const abort=()=>{decisions.delete(scope.taskId);reject(new ProtocolError('CANCELLED','Synthetic question cancelled'));};
        scope.signal.addEventListener('abort',abort,{once:true});
        decisions.set(scope.taskId,decision=>{scope.signal.removeEventListener('abort',abort);decisions.delete(scope.taskId);resolve(decision);});
      })}:{})});
    bridge=createWorkflowBusinessToolBridge({application:app,now:()=>new Date(clock),
      resolveTool:({actionKey,input})=>[request.actionKey,request.actionKey+'.before_export',request.actionKey+'.after_export'].includes(actionKey)?{workflowId:'F06',nodeId:'F06_N03',
        hostToolName:outer.descriptor.name,toolName:business.descriptor.name,toolVersion:business.descriptor.version,arguments:input}:undefined,
      assertCurrent(){if(!allowed)throw new ProtocolError('UNAUTHORIZED','Synthetic original graph lease revoked');}});
    client=new Client(app,Date.now);await client.connect();
  };
  await open();
  const parent=app.runtime.submitTask({goal:'Synthetic graph business operation',conversationId:'original-user-conversation',idempotencyKey:'graph-owner'});
  app.runtime.transitionTask(parent.taskId,'planning');app.runtime.transitionTask(parent.taskId,'running');
  const deadline=new Date(clock+60000).toISOString();
  const host=createRuntimeOwnedWorkflowHost(app,{parentTaskId:parent.taskId,receiptSecret:'synthetic-host-secret-at-least-32-characters',assertActive(){}});
  const source=host.submit({taskId:parent.taskId,workflowId:'F06',sessionId:'synthetic-session',controlRevision:0,deadline},
    {kind:'tool_proposal',nodeId:'F06_N03',operationId:'synthetic-original-create',originControlRevision:0,
      toolName:outer.descriptor.name,toolVersion:outer.descriptor.version,arguments:request.input});
  const decide=async(taskId,decision='allow_once')=>{
    await wait(()=>app.readHostToolTask(taskId).task.state==='waiting_approval');
    if(approvalHost){(await wait(()=>decisions.get(taskId)))(decision);return;}
    const approval=app.readHostToolTask(taskId).approval;
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision});
  };
  const child=()=>sourceContext&&bridge.read(request,sourceContext);
  const begin=async()=>{await decide(source.localTaskId);return wait(()=>{const value=child();return value?.state==='waiting_approval'?value:undefined;});};
  const settle=()=>wait(()=>{const value=app.readHostToolTask(source.localTaskId);return ['succeeded','failed','cancelled','waiting_reconciliation'].includes(value.task.state)?value:undefined;});
  t.after(async()=>{
    for(const task of app.runtime.listTasks({limit:100}).items){if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);}
    await wait(()=>app.activeTaskCount===0);app.close();
  });
  return {get app(){return app;},get bridge(){return bridge;},get context(){return sourceContext;},get receipt(){return receipt;},
    get calls(){return calls;},get businessSignal(){return businessSignal;},request,source,parent,business,outer,database,begin,child,decide,settle,
    revoke:()=>{allowed=false;},expire:()=>{clock+=61000;},reopen:async()=>{await wait(()=>app.activeTaskCount===0);app.close();await open();}};
}

// A real process exit, while the business approval is pending, preserves the
// SQLite state without cancelling the original task as a graceful close would.
if(process.argv.includes('--business-approval-crash-fixture')){
  const f=await setup({after(){}}),child=await f.begin();
  process.stdout.write(JSON.stringify({database:f.database,child,source:f.source,
    descriptors:[f.outer.descriptor,f.business.descriptor]})+'\n');
  setInterval(()=>{},1000);await new Promise(()=>{});
}

test('the original graph waits for a separately approved child and returns only its exact confirmed receipt',async t=>{
  const f=await setup(t),child=await f.begin();
  assert.equal(f.calls,0);assert.equal(f.app.readHostToolTask(f.source.localTaskId).task.state,'running');
  assert.equal(f.app.readHostToolTask(f.source.localTaskId).confirmed,undefined);
  assert.equal(f.app.readToolConversation(child.taskId),'original-user-conversation');
  assert.notEqual(child.runId,f.context.runId);
  await f.decide(child.taskId);assert.equal((await f.settle()).task.state,'succeeded');
  assert.equal(f.calls,1);assert.equal(f.receipt.taskId,child.taskId);assert.equal(f.receipt.runId,child.runId);
  assert.equal(f.receipt.scopeRef,child.runId);assert.deepEqual(f.receipt.arguments,f.request.input);
  assert.deepEqual(f.receipt.evidenceRefs,[child.runId]);assert.deepEqual(f.receipt.result,{item:{id:'synthetic-todo',revision:1}});
  const record=f.app.runtime.readToolExecutions(child.taskId)[0];
  assert.equal(record.policyDecision,'allow');assert.equal(record.executionStarted,true);assert.equal(record.state,'confirmed');
  assert.deepEqual(f.bridge.read(f.request,f.context).confirmed,f.receipt);
  assert.deepEqual(await f.bridge.invoke(f.request,f.context),f.receipt);assert.equal(f.calls,1);
  f.revoke();assert.throws(()=>f.bridge.read(f.request,f.context),{code:'UNAUTHORIZED'});assert.equal(f.calls,1);
});

test('denying the independent business approval never executes it or confirms the outer host',async t=>{
  const f=await setup(t),child=await f.begin();await f.decide(child.taskId,'deny');
  const result=await f.settle();assert.notEqual(result.task.state,'succeeded');assert.equal(result.confirmed,undefined);
  assert.equal(f.calls,0);assert.equal(f.app.runtime.readToolExecutions(child.taskId)[0].executionStarted,false);
});

test('a changed input, forged parent or unknown action cannot replace the original child',async t=>{
  const f=await setup(t),child=await f.begin();
  await assert.rejects(f.bridge.invoke({...f.request,input:{title:'Synthetic substitution'}},f.context),{code:'REVISION_CONFLICT'});
  await assert.rejects(f.bridge.invoke({...f.request,actionKey:'unregistered'},f.context),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(f.bridge.invoke(f.request,{...f.context,authorizationRef:'forged'}),{code:'UNAUTHORIZED'});
  assert.equal(f.child().taskId,child.taskId);assert.equal(f.calls,0);
  await f.decide(child.taskId);assert.equal((await f.settle()).task.state,'succeeded');assert.equal(f.calls,1);
});

for(const mode of ['cancel','timeout','revoke'])test(mode+' while awaiting the original child cancels that child without a write',async t=>{
  const f=await setup(t),child=await f.begin();
  if(mode==='cancel')f.app.runtime.requestCancel(f.source.localTaskId);
  if(mode==='timeout')f.expire();
  if(mode==='revoke')f.revoke();
  const result=await f.settle();assert.notEqual(result.task.state,'succeeded');assert.equal(result.confirmed,undefined);
  await wait(()=>f.app.runtime.getTask(child.taskId).cancelRequested);assert.equal(f.calls,0);
});

test('cancellation reaches a started business call and its late result cannot confirm the outer host',async t=>{
  const f=await setup(t,{pending:true}),child=await f.begin();await f.decide(child.taskId);await wait(()=>f.calls===1);
  f.app.runtime.requestCancel(f.source.localTaskId);await wait(()=>f.businessSignal.aborted);
  assert.notEqual((await f.settle()).task.state,'succeeded');assert.equal(f.calls,1);
  assert.equal(f.app.readHostToolTask(child.taskId).confirmed,undefined);
});

test('an unknown write retains the same child through SQLite restart and never replays under a new grant',async t=>{
  const f=await setup(t,{unknown:true}),child=await f.begin();await f.decide(child.taskId);
  assert.notEqual((await f.settle()).task.state,'succeeded');assert.equal(f.calls,1);
  const original=f.app.runtime.readToolExecutions(child.taskId);
  assert.equal(f.child().state,'waiting_reconciliation');
  await f.reopen();assert.equal(f.child().taskId,child.taskId);assert.equal(f.child().state,'waiting_reconciliation');
  await assert.rejects(f.bridge.invoke(f.request,f.context),{code:'RESULT_UNKNOWN'});
  assert.equal(f.calls,1);assert.deepEqual(f.app.runtime.readToolExecutions(child.taskId),original);
});

test('a descriptor change cannot reuse an outstanding business approval',async t=>{
  const f=await setup(t),child=await f.begin();
  f.business.descriptor.requiredScopes=['todo:write','synthetic:new-scope'];
  await assert.rejects(f.bridge.invoke(f.request,f.context),{code:'REVISION_CONFLICT'});
  assert.notEqual((await f.settle()).task.state,'succeeded');assert.equal(f.calls,0);
  assert.equal(f.app.runtime.getTask(child.taskId).cancelRequested,true);
});

test('revocation checked during an immediate approval cannot race the bridge polling loop',async t=>{
  const f=await setup(t),child=await f.begin();f.revoke();await f.decide(child.taskId);
  assert.notEqual((await f.settle()).task.state,'succeeded');assert.equal(f.calls,0);
});

test('revocation during the asynchronous original question is checked again immediately before the business tool',async t=>{
  const f=await setup(t,{approvalHost:true}),child=await f.begin();f.revoke();await f.decide(child.taskId);
  assert.notEqual((await f.settle()).task.state,'succeeded');assert.equal(f.calls,0);
});

test('a confirmed host may independently approve fixed read-only postchecks but cannot dispatch another write',async t=>{
  const f=await setup(t,{readOnly:true}),child=await f.begin();await f.decide(child.taskId);await f.settle();
  for(const suffix of ['.before_export','.after_export']){
    const request={...f.request,actionKey:f.request.actionKey+suffix},pending=f.bridge.invoke(request,f.context);
    const next=await wait(()=>{const value=f.bridge.read(request,f.context);return value.state==='waiting_approval'?value:undefined;});
    assert.notEqual(next.taskId,child.taskId);await f.decide(next.taskId);
    assert.equal((await pending).taskId,next.taskId);await f.bridge.invoke(request,f.context);
  }
  assert.equal(f.calls,3);
  const write=await setup(t),first=await write.begin();await write.decide(first.taskId);await write.settle();
  await assert.rejects(write.bridge.invoke({...write.request,actionKey:write.request.actionKey+'.before_export'},write.context),{code:'RESULT_UNKNOWN'});
  assert.equal(write.calls,1);
});

test('an old pending approval after process restart cannot execute without its original active parent guard',async t=>{
  const processFixture=spawn(process.execPath,[fileURLToPath(import.meta.url),'--business-approval-crash-fixture'],
    {stdio:['ignore','pipe','pipe'],windowsHide:true});
  let stderr='';processFixture.stderr.on('data',data=>{stderr+=String(data).slice(0,2000);});
  t.after(()=>{if(processFixture.exitCode===null&&!processFixture.killed)processFixture.kill();});
  const data=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(Error('Synthetic crash fixture did not start: '+stderr)),15000);
    processFixture.once('error',error=>{clearTimeout(timer);reject(error);});
    processFixture.once('exit',code=>{clearTimeout(timer);reject(Error('Synthetic crash fixture exited '+code+': '+stderr));});
    processFixture.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('\n')){clearTimeout(timer);resolve(JSON.parse(output.split('\n')[0]));}});
  });
  const exited=once(processFixture,'exit');processFixture.kill();await exited;
  let calls=0;
  const app=createRuntimeApplication({path:data.database,profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-business-user',
    tools:data.descriptors.map(descriptor=>({descriptor,execute:async()=>{calls++;return {item:{id:'must-not-write',revision:1}};}}))});
  t.after(async()=>{await wait(()=>app.activeTaskCount===0);app.close();});
  const original=app.runtime.readToolExecutions(data.source.localTaskId);
  const approval=app.readHostToolTask(data.child.taskId).approval;assert.equal(approval.state,'pending');
  const client=new Client(app,Date.now);await client.connect();
  await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  await wait(()=>app.activeTaskCount===0);
  assert.equal(calls,0,'the old child approval cannot replace the missing active parent authority');
  assert.equal(app.readHostToolTask(data.child.taskId).confirmed,undefined);
  assert.deepEqual(app.runtime.readToolExecutions(data.source.localTaskId),original);
});
