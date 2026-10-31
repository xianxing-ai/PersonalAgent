import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {remoteMcpDirectoryDigest} from '@personal-agent/mcp';
import {createRemoteMcpRegistry} from '../electron/remote-mcp-registry.js';
import {createRemoteMcpConfig} from '../electron/remote-mcp-config.js';
import {createDesktopRemoteMcpServices} from '../electron/remote-mcp-services.js';
import {createRemoteMcpManagement} from '../electron/remote-mcp-management.js';
import {fixture,descriptor,directory,endpoint} from '../../../packages/mcp/test/remote-http-fixture.mjs';

const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
const definition=id=>({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor:{...descriptor,name:`mcp.remote.${id}`}},directoryDigest:remoteMcpDirectoryDigest(directory())});
class Window extends EventEmitter{constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.session={setPermissionRequestHandler(){},setPermissionCheckHandler(){}};this.webContents.setWindowOpenHandler=()=>{};Window.last=this;}
  isDestroyed(){return !!this.destroyed;}destroy(){this.destroyed=true;this.emit('closed');}show(){}focus(){}async loadFile(){}}
async function until(app,id,state){for(let i=0;i<500;i++){if(app.runtime.getTask(id).state===state)return;await new Promise(r=>setTimeout(r,10));}assert.fail('task did not reach '+state);}
async function idle(app){for(let i=0;i<500&&app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,10));assert.equal(app.activeTaskCount,0);}

test('multi-service management preserves original Runtime approvals, isolation and restart boundaries',async()=>{
  const parent=fileURLToPath(new URL('../../../.cache/mcp-management-multi/',import.meta.url));mkdirSync(parent,{recursive:true});
  const userData=mkdtempSync(path.join(parent,'case-')),a=await fixture(),b=await fixture(),file=path.join(userData,'service.json');
  let app,client,management,services;
  async function start(){const registry=createRemoteMcpRegistry({userData,safeStorage});
    services=await createDesktopRemoteMcpServices({registry,readRuntime:()=>app?.runtime,confirmConnection:request=>management.confirmConnection(request),fetchFor:id=>id==='a'?a.fetch:b.fetch});
    const handlers=new Map(),ipcMain={handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)};
    const legacy=services.get('legacy');management=createRemoteMcpManagement({BrowserWindow:Window,ipcMain,
      dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[file]})},owner:()=>({isDestroyed:()=>false}),
      config:legacy.config,host:legacy.host,services,application:()=>app,client:()=>client,namespace:'synthetic-multi',
      confirmAuthorization:async request=>request.isCurrent()});
    management.open();const window=Window.last;
    return (name,payload)=>handlers.get('desktop:remote-mcp')({sender:window.webContents,senderFrame:window.webContents.mainFrame},name,payload);
  }
  try{
    let call=await start();
    for(const id of ['a','b']){
      assert.equal((await call('new',{id})).ok,true);writeFileSync(file,JSON.stringify(definition(id)));
      assert.equal((await call('import')).ok,true);const saved=await call('save',{token:'',expiresAt:''});
      assert.equal(saved.ok,true);assert.equal(saved.value.status,'reassembly_required');
    }
    assert.equal(services.list().filter(item=>item.configured).length,2);
    management.close();await services.dispose();services=undefined;
    call=await start();assert.equal(services.tools.length,2);assert.ok(services.list().every(item=>!item.connected));
    app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-multi',tools:services.tools});
    client=new Client(app,Date.now);await client.connect();
    async function invoke(id){assert.equal((await call('select',{id})).ok,true);assert.equal((await call('connect')).ok,true);
      const submitted=await call('submit',{key:'public'});assert.equal(submitted.ok,true);const taskId=submitted.value.taskId;
      await until(app,taskId,'waiting_approval');assert.equal((await call('respond',{taskId,decision:'allow_once'})).ok,false);
      const approval=app.readHostToolTask(taskId).approval;
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      await until(app,taskId,'succeeded');const read=await call('task',{taskId});assert.equal(read.ok,true);
      assert.doesNotMatch(JSON.stringify(read),/public synthetic reference|"key"/);assert.ok(read.value.evidenceRefs.length);}
    await invoke('a');assert.equal(a.calls().length,1);assert.equal(b.calls().length,0);
    await invoke('b');assert.equal(b.calls().length,1);assert.equal((await call('select',{id:'a'})).ok,true);
    assert.equal((await call('revoke')).ok,true);assert.equal(services.get('b').host.snapshot().connected,true);
    assert.doesNotMatch(JSON.stringify(await call('state')),/synthetic-access-token|secretRef|configurationRef/);
  }finally{if(app){await idle(app);app.close();}management?.close();if(services)await services.dispose();await a.close();await b.close();}
});

test('management migration requires explicit consent, preserves legacy ciphertext and is idempotent',async()=>{
  const parent=fileURLToPath(new URL('../../../.cache/mcp-management-multi/',import.meta.url));mkdirSync(parent,{recursive:true});
  const userData=mkdtempSync(path.join(parent,'migration-')),original=createRemoteMcpConfig({userData,safeStorage});
  original.configure({...definition('legacy'),credential:{token:'synthetic-secret-token',expiresAt:new Date(Date.now()+60000).toISOString()}});original.dispose();
  const source=path.join(userData,'remote-mcp-config.json'),ciphertext=readFileSync(source),registry=createRemoteMcpRegistry({userData,safeStorage});
  const services=await createDesktopRemoteMcpServices({registry,readRuntime:()=>undefined,confirmConnection:async()=>false});
  const handlers=new Map(),ipcMain={handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)};let allowed=false;
  const legacy=services.get('legacy'),management=createRemoteMcpManagement({BrowserWindow:Window,ipcMain,dialog:{},owner:()=>({isDestroyed:()=>false}),
    config:legacy.config,host:legacy.host,services,application:()=>undefined,client:()=>undefined,namespace:'synthetic-migration',
    confirmAuthorization:async request=>allowed&&request.isCurrent()});
  management.open();const window=Window.last,call=(name,payload)=>handlers.get('desktop:remote-mcp')({sender:window.webContents,senderFrame:window.webContents.mainFrame},name,payload);
  try{
    assert.equal((await call('migrate',{id:'copy'})).ok,true);assert.equal(services.list().some(item=>item.id==='copy'),false);
    allowed=true;const migrated=await call('migrate',{id:'copy'});assert.equal(migrated.ok,true);assert.equal(migrated.value.status,'reassembly_required');
    assert.deepEqual(readFileSync(source),ciphertext);assert.equal((await call('migrate',{id:'copy'})).ok,true);
    assert.deepEqual(readFileSync(source),ciphertext);assert.doesNotMatch(JSON.stringify(await call('state')),/synthetic-secret-token|secretRef|configurationRef/);
  }finally{management.close();await services.dispose();}
});
