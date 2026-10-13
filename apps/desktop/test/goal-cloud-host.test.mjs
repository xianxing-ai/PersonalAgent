import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createGoalTools} from '@personal-agent/goals/tool';
import {getGoal,listGoals} from '@personal-agent/goals/commands';
import {createDesktopGoalCloudHost} from '../electron/goal-cloud-host.js';
import {createGoalHost} from '../electron/goal-host.js';

const cache=new URL('../../../.cache/goal-cloud-host-tests/',import.meta.url);
mkdirSync(cache,{recursive:true});
const signal=new AbortController().signal;
const goal=(summary,sensitivity='private')=>({id:'goal-one',summary,
  validFrom:'2026-09-27T00:00:00.000Z',validUntil:'2026-10-27T00:00:00.000Z',
  sensitivity,state:'active',reason:'User selected this goal',dependencies:[]});
async function until(predicate){for(let n=0;n<100;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('State did not arrive');}

test('routine local Goal writes retain exact consumed Policy binding without cloud consent',async t=>{
  const namespace='routine-goal-user';
  const file=path.join(mkdtempSync(new URL('routine-',cache)),'runtime.sqlite');
  const host=createGoalHost(namespace);
  const cloud=createDesktopGoalCloudHost({goalHost:host,namespace});
  const app=createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',hostUserNamespace:namespace,
    tools:cloud.tools,automaticTools:cloud.tools.filter(tool=>tool.descriptor.sideEffect==='local_write')
      .map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version}))});
  t.after(()=>{cloud.close();app.close();});
  host.bind(app);cloud.bindApplication(app);
  const created=host.create({expectedGraphRevision:0,goal:goal('Three slides','public')});
  await until(()=>app.activeTaskCount===0);
  assert.equal(host.readTask(created.taskId).state,'succeeded');
  const revised=host.revise({expectedGraphRevision:1,expectedGoalRevision:1,
    goal:goal('Five slides','public')});
  await until(()=>app.activeTaskCount===0);
  assert.equal(host.readTask(revised.taskId).state,'succeeded');
  assert.equal(host.get('goal-one').goal.revision,2);
  assert.equal(host.get('goal-one').goal.summary,'Five slides');
  assert.equal(cloud.snapshot().sessionAllowed,false);
  const runId=`host-tool-${revised.taskId}`;
  assert.throws(()=>app.runtime.getApproval(runId),/not found/i);
  const records=app.runtime.readToolExecutions(revised.taskId);
  assert.equal(records.length,1);assert.equal(records[0].state,'confirmed');
  assert.equal(records[0].policyDecision,'allow');
  const intent=app.runtime.loadCheckpoint(revised.taskId,'host-tool-intent');
  const context={taskId:revised.taskId,runId,authorizationRef:runId,signal,
    deadline:intent.deadline,scopes:['goals:write']};
  const tool=cloud.tools.find(item=>item.descriptor.name==='goals.revise');
  await assert.rejects(()=>tool.execute({...intent.arguments,
    goal:{...intent.arguments.goal,summary:'Changed arguments'}},context),/unavailable/);
  app.runtime.policy.revoke(runId);
  await assert.rejects(()=>tool.execute(intent.arguments,context),/unavailable/);
  assert.equal(host.get('goal-one').goal.summary,'Five slides');
});

