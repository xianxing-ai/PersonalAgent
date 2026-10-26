import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveTextOutput} from '../electron/live-text-output.js';
import {liveTextOutputFeedback} from '../src/app/live-voice-controls.js';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';

function fixture() {
  const spoken=[];
  let record={id:'live-1',conversationId:'conversation-1',phase:'listening',controller:new AbortController(),
    deadline:new Date(Date.now()+30000).toISOString(),session:{speakText(text){spoken.push(text);return {accepted:true};}}};
  const output=createLiveTextOutput({readSession:()=>record});
  const track=()=>output.track({taskId:'task-1',conversationId:'conversation-1'});
  const task={taskId:'task-1',conversationId:'conversation-1',revision:2,state:'succeeded',resultSummary:'这是文字模型的最终回答。'};
  return {output,spoken,record,track,task,setRecord:value=>{record=value;}};
}

test('only a tracked successful text task in the active conversation reaches the speech model once',()=>{
  const f=fixture();f.output.observe(f.task);assert.deepEqual(f.spoken,[]);
  f.track();f.output.observe({...f.task,conversationId:'other'});assert.deepEqual(f.spoken,[]);
  f.output.observe({...f.task,state:'running',revision:1});assert.deepEqual(f.spoken,[]);
  f.output.observe(f.task);f.output.observe(f.task);f.track();f.output.observe({...f.task,revision:3});
  assert.deepEqual(f.spoken,[f.task.resultSummary]);
  assert.equal(f.output.snapshot().state,'accepted');assert.equal(f.output.snapshot().playbackVerified,false);
});

test('busy speech queues without a second task loop and drain explicitly delivers the exact text',()=>{
  const f=fixture();f.track();f.record.phase='speaking';f.output.observe(f.task);
  assert.equal(f.output.snapshot().state,'queued');assert.deepEqual(f.spoken,[]);
  f.record.phase='listening';f.record.session.speakText=()=>{throw Object.assign(Error('busy'),{code:'REALTIME_BUSY'});};
  f.output.flush();assert.equal(f.output.snapshot().pending,1);
  f.record.session.speakText=text=>{f.spoken.push(text);return {accepted:true};};
  f.output.flush();assert.deepEqual(f.spoken,[f.task.resultSummary]);assert.equal(f.output.snapshot().pending,0);
});

test('stop, interruption, expired lease and session replacement discard queued and late task output',()=>{
  for(const change of [f=>f.output.clear(),f=>f.record.controller.abort(),f=>f.record.deadline=new Date(0).toISOString(),
    f=>f.setRecord({...f.record,id:'live-2'})]) {
    const f=fixture();f.track();f.record.phase='speaking';f.output.observe(f.task);change(f);
    f.record.phase='listening';f.output.flush();f.output.observe({...f.task,revision:3});assert.deepEqual(f.spoken,[]);
  }
});

test('unsupported provider and missing Live report unavailable; failed, truncated and oversized results never speak',()=>{
  const f=fixture();f.setRecord(undefined);assert.equal(f.track().state,'unavailable');assert.deepEqual(f.spoken,[]);
  const missing=fixture();delete missing.record.session.speakText;missing.track();missing.output.observe(missing.task);
  assert.equal(missing.output.snapshot().state,'unavailable');
  assert.match(liveTextOutputFeedback({textOutput:missing.output.snapshot()}),/不支持/);
  for(const patch of [{state:'failed'},{state:'cancelled'},{cancelRequested:true},{outputTruncated:true},
    {resultSummary:''},{resultSummary:'x'.repeat(8001)}]) {
    const f=fixture();f.track();f.output.observe({...f.task,...patch});assert.deepEqual(f.spoken,[]);
  }
});

test('provider errors stay fixed and never claim playback',()=>{
  const f=fixture();f.track();f.record.session.speakText=()=>{throw Error('private provider credential');};
  f.output.observe(f.task);assert.equal(f.output.snapshot().state,'failed');
  assert.doesNotMatch(JSON.stringify(f.output.snapshot()),/private provider/);
  assert.equal(f.output.snapshot().playbackVerified,false);
});

test('Live host conversation switch drops queued results and rejects late submission binding',async()=>{
  let host,request,selected='conversation-1',token;
  const spoken=[];
  const contents={mainFrame:{},isDestroyed:()=>false,send(_channel,message){
    token=message.token;
    if(['start','stop'].includes(message.type))queueMicrotask(()=>host.receive({sender:contents,senderFrame:contents.mainFrame},
      {token:message.token,type:message.type==='start'?'ready':'stopped'}));
  }};
  host=createLiveVoiceHost({getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),
    config:{snapshot:()=>({configured:true}),current:()=>({})},readConversationId:()=>selected,
    microphoneHost:{authorize(){},async revoke(){}},
    createSource:()=>({subscribe:()=>({ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}}),async dispose(){}}),
    createGateway:()=>({async connect(value){request=value;return {sendAudio(){},interrupt(){request.onEvent({type:'interrupted'});},
      async close(){},speakText(text){spoken.push(text);return {accepted:true};}};}}),
  });
  await host.start();
  const task={taskId:'text-task',conversationId:selected,revision:1,state:'succeeded',resultSummary:'不要在切换后播报'};
  host.trackTextTask(task);request.onEvent({type:'audio',data:Uint8Array.of(0,0),responseId:'existing'});
  host.observeTextTask(task);assert.equal(host.snapshot().textOutput.state,'queued');
  selected='conversation-2';host.invalidateTextOutput('conversation-1');
  assert.equal(host.trackTextTask({...task,taskId:'late-submit'}).state,'unavailable');
  host.receive({sender:contents,senderFrame:contents.mainFrame},{token,type:'drained'});
  host.observeTextTask({...task,revision:2});assert.deepEqual(spoken,[]);
  await host.stop();
});
