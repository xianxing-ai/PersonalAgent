import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '../dist/application.js';
import {EXECUTION_CAPACITY_CHECKPOINT} from '../dist/application/execution-capacity.js';
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

function progressiveFixture(database, {actions=7,maxSteps,unknownFinal=false}={}) {
  const snapshots=[],effects=[];
  let h;
  const name='fixture.progressive_read';
  const tool={descriptor:{name,version:'1.0.0',
    inputSchema:{type:'object',properties:{sequence:{type:'integer',minimum:0}},required:['sequence'],additionalProperties:false},
    outputSchema:{type:'object',properties:{sequence:{type:'integer'},localOnly:{type:'string'}},
      required:['sequence','localOnly'],additionalProperties:false},
    sideEffect:'read',requiredScopes:['fixture:read'],idempotencySupport:true,recoverySupport:true,requiresPresence:false},
    execute:async input=>{effects.push(input.sequence);return {sequence:input.sequence,localOnly:'PRIVATE_PROGRESSIVE_READ_BODY'};}};
  const overrides={responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',
    competitionMaxSteps:2,competitionExecution:{mode:'progressive',windowSteps:2,...(maxSteps===undefined?{}:{maxSteps})},
    retainPriorToolResults:true,tools:[tool],automaticTools:[{toolName:name,toolVersion:'1.0.0'}],
    competitionToolAvailability:[{toolName:name,toolVersion:'1.0.0',available:()=>true}],
    competitionToolExports:[{toolName:name,toolVersion:'1.0.0',exportPolicyVersion:'progressive-read-v1',
      accepts:()=>true,project:({result})=>({sequence:result.sequence})}]};
  h=fixture(database,{overrides,
    invokeRespond:(frame,socket)=>{
      const taskId=h.app.runtime.listTasks({}).items[0].taskId;
      const ordinal=snapshots.length;
      snapshots.push(h.app.runtime.loadCheckpoint(taskId,'competition-cloud-dispatch-context'));
      socket.accepted(frame);
      if(ordinal<actions)socket.result(frame,JSON.stringify({kind:'tool_proposal',proposalId:`progressive-read-${ordinal}`,
        toolName:name,toolVersion:'1.0.0',arguments:{sequence:ordinal}}));
      else if(unknownFinal)socket.disconnect();
      else socket.result(frame,JSON.stringify({kind:'text',text:'Synthetic progressive WSS read sequence complete'}));
    }});
  return {...h,get app(){return h.app;},get invokes(){return h.invokes;},get fetches(){return h.fetches;},snapshots,effects,overrides};
}

async function submitProgressive(h,key) {
  const client=new Client(h.app);await client.connect();
  const {taskId}=await client.call('task.submit',{goal:'Synthetic progressive WSS adapter regression',conversationId:key},
    {idempotencyKey:key,timeoutMs:60_000});
  return taskId;
}

