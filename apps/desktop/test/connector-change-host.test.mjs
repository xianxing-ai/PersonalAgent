import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {FakeMailProvider,register as registerMail} from '@personal-agent/mail';
import {FakeWeatherProvider,register as registerWeather} from '@personal-agent/weather';
import {createDesktopConnectorChangeHost,significantWeatherChange} from '../electron/connector-change-host.js';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';
import {createConnectorReadOrigin} from '../electron/connector-read-origin.js';

// Real local Runtime/SQLite/Policy/Gateway, original connector adapters and notification
// receipt persistence. Providers, chooser and native show/click are explicit Fake ports.
// These tests are offline wiring evidence; they prove no real account/model/OS delivery.
const until=async predicate=>{for(let i=0;i<400;i++){
  if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));
}throw Error('Fake connector read did not settle');};
const namespace='synthetic-connector-change-user';
const configurationRef='c'.repeat(64);
const globalPolicy={mode:'normal',maxInterruptions:null,windowMinutes:17,silentUntilUtc:null,
  preferredChannel:'banner',allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null};

test('a late original event-pump flush after host and Runtime close does not touch the closed database',async()=>{
  const application=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'});
  const host=createDesktopConnectorChangeHost({application,namespace:'closed-runtime-trigger',
    readSourceAuthorization:()=>assert.fail('closed host must not inspect source authorization'),
    resolveUserConversation:()=>assert.fail('closed host must not resolve conversations')});
  await host.close();application.close();
  await host.flush();assert.doesNotThrow(()=>host.observeTask('late-completion'));
});

