import assert from 'node:assert/strict';
import test from 'node:test';
import {OwnedAgentOrchestrator} from '../dist/index.js';
import {GOAL_PREFIX} from '../dist/input.js';
import {FakeModelProvider} from '@personal-agent/models';

const goalId = 'b'.repeat(64), planId = 'a'.repeat(64), unrelatedId = 'c'.repeat(64);
const ref = (id, revision = 1) => ({id, revision});
const node = (id, revision, kind, summary) => ({id, revision, kind, summary, state:'active',
  validFrom:'2026-01-01T00:00:00.000Z', validUntil:'2027-01-01T00:00:00.000Z'});
const payload = () => ({action:'REVISE',strategy:'最小修复',
  nodes:[node(goalId,1,'goal','14点准备'),node(goalId,2,'goal','16点准备'),node(planId,1,'plan','14点准备'),node(unrelatedId,1,'plan','保留其他工作')],
  repairContext:{expectedGraphRevision:7,targets:[
    {node:ref(planId),summary:'14点准备',requestedDependencies:[ref(goalId,2)]},
    {node:ref(unrelatedId),summary:'保留其他工作',requestedDependencies:[ref(goalId,2)]}],allowedDependencies:[ref(goalId,2)]},
  omittedSources:0,calibrated:false,executed:false});
const world = () => ({reportVersion:'1.1',revision:7,observed_facts:[
  {node:ref(goalId),fact:'14点准备',confidence:'explicit'},
  {node:ref(goalId,2),fact:'16点准备',confidence:'explicit'}],
  changed_facts:[{previous:ref(goalId),current:ref(goalId,2),change:'准备目标改为16点'}],
  affected_items:[{kind:'plan_step',node:ref(planId),impact:'direct',reason:'目标时间变化'}],
  missing_information:[],recommended_disposition:'REVISE',summary:'仅调整准备计划'});
const plan = () => ({reportVersion:'1.1',base_revision:7,disposition:'REVISE',preserved_steps:[{node:ref(unrelatedId),reason:'其他工作不受影响'}],
  rechecked_steps:[],revised_steps:[{node:ref(planId),replacement:'16点准备',reason:'目标时间变化'}],removed_steps:[],
  dependency_updates:[{node:ref(planId),dependencies:[ref(goalId,2)],reason:'采用目标最新版本'}],
  evidence_required:['本地独立预览、Policy、CAS及读回'],missing_information:[],local_next_actions:[]});
const candidate = () => ({kind:'repair_candidate',candidateVersion:'1.0',candidate:{expectedGraphRevision:7,
  changes:[{node:ref(planId),summary:'16点准备',reason:'目标时间变化',dependencies:[ref(goalId,2)]}]}});
const request = input => ({query:typeof input === 'string' ? input : GOAL_PREFIX+JSON.stringify(input),
  deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,sessionId:'synthetic',requestId:'synthetic'});
function setup(w=world(),p=plan(),r=candidate()) {
  const models=Object.fromEntries(['fast','world','plan','review'].map(role => [role,new FakeModelProvider(
    role === 'fast' ? [] : [{kind:'final',text:JSON.stringify({world:w,plan:p,review:r}[role])}]) ]));
  return {models,agent:new OwnedAgentOrchestrator(models,4096)};
}

for (const version of ['1.0','1.1']) {
  test(`owned-${version} World KEEP remains KEEP and stops before Plan or Review`,async()=>{
    const w=version === '1.0'
      ? {disposition:'KEEP',affected:[],reason:'没有相关影响',missing_information:[]}
      : {...world(),recommended_disposition:'KEEP',changed_facts:[],affected_items:[],summary:'没有相关影响'};
    const {agent,models}=setup(w);
    assert.deepEqual(await agent.invoke(request(payload())),{kind:'text',text:'KEEP：世界状态分析无需修复。'});
    assert.equal(models.world.requests.length,1);
    assert.equal(models.plan.requests.length,0);
    assert.equal(models.review.requests.length,0);
  });
  test(`owned-${version} Plan KEEP remains KEEP and stops before Review`,async()=>{
    const w=version === '1.0'
      ? {disposition:'REVISE',affected:[planId],reason:'目标变化',missing_information:[]}
      : world();
    const p=version === '1.0'
      ? {disposition:'KEEP',changes:[],missing_information:[]}
      : {...plan(),disposition:'KEEP',revised_steps:[],dependency_updates:[],
        preserved_steps:[{node:ref(planId),reason:'现有步骤已经满足目标'},...plan().preserved_steps]};
    const {agent,models}=setup(w,p);
    assert.deepEqual(await agent.invoke(request(payload())),{kind:'text',text:'KEEP：现有计划无需修复。'});
    assert.equal(models.world.requests.length,1);
    assert.equal(models.plan.requests.length,1);
    assert.equal(models.review.requests.length,0);
  });
}

