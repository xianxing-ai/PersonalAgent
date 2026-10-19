import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {OwnedWorkflowAdvanceRequest,OwnedWorkflowAdvanceResult,OwnedWorkflowHostBridge,WorkflowReceipt} from '@personal-agent/agentarts';
import type {CoordinationAvailableTool} from '@personal-agent/coordination';
import type {WorkerContext,WorkerResult} from '../index.js';
import type {RuntimeApplication} from './runtime-application.js';

type Proposal=Extract<OwnedWorkflowAdvanceResult['proposals'][number],{kind:'tool_proposal'}>;
export interface RuntimeOwnedWorkflowDriverState<TInput=unknown> {
  version:1;sessionId:string;controlRevision:number;bindingId:string;sequence:number;
  input?:TInput;checkpoint?:string;result?:OwnedWorkflowAdvanceResult;receipts:WorkflowReceipt[];
  resolvedValues:Record<string,unknown>;pendingSend?:{requestId:string;digest:string};
  waiting?:{localTaskId:string;operationId:string};
  confirmedHost:Record<string,{localTaskId:string;operationId:string;result:unknown}>;
  evidenceRefs:string[];timings:{stage:string;startedAt:string;elapsedMs:number;nodeId?:string;operationId?:string}[];
}
/** Trusted composition only. Input must already have its exact export authorization.
 * Workflow identity, catalog and completion evidence are never chosen by model JSON. */
