import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeF10SupportedClaimsHost} from '../dist/application/workflow-f10-supported-claims-host.js';

// Synthetic readback and reviewer exercise the boundary, not actual research.
function fixture(){
  const now=Date.now(),deadline=new Date(now+60000).toISOString(),signal=new AbortController().signal;
  const records=new Map(),put=(id,key,value)=>records.set(id+'|'+key,value);
  put('child','coding-repair:parent',{taskId:'parent',operationId:'op'});
  put('child','host-tool-intent',{commandId:'op',toolName:'workflow.host.f10_n05',arguments:{},deadline});
  put('parent','owned-workflow:intent:op',{taskId:'parent',workflowId:'F10',sessionId:'session',deadline,
    proposal:{nodeId:'F10_N05',operationId:'op',toolName:'workflow.host.f10_n05',arguments:{}}});
  const runtime={loadCheckpoint:(id,key)=>records.get(id+'|'+key),getTask:()=>({state:'running'})};
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'grant',scopes:['research:read'],deadline,signal};
  let revision='v1',quote='original quotation',gate=true,exportAllowed=true,verdict='supported',confirmed,reviewCalls=0;
  const options={application:{runtime,readHostToolTask:()=>({commandId:'op',toolName:'workflow.host.f10_n05',
    task:{state:confirmed?'succeeded':'running'},confirmed:confirmed?{runId:context.runId,evidenceRefs:[context.runId],result:confirmed}:undefined})},
    requiredScopes:['research:read'],now:()=>new Date(now),
    assertCurrent:()=>{if(!gate)throw Error('revoked');},
    resolveBoundFindings:async()=>[{claimId:'claim',claim:'claim statement',sourceRef:'source',revision:'v1',quote}],
    readCitation:async()=>({revision,text:'This source contains the original quotation.'}),authorizeReview:async()=>true,
    reviewClaim:async()=>{reviewCalls++;return verdict;},
    authorizeExport:async()=>exportAllowed};
  return {context,options,put,setRevision:value=>revision=value,setQuote:value=>quote=value,
    revoke:()=>gate=false,denyExport:()=>exportAllowed=false,setVerdict:value=>verdict=value,
    complete:value=>confirmed=value,reviewCalls:()=>reviewCalls};
}
test('F10 registration requires every trusted port',()=>{
  assert.deepEqual(createRuntimeF10SupportedClaimsHost().tools,[]);
  const f=fixture();
  for(const key of ['assertCurrent','resolveBoundFindings','readCitation','authorizeReview','reviewClaim','authorizeExport']){
    const missing={...f.options};delete missing[key];
    assert.equal(createRuntimeF10SupportedClaimsHost(missing).unavailable,'f10_supported_claims_trusted_ports_unavailable');
  }
});
test('F10 denies model egress without permission for exact finding and source',async()=>{
  const f=fixture();let seen;
  f.options.authorizeReview=async(_scope,finding,source)=>{seen={finding,source};return false;};
  await assert.rejects(createRuntimeF10SupportedClaimsHost(f.options).tools[0].execute({},f.context),{code:'UNAUTHORIZED'});
  assert.equal(f.reviewCalls(),0);
  assert.equal(seen.finding.claimId,'claim');assert.equal(seen.source,'This source contains the original quotation.');
  f.options.authorizeReview=async()=>{f.revoke();return true;};
  await assert.rejects(createRuntimeF10SupportedClaimsHost(f.options).tools[0].execute({},f.context),{code:'UNAUTHORIZED'});
  assert.equal(f.reviewCalls(),0);
});
test('F10 emits only reviewed bound findings and authorizes exact receipt',async()=>{
  const f=fixture(),host=createRuntimeF10SupportedClaimsHost(f.options),tool=host.tools[0];
  assert.equal(tool.descriptor.name,'workflow.host.f10_n05');
  const result=await tool.execute({},f.context);
  assert.equal(result.correctionsApplied[0].claimId,'claim');
  assert.equal(result.correctionsApplied[0].state,'supported');
  assert.match(result.correctionsApplied[0].findingDigest,/^[a-f0-9]{64}$/);
  await assert.rejects(host.authorizeReceipt({context:f.context,result}),{code:'UNAUTHORIZED'});
  f.complete(result);
  await host.authorizeReceipt({context:f.context,result});
  assert.equal(f.reviewCalls(),1);
  await assert.rejects(host.authorizeReceipt({context:f.context,result:{correctionsApplied:[]}}),{code:'UNAUTHORIZED'});
  f.denyExport();await assert.rejects(host.authorizeReceipt({context:f.context,result}),{code:'UNAUTHORIZED'});
});
test('F10 keeps unknown unknown and rejects stale or fabricated citations',async()=>{
  const f=fixture(),host=createRuntimeF10SupportedClaimsHost(f.options);
  f.setVerdict('unknown');assert.equal((await host.tools[0].execute({},f.context)).correctionsApplied[0].state,'unknown');
  f.setQuote('not in source');await assert.rejects(host.tools[0].execute({},f.context),{code:'REVISION_CONFLICT'});
  f.setQuote('original quotation');f.setRevision('v2');await assert.rejects(host.tools[0].execute({},f.context),{code:'REVISION_CONFLICT'});
  f.setRevision('v1');f.revoke();await assert.rejects(host.tools[0].execute({},f.context),{code:'UNAUTHORIZED'});
});
test('F10 rechecks sources after export permission and hides provider errors',async()=>{
  const f=fixture(),host=createRuntimeF10SupportedClaimsHost(f.options),result=await host.tools[0].execute({},f.context);
  f.complete(result);
  f.options.authorizeExport=async()=>{f.setRevision('v2');return true;};
  await assert.rejects(host.authorizeReceipt({context:f.context,result}),{code:'REVISION_CONFLICT'});
  const broken=fixture();broken.options.readCitation=async()=>{throw Error('synthetic secret');};
  await assert.rejects(createRuntimeF10SupportedClaimsHost(broken.options).tools[0].execute({},broken.context),error=>
    error.code==='UNSUPPORTED_CAPABILITY'&&!error.message.includes('synthetic secret'));
});
