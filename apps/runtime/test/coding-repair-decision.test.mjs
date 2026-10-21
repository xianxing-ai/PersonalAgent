import assert from 'node:assert/strict';
import test from 'node:test';
import {OwnedWorkflowEngine} from '@personal-agent/agentarts';
import {createRuntimeApplication} from '../dist/application.js';

const name='decision.choose_candidate',version='1.0.0';
const candidates=(review='owned-review')=>[{id:'public-read',description:'Explicit Fake public source-read proposal'},
  {id:review,description:'Keep the original graph for review; do not execute a business operation'}];
const chosen=(id='public-read')=>({state:'selected',eligibleForRuntime:true,selected:{id,revision:1},reason:'selected'});

// Only the chooser/image are explicit Fakes. The default Runtime-generated decision
// adapter, original host task, SQLite, Policy, ToolGateway and Evidence are real.
function fixture(t,selection,{onChoose}={}) {
  let app,sequence=0;const calls=[];
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-decision-review',
    codingRepair:{image:{bindingId:'explicit-fake-unused-image',receiptSecret:async()=>assert.fail('no image request is expected'),
      advance:async()=>assert.fail('no image request is expected')}},
    proactiveDecision:{localChooser:{choose:async input=>{calls.push(input);await onChoose?.(input,app);return structuredClone(selection);}}},
    automaticTools:[{toolName:name,toolVersion:version}]});
  t.after(()=>app.close());
  return {app,calls,descriptor:app.tools.list().find(tool=>tool.name===name),
    async run(args={context:'Explicit Fake public decision',candidates:candidates(),requestId:'synthetic-choice'},options={}) {
      const request={commandId:'synthetic-choice-'+(++sequence),toolName:name,toolVersion:version,
        arguments:args,deadline:new Date(Date.now()+(options.deadlineMs??60_000)).toISOString()};
      const original=app.submitHostToolTask(request);await app.waitForHostToolTask(original.task.taskId);
      return app.readHostToolTask(original.task.taskId);
    }};
}

for(const [label,selection,ids,expected] of [
  ['eligible business choice',chosen(),candidates(),'public-read'],
  ['eligible owned review',chosen('owned-review'),candidates(),'owned-review'],
  ['uncertain business choice',{state:'review',eligibleForRuntime:false,selected:{id:'public-read',revision:1},reason:'uncertain'},candidates(),'owned-review'],
  ['uncertain owned review',{state:'review',eligibleForRuntime:false,selected:{id:'owned-review',revision:1},reason:'uncertain'},candidates(),'owned-review'],
  ['abstain',{state:'abstain',eligibleForRuntime:false,reason:'unavailable'},candidates(),'owned-review'],
  ['unknown selected ID',chosen('invented'),candidates(),'owned-review'],
  ['legacy review',{state:'abstain',eligibleForRuntime:false,reason:'invalid_response'},candidates('review'),'review'],
  ['owned review takes precedence',{state:'abstain',eligibleForRuntime:false,reason:'unavailable'},
    [...candidates('review'),{id:'owned-review',description:'Reserved owned graph abstention'}],'owned-review'],
])test(`default coding decision routes ${label} through the original confirmed read`,async t=>{
  const f=fixture(t,selection),read=await f.run({context:'Explicit Fake public decision',candidates:ids,requestId:'synthetic-'+label});
  assert.equal(read.task.state,'succeeded',JSON.stringify(read.task.error));assert.deepEqual(read.confirmed.result,{selectedId:expected});
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].candidates.map(item=>item.id),ids.map(item=>item.id));
  const [record]=f.app.runtime.readToolExecutions(read.task.taskId);
  assert.equal(record.toolName,name);assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');
  assert.equal(record.executionStarted,true);assert.ok(f.app.runtime.readEvidence(read.task.taskId).some(item=>item.evidenceId===record.evidenceId));
  assert.deepEqual(f.app.runtime.listTasks({limit:20}).items.map(task=>task.taskId),[read.task.taskId],
    'a local review result does not claim or create a teacher task');
});

