import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AgentArtsCloudAgentPort} from '../dist/index.js';
import {SyntheticWebSocket,identity,events} from './fixtures/websocket.mjs';

const config={gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic',transport:'wss',
  websocketUrl:'wss://agentarts.example.test/runtimes/synthetic/ws',allowHttpsFallback:true};
const saved=()=>({sessionId:'original-session',requestId:'original-request',idempotencyKey:'original-key',
  payloadDigest:'a'.repeat(64),accepted:true,serverInstanceId:'synthetic-instance'});
const control=overrides=>({deadline:new Date(Date.now()+3000).toISOString(),signal:new AbortController().signal,...overrides});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const status=(frame,state='unknown')=>({...identity(frame),type:'status',state,
  ...(state==='completed'?{events:events(JSON.stringify({kind:'tool_proposal',proposalId:'untrusted'}))}:{}),
  ...(['failed','cancelled'].includes(state)?{code:'EXTERNAL_FAILURE'}:{})});
function harness({respond=(frame,socket)=>socket.receive(status(frame)),autoReady=true,read=async()=>'Bearer outer',factory}={}) {
  const sockets=[],headers=[]; let fetches=0,outerReads=0,innerReads=0;
  const port=new AgentArtsCloudAgentPort(config,{read:async()=>{outerReads++;return read();}},
    async()=>{fetches++;throw Error('No HTTP lookup');},undefined,undefined,undefined,{
      authorizationProvider:{read:async()=>{innerReads++;return 'Bearer inner';}},
      factory:(url,options)=>{headers.push(options);const socket=factory?factory():new SyntheticWebSocket(respond,{autoReady});sockets.push(socket);return socket;}});
  return {port,sockets,headers,get fetches(){return fetches;},get reads(){return [outerReads,innerReads];}};
}

test('status returns the existing untrusted status union with one read-only frame, current auth and no invoke',async()=>{
  for(const state of ['running','completed','failed','cancelled','unknown']) {
    const h=harness({respond:(frame,socket)=>socket.receive(status(frame,state))});
    try {
      const receipt=saved(),result=await h.port.queryStatus(receipt,control());
      assert.equal(result.state,state);assert.equal(result.requestId,receipt.requestId);
      assert.deepEqual(h.sockets[0].sent.map(frame=>frame.type),['status']);
      assert.equal(h.sockets[0].terminations,1);assert.equal(h.fetches,0);assert.deepEqual(h.reads,[1,1]);
      const options=h.headers[0];assert.equal(options.headers.Authorization,'Bearer outer');
      assert.equal(options.headers['X-PA-Agent-Token'],'Bearer inner');
      assert.equal(options.headers['x-hw-agentarts-session-id'],receipt.sessionId);
      assert.equal(options.rejectUnauthorized,true);assert.equal(options.followRedirects,false);
      assert.equal(Object.hasOwn(result,'verification'),false);
      if(state==='completed') assert.equal(result.events[0].data.text.includes('untrusted'),true);
      assert.deepEqual(receipt,saved());
    } finally {h.port.close();}
  }
});

test('every identity mismatch or unsolicited result fails closed without HTTPS or replay',async()=>{
  for(const field of ['sessionId','requestId','idempotencyKey','payloadDigest','serverInstanceId','type']) {
    const h=harness({respond:(frame,socket)=>socket.receive(field==='type'
      ?{...identity(frame),type:'result',events:events('unsolicited')}
      :{...status(frame),[field]:field==='payloadDigest'?'b'.repeat(64):'other'})});
    try {
      await assert.rejects(h.port.queryStatus(saved(),control()),{code:'EXTERNAL_FAILURE'});
      assert.deepEqual(h.sockets[0].sent.map(frame=>frame.type),['status']);
      assert.equal(h.sockets[0].terminations,1);assert.equal(h.fetches,0);
    } finally {h.port.close();}
  }
});

test('old/missing server instance is unknown and never probes another instance cache or repeats invoke',async()=>{
  for(const serverInstanceId of [undefined,'retired-instance']) {
    const receipt=saved();if(serverInstanceId===undefined)delete receipt.serverInstanceId;else receipt.serverInstanceId=serverInstanceId;
    const h=harness({respond:()=>{throw Error('No query on an unbound instance');}});
    try {
      assert.equal((await h.port.queryStatus(receipt,control())).state,'unknown');
      assert.equal(h.sockets[0].sent.length,0);assert.equal(h.sockets[0].terminations,1);assert.equal(h.fetches,0);
    } finally {h.port.close();}
  }
});

test('cancel, timeout and adapter close release lookup sockets and never send cancel to the original work',async()=>{
  for(const [mode,autoReady] of [['cancel',false],['cancel',true],['timeout',false],['timeout',true],['close',true]]) {
    const h=harness({autoReady,respond:()=>{}}),controller=new AbortController();
    try {
      const pending=h.port.queryStatus(saved(),control({signal:controller.signal,
        ...(mode==='timeout'?{deadline:new Date(Date.now()+45).toISOString()}:{})}));
      const rejected=assert.rejects(pending,{code:mode==='timeout'?'TIMEOUT':'CANCELLED'});
      while(h.sockets.length===0) await settle();
      if(autoReady)await settle();
      if(mode==='cancel')controller.abort();else if(mode==='close')h.port.close();
      await rejected;
      assert.equal(h.sockets[0].terminations,1);assert.equal(h.fetches,0);
      assert.ok(h.sockets[0].sent.every(frame=>frame.type==='status'));
    } finally {h.port.close();}
  }
});

test('receipt is snapshotted before credentials; invalid receipt and handshake cannot send a status',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const h=harness({read:()=>gate}),receipt=saved();
  try {
    const pending=h.port.queryStatus(receipt,control());receipt.requestId='replacement';release('Bearer outer');
    assert.equal((await pending).requestId,'original-request');
    await assert.rejects(h.port.queryStatus({...saved(),payloadDigest:'bad'},control()),{code:'INVALID_ARGUMENT'});
    assert.deepEqual(h.reads,[1,1]);
  } finally {h.port.close();}
  for(const mode of ['no-status','401','connect-failure']) {
    const bad=harness({autoReady:false,...(mode==='connect-failure'?{factory:()=>{throw Error('private-credential');}}:{})});
    try {
      const pending=bad.port.queryStatus(saved(),control());
      const rejected=assert.rejects(pending,error=>error.code===(mode==='401'?'UNAUTHORIZED':mode==='no-status'?'UNSUPPORTED_CAPABILITY':'EXTERNAL_FAILURE')&&!error.message.includes('private'));
      if(mode!=='connect-failure') {
        while(bad.sockets.length===0)await settle();
        if(mode==='401')bad.sockets[0].emit('unexpected-response',{}, {statusCode:401,resume(){}});
        else bad.sockets[0].ready({capabilities:['invoke','cancel']});
      }
      await rejected;assert.equal(bad.fetches,0);
      assert.ok(bad.sockets.every(socket=>socket.sent.length===0&&socket.terminations===1));
    } finally {bad.port.close();}
  }
});