async function fixture(t,{decision='notify',autoShow=true}={}) {
  const cache=resolve('.cache/connector-change-host-tests');mkdirSync(cache,{recursive:true});
  const folder=mkdtempSync(join(cache,'run-')),file=join(folder,'runtime.sqlite');
  let time=Date.now(),application,notifications,changes,channel,connection,mailOrigin,selected=decision,authorized=true,chooserReady=true;
  let currentConfigurationRef=configurationRef;
  let epoch=17,providerCalls=0,mailHold,releaseMail;
  const choices=[],displayed=[],native=[],callbacks=new Map();
  const inbox=[message(1)];
  function message(uid,patch={}) {return {uid,folder:'INBOX',from:'synthetic@example.invalid',to:'fixture@example.invalid',
    subject:'Fake private subject '+uid,sentAt:new Date(time).toISOString(),messageId:'<fake-'+uid+'@example.invalid>',seen:false,...patch};}
  const mailProvider=new FakeMailProvider({inbox:[],sent:[]});
  mailProvider.fetchPage=async(account,input)=>{providerCalls++;if(mailHold)await mailHold;
    return new FakeMailProvider({inbox,sent:[]},{inboxUidValidity:epoch,pageSize:100}).fetchPage(account,input);};
  const forecast={location:'Synthetic City',date:new Date(time).toISOString().slice(0,10),summary:'Fake clear weather',
    temperatureMinC:18,temperatureMaxC:28,precipitationProbability:10,publishedAt:new Date(time).toISOString(),timezone:'UTC'};
  const weatherProvider=new FakeWeatherProvider([forecast]);
  const chooser={snapshot:()=>({ready:chooserReady}),async choose(input){choices.push(structuredClone({context:input.context,candidates:input.candidates}));
    if(typeof selected==='function')return selected(input);
    return {state:'selected',eligibleForRuntime:true,selected:{id:selected,revision:1},reason:'Explicit Fake decision',receipt:{id:'fake-choice-'+choices.length}};}};
  async function open(){
    channel=createDesktopNotificationPort({storageDir:folder,now:()=>time,onOutcome:outcome=>notifications.receipt(outcome),notifier:{
      async isSupported(){return true;},async show(input,events){native.push(input);callbacks.set(input.id,events);if(autoShow)events.onShow();return {close(){}};}}});
    notifications=createDesktopNotificationApplicationHost({namespace,channel,now:()=>time});
    const registered=[],host={register(tool){registered.push(tool);return ()=>{};}};
    registerMail(host,{provider:mailProvider,accountRef:'fixture-mail',now:()=>time});
    registerWeather(host,{provider:weatherProvider,cacheTtlMs:1,now:()=>time});
    application=createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',hostUserNamespace:namespace,now:()=>new Date(time),
      tools:[...registered,...notifications.tools],automaticTools:registered.filter(tool=>['mail.inbox','weather.forecast'].includes(tool.descriptor.name))
        .map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version}))});
    connection=new Client(application,()=>time);await connection.connect();notifications.bindApplication(application,connection);
    mailOrigin=createConnectorReadOrigin({getApplication:()=>application,
      readSourceAuthorization:()=>({available:authorized,configurationRef:currentConfigurationRef})});
    changes=createDesktopConnectorChangeHost({application,namespace,chooser,notifications,now:()=>time,
      readSourceAuthorization:()=>({available:authorized,configurationRef:currentConfigurationRef}),resolveUserConversation:()=> 'desktop-panel',
      readOriginalSourceBinding:taskId=>mailOrigin.read(taskId),
      onDecisionTask:task=>displayed.push(task)});
  }
  async function close(){await changes.close();while(application.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));
    notifications.dispose();application.close();}
  await open();
  await notifications.configureSettings({operationId:'fake-global-notification-policy',expectedRevision:0,scope:{kind:'global'},patch:globalPolicy});
  t.after(async()=>{await close();assert.ok(folder.startsWith(cache));rmSync(folder,{recursive:true,force:true});});
  let sequence=0;
  async function startRead(toolName,args={},bindOrigin=true) {
    const commandId='fake-read-'+(++sequence),deadline=new Date(time+60_000).toISOString();
    const toolVersion=application.tools.list().find(tool=>tool.name===toolName).version;
    const prepared=application.prepareHostToolTask({commandId,toolName,toolVersion,deadline});
    if(toolName==='mail.inbox'&&bindOrigin)mailOrigin.bind({taskId:prepared.taskId,conversationId:'desktop-panel'});
    application.finalizeHostToolTask({taskId:prepared.taskId,commandId,expectedTaskRevision:prepared.revision,arguments:args});
    return prepared.taskId;
  }
  async function read(toolName,args={}) {
    const taskId=await startRead(toolName,args);
    await until(()=>['succeeded','failed','waiting_reconciliation','waiting_approval'].includes(application.runtime.getTask(taskId).state));
    const readback=application.readHostToolTask(taskId);
    assert.equal(readback.task.state,'succeeded',JSON.stringify(readback.task.error??readback));
    assert.ok(readback.confirmed,'original Runtime read is confirmed');
    const execution=application.runtime.readToolExecutions(taskId).find(item=>item.toolName===toolName);
    assert.equal(execution.state,'confirmed');assert.equal(execution.policyDecision,'allow');
    changes.observeTask(taskId);return {taskId,readback,execution};
  }
  return {get app(){return application;},get host(){return changes;},get notifications(){return notifications;},get channel(){return channel;},
    inbox,forecast,weatherProvider,choices,displayed,native,callbacks,read,startRead,
    mail:args=>read('mail.inbox',{account:'fixture-mail',...args}),
    weather:args=>read('weather.forecast',{location:forecast.location,date:forecast.date,...args}),
    addMail:(uid,patch)=>inbox.push(message(uid,patch)),rotateEpoch:()=>{epoch++;},advance:(ms=1000)=>{time+=ms;},
    choose:value=>{selected=value;},ready:value=>{chooserReady=value;},revoke:()=>{authorized=false;},reauthorize:()=>{authorized=true;},providerCalls:()=>providerCalls,
    rotateConfiguration:()=>{currentConfigurationRef='replacement-'+currentConfigurationRef;},
    holdMail:()=>{mailHold=new Promise(resolve=>{releaseMail=resolve;});},releaseMail:()=>{releaseMail?.();mailHold=undefined;},
    seedInterruptedDecision({saved=false,notifyState=false,deadlineOffset=60_000}={}){
      const atomic=createRuntimeAtomicStatePort(application.runtime,'desktop-connector-changes'),key=createHash('sha256').update(JSON.stringify(namespace)).digest('hex');
      const stored=atomic.read(key),event=Object.values(stored.value.events).find(item=>item.state==='pending');
      assert.ok(event);const summary=event.kind==='mail.new'?'收到一封新邮件':'订阅地点的天气出现明显变化';
      const origin={id:event.id,origin:event.origin,revision:event.revision};
      const task=application.runtime.submitTaskWithCheckpoint({goal:'判断是否告知用户：'+summary,conversationId:'desktop-panel',
        idempotencyKey:event.id},'connector-change-origin',origin);
      const deadline=new Date(time+deadlineOffset).toISOString();
      application.runtime.saveCheckpointOnce(task.taskId,'application-deadline',deadline);
      application.runtime.transitionTask(task.taskId,'planning');application.runtime.transitionTask(task.taskId,'running');
      if(saved)application.runtime.saveCheckpointOnce(task.taskId,'connector-change-decision',{action:'notify',reason:'selected',
        receiptId:'persisted-choice-before-crash',calibrated:false,deadline,decidedAt:new Date(time).toISOString()});
      if(notifyState){event.state='notify';event.decisionTaskId=task.taskId;assert.equal(atomic.compareAndSet(key,stored.revision,stored.value),true);}
      return {taskId:task.taskId,deadline};
    },
    async restart(){await close();await open();},
  };
}

