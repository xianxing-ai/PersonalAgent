import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {WebSocket} from 'ws';
import {OwnedAgentOrchestrator,getOwnedBindings} from '@personal-agent/agentarts';
import {FakeModelProvider} from '@personal-agent/models';
import {digestAgentArtsPayload,parseAgentArtsTransportFrame} from '@personal-agent/contracts/agentarts-transport';
import {createAgentServer} from '../src/server.mjs';

const token='synthetic-owned-binding-credential-32-chars';
const auth={'x-pa-agent-token':`Bearer ${token}`};
const catalog=getOwnedBindings();
const fast=catalog.find(binding=>binding.roles.join(',')==='fast');
const worldBinding=catalog.find(binding=>binding.roles.join(',')==='world');
const planBinding=catalog.find(binding=>binding.roles.join(',')==='plan');
const reviewBinding=catalog.find(binding=>binding.roles.join(',')==='review');
const controller=catalog.find(binding=>binding.type==='controller'&&binding.origin==='new-owned-binding');
const context={expectedGraphRevision:7,targets:[{node:{id:'plan',revision:2},requestedSummary:'局部修复',requestedDependencies:[{id:'fact',revision:3}]}],allowedDependencies:[{id:'fact',revision:3}]};
const change={node:context.targets[0].node,summary:'局部修复',reason:'已观察的变化',dependencies:context.targets[0].requestedDependencies};
const world={disposition:'REVISE',affected:['plan'],reason:'已观察的变化',missing_information:[]};
const plan={disposition:'REVISE',changes:[change],missing_information:[]};
const candidate={kind:'repair_candidate',candidateVersion:'1.0',candidate:{expectedGraphRevision:7,changes:[change]}};
const repair=JSON.stringify({continuation:{proposalId:'synthetic-read',state:'confirmed',result:{repairContext:context}}});
const app={kind:'text',text:'synthetic binding answer'};
const envelope=(binding,query='synthetic ordinary goal',extra={})=>({bindingVersion:'1.0.0',type:binding.type,id:binding.id,query,...extra});
const wrapper=(binding,result={kind:'application_result',value:app})=>({bindingVersion:'1.0.0',binding:{id:binding.id,name:binding.name,type:binding.type,origin:binding.origin},verification:'unverified',result});
function realOrchestrator() {
  const values={fast:app,world,plan,review:candidate};
  const models=Object.fromEntries(Object.entries(values).map(([role,value])=>[role,
    new FakeModelProvider(Array.from({length:32},()=>({kind:'final',text:JSON.stringify(value)})))]));
  return {orchestrator:new OwnedAgentOrchestrator(models,2048),models};
}
async function host(t,options={}) {
  const real=realOrchestrator();
  const server=createAgentServer({mode:'standalone-validation',wssAuthToken:token,
    getBindings:getOwnedBindings,orchestrator:real.orchestrator,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const address=`127.0.0.1:${server.address().port}`;
  return {...real,server,url:`http://${address}`,wsUrl:`ws://${address}/ws`};
}
const post=(url,value,headers=auth)=>fetch(url+'/invocations',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({query:typeof value==='string'?value:JSON.stringify(value)})});
const output=async response=>JSON.parse((await response.json())[0].data.text);
async function connect(t,wsUrl) {
  const socket=new WebSocket(wsUrl,{headers:{...auth,'x-hw-agentarts-session-id':'synthetic-bindings'}});
  const queue=[],waiters=[];
  socket.on('error',()=>{});
  socket.on('message',bytes=>{
    const value=parseAgentArtsTransportFrame(JSON.parse(bytes.toString()));
    const index=waiters.findIndex(waiter=>waiter.type===value.type);
    if(index<0)queue.push(value);
    else{const [waiter]=waiters.splice(index,1);clearTimeout(waiter.timer);waiter.resolve(value);}
  });
  t.after(()=>socket.terminate());
  const next=type=>{
    const index=queue.findIndex(value=>value.type===type);
    if(index>=0)return Promise.resolve(queue.splice(index,1)[0]);
    return new Promise((resolve,reject)=>{
      const waiter={type,resolve};
      waiter.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error(`Missing ${type}`));},2000);
      waiters.push(waiter);
    });
  };
  await once(socket,'open');await next('ready');
  return {socket,next,send:value=>socket.send(JSON.stringify(value))};
}
const frame=(value,id='1')=>{
  const payload={query:JSON.stringify(value)};
  return {protocolVersion:'0.1.0',type:'invoke',sessionId:'synthetic-bindings',requestId:`request-${id}`,
    idempotencyKey:`binding-${id}`,payloadDigest:digestAgentArtsPayload(payload),deadline:new Date(Date.now()+3000).toISOString(),payload};
};
const control=(value,type)=>({protocolVersion:value.protocolVersion,type,sessionId:value.sessionId,
  requestId:value.requestId,idempotencyKey:value.idempotencyKey,payloadDigest:value.payloadDigest});

