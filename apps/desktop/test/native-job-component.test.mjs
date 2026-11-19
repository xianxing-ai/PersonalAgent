import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {writeSelfContainedHelperBundle} from '../../../packages/coding-tools/native/helper-bundle.mjs';
import {publishNativeJob} from '../scripts/publish-native-job.mjs';
import {readPackagedNativeJobHelper} from '../electron/native-job-component.js';

const repoRoot=path.resolve(import.meta.dirname,'../../..');
test('formal resources stage preserves distinct Desktop and Job manifests and rejects changed Job files',async()=>{
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'pa-job-package-')));
  const outputRoot=path.join(root,'.cache/native-desktop-publish/release');
  const desktop=path.join(outputRoot,'resources/native-tools/desktop');await mkdir(desktop,{recursive:true});
  await writeFile(path.join(desktop,'component-manifest.json'),'Synthetic desktop manifest');
  let calls=0;
  const run=async(command,args,options)=>{
    calls++;assert.equal(command,process.execPath);assert.ok(args.includes('--self-contained'));assert.equal(options.cwd,root);
    const targetDir=args[args.indexOf('--target-dir')+1];
    assert.equal(targetDir,await realpath(targetDir));
    // Synthetic bytes validate packaging only; this test never launches a fake executable.
    for(const name of ['WindowsJobProcessHost.exe','WindowsJobProcessHost.dll','coreclr.dll','hostfxr.dll','hostpolicy.dll'])
      await writeFile(path.join(targetDir,name),'Synthetic '+name);
    await writeFile(path.join(targetDir,'WindowsJobProcessHost.runtimeconfig.json'),JSON.stringify({runtimeOptions:{includedFrameworks:[{name:'Microsoft.NETCore.App',version:'8.0.30'}]}}));
    await writeFile(path.join(targetDir,'WindowsJobProcessHost.deps.json'),JSON.stringify({runtimeTarget:{name:'.NETCoreApp,Version=v8.0/win-x64'}}));
    writeSelfContainedHelperBundle({targetDir,repoRoot,toolchain:{runtimeIdentifier:'win-x64'},sourceSha256:{}});
  };
  // An owned TEMP alias models Windows runner short/junction paths. Only the
  // publisher's newly created directory may be canonicalized, never input bundles.
  const actualTemp=path.join(root,'actual-temp'),aliasTemp=path.join(root,'alias-temp');
  await mkdir(actualTemp);await symlink(actualTemp,aliasTemp,process.platform==='win32'?'junction':'dir');
  const saved=Object.fromEntries(['TEMP','TMP','TMPDIR'].map(key=>[key,process.env[key]]));
  let result;
  try {
    for(const key of Object.keys(saved))process.env[key]=aliasTemp;
    result=await publishNativeJob({root,outputRoot,run});
  } finally {
    for(const [key,value] of Object.entries(saved)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
  assert.equal(result.component,'windows-job-process-host');assert.equal(result.selfContained,true);
  assert.equal(result.bundle,path.join(outputRoot,'resources/native-tools/workspace-command'));
  assert.equal(await readFile(path.join(desktop,'component-manifest.json'),'utf8'),'Synthetic desktop manifest');
  const pins=readPackagedNativeJobHelper(path.join(outputRoot,'resources'));
  assert.equal(pins.helperFilesSha256['job-component-manifest.json'],result.manifestSha256);
  const resourceAlias=path.join(root,'resource-alias');
  await symlink(path.join(outputRoot,'resources'),resourceAlias,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>readPackagedNativeJobHelper(resourceAlias));
  await assert.rejects(publishNativeJob({root,outputRoot,run}),{code:'EEXIST'});assert.equal(calls,1);
  await writeFile(path.join(result.bundle,'unexpected-runtime.dll'),'replacement');
  assert.throws(()=>readPackagedNativeJobHelper(path.join(outputRoot,'resources')));
});

test('packaged Job cannot borrow a Desktop component or a relative resources path',async()=>{
  assert.throws(()=>readPackagedNativeJobHelper('resources'));
  const root=await mkdtemp(path.join(tmpdir(),'pa-job-missing-'));
  await mkdir(path.join(root,'native-tools/desktop'),{recursive:true});
  assert.throws(()=>readPackagedNativeJobHelper(root));
});