test('KEEP cannot conceal missing information, affected world items or unresolved plan classifications',async()=>{
  const compactWorld={disposition:'KEEP',affected:[],reason:'无影响',missing_information:[]};
  const fullWorld={...world(),recommended_disposition:'KEEP',changed_facts:[],affected_items:[]};
  for(const w of [
    {...compactWorld,missing_information:['缺来源']},
    {...compactWorld,affected:[planId]},
    {...fullWorld,missing_information:['缺来源']},
    {...fullWorld,affected_items:world().affected_items},
  ]) {
    const {agent,models}=setup(w);
    await assert.rejects(agent.invoke(request(payload())),{code:'EXTERNAL_FAILURE'});
    assert.equal(models.plan.requests.length,0);assert.equal(models.review.requests.length,0);
  }
  const compactPlan={disposition:'KEEP',changes:[],missing_information:['缺依据']};
  const compactRevisedWorld={disposition:'REVISE',affected:[planId],reason:'变化',missing_information:[]};
  const c=setup(compactRevisedWorld,compactPlan);
  await assert.rejects(c.agent.invoke(request(payload())),{code:'EXTERNAL_FAILURE'});
  assert.equal(c.models.review.requests.length,0);
  const keptPlan={...plan(),disposition:'KEEP',revised_steps:[],dependency_updates:[],
    preserved_steps:[{node:ref(planId),reason:'已有计划满足新目标'}]};
  for(const mutate of [p=>p.missing_information=['缺依据'],p=>{
    p.preserved_steps=[];p.rechecked_steps=[{node:ref(planId),condition:'待核实'}];},p=>p.preserved_steps=[]]) {
    const p=structuredClone(keptPlan);mutate(p);const {agent,models}=setup(world(),p);
    await assert.rejects(agent.invoke(request(payload())),{code:'EXTERNAL_FAILURE'});
    assert.equal(models.review.requests.length,0);
  }
});

test('every revised step needs a complete matching dependency report before Review',async()=>{
  const p=plan();p.dependency_updates=[];
  const {agent,models}=setup(world(),p);
  await assert.rejects(agent.invoke(request(payload())),{code:'EXTERNAL_FAILURE'});
  assert.equal(models.review.requests.length,0);
});

test('KEEP with an inferred observation alone remains a non-executing compatible analysis',async()=>{
  const w={...world(),recommended_disposition:'KEEP',changed_facts:[],affected_items:[]};
  w.observed_facts[0].confidence='inferred';
  const {agent,models}=setup(w);
  assert.deepEqual(await agent.invoke(request(payload())),{kind:'text',text:'KEEP：世界状态分析无需修复。'});
  assert.equal(models.plan.requests.length,0);assert.equal(models.review.requests.length,0);
});

test('full World and Plan retain versioned facts, impact, preserved steps and pending evidence; only revisions become candidate changes',async()=>{
  const {agent,models}=setup();
  assert.deepEqual(await agent.invoke(request(payload())),candidate());
  const review=JSON.parse(models.review.requests[0].messages[1].content);
  assert.equal(review.world.changed_facts[0].current.revision,2);
  assert.equal(review.plan.preserved_steps[0].node.id,unrelatedId);
  assert.deepEqual(review.plan.evidence_required,['本地独立预览、Policy、CAS及读回']);
  assert.equal(Object.hasOwn(review.plan,'verification'),false);
});

test('transitive label is preserved for local preview without claiming causal evidence',async()=>{
  const w=world(); w.affected_items[0].impact='transitive';
  const {agent,models}=setup(w);
  assert.equal((await agent.invoke(request(payload()))).kind,'repair_candidate');
  assert.equal(JSON.parse(models.review.requests[0].messages[1].content).world.affected_items[0].impact,'transitive');
});

test('World rejects forged, stale, inferred or inconsistent revision/source/impact reports before Plan',async()=>{
  const mutations=[w=>w.reportVersion='9.0',w=>w.revision=8,w=>w.observed_facts[0].fact='伪造事实',
    w=>w.observed_facts[0].node.revision=99,w=>w.observed_facts[0].confidence='inferred',
    w=>w.changed_facts[0].previous.id=planId,w=>w.changed_facts[0].current.revision=3,
    w=>w.changed_facts=[],w=>w.affected_items[0].kind='decision',w=>w.affected_items[0].node.revision=2,
    w=>w.affected_items.push({...w.affected_items[0]}),w=>w.missing_information=['来源未知'],w=>w.verification='verified',
    w=>w.observed_facts[0].node=null,w=>w.affected_items=[null]];
  for (const mutate of mutations) {
    const w=world(); mutate(w); const {agent,models}=setup(w);
    await assert.rejects(agent.invoke(request(payload())),{code:'EXTERNAL_FAILURE'});
    assert.equal(models.plan.requests.length,0);
  }
});

