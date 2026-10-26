import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequestDeadlineModel} from '../src/request-deadline-model.mjs';
import {scheduleExpiry} from '../src/invocation-timeout.mjs';

test('real provider remains active after 60 seconds and aborts at original deadline with max reasoning',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-23T00:00:00Z')});
  let started,signal,body;
  const dispatched=new Promise(resolve=>{started=resolve;});
  const model=createRequestDeadlineModel({baseUrl:'https://synthetic.invalid/v1',model:'synthetic',apiKey:()=> 'synthetic',
    nativeReasoning:{thinking:'enabled',effort:'max',supportedEfforts:['xhigh','max'],outputTokenParameter:'max_completion_tokens'},
    fetch:async(_url,options)=>{
      signal=options.signal;body=JSON.parse(options.body);started();
      return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
    }});
  const pending=model.complete({deadline:new Date(Date.now()+180_000).toISOString(),signal:new AbortController().signal,
    tools:[],messages:[{role:'user',content:'synthetic request'}]});
  const rejected=assert.rejects(pending,{code:'TIMEOUT'});
  await dispatched;
  assert.equal(body.reasoning_effort,'max');
  assert.deepEqual(body.thinking,{type:'enabled'});
  t.mock.timers.tick(60_001);
  assert.equal(signal.aborted,false);
  t.mock.timers.tick(119_999);
  assert.equal(signal.aborted,true);
  await rejected;
});

test('model timeout follows remaining task deadline without changing reasoning or route',async()=>{
  const options={model:'explicit-model',nativeReasoning:{thinking:'enabled',effort:'max'},fetch:()=>{}};
  const configurations=[],requests=[],deployment={provider:'openai-compatible',model:'explicit-model',capabilities:{text:true}};
  const model=createRequestDeadlineModel(options,{createProvider:configuration=>{
    configurations.push(configuration);
    return {deployment,complete:async request=>{requests.push(request);return 'result';}};
  }});
  const request={deadline:new Date(Date.now()+180_000).toISOString(),signal:new AbortController().signal};
  assert.equal(await model.complete(request),'result');
  assert.ok(configurations[1].timeoutMs>170_000);
  assert.ok(configurations[1].timeoutMs<=180_000);
  assert.equal(configurations[1].fetch,options.fetch);
  assert.equal(configurations[1].nativeReasoning,options.nativeReasoning);
  assert.equal(requests[0],request);
  assert.equal(model.deployment,deployment);
});
test('explicit model timeout remains a shorter bound and expired/cancelled requests never call provider',async()=>{
  let calls=0;
  const configs=[];
  const model=createRequestDeadlineModel({}, {timeoutMs:1234,createProvider:configuration=>{
    configs.push(configuration);return {deployment:{},complete:async()=>{calls++;}};
  }});
  const signal=new AbortController().signal;
  await model.complete({deadline:new Date(Date.now()+180_000).toISOString(),signal});
  assert.ok(configs[1].timeoutMs<=1234);
  assert.throws(()=>model.complete({deadline:'invalid',signal}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>model.complete({deadline:new Date(0).toISOString(),signal}),{code:'TIMEOUT'});
  const controller=new AbortController();controller.abort();
  assert.throws(()=>model.complete({deadline:new Date(Date.now()+1000).toISOString(),signal:controller.signal}));
  assert.equal(calls,1);
});
test('deadline timers re-arm platform-sized chunks and can be disposed',t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  let calls=0;
  const cancel=scheduleExpiry(1000+2_147_483_647+10,()=>calls++);
  t.mock.timers.tick(2_147_483_647);
  assert.equal(calls,0);
  t.mock.timers.tick(10);
  assert.equal(calls,1);
  cancel();
  const dispose=scheduleExpiry(Date.now()+10,()=>calls++);
  dispose();t.mock.timers.tick(10);assert.equal(calls,1);
});
