import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initializeDefaultWorkspace,readSavedWorkspaceStatus} from '../electron/default-workspace.js';
import {createWorkspaceConfigHost} from '../electron/workspace-config-host.js';

const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
function fixture(t){
  const parent=path.resolve(os.tmpdir()),base=mkdtempSync(path.join(parent,'pa-default-workspace-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(base)),parent);rmSync(base,{recursive:true,force:true});});
  const userData=path.join(base,'profile'),workspace=path.join(userData,'Workspace');
  return {base,userData,workspace,target:path.join(userData,'coding-workspace.json')};
}

test('new profile receives an app-owned writable folder and the existing host reads it without granting access',t=>{
  const f=fixture(t);
  assert.equal(initializeDefaultWorkspace({...f,safeStorage}),true);
  const record=JSON.parse(readFileSync(f.target,'utf8'));
  assert.equal(record.version,1);
  assert.equal(Buffer.from(record.encrypted,'base64').toString(),f.workspace);
  assert.deepEqual(readdirSync(f.workspace),[]);
  assert.deepEqual(readSavedWorkspaceStatus({...f,safeStorage}),{configured:true,selectionAvailable:false,displayName:'Workspace',
    reason:'已保存；连接 AI 后装配工具，写入仍需原授权'});
  const host=createWorkspaceConfigHost({userData:f.userData,defaultWorkspace:f.workspace,safeStorage,findExecutable:()=>undefined});
  const state=host.snapshot();
  assert.equal(state.configured,true);assert.equal(state.displayName,'Workspace');assert.equal(state.selectionAvailable,false);
  assert.equal(state.cloudExportAllowed,false);assert.equal(state.writeAllowed,false);assert.equal(state.commandAllowed,false);
  host.close();
});

test('an existing selected or unreadable configuration is never replaced',t=>{
  const f=fixture(t);mkdirSync(f.userData,{recursive:true});
  const original='intentionally unreadable old configuration';writeFileSync(f.target,original);
  assert.equal(initializeDefaultWorkspace({...f,safeStorage}),false);
  assert.equal(readFileSync(f.target,'utf8'),original);assert.equal(existsSync(f.workspace),false);
  assert.equal(readSavedWorkspaceStatus({...f,safeStorage}).configured,false);
  const host=createWorkspaceConfigHost({userData:f.userData,defaultWorkspace:f.workspace,safeStorage,findExecutable:()=>undefined});
  assert.equal(host.snapshot().configured,false);
  assert.match(host.snapshot().reason,/加密配置不可用/);
  assert.equal(readFileSync(f.target,'utf8'),original);host.close();
});

test('unavailable encryption and paths outside the app profile do not create a configuration',t=>{
  const f=fixture(t);
  assert.throws(()=>initializeDefaultWorkspace({...f,safeStorage:{isEncryptionAvailable:()=>false}}));
  assert.equal(existsSync(f.target),false);assert.equal(existsSync(f.workspace),false);
  assert.throws(()=>initializeDefaultWorkspace({...f,workspace:path.join(f.base,'outside'),safeStorage}),/路径无效/);
  assert.equal(existsSync(path.join(f.base,'outside')),false);assert.equal(existsSync(f.target),false);
});
