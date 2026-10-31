import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {TaskSnapshot,ToolDescriptor} from '@personal-agent/contracts';
import type {AgentToolPort} from '@personal-agent/agents';
import {parseCoordinationAvailableTools} from '@personal-agent/coordination';
import type {CoordinationToolProposalResult} from '@personal-agent/coordination';
import {getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import type {OwnedWorkflowAdvanceRequest,OwnedWorkflowAdvanceResult} from '@personal-agent/agentarts';
import type {CoordinationWorkerCapabilityPort} from './coordination.js';
import type {RuntimeApplication,HostToolTaskReadback} from './runtime-application.js';
import {createRuntimeOwnedWorkflowHost} from './owned-workflow-application.js';
import {runRuntimeOwnedWorkflowDriver} from './owned-workflow-driver.js';
import type {RuntimeOwnedWorkflowDriverState} from './owned-workflow-driver.js';

type Scope={taskId:string;deadline:string;signal:AbortSignal};
type Proposal=Extract<OwnedWorkflowAdvanceResult['proposals'][number],{kind:'tool_proposal'}>;
type Graph=RuntimeOwnedWorkflowDriverState;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}

/** Trusted per-graph composition. No generic model-selectable workflow ID or default verifier. */
export interface RuntimeConfiguredWorkflowOptions {
  workflowId:string;toolName:string;toolVersion:string;configurationVersion:string;
  requestSchema:Record<string,unknown>;inputSchema:Record<string,unknown>;resultSchema:Record<string,unknown>;
  publicEnumPaths:readonly string[];
  requiredTools:readonly {name:string;version:string}[];
  sideEffect:ToolDescriptor['sideEffect'];
  image:{bindingId:string;advance(request:OwnedWorkflowAdvanceRequest):Promise<OwnedWorkflowAdvanceResult>;receiptSecret(signal:AbortSignal):Promise<string>};
  available(scope:Scope):boolean|Promise<boolean>;
  resolveInput(arguments_:Record<string,unknown>,scope:Scope):Promise<unknown>;
  assertCurrent(scope:Scope):void;
  assertFrontier(input:Scope & {input:unknown;proposal:Proposal;state:Graph}):boolean|Promise<boolean>;
  authorizeExport(input:Scope & {stage:'initial'|'receipt'|'completion';value:unknown;proposal?:Proposal;localTaskId?:string}):Promise<boolean>;
  /** Verify every required node and its original domain readback, never cloud settled alone. */
  verifyCompletion(input:Scope & {input:unknown;state:Graph;readbacks:readonly HostToolTaskReadback[]}):Promise<{result:unknown;resultSummary:string}>;
}
export interface RuntimeConfiguredWorkflowCapability extends CoordinationWorkerCapabilityPort {
  describe():{name:string;version:string;inputSchema:Record<string,unknown>};
  available(scope:Scope):Promise<boolean>;
  isActive(taskId:string):boolean;
  pendingHostTask(taskId:string):TaskSnapshot|undefined;
  assertResumeAllowed(taskId:string):void;
}
const strictObject=(schema:unknown)=>plain(schema)&&schema.type==='object'&&schema.additionalProperties===false;
export function runtimeConfiguredWorkflowConfigured(options:RuntimeConfiguredWorkflowOptions|undefined):options is RuntimeConfiguredWorkflowOptions {
  return !!options&&!!getOwnedWorkflowTemplate(options.workflowId)&&!['F09','F15','F20'].includes(options.workflowId)
    &&/^workflow\.[a-z][a-z0-9_.]*$/.test(options.toolName)&&!['workflow.image.execute','workflow.feed.execute','workflow.image.catalog'].includes(options.toolName)
    &&typeof options.toolVersion==='string'&&/^[0-9A-Za-z][0-9A-Za-z_.-]{0,63}$/.test(options.toolVersion)
    &&typeof options.configurationVersion==='string'&&options.configurationVersion.length>0
    &&strictObject(options.requestSchema)&&strictObject(options.inputSchema)&&strictObject(options.resultSchema)
    &&Array.isArray(options.publicEnumPaths)&&options.publicEnumPaths.every(path=>typeof path==='string')
    &&Array.isArray(options.requiredTools)&&options.requiredTools.length>0
    &&options.requiredTools.every(tool=>typeof tool.name==='string'&&!!tool.name&&typeof tool.version==='string'&&!!tool.version)
    &&new Set(options.requiredTools.map(tool=>tool.name)).size===options.requiredTools.length
    &&['read','local_write','external_write'].includes(options.sideEffect)
    &&!!options.image&&typeof options.image.bindingId==='string'&&!!options.image.bindingId
    &&typeof options.image.advance==='function'&&typeof options.image.receiptSecret==='function'
    &&typeof options.available==='function'&&typeof options.resolveInput==='function'&&typeof options.assertCurrent==='function'
    &&typeof options.assertFrontier==='function'&&typeof options.authorizeExport==='function'&&typeof options.verifyCompletion==='function';
}

