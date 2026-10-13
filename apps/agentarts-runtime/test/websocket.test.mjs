import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {digestAgentArtsPayload, parseAgentArtsTransportFrame} from '@personal-agent/contracts/agentarts-transport';
import {createAgentServer} from '../src/server.mjs';

const token = 'synthetic-wss-secret-for-offline-tests';
const auth = sessionId => ({'x-pa-agent-token':`Bearer ${token}`,'x-hw-agentarts-session-id':sessionId});
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
const invokeFrame = (overrides={}) => {
  const payload = overrides.payload ?? {query:'合成传输请求'};
  return {protocolVersion:'0.1.0',type:'invoke',sessionId:'synthetic-session',requestId:'request-1',
    idempotencyKey:'invocation-1',payloadDigest:digestAgentArtsPayload(payload),
    deadline:new Date(Date.now()+3000).toISOString(),payload,...overrides};
};
const control = (frame,type) => ({protocolVersion:frame.protocolVersion,type,sessionId:frame.sessionId,
  requestId:frame.requestId,idempotencyKey:frame.idempotencyKey,payloadDigest:frame.payloadDigest});
async function host(t,options={}) {
  const calls=[];
  const server=createAgentServer({mode:'standalone-validation',wssAuthToken:token,
    orchestrator:{invoke:async value=>{calls.push(value); return {kind:'text',text:'合成答复'};}},...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve); server.closeAllConnections();}));
  const port=server.address().port;
  return {server,calls,url:`http://127.0.0.1:${port}`,wsUrl:`ws://127.0.0.1:${port}/ws`};
}
async function connect(t,address,sessionId='synthetic-session',options={}) {
  const socket=new WebSocket(address,{headers:auth(sessionId),...options});
  const queue=[],waiters=[];
  socket.on('error',()=>{});
  socket.on('message',data=>{
    const frame=parseAgentArtsTransportFrame(JSON.parse(data.toString()));
    const index=waiters.findIndex(waiter=>waiter.type===frame.type);
    if(index<0) queue.push(frame);
    else {const [waiter]=waiters.splice(index,1); clearTimeout(waiter.timer); waiter.resolve(frame);}
  });
  t.after(()=>socket.terminate());
  const next=type=>{
    const index=queue.findIndex(frame=>frame.type===type);
    if(index>=0) return Promise.resolve(queue.splice(index,1)[0]);
    return new Promise((resolve,reject)=>{
      const waiter={type,resolve,timer:undefined};
      waiter.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error(`Missing ${type} transport frame`));},2000);
      waiters.push(waiter);
    });
  };
  await once(socket,'open');
  const ready=await next('ready');
  return {socket,next,ready,send:frame=>socket.send(JSON.stringify(frame))};
}
async function rejectedUpgrade(address,headers) {
  const socket=new WebSocket(address,{headers});
  socket.on('error',()=>{});
  return new Promise(resolve=>socket.once('unexpected-response',(_,response)=>{
    const code=response.statusCode; response.resume(); socket.terminate(); resolve(code);
  }));
}
const statusRequest=(url,frame,headers=auth(frame.sessionId))=>fetch(url+'/invocation-status',{
  method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(control(frame,'status')),
});

test('WS requires explicit inner credential/session and refuses URL credentials',async t=>{
  const {wsUrl,calls}=await host(t);
  assert.equal(await rejectedUpgrade(wsUrl,{}),401);
  assert.equal(await rejectedUpgrade(wsUrl,{'x-pa-agent-token':`Bearer ${token}`}),400);
  assert.equal(await rejectedUpgrade(wsUrl,{...auth('synthetic-session'),authorization:`Bearer ${token}`,'x-pa-agent-token':'Bearer wrong'}),401);
  assert.equal(await rejectedUpgrade(wsUrl+'?token=never-log-this',auth('synthetic-session')),404);
  const disabled=await host(t,{wssAuthToken:undefined});
  assert.equal(await rejectedUpgrade(disabled.wsUrl,auth('synthetic-session')),503);
  assert.equal((await statusRequest(disabled.url,invokeFrame())).status,503);
  assert.equal(calls.length,0);
});