test('public Goal tools retain CAS while read projection and consent guard cloud export',async t=>{
  const file=path.join(mkdtempSync(new URL('run-',cache)),'runtime.sqlite');
  let store;
  const goalHost={tools:createGoalTools(()=>store),list:()=>listGoals(store),get:id=>getGoal(store,id)};
  const cloud=createDesktopGoalCloudHost({goalHost});
  const app=createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',hostUserNamespace:'test-user',
    tools:cloud.tools,competitionToolAvailability:cloud.competitionToolAvailability,
    competitionToolExports:cloud.competitionToolExports});
  t.after(()=>{cloud.close();app.close();});
  store=app.runtime.provisionCoordinationStore('test-user-goals');
  cloud.bindApplication(app);
  const task=app.runtime.submitTask({goal:'Manage my goal',conversationId:'desktop-panel',
    idempotencyKey:'goal-cloud-test'});
  const available=name=>cloud.competitionToolAvailability.find(item=>item.toolName===name)
    .available({taskId:task.taskId,revision:task.revision,deadline:'2026-09-28T00:00:00.000Z',signal});
  assert.equal(available('goals.create'),false);
  cloud.authorize({goalCloudConsent:true});
  assert.equal(available('goals.create'),true);
  const context={taskId:task.taskId,runId:'goal-run',signal,
    deadline:'2026-09-28T00:00:00.000Z',authorizationRef:'goal-run',scopes:['goals:write','goals:read']};
  const execute=(name,input)=>cloud.tools.find(item=>item.descriptor.name===name).execute(input,context);
  const create=await execute('goals.create',{expectedGraphRevision:0,goal:goal('First revision')});
  assert.deepEqual(create,{kind:'applied',graphRevision:1,previousGoal:null,
    currentGoal:{id:'goal-one',revision:1}});
  assert.match(store.read().history[0].sourceRef,/^desktop-goal-cloud:/);
  const listed=await execute('goals.list',{});
  assert.equal(listed.graphRevision,1);
  assert.deepEqual(listed.goals.map(item=>[item.id,item.revision,item.summary]),
    [['goal-one',1,'First revision']]);
  assert.equal(Object.hasOwn(listed.goals[0],'sourceRef'),false);
  assert.equal((await execute('goals.get',{id:'goal-one'})).goal.revision,1);
  const revise=await execute('goals.revise',{expectedGraphRevision:1,expectedGoalRevision:1,
    goal:goal('Second revision')});
  assert.deepEqual(revise,{kind:'applied',graphRevision:2,
    previousGoal:{id:'goal-one',revision:1},currentGoal:{id:'goal-one',revision:2}});
  const stale=await execute('goals.revise',{expectedGraphRevision:1,expectedGoalRevision:1,
    goal:goal('Stale revision')});
  assert.deepEqual(stale,{kind:'conflict',graphRevision:2});
  const exportRead=cloud.competitionToolExports.find(item=>item.toolName==='goals.list');
  assert.deepEqual(exportRead.project({taskId:task.taskId,result:await execute('goals.list',{}),signal}).goals
    .map(item=>item.summary),['Second revision']);
  app.runtime.saveCheckpoint(task.taskId,'competition-tool-catalog',
    {entries:[{name:'goals.list',version:'1.0.0'}]});
  cloud.assertCloudSend({taskId:task.taskId,signal});
  cloud.revoke();
  assert.equal(available('goals.create'),false);
  assert.equal(exportRead.accepts({taskId:task.taskId,arguments:{}}),false);
  assert.throws(()=>cloud.assertCloudSend({taskId:task.taskId,signal}),/revoked/);
  cloud.authorize({goalCloudConsent:true});
  assert.equal(available('goals.create'),false,'old task does not inherit a renewed grant');
  const restarted=createDesktopGoalCloudHost({goalHost});
  restarted.bindApplication(app);
  assert.equal(restarted.snapshot().sessionAllowed,false);
  restarted.authorize({goalCloudConsent:true});
  assert.equal(restarted.competitionToolAvailability[0].available({taskId:task.taskId,signal}),false,
    'old task does not inherit a restarted Desktop grant');
  restarted.close();
  const local=app.submitHostToolTask({commandId:'local-command',toolName:'goals.create',
    toolVersion:'1.0.0',deadline:new Date(Date.now()+600_000).toISOString(),
    arguments:{expectedGraphRevision:2,goal:{...goal('Local UI write'),id:'goal-two',
      sourceRef:'desktop-goal:local-command'}}});
  await until(()=>app.readHostToolTask(local.task.taskId).approval?.state==='pending');
  const approval=app.readHostToolTask(local.task.taskId).approval;
  app.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision);
  await until(()=>app.activeTaskCount===0);
  app.resumeHostToolTask(local.task.taskId);
  await until(()=>app.runtime.getTask(local.task.taskId).state==='succeeded');
  assert.equal(app.runtime.getTask(local.task.taskId).state,'succeeded',
    JSON.stringify(app.runtime.getTask(local.task.taskId)));
  assert.equal(goalHost.get('goal-two').goal.summary,'Local UI write',
    'local Goal host tool does not depend on cloud consent');
});

