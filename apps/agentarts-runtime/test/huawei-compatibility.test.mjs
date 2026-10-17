import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {WebSocket} from 'ws';
import {OpenAICompatibleModelProvider} from '@personal-agent/models';
import {createOwnedModelFetch,ownedModelRequestFormat} from '../src/model-fetch.mjs';
import {createAgentServer} from '../src/server.mjs';

test('MaaS DeepSeek disables thinking through its supported switch and keeps cancellation/auth',async()=>{
  let captured;const measured=[];
  const key='synthetic-model-key-not-a-real-credential',signal=new AbortController().signal;
  const provider=new OpenAICompatibleModelProvider({baseUrl:'https://api.modelarts-maas.com/openai/v1',
    model:'deepseek-v4-flash',requestFormat:ownedModelRequestFormat({endpoint:'https://api.modelarts-maas.com/openai/v1',model:'deepseek-v4-flash'}),
    contextLimitTokens:300,requestTokenBudget:{model:'deepseek-v4-flash',tokenizerRef:'synthetic:v1',
      configurationRef:'synthetic:v1',reservedOutputTokens:200,countInputTokens:body=>{measured.push(body);return 177;}},
    apiKey:()=>key,fetch:createOwnedModelFetch({
      endpoint:'https://api.modelarts-maas.com/openai/v1',model:'deepseek-v4-flash',fetch:async(input,init)=>{
        captured={input,init};return new Response(JSON.stringify({choices:[{message:{content:'{"kind":"text","text":"synthetic"}'}}]}));
      }})});
  const result=await provider.complete({messages:[{role:'user',content:'Synthetic request'}],tools:[],requiredCapabilities:['text'],
    reasoningEffort:'none',maxOutputTokens:123,signal,deadline:new Date(Date.now()+2000).toISOString()});
  const body=JSON.parse(captured.init.body);
  assert.equal(body.reasoning_effort,undefined);assert.deepEqual(body.chat_template_kwargs,{thinking:false});
  assert.equal(body.max_tokens,123);assert.equal(captured.init.headers.authorization,`Bearer ${key}`);
  assert.equal(captured.init.redirect,'error');assert.ok(captured.init.signal instanceof AbortSignal);
  assert.deepEqual(measured,[captured.init.body,captured.init.body]);
  assert.equal(result.requestBudget.inputTokens,177);assert.equal(result.requestBudget.reservedOutputTokens,123);
  assert.equal(result.requestBudget.requestFormat,'huawei-maas-deepseek-thinking-v1');
});

test('MaaS transformed-body overflow is rejected before credentials or transport',async()=>{
  let credentials=0,sends=0;
  const provider=new OpenAICompatibleModelProvider({baseUrl:'https://api.modelarts-maas.com/openai/v1',
    model:'deepseek-v4.1-flash',requestFormat:'huawei-maas-deepseek-thinking-v1',contextLimitTokens:100,
    requestTokenBudget:{model:'deepseek-v4.1-flash',tokenizerRef:'synthetic:v1',configurationRef:'synthetic:v1',
      reservedOutputTokens:20,countInputTokens:body=>{
        assert.deepEqual(JSON.parse(body).chat_template_kwargs,{thinking:false});return 81;
      }},apiKey:()=>{credentials++;return 'synthetic';},
    fetch:createOwnedModelFetch({fetch:async()=>{sends++;throw Error('must not send');}})});
  await assert.rejects(provider.complete({messages:[{role:'user',content:'synthetic'}],tools:[],
    reasoningEffort:'none',signal:new AbortController().signal,deadline:new Date(Date.now()+2000).toISOString()}),{code:'INVALID_ARGUMENT'});
  assert.equal(credentials,0);assert.equal(sends,0);
});

