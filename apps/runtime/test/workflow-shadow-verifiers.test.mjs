import test from 'node:test';
import assert from 'node:assert/strict';
import {signWorkflowShadowBranchReceipt} from '../../agentarts-runtime/src/shadow-controller.mjs';
import {createRuntimeWorkflowShadowBranchVerifiers} from '../dist/application/workflow-shadow-verifiers.js';

// Explicit synthetic records and keys exercise the verifier only; they are not real
// branch measurements, acceptance Evidence, AgentArts/cloud or a production producer.
const key='synthetic-shadow-branch-key-32-characters';
const digest='a'.repeat(64),deadline=new Date(Date.now()+60000).toISOString();
const binding={taskId:'parent',sessionId:'session',controlRevision:3,taskDeadline:deadline,isolation:{namespace:'isolated',snapshotDigest:digest}};
const unsigned=branch=>({receiptId:`receipt-${branch}`,taskKey:'parent',taskClass:'synthetic',decisionRef:'decision',branch,
  candidateId:branch,baselineSha256:digest,conditionsDigest:digest,workspaceRef:`workspace-${branch}`,resultSha256:digest,
  qualityMetricId:'quality',qualityScore:1,wallMs:1,modelCalls:1,evidenceRefs:[`run-${branch}`],configurationId:'config',
  version:branch==='main'?'v1':'v2',parametersDigest:digest,observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:deadline});
const main=signWorkflowShadowBranchReceipt({receiptSecret:key,receipt:unsigned('main'),context:binding});
const shadow=signWorkflowShadowBranchReceipt({receiptSecret:key,receipt:unsigned('shadow'),context:binding});
const context=()=>({taskId:'child',runId:'local-run',signal:new AbortController().signal,deadline,authorizationRef:'synthetic-grant',scopes:['fixture']});
function fixture() {
  const checkpoints=new Map([
    ['child:coding-repair:parent',{taskId:'parent',operationId:'op'}],
    ['parent:coding-repair:host:op',{localTaskId:'child',request:{toolName:'workflow.host.f23_n04',arguments:{main,shadow}}}],
    ['parent:graph',{sessionId:'session',controlRevision:3}],
    ['parent:graph:driver-binding',{taskId:'parent',workflowId:'F23',sessionId:'session',deadline}],
  ]);
  const records=['main','shadow'].map(role=>({taskId:'parent',evidenceId:`run-${role}`,toolName:'synthetic-evaluation',
    policyDecision:'allow',executionStarted:true,state:'confirmed'}));
  const evidence=records.map(record=>({evidenceId:record.evidenceId,kind:'execution',sourceRef:record.toolName}));
  const runtime={getTask:()=>({taskId:'parent',state:'running'}),loadCheckpoint:(taskId,name)=>checkpoints.get(`${taskId}:${name}`),
    readToolExecutions:()=>records,readEvidence:()=>evidence};
  const options={runtime,receiptSecret:key,driverCheckpointKey:'graph',verifyBranchObservation:async()=>true};
  return {checkpoints,records,evidence,options};
}
test('full release body signature, original task binding and independently verified observation are all required',async()=>{
  const f=fixture();assert.throws(()=>createRuntimeWorkflowShadowBranchVerifiers({...f.options,verifyBranchObservation:undefined}));
  const verifier=createRuntimeWorkflowShadowBranchVerifiers(f.options);
  assert.equal(await verifier.verifyBranch(main),true);assert.equal(await verifier.verifyBranch(shadow),true);
  assert.equal(await verifier.verifyComparable(main,shadow,context()),true);
  assert.equal(await verifier.verifyBranch({...main,version:'changed'}),false);
  assert.equal(await verifier.verifyBranch({...main,observedAt:new Date().toISOString()}),false);
  assert.equal(await verifier.verifyBranch({...main,proof:{...main.proof,signature:'forged'}}),false);
  f.records[0].policyDecision='deny';assert.equal(await verifier.verifyBranch(main),false);
  f.records[0].policyDecision='allow';f.checkpoints.get('parent:graph').controlRevision=4;
  assert.equal(await verifier.verifyComparable(main,shadow,context()),false);
  f.checkpoints.get('parent:graph').controlRevision=3;f.checkpoints.get('parent:coding-repair:host:op').localTaskId='other';
  assert.equal(await verifier.verifyComparable(main,shadow,context()),false);
  const unverified=createRuntimeWorkflowShadowBranchVerifiers({...f.options,verifyBranchObservation:async()=>false});
  assert.equal(await unverified.verifyBranch(main),false);
});
test('an execution record changed during independent verification invalidates the signed branch',async()=>{
  const f=fixture();
  const verifier=createRuntimeWorkflowShadowBranchVerifiers({...f.options,verifyBranchObservation:async()=>{
    f.records[0].state='unknown';return true;
  }});
  assert.equal(await verifier.verifyBranch(main),false);
});
