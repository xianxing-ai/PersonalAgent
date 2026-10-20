import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createRuntimeClientTranscriptConsumer} from '@personal-agent/voice';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';

test('trusted final consumer binds the captured speech item and current question; missing metadata, echo and old items never authorize',async()=>{
  let host,request,frames,token;
  const receipts=[],asked=[],time=Date.now();
  const question={questionId:'current-question',revision:4,state:'pending',summary:'是否确认当前参数？',argumentsDigest:'a'.repeat(64),
    issuedAt:new Date(time).toISOString(),expiresAt:new Date(time+30_000).toISOString()};
  const contents={mainFrame:{},isDestroyed:()=>false,send(_channel,message){token=message.token;
    if(['start','stop'].includes(message.type))queueMicrotask(()=>host.receive({sender:contents,senderFrame:contents.mainFrame},
      {token:message.token,type:message.type==='start'?'ready':'stopped'}));}};
  host=createLiveVoiceHost({getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),now:()=>time,
    config:{snapshot:()=>({configured:true}),current:()=>({})},microphoneHost:{authorize(){},revoke:async()=>{}},
    createSource:()=>({subscribe(options){frames=options;return {ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}};},dispose:async()=>{}}),
    createGateway:()=>({async connect(value){request=value;return {sendAudio(){},interrupt(){},close:async()=>{},askUserQuestion(text){asked.push(text);return {accepted:true};}};}}),
    createConsumer:()=>({}),client:{},readContext:()=>'',onTranscript(){},readCurrentQuestion:()=>question,
    onFinalUserCommand:async receipt=>{receipts.push(receipt);return {consumed:true,state:'confirmed'};}});
  assert.equal(host.askCurrentQuestion().state,'unavailable');
  await host.start();
  assert.equal(host.askCurrentQuestion().state,'queued');assert.equal(asked.length,1);
  assert.equal(host.snapshot().questionDelivery.playbackVerified,false);
  frames.onFrame({data:Uint8Array.of(0,0)});
  const speech=id=>{request.onEvent({type:'speech_started',utteranceId:id});request.onEvent({type:'speech_stopped',utteranceId:id});};
  const final=(id,extra={})=>request.onEvent({type:'transcript',id,utteranceId:id,role:'user',text:'同意',phase:'final',source:'input_audio',...extra});
  speech('current');final('old-item');final('current',{phase:'partial'});final('current',{source:undefined});
  await new Promise(setImmediate);assert.equal(receipts.length,0);
  final('current');await new Promise(setImmediate);assert.equal(receipts.length,1);
  assert.equal(receipts[0].utteranceId,'current');assert.equal(receipts[0].questionRevision,4);assert.equal(receipts[0].source,'live_input_audio');
  final('current');await new Promise(setImmediate);assert.equal(receipts.length,1);
  request.onEvent({type:'audio',responseId:'assistant-output',data:Uint8Array.of(0,0)});
  speech('echo');final('echo');await new Promise(setImmediate);assert.equal(receipts.length,1);
  host.receive({sender:contents,senderFrame:contents.mainFrame},{token,type:'drained'});
  speech('fresh');request.onEvent({type:'speech_stopped',utteranceId:'wrong-item'});final('fresh');
  await new Promise(setImmediate);assert.equal(receipts.length,1);
  await host.stop();final('fresh');await new Promise(setImmediate);assert.equal(receipts.length,1);
});

test('Live work shares desktop-panel and stopping audio never cancels an accepted Runtime task', async () => {
  let host, request, frameOptions, consumed, submitted, revoked=false, closed=false;
  const calls=[];
  const contents={id:7,mainFrame:{},isDestroyed:()=>false,send(_channel,message) {
    if (['start','stop'].includes(message.type)) queueMicrotask(()=>host.receive(
      {sender:contents,senderFrame:contents.mainFrame},{token:message.token,type:message.type==='start'?'ready':'stopped'}));
  }};
  const panel={webContents:contents,isDestroyed:()=>false,isVisible:()=>true};
  const source={subscribe(options) {frameOptions=options;return {ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}};},dispose:async()=>{}};
  host=createLiveVoiceHost({getPanel:()=>panel,config:{snapshot:()=>({configured:true}),current:()=>({})},
    microphoneHost:{authorize(){},revoke:async()=>{revoked=true;}},createSource:()=>source,
    createGateway:()=>({async connect(value) {request=value;return {sendAudio(){},interrupt(){},close:async()=>{closed=true;}};}}),
    client:{async call(op) {calls.push(op);return {taskId:'task-live'};}},readContext:()=>'{"tasks":[]}',
    onTaskSubmitted:value=>{submitted=value;},createConsumer:options=>{
      assert.equal(options.conversationId,'desktop-panel');
      return {consume(value) {consumed=value;return {result:options.client.call('task.submit',{goal:value.text}).then(()=>({replyText:'真实任务结果'})),stop:async()=>{}};}};
    },
  });
  await host.start();
  assert.equal(host.snapshot().status,'listening');
  assert.equal(await request.onTool('request_work',{goal:'合成任务'},'call_1'),'真实任务结果');
  assert.deepEqual(submitted,{taskId:'task-live',goal:'合成任务',conversationId:'desktop-panel'});
  assert.equal(consumed.text,'合成任务');
  assert.ok(frameOptions.signal);
  await host.stop();
  assert.equal(consumed.signal.aborted,true);
  assert.equal(revoked,true);assert.equal(closed,true);
  assert.deepEqual(calls,['task.submit']);
  assert.equal(host.hasActive(),false);
});