test('latest supplied source and host target/dependency versions cannot be replaced by history',async()=>{
  const changed=payload(); changed.nodes.push(node(goalId,3,'goal','18点准备'));
  changed.repairContext.allowedDependencies=[ref(goalId,3)];
  changed.repairContext.targets.forEach(target=>target.requestedDependencies=[ref(goalId,3)]);
  await assert.rejects(setup().agent.invoke(request(changed)),{code:'EXTERNAL_FAILURE'});
  for (const mutate of [p=>p.nodes.push(node(planId,2,'plan','新的基线')),
    p=>p.repairContext.targets[0].requestedDependencies[0].revision=0]) {
    const p=payload(); mutate(p); const {agent,models}=setup();
    await assert.rejects(agent.invoke(request(p)),{code:'INVALID_ARGUMENT'});
    assert.equal(models.world.requests.length,0);
  }
});

test('Plan rejects duplicated classifications, omitted impacted targets, changed dependencies, missing evidence and version mixing',async()=>{
  const mutations=[p=>p.reportVersion='2.0',p=>p.base_revision=9,
    p=>p.preserved_steps.push({node:ref(planId),reason:'同时保留和修订'}),p=>p.revised_steps=[],
    p=>p.rechecked_steps.push({node:ref(planId),condition:'待确认'}),p=>p.dependency_updates[0].dependencies=[],
    p=>p.dependency_updates[0].node=ref(unrelatedId),p=>p.evidence_required=[],
    p=>p.missing_information=['待核实来源'],p=>p.revised_steps[0].node.id='new'];
  for (const mutate of mutations) {
    const p=plan(); mutate(p); const {agent,models}=setup(world(),p);
    await assert.rejects(agent.invoke(request(payload())),{code:'EXTERNAL_FAILURE'});
    assert.equal(models.review.requests.length,0);
  }
  await assert.rejects(setup(world(),{disposition:'REVISE',changes:candidate().candidate.changes,missing_information:[]}).agent
    .invoke(request(payload())),{code:'EXTERNAL_FAILURE'});
});

test('removal and next actions have no repair-candidate mapping and are explicitly unsupported',async()=>{
  for (const mutate of [p=>{p.revised_steps=[];p.dependency_updates=[];p.removed_steps=[{node:ref(planId),reason:'已失效'}];},
    p=>p.local_next_actions=['发布变更']]) {
    const p=plan(); mutate(p); const {agent,models}=setup(world(),p);
    await assert.rejects(agent.invoke(request(payload())),{code:'UNSUPPORTED_CAPABILITY'});
    assert.equal(models.review.requests.length,0);
  }
});

test('missing source projection and unresolved rechecks stop without generating a repair',async()=>{
  const w={reportVersion:'1.1',revision:7,observed_facts:[],changed_facts:[],affected_items:[],
    missing_information:['没有事实前后版本投影'],recommended_disposition:'RECHECK',summary:'补齐来源后再判断'};
  const {agent,models}=setup(w);
  const context={...payload().repairContext,targets:payload().repairContext.targets.map(({summary,...target})=>({...target,requestedSummary:summary}))};
  assert.equal((await agent.invoke(request(JSON.stringify({continuation:{proposalId:'p',state:'confirmed',result:{repairContext:context}}})))).text,'RECHECK：世界状态分析缺少确定的修复依据。');
  assert.equal(models.plan.requests.length,0);
  const p=plan(); p.disposition='RECHECK';p.revised_steps=[];p.dependency_updates=[];
  p.rechecked_steps=[{node:ref(planId),condition:'核实前后版本'}];p.missing_information=['待本地读回'];
  const check=setup(world(),p); assert.equal((await check.agent.invoke(request(payload()))).text,'RECHECK：计划修复缺少确定依据。');
  assert.equal(check.models.review.requests.length,0);
});

test('review cannot erase or replace full-report repair changes',async()=>{
  const r=candidate();r.candidate.changes[0].reason='审查改写理由';
  await assert.rejects(setup(world(),plan(),r).agent.invoke(request(payload())),{code:'EXTERNAL_FAILURE'});
});