test('Fake mail first full baseline stays quiet; new UID reaches Laya and original notification host only once',async t=>{
  const f=await fixture(t);await f.mail();await f.host.flush();
  assert.equal(f.choices.length,0);assert.equal(f.native.length,0);
  f.addMail(2);f.advance();const source=await f.mail();
  assert.equal(f.host.snapshot().pending,1);await f.host.flush();
  assert.equal(f.choices.length,1);assert.equal(f.native.length,1);assert.equal(f.host.snapshot().notified,1);
  assert.equal(f.displayed[0].conversationId,'desktop-panel');
  const choice=JSON.parse(f.choices[0].context);assert.equal(choice.change,'mail.new');
  assert.match(choice.data.header,/Fake private subject 2/);
  assert.equal(f.app.runtime.getTask(f.displayed[0].taskId).state,'succeeded');
  assert.equal(f.app.runtime.loadCheckpoint(f.displayed[0].taskId,'connector-change-decision').calibrated,false);
  assert.equal(f.app.runtime.loadCheckpoint(f.displayed[0].taskId,'connector-change-origin').origin.taskId,source.taskId);
  assert.doesNotMatch(f.native[0].body,/private subject|synthetic@example/);
  f.host.observeTask(source.taskId);f.advance();await f.mail();await f.host.flush();
  assert.equal(f.choices.length,1);assert.equal(f.native.length,1);
});

test('unbound historical mail pages cannot seed a current configuration on event replay',async t=>{
  const f=await fixture(t),taskId=await f.startRead('mail.inbox',{account:'fixture-mail'},false);
  await until(()=>f.app.runtime.getTask(taskId).state==='succeeded');
  f.host.observeTask(taskId);await f.host.flush();
  assert.equal(f.host.snapshot().errorCode,'UNAUTHORIZED');assert.equal(f.choices.length,0);
  await f.mail();f.addMail(2);await f.mail();await f.host.flush();
  assert.equal(f.native.length,1);
});

