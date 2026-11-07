import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {ProtocolError} from '@personal-agent/contracts';
import * as runtimeModule from '@personal-agent/runtime/application';
import {FakeCalendarProvider} from '@personal-agent/calendar';
import {createBusinessWorkflowWorkerPorts} from '../electron/business-workflow-worker-ports.js';
import {createConnectorConversationTools} from '../electron/connector-conversation-tools.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {prepareWorkflowHostPreflight} from '../electron/workflow-host-preflight.js';
import {prepareConfiguredWorkflowDecisionQuestion} from '../electron/configured-workflow-decision-source.js';

// Actual graph engine/delegated Runtime/configured worker/Policy/bridge. Candidate
// content/selection, image transport and calendar provider are explicit fixtures.
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function scenario(t,{denyCreate=false,unknownCreate=false,denyExport=false}={}){
  let app,created=0,reads=0,sourceVersion;const cloud=[],exports=[],approvals=[],decisionProofs=[];
  const provider=new FakeCalendarProvider([]),create=provider.writes.createEvent.bind(provider.writes),read=provider.fetchWindow.bind(provider);
  provider.fetchWindow=(...args)=>{reads++;return read(...args);};
  provider.writes.createEvent=async(...args)=>{created++;if(unknownCreate)throw new ProtocolError('RESULT_UNKNOWN','Offline original write unknown');return create(...args);};
  const resolveConversation=taskId=>app.readToolConversation(taskId)??app.runtime.getTask(taskId).conversationId;
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new runtimeModule.AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'offline-business-worker',resolveConversation,available:()=>true,
    profiles:[{ref:'bounded',mode:'workspace-write',revision:1,label:'Offline policy',available:true}],defaultProfileRef:'bounded'});
  const connector=createConnectorConversationTools({question,getApplication:()=>app,resolveConversation,
    calendar:{binding:()=>({calendarUrl:'https://offline.invalid/calendar/',calendarName:'Offline',accountRef:'offline-calendar',revision:1}),
      readAuthorization:async()=> 'Offline authorization'},createCalendarProvider:()=>provider});
  const businessTools=connector.tools.filter(tool=>tool.descriptor.name.startsWith('calendar.'));
  const policies=connector.competitionToolExports.map(policy=>({...policy,project:scope=>{exports.push(policy.toolName);
    if(denyExport&&policy.toolName==='calendar.create')throw new ProtocolError('UNAUTHORIZED','Offline export denied');return policy.project(scope);}}));
  const prepareExport=scope=>connector.prepareExport(scope);
  const composition=createBusinessWorkflowWorkerPorts({runtimeModule,getApplication:()=>app,businessTools,competitionToolExports:policies,
    prepareCompetitionToolExport:prepareExport,readBusinessAvailability:()=>({ready:true,bindingId:'offline-original-account'}),authorizeExport:async()=>true});
  const worker=composition.configuredWorkflowWorkerPorts.find(item=>item.workflowId==='F07');assert.ok(worker);
  const input={title:'Offline reserved event',slot:{startUtc:'2026-11-01T09:00:00.000Z',endUtc:'2026-11-01T10:00:00.000Z'},
    calendarReadArguments:{fromUtc:'2026-11-01T00:00:00.000Z',toUtc:'2026-11-02T00:00:00.000Z'}};
  const decision=createWorkflowDecisionTool({selector:{select:async()=> 'supported'}});
  const tools=[...businessTools,...composition.tools,decision,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,
    getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(subtask,context,scoped)=>app.runDefaultSubagentWorker(subtask,context,scoped)})];
  const secret='offline-secret-at-least-thirty-two-characters';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>{
      let value;
      if(context.node.id==='F07_N02')value={toolName:'calendar.events',toolVersion:businessTools.find(tool=>tool.descriptor.name==='calendar.events').descriptor.version,arguments:input.calendarReadArguments};
      else if(context.node.id==='F07_N03'){sourceVersion=context.predecessorOutputs.F07_N02.sourceVersion;value={selected:true};}
      else if(context.node.id==='F07_N04')value={arguments:{calendarVersionAtRead:sourceVersion,calendarVersionNow:sourceVersion}};
      else value={arguments:{title:input.title,slot:input.slot}};
      return [{id:'supported',description:'Explicit fixture candidate',value},{id:'review',description:'Explicit abstention',value:null,abstain:true}];
    }});
  const image={bindingId:'offline-fixed-image',receiptSecret:async()=>secret,advance:request=>engine.advance(request)};
  app=runtimeModule.createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'offline-business-worker',
    coordinationBinding:'offline-deployment',tools,configuredWorkflowWorkers:[{...worker,image}],
    coordination:{execute:async request=>{cloud.push(request);
      if(app.runtime.getTask(request.taskId).conversationId==='offline-chat'||request.continuation)
        return {kind:'text',text:'Offline result',verification:'unverified'};
      return {kind:'tool_proposal',proposalId:'original-f07',toolName:worker.toolName,toolVersion:worker.toolVersion,arguments:input,verification:'unverified'};}},
    requiresToolAuthorization:()=>true,requestToolAuthorization:async scope=>{
      await prepareWorkflowHostPreflight({application:app,scope,prepareExport});
      const proof=prepareConfiguredWorkflowDecisionQuestion({application:app,scope,question});if(proof)decisionProofs.push(proof);
      return question.requestToolAuthorization(scope);
    },
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>policies.find(policy=>policy.toolName===tool.descriptor.name)??({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:'offline-fixture',accepts:()=>true,project:({result})=>result}))});
  t.after(async()=>{for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    question.close();for(let i=0;i<300&&app.activeTaskCount;i++)await pause();await connector.close();app.close();});
  const client=new Client(app);await client.connect();
  const root=await client.call('task.submit',{goal:'Offline configured calendar workflow',conversationId:'offline-chat'},
    {idempotencyKey:'offline-graph',timeoutMs:60000});
  let child;
  for(let attempt=0;attempt<2500;attempt++){
    for(const card of question.snapshot().filter(item=>item.state==='pending')){
      const taskId=app.runtime.getApproval(card.sourceApprovalId).taskId,tool=app.runtime.loadCheckpoint(taskId,'host-tool-intent')?.toolName;
      approvals.push({taskId,tool});
      question.respond({questionId:card.questionId,expectedRevision:card.revision,
        decision:denyCreate&&tool==='calendar.create'?'deny':'allow_once'},card.conversationId);
    }
    [child]=app.readSubagentTasks(root.taskId);
    if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;
    await pause();
  }
  assert.ok(child);
  return {app,child,created,reads,cloud,exports,approvals,decisionProofs,diagnostics:app.runtime.listTasks({limit:100}).items.map(task=>({
    state:task.state,error:task.error,tool:app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName}))};
}
test('F07 actual configured worker independently approves four reads and one write then verifies original provider receipt',async t=>{
  const f=await scenario(t);assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));
  assert.equal(f.created,1);assert.equal(f.reads,4);assert.equal(f.exports.filter(name=>name==='calendar.events').length,4);
  assert.equal(f.exports.filter(name=>name==='calendar.create').length,1);
  assert.equal(f.approvals.filter(item=>item.tool==='calendar.create').length,1);
  assert.equal(f.decisionProofs.length,4);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.eventCreated===true));
});
test('F07 child approval denial prevents the write despite the approved graph host',async t=>{
  const f=await scenario(t,{denyCreate:true});assert.equal(f.created,0);assert.notEqual(f.child.state,'succeeded');
});
test('F07 unknown original write is retained without retry or successful completion',async t=>{
  const f=await scenario(t,{unknownCreate:true});assert.equal(f.created,1);assert.notEqual(f.child.state,'succeeded');
  assert.equal(f.cloud.some(request=>request.continuation?.result?.eventCreated===true),false);
});
test('F07 denied original child export retains the write and never exports graph success',async t=>{
  const f=await scenario(t,{denyExport:true});assert.equal(f.created,1);assert.notEqual(f.child.state,'succeeded');
  assert.equal(f.cloud.some(request=>request.continuation?.result?.eventCreated===true),false);
});
