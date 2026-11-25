import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeSelfContainedHelperBundle,readSelfContainedHelperBundle} from '../native/helper-bundle.mjs';
import {readWindowsNativeHelperAttestation,createWindowsNativeSandboxExecutor} from '../dist/windows-native-sandbox.js';

// Synthetic bytes test integrity only; no fake helper is executed or called real PSEC evidence.
const repoRoot=path.resolve(import.meta.dirname,'../../..');
function fixture(fdd=false){
  const root=realpathSync.native(mkdtempSync(path.join(tmpdir(),'pa-helper-bundle-'))),bundle=path.join(root,'helper');mkdirSync(bundle);
  for(const name of ['WindowsJobProcessHost.exe','WindowsJobProcessHost.dll',...(fdd?[]:['coreclr.dll','hostfxr.dll','hostpolicy.dll'])])
    writeFileSync(path.join(bundle,name),'Synthetic '+name);
  writeFileSync(path.join(bundle,'WindowsJobProcessHost.runtimeconfig.json'),JSON.stringify({runtimeOptions:fdd?
    {framework:{name:'Microsoft.NETCore.App',version:'8.0.0'}}:{includedFrameworks:[{name:'Microsoft.NETCore.App',version:'8.0.30'}]}}));
  writeFileSync(path.join(bundle,'WindowsJobProcessHost.deps.json'),JSON.stringify({runtimeTarget:{name:'.NETCoreApp,Version=v8.0/win-x64'}}));
  const helperPath=path.join(bundle,'WindowsJobProcessHost.exe');
  if(!fdd)writeSelfContainedHelperBundle({targetDir:bundle,repoRoot,toolchain:{runtimeIdentifier:'win-x64'},sourceSha256:{'Synthetic.cs':'a'.repeat(64)}});
  const pins=readWindowsNativeHelperAttestation(helperPath);
  return {root,bundle,helperPath,pins};
}
test('FDD attestation keeps its existing three companion pins and no self-contained manifest requirement',()=>{
  const f=fixture(true);assert.equal(readSelfContainedHelperBundle(f.helperPath),undefined);
  assert.deepEqual(Object.keys(f.pins.helperFilesSha256),['WindowsJobProcessHost.dll','WindowsJobProcessHost.deps.json','WindowsJobProcessHost.runtimeconfig.json']);
});
test('self-contained attestation binds its complete runtime, license and manifest inventory',()=>{
  const f=fixture();
  for(const name of ['coreclr.dll','hostfxr.dll','hostpolicy.dll','licenses/sources.json','job-component-manifest.json','job-component-manifest.sha256'])
    assert.match(f.pins.helperFilesSha256[name],/^[a-f0-9]{64}$/);
  assert.deepEqual(readSelfContainedHelperBundle(f.helperPath),{helperSha256:f.pins.helperSha256,helperFilesSha256:f.pins.helperFilesSha256});
});
for(const [name,change]of [
  ['replaced runtime',f=>writeFileSync(path.join(f.bundle,'coreclr.dll'),'replacement')],
  ['extra runtime',f=>writeFileSync(path.join(f.bundle,'extra-runtime.dll'),'extra')],
  ['nested extra file',f=>{mkdirSync(path.join(f.bundle,'extra'));writeFileSync(path.join(f.bundle,'extra/runtime.dll'),'extra');}],
  ['missing runtime',f=>unlinkSync(path.join(f.bundle,'hostpolicy.dll'))],
  ['missing manifest',f=>unlinkSync(path.join(f.bundle,'job-component-manifest.json'))],
  ['changed manifest checksum',f=>writeFileSync(path.join(f.bundle,'job-component-manifest.sha256'),'wrong')],
  ['unapproved runtime version',f=>{
    const file=path.join(f.bundle,'job-component-manifest.json'),value=JSON.parse(readFileSync(file));value.runtimeVersion='8.0.31';
    const bytes=Buffer.from(JSON.stringify(value));writeFileSync(file,bytes);
    writeFileSync(path.join(f.bundle,'job-component-manifest.sha256'),createHash('sha256').update(bytes).digest('hex')+'  job-component-manifest.json\n');
  }],
])test('attestation refuses '+name,()=>{const f=fixture();change(f);assert.throws(()=>readWindowsNativeHelperAttestation(f.helperPath));});

function request(f){
  const workspace=path.join(f.root,'workspace');mkdirSync(workspace);
  const node=realpathSync.native(process.execPath),systemRoot=realpathSync.native(process.env.SystemRoot);
  return {sandboxRef:'synthetic-bundle',revision:1,taskId:'task',runId:'run',authorizationRef:'grant',argumentsDigest:'a'.repeat(64),
    deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,maxOutputBytes:4096,
    profile:{sandboxRef:'synthetic-bundle',revision:1,mode:'workspace-write',backend:'windows-psec',readRoots:[path.dirname(node),systemRoot],
      writeRoots:[workspace],executableAllowlist:[node],network:{mode:'deny'}},executable:node,argv:['-e','process.exit(99)'],
    env:{SystemRoot:systemRoot,LOCALAPPDATA:workspace},cwd:workspace};
}
for(const duringApproval of [false,true])test('execute rejects changed complete inventory '+(duringApproval?'after the original authority await':'before original authority'),
  {skip:process.platform!=='win32'},async()=>{
    const f=fixture(),input=request(f);let calls=0;
    const change=()=>writeFileSync(path.join(f.bundle,'hostfxr.dll'),'replacement');
    if(!duringApproval)change();
    const executor=createWindowsNativeSandboxExecutor({...f.pins,assertCurrent:()=>{calls++;if(duringApproval)change();}});
    const result=await executor.execute(input);
    assert.equal(result.executionStarted,false);assert.equal(result.reason,'invalid-or-unavailable-trusted-configuration');
    assert.equal(calls,duringApproval?1:0);
  });
test('self-contained execution cannot use the old three-file-only pin set',{skip:process.platform!=='win32'},async()=>{
  const f=fixture(),input=request(f);
  const oldPins=Object.fromEntries(Object.entries(f.pins.helperFilesSha256).filter(([name])=>name.startsWith('WindowsJobProcessHost.')));
  const result=await createWindowsNativeSandboxExecutor({...f.pins,helperFilesSha256:oldPins,assertCurrent:()=>assert.fail('must reject before authority')}).execute(input);
  assert.equal(result.executionStarted,false);assert.equal(result.reason,'invalid-or-unavailable-trusted-configuration');
});
