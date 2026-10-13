import assert from 'node:assert/strict';
import test from 'node:test';
import {OwnedAgentOrchestrator,parseAgentInput} from '../dist/index.js';
import {FakeModelProvider} from '@personal-agent/models';
import {GOAL_PREFIX} from '../dist/input.js';
const invoke = query => ({query,deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,sessionId:'synthetic',requestId:'synthetic-request'});
const response = value => ({kind:'final',text:JSON.stringify(value)});
const model = (...values) => new FakeModelProvider(values.map(response));
function setup(values={}) {
  const models=Object.fromEntries(['fast','world','plan','review'].map(role=>[role,model(...(values[role]??[]))]));
  const receipts=[];
  return {models,receipts,agent:new OwnedAgentOrchestrator(models,2048,r=>receipts.push(r))};
}
const tool = {name:'weather.forecast',version:'1.0.0',inputSchema:{type:'object',properties:{city:{type:'string'}},required:['city'],additionalProperties:false}};
const proposal={kind:'tool_proposal',proposalId:'weather-1',toolName:tool.name,toolVersion:tool.version,arguments:{city:'杭州'}};
const context={expectedGraphRevision:7,targets:[{node:{id:'plan',revision:2},requestedSummary:'16:00准备',requestedDependencies:[{id:'fact',revision:3}]}],allowedDependencies:[{id:'fact',revision:3}]};
const change={node:context.targets[0].node,summary:context.targets[0].requestedSummary,reason:'会议时间变更',dependencies:context.targets[0].requestedDependencies};
const candidate={kind:'repair_candidate',candidateVersion:'1.0',candidate:{expectedGraphRevision:7,changes:[change]}};
const repairQuery=JSON.stringify({continuation:{proposalId:'read-1',state:'confirmed',result:{repairContext:context}}});
const goalId='b'.repeat(64),planNodeId='a'.repeat(64);
const sourcedChange={node:{id:planNodeId,revision:1},summary:'16点准备',reason:'会议时间变更',dependencies:[{id:goalId,revision:2}]};
const sourcedCandidate={kind:'repair_candidate',candidateVersion:'1.0',candidate:{expectedGraphRevision:7,changes:[sourcedChange]}};
const sourcedQuery=GOAL_PREFIX+JSON.stringify({action:'REVISE',strategy:'最小修复',nodes:[
  {id:goalId,revision:1,kind:'goal',summary:'14点准备',state:'active',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z'},
  {id:goalId,revision:2,kind:'goal',summary:'16点准备',state:'active',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z'},
  {id:planNodeId,revision:1,kind:'plan',summary:'14点准备',state:'active',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z'}],
  repairContext:{expectedGraphRevision:7,targets:[{node:sourcedChange.node,summary:'14点准备',requestedDependencies:sourcedChange.dependencies}],allowedDependencies:sourcedChange.dependencies},
  omittedSources:0,calibrated:false,executed:false});
const compactWorld={disposition:'REVISE',affected:[planNodeId],reason:'变更',missing_information:[]};
const compactPlan={disposition:'REVISE',changes:[sourcedChange],missing_information:[]};

test('ordinary tool proposal and confirmed weather answer use fast only and no trust fields',async()=>{
  const {agent,models}=setup({fast:[proposal,{kind:'text',text:'已确认投影：杭州明天小雨，来源与时间见回执。'}]});
  assert.deepEqual(await agent.invoke(invoke(JSON.stringify({goal:'查询杭州天气',availableTools:[tool]}))),proposal);
  const continuation={proposalId:proposal.proposalId,state:'confirmed',result:{city:'杭州',forecast:'小雨'}};
  const answer=await agent.invoke(invoke(JSON.stringify({continuation})));
  assert.equal(answer.kind,'text'); assert.equal(Object.hasOwn(answer,'verification'),false);
  assert.equal(models.fast.requests.length,2); assert.equal(models.world.requests.length,0);
  assert.equal(models.fast.requests[1].messages[1].content.includes('confirmed'),true);
});
test('missing tool, bad arguments, forged authority, malformed model JSON fail closed',async()=>{
  for(const bad of [{...proposal,toolName:'shell.exec'},{...proposal,arguments:{}},
    {...proposal,authorizationRef:'forged'}, {...proposal,verification:'verified'},
    {...proposal,toolVersion:'latest'}]) {
    const {agent}=setup({fast:[bad]});
    await assert.rejects(agent.invoke(invoke(JSON.stringify({goal:'查天气',availableTools:[tool]}))));
  }
  const {agent}=setup({fast:[proposal]});
  await assert.rejects(agent.invoke(invoke('查询杭州天气')),{code:'UNSUPPORTED_CAPABILITY'});
});
test('confirmed command result uses no model; nonzero and inconsistent receipts are preserved/rejected',async()=>{
  const {agent,models}=setup();
  const query = result => JSON.stringify({continuation:{proposalId:'check-1',state:'confirmed',result}});
  assert.match((await agent.invoke(invoke(query({recipeId:'npm-test',exitCode:1,passed:false})))).text,/未通过/);
  await assert.rejects(agent.invoke(invoke(query({recipeId:'npm-test',exitCode:1,passed:true}))));
  assert.equal(models.fast.requests.length,0);
});
test('repair executes World Plan Review once, checks fixed revision/dependencies, emits content-free receipts',async()=>{
  const {agent,models,receipts}=setup({world:[compactWorld],plan:[compactPlan],review:[sourcedCandidate]});
  assert.deepEqual(await agent.invoke(invoke(sourcedQuery)),sourcedCandidate);
  assert.deepEqual(['world','plan','review'].map(r=>models[r].requests.length),[1,1,1]);
  assert.deepEqual(receipts.map(r=>r.role),['world','world','plan','plan','review','review']);
  assert.equal(JSON.stringify(receipts).includes('16点'),false);
});
test('source-less continuation stops before Plan and Review',async()=>{
  const {agent,models}=setup({world:[{disposition:'REVISE',affected:['plan'],reason:'变更',missing_information:[]}],
    plan:[{disposition:'REVISE',changes:[change],missing_information:[]}],review:[candidate]});
  assert.deepEqual(await agent.invoke(invoke(repairQuery)),{kind:'text',text:'RECHECK：世界状态分析缺少确定的修复依据。'});
  assert.deepEqual(['world','plan','review'].map(r=>models[r].requests.length),[1,0,0]);
});
test('source-less compact KEEP returns KEEP before the empty-source check',async()=>{
  const {agent,models}=setup({world:[{disposition:'KEEP',affected:[],reason:'没有相关影响',missing_information:[]}],
    plan:[{disposition:'REVISE',changes:[change],missing_information:[]}],review:[candidate]});
  assert.deepEqual(await agent.invoke(invoke(repairQuery)),{kind:'text',text:'KEEP：世界状态分析无需修复。'});
  assert.deepEqual(['world','plan','review'].map(r=>models[r].requests.length),[1,0,0]);
});
test('source-less versioned KEEP is rejected and does not return KEEP text',async()=>{
  const versionedKeep={reportVersion:'1.1',revision:7,observed_facts:[],changed_facts:[],affected_items:[],
    missing_information:[],recommended_disposition:'KEEP',summary:'没有相关影响'};
  const {agent,models}=setup({world:[versionedKeep],
    plan:[{disposition:'REVISE',changes:[change],missing_information:[]}],review:[candidate]});
  await assert.rejects(agent.invoke(invoke(repairQuery)),{code:'EXTERNAL_FAILURE',message:'Invalid versioned role report'});
  assert.deepEqual(['world','plan','review'].map(r=>models[r].requests.length),[1,0,0]);
});
test('repair rejects scope/revision/summary/dependency substitutions and wrong route',async()=>{
  for(const altered of [{...sourcedChange,node:{id:'c'.repeat(64),revision:1}}, {...sourcedChange,summary:'编造计划'},
    {...sourcedChange,dependencies:[]}, {...sourcedChange,node:{id:planNodeId,revision:99}}]) {
    const {agent}=setup({world:[compactWorld],plan:[{disposition:'REVISE',changes:[altered],missing_information:[]}]});
    await assert.rejects(agent.invoke(invoke(sourcedQuery)),{code:'EXTERNAL_FAILURE'});
  }
  const {agent}=setup({fast:[candidate]});
  await assert.rejects(agent.invoke(invoke('你好')),{code:'EXTERNAL_FAILURE'});
});
test('uncertainty stops repair before Plan and Review; corrupt context starts zero model calls',async()=>{
  const {agent,models}=setup({world:[{disposition:'RECHECK',affected:[],reason:'缺少来源',missing_information:['来源']}]});
  assert.match((await agent.invoke(invoke(repairQuery))).text,/RECHECK/);
  assert.equal(models.plan.requests.length,0); assert.equal(models.review.requests.length,0);
  await assert.rejects(agent.invoke(invoke(JSON.stringify({continuation:{proposalId:'p',state:'confirmed',result:{repairContext:{}}}}))));
  assert.equal(models.world.requests.length,1);
});
test('initial Goal repair checks original target baseline and never treats executed as authority',async()=>{
  const planId='a'.repeat(64),goalId='b'.repeat(64);
  const payload={action:'REVISE',strategy:'最小修复',nodes:[{id:planId,revision:1,kind:'plan',summary:'14点准备',state:'active',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z'}],repairContext:{expectedGraphRevision:1,targets:[{node:{id:planId,revision:1},summary:'14点准备',requestedDependencies:[{id:goalId,revision:2}]}],allowedDependencies:[{id:goalId,revision:2}]},omittedSources:0,calibrated:false,executed:false};
  const revised={node:{id:planId,revision:1},summary:'16点准备',reason:'目标变更',dependencies:[{id:goalId,revision:2}]};
  payload.nodes.push({id:goalId,revision:2,kind:'goal',summary:'目标已改为16点准备',state:'active',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z'});
  const {agent}=setup({world:[{disposition:'REVISE',affected:[planId],reason:'目标变更',missing_information:[]}],plan:[{disposition:'REVISE',changes:[revised],missing_information:[]}],review:[{kind:'repair_candidate',candidateVersion:'1.0',candidate:{expectedGraphRevision:1,changes:[revised]}}]});
  assert.equal((await agent.invoke(invoke(GOAL_PREFIX+JSON.stringify(payload)))).kind,'repair_candidate');
  await assert.rejects(agent.invoke(invoke(GOAL_PREFIX+JSON.stringify({...payload,executed:true}))));
});
test('cancel and original deadline stop non-cooperative provider without fallback or next role',async()=>{
  const provider=model(); provider.complete=()=>new Promise(()=>{});
  const agent=new OwnedAgentOrchestrator({fast:provider,world:provider,plan:provider,review:provider},2048);
  await assert.rejects(agent.invoke({...invoke('你好'),deadline:new Date(Date.now()+35).toISOString()}),{code:'TIMEOUT'});
  const controller=new AbortController(); const pending=agent.invoke({...invoke('你好'),signal:controller.signal});
  controller.abort(); await assert.rejects(pending,{code:'CANCELLED'});
});
test('strict input rejects unconfirmed, injected fields, malformed JSON and duplicate catalogs',()=>{
  for(const query of ['{"goal":"x"}',JSON.stringify({continuation:{proposalId:'p',state:'unknown',result:{}}}),
    JSON.stringify({goal:'x',availableTools:[tool,tool]}),'{broken',JSON.stringify({goal:'x',availableTools:[],authorizationRef:'x'})]) {
    assert.throws(()=>parseAgentInput(query));
  }
});

test('review cannot substitute plan and unresolved sources cannot enter repair',async()=>{
  const {agent}=setup({world:[compactWorld],plan:[compactPlan],review:[{...sourcedCandidate,candidate:{...sourcedCandidate.candidate,changes:[{...sourcedChange,reason:'被替换的理由'}]}}]});
  await assert.rejects(agent.invoke(invoke(sourcedQuery)),{code:'EXTERNAL_FAILURE'});
  for (const badWorld of [{...compactWorld,missing_information:['缺少来源']},{...compactWorld,affected:[]}]) {
    const {agent}=setup({world:[badWorld],plan:[compactPlan]});
    await assert.rejects(agent.invoke(invoke(sourcedQuery)),{code:'EXTERNAL_FAILURE'});
  }
});
