import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication,compactConversationContext} from '@personal-agent/runtime/application';

// Execute the original Main function over the real Runtime reader. All source,
// coordination and summary ports are explicit local fixtures; no provider IO.
const main=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
function reader(app,text,live=[]) {
  const file=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const node=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='readDesktopConversationContext');
  assert.ok(node);
  const box={runtimeApplication:app,ProtocolError:class extends Error {constructor(code,message){super(message);this.code=code;}},
    conversations:{containsConversation:()=>true,turns:new Map(),session:()=>({surface:'panel'}),messagesFor:()=>text},
    liveVoice:{historyMessages:()=>live},installedSkillsHost:undefined,knowledgeWatchHost:undefined,coordinationWatchInputs:new Map()};
  vm.createContext(box);vm.runInContext(node.getText(file)+'\nthis.read=readDesktopConversationContext;',box);
  return (...args)=>box.read(...args);
}
const scope=()=>({conversationId:'context-compat',deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal});
const policy=()=>({version:'compat:v1',triggerCharacters:2000,targetCharacters:1800,maxCharacters:16000,
  retainMessages:2,maxSourceMessages:40,segmentCharacters:2200,maxSummaryCharacters:100});
function compaction(messages,patch={}) {
  let receipt,calls=0;
  return {options:{scope:{...scope(),taskId:'fixture-task',cutoff:'fixture-task'},policy:policy(),modelConfigurationRef:'fixture-model:v1',
    readSnapshot:()=>({configurationRef:'fixture-source:v1',messages}),compile:value=>JSON.stringify({publicGoal:'当前目标',messages:value}),
    summarize:async input=>{calls++;input.assertBeforeSend();return '明确标注的合成历史摘要';},assertCurrent(){},
    saveCheckpoint:value=>{receipt=value;},...patch},receipt:()=>receipt,calls:()=>calls};
}

test('Main preserves more than twenty user conditions and rejects an explicit smaller source range',t=>{
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'});t.after(()=>app.close());
  const history=Array.from({length:25},(_,i)=>({id:'user-'+i,role:'user',text:i===0?'预算500元且不要皮革':'补充'+i,
    createdAt:new Date(Date.now()-100000+i).toISOString()}));
  const read=reader(app,history),messages=read(scope());
  assert.equal(messages.length,25);assert.equal(messages[0].content,'预算500元且不要皮革');
  assert.throws(()=>read(scope(),20),{code:'INVALID_ARGUMENT'});
  assert.equal(read(scope(),25).length,25);
});

test('Main preserves source timestamps so newer text corrections follow older Live input',t=>{
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'});t.after(()=>app.close());
  const later={id:'text-later',role:'user',text:'更正蓝色',createdAt:'2026-10-20T02:00:00Z'};
  const earlier={id:'voice-earlier',role:'user',text:'先红色',createdAt:'2026-10-20T01:00:00Z'};
  const messages=reader(app,[later],[earlier])(scope());
  assert.deepEqual(messages.map(m=>m.id),['voice-earlier','text-later']);
  assert.equal(messages[1].createdAt,later.createdAt);
});

test('compaction consumes original pending/withheld metadata without stripping it or calling a model',async t=>{
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'});t.after(()=>app.close());
  app.runtime.submitTask({goal:'仍需回答的原条件',conversationId:'context-compat',idempotencyKey:'pending'});
  const messages=app.readConversationContext({...scope(),historyMessages:[{id:'earlier',role:'user',content:'原语音',
    createdAt:'2026-10-20T01:00:00Z',answerWithheld:true}]});
  assert.equal(messages.find(m=>m.taskId)?.taskState,'created');
  const f=compaction(messages),result=await compactConversationContext(f.options);
  assert.equal(result.state,'unchanged');assert.deepEqual(result.messages,messages);assert.equal(f.calls(),0);
});

