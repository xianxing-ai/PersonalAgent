import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compactConversationContext,segmentConversationContext} from '../dist/application/context-compaction.js';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication,createAgentArtsRuntimeApplication,createRuntimeSubagentDispatchTool,
  CONTEXT_COMPACTION_CHECKPOINT} from '../dist/application.js';

// Synthetic pure-port tests. These do not invoke a provider or prove a cloud path.
function fixture(patch={}) {
  const control=new AbortController();
  const source={configurationRef:'synthetic-runtime:v1',messages:Array.from({length:8},(_,i)=>({
    id:'message-'+i,taskId:'source-task-'+Math.floor(i/2),role:i%2?'assistant':'user',
    content:'Synthetic source '+i+' '+('prior material '.repeat(24))}))};
  const policy={version:'synthetic-policy:v1',triggerCharacters:2000,targetCharacters:1800,maxCharacters:4000,
    retainMessages:2,maxSourceMessages:16,segmentCharacters:2200,maxSummaryCharacters:100};
  const saved={value:undefined};let calls=0;
  const options={scope:{taskId:'execution-child',conversationId:'child-conversation',cutoff:'execution-child',
    deadline:'2099-01-01T00:00:00.000Z',signal:control.signal},policy,modelConfigurationRef:'synthetic-model:v1',
    readSnapshot:()=>source,compile:messages=>JSON.stringify({publicGoal:'Keep the current goal',
      ephemeralGoal:'Keep the current prepared goal',conversationContext:{treatment:'untrusted_data',messages}}),
    summarize:async input=>{calls++;input.assertBeforeSend();return 'Synthetic past decisions '+input.segment.index;},
    assertCurrent(){},saveCheckpoint:receipt=>{saved.value=receipt;},loadCheckpoint:()=>saved.value,...patch};
  return {options,source,policy,saved,control,calls:()=>calls};
}

test('Synthetic compaction preserves the exact tail, segments only history, and saves detached digests',async()=>{
  const f=fixture();const original=structuredClone(f.source.messages);
  const result=await compactConversationContext(f.options);
  assert.equal(result.state,'compacted');assert.equal(f.calls(),2);
  assert.deepEqual(result.messages.slice(-2),original.slice(-2));
  assert.deepEqual(f.source.messages,original);
  const summary=JSON.parse(result.messages[0].content);
  assert.equal(summary.treatment,'untrusted_data');assert.equal(summary.kind,'derived_conversation_summary');
  assert.equal(result.receipt.sourceCount,8);assert.equal(result.receipt.sourceTasks.length,4);
  assert.ok(result.receipt.budget.after.characters<result.receipt.budget.before.characters);
  assert.deepEqual(result.receipt.budget.after.tokens,{state:'unmeasured'});
  assert.doesNotMatch(JSON.stringify(f.saved.value),/prior material|Synthetic past decisions|message-0/);
  assert.equal(f.saved.value.segments.length,2);result.assertCurrent();
  result.receipt.sourceTasks[0].messagesDigest='detached';
  assert.notEqual(f.saved.value.sourceTasks[0].messagesDigest,'detached');
});

test('Synthetic pass leaves a small history unchanged without summarization or a checkpoint',async()=>{
  const f=fixture();f.source.messages=f.source.messages.slice(-2);
  const result=await compactConversationContext(f.options);
  assert.equal(result.state,'unchanged');assert.equal(f.calls(),0);assert.equal(f.saved.value,undefined);
});

test('manual compaction below trigger preserves the tail and caches a projection for later turns',async()=>{
  let cache;
  const f=fixture({force:true,remember:value=>{cache=value;}});
  f.policy.maxCharacters=8000;f.policy.triggerCharacters=8000;
  const first=await compactConversationContext(f.options),calls=f.calls();
  assert.equal(first.state,'compacted');assert.ok(cache);
  f.saved.value=undefined;
  f.source.messages.push({id:'latest-correction',role:'user',content:'更正：青岛是山东青岛，明天出门，不是今天。'});
  const next=await compactConversationContext({...f.options,force:false,previous:cache});
  assert.equal(next.state,'compacted');assert.equal(f.calls(),calls);
  assert.deepEqual(next.messages.at(-1),f.source.messages.at(-1));
  assert.deepEqual(next.messages.slice(-3),f.source.messages.slice(-3));
  assert.equal(next.receipt.sourceCount,9);next.assertCurrent();
  f.source.messages[0].content='撤回旧条件';
  assert.throws(()=>next.assertCurrent(),{code:'REVISION_CONFLICT'});
});

