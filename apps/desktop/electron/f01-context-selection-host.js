import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createF01QueryBinding,readPersistedRuntimeProactiveWorkflow} from '@personal-agent/runtime/application';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key='f01:context-selection';
const fail=()=>{throw new ProtocolError('UNAUTHORIZED','F01 原公开来源选择已失效');};

/** One exact native source choice. Fact body export remains a separate permission. */
export function createF01ContextSelectionHost({getApplication,getPublicFactHost,getAuthorizationIntentHost,readDeploymentBinding}) {
  function original(scope){
    const app=getApplication(),bound=app?.readF01ContextBinding({taskId:scope.parentTaskId,sessionId:scope.sessionId,signal:scope.signal});
    const input=bound?.binding.input.context,memory=getPublicFactHost(),deployment=readDeploymentBinding();
    if(!bound||bound.binding.deadline!==scope.deadline||scope.signal.aborted||Date.parse(scope.deadline)<=Date.now()
      ||!input||Object.keys(input).sort().join(',')!=='fact,responsibilitySession'
      ||Object.keys(input.fact??{}).sort().join(',')!=='id,revision'
      ||Object.keys(input.responsibilitySession??{}).sort().join(',')!=='sessionId,taskId'
      ||typeof deployment!=='string'||!deployment||!memory?.memoryNamespace)return fail();
    const fact=memory.facts?.readCurrentPublicFact(input.fact),target=input.responsibilitySession;
    if(!fact||!isDeepStrictEqual(fact.ref,input.fact)||fact.sensitivity!=='public'||fact.state!=='active')return fail();
    const desktop=app.runtime.loadCheckpoint(target.taskId,'desktop-proactive-workflow-v1');
    const persisted=readPersistedRuntimeProactiveWorkflow(app.runtime,target.taskId,target.sessionId);
    const source=desktop?.sourceTaskId&&app.runtime.getTask(desktop.sourceTaskId),owner=app.runtime.getTask(target.taskId);
    if(!persisted||desktop?.taskId!==target.taskId||desktop.sessionId!==target.sessionId||desktop.contractRef!==persisted.application.state.contractRef
      ||desktop.taskDeadline!==persisted.application.state.binding.taskDeadline||source?.conversationId!==bound.user.conversationId
      ||!source.goal||source.cancelRequested||owner.cancelRequested||['succeeded','failed','cancelled','cancelling'].includes(owner.state)
      ||Date.parse(desktop.taskDeadline)<Date.parse(scope.deadline)
      ||[target.taskId,source.taskId].some(id=>app.runtime.loadCheckpoint(id,'private-copy-erasure')!==undefined
        ||app.runtime.loadCheckpoint(id,'private-copy-erasure-binding')!==undefined))return fail();
    const payload={fact:{...fact.ref},sourceRef:fact.sourceRef,limit:1,responsibilitySession:{...target}};
    const binding={parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,userTaskId:bound.user.taskId,
      conversationId:bound.user.conversationId,deadline:scope.deadline,configurationDigest:bound.binding.configurationDigest,
      memoryNamespace:memory.memoryNamespace,deployment,destination:bound.destination};
    return {app,memory,fact,payload,binding};
  }
  function confirmed(value,scope){
    const current=original(scope),ref=value?.decision;
    if(!ref||!isDeepStrictEqual(value.payload,current.payload)||!isDeepStrictEqual(value.binding,current.binding)
      ||ref.action!=='reference.source'||ref.deadline!==scope.deadline||ref.payloadDigest!==digest(value.payload)||ref.scopeDigest!==digest(value.binding))return fail();
    // Independently check original Runtime evidence; the callback and boolean are not authority.
    const task=current.app.readHostToolTask(ref.taskId),invocation=current.app.readAuthorizationQuestionInvocation(ref.taskId,ref.runId,true);
    if(task?.commandId!==ref.commandId||task.toolName!=='desktop.authorization.intent'||task.toolVersion!=='1.0.0'
      ||task.task.state!=='succeeded'||task.confirmed?.runId!==ref.runId||!task.confirmed.evidenceRefs.includes(ref.runId)
      ||!isDeepStrictEqual(task.confirmed.result,{decisionRecorded:true})||!invocation||invocation.deadline!==scope.deadline
      ||invocation.toolName!==task.toolName||invocation.toolVersion!==task.toolVersion
      ||!isDeepStrictEqual(invocation.arguments,{action:ref.action,payloadDigest:ref.payloadDigest,scopeDigest:ref.scopeDigest}))return fail();
    return current;
  }
  function selection(value){return {selectionId:value.decision.commandId,parentTaskId:value.binding.parentTaskId,
    sessionId:value.binding.sessionId,userTaskId:value.binding.userTaskId,factId:value.payload.fact.id,sourceRef:value.payload.sourceRef,limit:1};}
  function query(app){return createF01QueryBinding({application:app,now:()=>new Date(),verifyOriginalSelection:(candidate,lifetime)=>{
    const scope={...lifetime,parentTaskId:candidate.parentTaskId,sessionId:candidate.sessionId};
    const saved=app.runtime.loadCheckpoint(candidate.parentTaskId,key);confirmed(saved,scope);
    return getApplication()===app&&isDeepStrictEqual(candidate,selection(saved));
  }});}
  return {
    assertCurrent(scope){const app=getApplication();confirmed(app.runtime.loadCheckpoint(scope.parentTaskId,key),scope);},
    resolveQuery(scope){return query(getApplication()).resolveQuery(scope);},
    async prepare(scope){
      const initial=original(scope),saved=initial.app.runtime.loadCheckpoint(scope.parentTaskId,key);
      if(saved){confirmed(saved,scope);await query(initial.app).resolveQuery(scope);return true;}
      const intent=getAuthorizationIntentHost();if(typeof intent?.request!=='function')return false;
      const current=()=>{try{const value=original(scope);return value.app===initial.app&&value.memory.facts===initial.memory.facts
        &&isDeepStrictEqual(value.payload,initial.payload)&&isDeepStrictEqual(value.binding,initial.binding);}catch{return false;}};
      return intent.request({action:'reference.source',payload:initial.payload,scope:initial.binding,deadline:scope.deadline,signal:scope.signal,isCurrent:current,
        summary:'选择公开 Fact '+initial.fact.ref.id+'@'+initial.fact.ref.revision+'，仅查询此来源（1 项）；责任会话 '+initial.payload.responsibilitySession.sessionId+'。正文出机另行确认。',
        onConfirmed:decision=>{
          const value={payload:initial.payload,binding:initial.binding,decision};confirmed(value,scope);
          initial.app.runtime.saveCheckpointOnce(scope.parentTaskId,key,value);
          if(!isDeepStrictEqual(initial.app.runtime.loadCheckpoint(scope.parentTaskId,key),value))return fail();
          query(initial.app).recordSelection(selection(value),undefined,scope);
        }});
    },
  };
}
