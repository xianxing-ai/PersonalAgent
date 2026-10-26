import assert from 'node:assert/strict';
import test from 'node:test';
import {request as httpRequest} from 'node:http';
import {createAgentServer} from '../src/server.mjs';

async function host(t, options={}) {
  const calls=[];
  const server=createAgentServer({mode:'standalone-validation',orchestrator:{invoke:async value=>{calls.push(value); return {kind:'text',text:'合成答复'};}},...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve); server.closeAllConnections();}));
  return {server,calls,url:`http://127.0.0.1:${server.address().port}`};
}
const post=(url,body,headers={})=>fetch(url+'/invocations',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
test('request deadline mode preserves deadlines beyond 60s and requires a deadline',async t=>{
  const {url,calls}=await host(t,{timeoutMode:'request-deadline'});
  assert.equal((await post(url,{query:'x'})).status,400);
  const deadline=new Date(Date.now()+180_000).toISOString();
  assert.equal((await post(url,{query:'x'},{'x-pa-deadline':deadline})).status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].deadline,deadline);
});
test('request deadline mode still honors an explicit shorter timeout',async t=>{
  const {url,calls}=await host(t,{timeoutMode:'request-deadline',timeoutMs:5000});
  assert.equal((await post(url,{query:'x'})).status,400);
  const before=Date.now();
  assert.equal((await post(url,{query:'x'},{'x-pa-deadline':new Date(before+180_000).toISOString()})).status,200);
  assert.ok(Date.parse(calls[0].deadline)>=before+5000);
  assert.ok(Date.parse(calls[0].deadline)<before+6000);
});
test('request deadline mode cancels noncooperative providers and releases slots at caller deadline',async t=>{
  let signal;
  const {url}=await host(t,{timeoutMode:'request-deadline',maxConcurrency:1,orchestrator:{invoke:async value=>{signal=value.signal;return new Promise(()=>{});}}});
  const response=await post(url,{query:'x'},{'x-pa-deadline':new Date(Date.now()+50).toISOString()});
  assert.equal(response.status,504);
  assert.equal(signal.aborted,true);
  assert.equal((await (await fetch(url+'/ping')).json()).status,'Healthy');
});
test('request deadline mode bounds slow uploads by the caller deadline',async t=>{
  const {url,calls}=await host(t,{timeoutMode:'request-deadline'});
  const request=httpRequest(url+'/invocations',{method:'POST',headers:{'content-type':'application/json','x-pa-deadline':new Date(Date.now()+40).toISOString()}});
  request.on('error',()=>{});
  const response=new Promise(resolve=>request.on('response',value=>{value.resume();value.on('end',()=>resolve(value.statusCode));}));
  request.write('{"query":');
  assert.equal(await response,504);
  request.destroy();
  assert.equal(calls.length,0);
  assert.equal((await (await fetch(url+'/ping')).json()).status,'Healthy');
});
test('ping and strict invocation preserve deadline/session and contract events',async t=>{
  const {url,calls}=await host(t);
  assert.equal((await (await fetch(url+'/ping')).json()).status,'Healthy');
  const deadline=new Date(Date.now()+2000).toISOString();
  const result=await post(url,{query:'你好'},{'x-pa-deadline':deadline,'x-hw-agentarts-session-id':'synthetic','x-request-id':'request-1'});
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),[{event:'message',data:{text:'{"kind":"text","text":"合成答复"}'}},{event:'task_end'},{event:'end'}]);
  assert.equal(calls[0].deadline,deadline); assert.equal(calls[0].sessionId,'synthetic');
});
test('auth, malformed input, forged fields, expired deadlines and oversized bodies never reach model',async t=>{
  const token='s'.repeat(32), {url,calls}=await host(t,{authToken:token});
  assert.equal((await post(url,{query:'x'})).status,401);
  for (const [body,extra] of [[{query:'x',grant:true},{}],[{inputs:{goal:'x'}},{}],[{query:'x'},{'x-pa-deadline':'yesterday'}],[{query:'x'},{'x-pa-deadline':'2020-01-01T00:00:00.000Z'}],[{query:'x'.repeat(1_200_000)},{}]]) {
    assert.notEqual((await post(url,body,{authorization:`Bearer ${token}`,...extra})).status,200);
  }
  assert.equal(calls.length,0);
});
test('configured legacy workflow input works, provider failures are sanitized, no fallback',async t=>{
  const {url}=await host(t,{workflowGoalInput:'goal',orchestrator:{invoke:async()=>{throw Error('synthetic-private-key');}}});
  const response=await post(url,{inputs:{goal:'x'}});
  assert.equal(response.status,502); const text=await response.text();
  assert.equal(text.includes('synthetic-private-key'),false); assert.match(text,/EXTERNAL_FAILURE/);
});
test('deadline and disconnect release concurrency even when provider ignores cancellation',async t=>{
  let started;
  const {url}=await host(t,{timeoutMs:70,maxConcurrency:1,orchestrator:{invoke:value=>{started?.(value);return new Promise(()=>{});}}});
  const timeout=await post(url,{query:'x'}); assert.equal(timeout.status,504);
  assert.equal((await (await fetch(url+'/ping')).json()).status,'Healthy');
  let invocation;
  const invoked=new Promise(resolve=>{started=resolve;});
  const request=httpRequest(url+'/invocations',{method:'POST',headers:{'content-type':'application/json'}});
  request.on('error',()=>{}); request.end(JSON.stringify({query:'x'}));
  invocation=await invoked;
  assert.equal((await post(url,{query:'x'})).status,429);
  const cancelled=new Promise(resolve=>invocation.signal.addEventListener('abort',resolve,{once:true}));
  request.destroy(); await cancelled;
  assert.equal(invocation.signal.aborted,true);
  assert.equal((await (await fetch(url+'/ping')).json()).status,'Healthy');
});
test('slow uploads do not invoke the provider after deadline',async t=>{
  const {url,calls}=await host(t,{timeoutMs:30});
  const request=httpRequest(url+'/invocations',{method:'POST',headers:{'content-type':'application/json'}});
  request.on('error',()=>{});
  const done=new Promise(resolve=>request.on('response',response=>{response.resume(); response.on('end',resolve);}));
  request.write('{"query":'); await done;
  request.end('"late"}');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,0);
});
test('actual HTTP canonical deadline accepts original Z, milliseconds and leap-day controls',async t=>{
  const {url,calls}=await host(t);
  for(const deadline of ['2027-02-28T00:00:00Z','2027-02-28T00:00:00.000Z','2027-02-28T00:00:00.123Z','2028-02-29T00:00:00Z']){
    const response=await post(url,{query:'Synthetic public deadline control'},{'x-pa-deadline':deadline});
    assert.equal(response.status,200);await response.json();
  }
  assert.equal(calls.length,4);
});
test('actual HTTP noncanonical calendar deadlines reject before Synthetic invoker dispatch',async t=>{
  const {url,calls}=await host(t);
  for(const deadline of ['2027-02-29T00:00:00Z','2027-02-30T00:00:00.000Z','2027-04-31T00:00:00.123Z','2027-13-01T00:00:00Z','2027-01-01T24:00:00Z']){
    const response=await post(url,{query:'Synthetic public invalid deadline'},{'x-pa-deadline':deadline});
    assert.equal(response.status,400);assert.equal((await response.json()).data.error_code,'INVALID_ARGUMENT');
  }
  assert.equal(calls.length,0);
});
