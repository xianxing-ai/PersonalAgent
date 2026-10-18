import assert from 'node:assert/strict';
import test from 'node:test';
import {OwnedAgentOrchestrator,parseAgentInput,getOwnedWorkflowTemplate} from '../dist/index.js';
import {FakeModelProvider} from '@personal-agent/models';
import {GOAL_PREFIX} from '../dist/input.js';
const invoke = query => ({query,deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,sessionId:'synthetic',requestId:'synthetic-request'});
const response = value => ({kind:'final',text:JSON.stringify(value)});
const model = (...values) => new FakeModelProvider(values.map(response));
function setup(values={},selector) {
  const models=Object.fromEntries(['fast','world','plan','review'].map(role=>[role,model(...(values[role]??[]))]));
  const receipts=[];
  return {models,receipts,agent:new OwnedAgentOrchestrator(models,2048,r=>receipts.push(r),selector)};
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

test('embedded decision selects the exact validated fast proposal without adding authority',async()=>{
  const selections=[];
  const {agent,models}=setup({fast:[proposal]}, {select:async request=>{selections.push(request);return 'proposal';}});
  const request=invoke(JSON.stringify({goal:'查询杭州天气',availableTools:[tool]}));
  assert.deepEqual(await agent.invoke(request),proposal);assert.equal(models.fast.requests.length,1);assert.equal(selections.length,1);
  assert.equal(selections[0].deadline,request.deadline);assert.equal(selections[0].signal,request.signal);
  assert.deepEqual(selections[0].candidates.map(item=>item.id),['proposal','review']);
  assert.equal(Object.hasOwn(JSON.parse(selections[0].context).proposal,'verification'),false);
});
test('workflow preparation preserves node output contract and predecessor state on the existing model role',async()=>{
  const template=getOwnedWorkflowTemplate('F20'),node=template.nodes.find(value=>value.id==='F20_N02');
  const alternative={id:'public-doc',description:'Public schema-backed document',value:{diffFields:['language'],docMarkdown:'public document',exampleArguments:{language:'zh-CN'}}};
  const {agent,models}=setup({plan:[{candidates:[alternative]}]});const request=invoke('public source');
  const prepared=await agent.prepareOwnedWorkflowCandidates({template,node,input:{field:'language',docTemplate:'public template'},
    predecessorOutputs:{F20_N01:{content:'public contract'}},predecessorStates:{F20_N01:'completed'},
    availableTools:[],mode:'main',namespace:'synthetic',...request});
  assert.deepEqual(prepared[0],alternative);assert.equal(prepared[1].id,'owned-review');assert.equal(prepared[1].abstain,true);
  assert.equal(models.plan.requests.length,1);assert.equal(models.fast.requests.length,0);
  const data=JSON.parse(models.plan.requests[0].messages[1].content);
  assert.deepEqual(data.node.outputFields,['docMarkdown']);assert.deepEqual(data.predecessorStates,{F20_N01:'completed'});
  assert.deepEqual(data.predecessorOutputs,{F20_N01:{content:'public contract'}});
});
test('current tool request boundary preserves global downstream requirements without fabricating their outputs',async()=>{
  const template=getOwnedWorkflowTemplate('F20'),node=template.nodes.find(value=>value.id==='F20_N01');
  const input={goal:'Read public-api.json before producing API docs; the path must be extracted from this sentence',codeFile:'public-api.json',
    expectedOutputFields:['docMarkdown','exampleArguments']};
  const value={toolName:'workspace.read_text',toolVersion:'1.0.0',arguments:{path:'public-api.json'}};
  const {agent,models,receipts}=setup({fast:[{candidates:[{id:'source-read',description:'Read public source before comparison',value}]}]});
  const prepared=await agent.prepareOwnedWorkflowCandidates({template,node,input,predecessorOutputs:{},predecessorStates:{},
    availableTools:[{name:'workspace.read_text',version:'1.0.0',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}}],
    mode:'main',namespace:'synthetic',...invoke('public source')});
  const data=JSON.parse(models.fast.requests[0].messages[1].content);
  assert.deepEqual(data.input,input);assert.deepEqual(data.node.outputFields,['diffFields']);
  assert.deepEqual(data.currentCandidateBoundary,{kind:'unexecuted_tool_request',nodeOutputStage:'after_actual_host_receipt',
    selectionBasis:'published_schema_and_task_arguments',resultEvidenceStage:'after_actual_execution'});
  assert.deepEqual(data.publishedTools,data.availableTools);
  assert.deepEqual(prepared[0].value,value);assert.equal(prepared[1].abstain,true);
  const diagnostic=receipts.find(value=>value.event==='workflow_candidates');
  assert.equal(diagnostic.stage,'candidate_response');assert.equal(diagnostic.nodeId,'F20_N01');assert.equal(diagnostic.candidateCount,1);
  assert.match(diagnostic.candidateArrayDigest,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(diagnostic).includes('public-api.json'),false);
});
test('an explicit source path binds the published reader without a redundant generative model call',async()=>{
  const template=getOwnedWorkflowTemplate('F15'),node=template.nodes.find(value=>value.id==='F15_N01');
  const {agent,models,receipts}=setup();
  const prepared=await agent.prepareOwnedWorkflowCandidates({template,node,input:{goal:'Repair the SVG',targetFile:'pelican.svg'},
    predecessorOutputs:{},predecessorStates:{},availableTools:[{name:'workspace.read_text',version:'1.0.0',
      inputSchema:{type:'object',properties:{path:{const:'pelican.svg'}},required:['path'],additionalProperties:false}}],
    mode:'main',namespace:'synthetic',...invoke('explicit path')});
  assert.equal(models.fast.requests.length,0);assert.deepEqual(prepared[0].value,
    {toolName:'workspace.read_text',toolVersion:'1.0.0',arguments:{path:'pelican.svg'}});
  assert.equal(prepared[1].abstain,true);assert.equal(receipts[0].candidatePreparation,'deterministic_binding');
  assert.equal(JSON.stringify(receipts).includes('pelican.svg'),false);
});
test('empty actual candidate array is separately diagnosed before any selector invocation',async()=>{
  const template=getOwnedWorkflowTemplate('F20'),node=template.nodes.find(value=>value.id==='F20_N01');let selections=0;
  const {agent,receipts}=setup({fast:[{candidates:[]}]},{select:async()=>{selections++;return 'proposal';}});
  await assert.rejects(agent.prepareOwnedWorkflowCandidates({template,node,input:{goal:'public source'},predecessorOutputs:{},
    predecessorStates:{},availableTools:[],mode:'main',namespace:'synthetic',...invoke('public source')}),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(selections,0);const diagnostic=receipts.find(value=>value.event==='workflow_candidates');
  assert.equal(diagnostic.candidateCount,0);assert.equal(diagnostic.status,'failed');assert.equal(diagnostic.errorCode,'UNSUPPORTED_CAPABILITY');
  assert.match(diagnostic.candidateArrayDigest,/^[a-f0-9]{64}$/);
});

test('existing candidate preparation carries optional shadow intent as advisory data in the same model call',async()=>{
  const template=getOwnedWorkflowTemplate('F20'),node=template.nodes.find(value=>value.id==='F20_N02');
  const shadowIntent={taskClass:'public-doc',mode:'ordinary',tier:'trace_replay',shadowRequested:true,uncertain:false};
  const {agent,models}=setup({plan:[{candidates:[{id:'doc',description:'source-backed document',value:{docMarkdown:'public'},shadowIntent}]}]});
  const result=await agent.prepareOwnedWorkflowCandidates({template,node,input:{goal:'public doc'},predecessorOutputs:{},
    predecessorStates:{},availableTools:[],mode:'main',namespace:'synthetic',...invoke('public')});
  assert.equal(models.plan.requests.length,1);assert.equal(models.fast.requests.length,0);
  assert.deepEqual(result[0].metadata.shadowPlan,{...shadowIntent,provenance:{decidedBy:'code',deepseekProposalRef:null,
    layaDecisionRef:null,layaQualified:false,uncertaintyResolved:false}});
  assert.equal(result[1].abstain,true);
});
test('embedded decision can require review of the repair candidate after World Plan Review',async()=>{
  const selections=[];
  const {agent,models}=setup({world:[compactWorld],plan:[compactPlan],review:[sourcedCandidate]},
    {select:async request=>{selections.push(request);return 'review';}});
  const output=await agent.invoke(invoke(sourcedQuery));assert.equal(output.kind,'text');assert.match(output.text,/RECHECK/);
  assert.deepEqual(['world','plan','review'].map(role=>models[role].requests.length),[1,1,1]);assert.equal(selections.length,1);
  assert.deepEqual(JSON.parse(selections[0].context).proposal,sourcedCandidate);assert.equal(Object.hasOwn(output,'verification'),false);
});
test('World KEEP and source-insufficient RECHECK still pass the unique final selector',async()=>{
  for(const world of [{disposition:'KEEP',affected:[],reason:'无相关变更',missing_information:[]},
    {disposition:'REVISE',affected:['plan'],reason:'来源缺失',missing_information:[]}]) {
    let choices=0;const {agent,models}=setup({world:[world]}, {select:async()=>{choices++;return 'proposal';}});
    const output=await agent.invoke(invoke(repairQuery));assert.equal(output.kind,'text');assert.equal(choices,1);
    assert.equal(models.plan.requests.length,0);assert.equal(models.review.requests.length,0);
  }
});
test('decision failures and stale answers cannot silently restore the unselected proposal',async()=>{
  for(const selector of [{select:async()=> 'invented-action'},{select:async()=>{throw new Error('synthetic unavailable');}}]) {
    const {agent}=setup({fast:[proposal]},selector);
    await assert.rejects(agent.invoke(invoke(JSON.stringify({goal:'查询天气',availableTools:[tool]}))));
  }
  const control=new AbortController();const {agent}=setup({fast:[proposal]}, {select:async()=>{control.abort();return 'proposal';}});
  await assert.rejects(agent.invoke({...invoke(JSON.stringify({goal:'查询天气',availableTools:[tool]})),signal:control.signal}),{code:'CANCELLED'});
});

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
  assert.equal(new Set(receipts.map(r=>r.spanId)).size,3);
  for (let i=0;i<receipts.length;i+=2) {
    const [started,ended]=receipts.slice(i,i+2);
    assert.equal(started.status,'started'); assert.equal(ended.status,'completed');
    assert.equal(started.spanId,ended.spanId); assert.equal(started.startedAt,ended.startedAt);
    assert.equal(ended.requestId,'synthetic-request');
    assert.equal(Number.isFinite(Date.parse(ended.endedAt)),true);
    assert.ok(ended.durationMs>=0); assert.equal(started.endedAt,undefined);
  }
  assert.equal(JSON.stringify(receipts).includes('16点'),false);
  for(const receipt of receipts.filter(value=>value.status==='completed')) {
    assert.ok(Number.isFinite(receipt.durationMs)&&receipt.durationMs>=0);
    assert.equal(receipt.durationScope,'model_gateway_complete');
  }
  assert.ok(receipts.filter(value=>value.status==='started').every(value=>value.durationMs===undefined));
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
