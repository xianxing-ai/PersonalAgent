import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '../dist/application.js';
import {SyntheticWebSocket,identity,events} from '../../../packages/coordination/test/fixtures/websocket.mjs';

const target={gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic',transport:'wss',
  websocketUrl:'wss://agentarts.example.test/runtimes/synthetic/ws',allowHttpsFallback:true};
const scope=(app,taskId,overrides={})=>({expectedRevision:app.runtime.getTask(taskId).revision,
  deadline:new Date(Date.now()+3000).toISOString(),signal:new AbortController().signal,...overrides});
const status=(frame,state='unknown')=>({...identity(frame),type:'status',state,
  ...(state==='completed'?{events:events(JSON.stringify({kind:'tool_proposal',proposalId:'private-original-model-result',
    toolName:'fixture.read',toolVersion:'1.0.0',arguments:{}}))}:{}),
  ...(['failed','cancelled'].includes(state)?{code:'EXTERNAL_FAILURE'}:{})});
function fixture(database,{respond=(frame,socket)=>socket.receive(status(frame)),
  invokeRespond=(frame,socket)=>{socket.accepted(frame);socket.disconnect();},overrides={}}={}) {
  let invokes=0,statuses=0,fetches=0,executions=0;
  const sockets=[];
  const app=createAgentArtsRuntimeApplication({...target,path:database,
    authorizationProvider:{read:async()=>'Bearer synthetic-outer'},
    websocketAuthorizationProvider:{read:async()=>'Bearer synthetic-inner'},
    websocketFactory:()=>{
      const socket=new SyntheticWebSocket((frame,connection)=>{
        if(frame.type==='invoke'){invokes++;invokeRespond(frame,connection);}
        else if(frame.type==='status'){statuses++;respond(frame,connection);}
        else throw Error('Unexpected frame');
      });sockets.push(socket);return socket;
    },fetchImpl:async()=>{fetches++;throw Error('Unexpected HTTPS');},
    tools:[{descriptor:{name:'fixture.read',version:'1.0.0',inputSchema:{type:'object'},
      outputSchema:{type:'object'},sideEffect:'read',requiredScopes:[],idempotencySupport:true,recoverySupport:true,requiresPresence:false},
      execute:async()=>{executions++;return {};}}],...overrides});
  return {app,sockets,get invokes(){return invokes;},get statuses(){return statuses;},get fetches(){return fetches;},get executions(){return executions;}};
}
async function seed(h) {
  const client=new Client(h.app);await client.connect();
  const {taskId}=await client.call('task.submit',{goal:'Synthetic unknown cloud result',conversationId:'status-test'},
    {idempotencyKey:'status-original-task'});
  for(let n=0;n<200;n++) {
    const task=h.app.runtime.getTask(taskId);
    if(task.state==='waiting_reconciliation' && h.app.activeTaskCount===0)return taskId;
    if(['failed','succeeded'].includes(task.state))throw Error('Expected reconciliation hold');
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Task did not settle');
}
async function waitTask(h,taskId,state) {
  for(let n=0;n<200;n++) {
    const task=h.app.runtime.getTask(taskId);
    if(task.state===state && h.app.activeTaskCount===0)return task;
    if(['failed','succeeded'].includes(task.state))throw Error(`Unexpected task state: ${task.state}`);
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Task did not settle');
}
async function temporary(t) {
  const base=fileURLToPath(new URL('../../../.cache/agentarts-status-application-tests/',import.meta.url));
  await mkdir(base,{recursive:true});const directory=await mkdtemp(path.join(base,'case-'));
  t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(base));await rm(directory,{recursive:true,force:true});});
  return path.join(directory,'runtime.sqlite');
}

