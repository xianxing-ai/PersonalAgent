import assert from 'node:assert/strict';
import test from 'node:test';
import {once,EventEmitter} from 'node:events';
import {request as httpRequest} from 'node:http';
import {WebSocket,WebSocketServer} from 'ws';
import {createAgentServer} from '../src/server.mjs';
import {AGENTARTS_REALTIME_PROTOCOL,createAgentRealtimeProxy,agentRealtimeProxyFromEnvironment} from '../src/realtime-proxy.mjs';

const token='explicit-synthetic-realtime-inner-secret';
const key='explicit-synthetic-upstream-api-key';
const protocol=AGENTARTS_REALTIME_PROTOCOL;
const deadline=()=>new Date(Date.now()+5000).toISOString();
const headers=()=>({'x-pa-agent-token':`Bearer ${token}`,authorization:'Bearer explicit-synthetic-outer-key',
  'x-hw-agentarts-session-id':'synthetic-realtime-session','x-pa-deadline':deadline()});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('upstream diagnostics retain only bounded status/request id and known codes, never secrets or bodies',async()=>{
 class FakeSocket extends EventEmitter {
   static instance;
   constructor(){super();this.readyState=WebSocket.CONNECTING;this.bufferedAmount=0;FakeSocket.instance=this;}
   terminate(){this.readyState=WebSocket.CLOSED;this.emit('close',1006);}
   close(){this.terminate();}
 }
 const cases=[{statusCode:401,headers:{'x-request-id':'request-safe_1'}},{statusCode:403,headers:{'x-request-id':key}},
   {statusCode:500,headers:{'x-request-id':'https://private.invalid/?key='+key}},{statusCode:999,headers:{'x-request-id':'synthetic-workspace'}}];
 for(const response of cases){
   const records=[];const down=new FakeSocket();down.readyState=WebSocket.OPEN;
   const proxy=createAgentRealtimeProxy({workspaceId:'synthetic-workspace',apiKey:key,Socket:FakeSocket,onRecord:value=>records.push(value)});
   const attached=proxy.attach(down,{deadline:deadline()});let resumed=0;
   FakeSocket.instance.emit('unexpected-response',{url:'private-url',headers:{authorization:key}},{...response,body:'private-body',resume(){resumed++;}});
   await attached.closed;assert.equal(resumed,1);assert.equal(records.length,1);
   assert.deepEqual(records[0],{event:'realtime_upstream_diagnostic',kind:'unexpected_response',httpStatus:response.statusCode===999?null:response.statusCode,
    requestId:response.statusCode===401?'request-safe_1':null,errorCode:'unknown'});
   for(const secret of [key,'synthetic-workspace','private-url','private-body'])assert.equal(JSON.stringify(records).includes(secret),false);
 }
 for(const code of ['ENOTFOUND','ECONNRESET',key]){
   const records=[],down=new FakeSocket();down.readyState=WebSocket.OPEN;
   const proxy=createAgentRealtimeProxy({workspaceId:'synthetic-workspace',apiKey:key,Socket:FakeSocket,onRecord:value=>records.push(value)});
   const attached=proxy.attach(down,{deadline:deadline()});FakeSocket.instance.emit('error',{code,message:key,url:'private-url'});await attached.closed;
   assert.equal(records[0].errorCode,code===key?'unknown':code);assert.equal(JSON.stringify(records).includes(key),false);
 }
});
async function until(predicate) {
  for(let i=0;i<200;i++){if(predicate())return;await delay(5);}
  assert.fail('Expected local realtime lifecycle state');
}
function inbox(socket) {
  const queue=[],waiting=[];
  socket.on('error',()=>{});
  socket.on('message',bytes=>{const next=waiting.shift();if(next){clearTimeout(next.timer);next.resolve(bytes.toString());}else queue.push(bytes.toString());});
  return ()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{
    const entry={resolve,timer:setTimeout(()=>{waiting.splice(waiting.indexOf(entry),1);reject(Error('Missing synthetic realtime frame'));},1500)};
    waiting.push(entry);
  });
}
async function host(t,{configured=true,proxyOptions={},serverOptions={},Socket,handshakeDelay=0,onUpstream}={}) {
  const received=[],targets=[],upstreams=[],upstreamHeaders=[];
  const upstream=new WebSocketServer({port:0,host:'127.0.0.1',perMessageDeflate:false,
    ...(handshakeDelay?{verifyClient:(_info,done)=>setTimeout(()=>done(true),handshakeDelay)}:{})});
  await once(upstream,'listening');
  const target=`ws://127.0.0.1:${upstream.address().port}/synthetic-upstream`;
  class LocalSocket extends WebSocket {
    constructor(address,options){targets.push({address,options});super(target,options);}
  }
  upstream.on('connection',(socket,request)=>{
    upstreams.push(socket);upstreamHeaders.push(request.headers);
    socket.on('error',()=>{});socket.on('message',bytes=>received.push(bytes.toString()));
    socket.send('{"type":"session.created","session":{"id":"synthetic-native-session"}}');
    onUpstream?.(socket);
  });
  const realtimeProxy=configured?createAgentRealtimeProxy({workspaceId:'synthetic-workspace',apiKey:key,Socket:Socket??LocalSocket,...proxyOptions}):undefined;
  const server=createAgentServer({mode:'standalone-validation',wssAuthToken:token,realtimeProxy,
    orchestrator:{invoke:async()=>({kind:'text',text:'synthetic original invoke'})},...serverOptions});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    await new Promise(resolve=>server.close(()=>resolve()));
    for(const socket of upstream.clients)socket.terminate();
    await new Promise(resolve=>upstream.close(resolve));
  });
  const address=`http://127.0.0.1:${server.address().port}`;
  return {server,received,targets,upstreams,upstreamHeaders,url:address,wsUrl:address.replace('http:','ws:')+'/ws',
    ping:async()=>(await(await fetch(address+'/ping')).json()).status,
    invoke:()=>fetch(address+'/invocations',{method:'POST',headers:{'content-type':'application/json'},body:'{"query":"synthetic"}'})};
}
async function connect(t,host,extra={},protocols=protocol) {
  const socket=new WebSocket(host.wsUrl,protocols,{headers:{...headers(),...extra}}),next=inbox(socket);
  t.after(()=>socket.terminate());await once(socket,'open');return {socket,next};
}
async function reject(address,extra={},protocols=protocol) {
  const supplied=Object.fromEntries(Object.entries({...headers(),...extra}).filter(([,value])=>value!==undefined));
  const socket=new WebSocket(address,protocols,{headers:supplied});socket.on('error',()=>{});
  return new Promise(resolve=>socket.once('unexpected-response',(_request,response)=>{
    const code=response.statusCode;response.resume();socket.terminate();resolve(code);
  }));
}