test('cached summaries cannot cross conversation/model/policy/source changes or a restart',async t=>{
  for(const change of ['conversation','model','policy','source','delete','restart'])await t.test(change,async()=>{
    let cache;const f=fixture({remember:value=>{cache=value;}});
    await compactConversationContext(f.options);const calls=f.calls();f.saved.value=undefined;
    const options={...f.options,previous:cache,force:true};
    if(change==='conversation')options.scope={...options.scope,conversationId:'other'};
    if(change==='model')options.modelConfigurationRef='summary:v2';
    if(change==='policy')f.policy.version='policy:v2';
    if(change==='source')f.source.messages[0].content='Revised source '+'.'.repeat(300);
    if(change==='delete')f.source.messages.splice(0,2);
    if(change==='restart')delete options.previous;
    const result=await compactConversationContext(options);
    assert.equal(result.state,'compacted');assert.ok(f.calls()>calls);
  });
});

test('manual compaction with only retained messages is a no-op; failure preserves the source',async()=>{
  const f=fixture({force:true});f.source.messages=f.source.messages.slice(-2);
  assert.equal((await compactConversationContext(f.options)).state,'unchanged');assert.equal(f.calls(),0);
  const g=fixture({force:true,summarize:async()=>{throw Error('synthetic unavailable');}}),original=structuredClone(g.source);
  await assert.rejects(compactConversationContext(g.options),/synthetic unavailable/);
  assert.deepEqual(g.source,original);assert.equal(g.saved.value,undefined);
});

test('automatic compaction triggers exactly at the configured serialized character threshold',async()=>{
  const f=fixture();f.policy.triggerCharacters=f.options.compile(f.source.messages).length+1;
  assert.equal((await compactConversationContext(f.options)).state,'unchanged');assert.equal(f.calls(),0);
  f.policy.triggerCharacters--;
  assert.equal((await compactConversationContext(f.options)).state,'compacted');assert.ok(f.calls()>0);
});

test('Synthetic segmentation preserves original order, rejects an oversized message, and retains a full tail task',async()=>{
  const f=fixture();f.policy.retainMessages=1;
  const result=await compactConversationContext(f.options);
  assert.deepEqual(result.messages.slice(-2),f.source.messages.slice(-2));
  const parts=segmentConversationContext(f.source.messages,1200);
  assert.deepEqual(parts.flatMap(part=>part.messages),f.source.messages);
  assert.throws(()=>segmentConversationContext(f.source.messages,10),{code:'INVALID_ARGUMENT'});
});

test('Synthetic source/version/withdrawal changes during a summary cannot commit',async t=>{
  for(const change of ['body','identity','source-task','tail','withdraw','remove','configuration','policy','goal-frame','meter']) {
    await t.test(change,async()=>{
      let goal='original',count=200;
      const f=fixture({compile:messages=>JSON.stringify({goal,messages}),
        goalTokenBudget:{tokenizerRef:'synthetic-meter:v1',contextTokens:400,reservedOutputTokens:20,countTokens:()=>count}});
      f.options.summarize=async input=>{
        input.assertBeforeSend();
        if(change==='body')f.source.messages[0].content='Changed source';
        if(change==='identity')f.source.messages[0].id='changed-id';
        if(change==='source-task')f.source.messages[0].taskId='different-task';
        if(change==='tail')f.source.messages.at(-1).content='Changed retained tail';
        if(change==='withdraw')f.source.messages[0].withheld=true;
        if(change==='remove')f.source.messages.shift();
        if(change==='configuration')f.source.configurationRef='runtime:v2';
        if(change==='policy')f.policy.version='policy:v2';
        if(change==='goal-frame')goal='changed';
        if(change==='meter')count=201;
        return 'Summary';
      };
      await assert.rejects(compactConversationContext(f.options),error=>['REVISION_CONFLICT','UNAUTHORIZED'].includes(error.code));
      assert.equal(f.saved.value,undefined);
    });
  }
});

