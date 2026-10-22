import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,existsSync,linkSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createDeveloperSettingsHost} from '../electron/developer-settings-host.js';
import {createDesktopDeveloperDeployment} from '../electron/developer-deployment-config.js';
import {mountDeveloperControls} from '../src/features/admin/developer-controls.js';
import {developerSettingsError,developerSettingsErrorResponse,readDeveloperSettingsDiagnostic} from '../shared/developer-settings-diagnostics.js';

// Real product settings, filesystem validation, atomic encrypted-envelope writes and actual Main/
// renderer callbacks. Only encryption and the downstream tool provider are Synthetic; no gh runs.
const main=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const route=main.match(/  if\(\['developer.settings.read','developer.settings.configure','developer.settings.toggle'\]\.includes\(name\)\) \{[\s\S]*?\n  \}/)?.[0];
const handler=main.match(/ipcMain\.handle\('desktop:action', (async \(\.\.\.args\) => \{[\s\S]*?\n  \})\);/)?.[1];
const renderer=readFileSync(new URL('../src/app/renderer.js',import.meta.url),'utf8');
const invokeSource=renderer.match(/async function invoke\(action,payload\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(route&&handler&&invokeSource,'actual developer settings IPC route and invoke must be present');

async function fixture(t){
  const base=path.resolve('.cache/developer-settings-diagnostics');mkdirSync(base,{recursive:true});
  const directory=realpathSync(mkdtempSync(path.join(base,'case-')));
  const root=path.join(directory,'workspace'),cache=path.join(directory,'cache'),userData=path.join(directory,'user');
  for(const name of [root,cache,userData])mkdirSync(name);
  const file=path.join(root,'README.md');writeFileSync(file,'Synthetic public fixture\n');
  const executable=path.join(directory,'Synthetic-gh.exe');writeFileSync(executable,'never executed');chmodSync(executable,0o700);
  const secret='synthetic-private-token-never-display';let selected=true,saved=false,providers=0;
  const workspace={bindingId:'original-binding',rootPath:root,available:()=>true,assertCurrent(){}};
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
    decryptString:value=>Buffer.from(value).reverse().toString()};
  const settings=createDeveloperSettingsHost({userData,safeStorage,readWorkspace:()=>selected?workspace:undefined,
    readWorkspaceStatus:()=>({configured:saved}),readToolDescriptors:async()=>[],
    createDeployment:createDesktopDeveloperDeployment});
  t.after(()=>{settings.close();assert.equal(path.dirname(directory),realpathSync(base));rmSync(directory,{recursive:true,force:true});});
  await settings.createDeployment({cacheRootPath:cache,createHost:options=>{
    providers++;return {tools:[],competitionToolAvailability:[],competitionToolExports:[],unavailable:[],runtimeOptions:{},bind(){},
      close(){options.github?.provider.dispose();}};
  }});
  const configuration={version:1,repository:'synthetic/repository',github:{executable,environment:{},repairLinks:false},
    git:{sourceBranch:'main',remoteName:'origin',remoteUrl:'https://github.com/synthetic/repository.git',
      allowedPaths:['README.md'],authorName:'Synthetic Author',authorEmail:'synthetic@example.invalid'}};
  const admin={},context=vm.createContext({developerSettings:settings,competitionMode:true,admin,publish(){},
    developerSettingsError,developerSettingsErrorResponse,Error});
  const action=vm.runInContext(`(async function(event,name,payload){const sender=event.sender;${route}})`,context);
  context.action=action;const ipc=vm.runInContext(`(${handler})`,context);
  const invokeContext=vm.createContext({bridge:{invoke:(name,payload)=>ipc({sender:admin},name,payload)},
    activeDesktopConversationId:undefined,readDeveloperSettingsDiagnostic,Error});
  const invoke=vm.runInContext(`(${invokeSource})`,invokeContext);
  return {directory,root,userData,file,executable,secret,settings,safeStorage,configuration,invoke,ipc,admin,
    providers:()=>providers,setWorkspace(value,configured=false){selected=value;saved=configured;},
    request:()=>({enabled:true,configuration:structuredClone(configuration),token:secret})};
}

const noPrivateData=(value,f)=>{
  const serialized=JSON.stringify(value);for(const forbidden of [f.secret,f.directory,f.root,f.executable,'ENOENT','stack'])
    assert.equal(serialized.includes(forbidden),false,forbidden);
};

test('Synthetic actual Main settings route saves a valid schema form through the original deployment validator',async t=>{
  const f=await fixture(t),before=f.providers();
  const saved=await f.invoke('developer.settings.configure',f.request());
  assert.equal(saved.available,true);assert.equal(saved.tokenConfigured,true);assert.equal(saved.configuration.workflows,undefined);
  assert.equal(f.providers(),before+1);assert.equal(saved.configuration.git.allowedPaths[0],'README.md');
  const envelope=readFileSync(path.join(f.userData,'developer-settings.json'),'utf8');
  assert.equal(envelope.includes(f.secret),false);assert.equal(envelope.includes(f.root),false);
  await f.invoke('developer.settings.toggle',{enabled:false});assert.equal(f.settings.snapshot().available,false);
});

test('Synthetic Main distinguishes an unselected workspace from a saved selection awaiting original startup binding',async t=>{
  const f=await fixture(t);f.setWorkspace(false);
  for(const [configured,code]of [[false,'DEV_SETTINGS_WORKSPACE_REQUIRED'],[true,'DEV_SETTINGS_WORKSPACE_RESTART_REQUIRED']]){
    f.setWorkspace(false,configured);
    const reply=await f.ipc({sender:f.admin},'developer.settings.configure',f.request());
    assert.equal(reply.ok,false);assert.equal(reply.diagnostic.code,code);assert.match(reply.error,/开发 → 环境 \/ Worktrees/);
    assert.equal(f.settings.snapshot().workspace.requiresRestart,configured);noPrivateData(reply,f);
  }
  assert.equal(existsSync(path.join(f.userData,'developer-settings.json')),false);
});

test('Synthetic real allowlist and executable validation retains actionable categories without raw filesystem errors',async t=>{
  const f=await fixture(t);
  const linked=path.join(f.root,'linked.md');linkSync(f.file,linked);
  for(const [name,mutate,code]of [
    ['missing',request=>{request.configuration.git.allowedPaths=['missing-private-file.md'];},'DEV_SETTINGS_ALLOWED_FILE_UNAVAILABLE'],
    ['parent',request=>{request.configuration.git.allowedPaths=['../outside-private.md'];},'DEV_SETTINGS_ALLOWED_PATHS_INVALID'],
    ['directory',request=>{request.configuration.git.allowedPaths=['folder'];},'DEV_SETTINGS_ALLOWED_PATHS_INVALID'],
    ['hardlink',request=>{request.configuration.git.allowedPaths=['linked.md'];},'DEV_SETTINGS_ALLOWED_PATHS_INVALID'],
  ]){
    if(name==='directory')mkdirSync(path.join(f.root,'folder'));
    const request=f.request();mutate(request);
    const reply=await f.ipc({sender:f.admin},'developer.settings.configure',request);
    assert.equal(reply.ok,false);assert.equal(reply.diagnostic.code,code);noPrivateData(reply,f);
  }
  // Remove the hardlink before checking the unrelated executable fence.
  rmSync(linked);
  const request=f.request();request.configuration.github.executable=path.join(f.root,'missing-gh.exe');
  const reply=await f.ipc({sender:f.admin},'developer.settings.configure',request);
  assert.equal(reply.diagnostic.code,'DEV_SETTINGS_EXECUTABLE_INVALID');noPrivateData(reply,f);
  assert.equal(existsSync(path.join(f.userData,'developer-settings.json')),false);
  const saved=await f.invoke('developer.settings.configure',f.request());assert.equal(saved.available,true,'a corrected configuration can save without weakening the original fences');
});

test('Synthetic unknown provider/storage errors and forged diagnostic properties never expose secrets',async t=>{
  const f=await fixture(t);
  const forged=Object.assign(Error(f.secret+' '+f.root),{diagnostic:{code:'DEV_SETTINGS_ALLOWED_FILE_UNAVAILABLE'},code:'UNAUTHORIZED'});
  const response=developerSettingsErrorResponse(forged);
  assert.equal(response.diagnostic.code,'DEV_SETTINGS_SAVE_FAILED');noPrivateData(response,f);
  f.safeStorage.encryptString=()=>{throw forged;};
  const reply=await f.ipc({sender:f.admin},'developer.settings.configure',f.request());
  assert.equal(reply.diagnostic.code,'DEV_SETTINGS_STORAGE_WRITE_FAILED');noPrivateData(reply,f);
  const denied=await f.ipc({sender:{}},'developer.settings.configure',f.request());
  assert.equal(denied.diagnostic.code,'DEV_SETTINGS_ACCESS_DENIED');noPrivateData(denied,f);
});

test('Synthetic actual admin form receives the safe Main diagnosis, clears credentials and permits corrected retry',async t=>{
  const f=await fixture(t),elements=new Map(),handlers=new Map();
  const element=key=>{if(!elements.has(key))elements.set(key,{value:'',checked:false,addEventListener(name,fn){handlers.set(key+':'+name,fn);}});return elements.get(key);};
  const form=element('form');form.elements={namedItem:element};
  const section={querySelector:element,remove(){}};
  const original=globalThis.document;globalThis.document={createElement:()=>section};
  t.after(()=>{if(original===undefined)delete globalThis.document;else globalThis.document=original;});
  const control=mountDeveloperControls({append(){}},f.invoke);t.after(()=>control.close());
  control.render({configuration:f.configuration,workspace:{selected:false,requiresRestart:true}});
  assert.match(element('[data-developer-workspace]').textContent,/开发 → 环境 \/ Worktrees/);
  element('[data-developer-enabled]').checked=true;element('allowedPaths').value='not-there.md';element('token').value=f.secret;
  await handlers.get('form:submit')({preventDefault(){}});
  assert.match(element('[data-developer-feedback]').textContent,/DEV_SETTINGS_ALLOWED_FILE_UNAVAILABLE/);
  assert.equal(element('token').value,'');noPrivateData(element('[data-developer-feedback]').textContent,f);
  element('allowedPaths').value='README.md';element('token').value=f.secret;
  await handlers.get('form:submit')({preventDefault(){}});
  assert.match(element('[data-developer-feedback]').textContent,/已保存/);assert.equal(element('token').value,'');
  assert.equal(f.settings.snapshot().available,true);
});
