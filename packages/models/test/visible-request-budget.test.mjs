import assert from 'node:assert/strict';
import test from 'node:test';
import {ModelGateway, OpenAICompatibleModelProvider, StructuredToolProvider} from '../dist/index.js';

const request = overrides => ({messages:[{role:'user',content:'中文 hello 😀 \"引用\"\n第二行'}],tools:[],
  deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal,...overrides});
const budget = overrides => ({model:'synthetic',tokenizerRef:'synthetic-meter:v1',configurationRef:'fixture-config:v1',
  reservedOutputTokens:20,countInputTokens:()=>80,...overrides});
function fixture(options = {}) {
  const calls = [], bodies = [];
  let credentials = 0;
  const provider = new OpenAICompatibleModelProvider({baseUrl:'https://synthetic.invalid/v1',model:'synthetic',
    contextLimitTokens:100,requestTokenBudget:budget(),
    apiKey:()=>{credentials++; return 'synthetic-key';},
    fetch:async (_url,init)=>{calls.push(init);bodies.push(JSON.parse(init.body));
      return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({kind:'final',text:'synthetic answer'})}}]})};},
    ...options});
  return {provider,calls,bodies,credentials:()=>credentials};
}

test('complete serialized provider body reaches the meter after tool schema and receipt wrapping', async () => {
  const seen = [];
  const f = fixture({requestTokenBudget:budget({countInputTokens:body=>{seen.push(body);return 80;}}),
    nativeReasoning:{thinking:'enabled',effort:'high',supportedEfforts:['high'],outputTokenParameter:'max_completion_tokens'}});
  const tool = {name:'fixture.read',version:'1.0.0',inputSchema:{type:'object',properties:{query:{type:'string'}}},
    outputSchema:{type:'object'},sideEffect:'read',requiredScopes:['fixture:read'],
    idempotencySupport:true,recoverySupport:true,requiresPresence:false};
  const r = request({tools:[tool],messages:[{role:'system',content:'可见系统提示'},...request().messages,
    {role:'tool',content:'已确认回执: 😀 \"readback\"'}]});
  const result = await new ModelGateway(new StructuredToolProvider(f.provider)).complete(r);
  assert.equal(seen.length,2);assert.equal(seen[0],f.calls[0].body);assert.equal(seen[1],seen[0]);
  const body = f.bodies[0];
  assert.match(body.messages[0].content,/Available tools/);
  assert.ok(body.messages[0].content.includes(JSON.stringify(tool)));
  assert.equal(body.messages[1].content,'可见系统提示');assert.equal(body.messages[2].content,r.messages[1].content);
  assert.match(body.messages[3].content,/Untrusted tool result data: 已确认回执/);
  assert.equal(body.model,'synthetic');assert.deepEqual(body.thinking,{type:'enabled'});
  assert.equal(body.reasoning_effort,'high');assert.equal(body.max_completion_tokens,20);
  assert.equal(Object.hasOwn(body,'max_tokens'),false);assert.equal(body.stream,false);
  assert.deepEqual(result.requestBudget,{scope:'provider-body',model:'synthetic',tokenizerRef:'synthetic-meter:v1',
    configurationRef:'fixture-config:v1',contextTokens:100,reservedOutputTokens:20,
    state:'measured',inputTokens:80,hiddenContext:'unknown'});
  assert.equal(result.deployment.capabilities.requestTokenBudget.reservedOutputTokens,20);
  assert.equal(JSON.stringify(result.requestBudget).includes('readback'),false);
  assert.equal(result.deployment.verification,'conditional');
});

test('input/output boundary passes, overflow and enlarged output fail before credentials', async () => {
  const f = fixture();
  await f.provider.complete(request());assert.equal(f.bodies[0].max_tokens,20);
  await f.provider.complete(request({maxOutputTokens:10}));assert.equal(f.bodies[1].max_tokens,10);
  await assert.rejects(f.provider.complete(request({maxOutputTokens:21})),{code:'INVALID_ARGUMENT'});
  assert.equal(f.credentials(),2);assert.equal(f.calls.length,2);
  const overflow = fixture({requestTokenBudget:budget({countInputTokens:()=>81})});
  await assert.rejects(overflow.provider.complete(request()),{code:'INVALID_ARGUMENT'});
  assert.equal(overflow.credentials(),0);assert.equal(overflow.calls.length,0);
});

