import assert from 'node:assert/strict';
import test from 'node:test';
import {createRemoteReadonlyMcpHost,remoteMcpArgumentsDigest} from '../dist/index.js';
import {fixture,endpoint,descriptor} from './remote-http-fixture.mjs';

const future=()=>new Date(Date.now()+30000).toISOString();
const context=runId=>({taskId:'receipt-task',runId,authorizationRef:runId,signal:new AbortController().signal,deadline:future(),scopes:descriptor.requiredScopes});
const digest=remoteMcpArgumentsDigest({key:'public'});
const key=query=>JSON.stringify([query.taskId,query.runId]);
const options=(f,readRunReceipt)=>({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor},enabled:true,fetch:f.fetch,readRunReceipt});

test('terminal Runtime receipts retire bounded slots and remain authoritative after replacing a host',async()=>{
  const f=await fixture(),receipts=new Map();let host=createRemoteReadonlyMcpHost(options(f,query=>receipts.get(key(query))));
  try{
    await host.start({signal:new AbortController().signal,deadline:future()});
    for(let i=0;i<160;i++){
      const run=context('receipt-'+i),result=await host.tools[0].execute({key:'public'},run);
      receipts.set(key(run),{argumentsDigest:digest,state:'confirmed',result});
    }
    assert.equal(f.calls().length,160);
    const before=f.requests.length,result=await host.tools[0].execute({key:'public'},context('receipt-0'));
    result.text='caller mutation';
    assert.deepEqual(await host.tools[0].execute({key:'public'},context('receipt-0')),{text:'public synthetic reference'});
    await assert.rejects(host.tools[0].execute({key:'changed'},context('receipt-0')),{code:'REVISION_CONFLICT'});
    assert.equal(f.requests.length,before);
    await host.dispose();host=createRemoteReadonlyMcpHost(options(f,query=>receipts.get(key(query))));
    await host.start({signal:new AbortController().signal,deadline:future()});const restarted=f.requests.length;
    assert.deepEqual(await host.tools[0].execute({key:'public'},context('receipt-0')),{text:'public synthetic reference'});
    assert.equal(f.requests.length,restarted);assert.equal(f.calls().length,160);
  }finally{await host.dispose();await f.close();}
});

test('unknown receipts cannot be evicted or replayed; a persisted failed receipt alone frees its slot',async()=>{
  const f=await fixture({result:{content:[],isError:true}}),receipts=new Map();
  const host=createRemoteReadonlyMcpHost(options(f,query=>receipts.get(key(query))));
  try{
    await host.start({signal:new AbortController().signal,deadline:future()});
    for(let i=0;i<64;i++){
      const run=context('unknown-'+i);await assert.rejects(host.tools[0].execute({key:'public'},run));
      receipts.set(key(run),{argumentsDigest:digest,state:'unknown'});
    }
    const before=f.requests.length;
    await assert.rejects(host.tools[0].execute({key:'public'},context('new')),{code:'EXTERNAL_FAILURE'});
    await assert.rejects(host.tools[0].execute({key:'public'},context('unknown-0')),{code:'RESULT_UNKNOWN'});
    assert.equal(f.requests.length,before);
    receipts.set(key(context('unknown-0')),{argumentsDigest:digest,state:'failed'});delete f.mode.result;
    assert.deepEqual(await host.tools[0].execute({key:'public'},context('new')),{text:'public synthetic reference'});
    await assert.rejects(host.tools[0].execute({key:'public'},context('unknown-0')),{code:'EXTERNAL_FAILURE'});
    await assert.rejects(host.tools[0].execute({key:'public'},context('unknown-1')),{code:'RESULT_UNKNOWN'});
    assert.equal(f.calls().length,65);
  }finally{await host.dispose();await f.close();}
});
