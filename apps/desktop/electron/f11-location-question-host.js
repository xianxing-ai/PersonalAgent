import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {toolArgumentsDigest as digest} from '@personal-agent/tool-gateway';

const fail=(code,message)=>{throw new ProtocolError(code,message);};

/** The two fixed F11 questions share only original task/message/CAS checks, never tool authorization. */
function createQuestionHost({getApplication,onUpdate=()=>{},now=Date.now},kind) {
  const location=kind==='location',nodeId=location?'F11_N01':'F11_N04',toolName='workflow.host.'+nodeId.toLowerCase();
  const key='business-workflow:F11:'+kind+'-question',reference=key+':ref',field=location?'location':'decision';
  const questionId=binding=>'f11-'+kind+'-'+digest(binding);
  const publish=()=>{try{onUpdate();}catch{}};
  function original(taskId,signal,allowConfirmed=false) {
    const app=getApplication(),runtime=app.runtime,task=runtime.getTask(taskId),parent=runtime.loadCheckpoint(taskId,'coding-repair:parent');
    const host=runtime.loadCheckpoint(taskId,'host-tool-intent'),intent=parent&&runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
    if(signal?.aborted||task.cancelRequested||!['running',...(allowConfirmed?['succeeded']:[])].includes(task.state)
      ||!parent||host?.toolName!==toolName||host.commandId!==parent.operationId||intent?.workflowId!=='F11'
      ||intent.proposal?.nodeId!==nodeId||intent.proposal.toolName!==host.toolName||intent.proposal.operationId!==parent.operationId
      ||intent.deadline!==host.deadline||Date.parse(host.deadline)<=now()||!Number.isFinite(Date.parse(host.deadline))
      ||!isDeepStrictEqual(intent.proposal.arguments,host.arguments))fail('UNAUTHORIZED','F11 original question host unavailable');
    const bound=app.readConfiguredWorkflowBinding({taskId:parent.taskId,workflowId:'F11',sessionId:intent.sessionId,signal:signal??new AbortController().signal});
    const user=app.readDelegatedUserTaskParent(parent.taskId),owner=runtime.getTask(parent.taskId),runId='host-tool-'+taskId;
    const record=runtime.readToolExecutions(taskId).find(item=>item.evidenceId===runId),grant=runtime.policy.get(runId);
    if(!bound||bound.deadline!==host.deadline||!user||user.deadline!==host.deadline||!user.conversationId
      ||owner.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(owner.state)
      ||runtime.getTask(user.taskId).cancelRequested||['failed','cancelled','cancelling'].includes(runtime.getTask(user.taskId).state)
      ||[taskId,parent.taskId,user.taskId].some(id=>runtime.loadCheckpoint(id,'private-copy-erasure')!==undefined||runtime.loadCheckpoint(id,'private-copy-erasure-binding')!==undefined)
      ||!isDeepStrictEqual(host.arguments,location?{weather:bound.input.weather}:{update:bound.input.update,reminder:bound.input.reminder})
      ||(location?bound.input.weather?.query.location!==undefined:!bound.confirmedOperations.some(operation=>operation.nodeId==='F11_N04'
        &&operation.toolName==='workflow.guard.f11_n04'&&operation.result.state==='selected'))
      ||!record||!['started',...(allowConfirmed?['confirmed']:[])].includes(record.state)||!record.executionStarted||record.policyDecision!=='allow'
      ||record.toolName!==host.toolName||!runtime.matchesToolExecutionInput(record,{arguments:host.arguments,scopeRef:runId})
      ||!grant||grant.taskId!==taskId||grant.toolName!==host.toolName||grant.argumentsDigest!==digest(host.arguments)
      ||(location?['weather:read']:['calendar:read','todo:read']).some(scope=>!grant.scopes.includes(scope))
      ||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=now())
      fail('UNAUTHORIZED','F11 original question source or Policy changed');
    return {taskId,parentTaskId:parent.taskId,sessionId:intent.sessionId,operationId:parent.operationId,runId,
      sourceTaskId:user.taskId,conversationId:user.conversationId,deadline:host.deadline,argumentsDigest:digest(host.arguments),
      ...(location?{weather:bound.input.weather}:{plan:{update:bound.input.update,reminder:bound.input.reminder}})};
  }
  function saved(taskId,signal,allowConfirmed=false) {
    const current=original(taskId,signal,allowConfirmed),question=getApplication().runtime.loadCheckpoint(taskId,key);
    if(!question||!isDeepStrictEqual(question.binding,current)||question.questionId!==questionId(current)
      ||question.state!=='pending'||question.revision!==1)
      fail('REVISION_CONFLICT','F11 original question binding changed');
    const reply=getApplication().runtime.loadCheckpoint(taskId,key+':reply');
    return reply?{...question,state:'answered',revision:2,reply}:question;
  }
  const view=question=>({taskId:question.binding.taskId,graphTaskId:question.binding.parentTaskId,sourceTaskId:question.binding.sourceTaskId,questionId:question.questionId,
    revision:question.revision,state:question.state,conversationId:question.binding.conversationId,deadline:question.binding.deadline,
    field:location?'weather.location':'plan.decision',prompt:location?'请明确输入这次天气查询的城市或地点。':'是否采用当前日历方案？后续写入仍需各自审批。',
    ...(!location?{plan:structuredClone(question.binding.plan),choices:[{id:'accept',label:'采用原方案'},{id:'decline',label:'不采用'}]}:{}),
    ...(question.reply?{[field]:question.reply[field]}: {})});
  function resolved(scope) {
    const runtime=getApplication().runtime,ref=runtime.loadCheckpoint(scope.parentTaskId,reference);
    if(!ref||ref.sessionId!==scope.sessionId)fail('UNSUPPORTED_CAPABILITY','F11 original answer unavailable');
    const question=saved(ref.taskId,scope.signal,true);
    if(question.binding.parentTaskId!==scope.parentTaskId||question.binding.deadline!==scope.deadline||question.state!=='answered'
      ||question.revision!==2||question.reply?.origin!=='desktop_explicit_text'||!question.reply.commandId
      ||question.reply.sourceTaskId!==question.binding.sourceTaskId||question.reply.questionRevision!==1
      ||question.reply.questionId!==question.questionId||(location?typeof question.reply.location!=='string'||!question.reply.location.trim()
        :!['accept','decline'].includes(question.reply.decision)))
      fail('UNAUTHORIZED','F11 original explicit answer unavailable');
    return location?{...structuredClone(question.binding.weather.query),location:question.reply.location}
      :{decision:question.reply.decision,questionId:question.questionId,questionRevision:question.revision,
        sourceTaskId:question.binding.sourceTaskId,commandId:question.reply.commandId};
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
        }catch{ /* Only the original fixed question host relationship is discoverable. */ }
        return found.length===1?view(found[0]):undefined;
      }catch{return undefined;}
    },
    submitReply(input,{conversationId}) {
      if(!input||Object.keys(input).sort().join(',')!==['commandId','expectedRevision',field,'questionId','sourceTaskId','taskId'].sort().join(',')
        ||typeof input.commandId!=='string'||!input.commandId.trim()||input.commandId.length>256
        ||(location?typeof input.location!=='string'||!input.location.trim()||input.location.length>512||input.location!==input.location.trim()
          ||/[\u0000-\u001f\u007f]/u.test(input.location):!['accept','decline'].includes(input.decision)))
        fail('INVALID_ARGUMENT','F11 explicit reply invalid');
      const question=saved(input.taskId,undefined,true);
      if(question.binding.conversationId!==conversationId||input.sourceTaskId!==question.binding.sourceTaskId
        ||input.questionId!==question.questionId||input.expectedRevision!==1)fail('REVISION_CONFLICT','F11 original reply target changed');
      const reply={origin:'desktop_explicit_text',commandId:input.commandId,sourceTaskId:input.sourceTaskId,
        questionId:input.questionId,questionRevision:input.expectedRevision,[field]:input[field]};
      if(question.reply){if(!isDeepStrictEqual(question.reply,reply))fail('REVISION_CONFLICT','F11 question already has another explicit reply');return view(question);}
      if(question.state!=='pending'||question.revision!==input.expectedRevision)fail('REVISION_CONFLICT','F11 question revision changed');
      const runtime=getApplication().runtime;runtime.saveCheckpointOnce(input.taskId,key+':reply',reply);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(input.taskId,key+':reply'),reply))fail('REVISION_CONFLICT','F11 reply was concurrently changed');
      publish();return view(saved(input.taskId,undefined,true));
    },
    readReply:resolved,
    async requestReply(scope,context) {
      if(context.taskId!==scope.localTaskId||context.runId!=='host-tool-'+scope.localTaskId||context.signal!==scope.signal)
        fail('UNAUTHORIZED','F11 original question execution context changed');
      const binding=original(scope.localTaskId,scope.signal),runtime=getApplication().runtime;
      if(binding.parentTaskId!==scope.parentTaskId||binding.sessionId!==scope.sessionId||binding.deadline!==scope.deadline)
        fail('UNAUTHORIZED','F11 question graph scope changed');
      runtime.saveCheckpointOnce(scope.localTaskId,key,{binding,questionId:questionId(binding),revision:1,state:'pending'});
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

export function createF11LocationQuestionHost(options) {
  const {readReply,requestReply,...host}=createQuestionHost(options,'location');
  return {...host,readResolvedQuery:readReply,requestLocation:requestReply};
}

export function createF11DecisionQuestionHost(options) {
  const {readReply,requestReply,...host}=createQuestionHost(options,'decision');
  return {...host,readDecision:readReply,requestDecision:requestReply};
}