test('invalid, asynchronous and failing meters are rejected without exposing private errors', async () => {
  for (const value of [-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1,'80',undefined]) {
    const f = fixture({requestTokenBudget:budget({countInputTokens:()=>value})});
    await assert.rejects(f.provider.complete(request()),{code:'INVALID_ARGUMENT'});
    assert.equal(f.credentials(),0);assert.equal(f.calls.length,0);
  }
  for (const countInputTokens of [async()=>80,()=>Promise.reject(new Error('private source')),
    ()=>{throw new Error('private source');}]) {
    const f = fixture({requestTokenBudget:budget({countInputTokens})});
    await assert.rejects(f.provider.complete(request()),error=>error.code==='INVALID_ARGUMENT'&&!error.message.includes('private source'));
    assert.equal(f.credentials(),0);assert.equal(f.calls.length,0);
  }
});

test('model/window/version declarations must be explicit; caller mutation does not reconfigure the provider', async () => {
  for (const options of [{contextLimitTokens:undefined},{requestTokenBudget:budget({model:'other'})},
    {requestTokenBudget:budget({tokenizerRef:undefined})},{requestTokenBudget:budget({configurationRef:123})},
    {requestTokenBudget:budget({reservedOutputTokens:0})},{requestTokenBudget:budget({reservedOutputTokens:101})},
    {requestTokenBudget:budget({countInputTokens:undefined})}]) {
    assert.throws(()=>fixture(options),{code:'INVALID_ARGUMENT'});
  }
  const b = budget();const f = fixture({requestTokenBudget:b});
  b.tokenizerRef='mutated';b.configurationRef='mutated';b.reservedOutputTokens=99;b.countInputTokens=()=>999;
  const result = await f.provider.complete(request());
  assert.equal(result.requestBudget.tokenizerRef,'synthetic-meter:v1');assert.equal(result.requestBudget.inputTokens,80);
  assert.equal(f.bodies[0].max_tokens,20);
});

test('credential wait cannot change the measured payload or silently change its input count', async () => {
  const r = request();
  const f = fixture({apiKey:async()=>{r.messages[0].content='replaced after measurement';r.maxOutputTokens=999;return 'synthetic';}});
  await f.provider.complete(r);
  assert.equal(f.bodies[0].messages[0].content,request().messages[0].content);assert.equal(f.bodies[0].max_tokens,20);
  let count = 80;
  const drift = fixture({requestTokenBudget:budget({countInputTokens:()=>count}),apiKey:async()=>{count=79;return 'synthetic';}});
  await assert.rejects(drift.provider.complete(request()),{code:'REVISION_CONFLICT'});assert.equal(drift.calls.length,0);
});

test('every continuation is measured again, while missing meters explicitly remain unmeasured', async () => {
  const seen = [];
  const f = fixture({requestTokenBudget:budget({countInputTokens:body=>{seen.push(JSON.parse(body));
    return JSON.parse(body).messages.length===1?80:81;}})});
  await f.provider.complete(request());
  await assert.rejects(f.provider.complete(request({messages:[...request().messages,{role:'user',content:'confirmed continuation'}]})),{code:'INVALID_ARGUMENT'});
  assert.equal(seen.length,3);assert.equal(f.credentials(),1);assert.equal(f.calls.length,1);
  const unknown = fixture({requestTokenBudget:undefined});const result = await unknown.provider.complete(request());
  assert.deepEqual(result.requestBudget,{state:'unmeasured',scope:'provider-body',hiddenContext:'unknown'});
  assert.equal(Object.hasOwn(unknown.bodies[0],'max_tokens'),false);
  assert.equal(unknown.provider.deployment.capabilities.requestTokenBudget,undefined);
});

test('cancelled and expired requests do not read credentials or run the meter', async () => {
  let measured = 0;const f = fixture({requestTokenBudget:budget({countInputTokens:()=>{measured++;return 80;}})});
  const controller = new AbortController();controller.abort();
  await assert.rejects(f.provider.complete(request({signal:controller.signal})),{code:'CANCELLED'});
  await assert.rejects(f.provider.complete(request({deadline:new Date(0).toISOString()})),{code:'TIMEOUT'});
  assert.equal(measured,0);assert.equal(f.credentials(),0);assert.equal(f.calls.length,0);
});
