import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {remoteMcpDirectoryDigest} from '@personal-agent/mcp';
import {createRemoteMcpConfig} from '../electron/remote-mcp-config.js';
import {createDesktopRemoteMcpHost} from '../electron/remote-mcp-host.js';
import {createRemoteMcpManagement} from '../electron/remote-mcp-management.js';
import {fixture,endpoint,descriptor,directory} from '../../../packages/mcp/test/remote-http-fixture.mjs';

const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()}; // Explicit Fake encryption.
const definition=()=>({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor:{...descriptor,version:'2.0.0'}},directoryDigest:remoteMcpDirectoryDigest(directory())});
class Window extends EventEmitter {
  static all=[];
  constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};
    this.webContents.session={setPermissionRequestHandler(){},setPermissionCheckHandler(){}};this.webContents.setWindowOpenHandler=()=>{};Window.all.push(this);}
  isDestroyed(){return !!this.destroyed;}
  destroy(){this.destroyed=true;this.emit('closed');}
  show(){} focus(){} async loadFile(){}
}
function setup(extra={}){
  const parent=fileURLToPath(new URL('../../../.cache/mcp-management/',import.meta.url));mkdirSync(parent,{recursive:true});
  const userData=mkdtempSync(path.join(parent,'case-')),config=createRemoteMcpConfig({userData,safeStorage});
  if(extra.saved)config.configure({...definition(),credential:{token:'synthetic-token-only',expiresAt:new Date(Date.now()+60000).toISOString()}});
  const handlers=new Map(),ipcMain={handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)};
  let selected=path.join(userData,'definition.json'),answer=async()=>({response:1}),management;
  writeFileSync(selected,JSON.stringify(definition()));
  const host=createDesktopRemoteMcpHost({config,fetch:extra.fetch,confirmConnection:request=>management.confirmConnection(request)});
  management=createRemoteMcpManagement({BrowserWindow:Window,ipcMain,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[selected]}),showMessageBox:(...args)=>answer(...args)},
    owner:()=>({isDestroyed:()=>false}),config,host,application:()=>extra.app?.(),client:()=>extra.client?.(),namespace:'synthetic-management',
    confirmAuthorization:async request=>{const result=await answer(request);return result.response===1&&request.isCurrent();}}); // Explicit Fake card decision.
  management.open();const window=Window.all.at(-1);
  const call=(name,payload,event={sender:window.webContents,senderFrame:window.webContents.mainFrame})=>handlers.get('desktop:remote-mcp')(event,name,payload);
  return {config,host,management,window,userData,call,setAnswer:value=>{answer=value;},setFile:value=>{writeFileSync(selected,JSON.stringify(value));},
    async close(){management.close();await host.dispose();config.dispose();}};
}
async function until(app,id,state){for(let i=0;i<400;i++){if(app.runtime.getTask(id).state===state)return;await new Promise(r=>setTimeout(r,10));}assert.fail('task did not reach '+state);}
async function idle(app){for(let i=0;i<400 && app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,10));assert.equal(app.activeTaskCount,0);}

test('management IPC is limited to its own main frame and keeps credentials out of state',async()=>{
  const s=setup({saved:true});try{
    assert.equal((await s.call('state',undefined,{sender:{mainFrame:{}},senderFrame:{}})).ok,false);
    assert.equal((await s.call('state',undefined,{sender:s.window.webContents,senderFrame:{}})).ok,false);
    assert.equal((await s.call('state',{unexpected:true})).ok,false);
    assert.equal((await s.call('unknown')).ok,false);
    assert.doesNotMatch(JSON.stringify(await s.call('state')),/synthetic-token|secretRef|configurationRef/);
    assert.equal(s.window.options.webPreferences.sandbox,true);assert.equal(s.window.options.webPreferences.nodeIntegration,false);
    s.setFile({...definition(),credential:{token:'unapproved'}});assert.equal((await s.call('import')).ok,false);
    s.setFile({...definition(),tool:{...definition().tool,descriptor:{...descriptor,name:'workspace.read_text'}}});assert.equal((await s.call('import')).ok,false);
    s.setFile(definition());assert.equal((await s.call('import')).ok,true);
    const invalid=await s.call('save',{token:'private invalid token',expiresAt:'tomorrow'});
    assert.equal(invalid.ok,false);assert.match(invalid.error,/INVALID_ARGUMENT/);assert.doesNotMatch(invalid.error,/private invalid token|tomorrow/);
    assert.throws(()=>s.config.configure({...definition(),tool:{...definition().tool,descriptor:{...descriptor,name:'weather.forecast'}}}),{code:'INVALID_ARGUMENT'});
    assert.equal((await s.call('respond',{taskId:'unowned',expectedRevision:1,decision:'allow_once'})).ok,false);
  }finally{await s.close();}
});

