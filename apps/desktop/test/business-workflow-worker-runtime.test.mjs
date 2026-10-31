import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import * as runtimeModule from '@personal-agent/runtime/application';
import {FakeCalendarProvider} from '@personal-agent/calendar';
import {createBusinessWorkflowWorkerPorts} from '../electron/business-workflow-worker-ports.js';
import {createConnectorConversationTools} from '../electron/connector-conversation-tools.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {prepareWorkflowHostPreflight} from '../electron/workflow-host-preflight.js';

// Actual delegated Runtime/configured worker/Policy/bridge with explicit offline image,
// decision and calendar provider fixtures. No AgentArts or real account acceptance.
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function scenario(t,{denyCreate=false,unknownCreate=false,denyExport=false}={}){
  let app,created=0,reads=0,stage=0,sourceVersion;const cloud=[],exports=[],approvals=[];
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
  const decision={descriptor:{name:'decision.choose_candidate',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:decision'],
    inputSchema:{type:'object'},outputSchema:{type:'object'},idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute:async()=>({selected:true})};
  const tools=[...businessTools,...composition.tools,decision,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,
    getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(subtask,context,scoped)=>app.runDefaultSubagentWorker(subtask,context,scoped)})];
  const image={bindingId:'offline-fixed-image',receiptSecret:async()=> 'offline-secret-at-least-thirty-two-characters',advance:async request=>{
    if(stage===1)sourceVersion=request.receipts[0].result.sourceVersion;
    const steps=[['F07_N02','calendar.events',input.calendarReadArguments],['F07_N03','decision.choose_candidate',{context:JSON.stringify({workflowId:'F07',nodeId:'F07_N03'})}],
      ['F07_N04','workflow.host.f07_n04',{calendarVersionAtRead:sourceVersion,calendarVersionNow:sourceVersion}],
      ['F07_N05','workflow.host.f07_n05',{title:input.title,slot:input.slot}]];
    const current=steps[stage],nodes=Object.fromEntries([1,2,3,4,5].map(n=>['F07_N0'+n,{state:n<=stage+1?'completed':n===stage+2?'waiting_receipt':'pending'}]));
    const proposals=[];if(current){const [nodeId,toolName,args]=current,tool=tools.find(tool=>tool.descriptor.name===toolName).descriptor;
      proposals.push({kind:'tool_proposal',nodeId,toolName,toolVersion:tool.version,arguments:args,operationId:'offline-'+nodeId,
        proposalId:'offline-'+nodeId,originControlRevision:0,inputDigest:hash(args),toolSchemaDigest:hash(tool.inputSchema),resourceKeys:[],effect:tool.sideEffect==='read'?'read':'write'});}
    stage++;return {workflowId:'F07',workflowVersion:'1.0.0',checkpoint:'offline-'+stage,state:current?'awaiting_host':'settled',nodes,proposals};
  }};
  app=runtimeModule.createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'offline-business-worker',
    coordinationBinding:'offline-deployment',tools,configuredWorkflowWorkers:[{...worker,image}],
    coordination:{execute:async request=>{cloud.push(request);
      if(app.runtime.getTask(request.taskId).conversationId==='offline-chat'||request.continuation)
        return {kind:'text',text:'Offline result',verification:'unverified'};
      return {kind:'tool_proposal',proposalId:'original-f07',toolName:worker.toolName,toolVersion:worker.toolVersion,arguments:input,verification:'unverified'};}},
    requiresToolAuthorization:()=>true,requestToolAuthorization:async scope=>{
      await prepareWorkflowHostPreflight({application:app,scope,prepareExport});return question.requestToolAuthorization(scope);
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
  return {app,child,created,reads,stage,cloud,exports,approvals};
}
test('F07 actual configured worker independently approves four reads and one write then verifies original provider receipt',async t=>{
  const f=await scenario(t);assert.equal(f.child.state,'succeeded',JSON.stringify(f.child.error));
  assert.equal(f.created,1);assert.equal(f.reads,4);assert.equal(f.exports.filter(name=>name==='calendar.events').length,4);
  assert.equal(f.exports.filter(name=>name==='calendar.create').length,1);
  assert.equal(f.approvals.filter(item=>item.tool==='calendar.create').length,1);
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
