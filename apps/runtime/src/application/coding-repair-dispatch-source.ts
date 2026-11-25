import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {parseCodingRepairInput,parseCodingRepairCheckReadback,parseCodingRepairPublishReadback,parseCodingRepairPublishRequest} from '@personal-agent/contracts/coding-repair';
import type {SubtaskDefinition} from '@personal-agent/agents';
import {DEFAULT_ROLE_LABELS,computeSubtaskInputDigest} from '@personal-agent/agents';
import type {RuntimeApplication} from './runtime-application.js';
import {CODING_REPAIR_REQUEST,CODING_REPAIR_STATE,CODING_REPAIR_WORKFLOW_TOOL,codingRepairWorkflowInputSchema} from './coding-repair-application.js';

type Application=Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
type Reference={taskId:string;runId:string;toolVersion:string;scopeRef:string;arguments:Record<string,unknown>};
function fail():never {throw new ProtocolError('UNAUTHORIZED','Original F15 dispatch child binding is unavailable or changed');}
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

/** Reads the original dispatcher and its one persistent F15 child. This does not
 * dispatch, approve, resume, retry, or turn an accepted child into a repair proof. */
export function readRuntimeCodingRepairDispatchChild(application:Application,reference:Reference) {
  validateToolValue(codingRepairWorkflowInputSchema(),reference.arguments);
  const {runtime}=application,read=application.readHostToolTask(reference.taskId);
  const intent=runtime.loadCheckpoint(reference.taskId,'host-tool-intent') as {deadline?:string;arguments?:unknown}|undefined;
  const args=reference.arguments as {subtasks:SubtaskDefinition[];codingRepair:{mode:'main'|'isolated';allowedPaths?:string[]}};
  const definition=args.subtasks[0]!,request={version:1,...args.codingRepair,subtasks:args.subtasks};
  const record=runtime.readToolExecutions(reference.taskId).find(value=>value.evidenceId===reference.runId);
  if(reference.runId!=='host-tool-'+reference.taskId||reference.scopeRef!==reference.runId||reference.toolVersion!=='1.0.0'
    ||read.toolName!==CODING_REPAIR_WORKFLOW_TOOL||read.toolVersion!==reference.toolVersion||read.task.state!=='succeeded'
    ||!read.confirmed||read.confirmed.runId!==reference.runId||!record||record.toolName!==CODING_REPAIR_WORKFLOW_TOOL
    ||record.toolVersion!==reference.toolVersion||record.policyDecision!=='allow'||!record.executionStarted||record.state!=='confirmed'
    ||!runtime.matchesToolExecutionInput(record,{arguments:reference.arguments,scopeRef:reference.scopeRef})
    ||!intent?.deadline||!isDeepStrictEqual(intent.arguments,reference.arguments)
    ||!isDeepStrictEqual(runtime.loadCheckpoint(reference.taskId,CODING_REPAIR_REQUEST+':'+definition.subtaskId),request))fail();
  const child=runtime.findTaskByIdempotencyKey('subagent-dispatch-'+reference.taskId+'-'+definition.subtaskId);
  if(!child)fail();
  const parent=runtime.loadCheckpoint(child.taskId,'subtask-parent') as Record<string,unknown>|undefined;
  const expected={parentTaskId:reference.taskId,subtaskId:definition.subtaskId,role:definition.role,
    roleLabel:definition.roleLabel?.trim()||DEFAULT_ROLE_LABELS[definition.role],goal:definition.goal,
    ...(definition.model===undefined?{}:{model:definition.model}),
    ...(definition.reasoningEffort===undefined?{}:{reasoningEffort:definition.reasoningEffort}),
    ...(definition.thinkingDepth===undefined?{}:{thinkingDepth:definition.thinkingDepth}),parentDeadline:intent.deadline};
  // SQLite omits undefined members, while role/model defaults can be resolved by
  // the original dispatcher. Verify the exact supplied definition and lineage.
  if(!parent||parent.parentTaskId!==reference.taskId||parent.subtaskId!==definition.subtaskId
    ||parent.parentDeadline!==intent.deadline||parent.role!==expected.role||parent.roleLabel!==expected.roleLabel
    ||parent.goal!==expected.goal||definition.model!==undefined&&parent.model!==definition.model
    ||definition.reasoningEffort!==undefined&&parent.reasoningEffort!==definition.reasoningEffort
    ||definition.thinkingDepth!==undefined&&parent.thinkingDepth!==definition.thinkingDepth
    ||child.conversationId!=='desktop-subtask:'+reference.taskId||child.state!=='succeeded'||child.cancelRequested)fail();
  const progress=runtime.loadCheckpoint(reference.taskId,'subtask-progress-records') as Record<string,{inputDigest?:string;parentTaskId?:string}>|undefined;
  if(progress?.[definition.subtaskId]?.parentTaskId!==reference.taskId
    ||progress[definition.subtaskId]?.inputDigest!==computeSubtaskInputDigest(definition))fail();
  const graph=runtime.loadCheckpoint(child.taskId,CODING_REPAIR_STATE) as Record<string,unknown>|undefined;
  const input=plain(graph?.input)?graph.input:undefined,repair=plain(input?.codingRepair)?input.codingRepair:undefined;
  const session=plain(repair?.session)?repair.session:undefined;
  let summary:unknown;try{summary=JSON.parse(child.resultSummary??'');}catch{fail();}
  if(!graph||graph.version!==1||typeof graph.sessionId!=='string'||!plain(graph.result)||graph.result.state!=='settled'
    ||session?.taskId!==child.taskId||session.mode!==args.codingRepair.mode||typeof session.sessionId!=='string'
    ||!plain(summary)||summary.workflowId!=='F15'||summary.state!=='settled'||summary.mode!==args.codingRepair.mode
    ||summary.sessionId!==session.sessionId||!isDeepStrictEqual(summary.codingRepair,graph.result.codingRepair))fail();
  return Object.freeze({taskId:child.taskId,dispatchTaskId:reference.taskId,dispatchRunId:reference.runId,
    subtaskId:definition.subtaskId,sessionId:graph.sessionId,mode:args.codingRepair.mode,state:child.state});
}

