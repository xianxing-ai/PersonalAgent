import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createRuntimeClientTranscriptConsumer} from '@personal-agent/voice';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createDesktopVoiceCommandHost} from '../electron/voice-command-host.js';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';
import {createVoiceRuntimeApprovalBridge} from '../electron/voice-runtime-approval-bridge.js';

// Local / Synthetic native audio events and cloud coordinator only. Real Runtime,
// public Client, schema/catalog, Policy/ToolGateway, approvals and Evidence are used.
// No microphone, speaker, native model network, real account or Laya is opened.
test('Local/Synthetic Live work -> current parameter question -> trusted final -> original approval/tool/Evidence -> original task result',async t=>{
  const conversationId='conversation-synthetic-dynamic',args={value:'Original current parameters'};
  let executions=0,submits=0,approvalResponses=0,request,frames,host;
  const descriptor={name:'fixture.voice_echo',version:'1.0.0',
    inputSchema:{type:'object',properties:{value:{type:'string',maxLength:128}},required:['value'],additionalProperties:false},
    outputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},
    sideEffect:'local_write',requiredScopes:['fixture:voice-write'],requiresPresence:false,idempotencySupport:true,recoverySupport:true};
  const coordinatorRequests=[];
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:[{descriptor,async execute(input){executions++;return input;}}],
    competitionToolAvailability:[{toolName:descriptor.name,toolVersion:descriptor.version,available:()=>true}],
    competitionToolExports:[{toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}],
    coordination:{async execute(input){coordinatorRequests.push(input);
      if(input.continuation){assert.deepEqual(input.continuation.result,args);return {kind:'text',text:'Original verified runtime result',verification:'unverified'};}
      assert.equal(input.availableTools[0].name,descriptor.name);
      assert.deepEqual(input.availableTools[0].inputSchema,descriptor.inputSchema);
      return {kind:'tool_proposal',proposalId:'synthetic-voice-proposal',toolName:descriptor.name,toolVersion:descriptor.version,arguments:args,verification:'unverified'};
    }}});
  const connected=new Client(app,Date.now);await connected.connect();
  const client={async call(operation,payload,options){if(operation==='task.submit')submits++;if(operation==='authorization.respond')approvalResponses++;
    return connected.call(operation,payload,options);}};
  const voice=createDesktopVoiceCommandHost({notifications:{},readApproval:approvalId=>{
    const approval=app.runtime.getApproval(approvalId),task=app.runtime.getTask(approval.taskId);
    const pending=app.runtime.loadCheckpoint(task.taskId,'competition-loop')?.pending;
    assert.equal(toolArgumentsDigest(pending.arguments),approval.argumentsDigest);
    return {...approval,taskState:task.state,summary:`${pending.toolName} 当前参数：${JSON.stringify(pending.arguments)}`};
  },respondApproval:input=>client.call('authorization.respond',input)});
  const bridge=createVoiceRuntimeApprovalBridge({readCurrentQuestion:()=>voice.snapshot(),prepareApproval:input=>voice.prepareApproval(input),
    readPendingApproval:scope=>{
      const task=app.runtime.getTask(scope.taskId);
      if(task.conversationId!==scope.conversationId || task.state!=='waiting_approval')return null;
      const item=app.runtime.listApprovals({taskId:scope.taskId,state:'pending'}).items[0];if(!item)return null;
      const approval=app.runtime.getApproval(item.approvalId),pending=app.runtime.loadCheckpoint(task.taskId,'competition-loop')?.pending;
      if(pending?.toolName!==approval.toolName || toolArgumentsDigest(pending.arguments)!==approval.argumentsDigest)return null;
      return {...approval,conversationId:task.conversationId,taskState:task.state};
    }});
  const contents={mainFrame:{},isDestroyed:()=>false,send(_channel,message){
    if(['start','stop'].includes(message.type))queueMicrotask(()=>host.receive({sender:contents,senderFrame:contents.mainFrame},
      {token:message.token,type:message.type==='start'?'ready':'stopped'}));}};
  host=createLiveVoiceHost({getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),
    config:{snapshot:()=>({configured:true}),current:()=>({})},readConversationId:()=>conversationId,
    microphoneHost:{authorize(){},revoke:async()=>{}},
    createSource:()=>({subscribe(value){frames=value;return {ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}};},dispose:async()=>{}}),
    createGateway:()=>({async connect(value){request=value;return {sendAudio(){},interrupt(){},close:async()=>{}};}}),
    client,createConsumer:options=>createRuntimeClientTranscriptConsumer({...options,pollIntervalMs:1}),onTaskSubmitted(){},onTranscript(){},
    readContext:()=>({currentUserQuestion:voice.snapshot(),tools:[{name:descriptor.name,inputSchema:descriptor.inputSchema,state:'registered_requires_task_authorization'}]}),
    readCurrentQuestion:()=>voice.snapshot(),onFinalUserCommand:receipt=>voice.consumeFinal(receipt),...bridge});
  t.after(async()=>{await host.stop();for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,5));app.close();});
  await host.start();
  const waiting=await request.onTool('request_work',{goal:'Synthetic exact argument write'},'synthetic-request');
  assert.match(waiting,/Original current parameters/);assert.equal(submits,1);assert.equal(executions,0);
  const question=voice.snapshot(),taskId=question.taskId;
  assert.equal(question.argumentsDigest,toolArgumentsDigest(args));assert.equal(question.state,'pending');
  assert.equal(await request.onTool('request_work',{goal:'Synthetic exact argument write'},'synthetic-request'),waiting);
  frames.onFrame({data:Uint8Array.of(0,0)});
  request.onEvent({type:'speech_started',utteranceId:'current-audio'});request.onEvent({type:'speech_stopped',utteranceId:'current-audio'});
  request.onEvent({type:'transcript',id:'partial',role:'user',text:'同意',source:'input_audio',utteranceId:'current-audio'});
  await new Promise(setImmediate);assert.equal(approvalResponses,0);
  request.onEvent({type:'transcript',id:'final',role:'user',text:'同意',phase:'final',source:'input_audio',utteranceId:'current-audio'});
  // A native model may request context in the same turn as the final transcript.
  // Context waits for that existing trusted receipt; it never approves anything.
  const confirmedContext=JSON.parse(await request.onTool('read_context',{},'after-final'));
  assert.equal(confirmedContext.voiceConfirmation.state,'confirmed');
  assert.equal(confirmedContext.voiceConfirmation.questionId,question.questionId);
  assert.equal(confirmedContext.currentUserQuestion.state,'confirmed');
  assert.equal(voice.snapshot().state,'confirmed');assert.equal(approvalResponses,1);
  assert.match(await request.onTool('wait_for_task',{taskId},'original-readback'),/Original verified runtime result/);
  assert.equal(submits,1);assert.equal(executions,1);assert.equal(coordinatorRequests.length,2);
  assert.equal(app.runtime.getTask(taskId).state,'succeeded');assert.ok(app.runtime.getTask(taskId).evidenceRefs.length>0);
  request.onEvent({type:'transcript',id:'final',role:'user',text:'同意',phase:'final',source:'input_audio',utteranceId:'current-audio'});
  await new Promise(setImmediate);assert.equal(approvalResponses,1);assert.equal(executions,1);
});

