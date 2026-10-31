import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createF20CaseConfiguration} from '../electron/f20-case-config-host.js';

// Synthetic local secure-storage adapter; production uses Electron safeStorage.
test('native-selected case is encrypted, bound to its workspace and fixed recipe, and never grants authority',async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'personal-agent-f20-case-')),root=path.join(temp,'workspace'),userData=path.join(temp,'user');
  await mkdir(root);await mkdir(path.join(root,'src'));await writeFile(path.join(root,'schema.json'),'{}');
  await writeFile(path.join(root,'src','api.js'),'export const value=1;');
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value,'utf8').reverse(),
    decryptString:value=>Buffer.from(value).reverse().toString('utf8')};
  const workspace={rootPath:root,bindingId:'synthetic-binding',recipeIds:['node-check'],checkFile:'src/api.js',available:()=>true};
  const open=()=>createF20CaseConfiguration({userData,safeStorage,readWorkspace:()=>workspace});
  const input={inputRef:'api-case',schemaFile:'schema.json',codeFile:'src/api.js',recipeId:'node-check',docTemplate:'Synthetic template',targetDoc:'docs/api.md'};
  const scope={taskId:'synthetic-task',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  try {
    const host=open();assert.deepEqual(host.snapshot(),{configured:false});assert.equal(host.resolveInput('api-case',scope),undefined);
    assert.deepEqual(host.setFromNativeSelection(input),{configured:true,inputRef:'api-case'});
    const raw=await readFile(path.join(userData,'f20-workflow-case.json'),'utf8');
    assert.doesNotMatch(raw,/schema\.json|api\.js|Synthetic template/);
    const selected=host.resolveInput('api-case',scope);assert.equal(selected.schemaFile,'schema.json');assert.equal(selected.codeFile,'src/api.js');
    assert.match(selected.sourceVersion,/^[a-f0-9]{64}$/);assert.equal(host.resolveInput('different',scope),undefined);
    assert.equal(host.resolveInput('api-case',{...scope,deadline:'2000-01-01T00:00:00.000Z'}),undefined);
    assert.deepEqual(open().resolveInput('api-case',scope),selected);
    workspace.available=()=>false;assert.equal(host.resolveInput('api-case',scope),undefined);
    workspace.available=()=>true;workspace.bindingId='changed';assert.deepEqual(host.snapshot(),{configured:false});
    workspace.bindingId='synthetic-binding';workspace.checkFile='other.js';assert.deepEqual(host.snapshot(),{configured:false});
    workspace.checkFile='src/api.js';
    assert.throws(()=>host.setFromNativeSelection({...input,schemaFile:'../private'}));
    assert.throws(()=>host.setFromNativeSelection({...input,recipeId:'arbitrary'}));
    assert.throws(()=>host.setFromNativeSelection({...input,codeFile:'schema.json'}));
    assert.deepEqual(host.resolveInput('api-case',scope),selected,'rejected edits preserve original case');
  } finally {await rm(temp,{recursive:true,force:true});}
});
