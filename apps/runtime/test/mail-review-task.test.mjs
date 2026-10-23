import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {AgentArtsCloudAgentPort,CompetitionCoordinator} from '@personal-agent/coordination';
import {createRuntimeApplication,createAgentArtsRuntimeApplication,MAIL_REVIEW_RESULT,parseMailReviewResult} from '../dist/application.js';
import {SyntheticWebSocket} from '../../../packages/coordination/test/fixtures/websocket.mjs';
const binding={workKey:'public-work',sourceRevision:'revision-1',projectionDigest:'a'.repeat(64),receiptId:'public-receipt'};
const answer={version:1,label:'work',impact:'routine',notificationRecommendation:'review',reasonCode:'work'};
async function wait(app,id,predicate){for(let i=0;i<200;i++){const task=app.runtime.getTask(id);if(predicate(task))return task;await new Promise(r=>setTimeout(r,5));}throw Error('Task did not settle');}
async function fixture(t,execute){
  const directory=await mkdtemp(path.join(os.tmpdir(),'pa-mail-review-'));let app,allowed=true,sends=0,guards=0,closed=false;
  const options={path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'mail-user',
    coordination:{execute:async request=>{sends++;app.assertCompetitionExportAllowed({...request,signal:new AbortController().signal});
      return execute?execute(request):{kind:'text',text:JSON.stringify(answer),verification:'unverified'};}},
    coordinationInput:{beforeCoordinationSend(){throw Error('Mail must not borrow conversation history');}},
    mailReview:{readEnvelope:async original=>({binding:original,labelKeys:['work','newsletter'],headers:{subject:'PUBLIC_HEADER_ONLY'}}),
      assertExport(original,envelope){guards++;assert.deepEqual(original,binding);assert.deepEqual(envelope.binding,binding);
        if(!allowed)throw Error('REVOKED_PRIVATE_MESSAGE');}}};
  app=createRuntimeApplication(options);const client=new Client(app,Date.now);await client.connect();
  t.after(async()=>{for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,5));if(!closed)app.close();await rm(directory,{recursive:true,force:true});});
  const request={commandId:'public-review',toolName:'mail.review',toolVersion:'1.0.0',arguments:binding,deadline:new Date(Date.now()+60000).toISOString()};
  const submit=()=>app.submitHostToolTask(request);
  const approve=async id=>{await wait(app,id,task=>task.state==='waiting_approval');const approval=app.readHostToolTask(id).approval;
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});};
  return {app,client,submit,approve,options,request,close(){app.close();closed=true;},get sends(){return sends;},get guards(){return guards;},revoke(){allowed=false;},directory};
}
test('strict mail review JSON accepts only caller labels and exact enum fields',()=>{
  assert.deepEqual(parseMailReviewResult(JSON.stringify(answer),['work']),answer);
  for(const value of [{...answer,label:'unknown'},{...answer,PRIVATE_EXTRA:'x'},{...answer,version:2},{...answer,impact:'critical'},
    {...answer,notificationRecommendation:'send'}, {...answer,reasonCode:'free text'}])
    assert.throws(()=>parseMailReviewResult(JSON.stringify(value),['work']),{code:'EXTERNAL_FAILURE'});
  assert.throws(()=>parseMailReviewResult('```json\n{}\n```',['work']),{code:'EXTERNAL_FAILURE'});
});
test('host mail review waits for Policy and sends no tools or history; persists safe result only',async t=>{
  const f=await fixture(t,async request=>{
    assert.equal(request.textOnly,true);assert.equal(request.availableTools,undefined);assert.equal(request.continuation,undefined);
    assert.equal(request.priorContinuations,undefined);
    assert.deepEqual(Object.keys(JSON.parse(request.goal)).sort(),['headers','instruction','labelKeys']);
    assert.match(request.goal,/PUBLIC_HEADER_ONLY/);return {kind:'text',text:JSON.stringify(answer),verification:'unverified'};
  });const id=f.submit().task.taskId;assert.equal(f.sends,0);await f.approve(id);
  assert.equal((await wait(f.app,id,task=>['succeeded','failed'].includes(task.state))).state,'succeeded');
  assert.deepEqual(f.app.runtime.loadCheckpoint(id,MAIL_REVIEW_RESULT),{binding,result:answer});assert.equal(f.sends,1);assert.ok(f.guards>=3);
  assert.equal(f.app.runtime.getTask(id).goal,'Host tool mail.review');
  assert.equal(JSON.stringify(f.app.runtime.loadCheckpoint(id,'mail-review-attempt:v1')).includes('PUBLIC_HEADER_ONLY'),false);
  f.submit();assert.equal(f.sends,1);
  assert.throws(()=>f.app.assertCompetitionExportAllowed({taskId:id,revision:f.app.runtime.getTask(id).revision,
    goal:'PUBLIC_HEADER_ONLY',textOnly:true,deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal}),{code:'UNAUTHORIZED'});
});
test('revoked exact export prevents cloud dispatch after tool approval',async t=>{
  const f=await fixture(t);const id=f.submit().task.taskId;f.revoke();await f.approve(id);
  await wait(f.app,id,task=>['failed','waiting_reconciliation'].includes(task.state));assert.equal(f.sends,0);
  assert.equal(f.app.runtime.loadCheckpoint(id,MAIL_REVIEW_RESULT),undefined);
});
test('tool proposal is rejected and no review result is fabricated',async t=>{
  const f=await fixture(t,async()=>({kind:'tool_proposal',proposalId:'x',toolName:'mail.inbox',toolVersion:'1.0.0',arguments:{},verification:'unverified'}));
  const id=f.submit().task.taskId;await f.approve(id);await wait(f.app,id,task=>['failed','waiting_reconciliation'].includes(task.state));
  assert.equal(f.app.runtime.loadCheckpoint(id,MAIL_REVIEW_RESULT),undefined);assert.equal(f.sends,1);
});
test('revocation during exchange rejects late result',async t=>{
  let release,entered;const started=new Promise(r=>entered=r);const gate=new Promise(r=>release=r);
  const f=await fixture(t,async()=>{entered();await gate;return {kind:'text',text:JSON.stringify(answer),verification:'unverified'};});
  const id=f.submit().task.taskId;await f.approve(id);await started;f.revoke();release();
  await wait(f.app,id,task=>['failed','waiting_reconciliation'].includes(task.state));assert.equal(f.app.runtime.loadCheckpoint(id,MAIL_REVIEW_RESULT),undefined);
});
test('failed cloud attempt stays durable and restart cannot resend its original host command',async t=>{
  const f=await fixture(t,async()=>{throw Error('PRIVATE_PROVIDER_DIAGNOSTIC');});const id=f.submit().task.taskId;
  await f.approve(id);await wait(f.app,id,task=>['failed','waiting_reconciliation'].includes(task.state));
  for(let i=0;i<200&&f.app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(f.sends,1);assert.ok(f.app.runtime.loadCheckpoint(id,'mail-review-attempt:v1'));f.close();
  let replaySends=0;const reopened=createRuntimeApplication({...f.options,coordination:{execute:async()=>{replaySends++;throw Error();}}});
  try {assert.equal(reopened.submitHostToolTask(f.request).task.taskId,id);await new Promise(r=>setTimeout(r,20));
    assert.equal(replaySends,0);assert.equal(reopened.runtime.loadCheckpoint(id,MAIL_REVIEW_RESULT),undefined);
  } finally {reopened.close();}
});
test('actual AgentArts adapter rechecks copied lease before HTTP and accepts no business catalog',async t=>{
  let sends=0;const f=await fixture(t);const cloud=new AgentArtsCloudAgentPort({gatewayUrl:'https://agentarts.example.test',runtimeName:'mail-review',
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json'}, {read:async()=> 'Bearer fixture'},async(_url,init)=>{
      sends++;const wire=JSON.parse(init.body);assert.equal(typeof wire.query,'string');assert.match(wire.query,/PUBLIC_HEADER_ONLY/);
      assert.equal(wire.query.includes('workspace.'),false);
      return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify({kind:'text',text:JSON.stringify(answer)})}}),
        {headers:{'content-type':'application/json'}});
    },request=>f.app.assertCompetitionExportAllowed(request),()=>{throw Error('No catalog permitted');});
  // The original injected port is immutable to application code; its fixture delegate selects the real adapter.
  const coordinator=new CompetitionCoordinator(cloud);f.options.coordination.execute=request=>coordinator.execute(request);
  t.after(()=>cloud.close());const id=f.submit().task.taskId;await f.approve(id);
  assert.equal((await wait(f.app,id,task=>['succeeded','failed','waiting_reconciliation'].includes(task.state))).state,'succeeded');
  assert.equal(sends,1);
});
test('cancellation during credential wait prevents actual HTTP and result publication',async t=>{
  let entered,release,sends=0;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const f=await fixture(t);
  const cloud=new AgentArtsCloudAgentPort({gatewayUrl:'https://agentarts.example.test',runtimeName:'mail-review',responseMode:'tool-proposal-json',
    initialRequestMode:'goal-with-tools-json'}, {read:async()=>{entered();await gate;return 'Bearer fixture';}},async()=>{sends++;throw Error();},
    request=>f.app.assertCompetitionExportAllowed(request));
  f.options.coordination.execute=request=>new CompetitionCoordinator(cloud).execute(request);t.after(()=>cloud.close());
  const id=f.submit().task.taskId;await f.approve(id);await started;f.app.runtime.requestCancel(id);release();
  await wait(f.app,id,task=>['cancelled','failed','waiting_reconciliation'].includes(task.state));
  assert.equal(sends,0);assert.equal(f.app.runtime.loadCheckpoint(id,MAIL_REVIEW_RESULT),undefined);
});

