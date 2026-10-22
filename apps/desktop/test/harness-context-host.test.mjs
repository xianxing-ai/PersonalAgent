import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createConfiguredSubagentModelGateway,createContextModelSummarizer,createAgentArtsRuntimeApplication,
  compileCoordinationGoal} from '@personal-agent/runtime/application';
import {createModelApiConfig} from '../electron/model-api-config.js';
import {createDesktopHarnessContextHost} from '../electron/harness-context-host.js';

// Actual Desktop -> Runtime -> public ModelGateway/Provider -> injected HTTP.
// Credentials, consent and both endpoints below are Synthetic, not real service evidence.
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
  decryptString:value=>Buffer.from(value).reverse().toString()};
const policy=()=>({version:'synthetic-context:v1',triggerCharacters:12000,targetCharacters:9000,maxCharacters:16000,
  retainMessages:2,maxSourceMessages:40,segmentCharacters:7500,maxSummaryCharacters:120});
const source=()=>Array.from({length:28},(_,i)=>({id:'synthetic-source-'+i,role:i%2?'assistant':'user',
  content:'Original public history '+i+' '+('bounded material '.repeat(55))}));
const response=()=>new Response(JSON.stringify({choices:[{message:{content:'Synthetic historical decisions'}}]}));
async function settled(app,taskId) {
  const until=Date.now()+5000;
  while(Date.now()<until){const task=app.runtime.getTask(taskId);
    if(['succeeded','failed','cancelled','waiting_reconciliation'].includes(task.state)&&app.activeTaskCount===0)return task;
    await new Promise(resolve=>setTimeout(resolve,5));}
  throw Error('Synthetic harness context task did not settle');
}
function fixture(t,patch={}) {
  const base=new URL('../../../.cache/harness-context-host/',import.meta.url);mkdirSync(base,{recursive:true});
  const root=mkdtempSync(base),requests=[],consents=[];let application,privateBinding;
  const modelApi=createModelApiConfig({userData:path.join(root,'profile'),safeStorage,
    createGateway:createConfiguredSubagentModelGateway,createGuardedGateway:patch.createGuardedGateway??createConfiguredSubagentModelGateway,
    fetchImpl:async(_url,init)=>{requests.push(JSON.parse(init.body));return response();}});
  const configured=modelApi.configure({id:'chosen-summary',provider:'openai-compatible',baseUrl:'https://summary.example.test/v1',
    model:'synthetic-selected-model',displayName:'Chosen summary model',apiKey:'synthetic-test-key',enabled:true,makeDefault:false});
  const configurationRef=configured.models[0].configurationRef;
  modelApi.configureHarness({expectedRevision:'unconfigured',enabled:false,context:{enabled:true,modelId:'chosen-summary',configurationRef,
    maxOutputTokens:100,policy:policy()}});
  const configuration=modelApi.readHarnessConfiguration().context;
  const fakeApplication={runtime:{getTask:()=>({state:'running',conversationId:'owned-conversation',cancelRequested:false}),
    loadCheckpoint:()=>undefined},readPrivateTaskBinding:()=>privateBinding};
  const messages=source();
  const options={readConfiguration:()=>modelApi.readHarnessConfiguration().context,modelApi,getApplication:()=>application??fakeApplication,
    resolveConversation:()=> 'owned-conversation',readSnapshot:()=>messages,createModelSummarizer:createContextModelSummarizer,
    confirmExport:async request=>{consents.push(request);return true;},...patch};
  const host=createDesktopHarnessContextHost(options);
  t.after(()=>{host.dispose();modelApi.dispose();rmSync(root,{recursive:true,force:true});});
  const input={scope:{taskId:'synthetic-task',conversationId:'owned-conversation',cutoff:'synthetic-task',
    deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal},
    authorizationSource:{configurationRef:'synthetic-original-snapshot',sourceCount:messages.length,
      sourceDigest:createHash('sha256').update(JSON.stringify(messages)).digest('hex'),tailDigest:'a'.repeat(64),goalFrameDigest:'b'.repeat(64)},
    segment:{index:0,rangeDigest:'synthetic-range',messages:messages.slice(0,2)},maxSummaryCharacters:120,assertBeforeSend(){}};
  return {root,host,options,configuration,configurationRef,modelApi,messages,requests,consents,input,
    setApplication:value=>{application=value;},setPrivate:value=>{privateBinding=value;}};
}

