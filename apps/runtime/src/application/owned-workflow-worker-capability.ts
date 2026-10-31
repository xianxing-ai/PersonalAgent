import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {TaskSnapshot} from '@personal-agent/contracts';
import type {AgentToolPort} from '@personal-agent/agents';
import {parseCoordinationAvailableTools} from '@personal-agent/coordination';
import type {CoordinationToolProposalResult} from '@personal-agent/coordination';
import type {OwnedWorkflowAdvanceRequest,OwnedWorkflowAdvanceResult,WorkflowReceipt} from '@personal-agent/agentarts';
import type {WorkerContext} from '../index.js';
import type {CoordinationWorkerCapabilityPort} from './coordination.js';
import type {RuntimeApplication,HostToolTaskReadback} from './runtime-application.js';
import {createRuntimeOwnedWorkflowHost} from './owned-workflow-application.js';
import {runRuntimeOwnedWorkflowDriver} from './owned-workflow-driver.js';
import type {RuntimeOwnedWorkflowDriverState} from './owned-workflow-driver.js';

export const OWNED_WORKFLOW_WORKER_TOOL='workflow.image.execute';
export const OWNED_WORKFLOW_WORKER_VERSION='1.0.0';
const STATE_PREFIX='owned-workflow:f20:';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}

/** References select only a host-configured case. They do not name files or grant access. */
export function ownedWorkflowWorkerInputSchema():Record<string,unknown> {
  return {type:'object',properties:{workflowId:{const:'F20'},inputRef:{type:'string',minLength:1,maxLength:128,
    pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'}},required:['workflowId','inputRef'],additionalProperties:false};
}
export interface RuntimeF20Input {
  schemaFile:string;codeFile:string;recipeId:string;docTemplate:string;targetDoc:string;sourceVersion:string;
}
type Scope={taskId:string;deadline:string;signal:AbortSignal};
type Proposal=Extract<OwnedWorkflowAdvanceResult['proposals'][number],{kind:'tool_proposal'}>;
/** All callbacks are trusted host ports. Absence is unavailable, never implicit authorization.
 * The completion verifier must independently bind both current sources and the exact recipe to
 * the candidate and confirmed command result; an exit code alone is not document verification. */
export interface RuntimeOwnedWorkflowWorkerOptions {
  image:{bindingId:string;advance(request:OwnedWorkflowAdvanceRequest):Promise<OwnedWorkflowAdvanceResult>;receiptSecret(signal:AbortSignal):Promise<string>};
  available(scope:Scope):boolean|Promise<boolean>;
  resolveInput(inputRef:string,scope:Scope):Promise<RuntimeF20Input|undefined>;
  assertCurrent(scope:Scope):void;
  /** Independently authenticate the image frontier and its model-produced predecessor. */
  assertFrontier(input:Scope & {input:RuntimeF20Input;proposal:Proposal;state:RuntimeOwnedWorkflowDriverState<RuntimeF20Input>}):void|Promise<void>;
  authorizeExport(input:Scope & {stage:'initial'|'receipt'|'completion';inputRef:string;value:unknown;localTaskId?:string;operationId?:string}):Promise<void>;
  verifyCompletion(input:Scope & {input:RuntimeF20Input;state:RuntimeOwnedWorkflowDriverState<RuntimeF20Input>;
    read:HostToolTaskReadback;check:HostToolTaskReadback;sourceReads:readonly HostToolTaskReadback[]}):Promise<{additionalSourceTaskIds:readonly string[]}>;
}
interface Binding {version:1;taskId:string;deadline:string;revision:number;bindingId:string;proposalDigest:string;inputRef:string;input:RuntimeF20Input;}
type Graph=RuntimeOwnedWorkflowDriverState<RuntimeF20Input>;
export interface RuntimeOwnedWorkflowWorkerCapability extends CoordinationWorkerCapabilityPort {
  describe():{name:string;version:string;inputSchema:Record<string,unknown>};
  isActive(taskId:string):boolean;
  pendingHostTask(taskId:string):TaskSnapshot|undefined;
  assertResumeAllowed(taskId:string,observeUnknown?:boolean):void;
}
function validInput(value:unknown):value is RuntimeF20Input {
  if(!plain(value)||Object.keys(value).sort().join(',')!=='codeFile,docTemplate,recipeId,schemaFile,sourceVersion,targetDoc')return false;
  return Object.values(value).every(item=>typeof item==='string'&&item.length>0&&item.length<=4096&&!item.includes('\0'));
}
function graphKey(proposal:CoordinationToolProposalResult):string{return STATE_PREFIX+hash(proposal.proposalId);}
export function runtimeOwnedWorkflowWorkerConfigured(options:RuntimeOwnedWorkflowWorkerOptions|undefined):options is RuntimeOwnedWorkflowWorkerOptions {
  return !!options?.image&&typeof options.image.bindingId==='string'&&!!options.image.bindingId.trim()
    &&typeof options.image.advance==='function'&&typeof options.image.receiptSecret==='function'&&typeof options.available==='function'
    &&typeof options.resolveInput==='function'&&typeof options.assertCurrent==='function'&&typeof options.authorizeExport==='function'
    &&typeof options.verifyCompletion==='function'&&typeof options.assertFrontier==='function';
}

/** Executes in the existing user-work worker, through its original Policy/HostBridge. */
export function createRuntimeOwnedWorkflowWorkerCapability(application:RuntimeApplication,options:RuntimeOwnedWorkflowWorkerOptions,
  getTools:(taskId:string)=>AgentToolPort|undefined):RuntimeOwnedWorkflowWorkerCapability {
  const accepts=(proposal:CoordinationToolProposalResult)=>proposal.toolName===OWNED_WORKFLOW_WORKER_TOOL&&proposal.toolVersion===OWNED_WORKFLOW_WORKER_VERSION;
  const active=(scope:Scope)=>{
    const task=application.runtime.getTask(scope.taskId);
    if(scope.signal.aborted||task.cancelRequested)fail('CANCELLED','Original workflow worker was cancelled');
    if(!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))fail('TIMEOUT','Original workflow worker deadline expired');
    if(application.runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline)fail('REVISION_CONFLICT','Original workflow deadline changed');
    options.assertCurrent(scope);
  };
  const pending=(taskId:string)=>application.runtime.loadCheckpoint(taskId,'competition-loop') as {pending?:CoordinationToolProposalResult;pendingRevision?:number}|undefined;
  function isActive(taskId:string):boolean {
    const loop=pending(taskId),proposal=loop?.pending;if(!proposal||!accepts(proposal))return false;
    const bound=application.runtime.loadCheckpoint(taskId,graphKey(proposal)+':binding') as Binding|undefined;
    return !!bound&&bound.version===1&&bound.taskId===taskId&&bound.bindingId===options.image.bindingId
      &&bound.deadline===application.runtime.loadCheckpoint(taskId,'application-deadline')
      &&bound.proposalDigest===hash(proposal)&&bound.revision===loop?.pendingRevision;
  }
  function pendingHostTask(taskId:string) {
    const loop=pending(taskId),proposal=loop?.pending;if(!proposal||!isActive(taskId))return;
    const graph=application.runtime.loadCheckpoint(taskId,graphKey(proposal)+':graph') as Graph|undefined;
    if(!graph?.waiting)return;
    const {localTaskId,operationId}=graph.waiting;
    const parent=application.runtime.loadCheckpoint(localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const original=application.runtime.loadCheckpoint(taskId,'coding-repair:host:'+operationId) as {localTaskId?:string}|undefined;
    const host=application.readHostToolTask(localTaskId);
    if(parent?.taskId!==taskId||parent.operationId!==operationId||original?.localTaskId!==localTaskId||host.commandId!==operationId)
      fail('UNAUTHORIZED','Original workflow host task binding changed');
    return host.task;
  }
  function assertResumeAllowed(taskId:string,_observeUnknown=false):void {
    const loop=pending(taskId),proposal=loop?.pending;
    if(!proposal||!isActive(taskId))fail('UNAUTHORIZED','Original workflow proposal changed');
    const graph=application.runtime.loadCheckpoint(taskId,graphKey(proposal)+':graph') as Graph|undefined;
    const bound=application.runtime.loadCheckpoint(taskId,graphKey(proposal)+':binding') as Binding;
    if(application.runtime.getTask(taskId).cancelRequested||Date.now()>=Date.parse(bound.deadline)||!graph||graph.pendingSend)
      fail('RESULT_UNKNOWN','Original workflow requires reconciliation');
    const host=pendingHostTask(taskId);
    if(!host||!['succeeded','failed','cancelled'].includes(host.state))
      fail('RESULT_UNKNOWN','Original workflow host operation is not settled');
  }
  const capability:CoordinationWorkerCapabilityPort={accepts,dispatch:async(proposal,context)=>{
    if(!accepts(proposal))fail('UNSUPPORTED_CAPABILITY','Unknown owned workflow');
    validateToolValue(ownedWorkflowWorkerInputSchema(),proposal.arguments);
    if(!runtimeOwnedWorkflowWorkerConfigured(options))
      fail('UNSUPPORTED_CAPABILITY','Trusted F20 input, export and completion ports are unavailable');
    const scope={taskId:context.taskId,deadline:context.deadline,signal:context.signal};active(scope);
    if(!await options.available(scope))fail('UNSUPPORTED_CAPABILITY','Trusted F20 case is unavailable');active(scope);
    const inputRef=proposal.arguments.inputRef as string,input=await options.resolveInput(inputRef,scope);active(scope);
    if(!validInput(input))fail('UNSUPPORTED_CAPABILITY','Trusted F20 case is unavailable');
    const namespace=graphKey(proposal),bindingKey=namespace+':binding',key=namespace+':graph';
    const bound:Binding={version:1,taskId:scope.taskId,deadline:scope.deadline,revision:context.revision,
      bindingId:options.image.bindingId,proposalDigest:hash(proposal),inputRef,input:structuredClone(input)};
    const prior=application.runtime.loadCheckpoint(scope.taskId,bindingKey);
    if(prior!==undefined&&!isDeepStrictEqual(prior,bound))fail('REVISION_CONFLICT','Original workflow input or proposal changed');
    application.runtime.saveCheckpointOnce(scope.taskId,bindingKey,bound);
    const tools=getTools(scope.taskId);if(!tools)fail('UNSUPPORTED_CAPABILITY','Original workflow tool scope is unavailable');
    const catalog=parseCoordinationAvailableTools(tools.list().filter(tool=>
      ['workspace.read_text','workspace.run_allowed_command','decision.choose_candidate'].includes(tool.name))
      .map(tool=>({name:tool.name,version:tool.version,inputSchema:tool.inputSchema})));
    let state=context.loadCheckpoint(key) as Graph|undefined;
    if(!state){state={version:1,sessionId:randomUUID(),controlRevision:0,bindingId:options.image.bindingId,sequence:0,
      input:structuredClone(input),receipts:[],resolvedValues:{},confirmedHost:{},evidenceRefs:[],timings:[]};context.saveCheckpoint(key,state);}
    if(!isDeepStrictEqual(state.input,input))fail('REVISION_CONFLICT','Original workflow input changed');
    await options.authorizeExport({...scope,stage:'initial',inputRef,value:structuredClone(input)});active(scope);
    const secret=await options.image.receiptSecret(scope.signal);active(scope);
    const host=createRuntimeOwnedWorkflowHost(application,{receiptSecret:secret,parentTaskId:scope.taskId,
      assertActive:(id,revision)=>{active(scope);if(id!==scope.taskId||revision!==state!.controlRevision)fail('REVISION_CONFLICT','Original workflow control changed');}});
    const originalNodeReceipt=(graph:Graph,nodeId:string,toolName:string)=>{
      const record=Object.values(graph.confirmedOperations??{}).find(item=>item.nodeId===nodeId&&item.toolName===toolName);
      if(!record)fail('UNAUTHORIZED','F20 predecessor has no original local receipt');
      const binding=application.runtime.loadCheckpoint(scope.taskId,'owned-workflow:operation:'+record.operationId) as
        {taskId?:string;sessionId?:string;workflowId?:string;localTaskId?:string;proposal?:Proposal}|undefined;
      if(!binding?.proposal||binding.taskId!==scope.taskId||binding.sessionId!==graph.sessionId||binding.workflowId!=='F20'
        ||binding.localTaskId!==record.localTaskId||binding.proposal.nodeId!==nodeId||binding.proposal.toolName!==toolName
        ||binding.proposal.operationId!==record.operationId)fail('UNAUTHORIZED','F20 predecessor operation binding changed');
      const observed=application.readHostToolTask(record.localTaskId);
      const receipt=host.readReceipt({taskId:scope.taskId,sessionId:graph.sessionId,workflowId:'F20',controlRevision:graph.controlRevision},binding.proposal);
      if(receipt?.state!=='confirmed'||!observed.confirmed||observed.task.state!=='succeeded'
        ||observed.commandId!==record.operationId||!observed.confirmed.evidenceRefs.length
        ||!isDeepStrictEqual(observed.confirmed.result,record.result)||!isDeepStrictEqual(receipt.result,record.result))
        fail('UNAUTHORIZED','F20 predecessor readback changed');
      return observed;
    };
    const preflightBinding={version:1,taskId:scope.taskId,deadline:scope.deadline,sessionId:state.sessionId,
      bindingId:options.image.bindingId,proposalDigest:hash(proposal),inputDigest:hash(input),catalogDigest:hash(catalog)};
    application.runtime.saveCheckpointOnce(scope.taskId,key+':preflight-binding',preflightBinding);
    if(!isDeepStrictEqual(context.loadCheckpoint(key+':preflight-binding'),preflightBinding))
      fail('REVISION_CONFLICT','Original workflow source preflight changed');
    // N01 can request only one source. Obtain both original sources as separate,
    // locally initiated HostBridge operations. Their receipts are never sent as N01 receipts.
    if(!state.pendingSend) {
      const descriptor=catalog.find(tool=>tool.name==='workspace.read_text'&&tool.version==='1.0.0');
      if(!descriptor)fail('UNSUPPORTED_CAPABILITY','Original workflow source tool is unavailable');
      const hostBinding={taskId:scope.taskId,sessionId:state.sessionId,workflowId:'F20',controlRevision:state.controlRevision,deadline:scope.deadline};
      for(const path of new Set([input.schemaFile,input.codeFile])) {
        active(scope);
        const args={path};validateToolValue(descriptor.inputSchema,args);
        const operationId='f20-source-'+hash([scope.taskId,hash(proposal),state.sessionId,path]);
        const original:Proposal={kind:'tool_proposal',nodeId:'F20_N01',operationId,proposalId:operationId,inputDigest:hash(args),
          originControlRevision:state.controlRevision,toolName:descriptor.name,toolVersion:descriptor.version,toolSchemaDigest:hash(descriptor.inputSchema),
          arguments:args,resourceKeys:[],effect:'read'};
        const saved=state.confirmedOperations?.[operationId];
        if(saved) {
          const readback=application.readHostToolTask(saved.localTaskId);
          const receipt=host.readReceipt(hostBinding,original);
          if(saved.operationId!==operationId||saved.toolName!==descriptor.name||receipt?.state!=='confirmed'
            ||readback.task.state!=='succeeded'||!readback.confirmed?.evidenceRefs.length||!isDeepStrictEqual(readback.confirmed.result,saved.result))
            fail('UNAUTHORIZED','Original workflow source readback changed');
          continue;
        }
        const local=host.submit(hostBinding,original);
        state.waiting={localTaskId:local.localTaskId,operationId};context.saveCheckpoint(key,state);
        const cancelChild=()=>{try{application.runtime.requestCancel(local.localTaskId,'Original workflow was cancelled');}catch{/* Keep terminal child. */}};
        scope.signal.addEventListener('abort',cancelChild,{once:true});
        try{if(scope.signal.aborted)cancelChild();await application.waitForHostToolTask(local.localTaskId);active(scope);}
        finally{scope.signal.removeEventListener('abort',cancelChild);}
        const receipt=host.readReceipt(hostBinding,original);
        if(!receipt||receipt.state==='stopping'||receipt.state==='unknown') {
          const current=application.runtime.getTask(local.localTaskId);
          if(application.runtime.getTask(scope.taskId).state==='running')application.runtime.transitionTask(scope.taskId,
            current.state==='waiting_approval'?'waiting_approval':'waiting_reconciliation');
          return {state:current.state==='waiting_approval'?'pending':'unknown',result:null,evidenceRefs:[],selection:bound};
        }
        if(receipt.state!=='confirmed')fail('EXTERNAL_FAILURE','Original workflow source read failed');
        if(!plain(receipt.result)||receipt.result.path!==path||!receipt.evidenceRefs.length)
          fail('UNAUTHORIZED','Original workflow source readback is invalid');
        state.confirmedOperations??={};state.confirmedOperations[operationId]={toolName:descriptor.name,localTaskId:local.localTaskId,
          operationId,result:structuredClone(receipt.result)};
        state.evidenceRefs=[...new Set([...state.evidenceRefs,...receipt.evidenceRefs])];delete state.waiting;context.saveCheckpoint(key,state);
      }
    }
    const bridge={submit:(request:Parameters<typeof host.submit>[0],item:Parameters<typeof host.submit>[1])=>{
      if(item.kind!=='tool_proposal')fail('UNSUPPORTED_CAPABILITY','Workflow host adapter is unavailable');
      if(item.nodeId==='F20_N01'&&item.toolName==='workspace.read_text') {
        if(![input.schemaFile,input.codeFile].includes(String(item.arguments.path))
          ||Object.keys(item.arguments).some(key=>!['path','maxBytes'].includes(key)))fail('UNAUTHORIZED','Workflow source is outside the fixed case');
      }else if(item.nodeId==='F20_N03'&&item.toolName==='workspace.run_allowed_command') {
        if(!isDeepStrictEqual(item.arguments,{recipeId:input.recipeId}))fail('UNAUTHORIZED','Workflow command differs from the fixed recipe');
      }else if(['F20_N01','F20_N02','F20_N03','F20_N04'].includes(item.nodeId)&&item.toolName==='decision.choose_candidate') {
        // The existing local selector is advisory; it never grants an operation or scope.
      }else fail('UNAUTHORIZED','Workflow operation is outside the fixed F20 case');
      return host.submit(request,item);
    },readReceipt:host.readReceipt.bind(host)};
    const outcome=await runRuntimeOwnedWorkflowDriver(application,context,state,{workflowId:'F20',checkpointKey:key,mode:'main',
      image:options.image,bridge,catalog,requestId:sequence=>'f20-'+hash([scope.taskId,proposal.proposalId,sequence]),
      authorizeProposal:async({proposal:item,state:graph})=>{
        if(!['F20_N01','F20_N02','F20_N03','F20_N04'].includes(item.nodeId)
          ||graph.result?.nodes[item.nodeId]?.state!=='waiting_receipt')
          fail('UNAUTHORIZED','F20 proposal is outside its original node frontier');
        if(['F20_N02','F20_N03','F20_N04'].includes(item.nodeId))originalNodeReceipt(graph,'F20_N01','workspace.read_text');
        if(['F20_N03','F20_N04'].includes(item.nodeId))originalNodeReceipt(graph,'F20_N02','decision.choose_candidate');
        if(item.nodeId==='F20_N04')originalNodeReceipt(graph,'F20_N03','workspace.run_allowed_command');
        await options.assertFrontier({...scope,input:structuredClone(input),proposal:structuredClone(item),state:structuredClone(graph)});active(scope);
      },
      authorizeReceipt:async({proposal:item,receipt,localTaskId})=>{
        await options.authorizeExport({...scope,stage:'receipt',inputRef,value:structuredClone(receipt.result),localTaskId,operationId:item.operationId});active(scope);
      },
      validateSettled:async graph=>{
        if(['F20_N01','F20_N02','F20_N03','F20_N04'].some(id=>graph.result?.nodes[id]?.state!=='completed'))
          fail('UNAUTHORIZED','F20 has no complete original graph');
        const read=graph.confirmedHost['workspace.read_text'],check=graph.confirmedHost['workspace.run_allowed_command'];
        if(!read||!check)fail('UNAUTHORIZED','F20 original local operations are unavailable');
        originalNodeReceipt(graph,'F20_N01','workspace.read_text');
        originalNodeReceipt(graph,'F20_N02','decision.choose_candidate');
        originalNodeReceipt(graph,'F20_N03','workspace.run_allowed_command');
        originalNodeReceipt(graph,'F20_N04','decision.choose_candidate');
        const readback=application.readHostToolTask(read.localTaskId),checkback=application.readHostToolTask(check.localTaskId);
        for(const [record,original,name] of [[readback,read,'workspace.read_text'],[checkback,check,'workspace.run_allowed_command']] as const)
          if(!record.confirmed||record.task.state!=='succeeded'||record.commandId!==original.operationId||record.toolName!==name
            ||!record.confirmed.evidenceRefs.length||!isDeepStrictEqual(record.confirmed.result,original.result))
            fail('UNAUTHORIZED','F20 lacks original confirmed local evidence');
        if(!plain(checkback.confirmed!.result)||checkback.confirmed!.result.exitCode!==0)
          fail('UNAUTHORIZED','F20 fixed verification command did not pass');
        const reads=[...Object.values(graph.confirmedOperations??{}).filter(item=>item.toolName==='workspace.read_text').map(item=>item.localTaskId),
          read.localTaskId];
        const paths=new Set<string>(),sourceRefs:string[]=[],sourceReads:HostToolTaskReadback[]=[];
        for(const localTaskId of new Set(reads)) {
          const observed=application.readHostToolTask(localTaskId);
          const parent=application.runtime.loadCheckpoint(localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
          const original=parent?.operationId?application.runtime.loadCheckpoint(scope.taskId,'coding-repair:host:'+parent.operationId) as
            {localTaskId?:string;request?:{toolName?:string;arguments?:Record<string,unknown>}}|undefined:undefined;
          const path=original?.request?.arguments?.path;
          if(parent?.taskId!==scope.taskId||parent.operationId!==observed.commandId||original?.localTaskId!==localTaskId
            ||original?.request?.toolName!=='workspace.read_text'||observed.toolName!=='workspace.read_text'||observed.task.state!=='succeeded'
            ||!observed.confirmed?.evidenceRefs.length||typeof path!=='string'||![input.schemaFile,input.codeFile].includes(path)
            ||!plain(observed.confirmed.result)||observed.confirmed.result.path!==path)
            fail('UNAUTHORIZED','F20 source has no original authorized readback');
          paths.add(path);sourceRefs.push(...observed.confirmed.evidenceRefs);sourceReads.push(observed);
        }
        if(!paths.has(input.schemaFile)||!paths.has(input.codeFile))
          fail('UNSUPPORTED_CAPABILITY','F20 requires confirmed original reads for both configured sources');
        const verified=await options.verifyCompletion({...scope,input:structuredClone(input),state:structuredClone(graph),read:readback,check:checkback,sourceReads});active(scope);
        if(!verified||!Array.isArray(verified.additionalSourceTaskIds)||verified.additionalSourceTaskIds.length!==0)
          fail('UNAUTHORIZED','F20 completion cannot introduce unbound source tasks');
        return {resultSummary:'F20 candidate verified against the configured local case; not published',
          evidenceRefs:[...new Set([...graph.evidenceRefs,...sourceRefs])]};
      }});
    const task=application.runtime.getTask(scope.taskId);
    if(task.state==='waiting_approval'||task.state==='waiting_reconciliation')return {state:task.state==='waiting_approval'?'pending':'unknown',
      result:null,evidenceRefs:[],selection:bound};
    active(scope);
    const result={workflowId:'F20',state:'settled',published:false};
    await options.authorizeExport({...scope,stage:'completion',inputRef,value:result});active(scope);
    const selection={...bound,resultDigest:hash(result)};context.saveCheckpoint(namespace+':receipt',{selection,result});
    return {state:'confirmed',result,evidenceRefs:outcome.evidenceRefs??[],selection};
  },assertReceiptAllowed:(proposal,selection,result,context)=>{
    active(context);const saved=context.loadCheckpoint(graphKey(proposal)+':receipt') as {selection:Binding&{resultDigest:string};result:unknown}|undefined;
    if(!saved||saved.selection.bindingId!==options.image.bindingId||saved.selection.proposalDigest!==hash(proposal)
      ||saved.selection.taskId!==context.taskId||saved.selection.deadline!==context.deadline||saved.selection.revision!==context.revision
      ||saved.selection.resultDigest!==hash(result)||!isDeepStrictEqual(saved.selection,selection)||!isDeepStrictEqual(saved.result,result))
      fail('UNAUTHORIZED','Original workflow result receipt changed');
  }};
  return {...capability,describe:()=>({name:OWNED_WORKFLOW_WORKER_TOOL,version:OWNED_WORKFLOW_WORKER_VERSION,inputSchema:ownedWorkflowWorkerInputSchema()}),
    isActive,pendingHostTask,assertResumeAllowed};
}
