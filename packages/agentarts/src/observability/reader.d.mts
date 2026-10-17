// Bounded read-only AgentArts observation GET. Host supplies transport and
// the per-request AK/SK authorization; this module performs no implicit I/O.
import type {InvocationIdentity, RunLogObservation, RunLogQuery, TraceObservation} from './index.d.mts';

/** Legacy trace summary kept for documented manual compatibility. */
export interface AgentArtsTraceSummary {
  readonly surface:'ShowOpsTrace'; readonly region:'cn-southwest-2'; readonly httpStatus:200;
  readonly total:number; readonly returnedSpanCount:number;
  readonly spans:readonly {readonly index:number; readonly durationMs:number|null; readonly tokens:number|null;
    readonly inputTokens:number|null; readonly outputTokens:number|null; readonly isError:boolean|null}[];
  readonly requestCorrelation:'not_checked'; readonly deploymentVersion:'not_checked'; readonly cost:'not_checked';
}

/** Envelope added by the timed surfaces. `querySha256` covers the actual URL. */
export type Timed<T> = T & {readonly httpStatus:200; readonly querySha256:string; readonly observedAt:string};

export interface ObservationReadOptions {
  /** Canonical absolute UTC deadline, at most long before overflow. */
  readonly deadline:string;
  /** Linked cancellation; abort races every stage, including the injected callback. */
  readonly signal:AbortSignal;
  /** Signs the frozen GET description once; credentials never enter this module. */
  readonly authorize:(request:Readonly<{url:string; method:'GET'; body:string;
    headers:Readonly<Record<string,string>>; deadline:string; signal:AbortSignal}>)=>Promise<Record<string,string>>;
  /** Optional injected transport; defaults to globalThis.fetch. */
  readonly fetchImpl?:(url:string, init:{method:'GET'; headers:Record<string,string>;
    signal:AbortSignal; redirect:'error'})=>Promise<Response>;
}

export declare function readAgentArtsTrace(options:ObservationReadOptions & {readonly traceId:string}):
  Promise<AgentArtsTraceSummary>;
export declare function readAgentArtsTraceObservation(options:ObservationReadOptions & {
  readonly traceId:string; readonly invocation?:Readonly<InvocationIdentity>}): Promise<Timed<TraceObservation>>;
export declare function readAgentArtsRunLogs(options:ObservationReadOptions & {readonly query:Readonly<RunLogQuery>}):
  Promise<Timed<RunLogObservation>>;
