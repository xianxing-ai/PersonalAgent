import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {TaskRuntime,createRuntimeAtomicStatePort} from '../dist/index.js';
import {createProactiveWorkflowSession} from '../dist/application/proactive-workflow-session.js';
import {ProactiveWorkflowEngine,proactiveWorkflowDigest} from '@personal-agent/agentarts';

// Explicit offline image/tool fixtures. Real SQLite CAS is exercised; these are not model, Policy or account acceptance.
mkdirSync(join(process.cwd(),'.cache'),{recursive:true});
const binding={taskId:'task-one',sessionId:'session-one',controlRevision:1,taskDeadline:'2030-01-01T00:00:00.000Z'};
const proposal={proposalId:'proposal-one',operationId:'operation-one',argumentsDigest:'fixture-digest',originControlRevision:1,taskDeadline:binding.taskDeadline};
const result={checkpoint:'host-verified-sealed-fixture',taskDeadline:binding.taskDeadline,proposals:[proposal]};
const request=(requestId='request-one')=>({...binding,requestId,deadline:binding.taskDeadline,signal:new AbortController().signal});
function fixture(extra={}){
 const path=join(mkdtempSync(join(process.cwd(),'.cache','proactive-session-')),'runtime.sqlite');
 const runtime=new TaskRuntime(path),atomicState=createRuntimeAtomicStatePort(runtime,'proactive.session.fixture');
 let calls=0,active=true;
 const options={atomicState,binding,assertActive:()=>{if(!active)throw Object.assign(new Error('Cancelled actual host task'),{code:'CANCELLED'});},
  advancePort:async()=>{calls++;return structuredClone(result);},verifyAdvance:async()=>true,...extra};
 return {runtime,path,atomicState,options,session:createProactiveWorkflowSession(options),calls:()=>calls,cancel:()=>{active=false;}};
}

test('committed checkpoint and exact request receipt survive actual SQLite restart; changed arguments conflict',async()=>{
 const f=fixture();
 try{
  assert.deepEqual(await f.session.advance(request()),result);
  assert.equal(f.calls(),1);
  assert.deepEqual(await f.session.advance(request()),result);
  await assert.rejects(f.session.advance({...request(),deadline:'2029-01-01T00:00:00.000Z'}),{code:'REVISION_CONFLICT'});
  assert.equal(f.session.inspect().state.checkpoint,result.checkpoint);
 }finally{f.runtime.close();}
 const resumed=new TaskRuntime(f.path);
 try{
  const host=createProactiveWorkflowSession({...f.options,atomicState:createRuntimeAtomicStatePort(resumed,'proactive.session.fixture'),advancePort:async()=>{throw new Error('Must not call image again');}});
  assert.deepEqual(await host.advance(request()),result);
 }finally{resumed.close();}
});

test('CAS loser never releases image proposals; interrupted image intent is durable and never blindly retried',async()=>{
 let f;
 f=fixture({advancePort:async()=>{
  const snapshot=f.session.inspect(),key='proactive.session:'+createKey();
  assert.equal(f.atomicState.compareAndSet(key,snapshot.revision,{...snapshot.state,checkpoint:'other-committed-state'}),true);
  return result;
 }});
 try{
  await assert.rejects(f.session.advance(request()),{code:'REVISION_CONFLICT'});
  assert.equal(f.session.inspect().state.checkpoint,'other-committed-state');
  assert.equal(f.session.inspect().state.requests['request-one'].state,'pending');
  await assert.rejects(f.session.advance(request()),/do not replay/);
 }finally{f.runtime.close();}
 const failed=fixture({advancePort:async()=>{throw new Error('Image transport lost');}});
 try{
  await assert.rejects(failed.session.advance(request()),/transport lost/);
  await assert.rejects(failed.session.advance(request()),/do not replay/);
 }finally{failed.runtime.close();}
});

