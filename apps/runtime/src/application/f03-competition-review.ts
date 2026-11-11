import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {prepareReviewedRepair} from '@personal-agent/cognition';
import type {ReviewedRepairSelection,StoredRepairRequest} from '@personal-agent/cognition';
import type {NodeRef} from '@personal-agent/goals';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';

export interface F03CompetitionReviewScope {taskId:string;sessionId:string;operationId:string;deadline:string;signal:AbortSignal}
export interface F03CompetitionReviewSource {
  version:1;sourceTaskId:string;sourceOperationId:string;sessionId:string;deadline:string;
  graphNamespace:string;sourceDigest:string;graphRevision:number;evaluatedAt:string;
  review:ReviewedRepairSelection;request:StoredRepairRequest;
  decision:{taskId:string;runId:string;toolName:string;toolVersion:string;arguments:Record<string,unknown>;selectedId:string};
}
export interface F03CompetitionReviewInput {
  sourceDigest:string;graphNamespace:string;graphRevision:number;evaluatedAt:string;
  affected:readonly NodeRef[];allowedDependencies:readonly NodeRef[];
  candidate?:StoredRepairRequest;
}
const fail=():never=>{throw new ProtocolError('UNAUTHORIZED','Original Competition F03 review is unavailable');};
const same=(a:NodeRef,b:NodeRef)=>a.id===b.id&&a.revision===b.revision;

/** Reads a real configured-image N02 selection. It cannot manufacture a legacy Laya review checkpoint. */
export function readF03CompetitionReview(application:RuntimeApplication,scope:F03CompetitionReviewScope,
  source:F03CompetitionReviewInput):F03CompetitionReviewSource|undefined {
  if(application.profile!=='huawei_ict_agentarts'||scope.signal.aborted||Date.parse(scope.deadline)<=Date.now())fail();
  const graph=application.readConfiguredWorkflowBinding({taskId:scope.taskId,workflowId:'F03',sessionId:scope.sessionId,signal:scope.signal});
  if(!graph||graph.deadline!==scope.deadline||graph.configurationVersion!=='competition-mail-review-v1')return fail();
  const input=graph.input as {review?:F03CompetitionReviewInput};
  if(!isDeepStrictEqual(input.review,source))fail();
  const operation=graph.confirmedOperations.find(item=>item.nodeId==='F03_N02'&&item.toolName==='decision.choose_candidate'
    &&item.operationId===scope.operationId);
  if(!operation)return;
  const runtime=application.runtime,intent=runtime.loadCheckpoint(operation.localTaskId,'host-tool-intent') as {arguments:Record<string,unknown>};
  const runId='host-tool-'+operation.localTaskId,grant=runtime.policy.get(runId),result=operation.result as {selectedId?:unknown};
  if(!grant||grant.taskId!==operation.localTaskId||grant.toolName!==operation.toolName||Date.parse(grant.expiresAt)<=Date.now()
    ||grant.argumentsDigest!==toolArgumentsDigest(intent.arguments)||typeof result.selectedId!=='string')return fail();
  const selectedId=result.selectedId;
  let context:{workflowId?:unknown;nodeId?:unknown;candidateValues?:{id:string;value:unknown}[]};
  try{context=JSON.parse(String(intent.arguments.context));}catch{return fail();}
  if(context.workflowId!=='F03'||context.nodeId!=='F03_N02'||!Array.isArray(context.candidateValues))return fail();
  const value=context.candidateValues.find(item=>item.id===selectedId)?.value as {action?:string;repair?:StoredRepairRequest}|undefined;
  if(value?.action==='defer')return;
  if(value?.action!=='revise'||!value.repair||!isDeepStrictEqual(value.repair,source.candidate)||value.repair.expectedGraphRevision!==source.graphRevision
    ||!Array.isArray(value.repair.changes)||!value.repair.changes.length||value.repair.changes.length>16
    ||value.repair.changes.some(change=>!source.affected.some(ref=>same(ref,change.node))
      ||change.dependencies.some(dependency=>!source.allowedDependencies.some(ref=>same(ref,dependency)))))return fail();
  const option={id:selectedId,revision:1,description:'Original AgentArts F03 scoped repair candidate',action:'REVISE',repair:value.repair};
  const review:ReviewedRepairSelection={taskId:operation.localTaskId,graphNamespace:source.graphNamespace,
    graphRevision:source.graphRevision,bindingVersion:graph.configurationDigest,affected:source.affected.map(node=>({node})),
    options:[option],selectedOption:option,selection:{state:'selected',eligibleForRuntime:true,selected:{id:option.id,revision:1}}};
  const prepared=prepareReviewedRepair(runtime.bindCoordinationStore(source.graphNamespace).read(),source.evaluatedAt,review,value.repair);
  if(prepared.kind!=='prepared')return;
  return structuredClone({version:1,sourceTaskId:scope.taskId,sourceOperationId:scope.operationId,sessionId:scope.sessionId,deadline:scope.deadline,
    graphNamespace:source.graphNamespace,sourceDigest:source.sourceDigest,graphRevision:source.graphRevision,evaluatedAt:source.evaluatedAt,
    review,request:prepared.request,decision:{taskId:operation.localTaskId,runId,toolName:operation.toolName,
      toolVersion:operation.toolVersion,arguments:intent.arguments,selectedId}});
}

/** The original decision remains independently readable even after its graph proceeds or stops. */
export function assertF03CompetitionReviewEvidence(application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>,source:F03CompetitionReviewSource):void {
  const {runtime}=application,decision=source.decision,read=application.readHostToolTask(decision.taskId);
  const record=runtime.readToolExecutions(decision.taskId).find(item=>item.evidenceId===decision.runId);
  const parent=runtime.loadCheckpoint(decision.taskId,'coding-repair:parent');
  if(source.version!==1||!isDeepStrictEqual(parent,{taskId:source.sourceTaskId,operationId:source.sourceOperationId})
    ||read.commandId!==source.sourceOperationId||read.toolName!==decision.toolName||read.toolVersion!==decision.toolVersion
    ||read.task.state!=='succeeded'||read.task.cancelRequested||read.confirmed?.runId!==decision.runId
    ||(read.confirmed.result as {selectedId?:unknown})?.selectedId!==decision.selectedId
    ||!record||record.state!=='confirmed'||record.policyDecision!=='allow'||!record.executionStarted
    ||!runtime.matchesToolExecutionInput(record,{arguments:decision.arguments,scopeRef:decision.runId}))fail();
}
