import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,createHmac} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TaskRuntime} from '@personal-agent/runtime';
import {OwnedWorkflowEngine} from '../dist/owned-workflows.js';
import {OwnedWorkflowHostBridge,createOwnedWorkflowReceiptVerifier} from '../dist/owned-workflow-host-bridge.js';
import {createWorkflowDecisionTool} from '../dist/workflow-decision-tool.js';
import {parseWorkflowSelectionResult,workflowShadowSelectionDigest as digest,createWorkflowShadowCheckpointPort,createWorkflowShadowHistory} from '../dist/workflow-shadow-policy.js';

// Real Engine, signed HostBridge and SQLite checkpoints. Tool/model/resource outputs are explicit fixtures.
const secret='public-fixture-workflow-shadow-existing-key-123456';
const config={sampling:{base:1,min:0,max:1,adjustmentRate:0.2,minimumVerifiedSamples:1},comparison:{qualityWeight:1,wallMsWeight:0.1,modelCallWeight:0.1}};
const provenance={decidedBy:'deepseek',deepseekProposalRef:'fixture-same-decision-teacher',layaDecisionRef:'fixture-same-decision-laya',layaQualified:false,uncertaintyResolved:true};
const metadata=extra=>({shadowPlan:{taskClass:'fixture-coding',mode:'ordinary',tier:'isolated',shadowRequested:true,shadowCandidateId:'alternative',uncertain:false,provenance,...extra}});
const branchSign=body=>createHmac('sha256','explicit-fixture-branch-key').update(digest(body)).digest('hex');
const signedBranch=(receipt,context)=>{const body={...receipt,proof:context};return {...body,proof:{...context,signature:branchSign(body)}};};
const verifyBranch=async receipt=>{const {signature,...context}=receipt.proof??{};return signature===branchSign({...receipt,proof:context});};
const empty={type:'object',additionalProperties:false,properties:{},required:[]};
async function fixture(t,{plan=metadata(),configured=true,comparisonRequested=false}={}) {
  const directory=await mkdtemp(join(tmpdir(),'pa-engine-shadow-')),path=join(directory,'runtime.sqlite');let runtime=new TaskRuntime(path);
  const task=runtime.submitTask({goal:'public synthetic shadow consumer',conversationId:'fixture-shadow',idempotencyKey:'original'});
  const snapshot={namespace:'fixture-isolated',asOf:new Date(Date.now()-1000).toISOString(),sourceVersions:{fixture:'v1'}};
  const isolation={namespace:snapshot.namespace,snapshotDigest:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
  const original={workflowId:'F20',input:{goal:'public fixture'},taskId:task.taskId,sessionId:'fixture-session',controlRevision:1,requestId:'fixture-request',
    deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};original.taskDeadline=original.deadline;
  let prepared=0,selections=0,submissions=0,firstSelection,observed=[],advancedEnabled=true,mainPriorityAvailable=true,hostState='succeeded',active=true,isolationAvailable=true;
  const operations=new Map();
  const decisionTool=createWorkflowDecisionTool({selector:{select:async input=>{
    selections++;const context=JSON.parse(input.context);
    return context.nodeId==='F20_N01'&&context.mode==='main'?{selectedId:'primary',metadata:plan}:{selectedId:'primary'};
  }}});
  const descriptor=decisionTool.descriptor;
  const tools=[{name:descriptor.name,version:descriptor.version,inputSchema:descriptor.inputSchema},...['workspace.read_text','workspace.run_allowed_command'].map(name=>({name,version:'1.0.0',inputSchema:empty}))];
  const modelCandidates=async context=>{prepared++;const value=context.node.kind==='tool'
    ?{toolName:context.node.capabilities[0].name,toolVersion:'1.0.0',arguments:{}}:{fixture:context.node.id};
    return [{id:'primary',description:'fixture primary',value,metadata:plan},{id:'alternative',description:'fixture alternative',value}];};
  const engine=()=>new OwnedWorkflowEngine({checkpointSecret:secret,decisionTool:{name:decisionTool.descriptor.name,version:'1.0.0'},
    prepareCandidates:modelCandidates,allowIsolatedProposals:true,externalHost:true,receiptVerifier:createOwnedWorkflowReceiptVerifier({secret})});
  const host={submitHostToolTask(input){submissions++;const localTaskId='fixture-tool-'+submissions;
    const isDecision=input.toolName===decisionTool.descriptor.name;
    const context=isDecision?JSON.parse(input.arguments.context):undefined;
    const result=isDecision?(context.nodeId==='F20_N01'&&context.mode==='main'?(selections++,{selectedId:'primary',metadata:plan}):(selections++,{selectedId:'primary'})):{fixture:'actual tool readback'};
    operations.set(localTaskId,{input,result});return {...input,task:{taskId:localTaskId,state:hostState}};},
    readHostToolTask(localTaskId){const {input,result}=operations.get(localTaskId),runId='host-tool-'+localTaskId;
      return {...input,task:{taskId:localTaskId,state:hostState,evidenceRefs:[runId]},
        ...(hostState==='succeeded'?{confirmed:{runId,result:structuredClone(result),evidenceRefs:[runId]}}:{})};}};
  const checkpoints={read:(id,key)=>runtime.loadCheckpoint(id,key),writeOnce:(id,key,value)=>runtime.saveCheckpointOnce(id,key,value)};
  const shadow={policyConfig:config,verifyReceipt:verifyBranch,readSnapshot:()=>({advancedEnabled,comparisonRequested,
    resources:{mainPriorityAvailable,shadowAllowed:true,taskValueEligible:true},isolation,observedBranches:observed,
    ...(firstSelection?{admissionDecisionRef:firstSelection.operationId}:{})})};
  const bridge=()=>new OwnedWorkflowHostBridge({receiptSecret:secret,host,checkpoints,
    assertActive:()=>{if(!active)throw Error('fixture original task stopped');},assertIsolation:(id,value)=>{if(!isolationAvailable)throw Error('fixture sandbox unavailable');assert.deepEqual(value,isolation);},...(configured?{shadow}:{})});
  t.after(async()=>{runtime.close();await rm(directory,{recursive:true,force:true});});
  return {original:{...original,availableTools:tools},engine,bridge,snapshot,isolation,checkpoints,shadow,
    rememberFirst:value=>{firstSelection=value;},get firstSelection(){return firstSelection;},
    setObserved:value=>{observed=value;},setAdvanced:value=>{advancedEnabled=value;},setMainAvailable:value=>{mainPriorityAvailable=value;},
    setHostState:value=>{hostState=value;},setActive:value=>{active=value;},reopen:()=>{runtime.close();runtime=new TaskRuntime(path);},
    setIsolationAvailable:value=>{isolationAvailable=value;},
    counts:()=>({prepared,selections,submissions}),
    branches:(decisionRef,extra={})=>['main','shadow'].map(branch=>signedBranch({receiptId:branch+'-receipt',taskKey:task.taskId,taskClass:'fixture-coding',decisionRef,
      branch,candidateId:branch==='main'?'primary':'alternative',baselineSha256:'a'.repeat(64),conditionsDigest:'b'.repeat(64),workspaceRef:branch+'-fixture-root',
      resultSha256:'c'.repeat(64),qualityMetricId:'fixture-checks',qualityScore:branch==='shadow'?2:1,wallMs:branch==='shadow'?8:10,
      modelCalls:1,evidenceRefs:[branch+'-evidence'],...extra},{taskId:task.taskId,sessionId:original.sessionId,controlRevision:original.controlRevision,taskDeadline:original.taskDeadline})),
  };
}
async function firstDecision(f,runtime,bridge) {
  const result=await runtime.advance(f.original),proposal=result.proposals[0];f.rememberFirst(proposal);
  await bridge.submitWithShadow(f.original,proposal);const receipt=await bridge.readReceiptWithShadow(f.original,proposal);
  return {result,proposal,receipt};
}
async function settle(f,runtime,bridge,result) {
  for(let i=0;i<24&&result.state!=='settled';i++) {
    const receipts=[];
    for(const proposal of result.proposals) {await bridge.submitWithShadow(f.original,proposal);const receipt=await bridge.readReceiptWithShadow(f.original,proposal);if(receipt)receipts.push(receipt);}
    result=await runtime.advance({...f.original,checkpoint:result.checkpoint,receipts});
  }
  assert.equal(result.state,'settled');return result;
}
test('same actual decision metadata is consumed by Engine and signed HostBridge checkpoints without another selection',async t=>{
  const f=await fixture(t),runtime=f.engine(),bridge=f.bridge(),first=await firstDecision(f,runtime,bridge);
  assert.deepEqual(first.receipt.result,{selectedId:'primary',metadata:metadata()});
  assert.equal(first.receipt.shadowEvaluation.policy.action,'run');assert.equal(first.receipt.shadowEvaluation.actualExecutionVerified,false);
  let result=await runtime.advance({...f.original,checkpoint:first.result.checkpoint,receipts:[first.receipt]});
  assert.equal(result.shadows[0].plan.decision.decisionRef,first.proposal.operationId);
  assert.equal(result.shadows[0].evaluation.policy.comparison.status,'unknown');
  result=await settle(f,runtime,bridge,result);assert.equal(result.delivery.waitingForShadow,false);assert.equal(result.delivery.mayDeliverMain,true);
  const before=f.counts();await bridge.refreshShadowReceipt(f.original,first.proposal.operationId);assert.deepEqual(f.counts(),before);
  assert.equal(before.selections,4,'only the original four F20 candidate selections ran');
});
test('explicit comparison can settle main graph but delivery waits for signed comparable pair; restart persists history',async t=>{
  const f=await fixture(t,{plan:metadata({mode:'compare'}),comparisonRequested:true}),runtime=f.engine(),bridge=f.bridge(),first=await firstDecision(f,runtime,bridge);
  let result=await runtime.advance({...f.original,checkpoint:first.result.checkpoint,receipts:[first.receipt]});
  result=await settle(f,runtime,bridge,result);assert.equal(result.delivery.waitingForShadow,true);assert.equal(result.delivery.mayDeliverMain,false);
  const before=f.counts();f.setObserved(f.branches(first.proposal.operationId));f.reopen();
  const receipt=await f.bridge().refreshShadowReceipt(f.original,first.proposal.operationId);
  result=await f.engine().advance({...f.original,checkpoint:result.checkpoint,receipts:[receipt]});
  assert.equal(result.state,'settled');assert.equal(result.delivery.waitingForShadow,false);assert.equal(result.delivery.mayDeliverMain,true);
  assert.deepEqual(f.counts(),before);assert.equal(result.shadows[0].evaluation.policy.comparison.status,'comparable');
  const history=createWorkflowShadowHistory({checkpoints:createWorkflowShadowCheckpointPort({loadCheckpoint:key=>f.checkpoints.read(f.original.taskId,key),
    saveCheckpointOnce:(key,value)=>f.checkpoints.writeOnce(f.original.taskId,key,value)}),verifyReceipt:verifyBranch});
  assert.equal((await history.read('fixture-coding')).pairs.length,1);
  await f.bridge().refreshShadowReceipt(f.original,first.proposal.operationId);assert.equal((await history.read('fixture-coding')).pairs.length,1);
});
test('trusted advanced switch, resources and same-decision provenance produce skip/defer/need_teacher',async t=>{
  for(const [name,options,change,action] of [
    ['off',{},f=>f.setAdvanced(false),'skip'],['busy',{},f=>f.setMainAvailable(false),'defer'],
    ['teacher',{plan:metadata({provenance:{decidedBy:'code',deepseekProposalRef:null,layaDecisionRef:null,layaQualified:false,uncertaintyResolved:false}})},()=>{},'need_teacher'],
    ['missing',{configured:false},()=>{},'defer'],
  ])await t.test(name,async t=>{const f=await fixture(t,options);change(f);const first=await firstDecision(f,f.engine(),f.bridge());assert.equal(first.receipt.shadowEvaluation.policy.action,action);});
});
test('isolated new operations defer at the existing submit boundary; resource recovery resumes, unknown operations only read back',async t=>{
  const f=await fixture(t),bridge=f.bridge(),first=await firstDecision(f,f.engine(),bridge);
  const isolated=await f.engine().advance({...f.original,mode:'isolated',snapshot:f.snapshot}),proposal=isolated.proposals[0];
  const before=f.counts().submissions;f.setMainAvailable(false);
  await assert.rejects(bridge.submitWithShadow(f.original,proposal),{code:'RATE_LIMITED'});assert.equal(f.counts().submissions,before);
  f.setMainAvailable(true);await bridge.submitWithShadow(f.original,proposal);assert.equal(f.counts().submissions,before+1);
  f.setAdvanced(false);f.setHostState('waiting_reconciliation');f.setActive(false);f.setIsolationAvailable(false);
  assert.equal((await bridge.submitWithShadow(f.original,proposal)).state,'waiting_reconciliation');
  const unknown=await bridge.readReceiptWithShadow(f.original,proposal);assert.equal(unknown.state,'unknown');assert.equal(f.counts().submissions,before+1);
  f.setActive(true);f.setHostState('succeeded');f.setIsolationAvailable(true);await assert.rejects(bridge.readReceiptWithShadow({...f.original,taskDeadline:new Date(Date.now()+120000).toISOString()},first.proposal),{code:'REVISION_CONFLICT'});
});
test('policy refresh rejects tampering, other sessions/revisions/deadlines, and does not change a pending original tool operation',async t=>{
  const f=await fixture(t),runtime=f.engine(),bridge=f.bridge(),first=await firstDecision(f,runtime,bridge);
  const result=await runtime.advance({...f.original,checkpoint:first.result.checkpoint,receipts:[first.receipt]});
  const refresh=await bridge.refreshShadowReceipt(f.original,first.proposal.operationId),tampered=structuredClone(refresh);
  tampered.shadowEvaluation.policy.action='skip';
  await assert.rejects(runtime.advance({...f.original,checkpoint:result.checkpoint,receipts:[tampered]}),{code:'INVALID_ARGUMENT'});
  for(const change of [{sessionId:'wrong-session'},{controlRevision:2},{taskDeadline:new Date(Date.now()+120000).toISOString()}])
    await assert.rejects(bridge.refreshShadowReceipt({...f.original,...change},first.proposal.operationId),{code:'REVISION_CONFLICT'});
  const held=await runtime.advance({...f.original,checkpoint:result.checkpoint,receipts:[refresh]});
  assert.deepEqual(held.proposals,result.proposals,'policy-only refresh leaves the pending business operation intact');
  const stripped=structuredClone(first.receipt);delete stripped.shadowEvaluation;
  await assert.rejects(runtime.advance({...f.original,checkpoint:first.result.checkpoint,receipts:[stripped]}),{code:'INVALID_ARGUMENT'});
});
test('signed branch claims for another selected candidate cannot pollute existing checkpoint history',async t=>{
  const f=await fixture(t),bridge=f.bridge(),first=await firstDecision(f,f.engine(),bridge);
  f.setObserved(f.branches(first.proposal.operationId,{candidateId:'unselected'}));
  await assert.rejects(bridge.refreshShadowReceipt(f.original,first.proposal.operationId),{code:'REVISION_CONFLICT'});
  const history=createWorkflowShadowHistory({checkpoints:createWorkflowShadowCheckpointPort({loadCheckpoint:key=>f.checkpoints.read(f.original.taskId,key),
    saveCheckpointOnce:(key,value)=>f.checkpoints.writeOnce(f.original.taskId,key,value)}),verifyReceipt:verifyBranch});
  assert.equal((await history.read('fixture-coding')).pairs.length,0);
});
test('model compare intent cannot make ordinary delivery wait without trusted explicit user comparison',async t=>{
  const f=await fixture(t,{plan:metadata({mode:'compare'})}),runtime=f.engine(),bridge=f.bridge(),first=await firstDecision(f,runtime,bridge);
  assert.equal(first.receipt.result.metadata.shadowPlan.mode,'compare');assert.equal(first.receipt.shadowEvaluation.comparisonRequested,false);
  assert.equal(first.receipt.shadowEvaluation.plan.mode,'ordinary');
  let result=await runtime.advance({...f.original,checkpoint:first.result.checkpoint,receipts:[first.receipt]});
  result=await settle(f,runtime,bridge,result);assert.equal(result.delivery.waitingForShadow,false);assert.equal(result.delivery.mayDeliverMain,true);
});
test('every new main operation observes cancellation and both deadlines before submission',async t=>{
  const f=await fixture(t),bridge=f.bridge(),result=await f.engine().advance(f.original),proposal=result.proposals[0];
  const stop=new AbortController();stop.abort();
  await assert.rejects(bridge.submitWithShadow({...f.original,signal:stop.signal},proposal),{code:'CANCELLED'});
  await assert.rejects(bridge.submitWithShadow({...f.original,deadline:new Date(0).toISOString()},proposal),{code:'TIMEOUT'});
  await assert.rejects(bridge.submitWithShadow({...f.original,taskDeadline:new Date(0).toISOString()},proposal),{code:'TIMEOUT'});
  assert.equal(f.counts().submissions,0);
  await bridge.submitWithShadow(f.original,proposal);const before=f.counts().submissions;
  f.setHostState('waiting_reconciliation');
  assert.equal((await bridge.submitWithShadow({...f.original,signal:stop.signal},proposal)).state,'waiting_reconciliation');
  assert.equal(f.counts().submissions,before,'known original operation remains readback-only after cancellation');
});
test('selection parser retains legacy selectors and refuses undeclared metadata/candidates or forged participation',()=>{
  assert.deepEqual(parseWorkflowSelectionResult('primary',['primary']),{selectedId:'primary'});
  for(const value of [{selectedId:'other'},{selectedId:'primary',metadata:{shadowPlan:{...metadata().shadowPlan,shadowCandidateId:'invented'}}},
    {selectedId:'primary',metadata:{shadowPlan:{...metadata().shadowPlan,provenance:{...provenance,deepseekProposalRef:null}}}},
    {selectedId:'primary',metadata:{shadowPlan:metadata().shadowPlan,permission:'all'}}])
    assert.throws(()=>parseWorkflowSelectionResult(value,['primary','alternative']),{code:'INVALID_ARGUMENT'});
});