async function settledProgressive(h,taskId) {
  const end=Date.now()+10_000;
  while(Date.now()<end) {
    const task=h.app.runtime.getTask(taskId);
    if(['succeeded','failed','waiting_reconciliation'].includes(task.state)&&h.app.activeTaskCount===0)return task;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail(`Progressive WSS task did not settle: ${JSON.stringify(h.app.runtime.getTask(taskId))}`);
}

test('actual WSS dispatch callback crosses the original window while preserving confirmed Runtime records',async()=>{
  const h=progressiveFixture(':memory:');
  try {
    const taskId=await submitProgressive(h,'progressive-wss-complete');
    const task=await settledProgressive(h,taskId);
    assert.equal(task.state,'succeeded',JSON.stringify(task.error));
    assert.deepEqual(h.effects,[0,1,2,3,4,5,6]);
    assert.equal(h.invokes,8);assert.equal(h.fetches,0);
    assert.deepEqual(h.snapshots.map(item=>item.loop.step),[1,2,3,4,5,6,7,8]);
    assert.ok(h.snapshots.every(item=>item.loop.maxSteps===2),'Persisted dispatch shape retains the original budget');
    assert.equal(h.app.runtime.loadCheckpoint(taskId,'competition-max-steps'),2);
    const capacity=h.app.runtime.loadCheckpoint(taskId,EXECUTION_CAPACITY_CHECKPOINT);
    assert.equal(capacity.initialWindowSteps,2);assert.ok(capacity.windowEndStep>=8);
    assert.equal(capacity.deadline,h.app.runtime.loadCheckpoint(taskId,'application-deadline'));
    const records=h.app.runtime.readToolExecutions(taskId);
    assert.equal(records.length,7);assert.equal(h.app.runtime.readEvidence(taskId).length,7);
    assert.ok(records.every(record=>record.state==='confirmed'&&record.policyDecision==='allow'&&record.executionStarted));
    assert.doesNotMatch(JSON.stringify(h.snapshots),/PRIVATE_PROGRESSIVE_READ_BODY|Synthetic progressive WSS adapter regression/);
  } finally {h.app.close();}
});

test('progressive WSS callback never dispatches beyond an explicit total limit',async()=>{
  const h=progressiveFixture(':memory:',{actions:20,maxSteps:5});
  try {
    const taskId=await submitProgressive(h,'progressive-wss-limit');
    const task=await settledProgressive(h,taskId);
    assert.equal(task.state,'failed');assert.equal(task.error.code,'TIMEOUT');
    assert.equal(h.invokes,5);assert.deepEqual(h.effects,[0,1,2,3]);
    assert.ok(h.snapshots.every(item=>item.loop.step<=5));
    assert.equal(h.app.runtime.loadCheckpoint(taskId,EXECUTION_CAPACITY_CHECKPOINT).windowEndStep,5);
    assert.equal(h.app.runtime.readToolExecutions(taskId).length,4);assert.equal(h.fetches,0);
  } finally {h.app.close();}
});

test('unknown invocation beyond the original window survives reopen as status-only with no replay',async t=>{
  const database=await temporary(t),first=progressiveFixture(database,{unknownFinal:true});
  let taskId,context,original,task,records;
  try {
    taskId=await submitProgressive(first,'progressive-wss-unknown');
    task=await settledProgressive(first,taskId);
    assert.equal(task.state,'waiting_reconciliation');assert.equal(first.invokes,8);
    context=first.app.runtime.loadCheckpoint(taskId,'competition-cloud-dispatch-context');
    original=first.app.runtime.loadCheckpoint(taskId,'competition-cloud-unknown');
    records=first.app.runtime.readToolExecutions(taskId);
    assert.equal(context.loop.step,8);assert.equal(context.loop.maxSteps,2);assert.equal(records.length,7);
  } finally {first.app.close();}
  const reopened=fixture(database,{overrides:first.overrides,respond:(frame,socket)=>socket.receive(status(frame,'completed'))});
  try {
    const observed=await reopened.app.queryCompetitionCloudStatus(taskId,scope(reopened.app,taskId));
    assert.equal(observed.state,'completed');assert.equal(observed.verification,'unverified');
    assert.deepEqual(reopened.app.runtime.getTask(taskId),task);
    assert.deepEqual(reopened.app.runtime.readToolExecutions(taskId),records);
    assert.deepEqual(reopened.app.runtime.loadCheckpoint(taskId,'competition-cloud-dispatch-context'),context);
    assert.deepEqual(reopened.app.runtime.loadCheckpoint(taskId,'competition-cloud-unknown'),original);
    assert.equal(reopened.invokes,0);assert.equal(reopened.statuses,1);assert.equal(reopened.executions,0);
    assert.equal(first.effects.length,7);
    assert.equal(Object.hasOwn(observed,'events'),false);
    assert.throws(()=>reopened.app.resumeTask(taskId),{code:'RESULT_UNKNOWN'});
    assert.throws(()=>reopened.app.resumeConfirmedTask(taskId),{code:'RESULT_UNKNOWN'});
  } finally {reopened.app.close();}
});

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

test('an original accepted status result completes the same Runtime handoff with one tool run and no invoke replay',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  let invokes=0,statuses=0,executions=0,egressChecks=0,outerReads=0,innerReads=0;
  const queries=[],received=[];
  const descriptor={name:'fixture.recovered-read',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],
    idempotencySupport:true,recoverySupport:true,requiresPresence:false,
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    outputSchema:{type:'object',properties:{value:{type:'integer'},localOnly:{type:'string'}},required:['value','localOnly'],additionalProperties:false}};
  const app=createAgentArtsRuntimeApplication({...target,path:':memory:',recoverAcceptedStatus:true,
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',continuationContext:'goal',retainPriorToolResults:true,
    beforeCompetitionSend:()=>{egressChecks++;},
    authorizationProvider:{read:async()=>{outerReads++;return 'Bearer synthetic-outer';}},
    websocketAuthorizationProvider:{read:async()=>{innerReads++;return 'Bearer synthetic-inner';}},
    websocketFactory:()=>new SyntheticWebSocket((frame,socket)=>{
      if(frame.type==='status') {
        statuses++;
        socket.receive({...identity(frame),type:'status',state:'completed',events:events(JSON.stringify({kind:'tool_proposal',
          proposalId:'original-recovered-proposal',toolName:descriptor.name,toolVersion:descriptor.version,arguments:{}}))});
      }else if(frame.type==='invoke') {
        invokes++;queries.push(frame.payload.query);socket.accepted(frame);
        // Only the first terminal frame is omitted; the status read recovers it.
        if(invokes===2)socket.result(frame,JSON.stringify({kind:'text',text:'Synthetic original task completed'}));
      }else assert.fail('No other invocation, cancellation or write is expected');
    }),fetchImpl:async()=>assert.fail('No HTTPS fallback or model retry'),
    tools:[{descriptor,execute:async()=>{executions++;return {value:7,localOnly:'PRIVATE_ORIGINAL_RECOVERY_RESULT'};}}],
    automaticTools:[{toolName:descriptor.name,toolVersion:descriptor.version}],
    competitionToolAvailability:[{toolName:descriptor.name,toolVersion:descriptor.version,available:()=>true}],
    competitionToolExports:[{toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'explicit-recovery-public-v1',
      accepts:()=>true,project:({result})=>({value:result.value})}]});
  const save=app.runtime.saveCheckpoint.bind(app.runtime);
  app.runtime.saveCheckpoint=(taskId,key,value)=>{
    if(key==='competition-cloud-received'&&value!==null)received.push(structuredClone(value));
    return save(taskId,key,value);
  };
  try {
    const client=new Client(app);await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'Explicit synthetic accepted-status recovery',conversationId:'recovery-fixture'},
      {idempotencyKey:'original-status-recovery',timeoutMs:60_000});
    for(let count=0;count<100&&!app.runtime.loadCheckpoint(taskId,'competition-cloud-inflight')?.accepted;count++)
      await new Promise(resolve=>setImmediate(resolve));
    assert.equal(invokes,1);assert.equal(statuses,0);assert.equal(executions,0);
    t.mock.timers.tick(30_000);
    for(let count=0;count<200&&app.activeTaskCount;count++)await new Promise(resolve=>setImmediate(resolve));
    const task=app.runtime.getTask(taskId);assert.equal(task.state,'succeeded',JSON.stringify(task.error));
    assert.equal(invokes,2,'Each original exchange is sent once; status is never a third invoke');
    assert.equal(statuses,1);assert.equal(executions,1);assert.equal(egressChecks,2);
    assert.equal(outerReads,3);assert.equal(innerReads,3,'The status read obtains current host credentials');
    assert.equal(received.length,2);assert.equal(new Set(received.map(value=>value.requestId)).size,2);
    const [record]=app.runtime.readToolExecutions(taskId);assert.equal(record.state,'confirmed');
    assert.equal(record.policyDecision,'allow');assert.equal(record.executionStarted,true);
    assert.equal(app.runtime.readEvidence(taskId).length,1);
    assert.equal(app.runtime.loadCheckpoint(taskId,'tool-result-'+record.evidenceId).result.localOnly,'PRIVATE_ORIGINAL_RECOVERY_RESULT');
    assert.doesNotMatch(queries.join('\n'),/PRIVATE_ORIGINAL_RECOVERY_RESULT/);
    assert.equal(app.runtime.loadCheckpoint(taskId,'competition-cloud-inflight'),null);
    assert.equal(app.runtime.loadCheckpoint(taskId,'competition-cloud-received'),null);
  }finally{app.close();}
});