test('Synthetic bridge rejects cross-conversation and stale original approvals and reuses one current revision',async()=>{
  let current,prepares=0;
  const expiresAt=new Date(Date.now()+30_000).toISOString(),scope={taskId:'parent',conversationId:'dynamic-ui',deadline:expiresAt,signal:new AbortController().signal};
  let approval={taskId:'bound-child',requestTaskId:'parent',conversationId:'dynamic-ui',approvalId:'original-approval',revision:2,
    state:'pending',taskState:'waiting_approval',argumentsDigest:'a'.repeat(64),expiresAt};
  const bridge=createVoiceRuntimeApprovalBridge({readPendingApproval:()=>approval,readCurrentQuestion:()=>current,
    prepareApproval:input=>{prepares++;current={kind:'approval',taskId:approval.taskId,approvalId:input.approvalId,
      approvalRevision:input.expectedRevision,state:'pending',questionId:'question',revision:4,argumentsDigest:approval.argumentsDigest,expiresAt};return current;}});
  const first=await bridge.prepareTaskApproval(scope);assert.equal(first.taskId,'bound-child');
  assert.deepEqual(await bridge.prepareTaskApproval(scope),first);assert.equal(prepares,1);
  approval={...approval,conversationId:'another-ui'};assert.equal(await bridge.prepareTaskApproval(scope),null);
  approval={...approval,conversationId:'dynamic-ui',requestTaskId:'another-parent'};assert.equal(await bridge.prepareTaskApproval(scope),null);
  approval={...approval,requestTaskId:'parent',revision:1,state:'allowed'};assert.equal(await bridge.prepareTaskApproval(scope),null);
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(bridge.prepareTaskApproval({...scope,signal:cancelled.signal}),/失效/);
});
