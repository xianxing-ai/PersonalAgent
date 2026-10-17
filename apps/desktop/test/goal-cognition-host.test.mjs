import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import {Client} from '@personal-agent/client';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {LayaActionChoiceService,createCommittedMeetingProjectionReader,selectProjectedRepairScope} from '@personal-agent/cognition';
import {createAgentArtsRuntimeApplication,createProactiveCognitionHost} from '@personal-agent/runtime/application';
import {createDesktopGoalCognitionHost} from '../electron/goal-cognition-host.js';
import {createGoalHostCore} from '../electron/goal-host-core.js';
import {Conversations} from '../electron/conversations.js';
import {approvalCards} from '../src/features/conversation/approval-card.js';

const namespace='synthetic-desktop-cognition';
const ref=(id,revision=1)=>({id,revision});
const node=(id,kind,dependencies,summary=id,sensitivity='public')=>({id,kind,dependencies,summary,sensitivity,
  sourceRef:'synthetic/source',state:'active',reason:'fixture',
  validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'});
async function terminal(application,id) {
  for(let i=0;i<100;i++) {
    const task=application.runtime.getTask(id);
    if(['succeeded','failed','cancelled'].includes(task.state)) return task;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Synthetic task did not settle');
}
async function fixture(t,{revokeDuringCredentialRead=false,changeGraphDuringCredentialRead=false,uncertain=false,unavailableInitially=false,newGoal=false,holdFetch=false,controlledRepair=false,onTaskCallback=()=>{},largeScope=false}={}) {
  const root=fileURLToPath(new URL('../../../.cache/desktop-goal-cognition/',import.meta.url));
  await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'case-'));
  let host,layaCalls=0,goalWrites=0,updateCalls=0,releaseFetch,time=Date.now(),unavailable=unavailableInitially;const sent=[],announced=[];
  const application=createAgentArtsRuntimeApplication({path:path.join(directory,'runtime.sqlite'),
    gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic',
    ...(controlledRepair?{repairCandidateVersion:'1.0',responseMode:'tool-proposal-json',localRepair:{graphNamespace:namespace,bindingVersion:'desktop-reviewed-execution-v1',
      withSourceLock:async work=>work(),reviewedSource:{resolve:input=>{
        const prepared=host.readPreparedRepair(input.sourceTaskId);return prepared?.kind==='prepared' && prepared.binding.reviewTaskId===input.reviewTaskId?prepared:undefined;
      }}}}:{}),
    beforeCompetitionSend:request=>host.assertCloudSend(request),
    authorizationProvider:{read:async()=>{
      if(revokeDuringCredentialRead) host.configure({enabled:true,cloudAllowed:false});
      if(changeGraphDuringCredentialRead) store.append(store.read().revision,node('goal','goal',[ref('private-source')],'更新的目标','private'));
      return 'Bearer synthetic-not-a-key';
    }},
    fetchImpl:async(_url,input)=>{
      sent.push(JSON.parse(input.body));
      if(holdFetch) await new Promise(resolve=>{releaseFetch=resolve;});
      const payload=JSON.parse(input.body);
      const context=controlledRepair?JSON.parse(payload.query.slice(payload.query.lastIndexOf('\n')+1)).repairContext:undefined;
      const text=context?JSON.stringify({kind:'repair_candidate',candidateVersion:'1.0',
        candidate:{expectedGraphRevision:context.expectedGraphRevision,changes:context.targets.map(item=>({node:item.node,
          summary:item.summary,reason:'Synthetic semantic review of selected dependency change',dependencies:item.requestedDependencies}))}}):'合成规划已接收';
      return new Response(JSON.stringify({event:'message',data:{text,index:0}}),
        {headers:{'content-type':'application/json'}});
    }});
  const store=application.runtime.provisionCoordinationStore(namespace);
  store.append(0,node('private-source','fact',[],'PRIVATE_SOURCE_SENTINEL','private'));
  store.append(1,node('goal','goal',[ref('private-source')],'原目标','private'));
  if(!newGoal) {
    if(largeScope) {
      for(let i=0;i<101;i++) store.append(store.read().revision,node('large-plan-'+i,'plan',[ref('goal')],'Synthetic dependent Plan'));
      store.append(store.read().revision,node('goal','goal',[ref('private-source')],'修改后的目标','private'));
    } else {
    store.append(2,node('decision','decision',[ref('goal')],'关联决策'));
    store.append(3,node('plan','plan',[ref('decision')],'关联计划'));
    store.append(4,node('goal','goal',[ref('private-source')],'修改后的目标','private'));
    }
  }
  const sourceTask=application.runtime.submitTask({goal:'Synthetic completed goal edit',conversationId:'host-fixture',idempotencyKey:'synthetic-goal-edit'});
  await application.runtime.runTask(sourceTask.taskId,async()=>({resultSummary:'Synthetic goal receipt'}),
    {deadline:new Date(Date.now()+60_000).toISOString(),sideEffect:'read'});
  const strictGoalHost=createGoalHostCore(namespace,{getGoal:()=>{},listGoals:()=>[],createGoalTools:()=>[],
    GOAL_CREATE_TOOL:'goal.create',GOAL_REVISE_TOOL:'goal.revise',GOAL_TOOL_VERSION:'1.0.0'});
  strictGoalHost.bind(application);
  const goalHost={listTasks:()=>[{taskId:sourceTask.taskId,state:'succeeded',result:{kind:'applied',
    graphRevision:newGoal?2:5,...(newGoal?{}:{previousGoal:ref('goal')}),currentGoal:ref('goal',newGoal?1:2)}}],
    revise:input=>{goalWrites++;return strictGoalHost.revise(input);}};
  const facts=application.createCompetitionFactHost({memoryPath:path.join(directory,'memory.sqlite'),
    memoryNamespace:'synthetic-public-memory',graphNamespace:namespace,consumerKey:'fixture'});
  const client=new Client(application,Date.now);await client.connect();
  const chooser=new LayaActionChoiceService({infer:async payload=>{
    layaCalls++;
    if(unavailable) throw Error('Synthetic temporary Laya outage');
    const keys=Object.keys(payload.questions.action.criteria),selected=largeScope?keys.find(key=>JSON.parse(payload.questions.action.criteria[key]).description.startsWith('Ask AgentArts to retain')):newGoal?keys[0]:keys.at(-1);
    const probability=uncertain?1/keys.length:0.98;
    return {answers:{action:{choice:selected,probabilities:Object.fromEntries(keys.map(key=>[key,key===selected?probability:(1-probability)/(keys.length-1)])),
      answer_confidence:probability,confidence:0.5}}};
  }});
  const options={application,client,facts,namespace,goalHost,chooser,ready:()=>true,
    createHost:input=>createProactiveCognitionHost({...input,now:()=>time}),onTask:item=>{announced.push(item);onTaskCallback(item);},onUpdate:()=>{updateCalls++;},now:()=>time};
  host=createDesktopGoalCognitionHost(options);
  t.after(async()=>{host.close();facts.close();application.close();await rm(directory,{recursive:true,force:true});});
  return {application,client,facts,sent,announced,store,sourceTaskId:sourceTask.taskId,host:()=>host,layaCalls:()=>layaCalls,
    goalWrites:()=>goalWrites,updateCalls:()=>updateCalls,releaseFetch:()=>releaseFetch?.(),
    restoreLaya:()=>{unavailable=false;},advance:(ms=1100)=>{time+=ms;},restart:()=>{host.close();host=createDesktopGoalCognitionHost(options);return host;}};
}

test('goal change chooses locally; explicit cloud grant sends one minimized task and restart cannot reuse its grant',async t=>{
  const f=await fixture(t);
  f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
  assert.equal(f.layaCalls(),1);assert.equal(f.sent.length,0);
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  const taskId=f.announced[0]?.taskId;assert.ok(taskId);
  assert.equal((await terminal(f.application,taskId)).state,'succeeded');
  assert.equal(f.sent.length,1);assert.match(f.sent[0].query,/修改后的目标/);
  assert.doesNotMatch(f.sent[0].query,/PRIVATE_SOURCE_SENTINEL|synthetic\/source|private-source/);
  f.advance();await f.host().tick();assert.equal(f.layaCalls(),1);assert.equal(f.sent.length,1);
  assert.equal(f.store.read().revision,5,'selection does not directly mutate plans');
  const restarted=f.restart();
  assert.throws(()=>restarted.assertCloudSend({taskId,goal:f.sent[0].query,signal:new AbortController().signal}),/当前会话/);
});

async function savedGoalCards(t) {
  const root=fileURLToPath(new URL('../../../.cache/desktop-goal-cognition/',import.meta.url));
  await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'restore-'));
  let application,facts,host,layaCalls=0;const sent=[];
  const chooser=new LayaActionChoiceService({infer:async payload=>{
    layaCalls++;const keys=Object.keys(payload.questions.action.criteria),selected=keys[0];
    return {answers:{action:{choice:selected,probabilities:Object.fromEntries(keys.map(key=>
      [key,key===selected?0.98:0.02/(keys.length-1)])),answer_confidence:0.98,confidence:0.5}}};
  }});
  async function open() {
    application=createAgentArtsRuntimeApplication({path:path.join(directory,'runtime.sqlite'),
      gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic',
      beforeCompetitionSend:request=>host.assertCloudSend(request),
      authorizationProvider:{read:async()=> 'Bearer synthetic-not-a-key'},
      fetchImpl:async(_url,input)=>{sent.push(JSON.parse(input.body));return new Response(
        JSON.stringify({event:'message',data:{text:'Synthetic saved planning receipt',index:0}}),
        {headers:{'content-type':'application/json'}});}});
    application.runtime.provisionCoordinationStore(namespace);
    facts=application.createCompetitionFactHost({memoryPath:path.join(directory,'memory.sqlite'),
      memoryNamespace:'synthetic-public-memory',graphNamespace:namespace,consumerKey:'saved-cards'});
    const client=new Client(application,Date.now);await client.connect();
    host=createDesktopGoalCognitionHost({application,client,facts,namespace,goalHost:{listTasks:()=>[]},
      chooser,ready:()=>true,createHost:createProactiveCognitionHost});
  }
  await open();const store=application.runtime.bindCoordinationStore(namespace);
  store.append(0,node('private-source','fact',[],'PRIVATE_SOURCE_SENTINEL','private'));
  store.append(1,node('goal','goal',[ref('private-source')],'Registered Goal','private'));
  store.append(2,node('goal','goal',[ref('private-source')],'Revised before first planning','private'));
  host.configure({enabled:true,cloudAllowed:true});await host.tick();
  const card=host.snapshot().reviews[0];assert.ok(card?.taskId);
  assert.equal((await terminal(application,card.taskId)).state,'succeeded');
  const review=application.runtime.loadCheckpoint(card.reviewTaskId,'proactive-cognition-review-v1');
  const intent=application.runtime.loadCheckpoint(card.reviewTaskId,'proactive-cognition-intent-v1');
  assert.equal(intent.trigger.kind,'goal_unplanned');assert.equal(layaCalls,1);assert.equal(sent.length,1);
  t.after(async()=>{host.close();facts.close();application.close();await rm(directory,{recursive:true,force:true});});
  return {application:()=>application,host:()=>host,review,intent,card,sent,layaCalls:()=>layaCalls,
    async rebuild(reopenRuntime=false) {
      host.close();
      if(reopenRuntime) {facts.close();application.close();await open();}
      else {
        const client=new Client(application,Date.now);await client.connect();
        host=createDesktopGoalCognitionHost({application,client,facts,namespace,goalHost:{listTasks:()=>[]},
          chooser,ready:()=>true,createHost:createProactiveCognitionHost});
      }
      return host;
    }};
}

