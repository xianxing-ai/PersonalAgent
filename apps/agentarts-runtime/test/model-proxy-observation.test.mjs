import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenAICompatibleModelProvider} from '@personal-agent/models';
import {createAgentArtsModelFetch} from '../src/model-proxy.mjs';

const endpoint='https://proxy.synthetic.invalid/inference/v1';
const model='registered-model';
const request=signal=>({messages:[{role:'user',content:'fixture'}],tools:[],deadline:new Date(Date.now()+10000).toISOString(),signal});
const reply=actual=>Response.json({model:actual,choices:[{message:{content:'ok'}}]});

test('concurrent replies bind locally without upstream request IDs and do not log unknown model text',async()=>{
 const records=[];let n=0;
 const guarded=createAgentArtsModelFetch({endpoint,model,authentication:{kind:'api_key',headerName:'x-key',readSecret:()=> 'fixture-secret'},onRecord:r=>records.push(r),fetch:async()=>reply(++n===1?model:'unknown-secret-model')});
 const provider=new OpenAICompatibleModelProvider({baseUrl:endpoint,model,apiKey:()=> 'fixture-secret',fetch:guarded,onResponseModel:(response,value)=>guarded.recordResponseModel(response,value)});
 const [a,b]=await Promise.all([provider.complete(request(new AbortController().signal)),provider.complete(request(new AbortController().signal))]);
 assert.equal(a.response.text,'ok');assert.equal(b.response.text,'ok');
 const received=records.filter(r=>r.event==='model_proxy_response');const observed=records.filter(r=>r.event==='model_proxy_response_model');
 assert.equal(received.length,2);assert.equal(observed.length,2);assert.notEqual(received[0].correlationId,received[1].correlationId);
 assert.ok(received.every(r=>r.requestId===null&&r.responseModel===null));
 assert.deepEqual(observed.map(r=>r.correlationId).sort(),received.map(r=>r.correlationId).sort());
 assert.equal(observed.filter(r=>r.responseModel===model&&r.modelMismatch===false).length,1);
 assert.equal(observed.filter(r=>r.responseModel===null&&r.modelMismatch===true).length,1);
 assert.equal(observed.find(r=>r.responseModel===model).correlationId,received[0].correlationId);
 assert.equal(observed.find(r=>r.modelMismatch===true).correlationId,received[1].correlationId);
 assert.equal(JSON.stringify(records).includes('unknown-secret-model'),false);assert.equal(JSON.stringify(records).includes('fixture-secret'),false);
});

test('failed and cancelled responses never invent a model observation',async()=>{
 const records=[];let calls=0;
 const guarded=createAgentArtsModelFetch({endpoint,model,authentication:{kind:'api_key',headerName:'x-key',readSecret:()=> 'fixture-secret'},onRecord:r=>records.push(r),fetch:async()=>++calls===1?new Response('',{status:401}):new Response(new ReadableStream({pull(){return new Promise(()=>{});}}))});
 const provider=new OpenAICompatibleModelProvider({baseUrl:endpoint,model,apiKey:()=> 'fixture-secret',fetch:guarded,onResponseModel:(response,value)=>guarded.recordResponseModel(response,value)});
 await assert.rejects(provider.complete(request(new AbortController().signal)),{code:'UNAUTHORIZED'});
 const c=new AbortController();const pending=provider.complete(request(c.signal));setTimeout(()=>c.abort(),20);
 await assert.rejects(pending,{code:'CANCELLED'});
 assert.equal(records.filter(r=>r.event==='model_proxy_response_model').length,0);

});
test('proxy returns headers without waiting for a slow response body',async()=>{
 const response=new Response(new ReadableStream({pull(){return new Promise(()=>{});}}));
 const guarded=createAgentArtsModelFetch({endpoint,model,authentication:{kind:'api_key',headerName:'x-key',readSecret:()=> 'fixture-secret'},fetch:async()=>response});
 let timer;try {
  const result=await Promise.race([guarded(endpoint+'/chat/completions',{method:'POST',headers:{},body:JSON.stringify({model,stream:false}),signal:new AbortController().signal}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('response body blocked proxy')),300);})]);
  assert.equal(result,response);assert.equal(response.bodyUsed,false);
 } finally {clearTimeout(timer);}
});
