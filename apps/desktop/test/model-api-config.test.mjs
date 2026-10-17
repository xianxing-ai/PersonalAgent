import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createRuntimeApplication, createDesktopSubagentDispatchTool, createConfiguredSubagentModelGateway} from '@personal-agent/runtime/application';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createModelApiConfig} from '../electron/model-api-config.js';
import {describeModelThinking} from '../src/app/model-api-controls.js';

const safeStorage = {isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
  decryptString:value=>Buffer.from(value).reverse().toString()};
const input = {provider:'openai-compatible',baseUrl:'https://synthetic.invalid/v1',model:'text-model',displayName:'Research',apiKey:'synthetic-secret'};
const request = () => ({messages:[{role:'user',content:'Synthetic request'}],tools:[],
  signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()});
function fixture(fetch) {
  const base = new URL('../../../.cache/model-api-config-tests/',import.meta.url);
  mkdirSync(base,{recursive:true});
  const userData = mkdtempSync(base);
  const createGateway = config => createConfiguredSubagentModelGateway({...config,fetch});
  const options = {userData,safeStorage,createGateway};
  return {options,host:createModelApiConfig(options)};
}
const answer = () => new Response(JSON.stringify({choices:[{message:{content:'Synthetic answer'}}]}));

test('version-bound native settings traverse actual Competition child serialization independently of depth', async () => {
  const bodies = [];
  const {host,options} = fixture(async (_url,init)=>{bodies.push(JSON.parse(init.body));return answer();});
  const native = {thinking:'enabled',effort:'max',supportedEfforts:['low','high','max'],outputTokenParameter:'max_completion_tokens'};
  let restored, app;
  try {
    assert.throws(()=>host.configure({...input,id:'native',nativeReasoning:native}),/确认/);
    assert.throws(()=>host.configure({...input,id:'native',provider:'pangu',nativeReasoning:native,reasoningSupportConfirmed:true}),/无效/);
    assert.throws(()=>host.configure({...input,id:'native',nativeReasoning:{...native,extra:'unknown'},reasoningSupportConfirmed:true}),/无效/);
    const state = host.configure({...input,id:'native',nativeReasoning:native,reasoningSupportConfirmed:true});
    const ref = state.models[0].configurationRef;
    assert.equal(bodies.length,0);
    assert.doesNotMatch(JSON.stringify(state),/synthetic-secret|apiKey/);
    state.models[0].nativeReasoning.effort = 'low';
    restored = createModelApiConfig(options);
    assert.equal(restored.snapshot().models[0].nativeReasoning.effort,'max');
    assert.deepEqual(restored.getModelReasoningEfforts('native',ref),['low','high','max']);
    assert.equal(restored.getModelReasoningState('native',ref).nativeReasoningVerified,false);
    const described = describeModelThinking(restored.snapshot().models[0],0);
    assert.equal(described.stepBudget.maxSteps,2);
    assert.equal(described.modelReasoning.effort,'max');
    assert.equal(described.modelReasoning.requestedEffort,'max');
    const old = restored.getModelGateway('native',ref);
    await assert.rejects(old.complete({...request(),reasoningEffort:'medium'}),/未声明/);
    await assert.rejects(old.complete({...request(),thinkingBudget:99}),/thinkingBudget/);
    assert.equal(bodies.length,0);
    app = createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
      coordination:new FakeCoordinationPort(()=>({kind:'text',text:'unused',verification:'mock'}))});
    const parent = app.runtime.submitTask({goal:'native configuration fixture',conversationId:'native',idempotencyKey:'native-parent'});
    const dispatch = createDesktopSubagentDispatchTool({getRuntime:()=>app.runtime,
      getModelGateway:id=>restored.getModelGateway(id,ref),getModelConfigurationRef:()=>ref,
      getModelReasoningEfforts:id=>restored.getModelReasoningEfforts(id,ref)});
    const result = await dispatch.execute({subtasks:[{subtaskId:'native',role:'researcher',goal:'Synthetic answer',model:'native',thinkingDepth:0}]},
      {taskId:parent.taskId,runId:'native-dispatch',scopes:['agent:delegate'],authorizationRef:'synthetic-parent',
        signal:new AbortController().signal,deadline:request().deadline});
    assert.equal(result.succeeded,1);
    assert.equal(bodies.length,1);
    assert.deepEqual(bodies[0].thinking,{type:'enabled'});
    assert.equal(bodies[0].reasoning_effort,'max');
    assert.equal(Object.hasOwn(bodies[0],'max_tokens'),false);
    const child = app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-native`);
    const binding = app.runtime.loadCheckpoint(child.taskId,'subtask-model-binding');
    assert.equal(binding.configurationRef,ref);assert.deepEqual(binding.nativeReasoning,native);
    assert.equal(app.runtime.loadCheckpoint(child.taskId,'subtask-thinking-binding').stepBudget.maxSteps,2);
    assert.equal(app.runtime.loadCheckpoint(child.taskId,'subtask-thinking-binding').modelReasoning.effort,'max');
    const changed = restored.configure({...input,id:'native',apiKey:'',expectedConfigurationRef:ref,
      nativeReasoning:{thinking:'disabled',supportedEfforts:[],outputTokenParameter:'max_tokens'},reasoningSupportConfirmed:true});
    assert.notEqual(changed.models[0].configurationRef,ref);
    assert.equal(restored.getModelGateway('native',ref),undefined);
    await assert.rejects(old.complete(request()),/撤销/);
    assert.equal(bodies.length,1);
  } finally {app?.close();restored?.dispose();host.dispose();}
});
test('encrypted model config restores, masks keys, preserves only same-destination keys and selects exact model', async () => {
  const calls = [];
  const {host,options} = fixture(async (url,init)=>{calls.push({url,init});return answer();});
  const state = host.configure({...input,id:'research',makeDefault:true});
  const originalDeployment = host.getModelGateway('research').deployment.deployment;
  assert.doesNotMatch(JSON.stringify(state),/synthetic-secret|apiKey/);
  assert.doesNotMatch(readFileSync(path.join(options.userData,'model-api-config.json'),'utf8'),/synthetic-secret/);
  assert.equal(calls.length,0);
  assert.equal(host.getModelGateway('unknown'),undefined);
  assert.deepEqual(host.getModelReasoningEfforts('research'),[]);
  host.configure({...input,id:'research',apiKey:''});
  assert.notEqual(host.getModelGateway('research').deployment.deployment,originalDeployment);
  assert.throws(()=>host.configure({...input,id:'research',apiKey:'',baseUrl:'https://different.invalid/v1'}));
  assert.throws(()=>host.configure({...input,id:'research',apiKey:'',provider:'pangu'}));
  const restored = createModelApiConfig(options);
  assert.equal(restored.getModelGateway('research').deployment.deployment,host.getModelGateway('research').deployment.deployment);
  assert.equal(restored.snapshot().defaultId,'research');
  await restored.getModelGateway().complete(request());
  assert.equal(calls[0].init.headers.authorization,'Bearer synthetic-secret');
  assert.equal(calls[0].url,'https://synthetic.invalid/v1/chat/completions');
  host.configure({...input,id:'research',apiKey:'',makeDefault:false});
  assert.equal(host.snapshot().defaultId,'');
  assert.equal(host.getModelGateway(),undefined);
  const stale = host.getModelGateway('research');
  host.remove({id:'research'});
  assert.equal(host.getModelGateway(),undefined);
  await assert.rejects(stale.complete(request()));
  assert.equal(createModelApiConfig(options).snapshot().models.length,0);
  restored.dispose(); host.dispose();
});
test('changing, disabling or disposing model configuration aborts inflight calls and revokes old references', async () => {
  for (const action of ['change','disable','dispose']) {
    let started, observed;
    const ready = new Promise(resolve=>{started=resolve;});
    const {host} = fixture(async (_url,init)=>{observed=init.signal;started();return new Promise((_,reject)=>{
      init.signal.addEventListener('abort',()=>reject(Error('synthetic abort')),{once:true});});});
    host.configure({...input,id:'research'});
    const gateway = host.getModelGateway('research');
    const completion = gateway.complete(request());
    const rejected = assert.rejects(completion);
    await ready;
    if (action==='dispose') host.dispose();
    else host.configure({...input,id:'research',apiKey:'',...(action==='disable'?{enabled:false}:{model:'changed'})});
    await rejected; assert.equal(observed.aborted,true);
    await assert.rejects(gateway.complete(request()));
    host.dispose();
  }
});
test('unsafe storage, credential URLs and a missing Runtime gateway factory stay unavailable without network calls', () => {
  const {options,host} = fixture(()=>{throw Error('must not call');});
  const noStorage = createModelApiConfig({...options,safeStorage:{isEncryptionAvailable:()=>false}});
  assert.throws(()=>noStorage.configure(input),/安全存储/);
  for (const baseUrl of ['http://remote.invalid/v1','https://user:secret@synthetic.invalid/v1','https://synthetic.invalid/v1?token=secret']) {
    assert.throws(()=>host.configure({...input,baseUrl}));
  }
  const missing = createModelApiConfig({...options,createGateway:undefined});
  missing.configure({...input,id:'absent'});
  assert.equal(missing.snapshot().configured,false);
  assert.equal(missing.getModelGateway(),undefined);
  assert.equal(missing.snapshot().models[0].capabilities.nativeReasoning,false);
  host.dispose();missing.dispose();noStorage.dispose();
});

test('explicit reasoning declaration is version-bound, restores safely and rejects stale/unsupported parameters', async () => {
  const calls = [];
  const {host,options} = fixture(async (_url,init)=>{calls.push(JSON.parse(init.body));return answer();});
  try {
    assert.throws(()=>host.configure({...input,id:'research',reasoningEfforts:['low']}),/确认/);
    assert.throws(()=>host.configure({...input,id:'research',reasoningEfforts:['low','low'],reasoningSupportConfirmed:true}));
    assert.throws(()=>host.configure({...input,id:'research',reasoningEfforts:['max'],reasoningSupportConfirmed:true}));
    const state = host.configure({...input,id:'research',reasoningEfforts:['high','low'],reasoningSupportConfirmed:true});
    const before = state.models[0].configurationRef;
    assert.deepEqual(host.getModelReasoningEfforts('research',before),['low','high']);
    assert.equal(host.getModelReasoningState('research',before).nativeReasoningVerified,false);
    const copy = host.getModelReasoningEfforts('research'); copy.push('medium');
    assert.deepEqual(host.getModelReasoningEfforts('research'),['low','high']);
    const restored = createModelApiConfig(options);
    assert.deepEqual(restored.getModelReasoningEfforts('research',before),['low','high']); restored.dispose();
    const old = host.getModelGateway('research',before);
    await assert.rejects(old.complete({...request(),reasoningEffort:'medium'}),/未声明/);
    await assert.rejects(old.complete({...request(),thinkingBudget:1000}),/thinkingBudget/);
    assert.equal(calls.length,0);
    assert.throws(()=>host.configure({...input,id:'research',reasoningEfforts:['low'],reasoningSupportConfirmed:true}),/确认/);
    host.configure({...input,id:'research',model:'different-model',expectedConfigurationRef:before});
    assert.deepEqual(host.getModelReasoningEfforts('research'),[]);
    assert.equal(host.getModelGateway('research',before),undefined);
    assert.deepEqual(host.getModelReasoningEfforts('research',before),[]);
    assert.throws(()=>host.configure({...input,id:'research',expectedConfigurationRef:before}),/版本/);
    await assert.rejects(old.complete({...request(),reasoningEffort:'low'}),/撤销/);
    assert.equal(calls.length,0);
  } finally {host.dispose();}
});

test('declared low/high depths traverse child runAgent and actual provider serialization; unknown support stays steps-only', async () => {
  const bodies = [];
  const {host} = fixture(async (_url,init)=>{bodies.push(JSON.parse(init.body));return answer();});
  const app = createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:[],
    coordination:new FakeCoordinationPort(()=>({kind:'text',text:'unused',verification:'mock'}))});
  try {
    host.configure({...input,id:'research',reasoningEfforts:['low','high'],reasoningSupportConfirmed:true});
    host.configure({...input,id:'unknown-support'});
    const parent = app.runtime.submitTask({goal:'delegate',conversationId:'synthetic',idempotencyKey:'reasoning-parent'});
    const dispatch = createDesktopSubagentDispatchTool({getRuntime:()=>app.runtime,
      getModelGateway:host.getModelGateway,getModelReasoningEfforts:host.getModelReasoningEfforts});
    const defs = [
      {subtaskId:'low',role:'researcher',goal:'synthetic low',model:'research',thinkingDepth:1},
      {subtaskId:'high',role:'researcher',goal:'synthetic high',model:'research',thinkingDepth:4},
      {subtaskId:'unsupported',role:'researcher',goal:'synthetic medium',model:'research',thinkingDepth:3},
      {subtaskId:'unknown',role:'researcher',goal:'synthetic unknown',model:'unknown-support',thinkingDepth:4},
    ];
    const result = await dispatch.execute({subtasks:defs},{taskId:parent.taskId,runId:'dispatch',authorizationRef:'synthetic-ref',
      scopes:['agent:delegate'],signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()});
    assert.equal(result.succeeded,4);
    assert.deepEqual(bodies.map(body=>body.reasoning_effort),['low','high',undefined,undefined]);
    assert.ok(bodies.every(body=>body.model==='text-model' && !Object.hasOwn(body,'thinking_budget') && !Object.hasOwn(body,'thinkingBudget')));
    for (const [index,definition] of defs.entries()) {
      const child = app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-${definition.subtaskId}`);
      const actual = app.runtime.loadCheckpoint(child.taskId,'subtask-thinking-binding');
      const entry = host.snapshot().models.find(item=>item.id===definition.model);
      const expected = describeModelThinking(entry,definition.thinkingDepth);
      assert.deepEqual(actual.stepBudget,expected.stepBudget);
      assert.equal(actual.modelReasoning.effort,expected.modelReasoning.effort);
      assert.equal(actual.modelReasoning.supported,index<2);
      assert.equal(actual.modelReasoning.thinkingBudgetSupported,false);
      assert.equal(actual.modelReasoning.verification,'conditional');
    }
    assert.equal(host.getModelGateway('missing'),undefined);
    assert.deepEqual(host.getModelReasoningEfforts('missing'),[]);
    assert.equal(describeModelThinking(host.snapshot().models[0],4).stepBudget.maxSteps,10);
    assert.throws(()=>describeModelThinking(host.snapshot().models[0],6));
  } finally {host.dispose();app.close();}
});

