import assert from 'node:assert/strict';
import test from 'node:test';
import {createKnowledgeWriteProjection} from '../dist/application/knowledge-write-projection.js';

const scope = () => ({signal:new AbortController().signal, deadline:new Date(Date.now()+60000).toISOString()});
const input = {sourceId:'synthetic',configRevision:1,path:'one.md',expectedSha256:'a'.repeat(64),edits:[]};
const context = runId => ({...scope(),taskId:'task',runId,argumentsDigest:'b'.repeat(64)});
const receipt = {state:'verified',changed:true,operationId:'c'.repeat(64)};
function fixture(revalidate) {
  const checkpoints = new Map(); let available=true, token='synthetic:1', calls=0, fail=true, hook=async()=>{};
  const runtime = {loadCheckpoint:(task,key)=>checkpoints.get(task+key),
    saveCheckpoint:(task,key,value)=>checkpoints.set(task+key,structuredClone(value))};
  const open = () => createKnowledgeWriteProjection({revalidate:async()=>{
    calls++; await hook(); if(fail)throw Error('synthetic projection failure');return revalidate?.();
  }},()=>({runtime}),(input,signal)=>{
    if(!available)throw Error('revoked');
    return {signal,assertCurrent(){if(!available)throw Error('revoked');},release(){}};
  },()=>token);
  return {open,runtime,checkpoints,calls:()=>calls,fail:value=>{fail=value;},
    revoke:()=>{available=false;},change:()=>{token='synthetic:2';},hook:value=>{hook=value;}};
}

test('known write with failed projection survives restart; recovery deduplicates and never accepts an unknown write',async()=>{
  const f=fixture(), first=f.open();
  first.prepare(input,context('run-one')); first.accept('task','run-one','b'.repeat(64),receipt);
  first.prepare({...input,path:'two.md'},context('run-two'));
  assert.deepEqual(await first.recover('task',scope()),{pending:1,unknown:1});
  assert.equal(f.calls(),1);
  const reopened=f.open(); f.fail(false);
  assert.deepEqual(await reopened.recover('task',scope()),{pending:0,unknown:1});
  assert.deepEqual(await reopened.recover('task',scope()),{pending:0,unknown:1});
  assert.equal(f.calls(),2);
  assert.throws(()=>reopened.prepare(input,context('run-one')),{code:'RESULT_UNKNOWN'});
  reopened.accept('task','run-two','b'.repeat(64),{...receipt,state:'conflict',changed:false});
  assert.deepEqual(await reopened.recover('task',scope()),{pending:0,unknown:0});
  assert.equal(f.calls(),2);
});

test('revocation, source replacement, cancellation and expiry leave pending projection without dispatch',async()=>{
  for(const kind of ['revoked','changed','cancelled','expired']) {
    const f=fixture(), host=f.open(); f.fail(false);
    host.prepare(input,context('run')); host.accept('task','run','b'.repeat(64),receipt);
    const request=scope();
    if(kind==='revoked')f.revoke();
    if(kind==='changed')f.change();
    if(kind==='cancelled')request.signal=AbortSignal.abort();
    if(kind==='expired')request.deadline='2000-01-01T00:00:00.000Z';
    assert.deepEqual(await host.recover('task',request),{pending:1,unknown:0});
    assert.equal(f.calls(),0,kind);
  }
});

test('concurrent recovery shares one projection; revocation during read cannot acknowledge completion',async()=>{
  const f=fixture(), host=f.open(); f.fail(false);
  host.prepare(input,context('run')); host.accept('task','run','b'.repeat(64),receipt);
  let release; f.hook(()=>new Promise(resolve=>{release=resolve;}));
  const first=host.recover('task',scope()), second=host.recover('task',scope());
  assert.equal(first,second); assert.equal(f.calls(),1);
  f.revoke(); release(); assert.deepEqual(await first,{pending:1,unknown:0});
});

test('substituted execution cannot acknowledge pending work; readback of old tasks is compatible',()=>{
  const f=fixture(), host=f.open();
  host.accept('old-task','old-run','d'.repeat(64),receipt);
  host.prepare(input,context('run'));
  assert.throws(()=>host.accept('task','run','d'.repeat(64),receipt),{code:'SCOPE_DENIED'});
  f.change();assert.throws(()=>host.accept('task','run','b'.repeat(64),receipt),{code:'SCOPE_DENIED'});
});

