/** Host supplied snapshot of the actual HTTP InvokeRuntime request. */
export interface InvocationIdentity {readonly requestId:string; readonly sessionId:string; readonly resourceId:string}
export interface RunLogQuery {readonly agentRunId:string; readonly startTime:string; readonly endTime:string; readonly limit:number}
export interface TraceSpanObservation {
  readonly index:number; readonly spanRef:string|null; readonly parentSpanRef:string|null;
  readonly sessionRef:string|null; readonly resourceRef:string|null; readonly startTimeMs:number|null;
  readonly durationMs:number|null; readonly tokens:number|null; readonly inputTokens:number|null;
  readonly outputTokens:number|null; readonly isError:boolean|null;
}
export interface TraceObservation {
  readonly formatVersion:'1.0.0'; readonly surface:'ShowOpsTrace'; readonly region:'cn-southwest-2';
  readonly traceRef:string; readonly total:number; readonly returnedSpanCount:number;
  readonly coverage:'complete'|'partial'; readonly spans:readonly TraceSpanObservation[];
  readonly requestCorrelation:{readonly status:'not_checked'|'mismatch'|'unknown'|'exact_id_match';
    readonly basis:'trace_id+session_id+resource_id'; readonly scope:'returned_spans';
    readonly snapshotTrust:'caller_supplied'; readonly requestRef:string|null};
  readonly deploymentVersion:'unavailable'; readonly cost:'unavailable'; readonly usageAggregation:'not_performed';
}
export interface RunLogObservation {
  readonly formatVersion:'1.0.0'; readonly surface:'ListOpsAgentRunLog'; readonly region:'cn-southwest-2';
  readonly count:number; readonly returnedLogCount:number; readonly queryComplete:boolean; readonly hasContinuation:boolean;
  readonly logs:readonly {readonly index:number;readonly lineRef:string;readonly contentSha256:string;
    readonly contentBytes:number;readonly labelCount:number}[];
  readonly requestCorrelation:'not_checked'; readonly deploymentVersion:'unavailable'; readonly cost:'unavailable';
}
export function validateInvocationIdentity(value:unknown):Readonly<InvocationIdentity>;
export function buildRunLogPath(value:RunLogQuery):string;
export function projectTraceObservation(body:unknown, traceId:string, invocation?:InvocationIdentity):TraceObservation;
export function projectRunLogObservation(body:unknown):RunLogObservation;
