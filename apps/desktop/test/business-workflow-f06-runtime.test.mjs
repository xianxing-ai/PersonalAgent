import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createBusinessWorkflowWorkerPorts} from '../electron/business-workflow-worker-ports.js';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {createVerifyWorkflowReminderBinding} from '../electron/f06-reminder-binding.js';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {prepareWorkflowHostPreflight} from '../electron/workflow-host-preflight.js';
import {prepareConfiguredWorkflowDecisionQuestion} from '../electron/configured-workflow-decision-source.js';

// Real graph engine, Runtime/Policy, SQLite, question cards, Todo and original scheduler.
// Candidate content/selection, remote transport/export consent and OS display are fixtures.
// No clock injection or time advance is used, including restart and later delivery.
const pause=(ms=5)=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t,options={}){
  const cache=new URL('../../../.cache/business-f06-runtime/',import.meta.url);mkdirSync(cache,{recursive:true});
  const userData=mkdtempSync(new URL('case-',cache)),cloud=[],proposals=[],decisionProofs=[],responses=[];
  const input={todoTitle:'Original reminder',remindUtc:new Date(Date.now()+(options.future?8000:-1000)).toISOString()};
  let app,client,question,todoHost,notificationHost,policies,shown=0,closed=false,originalTodo,revoked=false;
  async function open(){
    closed=false;
    question=createDesktopAuthorizationQuestionHost({createQuestions:args=>new runtimeModule.AuthorizationQuestions(args),getApplication:()=>app,
      namespace:'offline-f06',resolveConversation:taskId=>app.readToolConversation(taskId)??app.runtime.getTask(taskId).conversationId,available:()=>true,
      profiles:[{ref:'bounded',mode:'workspace-write',revision:1,label:'Offline policy',available:true}],defaultProfileRef:'bounded'});
    const channel=createDesktopNotificationPort({storageDir:userData,onOutcome:outcome=>notificationHost.receipt(outcome),notifier:{
      isSupported:async()=>true,show:async(_input,events)=>{shown++;if(options.unknownDelivery)throw Error('Offline device result unknown');events.onShow();return {close(){}};}}});
    notificationHost=createDesktopNotificationApplicationHost({namespace:'offline-f06',channel});
    todoHost=createDesktopTodoHost({userData,namespace:'offline-f06',notificationHost,question,
      safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>Buffer.from(value).toString()},
      createDeliveryHost:runtimeModule.createReminderDeliveryHost,verifyWorkflowReminderBinding:createVerifyWorkflowReminderBinding({getApplication:()=>app}),
      onNotification:notice=>notificationHost.deliverBatch({batchId:notice.batchId,scope:{kind:'connector',connectorId:'productivity'},
        expiresAt:new Date(Date.now()+60000).toISOString(),title:'Offline reminder',body:notice.summary,source:'productivity'})});
    const businessTools=todoHost.tools,prepareExport=scope=>todoHost.prepareExport(scope);policies=todoHost.competitionToolExports;
    const composition=createBusinessWorkflowWorkerPorts({runtimeModule,getApplication:()=>app,businessTools,todoHost,notificationHost,
      competitionToolExports:policies,prepareCompetitionToolExport:prepareExport,readBusinessAvailability:()=>({ready:true,bindingId:'offline-device'}),
      authorizeExport:async request=>{if(request.stage==='completion')await options.beforeCompletion?.({app,todoHost,request});return true;}});
    const worker=composition.configuredWorkflowWorkerPorts.find(item=>item.workflowId==='F06');assert.ok(worker);
    const decision=createWorkflowDecisionTool({selector:{select:async()=> 'supported'}});
    const tools=[...businessTools,...notificationHost.tools,...composition.tools,decision,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,
      getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(subtask,context,scoped)=>app.runDefaultSubagentWorker(subtask,context,scoped)})];
    const secret='offline-secret-at-least-thirty-two-characters';
    const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},
      receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>{
        const nodeId=context.node.id;let value;
        if(nodeId==='F06_N02')value={actionPlan:'create original reminder'};
        else if(nodeId==='F06_N03')value={arguments:input};
        else if(nodeId==='F06_N04'){
          originalTodo=context.predecessorOutputs.F06_N03;value={arguments:{todoId:originalTodo.todoId,revision:originalTodo.revision}};
        }else value={arguments:{notification:{todoId:originalTodo.todoId,revision:originalTodo.revision}}};
        return [{id:'supported',description:'Explicit fixture candidate',value},{id:'review',description:'Explicit abstention',value:null,abstain:true}];
      }});
    const image={bindingId:'offline-f06-image-v2',receiptSecret:async()=>secret,advance:async request=>{
      const result=await engine.advance(request);proposals.push(...result.proposals);return result;
    }};
    app=runtimeModule.createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,
      hostUserNamespace:'offline-f06',coordinationBinding:'offline-deployment',tools,configuredWorkflowWorkers:[{...worker,image}],
      coordination:{execute:async request=>{cloud.push(request);
        if(app.runtime.getTask(request.taskId).conversationId==='offline-chat'||request.continuation)return {kind:'text',text:'Offline result',verification:'unverified'};
        return {kind:'tool_proposal',proposalId:'original-f06',toolName:worker.toolName,toolVersion:worker.toolVersion,arguments:input,verification:'unverified'};}},
      requestToolAuthorization:async scope=>{
        await prepareWorkflowHostPreflight({application:app,scope,prepareExport});
        const proof=prepareConfiguredWorkflowDecisionQuestion({application:app,scope,question});if(proof)decisionProofs.push(proof);
        return question.requestToolAuthorization(scope);
      },
      requiresToolAuthorization:()=>true,
      competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
        available:()=>tool.descriptor.name==='subagent.dispatch'||worker.requiredTools.some(item=>item.name===tool.descriptor.name),
        publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
      competitionToolExports:tools.map(tool=>policies.find(item=>item.toolName===tool.descriptor.name)??{
        toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'offline-fixture',accepts:()=>true,project:({result})=>result})});
    todoHost.bindApplication(app);client=new Client(app);await client.connect();notificationHost.bindApplication(app,client);
  }
  async function close(){
    if(closed)return;closed=true;await todoHost.close();
    for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    question.close();for(let i=0;i<300&&app.activeTaskCount;i++)await pause();notificationHost.dispose();app.close();
  }
  await open();t.after(close);
  const root=await client.call('task.submit',{goal:'Offline original reminder workflow',conversationId:'offline-chat'},
    {idempotencyKey:'offline-reminder-graph',timeoutMs:60000});
  let child;
  for(let i=0;i<3000;i++){
    for(const card of question.snapshot().filter(item=>item.state==='pending')){
      if(options.revokeDecisionSource&&!revoked&&card.toolName==='decision.choose_candidate'){
        const taskId=app.runtime.getApproval(card.sourceApprovalId).taskId,parent=app.runtime.loadCheckpoint(taskId,'coding-repair:parent');
        const key='owned-workflow:intent:'+parent.operationId,intent=app.runtime.loadCheckpoint(parent.taskId,key);
        app.runtime.saveCheckpoint(parent.taskId,key,{...intent,sessionId:'replaced-after-question-preparation'});revoked=true;
      }
      responses.push(question.respond({questionId:card.questionId,expectedRevision:card.revision,
        decision:card.toolName===options.denyTool?'deny':'allow_once'},card.conversationId));
    }
    [child]=app.readSubagentTasks(root.taskId);
    if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;
    await pause();
  }
  assert.ok(child);
  return {get app(){return app;},get todoHost(){return todoHost;},get notificationHost(){return notificationHost;},
    get shown(){return shown;},get policies(){return policies;},get originalTodo(){return originalTodo;},input,child,cloud,proposals,decisionProofs,responses,
    async restart(){await close();await open();}};
}

