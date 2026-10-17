import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication,createReminderDeliveryHost} from '@personal-agent/runtime/application';
import {notificationDigest as digest} from '@personal-agent/notifications';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {createEncryptedModuleStorage} from '../electron/encrypted-module-storage.js';

// Real local Runtime/SQLite/Policy/ToolGateway and persistent native receipt port.
// The notifier and its OS show/click events are explicit fixtures, never device evidence.
const globalScope={kind:'global'},scope={kind:'connector',connectorId:'mail'};
const policy=(patch={})=>({mode:'normal',maxInterruptions:null,windowMinutes:17,silentUntilUtc:null,
  preferredChannel:'banner',allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null,...patch});
const encryption={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
async function idle(app){while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));}
async function fixture(t,{autoShow=false,todo=false,legacyPolicy,legacyRecords}={}) {
  const cache=new URL('../../../.cache/desktop-notification-application-tests/',import.meta.url);mkdirSync(cache,{recursive:true});
  const userData=mkdtempSync(new URL('run-',cache)),file=path.join(userData,'runtime.sqlite');
  let application,host,channel,client,todoHost,time=Date.now();
  const originalPolicy=typeof legacyPolicy==='function'?legacyPolicy(time):legacyPolicy;
  if(legacyRecords)createEncryptedModuleStorage({userData,safeStorage:encryption,filename:'productivity-state.json'}).set('desktop-reminder-records',legacyRecords);
  if(originalPolicy!==undefined)createEncryptedModuleStorage({userData,safeStorage:encryption,filename:'productivity-state.json'})
    .set('desktop-notification-policy',originalPolicy);
  const native=[], callbacks=new Map();
  function open(){
    channel=createDesktopNotificationPort({storageDir:userData,now:()=>time,onOutcome:outcome=>host.receipt(outcome),notifier:{
      async isSupported(){return true;},async show(input,events){native.push(input);callbacks.set(input.id,events);if(autoShow)events.onShow();return {close(){}};}}});
    host=createDesktopNotificationApplicationHost({namespace:'fixture-notification-user',channel,now:()=>time});
    if(todo)todoHost=createDesktopTodoHost({userData,safeStorage:encryption,namespace:'fixture-notification-user',now:()=>time,
      notificationHost:host,createDeliveryHost:createReminderDeliveryHost,onNotification:notice=>host.deliverBatch({batchId:notice.batchId,
        scope:{kind:'connector',connectorId:'productivity'},expiresAt:new Date(time+30_000).toISOString(),title:'Fixture todo',body:notice.summary,source:'productivity'})});
    application=createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',hostUserNamespace:'fixture-notification-user',now:()=>new Date(time),
      tools:[...host.tools,...(todoHost?.tools??[])]});
    todoHost?.bindApplication(application);client=new Client(application,()=>time);
  }
  async function connect(){await client.connect();host.bindApplication(application,client);}
  async function close(){await todoHost?.close();await idle(application);host.dispose();application.close();}
  open();await connect();t.after(close);
  return {get host(){return host;},get app(){return application;},get channel(){return channel;},get todo(){return todoHost;},native,callbacks,originalPolicy,
    advance(ms){time+=ms;},now:()=>time,
    async restart(){await close();open();await connect();},
    configure(operationId,expectedRevision,patch,scope=globalScope){return host.configureSettings({operationId,expectedRevision,scope,patch});},
    ingest(id,scopeOverride=scope){host.ingest([{source:scopeOverride.connectorId??'mail',accountRef:'fixture',externalId:id,
      occurredAt:new Date(time).toISOString(),fetchedAt:new Date(time).toISOString(),contentRef:'fixture:'+id,sensitivity:'normal',dedupeKey:id}],{scope:scopeOverride});
      return host.drain().batches.find(b=>b.itemRefs.includes(id));},
  };
}

test('legacy visible reminders dismiss and stay dismissed after restart without a new feed record or toast',async t=>{
  const f=await fixture(t,{todo:true,legacyRecords:{old:{notificationId:'old',taskId:'historical',summary:'old inbox',occurredAt:new Date().toISOString(),state:'visible',presentationAttempted:true}}});
  assert.equal(f.todo.snapshot().notifications.length,1);assert.equal(f.host.snapshot().feed.items.length,0);
  f.todo.dismiss({id:'old'});assert.equal(f.todo.snapshot().notifications.length,0);
  await f.restart();await f.todo.tick(true);assert.equal(f.todo.snapshot().notifications.length,0);assert.equal(f.native.length,0);
});