test('protected discovery lists exactly the eleven owned identities and no model configuration',async t=>{
  const {url}=await host(t,{authToken:'synthetic-outer-credential-at-least-32'});
  assert.equal((await fetch(url+'/bindings')).status,401);
  assert.equal((await fetch(url+'/bindings',{headers:{authorization:'Bearer synthetic-outer-credential-at-least-32'}})).status,401);
  assert.equal((await fetch(url+'/bindings',{headers:{...auth,'x-pa-agent-token':'Bearer invalid'}})).status,401);
  const response=await fetch(url+'/bindings',{headers:auth});assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.bindingVersion,'1.0.0');assert.equal(result.verification,'unverified');
  assert.deepEqual(result.bindings,catalog);assert.equal(result.bindings.length,11);
  assert.equal(result.bindings.filter(binding=>binding.type==='workflow').length,8);
  assert.equal(result.bindings.filter(binding=>binding.type==='controller').length,3);
  assert.equal(JSON.stringify(result).includes(token),false);
  for(const binding of result.bindings)assert.deepEqual(Object.keys(binding),['id','name','type','roles','origin','requirements']);
  const disabled=await host(t,{wssAuthToken:undefined});assert.equal((await fetch(disabled.url+'/bindings',{headers:auth})).status,503);
  const legacy=await host(t,{getBindings:undefined,orchestrator:{invoke:async()=>app}});
  assert.equal((await fetch(legacy.url+'/bindings',{headers:auth})).status,503);
  assert.equal((await post(legacy.url,envelope(fast))).status,503);
  assert.deepEqual(await output(await post(legacy.url,'ordinary legacy query')),app);
});

test('all eight workflows and three controllers dispatch through actual core over HTTP',async t=>{
  const {url,models}=await host(t);
  for(const binding of catalog){
    const needsRepair=binding.roles.includes('world')&&binding.roles.length===1
      ||binding.roles.includes('plan')&&binding.roles.length===1||binding.roles.includes('review')&&binding.roles.length===1
      ||binding.requirements.includes('repair_input');
    const extra={...(binding.requirements.includes('world_report')?{world}:{}),...(binding.requirements.includes('plan_report')?{plan}:{})};
    const response=await post(url,envelope(binding,needsRepair?repair:'synthetic ordinary goal',extra));
    assert.equal(response.status,200,binding.name);
    const result=await output(response);assert.equal(result.binding.id,binding.id);assert.equal(result.verification,'unverified');
    assert.equal(Object.hasOwn(result,'kind'),false);
    assert.equal(result.result.kind,binding===worldBinding||binding.roles.join(',')==='plan'?'role_report':'application_result');
  }
  assert.equal(models.world.requests.length,2);assert.equal(models.plan.requests.length,3);assert.equal(models.review.requests.length,3);
});

