import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskRuntime} from '../dist/index.js';
import {Client, EventCursor} from '@personal-agent/client';
import {createRuntimeApplication} from '../dist/application.js';

function fixture(t) {
  let id=0;
  const runtime=new TaskRuntime(':memory:', {idFactory:()=>`batch-${++id}`});
  t.after(()=>runtime.close());
  return runtime;
}
const submit=(runtime,index)=>runtime.submitTask({goal:'Synthetic batch input',conversationId:'synthetic',idempotencyKey:`batch-${index}`});

test('bounded batches preserve the fixed watermark, order, cursor and later events', t=>{
  const runtime=fixture(t);
  for(let i=0;i<530;i++)submit(runtime,i);
  const expected=runtime.readEvents(0),cursor=new EventCursor('tasks'),received=[];
  let page=runtime.readEventBatch({limit:31});
  const throughSequence=page.throughSequence;
  submit(runtime,531);
  do {
    assert.ok(page.events.length<=31);
    received.push(...cursor.accept(page.events));
    assert.deepEqual(cursor.accept(page.events),[],'duplicate replay stays idempotent');
    if(!page.hasMore)break;
    page=runtime.readEventBatch({afterSequence:cursor.afterSequence,throughSequence,limit:31});
    assert.equal(page.throughSequence,throughSequence);
  } while(true);
  assert.deepEqual(received,expected);
  assert.equal(cursor.afterSequence,throughSequence);
  const next=runtime.readEventBatch({afterSequence:throughSequence});
  assert.ok(next.events.length>0);
  assert.equal(next.events[0].sequence,throughSequence+1);
});

test('subscribe validates the cursor without materializing events; malformed limits and watermarks reject', async t=>{
  const runtime=fixture(t);submit(runtime,1);
  const latest=runtime.readEventBatch().throughSequence;
  runtime.readEvents=()=>{throw Error('Subscribe must not read replay payloads');};
  const client=new Client(runtime);await client.connect();
  assert.equal((await client.call('event.subscribe',{streamId:'tasks',afterSequence:0})).replayFrom,1);
  await assert.rejects(client.call('event.subscribe',{streamId:'tasks',afterSequence:latest+1}),/cursor/i);
  for(const input of [{afterSequence:-1},{afterSequence:1.5},{afterSequence:latest+1},
    {limit:0},{limit:513},{limit:NaN},{throughSequence:latest+1},{afterSequence:latest,throughSequence:0}])
    assert.throws(()=>runtime.readEventBatch(input));
  assert.deepEqual(runtime.readEventBatch({afterSequence:latest}),{events:[],throughSequence:latest,hasMore:false});
});

test('batch reads use the same validated public events and do not hide gaps', t=>{
  const runtime=fixture(t),task=submit(runtime,1);
  runtime.requestCancel(task.taskId,'Synthetic cancellation');
  const full=runtime.readEvents(),batch=runtime.readEventBatch({limit:512}).events;
  assert.deepEqual(batch,full);
  assert.ok(batch.some(event=>event.type==='task.cancelled'||event.type==='task.state_changed'));
  const cursor=new EventCursor('tasks');
  assert.throws(()=>cursor.accept(batch.slice(1)),/gap/i);
  assert.equal(cursor.afterSequence,0,'a rejected gap never advances the accepted cursor');
});

test('the actual RuntimeApplication exposes the same bounded stream without starting a provider',()=>{
  const application=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'});
  try {
    for(let index=0;index<6;index++)submit(application.runtime,index);
    const expected=application.runtime.readEventBatch({limit:2});
    assert.deepEqual(application.readEventBatch({limit:2}),expected);
    assert.equal(expected.events.length,2);assert.equal(expected.hasMore,true);
  } finally {application.close();}
});
