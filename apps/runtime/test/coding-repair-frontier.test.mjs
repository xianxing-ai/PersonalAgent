import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {createCodingRepairFrontierGuard} from '../dist/application/coding-repair-frontier.js';

// Synthetic receipts exercise the guard; they do not prove real independent review.
const source='synthetic source\n',sha=createHash('sha256').update(source).digest('hex');
const baseline={snapshotId:'before',packages:[{id:'pkg',path:'',dependencies:[]}],files:[{path:'app.js',sha256:sha,packageId:'pkg',kind:'source'}]};
const codingRepair={version:1,session:{version:1,sessionId:'session',taskId:'task',workspaceId:'workspace',mode:'main',baselineSnapshotId:'before'},
  initialSnapshot:baseline,recipes:[{recipeId:'test',packageIds:['pkg'],required:true}]};
function fixture({review=false,assertCurrent=()=>{}}={}) {
  const entries=new Map(),state={confirmedOperations:{},result:{nodes:{}},evidenceRefs:[]};let reference;
  const runtime={loadCheckpoint:(taskId,key)=>entries.get(taskId+':'+key),readToolExecutions:()=>[{evidenceId:'start',toolName:'coding.repair.start',
    toolVersion:'1.0.0',state:'confirmed',executionStarted:true,policyDecision:'allow'}],matchesToolExecutionInput:()=>true},
    app={runtime,readHostToolTask:id=>entries.get('read:'+id)},
    bridge={readReceipt:(_binding,proposal)=>({state:'confirmed',result:entries.get('result:'+proposal.operationId),
      evidenceRefs:entries.get('receipt-refs:'+proposal.operationId)})};
  entries.set('task:tool-result-start',{result:codingRepair});
  const independentReview=review?{read:()=>reference,assertCurrent}:undefined;
  const guard=createCodingRepairFrontierGuard(app,bridge,{taskId:'task',sessionId:'session',controlRevision:0,initialRunId:'start',codingRepair,allowedPaths:['app.js'],
    deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal,...(independentReview?{independentReview}:{})});
  function observed(nodeId,toolName,args,result,refs=['synthetic']) {
    const operationId=`op-${Object.keys(state.confirmedOperations).length}`,localTaskId='child-'+operationId;
    const proposal={kind:'tool_proposal',nodeId,operationId,toolName,toolVersion:'1.0.0',arguments:args};
    state.confirmedOperations[operationId]={nodeId,toolName,operationId,localTaskId,result};
    entries.set('task:owned-workflow:operation:'+operationId,{taskId:'task',sessionId:'session',workflowId:'F15',controlRevision:0,localTaskId,proposal});
    entries.set(localTaskId+':coding-repair:parent',{taskId:'task',operationId});
    entries.set('task:coding-repair:host:'+operationId,{localTaskId,request:{commandId:operationId,toolName,toolVersion:'1.0.0',arguments:args}});
    entries.set('read:'+localTaskId,{task:{state:'succeeded'},commandId:operationId,toolName,confirmed:{result,evidenceRefs:refs}});
    entries.set('result:'+operationId,result);entries.set('receipt-refs:'+operationId,refs);return operationId;
  }
  function selection(nodeId,value) {return observed(nodeId,'decision.choose_candidate',{
    context:JSON.stringify({workflowId:'F15',nodeId,candidateValues:[{id:'selected',value}]}),candidates:[{id:'selected'}]},
    {selectedId:'selected'});}
  function invoke(nodeId,toolName,args) {
    state.result.nodes[nodeId]={state:'waiting_receipt'};
    return guard({state,proposal:{kind:'tool_proposal',nodeId,toolName,toolVersion:'1.0.0',arguments:args}});
  }
  return {state,observed,selection,invoke,entries,reviewReference:value=>{reference=value;}};
}
test('F15 local preview binds selected scope, source digest and exact patch',()=>{
  const f=fixture(),patch={path:'app.js',expectedSha256:sha,edits:[{oldText:'synthetic',newText:'replacement'}]};
  f.observed('F15_N01','workspace.coding_snapshot',{sessionId:'session'},baseline);
  f.selection('F15_N02',{scope:['app.js']});
  f.observed('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'},{path:'app.js',sha256:sha,content:source});
  f.selection('F15_N03',{diagnosis:'synthetic',patches:[patch]});
  assert.doesNotThrow(()=>f.invoke('F15_N04','workflow.host.f15_n04',{sessionId:'session',patches:[patch]}));
  assert.throws(()=>f.invoke('F15_N04','workflow.host.f15_n04',{sessionId:'session',patches:[{...patch,edits:[]}]}),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.invoke('F15_N04','workflow.host.f15_n04',{sessionId:'other',patches:[patch]}),{code:'UNAUTHORIZED'});
});
test('F15 rejects missing snapshot, missing local decision and unbound tool aliases',()=>{
  const f=fixture();
  assert.throws(()=>f.invoke('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'}),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.invoke('F15_N01','coding.repair.patch',{sessionId:'session'}),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.invoke('F15_N01','workspace.coding_snapshot',{sessionId:'different'}),{code:'UNAUTHORIZED'});
});
test('F15 checks and publish remain unavailable without real independent redline review',()=>{
  const f=fixture();
  assert.throws(()=>f.invoke('F15_N05','workflow.host.f15_n05',{sessionId:'session'}),{code:'UNSUPPORTED_CAPABILITY'});
  assert.throws(()=>f.invoke('F15_N06','workflow.host.f15_n06',{sessionId:'session'}),{code:'UNSUPPORTED_CAPABILITY'});
});
test('incorrect source bytes cannot authorize a patch',()=>{
  const f=fixture();f.observed('F15_N01','workspace.coding_snapshot',{sessionId:'session'},baseline);
  f.selection('F15_N02',{scope:['app.js']});
  f.observed('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'},{path:'app.js',sha256:sha,content:'changed'});
  const patch={path:'app.js',expectedSha256:sha,edits:[{oldText:'synthetic',newText:'replacement'}]};
  f.selection('F15_N03',{diagnosis:'synthetic',patches:[patch]});
  assert.throws(()=>f.invoke('F15_N04','workflow.host.f15_n04',{sessionId:'session',patches:[patch]}),{code:'UNAUTHORIZED'});
});
test('a changed original HostIntent or start result cannot authorize a source read',()=>{
  const f=fixture(),operationId=f.observed('F15_N01','workspace.coding_snapshot',{sessionId:'session'},baseline);
  f.selection('F15_N02',{scope:['app.js']});
  const key='task:coding-repair:host:'+operationId,original=f.entries.get(key);
  f.entries.set(key,{...original,request:{...original.request,arguments:{sessionId:'other'}}});
  assert.throws(()=>f.invoke('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'}),{code:'UNAUTHORIZED'});
  f.entries.set(key,original);
  f.entries.set('task:tool-result-start',{result:{...codingRepair,session:{...codingRepair.session,workspaceId:'other'}}});
  assert.throws(()=>f.invoke('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'}),{code:'UNAUTHORIZED'});
});
test('configured review requires a matching original confirmed HostBridge operation and exact patch digest',()=>{
  const clock=Date.now;let revoked=false,expireDuringCheck=false;
  const f=fixture({review:true,assertCurrent:()=>{
    if(revoked)throw new ProtocolError('UNAUTHORIZED','Synthetic review authorization revoked');
    if(expireDuringCheck)Date.now=()=>clock()+120000;
  }}),patch={path:'app.js',expectedSha256:sha,edits:[{oldText:'synthetic',newText:'replacement'}]};
  f.observed('F15_N01','workspace.coding_snapshot',{sessionId:'session'},baseline);f.selection('F15_N02',{scope:['app.js']});
  f.observed('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'},{path:'app.js',sha256:sha,content:source});
  f.selection('F15_N03',{diagnosis:'synthetic',patches:[patch]});
  f.observed('F15_N04','workflow.host.f15_n04',{sessionId:'session',patches:[patch]},
    {sessionId:'session',approved:true,previewed:true,patches:[{path:'app.js',beforeSha256:sha,afterSha256:'a'.repeat(64),changed:true}]});
  const proposal={sessionId:'session',patches:[patch],recipeIds:['test']};
  assert.throws(()=>f.invoke('F15_N05','workflow.host.f15_n05',proposal),{code:'UNSUPPORTED_CAPABILITY'});
  const patchDigest=createHash('sha256').update(JSON.stringify([patch])).digest('hex');
  const review={version:1,sessionId:'session',snapshotId:'before',patchDigest,decision:'approved',reviewerId:'synthetic-independent-reviewer',
    reviewedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
  const operationId=f.observed('F15_N04','workflow.host.f15_independent_review',{sessionId:'session',snapshotId:'before',patchDigest},review,['real-synthetic-review-evidence']);
  f.reviewReference({localTaskId:'child-'+operationId,operationId});
  assert.doesNotThrow(()=>f.invoke('F15_N05','workflow.host.f15_n05',proposal));
  assert.deepEqual(f.state.evidenceRefs,['real-synthetic-review-evidence']);
  f.entries.set('receipt-refs:'+operationId,[]);
  assert.throws(()=>f.invoke('F15_N05','workflow.host.f15_n05',proposal),{code:'UNAUTHORIZED'});
  f.entries.set('receipt-refs:'+operationId,['replacement']);
  assert.throws(()=>f.invoke('F15_N05','workflow.host.f15_n05',proposal),{code:'UNAUTHORIZED'});
  f.entries.set('receipt-refs:'+operationId,['real-synthetic-review-evidence']);
  f.state.evidenceRefs=[];revoked=true;
  assert.throws(()=>f.invoke('F15_N05','workflow.host.f15_n05',proposal),{code:'UNAUTHORIZED'});
  assert.deepEqual(f.state.evidenceRefs,[]);revoked=false;expireDuringCheck=true;
  try{assert.throws(()=>f.invoke('F15_N05','workflow.host.f15_n05',proposal),{code:'TIMEOUT'});
    assert.deepEqual(f.state.evidenceRefs,[]);
  }finally{Date.now=clock;expireDuringCheck=false;}
  const key='task:coding-repair:host:'+operationId,original=f.entries.get(key);
  f.entries.set(key,{...original,request:{...original.request,arguments:{...original.request.arguments,patchDigest:'0'.repeat(64)}}});
  assert.throws(()=>f.invoke('F15_N05','workflow.host.f15_n05',proposal),{code:'UNAUTHORIZED'});
});

