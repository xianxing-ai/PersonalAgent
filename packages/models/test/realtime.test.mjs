import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {QwenRealtimeModelGateway} from '../dist/realtime.js';

class Socket extends EventEmitter {
  static current;
  readyState = 0; bufferedAmount = 0; sent = [];
  constructor(url, options) {super(); Socket.current = this; this.url = url; this.options = options;
    queueMicrotask(() => {this.readyState = 1; this.emit('open');});}
  send(value) {const data = JSON.parse(value); this.sent.push(data);
    if (data.type === 'session.update') queueMicrotask(() => this.receive({type:'session.updated'}));}
  receive(value) {this.emit('message', Buffer.from(JSON.stringify(value)));}
  close() {this.readyState = 3; queueMicrotask(() => this.emit('close'));}
  terminate() {this.close();}
}
async function connected(onTool = async () => 'ok') {
  const controller = new AbortController(), events = [];
  const gateway = new QwenRealtimeModelGateway({workspaceId:'test-space',apiKey:'not-a-real-key'}, Socket);
  const session = await gateway.connect({signal:controller.signal,deadline:new Date(Date.now()+30000).toISOString(),
    instructions:'PersonalAgent',tools:[{name:'request_work',description:'work',parameters:{type:'object'}}],
    onEvent:event=>events.push(event),onTool});
  return {session,socket:Socket.current,events,controller};
}

test('native PCM uses the fixed endpoint and interruption drops stale response audio', async () => {
  const f = await connected();
  assert.equal(new URL(f.socket.url).hostname, 'test-space.cn-beijing.maas.aliyuncs.com');
  assert.equal(f.socket.url.includes('not-a-real-key'),false);
  assert.equal(f.socket.options.followRedirects,false);
  assert.deepEqual(f.socket.sent[0].session.modalities,['text','audio']);
  f.session.sendAudio(Uint8Array.of(0,1));
  assert.equal(f.socket.sent.at(-1).type,'input_audio_buffer.append');
  f.socket.receive({type:'response.created',response:{id:'r1'}});
  f.socket.receive({type:'response.audio.delta',response_id:'r1',delta:'AAE='});
  f.socket.receive({type:'input_audio_buffer.speech_started'});
  f.socket.receive({type:'response.audio.delta',response_id:'r1',delta:'AAE='});
  assert.equal(f.events.filter(e=>e.type==='audio').length,1);
  assert.equal(f.events.at(-1).type,'interrupted');
  await f.session.close();
});

test('a repeated tool call does not execute twice and cancellation suppresses its late reply', async () => {
  let count = 0, resolve;
  const f = await connected(() => {count++; return new Promise(yes=>{resolve=yes;});});
  f.socket.receive({type:'response.created',response:{id:'r1'}});
  const call={type:'response.function_call_arguments.done',response_id:'r1',call_id:'call_1',name:'request_work',arguments:'{"goal":"hello"}'};
  f.socket.receive(call); f.socket.receive(call);
  await new Promise(setImmediate);
  assert.equal(count,1);
  f.controller.abort();
  resolve('finished');
  await new Promise(setImmediate);
  assert.equal(f.socket.sent.some(e=>e.type==='conversation.item.create'),false);
  await f.session.close();
});

test('unregistered cloud tools close the session without execution or raw error exposure', async () => {
  let called=false;
  const f=await connected(async()=>{called=true;return 'ok';});
  f.socket.receive({type:'response.created',response:{id:'r1'}});
  f.socket.receive({type:'response.function_call_arguments.done',response_id:'r1',call_id:'x',name:'shell',arguments:'{}'});
  await new Promise(setImmediate);
  assert.equal(called,false);
  assert.equal(f.events.at(-1).type,'error');
  assert.equal(f.socket.readyState,3);
});

const tick = () => new Promise(setImmediate);
const created = id => ({type:'response.created',response:{id}});
const done = (id,status='completed') => ({type:'response.done',response:{id,status}});
const tool = (id,callId) => ({type:'response.function_call_arguments.done',response_id:id,
  call_id:callId,name:'request_work',arguments:'{}'});