test('trusted realtime configuration fixes Beijing model/credential; absent configuration does not open a fallback',()=>{
  assert.equal(agentRealtimeProxyFromEnvironment({}),undefined);
  for(const config of [{workspaceId:'bad.example',apiKey:key},{workspaceId:'synthetic',apiKey:'bad key'},
    {workspaceId:'synthetic',apiKey:key,sessionTimeoutMs:121*60_000}])assert.throws(()=>createAgentRealtimeProxy(config),{code:'INVALID_ARGUMENT'});
  for(const config of [{PA_AGENT_REALTIME_WORKSPACE_ID:'synthetic'},{PA_AGENT_REALTIME_API_KEY:key}]) {
    assert.throws(()=>agentRealtimeProxyFromEnvironment(config),error=>error.code==='INVALID_ARGUMENT'&&!error.message.includes(key));
  }
});

test('one upgrade listener forwards native text/audio JSON exactly; ordinary invoke still returns its original protocol',async t=>{
  const h=await host(t);assert.equal(h.server.listenerCount('upgrade'),1);
  h.wsUrl+='?endpoint=synthetic-v5';
  const c=await connect(t,h);assert.equal(c.socket.protocol,protocol);
  assert.deepEqual(JSON.parse(await c.next()),{type:'session.created',session:{id:'synthetic-native-session'}});
  const update=' {"type":"session.update","session":{"instructions":"synthetic context","tools":[]}} ';
  const audio='{"type":"input_audio_buffer.append","audio":"AAAA"}';c.socket.send(update);c.socket.send(audio);
  await until(()=>h.received.length===2);assert.deepEqual(h.received,[update,audio]);
  const native='{"type":"response.audio.delta","response_id":"synthetic-response","delta":"AAAA"}';
  h.upstreams[0].send(native);assert.equal(await c.next(),native);
  assert.equal(h.targets[0].address,'wss://synthetic-workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime');
  assert.deepEqual(h.targets[0].options.headers,{Authorization:`Bearer ${key}`});
  assert.equal(h.targets[0].options.followRedirects,false);assert.equal(h.targets[0].options.perMessageDeflate,false);
  assert.equal(h.upstreamHeaders[0]['x-pa-agent-token'],undefined);
  assert.equal((await h.invoke()).status,200);
  const ordinary=await connect(t,h,{},[]);assert.equal(JSON.parse(await ordinary.next()).type,'ready');
});

