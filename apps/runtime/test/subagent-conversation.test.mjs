import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication,createDesktopSubagentDispatchTool} from '../dist/application.js';

const selected={catalogRevision:'a'.repeat(64),modelId:'original-model',reasoningEffort:'high'};
const terminal=task=>['succeeded','failed','cancelled'].includes(task.state);
async function until(predicate,timeoutMs=5000){const end=Date.now()+timeoutMs;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('State did not arrive');}
function fixture({storage=':memory:',hold,write=false,execute,coordinationInput}={}) {
  let app,currentModel=selected,available=true;const calls=[],queries=[];
  const descriptor={name:'fixture.agent-read',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'},
    sideEffect:write?'external_write':'read',requiredScopes:['fixture:read'],requiresPresence:false,idempotencySupport:true,recoverySupport:true};
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(definition,worker,tools)=>app.runDefaultSubagentWorker(definition,worker,tools)});
  const port=new FakeCoordinationPort(async request=>{
    const task=app.runtime.getTask(request.taskId);
    const compiled=request.goal.startsWith('{')?JSON.parse(request.goal):{publicGoal:request.goal};
    queries.push({request,task,compiled});
    if(hold&&await hold(request,task))return {kind:'text',text:'Held reply',verification:'mock'};
    if(task.conversationId.startsWith('desktop-subagent-conversation:')) {
      assert.deepEqual(request.executionModel,selected);
      if(compiled.publicGoal.includes('use tool')&&!request.continuation)return {kind:'tool_proposal',proposalId:'turn-read',
        toolName:descriptor.name,toolVersion:descriptor.version,arguments:{},verification:'unverified'};
      if(compiled.publicGoal.includes('recurse'))return {kind:'tool_proposal',proposalId:'recursive',toolName:'subagent.dispatch',toolVersion:'1.0.0',
        arguments:{subtasks:[{subtaskId:'illegal',role:'coder',goal:'Should never run'}]},verification:'mock'};
      if(compiled.publicGoal.includes('fail'))throw Error('Authorization: Bearer PRIVATE-ERROR');
      return {kind:'text',text:`Reply for ${compiled.publicGoal}`,verification:'mock'};
    }
    if(task.conversationId.startsWith('desktop-subtask:'))return {kind:'text',text:`Original answer ${task.goal}`,verification:'mock'};
    assert.ok(request.continuation);return {kind:'text',text:'Coordinator summary',verification:'mock'};
  });
  const tools=[dispatch,{descriptor,execute:async(input,context)=>{calls.push(context.taskId);return execute?execute(input,context):{value:'public'};}}];
  app=createRuntimeApplication({path:storage,profile:'huawei_ict_agentarts',delegateUserTasks:true,coordination:port,
    coordinationBinding:'original-fixed-source',readDefaultExecutionModel:()=>selected,resolveExecutionModel:()=>currentModel,
    readConversationPreference:()=>({depth:2,fast:true,executionModel:selected}),
    ...(coordinationInput?{coordinationInput}:{}),tools,
    automaticTools:[{toolName:'subagent.dispatch',toolVersion:'1.0.0'}],
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:'fixture-v1',accepts:()=>true,project:({result})=>result})),
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      publicEnumPaths:['/subtasks/*/role','/subtasks/*/reasoningEffort'],available:()=>available})),
  });
  return {app,port,calls,queries,descriptor,setModel:value=>{currentModel=value;},setAvailable:value=>{available=value;}};
}
async function origin(f,name='origin',timeoutMs=5000) {
  const client=new Client(f.app);await client.connect();
  const parent=await client.call('task.submit',{goal:`Start ${name}`,conversationId:`user-${name}`},{idempotencyKey:name,timeoutMs:60000});
  await until(()=>f.app.activeTaskCount===0,timeoutMs);
  const [child]=f.app.readSubagentTasks(parent.taskId);
  assert.equal(child.state,'succeeded');return {parentTaskId:parent.taskId,taskId:child.taskId};
}
async function settle(app,taskId){await until(()=>app.activeTaskCount===0);return app.runtime.getTask(taskId);}

