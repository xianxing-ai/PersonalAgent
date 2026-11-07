import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {TaskSnapshot} from '@personal-agent/contracts';
import type {AgentToolPort} from '@personal-agent/agents';
import {parseCoordinationAvailableTools} from '@personal-agent/coordination';
import type {CoordinationToolProposalResult} from '@personal-agent/coordination';
import type {OwnedWorkflowAdvanceRequest,OwnedWorkflowAdvanceResult,WorkflowReceipt} from '@personal-agent/agentarts';
import type {CoordinationWorkerCapabilityPort} from './coordination.js';
import type {RuntimeApplication} from './runtime-application.js';
import {createRuntimeOwnedWorkflowHost} from './owned-workflow-application.js';
import {runRuntimeOwnedWorkflowDriver} from './owned-workflow-driver.js';
import type {RuntimeOwnedWorkflowDriverState} from './owned-workflow-driver.js';
export const F09_WORKFLOW_WORKER_TOOL='workflow.feed.execute';
export const F09_WORKFLOW_WORKER_VERSION='1.0.0';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}
type Scope={taskId:string;deadline:string;signal:AbortSignal};
type Proposal=Extract<OwnedWorkflowAdvanceResult['proposals'][number],{kind:'tool_proposal'}>;
export interface RuntimeF09Input {subscriptionId:string;cursor?:string;limit?:number}
type Graph=RuntimeOwnedWorkflowDriverState<RuntimeF09Input>;
interface Binding {version:1;taskId:string;deadline:string;revision:number;bindingId:string;proposalDigest:string;inputRef:string;input:RuntimeF09Input}
/** Source authorization must consume the original exact feed receipt and current destination lease.
 * Receipt export is separately authorized for each exact result, including derived N02 content. */
