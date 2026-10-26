import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Client} from '@personal-agent/client';
import {LayaActionChoiceService} from '@personal-agent/cognition';
import {FakeMailProvider,register as registerMail} from '@personal-agent/mail';
import {FakeWeatherProvider,register as registerWeather} from '@personal-agent/weather';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopConnectorWatchHost} from '../electron/connector-watch-host.js';
import {createDesktopConnectorChangeHost} from '../electron/connector-change-host.js';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';

// Offline integration: original Client approval, Runtime/SQLite/Policy/Gateway,
// Scheduler, connector registrations, Laya selection, notification host and receipt
// persistence are exercised together. Provider data, inference and native show are
// explicit Fake ports; this is no real account, weather/model or desktop OS receipt.
const namespace='synthetic-change-watch-integration';
const conversationId='desktop:original-user-conversation';
const configurationRef='synthetic-selected-connector-configuration';
const until=async predicate=>{for(let i=0;i<400;i++){
  if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));
}throw Error('Synthetic watch integration did not settle');};
const terminal=new Set(['succeeded','failed','cancelled','waiting_reconciliation']);

async function fixture(t) {
  const base=resolve('.cache/connector-change-watch-integration-tests');mkdirSync(base,{recursive:true});
  const directory=mkdtempSync(join(base,'run-')),file=join(directory,'runtime.sqlite');
  // A deterministic future local day keeps all simulated Scheduler advances in one
  // forecast identity while the real Laya service still sees an unexpired deadline.
  let time=Math.floor(Date.now()/86_400_000)*86_400_000+86_400_000+12*3_600_000;
  let application,client,watches,changes,notifications,channel,operationSequence=0,proposedOperation;
  const native=[],inferences=[],decisions=[],observations=[];
  const forecast={location:'Synthetic Integration City',date:new Date(time).toISOString().slice(0,10),timezone:'UTC',
    summary:'Explicit Fake clear forecast',temperatureMinC:18,temperatureMaxC:28,precipitationProbability:10,
    publishedAt:new Date(time).toISOString()};
  const weather=new FakeWeatherProvider([forecast]);
  const localChooser=new LayaActionChoiceService({async infer(payload){
    inferences.push(structuredClone(payload));
    const criteria=payload.questions.action.criteria,keys=Object.keys(criteria);
    const chosen=keys.find(key=>JSON.parse(criteria[key]).description.startsWith('告知用户这次变化'));
    assert.ok(chosen,'original Laya candidate projection retains the host notify choice');
    return {answers:{action:{choice:chosen,probabilities:Object.fromEntries(keys.map(key=>[key,key===chosen?0.9:0.1/(keys.length-1)])),
      answer_confidence:0.9,confidence:0.5}}};
  }});
  function resolveOriginal(id){try{const task=application.runtime.getTask(id);
    return task.conversationId===conversationId?conversationId:undefined;}catch{return undefined;}}
  async function open(){
    channel=createDesktopNotificationPort({storageDir:directory,now:()=>time,onOutcome:outcome=>notifications.receipt(outcome),notifier:{
      async isSupported(){return true;},async show(input,events){native.push(structuredClone(input));events.onShow();return {close(){}};}}});
    notifications=createDesktopNotificationApplicationHost({namespace,channel,now:()=>time});
    const registered=[],host={register(tool){registered.push(tool);return ()=>{};}};
    registerMail(host,{provider:new FakeMailProvider({inbox:[],sent:[]}),accountRef:'synthetic-mail',now:()=>time});
    registerWeather(host,{provider:weather,now:()=>time,cacheTtlMs:1});
    watches=createDesktopConnectorWatchHost({getApplication:()=>application,namespace,now:()=>time,
      readSourceAuthorization:()=>({available:true,configurationRef}),resolveUserConversation:resolveOriginal,
      observeTask:taskId=>{observations.push(taskId);changes.observeTask(taskId);}});
    application=createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',hostUserNamespace:namespace,
      now:()=>new Date(time),tools:[...registered,...notifications.tools,...watches.tools],
      competitionToolAvailability:watches.competitionToolAvailability,competitionToolExports:watches.competitionToolExports,
      // Explicit Fake coordination only proposes the user's selected operation;
      // the original application loop owns approval, execution and continuation.
      coordination:{execute:async input=>input.continuation
        ?{kind:'text',text:'Synthetic approved connector subscription operation',verification:'unverified'}
        :{kind:'tool_proposal',proposalId:proposedOperation.id,toolName:proposedOperation.tool.name,
          toolVersion:proposedOperation.tool.version,arguments:proposedOperation.arguments,verification:'unverified'}}});
    client=new Client(application,()=>time);await client.connect();notifications.bindApplication(application,client);
    changes=createDesktopConnectorChangeHost({application,namespace,now:()=>time,notifications,
      chooser:{snapshot:()=>({ready:true}),choose:input=>localChooser.choose(input)},
      readSourceAuthorization:()=>({available:true,configurationRef}),readWatchOrigin:id=>watches.readOrigin(id),
      resolveUserConversation:id=>resolveOriginal(id)??watches.resolveUserConversation(id),onDecisionTask:task=>decisions.push(task)});
  }
  async function close(){await watches.close();await changes.close();await until(()=>application.activeTaskCount===0);
    notifications.dispose();application.close();}
  await open();t.after(async()=>{await close();assert.ok(directory.startsWith(base));rmSync(directory,{recursive:true,force:true});});
  await notifications.configureSettings({operationId:'integration-native-policy',expectedRevision:0,scope:{kind:'global'},
    patch:{mode:'normal',maxInterruptions:null,windowMinutes:17,silentUntilUtc:null,preferredChannel:'banner',
      allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null}});
  async function invoke(operation,args){
    const tool=watches.tools.find(value=>value.descriptor.name==='connector.watch.'+operation),id='integration-operation-'+(++operationSequence);
    proposedOperation={id,tool:tool.descriptor,arguments:structuredClone(args)};
    const submitted=await client.call('task.submit',{goal:operation==='start'?'请按指定间隔持续关注这个地点的明显天气变化':'停止我指定的天气订阅',
      conversationId},{idempotencyKey:id});
    await until(()=>application.runtime.getTask(submitted.taskId).state==='waiting_approval'
      ||terminal.has(application.runtime.getTask(submitted.taskId).state));
    const task=application.runtime.getTask(submitted.taskId);assert.equal(task.state,'waiting_approval',JSON.stringify(task.error));
    const approval=application.runtime.listApprovals({taskId:task.taskId,state:'pending',limit:10}).items[0];
    assert.equal(approval.action,tool.descriptor.name);
    // Approval uses the actual Client request path, never direct Policy mutation.
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await until(()=>terminal.has(application.runtime.getTask(task.taskId).state));
    const completed=application.runtime.getTask(task.taskId);assert.equal(completed.state,'succeeded',JSON.stringify(completed.error));
    const execution=application.runtime.readToolExecutions(task.taskId).find(item=>item.toolName===tool.descriptor.name);
    assert.equal(execution.state,'confirmed');assert.equal(execution.policyDecision,'allow');
    const result=application.runtime.loadCheckpoint(task.taskId,'tool-result-'+execution.evidenceId).result;
    return {task:completed,result,execution,approval};
  }
  async function poll(){
    await watches.tick();const taskId=watches.snapshot().watches[0].readTaskId;assert.ok(taskId);
    await until(()=>terminal.has(application.runtime.getTask(taskId).state));
    const read=application.readHostToolTask(taskId);assert.equal(read.task.state,'succeeded',JSON.stringify(read.task.error));
    assert.ok(read.confirmed);await watches.tick();
    assert.equal(watches.snapshot().watches[0].state,'monitoring');return read;
  }
  return {get app(){return application;},get watches(){return watches;},get changes(){return changes;},get notifications(){return notifications;},
    forecast,weather,native,inferences,decisions,observations,invoke,poll,
    input:()=>({source:'weather',query:{location:forecast.location,units:'metric'},intervalMs:1000,expiresAt:new Date(time+600_000).toISOString()}),
    advance:()=>{time+=1001;},async restart(){await close();await open();}};
}

