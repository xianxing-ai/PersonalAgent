import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TaskRuntime} from '../dist/index.js';

function fixture(t,disk=false) {
  const base=fileURLToPath(new URL('../../../.cache/competition-export-read/',import.meta.url));
  mkdirSync(base,{recursive:true});
  const directory=disk?mkdtempSync(path.join(base,'case-')):undefined;
  const database=directory?path.join(directory,'runtime.sqlite'):':memory:';
  const runtime=new TaskRuntime(database);
  const task=runtime.submitTask({goal:'Explicit synthetic export snapshot',conversationId:'snapshot-fixture',idempotencyKey:'snapshot'});
  let closed=false;
  const close=()=>{if(!closed){closed=true;runtime.close();}};
  t.after(()=>{close();if(directory)rmSync(directory,{recursive:true,force:true});});
  return {runtime,taskId:task.taskId,database,close};
}

test('an export read shares deeply immutable JSON only inside its original synchronous Runtime scope',t=>{
  const {runtime,taskId}=fixture(t),original={step:4,receipts:[{continuation:{result:{value:'original'}}}]};
  runtime.saveCheckpoint(taskId,'competition-loop',original);
  let expired,observed;
  runtime.withCompetitionLoopRead(taskId,scope=>{
    expired=scope;observed=runtime.readCompetitionLoopForExport(taskId,scope);
    for(let index=0;index<66;index++)assert.equal(runtime.readCompetitionLoopForExport(taskId,scope),observed);
    assert.throws(()=>{observed.receipts[0].continuation.result.value='tampered';},TypeError);
    const ordinary=runtime.loadCheckpoint(taskId,'competition-loop');ordinary.receipts.length=0;
    assert.equal(observed.receipts.length,1,'Normal callers retain their independent mutable copy');
  });
  assert.throws(()=>runtime.readCompetitionLoopForExport(taskId,expired),{code:'UNAUTHORIZED'});
  runtime.saveCheckpoint(taskId,'competition-loop',{...original,step:5});
  runtime.withCompetitionLoopRead(taskId,scope=>assert.equal(runtime.readCompetitionLoopForExport(taskId,scope).step,5));
});

test('same-Runtime receipt writes are refused on the next read and at final export return',t=>{
  const {runtime,taskId}=fixture(t);
  for(const finalOnly of [false,true]) {
    runtime.saveCheckpoint(taskId,'competition-loop',{receipts:[],value:'before'});
    assert.throws(()=>runtime.withCompetitionLoopRead(taskId,scope=>{
      runtime.readCompetitionLoopForExport(taskId,scope);
      runtime.saveCheckpoint(taskId,'competition-loop',{receipts:[],value:'after!'});
      if(!finalOnly)runtime.readCompetitionLoopForExport(taskId,scope);
    }),{code:'REVISION_CONFLICT'});
  }
});

test('missing checkpoints and JSON null remain distinct through atomic create-only writes',t=>{
  const {runtime,taskId}=fixture(t);
  assert.throws(()=>runtime.withCompetitionLoopRead(taskId,scope=>{
    assert.equal(runtime.readCompetitionLoopForExport(taskId,scope),undefined);
    assert.equal(runtime.saveCheckpointOnce(taskId,'competition-loop',null),true);
  }),{code:'REVISION_CONFLICT'});
  runtime.withCompetitionLoopRead(taskId,scope=>assert.equal(runtime.readCompetitionLoopForExport(taskId,scope),null));
});

test('another SQLite connection changing exact receipt bytes invalidates the original scope',t=>{
  const {runtime,taskId,database}=fixture(t,true);
  runtime.saveCheckpoint(taskId,'competition-loop',{receipts:[],step:2});
  const other=new DatabaseSync(database);
  try {
    assert.throws(()=>runtime.withCompetitionLoopRead(taskId,scope=>{
      runtime.readCompetitionLoopForExport(taskId,scope);
      // Even a semantically equal rewrite is detected; updated_at is deliberately unchanged.
      other.prepare("UPDATE task_checkpoints SET value_json = ? WHERE task_id = ? AND checkpoint_key = 'competition-loop'")
        .run('{"receipts":[], "step":2}',taskId);
    }),{code:'REVISION_CONFLICT'});
  }finally{other.close();}
});

