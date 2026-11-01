import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,F01_LIFECYCLE_SCHEMA} from '@personal-agent/runtime/application';
import {createProactiveHostProofs} from '@personal-agent/agentarts-runtime/proactive-controller';
import {createDesktopProactiveWorkflowApplication} from '../electron/proactive-workflow-host.js';
import {createF01WorkflowLifecyclePorts} from '../electron/f01-workflow-lifecycle-ports.js';
import {createAgentArtsModelSettings} from '../electron/agentarts-model-settings.js';
import {createF01ModelCatalogSource} from '../electron/f01-model-catalog-source.js';

// Actual Runtime/Policy/SQLite/proactive lifecycle/Desktop ports. Image proposals,
// user text/clicks and the inactive proactive transport are explicit Synthetic.
const schema=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fixture(t,{unknown=false,deny=false,substitute=false,revokeDuringCas=false,cancelTargetDuringCas=false,foreignSession=false,models}={}) {
  const directory=await mkdtemp(join(tmpdir(),'pa-f01-lifecycle-')),deadline=new Date(Date.now()+600000).toISOString();
  let app,desktop,client,selection,target,source,commits=0,describes=0,opened=false,lastUser,deployment='synthetic-fixed-deployment';
  const secret='synthetic-f01-lifecycle-receipt-secret-32-characters',proofs=createProactiveHostProofs(secret);
  const contract={id:'synthetic-f01-responsibility',version:'1',qualifiedForMain:false,batchIndependent:true,criteria:'Synthetic fixture',
    candidates:[{id:'defer',description:'Preserve original work',action:'defer'}]};
  const bundle=createF01WorkflowLifecyclePorts({getApplication:()=>app,getProactiveHost:()=>desktop});
  const lifecycle=bundle.tools[0],worker={workflowId:'F01',toolName:'workflow.responsibility.manage',toolVersion:'1.0.0',configurationVersion:'synthetic-n09-only',
    requestSchema:schema({case:{const:'selected'}}),inputSchema:schema({lifecycle:F01_LIFECYCLE_SCHEMA}),resultSchema:lifecycle.descriptor.outputSchema,
    requiredTools:[{name:lifecycle.descriptor.name,version:'1.0.0'}],publicEnumPaths:['/case'],sideEffect:'local_write',
    image:{bindingId:'synthetic-f01',receiptSecret:async()=>secret,advance:async request=>({workflowId:'F01',workflowVersion:'1.0.0',
      checkpoint:'synthetic-f01-'+request.receipts.length,state:request.receipts.length?'settled':'awaiting_host',
      nodes:{F01_N09:{state:request.receipts.length?'completed':'waiting_receipt'}},proposals:request.receipts.length?[]:[{
        kind:'tool_proposal',nodeId:'F01_N09',operationId:'f01-operation-'+request.taskId,proposalId:'f01-operation-'+request.taskId,originControlRevision:0,
        inputDigest:hash(selection),toolSchemaDigest:hash(lifecycle.descriptor.inputSchema),toolName:lifecycle.descriptor.name,toolVersion:'1.0.0',
        arguments:substitute?{...selection,responsibilityId:'foreign'}:selection,resourceKeys:[],effect:'write'}]})},
    available:()=>true,resolveInput:async()=>({lifecycle:selection}),assertCurrent:()=>{},assertFrontier:()=>true,authorizeExport:async()=>true,
    verifyCompletion:async({readbacks})=>({result:readbacks[0].confirmed.result,resultSummary:'Synthetic N09 completion only'})};
  function open(){
    const tools=[lifecycle,createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
      runDefaultWorker:(subtask,worker,scope)=>app.runDefaultSubagentWorker(subtask,worker,scope)})];
    app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f01',
      tools,proactiveWorkflows:true,delegateUserTasks:true,configuredWorkflowWorkers:[worker],coordinationBinding:'synthetic-f01-deployment',
      ...(models?{readDefaultExecutionModel:role=>models.readExecutionModel(role),resolveExecutionModel:selection=>models.resolveExecutionModel(selection)}:{}),
      coordination:{execute:async request=>app.runtime.getTask(request.taskId).conversationId==='synthetic-chat'||request.continuation
        ?{kind:'text',text:'Synthetic result',verification:'mock'}
        :{kind:'tool_proposal',proposalId:'selected-f01',toolName:worker.toolName,toolVersion:'1.0.0',arguments:{case:'selected'},verification:'unverified'}},
      competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
        publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
      competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic',accepts:()=>true,project:({result})=>result}))});
    // Starting a new persistent controller is outside this N09 fixture; no cloud
    // advance is simulated as completed. Its existing persisted session is used.
    app.startProactiveTask=()=>{};
    desktop=createDesktopProactiveWorkflowApplication({application:app,localDeviceAvailable:()=>true,
      responsibilityLifecycleAuthority:()=>({...bundle.authority,verify(...args){const result=bundle.authority.verify(...args);
        if(revokeDuringCas)queueMicrotask(()=>{deployment='replacement';});
        if(cancelTargetDuringCas)queueMicrotask(()=>app.runtime.requestCancel(target.taskId,'Synthetic target cancellation'));return result;}}),
      readConfiguration:()=>({contractRef:contract.id,adapter:{endpoint:deployment}}),
      createAdapter:()=>({describe:async()=>{describes++;return {contracts:[contract]};},advancePort:async()=>{throw Error('No proactive cloud calls');},
        verifyAdvance:()=>false,sign:(kind,value,binding)=>proofs.sign(kind,value,binding)})});
    const record=desktop.recordResponsibilityLifecycle.bind(desktop);
    desktop.recordResponsibilityLifecycle=async(...args)=>{commits++;const result=await record(...args);
      if(unknown)throw new ProtocolError('RESULT_UNKNOWN','Synthetic lost response after actual CAS');return result;};
    client=new Client(app);opened=true;
  }
  open();await client.connect();source=app.runtime.submitTask({goal:'Synthetic original persistent responsibility',conversationId:'synthetic-chat',idempotencyKey:'responsibility-source'});
  const started=await desktop.start({sourceTaskId:source.taskId,commandId:'start-original',taskDeadline:deadline});
  target={taskId:started.taskId,sessionId:started.sessionId};
  selection={target,responsibilityId:'instruction:'+source.taskId,responsibilityRevision:1,expectedLifecycleRevision:0,action:'activate',validUntil:deadline};
  if(foreignSession)selection={...selection,target:{...target,sessionId:'foreign-session'}};
  async function run(){
    lastUser=await client.call('task.submit',{goal:'Synthetic selected responsibility lifecycle',conversationId:'synthetic-chat'},
      {idempotencyKey:'user-'+selection.action,timeoutMs:120000});let child;const end=Date.now()+10000;
    while(Date.now()<end){
      [child]=app.readSubagentTasks(lastUser.taskId);const tasks=[app.runtime.getTask(lastUser.taskId),...(child?[child]:[])];
      if(child){const host=app.readPendingOwnedWorkflowHostTask(child.taskId);if(host)tasks.push(host);}
      for(const task of tasks)for(const approval of app.runtime.listApprovals({taskId:task.taskId,state:'pending'}).items){
        let isLifecycle=false;try{isLifecycle=app.readHostToolTask(task.taskId).toolName===lifecycle.descriptor.name;}catch{}
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,
          decision:deny&&isLifecycle?'deny':'allow_once'});
      }
      [child]=app.readSubagentTasks(lastUser.taskId);
      if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))return child;
      if(deny&&child&&app.activeTaskCount===0&&app.readPendingOwnedWorkflowHostTask(child.taskId)?.state==='cancelled')return child;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    throw Error(JSON.stringify({child,tasks:app.runtime.listTasks({limit:20}).items}));
  }
  t.after(async()=>{if(opened)app.close();await rm(directory,{recursive:true,force:true});});
  return {run,bundle,target,source,deadline,scope:{deadline,signal:new AbortController().signal},get app(){return app;},get desktop(){return desktop;},
    get selection(){return selection;},get user(){return lastUser;},commits:()=>commits,describes:()=>describes,
    restoreDeployment:()=>{deployment='synthetic-fixed-deployment';},
    revoke:()=>{selection={...selection,action:'revoke',expectedLifecycleRevision:1};delete selection.validUntil;},
    async reopen(){app.close();opened=false;open();await client.connect();}};
}