test('Synthetic cancellation and deadline expiry after an await never commit',async t=>{
  for(const change of ['cancel','deadline'])await t.test(change,async()=>{
    let now=0;const f=fixture({now:()=>now});
    f.options.summarize=async input=>{input.assertBeforeSend();await Promise.resolve();
      if(change==='cancel')f.control.abort();else now=Date.parse(f.options.scope.deadline);return 'Summary';};
    await assert.rejects(compactConversationContext(f.options),{code:change==='cancel'?'CANCELLED':'TIMEOUT'});
    assert.equal(f.saved.value,undefined);
  });
});

test('Synthetic cancellation settles while an uncooperative summary is still pending',async()=>{
  const f=fixture();let started;
  const entered=new Promise(resolve=>{started=resolve;});
  f.options.summarize=async input=>{input.assertBeforeSend();started();return new Promise(()=>{});};
  const running=compactConversationContext(f.options);
  await entered;f.control.abort();
  await assert.rejects(running,{code:'CANCELLED'});assert.equal(f.saved.value,undefined);
});

test('Synthetic summary cannot invent a final guard, exceed output, make no progress, or bypass the target',async t=>{
  for(const mode of ['missing-guard','blank','output-overflow','no-progress','target-overflow','token-overflow','async-meter']) {
    await t.test(mode,async()=>{
      const f=fixture();
      if(mode==='no-progress'){f.policy.maxSummaryCharacters=5000;f.policy.targetCharacters=1800;}
      if(mode==='target-overflow')f.policy.targetCharacters=10;
      if(mode==='token-overflow')f.options.goalTokenBudget={tokenizerRef:'fixture:v1',contextTokens:100,reservedOutputTokens:10,
        countTokens:text=>text.includes('context-summary:')?95:100};
      if(mode==='async-meter')f.options.goalTokenBudget={tokenizerRef:'fixture:v1',contextTokens:100,reservedOutputTokens:10,
        countTokens:()=>Promise.resolve(1)};
      f.options.summarize=async input=>{
        if(mode!=='missing-guard')input.assertBeforeSend();
        if(mode==='blank')return ' ';
        if(mode==='output-overflow')return 'x'.repeat(101);
        if(mode==='no-progress')return JSON.stringify(input.segment.messages);
        return 'Summary';
      };
      await assert.rejects(compactConversationContext(f.options),{code:mode==='missing-guard'?'UNSUPPORTED_CAPABILITY':'INVALID_ARGUMENT'});
      assert.equal(f.saved.value,undefined);
    });
  }
});

test('Synthetic token budget can trigger a pass below the character trigger and measures the final wrapper',async()=>{
  const seen=[];const f=fixture({goalTokenBudget:{tokenizerRef:'synthetic:exact',contextTokens:100,reservedOutputTokens:10,
    countTokens:text=>{seen.push(text);return text.includes('context-summary:')?50:100;}}});
  f.policy.triggerCharacters=4000;
  const result=await compactConversationContext(f.options);
  assert.equal(result.state,'compacted');assert.equal(result.receipt.budget.after.tokens.inputTokens,50);
  assert.ok(seen.some(text=>text.includes('Keep the current prepared goal')));
});

test('Synthetic final send guard rechecks source, receipt and model configuration after compaction',async t=>{
  for(const change of ['source','receipt','model','policy','meter'])await t.test(change,async()=>{
    const f=fixture();
    const result=await compactConversationContext(f.options);
    if(change==='source')f.source.messages[0].content='Later withdrawn source';
    if(change==='receipt')f.saved.value.summaryDigest='corrupt';
    if(change==='model')f.options.modelConfigurationRef='synthetic-model:v2';
    if(change==='policy')f.policy.targetCharacters=1400;
    if(change==='meter')f.options.goalTokenBudget={tokenizerRef:'new-meter',contextTokens:100,reservedOutputTokens:10,countTokens:()=>1};
    assert.throws(()=>result.assertCurrent(),{code:'REVISION_CONFLICT'});
  });
});