test('saved Goal cards restore through all task pages with exact bindings and no new handoff',async t=>{
  const f=await savedGoalCards(t),runtime=f.application().runtime;
  const save=(key,intent,review=f.review,conversationId=`proactive-cognition:${namespace}`)=>{
    const task=runtime.submitTaskWithCheckpoint({goal:'Synthetic persisted review fixture',conversationId,
      idempotencyKey:key},'proactive-cognition-intent-v1',intent);
    if(review) runtime.saveCheckpoint(task.taskId,'proactive-cognition-review-v1',{...review,taskId:task.taskId});
    return task;
  };
  const unknown=save('saved-goal-unknown',{...f.intent,retryOf:f.card.reviewTaskId});
  await runtime.runTask(unknown.taskId,async()=>{
    runtime.transitionTask(unknown.taskId,'waiting_reconciliation',{
      error:{code:'RESULT_UNKNOWN',message:'Synthetic persisted review completion needs reconciliation',retryable:false}});
    return {resultSummary:'Original saved choice remains available'};
  },{deadline:new Date(Date.now()+60_000).toISOString(),sideEffect:'read'});
  for(let n=0;n<105;n++) save('saved-goal-unreviewed-'+n,f.intent,null);
  const excluded=[
    save('saved-goal-old-binding',{...f.intent,bindingVersion:'old-desktop-binding'}),
    save('saved-goal-other-namespace',{...f.intent,graphNamespace:'other-namespace'}),
    save('saved-goal-other-conversation',f.intent,f.review,'other-conversation'),
    save('saved-goal-fact-not-in-this-scope',{...f.intent,trigger:{kind:'fact',input:{}}}),
  ];
  const snapshots=Object.fromEntries([f.card.reviewTaskId,unknown.taskId,...excluded.map(task=>task.taskId)]
    .map(id=>[id,{task:runtime.getTask(id),review:runtime.loadCheckpoint(id,'proactive-cognition-review-v1')}]));
  const restored=await f.rebuild(),cards=restored.snapshot().reviews;
  assert.deepEqual(new Set(cards.map(card=>card.reviewTaskId)),new Set([f.card.reviewTaskId,unknown.taskId]));
  const completed=cards.find(card=>card.reviewTaskId===f.card.reviewTaskId);
  assert.equal(completed.taskId,f.card.taskId);assert.equal(completed.state,'succeeded');
  assert.equal(cards.find(card=>card.reviewTaskId===unknown.taskId).selected,f.review.selectedOption.id);
  assert.equal(runtime.getTask(unknown.taskId).state,'waiting_reconciliation');
  assert.equal(restored.snapshot().enabled,false);assert.equal(restored.snapshot().cloudAllowed,false);
  assert.throws(()=>restored.assertCloudSend({taskId:f.card.taskId,goal:f.sent[0].query,
    signal:new AbortController().signal}),/当前会话/);
  for(const [id,snapshot] of Object.entries(snapshots)) {
    assert.deepEqual(runtime.getTask(id),snapshot.task);
    assert.deepEqual(runtime.loadCheckpoint(id,'proactive-cognition-review-v1'),snapshot.review);
  }
  assert.equal(f.layaCalls(),1);assert.equal(f.sent.length,1);
});

test('saved Goal cards survive actual Runtime SQLite close and reopen without restoring permission',async t=>{
  const f=await savedGoalCards(t),review=structuredClone(f.review);
  f.application().runtime.bindCoordinationStore(namespace).append(3,node('later-fact','fact',[],'Later graph revision'));
  const original=f.application(),restored=await f.rebuild(true);
  assert.notEqual(f.application(),original,'the Runtime application and SQLite connection are recreated');
  const snapshot=restored.snapshot();assert.equal(snapshot.reviews.length,1);
  assert.equal(snapshot.reviews[0].reviewTaskId,f.card.reviewTaskId);
  assert.equal(snapshot.reviews[0].taskId,f.card.taskId);assert.equal(snapshot.reviews[0].state,'succeeded');
  assert.equal(snapshot.reviews[0].sourceOutdated,true);
  assert.deepEqual(f.application().runtime.loadCheckpoint(f.card.reviewTaskId,'proactive-cognition-review-v1'),review);
  assert.equal(snapshot.enabled,false);assert.equal(snapshot.cloudAllowed,false);
  await restored.tick();assert.equal(f.layaCalls(),1);assert.equal(f.sent.length,1);
  assert.throws(()=>restored.assertCloudSend({taskId:f.card.taskId,goal:f.sent[0].query,
    signal:new AbortController().signal}),/当前会话/);
});

test('revocation while credentials are pending prevents the actual cloud request',async t=>{
  const f=await fixture(t,{revokeDuringCredentialRead:true});
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  const taskId=f.announced[0]?.taskId;assert.ok(taskId);
  assert.equal((await terminal(f.application,taskId)).state,'failed');
  assert.equal(f.sent.length,0);assert.equal(f.layaCalls(),1);
});

test('a newer graph revision before HTTP invalidates the old selected projection',async t=>{
  const f=await fixture(t,{changeGraphDuringCredentialRead:true});
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  const taskId=f.announced[0]?.taskId;assert.ok(taskId);
  assert.equal((await terminal(f.application,taskId)).state,'failed');
  assert.equal(f.sent.length,0);assert.equal(f.store.read().revision,6);
});

