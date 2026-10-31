import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {getOwnedWorkflowTemplate} from '@personal-agent/agentarts';

/** Select the original configured graph's question preparation, without borrowing F15/F20 workspace authority. */
export function readConfiguredWorkflowDecisionScope(application,scope) {
  const original=application.readAuthorizationQuestionInvocation(scope.taskId,scope.runId);
  if(original?.toolName!=='decision.choose_candidate')return;
  const runtime=application.runtime,parent=runtime.loadCheckpoint(scope.taskId,'coding-repair:parent');
  const intent=parent&&runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
  if(!intent||['F09','F15','F20'].includes(intent.workflowId))return;
  const fail=()=>{throw new ProtocolError('UNAUTHORIZED','原配置工作流的判断来源已变化');};
  const graph=runtime.getTask(parent.taskId),host=application.readHostToolTask(scope.taskId);
  const edge=runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId);
  const binding=application.readConfiguredWorkflowBinding({taskId:parent.taskId,workflowId:intent.workflowId,
    sessionId:intent.sessionId,signal:scope.signal});
  const node=getOwnedWorkflowTemplate(intent.workflowId)?.nodes.find(item=>item.id===intent.proposal?.nodeId);
  if(scope.signal?.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline)
    ||graph.cancelRequested||!['running','waiting_approval'].includes(graph.state)||!node||['input','assemble'].includes(node.kind)
    ||scope.runId!=='host-tool-'+scope.taskId||original.deadline!==scope.deadline||original.toolVersion!=='1.0.0'
    ||scope.toolName!==undefined&&scope.toolName!==original.toolName||scope.toolVersion!==undefined&&scope.toolVersion!==original.toolVersion
    ||scope.argumentsDigest!==undefined&&scope.argumentsDigest!==original.argumentsDigest
    ||!binding||binding.deadline!==scope.deadline||!binding.configurationVersion
    ||intent.taskId!==parent.taskId||intent.deadline!==scope.deadline||intent.proposal.operationId!==parent.operationId
    ||intent.proposal.toolName!==original.toolName||intent.proposal.toolVersion!==original.toolVersion
    ||!isDeepStrictEqual(intent.proposal.arguments,original.arguments)||host.commandId!==parent.operationId
    ||host.toolName!==original.toolName||host.toolVersion!==original.toolVersion||edge?.localTaskId!==scope.taskId
    ||edge.request?.commandId!==parent.operationId||edge.request.deadline!==scope.deadline||edge.request.toolName!==original.toolName
    ||edge.request.toolVersion!==original.toolVersion||!isDeepStrictEqual(edge.request.arguments,original.arguments)
    ||scope.proposal&&(!isDeepStrictEqual(scope.proposal.arguments,original.arguments)
      ||scope.proposal.toolName!==original.toolName||scope.proposal.toolVersion!==original.toolVersion))fail();
  let context;try{context=JSON.parse(original.arguments.context);}catch{fail();}
  if(!context||context.workflowId!==intent.workflowId||context.nodeId!==intent.proposal.nodeId||!isDeepStrictEqual(context.input,binding.input)
    ||!Array.isArray(context.candidateValues)||!Array.isArray(original.arguments.candidates)
    ||!isDeepStrictEqual(context.candidateValues.map(value=>value.id),original.arguments.candidates.map(value=>value.id)))fail();
  return Object.freeze({workflowId:intent.workflowId,parentTaskId:parent.taskId,sessionId:intent.sessionId,
    taskId:scope.taskId,runId:scope.runId,operationId:parent.operationId,argumentsDigest:original.argumentsDigest,
    configurationDigest:binding.configurationDigest});
}

export function prepareConfiguredWorkflowDecisionQuestion({application,scope,question}) {
  const proof=readConfiguredWorkflowDecisionScope(application,scope);if(!proof)return;
  question.prepare(scope,{assertCurrent:()=>{
    try{return isDeepStrictEqual(proof,readConfiguredWorkflowDecisionScope(application,scope));}catch{return false;}
  }});
  return proof;
}
