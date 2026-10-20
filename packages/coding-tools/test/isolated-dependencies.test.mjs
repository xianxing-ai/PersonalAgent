import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath,stat,lstat} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {prepareIsolatedCodingDependencies,capturePreparedDependencyFingerprintSync,capturePreparedDependencyFingerprint,createIsolatedCodingRepairHost,
  createWorkspaceCommandTool} from '../dist/index.js';

async function fixture(t) {
  const base=await mkdtemp(path.join(tmpdir(),'pa-dependency-copy-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const source=path.join(base,'source'),isolated=path.join(base,'isolated');await mkdir(source);await mkdir(isolated);
  const manifest={name:'public-fixture',version:'1.0.0',dependencies:{'fixture-lib':'1.0.0'}};
  const pinned={version:'1.0.0',resolved:'https://invalid.example/fixture-lib.tgz',integrity:'sha512-explicit-metadata-fixture'};
  const lock={lockfileVersion:3,packages:{'':manifest,'node_modules/fixture-lib':pinned}};
  const files={'package.json':JSON.stringify(manifest),'package-lock.json':JSON.stringify(lock),
    'main.cjs':"module.exports=require('fixture-lib');\n"};
  for(const [file,value]of Object.entries(files))for(const root of[source,isolated])await writeFile(path.join(root,file),value);
  await mkdir(path.join(source,'node_modules','fixture-lib'),{recursive:true});
  await writeFile(path.join(source,'node_modules','.package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'node_modules/fixture-lib':pinned}}));
  await writeFile(path.join(source,'node_modules','fixture-lib','package.json'),JSON.stringify({name:'fixture-lib',version:'1.0.0',main:'index.cjs'}));
  const dependency=path.join(source,'node_modules','fixture-lib','index.cjs');await writeFile(dependency,'module.exports=42;\n');
  const input={sourceRoot:await realpath(source),isolatedRoot:await realpath(isolated),deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  return {base,source,isolated,dependency,input,lock,pinned};
}

test('prepared locked dependencies run the original fixed recipe from an independent copy without installs',async t=>{
  const f=await fixture(t),fingerprint=capturePreparedDependencyFingerprintSync(f.source);
  const host=await createIsolatedCodingRepairHost({workspaceRoot:f.source,sessionRoot:path.join(f.base,'sessions'),workspaceId:'fixture',
    patch:{powerShellPath:'C:/Program Files/PowerShell/7/pwsh.exe'},recipes:[{recipeId:'node-test',packageIds:['root'],required:true}],
    prepareWorkspace:input=>prepareIsolatedCodingDependencies({...input,expectedFingerprint:fingerprint}),
    validatePreparedWorkspace:async({isolatedRoot})=>assert.equal(capturePreparedDependencyFingerprintSync(isolatedRoot),fingerprint),
    createCommandTool:({rootPath})=>createWorkspaceCommandTool({rootPath,recipes:[{id:'node-test',executable:process.execPath,
      args:['-e',"require('node:assert/strict').equal(require('./main.cjs'),42)"]}]})});
  const context={taskId:'actual-fixture',runId:'run-'+randomUUID(),argumentsDigest:'a'.repeat(64),authorizationRef:'explicit-fake-outer-grant',
    scopes:['workspace:read','workspace:write','workspace:apply','workspace:execute'],deadline:f.input.deadline,signal:f.input.signal};
  const started=await host.start({mode:'isolated'},context);
  const root=path.join(f.base,'sessions',started.session.sessionId,'workspace');
  const copied=path.join(root,'node_modules','fixture-lib','index.cjs');
  assert.equal((await stat(copied)).nlink,1);assert.notEqual((await stat(copied)).ino,(await stat(f.dependency)).ino);
  await writeFile(f.dependency,'module.exports=99;\n');
  assert.equal((await host.verify(started.session.sessionId,'node-test',{...context,runId:'verify-'+randomUUID()})).status,'VALID');
  await writeFile(copied,'module.exports=7;\n');assert.equal(await readFile(f.dependency,'utf8'),'module.exports=99;\n');
  await assert.rejects(host.verify(started.session.sessionId,'node-test',{...context,runId:'verify-'+randomUUID()}));
});

test('workspace links are remapped inside the candidate and main build outputs are never copied',async t=>{
  const f=await fixture(t),relative='packages/local';
  const pkg={name:'@fixture/local',version:'1.0.0'},root=JSON.parse(await readFile(path.join(f.source,'package.json'),'utf8'));
  root.dependencies['@fixture/local']='1.0.0';root.workspaces=['packages/*'];
  f.lock.packages['']=root;f.lock.packages[relative]=pkg;f.lock.packages['node_modules/@fixture/local']={resolved:relative,link:true};
  for(const target of[f.source,f.isolated]) {
    await writeFile(path.join(target,'package.json'),JSON.stringify(root));await writeFile(path.join(target,'package-lock.json'),JSON.stringify(f.lock));
    await mkdir(path.join(target,relative),{recursive:true});await writeFile(path.join(target,relative,'package.json'),JSON.stringify(pkg));
    await writeFile(path.join(target,relative,'index.js'),'module.exports=1;');
  }
  await mkdir(path.join(f.source,relative,'dist'));await writeFile(path.join(f.source,relative,'dist','old.js'),'main-only old output');
  await mkdir(path.join(f.source,'node_modules','@fixture'));
  // Windows temp roots may use an 8.3 alias. A junction retains that target
  // spelling, while the lock verifier uses the canonical source root.
  const originalWorkspace=await realpath(path.join(f.source,relative));
  const originalLink=path.join(f.source,'node_modules','@fixture','local');
  await symlink(originalWorkspace,originalLink,process.platform==='win32'?'junction':'dir');
  assert.equal((await lstat(originalLink)).isSymbolicLink(),true);
  assert.equal(await realpath(originalLink),await realpath(path.join(f.input.sourceRoot,relative)),
    'fixture link resolves to the exact original locked workspace before preparation');
  await writeFile(path.join(f.source,'node_modules','.package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{
    'node_modules/fixture-lib':f.pinned,'node_modules/@fixture/local':{resolved:relative,link:true}}}));
  const prepared=await prepareIsolatedCodingDependencies(f.input);
  assert.equal(prepared.ready,true,prepared.reason??'workspace dependency preparation did not become ready');
  assert.equal(await realpath(path.join(f.isolated,'node_modules','@fixture','local')),await realpath(path.join(f.isolated,relative)));
  await assert.rejects(readFile(path.join(f.isolated,relative,'dist','old.js')),{code:'ENOENT'});
});

test('same-version byte changes, copy races, missing metadata and external links are unavailable',async t=>{
  for(const mode of['same-version','copy-race','missing','external-link'])await t.test(mode,async t=>{
    const f=await fixture(t),fingerprint=capturePreparedDependencyFingerprintSync(f.source);
    if(mode==='same-version')await writeFile(f.dependency,'module.exports=43;\n');
    if(mode==='missing')await rm(path.join(f.source,'node_modules','fixture-lib','package.json'));
    if(mode==='external-link') {
      const outside=path.join(f.base,'outside');await mkdir(outside);await writeFile(path.join(outside,'private.txt'),'do not copy');
      await symlink(outside,path.join(f.source,'node_modules','fixture-lib','escape'),process.platform==='win32'?'junction':'dir');
    }
    const pending=prepareIsolatedCodingDependencies({...f.input,expectedFingerprint:fingerprint});
    if(mode==='copy-race')writeFileSync(f.dependency,'module.exports=44;\n');
    const result=await pending;assert.equal(result.ready,false);assert.ok(result.reason);
    await assert.rejects(readFile(path.join(f.isolated,'node_modules','fixture-lib','escape','private.txt')));
  });
});

test('cancelled preparation never installs or runs a command',async t=>{
  const f=await fixture(t),controller=new AbortController();controller.abort();
  await assert.rejects(prepareIsolatedCodingDependencies({...f.input,signal:controller.signal}),{code:'CANCELLED'});
});

test('worker fingerprints bundled package payload and refuses unlocked top-level packages',async t=>{
  const f=await fixture(t),bundled=path.join(f.source,'node_modules','fixture-lib','fixtures','node_modules','bundled');
  await mkdir(bundled,{recursive:true});await writeFile(path.join(bundled,'index.js'),'fixture payload');
  const fingerprint=await capturePreparedDependencyFingerprint(f.source,{signal:f.input.signal,deadline:f.input.deadline});
  assert.equal(fingerprint,capturePreparedDependencyFingerprintSync(f.source));
  assert.equal((await prepareIsolatedCodingDependencies({...f.input,expectedFingerprint:fingerprint})).ready,true);
  await mkdir(path.join(f.source,'node_modules','unlocked'));await writeFile(path.join(f.source,'node_modules','unlocked','index.js'),'not locked');
  await assert.rejects(capturePreparedDependencyFingerprint(f.source,{signal:f.input.signal,deadline:f.input.deadline}),{code:'UNSUPPORTED_CAPABILITY'});
});
test('worker cancellation and expiry settle before the caller can observe completion',async t=>{
  const f=await fixture(t),controller=new AbortController();
  const pending=capturePreparedDependencyFingerprint(f.source,{signal:controller.signal});controller.abort();
  await assert.rejects(pending,{code:'CANCELLED'});
  await assert.rejects(capturePreparedDependencyFingerprint(f.source,{signal:f.input.signal,deadline:new Date(0).toISOString()}),{code:'TIMEOUT'});
  assert.equal((await prepareIsolatedCodingDependencies({...f.input,expectedFingerprint:null})).ready,false,
    'a dependency-free authorization cannot silently accept newly added dependencies');
});
