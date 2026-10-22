// Explicit, offline, read-only diagnostic. Never import Runtime, load credentials,
// discover a personal database, migrate, resume, reconcile, resend or start services.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,statSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const states=new Set(['created','planning','running','waiting_approval','waiting_external','waiting_reconciliation','verifying','cancelling','succeeded','failed','cancelled']);
const errors=new Set(['INVALID_ARGUMENT','INVALID_REQUEST','UNAUTHORIZED','UNSUPPORTED_CAPABILITY','EXTERNAL_FAILURE','INTERNAL_ERROR',
  'CANCELLED','TIMEOUT','RESULT_UNKNOWN','REVISION_CONFLICT','NOT_FOUND','RATE_LIMITED','RESOURCE_BUSY','VERSION_MISMATCH']);
const stages=new Set(['authorization','catalog_guard','export_guard','transport','http_response','response_body','response_schema','application_schema']);
const checkpointNames=['competition-cloud-inflight','competition-cloud-received','competition-cloud-unknown','competition-cloud-terminal-error',
  'competition-export-withheld','competition-loop','runtime-interruption:v1','runtime-startup-recovery:v1','private-copy-erasure'];
const identityPattern=/^[A-Za-z0-9_-]{1,128}$/u;
const fail=code=>{throw Object.assign(Error(code),{diagnosticCode:code});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function existingFile(value,code){
  if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))fail(code);
  try{const resolved=realpathSync.native(value);if(!statSync(resolved).isFile())fail(code);return resolved;}catch{fail(code);}
}
function boundedJson(text){try{return typeof text==='string'&&text.length<=16384?JSON.parse(text):undefined;}catch{return undefined;}}
function fileMetadata(root,file){
  try{
    const actual=existingFile(file,'FILE_UNAVAILABLE'),relative=path.relative(root,actual);
    const within=relative!==''&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);
    return {available:true,location:within?'selected_checkout_on_disk':'outside_selected_checkout_on_disk',
      ...(within?{relativePath:relative.split(path.sep).join('/')} : {}),sha256:hash(readFileSync(actual))};
  }catch{return {available:false,location:'unavailable'};}
}
function provenance(sourceRoot){
  const root=path.resolve(sourceRoot??fileURLToPath(new URL('../..',import.meta.url)));
  // Suppress optional index refresh writes and configured fsmonitor processes.
  const gitArgs=['--no-optional-locks','-c','core.fsmonitor=false','-C',root];
  const git=spawnSync('git',[...gitArgs,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true,shell:false,timeout:3000,maxBuffer:4096});
  const status=spawnSync('git',[...gitArgs,'status','--porcelain','--untracked-files=no'],{encoding:'utf8',windowsHide:true,shell:false,timeout:3000,maxBuffer:262144});
  const sha=git.status===0&&/^[a-f0-9]{40,64}$/u.test(git.stdout.trim())?git.stdout.trim():null;
  const files=['package-lock.json','apps/desktop/electron/main.js','apps/desktop/electron/desktop-host.js',
    'apps/runtime/src/application/coordination.ts','packages/coordination/src/agentarts-websocket.ts']
    .map(file=>({name:file,...fileMetadata(root,path.join(root,file))}));
  const require=createRequire(path.join(root,'apps/desktop/package.json'));
  const modules=['@personal-agent/runtime/application','@personal-agent/coordination'].map(name=>{
    try{return {name,...fileMetadata(root,require.resolve(name))};}catch{return {name,available:false,location:'unavailable'};}
  });
  const declaredPackageVersions=['apps/runtime/package.json','packages/coordination/package.json','node_modules/electron/package.json'].map(file=>{
    let version=null;
    try{const value=JSON.parse(readFileSync(path.join(root,file),'utf8')).version;
      if(typeof value==='string'&&/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(value))version=value;}catch{}
    return {name:file,version,scope:'package_file_on_selected_checkout_disk'};
  });
  return {scope:'selected_checkout_files_not_running_application',checkoutSha:sha,
    trackedChanges:status.status===0?status.stdout.trim().length>0:null,files,resolvedModuleFiles:modules,declaredPackageVersions,
    runningApplicationBuild:'not_observed',collectorNode:{version:process.version,scope:'this_diagnostic_process'}};
}
function originalReceipt(logPath,requestIds){
  if(logPath===undefined)return {source:'not_supplied',available:false};
  const file=existingFile(logPath,'LOG_UNAVAILABLE');
  if(statSync(file).size>524288)fail('LOG_TOO_LARGE');
  let found;
  for(const line of readFileSync(file,'utf8').split(/\r?\n/u)){
    const envelope=boundedJson(line);
    if(envelope?.event!=='agentarts-failure')continue;
    const value=typeof envelope.detail==='string'?boundedJson(envelope.detail):undefined;
    if(!value||!requestIds.has(value.requestId)||!stages.has(value.stage)||!errors.has(value.code))continue;
    found={source:'matching_explicit_desktop_log',available:true,stage:value.stage,code:value.code,
      ...(typeof value.resultUnknown==='boolean'?{resultUnknown:value.resultUnknown}:{}),
      ...(value.transportPhase==='wss_upgrade'?{transportPhase:value.transportPhase}:{})};
  }
  return found??{source:'no_matching_receipt_in_explicit_log',available:false};
}
export function collectReconciliationDiagnostic({databasePath,taskId,sourceRoot,desktopLogPath}={}){
  if(typeof taskId!=='string'||!identityPattern.test(taskId))fail('INVALID_TASK_ID');
  const database=existingFile(databasePath,'DATABASE_UNAVAILABLE');
  let db,facts;
  try{
    db=new DatabaseSync(database,{readOnly:true,allowExtension:false,timeout:1000});
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN;');
    // Select only the typed error code; never fetch goal, result summary, messages,
    // event bodies, credentials or unbounded checkpoint/result JSON.
    const task=db.prepare("SELECT state, CASE WHEN json_valid(error_json) THEN json_extract(error_json,'$.code') ELSE NULL END AS error_code FROM tasks WHERE task_id=?").get(taskId);
    if(!task)fail('TASK_NOT_FOUND');
    const checkpoints=Object.fromEntries(checkpointNames.map(name=>[name,false]));
    const rows=db.prepare(`SELECT checkpoint_key, value_json IS NOT NULL AND value_json != 'null' AS present
      FROM task_checkpoints WHERE task_id=? AND checkpoint_key IN (${checkpointNames.map(()=>'?').join(',')})`).all(taskId,...checkpointNames);
    for(const row of rows)checkpoints[row.checkpoint_key]=row.present===1;
    const receipts=db.prepare(`SELECT checkpoint_key,
      CASE WHEN json_valid(value_json) THEN CASE json_type(value_json,'$.accepted') WHEN 'true' THEN 1 WHEN 'false' THEN 0 ELSE NULL END ELSE NULL END AS accepted,
      CASE WHEN json_valid(value_json) THEN json_extract(value_json,'$.requestId') ELSE NULL END AS request_id
      FROM task_checkpoints WHERE task_id=? AND checkpoint_key IN ('competition-cloud-inflight','competition-cloud-received','competition-cloud-unknown')`).all(taskId);
    const accepted={inflight:null,received:null,unknown:null},requestIds=new Set();
    for(const row of receipts){
      accepted[row.checkpoint_key.slice('competition-cloud-'.length)]=row.accepted===1?true:row.accepted===0?false:null;
      if(typeof row.request_id==='string'&&identityPattern.test(row.request_id))requestIds.add(row.request_id);
    }
    facts={task:{taskId,state:states.has(task.state)?task.state:'OTHER',errorCode:task.error_code===null?null:errors.has(task.error_code)?task.error_code:'OTHER'},
      checkpoints,accepted,adapterReceipt:originalReceipt(desktopLogPath,requestIds)};
  }catch(error){
    if(error?.diagnosticCode)throw error;
    fail('DATABASE_READ_FAILED');
  }finally{if(db){try{db.exec('ROLLBACK;');}catch{}try{db.close();}catch{}}}
  return {diagnosticVersion:'1.0',readOnly:true,...facts,provenance:provenance(sourceRoot)};
}
function argumentsForCli(argv){
  const names=new Map([['--database','databasePath'],['--task-id','taskId'],['--source-root','sourceRoot'],['--desktop-log','desktopLogPath']]);
  const result={};
  for(let i=0;i<argv.length;i+=2){const key=names.get(argv[i]);if(!key||result[key]!==undefined||!argv[i+1])fail('INVALID_ARGUMENTS');result[key]=argv[i+1];}
  if(!result.databasePath||!result.taskId)fail('INVALID_ARGUMENTS');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(collectReconciliationDiagnostic(argumentsForCli(process.argv.slice(2))),null,2)+'\n');}
  catch(error){process.stdout.write(JSON.stringify({diagnosticVersion:'1.0',readOnly:true,error:error?.diagnosticCode??'DIAGNOSTIC_FAILED'})+'\n');process.exitCode=1;}
}