test('followup messages execute as fresh tasks in a persistent per-agent channel with the original model, role and scope',async()=>{
  const f=fixture();
  try {
    const a=await origin(f,'a'),b=await origin(f,'b');
    const original=f.app.runtime.getTask(a.taskId);
    const {acceptedTaskId:first}=f.app.submitSubagentConversationMessage({...a,text:'first message',requestId:'turn-1'});
    assert.notEqual(first,a.taskId);assert.equal((await settle(f.app,first)).state,'succeeded');
    assert.equal(f.app.runtime.getTask(first).conversationId,`desktop-subagent-conversation:${a.taskId}`);
    assert.deepEqual(f.app.runtime.loadCheckpoint(first,'execution-model'),selected);
    assert.equal(f.app.runtime.loadCheckpoint(first,'competition-max-steps'),4);
    assert.equal(f.app.runtime.loadCheckpoint(first,'subtask-parent'),undefined,'followups are not a second visible agent hierarchy');
    assert.deepEqual(f.app.readSubagentConversationOrigin(first),a);
    assert.deepEqual(f.app.runtime.getTask(a.taskId),original,'the original terminal task must stay closed');
    const query=f.queries.find(item=>item.task.taskId===first);
    assert.match(query.compiled.publicGoal,/任务执行.*first message/);
    assert.deepEqual(query.request.availableTools.map(tool=>tool.name),['fixture.agent-read']);
    assert.ok(query.compiled.conversationContext.messages.some(message=>message.content.includes('Original answer')));
    const {acceptedTaskId:second}=f.app.submitSubagentConversationMessage({...a,text:'second message',requestId:'turn-2'});
    await settle(f.app,second);
    const history=f.queries.find(item=>item.task.taskId===second).compiled.conversationContext.messages;
    assert.ok(history.some(message=>message.taskId===first&&message.role==='assistant'));
    assert.ok(history.every(message=>message.taskId!==b.taskId));
    const snapshot=f.app.readSubagentConversation(a);
    assert.equal(snapshot.canSubmit,true);assert.equal(snapshot.activeTaskId,undefined);
    assert.deepEqual(snapshot.messages.map(message=>message.userText),['first message','second message']);
    assert.match(snapshot.messages[1].replyText,/second message/);
    assert.deepEqual(f.app.readSubagentConversation(b).messages,[]);
    assert.deepEqual(f.app.readSubagentTasks(a.parentTaskId).map(task=>task.taskId),[a.taskId]);
    assert.equal(f.app.readSubagentConversationOrigin(a.taskId),undefined);
    assert.throws(()=>f.app.readSubagentConversationContext({taskId:second,conversationId:`desktop-subagent-conversation:${b.taskId}`,
      deadline:f.app.runtime.loadCheckpoint(second,'application-deadline'),signal:new AbortController().signal}),{code:'SCOPE_DENIED'});
    const {acceptedTaskId:failed}=f.app.submitSubagentConversationMessage({...a,text:'fail this turn',requestId:'failure'});
    assert.equal((await settle(f.app,failed)).state,'failed');
    const failedSnapshot=f.app.readSubagentConversation(a);
    assert.equal(failedSnapshot.messages.at(-1).error.code,'EXTERNAL_FAILURE');
    assert.doesNotMatch(JSON.stringify(failedSnapshot),/PRIVATE-ERROR|Authorization: Bearer/);
  } finally {f.app.close();}
});

test('request identity is idempotent and cannot change its text, scope or deadline',async()=>{
  const f=fixture();
  try {
    const scope=await origin(f);
    const input={...scope,text:'same message',requestId:'stable',deadline:new Date(Date.now()+60000).toISOString()};
    const first=f.app.submitSubagentConversationMessage(input);
    assert.deepEqual(f.app.submitSubagentConversationMessage(input),first);await settle(f.app,first.acceptedTaskId);
    assert.deepEqual(f.app.submitSubagentConversationMessage(input),first);
    assert.equal(f.app.readSubagentConversation(scope).messages.length,1);
    assert.throws(()=>f.app.submitSubagentConversationMessage({...input,text:'replacement'}),{code:'REVISION_CONFLICT'});
    assert.throws(()=>f.app.submitSubagentConversationMessage({...input,deadline:new Date(Date.now()+120000).toISOString()}),{code:'REVISION_CONFLICT'});
    assert.throws(()=>f.app.submitSubagentConversationMessage({...input,goal:'injected'}),{code:'INVALID_ARGUMENT'});
    assert.throws(()=>f.app.submitSubagentConversationMessage({...scope,text:'',requestId:'blank'}),{code:'INVALID_ARGUMENT'});
    assert.throws(()=>f.app.submitSubagentConversationMessage({...scope,text:'late',requestId:'late',deadline:'2000-01-01T00:00:00.000Z'}),{code:'INVALID_ARGUMENT'});
  } finally {f.app.close();}
});

