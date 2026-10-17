import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgentServer} from '../src/server.mjs';
import {createProactiveHostProofs,createProactiveWorkflowController} from '../src/proactive-controller.mjs';
import {proactiveWorkflowDigest as digest} from '@personal-agent/agentarts';

// Real HTTP routing/signature checks with explicitly synthetic model/host receipts.
// No connector account, paid inference, device execution or production authorization is exercised.
const secret='explicit-synthetic-proactive-host-secret-32',token='explicit-proactive-http-credential-32chars';
const actions=['research','delegate','notify','request_user','continue','local_plan','shadow','defer','ignore'];
const contracts=[false,true].map(qualifiedForMain=>({id:qualifiedForMain?'mature':'unqualified',version:'fixture-v1',criteria:'Use actual source context',qualifiedForMain,batchIndependent:true,
  candidates:actions.map(action=>({id:action,description:'synthetic '+action,action}))}));
const capabilities=['retrieve_context','local_decision_batch','teacher_decision',...actions.filter(a=>!['defer','ignore'].includes(a)),'update_item','schedule_wake']
  .map(kind=>({kind,ref:'fixture.'+kind,location:['local_decision_batch','research'].includes(kind)?'local_device':'cloud_persistent',
    effect:['retrieve_context','local_decision_batch','teacher_decision','research'].includes(kind)?'read':'write'}));