const countSent = (f,type) => f.socket.sent.filter(message=>message.type===type).length;

test('two tools return once and continue only after their response and both results finish', async t => {
  const pending=new Map(),executed=[];
  const f=await connected((_name,_args,id)=>{executed.push(id);return new Promise(resolve=>pending.set(id,resolve));});
  t.after(()=>f.session.close());
  f.socket.receive(created('r1'));f.socket.receive(tool('r1','a'));f.socket.receive(tool('r1','b'));
  f.socket.receive(tool('r1','a'));await tick();assert.deepEqual(executed,['a','b']);
  pending.get('a')('first');await tick();
  assert.equal(countSent(f,'conversation.item.create'),1);
  assert.equal(countSent(f,'response.create'),0,'active output must finish before continuation');
  f.socket.receive(done('r1'));assert.equal(countSent(f,'response.create'),0,'second result is still pending');
  pending.get('b')('second');await tick();
  assert.deepEqual(f.socket.sent.filter(x=>x.type==='conversation.item.create').map(x=>x.item.output),['first','second']);
  assert.equal(countSent(f,'response.create'),1);
  f.socket.receive(done('r1'));f.socket.receive(tool('r1','a'));await tick();
  assert.equal(countSent(f,'response.create'),1);assert.equal(countSent(f,'conversation.item.create'),2);
});

test('already returned tool results wait for done and duplicate completion does not drain again', async t => {
  const f=await connected();t.after(()=>f.session.close());
  f.socket.receive(created('r1'));f.socket.receive(tool('r1','a'));f.socket.receive(tool('r1','b'));await tick();
  assert.equal(countSent(f,'conversation.item.create'),2);assert.equal(countSent(f,'response.create'),0);
  f.socket.receive(done('r1'));assert.equal(countSent(f,'response.create'),1);
  f.socket.receive(done('r1'));assert.equal(countSent(f,'response.create'),1);
  assert.equal(f.events.filter(x=>x.type==='turn_complete').length,1);
});

test('an interrupted old done cannot clear a newer response or replay old audio', async t => {
  const f=await connected();t.after(()=>f.session.close());
  f.socket.receive(created('r1'));f.session.interrupt();f.socket.receive(created('r2'));
  f.socket.receive(done('r1','failed'));f.socket.receive(done('r1'));
  assert.equal(f.events.some(x=>x.type==='error'||x.type==='turn_complete'),false);
  f.session.interrupt();assert.equal(countSent(f,'response.cancel'),2,'r2 must still be cancellable');
  f.socket.receive({type:'response.audio.delta',response_id:'r2',delta:'AAE='});
  assert.equal(f.events.some(x=>x.type==='audio'),false);
});

test('late tool results survive interruption without starting or blocking a newer turn', async t => {
  const pending=new Map();
  const f=await connected((_name,_args,id)=>new Promise(resolve=>pending.set(id,resolve)));
  t.after(()=>f.session.close());
  f.socket.receive(created('r1'));f.socket.receive(tool('r1','old'));await tick();
  f.socket.receive({type:'input_audio_buffer.speech_started'});f.socket.receive(created('r2'));
  f.socket.receive(tool('r2','new'));await tick();pending.get('new')('new result');await tick();
  f.socket.receive(done('r2'));assert.equal(countSent(f,'response.create'),1,'old pending work does not block the current turn');
  f.socket.receive(created('r3'));pending.get('old')('late result');await tick();
  assert.deepEqual(f.socket.sent.filter(x=>x.type==='conversation.item.create').map(x=>x.item.output),['new result','late result']);
  f.socket.receive(done('r1'));f.socket.receive(done('r3'));
  assert.equal(countSent(f,'response.create'),1,'old work does not start another answer');
});