test('ready advertises only ephemeral transport; result preserves existing HTTP events and deadline',async t=>{
  const {wsUrl,calls,url}=await host(t);
  const connection=await connect(t,wsUrl);
  assert.deepEqual(connection.ready.capabilities,['invoke','status','cancel','ephemeral-replay']);
  assert.equal(connection.ready.restartRecovery,false);
  const frame=invokeFrame(); connection.send(frame);
  const accepted=await connection.next('accepted');
  assert.equal(accepted.deadline,frame.deadline);
  assert.equal(accepted.payloadDigest,frame.payloadDigest);
  const result=await connection.next('result');
  assert.equal(result.serverInstanceId,connection.ready.serverInstanceId);
  assert.deepEqual(result.events,[{event:'message',data:{text:'{"kind":"text","text":"合成答复"}'}},{event:'task_end'},{event:'end'}]);
  assert.equal(calls.length,1); assert.equal(calls[0].sessionId,frame.sessionId);
  assert.equal(calls[0].requestId,frame.requestId); assert.equal(calls[0].deadline,frame.deadline);
  assert.equal((await (await statusRequest(url,frame)).json()).state,'completed');
});

test('HTTP fallback keeps legacy auth and separately validates the custom inner token',async t=>{
  const legacy='synthetic-legacy-token-for-offline-test';
  const {url,calls}=await host(t,{authToken:legacy});
  const post=headers=>fetch(url+'/invocations',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({query:'fallback'})});
  assert.equal((await post({authorization:`Bearer ${legacy}`})).status,200);
  assert.equal((await post({'x-pa-agent-token':`Bearer ${token}`,authorization:'Bearer outer-platform-credential'})).status,200);
  assert.equal((await post({'x-pa-agent-token':'Bearer wrong',authorization:`Bearer ${legacy}`})).status,401);
  assert.equal(calls.length,2);
});

test('WS legacy payload only uses the configured input and expired requests never invoke',async t=>{
  const {wsUrl,calls}=await host(t,{workflowGoalInput:'goal'}),connection=await connect(t,wsUrl);
  connection.send(invokeFrame({payload:{inputs:{goal:'合成旧Workflow'}}}));
  await connection.next('result'); assert.equal(calls[0].query,'合成旧Workflow');
  const wrong=invokeFrame({requestId:'wrong-request',idempotencyKey:'wrong-invocation',payload:{inputs:{unexpected:'x'}}});
  connection.send(wrong); assert.equal((await connection.next('error')).code,'INVALID_ARGUMENT');
  const expired=invokeFrame({requestId:'expired-request',idempotencyKey:'expired-invocation',deadline:'2020-01-01T00:00:00.000Z'});
  connection.send(expired); const error=await connection.next('error');
  assert.equal(error.code,'TIMEOUT'); assert.equal(error.accepted,false);
  assert.equal(calls.length,1);
});

test('duplicate active invocation and completed replay never call the provider twice',async t=>{
  let finish;
  const calls=[];
  const {wsUrl}=await host(t,{orchestrator:{invoke:value=>{calls.push(value);return new Promise(resolve=>{finish=resolve;});}}});
  const first=await connect(t,wsUrl),second=await connect(t,wsUrl),frame=invokeFrame();
  first.send(frame); await first.next('accepted');
  second.send(frame); await second.next('accepted');
  finish({kind:'text',text:'confirmed'});
  const result=await first.next('result'); assert.deepEqual(await second.next('result'),result);
  second.send(frame); await second.next('accepted'); assert.deepEqual(await second.next('result'),result);
  assert.equal(calls.length,1);
});

