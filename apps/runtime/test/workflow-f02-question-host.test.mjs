import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskRuntime} from '../dist/index.js';
import {AuthorizationQuestions} from '../dist/application/authorization-question.js';
import {createF02PendingQuestionHost} from '../dist/application/workflow-f02-question-host.js';

// Real SQLite approvals and AuthorizationQuestions; graph provenance and export
// authority are explicit synthetic composition ports, not real voice or cloud.
function fixture(){
  const now=Date.now(),deadline=new Date(now+60_000).toISOString(),signal=new AbortController().signal;
  const runtime=new TaskRuntime(':memory:',{now:()=>new Date(now)}),task=runtime.submitTask({goal:'Synthetic user operation',conversationId:'fixture',idempotencyKey:'f02-source'});
  runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
  const runId='source-run',digest='a'.repeat(64),descriptor={name:'fixture.operation',version:'1.0.0',inputSchema:{type:'object'},outputSchema:{type:'object'},
    sideEffect:'read',requiredScopes:['fixture:read'],idempotencySupport:true,recoverySupport:true,requiresPresence:false};
  runtime.requestToolApproval(runId,task.taskId,descriptor,deadline,digest);
  let current=true,exportAllowed=true,result,selection;
  const questions=new AuthorizationQuestions({store:runtime.bindTrustedHostState('f02-question-fixture'),profiles:[{ref:'fixture',label:'fixture',mode:'read-only',revision:1,available:true}],
    defaultProfileRef:'fixture',now:()=>now,available:()=>true,readBinding:()=>current?{conversationId:'fixture',digest:'binding'}:undefined,canExecute:()=>true});
  const pending=questions.request({taskId:task.taskId,proposalId:'proposal',runId,toolName:descriptor.name,toolVersion:descriptor.version,argumentsDigest:digest,deadline,signal,
    requirements:[{requirementId:'tool',kind:'tool',scopes:['fixture:read'],bindingDigest:digest,summary:'Synthetic operation summary'}]});
  const question=questions.snapshot('fixture')[0],map=new Map(),put=(id,key,value)=>map.set(id+'|'+key,value);
  put('child','coding-repair:parent',{taskId:'parent',operationId:'operation'});
  put('child','host-tool-intent',{commandId:'operation',toolName:'workflow.host.f02_n01',arguments:{},deadline});
  put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId:'F02',sessionId:'session',deadline,
    proposal:{nodeId:'F02_N01',operationId:'operation',toolName:'workflow.host.f02_n01',arguments:{}}});
  const app={runtime:{loadCheckpoint:(id,key)=>map.get(id+'|'+key),getTask:()=>({state:'running',cancelRequested:false}),getApproval:id=>runtime.getApproval(id)},
    readHostToolTask:()=>({commandId:'operation',toolName:'workflow.host.f02_n01',task:{state:'succeeded'},confirmed:{runId:'host-tool-child',result,evidenceRefs:['host-tool-child']}}),
    readDelegatedUserTaskParent:()=>({taskId:'user',conversationId:'fixture',deadline}),readToolConversation:()=>current?'fixture':undefined,
    readPendingToolInvocation:(id,run)=>id===task.taskId&&run===runId&&runtime.getApproval(run).state==='pending'
      ?{toolName:descriptor.name,toolVersion:descriptor.version,arguments:{},argumentsDigest:digest,deadline}:undefined};
  const options={application:app,questions,requiredScopes:['fixture:read'],resolveOriginalQuestion:()=>selection,
    assertCurrent:()=>{if(!current)throw Error('private fixture diagnostic');},authorizeExport:async()=>exportAllowed,now:()=>new Date(now)};
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'fixture-grant',scopes:['fixture:read'],deadline,signal};
  return {runtime,questions,pending,task,runId,question,options,context,put,select:()=>{selection={questionId:question.questionId,sourceTaskId:task.taskId,runId};},
    setResult:value=>{result=value;},revoke:()=>{current=false;},denyExport:()=>{exportAllowed=false;},close:async()=>{questions.close();await pending.catch(()=>{});runtime.close();}};
}

test('F02 requires real ports and does not choose another pending question',async()=>{
  const f=fixture();try{
    assert.equal(createF02PendingQuestionHost().tools.length,0);
    const host=createF02PendingQuestionHost(f.options);
    await assert.rejects(host.tools[0].execute({},f.context),{code:'UNSUPPORTED_CAPABILITY'});
    f.select();const result=await host.tools[0].execute({},f.context);
    assert.equal(result.questionId,f.question.questionId);assert.equal(result.revision,1);assert.equal(result.approvalRevision,1);
    assert.equal(result.argumentsDigest,'a'.repeat(64));f.setResult(result);
    await host.authorizeReceipt({context:f.context,result});
    await assert.rejects(host.tools[0].execute({questionId:'model-picked'},f.context));
    f.denyExport();await assert.rejects(host.authorizeReceipt({context:f.context,result}),{code:'UNAUTHORIZED'});
  }finally{await f.close();}
});

test('F02 cannot export a changed, answered or revoked original question',async()=>{
  for(const change of [f=>f.questions.respond({questionId:f.question.questionId,expectedRevision:1,decision:'deny'},'fixture'),
    f=>f.runtime.invalidatePendingApproval(f.runId,'stale'),f=>f.revoke(),f=>{
      const original=f.options.application.readPendingToolInvocation;
      f.options.application.readPendingToolInvocation=(...args)=>({...original(...args),argumentsDigest:'b'.repeat(64)});
    }]){
    const f=fixture();try{f.select();const host=createF02PendingQuestionHost(f.options),result=await host.tools[0].execute({},f.context);
      f.setResult(result);change(f);await assert.rejects(host.authorizeReceipt({context:f.context,result}));
    }finally{await f.close();}
  }
});