test('uncertain Laya selection hands off one explicit machine review without claiming a chosen action',async t=>{
  const f=await fixture(t,{uncertain:true});
  f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
  assert.equal(f.sent.length,0);assert.match(f.host().snapshot().reason,/尚不确定/);
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  const taskId=f.announced[0]?.taskId;assert.ok(taskId);
  assert.equal((await terminal(f.application,taskId)).state,'succeeded');
  assert.equal(f.sent.length,1);
  assert.match(f.sent[0].query,/Laya 尚未确定选择/);
  assert.doesNotMatch(f.sent[0].query,/Laya 已选择|PRIVATE_SOURCE_SENTINEL/);
  const payload=JSON.parse(f.sent[0].query.slice(f.sent[0].query.indexOf('\n')+1));
  assert.equal(payload.action,'RECHECK');assert.equal(payload.selectedOption,null);
  assert.equal(payload.eligibleForRuntime,false);assert.equal(payload.executed,false);
  f.advance();await f.host().tick();assert.equal(f.sent.length,1);assert.equal(f.layaCalls(),1);
  assert.equal(f.store.read().revision,5);
});

test('legacy Goal marker resumes after a transient Laya outage without reopening the old terminal task',async t=>{
  const f=await fixture(t,{unavailableInitially:true});
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  assert.equal(f.host().snapshot().status,'error');assert.equal(f.layaCalls(),1);
  const old=f.application.runtime.listTasks({}).items.find(task=>
    f.application.runtime.loadCheckpoint(task.taskId,'proactive-cognition-review-v1')?.selection?.reason==='unavailable');
  assert.ok(old);assert.equal(old.state,'succeeded');
  // Emulate the marker saved by older Desktop versions before unavailable propagation was fixed.
  f.application.runtime.saveCheckpoint(f.sourceTaskId,'desktop-goal-cognition-review',old.taskId);
  f.restoreLaya();f.restart().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  assert.equal(f.layaCalls(),1,'persisted cooldown survives Desktop restart');
  f.advance(31_000);await f.host().tick();
  const taskId=f.announced[0]?.taskId;assert.ok(taskId);
  assert.equal((await terminal(f.application,taskId)).state,'succeeded');
  assert.equal(f.sent.length,1);assert.equal(f.layaCalls(),2);
  assert.notEqual(f.application.runtime.loadCheckpoint(f.sourceTaskId,'desktop-goal-cognition-review'),old.taskId);
  assert.equal(f.application.runtime.getTask(old.taskId).state,'succeeded');
  f.advance();await f.host().tick();assert.equal(f.sent.length,1);
});

test('a newly registered Goal supplies its real subject to the first planning handoff',async t=>{
  const f=await fixture(t,{newGoal:true});
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  const taskId=f.announced[0]?.taskId;assert.ok(taskId);
  assert.equal((await terminal(f.application,taskId)).state,'succeeded');
  assert.equal(f.sent.length,1);assert.match(f.sent[0].query,/目标已登记/);
  const payload=JSON.parse(f.sent[0].query.slice(f.sent[0].query.indexOf('\n')+1));
  assert.equal(payload.action,'RECHECK');assert.equal(payload.executed,false);
  assert.ok(payload.nodes.some(node=>node.kind==='goal'&&node.summary==='原目标'));
  assert.doesNotMatch(f.sent[0].query,/PRIVATE_SOURCE_SENTINEL|private-source/);
  f.advance();await f.host().tick();assert.equal(f.sent.length,1);assert.equal(f.store.read().revision,2);
});

test('goal cognition snapshot exposes trigger, Laya choice, and executionStatus for Desktop rendering', async t => {
  const f = await fixture(t);
  f.host().configure({enabled: true, cloudAllowed: false});
  await f.host().tick();
  const snapshot = f.host().snapshot();
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.cloudAllowed, false);
  assert.equal(snapshot.reviews.length, 1);
  const review = snapshot.reviews[0];
  assert.ok(review.trigger, 'trigger must be present');
  assert.match(review.choice, /defer|revise|recheck|plan/);
  assert.match(review.executionStatus, /本地决策建议.*尚未执行/);

  // When cloud is allowed and submitted
  f.host().configure({enabled: true, cloudAllowed: true});
  await f.host().tick();
  const taskId = f.announced[0]?.taskId;
  assert.ok(taskId);
  assert.equal((await terminal(f.application, taskId)).state, 'succeeded');
  const updated = f.host().snapshot().reviews[0];
  assert.equal(updated.state, 'succeeded');
  assert.match(updated.executionStatus, /目标更新尚未核实/);
  assert.equal(updated.graphUpdateVerified,false);
});

test('applyDecision uses one idempotent AgentArts handoff and real task feedback, never a Goal rewrite', async t => {
  const f = await fixture(t,{holdFetch:true});
  f.host().configure({enabled: true, cloudAllowed: false});
  await f.host().tick();
  const snapshot = f.host().snapshot();
  assert.equal(snapshot.reviews.length, 1);
  const reviewTaskId = snapshot.reviews[0].reviewTaskId;
  await assert.rejects(f.host().applyDecision(reviewTaskId),/许可未开启/);
  assert.equal(f.goalWrites(),0);
  assert.equal(f.store.read().revision,5);
  f.host().configure({enabled:true,cloudAllowed:true});
  const result = await f.host().applyDecision(reviewTaskId);
  assert.equal(result.status, 'submitted');
  assert.equal(result.graphUpdateVerified,false);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.sent.length,1);
  const repeated=await f.host().applyDecision(reviewTaskId);
  assert.equal(repeated.taskId,result.taskId);
  assert.equal(f.sent.length,1);
  f.releaseFetch();
  assert.equal((await terminal(f.application,result.taskId)).state,'succeeded');
  const updated=f.host().snapshot().reviews[0];
  assert.equal(updated.state,'succeeded');
  assert.match(updated.executionStatus,/目标更新尚未核实/);
  assert.equal(f.goalWrites(),0);
  assert.equal(f.store.read().revision,5);
  const restored=f.restart().snapshot().reviews[0];
  assert.equal(restored.reviewTaskId,reviewTaskId);
  assert.equal(restored.taskId,result.taskId);
  assert.equal(restored.state,'succeeded');
  assert.equal(restored.graphUpdateVerified,false);
  assert.equal(f.host().snapshot().cloudAllowed,false);
  assert.equal(f.layaCalls(),1);
});

test('uncertain action remains a machine review; stale or substituted choices cannot rewrite arbitrary Goals',async t=>{
  const f=await fixture(t,{uncertain:true});
  f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
  const reviewTaskId=f.host().snapshot().reviews[0].reviewTaskId;
  assert.equal(f.restart().snapshot().reviews[0].reviewTaskId,reviewTaskId);
  f.host().configure({enabled:true,cloudAllowed:true});
  const result=await f.host().applyDecision(reviewTaskId);
  await terminal(f.application,result.taskId);
  assert.match(f.sent[0].query,/Laya 尚未确定选择/);
  assert.equal(f.goalWrites(),0);assert.equal(f.store.read().revision,5);
  const next=await fixture(t);
  next.host().configure({enabled:true,cloudAllowed:false});await next.host().tick();
  const id=next.host().snapshot().reviews[0].reviewTaskId;
  assert.equal(next.host().snapshot().reviews[0].sourceOutdated,false);
  next.store.append(5,node('another-goal','goal',[],'另一目标'));
  next.host().configure({enabled:true,cloudAllowed:true});
  assert.equal(next.host().snapshot().reviews[0].sourceOutdated,true);
  await assert.rejects(next.host().applyDecision(id),/来源版本已变化/);
  assert.equal(next.goalWrites(),0);assert.equal(next.sent.length,0);
});

test('failed handoff is reported from Runtime and stable decision markers restore without another model call',async t=>{
  const f=await fixture(t,{revokeDuringCredentialRead:true});
  f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
  const reviewTaskId=f.host().snapshot().reviews[0].reviewTaskId;
  const recovered=f.restart().snapshot();
  assert.equal(recovered.reviews[0].reviewTaskId,reviewTaskId);
  assert.equal(recovered.cloudAllowed,false);
  f.host().configure({enabled:true,cloudAllowed:true});
  const result=await f.host().applyDecision(reviewTaskId);
  await terminal(f.application,result.taskId);
  assert.equal(f.host().snapshot().reviews[0].state,'failed');
  assert.match(f.host().snapshot().reviews[0].executionStatus,/任务失败/);
  assert.equal((await f.host().applyDecision(reviewTaskId)).status,'failed');
  assert.equal(f.sent.length,0);assert.equal(f.goalWrites(),0);assert.equal(f.layaCalls(),1);
});

