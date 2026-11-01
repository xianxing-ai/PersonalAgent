import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createBusinessWorkflowWorkerPorts} from '../../electron/business-workflow-worker-ports.js';
import {createDesktopNotificationApplicationHost} from '../../electron/notification-application-host.js';
import {createDesktopAuthorizationQuestionHost} from '../../electron/authorization-question-host.js';
import {prepareWorkflowHostPreflight} from '../../electron/workflow-host-preflight.js';
import {prepareConfiguredWorkflowDecisionQuestion} from '../../electron/configured-workflow-decision-source.js';
import {createF12ExplicitReturnSource} from '../../electron/f12-explicit-return-source.js';
import {originalReturn} from './f12-return-scenario.mjs';

// Actual Engine/SQLite/notification CAS feed/question/Policy. OS channel, candidate
// preparation/selection, cloud transport and graph export consent are explicit fixtures.
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
export async function scenario(t,options={}){
  const cache=new URL('../../../../.cache/business-f12-runtime/',import.meta.url);mkdirSync(cache,{recursive:true});
  const userData=mkdtempSync(new URL('case-',cache)),approvals=[],cloud=[],proposals=[],outcomes=new Map(),sent=[];
  let app,root,returned,changed=false,policyChanged=false,sends=0;
  const explicitReturnSource=options.returning?createF12ExplicitReturnSource({getApplication:()=>app,
    readPersistedWorkflow:runtimeModule.readPersistedRuntimeProactiveWorkflow}):undefined;
  const question=createDesktopAuthorizationQuestionHost({createQuestions:args=>new runtimeModule.AuthorizationQuestions(args),getApplication:()=>app,
    namespace:'f12',resolveConversation:taskId=>app.readToolConversation(taskId)??app.runtime.getTask(taskId).conversationId,available:()=>true,
    profiles:[{ref:'bounded',revision:1,mode:'workspace-write',label:'Fixture policy',available:true}],defaultProfileRef:'bounded'});
  const fixtureChannel={async sendAdvisoryNotification(input){if(!options.unknown)outcomes.set(input.id,{id:input.id,roundId:input.roundId,
    deliveryState:options.failed?'failed':'delivered',observedAt:new Date().toISOString(),evidenceRefs:['fixture-native-'+sends]});},
    readDeliveryOutcome:id=>outcomes.get(id),dispose(){}};
  const channel=options.createChannel?options.createChannel({getApplication:()=>app,getNotificationHost:()=>host,userData}):fixtureChannel;
  if(typeof channel?.sendAdvisoryNotification!=='function'||typeof channel?.readDeliveryOutcome!=='function')throw Error('Explicit F12 device channel is unavailable');
  const host=createDesktopNotificationApplicationHost({namespace:'f12',channel:{...channel,async sendAdvisoryNotification(input){
    sends++;sent.push(input);return channel.sendAdvisoryNotification(input);}},question});
  const composition=createBusinessWorkflowWorkerPorts({runtimeModule,getApplication:()=>app,notificationHost:host,explicitReturnSource,
    prepareCompetitionToolExport:async()=>{},readBusinessAvailability:()=>({ready:true,bindingId:'fixture-notification-device'}),
    authorizeExport:async request=>{
      if(request.stage==='initial'&&options.changeReturnDuringInitial)await returned.control('pause','fixture-before-return-image');
      if(request.stage==='completion'&&options.changeReturnDuringCompletion)await returned.control('pause','fixture-after-return');
      if(request.stage==='completion'&&options.readDuringCompletion)host.acknowledgeRead({operationId:'user-read',itemIds:[options.multi?'item-2':'item']});
      return !(request.stage==='completion'&&options.denyCompletion);
    }});
  const worker=composition.configuredWorkflowWorkerPorts.find(item=>item.workflowId==='F12');assert.ok(worker);
  assert.equal(composition.unavailable.includes('f12_user_return_event_source_unavailable'),!options.returning);
  const decision=createWorkflowDecisionTool({selector:{select:async()=> 'supported'}});
  const tools=[...host.tools,...composition.tools,decision,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,
    getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(subtask,context,scoped)=>app.runDefaultSubagentWorker(subtask,context,scoped)})];
  const selection=options.multi?{itemIds:['item','item-2']}:{itemId:'item'};
  const secret='fixture-f12-original-secret-thirty-two-characters',input={...selection,trigger:options.returning?'on_return':options.query?'on_demand':'event'};
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>{
      let value={arguments:selection};
      if(context.node.id==='F12_N03')value={action:options.silent||options.query||options.legacyPause||options.returning?'feed_only':'deliver',roundId:context.predecessorOutputs.F12_N02.roundId};
      if(context.node.id==='F12_N04')value={arguments:{roundId:context.predecessorOutputs.F12_N03.roundId,
        ...(options.replaceSelection?{itemIds:['item','unapproved']}:selection),channel:'banner'}};
      return [{id:'supported',description:'Original fixture notification action',value},{id:'review',description:'Fixture abstention',value:null,abstain:true}];
    }});
  app=runtimeModule.createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'f12',proactiveWorkflows:!!options.returning,
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
    if(card.toolName==='workflow.host.f12_n04'&&options.withdrawBeforeSend&&!changed){host.runtimeHost.withdrawNotifications({operationId:'user-withdraw',itemIds:[options.multi?'item-2':'item']});changed=true;}
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
  if(options.splitBatches)host.drain();
  for(const id of [...(options.multi?['item-2']:[]),...(options.extraItem?['unapproved']:[])])host.ingest([{source:'mail',accountRef:'fixture',externalId:id,
    occurredAt:now,fetchedAt:now,contentRef:'fixture:'+id,sensitivity:'normal',dedupeKey:id}],
    {scope:{kind:'connector',connectorId:options.otherScope?'calendar':'mail'}});
  if(options.returning){
    returned=await originalReturn(app,{conversationId:options.foreignReturn?'foreign-conversation':'fixture-chat'});
    assert.equal(returned.error,undefined);input.returnSource=returned.source;
    if(!options.unrecordedReturn)explicitReturnSource.acceptExplicitReturn(returned.source);
    if(options.cancelReturn)app.runtime.requestCancel(returned.task.taskId);
    if(options.eraseReturn)app.runtime.saveCheckpoint(returned.user.taskId,'private-copy-erasure',{state:'withheld'});
  }
  async function run(id){
    root=await client.call('task.submit',{goal:'Fixture F12 current notification',conversationId:'fixture-chat'},{idempotencyKey:id,timeoutMs:60000});
    let child;
    for(let i=0;i<2500;i++){respond();[child]=app.readSubagentTasks(root.taskId);
      if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;await pause();}
    assert.ok(child);return child;
  }
  const child=await run('fixture-f12'),repeated=options.repeat?await run('fixture-f12-repeat'):undefined;
  return {app,host,userData,child,repeated,sends,sent,approvals,cloud,proposals,returned,explicitReturnSource,diagnostics:app.runtime.listTasks({limit:100}).items.map(task=>({state:task.state,
    error:task.error,tool:app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName}))};
}
