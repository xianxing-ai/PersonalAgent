import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createDesktopCloudPersistentHost} from '../electron/cloud-persistent-host.js';

const owner={runtimeId:'fixture-cloud',hostId:'fixture-host',deploymentVersion:'fixed-v1',contractRef:'fixture-contract',contractVersion:'1'};
function fixture() {
  mkdirSync('.cache',{recursive:true});const userData=mkdtempSync(join('.cache','desktop-cloud-'));
  const application=createRuntimeApplication({path:join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts'}),runtime=application.runtime;
  const source=runtime.submitTask({goal:'Explicit public fixture instruction',conversationId:'fixture-user',idempotencyKey:'fixture-source'});
  let mode='valid',calls=0;
  const runner={service:{list:()=>[{id:owner.hostId,enabled:true,version:1}],async submit(job){calls++;
    if(mode==='lost')throw Object.assign(Error('fixture dropped response'),{code:'RESULT_UNKNOWN'});
    const args={maxTokens:42},deadline=new Date(Date.now()+60_000).toISOString();
    return {accepted:true,location:'remote',hostId:owner.hostId,receipt:{state:'succeeded',data:{version:1,commandId:job.payload.commandId,owner,
      target:{taskId:'fixture-cloud-task',sessionId:'fixture-cloud-session'},task:{state:'waiting_approval',revision:2,cancelRequested:false},controlRevision:0,
      approvals:[{approvalId:'fixture-approval',revision:1,action:'fixture.read',arguments:mode==='redacted'?{}:args,
        argumentsDigest:toolArgumentsDigest(args),expiresAt:deadline,state:'pending'}],evidenceRefs:[]}}};}}};
  const create=()=>createDesktopCloudPersistentHost({application,getRunner:()=>runner,userData,resolveUserConversation:()=>source.conversationId});
  const configure=()=>writeFileSync(join(userData,'cloud-persistent-binding.json'),JSON.stringify({version:1,owner,originRuntimeId:'fixture-desktop',qualificationEvidenceRef:'fixture-only'}));
  return {application,runtime,source,create,configure,setMode:value=>{mode=value;},get calls(){return calls;},
    start:{sourceTaskId:source.taskId,commandId:'submit-one',taskDeadline:new Date(Date.now()+120_000).toISOString()}};
}
test('unconfigured cloud stays unavailable; changed approval display cannot authorize original arguments',async()=>{
  const f=fixture(),host=f.create();assert.equal(host.status().state,'unavailable');
  await assert.rejects(host.start(f.start),{code:'UNSUPPORTED_CAPABILITY'});assert.equal(f.calls,0);
  f.configure();f.setMode('redacted');await assert.rejects(host.start(f.start),{code:'RESULT_UNKNOWN'});
  assert.equal(host.status().sessions[0].transportState,'unknown');
  await assert.rejects(host.start(f.start),{code:'RESULT_UNKNOWN'});assert.equal(f.calls,1);f.application.close();
});
test('lost controls remain unknown after host reconstruction; only original readback can release the gate',async()=>{
  const f=fixture();f.configure();const host=f.create(),started=await host.start(f.start);
  f.setMode('lost');await assert.rejects(host.control({sourceTaskId:f.source.taskId,originCommandId:'submit-one',commandId:'pause-one',
    target:started.reply.target,control:{action:'pause',expectedControlRevision:0}}),{code:'RESULT_UNKNOWN'});
  const reopened=f.create();assert.equal(reopened.status().sessions[0].transportState,'unknown');
  await assert.rejects(reopened.control({sourceTaskId:f.source.taskId,originCommandId:'submit-one',commandId:'pause-two',
    target:started.reply.target,control:{action:'pause',expectedControlRevision:0}}),{code:'RESULT_UNKNOWN'});assert.equal(f.calls,2);
  f.runtime.requestCancel(f.source.taskId);f.setMode('valid');
  const observed=await reopened.read({sourceTaskId:f.source.taskId,originCommandId:'submit-one',commandId:'read-one'});
  assert.equal(observed.reply.target.taskId,started.reply.target.taskId);assert.equal(f.calls,3);f.application.close();
});
