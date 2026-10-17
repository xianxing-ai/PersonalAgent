import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {createAgentArtsTransportConfig} from '../electron/agentarts-transport-config.js';

const binding={gatewayUrl:'https://synthetic.huaweicloud-agentarts.com',runtimeName:'fixture'};
const publicToken='explicit-public-fixture-credential-1234567890';
const proposal={kind:'tool_proposal',proposalId:'fixture-proposal',toolName:'fixture.read',toolVersion:'1.0.0',arguments:{}};
const descriptor={name:proposal.toolName,version:proposal.toolVersion,
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  outputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},
  sideEffect:'read',requiredScopes:['fixture:read'],idempotencySupport:true,recoverySupport:true,requiresPresence:false};
const checkpoint='competition-configuration-binding';
async function waitFor(app,taskId,state){
  for(let i=0;i<200;i++){
    const current=app.runtime.getTask(taskId);
    if(current.state===state)return current;
    if(['failed','cancelled','waiting_reconciliation'].includes(current.state))throw Error('Unexpected task state: '+current.state);
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Task did not reach '+state);
}
async function fixture(t){
  const base=new URL('../../../.cache/deployment-approval-binding/',import.meta.url);
  await mkdir(base,{recursive:true});const directory=await mkdtemp(new URL('run-',base));
  let current={appToken:publicToken,deploymentVersion:'v1'},executions=0;
  const calls=[];
  function create(){
    const transport=createAgentArtsTransportConfig({binding,environment:{},configurationProvider:{read:()=>current},
      fetchImpl:async(url,init)=>{
        calls.push({url,body:JSON.parse(init.body)});
        const result=calls.length===1?proposal:{kind:'text',text:'Public fixture completed'};
        return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(result)}}),
          {headers:{'content-type':'application/json'}});
      }});
    return createAgentArtsRuntimeApplication({...binding,...transport,path:directory+'/runtime.sqlite',
      responseMode:'tool-proposal-json',authorizationProvider:{read:async()=> 'Bearer explicit-public-outer'},
      tools:[{descriptor,execute:async()=>{executions++;return {value:'public fixture'};}}],
      competitionToolExports:[{toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'fixture-v1',
        accepts:()=>true,project:({result})=>result}]});
  }
  const connect=async app=>{const client=new Client(app);await client.connect();return client;};
  const submit=async(app,client)=>{
    const {taskId}=await client.call('task.submit',{goal:'Read the public fixture',conversationId:'fixture'},
      {idempotencyKey:'original',timeoutMs:60_000});
    await waitFor(app,taskId,'waiting_approval');
    const approval=(await client.call('approval.list',{taskId})).items[0];
    return {taskId,approval};
  };
  const allow=(client,approval)=>client.call('authorization.respond',{approvalId:approval.approvalId,
    expectedRevision:approval.revision,decision:'allow_once'});
  return {create,connect,submit,allow,calls,dispose:()=>rm(directory,{recursive:true,force:true}),get executions(){return executions;},
    configure:version=>{current={...current,deploymentVersion:version};}};
}

test('HTTPS hot deployment change blocks original approval before grants, tools or continuation; restoring it can resume',async t=>{
  const f=await fixture(t),app=f.create();t.after(()=>{app.close();return f.dispose();});
  const client=await f.connect(app),{taskId,approval}=await f.submit(app,client);
  const original=app.runtime.loadCheckpoint(taskId,checkpoint);
  assert.match(original,/^[a-f0-9]{64}$/);assert.doesNotMatch(original,/fixture|credential/);
  f.configure('v2');
  await assert.rejects(f.allow(client,approval),{code:'REVISION_CONFLICT'});
  assert.throws(()=>app.resumeTask(taskId),{code:'REVISION_CONFLICT'});
  assert.equal(app.runtime.getApproval(approval.approvalId).state,'pending');
  assert.equal(app.runtime.policy.get(approval.approvalId),undefined);
  assert.equal(f.executions,0);assert.equal(f.calls.length,1);
  assert.equal(app.runtime.getTask(taskId).state,'waiting_approval');
  assert.equal(app.runtime.loadCheckpoint(taskId,checkpoint),original);
  f.configure('v1');await f.allow(client,approval);await waitFor(app,taskId,'succeeded');
  assert.equal(f.executions,1);assert.equal(f.calls.length,2);
  assert.ok(f.calls.every(call=>call.url.endsWith('?endpoint=v1')));
});

for(const version of ['v1','v2'])test(`SQLite HTTPS approval restart against ${version} keeps the original deployment`,async t=>{
  const f=await fixture(t);let app=f.create();
  try{
    let client=await f.connect(app);const {taskId,approval}=await f.submit(app,client);
    const original=app.runtime.loadCheckpoint(taskId,checkpoint);
    app.close();f.configure(version);app=f.create();client=await f.connect(app);
    assert.equal(app.runtime.loadCheckpoint(taskId,checkpoint),original);
    if(version==='v2'){
      await assert.rejects(f.allow(client,approval),{code:'REVISION_CONFLICT'});
      assert.equal(app.runtime.getApproval(approval.approvalId).state,'pending');
      assert.equal(app.runtime.policy.get(approval.approvalId),undefined);
      assert.equal(f.executions,0);assert.equal(f.calls.length,1);
      assert.equal(app.runtime.getTask(taskId).state,'waiting_approval');
    }else{
      await f.allow(client,approval);await waitFor(app,taskId,'succeeded');
      assert.equal(f.executions,1);assert.equal(f.calls.length,2);
      assert.ok(f.calls.every(call=>call.url.endsWith('?endpoint=v1')));
    }
  }finally{app.close();await f.dispose();}
});

test('legacy pending HTTPS task without its original deployment cannot acquire a new identity during approval',async t=>{
  const f=await fixture(t),app=f.create();t.after(()=>{app.close();return f.dispose();});
  const client=await f.connect(app),{taskId,approval}=await f.submit(app,client);
  app.runtime.saveCheckpoint(taskId,checkpoint,null);
  await assert.rejects(f.allow(client,approval),{code:'REVISION_CONFLICT'});
  assert.equal(app.runtime.getApproval(approval.approvalId).state,'pending');
  assert.equal(app.runtime.policy.get(approval.approvalId),undefined);
  assert.equal(f.executions,0);assert.equal(f.calls.length,1);
});
