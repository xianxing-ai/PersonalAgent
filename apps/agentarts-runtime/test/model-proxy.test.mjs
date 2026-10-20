import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentArtsModelFetch} from '../src/model-proxy.mjs';
const endpoint='https://proxy.synthetic.invalid/inference/v1',model='registered-domestic-alias',secret='public-fixture-secret';
const init=()=>({method:'POST',headers:{authorization:'Bearer backend-must-not-leak','content-type':'application/json'},
  body:JSON.stringify({model,messages:[{role:'user',content:'public fixture'}],stream:false,reasoning_effort:'none'}),signal:new AbortController().signal});

test('JSON-only role output survives Huawei proxy translation without retries or text fallback',async()=>{
 let calls=0;const records=[];
 const fetch=createAgentArtsModelFetch({endpoint,model,requestProfile:'huawei-openai-v1',authentication:{kind:'api_key',headerName:'x-key',readSecret:()=>secret},
  onRecord:record=>records.push(record),
  fetch:async(_url,request)=>{calls++;const body=JSON.parse(request.body);assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(body.chat_template_kwargs.thinking,false);return Response.json({model});}});
 const request=init();request.body=JSON.stringify({...JSON.parse(request.body),response_format:{type:'json_object'}});
 await fetch(endpoint+'/chat/completions',request);assert.equal(calls,1);assert.equal(records.find(record=>record.event==='model_proxy_response').responseFormat,'json_object');
});
test('configured AgentArts Bearer ingress replaces backend auth and prefixes the raw key exactly once',async()=>{
 const fetch=createAgentArtsModelFetch({endpoint,model,authentication:{kind:'api_key',headerName:'Authorization',keyPrefix:'Bearer',readSecret:()=>secret},
  fetch:async(_url,request)=>{assert.equal(request.headers.get('authorization'),'Bearer '+secret);return Response.json({model});}});
 await fetch(endpoint+'/chat/completions',init());
 assert.throws(()=>createAgentArtsModelFetch({endpoint,model,authentication:{kind:'api_key',headerName:'authorization',keyPrefix:'Bearer\r\nextra',readSecret:()=>secret}}),{code:'INVALID_ARGUMENT'});
});
test('Huawei OpenAI backend protocol is translated only behind the AgentArts proxy',async()=>{
 const seen=[];let calls=0;const fetch=createAgentArtsModelFetch({endpoint,model,requestProfile:'huawei-openai-v1',
  authentication:{kind:'api_key',headerName:'x-key',readSecret:()=>secret},fetch:async(url,request)=>{
   calls++;assert.equal(url,endpoint+'/chat/completions');const body=JSON.parse(request.body);
   seen.push(body);assert.equal(body.chat_template_kwargs.thinking,body.reasoning_effort!==undefined);
   assert.equal(body.thinking,undefined);assert.equal(body.enable_thinking,undefined);return Response.json({model});
  }});
 await fetch(endpoint+'/chat/completions',init());assert.equal(calls,1);
 assert.equal(seen[0].reasoning_effort,undefined);assert.equal(seen[0].chat_template_kwargs.thinking,false);
 for(const reasoning_effort of ['low','high','max']){
  const depth=init();depth.body=JSON.stringify({...JSON.parse(depth.body),reasoning_effort});await fetch(endpoint+'/chat/completions',depth);
 }
 assert.deepEqual(seen.slice(1).map(body=>body.reasoning_effort),['low','high','max']);assert.equal(calls,4);
 for(const reasoning_effort of ['minimal','medium','xhigh','ultra']){
  const depth=init();depth.body=JSON.stringify({...JSON.parse(depth.body),reasoning_effort});
  await assert.rejects(fetch(endpoint+'/chat/completions',depth),{code:'UNSUPPORTED_CAPABILITY'});
 }
 assert.equal(calls,4);
});
test('proxy uses mapped model, configured key-name, safe timing and explicit Bailian thinking profile',async()=>{
 const records=[];let calls=0;
 const fetch=createAgentArtsModelFetch({endpoint,model,authentication:{kind:'api_key',headerName:'x-test-key',readSecret:()=>secret},
  requestProfile:'bailian-deepseek-v1',onRecord:r=>records.push(r),fetch:async(url,request)=>{
   calls++;assert.equal(url,endpoint+'/chat/completions');assert.equal(request.headers.get('authorization'),null);
   assert.equal(request.headers.get('x-test-key'),secret);assert.equal(request.redirect,'error');
   const body=JSON.parse(request.body);assert.equal(body.model,model);assert.equal(body.reasoning_effort,undefined);assert.equal(body.enable_thinking,false);
   return Response.json({model:'domestic-backend-actual-id',choices:[]},{headers:{'x-request-id':'trace-fixture'}});
  }});
 const response=await fetch(endpoint+'/chat/completions',init());assert.equal(response.status,200);assert.equal(calls,1);
 assert.equal(records.find(r=>r.event==='model_proxy_response').responseModel,'domestic-backend-actual-id');
 assert.ok(records.some(r=>r.status==='completed'&&r.finishedAtUtc&&r.wallMs>=0));
 assert.equal(JSON.stringify(records).includes(secret),false);assert.equal(JSON.stringify(records).includes('backend-must-not-leak'),false);
});
test('IAM signer receives exact payload; cancellation and endpoint mismatch never start a call',async()=>{
 let calls=0,signs=0;const fetch=createAgentArtsModelFetch({endpoint,model,authentication:{kind:'iam',signRequest:async input=>{
  signs++;assert.equal(input.headers.authorization,undefined);return {Authorization:'SDK-HMAC-SHA256 public-fixture'};
 }},fetch:async(_url,request)=>{calls++;assert.match(request.headers.get('authorization'),/^SDK-HMAC/u);return Response.json({model});}});
 await fetch(endpoint+'/chat/completions',init());assert.equal(calls,1);assert.equal(signs,1);
 await assert.rejects(fetch('https://api.modelarts-maas.com/openai/v1/chat/completions',init()),{code:'INVALID_ARGUMENT'});
 const controller=new AbortController();controller.abort();await assert.rejects(fetch(endpoint+'/chat/completions',{...init(),signal:controller.signal}));assert.equal(calls,1);
});
test('failure has one route and no fallback; unsafe auth or MCP endpoints are refused',async()=>{
 let calls=0;const fetch=createAgentArtsModelFetch({endpoint,model,authentication:{kind:'api_key',headerName:'x-key',readSecret:()=>secret},fetch:async()=>{calls++;throw new Error('fixture offline');}});
 await assert.rejects(fetch(endpoint+'/chat/completions',init()),/fixture offline/u);assert.equal(calls,1);
 for(const value of ['https://proxy.synthetic.invalid/mcp','https://proxy.synthetic.invalid/inference/v1?key=secret','http://proxy.synthetic.invalid/inference/v1'])
  assert.throws(()=>createAgentArtsModelFetch({endpoint:value,model,authentication:{kind:'api_key',headerName:'x-key',readSecret:()=>secret}}),{code:'INVALID_ARGUMENT'});
 assert.throws(()=>createAgentArtsModelFetch({endpoint,model,authentication:{kind:'api_key',headerName:'cookie',readSecret:()=>secret}}),{code:'INVALID_ARGUMENT'});
});
test('Bailian published reasoning depths map explicitly and do not pretend native streaming support',async()=>{
 const seen=[];const fetch=createAgentArtsModelFetch({endpoint,model,requestProfile:'bailian-deepseek-v1',
  authentication:{kind:'api_key',headerName:'x-key',readSecret:()=>secret},fetch:async(_url,request)=>{seen.push(JSON.parse(request.body));return Response.json({model});}});
 for(const reasoning_effort of ['minimal','low','medium','high','xhigh','max','ultra']){
  const request=init();request.body=JSON.stringify({...JSON.parse(request.body),reasoning_effort});await fetch(endpoint+'/chat/completions',request);
 }
 assert.deepEqual(seen.map(b=>b.reasoning_effort),['low','low','high','high','high','max','max']);assert.ok(seen.every(b=>b.enable_thinking===true));
 const streaming=init();streaming.body=JSON.stringify({...JSON.parse(streaming.body),stream:true});await assert.rejects(fetch(endpoint+'/chat/completions',streaming),{code:'INVALID_ARGUMENT'});
});
