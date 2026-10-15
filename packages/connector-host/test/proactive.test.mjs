import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectorHost,createProactiveConnectorHost} from '../dist/index.js';
import {ProtocolError} from '@personal-agent/contracts';
import {MailConnector,MailService,FakeMailProvider} from '@personal-agent/mail';

const context=()=>({signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()});
const item=(id='1',content='fixture')=>({source:'fixture',accountRef:'account',externalId:id,dedupeKey:'key-'+id,
  occurredAt:'2026-10-15T00:00:00.000Z',fetchedAt:'2026-10-15T01:00:00.000Z',sensitivity:'private',contentRef:content});
const manifest={id:'fixture',version:'1.0.0',accountTypes:['fixture'],capabilities:['fetchChanges'],configSchema:{type:'object'},authentication:'none',requiresPresence:false,syncStrategy:'incremental',verification:'mock'};
function ports() {
  const states=new Map(),batches=new Map(),stages=[];let sinkFailure=false;
  return {states,batches,stages,setSinkFailure:value=>sinkFailure=value,
    checkpoints:{read:id=>states.get(id),compareAndSet:(id,revision,value)=>{
      if(states.get(id)?.revision!==revision)return false;states.set(id,structuredClone(value));return true;}},
    events:{persist:async batch=>{
      if(sinkFailure)throw new Error('fixture sink unavailable');
      const previous=batches.get(batch.batchId);if(previous)assert.deepEqual(previous,batch);
      batches.set(batch.batchId,structuredClone(batch));return {batchId:batch.batchId,durable:true};}},
    onStage:stage=>stages.push(stage)};
}
function fixture({read=async()=>({items:[item()],nextCursor:'1',hasMore:false}),mode='poll-only',watch,reconcile,kind='mail'}={}) {
  const state=ports();let connected=false,reads=0;
  const connector={manifest,connect(){connected=true;return {sessionRef:'fixture',interactionRequired:false};},disconnect(){connected=false;return {disconnected:true,cleanupState:'complete'};},
    health:()=>({state:connected?'ready':'disconnected'}),getCapabilities:()=>manifest.capabilities,fetchChanges:async input=>{reads++;return read(input);},search:()=>[],getItem(){throw Error('unused');},performAction(){throw Error('never write');}};
  const host=new ConnectorHost({read:()=>undefined});host.register({manifest,create:()=>connector},{proactive:[{sourceId:'source',accountRef:'account',kind,mode,configurationRevision:'config-1',...(watch?{watch}:{}),...(reconcile?{reconcile}:{})}]});
  const options={host,...state,authorize:async()=>true};const runner=createProactiveConnectorHost(options);
  return {runner,host,connector,options,...state,reads:()=>reads,connected:()=>connected};
}

test('registration does not connect; durable pending -> sink -> cursor, exact duplicate silent but new revision emitted',async()=>{
  let content='first';const f=fixture({read:async()=>({items:[item('1',content)],nextCursor:'1',hasMore:false})});
  assert.equal(f.connected(),false);assert.equal(f.reads(),0);
  await f.runner.start('source',context());assert.equal(f.reads(),0);
  assert.equal((await f.runner.tick('source',{...context(),limit:10})).state,'changed');
  assert.equal(f.states.get('source').cursor,'1');assert.equal([...f.batches.values()][0].events.length,1);
  assert.equal((await f.runner.tick('source',{...context(),limit:10})).state,'no_changes');
  content='changed';assert.equal((await f.runner.tick('source',{...context(),limit:10})).state,'changed');
  assert.equal([...f.batches.values()].flatMap(batch=>batch.events).length,2,'unsubscribed new events are not filtered as irrelevant');
  assert.ok(f.stages.every(stage=>stage.startedAt&&stage.endedAt&&stage.durationMs>=0));
  assert.deepEqual(f.stages.slice(1,5).map(stage=>stage.stage),['read','pending_persist','event_sink','cursor_commit']);
  await f.runner.dispose();
});

