import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createBusinessWorkflowWorkerPorts} from '../electron/business-workflow-worker-ports.js';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {prepareWorkflowHostPreflight} from '../electron/workflow-host-preflight.js';
import {prepareConfiguredWorkflowDecisionQuestion} from '../electron/configured-workflow-decision-source.js';

// Actual Engine/SQLite/notification CAS feed/question/Policy. OS channel, candidate
// preparation/selection, cloud transport and graph export consent are explicit fixtures.
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function scenario(t,options={}){
  const cache=new URL('../../../.cache/business-f12-runtime/',import.meta.url);mkdirSync(cache,{recursive:true});
  const userData=mkdtempSync(new URL('case-',cache)),approvals=[],cloud=[],proposals=[],outcomes=new Map();
  let app,root,changed=false,policyChanged=false,sends=0;
  const question=createDesktopAuthorizationQuestionHost({createQuestions:args=>new runtimeModule.AuthorizationQuestions(args),getApplication:()=>app,
    namespace:'f12',resolveConversation:taskId=>app.readToolConversation(taskId)??app.runtime.getTask(taskId).conversationId,available:()=>true,
    profiles:[{ref:'bounded',revision:1,mode:'workspace-write',label:'Fixture policy',available:true}],defaultProfileRef:'bounded'});
  const channel={async sendAdvisoryNotification(input){sends++;if(!options.unknown)outcomes.set(input.id,{id:input.id,roundId:input.roundId,
    deliveryState:options.failed?'failed':'delivered',observedAt:new Date().toISOString(),evidenceRefs:['fixture-native-'+sends]});},
    readDeliveryOutcome:id=>outcomes.get(id),dispose(){}};
  const host=createDesktopNotificationApplicationHost({namespace:'f12',channel,question});
  const composition=createBusinessWorkflowWorkerPorts({runtimeModule,getApplication:()=>app,notificationHost:host,
    prepareCompetitionToolExport:async()=>{},readBusinessAvailability:()=>({ready:true,bindingId:'fixture-notification-device'}),
    authorizeExport:async request=>{
      if(request.stage==='completion'&&options.readDuringCompletion)host.acknowledgeRead({operationId:'user-read',itemIds:['item']});
      return !(request.stage==='completion'&&options.denyCompletion);
    }});
  const worker=composition.configuredWorkflowWorkerPorts.find(item=>item.workflowId==='F12');assert.ok(worker);
  assert.ok(composition.unavailable.includes('f12_user_return_event_source_unavailable'));
  const decision=createWorkflowDecisionTool({selector:{select:async()=> 'supported'}});
  const tools=[...host.tools,...composition.tools,decision,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,
    getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(subtask,context,scoped)=>app.runDefaultSubagentWorker(subtask,context,scoped)})];
  const secret='fixture-f12-original-secret-thirty-two-characters',input={itemId:'item',trigger:options.query?'on_demand':'event'};
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>{
      let value={arguments:{itemId:'item'}};
      if(context.node.id==='F12_N03')value={action:options.silent||options.query||options.legacyPause?'feed_only':'deliver',roundId:context.predecessorOutputs.F12_N02.roundId};
      if(context.node.id==='F12_N04')value={arguments:{roundId:context.predecessorOutputs.F12_N03.roundId,itemId:'item',channel:'banner'}};
      return [{id:'supported',description:'Original fixture notification action',value},{id:'review',description:'Fixture abstention',value:null,abstain:true}];
    }});
  app=runtimeModule.createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'f12',
    coordinationBinding:'fixture-deployment',tools,configuredWorkflowWorkers:[{...worker,image:{bindingId:'fixture-f12-image',receiptSecret:async()=>secret,
      advance:async request=>{const result=await engine.advance(request);proposals.push(...result.proposals);return result;}}}],
    coordination:{execute:async request=>{cloud.push(request);
      if(app.runtime.getTask(request.taskId).conversationId==='fixture-chat'||request.continuation)return {kind:'text',text:'Fixture result',verification:'unverified'};
      return {kind:'tool_proposal',proposalId:'original-f12',toolName:worker.toolName,toolVersion:worker.toolVersion,arguments:input,verification:'unverified'};}},
    requiresToolAuthorization:()=>true,requestToolAuthorization:async scope=>{
      await prepareWorkflowHostPreflight({application:app,scope,prepareExport:async()=>{}});
      prepareConfiguredWorkflowDecisionQuestion({application:app,scope,question});host.prepareAuthorization(scope);
      return question.requestToolAuthorization(scope);
    },competitionToolAvailability:tools.filter(tool=>tool.descriptor.name!=='notifications.interruption_policy.set').map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:'fixture-graph',accepts:()=>true,project:({result})=>result}))});
  const client=new Client(app);await client.connect();host.bindApplication(app,client);
  t.after(async()=>{for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    question.close();for(let i=0;i<300&&app.activeTaskCount;i++)await pause();host.dispose();app.close();});
  function respond(){for(const card of question.snapshot().filter(item=>item.state==='pending')){
    approvals.push(card.toolName);
    if(card.toolName==='workflow.host.f12_n04'&&options.policyBeforeSend){
      if(!changed){changed=true;void host.configureSettings({operationId:'change-policy',expectedRevision:1,scope:{kind:'global'},patch:{mode:'silent'}})
        .then(()=>{policyChanged=true;});}
      if(!policyChanged)continue;
    }
    if(card.toolName==='workflow.host.f12_n04'&&options.cancelBeforeSend){
      const graph=app.readSubagentTasks(root.taskId)[0];if(graph)app.runtime.requestCancel(graph.taskId);continue;
    }
    if(card.toolName==='workflow.host.f12_n04'&&options.withdrawBeforeSend&&!changed){host.runtimeHost.withdrawNotifications({operationId:'user-withdraw',itemIds:['item']});changed=true;}
    question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:card.toolName===options.denyTool?'deny':'allow_once'},card.conversationId);
  }}
  let configured=false;
  const settings=host.configureSettings({operationId:'initial-policy',expectedRevision:0,scope:{kind:'global'},patch:{mode:options.silent?'silent':'normal',
    maxInterruptions:options.quotaZero?0:null,windowMinutes:17,silentUntilUtc:null,preferredChannel:'banner',allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null}})
    .then(()=>{configured=true;});
  for(let i=0;i<2000&&!configured;i++){respond();await pause();}await settings;
  if(options.legacyPause)host.runtimeHost.importLegacyPolicy({kind:'connector',connectorId:'mail'},{pauseUntilUtc:new Date(Date.now()+60000).toISOString()});
  const now=new Date().toISOString();host.ingest([{source:'mail',accountRef:'fixture',externalId:'item',occurredAt:now,fetchedAt:now,
    contentRef:'fixture:item',sensitivity:'normal',dedupeKey:'item'}],{scope:{kind:'connector',connectorId:'mail'}});
  async function run(id){
    root=await client.call('task.submit',{goal:'Fixture F12 current notification',conversationId:'fixture-chat'},{idempotencyKey:id,timeoutMs:60000});
    let child;
    for(let i=0;i<2500;i++){respond();[child]=app.readSubagentTasks(root.taskId);
      if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;await pause();}
    assert.ok(child);return child;
  }
  const child=await run('fixture-f12'),repeated=options.repeat?await run('fixture-f12-repeat'):undefined;
  return {app,host,child,repeated,sends,approvals,cloud,proposals,diagnostics:app.runtime.listTasks({limit:100}).items.map(task=>({state:task.state,
    error:task.error,tool:app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName}))};
}