test('a selected strategy must still match the offered candidate and host binding',async t=>{
  for(const changed of ['candidate','binding']) {
    const f=await fixture(t);
    f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
    const id=f.host().snapshot().reviews[0].reviewTaskId;
    const review=f.application.runtime.loadCheckpoint(id,'proactive-cognition-review-v1');
    f.application.runtime.saveCheckpoint(id,'proactive-cognition-review-v1',changed==='candidate'
      ? {...review,selectedOption:{...review.selectedOption,description:'substituted action'}}
      : {...review,graphNamespace:'another-host'});
    f.host().configure({enabled:true,cloudAllowed:true});
    await assert.rejects(f.host().applyDecision(id),changed==='candidate'?/没有合法选择/:/可验证/);
    assert.equal(f.goalWrites(),0);assert.equal(f.sent.length,0);assert.equal(f.store.read().revision,5);
  }
});

test('a structured cloud repair translates only this selected scope and preserves private source omission',async t=>{
  const f=await fixture(t);
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  const taskId=f.announced[0].taskId;await terminal(f.application,taskId);
  const binding=f.host().readRepairBinding(taskId);assert.ok(binding);
  const payload=JSON.parse(f.sent[0].query.slice(f.sent[0].query.lastIndexOf('\n')+1));
  assert.equal(payload.repairContext.expectedGraphRevision,5);
  assert.doesNotMatch(JSON.stringify(payload.repairContext),/private-source|PRIVATE_SOURCE_SENTINEL|synthetic\/source/);
  assert.equal(f.host().readPreparedRepair(taskId).reason,'no_structured_candidate');
  const saved={kind:'repair_candidate',candidateVersion:'1.0',verification:'unverified',
    candidate:{expectedGraphRevision:5,changes:payload.repairContext.targets.map(item=>({node:item.node,summary:item.summary,
      reason:'Synthetic reviewed candidate',dependencies:item.requestedDependencies}))}};
  saved.candidate.changes[0].summary='Explicit revised decision';
  f.application.runtime.saveCheckpoint(taskId,'competition-repair-candidate',saved);
  const prepared=f.host().readPreparedRepair(taskId);
  assert.equal(prepared.kind,'prepared');
  assert.deepEqual(prepared.request.changes.map(change=>change.node.id),['decision','plan']);
  assert.equal(prepared.request.changes[0].summary,'Explicit revised decision');
  assert.equal(f.store.read().revision,5);assert.equal(f.goalWrites(),0);
  saved.candidate.changes[0].node.id='unoffered';
  f.application.runtime.saveCheckpoint(taskId,'competition-repair-candidate',saved);
  assert.throws(()=>f.host().readPreparedRepair(taskId),/选择范围/);
  f.host().configure({enabled:true,cloudAllowed:false});
  assert.equal(f.host().readRepairBinding(taskId),undefined);
  assert.equal(f.host().readPreparedRepair(taskId).kind,'unavailable');
});

test('Desktop reports applied only after real Runtime repair approval, CAS, Evidence and node-version readback',async t=>{
  const f=await fixture(t,{controlledRepair:true});
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  await terminal(f.application,f.announced[0].taskId);
  const reviewTaskId=f.host().snapshot().reviews[0].reviewTaskId;
  const accepted=await f.host().applyDecision(reviewTaskId);
  assert.notEqual(accepted.taskId,f.announced[0].taskId);assert.equal(accepted.graphUpdateVerified,false);
  for(let n=0;n<100 && f.application.runtime.getTask(accepted.taskId).state!=='waiting_approval';n++) await new Promise(resolve=>setTimeout(resolve,5));
  const approval=(await f.client.call('approval.list',{taskId:accepted.taskId})).items[0];assert.ok(approval);
  assert.equal(f.store.read().revision,5);
  await f.client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  assert.equal((await terminal(f.application,accepted.taskId)).state,'succeeded');
  const result=await f.host().applyDecision(reviewTaskId);
  assert.equal(result.status,'applied');assert.equal(result.executionVerified,true);assert.equal(result.graphUpdateVerified,true);
  assert.equal(f.store.read().revision,7);assert.equal(f.goalWrites(),0,'no summary overwrite through GoalHost.revise');
  assert.deepEqual(result.updatedNodes.map(node=>[node.id,node.revision]),[['decision',2],['plan',2]]);
  assert.ok(result.evidenceRefs.length);assert.equal(f.application.runtime.readToolExecutions(accepted.taskId).length,1);
  const restored=f.restart().snapshot().reviews[0];
  assert.equal(restored.taskId,accepted.taskId);assert.equal(restored.status,'applied');assert.equal(restored.graphUpdateVerified,true);
  assert.equal(f.host().snapshot().cloudAllowed,false);
  f.store.append(7,node('plan','plan',[ref('decision',2)],'Subsequent explicit Plan'));
  const changed=f.host().snapshot().reviews[0];assert.equal(changed.executionVerified,true);assert.equal(changed.graphUpdateVerified,false);
  assert.notEqual(changed.status,'applied');assert.equal(f.store.read().revision,8);
});

async function mixedMeeting(t,options={}) {
  const f=await fixture(t,options),at=new Date().toISOString();
  const context=()=>({deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal});
  const keys=['meeting','other'].map(id=>({vaultId:'public-demo',path:`${id}.md`,factId:`${id}/update`}));
  const record=(key,revision,summary)=>f.facts.recordPublicSource({...key,sourceRevision:revision.repeat(64),line:1,summary,
    observedAt:at,validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',
    expectedFactRevision:f.facts.readPublicSourceHead(key)},context()).fact.ref;
  const initialRefs=keys.map(key=>record(key,'a',`${key.path} initial`));
  await f.facts.drain({limit:10,maxBatches:2,...context()});
  f.facts.processImpacts({at,limit:10,...context()});
  const initial=f.facts.listImpactReceipts({afterGraphRevision:0,limit:10}).at(-1);
  const nodeRefs=initialRefs.map(fact=>initial.projection.links.find(link=>same(link.fact,fact)).node);
  for(let i=0;i<2;i++) {
    const id=i===0?'meeting':'other';
    f.store.append(f.store.read().revision,node(`${id}-goal`,'goal',[nodeRefs[i]]));
    f.store.append(f.store.read().revision,node(`${id}-plan`,'plan',[ref(`${id}-goal`)]));
  }
  const priorRevision=f.store.read().revision;
  const changed=keys.map(key=>record(key,'b',`${key.path} changed`));
  await f.facts.drain({limit:10,maxBatches:2,...context()});
  f.facts.processImpacts({at,limit:10,...context()});
  const receipt=f.facts.listImpactReceipts({afterGraphRevision:priorRevision,limit:10})[0];
  assert.equal(receipt.projection.links.length,2);
  const meetingFact=receipt.projection.links.find(link=>same(link.fact,changed[0])).node;
  const fact=f.store.read().history.findLast(item=>same(item,meetingFact));
  const event={eventId:'public-mixed-meeting',source:fact.sourceRef,meetingFactId:meetingFact.id,
    originalSummary:'meeting.md initial',newSummary:fact.summary,sourceRevision:'b'.repeat(64),detectedAt:at,...context()};
  const input={graphNamespace:namespace,projection:receipt.projection};
  const reader=createCommittedMeetingProjectionReader({namespace,store:f.store,facts:f.facts,
    readSourceRevision:async()=>({source:event.source,sourceRevision:event.sourceRevision,meetingFact})});
  const request=()=>({...input,meetingFact,sourceRevision:event.sourceRevision,at,workKey:'public-mixed-meeting',...context()});
  const port=()=>f.host().meetingReviewedRepairPort(reader);
  return {...f,at,context,event,input,meetingFact,reader,request,port};
}
const same=(a,b)=>a.id===b.id && a.revision===b.revision;