test('unrelated host lease changes are fresh and do not invalidate unchanged receipt bytes',t=>{
  const {runtime,taskId}=fixture(t);
  runtime.saveCheckpoint(taskId,'competition-loop',{receipts:[]});
  runtime.withCompetitionLoopRead(taskId,scope=>{
    const original=runtime.readCompetitionLoopForExport(taskId,scope);
    for(const revision of [1,2]) {
      runtime.saveCheckpoint(taskId,'synthetic-host-lease',{revision});
      assert.equal(runtime.loadCheckpoint(taskId,'synthetic-host-lease').revision,revision);
      assert.equal(runtime.readCompetitionLoopForExport(taskId,scope),original);
    }
  });
});

test('forged, cross-task, cross-Runtime and closed-Runtime read scopes cannot be used',t=>{
  const {runtime,taskId,close}=fixture(t),foreign=new TaskRuntime(':memory:');
  try {
    assert.throws(()=>runtime.readCompetitionLoopForExport(taskId,{}),{code:'UNAUTHORIZED'});
    runtime.withCompetitionLoopRead(taskId,scope=>{
      assert.throws(()=>runtime.readCompetitionLoopForExport('other-task',scope),{code:'UNAUTHORIZED'});
      assert.throws(()=>foreign.readCompetitionLoopForExport(taskId,scope),{code:'UNAUTHORIZED'});
    });
    assert.throws(()=>runtime.withCompetitionLoopRead(taskId,scope=>{
      runtime.readCompetitionLoopForExport(taskId,scope);close();
    }),{code:'UNAUTHORIZED'});
  }finally{foreign.close();}
});

test('a Promise callback is rejected and cannot retain an active scope after an await',async t=>{
  const {runtime,taskId}=fixture(t);let later;
  assert.throws(()=>runtime.withCompetitionLoopRead(taskId,scope=>{
    runtime.readCompetitionLoopForExport(taskId,scope);
    later=Promise.resolve().then(()=>assert.throws(()=>runtime.readCompetitionLoopForExport(taskId,scope),{code:'UNAUTHORIZED'}));
    return later;
  }),{code:'INVALID_ARGUMENT'});
  await later;
});

test('a caught initial decode failure or byte-change refusal cannot make the enclosing export succeed',t=>{
  const {runtime,taskId}=fixture(t),originalParse=JSON.parse;
  runtime.saveCheckpoint(taskId,'competition-loop',{receipts:[],marker:'explicit-synthetic-decode-fault'});
  JSON.parse=function(raw,...args){
    if(typeof raw==='string'&&raw.includes('explicit-synthetic-decode-fault'))throw new SyntaxError('Explicit synthetic decode refusal');
    return originalParse.call(this,raw,...args);
  };
  try {
    assert.throws(()=>runtime.withCompetitionLoopRead(taskId,scope=>{
      assert.throws(()=>runtime.readCompetitionLoopForExport(taskId,scope),SyntaxError);
      assert.throws(()=>runtime.readCompetitionLoopForExport(taskId,scope),{code:'UNAUTHORIZED'});
    }),{code:'UNAUTHORIZED'});
  }finally{JSON.parse=originalParse;}
  assert.throws(()=>runtime.withCompetitionLoopRead(taskId,scope=>{
    runtime.readCompetitionLoopForExport(taskId,scope);
    runtime.saveCheckpoint(taskId,'competition-loop',{receipts:[],marker:'changed'});
    assert.throws(()=>runtime.readCompetitionLoopForExport(taskId,scope),{code:'REVISION_CONFLICT'});
  }),{code:'UNAUTHORIZED'});
});