test('compaction strictly rejects malformed metadata and extra fields',async t=>{
  for(const extra of [{createdAt:'not-a-date'},{createdAt:123},{taskState:'future-state'},{taskState:3},
    {answerWithheld:false},{answerWithheld:'true'},{authorizationRef:'not-a-grant'}])await t.test(JSON.stringify(extra),async()=>{
    const f=compaction([{id:'source',role:'user',content:'原条件',...extra}]);
    await assert.rejects(compactConversationContext(f.options),{code:'UNAUTHORIZED'});assert.equal(f.calls(),0);
  });
});

test('metadata changes invalidate the original compaction source digest and committed receipt',async t=>{
  for(const field of ['createdAt','taskState','answerWithheld'])await t.test(field,async()=>{
    const messages=Array.from({length:8},(_,i)=>({id:'source-'+i,role:i%2?'assistant':'user',
      content:'original source '.repeat(30),createdAt:'2026-10-20T01:00:00Z',taskState:'failed',answerWithheld:true}));
    const f=compaction(messages),result=await compactConversationContext(f.options);
    assert.equal(result.state,'compacted');assert.ok(f.receipt().sourceDigest);result.assertCurrent();
    if(field==='createdAt')messages[0].createdAt='2026-10-20T02:00:00Z';
    if(field==='taskState')messages[0].taskState='cancelled';
    if(field==='answerWithheld')delete messages[0].answerWithheld;
    assert.throws(()=>result.assertCurrent(),{code:'REVISION_CONFLICT'});
  });
});

test('actual Runtime caller preserves full source/goal metadata with compaction disabled or enabled',async t=>{
  for(const enabled of [false,true])await t.test(String(enabled),async t=>{
    const source=Array.from({length:25},(_,i)=>({id:'source-'+i,role:'user',content:i===0?'预算500元且不要皮革':'条件'+i,
      createdAt:new Date(Date.now()-100000+i).toISOString(),taskState:'created',answerWithheld:true}));
    const requests=[];
    const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
      coordination:{execute:async request=>{requests.push(request);return {kind:'text',text:'合成答复',verification:'mock'};}},
      coordinationInput:{beforeCoordinationSend(){},readConversationContext:async()=>source,
        ...(enabled?{contextCompaction:{policy:{...policy(),triggerCharacters:12000},modelConfigurationRef:'fixture:v1',
          readSnapshot:()=>source,assertCurrent(){},summarize:async()=>{throw Error('small source needs no summary');}}}:{})}});
    t.after(()=>app.close());const client=new Client(app);await client.connect();
    const accepted=await client.call('task.submit',{goal:'在青岛',conversationId:'context-compat'},{idempotencyKey:'caller-'+enabled,timeoutMs:10000});
    const until=Date.now()+5000;while(app.activeTaskCount&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(app.runtime.getTask(accepted.taskId).state,'succeeded');assert.equal(requests.length,1);
    const compiled=JSON.parse(requests[0].goal);assert.equal(compiled.publicGoal,'在青岛');
    assert.deepEqual(compiled.conversationContext.messages,source);
  });
});

test('actual Runtime rejects oversized explicit compaction source before summary or coordination send',async t=>{
  const source=Array.from({length:25},(_,i)=>({id:'source-'+i,role:'user',content:'原条件'+i}));
  let sends=0,summaries=0;
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    coordination:{execute:async()=>{sends++;return {kind:'text',text:'must not send',verification:'mock'};}},
    coordinationInput:{beforeCoordinationSend(){},contextCompaction:{policy:{...policy(),maxSourceMessages:20},modelConfigurationRef:'fixture:v1',
      readSnapshot:()=>source,assertCurrent(){},summarize:async()=>{summaries++;return 'must not summarize a truncated range';}}}});
  t.after(()=>app.close());const client=new Client(app);await client.connect();
  const accepted=await client.call('task.submit',{goal:'继续',conversationId:'context-compat'},{idempotencyKey:'oversized',timeoutMs:10000});
  const until=Date.now()+5000;while(app.activeTaskCount&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(app.runtime.getTask(accepted.taskId).state,'failed');assert.equal(sends,0);assert.equal(summaries,0);
});