test('explicit bindings require the inner credential while ordinary configured platform calls remain compatible',async t=>{
  const outer='synthetic-outer-credential-at-least-32';
  const {url,models}=await host(t,{authToken:outer});
  assert.equal((await post(url,envelope(fast),{authorization:`Bearer ${outer}`})).status,401);
  assert.equal(models.fast.requests.length,0);
  assert.deepEqual(await output(await post(url,'ordinary query',{authorization:`Bearer ${outer}`})),app);
  assert.equal((await post(url,envelope(fast),auth)).status,200);
});

test('bad versions, unknown identities, fields and unnecessary or oversized reports fail before model calls',async t=>{
  const {url,models}=await host(t);
  for(const [value,status] of [
    [{...envelope(fast),bindingVersion:'2.0.0'},400],
    [{...envelope(fast),bindingVersion:undefined},400],
    [{...envelope(fast),id:'unknown-binding'},503],
    [{...envelope(fast),type:'controller'},503],
    [{...envelope(fast),grant:true},400],
    [{...envelope(fast),query:42},400],
    [{...envelope(fast),query:'x'.repeat(1_100_001)},400],
    [{...envelope(fast),world},400],
    [{...envelope(controller),plan},400],
    [envelope(planBinding,repair),400],
    [envelope(reviewBinding,repair,{world}),400],
    [envelope(planBinding,repair,{world:{note:'x'.repeat(16_001)}}),400],
    [envelope(planBinding,repair,{world:null}),400],
    ['{"bindingVersion":"1.0.0",broken',400],
  ]){const response=await post(url,value);assert.equal(response.status,status);await response.text();}
  assert.equal(Object.values(models).reduce((total,model)=>total+model.requests.length,0),0);
});

test('actual WS keeps role reports in binding wrappers and never produces an old executable candidate',async t=>{
  const {wsUrl,models}=await host(t),connection=await connect(t,wsUrl);
  for(const [binding,extra,expected] of [[worldBinding,{},'world'],[planBinding,{world},'plan'],[reviewBinding,{world,plan},'application_result']]){
    const value=frame(envelope(binding,repair,extra),binding.id);connection.send(value);await connection.next('accepted');
    const result=JSON.parse((await connection.next('result')).events[0].data.text);
    assert.equal(result.binding.id,binding.id);assert.equal(result.verification,'unverified');assert.equal(Object.hasOwn(result,'kind'),false);
    if(expected==='application_result')assert.deepEqual(result.result,{kind:'application_result',value:candidate});
    else assert.equal(result.result.role,expected);
  }
  assert.equal(models.world.requests.length,1);assert.equal(models.plan.requests.length,1);assert.equal(models.review.requests.length,1);
  const bad=frame({...envelope(fast),bindingVersion:'2.0.0'},'bad');connection.send(bad);await connection.next('accepted');
  assert.equal((await connection.next('error')).code,'INVALID_ARGUMENT');assert.equal(models.fast.requests.length,0);
});

test('valid non-ASCII World reports retain the core JSON character budget through actual Plan dispatch',async t=>{
  const report={...world,reason:'已确认变化'.repeat(1600)};
  const encoded=JSON.stringify(report);
  assert.ok(encoded.length<=16_000);assert.ok(Buffer.byteLength(encoded,'utf8')>16_000);
  const {url,models}=await host(t);
  const response=await post(url,envelope(planBinding,repair,{world:report}));
  assert.equal(response.status,200);
  const result=await output(response);assert.equal(result.result.kind,'role_report');assert.equal(result.result.role,'plan');
  assert.deepEqual(result.result.value,plan);assert.equal(models.plan.requests.length,1);
  assert.deepEqual(JSON.parse(models.plan.requests[0].messages[1].content).world,report);
  const overLimit={...world,reason:'中'.repeat(16_001)};
  assert.ok(JSON.stringify(overLimit).length>16_000);
  assert.equal((await post(url,envelope(planBinding,repair,{world:overLimit}))).status,400);
  assert.equal(models.plan.requests.length,1);
  const outOfScope={...report,affected:['not-in-repair-context']};
  const invalid=await post(url,envelope(planBinding,repair,{world:outOfScope}));
  assert.equal(invalid.status,502);assert.match(await invalid.text(),/EXTERNAL_FAILURE/);
  assert.equal(models.plan.requests.length,1);
});