test('each message gets fresh Policy approval, persists over restart, and cannot inherit a consumed grant',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'pa-agent-conversation-'));let f=fixture({storage:path.join(directory,'runtime.sqlite')});
  try {
    const scope=await origin(f,'origin',15000);
    const {acceptedTaskId}=f.app.submitSubagentConversationMessage({...scope,text:'use tool once',requestId:'read-one'});
    assert.equal((await settle(f.app,acceptedTaskId)).state,'waiting_approval');assert.equal(f.calls.length,0);
    const approval=f.app.runtime.getApproval(`competition-tool-${acceptedTaskId}-1`);
    assert.equal(f.app.readSubagentConversation(scope).activeTaskId,acceptedTaskId);
    assert.equal(f.app.readSubagentConversation(scope).canSubmit,false);
    f.app.close();f=fixture({storage:path.join(directory,'runtime.sqlite')});
    assert.equal(f.app.readSubagentConversation(scope).messages[0].state,'waiting_approval');
    const client=new Client(f.app);await client.connect();
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    assert.equal((await settle(f.app,acceptedTaskId)).state,'succeeded');assert.deepEqual(f.calls,[acceptedTaskId]);
    const {acceptedTaskId:next}=f.app.submitSubagentConversationMessage({...scope,text:'use tool twice',requestId:'read-two'});
    assert.equal((await settle(f.app,next)).state,'waiting_approval');
    assert.notEqual(next,acceptedTaskId);assert.deepEqual(f.calls,[acceptedTaskId]);
    assert.equal(f.app.runtime.getApproval(`competition-tool-${next}-1`).state,'pending');
    assert.equal(f.app.runtime.policy.get(`competition-tool-${next}-1`),undefined);
  } finally {f.app.close();await rm(directory,{recursive:true,force:true});}
});

test('same-agent active sends are serialized and cancel cannot target another independent agent',async()=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;});
  const f=fixture({hold:async(request,task)=>{
    if(task.conversationId.startsWith('desktop-subagent-conversation:')&&request.goal.includes('hold')) {
      entered();await new Promise(resolve=>{release=resolve;});return true;
    }
    return false;
  }});
  try {
    const a=await origin(f,'a'),b=await origin(f,'b');
    const first=f.app.submitSubagentConversationMessage({...a,text:'hold current task',requestId:'hold'});await started;
    assert.throws(()=>f.app.submitSubagentConversationMessage({...a,text:'competing task',requestId:'competing'}),{code:'REVISION_CONFLICT'});
    const other=f.app.submitSubagentConversationMessage({...b,text:'use tool in B',requestId:'b-read'});
    await until(()=>f.app.runtime.getTask(other.acceptedTaskId).state==='waiting_approval');
    assert.throws(()=>f.app.cancelSubagentConversationTask({...a,executionTaskId:other.acceptedTaskId}));
    assert.equal(f.app.runtime.getTask(other.acceptedTaskId).cancelRequested,undefined);
    const ack=f.app.cancelSubagentConversationTask({...a,executionTaskId:first.acceptedTaskId});
    assert.equal(ack.cancelAccepted,true);release();await settle(f.app,first.acceptedTaskId);
    assert.equal(f.app.runtime.getTask(first.acceptedTaskId).state,'cancelled');
    assert.equal(f.app.readSubagentConversation(a).canSubmit,true);
    assert.throws(()=>f.app.readSubagentConversation({parentTaskId:a.parentTaskId,taskId:b.taskId}),{code:'SCOPE_DENIED'});
  } finally {release?.();await until(()=>f.app.activeTaskCount===0);f.app.close();}
});