export interface RuntimeF09WorkflowWorkerOptions {
  image:{bindingId:string;advance(request:OwnedWorkflowAdvanceRequest):Promise<OwnedWorkflowAdvanceResult>;receiptSecret(signal:AbortSignal):Promise<string>};
  available(scope:Scope):boolean|Promise<boolean>;
  resolveInput(inputRef:string,scope:Scope):Promise<RuntimeF09Input|undefined>;
  assertCurrent(scope:Scope):void;
  authorizeInput(input:Scope & {inputRef:string;value:RuntimeF09Input}):Promise<boolean>;
  authorizeSource(input:Scope & {parentTaskId:string;sourceTaskId:string;sourceOperationId:string;result:unknown}):Promise<boolean>;
  authorizeReceipt(input:Scope & {inputRef:string;proposal:Proposal;receipt:WorkflowReceipt;localTaskId:string}):Promise<boolean>;
  assertFrontier(input:Scope & {input:RuntimeF09Input;proposal:Proposal;state:Graph}):boolean|Promise<boolean>;
}
export interface RuntimeF09WorkflowWorkerCapability extends CoordinationWorkerCapabilityPort {
  describe():{name:string;version:string;inputSchema:Record<string,unknown>};
  isActive(taskId:string):boolean;
  pendingHostTask(taskId:string):TaskSnapshot|undefined;
  assertResumeAllowed(taskId:string):void;
}
export function f09WorkflowWorkerInputSchema():Record<string,unknown> {
  return {type:'object',properties:{workflowId:{const:'F09'},inputRef:{type:'string',minLength:1,maxLength:128,
    pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'}},required:['workflowId','inputRef'],additionalProperties:false};
}
export function runtimeF09WorkflowWorkerConfigured(options:RuntimeF09WorkflowWorkerOptions|undefined):options is RuntimeF09WorkflowWorkerOptions {
  return !!options?.image&&typeof options.image.bindingId==='string'&&!!options.image.bindingId.trim()
    &&typeof options.image.advance==='function'&&typeof options.image.receiptSecret==='function'&&typeof options.available==='function'
    &&typeof options.resolveInput==='function'&&typeof options.assertCurrent==='function'&&typeof options.authorizeInput==='function'
    &&typeof options.authorizeSource==='function'&&typeof options.authorizeReceipt==='function'&&typeof options.assertFrontier==='function';
}
function validInput(value:unknown):value is RuntimeF09Input {
  return plain(value)&&Object.keys(value).every(key=>['subscriptionId','cursor','limit'].includes(key))
    &&typeof value.subscriptionId==='string'&&value.subscriptionId.length>0&&value.subscriptionId.length<=256
    &&(value.cursor===undefined||typeof value.cursor==='string'&&value.cursor.length<=2048)
    &&(value.limit===undefined||Number.isSafeInteger(value.limit)&&(value.limit as number)>=1&&(value.limit as number)<=100);
}
const graphKey=(proposal:CoordinationToolProposalResult)=>'owned-workflow:f09:'+hash(proposal.proposalId);

/** This worker can prove only the original feed collection/dedup prefix.
 * F10 enqueue and end-to-end F09 completion remain explicitly unavailable. */
export function createRuntimeF09WorkflowWorkerCapability(application:RuntimeApplication,options:RuntimeF09WorkflowWorkerOptions,
  getTools:(taskId:string)=>AgentToolPort|undefined):RuntimeF09WorkflowWorkerCapability {
  const accepts=(proposal:CoordinationToolProposalResult)=>proposal.toolName===F09_WORKFLOW_WORKER_TOOL
    &&proposal.toolVersion===F09_WORKFLOW_WORKER_VERSION;
  const active=(scope:Scope)=>{
    const task=application.runtime.getTask(scope.taskId);
    if(scope.signal.aborted||task.cancelRequested)fail('CANCELLED','Original F09 worker was cancelled');
    if(!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))fail('TIMEOUT','Original F09 worker deadline expired');
    if(application.runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline)fail('REVISION_CONFLICT','Original F09 deadline changed');
    const current=options.assertCurrent(scope);
    if(current!==undefined){void Promise.resolve(current).catch(()=>undefined);fail('UNAUTHORIZED','F09 current guard must be synchronous');}
  };
  const pending=(taskId:string)=>application.runtime.loadCheckpoint(taskId,'competition-loop') as {pending?:CoordinationToolProposalResult;pendingRevision?:number}|undefined;
  function isActive(taskId:string):boolean {
    const loop=pending(taskId),proposal=loop?.pending;if(!proposal||!accepts(proposal))return false;
    const binding=application.runtime.loadCheckpoint(taskId,graphKey(proposal)+':binding') as Binding|undefined;
    return !!binding&&binding.version===1&&binding.taskId===taskId&&binding.bindingId===options.image.bindingId
      &&binding.deadline===application.runtime.loadCheckpoint(taskId,'application-deadline')
      &&binding.proposalDigest===hash(proposal)&&binding.revision===loop?.pendingRevision;
  }
  function pendingHostTask(taskId:string):TaskSnapshot|undefined {
    const proposal=pending(taskId)?.pending;if(!proposal||!isActive(taskId))return;
    const graph=application.runtime.loadCheckpoint(taskId,graphKey(proposal)+':graph') as Graph|undefined;
    if(!graph?.waiting)return;
    const {localTaskId,operationId}=graph.waiting;
    const parent=application.runtime.loadCheckpoint(localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const original=application.runtime.loadCheckpoint(taskId,'coding-repair:host:'+operationId) as {localTaskId?:string}|undefined;
    const host=application.readHostToolTask(localTaskId);
    if(parent?.taskId!==taskId||parent.operationId!==operationId||original?.localTaskId!==localTaskId||host.commandId!==operationId)
      fail('UNAUTHORIZED','Original F09 host task binding changed');
    return host.task;
  }
  function assertResumeAllowed(taskId:string):void {
    const proposal=pending(taskId)?.pending;if(!proposal||!isActive(taskId))fail('UNAUTHORIZED','Original F09 proposal changed');
    const graph=application.runtime.loadCheckpoint(taskId,graphKey(proposal)+':graph') as Graph|undefined;
    const bound=application.runtime.loadCheckpoint(taskId,graphKey(proposal)+':binding') as Binding;
    if(application.runtime.getTask(taskId).cancelRequested||Date.now()>=Date.parse(bound.deadline)||!graph||graph.pendingSend)
      fail('RESULT_UNKNOWN','Original F09 requires reconciliation');
    const host=pendingHostTask(taskId);
    if(!host||!['succeeded','failed','cancelled'].includes(host.state))fail('RESULT_UNKNOWN','Original F09 host operation is not settled');
  }
  const capability:CoordinationWorkerCapabilityPort={accepts,dispatch:async(proposal,context)=>{
    if(!accepts(proposal))fail('UNSUPPORTED_CAPABILITY','Unknown owned workflow');
    validateToolValue(f09WorkflowWorkerInputSchema(),proposal.arguments);
    if(!runtimeF09WorkflowWorkerConfigured(options))fail('UNSUPPORTED_CAPABILITY','Trusted F09 source and export ports are unavailable');
    const scope={taskId:context.taskId,deadline:context.deadline,signal:context.signal};active(scope);
    if(await options.available(scope)!==true)fail('UNSUPPORTED_CAPABILITY','Trusted F09 source is unavailable');active(scope);
    const inputRef=proposal.arguments.inputRef as string,input=await options.resolveInput(inputRef,scope);active(scope);
    if(!validInput(input))fail('UNSUPPORTED_CAPABILITY','Trusted F09 input is unavailable');
    const namespace=graphKey(proposal),key=namespace+':graph',bindingKey=namespace+':binding';
    const bound:Binding={version:1,taskId:scope.taskId,deadline:scope.deadline,revision:context.revision,bindingId:options.image.bindingId,
      proposalDigest:hash(proposal),inputRef,input:structuredClone(input)};
    const prior=application.runtime.loadCheckpoint(scope.taskId,bindingKey);
    if(prior!==undefined&&!isDeepStrictEqual(prior,bound))fail('REVISION_CONFLICT','Original F09 source or proposal changed');
    application.runtime.saveCheckpointOnce(scope.taskId,bindingKey,bound);
    const tools=getTools(scope.taskId);if(!tools)fail('UNSUPPORTED_CAPABILITY','Original F09 tool scope is unavailable');
    const catalog=parseCoordinationAvailableTools(tools.list().filter(tool=>
      ['feeds.collect','workflow.host.f09_n02','decision.choose_candidate'].includes(tool.name))
      .map(tool=>({name:tool.name,version:tool.version,inputSchema:tool.inputSchema})));
    let state=context.loadCheckpoint(key) as Graph|undefined;
    if(!state){state={version:1,sessionId:randomUUID(),controlRevision:0,bindingId:options.image.bindingId,sequence:0,
      input:structuredClone(input),receipts:[],resolvedValues:{},confirmedHost:{},evidenceRefs:[],timings:[]};context.saveCheckpoint(key,state);}
    if(!isDeepStrictEqual(state.input,input))fail('REVISION_CONFLICT','Original F09 input changed');
    if(await options.authorizeInput({...scope,inputRef,value:structuredClone(input)})!==true)fail('UNAUTHORIZED','F09 input export was denied');active(scope);
    const secret=await options.image.receiptSecret(scope.signal);active(scope);
    const host=createRuntimeOwnedWorkflowHost(application,{receiptSecret:secret,parentTaskId:scope.taskId,
      assertActive:(id,revision)=>{active(scope);if(id!==scope.taskId||revision!==state!.controlRevision)fail('REVISION_CONFLICT','Original F09 control changed');}});
    const originalNode=(graph:Graph,nodeId:string,toolName:string)=>{
      const record=Object.values(graph.confirmedOperations??{}).find(item=>item.nodeId===nodeId&&item.toolName===toolName);
      if(!record)fail('UNAUTHORIZED','F09 predecessor has no original local receipt');
      const binding=application.runtime.loadCheckpoint(scope.taskId,'owned-workflow:operation:'+record.operationId) as
        {taskId?:string;sessionId?:string;workflowId?:string;localTaskId?:string;proposal?:Proposal}|undefined;
      const link=application.runtime.loadCheckpoint(record.localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
      const intent=application.runtime.loadCheckpoint(scope.taskId,'coding-repair:host:'+record.operationId) as
        {localTaskId?:string;request?:{commandId?:string;toolName?:string;toolVersion?:string;arguments?:unknown}}|undefined;
      if(!binding?.proposal||binding.taskId!==scope.taskId||binding.sessionId!==graph.sessionId||binding.workflowId!=='F09'
        ||binding.localTaskId!==record.localTaskId||binding.proposal.nodeId!==nodeId||binding.proposal.toolName!==toolName
        ||binding.proposal.operationId!==record.operationId||link?.taskId!==scope.taskId||link.operationId!==record.operationId
        ||intent?.localTaskId!==record.localTaskId||intent.request?.commandId!==record.operationId||intent.request.toolName!==toolName
        ||intent.request.toolVersion!==binding.proposal.toolVersion
        ||!isDeepStrictEqual(intent.request.arguments,binding.proposal.arguments))fail('UNAUTHORIZED','Original F09 operation binding changed');
      const readback=application.readHostToolTask(record.localTaskId),receipt=host.readReceipt({taskId:scope.taskId,sessionId:graph.sessionId,
        workflowId:'F09',controlRevision:graph.controlRevision},binding.proposal);
      if(receipt?.state!=='confirmed'||!readback.confirmed||readback.task.state!=='succeeded'||readback.commandId!==record.operationId
        ||!readback.confirmed.evidenceRefs.length||!isDeepStrictEqual(readback.confirmed.result,record.result)
        ||!isDeepStrictEqual(receipt.result,record.result)||!isDeepStrictEqual(receipt.evidenceRefs,readback.confirmed.evidenceRefs))
        fail('UNAUTHORIZED','Original F09 predecessor readback changed');
      return {record,receipt};
    };
    await runRuntimeOwnedWorkflowDriver(application,context,state,{workflowId:'F09',checkpointKey:key,mode:'main',image:options.image,bridge:host,catalog,
      requestId:sequence=>'f09-'+hash([scope.taskId,proposal.proposalId,sequence]),
      authorizeProposal:async({proposal:item,state:graph})=>{
        if(item.toolVersion!=='1.0.0'||graph.result?.nodes[item.nodeId]?.state!=='waiting_receipt')
          fail('UNAUTHORIZED','F09 proposal is outside the original frontier');
        if(item.nodeId==='F09_N04')fail('UNSUPPORTED_CAPABILITY','F10 research enqueue host is unavailable');
        if(item.nodeId==='F09_N01'&&item.toolName==='feeds.collect') {
          if(!isDeepStrictEqual(item.arguments,input))fail('UNAUTHORIZED','F09 source arguments differ from the trusted binding');
          if(Object.values(graph.confirmedOperations??{}).some(record=>record.nodeId==='F09_N01'
            &&record.toolName==='feeds.collect'&&record.operationId!==item.operationId))
            fail('REVISION_CONFLICT','F09 source operation is already bound');
        }else if(item.nodeId==='F09_N02'&&item.toolName==='workflow.host.f09_n02') {
          const source=originalNode(graph,'F09_N01','feeds.collect');
          if(!isDeepStrictEqual(item.arguments,{sourceOperationId:source.record.operationId}))
            fail('UNAUTHORIZED','F09 dedup input differs from the original source operation');
        }else if(item.toolName==='decision.choose_candidate'&&['F09_N01','F09_N02','F09_N03'].includes(item.nodeId)) {
          if(item.nodeId!=='F09_N01')originalNode(graph,'F09_N01','feeds.collect');
          if(item.nodeId==='F09_N03')originalNode(graph,'F09_N02','workflow.host.f09_n02');
        }else fail('UNAUTHORIZED','F09 proposal is outside the original node tool');
        if(await options.assertFrontier({...scope,input:structuredClone(input),proposal:structuredClone(item),state:structuredClone(graph)})!==true)
          fail('UNAUTHORIZED','F09 frontier was not independently verified');active(scope);
      },
      authorizeReceipt:async({proposal:item,receipt,localTaskId})=>{
        if(item.nodeId==='F09_N01'&&item.toolName==='feeds.collect'&&receipt.state==='confirmed') {
          if(await options.authorizeSource({...scope,parentTaskId:scope.taskId,sourceTaskId:localTaskId,sourceOperationId:item.operationId,result:structuredClone(receipt.result)})!==true)
            fail('UNAUTHORIZED','F09 original feed source export was denied');active(scope);
        }
        if(await options.authorizeReceipt({...scope,inputRef,proposal:structuredClone(item),receipt:structuredClone(receipt),localTaskId})!==true)
          fail('UNAUTHORIZED','F09 exact receipt export was denied');active(scope);
      },
      validateSettled:()=>fail('UNSUPPORTED_CAPABILITY','F10 research enqueue and local completion evidence are unavailable')});
    const task=application.runtime.getTask(scope.taskId);
    if(task.state==='waiting_approval'||task.state==='waiting_reconciliation')return {state:task.state==='waiting_approval'?'pending':'unknown',
      result:null,evidenceRefs:[],selection:bound};
    fail('UNSUPPORTED_CAPABILITY','F10 research enqueue is unavailable');
  },assertReceiptAllowed:()=>{fail('UNAUTHORIZED','F09 has no verified local research enqueue receipt');}};
  return {...capability,describe:()=>({name:F09_WORKFLOW_WORKER_TOOL,version:F09_WORKFLOW_WORKER_VERSION,inputSchema:f09WorkflowWorkerInputSchema()}),
    isActive,pendingHostTask,assertResumeAllowed};
}
