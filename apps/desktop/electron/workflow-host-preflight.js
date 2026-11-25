import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

/** Prepare the existing business question/export wrapper before its independent Policy card.
 * This selects metadata only; the original HostBridge and ToolGateway still prove execution authority. */
export async function prepareWorkflowHostPreflight({application,scope,prepareExport}) {
  if(scope.runId!=='host-tool-'+scope.taskId)return;
  const runtime=application.runtime,parent=runtime.loadCheckpoint(scope.taskId,'coding-repair:parent');
  if(!parent)return;
  const marker=runtime.loadCheckpoint(scope.taskId,'workflow-business-tool:source');
  const graphParent=marker?runtime.loadCheckpoint(parent.taskId,'coding-repair:parent'):parent;
  const graph=graphParent&&runtime.loadCheckpoint(graphParent.taskId,'owned-workflow:intent:'+graphParent.operationId);
  if(!graph&&!marker)return;
  const denied=()=>{throw new ProtocolError('UNAUTHORIZED','Original workflow export preparation changed');};
  if(!graph||graph.taskId!==graphParent.taskId||graph.proposal?.operationId!==graphParent.operationId
    ||marker&&(marker.sourceTaskId!==parent.taskId||marker.sourceRunId!=='host-tool-'+parent.taskId||marker.commandId!==parent.operationId))denied();
  const pending=application.readPendingToolInvocation(scope.taskId,scope.runId),host=application.readHostToolTask(scope.taskId);
  const edge=runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId);
  const current=()=>{
    const original=application.readPendingToolInvocation(scope.taskId,scope.runId);
    const owner=runtime.getTask(graphParent.taskId);
    if(scope.signal.aborted||!pending||!isDeepStrictEqual(original,pending)||original.toolName!==scope.toolName
      ||original.toolVersion!==scope.toolVersion||original.argumentsDigest!==scope.argumentsDigest||original.deadline!==scope.deadline
      ||host.commandId!==parent.operationId||edge?.localTaskId!==scope.taskId
      ||edge.request?.commandId!==host.commandId||edge.request.toolName!==original.toolName||edge.request.toolVersion!==original.toolVersion
      ||edge.request.deadline!==scope.deadline||!isDeepStrictEqual(edge.request.arguments,original.arguments)
      ||!isDeepStrictEqual(runtime.loadCheckpoint(scope.taskId,'coding-repair:parent'),parent)
      ||!isDeepStrictEqual(runtime.loadCheckpoint(scope.taskId,'workflow-business-tool:source'),marker)
      ||marker&&!isDeepStrictEqual(runtime.loadCheckpoint(parent.taskId,'coding-repair:parent'),graphParent)
      ||!isDeepStrictEqual(runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId),edge)
      ||owner.cancelRequested||!['running','waiting_approval'].includes(owner.state)||graph.deadline!==scope.deadline
      ||!isDeepStrictEqual(runtime.loadCheckpoint(graphParent.taskId,'owned-workflow:intent:'+graphParent.operationId),graph))denied();
  };
  current();
  await prepareExport({phase:'preflight',taskId:scope.taskId,runId:scope.runId,deadline:scope.deadline,signal:scope.signal,
    proposal:{kind:'tool_proposal',proposalId:host.commandId,toolName:pending.toolName,toolVersion:pending.toolVersion,
      arguments:structuredClone(pending.arguments),verification:'unverified'}});
  current();
}
