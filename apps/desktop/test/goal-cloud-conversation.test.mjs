import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication,createRuntimeSubagentDispatchTool,createRuntimeApplication} from '@personal-agent/runtime/application';
import {createGoalHost} from '../electron/goal-host.js';
import {createDesktopGoalCloudHost} from '../electron/goal-cloud-host.js';

for(const surface of ['panel','workspace'])test(`Synthetic ${surface} new conversation Goal catalog -> Policy -> SQLite -> model continuation`,async()=>{
  const conversationId=`desktop-${surface}:11111111-1111-4111-8111-111111111111`;
  let registered=true,app;const requests=[];const delegated=surface==='panel';
  const host=createGoalHost('synthetic-core');
  const cloud=createDesktopGoalCloudHost({goalHost:host,namespace:'synthetic-core',
    isConversationAllowed:(id,taskId)=>registered&&(id===conversationId
      || app?.readDelegatedUserTaskParent(taskId)?.conversationId===conversationId)});
  const goal={id:'synthetic-pelican',summary:'Create a public pelican diagram',validFrom:'2026-01-01T00:00:00.000Z',
    validUntil:'2099-01-01T00:00:00.000Z',sensitivity:'public',state:'active',reason:'Synthetic user instruction',dependencies:[]};
  const proposals=[{toolName:'goals.create',arguments:{expectedGraphRevision:0,goal}},
    {toolName:'goals.revise',arguments:{expectedGraphRevision:1,expectedGoalRevision:1,goal:{...goal,summary:'Create a revised public pelican diagram'}}},
    {toolName:'goals.get',arguments:{id:goal.id}}];
  const dispatch=createRuntimeSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,
    getTools:()=>app.tools,runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const dispatchAvailability={toolName:'subagent.dispatch',toolVersion:'1.0.0',available:()=>true,
    publicEnumPaths:['/subtasks/*/role','/subtasks/*/reasoningEffort']};
  const dispatchExport={toolName:'subagent.dispatch',toolVersion:'1.0.0',exportPolicyVersion:'synthetic-public-summary',
    accepts:()=>true,project:({result})=>({total:result.total,summary:result.summary})};
  app=createAgentArtsRuntimeApplication({path:':memory:',hostUserNamespace:'synthetic-core',
    gatewayUrl:'https://synthetic-agentarts.invalid',runtimeName:'synthetic-no-cloud',
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',competitionMaxSteps:8,
    ...(delegated?{delegateUserTasks:true}:{}),
    tools:[...cloud.tools,...(delegated?[dispatch]:[])],
    competitionToolAvailability:[...cloud.competitionToolAvailability,...(delegated?[dispatchAvailability]:[])],
    competitionToolExports:[...cloud.competitionToolExports,...(delegated?[dispatchExport]:[])],
    authorizationProvider:{read:async()=>'Bearer synthetic-never-sent'},
    beforeCompetitionSend:request=>cloud.assertCloudSend(request),
    fetchImpl:async(_url,init)=>{
      const query=JSON.parse(JSON.parse(init.body).query);requests.push(query);
      const proposal=proposals[requests.length-1];
      const result=proposal?{kind:'tool_proposal',proposalId:'synthetic-goal-'+requests.length,
        toolVersion:'1.0.0',...proposal}:{kind:'text',text:'Synthetic public Goal persisted and read back'};
      return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(result)}},{event:'task_end'},{event:'end'}]),
        {headers:{'content-type':'application/json'}});
    }});
  host.bind(app);cloud.bindApplication(app);cloud.authorize({goalCloudConsent:true});
  try {
    const client=new Client(app);await client.connect();
    const {taskId}=await client.call('task.submit',{conversationId,goal:'Create, revise and inspect this synthetic public pelican Goal'},
      {idempotencyKey:'synthetic-core-'+surface});
    const approved=new Set();let state;
    for(let i=0;i<500;i++) {
      state=app.runtime.getTask(taskId);
      for(const approval of (await client.call('approval.list',{})).items)if(approval.state==='pending'&&!approved.has(approval.approvalId)) {
        approved.add(approval.approvalId);
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      }
      if(['succeeded','failed','waiting_reconciliation'].includes(state.state))break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(state.state,'succeeded',JSON.stringify(state.error));
    assert.equal(approved.size,delegated?4:3,'dispatch, writes and read use original one-time Policy approvals');
    assert.deepEqual(requests[0].availableTools.map(item=>item.name).sort(),['goals.create','goals.get','goals.list','goals.revise']);
    const schema=requests[0].availableTools.find(item=>item.name==='goals.create').inputSchema;
    assert.deepEqual(schema.properties.goal.properties.state.enum,['active','withdrawn']);
    assert.ok(schema.properties.goal.properties.sensitivity.enum.includes('public'));
    assert.equal(requests[1].continuation.result.currentGoal.revision,1);
    assert.equal(requests[2].continuation.result.currentGoal.revision,2);
    assert.equal(requests[3].continuation.result.goal.summary,'Create a revised public pelican diagram');
    assert.equal(requests[3].continuation.result.goal.sourceRef,undefined);
    assert.equal(host.get(goal.id).goal.revision,2);
    const toolTaskId=delegated?app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${taskId}-user-work`).taskId:taskId;
    assert.equal(app.runtime.readToolExecutions(toolTaskId).filter(item=>item.state==='confirmed').length,3);
    registered=false;
    assert.equal(cloud.competitionToolAvailability[0].available({taskId,signal:new AbortController().signal}),false);
  }finally{cloud.close();app.close();}
});

test('Synthetic UTF8 Goal pages fit the cloud result budget without losing exact IDs or cursor progress',async()=>{
  const host=createGoalHost('synthetic-goal-budget'),cloud=createDesktopGoalCloudHost({goalHost:host});
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-goal-budget',tools:cloud.tools});
  host.bind(app);cloud.bindApplication(app);cloud.authorize({goalCloudConsent:true});
  try {
    const store=app.runtime.provisionCoordinationStore('synthetic-goal-budget');
    const ids=Array.from({length:7},(_,index)=>'synthetic-goal-'+index);
    for(const id of ids)store.append(store.read().revision,{id,kind:'goal',summary:'鹈'.repeat(512),reason:'鹕'.repeat(512),
      sourceRef:'synthetic:public-goal',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',
      sensitivity:'public',state:'active',dependencies:[]});
    const source=app.runtime.submitTask({goal:'List synthetic public Goals',conversationId:'desktop-panel',idempotencyKey:'budget-source'});
    const signal=new AbortController().signal,context={taskId:source.taskId,runId:'synthetic-direct-read',signal,scopes:['goals:read']};
    const tool=cloud.tools.find(tool=>tool.descriptor.name==='goals.list'),projection=cloud.competitionToolExports.find(tool=>tool.toolName==='goals.list');
    assert.equal(cloud.competitionToolAvailability.find(item=>item.toolName==='goals.list').available(context),true);
    const seen=[];let afterId;
    for(let index=0;index<ids.length;index++) {
      const page=await tool.execute(afterId===undefined?{}:{afterId},context);
      assert.ok(Buffer.byteLength(JSON.stringify(page),'utf8')<=7500);
      assert.ok(page.goals.length>0&&page.goals.length<ids.length);
      assert.deepEqual(projection.project({taskId:source.taskId,result:page,signal}),page);
      seen.push(...page.goals.map(goal=>goal.id));
      if(page.nextAfterId===null)break;
      assert.equal(page.nextAfterId,page.goals.at(-1).id);
      assert.notEqual(page.nextAfterId,afterId);afterId=page.nextAfterId;
    }
    assert.deepEqual(seen,ids);
    const oversizedId='z'.repeat(8000);
    const {revision:_revision,graphRevision:_graphRevision,...seed}=store.read().history[0];
    store.append(store.read().revision,{...seed,id:oversizedId,summary:'Synthetic oversized exact ID',reason:'Boundary fixture'});
    await assert.rejects(tool.execute({afterId:ids.at(-1)},context),/One Goal exceeds.*inspect this Goal locally/);
    assert.equal(store.read().history.at(-1).id,oversizedId,'oversized identities are never truncated or silently skipped');
  }finally{cloud.close();app.close();}
});
