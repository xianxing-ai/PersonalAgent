import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {createIsolatedCodingRepairHost,createIsolatedCodingRepairTools,createWorkspaceCommandTool,
  captureCodingRepairSnapshot,affectedCodingRepairPackages} from '../dist/index.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const ctx=(overrides={})=>({taskId:'parent-fixture',runId:'run-'+randomUUID(),scopes:['workspace:read','workspace:list','workspace:write','workspace:apply','workspace:execute'],
  authorizationRef:'explicit-fixture-outer-grant',argumentsDigest:hash('public synthetic outer invocation'),deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal,...overrides});
async function fixture(t,extra={}){
  const directory=await mkdtemp(path.join(tmpdir(),'pa-isolated-code-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const user=path.join(directory,'user'),sessions=path.join(directory,'sessions');await mkdir(path.join(user,'test'),{recursive:true});
  await writeFile(path.join(user,'package.json'),JSON.stringify({name:'fixture-project',scripts:{test:'node --test'}}));
  await writeFile(path.join(user,'math.cjs'),'module.exports=(a,b)=>a-b;\n');
  await writeFile(path.join(user,'test','math.test.cjs'),"const a=require('node:assert/strict');a.equal(require('../math.cjs')(2,3),5);\n");
  await writeFile(path.join(user,'user-uncommitted.txt'),'Unrelated user changes\n');
  let roots=[];
  const options={workspaceRoot:user,sessionRoot:sessions,workspaceId:'fixture-workspace',patch:{powerShellPath:process.env.PA_TEST_PWSH??'C:/Program Files/PowerShell/7/pwsh.exe'},
    recipes:[{recipeId:'node-test',packageIds:[],required:true}],
    createCommandTool:({rootPath})=>{roots.push(rootPath);return createWorkspaceCommandTool({rootPath,recipes:[{id:'node-test',executable:process.execPath,args:['--test','test/math.test.cjs']}]});},
    // The outer Runtime records real Evidence; host tests use an explicitly Fake confirmation port.
    readVerificationEvidence:async()=>['explicit-fake-runtime-evidence'],...extra};
  return {user,sessions,options,host:await createIsolatedCodingRepairHost(options),roots};
}

test('registered repair preview exposes only metadata while the local host retains the full preview',async t=>{
  const f=await fixture(t),input=await f.host.start({mode:'main',allowedPaths:['math.cjs','created.cjs']},ctx());
  const before=await readFile(path.join(f.user,'math.cjs'),'utf8'),created='module.exports = 7;\n';
  const patches=[{path:'math.cjs',expectedSha256:hash(before),edits:[{oldText:'a-b',newText:'a+b'}]},
    {path:'created.cjs',expectedSha256:null,edits:[],createText:created}];
  const local=await f.host.preview(input.session.sessionId,patches,ctx());
  assert.equal(local.patches[0].previewText,before.replace('a-b','a+b'));
  assert.equal(local.patches[1].previewText,created);
  const tool=createIsolatedCodingRepairTools(f.host).find(tool=>tool.descriptor.name==='coding.repair.preview');
  const result=await tool.execute({sessionId:input.session.sessionId,patches},ctx());
  assert.deepEqual(result,{sessionId:input.session.sessionId,approved:true,previewed:true,patches:[
    {path:'math.cjs',beforeSha256:hash(before),afterSha256:hash(before.replace('a-b','a+b')),changed:true},
    {path:'created.cjs',beforeSha256:null,afterSha256:hash(created),changed:true}]});
  assert.equal(await readFile(path.join(f.user,'math.cjs'),'utf8'),before);
});

test('real isolated read -> failing node test -> exact incremental patch -> passing test -> original-user CAS delivery',
  {skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),input=await f.host.start({mode:'main'},ctx());
  const baseline=await readFile(path.join(f.user,'math.cjs'),'utf8');
  const failed=await f.host.verify(input.session.sessionId,'node-test',ctx());
  assert.equal(failed.status,'FAILED');assert.notEqual(failed.exitCode,0);assert.ok(failed.diagnostics[0].message);
  const source=await f.host.read(input.session.sessionId,{path:'math.cjs'},ctx());
  const preview=await f.host.preview(input.session.sessionId,[{path:'math.cjs',expectedSha256:source.sha256,edits:[{oldText:'a-b',newText:'a+b'}]}],ctx());
  assert.equal(preview.sessionId,input.session.sessionId);assert.equal(preview.approved,true);assert.equal(preview.previewed,true);
  assert.equal(await readFile(path.join(f.user,'math.cjs'),'utf8'),baseline,'successful exact preview is not a user-root write');
  const checked=await f.host.check(input.session.sessionId,[{path:'math.cjs',expectedSha256:source.sha256,edits:[{oldText:'a-b',newText:'a+b'}]}],['node-test'],ctx());
  const valid=checked.verification.find(item=>item.status==='VALID');assert.ok(valid);assert.equal(valid.exitCode,0);
  assert.equal(checked.verification.find(item=>item.runId===failed.runId).status,'STALE','the old failed command describes historical source, not the repaired current input');
  const historical=JSON.parse(await readFile(path.join(f.sessions,input.session.sessionId,'journal.json'),'utf8'));
  assert.equal(historical.verification.find(item=>item.receipt.runId===failed.runId).receipt.status,'FAILED','derived validity never rewrites the historical failed receipt');
  assert.match(valid.packageGraphDigest,/^[a-f0-9]{64}$/);
  assert.equal(await readFile(path.join(f.user,'math.cjs'),'utf8'),baseline,'AI writes remain in the isolated root until publish');
  const published=await f.host.publish({version:1,sessionId:input.session.sessionId,baselineSnapshotId:input.initialSnapshot.snapshotId,
    snapshotId:checked.snapshot.snapshotId,paths:['math.cjs'],verificationRunIds:[valid.runId]},ctx());
  assert.equal(published.state,'published');assert.equal(published.files.length,1);
  assert.match(await readFile(path.join(f.user,'math.cjs'),'utf8'),/a\+b/);
  assert.equal(await readFile(path.join(f.user,'user-uncommitted.txt'),'utf8'),'Unrelated user changes\n');
  assert.ok(f.roots.every(root=>root!==f.user&&!root.startsWith(f.user+path.sep)));
});

test('cancelled real command retains unknown until stopped confirmation and cannot modify the main workspace',async t=>{
  let commandRoot;
  const stopState=async()=>{try{const pid=Number(await readFile(path.join(commandRoot,'.cache','command.pid'),'utf8'));process.kill(pid,0);return 'running';}catch(error){return error.code==='ESRCH'?'stopped':'unknown';}};
  const f=await fixture(t,{createCommandTool:({rootPath})=>{commandRoot=rootPath;return createWorkspaceCommandTool({rootPath,
    recipes:[{id:'node-test',executable:process.execPath,args:['-e',"const f=require('node:fs');f.mkdirSync('.cache',{recursive:true});f.writeFileSync('.cache/command.pid',String(process.pid));setInterval(()=>{},1000)"]}]});},readCommandStopState:stopState});
  const input=await f.host.start({mode:'main'},ctx()),before=await readFile(path.join(f.user,'math.cjs'),'utf8');
  const controller=new AbortController();
  const verified=assert.rejects(f.host.verify(input.session.sessionId,'node-test',ctx({signal:controller.signal})),error=>['CANCELLED','RESULT_UNKNOWN'].includes(error.code));
  for(let i=0;i<200;i++){try{await readFile(path.join(f.sessions,input.session.sessionId,'workspace','.cache','command.pid'));break;}catch{await new Promise(resolve=>setTimeout(resolve,5));}}
  controller.abort('synthetic user cancel');await verified;assert.equal(await stopState(),'stopped');
  assert.equal(await readFile(path.join(f.user,'math.cjs'),'utf8'),before);
  await assert.rejects(f.host.patch(input.session.sessionId,{path:'math.cjs',expectedSha256:hash(before),edits:[{oldText:'a-b',newText:'a+b'}]},ctx()),{code:'RESULT_UNKNOWN'});
  assert.equal((await f.host.reconcile(input.session.sessionId,ctx())).state,'clear');
});

test('package source/config changes invalidate its production consumers; root lock and unknown DAG invalidate all',async t=>{
  const f=await fixture(t),root=await realpath(f.user);
  for(const name of ['a','b','c']){await mkdir(path.join(f.user,'packages',name),{recursive:true});await writeFile(path.join(f.user,'packages',name,'package.json'),JSON.stringify({name:'@fixture/'+name,...(name==='b'?{dependencies:{'@fixture/a':'1.0.0'}}:{})}));await writeFile(path.join(f.user,'packages',name,'index.js'),'export const value=1;\n');}
  const before=await captureCodingRepairSnapshot(root);await writeFile(path.join(f.user,'packages','a','index.js'),'export const value=2;\n');
  assert.equal(affectedCodingRepairPackages(before.snapshot,before.snapshot,false).size,0,'unchanged exact input remains covered even when dependency analysis is unavailable');
  const after=await captureCodingRepairSnapshot(root);
  assert.deepEqual([...affectedCodingRepairPackages(before.snapshot,after.snapshot,true)].sort(),['pkg:packages/a','pkg:packages/b']);
  await writeFile(path.join(f.user,'package-lock.json'),'{}');const lock=await captureCodingRepairSnapshot(root);
  assert.equal(affectedCodingRepairPackages(after.snapshot,lock.snapshot,true).size,4);
  assert.equal(affectedCodingRepairPackages(before.snapshot,after.snapshot,false).size,4);
});

test('a changed tsconfig makes an earlier passing receipt STALE and stops publish',async t=>{
  const f=await fixture(t,{createCommandTool:({rootPath})=>createWorkspaceCommandTool({rootPath,
    recipes:[{id:'node-test',executable:process.execPath,args:['-e','process.exit(0)']} ]})});
  await writeFile(path.join(f.user,'tsconfig.json'),'{}');const input=await f.host.start({mode:'main'},ctx());
  const passed=await f.host.verify(input.session.sessionId,'node-test',ctx());assert.equal(passed.status,'VALID');
  const original=await f.host.read(input.session.sessionId,{path:'tsconfig.json'},ctx());
  // A project build changing source/config is detectable even when its command returns zero.
  const isolated=path.join(f.sessions,input.session.sessionId,'workspace');await writeFile(path.join(isolated,'tsconfig.json'),'{"strict":true}');
  const current=await f.host.check(input.session.sessionId,[],[],ctx());assert.equal(current.verification[0].status,'STALE');
  await assert.rejects(f.host.publish({version:1,sessionId:input.session.sessionId,baselineSnapshotId:input.initialSnapshot.snapshotId,
    snapshotId:current.snapshot.snapshotId,paths:['tsconfig.json'],verificationRunIds:[passed.runId]},ctx()),{code:'REVISION_CONFLICT'});
  assert.equal(await readFile(path.join(f.user,'tsconfig.json'),'utf8'),original.content);
});

test('concurrent user edits cause CAS conflict; shadow publishing and task/session substitution are rejected',async t=>{
  const f=await fixture(t,{createCommandTool:({rootPath})=>createWorkspaceCommandTool({rootPath,recipes:[{id:'node-test',executable:process.execPath,args:['-e','process.exit(0)']} ]})});
  const input=await f.host.start({mode:'main'},ctx()),isolated=path.join(f.sessions,input.session.sessionId,'workspace');
  await writeFile(path.join(isolated,'math.cjs'),'module.exports=(a,b)=>a+b;\n');const checked=await f.host.check(input.session.sessionId,[],['node-test'],ctx());
  await writeFile(path.join(f.user,'math.cjs'),'User concurrent edit\n');
  const result=await f.host.publish({version:1,sessionId:input.session.sessionId,baselineSnapshotId:input.initialSnapshot.snapshotId,snapshotId:checked.snapshot.snapshotId,
    paths:['math.cjs'],verificationRunIds:[checked.verification[0].runId]},ctx());assert.equal(result.state,'conflict');
  assert.equal(await readFile(path.join(f.user,'math.cjs'),'utf8'),'User concurrent edit\n');
  await assert.rejects(f.host.snapshot(input.session.sessionId,ctx({taskId:'different-task'})),{code:'UNAUTHORIZED'});
  const shadow=await f.host.start({mode:'isolated'},ctx());
  await assert.rejects(f.host.publish({version:1,sessionId:shadow.session.sessionId,baselineSnapshotId:shadow.initialSnapshot.snapshotId,snapshotId:shadow.initialSnapshot.snapshotId,paths:[],verificationRunIds:[]},ctx()),{code:'SCOPE_DENIED'});
});

test('dependency preparation cannot link the main node_modules or alter captured source; unknown prep stays unavailable',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.user,'package.json'),'{"name":"fixture","dependencies":{"synthetic":"1.0.0"}}');
  const input=await f.host.start({mode:'main'},ctx());await assert.rejects(f.host.verify(input.session.sessionId,'node-test',ctx()),{code:'UNSUPPORTED_CAPABILITY'});
  const external=path.join(f.user,'node_modules');await mkdir(external);await writeFile(path.join(external,'fixture.js'),'original');
  const linked=await createIsolatedCodingRepairHost({...f.options,prepareWorkspace:async({isolatedRoot})=>{await symlink(external,path.join(isolatedRoot,'node_modules'),process.platform==='win32'?'junction':'dir');return {ready:true};}});
  await assert.rejects(linked.start({mode:'main'},ctx()),{code:'SCOPE_DENIED'});
  assert.equal(await readFile(path.join(external,'fixture.js'),'utf8'),'original');
});

