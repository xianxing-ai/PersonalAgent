import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createRuntimeHarnessEvents} from '../dist/application/harness-events.js';

// Explicit in-memory original Runtime/host ports. No connector, cloud or user account.
function fixture() {
  const state = new Map(), tasks = new Map(), checkpoints = new Map(), entries = {}, listeners = new Set();
  const deadline = new Date(Date.now() + 5000).toISOString();
  const settings = {enabled:true, quiet:false, revision:'1'};
  let calls = 0, reads = 0, unknown = false, authorizations = 0;
  tasks.set('host', {taskId:'host', state:'running'});
  for (const id of ['a','b']) tasks.set(id, {taskId:id, state:'succeeded'});
  const event = (id, version = '1') => ({eventId:'event-'+id,entry:'connector',conversationId:'c-'+id,
    sourceId:'source-'+id,entityRef:'entity',sourceVersion:version,observedAt:new Date().toISOString(),change:'upsert',
    payloadRef:'ref-'+id,payloadDigest:'digest-'+version,anchorRefs:[],responsibilityRefs:['responsibility-'+id],
    goalRefs:[],contractRef:'contract',priority:'unknown',evidenceRefs:['confirmed-source-read']});
  const anchor = event => {
    const id = event.sourceId.slice(-1);
    return {sourceTaskId:id,parentTaskId:id,deadline,responsibility:{id:'responsibility-'+id,revision:1,
      conversationId:'c-'+id,sourceQuotes:[{conversationId:'c-'+id,messageId:id,quoteRef:'q',sha256:'sha'}],
      goalRefs:[],authority:'explicit_instruction',scopeRefs:['original-tracking-scope']}};
  };
  // The real composition binds one host to one conversation; this fixture uses one per test.
  let conversation = 'c-a';
  const resolve = id => id === 'host' ? conversation : id.includes('b') ? 'c-b' : 'c-a';
  const runtime = {bindTrustedHostState(namespace) {return {
    get:key=>structuredClone(state.get(namespace+key)),
    compareAndSet(key, old, value) {const k=namespace+key;if(!isDeepStrictEqual(state.get(k),old))return false;
      state.set(k,structuredClone(value));return true;},
  };},getTask:id=>{assert.ok(tasks.has(id));return tasks.get(id);},loadCheckpoint:(id,key)=>checkpoints.get(id+key)};
  function receipt(input) {
    const parentTaskId='next-'+input.anchor.parentTaskId, taskId='child-'+input.anchor.parentTaskId;
    tasks.set(parentTaskId,{taskId:parentTaskId,state:'running'});
    tasks.set(taskId,{taskId,state:'running'});
    checkpoints.set(parentTaskId+'harness-event-origin',{deliveryId:input.deliveryId,eventDigest:input.eventDigest,
      sourceTaskId:input.anchor.sourceTaskId,originalParentTaskId:input.anchor.parentTaskId});
    checkpoints.set(taskId+'subtask-parent',{parentTaskId});
    return {deliveryId:input.deliveryId,eventDigest:input.eventDigest,parentTaskId,taskId,receiptRef:'original-runtime-receipt'};
  }
  const options = {runtime, host:{taskId:'host',sessionId:'s',binding:{taskDeadline:deadline},
    inspect:()=>({application:{state:{entries,schedules:{}}}}),subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}},
    resolveAnchor:anchor,resolveUserConversation:resolve,readControl:()=>({...settings}),
    assertCurrentAuthorization:()=>{authorizations++;},delivery:{
      consume:async input=>{calls++;if(unknown)throw Error('PRIVATE UNKNOWN');return receipt(input);},
      readReceipt:async input=>{reads++;return unknown?undefined:receipt(input);},
    }};
  return {options,event,entries,state,settings,tasks,checkpoints,setUnknown:v=>{unknown=v;},
    setConversation:v=>{conversation=v;},counts:()=>({calls,reads,authorizations})};
}

test('durable source delivery uses original child and a new controller round without reopening terminal parent',async()=>{
  const f=fixture();f.entries.first={event:f.event('a')};
  const consumer=createRuntimeHarnessEvents(f.options);await consumer.start();await consumer.flush();await consumer.stop();
  assert.equal(f.counts().calls,1);assert.equal(f.tasks.get('a').state,'succeeded');
  assert.equal([...f.state.values()].filter(v=>v.value?.state==='confirmed').length,1);
  const reopened=createRuntimeHarnessEvents(f.options);await reopened.start();await reopened.stop();
  assert.equal(f.counts().calls,1);
});

test('unknown delivery is only read back after reopen, never dispatched again',async()=>{
  const f=fixture();f.entries.first={event:f.event('a')};f.setUnknown(true);
  const first=createRuntimeHarnessEvents(f.options);await first.start();await first.stop();
  assert.equal(first.inspect().lastError,'RESULT_UNKNOWN');
  f.setUnknown(false);const second=createRuntimeHarnessEvents(f.options);await second.start();await second.stop();
  assert.equal(f.counts().calls,1);assert.equal(f.counts().reads,1);
  assert.equal([...f.state.values()].filter(v=>v.value?.state==='confirmed').length,1);
});

