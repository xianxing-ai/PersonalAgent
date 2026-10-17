import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
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
  /** Current trusted workspace egress lease; paths, hashes and diagnostics are also user data. */
  authorizeMetadata?:(input:{taskId:string;value:unknown;deadline:string;signal:AbortSignal})=>void|Promise<void>;
  /** Exact, native-confirmed source export. Missing port is unavailable, never consent. */
  projectSource?:(input:{taskId:string;localTaskId:string;proposal:Extract<WorkflowProposal,{kind:'tool_proposal'}>;
    receipt:WorkflowReceipt;deadline:string;signal:AbortSignal})=>Promise<unknown>;
}
interface Request {version:1;mode:'main'|'isolated';allowedPaths?:string[];subtasks:SubtaskDefinition[]}
interface GraphState {
  version:1;sessionId:string;controlRevision:number;bindingId:string;sequence:number;
  input?:{goal:string;codingRepair:CodingRepairInput;executionModel?:ReturnType<typeof parseExecutionModelSelection>};checkpoint?:string;
  result?:OwnedWorkflowAdvanceResult;receipts:WorkflowReceipt[];resolvedValues:Record<string,unknown>;
  pendingSend?:{requestId:string;digest:string};initialRunId?:string;
  waiting?:{localTaskId:string;operationId:string};
  confirmedHost:Record<string,{localTaskId:string;operationId:string;result:unknown}>;
  evidenceRefs:string[];timings:{stage:string;startedAt:string;elapsedMs:number;nodeId?:string;operationId?:string}[];
}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function isRuntimeDispatchTool(name:string):boolean {return name==='subagent.dispatch'||name===CODING_REPAIR_WORKFLOW_TOOL;}
/** Original dispatcher owns child tasks, cancellation, summaries and model selection. */
export function createRuntimeCodingRepairDispatchTool(getApplication:()=>RuntimeApplication):RegisteredTool {
  const original=()=>getApplication().createSubagentDispatchTool();
  // Descriptor construction is static; application exists before this execute callback can run.
  const schema={type:'object',properties:{subtasks:{type:'array',minItems:1,maxItems:1,items:{type:'object',properties:{
    subtaskId:{type:'string',minLength:1},role:{type:'string',enum:['coder']},roleLabel:{type:'string'},goal:{type:'string',minLength:1},
    model:{type:'string',minLength:1},reasoningEffort:{enum:['none','minimal','low','medium','high','xhigh','max']},thinkingDepth:{type:'integer',minimum:0,maximum:5}},
    required:['subtaskId','role','goal'],additionalProperties:false}},codingRepair:{type:'object',properties:{
      mode:{enum:['main','isolated']},allowedPaths:{type:'array',items:{type:'string',minLength:1}}},required:['mode'],additionalProperties:false}},
    required:['subtasks','codingRepair'],additionalProperties:false};
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
  worker:WorkerContext,tools:AgentToolPort,options:RuntimeCodingRepairOptions):Promise<WorkerResult> {
  const request=readRuntimeCodingRepairRequest(application,subtask,worker.taskId);
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
  const pause=(localTaskId:string,operationId:string):WorkerResult=>{
    const local=application.runtime.getTask(localTaskId);state!.waiting={localTaskId,operationId};save();
    const waiting=local.state==='waiting_approval'?'waiting_approval':'waiting_reconciliation';
    if(application.runtime.getTask(worker.taskId).state==='running')application.runtime.transitionTask(worker.taskId,waiting);
    return {resultSummary:'F15 正等待原操作批准或核实；没有重做未知写入',evidenceRefs:[]};};
  const secret=await options.image.receiptSecret(worker.signal);active();
  const bridge=createRuntimeOwnedWorkflowHost(application,{receiptSecret:secret,parentTaskId:worker.taskId,
    assertActive:(taskId,revision)=>{active();if(taskId!==worker.taskId||revision!==state!.controlRevision)throw new ProtocolError('REVISION_CONFLICT','Coding workflow control changed');},
    ...(request.mode==='isolated'?{assertIsolation:()=>{if(state!.input?.codingRepair.session.mode!=='isolated')throw new ProtocolError('UNAUTHORIZED','Shadow session isolation is missing');}}:{})});
  if(!state.input) {
    const runId=state.initialRunId??`coding-start-${worker.taskId}`;state.initialRunId=runId;save();
    const result=await timed('isolation-start',()=>tools.invoke({taskId:worker.taskId,runId,authorizationRef:runId,toolName:'coding.repair.start',toolVersion:'1.0.0',
      arguments:{mode:request.mode,...(request.allowedPaths?{allowedPaths:request.allowedPaths}:{})},deadline:worker.deadline,signal:worker.signal}));
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
  await options.authorizeMetadata({taskId:worker.taskId,value:state.input,deadline:worker.deadline,signal:worker.signal});active();
  const catalog=parseCoordinationAvailableTools(tools.list().filter(tool=>
    tool.name!==CODING_REPAIR_WORKFLOW_TOOL&&(tool.name.startsWith('coding.repair.')||tool.name.startsWith('workflow.host.f15_')
      ||tool.name.startsWith('workflow.guard.f15_')||tool.name==='workspace.coding_snapshot'||tool.name==='decision.choose_candidate'))
    .map(tool=>({name:tool.name,version:tool.version,inputSchema:tool.inputSchema})));
  for(;;) {
    active();
    const binding={taskId:worker.taskId,sessionId:state.sessionId,workflowId:'F15',controlRevision:state.controlRevision,deadline:worker.deadline,taskDeadline:worker.deadline};
    const proposals=state.result?.proposals??[];
    state.receipts=[];
    for(const proposal of proposals) {
      if(proposal.kind!=='tool_proposal')throw new ProtocolError('UNSUPPORTED_CAPABILITY','Coding graph requires a registered host adapter');
      if(!catalog.some(tool=>tool.name===proposal.toolName&&tool.version===proposal.toolVersion))
        throw new ProtocolError('UNAUTHORIZED','Coding graph requested a tool outside its original published catalog');
      const local=bridge.submit(binding,proposal);
      // The child may finish asynchronously; wait only for the original registered worker, never replay it.
      const cancelChild=()=>{try{application.runtime.requestCancel(local.localTaskId,'Original coding graph was cancelled');}catch{/* Original terminal child is retained. */}};
      worker.signal.addEventListener('abort',cancelChild,{once:true});
      try {if(worker.signal.aborted)cancelChild();await application.waitForHostToolTask(local.localTaskId);active();}
      finally {worker.signal.removeEventListener('abort',cancelChild);}
      const receipt=await timed('host-readback',async()=>bridge.readReceipt(binding,proposal),{nodeId:proposal.nodeId,operationId:proposal.operationId});
      if(!receipt||receipt.state==='stopping'||receipt.state==='unknown')return pause(local.localTaskId,proposal.operationId);
      if(receipt.state==='confirmed')state.confirmedHost[proposal.toolName]={localTaskId:local.localTaskId,operationId:proposal.operationId,result:structuredClone(receipt.result)};
      let outbound=receipt;
      if(proposal.toolName==='coding.repair.read') {
        if(!options.projectSource)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Exact native source export authorization is unavailable');
        const projected=await timed('source-export-consent',()=>options.projectSource!({taskId:worker.taskId,localTaskId:local.localTaskId,proposal,receipt,deadline:worker.deadline,signal:worker.signal}),{nodeId:proposal.nodeId});
        if(!isDeepStrictEqual(projected,receipt.result))throw new ProtocolError('UNAUTHORIZED','Source export must preserve original confirmed bytes and SHA');
        outbound={...receipt,result:projected};
        state.resolvedValues['coding-source:'+String(proposal.arguments.path)]=structuredClone(projected);
      }else {
        await options.authorizeMetadata({taskId:worker.taskId,value:receipt.result,deadline:worker.deadline,signal:worker.signal});
        if(proposal.nodeId==='F15_N01'&&receipt.state==='confirmed')state.resolvedValues.F15_N01=structuredClone(receipt.result);
      }
      state.evidenceRefs=[...new Set([...state.evidenceRefs,...receipt.evidenceRefs])];
      state.receipts.push(outbound);delete state.waiting;save();
    }
    if(state.result?.state==='settled') {
      const originalCheck=state.confirmedHost['workflow.host.f15_n05'];
      const checkback=originalCheck?application.readHostToolTask(originalCheck.localTaskId):undefined;
      if(!checkback?.confirmed||checkback.task.state!=='succeeded'||checkback.commandId!==originalCheck!.operationId
        ||checkback.toolName!=='workflow.host.f15_n05'||!checkback.confirmed.evidenceRefs.length
        ||!isDeepStrictEqual(checkback.confirmed.result,originalCheck!.result))
        throw new ProtocolError('UNAUTHORIZED','Cloud completion has no original confirmed local verification');
      const checked=parseCodingRepairCheckReadback(checkback.confirmed.result);
      if(checked.sessionId!==state.input.codingRepair.session.sessionId||checked.snapshot.snapshotId!==state.result.codingRepair?.snapshotId
        ||state.input.codingRepair.recipes.filter(recipe=>recipe.required).some(recipe=>!checked.verification.some(item=>
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
        const node=state.result.nodes.F15_N06;if(node?.state!=='completed'||!plain(node.value)||node.value.state!=='published')
          throw new ProtocolError('RESULT_UNKNOWN','F15 settled without original verified publish readback');
      }else {
        const node=state.result.nodes.F15_N06;
        if(node?.state!=='completed'||!plain(node.value)||node.value.state!=='shadow_artifact_verified'||node.value.published!==false
          ||state.confirmedHost['workflow.host.f15_n06'])throw new ProtocolError('UNAUTHORIZED','Isolated completion lacks original verified unpublished artifact');
      }
      const refs=state.evidenceRefs;
      return {resultSummary:JSON.stringify({workflowId:'F15',state:'settled',mode:request.mode,sessionId:state.input.codingRepair.session.sessionId,
        codingRepair:state.result.codingRepair,timings:state.timings}),evidenceRefs:refs};
    }
    if(state.result&&['failed','unavailable','cancelled','unknown','paused','awaiting_user','awaiting_controller'].includes(state.result.state)) {
      if(state.result.state==='unknown'){application.runtime.transitionTask(worker.taskId,'waiting_reconciliation');return {resultSummary:'F15 原操作结果未知，未重放',evidenceRefs:[]};}
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Coding graph stopped: '+state.result.state+' '+(state.result.codingRepair?.stoppedReason??''));
    }
    if(state.pendingSend) {application.runtime.transitionTask(worker.taskId,'waiting_reconciliation');return {resultSummary:'F15 原云请求结果未知，未重新发送',evidenceRefs:[]};}
    const envelope:OwnedWorkflowAdvanceRequest={...binding,requestId:'coding-'+worker.taskId+'-'+state.sequence,input:state.input,
      signal:worker.signal,availableTools:catalog,mode:request.mode,...(state.checkpoint?{checkpoint:state.checkpoint}:{}),
      receipts:state.receipts,resolvedValues:state.resolvedValues};
    if(request.mode==='isolated')envelope.snapshot={namespace:state.sessionId,asOf:state.timings[0]?.startedAt??new Date().toISOString(),
      sourceVersions:Object.fromEntries(state.input.codingRepair.initialSnapshot.files.map(file=>[file.path,file.sha256??'absent']))};
    state.pendingSend={requestId:envelope.requestId,digest:hash({...envelope,signal:undefined})};save();
    const result=await timed('image-advance',()=>options.image.advance(envelope));active();
    if(result.workflowId!=='F15'||result.workflowVersion!=='1.0.0'||!result.checkpoint||!Array.isArray(result.proposals)||!plain(result.nodes))
      throw new ProtocolError('PROTOCOL_MISMATCH','Invalid F15 image graph result');
    state.result=structuredClone(result);state.checkpoint=result.checkpoint;state.sequence++;delete state.pendingSend;save();
    worker.reportProgress({stepId:'F15-'+state.sequence,label:'F15 '+result.state+' / round '+(result.codingRepair?.round??0)});
  }
}

/** Host-only reader supplied to the isolated host before CAS publication. */
export function readRuntimeCodingVerificationEvidence(application:RuntimeApplication,input:{session:{taskId:string;sessionId:string};runId:string;originTaskId:string;originRunId:string}):readonly string[]|undefined {
  const parent=application.runtime.loadCheckpoint(input.originTaskId,CODING_REPAIR_PARENT) as {taskId?:string}|undefined;
  if(parent?.taskId!==input.session.taskId||input.originRunId!==`host-tool-${input.originTaskId}`)return undefined;
  const readback=application.readHostToolTask(input.originTaskId),value=readback.confirmed?.result;
  if(readback.task.state!=='succeeded'||readback.toolName!=='workflow.host.f15_n05'||!readback.confirmed?.evidenceRefs.length
    ||!plain(value)||value.sessionId!==input.session.sessionId||!Array.isArray(value.verification)
    ||!value.verification.some(item=>plain(item)&&item.runId===input.runId&&item.sessionId===input.session.sessionId&&item.exitCode===0))return undefined;
  return [...readback.confirmed.evidenceRefs];
}