test('interruption before a continuation is acknowledged stops ambiguous audio without replaying work', async t => {
  let executions=0;const f=await connected(async()=>{executions++;return 'recorded';});t.after(()=>f.session.close());
  f.socket.receive(created('r1'));f.socket.receive(tool('r1','a'));await tick();f.socket.receive(done('r1'));
  assert.equal(countSent(f,'response.create'),1);f.session.interrupt();
  f.socket.receive(created('r2'));f.socket.receive({type:'response.audio.delta',response_id:'r2',delta:'AAE='});
  assert.equal(f.socket.readyState,3);assert.equal(executions,1);assert.equal(countSent(f,'conversation.item.create'),1);
  assert.equal(f.events.some(x=>x.type==='audio'),false);assert.equal(f.events.at(-1).type,'error');
});

test('server cancellation suppresses late continuation and tool failure returns only a sanitized result', async t => {
  let resolve;const f=await connected(()=>new Promise(yes=>{resolve=yes;}));t.after(()=>f.session.close());
  f.socket.receive(created('r1'));f.socket.receive(tool('r1','a'));await tick();f.socket.receive(done('r1','cancelled'));
  resolve('retained result');await tick();assert.equal(countSent(f,'conversation.item.create'),1);
  assert.equal(countSent(f,'response.create'),0);assert.equal(f.events.some(x=>x.type==='turn_complete'),false);
  const failure=await connected(async()=>{throw Error('SECRET-provider-error');});t.after(()=>failure.session.close());
  failure.socket.receive(created('r1'));failure.socket.receive(tool('r1','a'));await tick();failure.socket.receive(done('r1'));
  const output=failure.socket.sent.find(x=>x.type==='conversation.item.create').item.output;
  assert.match(output,/未能完成/);assert.equal(output.includes('SECRET'),false);assert.equal(countSent(failure,'response.create'),1);
});

test('close, abort and deadline retain started work but suppress late transmission', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  for (const action of ['close','abort','deadline']) await t.test(action,async child => {
    let resolve,executions=0;
    const f=await connected(()=>{executions++;return new Promise(yes=>{resolve=yes;});});child.after(()=>f.session.close());
    f.socket.receive(created('r1'));f.socket.receive(tool('r1','a'));await tick();
    if(action==='close') await f.session.close();
    else if(action==='abort')f.controller.abort();
    else t.mock.timers.tick(30001);
    resolve('completed background work');await tick();
    assert.equal(executions,1);assert.equal(countSent(f,'conversation.item.create'),0);
    assert.equal(countSent(f,'response.create'),0);assert.equal(f.socket.readyState,3);
  });
});

test('closing before a queued tool starts prevents execution and a changed call ID binding fails closed', async t => {
  let executions=0;const f=await connected(async()=>{executions++;return 'ok';});t.after(()=>f.session.close());
  f.socket.receive(created('r1'));f.socket.receive(tool('r1','a'));await f.session.close();await tick();assert.equal(executions,0);
  const conflict=await connected(async()=>{executions++;return 'ok';});t.after(()=>conflict.session.close());
  conflict.socket.receive(created('r1'));conflict.socket.receive(tool('r1','a'));
  conflict.socket.receive({...tool('r1','a'),arguments:'{"changed":true}'});await tick();
  assert.equal(conflict.socket.readyState,3);assert.equal(executions,0);assert.equal(conflict.events.at(-1).type,'error');
});

test('missing response identities cannot execute work or play unowned audio and transcript', async t => {
  for(const message of [tool('','a'),
    {type:'response.audio.delta',response_id:'',delta:'AAE='},
    {type:'response.audio_transcript.done',item_id:'a',transcript:'Unowned synthetic reply'}]) await t.test(message.type,async child=>{
      let executions=0;const f=await connected(async()=>{executions++;return 'ok';});child.after(()=>f.session.close());
      f.socket.receive(message);await tick();assert.equal(executions,0);
      assert.equal(f.socket.readyState,3);assert.equal(f.events.some(x=>x.type==='audio'||x.type==='transcript'),false);
    });
});
