import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {AgentArtsRealtimeModelGateway} from '../dist/index.js';

const target='wss://agentarts.example.test/runtimes/voice-runtime/invocations?endpoint=fixed-v1';
class Socket extends EventEmitter {
  static instances=[];readyState=0;bufferedAmount=0;sent=[];
  constructor(){super();Socket.instances.push(this);queueMicrotask(()=>{this.readyState=1;this.emit('open');this.receive({type:'session.created'});});}
  receive(frame){this.emit('message',Buffer.from(JSON.stringify(frame)));}
  send(payload){const frame=JSON.parse(payload);this.sent.push(frame);if(frame.type==='session.update')queueMicrotask(()=>this.receive({type:'session.updated'}));}
  close(){this.readyState=3;queueMicrotask(()=>this.emit('close'));}
  terminate(){this.close();}
}
const options=preparePayload=>({websocketUrl:target,authorizationProvider:{read:async()=> 'Bearer explicit-fixture'},
  websocketAuthorizationProvider:{read:async()=> 'Bearer explicit-fixture'},preparePayload});
const request=()=>({signal:new AbortController().signal,deadline:new Date(Date.now()+30000).toISOString(),
  instructions:'explicit public test fixture',tools:[],onEvent(){},onTool:async()=> 'public test fixture'});

test('realtime local denial prevents even the initial context frame from reaching the socket',async()=>{
  Socket.instances=[];
  const gateway=new AgentArtsRealtimeModelGateway(options(async()=>{throw Error('local denial');}),Socket);
  await assert.rejects(gateway.connect(request()));assert.equal(Socket.instances[0].sent.length,0);
});

test('realtime text is prepared in order and original audio remains unavailable without local content classification',async t=>{
  Socket.instances=[];const prepared=[],checked=[];
  const gateway=new AgentArtsRealtimeModelGateway(options(async scope=>{
    prepared.push(scope);assert.equal(scope.destination,target);assert.equal(scope.payload.includes('Bearer'),false);
    return {assertBeforeSend(actual){assert.equal(actual.destination,scope.destination);assert.equal(actual.payload,scope.payload);checked.push(JSON.parse(actual.payload).type);}};
  }),Socket);
  const session=await gateway.connect(request());t.after(()=>session.close());
  assert.throws(()=>session.sendAudio(new Uint8Array([0,0])),error=>error.code==='UNSUPPORTED_CAPABILITY');
  session.askUserQuestion('public test question');await new Promise(setImmediate);
  assert.deepEqual(checked,['session.update','conversation.item.create','response.create']);
  assert.deepEqual(Socket.instances[0].sent.map(frame=>frame.type),checked);assert.equal(prepared.length,3);
});