async function fixture(t,{configured=true}={}) {
  const proofs=createProactiveHostProofs(secret),timings=[];let sequence=0,latest;
  const binding={taskId:'fixture-task',sessionId:'fixture-session',controlRevision:1,taskDeadline:new Date(Date.now()+120000).toISOString()};
  const controller=createProactiveWorkflowController({receiptSecret:secret,decisionContracts:contracts,onStage:timing=>timings.push(timing)});
  const server=createAgentServer({mode:'standalone-validation',authToken:token,wssAuthToken:token,
    orchestrator:{invoke:async()=>{throw Error('Proactive service must not fall through to a model');}},
    serviceControllers:configured?{proactiveVersion:controller}:{}});
  server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();}));
  const endpoint='http://127.0.0.1:'+server.address().port+'/invocations';
  const call=async(value,requestId='fixture-request-'+(++sequence),headers={})=>{
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-pa-agent-token':'Bearer '+token,
      'x-hw-agentarts-session-id':binding.sessionId,'x-request-id':requestId,...headers},body:JSON.stringify({query:JSON.stringify(value)})});
    const body=await response.json();return {status:response.status,body,value:response.ok?JSON.parse(body[0].data.text):undefined};
  };
  const prepared=(delta={},frameExtra={})=>{
    const requestId='fixture-request-'+(++sequence),value={proactiveVersion:1,operation:'advance',taskId:binding.taskId,
      controlRevision:binding.controlRevision,taskDeadline:binding.taskDeadline,...(latest?{checkpoint:latest.checkpoint}:{}),...delta};
    value.hostFrame=proofs.sign('frame',{requestId,hostAvailability:{localDevice:true,cloudPersistentHost:true},availableCapabilities:structuredClone(capabilities),...frameExtra},
      {...binding,...value});return {value,requestId};
  };
  return {binding,proofs,timings,call,prepared,get latest(){return latest;},
    async advance(delta={},frameExtra={}){const request=prepared(delta,frameExtra),result=await call(request.value,request.requestId);
      assert.equal(result.status,200,JSON.stringify(result.body));latest=result.value;return latest;},
    event(id,entry='connector',extra={}){return proofs.sign('event',{eventId:id,entry,conversationId:'fixture-conversation',sourceId:'source-'+id,
      entityRef:'entity-'+id,sourceVersion:'v1',observedAt:new Date(Date.now()-1000).toISOString(),change:'upsert',payloadRef:'persisted-source:'+id,
      payloadDigest:digest(id),anchorRefs:['source-anchor:'+id],responsibilityRefs:[],goalRefs:[],contractRef:'unqualified',priority:'unknown',evidenceRefs:['fixture-source-evidence:'+id],...extra},binding);},
    responsibility(id='responsibility'){return proofs.sign('responsibility',{id,revision:1,conversationId:'fixture-conversation',
      sourceQuotes:[{conversationId:'fixture-conversation',messageId:'original-user-message',quoteRef:'original-user-quote',sha256:digest('fixture instruction')}],
      goalRefs:['fixture-goal'],authority:'explicit_instruction',scopeRefs:[]},binding);},
    receipt(proposal,result,state='confirmed'){return proofs.sign('receipt',{proposalId:proposal.proposalId,operationId:proposal.operationId,
      argumentsDigest:proposal.argumentsDigest,state,result,observedAt:new Date().toISOString(),evidenceRefs:['fixture-actual:'+proposal.operationId]},binding);},
    control(action,id=action){return proofs.sign('control',{commandId:'fixture-'+id,action,evidenceRefs:['fixture-control:'+id]},binding);},
    async retrieve(){const receipts=latest.proposals.filter(p=>p.stage==='retrieve').map(p=>this.receipt(p,{contextRef:'fixture-context:'+p.itemIds[0],
      sourceVersions:{[p.arguments.source.sourceId]:p.arguments.source.version},sourceQuotes:[],goalRefs:[],memoryRefs:[],experienceRefs:[],scopeRefs:[]}));return this.advance({receipts});},
    async select(choose=()=> 'research',frameExtra={}){return this.advance({receipts:latest.proposals.filter(p=>['laya','teacher'].includes(p.stage)).map(p=>this.receipt(p,
      {selections:p.itemIds.map((itemId,i)=>({itemId,candidateId:choose(i,itemId),decisionRef:'fixture-model-receipt:'+p.operationId,
        decidedBy:p.stage==='laya'?'laya':'deepseek',uncertain:false,complex:false,importance:'normal',authorityRequired:false}))}))},frameExtra);},
  };
}
test('HTTP descriptor preserves four entries and signed source/responsibility fronts batch Laya-first then teacher',async t=>{
  const f=await fixture(t),described=await f.call({proactiveVersion:1,operation:'describe'});
  assert.equal(described.status,200);assert.equal(described.value.descriptor.changesOwnedF01ToF28,false);
  assert.deepEqual(described.value.descriptor.entries,['connector','user_instruction','subtask_feedback','wake']);
  assert.equal(described.value.verification,'unverified');
  const events=described.value.descriptor.entries.map((entry,i)=>f.event('entrance-'+i,entry,{responsibilityRefs:['responsibility']}));
  let state=await f.advance({events:[...events,events[0]],responsibilities:[f.responsibility()]});
  assert.equal(Object.keys(state.items).length,4);assert.equal(state.proposals.length,4);assert.ok(state.proposals.every(p=>p.stage==='retrieve'));
  state=await f.retrieve();assert.equal(state.proposals.length,1);assert.equal(state.proposals[0].stage,'laya');assert.equal(state.proposals[0].itemIds.length,4);
  assert.ok(state.proposals[0].arguments.independentQuestions.every(q=>q.candidateOnly));
  state=await f.select();assert.equal(state.proposals[0].stage,'teacher');
  state=await f.select(i=>actions[i]);assert.deepEqual(new Set(state.proposals.map(p=>p.capabilityKind)),new Set(actions.slice(0,4)));
  assert.ok(f.timings.every(timing=>Number.isFinite(timing.wallMs)&&timing.startedAtUtc&&timing.finishedAtUtc));
});
test('independent HTTP branches progress while local work waits and unattended return never replays notifications',async t=>{
  const f=await fixture(t);await f.advance({events:[f.event('local'),f.event('cloud')]});await f.retrieve();await f.select();
  let state=await f.select(i=>i===0?'research':'notify',{hostAvailability:{localDevice:false,cloudPersistentHost:true}});
  assert.equal(state.proposals.length,1);assert.equal(state.proposals[0].capabilityKind,'notify');
  assert.ok(Object.values(state.items).some(item=>item.state==='waiting_device'));
  const notification=state.proposals[0];state=await f.advance({receipts:[f.receipt(notification,{status:'changed',resultRef:'fixture-channel-readback'})],
    control:f.control('enter_unattended')},{hostAvailability:{localDevice:false,cloudPersistentHost:true}});
  assert.equal(state.mode,'unattended');const update=state.proposals.find(p=>p.stage==='update');assert.ok(update);
  state=await f.advance({receipts:[f.receipt(update,{itemId:update.itemIds[0],stateRef:'fixture-existing-runtime-state'})]},
    {hostAvailability:{localDevice:false,cloudPersistentHost:true}});
  state=await f.advance({control:f.control('return')});assert.equal(state.returnSummary.changed.length,1);
  assert.equal(state.returnSummary.replayedNotifications,0);assert.equal(state.proposals.length,0);
  state=await f.advance({control:f.control('return')});assert.equal(state.returnSummary.newEvidenceOperationIds.length,0);assert.equal(state.proposals.length,0);
});
test('mature ordinary decision does not invoke a permanent teacher and unknown action receipt is readback-only',async t=>{
  const f=await fixture(t);await f.advance({events:[f.event('mature','connector',{contractRef:'mature',priority:'normal'})]});await f.retrieve();
  let state=await f.select(()=> 'delegate');assert.equal(state.proposals[0].stage,'action');const original=state.proposals[0];
  state=await f.advance({receipts:[f.receipt(original,{fixture:'unknown external effect'},'unknown')]});
  assert.equal(state.proposals.length,0);assert.equal(state.cancellationRequirements[0].operationId,original.operationId);
  state=await f.advance();assert.equal(state.proposals.length,0);
  state=await f.advance({receipts:[f.receipt(original,{status:'completed',resultRef:'fixture-original-operation-readback'})]});
  assert.equal(state.proposals[0].stage,'update');assert.notEqual(state.proposals[0].operationId,original.operationId);
});
test('HTTP rejects unsigned, tampered availability/capability, mixed protocols and stale frame correlation',async t=>{
  const f=await fixture(t);
  for(const mutate of [value=>{delete value.hostFrame.proof;},value=>{value.hostFrame.hostAvailability.localDevice=false;},
    value=>{value.hostFrame.availableCapabilities.push({kind:'notify',ref:'forged-tool',location:'cloud_persistent',effect:'write'});}]) {
    const request=f.prepared();mutate(request.value);assert.equal((await f.call(request.value,request.requestId)).status,401);
  }
  const missing=f.prepared();delete missing.value.hostFrame;assert.equal((await f.call(missing.value,missing.requestId)).status,400);
  const mixed=f.prepared();mixed.value.shadowVersion=1;assert.equal((await f.call(mixed.value,mixed.requestId)).status,400);
  const correlation=f.prepared();assert.equal((await f.call(correlation.value,'different-request')).status,401);
  assert.equal((await f.call(correlation.value,correlation.requestId,{'x-hw-agentarts-session-id':'different-session'})).status,401);
});
test('HTTP rejects forged event/responsibility/receipt/control and cannot extend original deadline',async t=>{
  const f=await fixture(t);
  const badEvent=f.prepared({events:[{...f.event('forged'),proof:'model-says-verified'}]});assert.equal((await f.call(badEvent.value,badEvent.requestId)).status,401);
  const badResponsibility=f.prepared({responsibilities:[{...f.responsibility(),proof:'forged'}]});assert.equal((await f.call(badResponsibility.value,badResponsibility.requestId)).status,401);
  const state=await f.advance({events:[f.event('original')]});const read=state.proposals[0];
  const receipt=f.receipt(read,{contextRef:'original',sourceVersions:{[read.arguments.source.sourceId]:'v1'},sourceQuotes:[],goalRefs:[],memoryRefs:[],experienceRefs:[],scopeRefs:[]});
  receipt.result.contextRef='substituted';const badReceipt=f.prepared({receipts:[receipt]});assert.equal((await f.call(badReceipt.value,badReceipt.requestId)).status,401);
  const badControl=f.prepared({control:{...f.control('pause'),proof:'forged'}});assert.equal((await f.call(badControl.value,badControl.requestId)).status,401);
  const extended=f.prepared({taskDeadline:new Date(Date.parse(f.binding.taskDeadline)+1).toISOString()});
  assert.notEqual((await f.call(extended.value,extended.requestId)).status,200);
  const expired=f.prepared({taskDeadline:new Date(Date.now()-1).toISOString()});assert.equal((await f.call(expired.value,expired.requestId)).status,504);
});
test('missing proactive controller is unavailable and signed offline observation does not invent persistent cloud execution',async t=>{
  const unconfigured=await fixture(t,{configured:false});assert.equal((await unconfigured.call({proactiveVersion:1,operation:'describe'})).status,503);
  const f=await fixture(t),state=await f.advance({events:[f.event('offline')]},{hostAvailability:{localDevice:false,cloudPersistentHost:false}});
  assert.equal(state.proposals.length,0);assert.equal(Object.values(state.items)[0].state,'waiting_device');
});
