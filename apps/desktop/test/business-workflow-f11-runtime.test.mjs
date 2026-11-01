import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {FakeCalendarProvider,defaultCalendarFixtures} from '@personal-agent/calendar';
import {OpenMeteoProvider} from '@personal-agent/weather';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createBusinessWorkflowWorkerPorts} from '../electron/business-workflow-worker-ports.js';
import {createConnectorConversationTools} from '../electron/connector-conversation-tools.js';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {prepareWorkflowHostPreflight} from '../electron/workflow-host-preflight.js';
import {prepareConfiguredWorkflowDecisionQuestion} from '../electron/configured-workflow-decision-source.js';
import {createPublicConnectorHost} from '../electron/public-connector-host.js';
import {createF11LocationQuestionHost} from '../electron/f11-location-question-host.js';

// Actual Engine/Runtime/SQLite/Todo/scheduler/question/Policy composition. Calendar,
// candidate preparation/selection, remote transport and graph export consent are fixtures.
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function scenario(t,options={}){
  const cache=new URL('../../../.cache/business-f11-runtime/',import.meta.url);mkdirSync(cache,{recursive:true});
  const userData=mkdtempSync(new URL('case-',cache)),cloud=[],approvals=[],proposals=[],decisions=[];
  let app,input,todo,changed=false,reads=0,writes=0,weatherReads=0,locationReply,locationReplied=false,locationClock=0;
  const locationQuestion=createF11LocationQuestionHost({getApplication:()=>app,now:()=>Date.now()+locationClock});
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
  // Actual public provider/parser/export policy with explicit HTTP response fixtures; no network access.
  const publicHost=options.weather?createPublicConnectorHost({weatherProvider:new OpenMeteoProvider({fetchImpl:async url=>({ok:true,status:200,json:async()=>
    String(url).includes('geocoding')?{results:[{id:1816670,name:'Beijing',latitude:39.9075,longitude:116.39723,timezone:'Asia/Shanghai',feature_code:'PPLC',population:18960744,country:'China'}]}
      :{timezone:'Asia/Shanghai',daily:{time:['2026-09-07'],temperature_2m_min:[18],temperature_2m_max:[26],precipitation_probability_max:[45],weather_code:[3]}}})})}):undefined;
  const weather=publicHost?.tools.find(tool=>tool.descriptor.name==='weather.forecast');
  const businessTools=[...connector.tools.filter(tool=>tool.descriptor.name.startsWith('calendar.')),...todoHost.tools.filter(tool=>tool.descriptor.name.startsWith('todo.')),
    ...(weather?[{...weather,async execute(args,context){weatherReads++;if(options.unknownWeather)throw new ProtocolError('RESULT_UNKNOWN','Fixture forecast result unknown');
      const result=await weather.execute(args,context);
      if(options.staleWeather)result.cache.state='stale';
      if(options.expiredWeather){result.cache.fetchedAt=new Date(Date.now()-result.cache.ttlMs-1).toISOString();result.record.fetchedAt=result.cache.fetchedAt;}
      if(options.outsideCoverage)result.record.validFor='2026-09-08T00:00:00.000Z/2026-09-09T00:00:00.000Z';
      if(options.changedWeather&&weatherReads===2)result.forecast.summary='另一版合成预报';return result;
    }}]:[])];
  const policies=[...connector.competitionToolExports,...todoHost.competitionToolExports,...(publicHost?.competitionToolExports??[])];
  if(options.denyWeatherExport){const index=policies.findIndex(policy=>policy.toolName==='weather.forecast');policies[index]={...policies[index],accepts:()=>false};}
  const prepareExport=async scope=>{await connector.prepareExport(scope);await todoHost.prepareExport(scope);};
  const composition=createBusinessWorkflowWorkerPorts({runtimeModule,getApplication:()=>app,businessTools,todoHost,competitionToolExports:policies,
    ...(options.missingLocation?{f11LocationQuestion:locationQuestion}:{}),
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
      decisions.push(context);
      const value=context.node.id==='F11_N01'?{arguments:input.weather?{weather:input.weather}:{}}:context.node.id==='F11_N02'?{toolName:'calendar.events',toolVersion:businessTools.find(tool=>tool.descriptor.name==='calendar.events').descriptor.version,
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
  if(options.weather)input.weather={eventId:options.wrongWeatherEvent?'another-event':'evt-standup',query:{location:'Beijing',date:'2026-09-07',units:'metric'}};
  if(options.missingLocation)delete input.weather.query.location;
  t.after(async()=>{for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    question.close();await todoHost.close();for(let i=0;i<300&&app.activeTaskCount;i++)await pause();await connector.close();publicHost?.close();app.close();});
  const client=new Client(app);await client.connect();
  const root=await client.call('task.submit',{goal:'Fixture explicit F11 calendar change',conversationId:'fixture-chat'},{idempotencyKey:'fixture-f11',timeoutMs:60000});
  let child;
  for(let i=0;i<2000;i++){
    if(options.missingLocation&&!locationReplied){
      const pending=locationQuestion.readQuestion({taskId:root.taskId,conversationId:'fixture-chat'});
      if(pending){
        assert.equal(pending.state,'pending');assert.equal(pending.sourceTaskId,root.taskId);
        assert.equal(locationQuestion.readQuestion({taskId:root.taskId,conversationId:'foreign'}),undefined);
        locationReplied=true;
        if(options.cancelLocation){app.runtime.requestCancel(pending.graphTaskId);}
        else {
          locationReply={taskId:pending.taskId,questionId:pending.questionId,expectedRevision:pending.revision,
            sourceTaskId:root.taskId,commandId:'fixture-explicit-location-message',location:'Beijing'};
          assert.throws(()=>locationQuestion.submitReply({...locationReply,expectedRevision:0},{conversationId:'fixture-chat'}),/target changed/);
          assert.throws(()=>locationQuestion.submitReply(locationReply,{conversationId:'foreign'}),/target changed/);
          if(options.revokeLocation||options.eraseLocation||options.expireLocation){
            if(options.revokeLocation)app.runtime.policy.revoke('host-tool-'+pending.taskId);
            else if(options.eraseLocation)app.runtime.saveCheckpoint(root.taskId,'private-copy-erasure',{state:'withheld'});
            else locationClock=60001; // Explicit clock fixture for the question deadline boundary only.
            assert.throws(()=>locationQuestion.submitReply(locationReply,{conversationId:'fixture-chat'}),/unavailable|changed/);
            app.runtime.requestCancel(pending.graphTaskId);continue;
          }
          const answered=locationQuestion.submitReply(locationReply,{conversationId:'fixture-chat'});
          assert.equal(answered.state,'answered');assert.equal(answered.revision,2);
          assert.deepEqual(locationQuestion.submitReply(locationReply,{conversationId:'fixture-chat'}),answered);
          assert.throws(()=>locationQuestion.submitReply({...locationReply,location:'Shanghai'},{conversationId:'fixture-chat'}),/another explicit reply/);
        }
      }
    }
    for(const card of question.snapshot().filter(item=>item.state==='pending')){
      approvals.push(card.toolName);
      if(card.toolName==='weather.forecast'&&options.cancelWeather){app.runtime.requestCancel(app.readSubagentTasks(root.taskId)[0].taskId);continue;}
      if(card.toolName==='todo.update'&&options.changeBeforeClear&&!changed){await todoHost.update({id:todo.id,title:'User edit while clear waits'});changed=true;}
      question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:card.toolName===options.denyTool?'deny':'allow_once'},card.conversationId);
    }
    [child]=app.readSubagentTasks(root.taskId);if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;
    await pause();
  }
  assert.ok(child);return {app,userData,child,todoHost,todo,schedule,reads,writes,weatherReads,decisions,cloud,approvals,proposals,locationReply,locationReplied,locationQuestion,
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

test('F11 original forecast and public projection reach the decision before independently approved changes',async t=>{
  const f=await scenario(t,{weather:true});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.writes,1);
  assert.equal(f.weatherReads,2);assert.equal(f.approvals.filter(name=>name==='weather.forecast').length,2);
  const source=f.decisions.find(context=>context.node.id==='F11_N03').predecessorOutputs.F11_N01;
  assert.equal(source.sourceKind,'forecast');assert.equal(source.weather.forecast.location,'Beijing');assert.equal(source.weather.record,undefined);
  assert.equal(JSON.stringify(f.decisions).includes('weather://forecast/'),false);
});
for(const option of ['staleWeather','expiredWeather','outsideCoverage','wrongWeatherEvent','changedWeather','denyWeatherExport','unknownWeather','cancelWeather'])
  test('F11 '+option+' refuses a weather-driven update and retains the original reminder',async t=>{
    const f=await scenario(t,{weather:true,[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.writes,0);
    assert.deepEqual(f.todoHost.snapshot().items[0],f.todo);assert.equal(f.app.runtime.getSchedule(f.schedule.scheduleId).status,'pending');
  });
test('F11 denying the independent weather child never reaches calendar or reminder writes',async t=>{
  const f=await scenario(t,{weather:true,denyTool:'weather.forecast'});assert.notEqual(f.child.state,'succeeded');assert.equal(f.weatherReads,0);assert.equal(f.writes,0);
});

test('F11 missing location waits on original N01, then an exact explicit text answer reaches separately approved weather and writes',async t=>{
  const f=await scenario(t,{weather:true,missingLocation:true});
  assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.locationReplied,true);assert.equal(f.weatherReads,2);assert.equal(f.writes,1);
  assert.equal(f.approvals.filter(name=>name==='weather.forecast').length,2);
  assert.equal(f.decisions.find(item=>item.node.id==='F11_N03').predecessorOutputs.F11_N01.weather.forecast.location,'Beijing');
  assert.equal(f.app.runtime.loadCheckpoint(f.locationReply.taskId,'business-workflow:F11:location-question:reply').origin,'desktop_explicit_text');
});

for(const options of [{cancelLocation:true},{denyTool:'weather.forecast'},{revokeLocation:true},{eraseLocation:true},{expireLocation:true}])test('F11 location answer grants no weather or write authority '+JSON.stringify(options),async t=>{
  const f=await scenario(t,{weather:true,missingLocation:true,...options});assert.equal(f.locationReplied,true);
  assert.equal(f.weatherReads,0);assert.equal(f.writes,0);assert.notEqual(f.child.state,'succeeded');assert.deepEqual(f.todoHost.snapshot().items[0],f.todo);
});

test('F11 location answer persists across SQLite reopen without replaying an unknown original weather result',async t=>{
  const f=await scenario(t,{weather:true,missingLocation:true,unknownWeather:true});assert.equal(f.weatherReads,1);assert.equal(f.writes,0);
  assert.notEqual(f.child.state,'succeeded');const key='business-workflow:F11:location-question:reply',reply=f.app.runtime.loadCheckpoint(f.locationReply.taskId,key);
  assert.equal(reply.location,'Beijing');assert.equal(reply.origin,'desktop_explicit_text');
  assert.throws(()=>f.locationQuestion.submitReply(f.locationReply,{conversationId:'fixture-chat'}),/unavailable|changed/);
  const restored=runtimeModule.createRuntimeApplication({path:path.join(f.userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'f11'});
  try {assert.deepEqual(restored.runtime.loadCheckpoint(f.locationReply.taskId,key),reply);
    const reader=createF11LocationQuestionHost({getApplication:()=>restored});
    assert.equal(reader.readQuestion({taskId:f.locationReply.sourceTaskId,conversationId:'fixture-chat'}),undefined);
    assert.throws(()=>reader.submitReply(f.locationReply,{conversationId:'fixture-chat'}),/unavailable|changed/);
  }finally{restored.close();}
  assert.equal(f.weatherReads,1);assert.deepEqual(f.todoHost.snapshot().items[0],f.todo);
});