test('quiet events are durably suppressed and do not replay after controls change',async()=>{
  const f=fixture();f.entries.first={event:f.event('a')};f.settings.quiet=true;
  const consumer=createRuntimeHarnessEvents(f.options);await consumer.start();
  f.settings.quiet=false;f.settings.revision='2';await consumer.flush();await consumer.stop();
  assert.equal(f.counts().calls,0);
  assert.equal([...f.state.values()].filter(v=>v.value?.state==='suppressed').length,1);
});

test('payload drift and revoked authorization fail closed without creating another dispatch',async()=>{
  const f=fixture();f.entries.first={event:f.event('a')};const consumer=createRuntimeHarnessEvents(f.options);
  await consumer.start();f.entries.first.event.payloadDigest='replaced';await consumer.flush();await consumer.stop();
  assert.equal(consumer.inspect().lastError,'REVISION_CONFLICT');assert.equal(f.counts().calls,1);
  const other=fixture();other.entries.first={event:other.event('a')};
  other.options.assertCurrentAuthorization=()=>{throw Error('PRIVATE revoked');};
  const denied=createRuntimeHarnessEvents(other.options);await denied.start();await denied.stop();
  assert.equal(other.counts().calls,0);assert.doesNotMatch(JSON.stringify(denied.inspect()),/PRIVATE/);
});

test('suppression and rejected entries persist without blocking later authorized events or replaying unknown writes',async()=>{
  const f=fixture();let denied=true;const original=f.options.resolveAnchor;
  f.entries.quiet={event:f.event('a','quiet')};f.settings.quiet=true;
  f.options.resolveAnchor=()=>{throw Error('PRIVATE expired grant');};
  const consumer=createRuntimeHarnessEvents(f.options);await consumer.start();
  assert.equal(f.counts().calls,0);
  assert.equal([...f.state.values()].filter(v=>v.value?.reason==='quiet').length,1);
  f.settings.quiet=false;f.settings.revision='2';
  f.entries.denied={event:f.event('a','denied')};
  f.entries.malformed={event:{...f.event('a','malformed'),evidenceRefs:[]}};
  f.options.resolveAnchor=event=>{if(event.sourceVersion==='denied'&&denied)throw Error('PRIVATE revoked');return original(event);};
  f.entries.good={event:f.event('a','good')};await consumer.flush();
  assert.equal(f.counts().calls,1);
  assert.equal([...f.state.values()].filter(v=>v.value?.reason==='authorization_denied').length,1);
  assert.equal([...f.state.values()].filter(v=>v.value?.state==='rejected').length,1);
  denied=false;await consumer.flush();assert.equal(f.counts().calls,1);
  f.setUnknown(true);f.entries.unknown={event:f.event('a','unknown')};await consumer.flush();
  const pending=[...f.state.values()].map(v=>v.value).find(v=>v?.state==='pending');assert.ok(pending);
  const origin={deliveryId:pending.deliveryId,eventDigest:pending.eventDigest,
    sourceTaskId:pending.anchor.sourceTaskId,originalParentTaskId:pending.anchor.parentTaskId};
  const before=f.counts().calls,readback=consumer.readOriginalDelivery(origin);assert.equal(readback.ledgerState,'pending');
  readback.assertCurrent();assert.equal(f.counts().calls,before);
  f.settings.quiet=true;f.settings.revision='3';assert.throws(()=>readback.assertCurrent());
  await consumer.flush();assert.equal(f.counts().calls,before);
  assert.equal([...f.state.values()].filter(v=>v.value?.state==='pending').length,1);
  await consumer.stop();assert.doesNotMatch(JSON.stringify(consumer.inspect()),/PRIVATE/);
});

test('restart overlapping stop scans new entries without resending the unknown delivery',async()=>{
  const f=fixture();f.entries.first={event:f.event('a')};
  let entered;
  const reached=new Promise(resolve=>{entered=resolve;});
  const consume=f.options.delivery.consume;
  f.options.delivery.consume=async input=>{
    await consume(input);
    entered();
    // Simulate an uncooperative delivery with a lost acknowledgement. Stop must
    // release its bounded wait without waiting for this operation to settle.
    return new Promise(()=>{});
  };
  const consumer=createRuntimeHarnessEvents(f.options);
  const started=consumer.start();await reached;
  const stopping=consumer.stop();
  f.entries.second={event:f.event('a','2')};
  f.options.delivery.consume=consume;
  const restarted=consumer.start();
  await Promise.all([started,stopping,restarted]);
  assert.equal(consumer.inspect().running,true);
  assert.equal(consumer.inspect().active,false);
  assert.equal(f.counts().calls,2);
  assert.equal(f.counts().reads,1);
  assert.equal([...f.state.values()].filter(v=>v.value?.state==='confirmed').length,2);
  await consumer.stop();
});
