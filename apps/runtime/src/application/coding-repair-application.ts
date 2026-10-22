import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {parseCodingRepairInput,parseCodingRepairCheckReadback,parseCodingRepairPublishReadback} from '@personal-agent/contracts/coding-repair';
import type {CodingRepairInput} from '@personal-agent/contracts/coding-repair';
import type {SubtaskDefinition,AgentToolPort} from '@personal-agent/agents';
import {computeSubtaskInputDigest,DEFAULT_ROLE_LABELS} from '@personal-agent/agents';
import type {OwnedWorkflowAdvanceRequest,OwnedWorkflowAdvanceResult,WorkflowReceipt} from '@personal-agent/agentarts';
type WorkflowProposal=OwnedWorkflowAdvanceResult['proposals'][number];
import type {CoordinationAvailableTool} from '@personal-agent/coordination';
import {parseCoordinationAvailableTools,parseExecutionModelSelection} from '@personal-agent/coordination';
import type {WorkerContext,WorkerResult} from '../index.js';
import type {RuntimeApplication} from './runtime-application.js';
import {createRuntimeOwnedWorkflowHost} from './owned-workflow-application.js';
import {runRuntimeOwnedWorkflowDriver} from './owned-workflow-driver.js';
import type {RuntimeOwnedWorkflowDriverState} from './owned-workflow-driver.js';

