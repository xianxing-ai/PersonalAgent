import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {remoteMcpDirectoryDigest} from '@personal-agent/mcp';
import {createRemoteMcpRegistry} from '../electron/remote-mcp-registry.js';
import {createDesktopRemoteMcpServices} from '../electron/remote-mcp-services.js';
import {fixture,descriptor,directory,endpoint} from '../../../packages/mcp/test/remote-http-fixture.mjs';

const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
const deadline=()=>new Date(Date.now()+60000).toISOString(),signal=()=>new AbortController().signal;
const settings=id=>({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor:{...descriptor,name:`mcp.remote.${id}`}},directoryDigest:remoteMcpDirectoryDigest(directory())});
async function until(app,id,state){for(let i=0;i<500;i++){if(app.runtime.getTask(id).state===state)return;await new Promise(r=>setTimeout(r,10));}assert.fail('task did not reach '+state);}
async function idle(app){for(let i=0;i<500&&app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,10));assert.equal(app.activeTaskCount,0);}

test('product service composition uses one Runtime and independently revokes two configured hosts',async()=>{
  const parent=fileURLToPath(new URL('../../../.cache/mcp-services/',import.meta.url));mkdirSync(parent,{recursive:true});
  const userData=mkdtempSync(path.join(parent,'case-')),a=await fixture(),b=await fixture();
  let registry=createRemoteMcpRegistry({userData,safeStorage}),services,app;
  registry.add('a',settings('a'));registry.add('b',settings('b'));
  const assemble=()=>createDesktopRemoteMcpServices({registry,readRuntime:()=>app?.runtime,confirmConnection:async()=>true,fetchFor:id=>id==='a'?a.fetch:b.fetch});
  try{
    services=await assemble();assert.equal(services.tools.length,2);
    assert.ok(services.list().every(item=>!item.connected));
    await services.connect('a',{signal:signal(),deadline:deadline()});await services.connect('b',{signal:signal(),deadline:deadline()});
    app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-services',tools:services.tools});
    const client=new Client(app,Date.now);await client.connect();
    async function invoke(id){const host=services.get(id).host,args=host.arguments({key:'public'}),tool=host.tools[0].descriptor;
      const taskId=app.submitHostToolTask({commandId:`task-${id}`,toolName:tool.name,toolVersion:tool.version,arguments:args,deadline:deadline()}).task.taskId;
      await until(app,taskId,'waiting_approval');const approval=app.readHostToolTask(taskId).approval;
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      await until(app,taskId,'succeeded');return args;}
    await invoke('a');assert.equal(a.calls().length,1);assert.equal(b.calls().length,0);
    await services.revoke('a');assert.equal(services.get('b').host.snapshot().connected,true);
    const oldB=await invoke('b');assert.equal(b.calls().length,1);await idle(app);app.close();app=undefined;
    await services.dispose();registry=createRemoteMcpRegistry({userData,safeStorage});services=await assemble();
    assert.ok(services.list().every(item=>!item.connected));
    assert.throws(()=>services.get('a'));await services.connect('b',{signal:signal(),deadline:deadline()});
    assert.notEqual(services.get('b').host.arguments({key:'public'}).bindingRef,oldB.bindingRef);assert.equal(b.calls().length,1);
  }finally{if(app){await idle(app);app.close();}if(services)await services.dispose();await a.close();await b.close();}
});

test('duplicate internal tool names are explicitly unavailable rather than silently rebound',async()=>{
  const parent=fileURLToPath(new URL('../../../.cache/mcp-services/',import.meta.url));mkdirSync(parent,{recursive:true});
  const userData=mkdtempSync(path.join(parent,'collision-')),registry=createRemoteMcpRegistry({userData,safeStorage});
  registry.add('a',settings('a'));registry.add('b',settings('a'));
  const services=await createDesktopRemoteMcpServices({registry,readRuntime:()=>undefined,confirmConnection:async()=>true});
  try{
    assert.equal(services.tools.length,1);assert.equal(services.list().find(item=>item.id==='b').status,'identity_conflict');
    assert.equal(services.get('b').host,undefined);
    await assert.rejects(services.connect('b',{signal:signal(),deadline:deadline()}),{code:'NOT_FOUND'});
  }finally{await services.dispose();}
});