test('production WSS mail composition binds dispatch and preserves unknown sends',async t=>{
  for(const disconnect of [false,true])await t.test(disconnect?'unknown is not retried':'raw review JSON is consumed',async()=>{
    let app,sends=0;
    app=createAgentArtsRuntimeApplication({path:':memory:',hostUserNamespace:'mail-wss',
      gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic',transport:'wss',
      websocketUrl:'wss://agentarts.example.test/runtimes/synthetic/ws',responseMode:'tool-proposal-json',
      authorizationProvider:{read:async()=>'Bearer synthetic-outer'},
      websocketAuthorizationProvider:{read:async()=>'Bearer synthetic-inner'},
      websocketFactory:()=>new SyntheticWebSocket((frame,socket)=>{
        if(frame.type!=='invoke')return;sends++;
        const task=app.runtime.listTasks({}).items[0];
        const dispatch=app.runtime.loadCheckpoint(task.taskId,'competition-cloud-dispatch-context');
        assert.equal(dispatch.loop.maxSteps,1);assert.equal(dispatch.catalog,null);
        socket.accepted(frame);if(disconnect)socket.disconnect();else socket.result(frame,JSON.stringify(answer));
      }),fetchImpl:async()=>{throw Error('Unexpected HTTPS');},
      mailReview:{readEnvelope:async original=>({binding:original,labelKeys:['work','newsletter'],headers:{subject:'PUBLIC_HEADER_ONLY'}}),assertExport(){}}});
    try {
      const client=new Client(app);await client.connect();
      const request={commandId:'public-review',toolName:'mail.review',toolVersion:'1.0.0',arguments:binding,deadline:new Date(Date.now()+60000).toISOString()};
      const id=app.submitHostToolTask(request).task.taskId;
      await wait(app,id,task=>task.state==='waiting_approval');const approval=app.readHostToolTask(id).approval;
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      const task=await wait(app,id,task=>['succeeded','failed','waiting_reconciliation'].includes(task.state));
      assert.equal(task.state,disconnect?'waiting_reconciliation':'succeeded');assert.equal(sends,1);
      if(disconnect){assert.equal(app.runtime.loadCheckpoint(id,MAIL_REVIEW_RESULT),undefined);assert.ok(app.runtime.loadCheckpoint(id,'competition-cloud-unknown'));}
      else {assert.deepEqual(app.runtime.loadCheckpoint(id,MAIL_REVIEW_RESULT),{binding,result:answer});assert.equal(app.runtime.loadCheckpoint(id,'competition-cloud-inflight'),null);}
      app.submitHostToolTask(request);assert.equal(sends,1);
    } finally {for(let n=0;n<200&&app.activeTaskCount;n++)await new Promise(r=>setTimeout(r,5));app.close();}
  });
});