test('Synthetic restart validates the full original range and refuses summary drift or a redacted receipt',async t=>{
  for(const change of ['unchanged','source','summary','redacted'])await t.test(change,async()=>{
    const f=fixture();await compactConversationContext(f.options);
    const saved=structuredClone(f.saved.value);let calls=0;
    if(change==='source')f.source.messages[0].content='Restart source changed';
    if(change==='summary')f.options.summarize=async input=>{calls++;input.assertBeforeSend();return 'Changed summary';};
    if(change==='redacted')f.saved.value={redacted:true};
    if(change==='unchanged')assert.equal((await compactConversationContext(f.options)).state,'compacted');
    else await assert.rejects(compactConversationContext(f.options),{code:'REVISION_CONFLICT'});
    if(change==='source')assert.equal(calls,0);
    if(change!=='redacted')assert.deepEqual(f.saved.value,saved);
  });
});

test('Synthetic invalid policies, duplicate/withheld sources and asynchronous commit fail closed',async t=>{
  for(const change of ['no-policy','zero-segment','unbounded-range','duplicate','withheld','retained-all','async-commit'])await t.test(change,async()=>{
    const f=fixture();
    if(change==='no-policy')f.options.policy=undefined;
    if(change==='zero-segment')f.policy.segmentCharacters=0;
    if(change==='unbounded-range')f.policy.maxSourceMessages=3;
    if(change==='duplicate')f.source.messages[1].id=f.source.messages[0].id;
    if(change==='withheld')f.source.messages[0].withheld=true;
    if(change==='retained-all')f.policy.retainMessages=8;
    if(change==='async-commit')f.options.saveCheckpoint=async()=>{};
    await assert.rejects(compactConversationContext(f.options),error=>['INVALID_ARGUMENT','UNAUTHORIZED'].includes(error.code));
  });
});

const COMPILED='competition-context:v1',COMPACTED=COMPILED+':'+CONTEXT_COMPACTION_CHECKPOINT;
const runtimePolicy=()=>({version:'synthetic-runtime-policy:v1',triggerCharacters:12000,targetCharacters:9000,maxCharacters:16000,
  retainMessages:2,maxSourceMessages:40,segmentCharacters:7500,maxSummaryCharacters:100});
const runtimeSource=()=>Array.from({length:28},(_,i)=>({id:'long-'+i,role:i%2?'assistant':'user',
  content:'Synthetic historical source '+i+' '+('material '.repeat(90))}));
async function settled(app,taskId) {
  const until=Date.now()+5000;
  while(Date.now()<until){const task=app.runtime.getTask(taskId);
    if(['succeeded','failed','cancelled','waiting_approval','waiting_reconciliation'].includes(task.state)&&app.activeTaskCount===0)return task;
    await new Promise(resolve=>setTimeout(resolve,5));}
  throw Error('Synthetic Runtime context task did not settle');
}

test('slash commands compact immediately without delegation, tools or the main model; next question reuses summary',async t=>{
  for(const command of ['/压缩','/compact'])await t.test(command,async t=>{
    let summaries=0,sends=0;const source=runtimeSource(),policy=runtimePolicy();policy.triggerCharacters=32000;policy.maxCharacters=128000;
    const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,
      coordinationInput:{beforeCoordinationSend(){},contextCompaction:{policy,modelConfigurationRef:'summary:v1',
        assertCurrent(){},readSnapshot:()=>source,summarize:async input=>{input.assertBeforeSend();summaries++;return 'Prior constraints and unresolved request';}}},
      coordination:{execute:async()=>{sends++;throw Error('manual command must not reach main model');}}});
    t.after(()=>app.close());const client=new Client(app);await client.connect();
    const task=await client.call('task.submit',{goal:command,conversationId:'manual-context'},{idempotencyKey:command,timeoutMs:60000});
    const result=await settled(app,task.taskId);
    assert.equal(result.state,'succeeded',JSON.stringify(result));assert.match(result.resultSummary,/上下文已压缩/);
    assert.ok(summaries>0);assert.equal(sends,0);assert.equal(app.readSubagentTasks(task.taskId).length,0);
    assert.equal(app.runtime.readToolExecutions(task.taskId).length,0);
    const calls=summaries;
    const again=await client.call('task.submit',{goal:command,conversationId:'manual-context'},{idempotencyKey:command+'-again',timeoutMs:60000});
    assert.equal((await settled(app,again.taskId)).state,'succeeded');assert.equal(summaries,calls);
  });
});