test('original write acceptance survives configuration change without granting a new projection read',async()=>{
  const f=fixture(),host=f.open();f.fail(false);host.prepare(input,context('run'));f.change();
  host.accept('task','run','b'.repeat(64),receipt,input);
  assert.deepEqual(await host.recover('task',scope()),{pending:1,unknown:0});assert.equal(f.calls(),0);
});

test('original write acceptance rejects changed digest, source, revision or path',async()=>{
  const f=fixture(),host=f.open();host.prepare(input,context('run'));f.change();
  for(const patch of [{sourceId:'other'},{configRevision:2},{path:'two.md'}]) {
    assert.throws(()=>host.accept('task','run','b'.repeat(64),receipt,{...input,...patch}),{code:'SCOPE_DENIED'});
  }
  assert.throws(()=>host.accept('task','run','d'.repeat(64),receipt,input),{code:'SCOPE_DENIED'});
  assert.deepEqual(await host.recover('task',scope()),{pending:0,unknown:1});assert.equal(f.calls(),0);
});

test('original verified write persists exact observed Fact versions; legacy void providers make no Fact claim',async()=>{
  const proof={version:1,sourceId:input.sourceId,configRevision:input.configRevision,path:input.path,sourceRevision:'d'.repeat(64),
    memoryNamespace:'synthetic-memory',coverage:'observed_active_heads',facts:[{previous:{id:'fact',revision:1},current:{id:'fact',revision:2},
      sourceDigest:'e'.repeat(64),sourceRevision:input.expectedSha256,state:'withdrawn',appended:true}]};
  const f=fixture(()=>structuredClone(proof)),host=f.open();f.fail(false);
  host.prepare(input,context('run'));host.accept('task','run','b'.repeat(64),{...receipt,afterSha256:proof.sourceRevision});
  assert.throws(()=>host.accept('task','run','b'.repeat(64),{...receipt,afterSha256:'f'.repeat(64)}),{code:'SCOPE_DENIED'});
  assert.throws(()=>host.accept('task','run','b'.repeat(64),{...receipt,operationId:'f'.repeat(64)}),{code:'SCOPE_DENIED'});
  assert.deepEqual(await host.recover('task',scope()),{pending:0,unknown:0});
  const saved=f.runtime.loadCheckpoint('task','knowledge-write-projections-v1')[0];
  assert.deepEqual(saved.factReadback,proof);assert.equal(saved.beforeSha256,input.expectedSha256);assert.equal(saved.operationId,receipt.operationId);
  assert.deepEqual(await f.open().recover('task',scope()),{pending:0,unknown:0});assert.equal(f.calls(),1);
  proof.facts[0].current.revision=999;assert.equal(saved.factReadback.facts[0].current.revision,2);
  const legacy=fixture(),old=legacy.open();legacy.fail(false);old.prepare(input,context('old'));
  old.accept('task','old','b'.repeat(64),receipt);await old.recover('task',scope());
  assert.equal(legacy.runtime.loadCheckpoint('task','knowledge-write-projections-v1')[0].factReadback,undefined);
});

test('Fact readback with replaced source, versions or duplicate facts never confirms a projection',async()=>{
  const proof={version:1,sourceId:input.sourceId,configRevision:input.configRevision,path:input.path,sourceRevision:'d'.repeat(64),
    memoryNamespace:'synthetic-memory',coverage:'observed_active_heads',facts:[{previous:{id:'fact',revision:1},current:{id:'fact',revision:2},
      sourceDigest:'e'.repeat(64),sourceRevision:input.expectedSha256,state:'withdrawn',appended:true}]};
  for(const substitute of [value=>value.sourceId='foreign',value=>value.configRevision++,value=>value.path='foreign.md',
    value=>value.sourceRevision='f'.repeat(64),value=>value.facts[0].current.id='foreign',value=>value.facts[0].current.revision++,
    value=>value.facts[0].appended=false,value=>value.facts.push(value.facts[0]),value=>value.untrusted='extra']) {
    const value=structuredClone(proof);substitute(value);const f=fixture(()=>value),host=f.open();f.fail(false);
    host.prepare(input,context('run'));host.accept('task','run','b'.repeat(64),{...receipt,afterSha256:proof.sourceRevision});
    assert.deepEqual(await host.recover('task',scope()),{pending:1,unknown:0});
    assert.equal(f.runtime.loadCheckpoint('task','knowledge-write-projections-v1')[0].factReadback,undefined);
  }
});