test('mail configuration replacement withholds old pending reads without contaminating the new baseline',async t=>{
  const f=await fixture(t);await f.mail();f.addMail(2);const old=await f.mail();
  assert.equal(f.host.snapshot().pending,1);f.rotateConfiguration();
  f.host.observeTask(old.taskId);await f.host.flush();
  assert.equal(f.host.snapshot().withheld,1);assert.equal(f.choices.length,0);
  await f.mail();await f.host.flush();assert.equal(f.native.length,0,'replacement first complete read seeds its own baseline');
  f.addMail(3);await f.mail();await f.host.flush();assert.equal(f.native.length,1);
  f.host.observeTask(old.taskId);await f.host.flush();assert.equal(f.native.length,1);
});

test('Fake mailbox initial pages and UID epoch reset establish new baselines without old-mail notifications',async t=>{
  const f=await fixture(t);f.addMail(2);f.addMail(3);
  await f.mail({limit:1});await f.host.flush();assert.equal(f.choices.length,0);
  await f.mail({cursor:'17:1',limit:10});await f.host.flush();assert.equal(f.choices.length,0);
  f.addMail(4);await f.mail({cursor:'17:3'});await f.host.flush();assert.equal(f.choices.length,1);
  f.rotateEpoch();f.advance();await f.mail();await f.host.flush();assert.equal(f.choices.length,1);
  f.addMail(5);await f.mail({cursor:'18:4'});await f.host.flush();assert.equal(f.choices.length,2);
});

test('Fake Laya defer and ignore persist once across restart, without a native notification',async t=>{
  const f=await fixture(t,{decision:'defer'});await f.mail();f.addMail(2);await f.mail();await f.host.flush();
  assert.equal(f.host.snapshot().deferred,1);assert.equal(f.choices.length,1);assert.equal(f.native.length,0);
  f.choose('ignore');f.addMail(3);await f.mail();await f.host.flush();assert.equal(f.choices.length,2);assert.equal(f.native.length,0);
  await f.restart();await f.host.flush();assert.equal(f.choices.length,2);assert.equal(f.native.length,0);
  assert.equal(f.host.snapshot().pending,0);assert.equal(f.host.snapshot().deferred,1);
});

test('Fake unavailable or ineligible Laya proposal defaults to defer and never invents a notification decision',async t=>{
  const f=await fixture(t,{decision:()=>({state:'selected',eligibleForRuntime:false,selected:{id:'notify',revision:1},reason:'Fake ineligible'})});
  await f.mail();f.addMail(2);await f.mail();await f.host.flush();
  assert.equal(f.host.snapshot().deferred,1);assert.equal(f.native.length,0);assert.equal(f.displayed.length,0);
});

test('Fake weather baseline, changed cache age and summary noise stay quiet; large forecast change reaches Laya',async t=>{
  const f=await fixture(t);await f.weather();await f.host.flush();assert.equal(f.choices.length,0);
  f.advance();f.forecast.summary='Fake model-like revised prose without a forecast change';await f.weather();await f.host.flush();
  assert.equal(f.choices.length,0);
  f.advance();f.forecast.temperatureMinC=9;await f.weather();await f.host.flush();
  assert.equal(f.choices.length,1);assert.equal(f.native.length,1);
  const context=JSON.parse(f.choices[0].context);assert.equal(context.change,'weather.changed');
  assert.deepEqual(context.data.differences,['temperatureMin']);assert.equal(context.data.previous.temperatureMin,18);
  assert.equal(context.data.current.temperatureMin,9);
  f.advance();await f.weather();await f.host.flush();assert.equal(f.choices.length,1);
});

test('Fake stale weather fallback cannot trigger a new change or replace the last usable forecast baseline',async t=>{
  const f=await fixture(t);await f.weather();
  f.advance();f.weatherProvider.setFailure(new ProtocolError('TIMEOUT','Explicit Fake timeout',true));
  const stale=await f.weather();assert.equal(stale.readback.confirmed.result.cache.state,'stale');await f.host.flush();
  assert.equal(f.choices.length,0);
  f.weatherProvider.setFailure(null);f.advance();f.forecast.precipitationProbability=80;await f.weather();await f.host.flush();
  assert.equal(f.choices.length,1);assert.deepEqual(JSON.parse(f.choices[0].context).data.differences,['precipitationProbability']);
});