test('a normal subsequent question consumes the source-validated manual summary without another summary call',async t=>{
  let summaries=0;const requests=[],source=runtimeSource(),policy=runtimePolicy();policy.triggerCharacters=32000;policy.maxCharacters=128000;
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    coordinationInput:{beforeCoordinationSend(){},contextCompaction:{policy,modelConfigurationRef:'summary:v1',assertCurrent(){},
      readSnapshot:()=>source,summarize:async input=>{input.assertBeforeSend();summaries++;return 'Location: Shandong Qingdao; unanswered request: clothing for tomorrow';}}},
    coordination:{execute:async request=>{requests.push(request);return {kind:'text',text:'Synthetic answer',verification:'mock'};}}});
  t.after(()=>app.close());const client=new Client(app);await client.connect();
  const first=await client.call('task.submit',{goal:'/压缩',conversationId:'reuse'},{idempotencyKey:'manual',timeoutMs:60000});
  assert.equal((await settled(app,first.taskId)).state,'succeeded');const calls=summaries;
  source.push({id:'correction',role:'user',content:'Tomorrow is rainy; remember the raincoat.'});
  const second=await client.call('task.submit',{goal:'What should I wear?',conversationId:'reuse'},{idempotencyKey:'question',timeoutMs:60000});
  assert.equal((await settled(app,second.taskId)).state,'succeeded');assert.equal(summaries,calls);assert.equal(requests.length,1);
  assert.match(requests[0].goal,/Shandong Qingdao/);assert.match(requests[0].goal,/raincoat/);assert.match(requests[0].goal,/What should I wear/);
});

test('unconfigured slash compaction fails explicitly and never becomes a main model question',async t=>{
  let sends=0;const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    coordination:{execute:async()=>{sends++;throw Error('must not send');}}});
  t.after(()=>app.close());const client=new Client(app);await client.connect();
  const task=await client.call('task.submit',{goal:'/compact',conversationId:'missing'},{idempotencyKey:'missing',timeoutMs:60000});
  const result=await settled(app,task.taskId);assert.equal(result.state,'failed');assert.match(result.error.message,/摘要模型/);assert.equal(sends,0);
});

test('actual delegated child consumes the original main conversation summary, without granting another conversation access',async t=>{
  let app,summaries=0;const sent=[],source=runtimeSource(),policy=runtimePolicy();policy.triggerCharacters=32000;policy.maxCharacters=128000;
  const read={name:'fixture.context.read',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],
    requiresPresence:false,idempotencySupport:true,recoverySupport:true,
    inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'}};
  const dispatch=createRuntimeSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(definition,worker,tools)=>app.runDefaultSubagentWorker(definition,worker,tools)});
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,
    tools:[dispatch,{descriptor:read,execute:async()=>assert.fail('Compaction does not execute business tools')}],
    automaticTools:[{toolName:'subagent.dispatch',toolVersion:'1.0.0'}],
    competitionToolAvailability:[{toolName:'subagent.dispatch',toolVersion:'1.0.0',available:()=>true},
      {toolName:read.name,toolVersion:read.version,available:()=>true}],
    competitionToolExports:[{toolName:'subagent.dispatch',toolVersion:'1.0.0',exportPolicyVersion:'fixture:v1',accepts:()=>true,project:({result})=>result},
      {toolName:read.name,toolVersion:read.version,exportPolicyVersion:'fixture-read:v1',accepts:()=>true,project:({result})=>result}],
    coordinationInput:{beforeCoordinationSend(){},contextCompaction:{policy,modelConfigurationRef:'summary:v1',assertCurrent(){},
      readSnapshot:()=>source,summarize:async input=>{input.assertBeforeSend();summaries++;return 'Synthetic original main history';}}},
    coordination:{execute:async request=>{sent.push(request);app.assertCompetitionExportAllowed(request);
      return {kind:'text',text:'Synthetic delegated answer',verification:'mock'};}}});
  t.after(()=>app.close());const client=new Client(app);await client.connect();
  const first=await client.call('task.submit',{goal:'/压缩',conversationId:'original-main'},{idempotencyKey:'main-compact',timeoutMs:60000});
  assert.equal((await settled(app,first.taskId)).state,'succeeded');const calls=summaries;
  const next=await client.call('task.submit',{goal:'Continue my original request',conversationId:'original-main'},{idempotencyKey:'main-continue',timeoutMs:60000});
  assert.equal((await settled(app,next.taskId)).state,'succeeded');
  assert.equal(summaries,calls);assert.equal(sent.length,2);
  const [child]=app.readSubagentTasks(next.taskId);assert.equal(child.state,'succeeded');
  assert.match(sent.find(request=>request.taskId===child.taskId).goal,/Synthetic original main history/);
  const other=await client.call('task.submit',{goal:'A separate conversation',conversationId:'other-main'},{idempotencyKey:'other',timeoutMs:60000});
  assert.equal((await settled(app,other.taskId)).state,'succeeded');
  assert.doesNotMatch(sent.filter(request=>request.taskId!==child.taskId&&request.taskId!==next.taskId).map(request=>request.goal).join('\n'),/context-summary:/);
});

