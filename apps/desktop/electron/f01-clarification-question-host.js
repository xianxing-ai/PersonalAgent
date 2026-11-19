import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {toolArgumentsDigest as digest} from '@personal-agent/tool-gateway';

const key='f01:clarification',fail=()=>{throw new ProtocolError('UNAUTHORIZED','原 F01 补问已失效');};
/** Original question/reply checkpoint CAS, identical lifetime rules to business questions. */
export function createF01ClarificationQuestionHost({getApplication,onUpdate=()=>{}}){
  const publish=()=>{try{onUpdate();}catch{}};
  function original(taskId,signal,confirmed=false){
    const app=getApplication(),runtime=app.runtime,read=app.readHostToolTask(taskId),parent=runtime.loadCheckpoint(taskId,'coding-repair:parent');
    const intent=parent&&runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId),host=runtime.loadCheckpoint(taskId,'host-tool-intent');
    if(signal?.aborted||read.task.cancelRequested||!['running',...(confirmed?['succeeded']:[])].includes(read.task.state)
      ||read.toolName!=='workflow.host.f01_n08'||read.commandId!==parent?.operationId||intent?.workflowId!=='F01'
      ||intent.proposal?.nodeId!=='F01_N08'||intent.proposal.toolName!==read.toolName||intent.proposal.operationId!==parent.operationId
      ||host?.deadline!==intent.deadline||Date.parse(intent.deadline)<=Date.now()||!isDeepStrictEqual(host.arguments,{})||!isDeepStrictEqual(intent.proposal.arguments,{}))return fail();
    const bound=app.readF01ContextBinding({taskId:parent.taskId,sessionId:intent.sessionId,signal:signal??new AbortController().signal});
    const record=runtime.readToolExecutions(taskId).find(item=>item.evidenceId==='host-tool-'+taskId),grant=runtime.policy.get('host-tool-'+taskId);
    const choices=bound?.binding.confirmedOperations.filter(item=>item.nodeId==='F01_N03'&&item.toolName==='decision.choose_candidate');
    if(!bound||bound.binding.deadline!==intent.deadline||choices.length!==1||!record?.executionStarted||record.policyDecision!=='allow'
      ||!['started',...(confirmed?['confirmed']:[])].includes(record.state)||!runtime.matchesToolExecutionInput(record,{arguments:{},scopeRef:record.evidenceId})
      ||grant?.taskId!==taskId||grant.toolName!==read.toolName||grant.argumentsDigest!==digest({})||!grant.scopes.includes('memory:read')||Date.parse(grant.expiresAt)<=Date.now()
      ||!bound.binding.confirmedOperations.some(item=>item.nodeId==='F01_N08'&&item.toolName==='workflow.guard.f01_n08'&&item.result.state==='selected'))return fail();
    const selected=choices[0],decision=runtime.loadCheckpoint(selected.localTaskId,'host-tool-intent');let context;
    try{context=JSON.parse(decision.arguments.context);}catch{return fail();}
    const values=context.candidateValues?.filter(item=>item.id===selected.result.selectedId),question=values?.[0]?.value?.question;
    if(context.workflowId!=='F01'||context.nodeId!=='F01_N03'||!isDeepStrictEqual(context.input,bound.binding.input)||values?.length!==1
      ||values[0].value.action!=='clarify'||typeof question!=='string'||!question||question.length>2048||question!==question.trim()||/[\u0000-\u001f\u007f]/u.test(question))return fail();
    return {taskId,parentTaskId:parent.taskId,sessionId:intent.sessionId,sourceTaskId:bound.user.taskId,conversationId:bound.user.conversationId,
      deadline:intent.deadline,configurationDigest:bound.binding.configurationDigest,destination:bound.destination,question};
  }
  function saved(taskId,signal,confirmed=false){const binding=original(taskId,signal,confirmed),value=getApplication().runtime.loadCheckpoint(taskId,key);
    if(!value||!isDeepStrictEqual(value.binding,binding)||value.questionId!=='f01-'+digest(binding)||value.revision!==1)return fail();
    return {...value,reply:getApplication().runtime.loadCheckpoint(taskId,key+':reply')};}
  const view=value=>({taskId:value.binding.taskId,graphTaskId:value.binding.parentTaskId,sourceTaskId:value.binding.sourceTaskId,questionId:value.questionId,
    revision:value.reply?2:1,state:value.reply?'answered':'pending',conversationId:value.binding.conversationId,deadline:value.binding.deadline,
    field:'responsibility.clarification',prompt:value.binding.question,...(value.reply?{answer:value.reply.answer}:{})});
  function readReply(scope){const ref=getApplication().runtime.loadCheckpoint(scope.parentTaskId,key+':ref');
    if(ref?.sessionId!==scope.sessionId)return fail();const value=saved(ref.taskId,scope.signal,true);
    if(value.binding.deadline!==scope.deadline||value.binding.parentTaskId!==scope.parentTaskId||!value.reply
      ||value.reply.questionId!==value.questionId||value.reply.sourceTaskId!==value.binding.sourceTaskId||value.reply.questionRevision!==1||value.reply.origin!=='desktop_explicit_text')return fail();
    return {state:'answered',questionId:value.questionId,questionRevision:2,answer:value.reply.answer,sourceTaskId:value.reply.sourceTaskId,commandId:value.reply.commandId};}
  return {readReply,
    readQuestion({taskId,conversationId}){try{const app=getApplication(),candidates=new Set([taskId]);
      for(const graph of [taskId,...app.readSubagentTasks(taskId).map(item=>item.taskId)]){const pending=app.readPendingOwnedWorkflowHostTask(graph),ref=app.runtime.loadCheckpoint(graph,key+':ref');if(pending)candidates.add(pending.taskId);if(ref?.taskId)candidates.add(ref.taskId);}
      const found=[];for(const id of candidates)try{const value=saved(id,undefined,true);if(value.binding.conversationId===conversationId&&[value.binding.sourceTaskId,value.binding.parentTaskId,value.binding.taskId].includes(taskId))found.push(value);}catch{}
      return found.length===1?view(found[0]):undefined;}catch{return undefined;}},
    submitReply(input,{conversationId}){
      if(!input||Object.keys(input).sort().join(',')!=='answer,commandId,expectedRevision,questionId,sourceTaskId,taskId'||typeof input.commandId!=='string'||!input.commandId.trim()||input.commandId.length>256
        ||typeof input.answer!=='string'||!input.answer||input.answer!==input.answer.trim()||input.answer.length>2048||/[\u0000-\u001f\u007f]/u.test(input.answer))return fail();
      const value=saved(input.taskId,undefined,true);if(conversationId!==value.binding.conversationId||input.sourceTaskId!==value.binding.sourceTaskId||input.questionId!==value.questionId||input.expectedRevision!==1)return fail();
      const reply={origin:'desktop_explicit_text',commandId:input.commandId,sourceTaskId:input.sourceTaskId,questionId:input.questionId,questionRevision:1,answer:input.answer};
      if(value.reply&&!isDeepStrictEqual(value.reply,reply))return fail();getApplication().runtime.saveCheckpointOnce(input.taskId,key+':reply',reply);
      if(!isDeepStrictEqual(getApplication().runtime.loadCheckpoint(input.taskId,key+':reply'),reply))return fail();publish();return view(saved(input.taskId,undefined,true));
    },
    async requestReply(scope,context){if(context.taskId!==scope.localTaskId||context.signal!==scope.signal)return fail();
      const binding=original(scope.localTaskId,scope.signal),runtime=getApplication().runtime;
      if(binding.parentTaskId!==scope.parentTaskId||binding.sessionId!==scope.sessionId||binding.deadline!==scope.deadline)return fail();
      runtime.saveCheckpointOnce(scope.localTaskId,key,{binding,questionId:'f01-'+digest(binding),revision:1});
      const ref={taskId:scope.localTaskId,sessionId:scope.sessionId};runtime.saveCheckpointOnce(scope.parentTaskId,key+':ref',ref);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(scope.parentTaskId,key+':ref'),ref))return fail();publish();
      for(;;){const value=saved(scope.localTaskId,scope.signal);if(value.reply)return readReply(scope);
        await new Promise(resolve=>{const done=()=>{clearTimeout(timer);scope.signal.removeEventListener('abort',done);resolve();};
          const timer=setTimeout(done,25);scope.signal.addEventListener('abort',done,{once:true});if(scope.signal.aborted)done();});}
    }};
}
