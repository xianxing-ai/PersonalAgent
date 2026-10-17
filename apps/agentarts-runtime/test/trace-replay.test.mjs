import test from 'node:test';
import assert from 'node:assert/strict';
import {replayFrozenWorkflowTrace,workflowTraceDigest} from '../src/trace-replay.mjs';
import {createWorkflowShadowController,signWorkflowShadowRequest,verifyWorkflowShadowResponse} from '../src/shadow-controller.mjs';
import {createAgentServer} from '../src/server.mjs';
const receiptSecret='explicit-public-frozen-trace-secret-123456';
const versions={workspace:'frozen-v1',toolCatalog:'catalog-v2'};
const active=()=>({signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
function record(extra={}) {
  const value={recordId:'original-runtime-record-1',kind:'tool',observedAt:new Date(Date.now()-2000).toISOString(),sourceVersions:versions,
    state:'confirmed',toolName:'workspace.read_text',toolVersion:'1.0.0',arguments:{path:'public.txt'},result:{content:'observed historical bytes'},
    evidenceRefs:['original-runtime-execution-evidence'],effect:'read',...extra};
  return {...value,argumentsDigest:workflowTraceDigest(value.arguments),resultDigest:workflowTraceDigest(value.result)};
}
const action=(extra={})=>{const value={actionId:'requested-read',toolName:'workspace.read_text',toolVersion:'1.0.0',arguments:{path:'public.txt'},sourceVersions:versions,...extra};return {...value,argumentsDigest:workflowTraceDigest(value.arguments)};};
const frozen=(records=[record()],requestedActions=[action()])=>({snapshot:{asOf:new Date(Date.now()-1000).toISOString(),sourceVersions:versions,records},requestedActions});
const replay=input=>replayFrozenWorkflowTrace(input,active());
const policyConfig={sampling:{base:0,min:0,max:1,adjustmentRate:0,minimumVerifiedSamples:1},comparison:{qualityWeight:1,wallMsWeight:0,modelCallWeight:0}};
function envelope(input=frozen()) {return {shadowVersion:1,operation:'replay',taskId:'original-task',sessionId:'original-session',controlRevision:4,
  taskDeadline:new Date(Date.now()+60000).toISOString(),requestId:'replay-request',...input};}
const sign=value=>signWorkflowShadowRequest({receiptSecret,value});

test('exact historical read returns original record/result/Evidence without new execution or counterfactual claims',()=>{
  const input=frozen(),result=replay(input),read=result.actions[0];
  assert.equal(read.state,'reused_historical_read');assert.equal(read.historicalState,'confirmed');
  assert.deepEqual(read.result,input.snapshot.records[0].result);assert.deepEqual(read.originalRecordIds,['original-runtime-record-1']);
  assert.equal(read.actualExecutionVerified,false);assert.equal(read.counterfactualExecutionVerified,false);
  assert.equal(result.actualToolCalls,0);assert.equal(result.actualModelCalls,0);assert.equal(result.authority,'data_only_no_tool_grant');
  assert.equal(result.currentResultValidity,'not_independently_verified');assert.equal(result.counterfactualComparison,'unknown');
});
test('actual failed and unknown history stay failed/unknown for debugging',()=>{
  const failed=record({recordId:'original-failed',toolName:'fixture.failed',state:'failed',result:{error:'observed failure'}});
  const unknown=record({recordId:'original-unknown',toolName:'fixture.unknown',state:'unknown',result:{reason:'original readback unresolved'}});
  const result=replay(frozen([failed,unknown],[action({actionId:'failed',toolName:'fixture.failed'}),action({actionId:'unknown',toolName:'fixture.unknown'})]));
  assert.equal(result.actions[0].state,'historical_failed');assert.equal(result.actions[0].historicalState,'failed');
  assert.equal(result.actions[1].state,'historical_unknown');assert.equal('result' in result.actions[1],false);assert.ok(result.actions[1].recordedResult);
});
test('writes are timeline-only; new candidates and missing execution Evidence remain unknown',()=>{
  const write=record({toolName:'workspace.write',effect:'write'});
  const result=replay(frozen([write],[action({toolName:'workspace.write'}),action({actionId:'new-read',arguments:{path:'never-read.txt'}})]));
  assert.equal(result.actions[0].comparability,'write_not_replayed');assert.equal('result' in result.actions[0],false);
  assert.equal(result.actions[1].state,'counterfactual_unknown');assert.equal(result.timeline[0].executedDuringReplay,false);
  const missing=replay(frozen([record({evidenceRefs:[]})]));assert.equal(missing.actions[0].comparability,'missing_evidence');
});
test('model and decision timeline preserve original data but never become tool Evidence',()=>{
  const records=['model','decision'].map((kind,index)=>({recordId:'original-'+kind,kind,observedAt:new Date(Date.now()-2000+index).toISOString(),
    sourceVersions:versions,state:'confirmed',name:kind+'-fixture',version:'v1',input:{promptRef:'original-input'},inputDigest:workflowTraceDigest({promptRef:'original-input'}),
    result:{text:'model claimed success'},resultDigest:workflowTraceDigest({text:'model claimed success'}),evidenceRefs:['original-'+kind+'-receipt'],effect:'none'}));
  const result=replay(frozen(records));assert.ok(result.timeline.every(item=>item.toolEvidence===false));
  assert.equal(result.actions[0].state,'counterfactual_unknown');assert.equal(result.timeline[0].record.result.text,'model claimed success');
});
test('future records, changed source versions, tampered digests and duplicate original IDs fail closed',()=>{
  const changes=[input=>{input.snapshot.asOf=new Date(Date.now()+60000).toISOString();},
    input=>{input.snapshot.records[0].observedAt=new Date().toISOString();},
    input=>{input.snapshot.records[0].sourceVersions={workspace:'different'};},
    input=>{input.requestedActions[0].sourceVersions={workspace:'different'};},
    input=>{input.snapshot.records[0].arguments.path='tampered';},
    input=>{input.snapshot.records[0].result.content='tampered';},
    input=>{input.snapshot.records.push(structuredClone(input.snapshot.records[0]));}];
  for(const change of changes){const input=structuredClone(frozen());change(input);assert.throws(()=>replay(input),{code:'INVALID_ARGUMENT'});}
});
test('identical lookup key with different historical result/state is ambiguous, never an invented winner',()=>{
  const original=record(),changed=record({recordId:'second-original-record',result:{content:'different historical result'}});
  assert.throws(()=>replay(frozen([original,changed])),{code:'REVISION_CONFLICT'});
  assert.throws(()=>replay(frozen([original,record({recordId:'another-record',state:'failed'})])),{code:'REVISION_CONFLICT'});
});
test('original deadline and cancellation are used without renewing replay lifetime',()=>{
  const input=frozen();assert.throws(()=>replayFrozenWorkflowTrace(input,{...active(),deadline:'2025-01-01T00:00:00Z'}),{code:'TIMEOUT'});
  const stop=new AbortController();stop.abort();assert.throws(()=>replayFrozenWorkflowTrace(input,{...active(),signal:stop.signal}),{code:'CANCELLED'});
});
test('actual HTTP replay route authenticates frozen export and returns signed data-only response, zero tool/model ports',async t=>{
  const controller=createWorkflowShadowController({receiptSecret,policyConfig}),token='explicit-public-transport-token-123456789';
  const server=createAgentServer({mode:'standalone-validation',authToken:token,wssAuthToken:token,
    orchestrator:{invoke:async()=>{throw Error('Replay must never call a model');}},serviceControllers:{shadowVersion:controller}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const value=sign(envelope()),url='http://127.0.0.1:'+server.address().port+'/invocations';
  const send=(query,credential=true)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',
    'x-hw-agentarts-session-id':value.sessionId,'x-request-id':value.requestId,...(credential?{'x-pa-agent-token':'Bearer '+token}:{})},body:JSON.stringify({query:JSON.stringify(query)})});
  assert.equal((await send(value,false)).status,401);
  const response=await send(value);assert.equal(response.status,200);const signed=JSON.parse((await response.json())[0].data.text);
  assert.equal(signed.operation,'replay_result');const result=verifyWorkflowShadowResponse({receiptSecret,response:signed,request:value});
  assert.equal(result.actions[0].state,'reused_historical_read');assert.equal(result.actualToolCalls,0);
  assert.equal(result.originalTaskDeadline,value.taskDeadline);
  const tampered=structuredClone(value);tampered.snapshot.records[0].result={content:'tampered'};assert.equal((await send(tampered)).status,401);
});