test('restricted goals, unsafe content and unrelated conversations stay off the cloud',async t=>{
  const file=path.join(mkdtempSync(new URL('run-',cache)),'runtime.sqlite');
  let store;
  const goalHost={tools:createGoalTools(()=>store),list:()=>listGoals(store),get:id=>getGoal(store,id)};
  const cloud=createDesktopGoalCloudHost({goalHost});
  const app=createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',hostUserNamespace:'test-user',tools:cloud.tools});
  t.after(()=>{cloud.close();app.close();});
  store=app.runtime.provisionCoordinationStore('test-user-goals');cloud.bindApplication(app);
  cloud.authorize({goalCloudConsent:true});
  const unrelated=app.runtime.submitTask({goal:'Other',conversationId:'desktop-todo-reminders:test-user',
    idempotencyKey:'unrelated'});
  assert.equal(cloud.competitionToolAvailability[0].available({taskId:unrelated.taskId,signal}),false);
  const task=app.runtime.submitTask({goal:'Goal',conversationId:'desktop-panel',idempotencyKey:'restricted'});
  assert.equal(cloud.competitionToolAvailability[0].available({taskId:task.taskId,signal}),true);
  const exportWrite=cloud.competitionToolExports.find(item=>item.toolName==='goals.create');
  assert.equal(exportWrite.accepts({taskId:task.taskId,arguments:{goal:goal('Secret','restricted')}}),false);
  assert.equal(exportWrite.accepts({taskId:task.taskId,arguments:{goal:goal('C:\\Users\\Alice\\secret')}}),false);
  const context={taskId:task.taskId,runId:'goal-run',signal,scopes:['goals:write','goals:read']};
  await assert.rejects(()=>cloud.tools.find(item=>item.descriptor.name==='goals.create')
    .execute({expectedGraphRevision:0,goal:goal('Secret','restricted')},context),/cloud/);
  store.append(0,{...goal('Private local only','restricted'),kind:'goal',sourceRef:'desktop-local'});
  const read=await cloud.tools.find(item=>item.descriptor.name==='goals.list').execute({},context);
  assert.deepEqual(read.goals,[]);
  const exportRevise=cloud.competitionToolExports.find(item=>item.toolName==='goals.revise');
  assert.equal(exportRevise.accepts({taskId:task.taskId,arguments:{goal:goal('Make public','public')}}),false);
});