test('Synthetic Desktop host uses only the explicitly selected version and asks exact destination/payload consent',async t=>{
  const f=fixture(t);assert.equal(f.modelApi.snapshot().defaultId,'');
  assert.equal(f.requests.length,0);assert.equal(f.host.snapshot().state,'configured');
  assert.equal(await f.host.runtimeHooks.summarize(f.input),'Synthetic historical decisions');
  assert.equal(f.requests.length,1);assert.equal(f.consents.length,1);
  assert.equal(f.consents[0].payload.destination.modelId,'chosen-summary');
  assert.equal(f.consents[0].payload.destination.configurationRef,f.configurationRef);
  assert.equal(f.consents[0].payload.destination.baseUrl,'https://summary.example.test/v1');
  assert.match(f.consents[0].payload.request.messages[1].content,/Original public history/);
  assert.doesNotMatch(JSON.stringify(f.consents),/synthetic-test-key|apiKey/);
  assert.equal(f.requests[0].model,'synthetic-selected-model');assert.equal(f.requests[0].max_tokens,100);
  assert.equal(f.requests[0].tools,undefined);
});

test('whole original history range shares one policy binding across segments; another source range cannot inherit it',async t=>{
  const f=fixture(t);
  await f.host.runtimeHooks.summarize(f.input);
  await f.host.runtimeHooks.summarize({...f.input,segment:{...f.input.segment,index:1,rangeDigest:'next-segment',messages:f.messages.slice(2,4)}});
  assert.equal(f.consents[0].policyBinding,f.consents[1].policyBinding);
  await f.host.runtimeHooks.summarize({...f.input,authorizationSource:{...f.input.authorizationSource,sourceDigest:'c'.repeat(64)}});
  assert.notEqual(f.consents[0].policyBinding,f.consents[2].policyBinding);
  const before=f.consents.length;
  await assert.rejects(f.host.runtimeHooks.summarize({...f.input,authorizationSource:undefined}),{code:'UNAUTHORIZED'});
  assert.equal(f.consents.length,before,'missing trusted whole-pass source must not ask or send');
});

test('Synthetic actual Provider fetch guard rejects withdrawal after awaited credentials before any HTTP',async t=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;});let withdrawn=false;
  const f=fixture(t,{createGuardedGateway:config=>createConfiguredSubagentModelGateway({...config,apiKey:async()=>{
    const key=config.apiKey();entered();await new Promise(resolve=>{release=resolve;});return key;}})});
  f.input.assertBeforeSend=()=>{if(withdrawn)throw new ProtocolError('UNAUTHORIZED','Source withdrawn');};
  const pending=f.host.runtimeHooks.summarize(f.input);await started;withdrawn=true;release();
  await assert.rejects(pending,{code:'UNAUTHORIZED'});assert.equal(f.requests.length,0);assert.equal(f.consents.length,1);
});