function twoRoundFixture() {
  const f=fixture(),firstPatch={path:'app.js',expectedSha256:sha,edits:[{oldText:'synthetic',newText:'replacement'}]};
  const secondSource='replacement source\n',secondSha=createHash('sha256').update(secondSource).digest('hex');
  const next={...baseline,snapshotId:'after-first',files:[{...baseline.files[0],sha256:secondSha}]};
  f.observed('F15_N01','workspace.coding_snapshot',{sessionId:'session'},baseline);
  f.selection('F15_N02',{scope:['app.js']});
  f.observed('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'},{path:'app.js',sha256:sha,content:source});
  f.selection('F15_N03',{diagnosis:'first',patches:[firstPatch]});
  f.observed('F15_N04','workflow.host.f15_n04',{sessionId:'session',patches:[firstPatch]},
    {sessionId:'session',approved:true,previewed:true,patches:[{path:'app.js',beforeSha256:sha,afterSha256:secondSha,changed:true}]});
  const result={version:1,sessionId:'session',snapshot:next,verification:[{version:1,sessionId:'session',runId:'test-run',recipeId:'test',
    packageIds:['pkg'],inputSnapshotId:next.snapshotId,files:next.files,exitCode:1,status:'FAILED',evidenceRefs:['test-evidence'],diagnostics:[]}]};
  const check=f.observed('F15_N05','workflow.host.f15_n05',{sessionId:'session',patches:[firstPatch],recipeIds:['test']},result);
  return {f,next,check,secondSource,secondSha};
}
test('new F15 round requires the original failed check snapshot and fresh decisions and reads',()=>{
  const {f,next,secondSource,secondSha}=twoRoundFixture();
  assert.throws(()=>f.invoke('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'}),{code:'UNAUTHORIZED'});
  f.observed('F15_N01','workspace.coding_snapshot',{sessionId:'session'},next);
  assert.throws(()=>f.invoke('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'}),{code:'UNAUTHORIZED'});
  f.selection('F15_N02',{scope:['app.js']});
  f.observed('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'},{path:'app.js',sha256:secondSha,content:secondSource});
  const patch={path:'app.js',expectedSha256:secondSha,edits:[{oldText:'replacement',newText:'final'}]};
  f.selection('F15_N03',{diagnosis:'second',patches:[patch]});
  assert.doesNotThrow(()=>f.invoke('F15_N04','workflow.host.f15_n04',{sessionId:'session',patches:[patch]}));
  assert.throws(()=>f.invoke('F15_N04','workflow.host.f15_n04',{sessionId:'session',patches:[{...patch,expectedSha256:sha}]}),{code:'UNAUTHORIZED'});
});
test('new F15 round rejects replaced snapshot and changed original failed check receipt',()=>{
  const {f,next,check}=twoRoundFixture();
  const snapshot=f.observed('F15_N01','workspace.coding_snapshot',{sessionId:'session'},next);
  f.selection('F15_N02',{scope:['app.js']});
  assert.doesNotThrow(()=>f.invoke('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'}));
  const record=f.state.confirmedOperations[snapshot];record.result={...next,snapshotId:'replacement'};
  assert.throws(()=>f.invoke('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'}),{code:'UNAUTHORIZED'});
  record.result=next;const receipt=f.entries.get('receipt-refs:'+check);f.entries.set('receipt-refs:'+check,['replacement']);
  assert.throws(()=>f.invoke('F15_N03','coding.repair.read',{sessionId:'session',path:'app.js'}),{code:'UNAUTHORIZED'});
  f.entries.set('receipt-refs:'+check,receipt);
});
