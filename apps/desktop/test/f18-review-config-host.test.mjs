import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createF18ReviewConfiguration} from '../electron/f18-review-config-host.js';
import {createGitHubF18F19Tools} from '@personal-agent/github';

test('F18 native configuration pins repository, exact PR revision, CI and reviewer policy without accepting results or grants',async t=>{
  const cache=resolve('.cache/f18-config');await mkdir(cache,{recursive:true});const userData=await mkdtemp(join(cache,'selection-'));
  t.after(()=>rm(userData,{recursive:true,force:true}));let bindingId='original',encrypted=true;
  const options={userData,safeStorage:{isEncryptionAvailable:()=>encrypted,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},
    readRepositoryBinding:()=>({repository:'synthetic/repository',bindingId})}; // Explicit synthetic safeStorage, not OS encryption acceptance.
  const host=createF18ReviewConfiguration(options),configuration={selection:{repo:'synthetic/repository',prNumber:42,
    headSha:'a'.repeat(40),baseSha:'b'.repeat(40),mergeMethod:'merge'},requiredChecks:['technical-ci'],eligibleReviewers:['reviewer']};
  assert.deepEqual(host.snapshot(),{configured:false});assert.deepEqual(host.createPorts().configuredWorkflowWorkerPorts,[]);
  const saved=host.configureFromNativeSelection(configuration);assert.equal(saved.configured,true);
  assert.deepEqual(createF18ReviewConfiguration(options).snapshot(),saved);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(userData,'f18-review-selection.json'),'utf8'))).sort(),['encrypted','version']);
  let captured;
  const assembly={getApplication:()=>undefined,github:{createTools:policy=>{captured=policy;return createGitHubF18F19Tools({...policy,
    runner:{run:async()=>{throw Error('No transport in config-only fixture');}},readToken:async()=> 'synthetic-unused',repositories:['synthetic/repository']});},
    available:async()=>true,assertCurrent(){}},
    authorizeExport:async()=>false,requestPresence:async()=>{throw Error('No synthetic gesture');}};
  const ports=host.createPorts(assembly);
  const worker=ports.configuredWorkflowWorkerPorts[0],scope={taskId:'original',signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()};
  const input=await worker.resolveInput(configuration.selection,scope),{reviewRequirements,...selected}=input;
  assert.deepEqual(selected,configuration.selection);assert.match(reviewRequirements,/F18_N02 and F18_N03/);
  assert.deepEqual(captured.requiredChecks,['technical-ci']);
  for(const change of [{taskId:'injected'},{approved:true},{ciPassed:true},{requiredChecks:[]},{eligibleReviewers:[]}])
    assert.throws(()=>host.configureFromNativeSelection({...configuration,...change}));
  assert.throws(()=>host.configureFromNativeSelection({...configuration,selection:{...configuration.selection,repo:'foreign/repository'}}));
  host.configureFromNativeSelection({...configuration,requiredChecks:['replacement-ci']});
  assert.throws(()=>worker.assertCurrent(scope),{code:'UNAUTHORIZED'});
  const replacement=host.createPorts(assembly).configuredWorkflowWorkerPorts[0];
  assert.notEqual(replacement.configurationVersion,worker.configurationVersion);
  assert.equal(createF18ReviewConfiguration(options).createPorts(assembly).configuredWorkflowWorkerPorts[0].configurationVersion,
    replacement.configurationVersion,'same persisted native revision survives reopen; replaced policy has another worker binding');
  bindingId='replacement';assert.deepEqual(host.snapshot(),{configured:false});bindingId='original';
  encrypted=false;assert.deepEqual(host.snapshot(),{configured:false});encrypted=true;
  const linked=userData+'-link';await symlink(userData,linked,process.platform==='win32'?'junction':'dir');t.after(()=>rm(linked,{force:true}));
  const viaLink=createF18ReviewConfiguration({...options,userData:linked});assert.deepEqual(viaLink.snapshot(),{configured:false});
  assert.throws(()=>viaLink.configureFromNativeSelection(configuration),{code:'UNAUTHORIZED'});
  host.close();assert.deepEqual(host.snapshot(),{configured:false});
});

test('F18 native picker rejects oversized, injected or stale selections without replacing the original preference',async t=>{
  const cache=resolve('.cache/f18-config');await mkdir(cache,{recursive:true});const userData=await mkdtemp(join(cache,'picker-'));
  t.after(()=>rm(userData,{recursive:true,force:true}));let bindingId='original',selected,resolvePicker;
  const host=createF18ReviewConfiguration({userData,
    safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},
    readRepositoryBinding:()=>({repository:'synthetic/repository',bindingId}),selectFile:()=>selected});
  t.after(()=>host.close());
  const configuration={selection:{repo:'synthetic/repository',prNumber:42,headSha:'a'.repeat(40),baseSha:'b'.repeat(40),mergeMethod:'merge'},
    requiredChecks:['technical-ci'],eligibleReviewers:['reviewer']};
  selected=join(userData,'selected.json');await writeFile(selected,JSON.stringify(configuration));
  const saved=await host.selectFromNativeDialog();assert.equal(saved.configured,true);
  assert.equal(saved.prNumber,42);assert.equal('selection' in saved,false,'paths, policy details and authorization are not renderer state');
  for(const bytes of [' '.repeat(65537),JSON.stringify({...configuration,approved:true}),Buffer.from([0xff])]){
    await writeFile(selected,bytes);await assert.rejects(host.selectFromNativeDialog());assert.deepEqual(host.snapshot(),saved);
  }
  await writeFile(selected,JSON.stringify(configuration));const file=selected;
  selected=undefined;assert.deepEqual(await host.selectFromNativeDialog(),{cancelled:true});assert.deepEqual(host.snapshot(),saved);
  selected='relative.json';await assert.rejects(host.selectFromNativeDialog(),{code:'UNAUTHORIZED'});
  selected=new Promise(resolve=>{resolvePicker=resolve;});const changedBinding=host.selectFromNativeDialog();
  bindingId='replacement';resolvePicker(file);await assert.rejects(changedBinding,{code:'UNAUTHORIZED'});bindingId='original';
  selected=new Promise(resolve=>{resolvePicker=resolve;});const stale=host.selectFromNativeDialog();
  const replacement=host.configureFromNativeSelection({...configuration,requiredChecks:['replacement-ci']});
  resolvePicker(file);await assert.rejects(stale,{code:'UNAUTHORIZED'});assert.deepEqual(host.snapshot(),replacement);
  selected=new Promise(resolve=>{resolvePicker=resolve;});const closed=host.selectFromNativeDialog();
  host.close();resolvePicker(file);await assert.rejects(closed,{code:'UNAUTHORIZED'});
});