test('owned format selection preserves the exact endpoint/model allowlist',()=>{
  for(const model of ['deepseek-v4-flash','deepseek-v4.1-flash']) {
    assert.equal(ownedModelRequestFormat({endpoint:'https://api.modelarts-maas.com/openai/v1/',model}),
      'huawei-maas-deepseek-thinking-v1');
  }
  for(const endpoint of ['https://provider.invalid/v1','https://api.modelarts-maas.com.evil.invalid/openai/v1',
    'https://api.modelarts-maas.com/openai/v2']) {
    assert.equal(ownedModelRequestFormat({endpoint,model:'deepseek-v4-flash'}),undefined);
  }
  assert.equal(ownedModelRequestFormat({endpoint:'https://api.modelarts-maas.com/openai/v1',model:'glm-5.2'}),undefined);
});

test('real loopback transport receives exactly the measured formatted Unicode request',async t=>{
  // Explicit synthetic endpoint and response; actual HTTP transport, no cloud account.
  let received,authorization;const measured=[];
  const server=createServer(async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    received=body;authorization=request.headers.authorization;
    response.writeHead(200,{'content-type':'application/json'});
    response.end(JSON.stringify({choices:[{message:{content:'synthetic reply'}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const provider=new OpenAICompatibleModelProvider({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,
    model:'synthetic',requestFormat:'huawei-maas-deepseek-thinking-v1',apiKey:()=> 'synthetic-local-key',
    contextLimitTokens:100,requestTokenBudget:{model:'synthetic',tokenizerRef:'synthetic:v1',configurationRef:'synthetic:v1',
      reservedOutputTokens:20,countInputTokens:body=>{measured.push(body);return 80;}},fetch:createOwnedModelFetch()});
  const content='中文 😀 "引用"\n已确认回执';
  await provider.complete({messages:[{role:'user',content}],tools:[],reasoningEffort:'none',
    signal:new AbortController().signal,deadline:new Date(Date.now()+5000).toISOString()});
  assert.deepEqual(measured,[received,received]);assert.equal(JSON.parse(received).messages[0].content,content);
  assert.deepEqual(JSON.parse(received).chat_template_kwargs,{thinking:false});
  assert.equal(authorization,'Bearer synthetic-local-key');
});
test('other providers and supported reasoning settings are passed through',async()=>{
  for (const [endpoint,model,effort] of [
    ['https://provider.invalid/v1','deepseek-v4-flash','none'],
    ['https://api.modelarts-maas.com/openai/v1','glm-5.2','none'],
    ['https://api.modelarts-maas.com/openai/v1','deepseek-v4-flash','high'],
  ]) {
    let captured;const body=JSON.stringify({reasoning_effort:effort});
    await createOwnedModelFetch({endpoint,model,fetch:async(_input,init)=>{captured=init;return new Response('{}');}})(endpoint,{body});
    assert.equal(captured.body,body);assert.equal(captured.redirect,'error');
  }
});
test('published endpoint and prefix aliases preserve HTTP/WS auth and reject URL credentials',async t=>{
  const token='synthetic-huawei-compatibility-wss-token',calls=[];
  const server=createAgentServer({mode:'standalone-validation',wssAuthToken:token,
    orchestrator:{invoke:async request=>{calls.push(request);return {kind:'text',text:'synthetic'};}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={'content-type':'application/json','x-pa-agent-token':`Bearer ${token}`};
  assert.equal((await fetch(base+'/invocations?endpoint=Latest',{method:'POST',headers,body:'{"query":"synthetic"}'})).status,200);
  assert.equal(calls.length,1);
  for(const query of ['token=secret','endpoint=Latest&token=secret','endpoint=Latest&endpoint=other']) {
    assert.equal((await fetch(base+'/invocations?'+query,{method:'POST',headers,body:'{"query":"synthetic"}'})).status,404);
  }
  assert.equal(calls.length,1);
  assert.equal((await fetch(base+'/invocations/bindings?endpoint=Latest')).status,401);
  const socket=new WebSocket(base.replace('http:','ws:')+'/invocations/ws?endpoint=Latest',{
    headers:{'x-pa-agent-token':`Bearer ${token}`,'x-hw-agentarts-session-id':'synthetic-compatibility'}});
  t.after(()=>socket.terminate());await once(socket,'open');socket.close();await once(socket,'close');
});