test('same key with substituted request, digest or deadline is rejected before invocation',async t=>{
  const {wsUrl,calls}=await host(t),connection=await connect(t,wsUrl),frame=invokeFrame();
  connection.send(frame); await connection.next('accepted'); await connection.next('result');
  for(const changed of [
    {...frame,requestId:'other-request'},
    invokeFrame({...frame,payload:{query:'different'},payloadDigest:digestAgentArtsPayload({query:'different'})}),
    {...frame,deadline:new Date(Date.parse(frame.deadline)+1).toISOString()},
  ]) {
    connection.send(changed); const error=await connection.next('error');
    assert.equal(error.code,'INVALID_ARGUMENT'); assert.equal(error.accepted,false);
  }
  assert.equal(calls.length,1);
});

test('bad versions, extra fields, binary and invalid UTF8 never reach the provider',async t=>{
  const {wsUrl,calls}=await host(t);
  for(const value of [{...invokeFrame(),protocolVersion:'1.0.0'},{...invokeFrame(),grant:true}]) {
    const connection=await connect(t,wsUrl);
    const close=once(connection.socket,'close'); connection.send(value);
    assert.equal((await close)[0],1008);
  }
  const binary=await connect(t,wsUrl),binaryClosed=once(binary.socket,'close');
  binary.socket.send(Buffer.from('{}')); assert.equal((await binaryClosed)[0],1003);
  const utf8=await connect(t,wsUrl),utf8Closed=once(utf8.socket,'close');
  utf8.socket.send(Buffer.from([0xc3,0x28]),{binary:false}); assert.equal((await utf8Closed)[0],1007);
  const oversized=await connect(t,wsUrl),oversizedClosed=once(oversized.socket,'close');
  oversized.socket.send('x'.repeat(1_200_001)); assert.equal((await oversizedClosed)[0],1009);
  assert.equal(calls.length,0);
});

test('session mismatch cannot invoke or read another session receipt',async t=>{
  const {wsUrl,url,calls}=await host(t),connection=await connect(t,wsUrl),frame=invokeFrame({sessionId:'other-session'});
  connection.send(frame); const error=await connection.next('error');
  assert.equal(error.code,'UNAUTHORIZED'); assert.equal(error.accepted,false);
  assert.equal((await statusRequest(url,frame,auth('synthetic-session'))).status,400);
  assert.equal((await statusRequest(url,frame,{'x-hw-agentarts-session-id':frame.sessionId})).status,401);
  assert.equal(calls.length,0);
});

