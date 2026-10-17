import test from 'node:test';
import assert from 'node:assert/strict';
import {createProactiveCheckpointAdapter} from '../src/application/proactive-connector-host.ts';
import {createRuntimeProactiveConnectorHost} from '../dist/application/proactive-connector-host.js';
import {TaskRuntime,createRuntimeAtomicStatePort} from '../dist/index.js';
import {ConnectorHost} from '@personal-agent/connector-host';
import {ProtocolError} from '@personal-agent/contracts';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';

test('proactive checkpoint projection has one atomic revision envelope, rejects stale or mismatched revisions',()=>{
  const data=new Map();const atomic={read:key=>data.get(key),compareAndSet:(key,revision,value)=>{
    if(data.get(key)?.revision!==revision)return false;
    data.set(key,{revision:(revision??0)+1,value:structuredClone(value)});return true;
  }};
  const adapter=createProactiveCheckpointAdapter(atomic);
  const first={version:1,sourceId:'fixture',bindingDigest:'fixture',revision:1,seen:{},state:'active',updatedAt:new Date().toISOString()};
  assert.equal(adapter.read('fixture'),undefined);assert.equal(adapter.compareAndSet('fixture',undefined,first),true);
  assert.deepEqual(adapter.read('fixture'),first);assert.equal(adapter.compareAndSet('fixture',undefined,first),false);
  const next={...first,revision:2,cursor:'confirmed-source-cursor'};assert.equal(adapter.compareAndSet('fixture',1,next),true);
  assert.equal(adapter.read('fixture').revision,2);assert.equal([...data.values()][0].revision,2);
  assert.throws(()=>adapter.compareAndSet('fixture',2,{...next,revision:4}),{code:'REVISION_CONFLICT'});
  [...data.values()][0].revision=3;
  assert.throws(()=>adapter.read('fixture'),{code:'REVISION_CONFLICT'});
});

test('multiple sources persist independently in actual SQLite when one disconnects; changed peer cursor survives restart',async()=>{
  await mkdir(join(process.cwd(),'.cache'),{recursive:true});const path=join(await mkdtemp(join(process.cwd(),'.cache','multi-source-')),'runtime.sqlite');
  let runtime=new TaskRuntime(path),offline=false,revision=1;
  const anchor=runtime.submitTask({goal:'Multiple source fixture',conversationId:'multiple-sources',idempotencyKey:'anchor'}),host=new ConnectorHost({read:()=>undefined});
  for(const id of ['mail','ci']){
    const manifest={id,version:'1.0.0',accountTypes:['fixture'],capabilities:['fetchChanges'],configSchema:{type:'object'},authentication:'none',requiresPresence:false,syncStrategy:'incremental',verification:'mock'};
    host.register({manifest,create:()=>({manifest,connect:()=>({sessionRef:'fixture-'+id,interactionRequired:false}),disconnect:()=>({disconnected:true,cleanupState:'complete'}),
      health:()=>({state:'ready'}),getCapabilities:()=>manifest.capabilities,fetchChanges:async()=>{
        if(id==='mail'&&offline)throw new ProtocolError('EXTERNAL_FAILURE','Explicit fixture source offline');
        return {items:[{source:id,accountRef:id,externalId:'same-item',dedupeKey:id+'-item',occurredAt:'2026-10-15T00:00:00.000Z',
          fetchedAt:'2026-10-15T00:00:00.000Z',contentRef:'fixture:'+id+':'+revision,sensitivity:'private'}],nextCursor:String(revision),hasMore:false};
      },search:()=>[],getItem:()=>{throw Error('unused');},performAction:()=>{throw Error('No account writes');}})},
      {proactive:[{sourceId:id,accountRef:id,kind:id==='mail'?'mail':'ci',mode:'poll-only',configurationRevision:'one'}]});
  }
  const context={signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()};
  const make=()=>createRuntimeProactiveConnectorHost({host,atomicState:createRuntimeAtomicStatePort(runtime,'multi-source-fixture'),authorize:async()=>true,
    events:{persist:async batch=>{const key='source-batch:'+batch.batchId,prior=runtime.loadCheckpoint(anchor.taskId,key);
      if(prior)assert.deepEqual(prior,batch);else runtime.saveCheckpointOnce(anchor.taskId,key,batch);return {batchId:batch.batchId,durable:true};}}});
  let runner=make();
  try{
    await runner.start('mail',context);await runner.start('ci',context);
    assert.deepEqual((await runner.tickMany([{sourceId:'mail',limit:1},{sourceId:'ci',limit:1}],context)).map(v=>v.state),['changed','changed']);
    offline=true;revision=2;
    const outcomes=await runner.tickMany([{sourceId:'mail',limit:1},{sourceId:'ci',limit:1}],context);
    assert.equal(outcomes[0].state,'offline');assert.equal(outcomes[1].state,'changed');
    assert.equal((await runner.status('mail')).checkpoint.cursor,'1');assert.equal((await runner.status('ci')).checkpoint.cursor,'2');
    await runner.dispose();runtime.close();runtime=new TaskRuntime(path);runner=make();
    assert.equal((await runner.status('ci')).checkpoint.cursor,'2');assert.equal((await runner.status('mail')).checkpoint.cursor,'1');
    assert.equal((await runner.tick('ci',{...context,limit:1})).state,'no_changes');
  }finally{await runner.dispose();runtime.close();}
});