test('approved watch Scheduler read reaches local Laya and one durable notification receipt',async t=>{
  const f=await fixture(t),input=f.input(),started=await f.invoke('start',input),watchId=started.result.watchId;
  assert.equal(f.app.runtime.getApproval(started.approval.approvalId).state,'allowed');
  const baseline=await f.poll();await f.changes.flush();assert.equal(f.inferences.length,0);assert.equal(f.native.length,0);
  assert.equal(f.watches.resolveUserConversation(baseline.task.taskId),conversationId);
  assert.equal(f.watches.readOrigin(baseline.task.taskId).taskId,started.task.taskId);
  f.advance();f.forecast.temperatureMinC=9;const changed=await f.poll();
  const origin=f.watches.readOrigin(changed.task.taskId);
  assert.equal(origin.watchId,watchId);assert.equal(origin.taskId,started.task.taskId);assert.equal(origin.conversationId,conversationId);
  assert.equal(f.app.runtime.policy.get('host-tool-'+changed.task.taskId).usesRemaining,0,'original one-use watch read grant is consumed');
  assert.equal(f.weather.fetchCalls,2);assert.equal(f.observations.length,2);assert.equal(f.changes.snapshot().pending,1);
  await f.changes.flush();assert.equal(f.inferences.length,1);assert.equal(f.native.length,1);assert.equal(f.decisions.length,1);
  const decisionTask=f.app.runtime.getTask(f.decisions[0].taskId),decision=f.app.runtime.loadCheckpoint(decisionTask.taskId,'connector-change-decision');
  assert.equal(decisionTask.state,'succeeded');assert.match(decisionTask.conversationId,/^connector-change:/);
  assert.equal(f.app.runtime.loadCheckpoint(decisionTask.taskId,'connector-change-origin').origin.taskId,changed.task.taskId);
  assert.equal(decision.action,'notify');assert.equal(decision.calibrated,false);assert.match(decision.receiptId,/^[a-f0-9]{64}$/u);
  assert.equal(f.changes.snapshot().notified,1);assert.equal(f.notifications.snapshot().feed.items.length,1);
  assert.ok(f.notifications.snapshot().feed.items[0].deliveredAt,'persisted native show receipt is separate from ingest');
  f.changes.observeTask(changed.task.taskId);await f.changes.flush();await f.watches.tick();
  await f.restart();await f.changes.flush();await f.watches.tick();
  assert.equal(f.inferences.length,1);assert.equal(f.native.length,1);assert.equal(f.weather.fetchCalls,2);
  assert.equal(f.changes.snapshot().notified,1);assert.equal(f.watches.readOrigin(changed.task.taskId).taskId,started.task.taskId);
});