test('an active original child is the exact stop target and blocks followup sends until it finishes',async()=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;});
  const f=fixture({hold:async(_request,task)=>{
    if(task.conversationId.startsWith('desktop-subtask:')) {entered();await new Promise(resolve=>{release=resolve;});return true;}
    return false;
  }});
  try {
    const client=new Client(f.app);await client.connect();
    const parent=await client.call('task.submit',{goal:'Hold original child',conversationId:'original'},
      {idempotencyKey:'original',timeoutMs:60000});await started;
    const [child]=f.app.readSubagentTasks(parent.taskId),scope={parentTaskId:parent.taskId,taskId:child.taskId};
    assert.equal(f.app.readSubagentConversation(scope).activeTaskId,child.taskId);
    assert.throws(()=>f.app.submitSubagentConversationMessage({...scope,text:'too soon',requestId:'early'}),{code:'REVISION_CONFLICT'});
    assert.equal(f.app.cancelSubagentConversationTask({...scope,executionTaskId:child.taskId}).cancelAccepted,true);
    release();await until(()=>f.app.activeTaskCount===0);
    assert.equal(f.app.runtime.getTask(child.taskId).state,'cancelled');
    assert.equal(f.app.readSubagentConversation(scope).canSubmit,true);
  } finally {release?.();await until(()=>f.app.activeTaskCount===0);f.app.close();}
});

test('old parent deadlines do not govern a newly authorized turn, while model and tool drift reject new execution',async()=>{
  const f=fixture();
  try {
    const scope=await origin(f),source=f.app.runtime.loadCheckpoint(scope.taskId,'subtask-parent');
    f.app.runtime.saveCheckpoint(scope.taskId,'subtask-parent',{...source,parentDeadline:'2000-01-01T00:00:00.000Z'});
    f.app.runtime.saveCheckpoint(scope.taskId,'application-deadline','2000-01-01T00:00:00.000Z');
    const {acceptedTaskId}=f.app.submitSubagentConversationMessage({...scope,text:'fresh deadline',requestId:'new-deadline'});
    assert.equal((await settle(f.app,acceptedTaskId)).state,'succeeded');
    f.setModel({...selected,catalogRevision:'b'.repeat(64)});
    assert.equal(f.app.readSubagentConversation(scope).messages.length,1,'history remains readable after configuration drift');
    assert.equal(f.app.readSubagentConversation(scope).canSubmit,false);
    assert.match(f.app.readSubagentConversation(scope).submitUnavailableReason,/原模型、部署或工具绑定不可用或已变化/);
    assert.throws(()=>f.app.submitSubagentConversationMessage({...scope,text:'different catalog',requestId:'drift'}),{code:'REVISION_CONFLICT'});
    f.setModel(selected);f.descriptor.inputSchema.required=['changed'];
    assert.equal(f.app.readSubagentConversation(scope).messages.length,1);
    assert.throws(()=>f.app.submitSubagentConversationMessage({...scope,text:'different tools',requestId:'tool-drift'}),{code:'REVISION_CONFLICT'});
  } finally {f.app.close();}
});

test('current availability is rechecked and recursive dispatch remains outside the preserved tool scope',async()=>{
  const f=fixture();
  try {
    const scope=await origin(f),before=f.queries.length;
    f.setAvailable(false);
    const blocked=f.app.submitSubagentConversationMessage({...scope,text:'not available',requestId:'unavailable'});
    assert.equal((await settle(f.app,blocked.acceptedTaskId)).state,'failed');assert.equal(f.queries.length,before);
    f.setAvailable(true);
    const recursion=f.app.submitSubagentConversationMessage({...scope,text:'recurse',requestId:'recursion'});
    assert.equal((await settle(f.app,recursion.acceptedTaskId)).state,'failed');
    assert.deepEqual(f.app.readSubagentTasks(recursion.acceptedTaskId),[]);assert.equal(f.calls.length,0);
  } finally {f.app.close();}
});

test('private and Skill-derived seed history is withheld and old bindings are never copied into a fresh task',async t=>{
  for(const marker of ['private-memory:consumption:v1','private-derived-output','application-reference-skill-v1','skill:cloud-selection:v1']) {
    await t.test(marker,async()=>{
      const f=fixture();
      try {
        const scope=await origin(f);f.app.runtime.saveCheckpoint(scope.taskId,marker,{private:'PRIVATE-ORIGINAL'});
        const {acceptedTaskId}=f.app.submitSubagentConversationMessage({...scope,text:'fresh public request',requestId:'public'});
        assert.equal((await settle(f.app,acceptedTaskId)).state,'succeeded');
        const sent=f.queries.find(item=>item.task.taskId===acceptedTaskId);
        assert.equal(sent.compiled.conversationContext,undefined);assert.equal(f.app.runtime.loadCheckpoint(acceptedTaskId,marker),undefined);
        assert.doesNotMatch(JSON.stringify(sent.request),/PRIVATE-ORIGINAL|Original answer/);
      } finally {f.app.close();}
    });
  }
});

