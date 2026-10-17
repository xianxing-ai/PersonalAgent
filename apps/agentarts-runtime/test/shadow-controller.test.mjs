import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentServer} from '../src/server.mjs';
import {createWorkflowShadowController,signWorkflowShadowRequest,signWorkflowShadowBranchReceipt,signWorkflowShadowIsolationReceipt,verifyWorkflowShadowResponse} from '../src/shadow-controller.mjs';

const receiptSecret='public-fixture-existing-receipt-secret-123456';
const config={sampling:{base:1,min:0,max:1,adjustmentRate:0.2,minimumVerifiedSamples:1},comparison:{qualityWeight:1,wallMsWeight:0.1,modelCallWeight:0.1}};
const context=extra=>({taskId:'task-fixture',sessionId:'session-fixture',requestId:'request-fixture',controlRevision:3,taskDeadline:new Date(Date.now()+60000).toISOString(),...extra});
const isolation=ctx=>signWorkflowShadowIsolationReceipt({receiptSecret,context:ctx,snapshotDigest:'a'.repeat(64),namespace:'trusted-isolated-fixture'});
function unsigned(ctx=context()) {return {shadowVersion:1,operation:'evaluate',...ctx,
  plan:{taskKey:ctx.taskId,taskClass:'coding',mode:'ordinary',tier:'isolated',isolation:isolation(ctx),
    decision:{selectedCandidateId:'main',shadowCandidateId:'shadow',shadowRequested:true,uncertain:false,decisionRef:'original-selection',
      provenance:{decidedBy:'deepseek',deepseekProposalRef:'actual-fixture-teacher-receipt',layaDecisionRef:'actual-fixture-local-receipt',layaQualified:false,uncertaintyResolved:true}}},
  resources:{mainPriorityAvailable:true,shadowAllowed:true,taskValueEligible:true,advancedEnabled:true},observedBranches:[],historySnapshot:null};}
const sign=value=>signWorkflowShadowRequest({receiptSecret,value});
const invoke=(controller,value,extra={})=>controller({value,deadline:new Date(Date.now()+120000).toISOString(),signal:new AbortController().signal,
  ...contextOf(value),requestId:value.requestId,...extra});
const contextOf=value=>({taskId:value.taskId,sessionId:value.sessionId,controlRevision:value.controlRevision,taskDeadline:value.taskDeadline});
function branch(value,kind,extra={}) {
  const receipt={receiptId:kind+'-actual-fixture-receipt',taskKey:value.taskId,taskClass:value.plan.taskClass,decisionRef:value.plan.decision.decisionRef,
    branch:kind,candidateId:value.plan.decision[kind==='main'?'selectedCandidateId':'shadowCandidateId'],baselineSha256:'a'.repeat(64),conditionsDigest:'b'.repeat(64),
    workspaceRef:kind+'-isolated-fixture',resultSha256:'c'.repeat(64),qualityMetricId:'explicit-fixture-quality',qualityScore:kind==='shadow'?2:1,
    wallMs:kind==='shadow'?8:10,modelCalls:1,evidenceRefs:[kind+'-actual-fixture-evidence'],...extra};
  return signWorkflowShadowBranchReceipt({receiptSecret,receipt,context:{...contextOf(value),isolation:value.plan.isolation}});
}

