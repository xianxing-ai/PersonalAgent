import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {TaskSnapshot} from '@personal-agent/contracts';
import type {AgentToolPort,SubtaskDefinition} from '@personal-agent/agents';
import type {CoordinationToolProposalResult} from '@personal-agent/coordination';
import type {WorkerContext} from '../index.js';
import type {CoordinationWorkerCapabilityPort} from './coordination.js';
import type {RuntimeApplication} from './runtime-application.js';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {CODING_REPAIR_PARENT,CODING_REPAIR_STATE,CODING_REPAIR_WORKFLOW_TOOL,
  codingRepairWorkflowInputSchema,runRuntimeCodingRepairWorkflow} from './coding-repair-application.js';
import type {RuntimeCodingRepairOptions,RuntimeCodingRepairRequest} from './coding-repair-application.js';

const KEY='coding-repair:worker-capability';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Binding {version:1;taskId:string;deadline:string;revision:number;bindingId:string;
  proposalDigest:string;request:RuntimeCodingRepairRequest;}
interface Graph {initialRunId?:string;input?:unknown;pendingSend?:unknown;
  waiting?:{localTaskId:string;operationId:string};}
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}

/** The existing user-work consumes the existing F15 runner. No recursive Agent dispatch. */
export function createRuntimeCodingRepairWorkerCapability(application:RuntimeApplication,
  options:RuntimeCodingRepairOptions,getTools:(taskId:string)=>AgentToolPort|undefined) {
  const accepts=(proposal:CoordinationToolProposalResult)=>proposal.toolName===CODING_REPAIR_WORKFLOW_TOOL&&proposal.toolVersion==='1.0.0';
  const read=(taskId:string)=>application.runtime.loadCheckpoint(taskId,KEY) as Binding|undefined;
  const active=(context:Pick<WorkerContext,'taskId'|'deadline'|'signal'>)=>{
    const task=application.runtime.getTask(context.taskId);
    if(context.signal.aborted||task.cancelRequested)fail('CANCELLED','Original coding worker was cancelled');
    if(!Number.isFinite(Date.parse(context.deadline))||Date.now()>=Date.parse(context.deadline))fail('TIMEOUT','Original coding worker deadline expired');
    if(application.runtime.loadCheckpoint(context.taskId,'application-deadline')!==context.deadline)
      fail('REVISION_CONFLICT','Original coding worker deadline changed');
  };
  function isActive(taskId:string):boolean {
    const bound=read(taskId),loop=application.runtime.loadCheckpoint(taskId,'competition-loop') as {pending?:CoordinationToolProposalResult;pendingRevision?:number}|undefined;
    return !!bound&&bound.version===1&&bound.taskId===taskId&&bound.bindingId===options.image.bindingId
      &&bound.deadline===application.runtime.loadCheckpoint(taskId,'application-deadline')
      &&!!loop?.pending&&accepts(loop.pending)&&bound.proposalDigest===hash(loop.pending)&&bound.revision===loop.pendingRevision;
  }
  function describe(context:Pick<WorkerContext,'taskId'|'deadline'|'signal'>) {
    active(context);
    const fixed=application.runtime.loadCheckpoint(context.taskId,'subtask-coordination-binding')!==undefined;
    if(fixed) {
      const task=application.runtime.getTask(context.taskId);
      const parent=application.runtime.loadCheckpoint(context.taskId,'subtask-parent') as {parentTaskId?:string}|undefined;
      if(!parent?.parentTaskId||task.conversationId!==`desktop-subtask:${parent.parentTaskId}`
        ||application.runtime.loadCheckpoint(context.taskId,'subtask-thinking-binding')===undefined||!getTools(context.taskId))
        fail('UNAUTHORIZED','Original coding worker execution binding is unavailable');
    }
    return {name:CODING_REPAIR_WORKFLOW_TOOL,version:'1.0.0',
      inputSchema:codingRepairWorkflowInputSchema(fixed?{sameWorker:true}:{})};
  }
  function pendingHostTask(taskId:string):TaskSnapshot|undefined {
    if(!isActive(taskId))return;
    const waiting=(application.runtime.loadCheckpoint(taskId,CODING_REPAIR_STATE) as Graph|undefined)?.waiting;
    if(!waiting)return;
    const linked=application.runtime.loadCheckpoint(waiting.localTaskId,CODING_REPAIR_PARENT) as {taskId?:string;operationId?:string}|undefined;
    const original=application.runtime.loadCheckpoint(taskId,'coding-repair:host:'+waiting.operationId) as {localTaskId?:string}|undefined;
    if(linked?.taskId!==taskId||linked.operationId!==waiting.operationId||original?.localTaskId!==waiting.localTaskId)
      fail('UNAUTHORIZED','Original coding host task binding changed');
    const readback=application.readHostToolTask(waiting.localTaskId);
    if(readback.commandId!==waiting.operationId)fail('UNAUTHORIZED','Original coding host command changed');
    return readback.task;
  }
  function resolveApproval(taskId:string,proposal:unknown) {
    if(!isActive(taskId)||hash(proposal)!==read(taskId)!.proposalDigest)return;
    const graph=application.runtime.loadCheckpoint(taskId,CODING_REPAIR_STATE) as Graph|undefined;
    if(!graph||graph.input||!graph.initialRunId)return;
    const original=application.runtime.loadCheckpoint(taskId,'application-tool-invocation:'+graph.initialRunId) as
      {toolName:string;toolVersion:string;arguments:Record<string,unknown>;argumentsDigest:string;deadline:string}|undefined;
    const expected={mode:read(taskId)!.request.mode,...(read(taskId)!.request.allowedPaths?{allowedPaths:read(taskId)!.request.allowedPaths}:{})};
    if(!original||original.toolName!=='coding.repair.start'||original.toolVersion!=='1.0.0'
      ||original.deadline!==read(taskId)!.deadline||original.argumentsDigest!==toolArgumentsDigest(original.arguments)
      ||!isDeepStrictEqual(original.arguments,expected))fail('UNAUTHORIZED','Original coding isolation approval changed');
    return {runId:graph.initialRunId,toolName:original.toolName,arguments:structuredClone(original.arguments)};
  }
  function assertResumeAllowed(taskId:string,observeUnknown=false):void {
    if(!isActive(taskId))fail('UNAUTHORIZED','Original coding worker proposal changed');
    const bound=read(taskId)!,task=application.runtime.getTask(taskId),graph=application.runtime.loadCheckpoint(taskId,CODING_REPAIR_STATE) as Graph|undefined;
    if(task.cancelRequested||Date.now()>=Date.parse(bound.deadline)||!graph||graph.pendingSend)
      fail('RESULT_UNKNOWN','Original coding graph requires reconciliation');
    const host=pendingHostTask(taskId);
    if(host){if(!['succeeded','failed','cancelled'].includes(host.state)&&!(observeUnknown&&host.state==='waiting_reconciliation'))
      fail('RESULT_UNKNOWN','Original coding host operation is not settled');return;}
    const loop=application.runtime.loadCheckpoint(taskId,'competition-loop') as {pending?:unknown}|undefined;
    const original=resolveApproval(taskId,loop?.pending);
    if(!original)fail('RESULT_UNKNOWN','Coding worker has no original resumable operation');
    const approval=application.runtime.getApproval(original.runId);
    const confirmed=application.runtime.readToolExecutions(taskId).some(record=>record.evidenceId===original.runId
      &&record.toolName===original.toolName&&record.state==='confirmed'&&record.executionStarted&&record.policyDecision==='allow'
      &&application.runtime.matchesToolExecutionInput(record,{arguments:original.arguments,scopeRef:original.runId}));
    if(approval.taskId!==taskId||approval.state!=='allowed'||approval.toolName!==original.toolName
      ||approval.argumentsDigest!==toolArgumentsDigest(original.arguments)||!confirmed&&!application.runtime.policy.get(original.runId))
      fail('UNAUTHORIZED','Original coding isolation operation is not approved');
  }
  const capability:CoordinationWorkerCapabilityPort={accepts,dispatch:async(proposal,context)=>{
    active(context);if(!accepts(proposal))fail('UNSUPPORTED_CAPABILITY','Unknown coding worker capability');
    validateToolValue(codingRepairWorkflowInputSchema(),proposal.arguments);
    if(!options.authorizeMetadata||!options.projectSource)fail('UNSUPPORTED_CAPABILITY','Original coding export ports are unavailable');
    const input=proposal.arguments as unknown as {subtasks:SubtaskDefinition[];codingRepair:{mode:'main'|'isolated';allowedPaths?:string[]}};
    const selected=context.loadCheckpoint('execution-model') as {modelId?:string;reasoningEffort?:string}|undefined;
    const subtask=input.subtasks[0]!;
    if(subtask.model!==undefined&&subtask.model!==selected?.modelId||subtask.reasoningEffort!==undefined&&subtask.reasoningEffort!==selected?.reasoningEffort)
      fail('REVISION_CONFLICT','Coding work cannot replace the current worker model');
    const thinking=context.loadCheckpoint('subtask-thinking-binding') as {depth?:number}|undefined;
    if(subtask.thinkingDepth!==undefined&&subtask.thinkingDepth!==thinking?.depth)
      fail('REVISION_CONFLICT','Coding work cannot replace the current worker thinking binding');
    const request:RuntimeCodingRepairRequest={version:1,...structuredClone(input.codingRepair),subtasks:structuredClone(input.subtasks)};
    const bound:Binding={version:1,taskId:context.taskId,deadline:context.deadline,revision:context.revision,
      bindingId:options.image.bindingId,proposalDigest:hash(proposal),request};
    const prior=read(context.taskId);
    if(prior!==undefined&&!isDeepStrictEqual(prior,bound))fail('REVISION_CONFLICT','This worker is already bound to its original coding request');
    application.runtime.saveCheckpointOnce(context.taskId,KEY,bound);
    const tools=getTools(context.taskId);if(!tools)fail('UNSUPPORTED_CAPABILITY','Original coding tool scope is unavailable');
    const outcome=await runRuntimeCodingRepairWorkflow(application,subtask,context,tools,options,request);
    const task=application.runtime.getTask(context.taskId);
    if(task.state==='waiting_approval'||task.state==='waiting_reconciliation')return {state:task.state==='waiting_approval'?'pending':'unknown',
      result:null,evidenceRefs:outcome.evidenceRefs??[],selection:bound};
    active(context);
    let completed:{workflowId?:string;state?:string;mode?:string};
    try{completed=JSON.parse(outcome.resultSummary??'');}catch{return fail('EXTERNAL_FAILURE','Coding graph returned no verified completion');}
    if(completed.workflowId!=='F15'||completed.state!=='settled'||completed.mode!==request.mode)
      fail('EXTERNAL_FAILURE','Coding graph did not settle its original request');
    const result={workflowId:'F15',state:'settled',mode:request.mode,confirmedOperations:outcome.evidenceRefs?.length??0};
    await options.authorizeMetadata({taskId:context.taskId,value:result,deadline:context.deadline,signal:context.signal});active(context);
    const selection={...bound,resultDigest:hash(result)};
    context.saveCheckpoint(KEY+':receipt',{selection,result});
    return {state:'confirmed',result,evidenceRefs:outcome.evidenceRefs??[],selection};
  },assertReceiptAllowed:(proposal,selection,result,context)=>{
    active(context);
    const saved=context.loadCheckpoint(KEY+':receipt') as {selection:Binding&{resultDigest:string};result:unknown}|undefined;
    if(!saved||saved.selection.bindingId!==options.image.bindingId||saved.selection.proposalDigest!==hash(proposal)
      ||saved.selection.taskId!==context.taskId||saved.selection.deadline!==context.deadline||saved.selection.revision!==context.revision
      ||saved.selection.resultDigest!==hash(result)||!isDeepStrictEqual(saved.selection,selection)||!isDeepStrictEqual(saved.result,result))
      fail('UNAUTHORIZED','Original coding worker receipt changed');
  }};
  return {...capability,describe,isActive,resolveApproval,assertResumeAllowed,pendingHostTask};
}