test('normal turns remain listening, transcripts persist, lease renews and explicit stop prevents restart', async () => {
  let host, clock = Date.now(), request, renewal, leasedDeadline, connections = 0, token;
  const saved = [], schedules = new Set();
  const contents = {mainFrame:{},isDestroyed:()=>false,send(_channel,message) {
    token = message.token;
    if (['start','stop'].includes(message.type)) queueMicrotask(()=>host.receive(
      {sender:contents,senderFrame:contents.mainFrame},{token:message.token,type:message.type==='start'?'ready':'stopped'}));
  }};
  host = createLiveVoiceHost({getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),
    config:{snapshot:()=>({configured:true}),current:()=>({})},now:()=>clock,
    schedule(callback,ms) {renewal=callback;schedules.add(callback);return callback;},unschedule:handle=>schedules.delete(handle),
    microphoneHost:{authorize({deadline}) {leasedDeadline=deadline;},revoke:async()=>{}},
    createSource:()=>({subscribe:()=>({ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}}),dispose:async()=>{}}),
    createGateway:()=>({async connect(value) {request=value;connections++;return {sendAudio(){},interrupt(){},close:async()=>{}};}}),
    createConsumer:()=>({}),client:{},readContext:()=>'',onTaskSubmitted(){},onTranscript:message=>saved.push(message),
  });
  await host.start();
  assert.equal(Date.parse(leasedDeadline)-clock,120*60_000);
  for (let i=0;i<3;i++) {
    request.onEvent({type:'transcript',id:`u${i}`,role:'user',text:`第${i}轮`});
    request.onEvent({type:'audio',data:Uint8Array.of(0,0),responseId:`r${i}`});
    request.onEvent({type:'transcript',id:`a${i}`,role:'assistant',text:'继续听你说'});
    request.onEvent({type:'turn_complete'});
    host.receive({sender:contents,senderFrame:contents.mainFrame},{token,type:'drained'});
    assert.equal(host.snapshot().status,'listening');
    assert.equal(host.hasActive(),true);
  }
  assert.equal(saved.length,6);
  clock+=119*60_000;
  renewal();
  await new Promise(setImmediate);
  assert.equal(connections,2);
  assert.equal(host.snapshot().status,'listening');
  assert.ok(request.instructions.includes('第2轮'));
  const staleRenewal=renewal;
  await host.stop();
  staleRenewal();
  await new Promise(setImmediate);
  assert.equal(connections,2);
  assert.equal(host.snapshot().active,false);
  assert.equal(schedules.size,0);
});

test('empty transcript is ignored and persistence failure degrades gracefully without dropping audio', async () => {
  let host, request, token;
  let throwOnSave = false;
  const saved = [];
  const contents = {mainFrame:{},isDestroyed:()=>false,send(_channel,message) {
    token = message.token;
    if (['start','stop'].includes(message.type)) queueMicrotask(()=>host.receive(
      {sender:contents,senderFrame:contents.mainFrame},{token:message.token,type:message.type==='start'?'ready':'stopped'}));
  }};
  host = createLiveVoiceHost({
    getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),
    config:{snapshot:()=>({configured:true,reason:'就绪'}),current:()=>({})},
    microphoneHost:{authorize(){},revoke:async()=>{}},
    createSource:()=>({subscribe:()=>({ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}}),dispose:async()=>{}}),
    createGateway:()=>({async connect(value) {request=value;return {sendAudio(){},interrupt(){},close:async()=>{}};}}),
    createConsumer:()=>({}),client:{},readContext:()=>'',onTaskSubmitted(){},
    onTranscript:message => {
      if (throwOnSave) throw Error('模拟磁盘写入异常');
      saved.push(message);
    },
  });
  await host.start();
  assert.equal(host.snapshot().status,'listening');

  // Empty or whitespace transcript must not crash or drop audio
  request.onEvent({type:'transcript',id:'empty1',role:'user',text:''});
  request.onEvent({type:'transcript',id:'empty2',role:'user',text:'   '});
  assert.equal(host.snapshot().status,'listening');
  assert.equal(saved.length,0);

  // Persistence failure must degrade gracefully without terminating live audio
  throwOnSave = true;
  request.onEvent({type:'transcript',id:'u1',role:'user',text:'遇到磁盘异常的话语'});
  assert.equal(host.snapshot().status,'listening');
  assert.equal(host.hasActive(),true);
  assert.match(host.snapshot().reason,/对话记录保存异常/);
  assert.equal(host.snapshot().transcripts.length,1);
  assert.equal(host.snapshot().transcripts[0].text,'遇到磁盘异常的话语');

  // Recovery first backfills the failed user message, then saves this answer.
  throwOnSave = false;
  request.onEvent({type:'transcript',id:'a1',role:'assistant',text:'回答依然继续'});
  assert.equal(host.snapshot().status,'listening');
  assert.equal(host.snapshot().reason,'就绪');
  assert.equal(saved.length,2);
  assert.equal(saved[0].text,'遇到磁盘异常的话语');
  assert.equal(saved[1].text,'回答依然继续');

  // Updated transcript with same id updates in-memory transcript text
  request.onEvent({type:'transcript',id:'a1',role:'assistant',text:'回答依然继续（修订补充）'});
  assert.equal(host.snapshot().transcripts.find(t=>t.id===saved[1].id).text,'回答依然继续（修订补充）');
  await host.stop();
});

test('Live initial startup includes recent context from readContext in instructions', async () => {
  let host, request;
  const contents = {mainFrame:{},isDestroyed:()=>false,send(_channel,message) {
    if (['start','stop'].includes(message.type)) queueMicrotask(()=>host.receive(
      {sender:contents,senderFrame:contents.mainFrame},{token:message.token,type:message.type==='start'?'ready':'stopped'}));
  }};
  host = createLiveVoiceHost({
    getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),
    config:{snapshot:()=>({configured:true}),current:()=>({})},
    microphoneHost:{authorize(){},revoke:async()=>{}},
    createSource:()=>({subscribe:()=>({ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}}),dispose:async()=>{}}),
    createGateway:()=>({async connect(value) {request=value;return {sendAudio(){},interrupt(){},close:async()=>{}};}}),
    createConsumer:()=>({}),client:{},
    readContext:()=>JSON.stringify({
      tasks: [{taskId:'task-prev',goal:'今天天气如何',state:'succeeded',result:'今天北京晴转多云'}],
      messages: [{role:'user',text:'之前问过的问题'},{role:'assistant',text:'这是之前的语音回答'}],
    }),
    onTaskSubmitted(){},onTranscript(){},
  });
  await host.start();
  assert.equal(host.snapshot().status,'listening');
  assert.ok(request.instructions.includes('今天天气如何'));
  assert.ok(request.instructions.includes('今天北京晴转多云'));
  assert.ok(request.instructions.includes('这是之前的语音回答'));
  assert.ok(request.instructions.includes('绝对不要重复执行或重新提交这些历史任务'));
  await host.stop();
});