test('save cancellation, window closure and concurrent revoke cannot resurrect a pending configuration',async()=>{
  for(const mode of ['deny','close','revoke']){
    const s=setup({saved:true});try{
      await s.call('import');let finish;
      const waiting=new Promise(resolve=>{finish=resolve;});s.setAnswer(()=>waiting);
      const pending=s.call('save',{token:'replacement-token',expiresAt:new Date(Date.now()+60000).toISOString()});
      await new Promise(resolve=>setImmediate(resolve));
      if(mode==='deny')finish({response:0});
      if(mode==='close'){s.window.destroy();finish({response:1});}
      if(mode==='revoke'){s.setAnswer(async()=>({response:1}));assert.equal((await s.call('revoke')).ok,true);finish({response:1});}
      const result=await pending;
      if(mode==='deny'){assert.equal(result.ok,true);assert.equal(s.config.snapshot().configured,true);}
      else {if(mode==='revoke')assert.equal(result.ok,false);assert.equal(s.config.snapshot().configured,mode!=='revoke');}
      if(mode!=='revoke')assert.equal(s.config.secretStore.read(s.config.binding().credential.secretRef,new AbortController().signal),'synthetic-token-only');
    }finally{await s.close();}
  }
});

test('legacy management approval IPC cannot grant; original Runtime readback and cancellation remain available',async()=>{
  const f=await fixture({requiredAuthorization:'Bearer synthetic-token-only'});let app,client;
  const s=setup({saved:true,fetch:f.fetch,app:()=>app,client:()=>client});
  app=createRuntimeApplication({path:path.join(s.userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-management',tools:s.host.tools});
  client=new Client(app,Date.now);await client.connect();
  try{
    assert.equal((await s.call('connect')).ok,true);assert.equal(f.calls().length,0);
    const submit=await s.call('submit',{key:'public'});assert.equal(submit.ok,true);const id=submit.value.taskId;
    await until(app,id,'waiting_approval');const read=(await s.call('task',{taskId:id})).value;
    assert.equal(read.approval.state,'pending');assert.equal(f.calls().length,0);
    assert.equal((await s.call('respond',{taskId:id,expectedRevision:read.approval.revision+1,decision:'allow_once'})).ok,false);
    await s.call('disconnect');assert.equal((await s.call('respond',{taskId:id,expectedRevision:read.approval.revision,decision:'allow_once'})).ok,false);
    assert.equal(f.calls().length,0);await s.call('connect');
    assert.equal((await s.call('respond',{taskId:id,expectedRevision:read.approval.revision,decision:'allow_once'})).ok,false);
    assert.equal(f.calls().length,0);assert.equal(app.runtime.getTask(id).state,'waiting_approval');
    assert.equal((await s.call('respond',{taskId:id,expectedRevision:read.approval.revision,decision:'allow_once'})).ok,false);
    assert.equal(f.calls().length,0);
    assert.equal((await s.call('cancel',{taskId:id})).ok,true);await idle(app);
    const unowned=app.submitHostToolTask({commandId:'other-host',toolName:descriptor.name,toolVersion:'2.0.0',arguments:s.host.arguments({key:'public'}),deadline:new Date(Date.now()+60000).toISOString()});
    assert.equal((await s.call('task',{taskId:unowned.task.taskId})).ok,false);
    app.runtime.requestCancel(unowned.task.taskId,'synthetic cleanup');await idle(app);
    await s.call('revoke');assert.equal((await s.call('submit',{key:'public'})).ok,false);assert.equal(f.calls().length,0);
  }finally{await idle(app);app.close();await s.close();await f.close();}
});

test('closing a window while native connection consent is pending prevents network activity',async()=>{
  const f=await fixture({requiredAuthorization:'Bearer synthetic-token-only'}),s=setup({saved:true,fetch:f.fetch});
  try{let finish;s.setAnswer(()=>new Promise(resolve=>{finish=resolve;}));const pending=s.call('connect');
    for(let i=0;i<100&&!finish;i++)await new Promise(r=>setTimeout(r,1));assert.ok(finish);
    s.window.destroy();finish({response:1});assert.equal((await pending).ok,false);assert.equal(f.requests.length,0);
  }finally{await s.close();await f.close();}
});