test('RegisteredTools preserve Runtime scopes and strict inputs; new files stay isolated and can resume from persistent journal',async t=>{
  const f=await fixture(t),tools=createIsolatedCodingRepairTools(f.host),start=tools.find(tool=>tool.descriptor.name==='coding.repair.start');
  await assert.rejects(start.execute({mode:'main',rootPath:f.user},ctx()));
  await assert.rejects(start.execute({mode:'main'},ctx({scopes:[]})),{code:'SCOPE_DENIED'});
  const input=await start.execute({mode:'main',allowedPaths:['new.js','math.cjs']},ctx());
  await f.host.patch(input.session.sessionId,{path:'new.js',expectedSha256:null,edits:[],createText:'export const value=1;\n'},ctx());
  await assert.rejects(readFile(path.join(f.user,'new.js')),{code:'ENOENT'});
  const restored=await createIsolatedCodingRepairHost(f.options);
  assert.equal((await restored.read(input.session.sessionId,{path:'new.js'},ctx())).content,'export const value=1;\n');
  const changed=await createIsolatedCodingRepairHost({...f.options,configurationRef:'changed-command-helper-config'});
  await assert.rejects(changed.snapshot(input.session.sessionId,ctx()),{code:'REVISION_CONFLICT'});
  await assert.rejects(restored.read(input.session.sessionId,{path:'../user/math.cjs'},ctx()),{code:'SCOPE_DENIED'});
  await assert.rejects(restored.patch(input.session.sessionId,{path:'private.pem',expectedSha256:null,edits:[],createText:'sensitive fixture'},ctx()),{code:'SCOPE_DENIED'});
});

