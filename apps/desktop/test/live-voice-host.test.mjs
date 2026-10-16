import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.deepEqual(submitted,{taskId:'task-live',goal:'合成任务'});
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
  releases.get('A')();
  assert.match(await first,/A failed/);
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


