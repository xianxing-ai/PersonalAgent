import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {toolArgumentsDigest as digest} from '@personal-agent/tool-gateway';

const key='business-workflow:F11:location-question',reference=key+':ref';
const fail=(code,message)=>{throw new ProtocolError(code,message);};

/** Business input on the original N01 task. Main alone records an explicit text reply; this is never a grant. */
export function createF11LocationQuestionHost({getApplication,onUpdate=()=>{},now=Date.now}) {
  const publish=()=>{try{onUpdate();}catch{}};
  function original(taskId,signal,allowConfirmed=false) {
    const app=getApplication(),runtime=app.runtime,task=runtime.getTask(taskId),parent=runtime.loadCheckpoint(taskId,'coding-repair:parent');
    const host=runtime.loadCheckpoint(taskId,'host-tool-intent'),intent=parent&&runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
    if(signal?.aborted||task.cancelRequested||!['running',...(allowConfirmed?['succeeded']:[])].includes(task.state)
      ||!parent||host?.toolName!=='workflow.host.f11_n01'||host.commandId!==parent.operationId||intent?.workflowId!=='F11'
      ||intent.proposal?.nodeId!=='F11_N01'||intent.proposal.toolName!==host.toolName||intent.proposal.operationId!==parent.operationId
      ||intent.deadline!==host.deadline||Date.parse(host.deadline)<=now()||!Number.isFinite(Date.parse(host.deadline))
      ||!isDeepStrictEqual(intent.proposal.arguments,host.arguments))fail('UNAUTHORIZED','F11 original location question host unavailable');
    const bound=app.readConfiguredWorkflowBinding({taskId:parent.taskId,workflowId:'F11',sessionId:intent.sessionId,signal:signal??new AbortController().signal});
    const user=app.readDelegatedUserTaskParent(parent.taskId),owner=runtime.getTask(parent.taskId),runId='host-tool-'+taskId;
    const record=runtime.readToolExecutions(taskId).find(item=>item.evidenceId===runId),grant=runtime.policy.get(runId);
    if(!bound||bound.deadline!==host.deadline||!user||user.deadline!==host.deadline||!user.conversationId
      ||owner.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(owner.state)
      ||runtime.getTask(user.taskId).cancelRequested||['failed','cancelled','cancelling'].includes(runtime.getTask(user.taskId).state)
      ||[taskId,parent.taskId,user.taskId].some(id=>runtime.loadCheckpoint(id,'private-copy-erasure')!==undefined||runtime.loadCheckpoint(id,'private-copy-erasure-binding')!==undefined)
      ||!isDeepStrictEqual(host.arguments,{weather:bound.input.weather})||bound.input.weather?.query.location!==undefined
      ||!record||!['started',...(allowConfirmed?['confirmed']:[])].includes(record.state)||!record.executionStarted||record.policyDecision!=='allow'
      ||record.toolName!==host.toolName||!runtime.matchesToolExecutionInput(record,{arguments:host.arguments,scopeRef:runId})
      ||!grant||grant.taskId!==taskId||grant.toolName!==host.toolName||grant.argumentsDigest!==digest(host.arguments)
      ||!grant.scopes.includes('weather:read')||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=now())
      fail('UNAUTHORIZED','F11 original location question source or Policy changed');
    return {taskId,parentTaskId:parent.taskId,sessionId:intent.sessionId,operationId:parent.operationId,runId,
      sourceTaskId:user.taskId,conversationId:user.conversationId,deadline:host.deadline,argumentsDigest:digest(host.arguments),weather:bound.input.weather};
  }
  function saved(taskId,signal,allowConfirmed=false) {
    const current=original(taskId,signal,allowConfirmed),question=getApplication().runtime.loadCheckpoint(taskId,key);
    if(!question||!isDeepStrictEqual(question.binding,current)||question.questionId!=='f11-location-'+digest(current)
      ||question.state!=='pending'||question.revision!==1)
      fail('REVISION_CONFLICT','F11 original location question binding changed');
    const reply=getApplication().runtime.loadCheckpoint(taskId,key+':reply');
    return reply?{...question,state:'answered',revision:2,reply}:question;
  }
  const view=question=>({taskId:question.binding.taskId,graphTaskId:question.binding.parentTaskId,sourceTaskId:question.binding.sourceTaskId,questionId:question.questionId,
    revision:question.revision,state:question.state,conversationId:question.binding.conversationId,deadline:question.binding.deadline,
    field:'weather.location',prompt:'请明确输入这次天气查询的城市或地点。',...(question.reply?{location:question.reply.location}: {})});
  function resolved(scope) {
    const runtime=getApplication().runtime,ref=runtime.loadCheckpoint(scope.parentTaskId,reference);
    if(!ref||ref.sessionId!==scope.sessionId)fail('UNSUPPORTED_CAPABILITY','F11 original location answer unavailable');
    const question=saved(ref.taskId,scope.signal,true);
    if(question.binding.parentTaskId!==scope.parentTaskId||question.binding.deadline!==scope.deadline||question.state!=='answered'
      ||question.revision!==2||question.reply?.origin!=='desktop_explicit_text'||!question.reply.commandId
      ||question.reply.sourceTaskId!==question.binding.sourceTaskId||question.reply.questionRevision!==1
      ||question.reply.questionId!==question.questionId||typeof question.reply.location!=='string'||!question.reply.location.trim())
      fail('UNAUTHORIZED','F11 original explicit location answer unavailable');
    return {...structuredClone(question.binding.weather.query),location:question.reply.location};
  }
  return {
    readQuestion({taskId,conversationId}) {
      try {
        const app=getApplication(),graphs=[taskId,...app.readSubagentTasks(taskId).map(task=>task.taskId)],candidates=new Set([taskId]);
        for(const graph of graphs){const host=app.readPendingOwnedWorkflowHostTask(graph);
          if(host)candidates.add(host.taskId);const ref=app.runtime.loadCheckpoint(graph,reference);if(ref?.taskId)candidates.add(ref.taskId);}
        const found=[];
        for(const id of candidates)try{const question=saved(id,undefined,true);
          if(question.binding.conversationId===conversationId&&[question.binding.taskId,question.binding.parentTaskId,question.binding.sourceTaskId].includes(taskId))found.push(question);
        }catch{ /* Only the original live N01 relationship is discoverable. */ }
        return found.length===1?view(found[0]):undefined;
      }catch{return undefined;}
    },
    submitReply(input,{conversationId}) {
      if(!input||Object.keys(input).sort().join(',')!=='commandId,expectedRevision,location,questionId,sourceTaskId,taskId'
        ||typeof input.commandId!=='string'||!input.commandId.trim()||input.commandId.length>256||typeof input.location!=='string'
        ||!input.location.trim()||input.location.length>512||input.location!==input.location.trim()||/[\u0000-\u001f\u007f]/u.test(input.location))
        fail('INVALID_ARGUMENT','F11 explicit location reply invalid');
      const question=saved(input.taskId,undefined,true);
      if(question.binding.conversationId!==conversationId||input.sourceTaskId!==question.binding.sourceTaskId
        ||input.questionId!==question.questionId||input.expectedRevision!==1)fail('REVISION_CONFLICT','F11 original reply target changed');
      const reply={origin:'desktop_explicit_text',commandId:input.commandId,sourceTaskId:input.sourceTaskId,
        questionId:input.questionId,questionRevision:input.expectedRevision,location:input.location};
      if(question.reply){if(!isDeepStrictEqual(question.reply,reply))fail('REVISION_CONFLICT','F11 location already has another explicit reply');return view(question);}
      if(question.state!=='pending'||question.revision!==input.expectedRevision)fail('REVISION_CONFLICT','F11 location question revision changed');
      const runtime=getApplication().runtime;runtime.saveCheckpointOnce(input.taskId,key+':reply',reply);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(input.taskId,key+':reply'),reply))fail('REVISION_CONFLICT','F11 location reply was concurrently changed');
      publish();return view(saved(input.taskId,undefined,true));
    },
    readResolvedQuery:resolved,
    async requestLocation(scope,context) {
      if(context.taskId!==scope.localTaskId||context.runId!=='host-tool-'+scope.localTaskId||context.signal!==scope.signal)
        fail('UNAUTHORIZED','F11 original location execution context changed');
      const binding=original(scope.localTaskId,scope.signal),runtime=getApplication().runtime;
      if(binding.parentTaskId!==scope.parentTaskId||binding.sessionId!==scope.sessionId||binding.deadline!==scope.deadline)
        fail('UNAUTHORIZED','F11 location graph scope changed');
      runtime.saveCheckpointOnce(scope.localTaskId,key,{binding,questionId:'f11-location-'+digest(binding),revision:1,state:'pending'});
      const ref={taskId:scope.localTaskId,sessionId:scope.sessionId};runtime.saveCheckpointOnce(scope.parentTaskId,reference,ref);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(scope.parentTaskId,reference),ref))fail('REVISION_CONFLICT','F11 original question reference changed');publish();
      for(;;){
        const question=saved(scope.localTaskId,scope.signal);
        if(question.state==='answered')return resolved(scope);
        await new Promise(resolve=>{
          const done=()=>{clearTimeout(timer);scope.signal.removeEventListener('abort',done);resolve();};
          const timer=setTimeout(done,25);scope.signal.addEventListener('abort',done,{once:true});if(scope.signal.aborted)done();
        });
      }
    },
  };
}
