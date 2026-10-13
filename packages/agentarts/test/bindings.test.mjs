import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {OwnedAgentOrchestrator,getOwnedBindings} from '../dist/index.js';
import {GOAL_PREFIX} from '../dist/input.js';
import {FakeModelProvider} from '@personal-agent/models';

const bindings = getOwnedBindings();
const workflow = name => bindings.find(item => item.type === 'workflow' && item.name === name).id;
const goalId='b'.repeat(64),planId='a'.repeat(64),otherId='c'.repeat(64);
const ref=(id,revision=1)=>({id,revision});
const node=(id,revision,kind,summary)=>({id,revision,kind,summary,state:'active',
  validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z'});
const query=()=>GOAL_PREFIX+JSON.stringify({action:'REVISE',strategy:'最小修复',
  nodes:[node(goalId,1,'goal','14点准备'),node(goalId,2,'goal','16点准备'),node(planId,1,'plan','14点准备'),node(otherId,1,'plan','其他工作')],
  repairContext:{expectedGraphRevision:7,targets:[
    {node:ref(planId),summary:'14点准备',requestedDependencies:[ref(goalId,2)]},
    {node:ref(otherId),summary:'其他工作',requestedDependencies:[ref(goalId,2)]}],allowedDependencies:[ref(goalId,2)]},
  omittedSources:0,calibrated:false,executed:false});
const world=()=>({reportVersion:'1.1',revision:7,observed_facts:[
  {node:ref(goalId),fact:'14点准备',confidence:'explicit'},
  {node:ref(goalId,2),fact:'16点准备',confidence:'explicit'}],
  changed_facts:[{previous:ref(goalId),current:ref(goalId,2),change:'目标时间变化'}],
  affected_items:[{kind:'plan_step',node:ref(planId),impact:'direct',reason:'目标时间变化'}],
  missing_information:[],recommended_disposition:'REVISE',summary:'只改准备时间'});
const plan=()=>({reportVersion:'1.1',base_revision:7,disposition:'REVISE',
  preserved_steps:[{node:ref(otherId),reason:'其他工作不受影响'}],rechecked_steps:[],
  revised_steps:[{node:ref(planId),replacement:'16点准备',reason:'目标时间变化'}],removed_steps:[],
  dependency_updates:[{node:ref(planId),dependencies:[ref(goalId,2)],reason:'使用新目标版本'}],
  evidence_required:['本地Policy、CAS及执行读回'],missing_information:[],local_next_actions:[]});
const candidate=()=>({kind:'repair_candidate',candidateVersion:'1.0',candidate:{expectedGraphRevision:7,
  changes:[{node:ref(planId),summary:'16点准备',reason:'目标时间变化',dependencies:[ref(goalId,2)]}]}});
const request=(queryValue=query())=>({query:queryValue,deadline:new Date(Date.now()+5000).toISOString(),
  signal:new AbortController().signal,sessionId:'binding-synthetic',requestId:'binding-synthetic'});
function setup(values={world:[world()],plan:[plan()],review:[candidate()]}) {
  const models=Object.fromEntries(['fast','world','plan','review'].map(role=>[role,new FakeModelProvider(
    (values[role]??[]).map(value=>({kind:'final',text:JSON.stringify(value)})))]));
  return {models,agent:new OwnedAgentOrchestrator(models,4096)};
}
const counts=models=>['fast','world','plan','review'].map(role=>models[role].requests.length);
const assertEnvelope=(output,id,kind)=>{
  assert.equal(output.bindingVersion,'1.0.0');assert.equal(output.verification,'unverified');
  assert.equal(output.binding.id,id);assert.equal(output.result.kind,kind);
  assert.equal(Object.hasOwn(output.binding,'requirements'),false);
};
const emptySchema={type:'object',properties:{},required:[],additionalProperties:false};
const commandTool=name=>({name,version:'1.0.0',inputSchema:emptySchema});
const initial=(goal,availableTools=[])=>JSON.stringify({goal,availableTools});

test('binding whitelist exactly covers the 8 and 3 public level-1 resources and is caller-independent',()=>{
  const assets=JSON.parse(readFileSync(new URL('../../../docs/modules/AGENTARTS-OWNED-IMAGE-ASSETS.json',import.meta.url)));
  const controllers=JSON.parse(readFileSync(new URL('../../../docs/modules/AGENTARTS-OWNED-IMAGE-CONTROLLERS.json',import.meta.url)));
  const expected=[...assets.resources,...controllers.resources].filter(item=>item.level===1)
    .map(({id,name,type})=>({id,name,type})).sort((a,b)=>a.id.localeCompare(b.id));
  assert.equal(bindings.length,11);
  assert.deepEqual(bindings.map(({id,name,type})=>({id,name,type})).sort((a,b)=>a.id.localeCompare(b.id)),expected);
  assert.deepEqual(Object.keys(bindings[0]).sort(),['id','name','origin','requirements','roles','type']);
  const copy=getOwnedBindings();copy[0].id='injected';copy[0].roles.push('fast');copy[0].requirements.push('injected');
  assert.deepEqual(getOwnedBindings(),bindings);
  assert.equal(bindings.find(item=>item.name==='PersonalAgent-MVP协调器').origin,'new-owned-binding');
});

test('World workflow really calls one role and returns its entire validated report',async()=>{
  const id=workflow('PA-世界状态影响分析');const {agent,models}=setup();
  const output=await agent.invokeWorkflow({...request(),workflowId:id});
  assertEnvelope(output,id,'role_report');assert.equal(output.result.role,'world');
  assert.deepEqual(output.result.value,world());assert.deepEqual(counts(models),[0,1,0,0]);
});
for(const name of ['PA-计划最小修复','PA-计划最小修复_1']) {
  test(`${name} independently calls Plan once, revalidates supplied World, and returns complete report`,async()=>{
    const id=workflow(name);const {agent,models}=setup();
    const output=await agent.invokeWorkflow({...request(),workflowId:id,world:world()});
    assertEnvelope(output,id,'role_report');assert.equal(output.result.role,'plan');
    assert.deepEqual(output.result.value,plan());assert.deepEqual(counts(models),[0,0,1,0]);
  });
}
for(const name of ['PA-证据安全审查','PA-证据安全审查_1']) {
  test(`${name} independently calls Review once and preserves fixed candidate semantics`,async()=>{
    const id=workflow(name);const {agent,models}=setup();
    const output=await agent.invokeWorkflow({...request(),workflowId:id,world:world(),plan:plan()});
    assertEnvelope(output,id,'application_result');assert.deepEqual(output.result.value,candidate());
    assert.deepEqual(counts(models),[0,0,0,1]);
  });
}
test('fast workflow makes only ordinary proposals and continuation answers',async()=>{
  const id=workflow('PA-MVP-快速工具与答复');const tool=commandTool('workspace.npm_test');
  const proposal={kind:'tool_proposal',proposalId:'test-1',toolName:tool.name,toolVersion:tool.version,arguments:{}};
  const {agent,models}=setup({fast:[proposal,{kind:'text',text:'已确认回执。'}]});
  const first=await agent.invokeWorkflow({...request(initial('测试',[tool])),workflowId:id});
  assertEnvelope(first,id,'application_result');assert.deepEqual(first.result.value,proposal);
  const second=await agent.invokeWorkflow({...request(JSON.stringify({continuation:{proposalId:'test-1',state:'confirmed',result:{status:'read-back'}}})),workflowId:id});
  assert.equal(second.result.value.kind,'text');assert.deepEqual(counts(models),[2,0,0,0]);
  await assert.rejects(agent.invokeWorkflow({...request(),workflowId:id}),{code:'INVALID_ARGUMENT'});
});
test('router workflow dispatches complete repair exactly once',async()=>{
  const id=workflow('PA-MVP-受限主路由');const {agent,models}=setup();
  const output=await agent.invokeWorkflow({...request(),workflowId:id});
  assertEnvelope(output,id,'application_result');assert.deepEqual(output.result.value,candidate());
  assert.deepEqual(counts(models),[0,1,1,1]);
});
for(const binding of bindings.filter(item=>item.type==='controller')) {
  test(`${binding.name} binds one complete chain without duplicate default dispatch`,async()=>{
    const {agent,models}=setup();const output=await agent.invokeController({...request(),controllerId:binding.id});
    assertEnvelope(output,binding.id,'application_result');assert.deepEqual(output.result.value,candidate());
    assert.deepEqual(counts(models),[0,1,1,1]);
  });
}
test('new owned MVP router accepts ordinary input while first cognition controller requires repair input',async()=>{
  const {agent,models}=setup({fast:[{kind:'text',text:'普通请求提案。'}]});
  const mvp=bindings.find(item=>item.origin==='new-owned-binding');
  const output=await agent.invokeController({...request('你好'),controllerId:mvp.id});
  assert.equal(output.binding.origin,'new-owned-binding');assert.equal(output.result.value.kind,'text');
  await assert.rejects(agent.invokeController({...request('你好'),controllerId:'32d4d44c-eade-4f3f-8f76-209c74609e79'}),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(counts(models),[1,0,0,0]);
});
test('unknown IDs, cross-type IDs, unexpected reports and ordinary repair-stage input fail before any model',async()=>{
  const {agent,models}=setup();
  for(const id of ['unknown','ae641e4a-1524-4435-a132-c58fb13e288d']) await assert.rejects(
    agent.invokeWorkflow({...request(),workflowId:id}),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(agent.invokeController({...request(),controllerId:workflow('PA-世界状态影响分析')}),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(agent.invokeWorkflow({...request('你好'),workflowId:workflow('PA-世界状态影响分析')}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(agent.invokeWorkflow({...request(),workflowId:workflow('PA-世界状态影响分析'),world:world()}),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(counts(models),[0,0,0,0]);
});
test('missing, foreign-source, stale, inferred and non-REVISE World reports never start Plan or Review',async()=>{
  const id=workflow('PA-计划最小修复');const {agent,models}=setup();
  await assert.rejects(agent.invokeWorkflow({...request(),workflowId:id}),{code:'INVALID_ARGUMENT'});
  for(const mutate of [w=>w.revision=8,w=>w.observed_facts[0].fact='来自另一请求',w=>w.observed_facts[0].confidence='inferred',
    w=>w.affected_items[0].node.revision=2,w=>w.verification='verified']) {
    const w=world();mutate(w);
    await assert.rejects(agent.invokeWorkflow({...request(),workflowId:id,world:w}),{code:'EXTERNAL_FAILURE'});
  }
  const keep={...world(),recommended_disposition:'KEEP',changed_facts:[],affected_items:[]};
  await assert.rejects(agent.invokeWorkflow({...request(),workflowId:id,world:keep}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(agent.invokeWorkflow({...request(),workflowId:workflow('PA-证据安全审查'),world:world()}),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(counts(models),[0,0,0,0]);
});
test('Plan cannot revise outside World scope and Review revalidates prior Plan constraints before model call',async()=>{
  const altered=plan();altered.preserved_steps=[];
  altered.revised_steps.push({node:ref(otherId),replacement:'无关修改',reason:'无依据'});
  altered.dependency_updates.push({node:ref(otherId),dependencies:[ref(goalId,2)],reason:'无依据'});
  const p=setup({plan:[altered]});
  await assert.rejects(p.agent.invokeWorkflow({...request(),workflowId:workflow('PA-计划最小修复'),world:world()}),{code:'EXTERNAL_FAILURE'});
  assert.deepEqual(counts(p.models),[0,0,1,0]);
  const r=setup();
  for(const mutate of [p=>p.base_revision=8,p=>p.dependency_updates[0].dependencies=[],p=>p.verification='verified']) {
    const bad=plan();mutate(bad);
    await assert.rejects(r.agent.invokeWorkflow({...request(),workflowId:workflow('PA-证据安全审查'),world:world(),plan:bad}),{code:'EXTERNAL_FAILURE'});
  }
  assert.deepEqual(counts(r.models),[0,0,0,0]);
});
test('Review cannot substitute candidate summary, reason, revision, dependencies or add authority',async()=>{
  for(const mutate of [c=>c.candidate.changes[0].summary='替换已评审计划',c=>c.candidate.changes[0].reason='替换理由',
    c=>c.candidate.expectedGraphRevision=8,c=>c.candidate.changes[0].dependencies=[],c=>c.verification='verified',
    c=>c.authorizationRef='forged']) {
    const bad=candidate();mutate(bad);const {agent,models}=setup({review:[bad]});
    await assert.rejects(agent.invokeWorkflow({...request(),workflowId:workflow('PA-证据安全审查_1'),world:world(),plan:plan()}),{code:'EXTERNAL_FAILURE'});
    assert.deepEqual(counts(models),[0,0,0,1]);
  }
});
test('unsupported removal or local next action cannot enlarge candidateVersion 1.0',async()=>{
  const p=plan();p.local_next_actions=['自行执行外部写入'];const {agent,models}=setup();
  await assert.rejects(agent.invokeWorkflow({...request(),workflowId:workflow('PA-证据安全审查'),world:world(),plan:p}),{code:'UNSUPPORTED_CAPABILITY'});
  assert.deepEqual(counts(models),[0,0,0,0]);
});
test('deterministic intent proposes only published exact empty-argument wrappers, without any model',async()=>{
  const {agent,models}=setup();const id=workflow('PA-MVP-确定性意图');
  for(const [goal,name] of [['语法检查','workspace.node_check'],['请运行构建。','workspace.npm_build'],['测试','workspace.npm_test']]) {
    const output=await agent.invokeWorkflow({...request(initial(goal,[commandTool(name)])),workflowId:id});
    assertEnvelope(output,id,'application_result');assert.equal(output.result.value.kind,'tool_proposal');
    assert.equal(output.result.value.toolName,name);assert.deepEqual(output.result.value.arguments,{});
  }
  assert.deepEqual(counts(models),[0,0,0,0]);
});
test('deterministic finite recipe routing cannot guess capability or arbitrary shell arguments',async()=>{
  const {agent,models}=setup();const id=workflow('PA-MVP-确定性意图');
  const allowed={name:'workspace.run_allowed_command',version:'1.0.0',inputSchema:{type:'object',required:['recipeId'],
    properties:{recipeId:{type:'string',enum:['node-check','npm-build','npm-test']}},additionalProperties:false}};
  for(const [goal,recipeId] of [['语法检查','node-check'],['构建','npm-build'],['测试','npm-test']]) {
    const output=await agent.invokeWorkflow({...request(initial(goal,[allowed])),workflowId:id});
    assert.equal(output.result.value.toolName,allowed.name);assert.deepEqual(output.result.value.arguments,{recipeId});
  }
  const wrongCatalog=[{...allowed,inputSchema:{...allowed.inputSchema,properties:{recipeId:{type:'string'}}}},
    {...commandTool('workspace.npm_test'),inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}];
  for(const [goal,catalog] of [['测试',[]],['测试并构建',[allowed]],['运行 npm test -- --update',[allowed]],
    ['测试',wrongCatalog],['测试',[commandTool('shell.exec')]],['查询天气',[allowed]]]) {
    const output=await agent.invokeWorkflow({...request(initial(goal,catalog)),workflowId:id});
    assert.equal(output.result.value.kind,'text');assert.match(output.result.value.text,/RECHECK/);
  }
  assert.deepEqual(counts(models),[0,0,0,0]);
});
test('deterministic confirmed failure is preserved; unknown and contradictory command receipts fail closed',async()=>{
  const {agent,models}=setup();const id=workflow('PA-MVP-确定性意图');
  const receipt=(state,result)=>JSON.stringify({continuation:{proposalId:'owned-npm-test',state,result}});
  const result={recipeId:'npm-test',exitCode:1,passed:false};
  const output=await agent.invokeWorkflow({...request(receipt('confirmed',result)),workflowId:id});
  assert.match(output.result.value.text,/未通过/);
  await assert.rejects(agent.invokeWorkflow({...request(receipt('unknown',result)),workflowId:id}));
  await assert.rejects(agent.invokeWorkflow({...request(receipt('confirmed',{...result,passed:true})),workflowId:id}),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(counts(models),[0,0,0,0]);
});
test('deterministic proposal identity binds session, request and selected published tool',async()=>{
  const {agent}=setup();const id=workflow('PA-MVP-确定性意图');const original=request(initial('测试',[commandTool('workspace.npm_test')]));
  const first=await agent.invokeWorkflow({...original,workflowId:id});
  const replay=await agent.invokeWorkflow({...original,workflowId:id});
  assert.equal(first.result.value.proposalId,replay.result.value.proposalId);
  const next=await agent.invokeWorkflow({...original,requestId:'next-request',workflowId:id});
  assert.notEqual(first.result.value.proposalId,next.result.value.proposalId);
  const alternate=await agent.invokeWorkflow({...original,workflowId:id,query:initial('测试',[{name:'workspace.run_allowed_command',version:'1.0.0',
    inputSchema:{type:'object',properties:{recipeId:{type:'string',enum:['npm-test']}},required:['recipeId'],additionalProperties:false}}])});
  assert.notEqual(first.result.value.proposalId,alternate.result.value.proposalId);
});
test('bound invocations respect original cancellation and deadline before and during non-cooperative models',async()=>{
  const expired={...request(),deadline:new Date(Date.now()-1).toISOString()};const {agent,models}=setup();
  await assert.rejects(agent.invokeWorkflow({...expired,workflowId:workflow('PA-世界状态影响分析')}),{code:'TIMEOUT'});
  const controller=new AbortController();controller.abort();
  await assert.rejects(agent.invokeController({...request(),signal:controller.signal,controllerId:'ae641e4a-1524-4435-a132-c58fb13e288d'}),{code:'CANCELLED'});
  assert.deepEqual(counts(models),[0,0,0,0]);
  const provider=new FakeModelProvider([]);provider.complete=()=>new Promise(()=>{});
  const stuck=new OwnedAgentOrchestrator({fast:provider,world:provider,plan:provider,review:provider},4096);
  await assert.rejects(stuck.invokeWorkflow({...request(),deadline:new Date(Date.now()+40).toISOString(),workflowId:workflow('PA-世界状态影响分析')}),{code:'TIMEOUT'});
  const cancel=new AbortController();const pending=stuck.invokeWorkflow({...request(),signal:cancel.signal,workflowId:workflow('PA-计划最小修复'),world:world()});
  cancel.abort();await assert.rejects(pending,{code:'CANCELLED'});
});

const legacyWorld={disposition:'REVISE',affected:[planId],reason:'调用方替换的旧报告',missing_information:[]};
const legacyPlan={disposition:'REVISE',missing_information:[],changes:[{node:ref(planId),summary:'16点准备',reason:'调用方替换的旧报告',dependencies:[ref(goalId,2)]}]};
const continuation=JSON.stringify({continuation:{proposalId:'synthetic-read',state:'confirmed',result:{repairContext:{
  expectedGraphRevision:7,targets:[{node:ref(planId),requestedSummary:'16点准备',requestedDependencies:[ref(goalId,2)]}],
  allowedDependencies:[ref(goalId,2)]}}}});
const recheckWorld={reportVersion:'1.1',revision:7,observed_facts:[],changed_facts:[],affected_items:[],
  missing_information:['没有宿主来源投影'],recommended_disposition:'RECHECK',summary:'补齐来源后再判断'};

test('versionless caller reports never authorize either Plan or Review workflow',async()=>{
  for(const name of ['PA-计划最小修复','PA-计划最小修复_1']){
    const {agent,models}=setup();
    await assert.rejects(agent.invokeWorkflow({...request(),workflowId:workflow(name),world:legacyWorld}),{code:'EXTERNAL_FAILURE'});
    assert.deepEqual(counts(models),[0,0,0,0]);
  }
  for(const name of ['PA-证据安全审查','PA-证据安全审查_1']){
    const {agent,models}=setup();
    await assert.rejects(agent.invokeWorkflow({...request(),workflowId:workflow(name),world:legacyWorld,plan:legacyPlan}),{code:'EXTERNAL_FAILURE'});
    assert.deepEqual(counts(models),[0,0,0,0]);
  }
});

test('unchanged facts, another graph revision and another source stop before Plan',async()=>{
  const base=JSON.parse(query().slice(GOAL_PREFIX.length));
  const cases=[
    payload=>{payload.nodes.filter(node=>node.kind==='goal').forEach(node=>node.summary='相同目标');},
    payload=>{payload.repairContext.expectedGraphRevision=11;},
    payload=>{payload.nodes.find(node=>node.id===goalId&&node.revision===2).summary='完全不同';},
  ];
  for(const mutate of cases){
    const payload=structuredClone(base);mutate(payload);
    const report=world();
    if(payload.nodes.every(node=>node.kind!=='goal'||node.summary==='相同目标')){
      report.observed_facts.forEach(item=>item.fact='相同目标');
    }
    const {agent,models}=setup();
    await assert.rejects(agent.invokeWorkflow({...request(GOAL_PREFIX+JSON.stringify(payload)),workflowId:workflow('PA-计划最小修复_1'),world:report}),{code:'EXTERNAL_FAILURE'});
    assert.deepEqual(counts(models),[0,0,0,0]);
  }
});

test('source-less continuation never calls later roles or emits a repair candidate',async()=>{
  for(const name of ['PA-计划最小修复','PA-计划最小修复_1']){
    const {agent,models}=setup();
    await assert.rejects(agent.invokeWorkflow({...request(continuation),workflowId:workflow(name),world:world()}),{code:'EXTERNAL_FAILURE'});
    assert.deepEqual(counts(models),[0,0,0,0]);
  }
  for(const name of ['PA-证据安全审查','PA-证据安全审查_1']){
    const {agent,models}=setup();
    await assert.rejects(agent.invokeWorkflow({...request(continuation),workflowId:workflow(name),world:world(),plan:plan()}),{code:'EXTERNAL_FAILURE'});
    assert.deepEqual(counts(models),[0,0,0,0]);
  }
  const router=workflow('PA-MVP-受限主路由');
  for(const binding of [...bindings.filter(item=>item.type==='controller'),{id:router,type:'workflow'}]){
    const {agent,models}=setup({world:[legacyWorld],plan:[legacyPlan],review:[candidate()]});
    const run=binding.type==='workflow'
      ? agent.invokeWorkflow({...request(continuation),workflowId:binding.id})
      : agent.invokeController({...request(continuation),controllerId:binding.id});
    await assert.rejects(run,{code:'EXTERNAL_FAILURE'});
    assert.deepEqual(counts(models),[0,1,0,0]);
  }
  for(const id of [router,...bindings.filter(item=>item.type==='controller').map(item=>item.id)]){
    const {agent,models}=setup({world:[recheckWorld]});
    const output=id===router
      ? await agent.invokeWorkflow({...request(continuation),workflowId:id})
      : await agent.invokeController({...request(continuation),controllerId:id});
    assert.equal(output.result.value.kind,'text');
    assert.match(output.result.value.text,/RECHECK/);
    assert.equal(output.result.value.kind==='repair_candidate',false);
    assert.deepEqual(counts(models),[0,1,0,0]);
  }
});