test('F01 N09 requires original Policy approval and records only the explicitly selected lifecycle',async t=>{
  const f=await fixture(t),before=await f.desktop.readResponsibility(f.target,f.selection,f.source.taskId,f.scope);
  assert.equal(before.lifecycle.reason,'lifecycle_not_recorded');
  const child=await f.run();assert.equal(child.state,'succeeded',JSON.stringify(child.error));assert.equal(f.commits(),1);
  const current=await f.desktop.readResponsibility(f.target,f.selection,f.source.taskId,f.scope);assert.equal(current.lifecycle.state,'current');
  const node=f.app.runtime.listTasks({limit:30}).items.find(task=>{try{return f.app.readHostToolTask(task.taskId).toolName==='workflow.host.f01_n09';}catch{return false;}});
  const record=f.app.runtime.readToolExecutions(node.taskId)[0];assert.equal(record.policyDecision,'allow');assert.equal(record.executionStarted,true);
  f.revoke();const revoked=await f.run();assert.equal(revoked.state,'succeeded',JSON.stringify(revoked.error));assert.equal(f.commits(),2);
  assert.equal((await f.desktop.readResponsibility(f.target,f.selection,f.source.taskId,f.scope)).lifecycle.reason,'responsibility_revoked');
});
for(const mode of ['deny','substitute'])test('F01 '+mode+' cannot activate a source merely labelled explicit_instruction',async t=>{
  const f=await fixture(t,{[mode]:true}),child=await f.run();
  assert.equal(child.state,mode==='deny'?'waiting_approval':'waiting_reconciliation');
  assert.equal(f.commits(),0);assert.equal((await f.desktop.readResponsibility(f.target,f.selection,f.source.taskId,f.scope)).lifecycle.reason,'lifecycle_not_recorded');
});
for(const mode of ['foreignSession','revokeDuringCas','cancelTargetDuringCas'])test('F01 '+mode+' refuses the original lifecycle CAS',async t=>{
  const f=await fixture(t,{[mode]:true}),child=await f.run();assert.equal(child.state,'waiting_reconciliation');
  f.restoreDeployment();assert.equal((await f.desktop.readResponsibility(f.target,f.selection,f.source.taskId,f.scope)).lifecycle.reason,'lifecycle_not_recorded');
  const original=f.app.readPendingOwnedWorkflowHostTask(child.taskId),scope={...f.scope,deadline:f.app.runtime.loadCheckpoint(child.taskId,'application-deadline')};
  if(mode==='foreignSession')await assert.rejects(f.bundle.readOriginalOperation(original.taskId,scope),/原责任会话/);
  else assert.deepEqual(await f.bundle.readOriginalOperation(original.taskId,scope),{state:'unknown'});
  assert.equal(f.commits(),1,'readback does not repeat the attempted CAS');
});
test('F01 unknown actual CAS reads only the original operation after SQLite reopen',async t=>{
  const f=await fixture(t,{unknown:true}),child=await f.run();assert.equal(child.state,'waiting_reconciliation',JSON.stringify(child.error));
  const original=f.app.readPendingOwnedWorkflowHostTask(child.taskId);assert.ok(original);assert.equal(f.commits(),1);
  const scope={...f.scope,deadline:f.app.runtime.loadCheckpoint(child.taskId,'application-deadline')};
  await f.reopen();const before=f.commits(),first=await f.bundle.readOriginalOperation(original.taskId,scope);
  assert.deepEqual(first,{state:'recorded',revision:1});assert.deepEqual(await f.bundle.readOriginalOperation(original.taskId,scope),first);
  assert.equal(f.commits(),before);assert.equal(f.app.runtime.getTask(child.taskId).state,'waiting_reconciliation');
  assert.throws(()=>f.app.resumeTask(child.taskId),{code:'RESULT_UNKNOWN'});assert.equal(f.commits(),before);
  const saved=f.app.runtime.loadCheckpoint(original.taskId,'host-tool-intent');
  f.app.runtime.saveCheckpoint(original.taskId,'host-tool-intent',{...saved,arguments:{...saved.arguments,action:'revoke'}});
  await assert.rejects(f.bundle.readOriginalOperation(original.taskId,scope),{code:'UNAUTHORIZED'});assert.equal(f.commits(),before);
});
test('F01 original context reads actual AgentArts catalog declarations and refuses changed task or deployment bindings',async t=>{
  let deployment={gatewayUrl:'https://synthetic.invalid',runtimeName:'synthetic',deploymentVersion:'fixed'};
  const models=createAgentArtsModelSettings({configuration:{snapshot:()=>deployment},readCatalog:async()=>({version:'1.0',revision:'a'.repeat(64),
    defaultModelId:'original-text',models:[{id:'original-text',displayName:'Original',type:'text',availability:'unverified',
      requestProfile:'standard',reasoningEfforts:['high'],route:'agentarts-proxy'}]})});
  await models.refresh();const f=await fixture(t,{unknown:true,models}),child=await f.run();assert.equal(child.state,'waiting_reconciliation');
  const local=f.app.readPendingOwnedWorkflowHostTask(child.taskId),parent=f.app.runtime.loadCheckpoint(local.taskId,'coding-repair:parent');
  const graph=f.app.runtime.loadCheckpoint(child.taskId,'owned-workflow:intent:'+parent.operationId);
  const request={taskId:child.taskId,sessionId:graph.sessionId,signal:f.scope.signal},original=f.app.readF01ContextBinding(request);
  assert.equal(original.user.taskId,f.user.taskId);assert.equal(original.selection.modelId,'original-text');
  assert.equal(Object.isFrozen(original),true);assert.equal(Object.isFrozen(original.binding.input),true);
  const read=createF01ModelCatalogSource({getApplication:()=>f.app,models,readDeploymentBinding:()=>hash(deployment),assertCurrent:()=>{}});
  const scope={parentTaskId:child.taskId,localTaskId:local.taskId,operationId:parent.operationId,sessionId:graph.sessionId,deadline:original.binding.deadline,signal:f.scope.signal};
  const value=await read(scope);assert.equal(value.kind,'agentarts_catalog');assert.equal(value.models[0].verification,'conditional');
  assert.equal(Object.hasOwn(value.models[0],'capabilities'),false);assert.deepEqual(value.models[0].reasoningEfforts,['high']);
  for(const taskId of [f.user.taskId,child.taskId]){
    const saved=f.app.runtime.loadCheckpoint(taskId,'competition-configuration-binding');
    f.app.runtime.saveCheckpoint(taskId,'competition-configuration-binding','replacement');
    assert.throws(()=>f.app.readF01ContextBinding(request),{code:'REVISION_CONFLICT'});
    f.app.runtime.saveCheckpoint(taskId,'competition-configuration-binding',saved);
  }
  const saved=f.app.runtime.loadCheckpoint(child.taskId,'execution-model');
  f.app.runtime.saveCheckpoint(child.taskId,'execution-model',{...saved,modelId:'foreign'});assert.throws(()=>f.app.readF01ContextBinding(request));
  f.app.runtime.saveCheckpoint(child.taskId,'execution-model',saved);
  deployment={...deployment,deploymentVersion:'changed'};assert.throws(()=>read(scope));
  f.app.runtime.requestCancel(f.user.taskId,'Synthetic cancellation');
  assert.equal(f.app.readF01ContextBinding({...request,signal:AbortSignal.abort()}),undefined);
  assert.equal(f.app.readF01ContextBinding(request),undefined);
});
