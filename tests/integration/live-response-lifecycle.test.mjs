import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {QwenRealtimeModelGateway} from '@personal-agent/models';
import {TaskRuntime} from '@personal-agent/runtime';
import {createLiveVoiceHost} from '../../apps/desktop/electron/live-voice-host.js';

class Socket extends EventEmitter {
  static current;
  readyState=0;bufferedAmount=0;sent=[];
  constructor(){super();Socket.current=this;queueMicrotask(()=>{this.readyState=1;this.emit('open');});}
  send(value){const message=JSON.parse(value);this.sent.push(message);
    if(message.type==='session.update')queueMicrotask(()=>this.receive({type:'session.updated'}));}
  receive(message){this.emit('message',Buffer.from(JSON.stringify(message)));}
  close(){this.readyState=3;queueMicrotask(()=>this.emit('close'));}
  terminate(){this.close();}
}

test('actual Live gateway and host stop ambiguous audio while original SQLite Runtime work completes once',async t=>{
  const runtime=new TaskRuntime(':memory:');let host,taskId,finishWork,workerSignal,executions=0;
  const operations=[],commands=[];
  const contents={mainFrame:{},isDestroyed:()=>false,send(_channel,message){
    commands.push(message.type);
    if(['start','stop'].includes(message.type))queueMicrotask(()=>host.receive(
      {sender:contents,senderFrame:contents.mainFrame},{token:message.token,type:message.type==='start'?'ready':'stopped'}));
  }};
  const client={async call(operation,input){operations.push(operation);
    if(operation!=='task.submit')throw Error('Unexpected operation');
    const task=runtime.submitTask(input);taskId=task.taskId;return task;}};
  host=createLiveVoiceHost({
    getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),
    config:{snapshot:()=>({configured:true}),current:()=>({})},
    microphoneHost:{authorize(){},revoke:async()=>{}},
    createSource:()=>({subscribe:()=>({ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}}),dispose:async()=>{}}),
    createGateway:()=>new QwenRealtimeModelGateway({workspaceId:'test-space',apiKey:'synthetic-key'},Socket),
    readContext:()=>'{"tasks":[]}',onTaskSubmitted(){},client,
    createConsumer:options=>({consume(value){return {result:(async()=>{
      const task=await options.client.call('task.submit',{goal:value.text,conversationId:options.conversationId,idempotencyKey:value.transcriptId});
      const result=await runtime.runTask(task.taskId,async context=>{
        executions++;workerSignal=context.signal;await new Promise(resolve=>{finishWork=resolve;});
        return {resultSummary:'Synthetic background result'};
      },{deadline:new Date(Date.now()+30000).toISOString()});
      return {replyText:result.resultSummary};
    })()};}}),
  });
  t.after(async()=>{finishWork?.();await host.dispose();await new Promise(setImmediate);runtime.close();});
  await host.start();const socket=Socket.current,tick=()=>new Promise(setImmediate);
  socket.receive({type:'response.created',response:{id:'r1'}});
  socket.receive({type:'response.function_call_arguments.done',response_id:'r1',call_id:'work',name:'request_work',arguments:'{"goal":"Public synthetic task"}'});
  await tick();assert.equal(runtime.getTask(taskId).state,'running');host.interrupt();
  socket.receive({type:'response.created',response:{id:'r2'}});
  socket.receive({type:'response.function_call_arguments.done',response_id:'r2',call_id:'context',name:'read_context',arguments:'{}'});
  await tick();socket.receive({type:'response.done',response:{id:'r2',status:'completed'}});
  assert.equal(socket.sent.filter(x=>x.type==='response.create').length,1);
  host.interrupt();await tick();
  assert.equal(host.hasActive(),false);assert.match(host.snapshot().reason,/续答尚未确认/);
  assert.equal(workerSignal.aborted,false);assert.equal(runtime.getTask(taskId).state,'running');
  finishWork();await tick();
  assert.equal(runtime.getTask(taskId).state,'succeeded');assert.equal(executions,1);
  assert.deepEqual(operations,['task.submit']);
  assert.equal(socket.sent.filter(x=>x.type==='conversation.item.create').length,1,'only context returned before closing');
  socket.receive({type:'response.created',response:{id:'r3'}});
  socket.receive({type:'response.audio.delta',response_id:'r3',delta:'AAE='});
  assert.equal(commands.includes('audio'),false);assert.equal(socket.readyState,3);
});
