'use strict';

// Revalidate an already completed public run. Never resubmit its model or tools.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {names,publicChecker,readOriginalExecution}=require('./desktop-progressive-development-live.cjs');
const {launch,snapshot,captureMode,closeDesktop}=require('./desktop-pelican-default-live.cjs');
const root=path.resolve(__dirname,'../../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const fileHash=file=>hash(fs.readFileSync(file));

async function main(){
  assert.equal(process.env.PA_MANUAL_PROGRESSIVE_DESKTOP_READBACK,'1','Explicit public-run readback opt-in required');
  const name=process.argv[2];assert.match(name,/^desktop-progressive-development-[A-Za-z0-9]+$/);
  const original=path.join(root,'.cache',name),rawPath=path.join(original,'receipt.json');
  assert.equal(fs.lstatSync(original).isSymbolicLink(),false);
  const raw=JSON.parse(fs.readFileSync(rawPath,'utf8')),rawSha=fileHash(rawPath);
  assert.equal(raw.kind,'production_desktop_progressive_development');
  assert.equal(raw.profile,'huawei_ict_agentarts');assert.equal(raw.fixture.dataClass,'public');
  assert.equal(raw.stage,'independent-readback');assert.equal(raw.lastState,'succeeded');
  assert.equal(raw.status,'failed');assert.equal(raw.failure.code,'ERR_ASSERTION');
  assert.match(raw.failure.message,/original preview and apply must describe the exact same patch/);
  assert.ok(raw.launchAttempts.length>0&&raw.launchAttempts.every(attempt=>attempt.cleanup?.state==='closed'
    &&attempt.cleanup.mainProcessExited&&attempt.cleanup.processExited),'Original owned Desktop must be closed');
  const output=fs.mkdtempSync(path.join(root,'.cache','progressive-desktop-readback-'));
  const receipt=path.join(output,'receipt.json'),workspace=path.join(original,'workspace');
  const originalProfile=path.join(original,'user-data'),userData=path.join(output,'restart-profile');
  assert.ok(fs.lstatSync(originalProfile).isDirectory()&&!fs.lstatSync(originalProfile).isSymbolicLink());
  const expectedFiles=[...names,'project.test.cjs','package.json'].sort();
  assert.deepEqual(raw.fixture.sourceFiles,expectedFiles);
  const expectedText=Object.fromEntries(names.map((name,index)=>[name,`'use strict';\nmodule.exports = value => value + ${index+1};\n`]));
  expectedText['project.test.cjs']=publicChecker();
  expectedText['package.json']=JSON.stringify({name:'public-progressive-development-acceptance',private:true,
    scripts:{test:'node --test'}},null,2)+'\n';
  function verifyFiles(){
    const entries=fs.readdirSync(workspace,{withFileTypes:true});
    assert.ok(entries.every(entry=>entry.isFile()));assert.deepEqual(entries.map(entry=>entry.name).sort(),expectedFiles);
    for(const [file,text]of Object.entries(expectedText))assert.equal(fs.readFileSync(path.join(workspace,file),'utf8'),text);
    return Object.fromEntries(expectedFiles.map(file=>[file,fileHash(path.join(workspace,file))]));
  }
  const originalDatabases=Object.fromEntries(['runtime.sqlite','runtime.sqlite-wal','runtime.sqlite-shm']
    .filter(file=>fs.existsSync(path.join(originalProfile,file))).map(file=>[file,fileHash(path.join(originalProfile,file))]));
  assert.ok(originalDatabases['runtime.sqlite']);
  const report={schemaVersion:1,kind:'completed_public_run_independent_readback',profile:raw.profile,
    startedAt:new Date().toISOString(),status:'in_progress',originalReceiptSha256:rawSha,originalAttemptStatus:raw.status,
    originalSource:raw.source,sourceTaskId:raw.sourceTaskId,
    automation:raw.automation,target:raw.target,originalApprovals:raw.approvals.length,
    source:Object.fromEntries(['tests/manual/agentarts/desktop-progressive-development-live.cjs',
      'tests/manual/agentarts/desktop-progressive-development-readback.cjs'].map(file=>[file,fileHash(path.join(root,file))])),
    limits:['The original acceptance receipt remains failed; this is a separate readback with corrected document-equivalence criteria.',
      'The restart uses an isolated copy of the original closed test profile. It does not restore an old permission or repeat an invoke.',
      'Physical human clicks, new platform deployment and arbitrary large projects are not proved.']};
  const persist=()=>fs.writeFileSync(receipt,JSON.stringify(report,null,2)+'\n');
  let session;
  try{
    report.skippedProfileLinks=[];
    fs.cpSync(originalProfile,userData,{recursive:true,filter:file=>{
      const relative=path.relative(originalProfile,file),first=relative.split(path.sep)[0];
      if(['Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache','Crashpad','DevToolsActivePort'].includes(first))return false;
      if(fs.lstatSync(file).isSymbolicLink()){report.skippedProfileLinks.push(relative);return false;}
      return true;
    }});
    for(const [file,digest]of Object.entries(originalDatabases))assert.equal(fileHash(path.join(userData,file)),digest);
    report.persistence=await readOriginalExecution(path.join(userData,'runtime.sqlite'),raw.sourceTaskId,{complete:true});
    report.fixture={sourceFileSetPreserved:true,fixedFilesUnchanged:true,allExpectedEdits:true,hashes:verifyFiles()};
    const node=process.env.PA_PELICAN_NODE,npm=process.env.PA_PELICAN_NPM_CLI;
    for(const file of [node,npm])assert.ok(file&&path.isAbsolute(file)&&fs.statSync(file).isFile());
    const checker=spawnSync(node,['--test'],{cwd:workspace,encoding:'utf8',windowsHide:true,shell:false});
    assert.equal(checker.status,0);assert.match(checker.stdout,/pass 14\b/);
    assert.match(checker.stdout,/progressive-development-verification:.*"modules":14,"verified":true/);
    report.independentNodeVerification={status:'passed',exitCode:0,passed:14,stdoutSha256:hash(checker.stdout)};
    report.stage='cold-restart-readback';persist();
    session=await launch({executablePath:process.env.PA_PELICAN_ELECTRON??path.join(root,'node_modules/electron/dist/electron.exe'),
      userData,workspace,node,npm},report);
    const view=await snapshot(session.panel),task=view.tasks.find(item=>item.taskId===raw.sourceTaskId);
    assert.equal(task?.state,'succeeded');
    await captureMode(session.app,'panel',path.join(output,'desktop-result.png'));
    await closeDesktop(session.app);session=undefined;
    const after=await readOriginalExecution(path.join(userData,'runtime.sqlite'),raw.sourceTaskId,{complete:true});
    assert.deepEqual(after.records,report.persistence.records);assert.equal(after.cloudRequestCount,report.persistence.cloudRequestCount);
    assert.equal(after.originalReceiptCount,report.persistence.originalReceiptCount);
    report.restart={mode:'isolated_copy_of_closed_original_profile',taskState:'succeeded',originalRecordsRetained:true,
      cloudRequestCountUnchanged:true,noOriginalInvokeOrToolReplay:true};
    assert.deepEqual(verifyFiles(),report.fixture.hashes);assert.equal(fileHash(rawPath),rawSha);
    for(const [file,digest]of Object.entries(originalDatabases))assert.equal(fileHash(path.join(originalProfile,file)),digest);
    report.originalReceiptAndDatabaseUnchanged=true;
    report.status='passed_real_default_desktop_beyond_32_readback';report.stage='complete';
  }catch(error){report.status='failed';report.failure={code:error?.code??'READBACK_FAILED',
    message:String(error?.message??'Readback failed').replace(/[A-Z]:[\\/][^\n]+/gi,'[local path]').slice(0,500)};throw error;
  }finally{
    if(session)try{await closeDesktop(session.app);}catch(error){report.status='failed';report.cleanupFailure={code:error?.code??'CLEANUP_FAILED'};}
    report.finishedAt=new Date().toISOString();persist();console.log(JSON.stringify({status:report.status,receipt}));
  }
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({code:error?.code??'READBACK_FAILED',
  message:String(error?.message??'Readback failed').replace(/[A-Z]:[\\/][^\n]+/gi,'[local path]').slice(0,500)}));process.exitCode=1;});