test('new reminder read acknowledgments still require their original feed record',async t=>{
  const f=await fixture(t,{todo:true,legacyRecords:{newer:{notificationId:'newer',batchId:'missing-feed',summary:'new inbox',occurredAt:new Date().toISOString(),state:'visible',presentationAttempted:true}}});
  assert.throws(()=>f.todo.dismiss({id:'newer'}),/not found/);assert.equal(f.todo.snapshot().notifications.length,1);
});

test('explicit UI settings traverse original Runtime approval and ToolGateway once, then latest policy governs delivery',async t=>{
  const f=await fixture(t);
  const configured=await f.configure('global-policy',0,policy());assert.equal(configured.state,'confirmed');
  const read=f.app.readHostToolTask(configured.taskId);assert.equal(read.approval.state,'allowed');
  const evidence=f.app.runtime.readToolExecutions(configured.taskId).find(e=>e.toolName==='notifications.interruption_policy.set');
  assert.equal(evidence.policyDecision,'allow');assert.equal(evidence.state,'confirmed');
  assert.equal(f.app.runtime.getApproval(read.approval.approvalId).argumentsDigest,digest({operationId:'global-policy',expectedRevision:0,scope:globalScope,patch:policy()}));
  assert.equal((await f.configure('global-policy',0,policy())).taskId,configured.taskId);
  assert.throws(()=>f.configure('global-policy',0,policy({mode:'silent'})),/different|不同/);
  const batch=f.ingest('latest-channel');
  f.host.runtimeHost.reserveInterruption({roundId:'old-channel',batchIds:[batch.id],scope,channels:['banner'],expiresAt:new Date(f.now()+30_000).toISOString()});
  await f.configure('prefer-voice',1,{preferredChannel:'voice'});
  const suppressed=await f.host.deliverRound({roundId:'old-channel',channel:'banner',title:'Fixture',body:'No OS send'});
  assert.equal(suppressed.counted,false);assert.equal(suppressed.reason,'preferred_channel_not_selected');assert.equal(f.native.length,0);
  const unavailable=await f.host.deliverBatch({batchId:batch.id,scope,expiresAt:new Date(f.now()+30_000).toISOString(),title:'Fixture',body:'No invented speech'});
  assert.equal(unavailable.state,'unavailable');assert.equal(f.native.length,0);
});

test('unknown native delivery is never resent; late show and click independently update delivery and unread',async t=>{
  const f=await fixture(t);await f.configure('global',0,policy({maxInterruptions:1}));
  const batch=f.ingest('notice');
  const input={batchId:batch.id,scope,expiresAt:new Date(f.now()+30_000).toISOString(),title:'Fixture notice',body:'Synthetic native receipt',source:'fixture'};
  const pending=await f.host.deliverBatch(input);assert.equal(pending.attempts.banner.state,'unknown');
  assert.equal(f.native.length,1);assert.equal(f.host.snapshot().feed.items[0].unread,true);
  await f.host.deliverBatch(input);assert.equal(f.native.length,1);
  const callbacks=f.callbacks.get(f.native[0].id);callbacks.onShow();
  assert.equal(f.host.runtimeHost.getInterruptionRound(pending.roundId).attempts.banner.state,'delivered');
  assert.ok(f.host.snapshot().feed.items[0].deliveredAt);assert.equal(f.host.snapshot().feed.items[0].unread,true);
  const returnDigest=f.host.getDigest({trigger:'on_return'});assert.equal(returnDigest.items.length,1);assert.equal(f.native.length,1);
  callbacks.onClick();assert.equal(f.host.snapshot().feed.items[0].unread,false);
  assert.equal(f.host.getDigest({trigger:'on_return'}).items.length,0);
  await f.restart();await f.host.deliverBatch(input);assert.equal(f.native.length,1);
  assert.equal(f.host.snapshot().feed.items[0].unread,false);
});

