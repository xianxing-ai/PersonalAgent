import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskRuntime} from '../dist/index.js';
import {AuthorizationQuestions} from '../dist/application/authorization-question.js';
import {createF02ConfirmationHost} from '../dist/application/workflow-f02-confirmation-host.js';

// Real SQLite Runtime approval, one-use Policy grant and AuthorizationQuestions.
// Graph HostTask readbacks, selection and export permissions are synthetic ports.
async function fixture(){
  let now=Date.now(),current=true,result,selection,exportAllowed=true;
  const deadline=new Date(now+60_000).toISOString(),signal=new AbortController().signal;
  const runtime=new TaskRuntime(':memory:',{now:()=>new Date(now)}),task=runtime.submitTask({goal:'Synthetic source',conversationId:'fixture',idempotencyKey:'f02-confirm'});
  runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
  const runId='source-run',digest='a'.repeat(64),descriptor={name:'fixture.operation',version:'1.0.0',inputSchema:{type:'object'},outputSchema:{type:'object'},
    sideEffect:'read',requiredScopes:['fixture:read'],idempotencySupport:true,recoverySupport:true,requiresPresence:false};
  runtime.requestToolApproval(runId,task.taskId,descriptor,deadline,digest);
  const questions=new AuthorizationQuestions({store:runtime.bindTrustedHostState('f02-confirm-fixture'),profiles:[{ref:'fixture',label:'fixture',mode:'read-only',revision:1,available:true}],
    defaultProfileRef:'fixture',now:()=>now,available:()=>true,readBinding:()=>current?{conversationId:'fixture',digest:'binding'}:undefined,canExecute:()=>current});
  const request={taskId:task.taskId,proposalId:'proposal',runId,toolName:descriptor.name,toolVersion:descriptor.version,argumentsDigest:digest,deadline,signal,
    requirements:[{requirementId:'tool',kind:'tool',scopes:['fixture:read'],bindingDigest:digest,summary:'Synthetic operation'}]};
  const pending=questions.request(request),question=questions.snapshot('fixture')[0];
  const prior={questionId:question.questionId,revision:question.revision,approvalRevision:1,toolName:descriptor.name,
    summary:question.description,argumentsDigest:digest,expiresAt:deadline};
  questions.respond({questionId:question.questionId,expectedRevision:question.revision,decision:'allow_once'},'fixture');
  const receipt=await pending;questions.consume(receipt,request,'tool',runId+':tool');
  runtime.respondApproval(runId,'allow_once',1);runtime.transitionTask(task.taskId,'running');
  const map=new Map(),put=(id,key,value)=>map.set(id+'|'+key,value);
  put('child','coding-repair:parent',{taskId:'parent',operationId:'operation'});
  put('child','host-tool-intent',{commandId:'operation',toolName:'workflow.host.f02_n05',arguments:{},deadline});
  put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId:'F02',sessionId:'session',deadline,
    proposal:{nodeId:'F02_N05',operationId:'operation',toolName:'workflow.host.f02_n05',arguments:{}}});
  put('question-host','coding-repair:parent',{taskId:'parent',operationId:'first-operation'});
  put('parent','owned-workflow:intent:first-operation',{taskId:'parent',workflowId:'F02',sessionId:'session',deadline,
    proposal:{nodeId:'F02_N01',operationId:'first-operation',toolName:'workflow.host.f02_n01',arguments:{}}});
  const app={runtime:{loadCheckpoint:(id,key)=>map.get(id+'|'+key),getTask:()=>({state:'running',cancelRequested:false}),getApproval:id=>runtime.getApproval(id),policy:runtime.policy},
    readHostToolTask:id=>id==='question-host'?{commandId:'first-operation',toolName:'workflow.host.f02_n01',task:{state:'succeeded'},
      confirmed:{runId:'host-tool-question-host',result:prior,evidenceRefs:['host-tool-question-host']}}:
      {commandId:'operation',toolName:'workflow.host.f02_n05',task:{state:'succeeded'},confirmed:{runId:'host-tool-child',result,evidenceRefs:['host-tool-child']}},
    readDelegatedUserTaskParent:()=>({taskId:'user',conversationId:'fixture',deadline}),readToolConversation:()=>current?'fixture':undefined,
    readAuthorizationQuestionInvocation:()=>({...request,scopes:['fixture:read']}),readAuthorizationQuestionBinding:()=>current?{conversationId:'fixture',digest:'binding'}:undefined};
  const options={application:app,questions,requiredScopes:['fixture:read'],resolveOriginalConfirmation:()=>selection,
    assertCurrent:()=>{if(!current)throw Error('private fixture diagnostic');},authorizeExport:async()=>exportAllowed,now:()=>new Date(now)};
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'fixture-grant',scopes:['fixture:read'],deadline,signal};
  return {runtime,questions,request,receipt,prior,options,context,put,select:()=>{selection={questionTaskId:'question-host',request,receipt};},
    setResult:value=>{result=value;},revoke:()=>{current=false;},expire:()=>{now+=60_001;},denyExport:()=>{exportAllowed=false;},close:()=>{questions.close();runtime.close();}};
}

test('F02 confirmation requires original user selection and existing one-use Policy authorization',async()=>{
  const f=await fixture();try{
    assert.equal(createF02ConfirmationHost().tools.length,0);
    const host=createF02ConfirmationHost(f.options);
    await assert.rejects(host.tools[0].execute({},f.context),{code:'UNSUPPORTED_CAPABILITY'});
    f.select();const result=await host.tools[0].execute({},f.context);f.setResult(result);
    assert.equal(result.state,'approved');assert.equal(result.questionRevision,2);assert.equal(result.approvalRevision,2);
    assert.equal(f.runtime.policy.get(f.request.runId).usesRemaining,1,'observation did not consume the Policy grant');
    await host.authorizeReceipt({context:f.context,result});
    await assert.rejects(host.tools[0].execute({confirmed:true},f.context));
    f.denyExport();await assert.rejects(host.authorizeReceipt({context:f.context,result}),{code:'UNAUTHORIZED'});
  }finally{f.close();}
});

test('F02 confirmation refuses revision changes, revoked or consumed Policy grants and expiry',async()=>{
  for(const change of [f=>{f.prior.revision=3;},f=>{f.prior.approvalRevision=3;},f=>{f.prior.argumentsDigest='b'.repeat(64);},
    f=>{f.options.application.readToolConversation=id=>id==='question-host'?undefined:'fixture';},
    f=>f.runtime.policy.revoke(f.request.runId),f=>f.revoke(),f=>f.expire(),
    f=>f.runtime.policy.authorize({authorizationRef:f.request.runId,taskId:f.request.taskId,toolName:f.request.toolName,
      argumentsDigest:f.request.argumentsDigest,requiredScopes:['fixture:read'],now:Date.now()})]){
    const f=await fixture();try{f.select();const host=createF02ConfirmationHost(f.options),result=await host.tools[0].execute({},f.context);
      f.setResult(result);change(f);await assert.rejects(host.authorizeReceipt({context:f.context,result}));
    }finally{f.close();}
  }
});