test('mixed Fact batch meeting review uses original proof, exact one-chain candidate, same Runtime identity and restart scope',async t=>{
  const f=await mixedMeeting(t),before=f.store.read();
  f.host().configure({enabled:true,cloudAllowed:false});
  const port=f.port();await port.readCommittedProjection(f.event,f.context());
  const value=await port.reviewCommittedFact(f.request());
  assert.equal(value.task.state,'succeeded');
  assert.deepEqual(value.review.affected.map(item=>item.node.id),['meeting-goal','meeting-plan']);
  assert.deepEqual(value.review.selectedOption.repair.changes.map(item=>item.node.id),['meeting-goal','meeting-plan']);
  const proof=f.application.runtime.loadCheckpoint(value.task.taskId,'desktop-meeting-review-scope-v1');
  assert.deepEqual(proof.input,f.input);assert.deepEqual(proof.meetingFact,f.meetingFact);
  assert.equal(proof.sourceRevision,f.event.sourceRevision);assert.equal(f.layaCalls(),1);
  f.restart().configure({enabled:true,cloudAllowed:false});
  const reopened=f.port();await reopened.readCommittedProjection(f.event,f.context());
  const replay=await reopened.reviewCommittedFact(f.request());
  assert.equal(replay.task.taskId,value.task.taskId);assert.equal(f.layaCalls(),1);
  assert.deepEqual(reopened.readReview(value.task.taskId).review.affected,value.review.affected);
  const legacy=f.application.runtime.submitTaskWithCheckpoint({goal:'Legacy full batch review',
    conversationId:`proactive-cognition:${namespace}`,idempotencyKey:'synthetic-legacy-full-batch'},'proactive-cognition-intent-v1',
    {version:1,graphNamespace:namespace,bindingVersion:'desktop-goal-analysis-v1',evaluatedAt:f.at,trigger:{kind:'fact',input:f.input}});
  assert.throws(()=>reopened.readReview(legacy.taskId),/缺少原批次范围凭据/);
  f.application.runtime.saveCheckpoint(value.task.taskId,'proactive-cognition-review-v1',
    {...value.review,affected:selectProjectedRepairScope(before,f.at,f.input).items});
  assert.throws(()=>reopened.readReview(value.task.taskId),/范围绑定/);
  await assert.rejects(reopened.applyDecision(value.task.taskId,f.context()),/范围绑定/);
  assert.equal(f.sent.length,0);assert.deepEqual(f.store.read(),before);
});

test('meeting full proof rejects unrelated link tampering before choose and rejects source revision substitution on recovery',async t=>{
  const f=await mixedMeeting(t),before=f.store.read();
  f.host().configure({enabled:true,cloudAllowed:false});
  const altered=structuredClone(f.input);altered.projection.links.find(link=>!same(link.node,f.meetingFact)).node.revision=99;
  const invalid=f.host().meetingReviewedRepairPort(async()=>({sourceRevision:f.event.sourceRevision,
    meetingFact:f.meetingFact,input:altered}));
  await invalid.readCommittedProjection(f.event,f.context());
  await assert.rejects(invalid.reviewCommittedFact({...f.request(),projection:altered.projection}),/投影尚未完成或已经变化/);
  assert.equal(f.layaCalls(),0);assert.deepEqual(f.store.read(),before);
  const valid=f.port();await valid.readCommittedProjection(f.event,f.context());
  const original=await valid.reviewCommittedFact(f.request());
  const changedSource=f.host().meetingReviewedRepairPort(async()=>({sourceRevision:'c'.repeat(64),meetingFact:f.meetingFact,input:f.input}));
  await changedSource.readCommittedProjection(f.event,f.context());
  await assert.rejects(changedSource.reviewCommittedFact({...f.request(),sourceRevision:'c'.repeat(64)}),/凭据不能替换/);
  assert.equal(f.layaCalls(),1);assert.equal(valid.readReview(original.task.taskId).task.taskId,original.task.taskId);
  assert.deepEqual(f.store.read(),before);
});

test('meeting reviewed repair CAS leaves the other Fact Goal and Plan in the same completed batch unchanged',async t=>{
  const f=await mixedMeeting(t,{controlledRepair:true}),before=f.store.read();
  const unrelated=before.history.filter(item=>item.id==='other-goal'||item.id==='other-plan'
    || item.id===f.input.projection.links.find(link=>!same(link.node,f.meetingFact)).node.id);
  f.host().configure({enabled:true,cloudAllowed:true});
  const port=f.port();await port.readCommittedProjection(f.event,f.context());
  const value=await port.reviewCommittedFact(f.request());
  await terminal(f.application,value.handoff.task.taskId);
  assert.doesNotMatch(f.sent[0].query,/other-goal|other-plan|other\.md changed/);
  const accepted=await port.applyDecision(value.task.taskId,f.context());
  for(let n=0;n<100 && f.application.runtime.getTask(accepted.taskId).state!=='waiting_approval';n++) await new Promise(resolve=>setTimeout(resolve,5));
  const approval=(await f.client.call('approval.list',{taskId:accepted.taskId})).items[0];assert.ok(approval);
  await f.client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  assert.equal((await terminal(f.application,accepted.taskId)).state,'succeeded');
  const result=await port.applyDecision(value.task.taskId,f.context());
  assert.equal(result.status,'applied');assert.equal(result.executionVerified,true);assert.equal(result.graphUpdateVerified,true);
  assert.deepEqual(result.updatedNodes.map(item=>[item.id,item.revision]),[['meeting-goal',2],['meeting-plan',2]]);
  assert.deepEqual(f.store.read().history.filter(item=>unrelated.some(original=>original.id===item.id)),unrelated);
  assert.equal(f.layaCalls(),1);assert.ok(result.evidenceRefs.length);
});



async function loseAcceptedHandoff(f) {
  f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
  const reviewTaskId=f.host().snapshot().reviews.find(card=>card.action!=='KEEP').reviewTaskId;
  const call=f.client.call.bind(f.client);let captured;
  f.client.call=async (operation,payload,options)=>{
    const receipt=await call(operation,payload,options);
    if(operation==='task.submit') {captured=receipt;throw Error('Synthetic delivery lost an accepted validated receipt');}
    return receipt;
  };
  f.host().configure({enabled:true,cloudAllowed:true});
  await assert.rejects(f.host().applyDecision(reviewTaskId),/Synthetic delivery/);
  f.client.call=call;assert.ok(captured?.taskId);
  assert.equal(f.application.runtime.loadCheckpoint(reviewTaskId,'desktop-goal-cognition-handoff-task-v1'),undefined);
  return {reviewTaskId,taskId:captured.taskId};
}

test('lost handoff receipt restores a succeeded task without cloud permission or another inference',async t=>{
  const f=await fixture(t),accepted=await loseAcceptedHandoff(f);
  assert.equal((await terminal(f.application,accepted.taskId)).state,'succeeded');
  const saved=f.application.runtime.loadCheckpoint(accepted.reviewTaskId,'proactive-cognition-review-v1');
  f.store.append(5,node('later-goal','goal',[],'Later source revision'));
  const host=f.restart(),card=host.snapshot().reviews.find(item=>item.reviewTaskId===accepted.reviewTaskId);
  assert.equal(card.taskId,accepted.taskId);assert.equal(card.state,'succeeded');assert.equal(card.sourceOutdated,true);
  assert.equal(card.graphUpdateVerified,false);assert.equal(host.snapshot().enabled,false);assert.equal(host.snapshot().cloudAllowed,false);
  assert.throws(()=>host.assertCloudSend({taskId:accepted.taskId,goal:f.sent[0].query,signal:new AbortController().signal}),/当前会话/);
  assert.deepEqual(f.application.runtime.loadCheckpoint(accepted.reviewTaskId,'proactive-cognition-review-v1'),saved);
  assert.equal(f.layaCalls(),1);assert.equal(f.sent.length,1);
});

test('lost handoff receipt restores the current running task without waiting or redispatch',async t=>{
  const f=await fixture(t,{holdFetch:true});t.after(()=>f.releaseFetch());
  const accepted=await loseAcceptedHandoff(f);
  for(let n=0;n<100 && !f.sent.length;n++) await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.sent.length,1);assert.equal(f.application.runtime.getTask(accepted.taskId).state,'running');
  try {
    const card=f.restart().snapshot().reviews.find(item=>item.reviewTaskId===accepted.reviewTaskId);
    assert.equal(card.taskId,accepted.taskId);assert.equal(card.state,'running');assert.equal(card.graphUpdateVerified,false);
    assert.equal(f.host().snapshot().cloudAllowed,false);assert.equal(f.layaCalls(),1);assert.equal(f.sent.length,1);
  } finally {f.releaseFetch();await terminal(f.application,accepted.taskId);}
});

