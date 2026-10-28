import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';

const scope={kind:'connector',connectorId:'mail'};
const policy={mode:'normal',maxInterruptions:1,windowMinutes:17,silentUntilUtc:null,
  preferredChannel:'banner',allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null};
const root=resolve('.cache/sol-notification-click-evidence-20261026/tests');
function directory(t) {
  mkdirSync(root,{recursive:true});const path=mkdtempSync(join(root,'case-'));
  assert.ok(path.startsWith(root+sep));return path;
}
async function idle(app){while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));}

test('early native click publishes a separate read receipt while delivery stays unknown',async t=>{
  const storageDir=directory(t),outcomes=[];let callbacks;
  const port=createDesktopNotificationPort({storageDir,onOutcome:outcome=>outcomes.push(outcome),notifier:{
    async isSupported(){return true;},async show(_input,events){callbacks=events;return {close(){}};}}});
  t.after(()=>port.dispose());
  await port.sendAdvisoryNotification({id:'early-click',title:'fixture',body:'no OS send',roundId:'original-round'});
  callbacks.onClick();
  const pending=port.readDeliveryOutcome('early-click');
  assert.equal(pending.deliveryState,'unknown');
  assert.equal(pending.userRead,false,'click alone must not become a show receipt');
  assert.deepEqual(pending.evidenceRefs,[]);
  assert.ok(Number.isFinite(Date.parse(pending.clickedAt)),'native click evidence must be readable');
  assert.equal(pending.roundId,'original-round');
  assert.equal(outcomes.length,1,'the original application host must be woken for the click');
});

async function applicationFixture(t) {
  const storageDir=directory(t),native=[],callbacks=new Map();let channel,host,app,client,publishClicks=true;
  const clock=Date.now(),database=join(storageDir,'runtime.sqlite');
  const notifier={async isSupported(){return true;},async show(input,events){native.push(input);callbacks.set(input.id,events);return {close(){}};}};
  async function open(){
    channel=createDesktopNotificationPort({storageDir,notifier,now:()=>clock,
      onOutcome:outcome=>{if(publishClicks)host?.receipt(outcome);}});
    host=createDesktopNotificationApplicationHost({namespace:'sol-click-evidence',channel,now:()=>clock});
    app=createRuntimeApplication({path:database,profile:'huawei_ict_agentarts',hostUserNamespace:'sol-click-evidence',
      now:()=>new Date(clock),tools:host.tools});
    client=new Client(app,()=>clock);await client.connect();host.bindApplication(app,client);
  }
  async function close(){if(!app)return;await idle(app);host.dispose();app.close();app=undefined;}
  await open();t.after(close);
  async function deliver(){
    await host.configureSettings({operationId:'click-policy',expectedRevision:0,scope:{kind:'global'},patch:policy});
    host.ingest([{source:'mail',accountRef:'fixture',externalId:'clicked-mail',occurredAt:new Date(clock).toISOString(),
      fetchedAt:new Date(clock).toISOString(),contentRef:'fixture:clicked',sensitivity:'normal',dedupeKey:'clicked-mail'}],{scope});
    const batch=host.drain().batches.find(value=>value.itemRefs.includes('clicked-mail'));
    assert.ok(batch);
    const round=await host.deliverBatch({batchId:batch.id,scope,expiresAt:new Date(clock+30_000).toISOString(),
      title:'fixture',body:'no OS send',source:'mail'});
    assert.equal(round.attempts.banner.state,'unknown');assert.equal(native.length,1);
    return round.roundId;
  }
  return {deliver,callbacks,native,get host(){return host;},get channel(){return channel;},
    get app(){return app;},setPublishClicks(value){publishClicks=value;},
    async restart(beforeOpen){await close();beforeOpen?.(storageDir);await open();}};
}

test('early click acknowledges original feed while the round remains unknown and is not resent',async t=>{
  const f=await applicationFixture(t),roundId=await f.deliver();
  assert.equal(f.host.snapshot().feed.items[0].unread,true);
  f.callbacks.get(f.native[0].id).onClick();
  assert.equal(f.host.snapshot().feed.items[0].unread,false);
  assert.equal(f.host.runtimeHost.getInterruptionRound(roundId).attempts.banner.state,'unknown');
  assert.equal(f.channel.readDeliveryOutcome(f.native[0].id).deliveryState,'unknown');
  assert.equal(f.native.length,1);
});

