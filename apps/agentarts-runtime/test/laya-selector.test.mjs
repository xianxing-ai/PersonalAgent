import assert from 'node:assert/strict';
import test from 'node:test';
import {createOwnedLayaSelector} from '../src/laya-selector.mjs';

const input=()=>({context:'Synthetic candidate data, not authorization',requestId:'synthetic',
  candidates:[{id:'proposal',description:'Use exact validated proposal'},{id:'review',description:'Review insufficient evidence'}],
  deadline:new Date(Date.now()+1000).toISOString(),signal:new AbortController().signal});
const answer=(overrides={})=>({answers:{decision:{choice:'candidate_0',probabilities:{candidate_0:0.8,candidate_1:0.2},answer_confidence:0.8,confidence:0.7,...overrides}}});
test('owned selector uses same typed choice API, original deadline and a loopback bearer only',async()=>{
  let payload;
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:8123/v1/systemone');assert.equal(options.headers.authorization,'Bearer synthetic-key');
    assert.equal(options.redirect,'error');payload=JSON.parse(options.body);return Response.json(answer());
  }});
  const original=input();assert.equal(await selector.select(original),'proposal');assert.equal(payload.deadline,original.deadline);
  assert.equal(payload.model,'multilingual');assert.deepEqual(Object.keys(payload.questions.decision.criteria),['candidate_0','candidate_1']);
  assert.equal(JSON.stringify(payload).includes('synthetic-key'),false);
});
test('invalid selection, probability identity or confidence cannot manufacture a candidate',async()=>{
  for(const overrides of [{choice:'execute-anything'},{probabilities:{candidate_0:0.8,candidate_7:0.2}},
    {choice:'candidate_1'},{answer_confidence:1},{probabilities:{candidate_0:0.8,candidate_1:0.8}}]) {
    const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async()=>Response.json(answer(overrides))});
    await assert.rejects(selector.select(input()),error=>error.code==='EXTERNAL_FAILURE');
  }
});
test('cancellation, expired deadline and unavailable instance never start another inference',async()=>{
  let calls=0;const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async()=>{calls++;return Response.json(answer());}});
  const original=input(), control=new AbortController();control.abort();
  await assert.rejects(selector.select({...original,signal:control.signal}),error=>error.code==='CANCELLED');
  await assert.rejects(selector.select({...original,deadline:'2020-01-01T00:00:00Z'}),error=>error.code==='TIMEOUT');
  assert.equal(calls,0);
  const unavailable=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',isReady:()=>false,request:async()=>{calls++;}});
  await assert.rejects(unavailable.select(input()),error=>error.code==='EXTERNAL_FAILURE');assert.equal(calls,0);
});
test('accepted-call timeout and service failure remain explicit without inference replay or fallback',async()=>{
  for(const [status,code] of [[408,'TIMEOUT'],[503,'EXTERNAL_FAILURE']]) {
    let calls=0;const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async()=>{calls++;return new Response('',{status});}});
    await assert.rejects(selector.select(input()),error=>error.code===code);assert.equal(calls,1);
  }
});
test('concurrent decisions share one forward queue and keep independent original candidates',async()=>{
  let release, started, posts=0, inFlight=0, peak=0;
  const first=new Promise(resolve=>release=resolve), entered=new Promise(resolve=>started=resolve);
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async(_url,options)=>{
    posts++;inFlight++;peak=Math.max(peak,inFlight);if(posts===1){started();await first;}
    const response=Response.json(answer());inFlight--;return response;
  }});
  const a=selector.select(input());await entered;
  const b=selector.select({...input(),candidates:[{id:'other-proposal',description:'other unchanged proposal'}, {id:'other-review',description:'other review'}]});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(posts,1);release();
  assert.deepEqual(await Promise.all([a,b]),['proposal','other-proposal']);assert.equal(peak,1);
});
test('queued cancellation and expiry never submit, renew deadline or consume another candidate result',async()=>{
  let release, started, posts=0;
  const first=new Promise(resolve=>release=resolve), entered=new Promise(resolve=>started=resolve);
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async()=>{
    posts++;if(posts===1){started();await first;}return Response.json(answer());
  }});
  const a=selector.select(input());await entered;
  const cancellation=new AbortController();
  const b=selector.select({...input(),signal:cancellation.signal});const cancelled=assert.rejects(b,error=>error.code==='CANCELLED');cancellation.abort();await cancelled;
  const c=selector.select({...input(),deadline:new Date(Date.now()+20).toISOString()});await assert.rejects(c,error=>error.code==='TIMEOUT');
  assert.equal(posts,1);release();assert.equal(await a,'proposal');
  assert.equal(await selector.select(input()),'proposal');assert.equal(posts,2);
});
test('rejected 429 waits for authenticated prior CPU completion before one accepted forward',async()=>{
  let posts=0,healthReads=0;
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async(url,options)=>{
    if(url.endsWith('/health')) {
      healthReads++;assert.equal(options.headers.authorization,'Bearer synthetic-key');
      return Response.json({status:'ok',model:'multilingual',warmed:true,inferenceBusy:healthReads<2});
    }
    posts++;return posts===1?new Response('',{status:429}):Response.json(answer());
  }});
  assert.equal(await selector.select(input()),'proposal');assert.equal(posts,2);assert.equal(healthReads,2);
});
test('after an accepted timeout the next choice checks CPU admission instead of overlapping it',async()=>{
  let posts=0,healthReads=0;
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async(url)=>{
    if(url.endsWith('/health')) {healthReads++;return Response.json({status:'ok',model:'multilingual',warmed:true,inferenceBusy:healthReads<2});}
    posts++;return posts===1?new Response('',{status:408}):Response.json(answer());
  }});
  await assert.rejects(selector.select(input()),error=>error.code==='TIMEOUT');
  assert.equal(await selector.select(input()),'proposal');assert.equal(posts,2);assert.equal(healthReads,2);
});
