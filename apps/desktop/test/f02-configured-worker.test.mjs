import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,AuthorizationQuestions} from '@personal-agent/runtime/application';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createF02WorkflowWorkerPorts} from '../electron/f02-workflow-worker-ports.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const until=async read=>{for(let i=0;i<1500;i++){const value=read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Original F02 fixture did not settle');};
const schema=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});

// Actual delegated worker, Runtime, Policy, HostBridge and card service. Cloud
// image, ASR/device/independent acoustic verifier and business service are Fake.
async function fixture(t,{acoustic=true,forgeSettled=false,unknown=false,denyExport=false,replaceInput=false,cancelAtPlayback=false,cancelAtTranscript=false,revokeAtTranscript=false,alterOriginalInput=false,
  transcript='同意',denyVoice=false,cancelAtDecision=false,alterPendingInput=false,revokeFinalAfterReceipt=false}={}){
  let app,questions,source,question,voiceTime,steps=0,calls=0,playbackStarted=false,transcriptRead=false,revoked=false,finalRevoked=false;const exports=[];
  const business={descriptor:{name:'fixture.voice.operation',version:'1.0.0',sideEffect:'local_write',requiredScopes:['fixture:write'],
    inputSchema:schema({value:{const:'original'}}),outputSchema:schema({done:{const:true}}),requiresPresence:false,idempotencySupport:false,recoverySupport:false},
    execute:async()=>{calls++;if(unknown)throw Object.assign(Error('Synthetic accepted, result unknown'),{code:'RESULT_UNKNOWN'});return {done:true};}};
  const final=binding=>{transcriptRead=true;if(cancelAtTranscript||revokeAtTranscript||finalRevoked)return undefined;
    const receipt=question?{...binding,sessionId:'synthetic-voice',utteranceId:'synthetic-utterance',text:transcript,
    transcriptDigest:createHash('sha256').update(transcript).digest('hex'),source:'live_input_audio',phase:'final',origin:'user',
    echo:'unknown',questionPlaybackVerified:false,startedAt:new Date(voiceTime-200).toISOString(),completedAt:new Date(voiceTime-100).toISOString(),expiresAt:question.expiresAt}:undefined;
    return receipt&&factory.authorizeFinalRead(binding,receipt)?receipt:undefined;
  };
  const live={askCurrentQuestion:()=>{playbackStarted=true;voiceTime??=Date.now();return {state:'queued',questionId:question.questionId,questionRevision:1};},
    readQuestionDelivery:()=>cancelAtPlayback?undefined:({sessionId:'synthetic-voice',drainId:'synthetic-drain',completedAt:new Date(voiceTime-300).toISOString(),playbackVerified:false}),
    readFinalUserAudio:final,readFinalCaptureEvidence:binding=>({sessionId:'synthetic-voice',utteranceId:'synthetic-utterance',
      transcriptDigest:final(binding)?.transcriptDigest,capture:{synthetic:true}})};
  const authorization=new Proxy({},{get(_target,name){return (...args)=>questions[name](...args);}});
  const factory=createF02WorkflowWorkerPorts({getApplication:()=>app,authorizationQuestions:authorization,liveVoiceHost:live,
    microphoneHost:{readCaptureReceipt:()=>({synthetic:true})},voiceCommandHost:{prepareApproval:()=>question},
    ...(acoustic?{verifyAudioEvidence:()=>true}:{}),authorizeExport:async input=>{exports.push(input);return !denyExport;}});
  assert.equal(factory.tools.length,13,'all fixed local F02 host and guard tools are registered');
  assert.equal(factory.authorizeFinalRead({deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal},{}),false);
  const ordered=['guard:F02_N01','host:F02_N01','host:F02_N02','host:F02_N03','guard:F02_N05',
    ...(denyVoice?['host:F02_N08']:['host:F02_N05','host:F02_N06','host:F02_N11'])];
  const options={...factory.configuredWorkflowWorkerPorts[0],image:{bindingId:'synthetic-f02-image',receiptSecret:async()=> 'synthetic-f02-secret-at-least-32-characters',
    advance:async request=>{
      if(revokeFinalAfterReceipt&&request.receipts.some(receipt=>receipt.nodeId==='F02_N03'))finalRevoked=true;
      if(alterPendingInput&&request.receipts.some(receipt=>receipt.nodeId==='F02_N03')){
        const read=app.readPendingToolInvocation.bind(app);
        app.readPendingToolInvocation=(...args)=>{const invocation=read(...args);return invocation&&args[0]===source.taskId?{...invocation,argumentsDigest:'0'.repeat(64)}:invocation;};
      }
      if(request.receipts.some(receipt=>receipt.nodeId==='F02_N05'&&receipt.result.state==='approved')&&!cancelAtDecision){
        await until(()=>['succeeded','waiting_reconciliation','failed','cancelled'].includes(app.runtime.getTask(source.taskId).state));
        if(alterOriginalInput){
          assert.equal(app.runtime.getTask(source.taskId).state,'succeeded','substitute only after the original effect is confirmed');
          const key='application-tool-invocation:host-tool-'+source.taskId,original=app.runtime.loadCheckpoint(source.taskId,key);
          app.runtime.saveCheckpoint(source.taskId,key,{...original,arguments:{value:'substituted'}});
        }
      }
      const nodes=Object.fromEntries(ordered.slice(0,steps).map(value=>[value.split(':')[1],{state:'completed'}]));
      if(forgeSettled||steps===ordered.length)return {workflowId:'F02',workflowVersion:'1.0.0',checkpoint:'synthetic-settled',state:'settled',nodes,proposals:[]};
      const [kind,nodeId]=ordered[steps++].split(':'),tool=factory.tools.find(tool=>tool.descriptor.name==='workflow.'+kind+'.'+nodeId.toLowerCase());
      const args=kind==='host'?{}:{workflowId:'F02',nodeId,input:replaceInput?{...request.input,questionId:'other-question'}:request.input,predecessorOutputs:{},predecessorStates:{}};
      nodes[nodeId]={state:'waiting_receipt'};
      return {workflowId:'F02',workflowVersion:'1.0.0',checkpoint:'synthetic-'+steps,state:'awaiting_host',nodes,
        proposals:[{kind:'tool_proposal',nodeId,operationId:'synthetic-operation-'+steps,proposalId:'synthetic-operation-'+steps,
          originControlRevision:0,inputDigest:hash(args),toolSchemaDigest:hash(tool.descriptor.inputSchema),
          toolName:tool.descriptor.name,toolVersion:'1.0.0',arguments:args,resourceKeys:[],effect:tool.descriptor.sideEffect==='read'?'read':'write'}]};
    }}};
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const tools=[dispatch,business,...factory.tools];
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'synthetic-f02-user',
    coordinationBinding:'synthetic-f02',tools,configuredWorkflowWorkers:[options],
    automaticTools:[dispatch,...factory.tools].map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version})),
    requestToolAuthorization:scope=>questions.requestToolAuthorization(scope),
    coordination:{execute:async request=>{
      if(request.continuation)return {kind:'text',text:'Original F02 receipt observed',verification:'mock'};
      const parent=app.readDelegatedUserTaskParent(request.taskId);assert.ok(parent);
      if(!source){
        const invocation={commandId:'synthetic-original-operation',toolName:business.descriptor.name,toolVersion:'1.0.0',arguments:{value:'original'},deadline:request.deadline};
        source=app.prepareHostToolTask(invocation);
        app.runtime.saveCheckpoint(source.taskId,'coding-repair:parent',{taskId:parent.taskId,operationId:invocation.commandId});
        app.runtime.saveCheckpoint(parent.taskId,'coding-repair:host:'+invocation.commandId,{localTaskId:source.taskId,request:invocation});
        app.finalizeHostToolTask({taskId:source.taskId,commandId:invocation.commandId,arguments:invocation.arguments,expectedTaskRevision:source.revision});
        question=await until(()=>questions.snapshot(parent.conversationId).find(item=>item.taskId===source.taskId));
      }
      return {kind:'tool_proposal',proposalId:'synthetic-f02',toolName:options.toolName,toolVersion:'1.0.0',arguments:{questionId:question.questionId},verification:'mock'};
    }},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))});
  questions=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'synthetic-f02-questions',resolveConversation:scope=>app.readToolConversation(scope.taskId),available:()=>true,
    profiles:[{ref:'synthetic',label:'Synthetic isolated policy',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'synthetic'});
  t.after(async()=>{for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    await until(()=>app.activeTaskCount===0);questions.close();app.close();});
  const client=new Client(app);await client.connect();const root=await client.call('task.submit',{goal:'Synthetic original voice question',conversationId:'f02-chat'},
    {idempotencyKey:'synthetic-f02',timeoutMs:60000});
  let child;
  for(let i=0;i<1500;i++){
    for(const approval of app.runtime.listApprovals({state:'pending'}).items){
      if(approval.taskId===source?.taskId)continue;
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    }
    [child]=app.readSubagentTasks(root.taskId);
    if(child&&cancelAtPlayback&&playbackStarted&&!child.cancelRequested)app.runtime.requestCancel(child.taskId);
    if(child&&cancelAtTranscript&&transcriptRead&&!child.cancelRequested)app.runtime.requestCancel(child.taskId);
    if(child&&cancelAtDecision&&!child.cancelRequested&&app.runtime.listTasks({limit:100}).items.some(task=>
      app.runtime.readToolExecutions(task.taskId).some(record=>record.toolName==='workflow.guard.f02_n05'&&record.executionStarted))){
      assert.equal(questions.snapshot(question.conversationId).find(item=>item.questionId===question.questionId).state,'pending');
      app.runtime.requestCancel(child.taskId);
    }
    if(child&&revokeAtTranscript&&transcriptRead&&!revoked){
      const read=app.runtime.listTasks({limit:100}).items.flatMap(task=>app.runtime.readToolExecutions(task.taskId))
        .find(record=>record.toolName==='workflow.host.f02_n03');
      if(read){app.runtime.policy.revoke(read.evidenceId);revoked=true;}
    }
    if(child&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  return {app,root,child,source,question,factory,exports,get calls(){return calls;}};
}

test('actual configured F02 accepts verified final voice through the original card, reads consumed zero-use grant, and never submits again',async t=>{
  const f=await fixture(t);assert.equal(f.child.state,'succeeded',JSON.stringify(f.child.error));assert.equal(f.calls,1);
  const record=f.app.runtime.readToolExecutions(f.source.taskId)[0];assert.equal(record.executionStarted,true);assert.equal(record.policyDecision,'allow');
  assert.equal(f.app.runtime.policy.get(record.evidenceId).usesRemaining,0);
  assert.ok(f.exports.some(item=>item.stage==='initial'));assert.ok(f.exports.some(item=>item.stage==='completion'));
});

test('verified final refusal denies the original operation without a business write',async t=>{
  const f=await fixture(t,{transcript:'不同意。',denyVoice:true});
  assert.equal(f.child.state,'succeeded',JSON.stringify(f.child.error));assert.equal(f.calls,0);
  assert.equal(f.app.runtime.getApproval('host-tool-'+f.source.taskId).state,'denied');
});

test('conditional final voice stays pending and cannot approve changed original arguments',async t=>{
  const conditional=await fixture(t,{transcript:'同意，但只发给我自己',cancelAtDecision:true});
  assert.equal(conditional.child.state,'cancelled');assert.equal(conditional.calls,0);
  const changed=await fixture(t,{alterPendingInput:true});
  assert.equal(changed.child.state,'failed');assert.equal(changed.calls,0);
  const revoked=await fixture(t,{revokeFinalAfterReceipt:true});
  assert.equal(revoked.child.state,'failed');assert.equal(revoked.calls,0);
});

test('configured F02 refuses missing acoustics, forged completion, denied export and substituted question input',async t=>{
  for(const options of [{acoustic:false},{forgeSettled:true},{denyExport:true},{replaceInput:true}])await t.test(JSON.stringify(options),async child=>{
    const f=await fixture(child,options);assert.equal(f.child.state,'failed');assert.equal(f.calls,0);
    assert.equal(f.exports.some(item=>item.stage==='completion'),false);
  });
});

test('cancelling F02 while waiting on original playback prevents audio consumption and the business write',async t=>{
  const f=await fixture(t,{cancelAtPlayback:true});assert.equal(f.child.state,'cancelled');assert.equal(f.calls,0);
  assert.equal(f.exports.some(item=>item.stage==='completion'),false);
});

test('original N03 waits for final ASR with its own Policy grant and cancellation stops the wait',async t=>{
  const f=await fixture(t,{cancelAtTranscript:true});assert.equal(f.child.state,'cancelled');assert.equal(f.calls,0);
  assert.equal(f.exports.some(item=>item.stage==='completion'),false);
});

test('revoking the original N03 grant stops waiting without reading a final or creating a write',async t=>{
  const f=await fixture(t,{revokeAtTranscript:true});assert.equal(f.child.state,'failed');assert.equal(f.calls,0);
  assert.equal(f.exports.some(item=>item.stage==='completion'),false);
});

test('an unknown original write cannot complete F02 or cause another dispatch',async t=>{
  const f=await fixture(t,{unknown:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.calls,1);
  const record=f.app.runtime.readToolExecutions(f.source.taskId)[0];assert.equal(record.executionStarted,true);
  assert.notEqual(record.state,'confirmed');assert.equal(f.exports.some(item=>item.stage==='completion'),false);
});

test('a consumed grant with substituted original arguments cannot confirm F02',async t=>{
  const f=await fixture(t,{alterOriginalInput:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.calls,1);
  assert.equal(f.app.runtime.readToolExecutions(f.source.taskId)[0].state,'confirmed','the actual prior effect is preserved');
  assert.equal(f.exports.some(item=>item.stage==='completion'),false);
});