test('signed envelope consumes original deadline, preserves provenance, and is only an advisory response',async()=>{
  const value=sign(unsigned()),controller=createWorkflowShadowController({receiptSecret,policyConfig:config});
  const response=await invoke(controller,value),result=verifyWorkflowShadowResponse({receiptSecret,response,request:value,currentContext:contextOf(value)});
  assert.equal(result.action,'run');assert.equal(result.actualExecutionVerified,false);assert.equal(result.authority,'advisory_no_tool_grant');
  assert.equal(result.originalTaskDeadline,value.taskDeadline);assert.equal(result.effectiveDeadline,value.taskDeadline);
  assert.equal(result.decisionProvenance.decidedBy,'deepseek');assert.equal(result.comparison.status,'unknown');
  assert.throws(()=>verifyWorkflowShadowResponse({receiptSecret,response:{...response,result:{action:'run',mayDeliverMain:true}},request:value}),{code:'UNAUTHORIZED'});
  assert.throws(()=>verifyWorkflowShadowResponse({receiptSecret,response,request:value,currentContext:{...contextOf(value),controlRevision:4}}),{code:'REVISION_CONFLICT'});
});
test('unqualified final Laya needs teacher; actual DeepSeek takeover resolves uncertainty and can run',async()=>{
  const controller=createWorkflowShadowController({receiptSecret,policyConfig:config}),value=unsigned();
  value.plan.decision.provenance={decidedBy:'laya',deepseekProposalRef:null,layaDecisionRef:'local-real-fixture-ref',layaQualified:false,uncertaintyResolved:false};
  assert.equal((await invoke(controller,sign(value))).result.action,'need_teacher');
  value.plan.decision.uncertain=true;
  value.plan.decision.provenance={decidedBy:'deepseek',deepseekProposalRef:'teacher-took-over',layaDecisionRef:'local-real-fixture-ref',layaQualified:false,uncertaintyResolved:true};
  assert.equal((await invoke(controller,sign(value))).result.action,'run');
  value.plan.decision.provenance.uncertaintyResolved=false;
  assert.equal((await invoke(controller,sign(value))).result.action,'need_teacher');
});
test('isolated execution needs trusted snapshot; light tiers and replay lack counterfactual',async()=>{
  const controller=createWorkflowShadowController({receiptSecret,policyConfig:config}),value=unsigned();value.plan.isolation=null;
  const deferred=await invoke(controller,sign(value));assert.equal(deferred.result.action,'defer');assert.equal(deferred.result.reason,'trusted_isolation_snapshot_required');
  value.plan.tier='trace_replay';value.plan.mode='compare';
  const replay=await invoke(controller,sign(value));assert.equal(replay.result.comparison.status,'unknown');assert.equal(replay.result.mayDeliverMain,false);
  value.plan.tier='decision_shadow';value.resources.shadowAllowed=false;
  assert.equal((await invoke(controller,sign(value))).result.action,'defer');
  value.plan.tier='isolated';value.plan.isolation={...isolation(value),snapshotDigest:'forged'};
  await assert.rejects(invoke(controller,sign(value)),{code:'UNAUTHORIZED'});
});
test('each observed branch is signed and current; model verified labels cannot promote results',async()=>{
  const controller=createWorkflowShadowController({receiptSecret,policyConfig:config}),value=unsigned();
  value.observedBranches=[branch(value,'main')];
  const mainOnly=await invoke(controller,sign(value));assert.equal(mainOnly.result.mayDeliverMain,true);assert.equal(mainOnly.result.comparison.reason,'missing_counterfactual');
  value.plan.mode='compare';value.observedBranches.push(branch(value,'shadow'));
  const both=await invoke(controller,sign(value));assert.equal(both.result.mayDeliverMain,true);assert.equal(both.result.comparison.status,'comparable');
  value.observedBranches[1].qualityScore=100;
  await assert.rejects(invoke(controller,sign(value)),{code:'UNAUTHORIZED'});
  value.observedBranches=[{...branch(value,'main'),verified:true}];
  await assert.rejects(invoke(controller,sign(value)),{code:'UNAUTHORIZED'});
});
test('history snapshot re-verifies historical task receipts, performs no write, and is not image storage',async()=>{
  const policyConfig={...config,sampling:{...config.sampling,base:0.4}},controller=createWorkflowShadowController({receiptSecret,policyConfig}),value=unsigned();
  const past=unsigned(context({taskId:'past-task',taskDeadline:'2025-01-01T00:00:00.000Z'}));
  value.historySnapshot={version:1,revision:1,taskClass:'coding',pairs:[[branch(past,'main'),branch(past,'shadow')]]};
  const response=await invoke(controller,sign(value));assert.equal(response.result.historySamples,1);assert.ok(Math.abs(response.result.samplingRate-0.6)<1e-12);
  value.historySnapshot.pairs[0][1].wallMs=0;
  await assert.rejects(invoke(controller,sign(value)),{code:'UNAUTHORIZED'});
  const fresh=await invoke(controller,sign(unsigned()));assert.equal(fresh.result.historySamples,0,'controller stores no caller history');
});
test('exact fields, tampered signatures, sessions/revisions, expired original deadlines and cancellation fail closed',async()=>{
  const controller=createWorkflowShadowController({receiptSecret,policyConfig:config}),value=sign(unsigned());
  for(const field of ['config','url','key','code'])await assert.rejects(invoke(controller,sign({...unsigned(),[field]:'caller-injected'})),{code:'INVALID_ARGUMENT'});
  const tampered=structuredClone(value);tampered.plan.decision.shadowRequested=false;
  await assert.rejects(invoke(controller,tampered),{code:'UNAUTHORIZED'});
  await assert.rejects(invoke(controller,value,{sessionId:'other'}),{code:'REVISION_CONFLICT'});
  await assert.rejects(invoke(controller,value,{controlRevision:4}),{code:'REVISION_CONFLICT'});
  await assert.rejects(invoke(controller,value,{taskDeadline:new Date(Date.now()+180000).toISOString()}),{code:'REVISION_CONFLICT'});
  const expired=sign(unsigned(context({taskDeadline:'2025-01-01T00:00:00.000Z'})));
  await assert.rejects(invoke(controller,expired),{code:'TIMEOUT'});
  const stop=new AbortController();stop.abort();await assert.rejects(invoke(controller,value,{signal:stop.signal}),{code:'CANCELLED'});
  assert.throws(()=>createWorkflowShadowController({receiptSecret}),/configuration/);
  assert.throws(()=>createWorkflowShadowController({receiptSecret,policyConfig:{...config,sampling:{...config.sampling,base:NaN}}}),/values/);
});
test('actual existing HTTP invocations route uses inner credential plus signed host context with no model fallback',async t=>{
  const token='explicit-public-host-token-fixture-123456789',value=sign(unsigned());
  const server=createAgentServer({mode:'standalone-validation',authToken:token,wssAuthToken:token,
    orchestrator:{invoke:async()=>{throw Error('No model fallback');}},serviceControllers:{shadowVersion:createWorkflowShadowController({receiptSecret,policyConfig:config})}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/invocations';
  const post=headers=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-hw-agentarts-session-id':value.sessionId,'x-request-id':value.requestId,...headers},body:JSON.stringify({query:JSON.stringify(value)})});
  assert.equal((await post({})).status,401);
  const response=await post({'x-pa-agent-token':'Bearer '+token});assert.equal(response.status,200);
  const events=await response.json(),signed=JSON.parse(events[0].data.text);
  assert.equal(verifyWorkflowShadowResponse({receiptSecret,response:signed,request:value}).action,'run');
});
test('advanced isolated run requires actual same-decision Laya and teacher participation',async()=>{
  const controller=createWorkflowShadowController({receiptSecret,policyConfig:config}),value=unsigned();
  value.plan.decision.provenance={decidedBy:'code',deepseekProposalRef:null,layaDecisionRef:null,layaQualified:false,uncertaintyResolved:false};
  assert.equal((await invoke(controller,sign(value))).result.action,'need_teacher');
  value.plan.decision.provenance={decidedBy:'deepseek',deepseekProposalRef:'same-decision-teacher',layaDecisionRef:null,layaQualified:false,uncertaintyResolved:true};
  assert.equal((await invoke(controller,sign(value))).result.action,'need_teacher');
  value.plan.decision.uncertain=true;value.plan.decision.provenance.layaDecisionRef='same-decision-laya';
  assert.equal((await invoke(controller,sign(value))).result.action,'run','teacher already took over; no repeated Laya call required');
});
test('historical branch pair from different signed control revisions cannot affect sampling',async()=>{
  const controller=createWorkflowShadowController({receiptSecret,policyConfig:config}),value=unsigned();
  const past=unsigned(context({taskId:'past-task',controlRevision:1,taskDeadline:'2025-01-01T00:00:00.000Z'}));
  const revisionTwo=unsigned({...contextOf(past),requestId:'past-request-2',controlRevision:2});
  const main=branch(past,'main'),shadow=branch(revisionTwo,'shadow');
  value.historySnapshot={version:1,revision:1,taskClass:'coding',pairs:[[main,shadow]]};
  await assert.rejects(invoke(controller,sign(value)),{code:'REVISION_CONFLICT'});
  value.historySnapshot=null;assert.equal((await invoke(controller,sign(value))).result.historySamples,0);
});
test('signed replay operation binds the same original context/deadline and is verified as replay_result',async()=>{
  const controller=createWorkflowShadowController({receiptSecret,policyConfig:config}),ctx=context();
  const unsignedReplay={shadowVersion:1,operation:'replay',...ctx,snapshot:{asOf:new Date(Date.now()-1000).toISOString(),sourceVersions:{fixture:'v1'},records:[]},requestedActions:[]};
  const value=sign(unsignedReplay),response=await invoke(controller,value);
  assert.equal(response.operation,'replay_result');assert.equal(response.authority,'data_only_no_tool_grant');
  const result=verifyWorkflowShadowResponse({receiptSecret,response,request:value,currentContext:contextOf(value)});
  assert.equal(result.actualToolCalls,0);assert.equal(result.originalTaskDeadline,ctx.taskDeadline);assert.equal(result.effectiveDeadline,ctx.taskDeadline);
  await assert.rejects(invoke(controller,value,{controlRevision:ctx.controlRevision+1}),{code:'REVISION_CONFLICT'});
  const stop=new AbortController();stop.abort();await assert.rejects(invoke(controller,value,{signal:stop.signal}),{code:'CANCELLED'});
  const expired=sign({...unsignedReplay,taskDeadline:'2025-01-01T00:00:00.000Z'});await assert.rejects(invoke(controller,expired),{code:'TIMEOUT'});
  await assert.rejects(invoke(controller,sign({...unsignedReplay,config:{}})),{code:'INVALID_ARGUMENT'});
});

test('explicit trusted advanced setting is separate from available resources',async()=>{
  const controller=createWorkflowShadowController({receiptSecret,policyConfig:config}),value=unsigned();
  value.resources.advancedEnabled=false;
  const disabled=await invoke(controller,sign(value));assert.equal(disabled.result.action,'skip');assert.equal(disabled.result.reason,'trusted_advanced_mode_disabled');
  delete value.resources.advancedEnabled;
  const missing=await invoke(controller,sign(value));assert.equal(missing.result.action,'defer');assert.equal(missing.result.reason,'trusted_advanced_setting_unavailable');
  value.resources.advancedEnabled='model says yes';await assert.rejects(invoke(controller,sign(value)),{code:'INVALID_ARGUMENT'});
});