test('multi-file publish journals the confirmed prefix and preserves a concurrent second-file conflict without blind retry',
  {skip:process.platform!=='win32'},async t=>{
  let publishing=false,writes=0,user;
  const f=await fixture(t,{createCommandTool:({rootPath})=>createWorkspaceCommandTool({rootPath,recipes:[{id:'node-test',executable:process.execPath,args:['-e','process.exit(0)']}]}),
    assertRecoveryDirectory:()=>{if(publishing&&++writes===2)writeFileSync(path.join(user,'second.cjs'),'Concurrent user second file\n');}});user=f.user;
  await writeFile(path.join(user,'second.cjs'),'module.exports=1;\n');
  const input=await f.host.start({mode:'main'},ctx()),isolated=path.join(f.sessions,input.session.sessionId,'workspace');
  await writeFile(path.join(isolated,'math.cjs'),'module.exports=(a,b)=>a+b;\n');await writeFile(path.join(isolated,'second.cjs'),'module.exports=2;\n');
  const checked=await f.host.check(input.session.sessionId,[],['node-test'],ctx());
  const request={version:1,sessionId:input.session.sessionId,baselineSnapshotId:input.initialSnapshot.snapshotId,snapshotId:checked.snapshot.snapshotId,
    paths:['math.cjs','second.cjs'],verificationRunIds:[checked.verification[0].runId]};
  publishing=true;const result=await f.host.publish(request,ctx());
  assert.equal(result.state,'unknown');assert.deepEqual(result.files.map(file=>file.path),['math.cjs']);
  assert.match(await readFile(path.join(user,'math.cjs'),'utf8'),/a\+b/);assert.equal(await readFile(path.join(user,'second.cjs'),'utf8'),'Concurrent user second file\n');
  const restored=await createIsolatedCodingRepairHost(f.options);const observed=await restored.reconcile(input.session.sessionId,ctx());
  assert.equal(observed.state,'clear');assert.equal(observed.delivery.state,'conflict');
  assert.deepEqual(observed.delivery.evidenceRefs,result.evidenceRefs);
  assert.equal(observed.delivery.files.length,2,'independent readback includes the actual concurrent second-file hash');
  assert.equal(observed.delivery.files[1].afterSha256,hash('Concurrent user second file\n'));
  await assert.rejects(restored.publish(request,ctx()),{code:'REVISION_CONFLICT'});assert.equal(writes,2,'reconciled partial delivery must not run either write again');
});

