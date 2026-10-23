import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication,createRuntimeApplication,compileCoordinationGoal} from '../dist/application.js';
import {COMPETITION_CONTEXT_CHECKPOINT as KEY,bindCompiledContext,assertCompiledContextUnchanged} from '../dist/application/context-binding.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const scope=()=>({deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal});
async function waitFor(app,id,states=['succeeded','failed','cancelled']) {
  const until=Date.now()+5_000;
  while(Date.now()<until) {
    const task=app.runtime.getTask(id);
    if(states.includes(task.state))return task;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Synthetic context task did not settle: '+JSON.stringify(app.runtime.getTask(id)));
}
async function directory(t) {
  const root=new URL('../../../.cache/versioned-context/',import.meta.url);
  await mkdir(root,{recursive:true});
  const path=await mkdtemp(new URL('case-',root));
  t.after(()=>rm(path,{recursive:true,force:true}));
  return path+'/runtime.sqlite';
}

test('compiled context stores only detached version metadata and enforces final serialized character boundary',()=>{
  const messages=[{id:'private-message-canary',role:'user',content:'Private body canary'}];
  const input={taskId:'synthetic-task',conversationId:'synthetic',configurationRef:'fixture:v1',
    ...scope(),publicGoal:'public',preparedGoal:'private body',messages,
    compiledGoal:compileCoordinationGoal('public','private body',messages)};
  const snapshot=bindCompiledContext(input);
  assert.doesNotMatch(JSON.stringify(snapshot),/private-message-canary|Private body canary|private body/);
  assert.equal(snapshot.version,1);
  assert.deepEqual(snapshot.budget.tokens,{state:'unmeasured'});
  assert.equal(snapshot.budget.characters,input.compiledGoal.length);
  messages[0].content='Changed body';
  assert.throws(()=>assertCompiledContextUnchanged(snapshot,bindCompiledContext(input)),{code:'REVISION_CONFLICT'});
  assert.equal(compileCoordinationGoal('a','x'.repeat(128_000),[]).length,128_000);
  assert.throws(()=>compileCoordinationGoal('a','x'.repeat(128_001),[]),{code:'INVALID_ARGUMENT'});
  const escaped=[{id:'escaped',role:'user',content:'"\\'.repeat(32000)}];
  assert.throws(()=>compileCoordinationGoal('a','a',escaped),{code:'INVALID_ARGUMENT'});
});

test('trusted goal meter counts the final wrapper and reserves output; unavailable or invalid counts never become estimates',async t=>{
  for(const [name,count,allowed] of [['boundary',85,true],['overflow',86,false],['negative',-1,false],
    ['fractional',1.5,false],['async',Promise.resolve(1),false],['missing',undefined,false]]) {
    await t.test(name,async()=>{
      let credentials=0,sends=0,measured;
      const app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'fixture',
        authorizationProvider:{read:async()=>{credentials++;return 'Bearer synthetic';}},
        fetchImpl:async(_url,init)=>{sends++;assert.equal(JSON.parse(init.body).query,measured);
          return new Response(JSON.stringify({event:'message',data:{text:'synthetic answer',index:0}}),
            {headers:{'content-type':'application/json'}});},
        coordinationInput:{beforeCoordinationSend(){},readConversationContext:async()=>[
          {id:'unicode',role:'user',content:'中文😀"\\'}],goalTokenBudget:{tokenizerRef:'fixture:exact-v1',
          contextTokens:100,reservedOutputTokens:15,countTokens:goal=>{measured=goal;return count;}}}});
      try {
        const client=new Client(app);await client.connect();
        const {taskId}=await client.call('task.submit',{goal:'public',conversationId:'meter'},{idempotencyKey:name});
        assert.equal((await waitFor(app,taskId)).state,allowed?'succeeded':'failed');
        assert.equal(credentials,allowed?1:0);assert.equal(sends,allowed?1:0);
        assert.ok(measured.includes('conversationContext'));
        if(allowed)assert.deepEqual(app.runtime.loadCheckpoint(taskId,KEY).budget.tokens,
          {state:'measured',tokenizerRef:'fixture:exact-v1',inputTokens:85,contextTokens:100,reservedOutputTokens:15});
        else assert.equal(app.runtime.loadCheckpoint(taskId,KEY),undefined);
      } finally {app.close();}
    });
  }
});