test('Client-approved stop fences an already-confirmed pending change before Laya, including after SQLite reopen',async t=>{
  const f=await fixture(t),started=await f.invoke('start',f.input());await f.poll();
  f.advance();f.forecast.precipitationProbability=90;const changed=await f.poll();
  assert.equal(f.changes.snapshot().pending,1);assert.ok(f.watches.readOrigin(changed.task.taskId));
  await f.invoke('stop',{watchId:started.result.watchId});assert.equal(f.watches.readOrigin(changed.task.taskId),undefined);
  await f.changes.flush();assert.equal(f.changes.snapshot().pending,0);assert.equal(f.changes.snapshot().withheld,1);
  assert.equal(f.changes.snapshot().errorCode,'UNAUTHORIZED');assert.equal(f.inferences.length,0);assert.equal(f.native.length,0);
  assert.equal(f.notifications.snapshot().feed.items.length,0);assert.equal(f.watches.snapshot().watches[0].enabled,false);
  f.advance();await f.watches.tick();await f.restart();await f.changes.flush();await f.watches.tick();
  assert.equal(f.weather.fetchCalls,2);assert.equal(f.inferences.length,0);assert.equal(f.native.length,0);
  assert.equal(f.changes.snapshot().withheld,1);assert.equal(f.watches.snapshot().watches[0].state,'stopped');
});
