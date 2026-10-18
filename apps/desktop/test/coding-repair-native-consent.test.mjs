import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePublicReferenceConsent} from '../electron/public-reference-consent.js';
const hash='a'.repeat(64);
function fixture(){
  const query={taskId:'original-host-child',proposalId:'original-f15-operation',path:'src/feature.js',configurationRef:'bound-host-config'};
  const deadline=new Date(Date.now()+60_000).toISOString();
  let toolName='coding.repair.read',digest=hash,calls=0;
  const candidate=()=>({query,toolName,toolVersion:'1.0.0',arguments:{path:query.path,maxBytes:1024},deadline});
  const consent=createNativePublicReferenceConsent({readPreflightCandidate:candidate,
    readConfirmedCandidate:()=>({...candidate(),contentDigest:digest,byteLength:20,runId:'original-confirmed-run'}),
    isTaskCurrent:id=>id===query.taskId,confirmNative:async()=>{calls++;return true;}});
  return {query,context:{deadline,signal:new AbortController().signal},consent,get calls(){return calls;},changeTool:value=>{toolName=value;},changeDigest:value=>{digest=value;}};
}
test('F15 exact source uses original native permission and reuses unchanged grants',async()=>{
  const f=fixture();await f.consent.requestPreflight(f.query,f.context);
  await f.consent.requestExact(f.query,f.context);assert.equal(f.calls,2);
  await f.consent.requestPreflight(f.query,f.context);await f.consent.requestExact(f.query,f.context);
  const exactQuery={...f.query,contentDigest:hash,byteLength:20};
  assert.equal(f.calls,2);assert.equal(f.consent.readAuthorization(exactQuery).contentDigest,hash);
  f.changeDigest('b'.repeat(64));assert.equal(f.consent.readAuthorization(exactQuery),undefined);
  await assert.rejects(f.consent.requestExact(f.query,f.context));
});
test('F15 permission cannot be substituted by old read tool or another task',async()=>{
  const f=fixture();await f.consent.requestPreflight(f.query,f.context);await f.consent.requestExact(f.query,f.context);
  f.changeTool('workspace.read_text');assert.equal(f.consent.readAuthorization({...f.query,contentDigest:hash,byteLength:20}),undefined);
  await assert.rejects(f.consent.requestExact(f.query,f.context));
  await assert.rejects(f.consent.requestPreflight({...f.query,taskId:'other-task'},f.context));
});