test('unverified responses, cancellation, revision mismatch and deadline extension cannot deliver proposals',async()=>{
 const f=fixture({verifyAdvance:()=>false});
 try{await assert.rejects(f.session.advance(request()),{code:'UNAUTHORIZED'});assert.equal(f.session.inspect().state.checkpoint,undefined);}
 finally{f.runtime.close();}
 const g=fixture();
 try{
  await assert.rejects(g.session.advance({...request(),controlRevision:2}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(g.session.advance({...request(),deadline:'2031-01-01T00:00:00.000Z'}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(g.session.advance({...request(),checkpoint:'caller-forged'}),{code:'INVALID_ARGUMENT'});
  g.cancel();await assert.rejects(g.session.advance(request()),{code:'CANCELLED'});
  assert.equal(g.calls(),0);
 }finally{g.runtime.close();}
});

test('trusted control revision advances the same saved checkpoint and revokes old proposals',async()=>{
 const f=fixture();
 try{
  await f.session.advance(request());
  const newer=createProactiveWorkflowSession({...f.options,binding:{...binding,controlRevision:2},advancePort:async(input)=>{
   assert.equal(input.checkpoint,result.checkpoint);assert.equal(input.controlRevision,2);
   return {...result,checkpoint:'revision-two-checkpoint',proposals:[]};
  },execution:{tools:{list:()=>[],invoke:async()=>{throw new Error('Old proposal executed');}},resolveInvocation:()=>{throw new Error('Old proposal resolved');},readExecution:async()=>{throw new Error('Old proposal read');}}});
  await assert.rejects(newer.executeProposal(proposal,{signal:new AbortController().signal,deadline:binding.taskDeadline}),{code:'UNAUTHORIZED'});
  await newer.advance({...request('revision-two-request'),controlRevision:2});
  assert.equal(newer.inspect().state.binding.controlRevision,2);
  await assert.rejects(f.session.advance(request('stale-revision-request')),{code:'REVISION_CONFLICT'});
 }finally{f.runtime.close();}
});

test('cancellation interrupts a stalled image response while preserving the durable unknown request',async()=>{
 let entered;const started=new Promise(resolve=>{entered=resolve;});
 const f=fixture({advancePort:()=>{entered();return new Promise(()=>{});}}),controller=new AbortController();
 try{
  const pending=f.session.advance({...request(),signal:controller.signal});
  await started;controller.abort();
  await assert.rejects(pending,{code:'CANCELLED'});
  assert.equal(f.session.inspect().state.requests['request-one'].state,'pending');
  assert.equal(f.session.inspect().state.checkpoint,undefined);
 }finally{f.runtime.close();}
});

test('execution persists intent before invocation; unknown only reads original Evidence, confirmed result is cached',async()=>{
 let invokes=0,reads=0,state='unknown',f;
 const execution={tools:{list:()=>[{name:'fixture.write',version:'1'}],invoke:async()=>{
  invokes++;assert.equal(f.session.inspect().state.operations['operation-one'].state,'pending');
  throw new Error('Transport failed after possible write');
 }},resolveInvocation:(_p,context)=>({toolName:'fixture.write',toolVersion:'1',arguments:{fixture:true},taskId:binding.taskId,runId:'original-run',authorizationRef:'existing-policy-ref',...context}),
 readExecution:async(invocation)=>{reads++;assert.equal(invocation.runId,'original-run');return {state,evidenceRefs:state==='confirmed'?['actual-runtime-evidence']:[],result:{fixtureReadback:true}};}};
 f=fixture({execution});
 try{
  await f.session.advance(request());
  const context={signal:new AbortController().signal,deadline:binding.taskDeadline};
  await assert.rejects(f.session.executeProposal({...proposal,argumentsDigest:'changed'},context),{code:'UNAUTHORIZED'});
  assert.equal((await f.session.executeProposal(proposal,context)).state,'unknown');
  assert.equal((await f.session.executeProposal(proposal,context)).state,'unknown');
  assert.equal(invokes,1);assert.equal(reads,2);
  state='confirmed';assert.equal((await f.session.executeProposal(proposal,context)).state,'confirmed');
  assert.equal((await f.session.executeProposal(proposal,context)).state,'confirmed');
  assert.equal(invokes,1);assert.equal(reads,3);
 }finally{f.runtime.close();}
});

test('cancelled/expired revision can reconcile original unknown write without resolving authority or invoking again',async()=>{
 let invokes=0,reads=0,state='unknown';
 const execution={tools:{list:()=>[{name:'fixture.write',version:'1'}],invoke:async()=>{invokes++;return {state:'unknown',evidenceRefs:[]};}},
  resolveInvocation:(_p,context)=>({toolName:'fixture.write',toolVersion:'1',arguments:{original:true},taskId:binding.taskId,runId:'original-write',authorizationRef:'original-policy',...context}),
  readExecution:async(invocation,p)=>{reads++;assert.equal(invocation.runId,'original-write');assert.deepEqual(invocation.arguments,{original:true});assert.equal(p.argumentsDigest,proposal.argumentsDigest);
   return {state,evidenceRefs:state==='confirmed'?['actual-original-evidence']:[]};}};
 const f=fixture({execution});
 try{
  await f.session.advance(request());await f.session.executeProposal(proposal,{signal:new AbortController().signal,deadline:binding.taskDeadline});
  state='confirmed';const expired=Date.parse(binding.taskDeadline)+1000;
  const resumed=createProactiveWorkflowSession({...f.options,binding:{...binding,controlRevision:2},now:()=>expired,
   assertActive:()=>{throw Object.assign(new Error('Cancelled'),{code:'CANCELLED'});},execution:{...execution,resolveInvocation:()=>{throw Error('Must not resolve new authority');}}});
  const context={signal:new AbortController().signal,deadline:new Date(expired+60000).toISOString()};
  assert.equal((await resumed.reconcileOperation(proposal.operationId,context)).state,'confirmed');
  assert.equal(invokes,1);assert.equal(reads,2);
  await assert.rejects(resumed.reconcileOperation('other-task-operation',context),{code:'NOT_FOUND'});
  assert.throws(()=>resumed.reconcileRequest(),{code:'UNSUPPORTED_CAPABILITY'});
 }finally{f.runtime.close();}
});

test('pure frontier recovery recomputes a lost signed response from frozen intent after real freshness changes and SQLite restart',async()=>{
 let clock=Date.now(),calls=0,discarded;
 const secret='explicit-offline-pure-frontier-signature-secret';
 const sign=body=>({...body,proof:createHmac('sha256',secret).update(proactiveWorkflowDigest(body)).digest('hex')});
 const engine=new ProactiveWorkflowEngine({checkpointSecret:secret,now:()=>clock,
  decisionContracts:[{id:'fixture',version:'1',criteria:'actual source context',qualifiedForMain:false,batchIndependent:true,
   candidates:[{id:'notify',description:'notify',action:'notify'},{id:'defer',description:'defer',action:'defer'}]}],
  verifyEvent:async()=>true,verifyResponsibility:async()=>true,verifyReceipt:async()=>true,verifyControl:async()=>true});
 const logs=[],f=fixture({now:()=>clock,pureAdvance:{kind:'signed_frontier_no_effects'},onRecovery:e=>logs.push(e),
  verifyAdvance:(value,input)=>{const {proof,...body}=value;return body.requestId===input.requestId&&sign(body).proof===proof;},
  advancePort:async input=>{
   calls++;assert.equal(input.hostAvailability.localDevice,true,'frozen host snapshot, not a replacement caller value');
   const output=sign({requestId:input.requestId,...await engine.advance(input)});
   if(calls===1){discarded=output;throw Error('Lost pure frontier response after computation');}return output;
  }});
 const input={...request(),hostAvailability:{localDevice:true,cloudPersistentHost:true},availableCapabilities:[{kind:'retrieve_context',ref:'fixture.read',effect:'read',location:'local_device'}],
  events:[{eventId:'expiring',entry:'connector',conversationId:'fixture',sourceId:'source',entityRef:'entity',sourceVersion:'one',observedAt:new Date(clock).toISOString(),
   expiresAt:new Date(clock+10).toISOString(),change:'upsert',payloadRef:'fixture:persisted-source',payloadDigest:'a'.repeat(64),anchorRefs:['original'],responsibilityRefs:[],goalRefs:[],contractRef:'fixture',priority:'unknown',evidenceRefs:['fixture-source-evidence'],proof:'explicit-fixture'}]};
 await assert.rejects(f.session.advance(input),/Lost pure/);assert.equal(discarded.proposals[0].arguments.needsRefresh,false);
 input.hostAvailability.localDevice=false;clock+=20;f.runtime.close();
 const runtime=new TaskRuntime(f.path);
 try{
  const resumed=createProactiveWorkflowSession({...f.options,atomicState:createRuntimeAtomicStatePort(runtime,'proactive.session.fixture')});
  const recovered=await resumed.recoverPendingRequest('request-one',{signal:new AbortController().signal});
  assert.equal(recovered.proposals[0].arguments.needsRefresh,true);
  assert.notEqual(recovered.proposals[0].operationId,discarded.proposals[0].operationId,'freshness changes can produce a new frontier operation identity');
  assert.equal(resumed.inspect().state.proposals[discarded.proposals[0].proposalId],undefined,'discarded response never released');
  assert.equal(resumed.inspect().state.requests['request-one'].recovery,'recompute_after_lost_pure_frontier_response');
  assert.equal(logs[0].event,'recompute_after_lost_pure_frontier_response');assert.equal(calls,2);
 }finally{runtime.close();}
});

test('concurrent pure recomputations share one pending CAS slot; winning operation executes once',async()=>{
 let calls=0,invokes=0,entered=0,release;const ready=new Promise(resolve=>release=resolve),waiters=[];
 const execution={tools:{list:()=>[{name:'fixture.write',version:'1'}],invoke:async()=>{invokes++;return {state:'confirmed',evidenceRefs:['fixture-evidence']};}},
  resolveInvocation:(_p,context)=>({toolName:'fixture.write',toolVersion:'1',arguments:{original:true},taskId:binding.taskId,runId:'one-write',authorizationRef:'original-policy-fixture',...context}),
  readExecution:async()=>({state:'confirmed',evidenceRefs:['fixture-original-readback']})};
 const f=fixture({pureAdvance:{kind:'signed_frontier_no_effects'},execution,advancePort:async()=>{
  const n=++calls;if(n===1)throw Error('lost response');
  await new Promise(resolve=>{waiters.push(resolve);if(++entered===2)release();});
  return {...result,checkpoint:'recomputation-'+n};
 }});
 try{
  await assert.rejects(f.session.advance(request()),/lost response/);
  const context={signal:new AbortController().signal};
  const attempts=[f.session.recoverPendingRequest('request-one',context),f.session.recoverPendingRequest('request-one',context)];
  await ready;waiters.forEach(resolve=>resolve());const outcomes=await Promise.allSettled(attempts);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.find(o=>o.status==='rejected').reason.code,'REVISION_CONFLICT');
  await f.session.executeProposal(proposal,{...context,deadline:binding.taskDeadline});
  await f.session.executeProposal(proposal,{...context,deadline:binding.taskDeadline});assert.equal(invokes,1);
  assert.deepEqual(await f.session.recoverPendingRequest('request-one',context),outcomes.find(o=>o.status==='fulfilled').value);assert.equal(calls,3);
 }finally{f.runtime.close();}
});

test('only a trusted pure port can recompute; original expired request cannot acquire a later deadline',async()=>{
 let calls=0;const f=fixture({advancePort:async()=>{calls++;throw Error('lost response');}});
 try{
  await assert.rejects(f.session.advance(request()),/lost response/);
  await assert.rejects(f.session.recoverPendingRequest('request-one',{signal:new AbortController().signal}),{code:'UNSUPPORTED_CAPABILITY'});
  const expired=createProactiveWorkflowSession({...f.options,pureAdvance:{kind:'signed_frontier_no_effects'},now:()=>Date.parse(binding.taskDeadline)+1});
  await assert.rejects(expired.recoverPendingRequest('request-one',{signal:new AbortController().signal,deadline:'2035-01-01T00:00:00.000Z'}),{code:'TIMEOUT'});
  assert.equal(calls,1);assert.equal(expired.inspect().state.requests['request-one'].state,'pending');
 }finally{f.runtime.close();}
});

// Same canonical hash as the documented state identity, without any private Runtime DB access.
import {createHash,createHmac} from 'node:crypto';
function createKey(){return createHash('sha256').update(JSON.stringify({sessionId:binding.sessionId,taskId:binding.taskId})).digest('hex');}