test('exact Unicode Goal IDs survive bounded cloud pagination and SQLite reopen', async t => {
  const namespace = 'synthetic-public-goal-paging-reopen';
  const file = path.join(mkdtempSync(new URL('unicode-paging-', cache)), 'runtime.sqlite');
  const ids = ['a\u0301', '\u00e1', 'z'];
  let app, cloud, host;
  const open = phase => {
    host = createGoalHost(namespace);
    cloud = createDesktopGoalCloudHost({goalHost: host, namespace});
    app = createRuntimeApplication({path: file, profile: 'huawei_ict_agentarts', hostUserNamespace: namespace, tools: cloud.tools});
    host.bind(app); cloud.bindApplication(app); cloud.authorize({goalCloudConsent: true});
    const task = app.runtime.submitTask({goal: 'Read synthetic public Goal pages', conversationId: 'desktop-panel',
      idempotencyKey: 'synthetic-unicode-paging-' + phase});
    const context = {taskId: task.taskId, runId: 'synthetic-explicit-fake-tool-gateway',
      authorizationRef: 'synthetic-explicit-fake-tool-gateway', signal,
      deadline: new Date(Date.now() + 60_000).toISOString(), scopes: ['goals:read', 'goals:write']};
    const execute = (name, input) => cloud.tools.find(tool => tool.descriptor.name === name).execute(input, context);
    const available = name => cloud.competitionToolAvailability.find(item => item.toolName === name)
      .available({...context, revision: task.revision});
    assert.equal(available('goals.list'), true);
    return {task, context, execute, available};
  };
  t.after(() => {cloud?.close(); app?.close();});
  const created = open('create');
  assert.equal(created.available('goals.create'), true);
  for (const [index, id] of ids.entries()) {
    const write = await created.execute('goals.create', {expectedGraphRevision: index,
      goal: {...goal('Synthetic distinct exact Goal ' + index, 'public'), id}});
    assert.equal(write.kind, 'applied'); assert.equal(write.currentGoal.id, id);
  }
  const read = async binding => {
    const pages = [], visited = []; let afterId;
    for (let pageIndex = 0; pageIndex < 4; pageIndex++) {
      const page = await binding.execute('goals.list', {limit: 1, ...(afterId === undefined ? {} : {afterId})});
      assert.equal(page.graphRevision, 3); assert.ok(page.goals.length <= 1);
      const exported = cloud.competitionToolExports.find(item => item.toolName === 'goals.list')
        .project({taskId: binding.task.taskId, result: page, signal});
      assert.deepEqual(exported, page); pages.push(page); visited.push(...page.goals.map(item => item.id));
      if (page.nextAfterId === null) break;
      afterId = page.nextAfterId;
    }
    assert.equal(pages.at(-1).nextAfterId, null);
    assert.deepEqual(new Set(visited), new Set(ids), 'Distinct exact IDs cannot collapse because their collation compares equal');
    assert.equal(visited.length, ids.length);
    assert.deepEqual(visited, ['a\u0301', 'z', '\u00e1']);
    const whole = await binding.execute('goals.list', {});
    assert.deepEqual(whole.goals.map(item => item.id), visited);
    for (const id of ids) assert.equal((await binding.execute('goals.get', {id})).goal.id, id);
    return pages;
  };
  const before = await read(created);
  cloud.close(); app.close(); cloud = undefined; app = undefined;
  const reopened = open('reopen');
  assert.deepEqual(await read(reopened), before, 'Existing SQLite Goal IDs reopen without normalization or new graph writes');
  assert.equal(host.list().graphRevision, 3);
  cloud.revoke();
  await assert.rejects(() => reopened.execute('goals.list', {limit: 1}), /unavailable/);
  assert.equal(host.list().graphRevision, 3);
});