test('weather reversals retain only the latest significant event for a delayed chooser, including repeated physical values',async t=>{
  const f=await fixture(t);await f.weather();f.ready(false);
  f.advance();f.forecast.temperatureMinC=9;await f.weather();await f.host.flush();
  assert.equal(f.host.snapshot().pending,1,'an unavailable chooser retains a recoverable pending event');
  f.advance();f.forecast.temperatureMinC=18;const latest=await f.weather();await f.host.flush();
  assert.equal(f.choices.length,0);assert.equal(f.native.length,0);
  await f.restart();f.ready(true);await f.host.flush();
  assert.equal(f.choices.length,1);assert.equal(f.native.length,1);assert.equal(f.host.snapshot().pending,0);
  assert.equal(f.host.snapshot().superseded,1);
  assert.equal(JSON.parse(f.choices[0].context).data.current.temperatureMin,18);
  assert.equal(f.app.runtime.loadCheckpoint(f.displayed[0].taskId,'connector-change-origin').origin.taskId,latest.taskId);
  f.advance();f.forecast.temperatureMinC=9;await f.weather();await f.host.flush();
  assert.equal(f.choices.length,2,'returning to an earlier forecast is a new significant transition');
  assert.equal(JSON.parse(f.choices[1].context).data.current.temperatureMin,9);assert.equal(f.native.length,2);
  await f.restart();await f.host.flush();assert.equal(f.choices.length,2);assert.equal(f.native.length,2);
  assert.equal(f.host.snapshot().superseded,1);
});

test('a new significant weather result fences an in-flight older Laya choice before any native notification',async t=>{
  const f=await fixture(t);await f.weather();f.advance();f.forecast.temperatureMinC=9;await f.weather();
  let latest;f.choose(async()=>{f.advance();f.forecast.temperatureMinC=18;latest=await f.weather();
    return {state:'selected',eligibleForRuntime:true,selected:{id:'notify',revision:1},reason:'Fake superseded choice'};});
  await f.host.flush();assert.equal(f.choices.length,1);assert.equal(f.native.length,0);assert.equal(f.displayed.length,0);
  assert.equal(f.host.snapshot().superseded,1);assert.equal(f.host.snapshot().deferred,0);
  f.choose('notify');await f.host.flush();assert.equal(f.choices.length,2);assert.equal(f.native.length,1);
  assert.equal(JSON.parse(f.choices[1].context).data.current.temperatureMin,18);
  assert.equal(f.app.runtime.loadCheckpoint(f.displayed[0].taskId,'connector-change-origin').origin.taskId,latest.taskId);
  assert.equal(f.host.snapshot().pending,0);
});

test('unconfirmed original mail execution cannot become a baseline or nominate an event',async t=>{
  const f=await fixture(t);f.holdMail();
  const taskId=await f.startRead('mail.inbox',{account:'fixture-mail'});
  await until(()=>f.providerCalls()>0);f.host.observeTask(taskId);await f.host.flush();
  assert.equal(f.host.snapshot().pending,0);assert.equal(f.choices.length,0);
  f.releaseMail();await until(()=>f.app.runtime.getTask(taskId).state==='succeeded');
  f.host.observeTask(taskId);await f.host.flush();assert.equal(f.choices.length,0);
  f.addMail(2);await f.mail();await f.host.flush();assert.equal(f.choices.length,1);
});

