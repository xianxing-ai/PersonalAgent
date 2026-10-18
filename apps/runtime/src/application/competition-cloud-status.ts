import {ProtocolError} from '@personal-agent/contracts';
import {AGENTARTS_TRANSPORT_VERSION, parseAgentArtsTransportFrame} from '@personal-agent/contracts/agentarts-transport';
import type {AgentArtsTransportFrame} from '@personal-agent/contracts/agentarts-transport';
import {parseCoordinationAvailableTools, parseCoordinationContinuation} from '@personal-agent/coordination';
import type {AgentArtsCloudAgentPort, AgentArtsUnknownReceipt, CoordinationRequest} from '@personal-agent/coordination';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {TaskRuntime} from '../index.js';

const BINDING = 'competition-cloud-dispatch-binding';
const OBSERVATION = 'competition-cloud-status-observation';
const CONTEXT = 'competition-cloud-dispatch-context';
type Status = Extract<AgentArtsTransportFrame, {type:'status'; serverInstanceId:string}>;
type StatusMetadata = Exclude<Status, {state:'completed'}> | Omit<Extract<Status, {state:'completed'}>, 'events'>;

export interface CompetitionCloudStatusScope {expectedRevision:number; deadline:string; signal:AbortSignal;}
/** Host-only metadata. No events, model content, task completion or execution authority. */
export type CompetitionCloudStatusObservation = StatusMetadata & {
  observationVersion:'1.0'; taskId:string; taskRevision:number; configurationRef:string;
  observedAt:string; verification:'unverified';
};

function identity(receipt:AgentArtsUnknownReceipt) {
  return {sessionId:receipt.sessionId,requestId:receipt.requestId,idempotencyKey:receipt.idempotencyKey,
    payloadDigest:receipt.payloadDigest,...(receipt.serverInstanceId===undefined?{}:{serverInstanceId:receipt.serverInstanceId})};
}

function receiptSnapshot(value:unknown):AgentArtsUnknownReceipt {
  try {
    if (!value || typeof value!=='object' || Array.isArray(value)) throw Error();
    const receipt=value as AgentArtsUnknownReceipt;
    if(typeof receipt.accepted!=='boolean')throw Error();
    const snapshot={...identity(receipt),accepted:receipt.accepted};
    const {serverInstanceId,...correlation}=identity(snapshot);
    const frame={protocolVersion:AGENTARTS_TRANSPORT_VERSION,type:'status',...correlation};
    parseAgentArtsTransportFrame(frame);
    if(serverInstanceId!==undefined)parseAgentArtsTransportFrame({...frame,serverInstanceId,state:'unknown'});
    return Object.freeze(snapshot);
  } catch {throw new ProtocolError('RESULT_UNKNOWN','Stored cloud invocation identity is invalid');}
}

function digest(value:unknown):string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function object(value:unknown):Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value))throw Error();
  return value as Record<string,unknown>;
}

/** References and digests only: never copy goal, tool arguments or continuation bodies. */
function dispatchFacts(runtime:TaskRuntime,taskId:string,phase:'initial'|'continuation',revision:number,deadline:string) {
  const loopValue=runtime.loadCheckpoint(taskId,'competition-loop');
  const loop=loopValue===undefined?undefined:object(loopValue);
  const maxSteps=runtime.loadCheckpoint(taskId,'competition-max-steps');
  if(!Number.isSafeInteger(maxSteps) || (maxSteps as number)<1)throw Error();
  const step=loop?.step??1;
  if(!Number.isSafeInteger(step) || (step as number)<1 || (step as number)>(maxSteps as number)
    || (phase==='initial'?loop!==undefined:!loop || (step as number)<2 || loop.pending!==undefined))throw Error();
  const catalogValue=runtime.loadCheckpoint(taskId,'competition-tool-catalog');
  let catalog=null;
  if(catalogValue!==undefined) {
    const stored=object(catalogValue);
    if(!Number.isSafeInteger(stored.revision) || (stored.revision as number)<0
      || (stored.revision as number)>revision || stored.deadline!==deadline
      || (phase==='initial' && stored.revision!==revision))throw Error();
    const entries=parseCoordinationAvailableTools(stored.entries);
    catalog={checkpointRef:'competition-tool-catalog',revision:stored.revision as number,
      deadline,entriesDigest:digest(entries)};
  }
  let continuation=null;
  if(phase==='continuation') {
    const value=parseCoordinationContinuation(loop!.continuation);
    if(!Array.isArray(loop!.receipts))throw Error();
    const matches=loop!.receipts.map((item,index)=>({receipt:object(item),index}))
      .filter(item=>object(item.receipt.proposal).proposalId===value.proposalId);
    if(matches.length!==1 || !isDeepStrictEqual(matches[0]!.receipt.continuation,value))throw Error();
    continuation={checkpointRef:'competition-loop',proposalId:value.proposalId,state:value.state,
      continuationDigest:digest(value),receiptIndex:matches[0]!.index,receiptDigest:digest(matches[0]!.receipt)};
  }
  return {loop:{checkpointRef:'competition-loop',checkpointDigest:loopValue===undefined?null:digest(loopValue),
    step:step as number,maxSteps:maxSteps as number},catalog,continuation};
}

