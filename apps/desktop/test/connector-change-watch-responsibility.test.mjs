import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {FakeWeatherProvider,register as registerWeather} from '@personal-agent/weather';
import {createDesktopConnectorWatchHost} from '../electron/connector-watch-host.js';
import {createDesktopConnectorChangeHost} from '../electron/connector-change-host.js';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';

// Actual watches, Gateway grants, Scheduler, SQLite changes and notification receipts.
// Weather, Laya selection and OS display are explicit offline Fake ports.
test('two main conversations watching the same place retain independent baselines and stopping A does not swallow B notification',async t=>{
  const cache=resolve('.cache/connector-change-watch-responsibility-tests');mkdirSync(cache,{recursive:true});
  const directory=mkdtempSync(join(cache,'run-')),namespace='synthetic-same-place-watches';
  let time=Date.now(),application,watches,changes,notifications,sequence=0;
  const shown=[],displayed=[],choices=[];
  const authorization=()=>({available:true,configurationRef:'synthetic-public-weather-configuration'});
  const forecast={location:'Synthetic Same Place',date:new Date(time).toISOString().slice(0,10),summary:'Synthetic clear weather',
    temperatureMinC:18,temperatureMaxC:28,precipitationProbability:10,publishedAt:new Date(time).toISOString(),timezone:'UTC'};
  const provider=new FakeWeatherProvider([forecast]),registered=[];
  registerWeather({register(tool){registered.push(tool);return ()=>{};}},{provider,cacheTtlMs:1,now:()=>time});
  const resolveConversation=id=>{try{const task=application.runtime.getTask(id);return task.conversationId.startsWith('desktop:')?task.conversationId:undefined;}catch{return undefined;}};
  const channel=createDesktopNotificationPort({storageDir:directory,now:()=>time,onOutcome:outcome=>notifications.receipt(outcome),notifier:{
    async isSupported(){return true;},async show(input,events){shown.push(input);events.onShow();return {close(){}};}}});
  notifications=createDesktopNotificationApplicationHost({namespace,channel,now:()=>time});
  watches=createDesktopConnectorWatchHost({getApplication:()=>application,namespace,now:()=>time,
    readSourceAuthorization:authorization,resolveUserConversation:resolveConversation,observeTask:id=>changes.observeTask(id)});
  application=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:namespace,
    now:()=>new Date(time),tools:[...registered,...watches.tools,...notifications.tools]});
  const client=new Client(application.runtime,()=>time);await client.connect();
  notifications.bindApplication(application,new Client(application,()=>time));
  changes=createDesktopConnectorChangeHost({application,namespace,notifications,now:()=>time,readSourceAuthorization:authorization,
    resolveUserConversation:id=>resolveConversation(id)??watches.resolveUserConversation(id),readWatchOrigin:id=>watches.readOrigin(id),
    chooser:{snapshot:()=>({ready:true}),async choose(input){choices.push(input);return {state:'selected',eligibleForRuntime:true,
      selected:{id:'notify',revision:1},reason:'selected',receipt:{id:'explicit-fake-choice'}};}},onDecisionTask:value=>displayed.push(value)});
  async function idle(){for(let i=0;application.activeTaskCount&&i<1000;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(application.activeTaskCount,0);}
  t.after(async()=>{await changes.close();await watches.close();await idle();notifications.dispose();application.close();
    const target=resolve(directory);assert.ok(target.startsWith(resolve(cache)+sep));rmSync(target,{recursive:true,force:true});});
  const notificationClient=new Client(application,()=>time);await notificationClient.connect();notifications.bindApplication(application,notificationClient);
  await notifications.configureSettings({operationId:'synthetic-global-policy',expectedRevision:0,scope:{kind:'global'},
    patch:{mode:'normal',maxInterruptions:null,windowMinutes:17,silentUntilUtc:null,preferredChannel:'banner',
      allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null}});
  async function invoke(operation,args,conversationId){
    const tool=watches.tools.find(item=>item.descriptor.name==='connector.watch.'+operation),id='same-place-'+(++sequence);
    const task=application.runtime.submitTask({goal:'在本主对话订阅同一地点天气显著变化',conversationId,idempotencyKey:id});
    const deadline=new Date(time+60_000).toISOString(),authorizationRef='approved-'+id;
    application.runtime.transitionTask(task.taskId,'planning');application.runtime.transitionTask(task.taskId,'running');
    const approval=application.runtime.requestToolApproval(authorizationRef,task.taskId,tool.descriptor,deadline,toolArgumentsDigest(args));
    application.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision);let result;
    const end=await application.runtime.runTask(task.taskId,async worker=>{
      result=await client.call('tool.invoke',{toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:args,scopeRef:authorizationRef},
        {taskId:task.taskId,idempotencyKey:'run-'+id,signal:worker.signal});return {resultSummary:'Explicitly approved subscription operation'};
    },{deadline,sideEffect:tool.descriptor.sideEffect,resume:true});
    assert.equal(end.state,'succeeded',JSON.stringify(end.error));assert.equal(result.state,'confirmed');return result.result;
  }
  const input={source:'weather',query:{location:forecast.location},intervalMs:1000,expiresAt:new Date(time+600_000).toISOString()};
  const a=await invoke('start',input,'desktop:conversation-a'),b=await invoke('start',input,'desktop:conversation-b');
  async function cycle(){await watches.tick();await idle();const reads=watches.snapshot().watches.map(item=>item.readTaskId).filter(Boolean);
    await watches.tick();return reads;}
  const initial=await cycle();await changes.flush();assert.equal(choices.length,0);
  const state=createRuntimeAtomicStatePort(application.runtime,'desktop-connector-changes'),key=createHash('sha256').update(JSON.stringify(namespace)).digest('hex');
  assert.equal(Object.keys(state.read(key).value.sources).length,2,'same place has one baseline per explicit watch responsibility');
  initial.forEach(id=>changes.observeTask(id));assert.equal(changes.snapshot().pending,0);
  time+=2000;forecast.temperatureMinC=9;const changed=await cycle();assert.equal(changes.snapshot().pending,2);
  await invoke('stop',{watchId:a.watchId},'desktop:conversation-a');
  assert.equal(watches.snapshot().watches.find(item=>item.watchId===b.watchId).enabled,true);
  await changes.flush();assert.equal(choices.length,1);assert.equal(shown.length,1);assert.equal(displayed.length,1);
  assert.match(displayed[0].conversationId,/^connector-change:/);
  const sourceB=changed.find(id=>watches.readOrigin(id)?.watchId===b.watchId);
  assert.equal(application.runtime.loadCheckpoint(displayed[0].taskId,'connector-change-origin').origin.taskId,sourceB);
  assert.equal(changes.snapshot().withheld,1);assert.equal(changes.snapshot().notified,1);assert.equal(changes.snapshot().pending,0);
  changed.forEach(id=>changes.observeTask(id));await changes.flush();assert.equal(choices.length,1);assert.equal(shown.length,1);
});
