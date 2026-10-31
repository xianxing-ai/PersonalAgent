import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {FakeCalendarProvider,defaultCalendarFixtures} from '@personal-agent/calendar';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createBusinessWorkflowWorkerPorts} from '../electron/business-workflow-worker-ports.js';
import {createConnectorConversationTools} from '../electron/connector-conversation-tools.js';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {prepareWorkflowHostPreflight} from '../electron/workflow-host-preflight.js';
import {prepareConfiguredWorkflowDecisionQuestion} from '../electron/configured-workflow-decision-source.js';

// Actual Engine/Runtime/SQLite/Todo/scheduler/question/Policy composition. Calendar,
// candidate preparation/selection, remote transport and graph export consent are fixtures.
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function scenario(t,options={}){
  const cache=new URL('../../../.cache/business-f11-runtime/',import.meta.url);mkdirSync(cache,{recursive:true});
  const userData=mkdtempSync(new URL('case-',cache)),cloud=[],approvals=[],proposals=[];
  let app,input,todo,changed=false,reads=0,writes=0;
  const provider=new FakeCalendarProvider([defaultCalendarFixtures[0]]),write=provider.writes.updateEvent.bind(provider.writes),read=provider.fetchWindow.bind(provider);
  provider.fetchWindow=async(...args)=>{reads++;if(reads===2&&options.changedCalendar)await write({uid:'evt-standup',summary:'Another client changed it'});return read(...args);};
  provider.writes.updateEvent=async(...args)=>{writes++;if(options.unknownUpdate)throw new ProtocolError('RESULT_UNKNOWN','Fixture update outcome unknown');return write(...args);};
  const resolveConversation=taskId=>app.readToolConversation(taskId)??app.runtime.getTask(taskId).conversationId;
  const question=createDesktopAuthorizationQuestionHost({createQuestions:args=>new runtimeModule.AuthorizationQuestions(args),getApplication:()=>app,
    namespace:'f11',resolveConversation,available:()=>true,
    profiles:[{ref:'bounded',revision:1,mode:'workspace-write',label:'Fixture policy',available:true}],defaultProfileRef:'bounded'});
  const connector=createConnectorConversationTools({question,getApplication:()=>app,resolveConversation,
    calendar:{binding:()=>({calendarUrl:'https://offline.invalid/calendar/',calendarName:'Fixture',accountRef:'fixture-calendar',revision:1}),
      readAuthorization:async()=> 'Fixture authorization'},createCalendarProvider:()=>provider});
  const todoHost=createDesktopTodoHost({userData,namespace:'f11',question,createDeliveryHost:runtimeModule.createReminderDeliveryHost,
    safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>Buffer.from(value).toString()}});
  const businessTools=[...connector.tools.filter(tool=>tool.descriptor.name.startsWith('calendar.')),...todoHost.tools.filter(tool=>tool.descriptor.name.startsWith('todo.'))];
  const policies=[...connector.competitionToolExports,...todoHost.competitionToolExports];
  const prepareExport=async scope=>{await connector.prepareExport(scope);await todoHost.prepareExport(scope);};
  const composition=createBusinessWorkflowWorkerPorts({runtimeModule,getApplication:()=>app,businessTools,todoHost,competitionToolExports:policies,
    prepareCompetitionToolExport:prepareExport,readBusinessAvailability:()=>({ready:true,bindingId:'fixture-calendar-and-todo'}),
    authorizeExport:async request=>{if(request.stage==='completion'&&options.changeAtCompletion)await todoHost.update({id:todo.id,title:'User edited after clear'});
      return !(request.stage==='completion'&&options.denyCompletion);}});
  const worker=composition.configuredWorkflowWorkerPorts.find(item=>item.workflowId==='F11');assert.ok(worker);
  assert.ok(composition.unavailable.includes('f11_missing_decision_voice_source_unavailable'));
  const decision=createWorkflowDecisionTool({selector:{select:async()=> 'supported'}});
  const tools=[...businessTools,...composition.tools,decision,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,
    getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(subtask,context,scoped)=>app.runDefaultSubagentWorker(subtask,context,scoped)})];
  const secret='fixture-f11-original-secret-thirty-two-characters';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>{
      const value=context.node.id==='F11_N02'?{toolName:'calendar.events',toolVersion:businessTools.find(tool=>tool.descriptor.name==='calendar.events').descriptor.version,
        arguments:input.calendarReadArguments}:context.node.id==='F11_N03'?{risk:'Fixture explicit change',recommendedAlternative:{update:input.update,reminder:input.reminder},
        requiresVoiceConfirm:options.needsClarification===true}:{arguments:{update:input.update,reminder:input.reminder}};
      return [{id:'supported',description:'Explicit fixture plan',value},{id:'review',description:'Fixture abstention',value:null,abstain:true}];
    }});
  const image={bindingId:'fixture-f11-image',receiptSecret:async()=>secret,advance:async request=>{const result=await engine.advance(request);proposals.push(...result.proposals);return result;}};
  app=runtimeModule.createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'f11',
    coordinationBinding:'fixture-deployment',tools,configuredWorkflowWorkers:[{...worker,image}],coordination:{execute:async request=>{
      cloud.push(request);if(app.runtime.getTask(request.taskId).conversationId==='fixture-chat'||request.continuation)return {kind:'text',text:'Fixture result',verification:'unverified'};
      return {kind:'tool_proposal',proposalId:'original-f11',toolName:worker.toolName,toolVersion:worker.toolVersion,arguments:input,verification:'unverified'};}},
    requiresToolAuthorization:()=>true,requestToolAuthorization:async scope=>{
      await prepareWorkflowHostPreflight({application:app,scope,prepareExport});prepareConfiguredWorkflowDecisionQuestion({application:app,scope,question});
      return question.requestToolAuthorization(scope);
    },competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>policies.find(policy=>policy.toolName===tool.descriptor.name)??{toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:'fixture-graph',accepts:()=>true,project:({result})=>result})});
  todoHost.bindApplication(app);await todoHost.create({title:'Original travel reminder',remindUtc:new Date(Date.now()+120000).toISOString()});
  todo=todoHost.snapshot().items[0];const schedule=app.runtime.listSchedules('desktop-todo-reminders:f11')[0];
  input={calendarReadArguments:{fromUtc:'2026-09-07T00:00:00.000Z',toUtc:'2026-09-08T00:00:00.000Z'},
    update:{externalId:'evt-standup',location:'online'},reminder:{todoId:todo.id,revision:todo.revision,scheduleId:schedule.scheduleId,conversationId:schedule.conversationId}};
  t.after(async()=>{for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    question.close();await todoHost.close();for(let i=0;i<300&&app.activeTaskCount;i++)await pause();await connector.close();app.close();});
  const client=new Client(app);await client.connect();
  const root=await client.call('task.submit',{goal:'Fixture explicit F11 calendar change',conversationId:'fixture-chat'},{idempotencyKey:'fixture-f11',timeoutMs:60000});
  let child;
  for(let i=0;i<2000;i++){
    for(const card of question.snapshot().filter(item=>item.state==='pending')){
      approvals.push(card.toolName);
      if(card.toolName==='todo.update'&&options.changeBeforeClear&&!changed){await todoHost.update({id:todo.id,title:'User edit while clear waits'});changed=true;}
      question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:card.toolName===options.denyTool?'deny':'allow_once'},card.conversationId);
    }
    [child]=app.readSubagentTasks(root.taskId);if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;
    await pause();
  }
  assert.ok(child);return {app,child,todoHost,todo,schedule,reads,writes,cloud,approvals,proposals,
    diagnostics:app.runtime.listTasks({limit:100}).items.map(task=>({state:task.state,error:task.error,tool:app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName}))};
}

