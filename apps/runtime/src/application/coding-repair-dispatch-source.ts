import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
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
