import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,AuthorizationQuestions,createRuntimeOwnedWorkflowHost} from '@personal-agent/runtime/application';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createComputerControlLease} from '../electron/computer-control-lease.js';
import {createF14WorkflowWorkerPorts} from '../electron/f14-workflow-worker-ports.js';
import {createF13WorkflowWorkerPorts} from '../electron/f13-workflow-worker-ports.js';
import {createSystemObservationTool} from '@personal-agent/windows-client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {prepareConfiguredWorkflowDecisionQuestion} from '../electron/configured-workflow-decision-source.js';

const until=async read=>{for(let i=0;i<1500;i++){const result=read();if(result)return result;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Original device fixture did not settle');};
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});

// Actual graph engine, delegated worker, Runtime, Policy, original cards and shared input lease.
// Candidate content/selection, transport/export consent and browser device are explicit fixtures.
async function fixture(t,{denyType=false,unknownClick=false,forgeSettled=false,replaceArgs=false,cancelType=false,wrongOwner=false,restartLease=false,
  revokeTypeParent=false,expireType=false,sqlite=false,denyConfirmation=false,skipConfirmation=false,revokeReceipt=false,denyReceipt=false,
  changeDuringConfirmation=false,longValue=false,revokeObservation}={}){
  let app,questions,factory,typed='',target,owner,cancelled=false,closed=false,clockShift=0;const calls=[],exports=[],proposals=[],decisionProofs=[];
  const directory=sqlite?await mkdtemp(path.join(tmpdir(),'pa-f14-original-')):undefined,dbPath=directory?path.join(directory,'runtime.sqlite'):':memory:';
  const input={url:'https://example.com/',values:[{label:'Note',text:'Synthetic text'}],clickTarget:'Save'};
  if(longValue)input.values[0].text='x'.repeat(501);
  const lease=createComputerControlLease({getRuntime:()=>app.runtime});
  const controls=()=>[{ref:'r1',name:'Note',tag:'input',role:'textbox',inputType:'text',disabled:false,value:typed},
    {ref:'r2',name:'Save',tag:'button',role:'button',inputType:'',disabled:false}];
  const deviceTools=['observe','type','click'].map(name=>({descriptor:{name:'browser.'+name,version:'1.0.0',
    sideEffect:name==='observe'?'read':'external_write',requiredScopes:['browser:control'],requiresPresence:false,idempotencySupport:false,recoverySupport:false,
    inputSchema:name==='observe'?object({}):object({targetRef:{type:'string'},ref:{type:'string'},...(name==='type'?{text:{type:'string'},clear:{type:'boolean'}}:{})}),
    outputSchema:{type:'object'}},async execute(args,context){
      calls.push({name,args:structuredClone(args),taskId:context.taskId,runId:context.runId});
      if(name!=='observe'){
        assert.equal(args.targetRef,target);
        if(!factory.authorizeWorkflowTarget({scope:context,args,toolName:'browser.'+name,sourceTaskId:wrongOwner?'sibling':owner,
          targetRef:target,url:input.url,expiresAt:deadline}))throw new ProtocolError('UNAUTHORIZED','Synthetic target owner rejected');
      }
      if(name==='click'&&unknownClick)throw new ProtocolError('RESULT_UNKNOWN','Synthetic click accepted, response lost');
      if(name==='type')typed=args.text;
      target=randomUUID();owner=context.taskId;
      return {source:'playwright',state:name==='observe'?'observed':'action_observed',goalVerified:false,targetRef:target,
        observedAt:new Date().toISOString(),expiresAt:deadline,url:input.url,controls:controls()};
    }}));
  const deadline=new Date(Date.now()+60000).toISOString();
  const browserHost={tools:deviceTools,snapshot:()=>({connected:true,available:true,busy:false,releaseState:'confirmed'})};
  const questionFacade=new Proxy({},{get(_target,name){return(...args)=>questions[name](...args);}});
  factory=createF14WorkflowWorkerPorts({getApplication:()=>app,browserHost,computerControlLease:lease,authorizationQuestions:questionFacade,
    now:()=>Date.now()+clockShift,authorizeExport:async value=>{
      exports.push(value);
      if(value.stage==='receipt'&&value.proposal.toolName==='workflow.host.f14_n03'){
        if(revokeReceipt)app.runtime.policy.revoke('host-tool-'+value.localTaskId);
        if(denyReceipt)return false;
      }
      return true;}});
  const secret='synthetic-f14-secret-at-least-32-characters';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>{
      const nodeId=context.node.id,args={F14_N01:{url:input.url},F14_N02:{lockKey:'desktop_input_lock'},
        F14_N03:{values:replaceArgs?[{label:'Note',text:'changed'}]:input.values},
        F14_N05:{question:'确认在 '+input.url+' 填充 Note=Synthetic text 后点击 Save'},F14_N06:{clickTarget:input.clickTarget}}[nodeId];
      const value=nodeId==='F14_N04'?{summary:'Synthetic fixed original form',mustHaltForVoice:true}:{arguments:args};
      return [{id:'supported',description:'Explicit fixture candidate',value,
        ...(skipConfirmation&&nodeId==='F14_N04'?{branches:[{nodeId:'F14_N05',state:'skipped'}]}:{})},
        {id:'review',description:'Explicit abstention',value:null,abstain:true}];
    }});
  const options={...factory.configuredWorkflowWorkerPorts[0],image:{bindingId:'synthetic-f14-real-engine',receiptSecret:async()=>secret,
    advance:async request=>{
      if(forgeSettled)return {workflowId:'F14',workflowVersion:'1.0.0',checkpoint:'synthetic-forged-settled',state:'settled',nodes:{},proposals:[]};
      const result=await engine.advance(request);proposals.push(...result.proposals);
      if(restartLease&&result.proposals.some(item=>item.toolName==='workflow.host.f14_n03'))
        lease.releaseWorkflow(app.runtime.loadCheckpoint(request.taskId,'f14:device-session').lease);
      return result;
    }}};
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const tools=[dispatch,createWorkflowDecisionTool({selector:{select:async()=> 'supported'}}),...factory.tools,...lease.wrapTools(deviceTools)];
  app=createRuntimeApplication({path:dbPath,profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'synthetic-f14-user',
    coordinationBinding:'synthetic-f14',tools,configuredWorkflowWorkers:[options],automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:'1.0.0'}],
    requestToolAuthorization:scope=>{
      const proof=prepareConfiguredWorkflowDecisionQuestion({application:app,scope,question:questions});if(proof)decisionProofs.push(proof);
      return questions.requestToolAuthorization(scope);},coordination:{execute:async request=>request.continuation?
      {kind:'text',text:'Original browser receipt',verification:'mock'}:
      {kind:'tool_proposal',proposalId:'synthetic-f14',toolName:options.toolName,toolVersion:'1.0.0',arguments:input,verification:'mock'}},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))});
  questions=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'synthetic-f14-questions',resolveConversation:scope=>app.readToolConversation(scope.taskId),available:()=>true,
    profiles:[{ref:'synthetic',label:'Synthetic isolated policy',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'synthetic'});
  t.after(async()=>{if(!closed){for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    await until(()=>app.activeTaskCount===0);questions.close();lease.close();app.close();}if(directory)await rm(directory,{recursive:true,force:true});});
  const client=new Client(app);await client.connect();const root=await client.call('task.submit',{goal:'Synthetic browser form',conversationId:'f14-chat'},
    {idempotencyKey:'synthetic-f14',timeoutMs:60000});
  let child;
  for(let i=0;i<1500;i++){
    [child]=app.readSubagentTasks(root.taskId);
    for(const question of questions.snapshot('f14-chat').filter(item=>item.state==='pending')){
      const read=app.readHostToolTask(question.taskId);
      if(cancelType&&read.toolName==='browser.type'&&!cancelled){app.runtime.requestCancel(child.taskId);cancelled=true;break;}
      if(read.toolName==='browser.type'){
        if(revokeTypeParent){const parent=app.runtime.loadCheckpoint(question.taskId,'coding-repair:parent');app.runtime.policy.revoke('host-tool-'+parent.taskId);}
        if(expireType)clockShift=60001;
      }
      if(changeDuringConfirmation&&read.toolName==='workflow.host.f14_n05')typed='changed during original confirmation';
      if(revokeObservation&&read.toolName==='browser.'+revokeObservation){
        const original=calls.filter(item=>item.name==='observe').at(-1);app.runtime.policy.revoke(original.runId);
      }
      questions.respond({questionId:question.questionId,expectedRevision:question.revision,
        decision:denyType&&read.toolName==='browser.type'||denyConfirmation&&read.toolName==='workflow.host.f14_n05'?'deny':'allow_once'},'f14-chat');
    }
    if(child&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  return {app,child,root,factory,lease,calls,exports,proposals,decisionProofs,dbPath,close(){questions.close();lease.close();app.close();closed=true;}};
}

test('actual F14 configured worker observes, reserves, fills, confirms original card and submits separate Policy children',async t=>{
  const f=await fixture(t);assert.equal(f.child.state,'succeeded',JSON.stringify({error:f.child.error,
    tasks:f.app.runtime.listTasks({limit:100}).items.map(task=>({state:task.state,tools:f.app.runtime.readToolExecutions(task.taskId).map(record=>record.toolName),error:task.error}))}));
  assert.deepEqual(f.calls.map(item=>item.name),['observe','type','observe','click']);assert.equal(new Set(f.calls.map(item=>item.taskId)).size,4);
  assert.ok(f.app.runtime.listTasks({limit:100}).items.some(task=>task.state==='succeeded'
    &&f.app.runtime.readToolExecutions(task.taskId).some(record=>record.toolName==='workflow.host.f14_n05'&&record.state==='confirmed')));
  assert.equal(f.lease.snapshot().state,'idle');assert.ok(f.exports.some(item=>item.stage==='completion'));
  assert.equal(f.decisionProofs.length,6,'all six real Engine decisions use the production original-source card gate');
  assert.deepEqual(f.proposals.filter(item=>item.toolName.startsWith('workflow.guard.')).map(item=>item.nodeId),['F14_N05','F14_N06']);
  const saved=f.app.runtime.loadCheckpoint(f.child.taskId,'f14:device-session');
  for(const ref of [saved.initial,...saved.typed,saved.beforeSubmit,saved.submitted])assert.equal(Object.hasOwn(ref,'result'),false,'DOM body stays in the original child result');
  for(const call of f.calls){const record=f.app.runtime.readToolExecutions(call.taskId)[0];assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');}
});
for(const [name,options]of [['denied child',{denyType:true}],['changed graph arguments',{replaceArgs:true}],['cancel while child waits',{cancelType:true}],
  ['revoked original parent grant',{revokeTypeParent:true}],['expired original parent deadline',{expireType:true}],
  ['denied original confirmation card',{denyConfirmation:true}],['skipped original confirmation',{skipConfirmation:true}],
  ['revoked grant during receipt export',{revokeReceipt:true}],['denied receipt export',{denyReceipt:true}],
  ['field changed during N05 with the same button',{changeDuringConfirmation:true}],['value outside original readback bounds',{longValue:true}],
  ['observation grant revoked while type awaits',{revokeObservation:'type'}],['fresh observation grant revoked while click awaits',{revokeObservation:'click'}],
  ['wrong original target owner',{wrongOwner:true}],['lost original lease',{restartLease:true}],['forged cloud completion',{forgeSettled:true}]]){
  test('F14 refuses '+name+' without submitting',async t=>{const f=await fixture(t,options);assert.notEqual(f.child.state,'succeeded');
    assert.equal(f.calls.some(item=>item.name==='click'),false);assert.equal(f.exports.some(item=>item.stage==='completion'),false);
    if(options.changeDuringConfirmation){
      assert.deepEqual(f.calls.map(item=>item.name),['observe','type','observe'],'fresh independently approved observation finds the drift without rewriting');
      const read=f.app.readHostToolTask(f.calls[2].taskId);
      assert.equal(read.confirmed.result.controls[0].value,'changed during original confirmation');
    }
    if(options.revokeReceipt||options.denyReceipt)assert.deepEqual(f.calls.map(item=>item.name),['observe','type'],
      'the original host receipt export is rejected after the confirmed field effect');
    if(options.skipConfirmation)assert.ok(f.proposals.some(item=>item.nodeId==='F14_N04'&&item.toolName==='decision.choose_candidate'),
      'the real Engine reaches the proposed branch before the fixed frontier rejects it');
    if(options.longValue)assert.equal(f.calls.length,0,'reject before any device I/O');
  });
}
test('unknown original F14 submit retains one attempt and does not claim released input or completion',async t=>{
  const f=await fixture(t,{unknownClick:true});assert.notEqual(f.child.state,'succeeded');
  assert.equal(f.calls.filter(item=>item.name==='click').length,1);assert.equal(f.lease.snapshot().writeBlocked,true);
  assert.equal(f.exports.some(item=>item.stage==='completion'),false);
});
test('SQLite restart preserves unknown F14 submit and cannot reconstruct or reuse the original input reservation',async t=>{
  const f=await fixture(t,{unknownClick:true,sqlite:true});assert.equal(f.calls.filter(item=>item.name==='click').length,1);
  const click=f.calls.find(item=>item.name==='click'),saved=f.app.runtime.loadCheckpoint(f.child.taskId,'f14:device-session');
  await until(()=>f.app.activeTaskCount===0);f.close();
  const reopened=createRuntimeApplication({path:f.dbPath,profile:'huawei_ict_agentarts'});
  try{
    const original=reopened.runtime.readToolExecutions(click.taskId).find(item=>item.evidenceId===click.runId);
    assert.equal(original.state,'unknown');assert.equal(original.executionStarted,true);
    const lease=createComputerControlLease({getRuntime:()=>reopened.runtime});
    assert.equal(lease.snapshot().writeBlocked,true);
    assert.throws(()=>lease.readWorkflowReservation(saved.lease),{code:'UNAUTHORIZED'});
    assert.throws(()=>lease.reserveWorkflow({taskId:'new-graph',sessionId:'new-session',deadline:new Date(Date.now()+60000).toISOString(),
      signal:new AbortController().signal,assertCurrent(){},authorizeOperation:()=>true}),{code:'RESULT_UNKNOWN'});
    assert.equal(f.calls.filter(item=>item.name==='click').length,1);
  }finally{reopened.close();}
});
test('F13 uses the registered real local tool but cannot substitute its samples for cloud, quota or recovery',async()=>{
  const ports=createF13WorkflowWorkerPorts({getApplication:()=>undefined,systemObserveTool:createSystemObservationTool(),authorizeExport:async()=>true});
  assert.match(ports.unavailable,/cloud_quota_lock/);assert.equal(ports.tools.length,2);
  const worker=ports.configuredWorkflowWorkerPorts[0];assert.equal(await worker.available({}),false);
  await assert.rejects(worker.resolveInput({},{}),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(worker.verifyCompletion({}),{code:'UNSUPPORTED_CAPABILITY'});
});

for(const denied of [false,true])test('actual F13 N02 requires its independent system Policy child and never invents probe fields '+denied,async t=>{
  let app,calls=0,cpu=0;
  const system=createSystemObservationTool({sampleWindowMs:1,probe:{cpuTimes:()=>[{user:++cpu,nice:0,sys:0,idle:10+cpu,irq:0}],
    totalMemoryBytes:()=>1000,freeMemoryBytes:()=>250,uptimeSeconds:()=>1234}});
  const tool={...system,execute:async(...args)=>{calls++;return system.execute(...args);}};
  const ports=createF13WorkflowWorkerPorts({getApplication:()=>app,systemObserveTool:tool,authorizeExport:async()=>true});
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f13',tools:[tool,...ports.tools]});
  t.after(async()=>{for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    await until(()=>app.activeTaskCount===0);app.close();});
  const client=new Client(app);await client.connect();
  const parent=app.runtime.submitTask({goal:'Synthetic local system diagnostic',conversationId:'f13-chat',idempotencyKey:'f13-original'});
  app.runtime.transitionTask(parent.taskId,'planning');app.runtime.transitionTask(parent.taskId,'running');
  const deadline=new Date(Date.now()+60000).toISOString();app.runtime.saveCheckpoint(parent.taskId,'application-deadline',deadline);
  const host=createRuntimeOwnedWorkflowHost(app,{parentTaskId:parent.taskId,receiptSecret:'synthetic-f13-secret-at-least-32-characters',assertActive(){}});
  const source=host.submit({taskId:parent.taskId,workflowId:'F13',sessionId:'synthetic-f13-session',controlRevision:0,deadline},
    {kind:'tool_proposal',nodeId:'F13_N02',operationId:'synthetic-f13-probe',originControlRevision:0,
      toolName:'workflow.host.f13_n02',toolVersion:'1.0.0',arguments:{checks:['cloud','quota','lock']}});
  for(let i=0;i<1500;i++){
    for(const approval of app.runtime.listApprovals({state:'pending'}).items){
      const read=app.readHostToolTask(approval.taskId);
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,
        decision:denied&&read.toolName==='computer.system.observe'?'deny':'allow_once'});
    }
    if(['failed','waiting_reconciliation'].includes(app.runtime.getTask(source.localTaskId).state))break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  const result=app.readHostToolTask(source.localTaskId);assert.equal(result.confirmed,undefined);assert.equal(calls,denied?0:1);
  const child=app.runtime.listTasks({limit:100}).items.find(task=>app.readHostToolTask(task.taskId).toolName==='computer.system.observe');
  assert.ok(child);assert.equal(child.state,denied?'cancelled':'succeeded');
  if(denied)assert.equal(app.runtime.readToolExecutions(child.taskId).some(record=>record.executionStarted),false);
  if(!denied)assert.equal(app.readHostToolTask(child.taskId).confirmed.result.source,'injected');
});
