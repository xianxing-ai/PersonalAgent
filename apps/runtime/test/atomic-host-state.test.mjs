import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {TaskRuntime,createRuntimeAtomicStatePort} from '../dist/index.js';
mkdirSync(join(process.cwd(),'.cache'),{recursive:true});
test('Runtime atomic state shares existing SQLite, preserves legacy values and survives restart',()=>{
 const path=join(mkdtempSync(join(process.cwd(),'.cache','atomic-host-')),'runtime.sqlite');
 const first=new TaskRuntime(path),second=new TaskRuntime(path);
 try{
  first.bindTrustedHostState('fixture').set('notifications:state',{pending:[{id:'user-existing'}],batches:[],delivered:[]});
  const a=createRuntimeAtomicStatePort(first,'fixture'),b=createRuntimeAtomicStatePort(second,'fixture');
  assert.equal(a.read('notifications:state').revision,0);
  const original=a.read('notifications:state');
  assert.equal(a.compareAndSet('notifications:state',0,{...original.value,quota:1}),true);
  assert.equal(b.compareAndSet('notifications:state',0,{pending:[]}),false);
  assert.deepEqual(b.storage.get('notifications:state').pending,[{id:'user-existing'}]);
  assert.equal(a.compareAndSet('new',undefined,{cursor:'one'}),true);
  assert.equal(b.compareAndSet('new',undefined,{cursor:'two'}),false);
 }finally{first.close();second.close();}
 const resumed=new TaskRuntime(path);
 try{assert.equal(createRuntimeAtomicStatePort(resumed,'fixture').read('notifications:state').value.quota,1);}
 finally{resumed.close();}
});
test('raw SQLite CAS rejects an outdated complete value and invalid JSON, without losing prior state',()=>{
 const path=join(mkdtempSync(join(process.cwd(),'.cache','atomic-host-')),'runtime.sqlite'),runtime=new TaskRuntime(path);
 try{
  const state=runtime.bindTrustedHostState('fixture');
  assert.equal(state.compareAndSet('key',undefined,{a:1}),true);
  assert.equal(state.compareAndSet('key',undefined,{a:2}),false);
  assert.equal(state.compareAndSet('key',{a:1},{a:3}),true);
  assert.equal(state.compareAndSet('key',{a:1},{a:4}),false);
  assert.throws(()=>state.compareAndSet('key',{a:3},{secret:undefined}),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(state.get('key'),{a:3});
 }finally{runtime.close();}
});
