import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {LayaActionChoiceService} from '@personal-agent/cognition';
import {createAgentArtsRuntimeApplication,createProactiveCognitionHost} from '@personal-agent/runtime/application';
import {OwnedAgentOrchestrator} from '@personal-agent/agentarts';
import {FakeModelProvider} from '@personal-agent/models';
import {createDesktopGoalCognitionHost} from '../electron/goal-cognition-host.js';
import {createGoalHostCore} from '../electron/goal-host-core.js';
import {SyntheticWebSocket} from '../../../packages/coordination/test/fixtures/websocket.mjs';

const namespace='synthetic-owned-analysis';
const ref=(id,revision=1)=>({id,revision});
const node=(id,kind,dependencies,summary=id,sensitivity='public')=>({id,kind,dependencies,summary,sensitivity,
  sourceRef:'synthetic/source',state:'active',reason:'fixture',
  validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'});
function agentWith() {
  const response={kind:'final',text:JSON.stringify({kind:'text',text:'Synthetic analysis only; not executed'})};
  return {models:{fast:new FakeModelProvider(Array.from({length:20},()=>response)),world:new FakeModelProvider([])}};
}
function repairAgent({mutatePlan=p=>p,mutateReview=r=>r}={}) {
  const models=Object.fromEntries(['fast','world','plan','review'].map(role=>[role,new FakeModelProvider(role==='fast'?[]:[request=>{
    const data=JSON.parse(request.messages[1].content),input=role==='world'?data:data.input;
    const context=input.repairContext;
    let value;
    if(role==='world') {
      const goals=input.nodes.filter(n=>n.kind==='goal').sort((a,b)=>a.revision-b.revision);
      value={reportVersion:'1.1',revision:context.expectedGraphRevision,
        observed_facts:goals.map(n=>({node:ref(n.id,n.revision),fact:n.summary,confidence:'explicit'})),
        changed_facts:[{previous:ref(goals[0].id,goals[0].revision),current:ref(goals.at(-1).id,goals.at(-1).revision),change:'目标内容变化'}],
        affected_items:context.targets.map(t=>({kind:input.nodes.find(n=>n.id===t.node.id).kind==='plan'?'plan_step':'decision',
          node:t.node,impact:'direct',reason:'目标版本变化'})),missing_information:[],recommended_disposition:'REVISE',summary:'仅修复原宿主范围'};
    } else if(role==='plan') {
      value=mutatePlan({reportVersion:'1.1',base_revision:context.expectedGraphRevision,disposition:'REVISE',
        preserved_steps:[],rechecked_steps:[],revised_steps:context.targets.map(t=>({node:t.node,
          replacement:input.nodes.find(n=>n.id===t.node.id).kind==='decision'?'按修改后的目标更新决策':'按更新后的决策调整计划',reason:'目标版本变化'})),
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
    if(['succeeded','failed','cancelled','waiting_reconciliation'].includes(task.state)) return task;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Synthetic Goal handoff did not settle');
}
// The existing Desktop Host produces the query. Only Laya inference, model
// responses and HTTP transport are Fake; Runtime, Client and projection are real.
async function hostFixture(t,{uncertain=false,newGoal=false,restricted=false,goalSummary='原目标',changeDuringCredentials=false,unknown=false,repair=false,ancillary}={}) {
  const root=new URL('../../../.cache/goal-empty-projection/',import.meta.url);await mkdir(root,{recursive:true});
  const directory=await mkdtemp(new URL('case-',root));
  const owned=repair?repairAgent():agentWith(),sent=[],rejections=[],announced=[]; let credentials=0,submits=0;
  let host,goalWrites=0;
  const app=createAgentArtsRuntimeApplication({path:path.join(directory,'runtime.sqlite'),
    ...(repair?{repairCandidateVersion:'1.0'}:{}),gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic',responseMode:'tool-proposal-json',
    ...(unknown?{transport:'wss',websocketUrl:'wss://agentarts.example.test/runtimes/synthetic/ws',
      websocketFactory:()=>new SyntheticWebSocket((frame,socket)=>{if(frame.type==='invoke'){socket.accepted(frame);socket.disconnect();}})}:{}),
    authorizationProvider:{read:async()=> {credentials++;if(changeDuringCredentials)store.append(store.read().revision,node('goal','goal',[ref('private-source')],'Now restricted','restricted'));return 'Bearer synthetic-no-real-key';}},
    beforeCompetitionSend:request=>host.assertCloudSend(request),
    fetchImpl:async(_url,input)=>{
      const payload=JSON.parse(input.body);sent.push(payload.query);
      let output;
      try {if(repair)output=await owned.agent.invoke({query:payload.query,deadline:input.headers['X-PA-Deadline'],signal:input.signal,sessionId:'synthetic',requestId:'synthetic-repair'});else {const result=await owned.models.fast.complete({messages:[{role:'user',content:payload.query}],tools:[],
        deadline:input.headers['X-PA-Deadline'],signal:input.signal,maxOutputTokens:2048});output=JSON.parse(result.response.text);}}
      catch(error){rejections.push(error.code);throw error;}
      return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(output)}},{event:'task_end'},{event:'end'}]),
        {headers:{'content-type':'application/json'}});
    }});
  const store=app.runtime.provisionCoordinationStore(namespace);
  store.append(0,node('private-source','fact',[],ancillary==='public'?'Public ancillary source':'PRIVATE_SOURCE_SENTINEL',ancillary??'private'));
  store.append(1,node('goal','goal',[ref('private-source')],goalSummary,restricted?'restricted':'private'));
  if(!newGoal){store.append(2,node('decision','decision',ancillary?[ref('goal'),ref('private-source')]:[ref('goal')],'关联决策',restricted?'restricted':'public'));
    store.append(3,node('plan','plan',[ref('decision')],'关联计划',restricted?'restricted':'public'));
    store.append(4,node('goal','goal',[ref('private-source')],goalSummary+'修改',restricted?'restricted':'private'));}
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
  const client=new Client(app);await client.connect();const originalCall=client.call.bind(client);client.call=(method,...args)=>{if(method==='task.submit')submits++;return originalCall(method,...args);};
  const chooser=new LayaActionChoiceService({infer:async payload=>{
    const keys=Object.keys(payload.questions.action.criteria),choice=repair?keys.find(key=>JSON.parse(payload.questions.action.criteria[key]).description.startsWith('Ask AgentArts to evaluate')):newGoal?keys[0]:keys.at(-1);
    const probability=uncertain?1/keys.length:0.98;
    return {answers:{action:{choice,probabilities:Object.fromEntries(keys.map(key=>[key,key===choice?probability:(1-probability)/(keys.length-1)])),
      answer_confidence:probability,confidence:0.5}}};
  }});
  host=createDesktopGoalCognitionHost({application:app,client,facts,namespace,goalHost,chooser,ready:()=>true,
    createHost:createProactiveCognitionHost,onTask:task=>announced.push(task)});
  t.after(async()=>{host.close();facts.close();app.close();await rm(directory,{recursive:true,force:true});});
  host.configure({enabled:true,cloudAllowed:true});await host.tick();
  const task=announced[0]?await settled(app,announced[0].taskId):undefined;
  return {...owned,app,store,host,client,task,announced,sent,rejections,source,credentials:()=>credentials,submits:()=>submits,goalWrites:()=>goalWrites};
}


const message='没有可供云端分析的来源；受限内容保留在本地，请补充允许发送的来源后重新分析。';
for(const options of [{newGoal:true,restricted:true},{uncertain:true,restricted:true}])test(`empty original Host projection stays local ${JSON.stringify(options)}`,async t=>{
 const f=await hostFixture(t,options),card=f.host.snapshot().reviews.find(r=>r.action==='RECHECK');assert.ok(card);
 assert.deepEqual(card.cloudExport,{state:'blocked',reason:'no_exportable_sources'});
 assert.equal(card.state,'unavailable');assert.match(card.choice,/没有可供云端分析的来源/);
 assert.equal(card.taskId,undefined);assert.equal(card.executionVerified,false);assert.equal(card.graphUpdateVerified,false);
 assert.deepEqual([f.credentials(),f.sent.length,f.submits(),f.announced.length],[0,0,0,0]);
 assert.equal(f.models.fast.requests.length,0);assert.equal(f.models.world.requests.length,0);
 assert.equal(f.app.runtime.loadCheckpoint(card.reviewTaskId,'proactive-cognition-handoff-v1'),undefined);
 const response=await f.host.applyDecision(card.reviewTaskId);
 assert.equal(response.status,'unavailable');assert.equal(response.cloudExport.reason,'no_exportable_sources');
 assert.equal(response.executionStatus,message);assert.deepEqual([f.credentials(),f.sent.length,f.submits()],[0,0,0]);
 f.store.append(f.store.read().revision,node('goal','goal',[ref('private-source')],'Allowed new Goal source','public'));
 const outdated=f.host.snapshot().reviews.find(r=>r.reviewTaskId===card.reviewTaskId);assert.equal(outdated.sourceOutdated,true);assert.equal(outdated.cloudExport,undefined);
 await assert.rejects(f.host.applyDecision(card.reviewTaskId),/版本已变化/);
 assert.equal(f.submits(),0);
 f.host.configure({enabled:true,cloudAllowed:false});assert.equal(f.host.snapshot().reviews.find(r=>r.reviewTaskId===card.reviewTaskId).cloudExport,undefined);
 f.store.append(f.store.read().revision,node('allowed-new-goal','goal',[],'New allowed source for a fresh choice','public'));
 f.host.configure({enabled:true,cloudAllowed:true});await f.host.tick();
 assert.ok(f.sent.length>0,'a new public source permits a fresh original review');assert.ok(f.submits()>0);
 if(f.announced.length)await settled(f.app,f.announced.at(-1).taskId);
});
for(const options of [{newGoal:true},{uncertain:true}])test(`nonempty original projection keeps the existing flow ${JSON.stringify(options)}`,async t=>{
 const f=await hostFixture(t,options);assert.equal(f.task.state,'succeeded');assert.equal(f.credentials(),1);assert.equal(f.submits(),1);
 assert.equal(f.sent.length,1);assert.equal(f.models.fast.requests.length,1);assert.doesNotMatch(f.sent[0],/PRIVATE_SOURCE_SENTINEL/);
 assert.ok(f.host.snapshot().reviews.every(r=>r.cloudExport===undefined));
});
test('existing full Goal text limit keeps its original structured feedback',async t=>{
 const f=await hostFixture(t,{newGoal:true,goalSummary:'x'.repeat(17000)});const card=f.host.snapshot().reviews.find(r=>r.action==='RECHECK');
 assert.equal(card.cloudExport.reason,'goal_text_limit');assert.equal(card.cloudExport.maxChars,16000);assert.ok(card.cloudExport.chars>16000);
 assert.deepEqual([f.credentials(),f.sent.length,f.submits(),f.announced.length],[0,0,0,0]);
});

test('source changes while credentials are pending fail the original dispatch guard without fetching',async t=>{
 const f=await hostFixture(t,{newGoal:true,changeDuringCredentials:true});assert.equal(f.task.state,'failed');
 assert.deepEqual([f.credentials(),f.sent.length,f.models.fast.requests.length,f.submits()],[1,0,0,1]);
 const card=f.host.snapshot().reviews.find(r=>r.taskId===f.task.taskId);assert.ok(card);assert.equal(card.sourceOutdated,true);assert.equal(card.cloudExport,undefined);
 const feedback=await f.host.applyDecision(card.reviewTaskId);assert.equal(feedback.taskId,f.task.taskId);assert.equal(feedback.state,'failed');assert.equal(f.submits(),1);
});
test('accepted unknown WSS task retains its original receipt when later sources become restricted',async t=>{
 const f=await hostFixture(t,{newGoal:true,unknown:true});assert.equal(f.task.state,'waiting_reconciliation');
 const before=f.host.snapshot().reviews.find(r=>r.taskId===f.task.taskId);assert.ok(before);
 f.store.append(f.store.read().revision,node('goal','goal',[ref('private-source')],'Restricted after original acceptance','restricted'));
 const card=f.host.snapshot().reviews.find(r=>r.reviewTaskId===before.reviewTaskId);assert.equal(card.taskId,f.task.taskId);
 assert.equal(card.state,'waiting_reconciliation');assert.equal(card.cloudExport,undefined);
 const feedback=await f.host.applyDecision(card.reviewTaskId);assert.equal(feedback.taskId,f.task.taskId);assert.equal(feedback.state,'waiting_reconciliation');
 assert.equal(f.submits(),1);assert.equal(f.credentials(),1);assert.equal(f.sent.length,0);assert.equal(f.models.fast.requests.length,0);
 assert.equal(f.app.runtime.loadCheckpoint(f.task.taskId,'competition-cloud-unknown').accepted,true);
});

for(const summary of ['x'.repeat(8192),'x'.repeat(8190)+'\nZ'])test(`source summary ${summary.length} chars preserves the original export`,async t=>{
 const f=await hostFixture(t,{newGoal:true,goalSummary:summary});assert.equal(f.task.state,'succeeded');
 assert.equal(f.sent.length,1);assert.ok(f.sent[0].length<16000);
 assert.equal(JSON.parse(f.sent[0].slice(f.sent[0].indexOf('\n')+1)).nodes[0].summary,summary);
 assert.deepEqual([f.credentials(),f.submits(),f.models.fast.requests.length],[1,1,1]);
});
test('8193 character source stays local below the full Goal limit and a fresh short source restores export',async t=>{
 const f=await hostFixture(t,{newGoal:true,goalSummary:'x'.repeat(8193)});
 const card=f.host.snapshot().reviews.find(r=>r.action==='RECHECK');assert.ok(card);
 assert.equal(card.cloudExport.reason,'source_summary_limit');assert.equal(card.cloudExport.maxChars,8192);
 assert.match(card.choice,/缩短.*来源摘要.*重新分析/);assert.equal(card.state,'unavailable');
 assert.deepEqual([f.credentials(),f.sent.length,f.submits(),f.models.fast.requests.length],[0,0,0,0]);
 const feedback=await f.host.applyDecision(card.reviewTaskId);assert.equal(feedback.state,'unavailable');
 assert.deepEqual([f.credentials(),f.sent.length,f.submits()],[0,0,0]);
 f.host.configure({enabled:true,cloudAllowed:false});
 f.store.append(f.store.read().revision,node('goal','goal',[ref('private-source')],'Shortened allowed source','private'));
 f.store.append(f.store.read().revision,node('fresh-short-goal','goal',[],'Fresh allowed source','public'));
 f.host.configure({enabled:true,cloudAllowed:true});await f.host.tick();assert.ok(f.announced.length);await settled(f.app,f.announced.at(-1).taskId);
 assert.ok(f.sent.length);assert.ok(f.host.snapshot().reviews.some(r=>r.taskId && !r.cloudExport));
});

for(const ancillary of [undefined,'public'])test(`actual owned repair preserves committed ancillary dependency ${ancillary??'none'} and future producer`,async t=>{
 const f=await hostFixture(t,{repair:true,ancillary});assert.equal(f.task.state,'succeeded');
 assert.deepEqual(['fast','world','plan','review'].map(r=>f.models[r].requests.length),[0,1,1,1]);
 const p=JSON.parse(f.sent[0].slice(f.sent[0].indexOf('\n')+1));
 assert.equal(p.nodes.some(n=>n.kind==='fact'),ancillary==='public');
 const decision=p.nodes.find(n=>n.kind==='decision');assert.equal(p.nodes.some(n=>n.id===decision.id&&n.revision===2),false);
 const prepared=f.host.readPreparedRepair(f.task.taskId);assert.equal(prepared.kind,'prepared');
 assert.equal(prepared.preview.after.snapshot.revision,7);assert.equal(f.store.read().revision,5);
 assert.equal(f.goalWrites(),0);assert.doesNotMatch(f.sent[0],/PRIVATE_SOURCE_SENTINEL/);
});
for(const ancillary of ['private','restricted'])test(`repair with omitted ${ancillary} dependency stays local`,async t=>{
 const f=await hostFixture(t,{repair:true,ancillary});const card=f.host.snapshot().reviews.find(r=>r.action==='REVISE');
 assert.equal(card.cloudExport.reason,'missing_repair_sources');assert.match(card.choice,/来源未获准发送或尚未提交/);
 assert.deepEqual([f.credentials(),f.sent.length,f.submits(),f.announced.length],[0,0,0,0]);
 assert.deepEqual(['fast','world','plan','review'].map(r=>f.models[r].requests.length),[0,0,0,0]);
 const feedback=await f.host.applyDecision(card.reviewTaskId);assert.equal(feedback.state,'unavailable');
 assert.equal(f.submits(),0);assert.equal(f.store.read().revision,5);
});

test('public repair dependency projection still revalidates original sources before HTTP',async t=>{
 const f=await hostFixture(t,{repair:true,ancillary:'public',changeDuringCredentials:true});assert.equal(f.task.state,'failed');
 assert.deepEqual([f.credentials(),f.submits(),f.sent.length],[1,1,0]);
 assert.deepEqual(['fast','world','plan','review'].map(r=>f.models[r].requests.length),[0,0,0,0]);
 const card=f.host.snapshot().reviews.find(r=>r.taskId===f.task.taskId);assert.equal(card.sourceOutdated,true);
 assert.equal((await f.host.applyDecision(card.reviewTaskId)).taskId,f.task.taskId);assert.equal(f.submits(),1);
});
test('accepted repair unknown receipt survives later ancillary privacy changes',async t=>{
 const f=await hostFixture(t,{repair:true,ancillary:'public',unknown:true});assert.equal(f.task.state,'waiting_reconciliation');
 const original=f.host.snapshot().reviews.find(r=>r.taskId===f.task.taskId);
 f.store.append(f.store.read().revision,node('private-source','fact',[],'PRIVATE_SOURCE_SENTINEL','restricted'));
 const card=f.host.snapshot().reviews.find(r=>r.reviewTaskId===original.reviewTaskId);
 assert.equal(card.state,'waiting_reconciliation');assert.equal(card.cloudExport,undefined);
 const feedback=await f.host.applyDecision(card.reviewTaskId);assert.equal(feedback.taskId,f.task.taskId);assert.equal(feedback.state,'waiting_reconciliation');
 assert.deepEqual([f.credentials(),f.submits(),f.sent.length],[1,1,0]);
});