test('Live request_work returns accurate failure, cancellation, and waiting_approval status without false completion', async () => {
  let host, request;
  const contents = {id: 8, mainFrame: {}, isDestroyed: () => false, send(_ch, msg) {
    if (['start', 'stop'].includes(msg.type)) queueMicrotask(() => host.receive(
      {sender: contents, senderFrame: contents.mainFrame}, {token: msg.token, type: msg.type === 'start' ? 'ready' : 'stopped'}));
  }};
  const panel = {webContents: contents, isDestroyed: () => false, isVisible: () => true};
  const source = {subscribe: () => ({ready: Promise.resolve(), closed: Promise.resolve(), unsubscribe() {}}), dispose: async () => {}};

  let taskState = 'failed';
  let failureReason = '网络连接超时';
  const client = {
    async call(op, args) {
      if (op === 'task.submit') return {taskId: 'task-test-status'};
      if (op === 'task.get') return {taskId: args.taskId, state: taskState, failureReason, error: {message: failureReason}};
      return {};
    },
  };

  host = createLiveVoiceHost({
    getPanel: () => panel,
    config: {snapshot: () => ({configured: true}), current: () => ({})},
    microphoneHost: {authorize() {}, revoke: async () => {}},
    createSource: () => source,
    createGateway: () => ({async connect(val) {request = val; return {sendAudio() {}, interrupt() {}, close: async () => {}};}}),
    client,
    readContext: () => '',
    onTaskSubmitted() {},
    createConsumer: options => ({
      consume(val) {
        return {
          result: options.client.call('task.submit', {goal: val.text}).then(() => {
            throw Error('Runtime transcript consumption failed');
          }),
          stop: async () => {},
        };
      },
    }),
  });

  await host.start();

  // 1. Task failed
  taskState = 'failed';
  failureReason = '网络连接超时';
  const failResult = await request.onTool('request_work', {goal: '测试失败任务'}, 'call_f');
  assert.match(failResult, /任务执行失败：网络连接超时/);

  // 2. Task cancelled
  taskState = 'cancelled';
  const cancelResult = await request.onTool('request_work', {goal: '测试取消任务'}, 'call_c');
  assert.match(cancelResult, /任务已被取消/);

  // 3. Task waiting approval
  taskState = 'waiting_approval';
  const approvalResult = await request.onTool('request_work', {goal: '测试审批任务'}, 'call_a');
  assert.match(approvalResult, /正在等待用户审批授权/);

  await host.stop();
});

test('Live initial startup interleaves tasks and messages in chronological order and deduplicates', async () => {
  let host, request;
  const contents = {mainFrame: {}, isDestroyed: () => false, send(_ch, msg) {
    if (['start', 'stop'].includes(msg.type)) queueMicrotask(() => host.receive(
      {sender: contents, senderFrame: contents.mainFrame}, {token: msg.token, type: msg.type === 'start' ? 'ready' : 'stopped'}));
  }};
  host = createLiveVoiceHost({
    getPanel: () => ({webContents: contents, isDestroyed: () => false, isVisible: () => true}),
    config: {snapshot: () => ({configured: true}), current: () => ({})},
    microphoneHost: {authorize() {}, revoke: async () => {}},
    createSource: () => ({subscribe: () => ({ready: Promise.resolve(), closed: Promise.resolve(), unsubscribe() {}}), dispose: async () => {}}),
    createGateway: () => ({async connect(val) {request = val; return {sendAudio() {}, interrupt() {}, close: async () => {}};}}),
    createConsumer: () => ({}),
    client: {},
    readContext: () => JSON.stringify({
      tasks: [
        {taskId: 't1', goal: '第一个文字问题', state: 'succeeded', result: '第一个回答', createdAt: '2026-09-27T10:00:00.000Z'},
        {taskId: 't2', goal: '第三个文字问题', state: 'failed', failureReason: '模型故障', createdAt: '2026-09-27T10:02:00.000Z'},
      ],
      messages: [
        {role: 'user', text: '第二个语音问题', createdAt: '2026-09-27T10:01:00.000Z'},
        {id:'a2',role: 'assistant', text: '第二个语音回答', createdAt: '2026-09-27T10:01:05.000Z'},
        {id:'a2',role: 'assistant', text: '第二个语音回答', createdAt: '2026-09-27T10:01:06.000Z'}, // same-identity replay
      ],
    }),
    onTaskSubmitted() {},
    onTranscript() {},
  });

  await host.start();
  const inst = request.instructions;
  const pos1 = inst.indexOf('第一个文字问题');
  const pos2 = inst.indexOf('第二个语音问题');
  const pos3 = inst.indexOf('第三个文字问题');
  assert.ok(pos1 > 0 && pos2 > 0 && pos3 > 0, 'all entries must be present');
  assert.ok(pos1 < pos2, 'chronology: task 1 before message 2');
  assert.ok(pos2 < pos3, 'chronology: message 2 before task 3');
  assert.ok(inst.includes('任务执行失败：模型故障'), 'failed task status is included');
  // Check deduplication
  const occurrences = (inst.match(/第二个语音回答/g) || []).length;
  assert.equal(occurrences, 1, 'duplicate voice answer must be deduplicated');
  await host.stop();
});

function harness(overrides = {}) {
  let host, request;
  const commands=[];
  const contents={mainFrame:{},isDestroyed:()=>false,send(_channel,message) {
    commands.push(message);
    if (['start','stop'].includes(message.type)) queueMicrotask(()=>host.receive(
      {sender:contents,senderFrame:contents.mainFrame},{token:message.token,type:message.type==='start'?'ready':'stopped'}));
  }};
  host=createLiveVoiceHost({getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),
    config:{snapshot:()=>({configured:true}),current:()=>({})},
    microphoneHost:{authorize(){},revoke:async()=>{}},
    createSource:()=>({subscribe:()=>({ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}}),dispose:async()=>{}}),
    createGateway:()=>({async connect(value) {request=value;return {sendAudio(){},interrupt(){},close:async()=>{}};}}),
    createConsumer:()=>({}),client:{},readContext:()=>'',onTaskSubmitted(){},...overrides});
  return {host,contents,commands,get request(){return request;}};
}

