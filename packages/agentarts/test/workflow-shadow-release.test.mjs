import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {createWorkflowShadowReleaseService,createWorkflowShadowReleaseAdapter,workflowShadowReleaseDigest as hash} from '../dist/workflow-shadow-release.js';

// Signed synthetic receipts and an atomic in-memory configuration host: fixture evidence only,
// not an AgentArts platform evaluation, production configuration store or authorization test.
const copy=structuredClone,secret='synthetic-shadow-release-signature-key';
const sign=value=>createHmac('sha256',secret).update(hash(value)).digest('hex');
const signed=value=>{const {proof:_,...body}=value;return {...body,proof:sign(body)};};
const verified=async value=>{const {proof,...body}=value;return proof===sign(body);};
const stamp=()=>({observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()});
const scopes=['configuration:release'];
const context=()=>({taskId:'fixture-task',runId:'fixture-run',signal:new AbortController().signal,
  deadline:new Date(Date.now()+60000).toISOString(),authorizationRef:'existing-runtime-authorization',scopes});
function fixture({mode='normal',onRead}={}) {
  const oldParameters={prompt:'old'},newParameters={prompt:'new'};
  let state={configurationId:'fixture-config',revision:1,version:'v1',parameters:oldParameters,parametersDigest:hash(oldParameters)};
  let writes=0;const operations=new Map();
  const port={async read(id){if(onRead)state=onRead(copy(state),writes);return id===state.configurationId?copy(state):undefined;},
    async readOperation(id){return copy(operations.get(id)??{state:'not_started'});},
    async compareAndSet(request){
      writes++;const prior=operations.get(request.operationId);
      if(prior){assert.equal(prior.requestDigest,request.requestDigest);return copy(prior);}
      if(mode==='pending') {const op={state:'unknown',requestDigest:request.requestDigest,request:copy(request)};operations.set(request.operationId,op);throw new Error('write response lost');}
      if(hash(state)!==hash(request.expected)) {
        const op={state:'rejected',requestDigest:request.requestDigest,request:copy(request),reason:'revision_conflict'};operations.set(request.operationId,op);return copy(op);
      }
      const before=copy(state);state={...copy(request.next),revision:before.revision+1};
      const op={state:'applied',requestDigest:request.requestDigest,request:copy(request),before,after:copy(state),evidenceRefs:['fixture-cas-'+request.operationId]};
      operations.set(request.operationId,op);
      if(mode==='applied_throw')throw new Error('response lost after committed write');
      return copy(op);
    }};
  const c={policyId:'fixture-acceptance',revision:3,configurationId:state.configurationId,taskClass:'fixture-class',
    validFrom:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),
    baseline:{revision:1,version:'v1',parametersDigest:hash(oldParameters),resultBaselineSha256:hash('same-source')},
    candidate:{version:'v2',parametersDigest:hash(newParameters)},conditionsDigest:hash('same-model-data-budget'),qualityMetricId:'fixture-quality',
    metricRules:[{metric:'qualityScore',bound:'min_delta',value:0.1},{metric:'wallMs',bound:'max_delta',value:0}],requiredChecks:['unit','safety']};
  const binding={taskId:'fixture-task',sessionId:'fixture-session',controlRevision:1,taskDeadline:c.expiresAt};
  const verifyComparable=async(main,shadow,context)=>await verified(main)&&await verified(shadow)
    &&context.taskId===binding.taskId&&hash(main.runBinding)===hash(binding)&&hash(shadow.runBinding)===hash(binding);
  const branch=role=>signed({receiptId:'fixture-'+role,taskKey:'fixture-task',taskClass:c.taskClass,decisionRef:'fixture-decision',branch:role,runBinding:binding,
    candidateId:role==='main'?'old':'new',baselineSha256:c.baseline.resultBaselineSha256,conditionsDigest:c.conditionsDigest,
    workspaceRef:'isolated-'+role,resultSha256:hash(role),qualityMetricId:c.qualityMetricId,qualityScore:role==='main'?0.6:0.9,
    wallMs:role==='main'?50:40,modelCalls:2,evidenceRefs:['fixture-result-'+role],configurationId:c.configurationId,
    version:role==='main'?'v1':'v2',parametersDigest:hash(role==='main'?oldParameters:newParameters),...stamp()});
  const evidence=signed({evidenceId:'fixture-tests',configurationId:c.configurationId,version:'v2',parametersDigest:c.candidate.parametersDigest,
    policyId:c.policyId,policyRevision:c.revision,baselineSha256:c.baseline.resultBaselineSha256,conditionsDigest:c.conditionsDigest,
    ...stamp(),checks:[{id:'unit',state:'passed'},{id:'safety',state:'passed'}]});
  const request={action:'promote',operationId:'fixture-promotion',configurationId:c.configurationId,
    main:branch('main'),shadow:branch('shadow'),testEvidence:evidence,candidateParameters:newParameters};
  const service=createWorkflowShadowReleaseService({configurationPort:port,acceptance:c,verifyBranch:verified,verifyComparable,verifyTestEvidence:verified,requiredScopes:scopes});
  return {service,port,request,c,operations,verifyComparable,get state(){return copy(state);},setState:value=>{state=copy(value);},get writes(){return writes;}};
}
const rollback=f=>({action:'rollback',operationId:'fixture-rollback',configurationId:f.request.configurationId,promotionOperationId:f.request.operationId});
test('unbound configuration is unavailable; F23 adapter cannot use a receipt as a grant',async()=>{
  const service=createWorkflowShadowReleaseService({requiredScopes:scopes}),adapter=createWorkflowShadowReleaseAdapter(service,{sideEffect:'local_write'});
  assert.throws(()=>createWorkflowShadowReleaseAdapter(service),/actual write side effect/);
  assert.throws(()=>createWorkflowShadowReleaseAdapter(service,{sideEffect:'read'}),/actual write side effect/);
  assert.equal(createWorkflowShadowReleaseAdapter(service,{sideEffect:'external_write'}).descriptor.sideEffect,'external_write');
  assert.equal(adapter.descriptor.name,'workflow.host.f23_n05');assert.equal(adapter.descriptor.sideEffect,'local_write');
  assert.equal((await adapter.execute({action:'rollback',operationId:'rollback',configurationId:'x',promotionOperationId:'promotion'},context())).state,'unavailable');
  await assert.rejects(adapter.execute({action:'promote',operationId:'x',configurationId:'x'},{...context(),scopes:[]}),/scope/i);
});
test('public F23 adapter compares each configured metric/test and promotes only after operation plus version readback',async()=>{
  const f=fixture(),adapter=createWorkflowShadowReleaseAdapter(f.service,{sideEffect:'local_write'}),result=await adapter.execute(f.request,context());
  assert.equal(result.state,'promoted');assert.equal(result.promotionReady,true);assert.equal(result.rollbackPointActive,true);
  assert.deepEqual(result.comparison.checks,[{id:'unit',state:'passed'},{id:'safety',state:'passed'}]);
  assert.equal(result.comparison.rules.length,2);assert.equal(result.readback.version,'v2');assert.equal(result.readbackReceipt.revision,2);
  assert.equal(result.rollbackAnchor.before.version,'v1');assert.equal(f.writes,1);
});
test('forged/stale/different-condition/unknown or missing test evidence cannot promote',async()=>{
  for(const change of [
    r=>{r.main.proof='forged';},r=>{r.shadow=signed({...r.shadow,expiresAt:new Date(0).toISOString()});},
    r=>{r.shadow=signed({...r.shadow,conditionsDigest:hash('different')});},
    r=>{r.shadow=signed({...r.shadow,baselineSha256:hash('different')});},
    r=>{r.testEvidence=signed({...r.testEvidence,checks:[{id:'unit',state:'unknown'},{id:'safety',state:'passed'}]});},
    r=>{r.testEvidence=signed({...r.testEvidence,checks:[{id:'unit',state:'passed'}]});},
    r=>{r.testEvidence=signed({...r.testEvidence,policyRevision:2});},r=>{r.candidateParameters={prompt:'changed'};},
    r=>{r.shadow=signed({...r.shadow,qualityScore:0.1});},
  ]) {
    const f=fixture(),request=copy(f.request);change(request);
    assert.equal((await f.service.execute(request,context())).state,'rejected');assert.equal(f.writes,0);
  }
});
test('CAS protects concurrent promotions; exactly one current revision wins',async()=>{
  const f=fixture();const results=await Promise.all([f.service.execute(f.request,context()),f.service.execute({...f.request,operationId:'other-promotion'},context())]);
  assert.equal(results.filter(r=>r.state==='promoted').length,1);assert.equal(results.filter(r=>r.state==='rejected').length,1);
  assert.equal(f.state.revision,2);assert.equal([...f.operations.values()].filter(r=>r.state==='applied').length,1);
});
test('independently valid signatures cannot combine different task/session/revision/deadline contexts',async()=>{
  for(const change of [binding=>({...binding,taskId:'other-task'}),binding=>({...binding,sessionId:'other-session'}),
    binding=>({...binding,controlRevision:2}),binding=>({...binding,taskDeadline:new Date(Date.now()+30000).toISOString()})]) {
    const f=fixture(),request=copy(f.request);request.shadow=signed({...request.shadow,runBinding:change(request.shadow.runBinding)});
    assert.equal(await verified(request.shadow),true);
    const result=await f.service.execute(request,context());assert.equal(result.state,'rejected');
    assert.equal(result.reason,'branch_pair_context_unverified');assert.equal(f.writes,0);
  }
});
test('missing trusted full-context pair verifier is unavailable even with valid individual signature verifiers',async()=>{
  const f=fixture(),service=createWorkflowShadowReleaseService({configurationPort:f.port,acceptance:f.c,
    verifyBranch:verified,verifyTestEvidence:verified,requiredScopes:scopes});
  assert.equal(service.status().state,'unavailable');assert.ok(service.status().missingConfiguration.includes('trusted full-context pair verifier'));
  assert.equal((await service.execute(f.request,context())).state,'unavailable');assert.equal(f.writes,0);
});
test('unknown response after applied write reconciles original operation and never writes twice',async()=>{
  const f=fixture({mode:'applied_throw'});
  assert.equal((await f.service.execute(f.request,context())).state,'promoted');
  assert.equal((await f.service.execute(f.request,context())).state,'promoted');assert.equal(f.writes,1);
  await assert.rejects(f.service.execute({...f.request,candidateParameters:{prompt:'other'}},context()),/changed/);assert.equal(f.writes,1);
});
test('simultaneous same-operation calls converge to one atomic configuration change',async()=>{
  const f=fixture();const results=await Promise.all([f.service.execute(f.request,context()),f.service.execute(f.request,context())]);
  assert.ok(results.every(result=>result.state==='promoted'));assert.equal(f.state.revision,2);assert.equal(f.operations.size,1);
});
test('readback transport failure after a committed CAS preserves original state and rollback anchor',async()=>{
  const f=fixture({onRead:(state,writes)=>{if(writes>0)throw new Error('fixture readback unavailable');return state;}});
  const result=await f.service.execute(f.request,context());
  assert.equal(result.state,'unknown');assert.equal(result.before.version,'v1');assert.equal(result.rollbackAnchor.promoted.version,'v2');
  assert.equal((await f.service.execute(f.request,context())).state,'unknown');assert.equal(f.writes,1);
});
test('pending unknown write remains unknown across reentry and changed inputs cannot reuse its operation',async()=>{
  const f=fixture({mode:'pending'});
  assert.equal((await f.service.execute(f.request,context())).state,'unknown');
  assert.equal((await f.service.execute(f.request,context())).state,'unknown');assert.equal(f.writes,1);assert.equal(f.state.version,'v1');
  await assert.rejects(f.service.execute({...f.request,candidateParameters:{prompt:'other'}},context()),/changed/);assert.equal(f.writes,1);
});
test('rollback reads original applied promotion and CAS-restores parameters at a new revision',async()=>{
  const f=fixture();await f.service.execute(f.request,context());
  const restored=await f.service.execute(rollback(f),context());
  assert.equal(restored.state,'rolled_back');assert.equal(restored.readback.version,'v1');assert.equal(restored.readback.revision,3);
  assert.equal(restored.readback.parametersDigest,f.c.baseline.parametersDigest);
  assert.equal((await f.service.execute(rollback(f),context())).state,'rolled_back');assert.equal(f.writes,2);
});
test('rollback never covers a newer configuration and keeps its original anchor',async()=>{
  const f=fixture();await f.service.execute(f.request,context());
  f.setState({...f.state,revision:3,version:'v3',parameters:{prompt:'third'},parametersDigest:hash({prompt:'third'})});
  const result=await f.service.execute(rollback(f),context());assert.equal(result.state,'rejected');
  assert.equal(f.state.version,'v3');assert.equal(f.state.revision,3);assert.equal(result.before.version,'v2');
  assert.equal(result.rollbackAnchor.before.version,'v1');assert.equal(result.rollbackAnchor.promoted.version,'v2');
  assert.equal((await f.service.execute(f.request,context())).state,'superseded');assert.equal(f.writes,2);
});
test('readback mismatch stays unknown, does not rollback or replay implicitly',async()=>{
  const f=fixture({onRead:(state,writes)=>writes>0?{...state,version:'mismatch'}:state});
  const result=await f.service.execute(f.request,context());
  assert.equal(result.state,'unknown');assert.equal(result.rollbackAnchor.before.version,'v1');assert.equal(result.promotionReady,false);
  assert.equal((await f.service.execute(f.request,context())).state,'unknown');assert.equal(f.writes,1);
});
test('expired policy is rejected; cancellation and missing original promotion stop before writes',async()=>{
  const f=fixture(),expired=createWorkflowShadowReleaseService({configurationPort:f.port,acceptance:{...f.c,expiresAt:new Date(0).toISOString()},
    verifyBranch:verified,verifyComparable:f.verifyComparable,verifyTestEvidence:verified,requiredScopes:scopes});
  assert.equal((await expired.execute(f.request,context())).state,'rejected');assert.equal(f.writes,0);
  const controller=new AbortController();controller.abort();await assert.rejects(f.service.execute(f.request,{...context(),signal:controller.signal}),/cancelled/);
  assert.equal((await f.service.execute(rollback(f),context())).state,'unknown');assert.equal(f.writes,0);
});