export interface RuntimeOwnedWorkflowDriverOptions<TInput> {
  workflowId:string;checkpointKey:string;mode:NonNullable<OwnedWorkflowAdvanceRequest['mode']>;
  image:{bindingId:string;advance(request:OwnedWorkflowAdvanceRequest):Promise<OwnedWorkflowAdvanceResult>};
  bridge:Pick<OwnedWorkflowHostBridge,'submit'|'readReceipt'>;catalog:readonly CoordinationAvailableTool[];
  requestId:(sequence:number)=>string;
  authorizeReceipt:(input:{proposal:Proposal;receipt:WorkflowReceipt;localTaskId:string;state:RuntimeOwnedWorkflowDriverState<TInput>})=>Promise<void>;
  /** Required local verification. Cloud state alone never completes the original task. */
  validateSettled:(state:RuntimeOwnedWorkflowDriverState<TInput>)=>WorkerResult|Promise<WorkerResult>;
  snapshot?:(state:RuntimeOwnedWorkflowDriverState<TInput>)=>OwnedWorkflowAdvanceRequest['snapshot'];
  stoppedReason?:(result:OwnedWorkflowAdvanceResult)=>string;
  progress?:(state:RuntimeOwnedWorkflowDriverState<TInput>)=>Parameters<WorkerContext['reportProgress']>[0];
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Extracted original F15 frontier consumer. Runs only inside the caller's existing Runtime worker. */
export async function runRuntimeOwnedWorkflowDriver<TInput>(application:RuntimeApplication,worker:WorkerContext,
  state:RuntimeOwnedWorkflowDriverState<TInput>,options:RuntimeOwnedWorkflowDriverOptions<TInput>):Promise<WorkerResult> {
  if(state.version!==1||state.bindingId!==options.image.bindingId||state.input===undefined)
    throw new ProtocolError('REVISION_CONFLICT','Original workflow input or deployment changed');
  const binding={taskId:worker.taskId,workflowId:options.workflowId,mode:options.mode,sessionId:state.sessionId,
    deadline:worker.deadline,imageBinding:options.image.bindingId,inputDigest:hash(state.input),catalogDigest:hash(options.catalog)};
  const bindingKey=options.checkpointKey+':driver-binding';
  application.runtime.saveCheckpointOnce(worker.taskId,bindingKey,binding);
  if(!isDeepStrictEqual(worker.loadCheckpoint(bindingKey),binding))
    throw new ProtocolError('REVISION_CONFLICT','Original workflow input, lifetime or catalog changed');
  const save=()=>worker.saveCheckpoint(options.checkpointKey,state);
  const active=()=>{if(worker.signal.aborted||application.runtime.getTask(worker.taskId).cancelRequested)
    throw new ProtocolError('CANCELLED','Original graph was cancelled');
    if(!Number.isFinite(Date.parse(worker.deadline))||Date.now()>=Date.parse(worker.deadline))
      throw new ProtocolError('TIMEOUT','Original graph deadline expired');};
  const timed=async<T>(stage:string,work:()=>Promise<T>,extra:{nodeId?:string;operationId?:string}={}):Promise<T>=>{
    const begin=Date.now();try{return await work();}finally{state.timings.push({stage,startedAt:new Date(begin).toISOString(),elapsedMs:Date.now()-begin,...extra});save();}};
  const pause=(localTaskId:string,operationId:string):WorkerResult=>{
    const local=application.runtime.getTask(localTaskId);state.waiting={localTaskId,operationId};save();
    if(application.runtime.getTask(worker.taskId).state==='running')
      application.runtime.transitionTask(worker.taskId,local.state==='waiting_approval'?'waiting_approval':'waiting_reconciliation');
    return {resultSummary:options.workflowId+' waits for its original operation; unknown writes were not repeated',evidenceRefs:[]};};
  for(;;) {
    active();
    const binding={taskId:worker.taskId,sessionId:state.sessionId,workflowId:options.workflowId,controlRevision:state.controlRevision,deadline:worker.deadline,taskDeadline:worker.deadline};
    const proposals=state.result?.proposals??[];
    state.receipts=[];
    for(const proposal of proposals) {
      if(proposal.kind!=='tool_proposal')throw new ProtocolError('UNSUPPORTED_CAPABILITY','Graph requires a registered host adapter');
      if(!options.catalog.some(tool=>tool.name===proposal.toolName&&tool.version===proposal.toolVersion))
        throw new ProtocolError('UNAUTHORIZED','Graph requested a tool outside its original published catalog');
      const local=options.bridge.submit(binding,proposal);
      // The child may finish asynchronously; wait only for the original registered worker, never replay it.
      const cancelChild=()=>{try{application.runtime.requestCancel(local.localTaskId,'Original graph was cancelled');}catch{/* Original terminal child is retained. */}};
      worker.signal.addEventListener('abort',cancelChild,{once:true});
      try {if(worker.signal.aborted)cancelChild();await application.waitForHostToolTask(local.localTaskId);active();}
      finally {worker.signal.removeEventListener('abort',cancelChild);}
      const receipt=await timed('host-readback',async()=>options.bridge.readReceipt(binding,proposal),{nodeId:proposal.nodeId,operationId:proposal.operationId});
      if(!receipt||receipt.state==='stopping'||receipt.state==='unknown')return pause(local.localTaskId,proposal.operationId);
      if(receipt.state==='confirmed')state.confirmedHost[proposal.toolName]={localTaskId:local.localTaskId,operationId:proposal.operationId,result:structuredClone(receipt.result)};
      await options.authorizeReceipt({proposal,receipt,localTaskId:local.localTaskId,state});active();
      state.evidenceRefs=[...new Set([...state.evidenceRefs,...receipt.evidenceRefs])];
      state.receipts.push(receipt);delete state.waiting;save();
    }
    if(state.result?.state==='settled')return options.validateSettled(state);
    if(state.result&&['failed','unavailable','cancelled','unknown','paused','awaiting_user','awaiting_controller'].includes(state.result.state)) {
      if(state.result.state==='unknown'){application.runtime.transitionTask(worker.taskId,'waiting_reconciliation');return {resultSummary:options.workflowId+' original result is unknown; not repeated',evidenceRefs:[]};}
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Graph stopped: '+state.result.state+' '+(options.stoppedReason?.(state.result)??''));
    }
    if(state.pendingSend) {application.runtime.transitionTask(worker.taskId,'waiting_reconciliation');return {resultSummary:options.workflowId+' original send is unknown; not repeated',evidenceRefs:[]};}
    const envelope:OwnedWorkflowAdvanceRequest={...binding,requestId:options.requestId(state.sequence),input:state.input,
      signal:worker.signal,availableTools:options.catalog,mode:options.mode,...(state.checkpoint?{checkpoint:state.checkpoint}:{}),
      receipts:state.receipts,resolvedValues:state.resolvedValues};
    const snapshot=options.snapshot?.(state);if(snapshot)envelope.snapshot=snapshot;
    state.pendingSend={requestId:envelope.requestId,digest:hash({...envelope,signal:undefined})};save();
    const result=await timed('image-advance',()=>options.image.advance(envelope));active();
    if(result.workflowId!==options.workflowId||result.workflowVersion!=='1.0.0'||!result.checkpoint||!Array.isArray(result.proposals)||!plain(result.nodes))
      throw new ProtocolError('PROTOCOL_MISMATCH','Invalid original image graph result');
    state.result=structuredClone(result);state.checkpoint=result.checkpoint;state.sequence++;delete state.pendingSend;save();
    worker.reportProgress(options.progress?.(state)??{stepId:options.workflowId+'-'+state.sequence,label:options.workflowId+' '+result.state});
  }
}