test('accepted work stays working across speech interruption and playback drain until its own result arrives', async()=>{
  let finish;
  const fixture=harness({client:{async call(operation){assert.equal(operation,'task.submit');return {taskId:'accepted-task'};}},
    createConsumer:options=>({consume(value){return {result:(async()=>{
      await options.client.call('task.submit',{goal:value.text});
      return new Promise(resolve=>{finish=resolve;});
    })()};}})});
  await fixture.host.start();
  const pending=fixture.request.onTool('request_work',{goal:'派发子智能体计算一加二'},'work-call');
  await new Promise(setImmediate);
  assert.equal(fixture.host.snapshot().status,'working');
  fixture.request.onEvent({type:'interrupted'});
  assert.equal(fixture.host.snapshot().status,'working','interrupting speech must not mark background work as idle');
  fixture.request.onEvent({type:'audio',data:new Uint8Array([0,0])});
  fixture.host.receive({sender:fixture.contents,senderFrame:fixture.contents.mainFrame},
    {token:fixture.commands.find(c=>c.type==='start').token,type:'drained'});
  assert.equal(fixture.host.snapshot().status,'working');
  assert.deepEqual(fixture.host.snapshot().workRequests,[{state:'accepted',taskId:'accepted-task'}]);
  finish({replyText:'已返回任务结果'});
  assert.equal(await pending,'已返回任务结果');
  assert.equal(fixture.host.snapshot().status,'listening');
  await fixture.host.stop();
});

test('concurrent requests read their own task status and same call replay never resubmits', async () => {
  const releases=new Map(), submitted=[], read=[];
  const fixture=harness({client:{async call(op,payload) {
    if(op==='task.submit') {submitted.push(payload.goal);return {taskId:`task-${payload.goal}`};}
    if(op==='task.get') {read.push(payload.taskId);return {taskId:payload.taskId,state:payload.taskId==='task-A'?'failed':'waiting_approval',error:{message:'A failed'}};}
  }},createConsumer:options=>({consume(value) {return {result:(async()=>{
    await options.client.call('task.submit',{goal:value.text});
    await new Promise(resolve=>releases.set(value.text,resolve));
    throw Error('wait failed');
  })()};}})});
  await fixture.host.start();
  const first=fixture.request.onTool('request_work',{goal:'A'},'call-a');
  const second=fixture.request.onTool('request_work',{goal:'B'},'call-b');
  const replay=fixture.request.onTool('request_work',{goal:'A'},'call-a');
  await new Promise(setImmediate);
  releases.get('B')();
  assert.match(await second,/等待用户审批/);
  assert.deepEqual(fixture.host.snapshot().workRequests.find(item=>item.taskId==='task-B'),{state:'awaiting_result',taskId:'task-B'});
  releases.get('A')();
  assert.match(await first,/A failed/);
  assert.deepEqual(fixture.host.snapshot().workRequests.find(item=>item.taskId==='task-A'),{state:'result_returned',taskId:'task-A'});
  assert.equal(await replay,await first);
  assert.deepEqual(submitted,['A','B']);
  assert.deepEqual(read,['task-B','task-A']);
  await assert.rejects(fixture.request.onTool('request_work',{goal:'changed'},'call-a'),/标识冲突/);
  assert.equal(fixture.host.snapshot().status,'listening');
  await fixture.host.stop();
});

test('consumer factory failure does not wedge Live or create a Runtime task', async () => {
  const fixture=harness({createConsumer:()=>{throw Error('consumer unavailable');}});
  await fixture.host.start();
  await assert.rejects(fixture.request.onTool('request_work',{goal:'A'},'call-a'),/consumer unavailable/);
  assert.equal(fixture.host.snapshot().status,'listening');
  await fixture.host.stop();
  await fixture.host.start();
  await fixture.host.stop();
});

test('successful task without a result summary is not described as still running', async()=>{
  const fixture=harness({client:{async call(operation){
    return operation==='task.submit'?{taskId:'task-empty-summary'}:{taskId:'task-empty-summary',state:'succeeded'};
  }},createConsumer:options=>({consume(value){return {result:(async()=>{
    await options.client.call('task.submit',{goal:value.text});throw Error('missing summary');
  })()};}})});
  await fixture.host.start();
  const reply=await fixture.request.onTool('request_work',{goal:'A'},'call-empty-summary');
  assert.match(reply,/状态为成功.*未返回.*结果摘要/);
  assert.doesNotMatch(reply,/尚未完成/);
  assert.deepEqual(fixture.host.snapshot().workRequests,[{state:'result_returned',taskId:'task-empty-summary'}]);
  assert.equal(fixture.host.snapshot().status,'listening');
  await fixture.host.stop();
});

test('stop awaits an in-flight connection close and forbids duplicate audio sessions', async () => {
  let resolveConnect,request,closes=0;
  const fixture=harness({createGateway:()=>({connect(value) {
    request=value;return new Promise(resolve=>{resolveConnect=resolve;});
  }})});
  const starting=fixture.host.start();
  await new Promise(setImmediate);
  const stopping=fixture.host.stop();
  assert.equal(request.signal.aborted,true);
  await assert.rejects(fixture.host.start(),/会话已存在/);
  resolveConnect({sendAudio(){},interrupt(){},close:async()=>{closes++;}});
  await Promise.all([starting,stopping]);
  assert.equal(closes,1);
  assert.equal(fixture.host.hasActive(),false);
});

test('synchronous device release failures still close the session and block unsafe restart', async () => {
  let closed=false;
  const fixture=harness({microphoneHost:{authorize(){},revoke(){throw Error('release failed');}},
    createGateway:()=>({async connect(){return {sendAudio(){},interrupt(){},close:async()=>{closed=true;}};}})});
  await fixture.host.start();
  const state=await fixture.host.stop();
  assert.equal(closed,true);
  assert.equal(state.active,true);
  assert.equal(fixture.host.hasActive(),true);
  assert.match(state.reason,/释放未确认/);
  await assert.rejects(fixture.host.start(),/释放未确认/);
});

test('unsaved transcript survives stop/start and is visible to text consumers and read_context', async () => {
  const fixture=harness({onTranscript:()=>{throw Error('disk unavailable');}});
  await fixture.host.start();
  fixture.request.onEvent({type:'transcript',id:'u1',role:'user',text:'待保存的话语'});
  const stale=fixture.request;
  await fixture.host.stop();
  await fixture.host.start();
  stale.onEvent({type:'transcript',id:'late',role:'user',text:'旧会话晚到'});
  assert.match(fixture.request.instructions,/待保存的话语/);
  assert.equal(fixture.host.historyMessages().length,1);
  const read=JSON.parse(await fixture.request.onTool('read_context',{},'context'));
  assert.deepEqual(read.recentDialogue,[{role:'user',text:'待保存的话语'}]);
  await fixture.host.stop();
});