test('Synthetic fresh guarded gateways do not share guards between parallel summaries',async t=>{
  const f=fixture(t);const seen=[];
  const a=f.modelApi.getGuardedModelGateway('chosen-summary',f.configurationRef,()=>{seen.push('a');});
  const b=f.modelApi.getGuardedModelGateway('chosen-summary',f.configurationRef,()=>{seen.push('b');throw Error('B source withdrawn');});
  assert.notEqual(a,b);
  const request={messages:[{role:'user',content:'Synthetic parallel summary'}],tools:[],deadline:f.input.scope.deadline,signal:f.input.scope.signal};
  const results=await Promise.allSettled([a.complete(request),b.complete(request)]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
  assert.deepEqual(seen.sort(),['a','b']);assert.equal(f.requests.length,1);
});

test('Synthetic revoked model/config, denied consent and private bindings never dispatch a summary',async t=>{
  for(const mode of ['model','config','consent','private'])await t.test(mode,async t=>{
    const f=fixture(t);
    if(mode==='model')f.modelApi.remove({id:'chosen-summary'});
    if(mode==='config')f.modelApi.configureHarness({expectedRevision:f.modelApi.readHarnessConfiguration().revision,enabled:false,context:{enabled:false}});
    if(mode==='consent'){
      f.host.dispose();f.options.confirmExport=async()=>false;
      f.host=createDesktopHarnessContextHost(f.options);t.after(()=>f.host.dispose());
    }
    if(mode==='private')f.setPrivate({private:'not-exported'});
    await assert.rejects(f.host.runtimeHooks.summarize(f.input));assert.equal(f.requests.length,0);
  });
});

test('Synthetic disabled configuration preserves old preflight; enabled preflight retains the current goal and exact tail',t=>{
  const f=fixture(t),goal='Exact current goal';
  assert.throws(()=>compileCoordinationGoal(goal,goal,f.messages),{code:'INVALID_ARGUMENT'});
  const admitted=JSON.parse(f.host.preflight(goal,goal,f.messages,compileCoordinationGoal));
  assert.equal(admitted.publicGoal,goal);assert.deepEqual(admitted.conversationContext.messages,f.messages.slice(-2));
  assert.equal(f.requests.length,0,'Preflight never runs a model');
  assert.throws(()=>f.host.preflight('x'.repeat(16001),'x'.repeat(16001),f.messages,compileCoordinationGoal),{code:'INVALID_ARGUMENT'});
  const off=createDesktopHarnessContextHost({readConfiguration:()=>({enabled:false})});t.after(()=>off.dispose());
  assert.equal(off.runtimeHooks,undefined);assert.equal(off.snapshot().state,'disabled');
  assert.throws(()=>off.preflight(goal,goal,f.messages,compileCoordinationGoal),{code:'INVALID_ARGUMENT'});
});

test('Synthetic explicit context config rejects missing budgets, unselected versions and an unguarded model factory',t=>{
  const f=fixture(t);
  for(const change of [{maxOutputTokens:undefined},{policy:{...f.configuration.policy,retainMessages:undefined}},
    {configurationRef:'different-version'},{modelId:''},{policy:{...f.configuration.policy,maxCharacters:16001}}]){
    assert.throws(()=>createDesktopHarnessContextHost({...f.options,readConfiguration:()=>({...f.configuration,...change})}));
  }
  const noGuard=createModelApiConfig({userData:path.join(f.root,'profile'),safeStorage,createGateway:createConfiguredSubagentModelGateway});
  t.after(()=>noGuard.dispose());assert.equal(noGuard.getGuardedModelGateway('chosen-summary',f.configurationRef,()=>{}),undefined);
  assert.throws(()=>createDesktopHarnessContextHost({...f.options,modelApi:noGuard}));
  assert.equal(f.requests.length,0);
});

test('Synthetic full Desktop host to Runtime caller summarizes a long overlay and emits only bounded goal data to cloud',async t=>{
  const f=fixture(t);let cloud=0;
  const app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic',
    authorizationProvider:{read:async()=> 'Bearer synthetic'},fetchImpl:async(_url,init)=>{
      cloud++;const query=JSON.parse(JSON.parse(init.body).query);assert.equal(query.publicGoal,'Current developer request');
      assert.deepEqual(query.conversationContext.messages.slice(-2),f.messages.slice(-2));
      assert.ok(init.body.length<16000);
      return new Response(JSON.stringify({event:'message',data:{text:'Synthetic cloud answer',index:0}}),{headers:{'content-type':'application/json'}});},
    coordinationInput:{beforeCoordinationSend(){},contextCompaction:f.host.runtimeHooks}});
  f.setApplication(app);t.after(()=>app.close());
  const client=new Client(app);await client.connect();const task=await client.call('task.submit',
    {goal:'Current developer request',conversationId:'owned-conversation'},{idempotencyKey:'full-host',timeoutMs:60000});
  assert.equal((await settled(app,task.taskId)).state,'succeeded');assert.equal(cloud,1);assert.ok(f.requests.length>1);
  assert.equal(f.requests.length,f.consents.length);
  assert.equal(new Set(f.consents.map(item=>item.policyBinding)).size,1,'the real Runtime passes the same whole-range identity to each segment');
  assert.equal(app.runtime.loadCheckpoint(task.taskId,'competition-context:v1:conversation-compaction:v1').sourceCount,28);
});