test('cancelling an in-progress manual summary cannot publish a projection or checkpoint',async t=>{
  let entered;const started=new Promise(resolve=>{entered=resolve;});
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    coordinationInput:{beforeCoordinationSend(){},contextCompaction:{policy:runtimePolicy(),modelConfigurationRef:'summary:v1',
      assertCurrent(){},readSnapshot:runtimeSource,summarize:async input=>{input.assertBeforeSend();entered();return new Promise(()=>{});}}},
    coordination:{execute:async()=>assert.fail('No main model call')}});
  t.after(()=>app.close());const client=new Client(app);await client.connect();
  const task=await client.call('task.submit',{goal:'/压缩',conversationId:'cancel-summary'},{idempotencyKey:'cancel-summary',timeoutMs:60000});
  await started;await client.call('task.cancel',{taskId:task.taskId,reason:'Synthetic cancellation'});
  assert.equal((await settled(app,task.taskId)).state,'cancelled');
  assert.equal(app.runtime.loadCheckpoint(task.taskId,COMPACTED),undefined);
});

test('quoted or extended slash text stays ordinary conversation and never becomes a command',async t=>{
  let sends=0;const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    coordination:{execute:async()=>{sends++;return {kind:'text',text:'Synthetic ordinary explanation',verification:'mock'};}}});
  t.after(()=>app.close());const client=new Client(app);await client.connect();
  for(const [index,goal] of ['请解释 /压缩','/compact this text'].entries()){
    const task=await client.call('task.submit',{goal,conversationId:'ordinary-command-text'},{idempotencyKey:'ordinary-'+index,timeoutMs:60000});
    assert.equal((await settled(app,task.taskId)).state,'succeeded');
    assert.equal(app.runtime.loadCheckpoint(task.taskId,'conversation-compaction-command:v1'),undefined);
  }
  assert.equal(sends,2);
});