test('credential await cannot change the meter version, reservation, measurement or stored context',async t=>{
  for(const change of ['tokenizer','reserve','count','checkpoint'])await t.test(change,async()=>{
    let count=5,sends=0,app;
    const budget={tokenizerRef:'fixture:v1',contextTokens:100,reservedOutputTokens:10,countTokens:()=>count};
    app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'fixture',
      authorizationProvider:{read:async()=>{
        if(change==='tokenizer')budget.tokenizerRef='fixture:v2';
        if(change==='reserve')budget.reservedOutputTokens=20;
        if(change==='count')count=6;
        if(change==='checkpoint')app.runtime.saveCheckpoint(id,KEY,{version:2});
        return 'Bearer synthetic';}},
      fetchImpl:async()=>{sends++;throw Error('Changed context must not reach HTTP');},
      coordinationInput:{beforeCoordinationSend(){},goalTokenBudget:budget}});
    let id;
    try {
      const client=new Client(app);await client.connect();
      ({taskId:id}=await client.call('task.submit',{goal:'public',conversationId:'mutation'},{idempotencyKey:change}));
      assert.equal((await waitFor(app,id)).state,'failed');assert.equal(sends,0);
    } finally {app.close();}
  });
});

const descriptor={name:'fixture.read',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},
  outputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},
  sideEffect:'read',requiredScopes:['fixture:read'],idempotencySupport:true,recoverySupport:true,requiresPresence:false};

test('SQLite approval recovery preserves the same context, refuses changed revisions and retains the confirmed tool receipt',async t=>{
  for(const change of ['same version','changed version','missing hooks','legacy without hooks'])await t.test(change,async t=>{
    const path=await directory(t);let calls=0,executions=0;
    const messages=[{id:'fact-source',role:'assistant',content:'synthetic revision 1'}];
    const options={path,profile:'huawei_ict_agentarts',coordinationBinding:'fixture-config-v1',
      tools:[{descriptor,execute:async()=>{executions++;return {value:'synthetic receipt'};}}],
      competitionToolExports:[{toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'fixture-v1',
        accepts:()=>true,project:({result})=>result}],
      competitionToolAvailability:[{toolName:descriptor.name,toolVersion:descriptor.version,available:()=>true}],
      ...(change==='legacy without hooks'?{}:{coordinationInput:{beforeCoordinationSend(){},readConversationContext:async()=>messages}}),
      coordination:{execute:async()=>++calls===1?{kind:'tool_proposal',proposalId:'fixture-proposal',
        toolName:descriptor.name,toolVersion:descriptor.version,arguments:{},verification:'unverified'}:
        {kind:'text',text:'synthetic answer',verification:'unverified'}}};
    let app=createRuntimeApplication(options);
    try {
      let client=new Client(app);await client.connect();
      const {taskId}=await client.call('task.submit',{goal:'public',conversationId:'restart'},
        {idempotencyKey:'restart',timeoutMs:60_000});
      await waitFor(app,taskId,['waiting_approval']);
      const original=app.runtime.loadCheckpoint(taskId,KEY);
      app.close();if(change==='changed version')messages[0].content='synthetic revision 2';
      const recoveredOptions={...options};if(change==='missing hooks')delete recoveredOptions.coordinationInput;
      app=createRuntimeApplication(recoveredOptions);client=new Client(app);await client.connect();
      assert.deepEqual(app.runtime.loadCheckpoint(taskId,KEY),original);
      const approval=(await client.call('approval.list',{taskId})).items.find(item=>item.state==='pending');
      await client.call('authorization.respond',{approvalId:approval.approvalId,
        expectedRevision:approval.revision,decision:'allow_once'});
      const blocked=['changed version','missing hooks'].includes(change);
      assert.equal((await waitFor(app,taskId,['succeeded','failed','waiting_reconciliation'])).state,
        blocked?'waiting_reconciliation':'succeeded');
      assert.equal(calls,blocked?1:2);assert.equal(executions,1);
      assert.equal(app.runtime.readToolExecutions(taskId)[0].state,'confirmed');
      assert.deepEqual(app.runtime.loadCheckpoint(taskId,KEY),original);
    } finally {app.close();}
  });
});

test('final export guard rejects existing context checkpoints without hooks, including redacted and malformed metadata',async t=>{
  for(const mode of ['versioned','redacted','null'])await t.test(mode,async()=>{
    let app,guardError,sends=0;
    app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',coordination:{execute:async request=>{
      const checkpoint=mode==='versioned'?bindCompiledContext({taskId:request.taskId,conversationId:'final-guard',
        configurationRef:app.coordinationConfigurationRef,deadline:request.deadline,publicGoal:request.goal,
        preparedGoal:request.goal,compiledGoal:request.goal,messages:[]}):mode==='redacted'?{redacted:true}:null;
      app.runtime.saveCheckpoint(request.taskId,KEY,checkpoint);
      try {app.assertCompetitionExportAllowed(request);}catch(error){guardError=error;throw error;}
      sends++;return {kind:'text',text:'synthetic answer',verification:'unverified'};
    }}});
    try {
      const client=new Client(app);await client.connect();
      const {taskId}=await client.call('task.submit',{goal:'public',conversationId:'final-guard'},{idempotencyKey:mode});
      const result=await waitFor(app,taskId);
      assert.equal(result.state,'failed');assert.equal(guardError?.code,'UNAUTHORIZED');
      assert.equal(result.error.code,'EXTERNAL_FAILURE');assert.equal(sends,0);
    } finally {app.close();}
  });
});