test('an ineligible business choice without a supplied review candidate remains unavailable',async t=>{
  const f=fixture(t,{state:'review',eligibleForRuntime:false,selected:{id:'public-read',revision:1},reason:'uncertain'});
  const read=await f.run({context:'Explicit Fake insufficient evidence',candidates:[candidates()[0],{id:'other-read',description:'Other business proposal'}],requestId:'no-review'});
  assert.equal(read.task.state,'failed');assert.equal(read.task.error.code,'UNSUPPORTED_CAPABILITY');assert.equal(read.confirmed,undefined);
});

test('cancellation during an abstaining chooser cannot confirm the review fallback',async t=>{
  const f=fixture(t,{state:'abstain',eligibleForRuntime:false,reason:'cancelled'},{onChoose:(_input,app)=>{
    const [task]=app.runtime.listTasks({limit:10}).items;app.runtime.requestCancel(task.taskId,'Explicit Fake cancellation during local decision');
  }});
  const read=await f.run();assert.equal(f.calls.length,1);assert.equal(read.task.state,'cancelled');assert.equal(read.confirmed,undefined);
  assert.equal(f.app.runtime.readToolExecutions(read.task.taskId).some(record=>record.state==='confirmed'),false);
});

test('the original deadline still prevents a late review fallback from confirming',async t=>{
  const f=fixture(t,{state:'abstain',eligibleForRuntime:false,reason:'deadline'},{onChoose:input=>new Promise(resolve=>{
    if(input.signal.aborted)resolve();else input.signal.addEventListener('abort',resolve,{once:true});
  })});
  const read=await f.run(undefined,{deadlineMs:100});assert.equal(f.calls.length,1);
  assert.equal(read.task.state,'failed');assert.equal(read.task.error.code,'TIMEOUT');assert.equal(read.confirmed,undefined);
});

test('the confirmed owned-review result leaves the original sealed graph unknown with zero business proposals',async t=>{
  const f=fixture(t,{state:'review',eligibleForRuntime:false,selected:{id:'public-read',revision:1},reason:'uncertain'});
  const engine=new OwnedWorkflowEngine({checkpointSecret:'explicit-fake-review-checkpoint-key-at-least-32',externalHost:true,
    decisionTool:{name,version},prepareCandidates:async()=>[
      {id:'public-read',description:'Explicit Fake public read',value:{toolName:'workspace.read_text',toolVersion:'1.0.0',arguments:{path:'public.txt'}}},
      {id:'owned-review',description:'Reserved owned graph abstention',value:null,abstain:true}],
    receiptVerifier:{verify:async receipt=>receipt.proof==='explicit-fake-verifier'}});
  const request={workflowId:'F20',input:{goal:'Explicit Fake public source'},taskId:'synthetic-sealed-graph',controlRevision:1,
    sessionId:'synthetic-graph-session',requestId:'synthetic-graph-request',deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal,
    availableTools:[{name,version,inputSchema:f.descriptor.inputSchema},{name:'workspace.read_text',version:'1.0.0',
      inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}]};
  const first=await engine.advance(request),proposal=first.proposals[0];assert.equal(proposal.toolName,name);
  const read=await f.run(proposal.arguments);assert.equal(read.task.state,'succeeded');assert.equal(read.confirmed.result.selectedId,'owned-review');
  const second=await engine.advance({...request,checkpoint:first.checkpoint,receipts:[{nodeId:proposal.nodeId,proposalId:proposal.proposalId,
    operationId:proposal.operationId,inputDigest:proposal.inputDigest,state:'confirmed',result:read.confirmed.result,
    evidenceRefs:read.confirmed.evidenceRefs,proof:'explicit-fake-verifier'}]});
  assert.equal(second.state,'unknown');assert.equal(second.nodes[proposal.nodeId].state,'unknown');assert.deepEqual(second.proposals,[]);
  assert.match(second.nodes[proposal.nodeId].reason,/recheck/);assert.equal(f.calls.length,1);
});