test('F06 original due schedule delivers once through real engine and exact automatic revision',async t=>{
  const f=await fixture(t);assert.equal(f.child.state,'succeeded',JSON.stringify(f.child.error));
  assert.equal(f.originalTodo.revision,1);assert.equal(f.todoHost.snapshot().items[0].revision,2);
  assert.equal(f.todoHost.snapshot().items[0].reminder.state,'delivered');assert.equal(f.shown,1);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.reminderState==='delivered'&&request.continuation.result.delivered===true));
  assert.ok(f.proposals.some(item=>item.toolName==='workflow.guard.f06_n05'));
  assert.equal(f.decisionProofs.length,4,'all semantic and host candidate decisions use the production original-source gate');
  await f.todoHost.tick(true);assert.equal(f.shown,1);
  const task=f.app.runtime.listTasks({limit:100}).items.find(item=>f.app.runtime.loadCheckpoint(item.taskId,'host-tool-intent')?.toolName==='todo.create');
  const intent=f.app.runtime.loadCheckpoint(task.taskId,'host-tool-intent'),result=f.app.readHostToolTask(task.taskId).confirmed.result;
  const policy=f.policies.find(item=>item.toolName==='todo.create'),scope={taskId:task.taskId,proposalId:intent.commandId,
    runId:'host-tool-'+task.taskId,deadline:intent.deadline,arguments:intent.arguments,result,signal:new AbortController().signal};
  assert.deepEqual(policy.project(scope),result);
  assert.throws(()=>policy.project({...scope,result:{...result,item:{...result.item,title:'substituted'}}}),/出机许可不可用/);
  f.app.runtime.saveCheckpoint(task.taskId,'host-tool-intent',{...intent,commandId:'foreign'});
  assert.throws(()=>policy.project(scope),/出机许可不可用/);f.app.runtime.saveCheckpoint(task.taskId,'host-tool-intent',intent);
  f.todoHost.revoke();assert.throws(()=>policy.project(scope),/授权已失效/);
  await f.restart();await f.todoHost.tick(true);assert.equal(f.shown,1,'recovery never repeats original delivery');
});

