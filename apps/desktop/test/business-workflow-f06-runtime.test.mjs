import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createBusinessWorkflowWorkerPorts} from '../electron/business-workflow-worker-ports.js';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {createVerifyWorkflowReminderBinding} from '../electron/f06-reminder-binding.js';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {prepareWorkflowHostPreflight} from '../electron/workflow-host-preflight.js';

// Real local scheduler/SQLite/Todo/notification records and configured worker. Image,
// semantic decision and OS show event are explicit fixtures; the clock is never advanced.
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
test('F06 original due schedule delivers once and its exact automatic revision is accepted through the configured worker',async t=>{
  const cache=new URL('../../../.cache/business-f06-runtime/',import.meta.url);mkdirSync(cache,{recursive:true});
  const userData=mkdtempSync(new URL('case-',cache)),now=Date.now(),cloud=[];let app,notificationHost,shown=0,stage=0,originalTodo;
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new runtimeModule.AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'offline-f06',resolveConversation:taskId=>app.readToolConversation(taskId)??app.runtime.getTask(taskId).conversationId,available:()=>true,
    profiles:[{ref:'bounded',mode:'workspace-write',revision:1,label:'Offline policy',available:true}],defaultProfileRef:'bounded'});
  const channel=createDesktopNotificationPort({storageDir:userData,onOutcome:outcome=>notificationHost.receipt(outcome),notifier:{
    isSupported:async()=>true,show:async(_input,events)=>{shown++;events.onShow();return {close(){}};}}});
  notificationHost=createDesktopNotificationApplicationHost({namespace:'offline-f06',channel});
  const todoHost=createDesktopTodoHost({userData,namespace:'offline-f06',notificationHost,question,
    safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>Buffer.from(value).toString()},
    createDeliveryHost:runtimeModule.createReminderDeliveryHost,verifyWorkflowReminderBinding:createVerifyWorkflowReminderBinding({getApplication:()=>app}),
    onNotification:notice=>notificationHost.deliverBatch({batchId:notice.batchId,scope:{kind:'connector',connectorId:'productivity'},
      expiresAt:new Date(Date.now()+60000).toISOString(),title:'Offline reminder',body:notice.summary,source:'productivity'})});
  const businessTools=todoHost.tools,policies=todoHost.competitionToolExports,prepareExport=scope=>todoHost.prepareExport(scope);
  const composition=createBusinessWorkflowWorkerPorts({runtimeModule,getApplication:()=>app,businessTools,todoHost,notificationHost,
    competitionToolExports:policies,prepareCompetitionToolExport:prepareExport,readBusinessAvailability:()=>({ready:true,bindingId:'offline-device'}),authorizeExport:async()=>true});
  const worker=composition.configuredWorkflowWorkerPorts.find(item=>item.workflowId==='F06');assert.ok(worker);
  const input={todoTitle:'Original due reminder',remindUtc:new Date(now-1000).toISOString()};
  const decision={descriptor:{name:'decision.choose_candidate',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:decision'],
    inputSchema:{type:'object'},outputSchema:{type:'object'},idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute:async()=>({selected:true})};
  const tools=[...businessTools,...notificationHost.tools,...composition.tools,decision,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,
    getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(subtask,context,scoped)=>app.runDefaultSubagentWorker(subtask,context,scoped)})];
  const image={bindingId:'offline-f06-image',receiptSecret:async()=> 'offline-secret-at-least-thirty-two-characters',advance:async request=>{
    if(stage===2)originalTodo=request.receipts[0].result;
    const identity=originalTodo&&{todoId:originalTodo.todoId,revision:originalTodo.revision};
    const steps=[['F06_N02','decision.choose_candidate',{context:JSON.stringify({workflowId:'F06',nodeId:'F06_N02'})}],
      ['F06_N03','workflow.host.f06_n03',input],['F06_N04','workflow.host.f06_n04',identity],
      ['F06_N05','workflow.host.f06_n05',{notification:identity}]];
    const current=steps[stage],nodes=Object.fromEntries([1,2,3,4,5].map(n=>['F06_N0'+n,{state:n<=stage+1?'completed':n===stage+2?'waiting_receipt':'pending'}]));
    const proposals=[];if(current){const [nodeId,toolName,args]=current,tool=tools.find(tool=>tool.descriptor.name===toolName).descriptor;
      proposals.push({kind:'tool_proposal',nodeId,toolName,toolVersion:tool.version,arguments:args,operationId:'offline-'+nodeId,
        proposalId:'offline-'+nodeId,originControlRevision:0,inputDigest:hash(args),toolSchemaDigest:hash(tool.inputSchema),resourceKeys:[],effect:tool.sideEffect==='read'?'read':'write'});}
    stage++;return {workflowId:'F06',workflowVersion:'1.0.0',checkpoint:'offline-'+stage,state:current?'awaiting_host':'settled',nodes,proposals};
  }};
  app=runtimeModule.createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,
    hostUserNamespace:'offline-f06',coordinationBinding:'offline-deployment',tools,configuredWorkflowWorkers:[{...worker,image}],
    coordination:{execute:async request=>{cloud.push(request);
      if(app.runtime.getTask(request.taskId).conversationId==='offline-chat'||request.continuation)return {kind:'text',text:'Offline result',verification:'unverified'};
      return {kind:'tool_proposal',proposalId:'original-f06',toolName:worker.toolName,toolVersion:worker.toolVersion,arguments:input,verification:'unverified'};}},
    requestToolAuthorization:async scope=>{
      await prepareWorkflowHostPreflight({application:app,scope,prepareExport});
      return question.requestToolAuthorization(scope);
    },requiresToolAuthorization:()=>true,
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      available:()=>tool.descriptor.name==='subagent.dispatch'||worker.requiredTools.some(item=>item.name===tool.descriptor.name),
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:'offline-fixture',accepts:()=>true,project:({result})=>result}))});
  todoHost.bindApplication(app);const client=new Client(app);await client.connect();notificationHost.bindApplication(app,client);
  t.after(async()=>{await todoHost.close();for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    question.close();for(let i=0;i<300&&app.activeTaskCount;i++)await pause();notificationHost.dispose();app.close();});
  const root=await client.call('task.submit',{goal:'Offline due reminder workflow',conversationId:'offline-chat'},
    {idempotencyKey:'offline-reminder-graph',timeoutMs:60000});
  let child;
  for(let i=0;i<2500;i++){
    for(const card of question.snapshot().filter(item=>item.state==='pending'))question.respond({questionId:card.questionId,
      expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
    [child]=app.readSubagentTasks(root.taskId);
    if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;
    await pause();
  }
  assert.ok(child);assert.equal(child.state,'succeeded',JSON.stringify(child.error));
  assert.equal(originalTodo.revision,1);assert.equal(todoHost.snapshot().items[0].revision,2);
  assert.equal(todoHost.snapshot().items[0].reminder.state,'delivered');assert.equal(shown,1);
  assert.ok(cloud.some(request=>request.continuation?.result?.delivered===true));
  await todoHost.tick(true);assert.equal(shown,1);
  const task=app.runtime.listTasks({limit:100}).items.find(item=>app.runtime.loadCheckpoint(item.taskId,'host-tool-intent')?.toolName==='todo.create');
  const intent=app.runtime.loadCheckpoint(task.taskId,'host-tool-intent'),result=app.readHostToolTask(task.taskId).confirmed.result;
  const policy=policies.find(item=>item.toolName==='todo.create'),scope={taskId:task.taskId,proposalId:intent.commandId,
    runId:'host-tool-'+task.taskId,deadline:intent.deadline,arguments:intent.arguments,result,signal:new AbortController().signal};
  assert.deepEqual(policy.project(scope),result);
  assert.throws(()=>policy.project({...scope,result:{...result,item:{...result.item,title:'substituted'}}}),/出机许可不可用/);
  app.runtime.saveCheckpoint(task.taskId,'host-tool-intent',{...intent,commandId:'foreign'});
  assert.throws(()=>policy.project(scope),/出机许可不可用/);app.runtime.saveCheckpoint(task.taskId,'host-tool-intent',intent);
  todoHost.revoke();assert.throws(()=>policy.project(scope),/授权已失效/);
});
