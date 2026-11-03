import test from 'node:test';
import assert from 'node:assert/strict';
import {correlatePinnedReadonlyTool} from '../dist/pinned-version-readonly.js';

const deployment={runtimeId:'runtime-1',runtimeName:'pa-owned',endpointId:'endpoint-1',endpointName:'v1',version:'v1',imageDigest:'sha256:'+'a'.repeat(64)};
const tool={name:'research.search',version:'0.1.0'};
const context=()=>({signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString(),requestId:'request-1',taskId:'task-1',runId:'run-1'});
function ports(overrides={}) {
  const calls={read:0,cloud:0,local:0,record:0};
  const base={deployment,allowedTool:tool,
    readDeployment:async()=>{calls.read++;return {...deployment,runtimeReady:true};},
    invokeCloud:async()=>{calls.cloud++;return {requestId:'request-1',kind:'tool_proposal',toolName:tool.name,toolVersion:tool.version,arguments:{query:'public'}} ;},
    executeLocalReadonly:async()=>{calls.local++;return {evidenceId:'evidence-1',state:'succeeded'};},
    authorize:async()=>true,
    recordEvidence:async draft=>{calls.record++;assert.equal(draft.platformRequestId,'request-1');assert.equal(draft.evidenceId,'evidence-1');return {evidenceId:draft.evidenceId};},
    surfaceStatus:()=>({knowledge:{state:'configured_not_verified',verified:true},mcp:{state:'unavailable',verified:true},trace:{state:'unavailable'},evaluation:{state:'configured_not_verified'}}),
    ...overrides};
  return {ports:base,calls};
}
test('pinned readonly correlation keeps the exact version, one local read, and unverified platform surfaces',async()=>{
  const f=ports();
  const result=await correlatePinnedReadonlyTool(f.ports,{arguments:{query:'public'}},context());
  assert.equal(result.state,'correlated');assert.equal(result.localTaskCompleted,false);assert.equal(result.localEvidenceId,'evidence-1');
  assert.equal(result.platformRequestId,'request-1');assert.equal(result.containerExecution,'unverified');assert.equal(result.readinessProbe,'unverified');
  assert.equal(result.realEnvironmentAcceptance,'not_performed');assert.equal(result.modelProxy.state,'separate_from_mcp');assert.equal(result.modelProxy.verified,false);
  assert.equal(result.surfaces.knowledge.verified,false);assert.equal(result.surfaces.mcp.verified,false);
  assert.equal(result.surfaces.trace.state,'unavailable');assert.equal(result.surfaces.evaluation.state,'configured_not_verified');
  assert.deepEqual(f.calls,{read:2,cloud:1,local:1,record:1});
  assert.equal(result.cloudSuccessIsNotLocalCompletion,true);
});
test('authorization failure, version drift and a non-readonly proposal do not execute or retry',async()=>{
  const denied=ports({authorize:async()=>false});
  await assert.rejects(correlatePinnedReadonlyTool(denied.ports,{arguments:{query:'public'}},context()),{code:'UNAUTHORIZED'});
  assert.equal(denied.calls.cloud,0);assert.equal(denied.calls.local,0);
  const drifted=ports({readDeployment:async()=>{drifted.calls.read++;return {...deployment,version:'other',endpointName:'other'};}});
  await assert.rejects(correlatePinnedReadonlyTool(drifted.ports,{arguments:{query:'public'}},context()),{code:'REVISION_CONFLICT'});
  assert.equal(drifted.calls.cloud,0);
  const text=ports({invokeCloud:async()=>{text.calls.cloud++;return {requestId:'request-1',kind:'text',text:'cloud says done'};}});
  await assert.rejects(correlatePinnedReadonlyTool(text.ports,{arguments:{query:'public'}},context()),{code:'UNAUTHORIZED'});
  assert.equal(text.calls.local,0);
  await assert.rejects(correlatePinnedReadonlyTool({...ports().ports,deployment:{...deployment,version:'latest',endpointName:'latest'}},{arguments:{query:'public'}},context()),{code:'INVALID_ARGUMENT'});
});
test('a changed deployment after the local read is not success and is not invoked again',async()=>{
  let read=0;const f=ports({readDeployment:async()=>{read++;f.calls.read++;return read===1?{...deployment,runtimeReady:true}:{...deployment,imageDigest:'sha256:'+'b'.repeat(64),runtimeReady:true};}});
  await assert.rejects(correlatePinnedReadonlyTool(f.ports,{arguments:{query:'public'}},context()),{code:'REVISION_CONFLICT'});
  assert.equal(f.calls.cloud,1);assert.equal(f.calls.local,1);assert.equal(f.calls.read,2);
});
test('missing ports stay unavailable and a cancelled call does not touch the cloud',async()=>{
  await assert.rejects(correlatePinnedReadonlyTool({deployment,allowedTool:tool},{arguments:{query:'public'}},context()),{code:'UNSUPPORTED_CAPABILITY'});
  const abort=new AbortController();abort.abort();
  const f=ports();
  await assert.rejects(correlatePinnedReadonlyTool(f.ports,{arguments:{query:'public'}},{...context(),signal:abort.signal}),{code:'CANCELLED'});
  assert.equal(f.calls.cloud,0);
});
