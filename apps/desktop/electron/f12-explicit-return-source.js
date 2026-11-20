import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {notificationDigest} from '@personal-agent/notifications';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
const text={type:'string',minLength:1,maxLength:256};
export const F12_EXPLICIT_RETURN_SOURCE_SCHEMA={type:'object',additionalProperties:false,
  properties:{taskId:text,sessionId:text,sourceTaskId:text,commandId:text,controlRevision:{type:'integer',minimum:1}},
  required:['taskId','sessionId','sourceTaskId','commandId','controlRevision']};

/** Main calls acceptExplicitReturn only after the original trusted panel/admin return control.
 * This marker records that UI origin; it issues no grant and never submits a task or delivery. */
export function createF12ExplicitReturnSource({getApplication,readPersistedWorkflow,now=Date.now}={}) {
  if(typeof getApplication!=='function'||typeof readPersistedWorkflow!=='function')
    throw Error('F12 return source requires the original Runtime persisted control reader');
  const key=source=>'desktop-f12:explicit-return:'+notificationDigest(source.commandId);
  const current=source=>{
    if(!source||Object.keys(source).length!==5||['taskId','sessionId','sourceTaskId','commandId'].some(name=>typeof source[name]!=='string'||!source[name].trim()||source[name].length>256)
      ||!Number.isSafeInteger(source.controlRevision)||source.controlRevision<1)fail('INVALID_ARGUMENT','F12 explicit return reference invalid');
    const app=getApplication(),runtime=app.runtime,task=runtime.getTask(source.taskId),user=runtime.getTask(source.sourceTaskId);
    if(task.cancelRequested||user.cancelRequested||['succeeded','failed','cancelled','cancelling'].includes(task.state)
      ||['failed','cancelled','cancelling'].includes(user.state)||!user.conversationId||user.conversationId!==task.conversationId
      ||[task.taskId,user.taskId].some(id=>runtime.loadCheckpoint(id,'private-copy-erasure')!==undefined
        ||runtime.loadCheckpoint(id,'private-copy-erasure-binding')!==undefined))fail('UNAUTHORIZED','F12 original return source is inactive');
    const persisted=readPersistedWorkflow(runtime,source.taskId,source.sessionId),state=persisted?.application?.state;
    const command=state?.commands?.[source.commandId],binding=state?.binding;
    if(!binding||binding.taskId!==source.taskId||binding.sessionId!==source.sessionId||binding.controlRevision!==source.controlRevision
      ||Date.parse(binding.taskDeadline)<=now()||!Number.isFinite(Date.parse(binding.taskDeadline))
      ||state.conversationId!==user.conversationId||state.pendingControl||command?.revision!==source.controlRevision
      ||!isDeepStrictEqual(command.command,{commandId:source.commandId,action:'return',expectedControlRevision:source.controlRevision-1,sourceTaskId:source.sourceTaskId})
      ||command.control?.action!=='return'||command.control.commandId!==source.commandId||!command.control.evidenceRefs?.length
      ||state.lastResult?.mode!=='attended'||persisted.session?.state.binding.controlRevision!==source.controlRevision
      ||!Object.values(state.requests).some(request=>request.acknowledged===true&&request.input.controlRevision===source.controlRevision
        &&request.input.control?.commandId===source.commandId&&request.input.control.action==='return'))
      fail('REVISION_CONFLICT','F12 original return control is not current and acknowledged');
    return {version:1,origin:'desktop_explicit_return',source:structuredClone(source),conversationId:user.conversationId,taskDeadline:binding.taskDeadline};
  };
  return {
    acceptExplicitReturn(source){
      const proof=current(source),runtime=getApplication().runtime;
      runtime.saveCheckpointOnce(source.taskId,key(source),proof);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(source.taskId,key(source)),proof))fail('REVISION_CONFLICT','F12 original explicit return marker changed');
      return {source:structuredClone(source),conversationId:proof.conversationId,taskDeadline:proof.taskDeadline,
        idempotencyKey:'f12-return-'+notificationDigest([source.taskId,source.commandId])};
    },
    read(source,scope){
      if(!(scope.signal instanceof AbortSignal)||scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.parse(scope.deadline)<=now())
        fail('CANCELLED','F12 return read cancelled or expired');
      const proof=current(source),app=getApplication(),taskId=scope.parentTaskId??scope.taskId,task=app.runtime.getTask(taskId);
      const conversationId=app.readToolConversation(taskId)??task.conversationId;
      if(task.cancelRequested||['succeeded','failed','cancelled','cancelling'].includes(task.state)
        ||app.runtime.loadCheckpoint(taskId,'private-copy-erasure')!==undefined||app.runtime.loadCheckpoint(taskId,'private-copy-erasure-binding')!==undefined
        ||conversationId!==proof.conversationId||Date.parse(scope.deadline)>Date.parse(proof.taskDeadline)
        ||!isDeepStrictEqual(app.runtime.loadCheckpoint(source.taskId,key(source)),proof))
        fail('UNAUTHORIZED','F12 original UI return marker or conversation unavailable');
      return structuredClone(proof);
    },
  };
}