test('revoked source authorization withholds a pending event without invoking Laya and remains settled after restart',async t=>{
  const f=await fixture(t);await f.mail();f.addMail(2);await f.mail();f.revoke();await f.host.flush();
  assert.equal(f.choices.length,0);assert.equal(f.native.length,0);assert.equal(f.host.snapshot().pending,0);
  assert.equal(f.host.snapshot().errorCode,'UNAUTHORIZED');assert.equal(f.host.snapshot().withheld,1);
  f.reauthorize();await f.restart();await f.host.flush();
  assert.equal(f.host.snapshot().pending,0);assert.equal(f.choices.length,0);assert.equal(f.native.length,0);
  assert.equal(f.host.snapshot().withheld,1);
});

test('source revocation during Fake Laya inference prevents both persisted selection and native delivery',async t=>{
  const f=await fixture(t);await f.mail();f.addMail(2);await f.mail();
  f.choose(()=>{f.revoke();return {state:'selected',eligibleForRuntime:true,selected:{id:'notify',revision:1}};});
  await f.host.flush();assert.equal(f.choices.length,1);assert.equal(f.native.length,0);assert.equal(f.displayed.length,0);
  assert.equal(f.host.snapshot().pending,0);assert.equal(f.host.snapshot().errorCode,'UNAUTHORIZED');assert.equal(f.host.snapshot().withheld,1);
  const decision=f.app.runtime.listTasks({limit:100}).items.find(task=>task.goal.startsWith('判断是否告知用户：'));
  assert.equal(decision.state,'failed');assert.equal(decision.error.code,'UNAUTHORIZED');
  assert.equal(f.app.runtime.loadCheckpoint(decision.taskId,'connector-change-decision'),undefined);
  f.reauthorize();await f.restart();await f.host.flush();
  assert.equal(f.host.snapshot().pending,0);assert.equal(f.choices.length,1);assert.equal(f.native.length,0);
  assert.equal(f.host.snapshot().withheld,1);
});

test('erased original source evidence withholds its queued change without a Laya call',async t=>{
  const f=await fixture(t);await f.mail();f.addMail(2);const source=await f.mail();
  f.app.runtime.saveCheckpoint(source.taskId,'private-copy-erasure',{withheld:true});await f.host.flush();
  assert.equal(f.choices.length,0);assert.equal(f.native.length,0);assert.equal(f.host.snapshot().pending,0);
  assert.equal(f.host.snapshot().errorCode,'SCOPE_DENIED');assert.equal(f.host.snapshot().withheld,1);
});

test('a terminal Fake chooser failure converges to a durable defer instead of an unresumable pending event',async t=>{
  const f=await fixture(t,{decision:()=>{throw new ProtocolError('TIMEOUT','Explicit Fake inference timeout',true);}});
  await f.mail();f.addMail(2);await f.mail();await f.host.flush();
  assert.equal(f.choices.length,1);assert.equal(f.native.length,0);assert.equal(f.host.snapshot().pending,0);
  assert.equal(f.host.snapshot().deferred,1);await f.restart();await f.host.flush();
  assert.equal(f.choices.length,1);assert.equal(f.native.length,0);assert.equal(f.host.snapshot().deferred,1);
});

test('SQLite reopen preserves pending changes and exact decisions; an unknown native attempt is never sent twice',async t=>{
  const f=await fixture(t,{autoShow:false});await f.mail();f.addMail(2);await f.mail();
  await f.restart();assert.equal(f.host.snapshot().pending,1);await f.host.flush();
  assert.equal(f.choices.length,1);assert.equal(f.native.length,1);assert.equal(f.host.snapshot().notified,0);
  assert.equal(f.notifications.snapshot().feed.items.length,1);
  await f.host.flush();await f.restart();await f.host.flush();
  assert.equal(f.native.length,1);assert.equal(f.choices.length,1);
  f.channel.reconcile(f.native[0].id,true);await f.host.flush();
  assert.equal(f.host.snapshot().notified,1,'late persisted native receipt settles the original event');
  assert.equal(f.native.length,1);
});