test('F12 actual configured graph consumes current policy and durable original banner receipt',async t=>{
  const f=await scenario(t);assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.sends,1);
  assert.ok(f.approvals.includes('workflow.host.f12_n04'));assert.ok(f.host.snapshot().feed.items[0].deliveredAt);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.notificationState==='delivered'));
});
test('F12 a durable device failure is reported as failed and never as delivered',async t=>{
  const f=await scenario(t,{failed:true});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.sends,1);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.notificationState==='failed'&&request.continuation.result.delivered===false));
  assert.equal(f.host.snapshot().feed.items[0].deliveredAt,undefined);
});
for(const option of ['silent','query','quotaZero','legacyPause'])test('F12 '+option+' retains unread feed without a late notification',async t=>{
  const f=await scenario(t,{[option]:true});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.sends,0);
  assert.equal(f.host.snapshot().feed.items[0].unread,true);assert.equal(f.host.snapshot().feed.items[0].deliveredAt,undefined);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.notificationState==='feed_only'));
});
for(const option of ['unknown','withdrawBeforeSend','readDuringCompletion','denyCompletion'])test('F12 '+option+' cannot publish a successful graph receipt',async t=>{
  const f=await scenario(t,{[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,option==='withdrawBeforeSend'?0:1);
  assert.ok(f.approvals.includes('workflow.host.f12_n04'));
  assert.equal(f.cloud.some(request=>request.continuation?.result?.notificationState!==undefined),false);
});
test('F12 original delivery approval denial keeps the feed and produces no device send',async t=>{
  const f=await scenario(t,{denyTool:'workflow.host.f12_n04'});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);
  assert.ok(f.approvals.includes('workflow.host.f12_n04'));
  assert.equal(f.host.snapshot().feed.items[0].unread,true);
});
for(const option of ['policyBeforeSend','cancelBeforeSend'])test('F12 '+option+' revokes pending delivery before the device call',async t=>{
  const f=await scenario(t,{[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);
  assert.ok(f.approvals.includes('workflow.host.f12_n04'));assert.equal(f.host.snapshot().feed.items[0].unread,true);
});
test('F12 a second graph cannot replace an unknown original round with another send',async t=>{
  const f=await scenario(t,{unknown:true,repeat:true});assert.notEqual(f.child.state,'succeeded');assert.notEqual(f.repeated.state,'succeeded');assert.equal(f.sends,1);
});
