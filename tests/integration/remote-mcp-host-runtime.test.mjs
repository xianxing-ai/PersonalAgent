import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {remoteMcpDirectoryDigest} from '@personal-agent/mcp';
import {createRemoteMcpConfig} from '../../apps/desktop/electron/remote-mcp-config.js';
import {createDesktopRemoteMcpHost} from '../../apps/desktop/electron/remote-mcp-host.js';
import {fixture,endpoint,descriptor,directory} from '../../packages/mcp/test/remote-http-fixture.mjs';

const token='synthetic-access-token-only';
const future=()=>new Date(Date.now()+60000).toISOString();
const signal=()=>new AbortController().signal;
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()}; // Explicit Fake encryption.
async function waitFor(app,taskId,state){
  for(let i=0;i<400;i++){const value=app.runtime.getTask(taskId);if(value.state===state)return value;await new Promise(resolve=>setTimeout(resolve,10));}
  throw Error('Expected Runtime task state '+state);
}
async function idle(app){for(let i=0;i<400&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(app.activeTaskCount,0);}
function location(){const parent=fileURLToPath(new URL('../../.cache/remote-mcp-runtime/',import.meta.url));mkdirSync(parent,{recursive:true});return mkdtempSync(path.join(parent,'case-'));}
function settings(){return {endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor:{...descriptor,version:'2.0.0'}},
  directoryDigest:remoteMcpDirectoryDigest(directory()),credential:{token,expiresAt:future()}};}
function assemble(userData,f){
  const config=createRemoteMcpConfig({userData,safeStorage});
  const host=createDesktopRemoteMcpHost({config,fetch:f.fetch,confirmConnection:async()=>true});
  return {config,host};
}
const application=(userData,host)=>createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-remote-mcp-user',tools:host.tools});
const submission=(host,commandId)=>({commandId,toolName:descriptor.name,toolVersion:'2.0.0',arguments:host.arguments({key:'public'}),deadline:future()});

test('encrypted MCP host uses original Runtime approval, confirmed execution/Evidence and does not replay after restart',async()=>{
  const userData=location(),f=await fixture({requiredAuthorization:`Bearer ${token}`});
  let config=createRemoteMcpConfig({userData,safeStorage});config.configure(settings());
  let host=createDesktopRemoteMcpHost({config,fetch:f.fetch,confirmConnection:async()=>true}),app;
  try{
    await host.connect({signal:signal(),deadline:future()});app=application(userData,host);
    const input=submission(host,'confirmed-read'),first=app.submitHostToolTask(input),taskId=first.task.taskId;
    await waitFor(app,taskId,'waiting_approval');assert.equal(f.calls().length,0);
    const approval=app.readHostToolTask(taskId).approval,client=new Client(app,Date.now);await client.connect();
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await waitFor(app,taskId,'succeeded');await idle(app);
    assert.deepEqual(app.readHostToolTask(taskId).confirmed.result,{text:'public synthetic reference'});
    const records=app.runtime.readToolExecutions(taskId),evidence=app.runtime.readEvidence(taskId);
    assert.equal(records.length,1);assert.equal(records[0].state,'confirmed');assert.equal(records[0].policyDecision,'allow');assert.equal(records[0].executionStarted,true);
    assert.equal(evidence[0].verification,'conditional');assert.equal(f.calls().length,1);
    assert.doesNotMatch(JSON.stringify([records,evidence,app.readHostToolTask(taskId)]),/synthetic-access-token|synthetic-secret/);
    assert.equal(app.submitHostToolTask(input).task.taskId,taskId);assert.equal(f.calls().length,1);
    app.close();app=undefined;await host.dispose();config.dispose();
    const baseline=f.requests.length;({config,host}=assemble(userData,f));app=application(userData,host);
    assert.equal(host.snapshot().connected,false);assert.equal(f.requests.length,baseline);
    assert.deepEqual(app.readHostToolTask(taskId).confirmed.result,{text:'public synthetic reference'});assert.equal(f.calls().length,1);
    assert.throws(()=>app.submitHostToolTask({...input,commandId:'old-envelope'}),{code:'INVALID_ARGUMENT'});
    assert.equal(readFileSync(path.join(userData,'runtime.sqlite')).includes(Buffer.from(token)),false);
  }finally{if(app){await idle(app);app.close();}await host.dispose();config.dispose();await f.close();}
});

test('a pending approval from an earlier host session cannot execute through the restored configuration',async()=>{
  const userData=location(),f=await fixture({requiredAuthorization:`Bearer ${token}`});
  let config=createRemoteMcpConfig({userData,safeStorage});config.configure(settings());
  let host=createDesktopRemoteMcpHost({config,fetch:f.fetch,confirmConnection:async()=>true}),app;
  try{
    await host.connect({signal:signal(),deadline:future()});app=application(userData,host);
    const input=submission(host,'pending-read'),taskId=app.submitHostToolTask(input).task.taskId;
    await waitFor(app,taskId,'waiting_approval');await idle(app);const approval=app.readHostToolTask(taskId).approval;
    app.close();app=undefined;await host.dispose();config.dispose();
    ({config,host}=assemble(userData,f));app=application(userData,host);const prior=f.requests.length;
    assert.equal(host.snapshot().connected,false);assert.equal(f.requests.length,prior);assert.equal(f.calls().length,0);
    await host.connect({signal:signal(),deadline:future()});
    const client=new Client(app,Date.now);await client.connect();
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await waitFor(app,taskId,'failed');await idle(app);assert.equal(f.calls().length,0);
    assert.equal(app.runtime.readToolExecutions(taskId).some(record=>record.executionStarted),false);
    const fresh=app.submitHostToolTask(submission(host,'fresh-read')).task.taskId;await waitFor(app,fresh,'waiting_approval');
    const next=app.readHostToolTask(fresh).approval;
    await client.call('authorization.respond',{approvalId:next.approvalId,expectedRevision:next.revision,decision:'allow_once'});
    await waitFor(app,fresh,'succeeded');assert.equal(f.calls().length,1);
  }finally{if(app){await idle(app);app.close();}await host.dispose();config.dispose();await f.close();}
});
