import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCodingRepairInput,parseCodingRepairSnapshot,parseCodingRepairPatch,parseCodingRepairVerificationReceipt,
  parseCodingRepairPublishReadback} from '../dist/coding-repair.js';
const files=[{path:'src/main.ts',sha256:'a'.repeat(64),packageId:'@pa/app',kind:'source',content:'public fixture'}];
const snapshot={snapshotId:'snapshot-0',files,packages:[{id:'@pa/app',path:'',dependencies:[]}]};
const session={version:1,sessionId:'coding-session',taskId:'coding-task',workspaceId:'workspace',mode:'main',baselineSnapshotId:'snapshot-0'};
test('coding v1 parses isolated binding, source/config hashes and mandatory recipes without changing Core wire',()=>{
  const value={version:1,session,initialSnapshot:snapshot,recipes:[{recipeId:'test',packageIds:['@pa/app'],required:true}]};
  assert.deepEqual(parseCodingRepairInput(value),value);
  assert.throws(()=>parseCodingRepairInput({...value,session:{...session,baselineSnapshotId:'substituted'}}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>parseCodingRepairInput({...value,authority:'allow'}),{code:'INVALID_ARGUMENT'});
});
test('snapshots reject traversal, duplicate files, missing dependency packages and cyclic package DAGs',()=>{
  for(const path of ['../private','/root','C:/root','a\\b','a//b','./file'])assert.throws(()=>parseCodingRepairSnapshot({...snapshot,files:[{...files[0],path}]}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>parseCodingRepairSnapshot({...snapshot,files:[...files,...files]}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>parseCodingRepairSnapshot({...snapshot,packages:[{...snapshot.packages[0],dependencies:['missing']}]}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>parseCodingRepairSnapshot({...snapshot,packages:[{id:'@pa/app',path:'',dependencies:['b']},{id:'b',path:'b',dependencies:['@pa/app']}]}),{code:'INVALID_ARGUMENT'});
});
test('exact patches distinguish existing SHA CAS from absent-file creation and permit whitespace edits',()=>{
  const patch={path:'src/main.ts',expectedSha256:'a'.repeat(64),edits:[{oldText:'  ',newText:'    '}]};
  assert.deepEqual(parseCodingRepairPatch(patch),patch);
  assert.deepEqual(parseCodingRepairPatch({path:'new.ts',expectedSha256:null,edits:[],createText:''}),{path:'new.ts',expectedSha256:null,edits:[],createText:''});
  for(const invalid of [{...patch,edits:[]},{...patch,createText:'overwrite'},{...patch,expectedSha256:null},{...patch,edits:[{oldText:'',newText:'x'}]}])
    assert.throws(()=>parseCodingRepairPatch(invalid),{code:'INVALID_ARGUMENT'});
});
test('verification status cannot turn a failed or unknown exit into VALID',()=>{
  const r={version:1,sessionId:'coding-session',runId:'run',recipeId:'test',packageIds:['@pa/app'],inputSnapshotId:'snapshot-0',files,exitCode:0,status:'VALID',evidenceRefs:['real-run'],diagnostics:[]};
  assert.deepEqual(parseCodingRepairVerificationReceipt(r),r);
  for(const invalid of [{...r,exitCode:1},{...r,exitCode:null},{...r,status:'FAILED'}])assert.throws(()=>parseCodingRepairVerificationReceipt(invalid),{code:'INVALID_ARGUMENT'});
  assert.equal(parseCodingRepairVerificationReceipt({...r,exitCode:null,status:'UNKNOWN'}).status,'UNKNOWN');
  assert.equal(parseCodingRepairPublishReadback({version:1,sessionId:'coding-session',state:'unknown',files:[],evidenceRefs:[]}).state,'unknown');
});