test('lost handoff receipt restores created tasks and rejects absent or mismatched durable bindings',async t=>{
  const f=await fixture(t);f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
  const runtime=f.application.runtime,reviewTaskId=f.host().snapshot().reviews[0].reviewTaskId;
  const review=runtime.loadCheckpoint(reviewTaskId,'proactive-cognition-review-v1');
  const commandId='proactive-'+toolArgumentsDigest({graphNamespace:namespace,bindingVersion:'desktop-goal-analysis-v1',taskId:reviewTaskId});
  const task=runtime.submitTask({goal:'Synthetic persisted accepted goal',conversationId:`desktop-proactive-goals:${namespace}`,idempotencyKey:commandId});
  const envelope={commandId,reviewTaskId,selectionDigest:toolArgumentsDigest(review),exportPolicyVersion:'desktop-goal-analysis-v1',goal:task.goal,deadline:'2026-01-01T00:00:00.000Z'};
  runtime.saveCheckpoint(reviewTaskId,'proactive-cognition-handoff-v1',envelope);
  let card=f.restart().snapshot().reviews[0];assert.equal(card.taskId,task.taskId);assert.equal(card.state,'created');
  // An already accepted task remains a receipt after its dispatch deadline expires.
  for(const changed of [{...envelope,reviewTaskId:'foreign-review'},{...envelope,selectionDigest:'foreign-digest'},
    {...envelope,exportPolicyVersion:'foreign-binding'},{...envelope,commandId:'foreign-command'},
    {...envelope,goal:'foreign payload'},null]) {
    runtime.saveCheckpoint(reviewTaskId,'proactive-cognition-handoff-v1',changed);
    card=f.restart().snapshot().reviews[0];assert.equal(card.taskId,undefined);
  }
  const foreign=runtime.submitTask({goal:task.goal,conversationId:'desktop-proactive-goals:foreign-namespace',idempotencyKey:'foreign-receipt'});
  runtime.saveCheckpoint(reviewTaskId,'proactive-cognition-handoff-v1',{...envelope,commandId:'foreign-receipt'});
  card=f.restart().snapshot().reviews[0];assert.equal(card.taskId,undefined);assert.equal(runtime.getTask(foreign.taskId).state,'created');
  runtime.saveCheckpoint(reviewTaskId,'proactive-cognition-handoff-v1',envelope);
  runtime.saveCheckpoint(reviewTaskId,'desktop-goal-cognition-handoff-task-v1',null);
  assert.equal(f.restart().snapshot().reviews[0].taskId,undefined,'a present malformed Desktop marker is not replaced by fallback');
  assert.equal(f.layaCalls(),1);assert.equal(f.sent.length,0);assert.equal(f.host().snapshot().cloudAllowed,false);
  // A foreign-conversation task under the exact otherwise valid command is not this receipt.
  const other=await fixture(t);other.host().configure({enabled:true,cloudAllowed:false});await other.host().tick();
  const otherId=other.host().snapshot().reviews[0].reviewTaskId,otherRuntime=other.application.runtime;
  const otherReview=otherRuntime.loadCheckpoint(otherId,'proactive-cognition-review-v1');
  const exactCommand='proactive-'+toolArgumentsDigest({graphNamespace:namespace,bindingVersion:'desktop-goal-analysis-v1',taskId:otherId});
  const foreignTask=otherRuntime.submitTask({goal:envelope.goal,conversationId:'desktop-proactive-goals:foreign-namespace',idempotencyKey:exactCommand});
  otherRuntime.saveCheckpoint(otherId,'proactive-cognition-handoff-v1',{...envelope,commandId:exactCommand,reviewTaskId:otherId,selectionDigest:toolArgumentsDigest(otherReview)});
  assert.equal(other.restart().snapshot().reviews[0].taskId,undefined);
  assert.equal(otherRuntime.getTask(foreignTask.taskId).state,'created');assert.equal(other.sent.length,0);
});

test('lost handoff receipt fallback preserves the original Desktop receipt marker priority',async t=>{
  const f=await fixture(t);f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  const original=f.host().snapshot().reviews[0];await terminal(f.application,original.taskId);
  f.application.runtime.saveCheckpoint(original.reviewTaskId,'proactive-cognition-handoff-v1',{commandId:'foreign-command',reviewTaskId:'foreign-review'});
  const card=f.restart().snapshot().reviews[0];assert.equal(card.taskId,original.taskId);assert.equal(card.state,'succeeded');
  assert.equal(f.layaCalls(),1);assert.equal(f.sent.length,1);assert.equal(f.host().snapshot().cloudAllowed,false);
});

test('lost handoff immediate feedback shows the accepted task and retains the original delivery error',async t=>{
  const f=await fixture(t,{holdFetch:true});let taskId;
  try {
    f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
    const reviewTaskId=f.host().snapshot().reviews[0].reviewTaskId,call=f.client.call.bind(f.client);
    const deliveryError=Error('Synthetic immediate lost receipt');let submissions=0;
    f.client.call=async (operation,payload,options)=>{
      const result=await call(operation,payload,options);
      if(operation==='task.submit') {submissions++;taskId=result.taskId;throw deliveryError;}
      return result;
    };
    f.host().configure({enabled:true,cloudAllowed:true});const updates=f.updateCalls();
    await assert.rejects(f.host().applyDecision(reviewTaskId),error=>error===deliveryError);
    const card=f.host().snapshot().reviews[0];assert.equal(card.taskId,taskId);
    assert.equal(card.state,f.application.runtime.getTask(taskId).state);assert.equal(card.graphUpdateVerified,false);
    assert.equal(f.host().snapshot().status,'submitted');assert.equal(f.updateCalls(),updates+1);
    assert.equal(submissions,1);assert.equal(f.layaCalls(),1);
    assert.equal(f.application.runtime.loadCheckpoint(reviewTaskId,'desktop-goal-cognition-handoff-task-v1'),undefined);
  } finally {f.releaseFetch();if(taskId) await terminal(f.application,taskId);}
});

test('lost handoff immediate feedback cannot invent acceptance or restore revoked and closed sessions',async t=>{
  for(const mode of ['not_accepted','revoked','closed']) {
    const f=await fixture(t);f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
    const reviewTaskId=f.host().snapshot().reviews[0].reviewTaskId,call=f.client.call.bind(f.client);
    const originalError=Error('Synthetic original '+mode);let taskId,submissions=0;
    f.client.call=async (operation,payload,options)=>{
      if(operation!=='task.submit') return call(operation,payload,options);
      if(mode==='not_accepted') throw originalError;
      const result=await call(operation,payload,options);submissions++;taskId=result.taskId;
      if(mode==='revoked') f.host().configure({enabled:true,cloudAllowed:false});else f.host().close();
      throw originalError;
    };
    f.host().configure({enabled:true,cloudAllowed:true});
    let result;
    if(mode==='not_accepted') await assert.rejects(f.host().applyDecision(reviewTaskId),error=>error===originalError);
    else result=await f.host().applyDecision(reviewTaskId);
    const view=f.host().snapshot(),card=view.reviews[0];
    if(mode==='not_accepted') {
      assert.equal(card.taskId,undefined);assert.equal(submissions,0);
      assert.equal(f.application.runtime.loadCheckpoint(reviewTaskId,'desktop-goal-cognition-handoff-task-v1'),undefined);
    } else {
      // Original Runtime cancellation reconciliation already returns the accepted
      // task after revocation/close. Preserve that success-path receipt contract.
      assert.equal(result.taskId,taskId);assert.equal(view.cloudAllowed,false);assert.equal(submissions,1);
      assert.throws(()=>f.host().assertCloudSend({taskId,goal:f.application.runtime.getTask(taskId).goal,signal:new AbortController().signal}));
      if(mode==='revoked') assert.equal(card.taskId,taskId);else assert.equal(view.enabled,false);
      await terminal(f.application,taskId);
    }
    assert.equal(f.layaCalls(),1);assert.equal(f.sent.length,0);
  }
});

async function originalGoalTaskSurface() {
  const text=await readFile(new URL('../electron/main.js',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const declaration=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast);
  let notify,filter;
  function visit(n) {
    if(ts.isCallExpression(n)&&n.expression.getText(ast)==='createDesktopProactiveHost') {
      notify=n.arguments[0].properties.find(p=>p.name?.getText(ast)==='onAnalysisTask').initializer.getText(ast);
    }
    if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==='tasks'&&n.initializer.getText(ast).startsWith('orderedTasks().filter(')&&n.initializer.getText(ast).includes('visibleConversationTask(task,surface)')) {
      filter=n.initializer.expression.expression.getText(ast);
    }
    ts.forEachChild(n,visit);
  }
  visit(ast);assert.ok(notify&&filter);
  const conversations=new Conversations(undefined),taskGoals=new Map(),tasks=new Map();
  const context=vm.createContext({conversations,taskGoals,tasks,Date});
  vm.runInContext(declaration('orderedTasks')+'\n'+declaration('taskSurface')+'\n'+declaration('visibleConversationTask'),context);
  return {conversations,taskGoals,tasks,notify:vm.runInContext('('+notify+')',context),
    panelTasks:()=>{context.surface='panel';return vm.runInContext(filter,context);},
    adminTasks:()=>{context.surface=undefined;return vm.runInContext(filter,context);}};
}