test('sink failure retains pending and original cursor; restarted host replays identical durable batch before refetch',async()=>{
  const f=fixture();await f.runner.start('source',context());f.setSinkFailure(true);
  const failed=await f.runner.tick('source',{...context(),limit:10});assert.equal(failed.state,'offline');
  assert.equal(f.states.get('source').cursor,undefined);const pending=structuredClone(f.states.get('source').pending);assert.ok(pending);
  f.setSinkFailure(false);const reopened=createProactiveConnectorHost(f.options);
  const resumed=await reopened.tick('source',{...context(),limit:10});assert.equal(resumed.recoveredPending,true);
  assert.equal(f.reads(),1);assert.deepEqual(f.batches.get(pending.batchId),pending);assert.equal(f.states.get('source').cursor,'1');
  await reopened.dispose();await f.runner.dispose();
});

test('read disconnection, authorization expiry, invalid cursor and cancellation never report no changes',async()=>{
  for(const code of ['EXTERNAL_FAILURE','UNAUTHORIZED','CURSOR_EXPIRED','CANCELLED']) {
    const f=fixture({read:async()=>{throw new ProtocolError(code,'fixture failure');}});await f.runner.start('source',context());
    const result=await f.runner.tick('source',{...context(),limit:10});assert.notEqual(result.state,'no_changes');assert.equal(result.errorCode,code);
    assert.equal(f.states.get('source').cursor,undefined);await f.runner.dispose();
  }
});

test('same-source read is not reentrant; independent sources can run in parallel',async()=>{
  let release,entered;const started=new Promise(resolve=>entered=resolve),block=new Promise(resolve=>release=resolve);
  const f=fixture({read:async()=>{entered();await block;return {items:[],nextCursor:'1',hasMore:false};}});
  await f.runner.start('source',context());const pending=f.runner.tick('source',{...context(),limit:1});await started;
  await assert.rejects(f.runner.tick('source',{...context(),limit:1}),{code:'REVISION_CONFLICT'});release();await pending;
  await f.runner.dispose();
  let active=0,maximum=0;const other=fixture();
  other.host.register({manifest:{...manifest,id:'second'},create:()=>({...other.connector,manifest:{...manifest,id:'second'},fetchChanges:async()=>{
    active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));active--;return {items:[],nextCursor:'1',hasMore:false};}})},
    {proactive:[{sourceId:'second-source',accountRef:'account',kind:'ci',mode:'poll-only',configurationRevision:'v1'}]});
  // Both explicit source adapters share this barrier only to demonstrate the host doesn't serialize unrelated reads.
  other.connector.fetchChanges=async()=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));active--;return {items:[],nextCursor:'1',hasMore:false};};
  await other.runner.start('source',context());await other.runner.start('second-source',context());
  await other.runner.tickMany([{sourceId:'source',limit:1},{sourceId:'second-source',limit:1}],context());assert.equal(maximum,2);await other.runner.dispose();
});

test('watch consumes durable pages and dispose removes subscription; manual/no adapter never claims monitoring',async()=>{
  let accept,stopped=0;
  const f=fixture({mode:'watch',kind:'wiki',watch:async(_connector,_input,onPage)=>{accept=onPage;return()=>{stopped++;};}});
  await f.runner.start('source',context());await accept({items:[item()],nextCursor:'watch-1',hasMore:false});
  assert.equal(f.states.get('source').cursor,'watch-1');await f.runner.dispose();assert.equal(stopped,1);
  const absent=fixture({mode:'watch'});assert.equal(absent.runner.sources()[0].mode,'unavailable');await assert.rejects(absent.runner.start('source',context()),{code:'UNSUPPORTED_CAPABILITY'});
  const manual=fixture({mode:'manual-only',kind:'research'});assert.equal(manual.runner.sources()[0].mode,'manual-only');await assert.rejects(manual.runner.start('source',context()),{code:'UNSUPPORTED_CAPABILITY'});
});

