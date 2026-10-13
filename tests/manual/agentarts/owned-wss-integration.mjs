// Hermetic network integration, not a live AgentArts acceptance record.
// Build the owned-agent workspaces first. Set PA_TEST_TLS_DIR to a synthetic
// key.pem/cert.pem directory whose certificate SAN includes IP 127.0.0.1.
// The wrapper trusts that certificate only in its child process. No credentials,
// external network, system trust changes, or paid model calls are involved.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer as createHttpsServer} from 'node:https';
import {request as httpRequest} from 'node:http';
import {connect as connectTcp} from 'node:net';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import WebSocket from 'ws';
import {AgentArtsCloudAgentPort,AgentArtsResultUnknownError} from '@personal-agent/coordination';
import {OwnedAgentOrchestrator} from '@personal-agent/agentarts';
import {FakeModelProvider} from '@personal-agent/models';
import {createAgentServer} from '@personal-agent/agentarts-runtime';
import {encodeAgentArtsTransportFrame,parseAgentArtsTransportFrame} from '@personal-agent/contracts/agentarts-transport';

const fixture=process.env.PA_TEST_TLS_DIR;
assert.ok(fixture,'PA_TEST_TLS_DIR must name explicitly synthetic TLS fixtures');
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED,'0','TLS verification must remain enabled');
const fixturePath=path.resolve(fixture);
if (!process.argv.includes('--trusted-fixture-child')) {
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('PA_AGENT_')&&name!=='NODE_TLS_REJECT_UNAUTHORIZED'));
  env.PA_TEST_TLS_DIR=fixturePath;
  env.NODE_EXTRA_CA_CERTS=path.join(fixturePath,'cert.pem');
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--trusted-fixture-child'],{env,stdio:'inherit'});
  const [code,signal]=await once(child,'close');
  assert.equal(signal,null,'Network integration child was interrupted');
  process.exitCode=code ?? 1;
} else {
  const outer='Bearer synthetic-platform-credential';
  const secret='synthetic-inner-token-for-wss-network-integration';
  const fast=new FakeModelProvider([
    {kind:'final',text:JSON.stringify({kind:'text',text:'合成WSS答复一'})},
    {kind:'final',text:JSON.stringify({kind:'text',text:'合成WSS答复二'})},
    {kind:'final',text:JSON.stringify({kind:'text',text:'合成HTTPS备用答复'})},
    ()=>new Promise(()=>{}),()=>new Promise(()=>{}),()=>new Promise(()=>{}),
  ]);
  const unused=new FakeModelProvider([]);
  const orchestrator=new OwnedAgentOrchestrator({fast,world:unused,plan:unused,review:unused},2048);
  const ports=[],rawSockets=new Set(),pairs=new Set();
  let backend;
  let backendPort;
  let dropNextUpgrade=false;
  let upgrades=0,httpsInvocations=0,statusQueries=0;
  const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const close=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  const wait=async(predicate,label)=>{
    const expires=Date.now()+3000;
    while(!predicate()) {assert.ok(Date.now()<expires,`Timed out: ${label}`);await new Promise(resolve=>setTimeout(resolve,5));}
  };
  const startBackend=async()=>{
    backend=createAgentServer({mode:'standalone-validation',wssAuthToken:secret,orchestrator,timeoutMs:5000});
    await listen(backend);backendPort=backend.address().port;
  };
  await startBackend();
  const proxy=createHttpsServer({key:await readFile(path.join(fixturePath,'key.pem')),
    cert:await readFile(path.join(fixturePath,'cert.pem'))},(request,response)=>{
    if(request.headers.authorization!==outer) {response.writeHead(401);response.end();return;}
    const route=request.url?.replace(/^\/runtimes\/owned/,'');
    if(!['/invocations','/invocation-status'].includes(route)) {response.writeHead(404);response.end();return;}
    if(route==='/invocations') httpsInvocations++;else statusQueries++;
    const upstream=httpRequest({hostname:'127.0.0.1',port:backendPort,path:route,method:request.method,
      headers:{...request.headers,host:`127.0.0.1:${backendPort}`}},reply=>{
      response.writeHead(reply.statusCode,reply.headers);reply.pipe(response);
    });
    upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});
    request.on('aborted',()=>upstream.destroy());request.pipe(upstream);
  });
  proxy.on('upgrade',(request,socket,head)=>{
    if(request.url!=='/runtimes/owned/ws'||request.headers.authorization!==outer) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;
    }
    if(dropNextUpgrade) {dropNextUpgrade=false;socket.destroy();return;}
    upgrades++;
    const upstream=connectTcp({host:'127.0.0.1',port:backendPort});
    const pair={socket,upstream,sessionId:request.headers['x-hw-agentarts-session-id']};pairs.add(pair);
    const dispose=()=>{pairs.delete(pair);socket.destroy();upstream.destroy();};
    socket.on('error',dispose);upstream.on('error',dispose);
    socket.once('close',dispose);upstream.once('close',dispose);
    upstream.once('connect',()=>{
      const headers=Object.entries(request.headers).map(([name,value])=>`${name}: ${Array.isArray(value)?value.join(', '):value}`).join('\r\n');
      upstream.write(`GET /ws HTTP/1.1\r\n${headers}\r\n\r\n`);
      if(head.length)upstream.write(head);
      socket.pipe(upstream);upstream.pipe(socket);
    });
  });
  await listen(proxy);
  const origin=`https://127.0.0.1:${proxy.address().port}`;
  const wsUrl=origin.replace('https:','wss:')+'/runtimes/owned/ws';
  const configuration={gatewayUrl:origin,runtimeName:'owned',transport:'wss',websocketUrl:wsUrl,
    responseMode:'tool-proposal-json',allowHttpsFallback:true};
  const createPort=(options={})=>{
    const dispatches=[],terminals=[],states=[],intents=new Map();
    const port=new AgentArtsCloudAgentPort(configuration,{read:async()=>outer},undefined,()=>{},undefined,undefined,{
      authorizationProvider:{read:async()=>`Bearer ${options.secret ?? secret}`},
      onState:state=>states.push(state),
      onDispatch:(request,receipt)=>{dispatches.push({request,receipt});intents.set(receipt.requestId,receipt);},
      onTerminal:(_request,receipt)=>{terminals.push(receipt);intents.delete(receipt.requestId);},
    });
    ports.push(port);return {port,dispatches,terminals,states,intents};
  };
  const invocation=(taskId,revision,overrides={})=>({taskId,revision,goal:'分析合成网络测试数据',
    deadline:new Date(Date.now()+4000).toISOString(),signal:new AbortController().signal,...overrides});
  const status=async receipt=>{
    const response=await fetch(origin+'/runtimes/owned/invocation-status',{method:'POST',
      headers:{'content-type':'application/json',authorization:outer,'x-pa-agent-token':`Bearer ${secret}`,
        'x-hw-agentarts-session-id':receipt.sessionId},
      body:JSON.stringify({protocolVersion:'0.1.0',type:'status',sessionId:receipt.sessionId,requestId:receipt.requestId,
        idempotencyKey:receipt.idempotencyKey,payloadDigest:receipt.payloadDigest})});
    assert.equal(response.status,200);return parseAgentArtsTransportFrame(await response.json());
  };
  const raw=async sessionId=>{
    const socket=new WebSocket(wsUrl,{headers:{Authorization:outer,'X-PA-Agent-Token':`Bearer ${secret}`,
      'x-hw-agentarts-session-id':sessionId},rejectUnauthorized:true,followRedirects:false,perMessageDeflate:false});
    rawSockets.add(socket);socket.once('close',()=>rawSockets.delete(socket));socket.on('error',()=>{});
    const queue=[],waiters=[];
    socket.on('message',bytes=>{
      const frame=parseAgentArtsTransportFrame(JSON.parse(bytes.toString()));
      const index=waiters.findIndex(waiter=>waiter.type===frame.type);
      if(index<0)queue.push(frame);else {const [waiter]=waiters.splice(index,1);clearTimeout(waiter.timer);waiter.resolve(frame);}
    });
    const next=type=>{
      const index=queue.findIndex(frame=>frame.type===type);
      if(index>=0)return Promise.resolve(queue.splice(index,1)[0]);
      return new Promise((resolve,reject)=>{
        const waiter={type,resolve,timer:undefined};
        waiter.timer=setTimeout(()=>reject(Error(`Missing network frame ${type}`)),2000);waiters.push(waiter);
      });
    };
    await once(socket,'open');const ready=await next('ready');return {socket,next,ready};
  };
  const cases=[];
  try {
    const normal=createPort();
    const first=invocation('synthetic-resident-session',1);
    assert.deepEqual(await normal.port.invoke(first),{kind:'text',text:'合成WSS答复一',verification:'unverified'});
    assert.equal((await normal.port.invoke(invocation(first.taskId,2))).text,'合成WSS答复二');
    assert.equal(upgrades,1);assert.equal(httpsInvocations,0);assert.equal(fast.requests.length,2);
    assert.equal(normal.dispatches.length,2);assert.equal(normal.terminals.length,2);assert.equal(normal.intents.size,0);
    assert.equal(normal.dispatches[0].receipt.sessionId,normal.dispatches[1].receipt.sessionId);
    assert.notEqual(normal.dispatches[0].receipt.requestId,normal.dispatches[1].receipt.requestId);
    cases.push('trusted-tls-real-client','same-session-reuse');

    const firstReceipt=normal.dispatches[0].receipt;
    const replay=await raw(firstReceipt.sessionId);
    assert.equal(replay.ready.restartRecovery,false);
    replay.socket.send(encodeAgentArtsTransportFrame({protocolVersion:'0.1.0',type:'invoke',
      sessionId:firstReceipt.sessionId,requestId:firstReceipt.requestId,idempotencyKey:firstReceipt.idempotencyKey,
      payloadDigest:firstReceipt.payloadDigest,deadline:first.deadline,payload:{query:first.goal}}));
    await replay.next('accepted');assert.equal((await replay.next('result')).events[0].event,'message');
    assert.equal(fast.requests.length,2);replay.socket.terminate();cases.push('explicit-confirmed-replay-no-model-repeat');

    const strict=await raw('synthetic-strict-session'),strictClose=once(strict.socket,'close');
    strict.socket.send(JSON.stringify({protocolVersion:'0.1.0',type:'invoke',sessionId:'synthetic-strict-session',
      requestId:'strict-request',idempotencyKey:'strict-request',payloadDigest:firstReceipt.payloadDigest,
      deadline:first.deadline,payload:{query:first.goal},grant:true}));
    assert.equal((await strictClose)[0],1008);assert.equal(fast.requests.length,2);cases.push('strict-envelope-rejection');

    const denied=createPort({secret:'synthetic-wrong-inner-credential'}),beforeDeniedHttp=httpsInvocations;
    await assert.rejects(denied.port.invoke(invocation('synthetic-denied',1)),{code:'UNAUTHORIZED'});
    assert.equal(httpsInvocations,beforeDeniedHttp);assert.equal(fast.requests.length,2);assert.equal(denied.dispatches.length,0);
    cases.push('auth-denial-no-fallback');

    const fallback=createPort();dropNextUpgrade=true;
    assert.equal((await fallback.port.invoke(invocation('synthetic-fallback',1))).text,'合成HTTPS备用答复');
    assert.equal(httpsInvocations,1);assert.equal(fast.requests.length,3);
    assert.equal(fallback.states.some(state=>state.state==='https_fallback'),true);
    cases.push('pre-send-only-https-fallback');

    const cancelled=new AbortController();
    const cancellation=normal.port.invoke(invocation(first.taskId,3,{signal:cancelled.signal}));
    await wait(()=>fast.requests.length===4,'cancel invocation starts');
    const cancelledReceipt=normal.dispatches.at(-1).receipt;
    cancelled.abort();await assert.rejects(cancellation,{code:'CANCELLED'});
    await wait(()=>fast.requests[3].signal.aborted,'cancel reaches model');
    assert.equal((await status(cancelledReceipt)).state,'cancelled');
    assert.equal(normal.intents.has(cancelledReceipt.requestId),true);
    assert.equal(fast.requests.length,4);assert.equal(httpsInvocations,1);
    cases.push('cancel-signal-readback-no-replay');

    const disconnected=normal.port.invoke(invocation(first.taskId,4));
    await wait(()=>fast.requests.length===5,'disconnect invocation starts');
    const disconnectedReceipt=normal.dispatches.at(-1).receipt;
    for(const pair of pairs)if(pair.sessionId===disconnectedReceipt.sessionId){pair.socket.destroy();pair.upstream.destroy();}
    await assert.rejects(disconnected,error=>error instanceof AgentArtsResultUnknownError
      && error.receipt.requestId===disconnectedReceipt.requestId && error.retryable===false);
    await wait(()=>fast.requests[4].signal.aborted,'disconnect reaches model');
    assert.equal(normal.intents.has(disconnectedReceipt.requestId),true);
    assert.equal(httpsInvocations,1);assert.equal(fast.requests.length,5);
    cases.push('post-send-disconnect-unknown-no-replay');

    const closing=createPort(),shutdown=closing.port.invoke(invocation('synthetic-shutdown',1));
    const stopped=assert.rejects(shutdown,AgentArtsResultUnknownError);
    await wait(()=>fast.requests.length===6,'shutdown invocation starts');
    await close(backend);
    await stopped;
    await wait(()=>fast.requests[5].signal.aborted,'shutdown reaches model');
    await wait(()=>pairs.size===0,'upgraded sockets close');cases.push('server-close-cleans-upgrade-and-cancels');
    await startBackend();
    const lost=await status(disconnectedReceipt);assert.equal(lost.state,'unknown');
    assert.notEqual(lost.serverInstanceId,replay.ready.serverInstanceId);
    assert.equal(fast.requests.length,6);assert.equal(httpsInvocations,1);assert.equal(unused.requests.length,0);
    cases.push('restart-status-unknown-no-replay');
    assert.equal(JSON.stringify([...normal.states,...fallback.states,...denied.states]).includes(secret),false);
    process.stdout.write(JSON.stringify({status:'passed',profile:'huawei_ict_agentarts',evidence:'mock-model-real-tls-transport',
      realWebSocketClient:true,tlsVerification:true,loopbackOnly:true,externalNetwork:false,modelProvider:'fake',
      modelCalls:fast.requests.length,httpsInvocations,statusQueries,cases})+'\n');
  } finally {
    for(const port of ports)port.close();
    for(const socket of rawSockets)socket.terminate();
    for(const pair of pairs){pair.socket.destroy();pair.upstream.destroy();}
    await close(backend);await close(proxy);
  }
}
