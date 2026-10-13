import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {OpenAICompatibleModelProvider} from '@personal-agent/models';
import {createOwnedModelFetch} from '../src/model-fetch.mjs';
import {createAgentServer} from '../src/server.mjs';

test('MaaS DeepSeek disables thinking through its supported switch and keeps cancellation/auth',async()=>{
  let captured;
  const key='synthetic-model-key-not-a-real-credential',signal=new AbortController().signal;
  const provider=new OpenAICompatibleModelProvider({baseUrl:'https://api.modelarts-maas.com/openai/v1',
    model:'deepseek-v4-flash',apiKey:()=>key,fetch:createOwnedModelFetch({
      endpoint:'https://api.modelarts-maas.com/openai/v1',model:'deepseek-v4-flash',fetch:async(input,init)=>{
        captured={input,init};return new Response(JSON.stringify({choices:[{message:{content:'{"kind":"text","text":"synthetic"}'}}]}));
      }})});
  await provider.complete({messages:[{role:'user',content:'Synthetic request'}],tools:[],requiredCapabilities:['text'],
    reasoningEffort:'none',maxOutputTokens:123,signal,deadline:new Date(Date.now()+2000).toISOString()});
  const body=JSON.parse(captured.init.body);
  assert.equal(body.reasoning_effort,undefined);assert.deepEqual(body.chat_template_kwargs,{thinking:false});
  assert.equal(body.max_tokens,123);assert.equal(captured.init.headers.authorization,`Bearer ${key}`);
  assert.equal(captured.init.redirect,'error');assert.ok(captured.init.signal instanceof AbortSignal);
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
