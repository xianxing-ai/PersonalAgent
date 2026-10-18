import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {LayaActionChoiceService,previewStoredRepair} from '@personal-agent/cognition';
import {createAgentArtsRuntimeApplication,createProactiveCognitionHost} from '@personal-agent/runtime/application';
import {OwnedAgentOrchestrator} from '@personal-agent/agentarts';
import {FakeModelProvider} from '@personal-agent/models';
import {createDesktopGoalCognitionHost} from '../../apps/desktop/electron/goal-cognition-host.js';
import {createGoalHostCore} from '../../apps/desktop/electron/goal-host-core.js';

const namespace='synthetic-owned-analysis';
const ref=(id,revision=1)=>({id,revision});
const node=(id,kind,dependencies,summary=id,sensitivity='public')=>({id,kind,dependencies,summary,sensitivity,
  sourceRef:'synthetic/source',state:'active',reason:'fixture',
  validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'});
const invocation=query=>({query,deadline:new Date(Date.now()+5000).toISOString(),
  signal:new AbortController().signal,sessionId:'synthetic',requestId:'synthetic-analysis'});
function agentWith(response={kind:'text',text:'需要复核目标与来源，建议先确认计划条件。'}) {
  const models=Object.fromEntries(['fast','world','plan','review'].map(role=>[role,new FakeModelProvider(
    role==='fast'?[{kind:'final',text:JSON.stringify(response)}]:[])]));
  return {models,agent:new OwnedAgentOrchestrator(models,2048)};
}
function repairAgent({mutatePlan=p=>p,mutateReview=r=>r}={}) {
  const models=Object.fromEntries(['fast','world','plan','review'].map(role=>[role,new FakeModelProvider(role==='fast'?[]:[request=>{
    const data=JSON.parse(request.messages[1].content),input=data.input;
    if(role==='world') {
      assert.deepEqual(Object.keys(data.report_constraints).sort(),
        ['affected_item_candidates','changed_fact_candidates','observed_fact_candidates','reportVersion','revision']);
      assert.equal(data.report_constraints.revision,input.repairContext.expectedGraphRevision);
    }
    const context=input.repairContext;
    const version=context.targets.some(t=>input.nodes.find(n=>n.id===t.node.id&&n.revision===t.node.revision)?.kind==='goal')?'1.2':'1.1';
    let value;
    if(role==='world') {
      const goals=input.nodes.filter(n=>n.kind==='goal').sort((a,b)=>a.revision-b.revision);
      const current=goals.findLast(n=>goals.some(old=>old.id===n.id&&old.revision+1===n.revision));
      const previous=goals.find(n=>n.id===current.id&&n.revision+1===current.revision);
      value={reportVersion:version,revision:context.expectedGraphRevision,
        observed_facts:goals.map(n=>({node:ref(n.id,n.revision),fact:n.summary,confidence:'explicit'})),
        changed_facts:[{previous:ref(previous.id,previous.revision),current:ref(current.id,current.revision),change:'目标内容变化'}],
        affected_items:context.targets.map(t=>({kind:input.nodes.find(n=>n.id===t.node.id).kind==='plan'?'plan_step':input.nodes.find(n=>n.id===t.node.id).kind,
          node:t.node,impact:'direct',reason:'目标版本变化'})),missing_information:[],recommended_disposition:'REVISE',summary:'仅修复原宿主范围'};
    } else if(role==='plan') {
      value=mutatePlan({reportVersion:version,base_revision:context.expectedGraphRevision,disposition:'REVISE',
        preserved_steps:[],rechecked_steps:[],revised_steps:context.targets.map(t=>({node:t.node,
          replacement:input.nodes.find(n=>n.id===t.node.id).kind==='decision'?'按修改后的目标更新决策':input.nodes.find(n=>n.id===t.node.id).kind==='goal'?'按修改后的目标更新相关目标':'按更新后的决策调整计划',reason:'目标版本变化'})),
        removed_steps:[],dependency_updates:context.targets.map(t=>({node:t.node,dependencies:t.requestedDependencies,reason:'采用宿主精确引用'})),
        evidence_required:['尚需本地 Policy、CAS 与独立读回'],missing_information:[],local_next_actions:[]},input);
    } else {
      value=mutateReview({kind:'repair_candidate',candidateVersion:'1.0',candidate:{expectedGraphRevision:context.expectedGraphRevision,
        changes:data.plan.revised_steps.map(step=>({node:step.node,summary:step.replacement,reason:step.reason,
          dependencies:context.targets.find(t=>t.node.id===step.node.id).requestedDependencies}))}},input);
    }
    return {kind:'final',text:JSON.stringify(value)};
  }])]));
  return {models,agent:new OwnedAgentOrchestrator(models,2048)};
}
async function settled(app,taskId) {
  for(let i=0;i<200;i++) {
    const task=app.runtime.getTask(taskId);
    if(['succeeded','failed','cancelled'].includes(task.state)) return task;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Synthetic Goal handoff did not settle');
}
// The existing Desktop Host produces the query. Only Laya inference, model
// responses and HTTP transport are Fake; Runtime, Client and projection are real.
async function hostFixture(t,{uncertain=false,newGoal=false,repair=false,keepProducerSummary=false,baselineKind,baselineLength=1500,dependentKind='decision',controlledRepair=false}={}) {
  const root=new URL('../../.cache/owned-goal-analysis/',import.meta.url);await mkdir(root,{recursive:true});
  const directory=await mkdtemp(new URL('case-',root));
  const owned=repair?repairAgent({mutatePlan:(p,input)=>{
    if(keepProducerSummary) {
      const producer=input.nodes.find(n=>n.kind==='decision');
      p.revised_steps.find(s=>s.node.id===producer.id).replacement=producer.summary;
    }
    return p;
  }}):agentWith(),sent=[],rejections=[],announced=[];
  let host,goalWrites=0;
  const app=createAgentArtsRuntimeApplication({path:path.join(directory,'runtime.sqlite'),
    ...(controlledRepair?{localRepair:{graphNamespace:namespace,bindingVersion:'desktop-reviewed-execution-v1',
      withSourceLock:async work=>work(),reviewedSource:{resolve:input=>{const prepared=host.readPreparedRepair(input.sourceTaskId);
        return prepared?.kind==='prepared'&&prepared.binding.reviewTaskId===input.reviewTaskId?prepared:undefined;}}}}:{}),
    gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic',responseMode:'tool-proposal-json',
    ...(repair?{repairCandidateVersion:'1.0'}:{}),
    authorizationProvider:{read:async()=> 'Bearer synthetic-no-real-key'},
    beforeCompetitionSend:request=>host.assertCloudSend(request),
    fetchImpl:async(_url,input)=>{
      const payload=JSON.parse(input.body);sent.push(payload.query);
      let output;
      try {output=await owned.agent.invoke({query:payload.query,deadline:input.headers['X-PA-Deadline'],
        signal:input.signal,sessionId:input.headers['x-hw-agentarts-session-id'],requestId:input.headers['X-Request-Id']});}
      catch(error){rejections.push(error.code);throw error;}
      return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(output)}},{event:'task_end'},{event:'end'}]),
        {headers:{'content-type':'application/json'}});
    }});
  const store=app.runtime.provisionCoordinationStore(namespace);
  store.append(0,node('private-source','fact',[],'PRIVATE_SOURCE_SENTINEL','private'));
  store.append(1,node('goal','goal',[ref('private-source')],'原目标','private'));
  if(!newGoal){store.append(2,node('decision',dependentKind,[ref('goal')],baselineKind==='decision'?'D'.repeat(baselineLength):'关联决策'));
    store.append(3,node('plan','plan',[ref('decision')],baselineKind==='plan'?'P'.repeat(baselineLength):'关联计划'));
    store.append(4,node('goal','goal',[ref('private-source')],'修改后的目标','private'));}
  const source=app.runtime.submitTask({goal:'Synthetic prior Goal edit',conversationId:'fixture',idempotencyKey:'synthetic-goal-edit'});
  await app.runtime.runTask(source.taskId,async()=>({resultSummary:'Synthetic edit receipt'}),
    {deadline:new Date(Date.now()+5000).toISOString(),sideEffect:'read'});
  const goalCore=createGoalHostCore(namespace,{getGoal:()=>{},listGoals:()=>[],createGoalTools:()=>[],
    GOAL_CREATE_TOOL:'goal.create',GOAL_REVISE_TOOL:'goal.revise',GOAL_TOOL_VERSION:'1.0.0'});goalCore.bind(app);
  const goalHost={listTasks:()=>[{taskId:source.taskId,state:'succeeded',result:{kind:'applied',
    graphRevision:newGoal?2:5,...(newGoal?{}:{previousGoal:ref('goal')}),currentGoal:ref('goal',newGoal?1:2)}}],
    revise:input=>{goalWrites++;return goalCore.revise(input);}};
  const facts=app.createCompetitionFactHost({memoryPath:path.join(directory,'memory.sqlite'),
    memoryNamespace:'synthetic-public-memory',graphNamespace:namespace,consumerKey:'fixture'});
  const client=new Client(app);await client.connect();
  const chooser=new LayaActionChoiceService({infer:async payload=>{
    const keys=Object.keys(payload.questions.action.criteria),choice=repair
      ? keys.find(key=>JSON.parse(payload.questions.action.criteria[key]).description.startsWith('Ask AgentArts to evaluate'))
      : newGoal?keys[0]:keys.at(-1);
    assert.ok(choice,'Synthetic Laya choice must match an actually offered option');
    const probability=uncertain?1/keys.length:0.98;
    return {answers:{action:{choice,probabilities:Object.fromEntries(keys.map(key=>[key,key===choice?probability:(1-probability)/(keys.length-1)])),
      answer_confidence:probability,confidence:0.5}}};
  }});
  host=createDesktopGoalCognitionHost({application:app,client,facts,namespace,goalHost,chooser,ready:()=>true,
    createHost:createProactiveCognitionHost,onTask:task=>announced.push(task)});
  t.after(async()=>{host.close();facts.close();app.close();await rm(directory,{recursive:true,force:true});});
  host.configure({enabled:true,cloudAllowed:true});await host.tick();
  assert.ok(announced[0]);const task=await settled(app,announced[0].taskId);
  assert.equal(sent.length,1);assert.doesNotMatch(sent[0],/PRIVATE_SOURCE_SENTINEL|private-source/);
  return {...owned,app,store,host,client,task,query:sent[0],rejections,goalWrites:()=>goalWrites};
}
test('actual short-summary Host REVISE accepts ordered prospective dependencies without inventing committed source nodes',async t=>{
  const f=await hostFixture(t,{repair:true});
  const payload=JSON.parse(f.query.slice(f.query.indexOf('\n')+1));
  assert.equal(payload.action,'REVISE');
  const decision=payload.nodes.find(n=>n.kind==='decision');
  assert.equal(decision.revision,1);
  assert.ok(payload.repairContext.allowedDependencies.some(d=>d.id===decision.id && d.revision===2));
  assert.equal(payload.nodes.some(n=>n.id===decision.id && n.revision===2),false);
  assert.equal(f.task.state,'succeeded',`Owned rejection codes: ${f.rejections.join(',')}`);
  assert.deepEqual(['fast','world','plan','review'].map(r=>f.models[r].requests.length),[0,1,1,1]);
  const candidate=f.app.runtime.loadCheckpoint(f.task.taskId,'competition-repair-candidate');
  assert.equal(candidate.candidate.changes[0].node.id,decision.id);
  assert.ok(candidate.candidate.changes[1].dependencies.some(d=>d.id===decision.id && d.revision===2));
  const prepared=f.host.readPreparedRepair(f.task.taskId);
  assert.equal(prepared.kind,'prepared');assert.equal(prepared.preview.before.snapshot.revision,5);
  assert.equal(prepared.preview.after.snapshot.revision,7);
  assert.deepEqual(prepared.preview.inputs.map(n=>n.id),['decision','plan']);
  assert.equal(f.store.read().revision,5);assert.equal(f.goalWrites(),0);
  assert.equal(f.app.runtime.readToolExecutions(f.task.taskId).length,0);
});
for(const baselineKind of ['decision','plan'])test(`actual Host preserves long committed ${baselineKind} baseline while proposing bounded replacements`,async t=>{
  const f=await hostFixture(t,{repair:true,baselineKind});
  assert.equal(f.task.state,'succeeded',`Owned rejection codes: ${f.rejections.join(',')}`);
  const payload=JSON.parse(f.query.slice(f.query.indexOf('\n')+1));
  assert.equal(payload.nodes.find(n=>n.kind===baselineKind).summary.length,1500);
  const candidate=f.app.runtime.loadCheckpoint(f.task.taskId,'competition-repair-candidate');
  assert.ok(candidate.candidate.changes.every(c=>c.summary.length<=1024));
  const prepared=f.host.readPreparedRepair(f.task.taskId);assert.equal(prepared.kind,'prepared');
  assert.equal(prepared.preview.after.snapshot.revision,7);assert.equal(f.store.read().revision,5);
});
test('owned committed baseline boundary is 8192 with exact source equality; new summaries remain bounded',async t=>{
  const f=await hostFixture(t,{repair:true});
  const split=f.query.indexOf('\n'),prefix=f.query.slice(0,split+1),original=JSON.parse(f.query.slice(split+1));
  // Captured actual Host projection, consumed directly: a doubled 8192 baseline
  // exceeds the independent Desktop 16k whole-query guard, which remains intact.
  const changed=(length,mismatch=false)=>{
    const p=structuredClone(original),target=p.repairContext.targets[0];target.summary='D'.repeat(length);
    p.nodes.find(n=>n.id===target.node.id).summary=mismatch?'different':target.summary;return p;
  };
  const h=repairAgent(),result=await h.agent.invoke(invocation(prefix+JSON.stringify(changed(8192))));
  assert.equal(result.kind,'repair_candidate');assert.ok(result.candidate.changes.every(c=>c.summary.length<=1024));
  for(const payload of [changed(8193),changed(8192,true)]) {
    const rejected=repairAgent();await assert.rejects(rejected.agent.invoke(invocation(prefix+JSON.stringify(payload))),{code:'INVALID_ARGUMENT'});
    assert.equal(rejected.models.world.requests.length,0);
  }
  const continuationContext=structuredClone(original.repairContext);
  for(const target of continuationContext.targets){delete target.summary;target.requestedSummary='X'.repeat(1025);}
  const continuation=repairAgent();
  await assert.rejects(continuation.agent.invoke(invocation(JSON.stringify({continuation:{proposalId:'synthetic',
    state:'confirmed',result:{repairContext:continuationContext}}}))),{code:'INVALID_ARGUMENT'});
  assert.equal(continuation.models.world.requests.length,0);
  for(const stage of ['plan','review']) {
    const rejected=repairAgent({mutatePlan:p=>{if(stage==='plan')p.revised_steps[0].replacement='X'.repeat(1025);return p;},
      mutateReview:r=>{if(stage==='review')r.candidate.changes[0].summary='X'.repeat(1025);return r;}});
    await assert.rejects(rejected.agent.invoke(invocation(f.query)),{code:'EXTERNAL_FAILURE'});
  }
});
test('dependency-only producer revisions remain valid; actual local preview rejects a producer with no effective revision',async t=>{
  const f=await hostFixture(t,{repair:true,keepProducerSummary:true});
  assert.equal(f.task.state,'succeeded');
  const prepared=f.host.readPreparedRepair(f.task.taskId);assert.equal(prepared.kind,'prepared');
  assert.equal(prepared.preview.inputs[0].summary,'关联决策');
  assert.deepEqual(prepared.preview.inputs[0].dependencies,[ref('goal',2)]);
  const noOp=structuredClone(prepared.request);
  const original=f.store.read().history.findLast(n=>n.id==='decision');
  noOp.changes[0].summary=original.summary;noOp.changes[0].dependencies=original.dependencies;
  assert.throws(()=>previewStoredRepair(f.store,new Date().toISOString(),noOp),{code:'NOT_APPLICABLE'});
  assert.equal(f.store.read().revision,5);assert.equal(f.goalWrites(),0);
});
test('prospective refs reject arbitrary future, stale, inactive or uncommitted targets before models',async t=>{
  const f=await hostFixture(t,{repair:true});
  const split=f.query.indexOf('\n'),prefix=f.query.slice(0,split+1),original=JSON.parse(f.query.slice(split+1));
  const decision=original.nodes.find(n=>n.kind==='decision'),goal=original.nodes.find(n=>n.kind==='goal');
  for(const mutate of [p=>{for(const refs of [p.repairContext.allowedDependencies,...p.repairContext.targets.map(t=>t.requestedDependencies)])
    for(const d of refs)if(d.id===decision.id)d.revision=3;},
    p=>{for(const refs of [p.repairContext.allowedDependencies,...p.repairContext.targets.map(t=>t.requestedDependencies)])
      for(const d of refs)if(d.id===goal.id)d.revision=1;},
    p=>p.nodes.find(n=>n.id===decision.id).state='withdrawn',
    p=>p.nodes.splice(p.nodes.findIndex(n=>n.id===decision.id),1),
    p=>p.nodes.push({...p.nodes.find(n=>n.id===decision.id),revision:2}),
    p=>{for(const refs of [p.repairContext.allowedDependencies,...p.repairContext.targets.map(t=>t.requestedDependencies)])
      for(const d of refs)if(d.id===decision.id)d.id='d'.repeat(64);},
  ]) {
    const payload=structuredClone(original);mutate(payload);const h=repairAgent();
    await assert.rejects(h.agent.invoke(invocation(prefix+JSON.stringify(payload))),{code:'INVALID_ARGUMENT'});
    assert.equal(h.models.world.requests.length,0);
  }
});
test('a future dependency requires its producer change first, including in the reviewed candidate',async t=>{
  const f=await hostFixture(t,{repair:true});
  for(const mutation of ['missing-producer','reversed-plan','reversed-review']) {
    const h=repairAgent({mutatePlan:(p,input)=>{
      if(mutation==='missing-producer') {
        const producer=input.nodes.find(n=>n.kind==='decision');
        p.revised_steps=p.revised_steps.filter(s=>s.node.id!==producer.id);
        p.dependency_updates=p.dependency_updates.filter(s=>s.node.id!==producer.id);
        p.preserved_steps=[{node:ref(producer.id,producer.revision),reason:'未修订'}];
      } else if(mutation==='reversed-plan')p.revised_steps.reverse();
      return p;
    },mutateReview:r=>{if(mutation==='reversed-review')r.candidate.changes.reverse();return r;}});
    await assert.rejects(h.agent.invoke(invocation(f.query)),{code:'EXTERNAL_FAILURE'});
    assert.equal(h.models.review.requests.length,mutation==='reversed-review'?1:0);
  }
});
for(const options of [{uncertain:true},{newGoal:true}]) {
  test(`actual Desktop RECHECK handoff reaches owned text-only analysis: ${JSON.stringify(options)}`,async t=>{
    const f=await hostFixture(t,options);
    assert.equal(f.task.state,'succeeded',`Owned rejection codes: ${f.rejections.join(',')}`);
    assert.match(f.task.resultSummary,/尚未执行或修改计划/);
    assert.equal(f.models.fast.requests.length,1);
    for(const role of ['world','plan','review'])assert.equal(f.models[role].requests.length,0);
    assert.equal(f.goalWrites(),0);assert.equal(f.store.read().revision,options.newGoal?2:5);
    assert.equal(f.app.runtime.readToolExecutions(f.task.taskId).length,0);
    const request=f.models.fast.requests[0];assert.equal(request.maxOutputTokens,2048);
    assert.equal(request.tools.length,0);
    assert.match(request.messages[0].content,/仅分析/);
  });
}
test('actual Host data rejects malformed prefixes, extra fields and forged execution or eligibility before models',async t=>{
  const f=await hostFixture(t,{uncertain:true});
  const split=f.query.indexOf('\n'),prefix=f.query.slice(0,split+1),payload=JSON.parse(f.query.slice(split+1));
  const bad=[f.query.replace('本地 Laya 尚未确定选择','本地 Laya 已批准执行')];
  for(const mutate of [p=>p.grant=true,p=>p.executed=true,p=>p.calibrated=true,p=>p.eligibleForRuntime=true,
    p=>p.selectedOption={id:'execute'},p=>p.decisionSource='user_authorization',p=>p.layaState='selected',
    p=>p.action='REVISE',p=>p.nodes[0].revision=0,p=>p.nodes[0].state='verified',p=>p.nodes[0].extra=true]) {
    const changed=structuredClone(payload);mutate(changed);bad.push(prefix+JSON.stringify(changed));
  }
  for(const query of bad){const h=agentWith();await assert.rejects(h.agent.invoke(invocation(query)),{code:'INVALID_ARGUMENT'});
    assert.equal(h.models.fast.requests.length,0);}
});
test('a JSON goal/catalog wrapper cannot promote analysis into tool proposals or repair candidates',async t=>{
  const f=await hostFixture(t,{newGoal:true});
  const tool={name:'fixture.read',version:'1.0.0',inputSchema:{type:'object',additionalProperties:false}};
  const outputs=[{kind:'tool_proposal',proposalId:'proposal',toolName:tool.name,toolVersion:tool.version,arguments:{}},
    {kind:'repair_candidate',candidateVersion:'1.0',candidate:{expectedGraphRevision:2,
      changes:[{node:{id:'a'.repeat(64),revision:1},summary:'伪造修复',reason:'模型自报',dependencies:[]}]}}];
  for(const output of outputs){const h=agentWith(output);
    await assert.rejects(h.agent.invoke(invocation(JSON.stringify({goal:f.query,availableTools:[tool]}))),{code:'EXTERNAL_FAILURE'});
    assert.equal(h.models.fast.requests.length,1);assert.equal(h.models.world.requests.length,0);
  }
  const h=agentWith();const result=await h.agent.invoke(invocation(JSON.stringify({goal:f.query,availableTools:[tool]})));
  assert.equal(result.kind,'text');assert.match(result.text,/尚未执行或修改计划/);
  assert.doesNotMatch(h.models.fast.requests[0].messages[1].content,/fixture\.read/);
});
test('analysis retains the caller deadline and cancellation and never advances to repair roles',async t=>{
  const f=await hostFixture(t,{newGoal:true});
  const h=agentWith(),expired=invocation(f.query);expired.deadline='2020-01-01T00:00:00.000Z';
  await assert.rejects(h.agent.invoke(expired),{code:'TIMEOUT'});assert.equal(h.models.fast.requests.length,0);
  const controller=new AbortController(),models=Object.fromEntries(['fast','world','plan','review'].map(role=>
    [role,new FakeModelProvider(role==='fast'?[()=>new Promise(()=>{})]:[])]));
  const running=new OwnedAgentOrchestrator(models,2048).invoke({...invocation(f.query),signal:controller.signal});
  void running.catch(()=>{});
  for(let i=0;i<100 && models.fast.requests.length===0;i++)await new Promise(resolve=>setImmediate(resolve));
  controller.abort();await assert.rejects(running,{code:'CANCELLED'});
  assert.equal(models.world.requests.length,0);assert.equal(models.plan.requests.length,0);assert.equal(models.review.requests.length,0);
});