test('a saved successful notify restores the original main conversation projection before delivery after reopen',async t=>{
  const f=await fixture(t);await f.mail();f.addMail(2);await f.mail();
  const original=f.seedInterruptedDecision({saved:true,notifyState:true});
  f.app.runtime.transitionTask(original.taskId,'verifying');
  f.app.runtime.transitionTask(original.taskId,'succeeded',{resultSummary:'收到一封新邮件'});
  assert.equal(f.displayed.length,0);await f.restart();await f.host.flush();
  assert.equal(f.choices.length,0,'saved choice is not recomputed');
  assert.deepEqual(f.displayed,[{taskId:original.taskId,goal:'收到一封新邮件',conversationId:'desktop-panel'}]);
  assert.equal(f.native.length,1);assert.equal(f.host.snapshot().notified,1);
  await f.host.flush();assert.equal(f.displayed.length,1);assert.equal(f.native.length,1);
});

test('a late native show in the same process settles the original event after drain stops returning its batch',async t=>{
  const f=await fixture(t,{autoShow:false});await f.mail();f.addMail(2);await f.mail();await f.host.flush();
  assert.equal(f.native.length,1);assert.equal(f.host.snapshot().notified,0);
  f.callbacks.get(f.native[0].id).onShow();
  assert.ok(f.notifications.snapshot().feed.items[0].deliveredAt,'original native show receipt is persisted');
  assert.equal(f.notifications.drain().batches.length,0,'delivered batch is no longer outstanding');
  await f.host.flush();assert.equal(f.host.snapshot().notified,1);
  assert.equal(f.native.length,1);assert.equal(f.choices.length,1);assert.equal(f.displayed.length,1);
  await f.restart();await f.host.flush();assert.equal(f.native.length,1);assert.equal(f.choices.length,1);
});

test('interrupted local inference resumes only its original task and deadline before any decision was saved',async t=>{
  const f=await fixture(t);await f.mail();f.addMail(2);await f.mail();
  const original=f.seedInterruptedDecision();f.advance(1000);await f.restart();f.app.runtime.recoverInterruptedTasks();
  assert.equal(f.app.runtime.getTask(original.taskId).state,'waiting_reconciliation');
  await f.host.flush();assert.equal(f.choices.length,1);assert.equal(f.native.length,1);
  assert.equal(f.app.runtime.getTask(original.taskId).state,'succeeded');assert.equal(f.host.snapshot().superseded,0);
  assert.equal(f.app.runtime.loadCheckpoint(original.taskId,'application-deadline'),original.deadline);
  assert.equal(f.choices[0].candidates[0].expiresAt,original.deadline);
  assert.equal(f.app.runtime.readToolExecutions(original.taskId).length,0);
  await f.host.flush();assert.equal(f.choices.length,1);assert.equal(f.native.length,1);
});

for(const notifyState of [false,true])test('saved local decision completes original terminal state without another choice; notify state '+notifyState,async t=>{
  const f=await fixture(t);await f.mail();f.addMail(2);await f.mail();
  const original=f.seedInterruptedDecision({saved:true,notifyState,deadlineOffset:1000});
  f.advance(2000);await f.restart();f.app.runtime.recoverInterruptedTasks();await f.host.flush();
  assert.equal(f.choices.length,0);assert.equal(f.native.length,1);assert.equal(f.host.snapshot().notified,1);
  const task=f.app.runtime.getTask(original.taskId);assert.equal(task.state,'succeeded');assert.equal(task.error,undefined);
  assert.equal(f.app.runtime.loadCheckpoint(task.taskId,'application-deadline'),original.deadline);
  assert.equal(f.app.runtime.loadCheckpoint(task.taskId,'connector-change-decision').receiptId,'persisted-choice-before-crash');
  await f.restart();await f.host.flush();assert.equal(f.choices.length,0);assert.equal(f.native.length,1);
});

