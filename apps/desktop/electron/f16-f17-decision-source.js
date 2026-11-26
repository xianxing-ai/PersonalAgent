import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {F16_F17_CONFIGURATIONS} from './f16-f17-workflow-ports.js';

/** Read-only routing proof for main's original question/export preparation. F15's
 * workspace-specific decision gate cannot accept these graphs. This grants nothing. */
export function readF16F17DecisionScope(application,scope) {
  const original=application.readAuthorizationQuestionInvocation(scope.taskId,scope.runId);
  if(original?.toolName!=='decision.choose_candidate')return undefined;
  const runtime=application.runtime,parent=runtime.loadCheckpoint(scope.taskId,'coding-repair:parent');
  const intent=parent&&runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
  if(!intent||!['F16','F17'].includes(intent.workflowId))return undefined;
  const fail=()=>{throw new ProtocolError('UNAUTHORIZED','F16/F17 原判断节点或候选绑定已变化');};
  const graph=runtime.getTask(parent.taskId),host=application.readHostToolTask(scope.taskId);
  const edge=runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId);
  const binding=application.readConfiguredWorkflowBinding({taskId:parent.taskId,workflowId:intent.workflowId,
    sessionId:intent.sessionId,signal:scope.signal});
  if(scope.signal?.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline)
    ||graph.cancelRequested||!['running','waiting_approval'].includes(graph.state)
    ||scope.runId!=='host-tool-'+scope.taskId||original.deadline!==scope.deadline||original.toolVersion!=='1.0.0'
    ||scope.toolName!==undefined&&scope.toolName!==original.toolName||scope.toolVersion!==undefined&&scope.toolVersion!==original.toolVersion
    ||scope.argumentsDigest!==undefined&&scope.argumentsDigest!==original.argumentsDigest
    ||!binding||binding.deadline!==scope.deadline||binding.configurationVersion!==F16_F17_CONFIGURATIONS[intent.workflowId].configurationVersion
    ||intent.taskId!==parent.taskId||intent.deadline!==scope.deadline||intent.proposal?.nodeId!==intent.workflowId+'_N02'
    ||intent.proposal.operationId!==parent.operationId||intent.proposal.toolName!==original.toolName||intent.proposal.toolVersion!==original.toolVersion
    ||!isDeepStrictEqual(intent.proposal.arguments,original.arguments)||host.commandId!==parent.operationId
    ||host.toolName!==original.toolName||host.toolVersion!==original.toolVersion||edge?.localTaskId!==scope.taskId
    ||edge.request?.commandId!==parent.operationId||edge.request.deadline!==scope.deadline||edge.request.toolName!==original.toolName
    ||edge.request.toolVersion!==original.toolVersion||!isDeepStrictEqual(edge.request.arguments,original.arguments)
    ||scope.proposal&&(!isDeepStrictEqual(scope.proposal.arguments,original.arguments)
      ||scope.proposal.toolName!==original.toolName||scope.proposal.toolVersion!==original.toolVersion))fail();
  let context;try{context=JSON.parse(original.arguments.context);}catch{fail();}
  if(context.workflowId!==intent.workflowId||context.nodeId!==intent.proposal.nodeId||!isDeepStrictEqual(context.input,binding.input)
    ||!Array.isArray(context.candidateValues)||!Array.isArray(original.arguments.candidates)
    ||!isDeepStrictEqual(context.candidateValues.map(value=>value.id),original.arguments.candidates.map(value=>value.id)))fail();
  return Object.freeze({workflowId:intent.workflowId,parentTaskId:parent.taskId,sessionId:intent.sessionId,
    taskId:scope.taskId,runId:scope.runId,operationId:parent.operationId,argumentsDigest:original.argumentsDigest});
}

/** Add only a source fence to the existing generic tool question. Its original
 * `tool` requirement, user response, Policy consumption and export remain owned there. */
export function prepareF16F17DecisionQuestion({application,scope,question}) {
  const proof=readF16F17DecisionScope(application,scope);if(!proof)return undefined;
  question.prepare(scope,{assertCurrent:()=>{
    try{return isDeepStrictEqual(proof,readF16F17DecisionScope(application,scope));}catch{return false;}
  }});
  return proof;
}