test('F06 future graph completes scheduled, survives restart and original scheduler later delivers once',async t=>{
  const f=await fixture(t,{future:true});assert.equal(f.child.state,'succeeded',JSON.stringify(f.child.error));
  assert.equal(f.shown,0);assert.equal(f.todoHost.snapshot().items[0].revision,1);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.reminderState==='scheduled'&&request.continuation.result.delivered===false));
  assert.equal(f.proposals.some(item=>item.toolName==='workflow.host.f06_n05'),false);
  const originalSchedules=f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06');assert.equal(originalSchedules.length,1);
  assert.equal(originalSchedules[0].status,'pending');assert.equal(originalSchedules[0].runAt,f.input.remindUtc);
  await f.restart();assert.deepEqual(f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06'),originalSchedules);
  await f.todoHost.tick(true);assert.equal(f.shown,0);
  await pause(Math.max(1,Date.parse(f.input.remindUtc)-Date.now()+20));
  await f.todoHost.tick(true);
  for(let i=0;i<200&&!f.shown;i++)await pause();
  assert.equal(f.shown,1);assert.equal(f.todoHost.snapshot().items[0].reminder.state,'delivered');
  assert.equal(f.app.runtime.getSchedule(originalSchedules[0].scheduleId).status,'fired');
  await f.restart();await f.todoHost.tick(true);assert.equal(f.shown,1);
  assert.equal(f.todoHost.snapshot().items.length,1);assert.equal(f.todoHost.snapshot().items[0].revision,2);
});

for(const change of ['cancel','edit'])test('F06 future completion rejects original reminder '+change+' during consent',async t=>{
  const f=await fixture(t,{future:true,beforeCompletion:async({todoHost})=>{
    const item=todoHost.snapshot().items[0];await todoHost.update({id:item.id,...(change==='cancel'?{status:'cancelled'}:{title:'User changed the original'})});
  }});
  assert.notEqual(f.child.state,'succeeded');assert.equal(f.shown,0);
  assert.equal(f.cloud.some(request=>request.continuation?.result?.reminderState==='scheduled'),false);
  assert.equal(f.todoHost.snapshot().items[0].revision,2);
  if(change==='cancel')assert.equal(f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06')[0].status,'cancelled');
});

test('F06 child denial creates no Todo or schedule',async t=>{
  const f=await fixture(t,{future:true,denyTool:'todo.create'});assert.notEqual(f.child.state,'succeeded');
  assert.equal(f.todoHost.snapshot().items.length,0);assert.deepEqual(f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06'),[]);
});

test('F06 original decision source revoked after question preparation cannot be approved',async t=>{
  const f=await fixture(t,{future:true,revokeDecisionSource:true});assert.notEqual(f.child.state,'succeeded');
  assert.equal(f.decisionProofs.length,1);assert.ok(f.responses.some(response=>response.accepted===false&&response.state==='stale'));
  assert.equal(f.todoHost.snapshot().items.length,0);assert.deepEqual(f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06'),[]);
});

test('F06 becoming due during completion consent is not exported as scheduled and original reminder remains deliverable',async t=>{
  const f=await fixture(t,{future:true,beforeCompletion:async({todoHost})=>{
    await pause(Math.max(1,Date.parse(todoHost.snapshot().items[0].reminder.remindAt.utc)-Date.now()+20));
  }});
  assert.notEqual(f.child.state,'succeeded');assert.equal(f.cloud.some(request=>request.continuation?.result?.reminderState==='scheduled'),false);
  await f.todoHost.tick(true);for(let i=0;i<200&&!f.shown;i++)await pause();
  assert.equal(f.shown,1);await f.todoHost.tick(true);assert.equal(f.shown,1);
});

test('F06 unknown device delivery never becomes confirmed and recovery does not resend',async t=>{
  const f=await fixture(t,{unknownDelivery:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.shown,1);
  assert.equal(f.cloud.some(request=>request.continuation?.result?.delivered===true),false);
  await f.restart();await f.todoHost.tick(true);assert.equal(f.shown,1);
});