function dispatchContext(runtime:TaskRuntime,taskId:string,configurationRef:string,receipt:AgentArtsUnknownReceipt,
  phase:'initial'|'continuation',revision:number,deadline:string,capturedAt:string) {
  if(!Number.isSafeInteger(revision) || revision<0 || revision>runtime.getTask(taskId).revision
    || runtime.loadCheckpoint(taskId,'application-profile')!=='huawei_ict_agentarts'
    || runtime.loadCheckpoint(taskId,'application-deadline')!==deadline
    || !Number.isFinite(Date.parse(deadline)) || !Number.isFinite(Date.parse(capturedAt)))throw Error();
  return {snapshotVersion:'1.0',taskId,configurationRef,invocation:identity(receipt),
    request:{phase,revision,deadline},...dispatchFacts(runtime,taskId,phase,revision,deadline),capturedAt,
    // No general, durable public-input provenance contract exists for this path.
    // A missing privacy marker or an unchanged goal is not permission to recover.
    privacyEligibility:{eligible:false,reason:'public-provenance-unavailable'},recovery:'unavailable'};
}

function readDispatchContext(runtime:TaskRuntime,taskId:string,configurationRef:string,receipt:AgentArtsUnknownReceipt) {
  const value=runtime.loadCheckpoint(taskId,CONTEXT);
  // Legacy status diagnostics remain readable; no context is invented for recovery.
  if(value===undefined)return undefined;
  try {
    const saved=object(value),request=object(saved.request);
    if(!['initial','continuation'].includes(request.phase as string)
      || typeof request.deadline!=='string' || typeof saved.capturedAt!=='string')throw Error();
    const expected=dispatchContext(runtime,taskId,configurationRef,receipt,request.phase as 'initial'|'continuation',
      request.revision as number,request.deadline,saved.capturedAt);
    if(!isDeepStrictEqual(value,expected))throw Error();
    return expected;
  } catch {throw new ProtocolError('RESULT_UNKNOWN','Original cloud dispatch context is missing or changed');}
}

/** Saved only by the trusted dispatch callback, with no credentials, endpoint or body. */
export function recordCompetitionCloudStatusBinding(runtime:TaskRuntime,taskId:string,
  configurationRef:string,receipt:AgentArtsUnknownReceipt,request:CoordinationRequest):void {
  const saved=receiptSnapshot(receipt);
  let context;
  try {
    const task=runtime.getTask(taskId);
    if(request.taskId!==taskId || task.state!=='running' || task.cancelRequested || task.revision!==request.revision
      || request.signal.aborted || Date.now()>=Date.parse(request.deadline)
      || runtime.loadCheckpoint(taskId,'private-copy-erasure')!==undefined)throw Error();
    const phase=request.continuation===undefined?'initial':'continuation';
    context=dispatchContext(runtime,taskId,configurationRef,saved,phase,request.revision,request.deadline,new Date().toISOString());
    if(phase==='initial') {
      const catalog=runtime.loadCheckpoint(taskId,'competition-tool-catalog');
      if(!isDeepStrictEqual(request.availableTools,catalog===undefined?undefined:object(catalog).entries))throw Error();
    } else if(request.availableTools!==undefined
      || !isDeepStrictEqual(request.continuation,object(runtime.loadCheckpoint(taskId,'competition-loop')).continuation))throw Error();
  } catch {throw new ProtocolError('RESULT_UNKNOWN','Cloud send context is not bound to the original task');}
  runtime.saveCheckpoint(taskId,BINDING,{bindingVersion:'1.0',configurationRef,invocation:identity(saved)});
  runtime.saveCheckpoint(taskId,CONTEXT,context);
}

/** Reads the original cloud status without consuming its result or clearing the send hold. */
export class CompetitionCloudStatusReader {
  private readonly active=new Map<string,AbortController>();
  private closed=false;
  constructor(private readonly runtime:TaskRuntime,private readonly configurationRef:string,
    private readonly cloud:Pick<AgentArtsCloudAgentPort,'queryStatus'>,private readonly enabled:boolean) {}