test('F11 actual graph approves original calendar update and conditional reminder clear separately',async t=>{
  const f=await scenario(t);assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.reads,2);assert.equal(f.writes,1);
  assert.equal(f.todoHost.snapshot().items[0].reminder,undefined);assert.equal(f.app.runtime.getSchedule(f.schedule.scheduleId).status,'cancelled');
  assert.equal(f.approvals.filter(name=>name==='calendar.update').length,1);assert.equal(f.approvals.filter(name=>name==='todo.update').length,1);
  assert.ok(f.proposals.some(item=>item.toolName==='workflow.guard.f11_n04'));assert.ok(f.proposals.some(item=>item.toolName==='workflow.guard.f11_n05'));
  assert.equal(f.proposals.some(item=>item.toolName==='workflow.host.f11_n04'),false);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.calendarUpdated===true&&request.continuation.result.oldTrafficAlarmVoided===true));
});
for(const option of ['needsClarification','changedCalendar'])test('F11 '+option+' never falls back to an unverified write',async t=>{
  const f=await scenario(t,{[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.writes,0);assert.deepEqual(f.todoHost.snapshot().items[0],f.todo);
});
test('F11 denying the calendar child preserves the original reminder',async t=>{
  const f=await scenario(t,{denyTool:'calendar.update'});assert.notEqual(f.child.state,'succeeded');assert.equal(f.writes,0);assert.deepEqual(f.todoHost.snapshot().items[0],f.todo);
});
test('F11 denying the separate Todo child retains calendar change and the original reminder',async t=>{
  const f=await scenario(t,{denyTool:'todo.update'});assert.notEqual(f.child.state,'succeeded');assert.equal(f.writes,1);
  assert.deepEqual(f.todoHost.snapshot().items[0],f.todo);assert.equal(f.app.runtime.getSchedule(f.schedule.scheduleId).status,'pending');
});
for(const option of ['unknownUpdate','changeBeforeClear','denyCompletion','changeAtCompletion'])test('F11 '+option+' retains partial effects without successful completion',async t=>{
  const f=await scenario(t,{[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.writes,1);
  assert.equal(f.cloud.some(request=>request.continuation?.result?.calendarUpdated===true),false);
  if(option==='unknownUpdate'||option==='changeBeforeClear')assert.ok(f.todoHost.snapshot().items[0].reminder);
});
