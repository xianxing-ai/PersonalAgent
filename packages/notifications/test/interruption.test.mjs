import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {NotificationService,createNotificationSettingsTool} from '../dist/index.js';

const copy=structuredClone,globalScope={kind:'global'},connector={kind:'connector',connectorId:'mail'};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']'
  :'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const userPolicy=(patch={})=>({mode:'normal',maxInterruptions:null,windowMinutes:23,silentUntilUtc:null,
  preferredChannel:'auto',allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null,...patch});
function fixture({atomic=true,policy={},initial}={}) {
  let time=Date.parse('2026-10-15T12:00:00.000Z'),ids=0;const cells=new Map(),legacy=new Map(initial?[['notifications:state',copy(initial)]]:[]),stages=[];
  const storage={get:key=>copy(legacy.get(key)),set:(key,value)=>legacy.set(key,copy(value)),delete:key=>legacy.delete(key)};
  const port={read:key=>copy(cells.get(key)??(legacy.has(key)?{revision:0,value:legacy.get(key)}:undefined)),
    compareAndSet(key,expected,next){const current=this.read(key);if(current?.revision!==expected)return false;
      cells.set(key,{revision:(expected??0)+1,value:copy(next)});return true;}};
  const options={now:()=>time,idFactory:()=>`batch-${++ids}`,...(atomic?{atomicState:port}:{}),onStage:event=>stages.push(event)};
  const service=new NotificationService(storage,policy,options);
  const configure=(patch=userPolicy())=>service.updateInterruptionPolicy({operationId:'configure',expectedRevision:0,scope:globalScope,patch});
  const item=id=>({source:'mail',accountRef:'synthetic',externalId:id,occurredAt:new Date(time).toISOString(),fetchedAt:new Date(time).toISOString(),
    contentRef:'synthetic:'+id,sensitivity:'normal',dedupeKey:id});
  const ingest=(id,context={})=>{service.ingest([item(id)],{scope:connector,...context});return service.drain().batches.find(b=>b.itemRefs.includes(id));};
  const reserve=(roundId,batch,extra={})=>service.reserveInterruption({roundId,batchIds:[batch.id],scope:connector,channels:['banner','voice'],
    expiresAt:new Date(time+3600000).toISOString(),...extra});
  return {service,storage,port,options,stages,configure,item,ingest,reserve,restart:()=>new NotificationService(storage,policy,options),
    now:()=>time,advance:ms=>{time+=ms;},cells};
}
test('no atomic port keeps legacy ingestion but refuses new quota/policy claims',()=>{
  const f=fixture({atomic:false});assert.equal(f.service.status().interruptionQuotaSafety,'unavailable');
  assert.throws(()=>f.configure(),/Atomic/);f.ingest('still-ingested');assert.equal(f.service.notificationFeed().items.length,1);
  assert.equal(f.service.getInterruptionPolicy(connector).state,'unconfigured');
});
test('global policy must be explicit; CAS and operation replay preserve feed, unread and prior rounds',()=>{
  const f=fixture();assert.throws(()=>f.configure({mode:'normal'}),/Explicit/);f.configure();const b=f.ingest('event');
  const original=f.service.updateInterruptionPolicy({operationId:'silence',expectedRevision:1,scope:globalScope,patch:{mode:'silent'}});
  assert.deepEqual(f.service.updateInterruptionPolicy({operationId:'silence',expectedRevision:1,scope:globalScope,patch:{mode:'silent'}}),original);
  assert.throws(()=>f.service.updateInterruptionPolicy({operationId:'silence',expectedRevision:1,scope:globalScope,patch:{mode:'normal'}}),/parameters changed/);
  assert.throws(()=>f.service.updateInterruptionPolicy({operationId:'stale',expectedRevision:1,scope:globalScope,patch:{mode:'normal'}}),/policy changed/);
  assert.equal(f.service.notificationFeed().cursor,1);assert.equal(f.service.notificationFeed().items[0].unread,true);
  assert.equal(f.service.status().unacknowledgedBatches,1);assert.equal(f.reserve('suppressed',b).counted,false);
});
test('cross-instance CAS conflict never overwrites concurrently committed state',()=>{
  const f=fixture();f.configure();const original=f.port.compareAndSet.bind(f.port);let race=true;
  f.port.compareAndSet=(key,expected,next)=>{if(race){race=false;const cell=f.port.read(key);original(key,cell.revision,cell.value);}return original(key,expected,next);};
  assert.throws(()=>f.ingest('conflict'),/state changed/);assert.equal(f.restart().notificationFeed().items.length,0);
  f.ingest('conflict');assert.equal(f.restart().notificationFeed().items.length,1);
});
test('concurrent rounds share a global cap and channel retries cannot double charge',async()=>{
  const f=fixture();f.configure(userPolicy({maxInterruptions:1}));const one=f.ingest('one'),two=f.ingest('two');
  const outcomes=await Promise.all([Promise.resolve().then(()=>f.reserve('round-one',one)),Promise.resolve().then(()=>f.reserve('round-two',two))]);
  assert.equal(outcomes.filter(r=>r.counted).length,1);assert.equal(outcomes.filter(r=>r.reason==='interruption_limit_reached').length,1);
  assert.equal(f.service.beginDelivery({roundId:'round-one',channel:'banner'}).maySend,true);
  f.service.completeDelivery({roundId:'round-one',channel:'banner',state:'delivered',evidenceRefs:['actual-fixture-banner']});
  assert.equal(f.service.beginDelivery({roundId:'round-one',channel:'banner'}).maySend,false);
  assert.equal(f.service.beginDelivery({roundId:'round-one',channel:'voice'}).maySend,true);
  f.service.completeDelivery({roundId:'round-one',channel:'voice',state:'delivered',evidenceRefs:['actual-fixture-voice']});
  assert.equal(f.reserve('round-one',one).counted,true);assert.equal(f.service.notificationFeed().items[0].unread,true);
  assert.ok(f.service.notificationFeed().items[0].deliveredAt);
});
test('silent mode ingests continuously, returns valid feed/digest only and never grants an interruption',()=>{
  const f=fixture();f.configure(userPolicy({mode:'silent',maxInterruptions:0}));
  f.service.ingest([f.item('silent-one')],{scope:connector});f.service.ingest([f.item('expired')],{scope:connector,validUntilUtc:new Date(f.now()+1).toISOString()});
  f.service.ingest([f.item('withdrawn')],{scope:connector});f.service.withdrawNotifications({operationId:'withdraw',itemIds:['withdrawn']});f.advance(2);
  assert.equal(f.service.drain().batches.length,0);assert.equal(f.service.notificationFeed().items.length,3);
  assert.deepEqual(f.service.getDigest({trigger:'on_return'}).items.map(e=>e.id),['silent-one']);
  assert.equal(f.service.getDigest({trigger:'on_demand'}).interruptionCount,0);
  f.service.acknowledgeRead({operationId:'read-silent',itemIds:['silent-one']});assert.equal(f.service.getDigest({trigger:'on_return'}).items.length,0);
  assert.equal(f.restart().notificationFeed().items[0].unread,false);
});
test('latest policy blocks old queued rounds; unsent reservation releases but unknown delivery never refunds or resends',()=>{
  const f=fixture();f.configure(userPolicy({maxInterruptions:1}));const b=f.ingest('event');f.reserve('old',b);
  f.service.updateInterruptionPolicy({operationId:'silent',expectedRevision:1,scope:globalScope,patch:{mode:'silent'}});
  assert.equal(f.service.beginDelivery({roundId:'old',channel:'banner'}).maySend,false);assert.equal(f.service.getInterruptionRound('old').counted,false);
  f.service.updateInterruptionPolicy({operationId:'normal',expectedRevision:2,scope:globalScope,patch:{mode:'normal'}});
  f.reserve('attempted',b);assert.equal(f.service.beginDelivery({roundId:'attempted',channel:'banner'}).maySend,true);
  f.service.completeDelivery({roundId:'attempted',channel:'banner',state:'unknown',evidenceRefs:[]});
  const restarted=f.restart();assert.equal(restarted.beginDelivery({roundId:'attempted',channel:'banner'}).maySend,false);
  assert.equal(restarted.beginDelivery({roundId:'attempted',channel:'voice'}).maySend,false);assert.equal(restarted.getInterruptionRound('attempted').counted,true);
  const second=f.ingest('second');assert.equal(f.reserve('another',second).reason,'interruption_limit_reached');
  restarted.completeDelivery({roundId:'attempted',channel:'banner',state:'delivered',evidenceRefs:['independent-readback']});
  assert.equal(restarted.notificationFeed().items[0].unread,true);
});
test('global silence and quota cannot be bypassed by connector or responsibility patches',()=>{
  const f=fixture();f.configure(userPolicy({mode:'silent',maxInterruptions:0}));
  f.service.updateInterruptionPolicy({operationId:'connector-policy',expectedRevision:0,scope:connector,patch:{mode:'normal',maxInterruptions:null,allowUrgentBreakthrough:true}});
  const responsibility={kind:'responsibility',connectorId:'mail',responsibilityId:'inbox'};
  f.service.updateInterruptionPolicy({operationId:'responsibility-policy',expectedRevision:0,scope:responsibility,patch:{mode:'normal'}});
  assert.equal(f.service.getInterruptionPolicy(responsibility).effective.mode,'silent');
  f.service.ingest([f.item('urgent')],{scope:responsibility,urgent:true});assert.equal(f.service.drain().batches.length,0);
  assert.equal(f.service.getInterruptionPolicy(responsibility).constraints[0].policy.maxInterruptions,0);
});
test('timed silence ends without resetting feed or policy revision, rolling quotas survive restart',()=>{
  const f=fixture();f.configure(userPolicy({mode:'silent',silentUntilUtc:new Date(f.now()+1000).toISOString(),maxInterruptions:1,windowMinutes:1}));
  f.service.ingest([f.item('timed')],{scope:connector});assert.equal(f.service.drain().batches.length,0);f.advance(1000);
  const b=f.service.drain().batches[0];assert.ok(b);assert.equal(f.service.getInterruptionPolicy(connector).effective.mode,'normal');f.reserve('timed-round',b);
  assert.equal(f.restart().getInterruptionRound('timed-round').counted,true);f.advance(60001);
  const next=f.ingest('after-window');assert.equal(f.reserve('after-window-round',next).counted,true);assert.equal(f.service.notificationFeed().cursor,2);
});
test('legacy pending/batches migrate through the same CAS state and new fields survive legacy drain/ack',()=>{
  const f=fixture();const b=f.ingest('legacy');const raw=f.port.read('notifications:state').value;
  const migrated=fixture({initial:raw});migrated.configure();assert.equal(migrated.service.drain().batches[0].id,b.id);
  migrated.service.acknowledge(b.id);assert.equal(migrated.service.getInterruptionPolicy(connector).state,'configured');
  assert.equal(migrated.restart().notificationFeed().items[0].unread,true);
  assert.ok(migrated.restart().notificationFeed().items[0].deliveredAt);
});
test('actual pre-extension pending migrates faithfully and legacy batches recover feed from source replay only',()=>{
  const old=fixture({atomic:false});old.service.ingest([old.item('pending')]);const raw=old.storage.get('notifications:state');delete raw.interruption;
  const f=fixture({initial:raw});f.configure();assert.equal(f.service.notificationFeed().items[0].contentRef,'synthetic:pending');
  const batch=f.service.drain().batches[0];const batched=f.port.read('notifications:state').value;delete batched.interruption;
  const reopened=fixture({initial:batched});reopened.configure();assert.equal(reopened.service.notificationFeed().items.length,0);
  assert.deepEqual(reopened.service.ingest([reopened.item('pending')]),{accepted:0,duplicates:1});
  assert.equal(reopened.service.notificationFeed().items[0].contentRef,'synthetic:pending');
  assert.equal(reopened.service.drain().batches[0].id,batch.id);
});
test('a new round cannot bypass an unknown delivery for the same notification',()=>{
  const f=fixture();f.configure();const b=f.ingest('one');f.reserve('original',b);
  f.service.beginDelivery({roundId:'original',channel:'banner'});f.service.completeDelivery({roundId:'original',channel:'banner',state:'unknown',evidenceRefs:[]});
  assert.equal(f.reserve('different-round',b).reason,'original_round_requires_readback_or_is_terminal');
  assert.equal(f.service.getInterruptionRound('different-round').counted,false);
});
test('explicit preferred channel is respected and timed silence uses existing schedule suggestions',()=>{
  const f=fixture();f.configure(userPolicy({preferredChannel:'voice'}));const b=f.ingest('one');
  assert.equal(f.reserve('wrong-channel',b,{channels:['banner']}).reason,'preferred_channel_not_selected');
  assert.equal(f.reserve('voice-round',b,{channels:['voice']}).counted,true);
  const until=new Date(f.now()+1000).toISOString();f.service.updateInterruptionPolicy({operationId:'timed-silence',expectedRevision:1,scope:globalScope,patch:{silentUntilUtc:until}});
  assert.ok(f.service.planSchedules('synthetic').some(plan=>plan.scheduleId==='notifications:silence-end:'+until));
});
test('sending rechecks latest preferred channel after auto/voice/banner changes and releases only unattempted quota',()=>{
  for(const [initial,oldChannel,preferred] of [['auto','banner','voice'],['auto','voice','banner'],['voice','voice','banner'],['banner','banner','voice']]) {
    const f=fixture();f.configure(userPolicy({maxInterruptions:1,preferredChannel:initial}));const b=f.ingest('queued');
    f.reserve('reserved',b,{channels:[oldChannel]});
    f.service.updateInterruptionPolicy({operationId:'changed-channel',expectedRevision:1,scope:globalScope,patch:{preferredChannel:preferred}});
    const result=f.service.beginDelivery({roundId:'reserved',channel:oldChannel});
    assert.equal(result.maySend,false);assert.equal(result.reason,'preferred_channel_not_selected');
    assert.equal(result.round.counted,false);assert.deepEqual(result.round.attempts,{});
    const next=f.reserve('new-channel',b,{channels:[preferred]});assert.equal(next.counted,true);
    assert.equal(f.service.beginDelivery({roundId:'new-channel',channel:preferred}).maySend,true);
  }
});