test('persisted instance/configuration survives actual reopen; completed status stores metadata while task stays unknown',async t=>{
  const database=await temporary(t),first=fixture(database);const taskId=await seed(first);
  const binding=first.app.runtime.loadCheckpoint(taskId,'competition-cloud-dispatch-binding');
  const context=first.app.runtime.loadCheckpoint(taskId,'competition-cloud-dispatch-context');
  const original=first.app.runtime.loadCheckpoint(taskId,'competition-cloud-unknown');
  assert.equal(binding.configurationRef,first.app.coordinationConfigurationRef);
  assert.equal(binding.invocation.serverInstanceId,'synthetic-instance');
  assert.equal(original.serverInstanceId,'synthetic-instance');assert.equal(original.accepted,true);
  assert.equal(context.snapshotVersion,'1.0');assert.equal(context.taskId,taskId);
  assert.deepEqual(context.invocation,binding.invocation);assert.equal(context.configurationRef,binding.configurationRef);
  assert.equal(context.request.phase,'initial');assert.equal(context.loop.step,1);
  assert.equal(context.request.deadline,first.app.runtime.loadCheckpoint(taskId,'application-deadline'));
  assert.equal(context.catalog,null);assert.equal(context.continuation,null);
  assert.deepEqual(context.privacyEligibility,{eligible:false,reason:'public-provenance-unavailable'});
  assert.equal(context.recovery,'unavailable');
  assert.doesNotMatch(JSON.stringify(context),/Synthetic unknown cloud result|Bearer/);
  first.app.close();
  const h=fixture(database,{respond:(frame,socket)=>socket.receive(status(frame,'completed'))});
  try {
    assert.deepEqual(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-dispatch-binding'),binding);
    assert.deepEqual(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-dispatch-context'),context);
    assert.deepEqual(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-unknown'),original);
    const before=h.app.runtime.getTask(taskId),inflight=h.app.runtime.loadCheckpoint(taskId,'competition-cloud-inflight');
    const observation=await h.app.queryCompetitionCloudStatus(taskId,scope(h.app,taskId));
    assert.equal(observation.state,'completed');assert.equal(observation.verification,'unverified');
    assert.equal(observation.serverInstanceId,'synthetic-instance');assert.equal(observation.configurationRef,binding.configurationRef);
    assert.equal(Object.hasOwn(observation,'events'),false);
    assert.equal(JSON.stringify(observation).includes('private-original-model-result'),false);
    assert.deepEqual(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-status-observation'),observation);
    assert.deepEqual(h.app.runtime.getTask(taskId),before);
    assert.deepEqual(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-inflight'),inflight);
    assert.deepEqual(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-unknown'),original);
    assert.equal(h.invokes,0);assert.equal(h.statuses,1);assert.equal(h.fetches,0);assert.equal(h.executions,0);
    assert.deepEqual(h.app.runtime.readEvidence(taskId),[]);
    assert.throws(()=>h.app.resumeTask(taskId),{code:'RESULT_UNKNOWN'});
    assert.throws(()=>h.app.resumeConfirmedTask(taskId),{code:'RESULT_UNKNOWN'});
    assert.equal(h.sockets[0].terminations,1);
  } finally {h.app.close();}
});

test('deployment, binding, receipt, revision, privacy and cancellation checks cannot leak cloud identity',async t=>{
  const database=await temporary(t),first=fixture(database),taskId=await seed(first);first.app.close();
  const moved=fixture(database,{overrides:{runtimeName:'other',websocketUrl:'wss://agentarts.example.test/runtimes/other/ws'}});
  try {
    await assert.rejects(moved.app.queryCompetitionCloudStatus(taskId,scope(moved.app,taskId)),{code:'UNAUTHORIZED'});
    assert.equal(moved.sockets.length,0);
  } finally {moved.app.close();}
  const h=fixture(database);
  try {
    await assert.rejects(h.app.queryCompetitionCloudStatus(taskId,scope(h.app,taskId,{expectedRevision:0})),{code:'REVISION_CONFLICT'});
    const original=h.app.runtime.loadCheckpoint(taskId,'competition-cloud-unknown');
    h.app.runtime.saveCheckpoint(taskId,'competition-cloud-unknown',0);
    await assert.rejects(h.app.queryCompetitionCloudStatus(taskId,scope(h.app,taskId)),{code:'RESULT_UNKNOWN'});
    h.app.runtime.saveCheckpoint(taskId,'competition-cloud-unknown',original);
    const binding=h.app.runtime.loadCheckpoint(taskId,'competition-cloud-dispatch-binding');
    h.app.runtime.saveCheckpoint(taskId,'competition-cloud-dispatch-binding',null);
    await assert.rejects(h.app.queryCompetitionCloudStatus(taskId,scope(h.app,taskId)),{code:'UNAUTHORIZED'});
    h.app.runtime.saveCheckpoint(taskId,'competition-cloud-dispatch-binding',binding);
    const cancelled=new AbortController();cancelled.abort();
    await assert.rejects(h.app.queryCompetitionCloudStatus(taskId,scope(h.app,taskId,{signal:cancelled.signal})),{code:'CANCELLED'});
    for(const marker of [0,null,false]) {
      h.app.runtime.saveCheckpoint(taskId,'private-copy-erasure',marker);
      await assert.rejects(h.app.queryCompetitionCloudStatus(taskId,scope(h.app,taskId)),{code:'UNAUTHORIZED'});
    }
    assert.equal(h.sockets.length,0);assert.equal(h.statuses,0);assert.equal(h.invokes,0);
    assert.equal(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-status-observation'),undefined);
  } finally {h.app.close();}
});

test('binding, dispatch context, catalog or task revision drift cannot publish a stale observation',async()=>{
  for(const changed of ['binding','revision','context','catalog']) {
    let h,taskId;
    h=fixture(':memory:',{respond:(frame,socket)=>{
      if(changed==='binding')h.app.runtime.saveCheckpoint(taskId,'competition-cloud-dispatch-binding',{configurationRef:'replaced'});
      else if(changed==='revision')h.app.runtime.transitionTask(taskId,'cancelling');
      else h.app.runtime.saveCheckpoint(taskId,changed==='context'?'competition-cloud-dispatch-context':'competition-tool-catalog',null);
      socket.receive(status(frame,'completed'));
    }});
    try {
      taskId=await seed(h);
      await assert.rejects(h.app.queryCompetitionCloudStatus(taskId,scope(h.app,taskId)),
        {code:changed==='binding'?'UNAUTHORIZED':changed==='revision'?'REVISION_CONFLICT':'RESULT_UNKNOWN'});
      assert.equal(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-status-observation'),undefined);
      assert.ok(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-inflight'));
      assert.ok(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-unknown'));
      assert.equal(h.invokes,1);assert.equal(h.statuses,1);assert.equal(h.executions,0);
    } finally {h.app.close();}
  }
});

test('initial catalog and confirmed continuation snapshots survive reopen without body persistence or recovery',async t=>{
  const database=await temporary(t),snapshots=[];let h,executions=0;
  const proposal={kind:'tool_proposal',proposalId:'snapshot-read',toolName:'fixture.read',toolVersion:'1.0.0',
    arguments:{id:'synthetic-private-argument'}};
  const overrides={responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',
    competitionToolAvailability:[{toolName:'fixture.read',toolVersion:'1.0.0',available:()=>true}],
    competitionToolExports:[{toolName:'fixture.read',toolVersion:'1.0.0',exportPolicyVersion:'snapshot-v1',
      accepts:()=>true,project:({result})=>result}],
    tools:[{descriptor:{name:'fixture.read',version:'1.0.0',inputSchema:{type:'object',required:['id'],
      properties:{id:{type:'string'}}},outputSchema:{type:'object',required:['value'],properties:{value:{type:'string'}}},
      sideEffect:'read',requiredScopes:['fixture:read'],idempotencySupport:true,recoverySupport:true,requiresPresence:false},
      execute:async()=>{executions++;return {value:'synthetic-private-continuation-body'};}}]};
  h=fixture(database,{overrides,invokeRespond:(frame,socket)=>{
    const taskId=h.app.runtime.listTasks({}).items[0].taskId;
    snapshots.push(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-dispatch-context'));
    socket.accepted(frame);
    if(snapshots.length===1)socket.result(frame,JSON.stringify(proposal));else socket.disconnect();
  }});
  let taskId;
  try {
    const client=new Client(h.app);await client.connect();
    ({taskId}=await client.call('task.submit',{goal:'Snapshot a synthetic continuation',conversationId:'snapshot-test'},
      {idempotencyKey:'snapshot-continuation'}));
    await waitTask(h,taskId,'waiting_approval');
    const approval=(await client.call('approval.list',{taskId})).items[0];
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await waitTask(h,taskId,'waiting_reconciliation');
    assert.equal(snapshots.length,2);assert.equal(executions,1);
    assert.equal(snapshots[0].request.phase,'initial');assert.equal(snapshots[1].request.phase,'continuation');
    assert.equal(snapshots[1].loop.step,2);assert.deepEqual(snapshots[1].catalog,snapshots[0].catalog);
    assert.match(snapshots[0].catalog.entriesDigest,/^[a-f0-9]{64}$/);
    assert.equal(snapshots[1].continuation.proposalId,proposal.proposalId);
    assert.match(snapshots[1].continuation.continuationDigest,/^[a-f0-9]{64}$/);
    assert.equal(snapshots[1].privacyEligibility.eligible,false);
    assert.doesNotMatch(JSON.stringify(snapshots),/synthetic-private-argument|synthetic-private-continuation-body|Snapshot a synthetic/);
  } finally {h.app.close();}
  const reopened=fixture(database,{overrides,respond:(frame,socket)=>socket.receive(status(frame,'completed'))});
  try {
    assert.deepEqual(reopened.app.runtime.loadCheckpoint(taskId,'competition-cloud-dispatch-context'),snapshots[1]);
    const before=reopened.app.runtime.getTask(taskId);
    assert.equal((await reopened.app.queryCompetitionCloudStatus(taskId,scope(reopened.app,taskId))).state,'completed');
    assert.deepEqual(reopened.app.runtime.getTask(taskId),before);assert.equal(executions,1);assert.equal(reopened.invokes,0);
    assert.throws(()=>reopened.app.resumeTask(taskId),{code:'RESULT_UNKNOWN'});
    const loop=reopened.app.runtime.loadCheckpoint(taskId,'competition-loop');
    reopened.app.runtime.saveCheckpoint(taskId,'competition-loop',{...loop,continuation:{...loop.continuation,result:{changed:true}}});
    await assert.rejects(reopened.app.queryCompetitionCloudStatus(taskId,scope(reopened.app,taskId)),{code:'RESULT_UNKNOWN'});
    assert.equal(reopened.statuses,1);
  } finally {reopened.app.close();}
});

test('legacy records without dispatch context remain diagnostic only and are never backfilled',async()=>{
  const h=fixture(':memory:');
  const save=h.app.runtime.saveCheckpoint.bind(h.app.runtime);
  h.app.runtime.saveCheckpoint=(taskId,key,value)=>{if(key!=='competition-cloud-dispatch-context')save(taskId,key,value);};
  try {
    const taskId=await seed(h);
    assert.equal((await h.app.queryCompetitionCloudStatus(taskId,scope(h.app,taskId))).state,'unknown');
    assert.equal(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-dispatch-context'),undefined);
    assert.throws(()=>h.app.resumeTask(taskId),{code:'RESULT_UNKNOWN'});
    assert.throws(()=>h.app.resumeConfirmedTask(taskId),{code:'RESULT_UNKNOWN'});
    assert.equal(h.invokes,1);
  } finally {h.app.close();}
});

test('unknown status and cancelled/expired lookups retain the original hold without replay or observation on failure',async()=>{
  for(const mode of ['unknown','cancel','timeout']) {
    const h=fixture(':memory:',{respond:mode==='unknown'?(frame,socket)=>socket.receive(status(frame)):()=>{}});
    try {
      const taskId=await seed(h),before=h.app.runtime.getTask(taskId),controller=new AbortController();
      const pending=h.app.queryCompetitionCloudStatus(taskId,scope(h.app,taskId,{signal:controller.signal,
        ...(mode==='timeout'?{deadline:new Date(Date.now()+45).toISOString()}:{})}));
      if(mode==='unknown')assert.equal((await pending).state,'unknown');
      else {
        const rejected=assert.rejects(pending,{code:mode==='cancel'?'CANCELLED':'TIMEOUT'});
        while(h.statuses===0)await new Promise(resolve=>setImmediate(resolve));
        if(mode==='cancel')controller.abort();await rejected;
        assert.equal(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-status-observation'),undefined);
      }
      assert.deepEqual(h.app.runtime.getTask(taskId),before);
      assert.throws(()=>h.app.resumeTask(taskId),{code:'RESULT_UNKNOWN'});
      assert.equal(h.invokes,1);assert.equal(h.statuses,1);assert.equal(h.fetches,0);assert.equal(h.executions,0);
      assert.equal(h.sockets.at(-1).terminations,1);
    } finally {h.app.close();}
  }
});