/** Exact original F15 CAS publication, for a separate publication consumer.
 * No caller-supplied hashes, model claims or arbitrary ancestor traversal. */
export function readRuntimeCodingRepairPublishedSource(application:Application,reference:Reference) {
  const child=readRuntimeCodingRepairDispatchChild(application,reference),{runtime}=application;
  if(child.mode!=='main')fail();
  const graph=runtime.loadCheckpoint(child.taskId,CODING_REPAIR_STATE) as {input?:{codingRepair?:unknown};
    confirmedHost?:Record<string,{localTaskId:string;operationId:string;result:unknown}>};
  const input=parseCodingRepairInput(graph.input?.codingRepair);
  const original=(name:string)=>{
    const source=graph.confirmedHost?.[name];if(!source)fail();
    const read=application.readHostToolTask(source.localTaskId),runId='host-tool-'+source.localTaskId;
    const intent=runtime.loadCheckpoint(source.localTaskId,'host-tool-intent') as {arguments?:unknown}|undefined;
    const parent=runtime.loadCheckpoint(source.localTaskId,'coding-repair:parent');
    const edge=runtime.loadCheckpoint(child.taskId,'coding-repair:host:'+source.operationId) as {localTaskId?:string;request?:{arguments?:unknown}}|undefined;
    const record=runtime.readToolExecutions(source.localTaskId).find(value=>value.evidenceId===runId);
    if(read.task.state!=='succeeded'||read.toolName!==name||read.toolVersion!=='1.0.0'||read.commandId!==source.operationId
      ||!read.confirmed||read.confirmed.runId!==runId||!read.confirmed.evidenceRefs.length
      ||!isDeepStrictEqual(read.confirmed.result,source.result)||!isDeepStrictEqual(parent,{taskId:child.taskId,operationId:source.operationId})
      ||edge?.localTaskId!==source.localTaskId||!isDeepStrictEqual(edge.request?.arguments,intent?.arguments)
      ||!record||record.toolName!==name||record.toolVersion!=='1.0.0'||record.policyDecision!=='allow'||!record.executionStarted
      ||record.state!=='confirmed'||!intent||!plain(intent.arguments)||!runtime.matchesToolExecutionInput(record,{arguments:intent.arguments,scopeRef:runId}))fail();
    return {taskId:source.localTaskId,runId,arguments:intent.arguments,result:read.confirmed.result};
  };
  const check=original('workflow.host.f15_n05'),publish=original('workflow.host.f15_n06');
  const checked=parseCodingRepairCheckReadback(check.result),published=parseCodingRepairPublishReadback(publish.result);
  const request=parseCodingRepairPublishRequest(publish.arguments);
  if(input.session.taskId!==child.taskId||checked.sessionId!==input.session.sessionId||published.sessionId!==input.session.sessionId
    ||published.state!=='published'||!published.files.length||!published.evidenceRefs.includes(check.runId)||request.sessionId!==input.session.sessionId
    ||request.baselineSnapshotId!==input.session.baselineSnapshotId||request.snapshotId!==checked.snapshot.snapshotId
    ||!isDeepStrictEqual([...request.paths].sort(),published.files.map(file=>file.path).sort())
    ||published.files.some(file=>file.afterSha256===null||!input.initialSnapshot.files.some(before=>before.path===file.path&&before.sha256===file.beforeSha256)
      ||!checked.snapshot.files.some(after=>after.path===file.path&&after.sha256===file.afterSha256))
    ||!request.verificationRunIds.length||request.verificationRunIds.some(runId=>!checked.verification.some(value=>value.runId===runId&&value.status==='VALID'
      &&value.exitCode===0&&value.inputSnapshotId===checked.snapshot.snapshotId
      &&value.runId===check.runId+'-verify-'+value.recipeId)))fail();
  const value={taskId:child.taskId,graphSessionId:child.sessionId,workspaceSessionId:input.session.sessionId,
    workspaceId:input.session.workspaceId,check:{taskId:check.taskId,runId:check.runId},
    publication:{taskId:publish.taskId,runId:publish.runId},files:structuredClone(published.files)};
  for(const file of value.files)Object.freeze(file);Object.freeze(value.files);Object.freeze(value.check);Object.freeze(value.publication);
  return Object.freeze(value);
}