test('native host egress rechecks the persisted original identity and denies old Skill permissions',async()=>{
  let app,deny=false;const f=fixture({coordinationInput:{beforeCoordinationSend:request=>{
    const original=app.readSubagentConversationOrigin(request.taskId);
    if(original&&deny)throw Error('Original native Skill permission cannot transfer');
  }}});app=f.app;
  try {
    const scope=await origin(f);deny=true;
    const before=f.queries.length,{acceptedTaskId}=app.submitSubagentConversationMessage({...scope,text:'new task',requestId:'skill-block'});
    assert.equal((await settle(app,acceptedTaskId)).state,'failed');assert.equal(f.queries.length,before);
    assert.deepEqual(app.readSubagentConversationOrigin(acceptedTaskId),scope);
    assert.doesNotMatch(JSON.stringify(app.readSubagentConversation(scope)),/Original native Skill/);
  } finally {app.close();}
});

test('unknown writes remain unresolved, reject further messages and never repeat for an idempotent request',async()=>{
  const f=fixture({write:true,execute:()=>{throw Error('unknown external write');}});
  try {
    const scope=await origin(f),input={...scope,text:'use tool for write',requestId:'write'};
    const {acceptedTaskId}=f.app.submitSubagentConversationMessage(input);await settle(f.app,acceptedTaskId);
    const approval=f.app.runtime.getApproval(`competition-tool-${acceptedTaskId}-1`),client=new Client(f.app);await client.connect();
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    assert.equal((await settle(f.app,acceptedTaskId)).state,'waiting_reconciliation');assert.deepEqual(f.calls,[acceptedTaskId]);
    assert.deepEqual(f.app.submitSubagentConversationMessage(input),{acceptedTaskId});
    assert.throws(()=>f.app.submitSubagentConversationMessage({...scope,text:'another write',requestId:'new-write'}),{code:'REVISION_CONFLICT'});
    const ack=f.app.cancelSubagentConversationTask({...scope,executionTaskId:acceptedTaskId});
    assert.equal(ack.state,'waiting_reconciliation');assert.equal(f.app.readSubagentConversation(scope).canSubmit,false);
    assert.deepEqual(f.calls,[acceptedTaskId]);
  } finally {f.app.close();}
});

test('all original children remain paginated beyond 100 while followup tasks are not listed as new agents',async()=>{
  const f=fixture();
  try {
    const scope=await origin(f);
    const originalIds=[scope.taskId];
    for(let index=0;index<104;index++) {
      const subtaskId='historic-'+index,definition={subtaskId,role:'coder',roleLabel:'代码执行',goal:'Historic child '+index};
      const task=f.app.runtime.submitTaskWithCheckpoint({goal:'[代码执行] '+definition.goal,
        conversationId:`desktop-subtask:${scope.parentTaskId}`,idempotencyKey:`subagent-dispatch-${scope.parentTaskId}-${subtaskId}`},
      'subtask-parent',{...definition,parentTaskId:scope.parentTaskId,parentDeadline:'2000-01-01T00:00:00.000Z'});
      originalIds.push(task.taskId);
    }
    assert.equal(f.app.readSubagentTasks(scope.parentTaskId).length,105);
    assert.ok(f.app.readSubagentTasks(scope.parentTaskId).some(item=>item.taskId===scope.taskId),'oldest child beyond the first Runtime page remains resolvable');
    const {acceptedTaskId}=f.app.submitSubagentConversationMessage({...scope,text:'listed in the same original agent',requestId:'followup'});
    await settle(f.app,acceptedTaskId);
    assert.equal(f.app.listSubagentConversations({limit:6}).items[0].taskId,scope.taskId,'a new execution promotes its original logical agent into the recent entries');
    const all=[];let cursor;
    do {
      const page=f.app.listSubagentConversations({limit:13,...(cursor?{cursor}:{})});
      assert.ok(page.items.length<=13);all.push(...page.items);cursor=page.nextCursor;
    } while(cursor);
    assert.equal(all.length,105);assert.equal(new Set(all.map(item=>item.taskId)).size,105);
    assert.deepEqual([...all.map(item=>item.taskId)].sort(),originalIds.sort());
    assert.ok(!all.some(item=>item.taskId===acceptedTaskId));
    const updated=all.find(item=>item.taskId===scope.taskId);
    assert.equal(updated.updatedAt,f.app.runtime.getTask(acceptedTaskId).updatedAt);
    assert.equal(f.app.runtime.listTasks({conversationId:`desktop-subagent-conversation:${scope.taskId}`,limit:100}).items.length,1);
    assert.throws(()=>f.app.listSubagentConversations({cursor:'not-a-cursor'}),{code:'INVALID_ARGUMENT'});
    assert.throws(()=>f.app.listSubagentConversations({limit:101}),{code:'INVALID_ARGUMENT'});
  } finally {f.app.close();}
});