test('expired local inference without a saved choice becomes durable defer without extending its deadline',async t=>{
  const f=await fixture(t);await f.mail();f.addMail(2);await f.mail();
  const original=f.seedInterruptedDecision({deadlineOffset:1000});f.advance(2000);await f.restart();
  f.app.runtime.recoverInterruptedTasks();await f.host.flush();
  assert.equal(f.choices.length,0);assert.equal(f.native.length,0);assert.equal(f.host.snapshot().pending,0);
  assert.equal(f.host.snapshot().deferred,1);assert.equal(f.host.snapshot().superseded,0);
  const task=f.app.runtime.getTask(original.taskId);assert.equal(task.state,'failed');assert.equal(task.error.code,'TIMEOUT');
  assert.equal(f.app.runtime.loadCheckpoint(task.taskId,'application-deadline'),original.deadline);
  f.advance(1000);await f.host.flush();assert.equal(f.choices.length,0);assert.equal(f.host.snapshot().deferred,1);
});

test('cancelled saved local decision never recovers into a notification',async t=>{
  const f=await fixture(t);await f.mail();f.addMail(2);await f.mail();
  const original=f.seedInterruptedDecision({saved:true});f.app.runtime.requestCancel(original.taskId,'Explicit test user cancellation');
  await f.restart();f.app.runtime.recoverInterruptedTasks();await f.host.flush();
  assert.equal(f.app.runtime.getTask(original.taskId).state,'cancelled');assert.equal(f.choices.length,0);assert.equal(f.native.length,0);
  assert.equal(f.host.snapshot().withheld,1);assert.equal(f.host.snapshot().pending,0);
});

test('an interrupted decision carrying any cloud intent cannot use the pure local recovery path',async t=>{
  const f=await fixture(t);await f.mail();f.addMail(2);await f.mail();
  const original=f.seedInterruptedDecision();f.app.runtime.saveCheckpointOnce(original.taskId,'competition-cloud-inflight',{synthetic:true});
  await f.restart();f.app.runtime.recoverInterruptedTasks();await f.host.flush();
  assert.equal(f.app.runtime.getTask(original.taskId).state,'waiting_reconciliation');
  assert.equal(f.choices.length,0);assert.equal(f.native.length,0);assert.equal(f.host.snapshot().deferred,1);
  assert.equal(f.host.snapshot().superseded,0);
});

test('closing aborts a Fake Laya port which never resolves and creates no notification intent',async t=>{
  const f=await fixture(t);await f.mail();f.addMail(2);await f.mail();
  let inferenceSignal;f.choose(input=>{inferenceSignal=input.signal;return new Promise(()=>{});});
  const flush=f.host.flush();await until(()=>f.choices.length===1);await f.host.close();await flush;
  assert.equal(inferenceSignal.aborted,true);assert.equal(f.host.snapshot().available,false);
  assert.equal(f.native.length,0);assert.equal(f.displayed.length,0);
});

test('weather significance uses physical metric/imperial thresholds and ignores ordinary changes',()=>{
  const previous={units:'metric',temperatureMin:15,temperatureMax:25,precipitationProbability:20,
    current:{temperature:20,windSpeed:20,weatherCode:1}};
  assert.deepEqual(significantWeatherChange(previous,{...previous,temperatureMax:32,current:{...previous.current,windSpeed:44}}),[]);
  assert.deepEqual(significantWeatherChange(previous,{...previous,temperatureMax:33,precipitationProbability:60,
    current:{temperature:28,windSpeed:50,weatherCode:95}}),
    ['temperatureMax','precipitationProbability','current.temperature','current.weatherCode','current.windSpeed']);
  const imperial={units:'imperial',temperatureMin:59,temperatureMax:77,precipitationProbability:20,
    current:{temperature:68,windSpeed:12,weatherCode:1}};
  assert.deepEqual(significantWeatherChange(imperial,{...imperial,temperatureMax:92,
    current:{...imperial.current,windSpeed:32}}),['temperatureMax','current.windSpeed']);
});