test('history withheld during credential read blocks its old context before HTTP',async t=>{
  let sends=0,earlier,app;
  app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'fixture',
    authorizationProvider:{read:async()=>{app.runtime.saveCheckpoint(earlier,'private-derived-output',{withheld:true});
      return 'Bearer synthetic';}},fetchImpl:async()=>{sends++;throw Error('Withheld history must not reach HTTP');},
    coordinationInput:{beforeCoordinationSend(){},readConversationContext:async()=>[
      {id:'old',taskId:earlier,role:'assistant',content:'synthetic old context'}]}});
  t.after(()=>app.close());
  earlier=app.runtime.submitTask({goal:'public earlier',conversationId:'withheld',idempotencyKey:'earlier'}).taskId;
  const client=new Client(app);await client.connect();
  const {taskId}=await client.call('task.submit',{goal:'public',conversationId:'withheld'},{idempotencyKey:'current'});
  assert.equal((await waitFor(app,taskId)).state,'failed');assert.equal(sends,0);
});

test('per-fact erasure redacts new context checkpoints and derived children across restart, retaining unrelated tasks',async t=>{
  const path=await directory(t);let app;
  const options={path,profile:'huawei_ict_agentarts',coordinationBinding:'fixture-config-v1',
    coordination:{execute:async()=>({kind:'text',text:'private derived answer canary',verification:'unverified'})},
    coordinationInput:{beforeCoordinationSend(){},prepareCoordinationGoal:async scope=>{
      if(scope.publicGoal==='independent')return scope.publicGoal;
      app.writePrivateTaskBinding(scope.taskId,{taskId:scope.taskId,conversationId:scope.conversationId,
        destination:'agentarts',configurationRef:app.coordinationConfigurationRef,deadline:scope.deadline,
        userGoalDigest:hash(scope.publicGoal),fact:{ref:{id:'synthetic-fact',revision:1},
          summaryDigest:hash('private summary canary'),sourceDigest:hash('private source canary'),configurationRef:'private-v1'}});
      return 'private summary canary';}}};
  app=createRuntimeApplication(options);
  try {
    const client=new Client(app);await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'public',conversationId:'erase'},{idempotencyKey:'private'});
    assert.equal((await waitFor(app,taskId)).state,'succeeded');
    const snapshot=app.runtime.loadCheckpoint(taskId,KEY);
    assert.ok(snapshot.privateBindingDigest);assert.doesNotMatch(JSON.stringify(snapshot),/canary/);
    const child=app.runtime.submitTask({goal:'private child canary',conversationId:'erase-child',idempotencyKey:'child'}).taskId;
    app.runtime.saveCheckpoint(child,'subtask-parent',{parentTaskId:taskId,subtaskId:'synthetic-child',goal:'private child canary'});
    app.runtime.saveCheckpoint(child,KEY,{body:'private child canary'});
    app.runtime.requestCancel(child);app.runtime.confirmCancellation(child);
    const {taskId:independent}=await client.call('task.submit',{goal:'independent',conversationId:'erase'},{idempotencyKey:'public'});
    await waitFor(app,independent);
    const unrelated=app.runtime.loadCheckpoint(independent,KEY);
    app.close();app=createRuntimeApplication(options);
    for(const copy of app.listBindings().items) {
      assert.equal((await app.eraseTaskCopies({taskId:copy.taskId,factId:'synthetic-fact',
        bindingDigest:hash(JSON.stringify(copy.binding)),...scope()})).state,'purged');
      assert.equal(app.runtime.loadCheckpoint(copy.taskId,KEY).redacted,true);
      assert.doesNotMatch(JSON.stringify(app.runtime.getTask(copy.taskId)),/canary/);
    }
    assert.deepEqual(app.runtime.loadCheckpoint(independent,KEY),unrelated);
    assert.equal(app.runtime.getTask(independent).goal,'independent');
    app.close();app=createRuntimeApplication(options);
    assert.equal(app.runtime.loadCheckpoint(taskId,KEY).redacted,true);
    assert.equal(app.runtime.loadCheckpoint(child,KEY).redacted,true);
    assert.deepEqual(app.runtime.loadCheckpoint(independent,KEY),unrelated);
  } finally {app.close();}
});