test('latest preferred channel also blocks an unattempted secondary channel without refunding an already attempted round',()=>{
  const f=fixture();f.configure(userPolicy({maxInterruptions:1}));const b=f.ingest('multi-channel');f.reserve('round',b);
  assert.equal(f.service.beginDelivery({roundId:'round',channel:'banner'}).maySend,true);
  f.service.completeDelivery({roundId:'round',channel:'banner',state:'delivered',evidenceRefs:['fixture-delivery']});
  f.service.updateInterruptionPolicy({operationId:'prefer-banner',expectedRevision:1,scope:globalScope,patch:{preferredChannel:'banner'}});
  const blocked=f.service.beginDelivery({roundId:'round',channel:'voice'});assert.equal(blocked.maySend,false);
  assert.equal(blocked.reason,'preferred_channel_not_selected');assert.equal(blocked.round.counted,true);
  assert.equal(f.service.beginDelivery({roundId:'round',channel:'banner'}).maySend,false);
  const other=f.ingest('another');assert.equal(f.reserve('other-round',other,{channels:['banner']}).reason,'interruption_limit_reached');
});

test('duplicate corrected and withdrawn silent feed entries preserve history but never replay a return popup',()=>{
  const f=fixture();f.configure(userPolicy({mode:'silent',maxInterruptions:0}));
  assert.deepEqual(f.service.ingest([f.item('original')],{scope:connector}),{accepted:1,duplicates:0});
  assert.deepEqual(f.service.ingest([f.item('corrected')],{scope:connector,supersedes:['original']}),{accepted:1,duplicates:0});
  assert.deepEqual(f.service.ingest([f.item('corrected')],{scope:connector,supersedes:['original']}),{accepted:0,duplicates:1});
  assert.deepEqual(f.service.getDigest({trigger:'on_return'}).items.map(item=>item.id),['corrected']);
  const history=f.service.notificationFeed().items;assert.equal(history[0].validity,'withdrawn');assert.equal(history[0].unread,true);
  assert.equal(history[1].unread,true);assert.equal(history.length,2);assert.equal(f.service.drain().batches.length,0);
  f.service.withdrawNotifications({operationId:'withdraw-correction',itemIds:['corrected']});
  const resumed=f.restart();assert.equal(resumed.getDigest({trigger:'on_return'}).items.length,0);
  assert.equal(resumed.getDigest({trigger:'on_return'}).interruptionCount,0);
  resumed.updateInterruptionPolicy({operationId:'normal-after-return',expectedRevision:1,scope:globalScope,patch:{mode:'normal'}});
  assert.equal(resumed.drain().batches.length,0,'withdrawn/corrected old versions cannot become catch-up popups');
  assert.equal(resumed.notificationFeed().items.length,2,'history is not delivery or read acknowledgement');
});

test('settings tool requires exact original arguments and trusted explicit user command; timestamps are exposed',async()=>{
  const f=fixture(),input={operationId:'user-setting',expectedRevision:0,scope:globalScope,patch:userPolicy()};
  const context={taskId:'synthetic-settings',runId:'synthetic-run',signal:new AbortController().signal,deadline:new Date(f.now()+100000000).toISOString(),
    authorizationRef:'existing-policy-grant',scopes:['notifications:settings'],argumentsDigest:hash(input)};
  const tool=createNotificationSettingsTool(f.service,{requiredScopes:['notifications:settings'],verifyUserCommand:()=>true});
  assert.equal((await tool.execute(input,context)).revision,1);
  await assert.rejects(tool.execute({...input,expectedRevision:1},context),/argument\/version binding/);
  const forbidden=createNotificationSettingsTool(f.service,{requiredScopes:['notifications:settings'],verifyUserCommand:()=>false});
  await assert.rejects(forbidden.execute(input,context),/user settings command/);
  assert.ok(f.stages.some(stage=>stage.stage==='interruption_policy_updated'&&stage.observedAt));
});