test('actual prepared dependent Goal uses complete1.2 roles then existing candidate and public preview without cloud writes',async t=>{
 const f=await hostFixture(t,{repair:true,dependentKind:'goal'});assert.equal(f.task.state,'succeeded');
 assert.deepEqual(['fast','world','plan','review'].map(r=>f.models[r].requests.length),[0,1,1,1]);
 const payload=JSON.parse(f.query.slice(f.query.indexOf('\n')+1));
 const target=payload.repairContext.targets[0];assert.equal(payload.nodes.find(n=>n.id===target.node.id).kind,'goal');
 assert.equal(payload.nodes.some(n=>n.id===target.node.id&&n.revision===2),false);
 const candidate=f.app.runtime.loadCheckpoint(f.task.taskId,'competition-repair-candidate');assert.equal(candidate.candidateVersion,'1.0');
 const prepared=f.host.readPreparedRepair(f.task.taskId);assert.equal(prepared.kind,'prepared');
 assert.deepEqual(prepared.preview.inputs.map(n=>n.kind),['goal','plan']);
 assert.equal(prepared.preview.after.snapshot.revision,7);assert.equal(f.store.read().revision,5);
 assert.equal(f.goalWrites(),0);assert.equal(f.app.runtime.readToolExecutions(f.task.taskId).length,0);
 const original=f.store.read().history.findLast(n=>n.id==='decision');assert.equal(original.kind,'goal');
 assert.equal(original.summary,'关联决策');assert.deepEqual(original.dependencies,[ref('goal')]);
 assert.equal(f.app.runtime.listApprovals({}).items.length,0);
});