export const CODING_REPAIR_WORKFLOW_TOOL='coding.repair.workflow';
export const CODING_REPAIR_REQUEST='coding-repair:request';
export const CODING_REPAIR_STATE='coding-repair:graph';
export const CODING_REPAIR_PARENT='coding-repair:parent';
export interface RuntimeCodingRepairImagePort {
  advance(request:OwnedWorkflowAdvanceRequest):Promise<OwnedWorkflowAdvanceResult>;
  receiptSecret(signal:AbortSignal):Promise<string>;
  bindingId:string;
}
export interface RuntimeCodingRepairOptions {
  image:RuntimeCodingRepairImagePort;
  /** Production question composition cannot silently export raw metadata when its projector is absent. */
  requireProjectedMetadata?:boolean;
  /** Current trusted workspace egress lease; paths, hashes and diagnostics are also user data. */
  authorizeMetadata?:(input:{taskId:string;stage:'initial'|'receipt'|'completion';value:unknown;authorization:{taskId:string;runId:string};deadline:string;signal:AbortSignal})=>unknown|Promise<unknown>;
  /** Exact, native-confirmed source export. Missing port is unavailable, never consent. */
  projectSource?:(input:{taskId:string;localTaskId:string;proposal:Extract<WorkflowProposal,{kind:'tool_proposal'}>;
    receipt:WorkflowReceipt;authorization:{taskId:string;runId:string};deadline:string;signal:AbortSignal})=>Promise<unknown>;
}
export interface RuntimeCodingRepairRequest {version:1;mode:'main'|'isolated';allowedPaths?:string[];subtasks:SubtaskDefinition[]}
type Request=RuntimeCodingRepairRequest;
interface GraphState extends RuntimeOwnedWorkflowDriverState<{goal:string;codingRepair:CodingRepairInput;executionModel?:ReturnType<typeof parseExecutionModelSelection>}> {initialRunId?:string;}
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const startFailureReasons:Readonly<Record<string,string>>={
  'Invalid authorization question binding':'invalid_question_binding',
  'Invalid authorization requirement':'invalid_requirement',
  '当前对话授权卡不可用，操作未获允许':'question_unavailable',
  '原任务或权限策略已变化，操作未获允许':'question_current_changed',
  'Original question binding is unavailable':'original_question_binding_unavailable',
  '原操作的精确授权已失效，未执行或发送新的资料':'original_scope_changed',
  '工作区配置或授权提问通路不可用':'workspace_preparation_unavailable',
  '原工作区操作、配置或授权范围已变化':'workspace_current_changed',
  '不允许自动扩大为完全访问':'sandbox_escalation_denied',
  '授权决定期限已过':'decision_deadline_expired',
};
export function isRuntimeDispatchTool(name:string):boolean {return name==='subagent.dispatch'||name===CODING_REPAIR_WORKFLOW_TOOL;}
/** Original dispatcher owns child tasks, cancellation, summaries and model selection. */
export function createRuntimeCodingRepairDispatchTool(getApplication:()=>RuntimeApplication):RegisteredTool {
  const original=()=>getApplication().createSubagentDispatchTool();
  const schema=codingRepairWorkflowInputSchema();
  return {descriptor:{name:CODING_REPAIR_WORKFLOW_TOOL,version:'1.0.0',inputSchema:schema,outputSchema:{},
    sideEffect:'local_write',requiredScopes:['agent:delegate','workspace:read','workspace:write','workspace:apply','workspace:execute'],
    idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute:async(value,context)=>{
      validateToolValue(schema,value);const v=value as {subtasks:SubtaskDefinition[];codingRepair:{mode:'main'|'isolated';allowedPaths?:string[]}};
      const application=getApplication(),request:Request={version:1,...structuredClone(v.codingRepair),subtasks:structuredClone(v.subtasks)};
      const key=CODING_REPAIR_REQUEST+':'+v.subtasks[0]!.subtaskId,previous=application.runtime.loadCheckpoint(context.taskId,key);
      if(previous!==undefined&&!isDeepStrictEqual(previous,request))throw new ProtocolError('REVISION_CONFLICT','Original coding workflow request changed');
      application.runtime.saveCheckpointOnce(context.taskId,key,request);
      return original().execute({subtasks:v.subtasks},context);
    }};
}
/** Root dispatch may select a new worker; an existing worker retains its bound execution configuration. */
export function codingRepairWorkflowInputSchema(options:{sameWorker?:true}={}):Record<string,unknown> {
  return {type:'object',properties:{subtasks:{type:'array',minItems:1,maxItems:1,items:{type:'object',properties:{
    subtaskId:{type:'string',minLength:1},role:{type:'string',enum:['coder']},roleLabel:{type:'string'},goal:{type:'string',minLength:1},
    ...(options.sameWorker?{}:{model:{type:'string',minLength:1},reasoningEffort:{enum:['none','minimal','low','medium','high','xhigh','max']},
      thinkingDepth:{type:'integer',minimum:0,maximum:5}})},
    required:['subtaskId','role','goal'],additionalProperties:false}},codingRepair:{type:'object',properties:{
      mode:{enum:['main','isolated']},allowedPaths:{type:'array',items:{type:'string',minLength:1}}},required:['mode'],additionalProperties:false}},
    required:['subtasks','codingRepair'],additionalProperties:false};
}
export function readRuntimeCodingRepairRequest(application:RuntimeApplication,subtask:SubtaskDefinition,taskId:string):Request|undefined {
  const binding=application.runtime.loadCheckpoint(taskId,'subtask-parent') as {parentTaskId?:string}|undefined;
  if(!binding?.parentTaskId)return undefined;
  const value=application.runtime.loadCheckpoint(binding.parentTaskId,CODING_REPAIR_REQUEST+':'+subtask.subtaskId) as Request|undefined;
  if(value===undefined)return undefined;
  if(value.version!==1||!['main','isolated'].includes(value.mode)||value.subtasks.length!==1
    ||computeSubtaskInputDigest(value.subtasks[0]!)!==computeSubtaskInputDigest(subtask)
    ||(value.subtasks[0]!.roleLabel??DEFAULT_ROLE_LABELS[subtask.role])!==(subtask.roleLabel??DEFAULT_ROLE_LABELS[subtask.role]))
    throw new ProtocolError('REVISION_CONFLICT','Coding workflow child binding changed');
  return value;
}
/** The existing child's WorkerContext drives the image graph; no second runTask or task store. */
export async function runRuntimeCodingRepairWorkflow(application:RuntimeApplication,subtask:SubtaskDefinition,
  worker:WorkerContext,tools:AgentToolPort,options:RuntimeCodingRepairOptions,boundRequest?:RuntimeCodingRepairRequest):Promise<WorkerResult> {
  const request=boundRequest??readRuntimeCodingRepairRequest(application,subtask,worker.taskId);
  if(!request)throw new ProtocolError('NOT_FOUND','Original coding workflow request is missing');
  let state=worker.loadCheckpoint(CODING_REPAIR_STATE) as GraphState|undefined;
  if(!state) {state={version:1,sessionId:randomUUID(),controlRevision:0,bindingId:options.image.bindingId,sequence:0,
    receipts:[],resolvedValues:{},evidenceRefs:[],confirmedHost:{},timings:[]};worker.saveCheckpoint(CODING_REPAIR_STATE,state);}
  if(state.version!==1||state.bindingId!==options.image.bindingId)throw new ProtocolError('REVISION_CONFLICT','Original coding workflow deployment changed');
  const save=()=>worker.saveCheckpoint(CODING_REPAIR_STATE,state);
  const active=()=>{if(worker.signal.aborted||application.runtime.getTask(worker.taskId).cancelRequested)throw new ProtocolError('CANCELLED','Coding workflow cancelled');
    if(Date.now()>=Date.parse(worker.deadline))throw new ProtocolError('TIMEOUT','Original coding workflow deadline expired');};
  const timed=async<T>(stage:string,work:()=>Promise<T>,extra:{nodeId?:string;operationId?:string}={}):Promise<T>=>{
    const begin=Date.now();try{return await work();}finally{state!.timings.push({stage,startedAt:new Date(begin).toISOString(),elapsedMs:Date.now()-begin,...extra});save();}};
  const secret=await options.image.receiptSecret(worker.signal);active();
  const bridge=createRuntimeOwnedWorkflowHost(application,{receiptSecret:secret,parentTaskId:worker.taskId,
    assertActive:(taskId,revision)=>{active();if(taskId!==worker.taskId||revision!==state!.controlRevision)throw new ProtocolError('REVISION_CONFLICT','Coding workflow control changed');},
    ...(request.mode==='isolated'?{assertIsolation:()=>{if(state!.input?.codingRepair.session.mode!=='isolated')throw new ProtocolError('UNAUTHORIZED','Shadow session isolation is missing');}}:{})});
  if(!state.input) {
    const runId=state.initialRunId??`coding-start-${worker.taskId}`;state.initialRunId=runId;save();
    const args={mode:request.mode,...(request.allowedPaths?{allowedPaths:request.allowedPaths}:{})};
    const result=await timed('isolation-start',async()=>{
      try {return await tools.invoke({taskId:worker.taskId,runId,authorizationRef:runId,toolName:'coding.repair.start',toolVersion:'1.0.0',
        arguments:args,deadline:worker.deadline,signal:worker.signal});}
      catch(error) {
        // The approval invalidator may already have made the task terminal. Keep
        // the original fixed failure category locally without exporting text or
        // changing that denial into authority to execute/replay the operation.
        const code=error instanceof ProtocolError&&['UNAUTHORIZED','INVALID_ARGUMENT','REVISION_CONFLICT','CANCELLED','TIMEOUT',
          'UNSUPPORTED_CAPABILITY','NOT_FOUND','RESULT_UNKNOWN','EXTERNAL_FAILURE'].includes(error.code)?error.code:'EXTERNAL_FAILURE';
        try {worker.saveCheckpoint('coding-repair:start-failure:v1:'+runId,{version:1,authority:'diagnostic_no_tool_grant',
          taskId:worker.taskId,runId,toolName:'coding.repair.start',toolVersion:'1.0.0',argumentsDigest:toolArgumentsDigest(args),
          deadline:worker.deadline,stage:'isolation-start',code,
          reason:error instanceof Error&&Object.hasOwn(startFailureReasons,error.message)?startFailureReasons[error.message]
            :code==='CANCELLED'?'cancelled':code==='TIMEOUT'?'deadline_expired':'unclassified_local_failure'});
        }catch{/* Retain the original failure even if diagnostic storage is unavailable. */}
        throw error;
      }
    });
    if(result.state!=='confirmed') {
      if(application.runtime.getTask(worker.taskId).state==='running')application.runtime.transitionTask(worker.taskId,result.state==='pending'?'waiting_approval':'waiting_reconciliation');
      return {resultSummary:'F15 隔离工作区创建等待原授权或核实',evidenceRefs:[]};
    }
    const input=parseCodingRepairInput(result.result);
    if(input.session.taskId!==worker.taskId||input.session.mode!==request.mode||input.initialSnapshot.files.some(file=>file.content!==undefined))
      throw new ProtocolError('UNAUTHORIZED','Initial coding source snapshot must retain task identity and metadata-only export');
    const selected=worker.loadCheckpoint('execution-model');
    state.sessionId=input.session.sessionId;
    state.input={goal:subtask.goal,codingRepair:input,...(selected===undefined?{}:{executionModel:parseExecutionModelSelection(selected)})};save();
  }
  if(!options.authorizeMetadata)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Coding workspace metadata export authorization unavailable');
  if(!state.input||state.input.goal!==subtask.goal||!isDeepStrictEqual(state.input.executionModel,worker.loadCheckpoint('execution-model')))
    throw new ProtocolError('REVISION_CONFLICT','Original coding goal or execution destination changed');
  if(!state.initialRunId)throw new ProtocolError('UNAUTHORIZED','Original coding start authorization mapping is unavailable');
  const projectedInput=await options.authorizeMetadata({taskId:worker.taskId,stage:'initial',value:state.input,authorization:{taskId:worker.taskId,runId:state.initialRunId},deadline:worker.deadline,signal:worker.signal});active();
  if(options.requireProjectedMetadata&&projectedInput===undefined)throw new ProtocolError('UNAUTHORIZED','Coding metadata projector returned no authorized projection');
  if(projectedInput!==undefined){
    if(!plain(projectedInput)||projectedInput.goal!==subtask.goal||!isDeepStrictEqual(projectedInput.executionModel,state.input.executionModel))
      throw new ProtocolError('UNAUTHORIZED','Coding metadata projection changed original goal or model');
    const codingRepair=parseCodingRepairInput(projectedInput.codingRepair);
    if(codingRepair.session.taskId!==worker.taskId||codingRepair.session.sessionId!==state.sessionId
      ||codingRepair.session.mode!==request.mode||codingRepair.initialSnapshot.files.some(file=>file.content!==undefined))
      throw new ProtocolError('UNAUTHORIZED','Coding metadata projection changed original session or included source');
    state.input={goal:subtask.goal,codingRepair,...(state.input.executionModel?{executionModel:state.input.executionModel}:{})};save();
  }
  const catalog=parseCoordinationAvailableTools(tools.list().filter(tool=>
    tool.name!==CODING_REPAIR_WORKFLOW_TOOL&&(tool.name.startsWith('coding.repair.')||tool.name.startsWith('workflow.host.f15_')
      ||tool.name.startsWith('workflow.guard.f15_')||tool.name==='workspace.coding_snapshot'||tool.name==='decision.choose_candidate'))
    .map(tool=>({name:tool.name,version:tool.version,inputSchema:tool.inputSchema})));

  return runRuntimeOwnedWorkflowDriver(application,worker,state,{
    workflowId:'F15',checkpointKey:CODING_REPAIR_STATE,mode:request.mode,image:options.image,bridge,catalog,
    requestId:sequence=>'coding-'+worker.taskId+'-'+sequence,
    authorizeReceipt:async({proposal,receipt,localTaskId,state})=>{
      if(proposal.toolName==='coding.repair.read') {
        if(!options.projectSource)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Exact native source export authorization is unavailable');
        const projected=await timed('source-export-consent',()=>options.projectSource!({taskId:worker.taskId,localTaskId,proposal,receipt,
          authorization:{taskId:localTaskId,runId:'host-tool-'+localTaskId},deadline:worker.deadline,signal:worker.signal}),{nodeId:proposal.nodeId});
        if(!isDeepStrictEqual(projected,receipt.result))throw new ProtocolError('UNAUTHORIZED','Source export must preserve original confirmed bytes and SHA');
        state.resolvedValues['coding-source:'+String(proposal.arguments.path)]=structuredClone(projected);
      }else {
        const projected=await options.authorizeMetadata!({taskId:worker.taskId,stage:'receipt',value:receipt.result,authorization:{taskId:localTaskId,runId:'host-tool-'+localTaskId},deadline:worker.deadline,signal:worker.signal});
        if(options.requireProjectedMetadata&&projected===undefined)throw new ProtocolError('UNAUTHORIZED','Coding receipt projector returned no authorized projection');
        const lease=application.runtime.loadCheckpoint(localTaskId,'authorization-question-export:host-tool-'+localTaskId+':workspace-metadata-export') as
          {resultDigest:string;policyVersion:string;schemaDigest:string;leaseRef:string;stage:string}|undefined;
        if(projected!==undefined&&(!lease||lease.resultDigest!==createHash('sha256').update(JSON.stringify(projected)).digest('hex')))
          throw new ProtocolError('UNAUTHORIZED','Coding projection has no matching exact export lease');
        const exported=projected===undefined?receipt:bridge.projectReceiptResult({taskId:worker.taskId,sessionId:state.sessionId,
          workflowId:'F15',controlRevision:state.controlRevision},proposal,receipt,projected,lease!);
        if(proposal.nodeId==='F15_N01'&&receipt.state==='confirmed')state.resolvedValues.F15_N01=structuredClone(exported.result);
        return exported;
      }
    },
    validateSettled:state=>{
      const originalCheck=state.confirmedHost['workflow.host.f15_n05'];
      const checkback=originalCheck?application.readHostToolTask(originalCheck.localTaskId):undefined;
      if(!checkback?.confirmed||checkback.task.state!=='succeeded'||checkback.commandId!==originalCheck!.operationId
        ||checkback.toolName!=='workflow.host.f15_n05'||!checkback.confirmed.evidenceRefs.length
        ||!isDeepStrictEqual(checkback.confirmed.result,originalCheck!.result))
        throw new ProtocolError('UNAUTHORIZED','Cloud completion has no original confirmed local verification');
      const checked=parseCodingRepairCheckReadback(checkback.confirmed.result);
      if(checked.sessionId!==state.input!.codingRepair.session.sessionId||checked.snapshot.snapshotId!==state.result!.codingRepair?.snapshotId
        ||state.input!.codingRepair.recipes.filter(recipe=>recipe.required).some(recipe=>!checked.verification.some(item=>
          item.recipeId===recipe.recipeId&&item.status==='VALID'&&item.exitCode===0)))
        throw new ProtocolError('REVISION_CONFLICT','Cloud completion is not covered by original current required verification');
      if(request.mode==='main') {
        const originalPublish=state.confirmedHost['workflow.host.f15_n06'];
        const published=originalPublish?application.readHostToolTask(originalPublish.localTaskId):undefined;
        if(!published?.confirmed||published.task.state!=='succeeded'||published.toolName!=='workflow.host.f15_n06'
          ||published.commandId!==originalPublish!.operationId||!published.confirmed.evidenceRefs.length
          ||!isDeepStrictEqual(published.confirmed.result,originalPublish!.result))
          throw new ProtocolError('UNAUTHORIZED','Cloud completion has no original confirmed local CAS publication');
        const delivered=parseCodingRepairPublishReadback(published.confirmed.result);
        if(delivered.sessionId!==checked.sessionId||delivered.state!=='published'||delivered.files.some(file=>
          !checked.snapshot.files.some(source=>source.path===file.path&&source.sha256===file.afterSha256)))
          throw new ProtocolError('REVISION_CONFLICT','Original publication is not bound to the current verified sources');
        const node=state.result!.nodes.F15_N06;if(node?.state!=='completed'||!plain(node.value)||node.value.state!=='published')
          throw new ProtocolError('RESULT_UNKNOWN','F15 settled without original verified publish readback');
      }else {
        const node=state.result!.nodes.F15_N06;
        if(node?.state!=='completed'||!plain(node.value)||node.value.state!=='shadow_artifact_verified'||node.value.published!==false
          ||state.confirmedHost['workflow.host.f15_n06'])throw new ProtocolError('UNAUTHORIZED','Isolated completion lacks original verified unpublished artifact');
      }
      const refs=state.evidenceRefs;
      return {resultSummary:JSON.stringify({workflowId:'F15',state:'settled',mode:request.mode,sessionId:state.input!.codingRepair.session.sessionId,
        codingRepair:state.result!.codingRepair,timings:state.timings}),evidenceRefs:refs};
    },
    ...(request.mode==='isolated'?{snapshot:(state:GraphState)=>({namespace:state.sessionId,asOf:state.timings[0]?.startedAt??new Date().toISOString(),
      sourceVersions:Object.fromEntries(state.input!.codingRepair.initialSnapshot.files.map(file=>[file.path,file.sha256??'absent']))})}:{}),
    stoppedReason:result=>result.codingRepair?.stoppedReason??'',
    progress:state=>({stepId:'F15-'+state.sequence,label:'F15 '+state.result!.state+' / round '+(state.result!.codingRepair?.round??0)}),
  });
}

/** Host-only reader supplied to the isolated host before CAS publication. */
export function readRuntimeCodingVerificationEvidence(application:RuntimeApplication,input:{session:{taskId:string;sessionId:string};runId:string;originTaskId:string;originRunId:string}):readonly string[]|undefined {
  const candidate=application.readHarnessCandidateVerificationEvidence?.(input);
  if(candidate)return candidate;
  const parent=application.runtime.loadCheckpoint(input.originTaskId,CODING_REPAIR_PARENT) as {taskId?:string}|undefined;
  if(parent?.taskId!==input.session.taskId||input.originRunId!==`host-tool-${input.originTaskId}`)return undefined;
  const readback=application.readHostToolTask(input.originTaskId),value=readback.confirmed?.result;
  if(readback.task.state!=='succeeded'||readback.toolName!=='workflow.host.f15_n05'||!readback.confirmed?.evidenceRefs.length
    ||!plain(value)||value.sessionId!==input.session.sessionId||!Array.isArray(value.verification)
    ||!value.verification.some(item=>plain(item)&&item.runId===input.runId&&item.sessionId===input.session.sessionId&&item.exitCode===0))return undefined;
  return [...readback.confirmed.evidenceRefs];
}