  async query(taskId:string,input:CompetitionCloudStatusScope):Promise<CompetitionCloudStatusObservation> {
    if(this.closed || !this.enabled)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Competition WSS status reader is unavailable');
    let scope:CompetitionCloudStatusScope,deadlineMs:number;
    try {
      scope={expectedRevision:input.expectedRevision,deadline:input.deadline,signal:input.signal};
      deadlineMs=Date.parse(scope.deadline);
      if(typeof taskId!=='string' || !taskId || !(scope.signal instanceof AbortSignal)
        || !Number.isSafeInteger(scope.expectedRevision) || scope.expectedRevision<0
        || typeof scope.deadline!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(scope.deadline)
        || !Number.isFinite(deadlineMs)
        || scope.deadline.replace('.000Z','Z')!==new Date(deadlineMs).toISOString().replace('.000Z','Z'))throw Error();
    } catch {throw new ProtocolError('INVALID_ARGUMENT','Invalid Competition status query scope');}
    const controller=new AbortController();
    const abort=():void=>controller.abort();
    const checkControl=():void=>{
      if(this.closed || controller.signal.aborted || scope.signal.aborted)throw new ProtocolError('CANCELLED','Competition status query cancelled');
      if(Date.now()>=deadlineMs)throw new ProtocolError('TIMEOUT','Competition status query expired');
    };
    const read=()=>{
      checkControl();
      const task=this.runtime.getTask(taskId);
      if(task.state!=='waiting_reconciliation' || task.revision!==scope.expectedRevision) {
        throw new ProtocolError('REVISION_CONFLICT','Original Competition task is not awaiting this status query');
      }
      if(this.runtime.loadCheckpoint(taskId,'application-profile')!=='huawei_ict_agentarts'
        || this.runtime.loadCheckpoint(taskId,'private-copy-erasure')!==undefined) {
        throw new ProtocolError('UNAUTHORIZED','Original Competition status scope is unavailable');
      }
      const inflight=this.runtime.loadCheckpoint(taskId,'competition-cloud-inflight');
      const unknown=this.runtime.loadCheckpoint(taskId,'competition-cloud-unknown');
      const original=receiptSnapshot(inflight),saved=unknown!==undefined && unknown!==null?receiptSnapshot(unknown):original;
      if(!isDeepStrictEqual(identity(original),identity(saved))) {
        throw new ProtocolError('RESULT_UNKNOWN','Stored cloud receipts disagree');
      }
      const binding=this.runtime.loadCheckpoint(taskId,BINDING);
      if(!isDeepStrictEqual(binding,{bindingVersion:'1.0',configurationRef:this.configurationRef,invocation:identity(original)})) {
        throw new ProtocolError('UNAUTHORIZED','Original cloud deployment binding is missing or changed');
      }
      const context=readDispatchContext(this.runtime,taskId,this.configurationRef,saved);
      return {inflight,unknown,binding,saved,context};
    };
    const before=read();
    if(this.active.has(taskId))throw new ProtocolError('REVISION_CONFLICT','A status query is already active for this task');
    this.active.set(taskId,controller);
    scope.signal.addEventListener('abort',abort,{once:true});
    try {
      checkControl();
      const response=await this.cloud.queryStatus(before.saved,{deadline:scope.deadline,signal:controller.signal});
      if(!isDeepStrictEqual(read(),before))throw new ProtocolError('REVISION_CONFLICT','Original cloud status binding changed during lookup');
      const frame=parseAgentArtsTransportFrame(response);
      if(frame.type!=='status' || !('state' in frame)
        || frame.sessionId!==before.saved.sessionId || frame.requestId!==before.saved.requestId
        || frame.idempotencyKey!==before.saved.idempotencyKey || frame.payloadDigest!==before.saved.payloadDigest
        || (frame.serverInstanceId!==before.saved.serverInstanceId && frame.state!=='unknown')) {
        throw new ProtocolError('RESULT_UNKNOWN','Cloud status does not match the original invocation');
      }
      // Explicit projection: never spread cloud events or retain their model content.
      const observation:CompetitionCloudStatusObservation={protocolVersion:frame.protocolVersion,type:'status',
        sessionId:frame.sessionId,requestId:frame.requestId,idempotencyKey:frame.idempotencyKey,
        payloadDigest:frame.payloadDigest,serverInstanceId:frame.serverInstanceId,state:frame.state,
        ...('code' in frame?{code:frame.code}:{}),observationVersion:'1.0',taskId,taskRevision:scope.expectedRevision,
        configurationRef:this.configurationRef,observedAt:new Date().toISOString(),verification:'unverified'} as CompetitionCloudStatusObservation;
      this.runtime.saveCheckpoint(taskId,OBSERVATION,observation);
      return Object.freeze(observation);
    } finally {
      scope.signal.removeEventListener('abort',abort);
      this.active.delete(taskId);
    }
  }

  close():void {
    this.closed=true;
    for(const controller of this.active.values())controller.abort();
  }
}