test('owned1.2 Goal candidate remains unexecuted until a separate original local Policy approval and CAS readback',async t=>{
 const f=await hostFixture(t,{repair:true,dependentKind:'goal',controlledRepair:true});assert.equal(f.task.state,'succeeded');
 assert.equal(f.store.read().revision,5);assert.equal(f.app.runtime.readToolExecutions(f.task.taskId).length,0);
 const card=f.host.snapshot().reviews.find(r=>r.taskId===f.task.taskId);assert.ok(card);
 const accepted=await f.host.applyDecision(card.reviewTaskId);assert.notEqual(accepted.taskId,f.task.taskId);
 for(let i=0;i<200&&f.app.runtime.getTask(accepted.taskId).state!=='waiting_approval';i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(f.app.runtime.getTask(accepted.taskId).state,'waiting_approval');assert.equal(f.store.read().revision,5);
 const approval=(await f.client.call('approval.list',{taskId:accepted.taskId})).items[0];assert.ok(approval);
 await f.client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
 assert.equal((await settled(f.app,accepted.taskId)).state,'succeeded');
 const result=await f.host.applyDecision(card.reviewTaskId);assert.equal(result.status,'applied');
 assert.equal(result.executionVerified,true);assert.equal(result.graphUpdateVerified,true);
 assert.deepEqual(result.updatedNodes.map(n=>[n.id,n.kind,n.revision]),[['decision','goal',2],['plan','plan',2]]);
 assert.equal(f.store.read().revision,7);assert.equal(f.goalWrites(),0);
 const executions=f.app.runtime.readToolExecutions(accepted.taskId);assert.equal(executions.length,1);
 assert.equal(executions[0].toolName,'cognition.commit_repair');assert.equal(executions[0].state,'confirmed');
});