/** Same original worker, driver, Policy and persistent host operations as the dedicated graphs. */
export function createRuntimeConfiguredWorkflowCapability(application:RuntimeApplication,configuration:RuntimeConfiguredWorkflowOptions,
  getTools:(taskId:string)=>AgentToolPort|undefined):RuntimeConfiguredWorkflowCapability {
  if(!runtimeConfiguredWorkflowConfigured(configuration))fail('UNSUPPORTED_CAPABILITY','Trusted graph configuration is incomplete');
  const options={...configuration,image:{...configuration.image},...structuredClone({
    requestSchema:configuration.requestSchema,inputSchema:configuration.inputSchema,resultSchema:configuration.resultSchema,
    publicEnumPaths:configuration.publicEnumPaths,requiredTools:configuration.requiredTools})};
  const {workflowId,toolName,toolVersion}=options;
  const configurationDigest=hash({...options,image:{bindingId:options.image.bindingId}});
  const accepts=(proposal:CoordinationToolProposalResult)=>proposal.toolName===toolName&&proposal.toolVersion===toolVersion;
  const key=(proposal:CoordinationToolProposalResult)=>'owned-workflow:configured:'+hash([toolName,proposal.proposalId]);
  const pending=(taskId:string)=>application.runtime.loadCheckpoint(taskId,'competition-loop') as {pending?:CoordinationToolProposalResult;pendingRevision?:number}|undefined;
  function active(scope:Scope):void {
    const task=application.runtime.getTask(scope.taskId);
    if(scope.signal.aborted||task.cancelRequested)fail('CANCELLED','Original graph was cancelled');
    if(!['running','waiting_approval','waiting_reconciliation'].includes(task.state))fail('UNAUTHORIZED','Original graph task is no longer active');
    if(!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))fail('TIMEOUT','Original graph deadline expired');
    if(application.runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline)fail('REVISION_CONFLICT','Original graph deadline changed');
    const result=options.assertCurrent(scope);
    if(result!==undefined){void Promise.resolve(result).catch(()=>undefined);fail('UNAUTHORIZED','Graph current guard must be synchronous');}
  }
  function descriptors(scope:Scope):ToolDescriptor[] {
    const tools=getTools(scope.taskId)?.list()??[];
    return options.requiredTools.map(required=>{
      const tool=tools.find(item=>item.name===required.name&&item.version===required.version);
      if(!tool)fail('UNSUPPORTED_CAPABILITY','Original graph tool is unavailable');
      if(options.sideEffect==='read'&&tool.sideEffect!=='read'||options.sideEffect==='local_write'&&tool.sideEffect==='external_write')
        fail('UNAUTHORIZED','Graph effect understates its registered tool');
      return structuredClone(tool);
    });
  }
  async function available(scope:Scope):Promise<boolean> {
    try{active(scope);descriptors(scope);const allowed=await options.available(scope);active(scope);return allowed===true;}catch{return false;}
  }
  function isActive(taskId:string):boolean {
    const loop=pending(taskId),proposal=loop?.pending;if(!proposal||!accepts(proposal))return false;
    const bound=application.runtime.loadCheckpoint(taskId,key(proposal)+':binding') as Record<string,unknown>|undefined;
    return !!bound&&bound.taskId===taskId&&bound.configurationDigest===configurationDigest
      &&bound.deadline===application.runtime.loadCheckpoint(taskId,'application-deadline')
      &&bound.proposalDigest===hash(proposal)&&bound.revision===loop?.pendingRevision;
  }
  function pendingHostTask(taskId:string):TaskSnapshot|undefined {
    const proposal=pending(taskId)?.pending;if(!proposal||!isActive(taskId))return;
    const graph=application.runtime.loadCheckpoint(taskId,key(proposal)+':graph') as Graph|undefined;
    if(!graph?.waiting)return;
    const {localTaskId,operationId}=graph.waiting;
    const parent=application.runtime.loadCheckpoint(localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const original=application.runtime.loadCheckpoint(taskId,'coding-repair:host:'+operationId) as {localTaskId?:string}|undefined;
    const host=application.readHostToolTask(localTaskId);
    if(parent?.taskId!==taskId||parent.operationId!==operationId||original?.localTaskId!==localTaskId||host.commandId!==operationId)
      fail('UNAUTHORIZED','Original graph host binding changed');
    return host.task;
  }
  function assertResumeAllowed(taskId:string):void {
    const proposal=pending(taskId)?.pending;if(!proposal||!isActive(taskId))fail('UNAUTHORIZED','Original graph proposal changed');
    const graph=application.runtime.loadCheckpoint(taskId,key(proposal)+':graph') as Graph|undefined;
    const deadline=application.runtime.loadCheckpoint(taskId,'application-deadline') as string;
    const host=pendingHostTask(taskId);
    if(application.runtime.getTask(taskId).cancelRequested||Date.now()>=Date.parse(deadline)||!graph||graph.pendingSend
      ||!host||!['succeeded','failed','cancelled'].includes(host.state))fail('RESULT_UNKNOWN','Original graph operation requires reconciliation');
  }
  const capability:CoordinationWorkerCapabilityPort={accepts,dispatch:async(proposal,context)=>{
    if(!accepts(proposal))fail('UNSUPPORTED_CAPABILITY','Unknown configured graph');
    validateToolValue(options.requestSchema,proposal.arguments);
    const scope={taskId:context.taskId,deadline:context.deadline,signal:context.signal};active(scope);
    if(await options.available(scope)!==true)fail('UNSUPPORTED_CAPABILITY','Trusted graph is unavailable');active(scope);
    const input=await options.resolveInput(structuredClone(proposal.arguments),scope);active(scope);validateToolValue(options.inputSchema,input);
    const registered=descriptors(scope),catalog=parseCoordinationAvailableTools(registered.map(tool=>({name:tool.name,version:tool.version,inputSchema:tool.inputSchema})));
    const namespace=key(proposal),graphKey=namespace+':graph';
    const bound={version:1,taskId:scope.taskId,deadline:scope.deadline,revision:context.revision,configurationDigest,
      proposalDigest:hash(proposal),input:structuredClone(input),descriptors:registered};
    const prior=context.loadCheckpoint(namespace+':binding');
    if(prior!==undefined&&!isDeepStrictEqual(prior,bound))fail('REVISION_CONFLICT','Original graph configuration or input changed');
    application.runtime.saveCheckpointOnce(scope.taskId,namespace+':binding',bound);
    let graph=context.loadCheckpoint(graphKey) as Graph|undefined;
    if(!graph){graph={version:1,sessionId:randomUUID(),controlRevision:0,bindingId:options.image.bindingId,sequence:0,input:structuredClone(input),
      receipts:[],resolvedValues:{},confirmedHost:{},evidenceRefs:[],timings:[]};context.saveCheckpoint(graphKey,graph);}
    if(!isDeepStrictEqual(graph.input,input))fail('REVISION_CONFLICT','Original graph input changed');
    const authorize=async(stage:'initial'|'receipt'|'completion',value:unknown,extra:{proposal?:Proposal;localTaskId?:string}={})=>{
      if(await options.authorizeExport({...scope,stage,value:structuredClone(value),...extra})!==true)fail('UNAUTHORIZED','Exact graph export was denied');active(scope);
      if(!isDeepStrictEqual(descriptors(scope),registered))fail('REVISION_CONFLICT','Original graph tool changed');
    };
    await authorize('initial',input);
    const secret=await options.image.receiptSecret(scope.signal);active(scope);
    const host=createRuntimeOwnedWorkflowHost(application,{receiptSecret:secret,parentTaskId:scope.taskId,assertActive:(id,revision)=>{
      active(scope);if(id!==scope.taskId||revision!==graph!.controlRevision)fail('REVISION_CONFLICT','Original graph control changed');
      if(!isDeepStrictEqual(descriptors(scope),registered))fail('REVISION_CONFLICT','Original graph tool changed');}});
    let completion:unknown;
    const outcome=await runRuntimeOwnedWorkflowDriver(application,context,graph,{workflowId,checkpointKey:graphKey,mode:'main',image:options.image,
      bridge:host,catalog,requestId:sequence=>'graph-'+hash([scope.taskId,proposal.proposalId,sequence]),
      authorizeProposal:async({proposal:item,state})=>{
        if(!getOwnedWorkflowTemplate(workflowId)!.nodes.some(node=>node.id===item.nodeId)
          ||state.result?.nodes[item.nodeId]?.state!=='waiting_receipt')fail('UNAUTHORIZED','Graph proposal is outside its original frontier');
        if(await options.assertFrontier({...scope,input:structuredClone(input),proposal:structuredClone(item),state:structuredClone(state)})!==true)
          fail('UNAUTHORIZED','Original graph frontier was not verified');active(scope);
      },
      authorizeReceipt:async({proposal:item,receipt,localTaskId})=>authorize('receipt',receipt,{proposal:structuredClone(item),localTaskId}),
      validateSettled:async state=>{
        const records=Object.values(state.confirmedOperations??{});
        if(!records.length)fail('UNAUTHORIZED','Graph has no original local completion evidence');
        const readbacks=records.map(record=>{
          const binding=application.runtime.loadCheckpoint(scope.taskId,'owned-workflow:operation:'+record.operationId) as
            {taskId?:string;workflowId?:string;sessionId?:string;localTaskId?:string;proposal?:Proposal}|undefined;
          const parent=application.runtime.loadCheckpoint(record.localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
          const intent=application.runtime.loadCheckpoint(scope.taskId,'coding-repair:host:'+record.operationId) as
            {localTaskId?:string;request?:{toolName?:string;toolVersion?:string;arguments?:unknown}}|undefined;
          if(!binding?.proposal||binding.taskId!==scope.taskId||binding.workflowId!==workflowId||binding.sessionId!==state.sessionId
            ||binding.localTaskId!==record.localTaskId||binding.proposal.operationId!==record.operationId||binding.proposal.nodeId!==record.nodeId
            ||binding.proposal.toolName!==record.toolName||parent?.taskId!==scope.taskId||parent.operationId!==record.operationId
            ||intent?.localTaskId!==record.localTaskId||intent.request?.toolName!==record.toolName||intent.request.toolVersion!==binding.proposal.toolVersion
            ||!isDeepStrictEqual(intent.request.arguments,binding.proposal.arguments))fail('UNAUTHORIZED','Original graph completion binding changed');
          const readback=application.readHostToolTask(record.localTaskId),receipt=host.readReceipt({taskId:scope.taskId,workflowId,
            sessionId:state.sessionId,controlRevision:state.controlRevision},binding.proposal);
          if(receipt?.state!=='confirmed'||readback.task.state!=='succeeded'||readback.commandId!==record.operationId
            ||readback.toolName!==record.toolName||!readback.confirmed?.evidenceRefs.length
            ||!isDeepStrictEqual(readback.confirmed.result,record.result)||!isDeepStrictEqual(receipt.result,record.result)
            ||!isDeepStrictEqual(receipt.evidenceRefs,readback.confirmed.evidenceRefs))fail('UNAUTHORIZED','Original graph completion readback changed');
          return readback;
        });
        const verified=await options.verifyCompletion({...scope,input:structuredClone(input),state:structuredClone(state),readbacks});active(scope);
        if(!verified||typeof verified.resultSummary!=='string'||!verified.resultSummary.trim())fail('UNAUTHORIZED','Graph completion was not verified');
        validateToolValue(options.resultSchema,verified.result);completion=structuredClone(verified.result);
        return {resultSummary:verified.resultSummary,evidenceRefs:[...new Set(readbacks.flatMap(read=>read.confirmed!.evidenceRefs))]};
      }});
    const task=application.runtime.getTask(scope.taskId);
    if(task.state==='waiting_approval'||task.state==='waiting_reconciliation')return {state:task.state==='waiting_approval'?'pending':'unknown',result:null,evidenceRefs:[],selection:bound};
    active(scope);await authorize('completion',completion);
    const selection={...bound,resultDigest:hash(completion)};
    context.saveCheckpoint(namespace+':receipt',{selection,result:completion});
    return {state:'confirmed',result:completion,evidenceRefs:outcome.evidenceRefs??[],selection};
  },assertReceiptAllowed:(proposal,selection,result,context)=>{
    active(context);const saved=context.loadCheckpoint(key(proposal)+':receipt') as {selection:Record<string,unknown>;result:unknown}|undefined;
    if(!accepts(proposal)||!saved||saved.selection.configurationDigest!==configurationDigest||saved.selection.proposalDigest!==hash(proposal)
      ||saved.selection.taskId!==context.taskId||saved.selection.deadline!==context.deadline||saved.selection.revision!==context.revision
      ||!isDeepStrictEqual(saved.selection.descriptors,descriptors(context))
      ||saved.selection.resultDigest!==hash(result)||!isDeepStrictEqual(saved.selection,selection)||!isDeepStrictEqual(saved.result,result))
      fail('UNAUTHORIZED','Original graph result receipt changed');
  }};
  return {...capability,describe:()=>({name:toolName,version:toolVersion,inputSchema:structuredClone(options.requestSchema)}),
    available,isActive,pendingHostTask,assertResumeAllowed};
}
