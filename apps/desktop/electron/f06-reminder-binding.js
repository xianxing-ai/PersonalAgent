import {isDeepStrictEqual} from 'node:util';

const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.trim().length>0;

/** Prove F06_N04 reads the same-graph N03 confirmed todoId/revision. Never invent reminders. */
export function createVerifyWorkflowReminderBinding({getApplication}={}) {
  if(typeof getApplication!=='function')throw Error('F06 reminder binding requires the original Runtime application');
  return async({todoId,revision,context}={})=>{
    if(!text(todoId)||!Number.isSafeInteger(revision)||revision<1||!plain(context)||!text(context.taskId)
      ||!(context.signal instanceof AbortSignal)||context.signal.aborted)return false;
    const application=getApplication();
    if(!application?.runtime)return false;
    try {
      const parent=application.runtime.loadCheckpoint(context.taskId,'coding-repair:parent');
      if(!plain(parent)||!text(parent.taskId)||!text(parent.operationId))return false;
      const intent=application.runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
      const host=application.runtime.loadCheckpoint(context.taskId,'host-tool-intent');
      if(!plain(intent)||intent.workflowId!=='F06'||intent.taskId!==parent.taskId||!text(intent.sessionId)
        ||intent.proposal?.nodeId!=='F06_N04'||intent.proposal.operationId!==parent.operationId
        ||intent.proposal.toolName!=='workflow.host.f06_n04'||!plain(host)||host.commandId!==parent.operationId
        ||host.toolName!=='workflow.host.f06_n04'||!isDeepStrictEqual(host.arguments,intent.proposal.arguments))return false;
      const binding=application.runtime.loadCheckpoint(parent.taskId,'f06:n03-todo:'+intent.sessionId);
      return plain(binding)&&binding.sessionId===intent.sessionId&&binding.todoId===todoId
        &&binding.revision===revision&&text(binding.operationId);
    }catch{return false;}
  };
}
