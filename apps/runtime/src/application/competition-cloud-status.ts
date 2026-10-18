import {ProtocolError} from '@personal-agent/contracts';
import {AGENTARTS_TRANSPORT_VERSION, parseAgentArtsTransportFrame} from '@personal-agent/contracts/agentarts-transport';
import type {AgentArtsTransportFrame} from '@personal-agent/contracts/agentarts-transport';
import type {AgentArtsCloudAgentPort, AgentArtsUnknownReceipt} from '@personal-agent/coordination';
import {isDeepStrictEqual} from 'node:util';
import type {TaskRuntime} from '../index.js';

const BINDING = 'competition-cloud-dispatch-binding';
const OBSERVATION = 'competition-cloud-status-observation';
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

/** Saved only by the trusted dispatch callback, with no credentials, endpoint or body. */
export function recordCompetitionCloudStatusBinding(runtime:TaskRuntime,taskId:string,
  configurationRef:string,receipt:AgentArtsUnknownReceipt):void {
  runtime.saveCheckpoint(taskId,BINDING,{bindingVersion:'1.0',configurationRef,invocation:identity(receiptSnapshot(receipt))});
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
      return {inflight,unknown,binding,saved};
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