test('missing config, explicit inner auth, session, deadline, query and mixed protocol reject before dialing',async t=>{
  const disabled=await host(t,{configured:false});assert.equal(await reject(disabled.wsUrl),503);
  const h=await host(t);
  assert.equal(await reject(h.wsUrl,{'x-pa-agent-token':undefined,authorization:`Bearer ${token}`}),401);
  assert.equal(await reject(h.wsUrl,{'x-pa-agent-token':'Bearer wrong'}),401);
  assert.equal(await reject(h.wsUrl,{'x-hw-agentarts-session-id':'invalid:session'}),400);
  assert.equal(await reject(h.wsUrl,{'x-pa-deadline':undefined}),400);
  assert.equal(await reject(h.wsUrl,{'x-pa-deadline':'2027-02-30T00:00:00Z'}),400);
  assert.equal(await reject(h.wsUrl,{'x-pa-deadline':'2020-01-01T00:00:00Z'}),408);
  assert.equal(await reject(h.wsUrl+'?endpoint=synthetic&key=never-forward'),404);
  assert.equal(await reject(h.wsUrl,{},['other',protocol]),400);assert.equal(h.targets.length,0);
});

test('native client frames queued while the trusted upstream connects retain order and original bytes',async t=>{
  const h=await host(t,{handshakeDelay:70}),c=await connect(t,h);
  const frames=['{"type":"session.update","session":{"instructions":"first"}}','{"type":"input_audio_buffer.append","audio":"AAAA"}'];
  for(const frame of frames)c.socket.send(frame);
  assert.equal(h.received.length,0);await c.next();await until(()=>h.received.length===2);assert.deepEqual(h.received,frames);
});

test('pending upstream handshake and reverse audio both enforce the byte buffer limit',async t=>{
  const pending=await host(t,{handshakeDelay:150,proxyOptions:{maxBufferedBytes:128}}),c=await connect(t,pending);
  const closed=once(c.socket,'close');
  c.socket.send(JSON.stringify({type:'session.update',session:{instructions:'x'.repeat(150)}}));
  assert.equal((await closed)[0],1013);assert.equal(pending.received.length,0);assert.equal(pending.targets.length,1);
  const reverse=await host(t,{proxyOptions:{maxBufferedBytes:128}}),other=await connect(t,reverse);await other.next();
  const reverseClosed=once(other.socket,'close');
  reverse.upstreams[0].send(JSON.stringify({type:'response.audio.delta',delta:'A'.repeat(150)}));
  assert.equal((await reverseClosed)[0],1013);
});

test('routing, credentials, alternate model, malformed UTF-8 and binary never reach the upstream',async t=>{
  const h=await host(t);
  const bad=[JSON.stringify({type:'session.update',session:{url:'wss://untrusted.invalid'}}),
    JSON.stringify({type:'session.update',apiKey:'never-forward'}),JSON.stringify({type:'session.update',session:{model:'other-model'}}),
    '{bad',[Buffer.from([0xff]),false],[Buffer.from([0,0]),true]];
  for(const value of bad) {
    const c=await connect(t,h);await c.next();const closed=once(c.socket,'close');
    const [data,binary]=Array.isArray(value)?value:[value,false];
    c.socket.send(data,{binary});await closed;
  }
  assert.equal(h.received.length,0);assert.equal(h.targets.length,bad.length);
});

test('oversized native audio frames close before any upstream audio is forwarded',async t=>{
  const h=await host(t),c=await connect(t,h);await c.next();const closed=once(c.socket,'close');
  c.socket.send(JSON.stringify({type:'input_audio_buffer.append',audio:'A'.repeat(1_200_000)}));
  assert.equal((await closed)[0],1009);assert.equal(h.received.length,0);
});

test('realtime reserves the shared concurrency slot and both sockets release it after client disconnect',async t=>{
  const h=await host(t,{serverOptions:{maxConcurrency:1}}),c=await connect(t,h);await c.next();
  assert.equal(await h.ping(),'HealthyBusy');assert.equal((await h.invoke()).status,429);
  assert.equal(await reject(h.wsUrl),429);const upstreamClosed=once(h.upstreams[0],'close');
  c.socket.close();await upstreamClosed;await delay(10);
  assert.equal(await h.ping(),'Healthy');assert.equal((await h.invoke()).status,200);
});