test('trusted default controller preserves legacy HTTP and WS application output without changing explicit bindings',async t=>{
  const {url,wsUrl,models}=await host(t,{defaultControllerId:controller.id});
  assert.deepEqual(await output(await post(url,'ordinary legacy query')),app);
  const connection=await connect(t,wsUrl);const payload={query:'ordinary legacy query'};
  const value={...frame(envelope(fast),'default'),payload,payloadDigest:digestAgentArtsPayload(payload)};
  connection.send(value);await connection.next('accepted');
  assert.deepEqual(JSON.parse((await connection.next('result')).events[0].data.text),app);
  assert.equal((await output(await post(url,envelope(fast)))).binding.id,fast.id);
  assert.equal(models.fast.requests.length,3);
  for(const defaultControllerId of ['missing',fast.id,''])assert.throws(()=>createAgentServer({mode:'agentarts',
    orchestrator:realOrchestrator().orchestrator,getBindings:getOwnedBindings,defaultControllerId}),{code:'INVALID_ARGUMENT'});
});

test('default controller rejects forged trust and report outputs instead of unwrapping them',async t=>{
  for(const bad of [{...wrapper(controller),verification:'verified'},wrapper(controller,{kind:'role_report',role:'world',value:world}),
    wrapper(controller,{kind:'application_result',value:{...app,verification:'verified'}})]){
    const {url}=await host(t,{defaultControllerId:controller.id,orchestrator:{invoke:async()=>app,
      invokeWorkflow:async()=>wrapper(fast),invokeController:async()=>bad}});
    const response=await post(url,'ordinary query');assert.equal(response.status,502);assert.match(await response.text(),/EXTERNAL_FAILURE/);
  }
});

test('bound calls share HTTP/WS limits, cancellation, deadlines and shutdown with ordinary invocation',async t=>{
  const calls=[];let started;
  const {url,wsUrl,server}=await host(t,{timeoutMs:150,maxConcurrency:1,orchestrator:{invoke:async()=>app,
    invokeWorkflow:request=>{calls.push(request);started?.(request);return new Promise(()=>{});},invokeController:async()=>wrapper(controller)}});
  const connection=await connect(t,wsUrl);const value=frame(envelope(fast),'cancel');connection.send(value);await connection.next('accepted');
  assert.equal((await post(url,envelope(fast))).status,429);
  assert.equal((await fetch(url+'/bindings',{headers:auth})).status,200);
  connection.send(control(value,'cancel'));assert.equal((await connection.next('error')).code,'CANCELLED');
  assert.equal(calls[0].signal.aborted,true);
  const timeout=await post(url,envelope(fast));assert.equal(timeout.status,504);await timeout.text();assert.equal(calls[1].signal.aborted,true);
  const invoked=new Promise(resolve=>started=resolve);
  const request=httpRequest(url+'/invocations',{method:'POST',headers:{'content-type':'application/json',...auth}});
  request.on('error',()=>{});request.end(JSON.stringify({query:JSON.stringify(envelope(fast))}));
  const invocation=await invoked;const cancelled=once(invocation.signal,'abort');request.destroy();await cancelled;
  assert.equal(invocation.signal.aborted,true);
  const final=frame(envelope(fast),'shutdown');connection.send(final);await connection.next('accepted');
  const closed=once(connection.socket,'close');server.close();await closed;assert.equal(calls.at(-1).signal.aborted,true);
});