test('reopening SQLite and the port consumes the original persisted click binding without a new send',async t=>{
  const f=await applicationFixture(t),roundId=await f.deliver(),id=f.native[0].id;
  f.setPublishClicks(false);f.callbacks.get(id).onClick();
  assert.equal(f.host.snapshot().feed.items[0].unread,true,'the first host deliberately missed the callback');
  assert.equal(f.channel.readDeliveryOutcome(id).deliveryState,'unknown');
  await f.restart();
  assert.equal(f.host.snapshot().feed.items[0].unread,false,'restart must consume the saved click-to-round binding');
  assert.equal(f.host.runtimeHost.getInterruptionRound(roundId).attempts.banner.state,'unknown');
  assert.equal(f.native.length,1,'unknown delivery must not be sent again');
});

test('a reopened click bound to another round cannot mark the original feed read',async t=>{
  const f=await applicationFixture(t),roundId=await f.deliver(),id=f.native[0].id;
  f.setPublishClicks(false);f.callbacks.get(id).onClick();
  await f.restart(storageDir=>{
    const file=join(storageDir,'desktop-notifications.json'),saved=JSON.parse(readFileSync(file,'utf8'));
    saved.records.find(record=>record.id===id).roundId='different-round';
    writeFileSync(file,JSON.stringify(saved));
  });
  assert.equal(f.host.snapshot().feed.items[0].unread,true);
  assert.equal(f.host.runtimeHost.getInterruptionRound(roundId).attempts.banner.state,'unknown');
  assert.equal(f.native.length,1);
});

test('a failure after an early click remains a failed delivery without a show receipt',async t=>{
  const f=await applicationFixture(t),roundId=await f.deliver(),id=f.native[0].id;
  f.callbacks.get(id).onClick();f.callbacks.get(id).onFailed();
  assert.equal(f.channel.readDeliveryOutcome(id).deliveryState,'failed');
  assert.deepEqual(f.channel.readDeliveryOutcome(id).evidenceRefs,[]);
  assert.equal(f.host.runtimeHost.getInterruptionRound(roundId).attempts.banner.state,'failed');
  assert.equal(f.native.length,1);
});

test('delivered click survives a lost callback and is consumed from the original SQLite round after reopen',async t=>{
  const f=await applicationFixture(t),roundId=await f.deliver(),id=f.native[0].id;
  f.callbacks.get(id).onShow();
  assert.equal(f.host.runtimeHost.getInterruptionRound(roundId).attempts.banner.state,'delivered');
  f.setPublishClicks(false);f.callbacks.get(id).onClick();
  assert.equal(f.channel.readDeliveryOutcome(id).deliveryState,'delivered');
  assert.equal(f.channel.readDeliveryOutcome(id).userRead,true);
  assert.equal(f.host.snapshot().feed.items[0].unread,true,'the application callback was deliberately lost');
  await f.restart();
  assert.equal(f.host.snapshot().feed.items[0].unread,false,'reopen must consume the durable delivered-click receipt');
  assert.equal(f.host.runtimeHost.getInterruptionRound(roundId).attempts.banner.state,'delivered');
  assert.equal(f.native.length,1,'the delivered toast must not be sent again');
});

test('delivered click survives an acknowledge write failure and is consumed after reopen',async t=>{
  const f=await applicationFixture(t),roundId=await f.deliver(),id=f.native[0].id;
  f.callbacks.get(id).onShow();
  assert.equal(f.host.runtimeHost.getInterruptionRound(roundId).attempts.banner.state,'delivered');
  let writes=0;
  f.host.runtimeHost.acknowledgeRead=()=>{writes++;throw Error('injected SQLite acknowledge write failure');};
  f.callbacks.get(id).onClick();
  assert.equal(writes,1,'the original Runtime acknowledge path was attempted');
  assert.equal(f.host.snapshot().feed.items[0].unread,true);
  await f.restart();
  assert.equal(f.host.snapshot().feed.items[0].unread,false,'reopen must retry only the original read acknowledgement');
  assert.equal(f.host.runtimeHost.getInterruptionRound(roundId).attempts.banner.state,'delivered');
  assert.equal(f.native.length,1,'an acknowledgement retry cannot resend the toast');
});

test('an older delivered click with acknowledgedAt alone remains bound to its original round',async t=>{
  const f=await applicationFixture(t),roundId=await f.deliver(),id=f.native[0].id;
  f.callbacks.get(id).onShow();
  f.setPublishClicks(false);f.callbacks.get(id).onClick();
  await f.restart(storageDir=>{
    const file=join(storageDir,'desktop-notifications.json'),saved=JSON.parse(readFileSync(file,'utf8'));
    const record=saved.records.find(value=>value.id===id);
    assert.ok(record.acknowledgedAt);
    delete record.clickedAt;
    writeFileSync(file,JSON.stringify(saved));
  });
  assert.equal(f.host.snapshot().feed.items[0].unread,false);
  assert.equal(f.host.runtimeHost.getInterruptionRound(roundId).attempts.banner.state,'delivered');
  assert.equal(f.native.length,1);
});