test('publish CAS covers verification dependencies and global lockfiles, but permits unrelated package edits',async t=>{
  for(const change of ['dependency','lock','unrelated'])await t.test(change,async t=>{
    const f=await fixture(t,{recipes:[{recipeId:'node-test',packageIds:['pkg:packages/b'],required:true}],
      prepareWorkspace:async()=>({ready:true}),createCommandTool:({rootPath})=>createWorkspaceCommandTool({rootPath,recipes:[{id:'node-test',executable:process.execPath,args:['-e','process.exit(0)']} ]})});
    for(const name of ['a','b','c']){await mkdir(path.join(f.user,'packages',name),{recursive:true});await writeFile(path.join(f.user,'packages',name,'package.json'),JSON.stringify({name:'@fixture/'+name,...(name==='b'?{dependencies:{'@fixture/a':'1.0.0'}}:{})}));await writeFile(path.join(f.user,'packages',name,'index.js'),'export const value=1;\n');}
    await writeFile(path.join(f.user,'package-lock.json'),'{}');
    const input=await f.host.start({mode:'main'},ctx()),isolated=path.join(f.sessions,input.session.sessionId,'workspace');
    await writeFile(path.join(isolated,'packages','b','index.js'),'export const value=2;\n');
    const checked=await f.host.check(input.session.sessionId,[],['node-test'],ctx());
    const changed=change==='lock'?'package-lock.json':`packages/${change==='dependency'?'a':'c'}/index.js`;
    await writeFile(path.join(f.user,changed),'User concurrent unrelated or dependency change\n');
    const published=await f.host.publish({version:1,sessionId:input.session.sessionId,baselineSnapshotId:input.initialSnapshot.snapshotId,
      snapshotId:checked.snapshot.snapshotId,paths:['packages/b/index.js'],verificationRunIds:[checked.verification[0].runId]},ctx());
    assert.equal(published.state,change==='unrelated'?'published':'conflict');
    assert.equal(await readFile(path.join(f.user,changed),'utf8'),'User concurrent unrelated or dependency change\n');
    assert.equal(await readFile(path.join(f.user,'packages','b','index.js'),'utf8'),change==='unrelated'?'export const value=2;\n':'export const value=1;\n');
  });
});