test('Goal task metadata makes accepted lost receipts visible in the original panel once per Host',async t=>{
  for(const lost of [false,true]) {
    const ui=await originalGoalTaskSurface(),f=await fixture(t,{onTaskCallback:ui.notify});
    f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
    const id=f.host().snapshot().reviews[0].reviewTaskId,call=f.client.call.bind(f.client);
    const deliveryError=Error('Synthetic metadata receipt delivery lost');let taskId,submissions=0;
    f.client.call=async(operation,payload,options)=>{
      const result=await call(operation,payload,options);
      if(operation==='task.submit'){submissions++;taskId=result.taskId;if(lost)throw deliveryError;}
      return result;
    };
    f.host().configure({enabled:true,cloudAllowed:true});
    if(lost) await assert.rejects(f.host().applyDecision(id),error=>error===deliveryError);
    else await f.host().applyDecision(id);
    await terminal(f.application,taskId);ui.tasks.set(taskId,f.application.runtime.getTask(taskId));
    assert.equal(ui.panelTasks().some(task=>task.taskId===taskId),true,'accepted task needs original panel metadata even when its reply was lost');
    assert.equal(ui.conversations.goal(taskId),'根据目标与事实变化主动规划');
    assert.equal(f.announced.length,1,'normal dispatch and repeated record share one notification');
    f.host().configure({enabled:true,cloudAllowed:false});f.advance();await f.host().tick();
    await f.host().applyDecision(id);assert.equal(f.announced.length,1);assert.equal(submissions,1);
    ui.conversations.turns.clear();ui.taskGoals.clear();const reopened=f.restart();
    assert.equal(ui.panelTasks().some(task=>task.taskId===taskId),true,'rebuilding the Host restores historical panel registration');
    assert.equal(f.announced.length,2);assert.equal(reopened.snapshot().cloudAllowed,false);
    assert.throws(()=>reopened.assertCloudSend({taskId,goal:f.application.runtime.getTask(taskId).goal,signal:new AbortController().signal}));
    assert.equal(f.sent.length,1);assert.equal(f.layaCalls(),1);assert.equal(f.store.read().revision,5);
  }
});

test('Goal task metadata callback failures keep the original delivery error and never duplicate notification',async t=>{
  for(const accepted of [false,true]) {
    const callbackError=Error('Synthetic metadata persistence failed'),f=await fixture(t,{onTaskCallback:()=>{throw callbackError;}});
    f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
    const id=f.host().snapshot().reviews[0].reviewTaskId,call=f.client.call.bind(f.client);
    const deliveryError=Error('Synthetic original delivery failure');let taskId;
    f.client.call=async(operation,payload,options)=>{
      if(operation!=='task.submit')return call(operation,payload,options);
      if(accepted)taskId=(await call(operation,payload,options)).taskId;
      throw deliveryError;
    };
    f.host().configure({enabled:true,cloudAllowed:true});
    await assert.rejects(f.host().applyDecision(id),error=>error===deliveryError);
    assert.equal(f.announced.length,accepted?1:0);
    const card=f.host().snapshot().reviews[0];assert.equal(card.taskId,taskId);
    assert.equal(f.application.runtime.loadCheckpoint(id,'desktop-goal-cognition-handoff-task-v1'),undefined);
    f.host().configure({enabled:true,cloudAllowed:false});f.advance();await f.host().tick();
    assert.equal(f.announced.length,accepted?1:0,'a notification that may have partly completed is not repeated by reconciliation');
    if(taskId)await terminal(f.application,taskId);
    assert.equal(f.layaCalls(),1);assert.ok(f.sent.length<=1);
  }
});

test('Goal task metadata rejects malformed receipts and foreign bindings before notifying an existing created task',async t=>{
  const f=await fixture(t);f.host().configure({enabled:true,cloudAllowed:false});await f.host().tick();
  const runtime=f.application.runtime,id=f.host().snapshot().reviews[0].reviewTaskId;
  const review=runtime.loadCheckpoint(id,'proactive-cognition-review-v1');
  const commandId='proactive-'+toolArgumentsDigest({graphNamespace:namespace,bindingVersion:'desktop-goal-analysis-v1',taskId:id});
  const task=runtime.submitTask({goal:'Synthetic existing created Goal',conversationId:`desktop-proactive-goals:${namespace}`,idempotencyKey:commandId});
  const envelope={commandId,reviewTaskId:id,selectionDigest:toolArgumentsDigest(review),exportPolicyVersion:'desktop-goal-analysis-v1',goal:task.goal,deadline:'2026-01-01T00:00:00.000Z'};
  for(const changed of [{...envelope,selectionDigest:'foreign-digest'},{...envelope,goal:'foreign-goal'},{...envelope,exportPolicyVersion:'foreign-binding'}]) {
    runtime.saveCheckpoint(id,'proactive-cognition-handoff-v1',changed);f.restart();assert.equal(f.announced.length,0);
  }
  runtime.saveCheckpoint(id,'proactive-cognition-handoff-v1',envelope);
  runtime.saveCheckpoint(id,'desktop-goal-cognition-handoff-task-v1',null);f.restart();assert.equal(f.announced.length,0);
  // The valid durable binding was never replaced by the malformed marker.
  const other=await fixture(t);other.host().configure({enabled:true,cloudAllowed:false});await other.host().tick();
  const otherId=other.host().snapshot().reviews[0].reviewTaskId,otherRuntime=other.application.runtime;
  const otherCommand='proactive-'+toolArgumentsDigest({graphNamespace:namespace,bindingVersion:'desktop-goal-analysis-v1',taskId:otherId});
  const foreign=otherRuntime.submitTask({goal:task.goal,conversationId:'desktop-proactive-goals:foreign',idempotencyKey:otherCommand});
  otherRuntime.saveCheckpoint(otherId,'proactive-cognition-handoff-v1',{...envelope,commandId:otherCommand,reviewTaskId:otherId,
    selectionDigest:toolArgumentsDigest(otherRuntime.loadCheckpoint(otherId,'proactive-cognition-review-v1'))});
  other.restart();assert.equal(other.announced.length,0);assert.equal(otherRuntime.getTask(foreign.taskId).state,'created');
  assert.equal(f.sent.length+other.sent.length,0);assert.equal(f.host().snapshot().cloudAllowed,false);
});

async function pendingOriginalPanelRepair(f,ui) {
  const cloudTaskId=f.announced[0].taskId;await terminal(f.application,cloudTaskId);
  const reviewTaskId=f.host().snapshot().reviews[0].reviewTaskId;
  const accepted=await f.host().applyDecision(reviewTaskId),taskId=accepted.taskId;
  for(let n=0;n<100&&f.application.runtime.getTask(taskId).state!=='waiting_approval';n++)await new Promise(done=>setTimeout(done,5));
  assert.equal(f.application.runtime.getTask(taskId).state,'waiting_approval');
  const approvals=(await f.client.call('approval.list',{taskId})).items;
  assert.equal(approvals.length,1);assert.equal(approvals[0].state,'pending');
  let snapshotSequence,beforeSequence;
  do {
    const page=await f.client.call('task.list',{limit:100,...(snapshotSequence===undefined?{}:{snapshotSequence}),
      ...(beforeSequence===undefined?{}:{beforeSequence})});
    snapshotSequence=page.snapshotSequence;
    for(const task of page.items)ui.tasks.set(task.taskId,task);
    beforeSequence=page.nextBeforeSequence;
  }while(beforeSequence!==undefined);
  return {cloudTaskId,reviewTaskId,taskId,approvals};
}