test('an unknown profile exposes neither gateways nor native support and never falls back', () => {
  const {host,options} = fixture(()=>{throw Error('network must not run');});
  host.configure({...input,id:'research',reasoningEfforts:['high'],reasoningSupportConfirmed:true});
  const unavailable = createModelApiConfig({...options,profile:'local'});
  try {
    assert.equal(unavailable.snapshot().status,'unavailable');
    assert.equal(unavailable.snapshot().models[0].capabilities.nativeReasoning,false);
    assert.equal(unavailable.getModelGateway('research'),undefined);
    assert.deepEqual(unavailable.getModelReasoningEfforts('research'),[]);
    assert.throws(()=>unavailable.configure(input),/Competition/);
  } finally {host.dispose();unavailable.dispose();}
});

test('enabled optional APIs cannot claim a default cloud worker or missing default API is available', () => {
  const {host,options} = fixture(()=>{throw Error('must not call');});
  let ready=false;
  const withDefault = createModelApiConfig({...options,isDefaultExecutionAvailable:()=>ready});
  try {
    host.configure({...input,id:'explicit-only',makeDefault:false});
    assert.equal(host.snapshot().configured,true);
    assert.equal(host.snapshot().defaultModelAvailable,false);
    assert.equal(host.snapshot().defaultAvailable,false);
    assert.equal(host.getModelGateway(),undefined);
    ready=true;
    assert.equal(withDefault.snapshot().defaultAvailable,true);
    assert.equal(withDefault.snapshot().defaultModelAvailable,false);
    assert.equal(withDefault.snapshot().defaultExecution.strategy,'competition');
    ready=false; assert.equal(withDefault.snapshot().defaultAvailable,false);
    const failed = createModelApiConfig({...options,isDefaultExecutionAvailable:()=>{throw Error('synthetic secret');}});
    assert.equal(failed.snapshot().defaultAvailable,false);
    assert.doesNotMatch(JSON.stringify(failed.snapshot()),/synthetic secret/);failed.dispose();
  } finally {host.dispose();withDefault.dispose();}
});
