import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {TaskRuntime} from '@personal-agent/runtime';
import {remoteMcpDirectoryDigest} from '@personal-agent/mcp';
import {createRemoteMcpConfig} from '../../apps/desktop/electron/remote-mcp-config.js';
import {createDesktopRemoteMcpHost} from '../../apps/desktop/electron/remote-mcp-host.js';
import {fixture,endpoint,descriptor,directory} from '../../packages/mcp/test/remote-http-fixture.mjs';

const deadline=()=>new Date(Date.now()+30000).toISOString();
async function until(app,id,state){
  for(let i=0;i<1000;i++){
    const task=app.runtime.getTask(id);if(task.state===state)return;
    if(['failed','waiting_reconciliation'].includes(task.state))assert.fail('Unexpected '+task.state+': '+JSON.stringify(task.error));
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail('Expected '+state);
}
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};

test('long-lived Desktop MCP retires only durable terminal receipts and reuses old runs without HTTP',async()=>{
  const parent=fileURLToPath(new URL('../../.cache/mcp-capacity-runtime/',import.meta.url));mkdirSync(parent,{recursive:true});
  const userData=mkdtempSync(path.join(parent,'case-')),f=await fixture();
  const config=createRemoteMcpConfig({userData,safeStorage});
  config.configure({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor:{...descriptor,version:'2.0.0'}},directoryDigest:remoteMcpDirectoryDigest(directory())});
  let app,host;
  const assemble=()=>createDesktopRemoteMcpHost({config,fetch:f.fetch,readRuntime:()=>app?.runtime,confirmConnection:async()=>true});
  host=assemble();
  app=createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'mcp-capacity',tools:host.tools});
  const client=new Client(app,Date.now);await client.connect();
  let first;
  try{
    await host.connect({signal:new AbortController().signal,deadline:deadline()});
    for(let i=0;i<130;i++){
      const args=host.arguments({key:'public'}),taskId=app.submitHostToolTask({commandId:'capacity-'+i,toolName:descriptor.name,toolVersion:'2.0.0',arguments:args,deadline:deadline()}).task.taskId;
      await until(app,taskId,'waiting_approval');
      const approval=app.readHostToolTask(taskId).approval;
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      await until(app,taskId,'succeeded');
      const record=app.runtime.readToolExecutions(taskId)[0];
      assert.equal(record.state,'confirmed');
      if(i===0)first={taskId,runId:record.evidenceId,args};
    }
    assert.equal(f.calls().length,130);
    const context={taskId:first.taskId,runId:first.runId,authorizationRef:first.runId,signal:new AbortController().signal,deadline:deadline(),scopes:descriptor.requiredScopes};
    const before=f.requests.length;
    assert.deepEqual(await host.tools[0].execute(first.args,context),{text:'public synthetic reference'});
    assert.equal(f.requests.length,before);
    await host.disconnect();await host.connect({signal:new AbortController().signal,deadline:deadline()});
    const reconnected=f.requests.length;
    assert.deepEqual(await host.tools[0].execute(first.args,context),{text:'public synthetic reference'});
    assert.equal(f.requests.length,reconnected);
    let release,started;
    const received=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    f.mode.beforeToolResult=()=>{started();return gate;};
    const pendingArgs=host.arguments({key:'public'}),pendingId=app.submitHostToolTask({commandId:'pending-handoff',toolName:descriptor.name,toolVersion:'2.0.0',arguments:pendingArgs,deadline:deadline()}).task.taskId;
    await until(app,pendingId,'waiting_approval');const approval=app.readHostToolTask(pendingId).approval;
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});await received;
    const other=new TaskRuntime(path.join(userData,'runtime.sqlite'));
    const staleHost=createDesktopRemoteMcpHost({config,fetch:f.fetch,readRuntime:()=>other,confirmConnection:async()=>true});
    try{
      const pendingRecord=other.readToolExecutions(pendingId)[0];assert.equal(pendingRecord.state,'started');
      assert.equal(other.getTask(pendingId).state,'running');
      await staleHost.connect({signal:new AbortController().signal,deadline:deadline()});const beforeStale=f.requests.length;
      const staleContext={...context,taskId:pendingId,runId:pendingRecord.evidenceId,authorizationRef:pendingRecord.evidenceId};
      await assert.rejects(host.tools[0].execute(pendingArgs,staleContext),{code:'RESULT_UNKNOWN'});
      await assert.rejects(staleHost.tools[0].execute(pendingArgs,staleContext),{code:'RESULT_UNKNOWN'});
      await assert.rejects(staleHost.tools[0].execute({...pendingArgs,arguments:{key:'changed'}},staleContext),{code:'REVISION_CONFLICT'});
      assert.equal(f.requests.length,beforeStale);
    }finally{await staleHost.dispose();other.close();release();delete f.mode.beforeToolResult;}
    await until(app,pendingId,'succeeded');
    await host.dispose();host=assemble();await host.connect({signal:new AbortController().signal,deadline:deadline()});
    const replaced=f.requests.length;
    assert.deepEqual(await host.tools[0].execute(first.args,context),{text:'public synthetic reference'});
    assert.equal(f.requests.length,replaced);assert.equal(f.calls().length,131);
    await assert.rejects(host.tools[0].execute({...first.args,arguments:{key:'changed'}},context),{code:'REVISION_CONFLICT'});
    assert.equal(f.requests.length,replaced);
  }finally{await host.dispose();app.close();config.dispose();await f.close();}
});