test('status works while shared invocation slots are busy; WS and HTTP share the same limiter',async t=>{
  const {wsUrl,url}=await host(t,{maxConcurrency:1,orchestrator:{invoke:()=>new Promise(()=>{})}});
  const connection=await connect(t,wsUrl),frame=invokeFrame(); connection.send(frame); await connection.next('accepted');
  const state=await statusRequest(url,frame); assert.equal(state.status,200); assert.equal((await state.json()).state,'running');
  assert.equal((await fetch(url+'/invocations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'busy'})})).status,429);
  connection.send(invokeFrame({requestId:'request-2',idempotencyKey:'invocation-2'}));
  assert.equal((await connection.next('error')).code,'RATE_LIMITED');
  connection.send(control(frame,'cancel'));
  assert.equal((await connection.next('error')).code,'CANCELLED');
});

test('cancel acknowledges bounded stop and deadline releases noncooperative providers',async t=>{
  const calls=[];
  const {wsUrl,url}=await host(t,{timeoutMs:1000,orchestrator:{invoke:value=>{calls.push(value);return new Promise(()=>{});}}});
  const connection=await connect(t,wsUrl),frame=invokeFrame(); connection.send(frame); await connection.next('accepted');
  connection.send(control(frame,'cancel'));
  const error=await connection.next('error'); assert.equal(error.code,'CANCELLED'); assert.equal(error.accepted,true);
  assert.equal(calls[0].signal.aborted,true);
  assert.equal((await (await statusRequest(url,frame)).json()).state,'cancelled');
  const expired=invokeFrame({requestId:'deadline-request',idempotencyKey:'deadline-invocation',deadline:new Date(Date.now()+50).toISOString()});
  connection.send(expired); await connection.next('accepted');
  assert.equal((await connection.next('error')).code,'TIMEOUT');
  assert.equal(calls[1].signal.aborted,true);
  assert.equal((await (await fetch(url+'/ping')).json()).status,'Healthy');
});

test('disconnect cancels original invocation and reconnect status does not resend it',async t=>{
  const calls=[];
  const {wsUrl}=await host(t,{orchestrator:{invoke:value=>{calls.push(value);return new Promise(()=>{});}}});
  const first=await connect(t,wsUrl),frame=invokeFrame(); first.send(frame); await first.next('accepted');
  const aborted=once(calls[0].signal,'abort'); first.socket.terminate(); await aborted;
  const second=await connect(t,wsUrl); second.send(control(frame,'status'));
  const status=await second.next('status'); assert.equal(status.state,'cancelled'); assert.equal(status.code,'CANCELLED');
  second.send(frame); await second.next('accepted'); assert.equal((await second.next('error')).code,'CANCELLED');
  assert.equal(calls.length,1);
});

test('expired cache and a new server instance report unknown, never a fabricated durable receipt',async t=>{
  const {wsUrl,url}=await host(t,{websocket:{receiptTtlMs:20}});
  const first=await connect(t,wsUrl),frame=invokeFrame(); first.send(frame); await first.next('result');
  await delay(30);
  assert.equal((await (await statusRequest(url,frame)).json()).state,'unknown');
  const restarted=await host(t),second=await connect(t,restarted.wsUrl);
  assert.notEqual(second.ready.serverInstanceId,first.ready.serverInstanceId);
  second.send(control(frame,'status')); assert.equal((await second.next('status')).state,'unknown');
  assert.equal(restarted.calls.length,0);
});

test('cache capacity rejects new work instead of dropping a retained receipt',async t=>{
  const {wsUrl}=await host(t,{websocket:{receiptLimit:1}}),connection=await connect(t,wsUrl),frame=invokeFrame();
  connection.send(frame); await connection.next('result');
  connection.send(invokeFrame({requestId:'new-request',idempotencyKey:'new-invocation'}));
  const limited=await connection.next('error'); assert.equal(limited.code,'RATE_LIMITED'); assert.equal(limited.accepted,false);
  connection.send(control(frame,'status')); assert.equal((await connection.next('status')).state,'completed');
});

test('provider failures and oversized output are sanitized terminal failures',async t=>{
  for(const answer of [()=>{throw Error('synthetic-secret-provider-data');},()=>({kind:'text',text:'x'.repeat(65_000)})]) {
    const {wsUrl,url}=await host(t,{orchestrator:{invoke:answer}}),connection=await connect(t,wsUrl),frame=invokeFrame();
    connection.send(frame); const error=await connection.next('error');
    assert.equal(error.code,'EXTERNAL_FAILURE'); assert.equal(error.accepted,true);
    const status=await (await statusRequest(url,frame)).text();
    assert.equal(status.includes('synthetic-secret-provider-data'),false);
    assert.equal(JSON.parse(status).state,'failed');
  }
});

test('connection cap and missed heartbeat bound idle resources',async t=>{
  const {wsUrl}=await host(t,{websocket:{maxConnections:1,heartbeatMs:30}});
  const connection=await connect(t,wsUrl,'synthetic-session',{autoPong:false});
  assert.equal(await rejectedUpgrade(wsUrl,auth('synthetic-session')),429);
  // A client that cannot answer heartbeat simulates a lost connection.
  const closed=once(connection.socket,'close');
  assert.equal((await closed)[0],1006);
});
