import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';
import {createF12NotificationWorkflowPorts} from '../electron/f12-notification-workflow-ports.js';

// Real local SQLite + notification host; the configured graph binding and device are explicit fixtures.
async function fixture(t,{unknown=false}={}) {
  const time=Date.now(),deadline=new Date(time+60_000).toISOString(),controller=new AbortController();
  let sends=0,read;
  const channel={async sendAdvisoryNotification(input){
    sends++;if(!unknown)read={id:input.id,deliveryState:'delivered',observedAt:new Date(time).toISOString(),evidenceRefs:['fixture-device']};
  },readDeliveryOutcome:()=>read,dispose(){}};
  const host=createDesktopNotificationApplicationHost({namespace:'f12-fixture',channel,now:()=>time});
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'f12-fixture',tools:host.tools,now:()=>new Date(time)});
  const client=new Client(app,()=>time);await client.connect();host.bindApplication(app,client);
  t.after(async()=>{host.dispose();while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));app.close();});
  const scope={kind:'connector',connectorId:'mail'};
  await host.configureSettings({operationId:'policy',expectedRevision:0,scope:{kind:'global'},patch:{mode:'normal',maxInterruptions:null,
    windowMinutes:17,silentUntilUtc:null,preferredChannel:'banner',allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null}});
  host.ingest([{source:'mail',accountRef:'fixture',externalId:'item',occurredAt:new Date(time).toISOString(),
    fetchedAt:new Date(time).toISOString(),contentRef:'fixture:item',sensitivity:'normal',dedupeKey:'item'}],{scope});
  const batch=host.drain().batches[0];
  const round=host.runtimeHost.reserveInterruption({roundId:'original-round',batchIds:[batch.id],scope,channels:['banner'],expiresAt:deadline});
  const plan={roundId:round.roundId,itemId:'item',channel:'banner',policyRevisionDigest:round.policyRevisionDigest,title:'Fixture',body:'Fixture delivery',source:'mail'};
  let binding={input:plan,deadline,sessionId:'session',confirmedOperations:[]};
  const application={readConfiguredWorkflowBinding:()=>binding};
  const ports=createF12NotificationWorkflowPorts({getApplication:()=>application,notificationHost:host,authorizeExport:async()=>true,now:()=>time});
  return {ports,host,controller,plan,scope:{parentTaskId:'parent',sessionId:'session',deadline,signal:controller.signal},
    sends:()=>sends,changeBinding:value=>{binding=value;}};
}

test('F12 ports can be composed before Runtime binds the notification singleton',()=>{
  const notificationHost={deliverRound(){},get runtimeHost(){throw Error('not yet bound');}};
  const ports=createF12NotificationWorkflowPorts({getApplication:()=>undefined,notificationHost,authorizeExport:async()=>false});
  assert.equal(typeof ports.notificationHost.getInterruptionRound,'function');
  assert.throws(()=>ports.notificationHost.getInterruptionRound('round'),/not yet bound/);
});

test('F12 concrete port records original delivery before send and reads it without duplicate send',async t=>{
  const f=await fixture(t),input={roundId:f.plan.roundId,itemId:f.plan.itemId,channel:'banner'};
  assert.equal(await f.ports.verifyDeliveryBinding(f.scope,input),true);
  const receipt=await f.ports.resolveDeliveryReceipt(f.scope,input);
  assert.equal(receipt.state,'delivered');assert.ok(receipt.evidenceRefs.length);
  assert.deepEqual(f.host.runtimeHost.getInterruptionRound(input.roundId).attempts.banner.evidenceRefs,receipt.evidenceRefs);
  assert.deepEqual(await f.ports.resolveDeliveryReceipt(f.scope,input),receipt);assert.equal(f.sends(),1);
  await assert.rejects(f.ports.resolveDeliveryReceipt(f.scope,{...input,itemId:'other'}),{code:'UNAUTHORIZED'});
  f.controller.abort();await assert.rejects(f.ports.resolveDeliveryReceipt(f.scope,input),{code:'CANCELLED'});assert.equal(f.sends(),1);
});

test('F12 unknown delivery remains on the original durable attempt without replay',async t=>{
  const f=await fixture(t,{unknown:true}),input={roundId:f.plan.roundId,itemId:f.plan.itemId,channel:'banner'};
  assert.equal((await f.ports.resolveDeliveryReceipt(f.scope,input)).state,'unknown');
  assert.equal((await f.ports.resolveDeliveryReceipt(f.scope,input)).state,'unknown');assert.equal(f.sends(),1);
  f.changeBinding(undefined);await assert.rejects(f.ports.resolveDeliveryReceipt(f.scope,input),{code:'UNAUTHORIZED'});
});