test('immediate cancellation of an accepted but unstarted followup leaves a closed task and performs no model request',async()=>{
  const f=fixture();
  try {
    const scope=await origin(f),before=f.queries.length;
    const {acceptedTaskId}=f.app.submitSubagentConversationMessage({...scope,text:'stop immediately',requestId:'immediate'});
    assert.equal(f.app.cancelSubagentConversationTask({...scope,executionTaskId:acceptedTaskId}).cancelAccepted,true);
    await settle(f.app,acceptedTaskId);
    assert.equal(f.app.runtime.getTask(acceptedTaskId).state,'cancelled');assert.equal(f.queries.length,before);
    assert.equal(f.app.readSubagentConversation(scope).canSubmit,true);
  } finally {f.app.close();}
});

test('visible parents select their original children before the global limit and bind subsequent cursors',async()=>{
  const f=fixture();
  try {
    const visible=[await origin(f,'visible-a'),await origin(f,'visible-b'),await origin(f,'visible-c')];
    const parentTaskIds=visible.map(item=>item.parentTaskId),ids=new Set(visible.map(item=>item.taskId));
    for(let index=0;index<105;index++)await origin(f,`unrelated-${index}`);
    const global=f.app.listSubagentConversations({limit:100});
    assert.equal(global.items.length,100);assert.ok(global.nextCursor);assert.ok(global.items.every(item=>!ids.has(item.taskId)));
    const {acceptedTaskId}=f.app.submitSubagentConversationMessage({...visible[0],text:'Current visible followup',requestId:'visible-followup'});
    const latest=await settle(f.app,acceptedTaskId);assert.equal(latest.state,'succeeded');
    let page=f.app.listSubagentConversations({parentTaskIds,limit:1});
    assert.equal(page.items[0].taskId,visible[0].taskId);assert.equal(page.items[0].updatedAt,latest.updatedAt);
    assert.ok(page.nextCursor);
    const originalCursor=page.nextCursor,seen=new Set();
    do {
      assert.ok(page.items.length<=1);
      for(const item of page.items){assert.ok(ids.has(item.taskId));assert.equal(seen.has(item.taskId),false);seen.add(item.taskId);}
      if(!page.nextCursor)break;
      page=f.app.listSubagentConversations({parentTaskIds:[...parentTaskIds].reverse(),limit:1,cursor:page.nextCursor});
    }while(true);
    assert.deepEqual(seen,ids);
    assert.throws(()=>f.app.listSubagentConversations({parentTaskIds:[parentTaskIds[0]],limit:1,cursor:originalCursor}),{code:'INVALID_ARGUMENT'});
    assert.throws(()=>f.app.listSubagentConversations({parentTaskIds,limit:1,cursor:global.nextCursor}),{code:'INVALID_ARGUMENT'});
    assert.throws(()=>f.app.listSubagentConversations({limit:1,cursor:originalCursor}),{code:'INVALID_ARGUMENT'});
    assert.deepEqual(f.app.listSubagentConversations({parentTaskIds:[],limit:1}),{items:[]});
    assert.throws(()=>f.app.listSubagentConversations({parentTaskIds:[parentTaskIds[0],parentTaskIds[0]]}),{code:'INVALID_ARGUMENT'});
  }finally{f.app.close();}
});
