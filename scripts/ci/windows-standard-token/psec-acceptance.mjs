// Fixed real-Windows acceptance. No arbitrary command, fallback or optional skip.
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {assessPsecTap} from './psec-acceptance-result.mjs';
import {probeNativeToolchain,requireNativeRuntime,requirePeArchitecture} from '../../../packages/coding-tools/native/host-architecture.mjs';

const start = new Date();
assert.equal(process.platform,'win32','Real Windows required');
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
  runId:process.env.GITHUB_RUN_ID??null,runAttempt:process.env.GITHUB_RUN_ATTEMPT??null,runnerName:process.env.RUNNER_NAME??null,
  helperSha256:hash(readFileSync(process.env.PA_TEST_JOB_HOST_EXE)),helperFilesSha256,
  processmodel:{exists:existsSync(dll),sha256:existsSync(dll)?hash(readFileSync(dll)):null},results:[]};
// Recheck inside the actual ordinary-user child, not only in the elevated preparation step.
// Save a typed failure receipt before any PSEC scenario can execute on an emulated host.
try {
  assert.equal(process.version,'v'+readFileSync('.node-version','utf8').trim(),'Pinned Node required');
  receipt.toolchain=probeNativeToolchain();
  requirePeArchitecture(process.env.PA_TEST_JOB_HOST_EXE,receipt.toolchain.architecture);
  assert.ok(process.env.PA_CI_CHECK_LAUNCHER,'Actual standard-token launcher required');
  requirePeArchitecture(process.env.PA_CI_CHECK_LAUNCHER,receipt.toolchain.architecture);
  const launcher=spawnSync(process.env.PA_CI_CHECK_LAUNCHER,['--architecture'],
    {encoding:'utf8',timeout:10000,maxBuffer:4096,windowsHide:true,shell:false});
  assert.equal(launcher.status,0);assert.equal(launcher.error,undefined);assert.equal(launcher.signal,null);
  receipt.launcherArchitecture=JSON.parse(launcher.stdout);
  requireNativeRuntime(receipt.launcherArchitecture,receipt.toolchain.architecture);
} catch {
  receipt.finishedAt=new Date().toISOString();receipt.status='failed';receipt.failure='native-toolchain-unconfirmed';
  writeFileSync(path.join(target,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  throw Error('Native Node/dotnet/helper/launcher architecture unconfirmed');
}
// Fixed helper modes emit only safe OS/token/loader/contract metadata. They never
// create a PSEC environment or run the proposed command; enforcement is tested below.
receipt.nativeDiagnostics={};
for(const [name,mode] of [['loader','--sandbox-diagnostics'],['contract','--sandbox-support']]){
  const diagnostic=spawnSync(process.env.PA_TEST_JOB_HOST_EXE,[mode],
    {env:{},encoding:'utf8',timeout:10000,maxBuffer:16384,windowsHide:true,shell:false});
  let data;
  try{data=JSON.parse(diagnostic.stdout??'');}catch{data={invalidReceipt:true};}
  receipt.nativeDiagnostics[name]={exitCode:diagnostic.status,signal:diagnostic.signal,error:diagnostic.error?.code??null,data};
}
const ordinary=receipt.nativeDiagnostics.loader.exitCode===0
  &&receipt.nativeDiagnostics.loader.data.diagnosticOnly===true
  &&receipt.nativeDiagnostics.loader.data.token?.available===true
  &&receipt.nativeDiagnostics.loader.data.token.elevated===false
  &&receipt.nativeDiagnostics.loader.data.token.administrator===false
  &&receipt.nativeDiagnostics.loader.data.token.appContainer===false;
receipt.ordinaryUser=ordinary;
writeFileSync(path.join(target,'native-diagnostics.json'),JSON.stringify(receipt.nativeDiagnostics,null,2)+'\n');
let nativeHelper=false;
try {
  const helper=receipt.nativeDiagnostics.loader.data;
  assert.equal(receipt.nativeDiagnostics.loader.exitCode,0);
  requireNativeRuntime({processArchitecture:helper.os?.processArchitecture,osArchitecture:helper.os?.architecture,
    framework:helper.runtime?.framework},receipt.toolchain.architecture);nativeHelper=true;
} catch { /* Fixed failure below. */ }
receipt.nativeHelper=nativeHelper;
if(!nativeHelper){
  receipt.finishedAt=new Date().toISOString();receipt.status='failed';receipt.failure='native-helper-architecture-unconfirmed';
  writeFileSync(path.join(target,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  throw Error('Actual helper OS/process architecture mismatch');
}
// Never proceed under an outer AppContainer/elevated/unknown token or with an old
// helper lacking the fixed diagnostic mode. Preserve the failed preflight receipt.
if(!ordinary){
  receipt.finishedAt=new Date().toISOString();receipt.status='failed';receipt.failure='ordinary-token-unconfirmed';
  writeFileSync(path.join(target,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  throw Error('Real PSEC acceptance requires a confirmed ordinary user outside an outer AppContainer');
}
for(const [name,file,rootName,minimumTests] of [
  ['os-boundary','packages/coding-tools/test/windows-native-sandbox.test.mjs','real Windows PSEC boundary, generation guards and lifecycle',7],
  ['authorization-chain','apps/desktop/test/authorization-native-execution.integration.test.mjs','one real original question gates a production PSEC command and never replenishes authority',1],
]){
  const before=Date.now();
  const pattern='^'+rootName.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')+'$';
  const run=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap','--test-name-pattern='+pattern,file],
    {env:{...process.env,PA_TEST_NATIVE_SANDBOX_REQUIRED:'1'},encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
  const log=(run.stdout??'')+(run.stderr??'');
  writeFileSync(path.join(target,name+'.log'),log);
  process.stdout.write(log);
  // Exactly one selected root test must execute; unsupported/error/skip is never acceptance.
  const {accepted,summary,reason}=assessPsecTap(run,rootName,minimumTests);
  receipt.results.push({name,file,exitCode:run.status,signal:run.signal,error:run.error?.code??null,
    wallMs:Date.now()-before,logSha256:hash(log),summary,reason,status:accepted?'passed':'failed'});
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
