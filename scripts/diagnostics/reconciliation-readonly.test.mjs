import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {collectReconciliationDiagnostic} from './reconciliation-readonly.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url)),cache=path.join(root,'.cache');mkdirSync(cache,{recursive:true});
const secret='PRIVATE_BODY_ACCOUNT_https://private.invalid/?token=TOP_SECRET';
const taskId='12345678-1234-4234-8234-123456789abc',requestId='22345678-1234-4234-8234-123456789abc';
function fixture(errorCode='RESULT_UNKNOWN',accepted=true){
  const directory=mkdtempSync(path.join(cache,'reconciliation-diagnostic-')),databasePath=path.join(directory,'synthetic.sqlite');
  const db=new DatabaseSync(databasePath);
  db.exec('CREATE TABLE tasks(task_id TEXT PRIMARY KEY,state TEXT,error_json TEXT,goal TEXT,result_summary TEXT); CREATE TABLE task_checkpoints(task_id TEXT,checkpoint_key TEXT,value_json TEXT);');
  db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?)').run(taskId,'waiting_reconciliation',JSON.stringify({code:errorCode,message:secret,token:secret}),secret,secret);
  const save=(key,value)=>db.prepare('INSERT INTO task_checkpoints VALUES (?,?,?)').run(taskId,key,JSON.stringify(value));
  save('competition-cloud-inflight',{accepted,requestId,payload:secret,headers:{Authorization:secret}});
  save('competition-cloud-unknown',{accepted,requestId,body:secret});save('competition-cloud-received',null);
  save('competition-export-withheld',{withheld:true,result:secret});save('unrelated-private-content',{text:secret});db.close();
  const desktopLogPath=path.join(directory,'synthetic.log');
  writeFileSync(desktopLogPath,JSON.stringify({event:'agentarts-failure',detail:JSON.stringify({stage:'transport',code:'EXTERNAL_FAILURE',
    requestId,resultUnknown:true,transportPhase:'wss_upgrade',body:secret,url:secret,token:secret})})+'\n');
  return {directory,databasePath,desktopLogPath,taskId,sourceRoot:root};
}
test('explicit SQLite diagnostic reads safe metadata and matching original stage without changing any fixture bytes',()=>{
  const input=fixture(),before=readFileSync(input.databasePath),files=readdirSync(input.directory);
  const result=collectReconciliationDiagnostic(input),serialized=JSON.stringify(result);
  assert.deepEqual(result.task,{taskId,state:'waiting_reconciliation',errorCode:'RESULT_UNKNOWN'});
  assert.deepEqual(result.accepted,{inflight:true,received:null,unknown:true});
  assert.deepEqual(result.adapterReceipt,{source:'matching_explicit_desktop_log',available:true,stage:'transport',code:'EXTERNAL_FAILURE',resultUnknown:true,transportPhase:'wss_upgrade'});
  assert.equal(result.checkpoints['competition-cloud-inflight'],true);assert.equal(result.checkpoints['competition-cloud-received'],false);
  assert.equal(result.checkpoints['competition-export-withheld'],true);
  assert.equal(result.provenance.runningApplicationBuild,'not_observed');assert.equal(result.provenance.collectorNode.scope,'this_diagnostic_process');
  assert.equal(result.provenance.resolvedModuleFiles.length,2);assert.ok(result.provenance.files.every(file=>!file.relativePath||!path.isAbsolute(file.relativePath)));
  assert.equal(serialized.includes(secret),false);assert.equal(serialized.includes(input.directory),false);assert.equal(serialized.includes(root),false);
  assert.deepEqual(readFileSync(input.databasePath),before);assert.deepEqual(readdirSync(input.directory),files);
});
test('unknown codes and non-boolean admission do not become trusted diagnostic facts; missing stage stays unavailable',()=>{
  const input=fixture(secret,1),result=collectReconciliationDiagnostic({...input,desktopLogPath:undefined});
  assert.equal(result.task.errorCode,'OTHER');assert.deepEqual(result.accepted,{inflight:null,received:null,unknown:null});
  assert.deepEqual(result.adapterReceipt,{source:'not_supplied',available:false});assert.equal(JSON.stringify(result).includes(secret),false);
  writeFileSync(input.desktopLogPath,JSON.stringify({event:'agentarts-failure',detail:JSON.stringify({requestId:'foreign',stage:'transport',code:'TIMEOUT',body:secret})}));
  assert.deepEqual(collectReconciliationDiagnostic(input).adapterReceipt,{source:'no_matching_receipt_in_explicit_log',available:false});
});
test('missing or malformed databases fail without creation or private error text; CLI requires explicit inputs',()=>{
  const input=fixture(),missing=path.join(input.directory,'missing.sqlite');
  assert.throws(()=>collectReconciliationDiagnostic({...input,databasePath:missing}),error=>error.message==='DATABASE_UNAVAILABLE');assert.equal(existsSync(missing),false);
  assert.throws(()=>collectReconciliationDiagnostic({...input,taskId:'missing-task'}),error=>error.message==='TASK_NOT_FOUND');
  const invalid=path.join(input.directory,'private-invalid.sqlite');writeFileSync(invalid,secret);
  assert.throws(()=>collectReconciliationDiagnostic({...input,databasePath:invalid}),error=>error.message==='DATABASE_READ_FAILED');
  const cli=spawnSync(process.execPath,[fileURLToPath(new URL('./reconciliation-readonly.mjs',import.meta.url)),'--database',invalid,'--task-id',taskId],{encoding:'utf8',windowsHide:true});
  assert.equal(cli.status,1);assert.deepEqual(JSON.parse(cli.stdout),{diagnosticVersion:'1.0',readOnly:true,error:'DATABASE_READ_FAILED'});
  assert.equal((cli.stdout+cli.stderr).includes(input.directory),false);assert.equal((cli.stdout+cli.stderr).includes(secret),false);
});