test('Synthetic actual Coordination caller compacts over-16k history and preserves the confirmed current continuation byte for byte',async t=>{
  let app;const source=runtimeSource(),queries=[],summarized=[];
  const descriptor={name:'fixture.compaction.read',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],
    requiresPresence:false,idempotencySupport:true,recoverySupport:true,
    inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'}};
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',coordinationBinding:'synthetic-config:v1',
    tools:[{descriptor,execute:async()=>({toolResult:'Keep this exact tool result',nativeProposalId:'preserved'})}],
    automaticTools:[{toolName:descriptor.name,toolVersion:descriptor.version}],
    competitionToolAvailability:[{toolName:descriptor.name,toolVersion:descriptor.version,available:()=>true}],
    competitionToolExports:[{toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'synthetic-export:v1',
      accepts:()=>true,project:({result})=>result}],
    coordinationInput:{beforeCoordinationSend(){},contextCompaction:{policy:runtimePolicy(),modelConfigurationRef:'synthetic-summary-model:v1',
      assertCurrent(){},readSnapshot:()=>source,summarize:async input=>{input.assertBeforeSend();summarized.push(input);
        assert.ok(input.segment.messages.every(message=>!message.content.includes('Keep this exact tool result')));
        return 'Synthetic compacted decisions '+input.segment.index;}}},
    coordination:{execute:async request=>{
      app.assertCompetitionExportAllowed(request);queries.push(request);
      if(!request.continuation)return {kind:'tool_proposal',proposalId:'current-native-proposal',toolName:descriptor.name,
        toolVersion:descriptor.version,arguments:{},verification:'unverified'};
      const loop=app.runtime.loadCheckpoint(request.taskId,'competition-loop');
      assert.equal(JSON.stringify(request.continuation),JSON.stringify(loop.continuation));
      assert.deepEqual(request.continuation.result,{toolResult:'Keep this exact tool result',nativeProposalId:'preserved'});
      return {kind:'text',text:'Synthetic child execution answer',verification:'mock'};}}});
  t.after(()=>app.close());const client=new Client(app);await client.connect();
  const task=await client.call('task.submit',{goal:'Exact current public goal',conversationId:'compaction-caller'},
    {idempotencyKey:'actual-caller',timeoutMs:60000});
  const finalTask=await settled(app,task.taskId);
  assert.equal(finalTask.state,'succeeded',JSON.stringify({task:finalTask,loop:app.runtime.loadCheckpoint(task.taskId,'competition-loop')}));assert.equal(queries.length,2);
  const compiled=JSON.parse(queries[0].goal);
  assert.equal(compiled.publicGoal,'Exact current public goal');
  assert.equal(compiled.conversationContext.treatment,'untrusted_data');
  assert.deepEqual(compiled.conversationContext.messages.slice(-2),source.slice(-2));
  assert.ok(queries[0].goal.length<9000);assert.ok(JSON.stringify(source).length>16000);
  const receipt=app.runtime.loadCheckpoint(task.taskId,COMPACTED),binding=app.runtime.loadCheckpoint(task.taskId,COMPILED);
  assert.equal(receipt.sourceCount,28);assert.ok(binding.compactionReceiptDigest);
  assert.doesNotMatch(JSON.stringify(receipt),/historical source|Synthetic compacted decisions/);
  assert.ok(summarized.length>2);assert.equal(app.runtime.readToolExecutions(task.taskId).filter(item=>item.state==='confirmed').length,1);
});

test('Synthetic real transport final guard rejects source withdrawal/config change after credential await',async t=>{
  for(const mode of ['body','withdraw','configuration'])await t.test(mode,async t=>{
    const source=runtimeSource();let sends=0;
    const compaction={policy:runtimePolicy(),modelConfigurationRef:'synthetic-summary:v1',assertCurrent(){},readSnapshot:()=>source,
      summarize:async input=>{input.assertBeforeSend();return 'Synthetic summary '+input.segment.index;}};
    const app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic',
      authorizationProvider:{read:async()=>{
        await Promise.resolve();
        if(mode==='body')source[0].content='Changed while reading credential';
        if(mode==='withdraw')source[0].withheld=true;
        if(mode==='configuration')compaction.modelConfigurationRef='summary:v2';
        return 'Bearer synthetic';}},fetchImpl:async()=>{sends++;throw Error('Changed source must not reach actual HTTP send');},
      coordinationInput:{beforeCoordinationSend(){},contextCompaction:compaction}});
    t.after(()=>app.close());const client=new Client(app);await client.connect();
    const task=await client.call('task.submit',{goal:'Current goal',conversationId:'credential-change'},
      {idempotencyKey:mode,timeoutMs:60000});
    assert.equal((await settled(app,task.taskId)).state,'failed');assert.equal(sends,0);
    assert.ok(app.runtime.loadCheckpoint(task.taskId,COMPACTED),'Metadata may survive; the stale projection was not sent');
  });
});