test('restart reads the original unknown OS intent and cannot create a replacement round to bypass quota',async t=>{
  const f=await fixture(t);await f.configure('global',0,policy({maxInterruptions:1}));
  const batch=f.ingest('unknown');const input={batchId:batch.id,scope,expiresAt:new Date(f.now()+30_000).toISOString(),title:'Fixture',body:'Unknown'};
  const original=await f.host.deliverBatch(input);await f.restart();
  const read=await f.host.deliverBatch(input);assert.equal(read.roundId,original.roundId);assert.equal(read.attempts.banner.state,'unknown');assert.equal(f.native.length,1);
  const changed=f.ingest('different');
  const blocked=f.host.runtimeHost.reserveInterruption({roundId:'replacement',batchIds:[changed.id],scope,channels:['banner'],expiresAt:new Date(f.now()+30_000).toISOString()});
  assert.equal(blocked.counted,false);assert.equal(blocked.reason,'interruption_limit_reached');
  f.channel.reconcile(f.native[0].id,true);f.host.reconcileDelivery(original.roundId);
  assert.equal(f.host.runtimeHost.getInterruptionRound(original.roundId).attempts.banner.state,'delivered');assert.equal(f.native.length,1);
});

test('silence preserves feed, return is a read and inherited connector settings cannot bypass global silence',async t=>{
  const f=await fixture(t,{autoShow:true});await f.configure('global',0,policy({mode:'silent',maxInterruptions:0}));
  await f.configure('connector',0,{mode:'normal',maxInterruptions:null},scope);
  assert.equal(f.ingest('silent'),undefined);assert.equal(f.host.snapshot().feed.items.length,1);assert.equal(f.native.length,0);
  const digest=f.host.getDigest({trigger:'on_return'});assert.equal(digest.items.length,1);assert.equal(digest.interruptionCount,0);
  f.host.acknowledgeRead({operationId:'read-silent',itemIds:['silent']});assert.equal(f.host.getDigest({trigger:'on_return'}).items.length,0);
  assert.equal(f.native.length,0);
});

test('production todo injection uses the same Runtime notification state and does not acknowledge an inbox as OS delivery',async t=>{
  const f=await fixture(t,{todo:true});await f.configure('global',0,policy());
  await f.todo.create({title:'Fixture reminder',remindUtc:new Date(f.now()+1000).toISOString()});
  f.advance(1500);await f.todo.tick(true);
  const notice=f.todo.snapshot().notifications[0];assert.ok(notice.batchId);
  assert.equal(f.host.snapshot().feed.items.length,1);assert.equal(f.host.status().unacknowledgedBatches,1);
  assert.equal(f.host.snapshot().feed.items[0].deliveredAt,undefined);
  f.callbacks.get(f.native[0].id).onShow();assert.equal(f.host.status().unacknowledgedBatches,0);
  assert.equal(f.host.snapshot().feed.items[0].unread,true);
  f.todo.dismiss({id:notice.notificationId});assert.equal(f.host.snapshot().feed.items[0].unread,false);
});

test('saved Todo quiet/pause/digest remain scoped and survive restart before any new global configuration',async t=>{
  const hhmm=value=>new Date(value).toISOString().slice(11,16);
  const f=await fixture(t,{todo:true,autoShow:true,legacyPolicy:now=>({pauseUntilUtc:new Date(now+5*60000).toISOString(),
    quietHours:{startLocal:hhmm(now-3600000),endLocal:hhmm(now+3600000),timeZone:'UTC'},digest:{windowMs:60000,maxItems:3,sources:['productivity']}})});
  assert.equal(f.host.snapshot().policy.state,'unconfigured');assert.deepEqual(f.todo.snapshot().policy,f.originalPolicy);
  await f.todo.create({title:'Preserve the original silence',remindUtc:new Date(f.now()+1000).toISOString()});
  f.advance(1500);await f.todo.tick(true);assert.equal(f.native.length,0);assert.equal(f.todo.snapshot().notifications.length,0);
  assert.equal(f.todo.snapshot().notificationStatus.pausedUntil,f.originalPolicy.pauseUntilUtc);
  const other=f.ingest('unrelated-mail');assert.deepEqual(other.itemRefs,['unrelated-mail']);
  assert.equal(f.host.status(scope).quietUntil,null);assert.equal(f.host.status(scope).pausedUntil,null);
  await f.restart();await f.todo.tick(true);assert.equal(f.native.length,0);assert.deepEqual(f.todo.snapshot().policy,f.originalPolicy);
  f.advance(2*3600000);await f.todo.tick(true);
  assert.equal(f.native.length,1);assert.equal(f.todo.snapshot().notifications.length,1);
  assert.equal(f.host.snapshot().policy.state,'unconfigured');
  await f.restart();await f.todo.tick(true);assert.equal(f.native.length,1);
});