test('late consumer success after stop is rejected and never cancels the accepted task', async () => {
  let resolveWork;
  const fixture=harness({createConsumer:()=>({consume:()=>({result:new Promise(resolve=>{resolveWork=resolve;})})})});
  await fixture.host.start();
  const work=fixture.request.onTool('request_work',{goal:'A'},'call-a');
  await new Promise(setImmediate);
  await fixture.host.stop();
  resolveWork({replyText:'晚到的成功'});
  await assert.rejects(work,/Live 已停止/);
});

test('expired session rejects new work even if a deadline timer has not fired', async () => {
  let clock=Date.now(),consumed=0;
  const fixture=harness({now:()=>clock,createConsumer:()=>{consumed++;return {};}});
  await fixture.host.start();
  clock+=120*60_000;
  await assert.rejects(fixture.request.onTool('request_work',{goal:'A'},'call-a'),/到期/);
  assert.equal(consumed,0);
  await fixture.host.stop();
});

test('Synthetic approval waits return promptly and continue the original task without another submission', async () => {
  let state='waiting_approval',submits=0,prepares=0;
  const question={kind:'approval',taskId:'accepted-task',questionId:'current-approval',revision:3,state:'pending',
    summary:'fixture.write 当前参数：value=Original，是否同意？',argumentsDigest:'a'.repeat(64),expiresAt:new Date(Date.now()+30_000).toISOString()};
  const fixture=harness({readCurrentQuestion:()=>question,prepareTaskApproval:async scope=>{
    assert.equal(scope.taskId,'accepted-task');assert.equal(scope.conversationId,'desktop-panel');prepares++;return question;
  },client:{async call(operation,payload){
    if(operation==='task.submit'){submits++;return {taskId:'accepted-task'};}
    assert.equal(operation,'task.get');return {taskId:payload.taskId,state,resultSummary:'Original tool readback'};
  }},createConsumer:options=>({consume(value){return {result:(async()=>{
    const task=await options.client.call('task.submit',{goal:value.text});
    await options.client.call('task.get',task);
    throw Error('consumer should leave only its local wait');
  })()};}})});
  await fixture.host.start();
  const first=await fixture.request.onTool('request_work',{goal:'Synthetic approval task'},'approval-call');
  assert.match(first,/当前参数：value=Original/);assert.equal(prepares,1);assert.equal(submits,1);
  assert.equal(await fixture.request.onTool('request_work',{goal:'Synthetic approval task'},'approval-call'),first);
  state='succeeded';
  assert.equal(await fixture.request.onTool('wait_for_task',{taskId:'accepted-task'},'read-result'),'Original tool readback');
  assert.equal(submits,1);assert.equal(fixture.host.snapshot().workRequests[0].state,'result_returned');
  await fixture.host.stop();
});

test('Synthetic wait_for_task checks exact trusted conversation scope and never grants or submits', async () => {
  const reads=[],scopes=[];
  const fixture=harness({readConversationId:()=> 'conversation-dynamic',
    authorizeTaskRead:scope=>{scopes.push(scope);return scope.taskId==='bound-child' && scope.conversationId==='conversation-dynamic';},
    client:{async call(operation,payload){assert.equal(operation,'task.get');reads.push(payload.taskId);
      return {taskId:payload.taskId,state:'succeeded',resultSummary:'Bound child actual result'};}}});
  await fixture.host.start();
  await assert.rejects(fixture.request.onTool('wait_for_task',{taskId:'bound-child-lookalike'},'unbound'),/不属于当前对话/);
  await assert.rejects(fixture.request.onTool('wait_for_task',{taskId:'bound-child',goal:'extra'},'invalid'),/标识无效/);
  assert.equal(await fixture.request.onTool('wait_for_task',{taskId:'bound-child'},'bound'),'Bound child actual result');
  assert.deepEqual(reads,['bound-child']);assert.equal(scopes[0].conversationId,'conversation-dynamic');
  await fixture.host.stop();
});

test('Synthetic read_context keeps the complete reviewed schema and configuration reasons while bounding history', async () => {
  const tools=[{name:'fixture.configured',version:'1',description:'Reviewed bounded description',state:'available',
    inputSchema:{type:'object',properties:{value:{type:'string',enum:['public-option']}},required:['value'],additionalProperties:false}},
    {name:'fixture.disabled',version:'1',state:'missing_trusted_configuration',reason:'Explicit configuration is missing'}];
  const fixture=harness({readContext:()=>({tools,messages:Array.from({length:30},()=>({role:'assistant',text:'合成历史'.repeat(500)}))})});
  await fixture.host.start();
  assert.ok(fixture.request.tools.some(tool=>tool.name==='wait_for_task'));
  const result=await fixture.request.onTool('read_context',{},'directory');
  const context=JSON.parse(result);
  assert.deepEqual(context.tools,tools);assert.equal(context.historyOmitted,true);assert.ok(result.length<=32000);
  await fixture.host.stop();
});

test('Live refuses to send oversized critical user history instead of trimming it for a connection',async()=>{
 const fixture=harness({readContext:()=>({messages:[{id:'critical',role:'user',text:'必须保留的用户条件'.repeat(3000)}]})});
 await assert.rejects(fixture.host.start(),/上下文.*无法完整发送/);
 assert.equal(fixture.request,undefined);
 await fixture.host.stop();
});

test('Synthetic expired local work wait retains the accepted task for a later bound read', async () => {
  let clock=Date.now(),submits=0,reads=0,state='running';
  const fixture=harness({now:()=>clock,client:{async call(operation,payload){
    if(operation==='task.submit'){submits++;return {taskId:'slow-original'};}
    assert.equal(operation,'task.get');reads++;
    return {taskId:payload.taskId,state,resultSummary:'Original slow result'};
  }},createConsumer:options=>({consume(value){return {result:(async()=>{
    await options.client.call('task.submit',{goal:value.text});clock+=120_001;throw Error('Synthetic deadline');
  })()};}})});
  await fixture.host.start();
  await assert.rejects(fixture.request.onTool('request_work',{goal:'Synthetic slow task'},'slow-call'),/工作等待已到期/);
  assert.equal(reads,0);assert.equal(submits,1);
  assert.deepEqual(fixture.host.snapshot().workRequests.find(item=>item.taskId==='slow-original'),
    {state:'awaiting_result',taskId:'slow-original'});
  state='succeeded';
  assert.equal(await fixture.request.onTool('wait_for_task',{taskId:'slow-original'},'later-read'),'Original slow result');
  assert.equal(reads,1);assert.equal(submits,1);
  await fixture.host.stop();
});