test('a selected parent exposes only bounded direct child metadata and its own matching safe adapter receipt',()=>{
  const input=fixture(),db=new DatabaseSync(input.databasePath),childId='synthetic-child',childRequest='synthetic-child-request';
  const insert=db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?)'),save=db.prepare('INSERT INTO task_checkpoints VALUES (?,?,?)');
  insert.run(childId,'waiting_reconciliation',JSON.stringify({code:'UNAUTHORIZED',message:secret}),secret,secret);
  save.run(childId,'subtask-parent',JSON.stringify({parentTaskId:taskId,goal:secret,model:secret,subtaskId:'user-work'}));
  save.run(childId,'competition-cloud-inflight',JSON.stringify({requestId:childRequest,accepted:true,payload:secret}));
  save.run(childId,'competition-export-withheld',JSON.stringify({result:secret}));
  save.run(taskId,'subagent-parent-wait',JSON.stringify({arguments:secret}));
  insert.run('grandchild','failed',null,secret,secret);
  save.run('grandchild','subtask-parent',JSON.stringify({parentTaskId:childId,goal:secret}));
  insert.run('foreign-child','waiting_reconciliation',null,secret,secret);
  save.run('foreign-child','subtask-parent',JSON.stringify({parentTaskId:'foreign-parent',goal:secret}));db.close();
  writeFileSync(input.desktopLogPath,JSON.stringify({event:'agentarts-failure',detail:JSON.stringify({requestId:childRequest,
    stage:'export_guard',code:'UNAUTHORIZED',headers:secret,body:secret})}));
  const before=readFileSync(input.databasePath),result=collectReconciliationDiagnostic(input),serialized=JSON.stringify(result);
  assert.equal(result.checkpoints['subagent-parent-wait'],true);assert.equal(result.adapterReceipt.available,false);
  assert.equal(result.relatedTasks.depth,1);assert.equal(result.relatedTasks.childrenTruncated,false);
  assert.equal(result.relatedTasks.children.length,1);assert.deepEqual(result.relatedTasks.children[0].task,{taskId:childId,state:'waiting_reconciliation',errorCode:'UNAUTHORIZED'});
  assert.equal(result.relatedTasks.children[0].checkpoints['competition-export-withheld'],true);
  assert.deepEqual(result.relatedTasks.children[0].adapterReceipt,{source:'matching_explicit_desktop_log',available:true,stage:'export_guard',code:'UNAUTHORIZED'});
  assert.equal(serialized.includes(secret),false);assert.equal(serialized.includes('grandchild'),false);assert.equal(serialized.includes('foreign-child'),false);
  assert.deepEqual(readFileSync(input.databasePath),before);
  const child=collectReconciliationDiagnostic({...input,taskId:childId});assert.equal(child.relatedTasks.parents[0].task.taskId,taskId);
});

test('direct related child inventory is capped and explicitly reports truncation',()=>{
  const input=fixture(),db=new DatabaseSync(input.databasePath);
  for(let i=0;i<35;i++) {
    const id='child-'+String(i).padStart(2,'0');
    db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?)').run(id,'failed',null,secret,secret);
    db.prepare('INSERT INTO task_checkpoints VALUES (?,?,?)').run(id,'subtask-parent',JSON.stringify({parentTaskId:taskId,goal:secret}));
  }
  db.close();const result=collectReconciliationDiagnostic(input);
  assert.equal(result.relatedTasks.children.length,32);assert.equal(result.relatedTasks.childrenTruncated,true);
  assert.equal(JSON.stringify(result).includes(secret),false);
});