test('local repair pending approval is visible in the original panel and restored once per Host',async t=>{
  const ui=await originalGoalTaskSurface(),f=await fixture(t,{controlledRepair:true,onTaskCallback:ui.notify});
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  const pending=await pendingOriginalPanelRepair(f,ui),taskId=pending.taskId;
  const panelTask=ui.panelTasks().find(task=>task.taskId===taskId);
  assert.ok(panelTask,'the original panel filter must expose the pending local repair task');
  assert.match(approvalCards(panelTask,pending.approvals),/data-approval-decision="allow_once"/);
  assert.equal(ui.adminTasks().some(task=>task.taskId===taskId),true);
  assert.equal(ui.conversations.goal(taskId),'根据已选择方案受控修复计划');
  assert.equal(f.announced.filter(task=>task.taskId===taskId).length,1);
  assert.equal((await f.host().applyDecision(pending.reviewTaskId)).taskId,taskId);
  assert.equal(f.announced.filter(task=>task.taskId===taskId).length,1);
  ui.conversations.turns.clear();ui.taskGoals.clear();f.restart();
  assert.equal(f.announced.filter(task=>task.taskId===taskId).length,2);
  assert.equal(ui.panelTasks().some(task=>task.taskId===taskId),true);
  assert.equal(f.host().snapshot().cloudAllowed,false);
  assert.throws(()=>f.host().assertCloudSend({taskId:pending.cloudTaskId,goal:f.application.runtime.getTask(pending.cloudTaskId).goal,signal:new AbortController().signal}));
  assert.deepEqual((await f.client.call('approval.list',{taskId})).items,pending.approvals);
  assert.equal(f.application.runtime.getTask(taskId).state,'waiting_approval');
  assert.equal(f.store.read().revision,5);assert.equal(f.sent.length,1);assert.equal(f.layaCalls(),1);
});

test('local repair metadata callback failure preserves its error and does not repeat an attempted notification',async t=>{
  const callbackError=Error('Synthetic local repair metadata persistence failed');
  const f=await fixture(t,{controlledRepair:true,onTaskCallback:item=>{if(item.goal==='根据已选择方案受控修复计划')throw callbackError;}});
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  await terminal(f.application,f.announced[0].taskId);
  const reviewTaskId=f.host().snapshot().reviews[0].reviewTaskId;
  await assert.rejects(f.host().applyDecision(reviewTaskId),error=>error===callbackError);
  const marker=f.application.runtime.loadCheckpoint(reviewTaskId,'desktop-goal-cognition-repair-task-v1');
  assert.ok(marker);assert.equal(f.announced.filter(task=>task.taskId===marker.taskId).length,1);
  const repeated=await f.host().applyDecision(reviewTaskId);assert.equal(repeated.taskId,marker.taskId);
  assert.equal(f.announced.filter(task=>task.taskId===marker.taskId).length,1);
  const intent=f.application.runtime.loadCheckpoint(marker.taskId,'local-repair-intent');
  f.restart();assert.equal(f.announced.filter(task=>task.taskId===marker.taskId).length,2);
  assert.deepEqual(f.application.runtime.loadCheckpoint(marker.taskId,'local-repair-intent'),intent);
  assert.deepEqual(f.application.runtime.loadCheckpoint(reviewTaskId,'desktop-goal-cognition-repair-task-v1'),marker);
  assert.equal(f.store.read().revision,5);assert.equal(f.sent.length,1);assert.equal(f.layaCalls(),1);
});

test('historical local repair metadata rejects malformed markers and a foreign task conversation',async t=>{
  const ui=await originalGoalTaskSurface(),f=await fixture(t,{controlledRepair:true,onTaskCallback:ui.notify});
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  const pending=await pendingOriginalPanelRepair(f,ui),runtime=f.application.runtime;
  const marker=runtime.loadCheckpoint(pending.reviewTaskId,'desktop-goal-cognition-repair-task-v1');
  const intent=runtime.loadCheckpoint(pending.taskId,'local-repair-intent');
  const foreign=runtime.submitTask({goal:'Synthetic foreign metadata task',conversationId:'foreign-conversation',idempotencyKey:'synthetic-foreign-local-repair-metadata'});
  runtime.saveCheckpoint(foreign.taskId,'local-repair-intent',intent);
  for(const changed of [{...marker,namespace:'foreign'},{...marker,reviewTaskId:'foreign'},
    {...marker,sourceTaskId:'foreign'},{...marker,candidateDigest:'foreign'},{...marker,taskId:foreign.taskId}]) {
    runtime.saveCheckpoint(pending.reviewTaskId,'desktop-goal-cognition-repair-task-v1',changed);
    f.announced.length=0;ui.conversations.turns.clear();ui.taskGoals.clear();f.restart();
    assert.equal(f.announced.some(task=>task.taskId===pending.taskId||task.taskId===foreign.taskId),false);
    assert.equal(ui.panelTasks().some(task=>task.taskId===pending.taskId||task.taskId===foreign.taskId),false);
    assert.equal(f.host().snapshot().reviews[0].state,'waiting_reconciliation');
    assert.deepEqual(runtime.loadCheckpoint(pending.reviewTaskId,'desktop-goal-cognition-repair-task-v1'),changed);
  }
  runtime.saveCheckpoint(pending.reviewTaskId,'desktop-goal-cognition-repair-task-v1',marker);f.restart();
  assert.equal(ui.panelTasks().some(task=>task.taskId===pending.taskId),true);
  assert.deepEqual(runtime.loadCheckpoint(pending.taskId,'local-repair-intent'),intent);
  assert.deepEqual((await f.client.call('approval.list',{taskId:pending.taskId})).items,pending.approvals);
  assert.equal(f.store.read().revision,5);assert.equal(f.sent.length,1);assert.equal(f.layaCalls(),1);
});


test('complete oversized Goal projection stays local without a handoff journal or accepted task',async t=>{
  const f=await fixture(t,{largeScope:true});
  assert.ok(f.host().snapshot().reviews.every(item=>item.cloudExport===undefined));
  f.host().configure({enabled:true,cloudAllowed:true});await f.host().tick();
  const card=f.host().snapshot().reviews.find(item=>item.selected==='defer');assert.ok(card);
  assert.equal(card.cloudExport?.state,'blocked');assert.equal(card.cloudExport?.reason,'goal_text_limit');
  assert.equal(card.cloudExport.maxChars,16000);assert.ok(card.cloudExport.chars>16000);
  assert.equal(card.taskId,undefined);assert.equal(f.announced.length,0);assert.equal(f.sent.length,0);
  const runtime=f.application.runtime,review=runtime.loadCheckpoint(card.reviewTaskId,'proactive-cognition-review-v1');
  assert.equal(review.affected.length,101);assert.equal(runtime.loadCheckpoint(card.reviewTaskId,'proactive-cognition-handoff-v1'),undefined);
  const response=await f.host().applyDecision(card.reviewTaskId);assert.equal(response.status,'unavailable');
  assert.equal(response.cloudExport.state,'blocked');assert.equal(response.taskId,undefined);
  assert.equal(f.announced.length,0);assert.equal(f.sent.length,0);assert.equal(f.store.read().revision,104);
  assert.deepEqual(runtime.loadCheckpoint(card.reviewTaskId,'proactive-cognition-review-v1'),review);
  f.store.append(f.store.read().revision,node('goal','goal',[ref('private-source')],'Later Goal revision','private'));
  const outdated=f.host().snapshot().reviews.find(item=>item.reviewTaskId===card.reviewTaskId);
  assert.equal(outdated.sourceOutdated,true);assert.equal(outdated.cloudExport,undefined);
  f.host().configure({enabled:true,cloudAllowed:false});
  assert.equal(f.host().snapshot().reviews.find(item=>item.reviewTaskId===card.reviewTaskId).cloudExport,undefined);
  const restored=f.restart();assert.equal(restored.snapshot().enabled,false);assert.equal(restored.snapshot().cloudAllowed,false);
  assert.equal(restored.snapshot().reviews.find(item=>item.reviewTaskId===card.reviewTaskId).taskId,undefined);
});

test('background Goal metadata retains legacy ownership and existing explicit ownership after chat switches',async()=>{const ui=await originalGoalTaskSurface();const fresh=ui.conversations.create('panel','new active chat');ui.tasks.set('background',{taskId:'background',conversationId:'desktop-proactive-goals:trusted',state:'running'});ui.notify({taskId:'background',goal:'background analysis'});assert.equal(ui.conversations.conversationIdForTask(ui.tasks.get('background')),'desktop-panel');assert.equal(ui.panelTasks().length,0);ui.conversations.switch('panel','desktop-panel');assert.equal(ui.panelTasks()[0].taskId,'background');ui.conversations.add('existing','panel','original',fresh.id);ui.tasks.set('existing',{taskId:'existing',state:'running'});ui.notify({taskId:'existing',goal:'repeated registration'});assert.equal(ui.conversations.conversationIdForTask(ui.tasks.get('existing')),fresh.id);ui.tasks.set('foreign',{taskId:'foreign',conversationId:'foreign-conversation',state:'created'});assert.equal(ui.panelTasks().some(task=>task.taskId==='foreign'),false);});