test('Synthetic original parent wait can ask a strictly bound child approval and still waits for the parent result',async()=>{
  let state='waiting_reconciliation',submits=0;
  const question={kind:'approval',taskId:'persisted-child',questionId:'child-question',revision:2,state:'pending',
    summary:'子任务当前参数：value=Child，是否允许本次？',argumentsDigest:'b'.repeat(64),expiresAt:new Date(Date.now()+30_000).toISOString()};
  const fixture=harness({readConversationId:()=> 'dynamic-parent-ui',readCurrentQuestion:()=>question,
    authorizeTaskRead:scope=>scope.taskId==='persisted-child' && scope.conversationId==='dynamic-parent-ui',
    prepareTaskApproval:async scope=>{assert.equal(scope.taskId,'parent');return question;},
    client:{async call(operation,payload){if(operation==='task.submit'){submits++;return {taskId:'parent'};}
      assert.equal(operation,'task.get');assert.equal(payload.taskId,'parent');
      return {taskId:'parent',state,resultSummary:'Parent original final answer'};}},
    createConsumer:options=>({consume(value){return {result:(async()=>{
      const task=await options.client.call('task.submit',{goal:value.text});await options.client.call('task.get',task);
    })()};}})});
  await fixture.host.start();
  const result=await fixture.request.onTool('request_work',{goal:'Synthetic delegated work'},'parent-request');
  assert.match(result,/子任务当前参数/);assert.match(result,/"taskId":"parent"/);assert.equal(submits,1);
  state='succeeded';
  assert.equal(await fixture.request.onTool('wait_for_task',{taskId:'parent'},'parent-read'),'Parent original final answer');
  assert.equal(submits,1);await fixture.host.stop();
});

test('Synthetic unrelated child question does not turn an unknown parent result into approval',async()=>{
  const question={taskId:'unbound-child',state:'pending',questionId:'foreign',revision:1,summary:'Do not expose foreign approval',
    argumentsDigest:'c'.repeat(64),expiresAt:new Date(Date.now()+30_000).toISOString()};
  const fixture=harness({readCurrentQuestion:()=>question,prepareTaskApproval:async()=>question,authorizeTaskRead:()=>false,
    client:{async call(operation,payload){return operation==='task.submit'?{taskId:'parent'}:{taskId:payload.taskId,state:'waiting_reconciliation'};}},
    createConsumer:options=>({consume(value){return {result:(async()=>{
      const task=await options.client.call('task.submit',{goal:value.text});await options.client.call('task.get',task);
    })()};}})});
  await fixture.host.start();
  const result=await fixture.request.onTool('request_work',{goal:'Synthetic unknown original'},'unknown');
  assert.match(result,/尚未核实/);assert.doesNotMatch(result,/Do not expose/);await fixture.host.stop();
});

test('Synthetic stop aborts a noncooperative original-task read without cancelling its Runtime task',async()=>{
  let resolveRead;
  const calls=[];
  const fixture=harness({authorizeTaskRead:()=>true,client:{call(operation){calls.push(operation);
    assert.equal(operation,'task.get');return new Promise(resolve=>{resolveRead=resolve;});}}});
  await fixture.host.start();
  const result=fixture.request.onTool('wait_for_task',{taskId:'original'},'waiting');
  await new Promise(setImmediate);await fixture.host.stop();
  await assert.rejects(result,/Live 已停止/);resolveRead({taskId:'original',state:'succeeded',resultSummary:'Late result'});
  assert.deepEqual(calls,['task.get']);assert.equal(fixture.host.hasActive(),false);
});

test('Local/Synthetic natural handoff retains dynamic conversation, message order and original work across interruption',async()=>{
  const conversationId='ui-session-continuous',saved=[],order=[],calls=[];
  let completeWork;
  const fixture=harness({readConversationId:()=>conversationId,onTranscript:message=>{saved.push(message);order.push(message.role);},
    onTaskSubmitted:value=>{assert.equal(value.conversationId,conversationId);order.push('task-accepted');},
    readContext:scope=>{assert.equal(scope.conversationId,conversationId);return {messages:saved};},
    client:{async call(operation,payload){calls.push(operation);
      if(operation==='task.submit')return {taskId:'same-original'};
      assert.equal(operation,'task.get');assert.equal(payload.taskId,'same-original');
      return {taskId:payload.taskId,state:'succeeded',resultSummary:'Original result after interruption'};}},
    createConsumer:options=>{assert.equal(options.conversationId,conversationId);return {consume(value){return {result:(async()=>{
      await options.client.call('task.submit',{goal:value.text});await new Promise(resolve=>{completeWork=resolve;});
      return {replyText:'Original result after interruption'};
    })()};}};}});
  await fixture.host.start();
  assert.match(fixture.request.instructions,/用户无需重述目标或切换界面/);
  assert.match(fixture.request.instructions,/承接一次/);assert.match(fixture.request.instructions,/不要念给用户/);
  fixture.request.onEvent({type:'transcript',id:'work-goal',role:'user',text:'继续帮我完成刚才的工作'});
  const work=fixture.request.onTool('request_work',{goal:'Original same-conversation work'},'natural-work');
  const repeated=fixture.request.onTool('request_work',{goal:'Original same-conversation work'},'natural-work');
  await new Promise(setImmediate);
  fixture.request.onEvent({type:'interrupted'});
  const context=JSON.parse(await fixture.request.onTool('read_context',{},'after-interruption'));
  assert.equal(context.handoff.conversationId,conversationId);assert.equal(context.handoff.phase,'working');
  assert.deepEqual(context.handoff.originalTasks,[{taskId:'same-original',state:'accepted'}]);
  completeWork();assert.equal(await work,'Original result after interruption');assert.equal(await repeated,await work);
  fixture.request.onEvent({type:'transcript',id:'work-answer',role:'assistant',text:'工作结果已经核实'});
  assert.equal(await fixture.request.onTool('wait_for_task',{taskId:'same-original'},'resume-original'),'Original result after interruption');
  assert.deepEqual(order,['user','task-accepted','assistant']);
  assert.ok(saved.every(message=>message.conversationId===conversationId));
  assert.deepEqual(calls,['task.submit','task.get']);
  await fixture.host.stop();assert.deepEqual(calls,['task.submit','task.get']);
});