test('deadline clamps to the trusted session lifetime, closes both sides and prevents replay',async t=>{
  const h=await host(t,{proxyOptions:{sessionTimeoutMs:140},serverOptions:{maxConcurrency:1}}),c=await connect(t,h);await c.next();
  const upstreamClosed=once(h.upstreams[0],'close'),closed=once(c.socket,'close');await closed;await upstreamClosed;
  await delay(10);assert.equal(h.targets.length,1);assert.equal(await h.ping(),'Healthy');
});

test('realtime and ordinary sockets share the connection cap and missed heartbeat closes the upstream',async t=>{
  const h=await host(t,{serverOptions:{websocket:{maxConnections:1,heartbeatMs:40}}});
  const socket=new WebSocket(h.wsUrl,protocol,{headers:headers(),autoPong:false}),next=inbox(socket);
  t.after(()=>socket.terminate());await once(socket,'open');await next();
  const closed=once(socket,'close'),upstreamClosed=once(h.upstreams[0],'close');
  assert.equal(await reject(h.wsUrl,{},[]),429);await closed;await upstreamClosed;
  await delay(10);assert.equal(await h.ping(),'Healthy');
});

test('upstream close and construction failure expose only sanitized close reasons, with no retry',async t=>{
  const h=await host(t),c=await connect(t,h);await c.next();const closed=once(c.socket,'close');
  h.upstreams[0].close(1011,'synthetic-upstream-private-diagnostic');
  const [,reason]=await closed;assert.equal(reason.toString(),'Realtime upstream closed');assert.equal(h.targets.length,1);
  class Broken {constructor(){throw Error('synthetic-upstream-private-key');}}
  const broken=await host(t,{Socket:Broken,serverOptions:{maxConcurrency:1}}),other=await connect(t,broken);
  const [,safe]=await once(other.socket,'close');assert.equal(safe.toString(),'Realtime upstream unavailable');
  await delay(10);assert.equal(await broken.ping(),'Healthy');
});

class HeldSocket extends EventEmitter {
  static instances=[];
  constructor(){super();this.readyState=WebSocket.CONNECTING;this.bufferedAmount=0;HeldSocket.instances.push(this);
    queueMicrotask(()=>{this.readyState=WebSocket.OPEN;this.emit('open');this.emit('message',Buffer.from('{"type":"session.created"}'),false);});}
  send(_bytes,_options,callback){callback?.();}
  close(){this.readyState=WebSocket.CLOSING;}
  finish(){if(this.readyState===WebSocket.CLOSED)return;this.readyState=WebSocket.CLOSED;this.emit('close',1000);}
  terminate(){this.finish();}
}

test('buffer failure holds admission until the original upstream actually closes; release is exactly once',async t=>{
  const h=await host(t,{Socket:HeldSocket,proxyOptions:{maxBufferedBytes:128,closeTimeoutMs:300},serverOptions:{maxConcurrency:1}});
  const c=await connect(t,h);await c.next();const upstream=HeldSocket.instances.at(-1);upstream.bufferedAmount=128;
  const closed=once(c.socket,'close');c.socket.send('{"type":"response.create"}');await closed;
  assert.equal((await h.invoke()).status,429);upstream.finish();await delay(10);
  assert.equal(await h.ping(),'Healthy');assert.equal((await h.invoke()).status,200);
  upstream.emit('close',1000);assert.equal(await h.ping(),'Healthy');
});

test('invalid WebSocket handshake returns one response and releases a pre-upgrade realtime slot',async t=>{
  const h=await host(t,{serverOptions:{maxConcurrency:1}});
  const code=await new Promise(resolve=>{
    const request=httpRequest(h.url+'/ws',{headers:{...headers(),connection:'Upgrade',upgrade:'websocket',
      'sec-websocket-version':'13','sec-websocket-key':'invalid','sec-websocket-protocol':protocol}},response=>{
      const status=response.statusCode;response.resume();response.once('end',()=>resolve(status));});
    request.on('error',()=>resolve('unexpected_error'));request.end();
  });
  assert.equal(code,400);await delay(10);assert.equal(await h.ping(),'Healthy');assert.equal(h.targets.length,0);
});

test('server shutdown waits for original upstream release and closes the only upgrade listener',async t=>{
  const h=await host(t,{Socket:HeldSocket,proxyOptions:{closeTimeoutMs:60}}),c=await connect(t,h);await c.next();
  const upstream=HeldSocket.instances.at(-1);let finished=false;
  const closed=new Promise(resolve=>h.server.close(()=>{finished=true;resolve();}));
  await delay(15);assert.equal(finished,false);await closed;
  assert.equal(upstream.readyState,WebSocket.CLOSED);assert.equal(h.server.listenerCount('upgrade'),0);
});