test('expired cursor stays blocked until explicit source reconciliation reset; wake is a scheduler suggestion only',async()=>{
  let expired=true;const f=fixture({read:async()=>{if(expired)throw new ProtocolError('CURSOR_EXPIRED','fixture epoch');return {items:[item()],nextCursor:'new:1',hasMore:false};},
    reconcile:async()=>({state:'verified',evidenceRefs:['fixture-epoch-readback'],resetCursor:true})});
  await f.runner.start('source',context());await f.runner.tick('source',{...context(),limit:1});expired=false;
  const blocked=await f.runner.tick('source',{...context(),limit:1});assert.equal(blocked.state,'cursor_expired');assert.equal(blocked.errorCode,'CURSOR_EXPIRED');
  await f.runner.recover('source','cursor_expired',context());assert.equal((await f.runner.tick('source',{...context(),limit:1})).state,'changed');
  const suggestion=await f.runner.planWake('source',new Date(Date.now()+1000).toISOString());assert.equal(suggestion.missedRunPolicy,'run_once');assert.equal(f.reads(),2);
  await f.runner.dispose();
});

test('existing public MailConnector fetchChanges integrates with explicit Fake provider, pagination and epoch readback',async()=>{
  const state=ports(),provider=new FakeMailProvider();const connector=new MailConnector(new MailService(provider,{now:Date.now}));
  const host=new ConnectorHost({read:()=>undefined});host.register({manifest:connector.manifest,create:()=>connector},
    {proactive:[{sourceId:'mail-primary',accountRef:'primary',kind:'mail',mode:'poll-only',configurationRevision:'mail-config-v1'}]});
  const runner=createProactiveConnectorHost({host,...state,authorize:()=>true});await runner.start('mail-primary',context());
  const first=await runner.tick('mail-primary',{...context(),limit:3}),second=await runner.tick('mail-primary',{...context(),limit:3});
  assert.equal(first.hasMore,true);assert.equal(second.state,'changed');assert.equal([...state.batches.values()].flatMap(batch=>batch.events).length,6);
  assert.ok([...state.batches.values()].flatMap(batch=>batch.events).every(event=>event.item.sensitivity==='private'));
  provider.rotateUidValidity();assert.equal((await runner.tick('mail-primary',{...context(),limit:3})).state,'cursor_expired');await runner.dispose();
});

test('cursor CAS failure after durable event commit restores pending without refetch or event loss',async()=>{
  const f=fixture();const original=f.options.checkpoints.compareAndSet;let denyCommit=true;
  f.options.checkpoints.compareAndSet=(id,revision,next)=>{
    if(denyCommit&&next.state==='changed'&&!next.pending){denyCommit=false;return false;}return original(id,revision,next);
  };
  await f.runner.start('source',context());const result=await f.runner.tick('source',{...context(),limit:1});
  assert.equal(result.state,'reconciliation_required');assert.equal(f.states.get('source').cursor,undefined);
  const batch=f.states.get('source').pending;assert.ok(f.batches.has(batch.batchId));
  const restored=await f.runner.tick('source',{...context(),limit:1});assert.equal(restored.recoveredPending,true);
  assert.equal(f.reads(),1);assert.equal(f.batches.size,1);assert.equal(f.states.get('source').cursor,'1');await f.runner.dispose();
});

test('lease revoked after pending persistence keeps original cursor, dispose blocks late read from publishing',async()=>{
  const f=fixture();let allowed=true;
  f.options.authorize=()=>allowed;
  // Recreate to capture the changed trusted callback; no additional connector registration.
  const runner=createProactiveConnectorHost(f.options);await runner.start('source',context());
  const save=f.options.checkpoints.compareAndSet;
  f.options.checkpoints.compareAndSet=(id,revision,next)=>{const result=save(id,revision,next);if(next.pending)allowed=false;return result;};
  assert.equal((await runner.tick('source',{...context(),limit:1})).state,'authorization_expired');
  assert.equal(f.states.get('source').cursor,undefined);assert.ok(f.states.get('source').pending);assert.equal(f.batches.size,0);await runner.dispose();
  let release,entered;const started=new Promise(resolve=>entered=resolve),waiting=new Promise(resolve=>release=resolve);
  const delayed=fixture({read:async()=>{entered();await waiting;return {items:[item()],nextCursor:'1',hasMore:false};}});
  await delayed.runner.start('source',context());const ongoing=delayed.runner.tick('source',{...context(),limit:1});await started;
  await delayed.runner.dispose();release();assert.equal((await ongoing).state,'cancelled');assert.equal(delayed.batches.size,0);assert.equal(delayed.states.get('source').cursor,undefined);
});
