import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile,symlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createF16F17CaseConfiguration} from '../electron/f16-f17-case-config-host.js';

test('F17 native case picker persists only configuration and rejects substituted bindings or injected receipts',async t=>{
  const base=resolve('.cache/f16-f17');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'selection-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  // Explicit fixture encryption; the production adapter calls Electron safeStorage.
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
  let bindingId='original-workspace-binding',permitted=true,selectedFile;
  const scope={taskId:'original',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  const options={userData:root,safeStorage,readWorkspace:()=>({bindingId,rootPath:root,
    command:{recipeIds:['npm-test']},available:()=>permitted}),selectFile:async()=>selectedFile};
  const selection={selectionRef:'project-tests',repository:'xianxing-ai/PersonalAgent',recipeId:'npm-test'};
  const host=createF16F17CaseConfiguration(options);
  assert.deepEqual(host.snapshot('F17'),{configured:false});
  selectedFile=join(root,'selected-case.json');await writeFile(selectedFile,JSON.stringify(selection));
  assert.deepEqual(await host.selectFromNativeDialog('F17'),{configured:true,selectionRef:'project-tests'});
  const original=host.read('F17',scope);assert.deepEqual(original.selection,selection);assert.match(original.configurationRef,/^[a-f0-9]{64}$/);
  assert.deepEqual(createF16F17CaseConfiguration(options).read('F17',scope),original);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(root,'f16-f17-workflow-cases.json'),'utf8'))).sort(),['encrypted','version']);
  for(const extra of [{headSha:'a'.repeat(40)},{initialFailure:{stdout:'invented'}},{taskId:'foreign'},{recipeId:'shell'}])
    assert.throws(()=>host.setFromNativeSelection('F17',{...selection,...extra}));
  permitted=false;assert.equal(host.read('F17',scope),undefined);permitted=true;
  bindingId='replacement';assert.deepEqual(host.snapshot('F17'),{configured:false});
  bindingId='original-workspace-binding';
  const expired={...scope,deadline:new Date(0).toISOString()};assert.equal(host.read('F17',expired),undefined);
  const controller=new AbortController();controller.abort();assert.equal(host.read('F17',{...scope,signal:controller.signal}),undefined);
  const changed=createF16F17CaseConfiguration({...options,selectFile:async()=>{bindingId='changed-in-dialog';return selectedFile;}});
  await assert.rejects(changed.selectFromNativeDialog('F17'),{code:'UNSUPPORTED_CAPABILITY'});
});

test('F17 native picker refuses oversized/link sources and unavailable secure storage',async t=>{
  const base=resolve('.cache/f16-f17');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'selection-'));
  t.after(()=>rm(root,{recursive:true,force:true}));let selected,encrypted=false;
  const options={userData:root,safeStorage:{isEncryptionAvailable:()=>encrypted,
    encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},
    readWorkspace:()=>({bindingId:'binding',rootPath:root,command:{recipeIds:['npm-test']},available:()=>true}),selectFile:async()=>selected};
  const host=createF16F17CaseConfiguration(options),selection={selectionRef:'project',repository:'xianxing-ai/PersonalAgent',recipeId:'npm-test'};
  assert.throws(()=>host.setFromNativeSelection('F17',selection));
  encrypted=true;
  selected=join(root,'large');await writeFile(selected,Buffer.alloc(256*1024+1));await assert.rejects(host.selectFromNativeDialog('F17'));
  const target=join(root,'case');await writeFile(target,JSON.stringify(selection));selected=join(root,'link');
  let fileLink=false;
  try{await symlink(target,selected);fileLink=true;}catch(error){
    // Windows ordinary users may lack SeCreateSymbolicLinkPrivilege. Only this
    // unavailable fixture primitive is replaced; the rejection test continues.
    if(process.platform!=='win32'||error.code!=='EPERM')throw error;
  }
  if(fileLink)await assert.rejects(host.selectFromNativeDialog('F17'),{code:'UNSUPPORTED_CAPABILITY'});
  const directory=join(root,'original-parent'),linked=join(root,'linked-parent');await mkdir(directory);
  await writeFile(join(directory,'case.json'),JSON.stringify(selection));
  await symlink(directory,linked,process.platform==='win32'?'junction':'dir');
  selected=linked;await assert.rejects(host.selectFromNativeDialog('F17'),{code:'UNSUPPORTED_CAPABILITY'});
  selected=join(linked,'case.json');await assert.rejects(host.selectFromNativeDialog('F17'),{code:'UNSUPPORTED_CAPABILITY'});
  selected=join(directory,'case.json');assert.deepEqual(await host.selectFromNativeDialog('F17'),{configured:true,selectionRef:'project'});
});
