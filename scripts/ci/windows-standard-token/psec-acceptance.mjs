// Fixed real-Windows acceptance. No arbitrary command, fallback or optional skip.
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {nativeTokenDiagnostic} from '../../../packages/coding-tools/test/native-sandbox-fixture.mjs';

const start = new Date();
assert.equal(process.platform,'win32','Real Windows required');
assert.equal(nativeTokenDiagnostic().administratorToken,false,'Ordinary user token required');
assert.ok(process.env.PA_TEST_JOB_HOST_EXE && existsSync(process.env.PA_TEST_JOB_HOST_EXE),'Explicit built native helper required');
const target=path.join(process.env.RUNNER_TEMP ?? '.cache','psec-positive-acceptance');
mkdirSync(target,{recursive:true});
const hash=value=>createHash('sha256').update(value).digest('hex');
const dll=path.join(process.env.SystemRoot,'System32','processmodel.dll');
const cases=path.resolve('.cache/authorization-native-integration');
const beforeCases=new Set(existsSync(cases)?readdirSync(cases):[]);
const helperFilesSha256=Object.fromEntries(['WindowsJobProcessHost.dll','WindowsJobProcessHost.deps.json','WindowsJobProcessHost.runtimeconfig.json']
  .map(name=>[name,hash(readFileSync(path.join(path.dirname(process.env.PA_TEST_JOB_HOST_EXE),name)))]));
const receipt={startedAt:start.toISOString(),sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  platform:process.platform,release:os.release(),osVersion:os.version(),node:process.version,required:true,
  imageOS:process.env.ImageOS??null,imageVersion:process.env.ImageVersion??null,
  runId:process.env.GITHUB_RUN_ID??null,runAttempt:process.env.GITHUB_RUN_ATTEMPT??null,
  helperSha256:hash(readFileSync(process.env.PA_TEST_JOB_HOST_EXE)),helperFilesSha256,
  processmodel:{exists:existsSync(dll),sha256:existsSync(dll)?hash(readFileSync(dll)):null},results:[]};
for(const [name,file,pattern] of [
  ['os-boundary','packages/coding-tools/test/windows-native-sandbox.test.mjs','^real Windows PSEC boundary, generation guards and lifecycle'],
  ['authorization-chain','apps/desktop/test/authorization-native-execution.integration.test.mjs','^one real original question gates a production PSEC command and never replenishes authority'],
]){
  const before=Date.now();
  const run=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap','--test-name-pattern='+pattern,file],
    {env:{...process.env,PA_TEST_NATIVE_SANDBOX_REQUIRED:'1'},encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
  const log=(run.stdout??'')+(run.stderr??'');
  writeFileSync(path.join(target,name+'.log'),log);
  process.stdout.write(log);
  // Exactly one selected root test must execute; unsupported/error/skip is never acceptance.
  const accepted=run.status===0&&!run.error&&/^# pass [1-9]\d*$/mu.test(log)&&/^# fail 0$/mu.test(log)&&/^# skipped 0$/mu.test(log);
  receipt.results.push({name,file,exitCode:run.status,signal:run.signal,error:run.error?.code??null,
    wallMs:Date.now()-before,logSha256:hash(log),status:accepted?'passed':'failed'});
}
receipt.finishedAt=new Date().toISOString();
// Export only this run's two explicitly synthetic receipts, never the SQLite/cache tree.
receipt.businessReceipts=[];
if(existsSync(cases))for(const name of readdirSync(cases)){
  if(beforeCases.has(name)||!/^case-[\w-]+$/u.test(name))continue;
  const directory=path.join(cases,name),stat=lstatSync(directory);
  if(stat.isSymbolicLink()||!stat.isDirectory())continue;
  for(const file of ['receipt.json','unavailable-receipt.json']){
    const source=path.join(directory,file);
    if(!existsSync(source))continue;
    const fileStat=lstatSync(source);
    if(fileStat.isSymbolicLink()||!fileStat.isFile()||fileStat.size>262144)continue;
    const bytes=readFileSync(source),artifact=`authorization-${receipt.businessReceipts.length}-${file}`;
    writeFileSync(path.join(target,artifact),bytes);
    receipt.businessReceipts.push({artifact,sha256:hash(bytes)});
  }
}
receipt.wallMs=Date.now()-start.getTime();
receipt.status=receipt.results.every(result=>result.status==='passed')?'passed':'failed';
writeFileSync(path.join(target,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
process.exitCode=receipt.status==='passed'?0:1;
