import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const fail=(code,message)=>{throw new ProtocolError(code,message);};

/** Genuine mail tools only; content and recipients must equal the original configured input. */
export function createF08MailWorkflowPorts({getApplication,bridge,authorizeExport,now=Date.now}={}) {
  if(typeof getApplication!=='function'||typeof bridge?.invoke!=='function'||typeof authorizeExport!=='function')
    throw Error('F08 requires Runtime binding and child Policy bridge');
  const binding=scope=>{
    if(scope.signal.aborted||Date.parse(scope.deadline)<=now())fail('CANCELLED','F08 operation is no longer active');
    const app=getApplication(),bound=app.readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId:'F08',sessionId:scope.sessionId,signal:scope.signal});
    if(!bound||bound.deadline!==scope.deadline)fail('UNAUTHORIZED','F08 original workflow binding unavailable');return {app,bound};
  };
  const key=scope=>'f08:original-send:'+scope.sessionId;
  const invoke=async(scope,input,context,kind)=>{
    const {app,bound}=binding(scope);
    if(!isDeepStrictEqual(input,bound.input[kind]))fail('UNAUTHORIZED','F08 mail action differs from the original plan');
    const receipt=await bridge.invoke({actionKey:'f08.mail.'+kind,input:structuredClone(input)},context);binding(scope);
    if(receipt.toolName!=='mail.'+kind||!isDeepStrictEqual(receipt.arguments,input))fail('UNAUTHORIZED','F08 original child receipt changed');
    if(kind==='send'){
      const original={taskId:receipt.taskId,runId:receipt.runId,messageId:receipt.result?.externalId,idempotencyKey:receipt.runId,operationId:scope.operationId};
      if(typeof original.messageId!=='string')fail('RESULT_UNKNOWN','F08 original Message-ID unavailable');
      app.runtime.saveCheckpointOnce(scope.parentTaskId,key(scope),original);
      if(!isDeepStrictEqual(app.runtime.loadCheckpoint(scope.parentTaskId,key(scope)),original))fail('REVISION_CONFLICT','F08 original send changed');
      return {...receipt.result,idempotencyKey:receipt.runId};
    }
    return receipt.result;
  };
  return {
    assertCurrent:scope=>{binding(scope);},
    async verifyArchiveBinding(scope,input){
      const {bound}=binding(scope);if(!isDeepStrictEqual(input,bound.input.archive))return false;
      const source=bound.confirmedOperations.find(op=>op.nodeId==='F08_N01'&&op.toolName==='mail.inbox');
      return source?.result?.items?.some(item=>item.source==='mail'&&item.accountRef===input.account
        &&item.externalId===input.folder+':'+input.uid
        &&item.dedupeKey===`${input.account}:${input.uidValidity}:${input.folder}:${input.uid}:${input.messageId}`)===true;
    },
    async verifySendBinding(scope,input){return isDeepStrictEqual(binding(scope).bound.input.send,input);},
    invokeArchive:(scope,input,context)=>invoke(scope,input,context,'archive'),
    invokeSend:(scope,input,context)=>invoke(scope,input,context,'send'),
    async resolveOriginalSend(scope){const {app}=binding(scope);return app.runtime.loadCheckpoint(scope.parentTaskId,key(scope));},
    async readReconciliation(scope,original){
      const {app,bound}=binding(scope),saved=app.runtime.loadCheckpoint(scope.parentTaskId,key(scope));
      if(!isDeepStrictEqual(saved,original))fail('UNAUTHORIZED','F08 original send binding changed');
      const op=bound.confirmedOperations.find(value=>value.nodeId==='F08_N11'&&value.toolName==='mail.reconcile_send');
      if(!op)return;
      const intent=app.runtime.loadCheckpoint(op.localTaskId,'host-tool-intent');
      if(!isDeepStrictEqual(intent?.arguments,{...(bound.input.send.account?{account:bound.input.send.account}:{}),
        messageId:original.messageId,idempotencyKey:original.idempotencyKey})||op.result?.externalId!==original.messageId)
        fail('UNAUTHORIZED','F08 reconciliation belongs to another send');
      return op.result;
    },
    async authorizeExport(scope,result){binding(scope);const allowed=await authorizeExport(scope,result);binding(scope);return allowed===true;},
  };
}