test('old Todo digest count and window are preserved across restart without holding another connector',async t=>{
  const f=await fixture(t,{todo:true,autoShow:true,legacyPolicy:{digest:{windowMs:60000,maxItems:3,sources:['productivity']}}});
  await f.todo.create({title:'Digest one',remindUtc:new Date(f.now()+1000).toISOString()});
  await f.todo.create({title:'Digest two',remindUtc:new Date(f.now()+1500).toISOString()});
  f.advance(2000);await f.todo.tick(true);assert.equal(f.native.length,0);assert.equal(f.todo.snapshot().notificationStatus.pending,2);
  assert.deepEqual(f.ingest('mail-during-digest').itemRefs,['mail-during-digest']);
  await f.restart();await f.todo.tick(true);assert.equal(f.native.length,0);
  f.advance(60001);await f.todo.tick(true);assert.equal(f.native.length,1);
  assert.match(f.native[0].body,/Digest one/);assert.match(f.native[0].body,/Digest two/);
  assert.equal(f.host.snapshot().policy.state,'unconfigured');
});

test('editing the old Todo policy uses original Gateway/CAS and immediately changes digest and silence without asking for new global limits',async t=>{
  const f=await fixture(t,{todo:true,autoShow:true,legacyPolicy:now=>({pauseUntilUtc:new Date(now+3600000).toISOString(),digest:{windowMs:60000,maxItems:3}})});
  const changed={digest:{windowMs:60000,maxItems:1,sources:['productivity']}};
  await f.todo.configureNotifications(changed);assert.deepEqual(f.todo.snapshot().policy,changed);
  assert.equal(f.todo.snapshot().notificationStatus.pausedUntil,null);assert.equal(f.host.snapshot().policy.state,'unconfigured');
  const settingsTask=f.app.runtime.listTasks({limit:100}).items.find(task=>task.goal==='Host tool notifications.interruption_policy.set');
  const record=f.app.runtime.readToolExecutions(settingsTask.taskId).find(value=>value.toolName==='notifications.interruption_policy.set');
  assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');
  await f.todo.create({title:'New policy now',remindUtc:new Date(f.now()+1000).toISOString()});
  f.advance(1500);await f.todo.tick(true);assert.equal(f.native.length,1);
  await f.restart();assert.deepEqual(f.todo.snapshot().policy,changed);assert.equal(f.todo.snapshot().notificationStatus.pausedUntil,null);
});

test('legacy settings cannot self-assert a user command through the registered tool or reuse different UI arguments',async t=>{
  const f=await fixture(t,{todo:true,legacyPolicy:{digest:{windowMs:60000,maxItems:3}}});
  const legacyScope={kind:'connector',connectorId:'productivity'},input={operationId:'model-proposal',expectedRevision:1,scope:legacyScope,legacyPolicy:{}};
  const context={taskId:'untrusted-model',runId:'untrusted-run',authorizationRef:'model-claimed-grant',scopes:['notifications:settings'],
    argumentsDigest:digest(input),signal:new AbortController().signal,deadline:new Date(f.now()+30000).toISOString()};
  await assert.rejects(f.host.tools[0].execute(input,context),/user settings command/);
  assert.deepEqual(f.todo.snapshot().policy,f.originalPolicy);assert.equal(f.app.runtime.listTasks({limit:100}).items.length,0);
  const typed={operationId:'typed-ui',expectedRevision:0,scope:globalScope,patch:policy()};
  assert.equal((await f.host.configureSettings(typed)).state,'confirmed');
  assert.throws(()=>f.host.configureSettings({...input,operationId:typed.operationId}),/different|不同/);
  assert.deepEqual(f.todo.snapshot().policy,f.originalPolicy);
});
