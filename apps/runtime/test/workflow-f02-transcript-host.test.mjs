import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createF02FinalTranscriptHost} from '../dist/application/workflow-f02-transcript-host.js';

// Synthetic host ports and provider observations. This does not prove ASR,
// microphone hardware, absence of echo, or question playback.
function fixture(){
  const now=Date.now(),deadline=new Date(now+60_000).toISOString(),signal=new AbortController().signal;
  let verified=false,allowed=true,result,questionState='pending',bindingPresent=true;
  const source={questionTaskId:'question-host',questionId:'question',questionRevision:1,sourceTaskId:'source',sourceApprovalId:'source-run',sessionId:'voice',utteranceId:'utterance'};
  const receipt={sessionId:'voice',utteranceId:'utterance',conversationId:'fixture',questionId:'question',questionRevision:1,
    sourceTaskId:'source',sourceApprovalId:'source-run',text:'合成转写',transcriptDigest:createHash('sha256').update('合成转写').digest('hex'),
    source:'live_input_audio',phase:'final',origin:'user',echo:'unknown',questionPlaybackVerified:false,
    startedAt:new Date(now-1000).toISOString(),completedAt:new Date(now-500).toISOString(),expiresAt:deadline};
  const prior={questionId:'question',revision:1,approvalRevision:1,toolName:'fixture.operation',argumentsDigest:'a'.repeat(64)},map=new Map();
  const put=(id,key,value)=>map.set(id+'|'+key,value);
  put('child','coding-repair:parent',{taskId:'parent',operationId:'operation'});
  put('child','host-tool-intent',{commandId:'operation',toolName:'workflow.host.f02_n03',arguments:{},deadline});
  put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId:'F02',sessionId:'session',deadline,
    proposal:{nodeId:'F02_N03',operationId:'operation',toolName:'workflow.host.f02_n03',arguments:{}}});
  put('question-host','coding-repair:parent',{taskId:'parent',operationId:'first-operation'});
  put('parent','owned-workflow:intent:first-operation',{taskId:'parent',workflowId:'F02',sessionId:'session',deadline,
    proposal:{nodeId:'F02_N01',operationId:'first-operation',toolName:'workflow.host.f02_n01',arguments:{}}});
  const application={runtime:{loadCheckpoint:(id,key)=>map.get(id+'|'+key),getTask:()=>({state:'running',cancelRequested:false}),
    getApproval:()=>({state:'pending',taskId:'source',approvalId:'source-run',revision:1,argumentsDigest:'a'.repeat(64)})},
    readHostToolTask:id=>id==='question-host'?{commandId:'first-operation',toolName:'workflow.host.f02_n01',task:{state:'succeeded'},
      confirmed:{runId:'host-tool-question-host',result:prior,evidenceRefs:['host-tool-question-host']}}:
      {commandId:'operation',toolName:'workflow.host.f02_n03',task:{state:'succeeded'},confirmed:{runId:'host-tool-child',result,evidenceRefs:['host-tool-child']}},
    readDelegatedUserTaskParent:()=>({taskId:'user',conversationId:'fixture',deadline}),readToolConversation:()=> 'fixture',
    readPendingToolInvocation:()=>({toolName:'fixture.operation',argumentsDigest:'a'.repeat(64)})};
  const questions={refresh(){},snapshot:()=>[{questionId:'question',revision:1,taskId:'source',sourceApprovalId:'source-run',
    state:questionState,toolName:'fixture.operation',expiresAt:deadline}]};
  const options={application,questions,requiredScopes:['fixture:read'],resolveOriginalVoice:()=>bindingPresent?source:undefined,
    readFinal:()=>structuredClone(receipt),verifyAudioEvidence:()=>verified,assertCurrent:()=>{},authorizeExport:async()=>allowed,now:()=>new Date(now)};
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'fixture-grant',scopes:['fixture:read'],deadline,signal};
  return {options,context,receipt,prior,put,select:()=>{verified=true;},unselect:()=>{bindingPresent=false;},
    setResult:value=>{result=value;},denyExport:()=>{allowed=false;},answer:()=>{questionState='allowed';},revoke:()=>{verified=false;}};
}

test('F02 final transcript requires original selected voice and separate real acoustic/playback evidence',async()=>{
  const f=fixture();assert.equal(createF02FinalTranscriptHost().tools.length,0);
  const host=createF02FinalTranscriptHost(f.options);
  await assert.rejects(host.tools[0].execute({},f.context),{code:'UNSUPPORTED_CAPABILITY'});
  f.select();const result=await host.tools[0].execute({},f.context);f.setResult(result);
  assert.equal(result.text,'合成转写');await host.authorizeReceipt({context:f.context,result});
  await assert.rejects(host.tools[0].execute({text:'model-forged'},f.context));
  f.denyExport();await assert.rejects(host.authorizeReceipt({context:f.context,result}),{code:'UNAUTHORIZED'});
});

test('F02 refuses partial, model, wrong event identity, stale question and revoked audio evidence',async()=>{
  for(const change of [f=>{f.receipt.phase='partial';},f=>{f.receipt.origin='model';},f=>{f.receipt.source='output_audio';},
    f=>{f.receipt.echo=true;},f=>{f.receipt.utteranceId='other';},f=>{f.receipt.text='replaced';},f=>f.answer(),f=>f.revoke(),f=>f.unselect(),
    f=>{f.options.application.readToolConversation=id=>id==='question-host'?undefined:'fixture';}]){
    const f=fixture();f.select();const host=createF02FinalTranscriptHost(f.options),result=await host.tools[0].execute({},f.context);
    f.setResult(result);change(f);await assert.rejects(host.authorizeReceipt({context:f.context,result}));
  }
});