test('Synthetic ordinary overlay without a synchronous source port is unavailable and flag-off keeps its original behavior',async t=>{
  for(const enabled of [false,true])await t.test(String(enabled),async t=>{
    let summaries=0,sends=0;const source=[{id:'small',role:'user',content:'Original public overlay'}];
    const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',coordination:{execute:async request=>{
      sends++;assert.match(request.goal,/Original public overlay/);return {kind:'text',text:'Answer',verification:'mock'};}},
      coordinationInput:{beforeCoordinationSend(){},readConversationContext:async()=>source,
        ...(enabled?{contextCompaction:{policy:runtimePolicy(),modelConfigurationRef:'fixture:v1',assertCurrent(){},
          summarize:async()=>{summaries++;return 'Summary';}}}:{})}});
    t.after(()=>app.close());const client=new Client(app);await client.connect();
    const task=await client.call('task.submit',{goal:'Small goal',conversationId:'original-overlay'},
      {idempotencyKey:'enabled-'+enabled,timeoutMs:60000});
    assert.equal((await settled(app,task.taskId)).state,enabled?'failed':'succeeded');
    assert.equal(summaries,0);assert.equal(sends,enabled?0:1);
  });
});

test('Synthetic native persistent subagent conversation consumes more than twenty original messages with the original main/child split',async t=>{
  let app;const sent=[],summarized=[];
  const read={name:'fixture.native-context.read',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],
    requiresPresence:false,idempotencySupport:true,recoverySupport:true,
    inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'}};
  const dispatch=createRuntimeSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(definition,worker,tools)=>app.runDefaultSubagentWorker(definition,worker,tools)});
  const compaction={policy:runtimePolicy(),modelConfigurationRef:'synthetic-native-summary:v1',assertCurrent(){},readSnapshot:()=>[],
    summarize:async input=>{input.assertBeforeSend();summarized.push(input);return 'Synthetic native history '+input.segment.index;}};
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,
    tools:[dispatch,{descriptor:read,execute:async()=>({value:'Synthetic public read'})}],automaticTools:[{toolName:'subagent.dispatch',toolVersion:'1.0.0'}],
    competitionToolExports:[{toolName:'subagent.dispatch',toolVersion:'1.0.0',exportPolicyVersion:'fixture:v1',accepts:()=>true,project:({result})=>result},
      {toolName:read.name,toolVersion:read.version,exportPolicyVersion:'fixture-read:v1',accepts:()=>true,project:({result})=>result}],
    competitionToolAvailability:[{toolName:'subagent.dispatch',toolVersion:'1.0.0',available:()=>true},
      {toolName:read.name,toolVersion:read.version,available:()=>true}],
    coordinationInput:{beforeCoordinationSend(){},contextCompaction:compaction},coordination:{execute:async request=>{
      sent.push(request);app.assertCompetitionExportAllowed(request);
      return {kind:'text',text:app.runtime.getTask(request.taskId).conversationId==='native-main'
        ?'Main interaction summary':'Synthetic executed subagent answer '+('retained detail '.repeat(55)),verification:'mock'};}}});
  t.after(()=>app.close());const client=new Client(app);await client.connect();
  const parent=await client.call('task.submit',{goal:'Only a subagent performs the actual work',conversationId:'native-main'},
    {idempotencyKey:'native-parent',timeoutMs:60000});
  await settled(app,parent.taskId);const [child]=app.readSubagentTasks(parent.taskId);
  assert.equal(child.state,'succeeded',JSON.stringify(app.runtime.getTask(child.taskId)));const origin={parentTaskId:parent.taskId,taskId:child.taskId};
  let final;
  for(let i=0;i<14;i++) {
    final=app.submitSubagentConversationMessage({...origin,text:'Synthetic user followup '+i+' '+('bounded history '.repeat(40)),requestId:'native-turn-'+i});
    assert.equal((await settled(app,final.acceptedTaskId)).state,'succeeded');
  }
  const receipt=app.runtime.loadCheckpoint(final.acceptedTaskId,COMPACTED);
  assert.ok(receipt.sourceCount>20);assert.ok(summarized.length>0);
  const request=sent.find(request=>request.taskId===final.acceptedTaskId),goal=JSON.parse(request.goal);
  assert.match(goal.publicGoal,/Synthetic user followup 13/);
  assert.equal(goal.conversationContext.treatment,'untrusted_data');
  assert.deepEqual(app.readSubagentTasks(parent.taskId).map(task=>task.taskId),[child.taskId]);
  assert.ok(sent.filter(request=>request.taskId===parent.taskId).every(request=>(request.availableTools??[]).every(tool=>tool.name==='subagent.dispatch')));
});
