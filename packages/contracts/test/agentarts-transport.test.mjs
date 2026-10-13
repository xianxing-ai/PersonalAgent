import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseAgentArtsTransportFrame,encodeAgentArtsTransportFrame,digestAgentArtsPayload} from '../dist/agentarts-transport.js';

const payload={query:'Read the public project status'};
const identity={protocolVersion:'0.1.0',sessionId:'test-session',requestId:'test-request',
  idempotencyKey:'test-request',payloadDigest:digestAgentArtsPayload(payload)};
const events=[{event:'message',data:{text:'{"kind":"text","text":"public result"}'}},
  {event:'task_end'},{event:'end'}];
const rejected=value=>assert.throws(()=>parseAgentArtsTransportFrame(value),{code:'INVALID_ARGUMENT'});

test('invoke preserves the existing single-key HTTP payload with a bound digest and deadline',()=>{
  const invoke={...identity,type:'invoke',deadline:'2026-10-09T15:00:00.000Z',payload};
  assert.deepEqual(JSON.parse(encodeAgentArtsTransportFrame(invoke)),invoke);
  const mapped={inputs:{goal:'public goal'}};
  assert.equal(parseAgentArtsTransportFrame({...invoke,payload:mapped,payloadDigest:digestAgentArtsPayload(mapped)}).payload.inputs.goal,'public goal');
  rejected({...invoke,payload:{query:payload.query,authorization:'injected'}});
  rejected({...invoke,payload:{inputs:{a:'first',b:'second'}}});
});
test('changed input, invalid UTC times and unregistered envelope fields are refused',()=>{
  const invoke={...identity,type:'invoke',deadline:'2026-10-09T15:00:00Z',payload};
  rejected({...invoke,payload:{query:'changed goal'}});
  rejected({...invoke,deadline:'2026-02-30T15:00:00Z'});
  rejected({...invoke,deadline:'2026-10-09T23:00:00+08:00'});
  rejected({...invoke,approved:true});
  rejected({...invoke,protocolVersion:'1.0.0'});
});
test('ready advertises ephemeral recovery and cannot claim cross-restart persistence',()=>{
  const ready={protocolVersion:'0.1.0',type:'ready',serverInstanceId:'instance-one',
    capabilities:['invoke','status','cancel','ephemeral-replay'],restartRecovery:false,heartbeatMs:15000};
  assert.deepEqual(parseAgentArtsTransportFrame(ready),ready);
  rejected({...ready,restartRecovery:true});
  rejected({...ready,capabilities:['execute-local-tool']});
});
test('only a complete ordered result can be recovered as completed',()=>{
  const status={...identity,type:'status',serverInstanceId:'instance-one',state:'completed',events};
  assert.deepEqual(parseAgentArtsTransportFrame(status),status);
  rejected({...status,events:[events[2],events[0],events[1]]});
  rejected({...status,events:events.slice(0,2)});
  rejected({...status,code:'EXTERNAL_FAILURE'});
  rejected({...status,state:'unknown'});
  rejected({...identity,type:'status',serverInstanceId:'instance-one',state:'failed'});
});
test('status and cancellation references cannot smuggle a new invocation',()=>{
  assert.equal(parseAgentArtsTransportFrame({...identity,type:'status'}).type,'status');
  assert.equal(parseAgentArtsTransportFrame({...identity,type:'cancel'}).type,'cancel');
  rejected({...identity,type:'cancel',payload});
  rejected({...identity,type:'status',deadline:'2026-10-09T15:00:00Z'});
  rejected({...identity,type:'error',serverInstanceId:'instance-one',code:'EXTERNAL_FAILURE',accepted:false,message:'private failure'});
});
test('wire and result limits measure UTF-8 bytes rather than character counts',()=>{
  const large={query:'界'.repeat(410000)};
  rejected({...identity,type:'invoke',deadline:'2026-10-09T15:00:00Z',payload:large,payloadDigest:digestAgentArtsPayload(large)});
  rejected({...identity,type:'result',serverInstanceId:'instance-one',events:[
    {event:'message',data:{text:'界'.repeat(22000)}},events[1],events[2]]});
});