test('Local/Synthetic large reviewed tool directory pages exact complete schemas once and retains current approval',async()=>{
  const tools=Array.from({length:9},(_,index)=>({name:`fixture.page_${index}`,version:'1.0.0',state:'registered_requires_task_authorization',
    inputSchema:{type:'object',additionalProperties:false,required:['field0'],properties:Object.fromEntries(Array.from({length:100},(_,field)=>[
      `field${field}`,{type:'string',enum:[`public-option-${index}-${field}`],maxLength:256}]))}}));
  const question={kind:'approval',state:'pending',taskId:'pending-task',questionId:'pending-question',revision:4,
    summary:'Exact current action parameters',argumentsDigest:'a'.repeat(64),expiresAt:new Date(Date.now()+30000).toISOString()};
  let clientCalls=0;
  const fixture=harness({client:{call(){clientCalls++;throw Error('Directory must not execute');}},readCurrentQuestion:()=>question,
    readContext:()=>({tools,currentUserQuestion:question,messages:Array.from({length:10},()=>({role:'assistant',text:'Synthetic old history '.repeat(300)}))})});
  await fixture.host.start();
  const collected=[],offsets=[];let offset;
  do {
    const raw=await fixture.request.onTool('read_context',offset===undefined?{}:{toolOffset:offset},'directory-page');
    assert.ok(raw.length<=32000);const page=JSON.parse(raw);assert.ok(page.tools.length>0);
    assert.deepEqual(page.currentUserQuestion,question);assert.equal(page.handoff.currentConfirmation.questionId,question.questionId);
    assert.deepEqual(page.toolIndex,tools.map(({name,version})=>({name,version})));
    assert.equal(page.toolDirectory.total,tools.length);assert.equal(page.toolDirectory.offset,offset??0);
    offsets.push(page.toolDirectory.offset);collected.push(...page.tools);offset=page.toolDirectory.nextOffset;
  }while(offset!==null);
  assert.ok(offsets.length>1);assert.deepEqual(collected,tools);assert.equal(new Set(collected.map(tool=>tool.name)).size,tools.length);
  assert.equal(clientCalls,0);await fixture.host.stop();
});

test('Local/Synthetic read_context validates offsets and preserves the original small directory shape',async()=>{
  const tools=[{name:'fixture.small',version:'1',inputSchema:{type:'object',properties:{},additionalProperties:false}}];
  const fixture=harness({readContext:()=>({tools})});await fixture.host.start();
  const small=JSON.parse(await fixture.request.onTool('read_context',{},'small'));
  assert.deepEqual(small.tools,tools);assert.equal('toolDirectory'in small,false);assert.equal('toolIndex'in small,false);
  for(const args of [{toolOffset:-1},{toolOffset:0.5},{toolOffset:'0'},{toolOffset:null},{toolOffset:Number.MAX_SAFE_INTEGER+1},
    {toolOffset:1},{toolOffset:10},{toolOffset:0,unknown:true}]){
    await assert.rejects(fixture.request.onTool('read_context',args,'invalid-page'),/偏移/);
  }
  const explicit=JSON.parse(await fixture.request.onTool('read_context',{toolOffset:0},'explicit-first'));
  assert.deepEqual(explicit.tools,tools);assert.deepEqual(explicit.toolDirectory,{offset:0,total:1,nextOffset:null});
  await fixture.host.stop();
});

test('Local/Synthetic oversized single schema or current approval is rejected without truncation',async()=>{
  for(const hugeQuestion of [false,true]){
    const inputSchema={type:'object',properties:{value:{type:'string',enum:['public-option-'.repeat(3000)]}},additionalProperties:false};
    const tools=[{name:'fixture.oversized',version:'1',inputSchema:hugeQuestion?{type:'object',properties:{}}:inputSchema}];
    const question={kind:'approval',state:'pending',summary:hugeQuestion?'Exact pending parameters '.repeat(2000):'Current pending parameters'};
    const original=structuredClone({tools,question});
    const fixture=harness({readContext:()=>({tools,currentUserQuestion:question})});await fixture.host.start();
    await assert.rejects(fixture.request.onTool('read_context',{},'oversized'),hugeQuestion?/当前确认/:/单项工具 Schema/);
    assert.deepEqual({tools,question},original);
    await fixture.host.stop();
  }
});

test('Local/Synthetic exact goal with a new callId shares the original in-flight submission before taskId exists',async()=>{
  let finishSubmit,submits=0;
  const fixture=harness({client:{call(operation,payload){
    if(operation==='task.submit'){submits++;return new Promise(resolve=>{finishSubmit=resolve;});}
    return Promise.resolve({taskId:payload.taskId,state:'waiting_approval'});
  }},createConsumer:options=>({consume(value){return {result:(async()=>{
    const task=await options.client.call('task.submit',{goal:value.text});await options.client.call('task.get',task);
  })()};}})});
  await fixture.host.start();
  const first=fixture.request.onTool('request_work',{goal:'Exact pending goal'},'first-call');
  await new Promise(setImmediate);
  const repeated=fixture.request.onTool('request_work',{goal:'Exact pending goal'},'new-call');
  assert.equal(submits,1);finishSubmit({taskId:'original-submitting-task'});
  const result=await first;assert.match(result,/等待用户审批/);assert.equal(await repeated,result);
  assert.equal(submits,1);assert.equal(fixture.host.snapshot().workRequests.length,1);await fixture.host.stop();
});