const exportGoal={id:'source-goal',kind:'goal',summary:'SYNTHETIC_PREVIOUS_ALLOWED_SUMMARY',sourceRef:'synthetic/direct-seed',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',sensitivity:'public',state:'active',reason:'Synthetic user Goal',dependencies:[]};
for(const toolName of ['goals.get','goals.list'])for(const change of ['none','restricted','withdrawn','revised','unrelated','private','empty'])test(`actual ${toolName} export after credential gap change=${change}`,async t=>{
 const restrict=['restricted','withdrawn','revised'].includes(change);
 const directory=await mkdtemp(path.join(os.tmpdir(),'synthetic-goal-export-'));let store,credentials=0;const queries=[];
 const goalHost={tools:createGoalTools(()=>store),list:()=>listGoals(store),get:id=>getGoal(store,id)};
 const cloud=createDesktopGoalCloudHost({goalHost,namespace:'synthetic-user'});
 const app=createAgentArtsRuntimeApplication({path:path.join(directory,'runtime.sqlite'),gatewayUrl:'https://synthetic-agentarts.invalid',runtimeName:'synthetic',responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',hostUserNamespace:'synthetic-user',tools:cloud.tools,competitionToolAvailability:cloud.competitionToolAvailability,competitionToolExports:cloud.competitionToolExports,
  authorizationProvider:{read:async()=>{credentials++;if(credentials===2&&restrict)store.append(1,{...exportGoal,summary:'SYNTHETIC_NEW_BODY',sensitivity:change==='restricted'?'restricted':'public',state:change==='withdrawn'?'withdrawn':'active'});if(credentials===2&&change==='unrelated')store.append(1,{...exportGoal,id:'unrelated-goal',summary:'Unrelated public Goal'});return 'Bearer synthetic-no-real-credential';}},
  beforeCompetitionSend:request=>cloud.assertCloudSend(request),
  fetchImpl:async(_url,init)=>{const query=JSON.parse(init.body).query;queries.push(query);const result=Object.hasOwn(JSON.parse(query),'goal')?{kind:'tool_proposal',proposalId:`synthetic-read-${queries.length}`,toolName,toolVersion:'1.0.0',arguments:toolName==='goals.get'?{id:exportGoal.id}:{}}:{kind:'text',text:'Synthetic terminal analysis'};return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(result)}},{event:'task_end'},{event:'end'}]),{headers:{'content-type':'application/json'}});}});
 t.after(async()=>{for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,5));cloud.close();app.close();await rm(directory,{recursive:true,force:true});});
 store=app.runtime.provisionCoordinationStore('synthetic-user');if(change!=='empty')store.append(0,{...exportGoal,sensitivity:change==='private'?'private':'public'});cloud.bindApplication(app);cloud.authorize({goalCloudConsent:true});
 const client=new Client(app);await client.connect();const receipt=await client.call('task.submit',{conversationId:'desktop-panel',goal:'Read my permitted Goal'},{idempotencyKey:'synthetic-goal-read'});
 let task;for(let i=0;i<200;i++){task=app.runtime.getTask(receipt.taskId);if(task.state==='waiting_approval'){const approval=(await client.call('approval.list',{taskId:task.taskId})).items[0];await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});}if(['succeeded','failed','waiting_reconciliation','cancelled'].includes(task.state))break;await new Promise(r=>setTimeout(r,5));}
 const oldSummarySent=queries.slice(1).some(q=>q.includes(exportGoal.summary));
 t.diagnostic(JSON.stringify({toolName,restrict,credentials,fetches:queries.length,state:task.state,currentGoalSensitivity:store.read().history.at(-1)?.sensitivity,currentRevision:store.read().revision,oldSummarySent,externalCloud:false}));
 assert.equal(task.state,restrict?'waiting_reconciliation':'succeeded');assert.equal(queries.length,restrict?1:2);assert.equal(oldSummarySent,!restrict&&change!=='empty');
 if(restrict){const receipt=app.runtime.loadCheckpoint(task.taskId,'competition-loop').receipts[0];assert.equal(receipt.continuation.state,'confirmed');assert.throws(()=>cloud.assertCloudSend({taskId:task.taskId,continuation:receipt.continuation,signal:new AbortController().signal}),/no longer exportable/);const binding=cloud.competitionToolExports.find(x=>x.toolName===toolName);assert.throws(()=>binding.project({taskId:task.taskId,result:receipt.continuation.result,signal:new AbortController().signal}),/no longer exportable/);}
 if(change==='restricted')assert.equal(store.read().history.at(-1).sensitivity,'restricted');
 if(restrict){
  const originalReceipt=app.runtime.loadCheckpoint(task.taskId,'competition-loop').receipts[0];
  store.append(2,{...exportGoal,summary:'SYNTHETIC_RESTORED_PUBLIC_SUMMARY'});
  const next=await client.call('task.submit',{conversationId:'desktop-panel',goal:'Read the newly permitted current Goal'},{idempotencyKey:'synthetic-restored-read'});
  for(let i=0;i<400;i++){const current=app.runtime.getTask(next.taskId);if(current.state==='waiting_approval'){const approval=(await client.call('approval.list',{taskId:current.taskId})).items[0];await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});}if(['succeeded','failed','waiting_reconciliation'].includes(current.state))break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(app.runtime.getTask(next.taskId).state,'succeeded');assert.equal(queries.length,3);
  assert.equal(app.runtime.getTask(task.taskId).state,'waiting_reconciliation');
  assert.deepEqual(app.runtime.loadCheckpoint(task.taskId,'competition-loop').receipts[0],originalReceipt);
  assert.equal(app.runtime.readToolExecutions(task.taskId).length,1);
 }

});