test('Local/Synthetic exact goal after interruption reads the original pending task for new callIds',async()=>{
  let finishOriginal,submits=0;
  const fixture=harness({client:{async call(operation,payload){
    if(operation==='task.submit'){submits++;return {taskId:'original-pending-task'};}
    assert.equal(operation,'task.get');assert.equal(payload.taskId,'original-pending-task');
    return {taskId:payload.taskId,state:'waiting_approval'};
  }},createConsumer:options=>({consume(value){return {result:(async()=>{
    await options.client.call('task.submit',{goal:value.text});return new Promise(resolve=>{finishOriginal=resolve;});
  })()};}})});
  await fixture.host.start();
  const original=fixture.request.onTool('request_work',{goal:'Exact interrupted goal'},'original-call');
  await new Promise(setImmediate);fixture.request.onEvent({type:'interrupted'});
  const resumed=fixture.request.onTool('request_work',{goal:'Exact interrupted goal'},'resumed-call');
  const concurrent=fixture.request.onTool('request_work',{goal:'Exact interrupted goal'},'another-new-call');
  assert.match(await resumed,/等待用户审批/);assert.equal(await concurrent,await resumed);assert.equal(submits,1);
  finishOriginal({replyText:'Original final readback'});assert.equal(await original,'Original final readback');
  assert.equal(fixture.host.snapshot().workRequests.length,1);await fixture.host.stop();
});

test('Local/Synthetic exact goal can submit again only after its original task is read back terminal',async()=>{
  let finishOriginal,terminal=false,submits=0;
  const fixture=harness({client:{async call(operation,payload){
    if(operation==='task.submit'){submits++;return {taskId:`actual-task-${submits}`};}
    return {taskId:payload.taskId,state:terminal?'succeeded':'running',resultSummary:'Original terminal readback'};
  }},createConsumer:options=>({consume(value){return {result:(async()=>{
    const task=await options.client.call('task.submit',{goal:value.text});
    if(task.taskId==='actual-task-1')return new Promise(resolve=>{finishOriginal=resolve;});
    return {replyText:'Intentional second task result'};
  })()};}})});
  await fixture.host.start();
  const first=fixture.request.onTool('request_work',{goal:'Exact repeated weather query'},'weather-first');
  await new Promise(setImmediate);terminal=true;
  const second=fixture.request.onTool('request_work',{goal:'Exact repeated weather query'},'weather-again');
  const samePendingSecond=fixture.request.onTool('request_work',{goal:'Exact repeated weather query'},'weather-again-concurrent');
  assert.equal(await second,'Intentional second task result');assert.equal(await samePendingSecond,await second);assert.equal(submits,2);
  finishOriginal({replyText:'Original terminal readback'});assert.equal(await first,'Original terminal readback');
  assert.equal(fixture.host.snapshot().workRequests.length,2);await fixture.host.stop();
});

test('Local/Synthetic submission unknown preserves the original request after a real Runtime task exists and the reply is lost',async t=>{
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    coordination:{execute:async()=>({kind:'text',text:'Synthetic retained Runtime task',verification:'mock'})}});
  const realClient=new Client(app,Date.now);await realClient.connect();let submits=0,acceptedCallbacks=0;
  const fixture=harness({client:{async call(operation,payload,options){
    assert.equal(operation,'task.submit');submits++;await realClient.call(operation,payload,options);
    throw Error('Synthetic response lost after the original Runtime accepted the request');
  }},createConsumer:createRuntimeClientTranscriptConsumer,onTaskSubmitted(){acceptedCallbacks++;}});
  t.after(async()=>{await fixture.host.stop();for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,5));app.close();});
  await fixture.host.start();
  const first=await fixture.request.onTool('request_work',{goal:'Exact unknown submission'},'unknown-first');
  assert.match(first,/受理结果尚未确认/);assert.match(first,/submission_unknown/);
  assert.equal(await fixture.request.onTool('request_work',{goal:'Exact unknown submission'},'unknown-new-call'),first);
  const context=JSON.parse(await fixture.request.onTool('read_context',{},'unknown-context'));
  assert.equal(context.workRequests[0].state,'awaiting_result');assert.equal(context.workRequests[0].submissionUnknown,true);
  assert.equal(context.workRequests[0].taskId,undefined);assert.equal(context.handoff.phase,'submission_unknown');
  assert.equal(context.handoff.originalTasks[0].submissionUnknown,true);assert.equal(submits,1);assert.equal(acceptedCallbacks,0);
  assert.equal(app.runtime.listTasks({conversationId:'desktop-panel',limit:10}).items.length,1);
});

test('Local/Synthetic validation before submission stays failed and never claims an unknown accepted request',async()=>{
  let submits=0;
  const fixture=harness({client:{call(){submits++;throw Error('Unexpected dispatch');}},createConsumer:options=>({consume(value){return {
    result:options.client.call('task.submit',{goal:value.text,unexpected:'invalid-before-dispatch'})};}})});
  await fixture.host.start();
  await assert.rejects(fixture.request.onTool('request_work',{goal:'Invalid local request'},'invalid-first'),/提交参数无效/);
  const context=JSON.parse(await fixture.request.onTool('read_context',{},'invalid-context'));
  assert.equal(context.workRequests[0].state,'failed');assert.equal(context.workRequests[0].submissionUnknown,undefined);assert.equal(submits,0);
  await fixture.host.stop();
});


test('Local/Synthetic late accepted receipt replaces submission unknown without another submit',async t=>{
  let releaseSubmit,lateReceipt,submits=0;
  const fixture=harness({client:{call(operation,payload){
    if(operation==='task.submit'){submits++;return new Promise(resolve=>{releaseSubmit=resolve;});}
    return Promise.resolve({taskId:payload.taskId,state:'waiting_approval'});
  }},createConsumer:options=>({consume(value){
    lateReceipt=options.client.call('task.submit',{goal:value.text});
    return {result:Promise.reject(Error('Synthetic consumer wait ended before the original Client reply'))};
  }})});
  t.after(()=>fixture.host.stop());await fixture.host.start();
  assert.match(await fixture.request.onTool('request_work',{goal:'Exact late reply goal'},'late-original'),/受理结果尚未确认/);
  let context=JSON.parse(await fixture.request.onTool('read_context',{},'before-late-reply'));
  assert.equal(context.workRequests[0].submissionUnknown,true);
  releaseSubmit({taskId:'original-late-accepted-task'});await lateReceipt;
  context=JSON.parse(await fixture.request.onTool('read_context',{},'after-late-reply'));
  assert.equal(context.workRequests[0].taskId,'original-late-accepted-task');assert.equal(context.workRequests[0].state,'accepted');
  assert.equal(context.workRequests[0].submissionUnknown,undefined);assert.equal(context.workRequests[0].requestId,undefined);
  assert.notEqual(context.handoff.phase,'submission_unknown');
  assert.match(await fixture.request.onTool('request_work',{goal:'Exact late reply goal'},'late-new-call'),/等待用户审批/);
  assert.equal(submits,1);
});
