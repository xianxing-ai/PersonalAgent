// Production consumption side of the AgentArts request observation loop.
// Reads platform trace/log projections through the public bounded reader,
// binds results to the originally dispatched task/request identity and stores
// metadata Evidence on the existing trusted-readback path. It never changes a
// task's execution state and never infers a runtime version or business success.
import {ProtocolError, validateContract} from '@personal-agent/contracts';
import type {ProtocolContracts} from '@personal-agent/contracts';
import {createHash} from 'node:crypto';
import {readAgentArtsRunLogs, readAgentArtsTraceObservation} from '@personal-agent/agentarts/observability/reader';
import {readCompetitionCloudRequestIdentity, type CompetitionCloudRequestIdentities,
  type CompetitionCloudRequestIdentityRecord} from './coordination.js';
import type {TaskRuntime} from '../index.js';

type Evidence = ProtocolContracts['evidence'];
type TraceObservation = Awaited<ReturnType<typeof readAgentArtsTraceObservation>>;
type RunLogObservation = Awaited<ReturnType<typeof readAgentArtsRunLogs>>;

/** Frozen GET description the per-request authorization callback must sign. */
export interface AgentArtsObservationRequestDescription {
  readonly url: string;
  readonly method: 'GET';
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly deadline: string;
  readonly signal: AbortSignal;
}

/** Trusted host capability; real platform observation needs an AK/SK signer,
 * never the invocation Bearer. An absent capability stays explicitly unavailable. */
export interface AgentArtsObservationAuthorization {
  authorize(request: AgentArtsObservationRequestDescription): Promise<Record<string, string>>;
}

/** Injected transport for offline and directed consumers; defaults to globalThis.fetch. */
export type AgentArtsObservationFetch = (url: string, init: {method: 'GET';
  headers: Record<string, string>; signal: AbortSignal; redirect: 'error'}) => Promise<Response>;

export type AgentArtsObservationSurface = 'trace' | 'agent_run_log';

export interface AgentArtsObservationInput {
  taskId: string;
  surface: AgentArtsObservationSurface;
  /** Bind a specific recorded send attempt; default binds the newest recorded one. */
  revision?: number;
  /** Trace only. Defaults to the bound request id: the actual X-Request-Id, defined
   * by InvokeRuntime as this request's call-chain identifier. */
  traceId?: string;
  /** Agent-run log only. Must come from a platform run record; never guessed from
   * runtimeId, sessionId or traceId. A missing value stays explicitly unknown. */
  agentRunId?: string;
  /** Agent-run log only; 13-digit millisecond epoch window with 1..1000 limit. */
  window?: {startMs: number; endMs: number; limit: number};
  deadline: string;
  signal: AbortSignal;
}

export interface AgentArtsObservationBinding {
  readonly revision: number;
  readonly sessionId: string;
  readonly requestId: string;
  readonly payloadDigest: string;
  readonly recordedAt: string;
  readonly attempts: number;
  /** True when the same request id carried two different payloads. */
  readonly identityConflict: boolean;
}

export type AgentArtsObservationAvailability =
  | 'observed'
  /** The composition has no trusted observation authorization. */
  | 'unavailable'
  /** No platform request identity for this task/revision; nothing was fabricated. */
  | 'unknown_request';

export interface AgentArtsPlatformObservationRecord {
  readonly surface: AgentArtsObservationSurface;
  readonly taskId: string;
  /** Configured invocation target only; never a verified runtime version. */
  readonly runtimeName: string;
  readonly availability: AgentArtsObservationAvailability;
  readonly reason?: 'missing_request_identity' | 'missing_revision_identity' | 'missing_agent_run_identity'
    | 'missing_observation_window' | 'observation_authorization_unavailable' | 'identity_conflict';
  readonly binding?: AgentArtsObservationBinding;
  /** Officially documented fact: a request-level deployment version is not available. */
  readonly deploymentVersion: 'unavailable';
  /** Present only after an actual successful platform read. */
  readonly observation?: TraceObservation | RunLogObservation;
  /** Present when the observed record is durably bound as Evidence. */
  readonly evidenceRef?: string;
}

const TRACE_SOURCE_REF = 'agentarts:ShowOpsTrace';
const LOG_SOURCE_REF = 'agentarts:ListOpsAgentRunLog';

/** Run references stored in the metadata snapshot stay digest-only. */
function shaRef(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value;
}

function boundedTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseInput(value: unknown): AgentArtsObservationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Observation input must be an object');
  }
  // Keep one invocation's task, scope and cancellation binding across all awaited stages.
  // The caller still owns the input object and may reuse or edit it while the read is pending.
  const input = {...value as AgentArtsObservationInput};
  if (input.window !== undefined) input.window = {...input.window};
  const fields = new Set(['taskId', 'surface', 'revision', 'traceId', 'agentRunId', 'window', 'deadline', 'signal']);
  if (Object.keys(input).some(key => !fields.has(key)) || !boundedText(input.taskId, 256)
    || !(input.signal instanceof AbortSignal) || !boundedTimestamp(input.deadline)
    || Date.parse(input.deadline) <= Date.now() || Date.parse(input.deadline) - Date.now() > 2_147_483_647
    || !(input.surface === 'trace' || input.surface === 'agent_run_log')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Observation input is invalid');
  }
  if ((input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision < 0))
    || (input.traceId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(input.traceId))
    || (input.agentRunId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(input.agentRunId))) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Observation input is invalid');
  }
  if (input.window !== undefined) {
    const {startMs, endMs, limit} = input.window;
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs > endMs
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000
      || !/^\d{13}$/.test(String(startMs)) || !/^\d{13}$/.test(String(endMs))) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Observation input is invalid');
    }
  }
  return input;
}

function bindingFor(record: CompetitionCloudRequestIdentityRecord,
  identities: CompetitionCloudRequestIdentities): AgentArtsObservationBinding {
  return Object.freeze({
    revision: record.revision, sessionId: record.sessionId, requestId: record.requestId,
    payloadDigest: record.payloadDigest, recordedAt: record.recordedAt, attempts: record.attempts,
    identityConflict: identities.conflicts.includes(record.requestId),
  });
}

function evidenceSummary(surface: AgentArtsObservationSurface, observation: TraceObservation | RunLogObservation): string {
  // Statuses and counts only: platform read-backs never carry identifiers,
  // private content or any business-success or deployment-version claim.
  if (surface === 'trace') {
    const trace = observation as TraceObservation;
    return `AgentArts platform trace observation; correlation=${trace.requestCorrelation.status};` +
      ` coverage=${trace.coverage}; spans=${trace.returnedSpanCount}/${trace.total}; cost=unavailable`;
  }
  const logs = observation as RunLogObservation;
  return `AgentArts platform agent-run log observation; correlation=not_checked;` +
    ` logs=${logs.returnedLogCount}/${logs.count}; queryComplete=${logs.queryComplete};` +
    ` continuation=${logs.hasContinuation}; cost=unavailable`;
}

function evidenceIdentifier(input: {taskId: string; surface: AgentArtsObservationSurface; querySha256: string;
  runRef: string}): string {
  const digest = createHash('sha256').update(JSON.stringify({
    taskId: input.taskId, surface: input.surface, querySha256: input.querySha256, runRef: input.runRef,
  }), 'utf8').digest('hex').slice(0, 32);
  return `agentarts-observation-${input.surface === 'trace' ? 'trace' : 'log'}-${digest}`;
}

export interface AgentArtsObservationHostOptions {
  runtime: TaskRuntime;
  /** Configured invocation target recorded with every bound read. */
  runtimeName: string;
  authorization?: AgentArtsObservationAuthorization;
  fetchImpl?: AgentArtsObservationFetch;
  /** Platform application id (resource_id) enabling exact identity comparison. */
  applicationId?: string;
}

export function createAgentArtsObservationHost(options: AgentArtsObservationHostOptions): {
  read(input: AgentArtsObservationInput): Promise<AgentArtsPlatformObservationRecord>;
} {
  const {runtime, runtimeName, authorization, fetchImpl, applicationId} = options;
  if (typeof runtimeName !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(runtimeName)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Observation host runtime target is invalid');
  }
  if (authorization !== undefined && typeof authorization.authorize !== 'function') {
    throw new ProtocolError('INVALID_ARGUMENT', 'Observation host authorization is invalid');
  }
  if (fetchImpl !== undefined && typeof fetchImpl !== 'function') {
    throw new ProtocolError('INVALID_ARGUMENT', 'Observation host transport is invalid');
  }
  if (applicationId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(applicationId)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Observation host application id is invalid');
  }

  function assertReadCurrent(input: AgentArtsObservationInput, binding?: AgentArtsObservationBinding): void {
    if (input.signal.aborted) throw new ProtocolError('CANCELLED', 'Observation read cancelled');
    if (Date.now() >= Date.parse(input.deadline)) throw new ProtocolError('TIMEOUT', 'Observation read expired');
    if (runtime.loadCheckpoint(input.taskId, 'private-copy-erasure') !== undefined) {
      throw new ProtocolError('UNAUTHORIZED', 'Observation task copies are withheld');
    }
    if (binding === undefined) return;
    const current = readCompetitionCloudRequestIdentity(runtime, input.taskId).identities;
    if (current.conflicts.includes(binding.requestId) || !current.requests.some(record =>
      record.revision === binding.revision && record.requestId === binding.requestId
      && record.sessionId === binding.sessionId && record.payloadDigest === binding.payloadDigest
      && record.recordedAt === binding.recordedAt)) {
      throw new ProtocolError('REVISION_CONFLICT', 'Observation request identity changed');
    }
  }

  async function guardedRead<T>(input: AgentArtsObservationInput,
    binding: AgentArtsObservationBinding | undefined,
    read: (options: {authorize: AgentArtsObservationAuthorization['authorize'];
      fetchImpl: AgentArtsObservationFetch}) => Promise<T>): Promise<T> {
    assertReadCurrent(input, binding);
    try {
      return await read({
        authorize: async request => {
          assertReadCurrent(input, binding);
          if (authorization === undefined) throw new ProtocolError('UNAUTHORIZED', 'Observation authorization is unavailable');
          const headers = await authorization.authorize(request);
          assertReadCurrent(input, binding);
          return headers;
        },
        fetchImpl: (url, init) => {
          // Signers and the reader await between stages; check again on the actual send stack.
          assertReadCurrent(input, binding);
          return (fetchImpl ?? globalThis.fetch)(url, init);
        },
      });
    } catch (error) {
      // The bounded reader redacts foreign exceptions. Preserve our current binding failure
      // without exposing signer/provider errors when an awaited stage invalidated the read.
      assertReadCurrent(input, binding);
      throw error;
    }
  }

  async function read(original: unknown): Promise<AgentArtsPlatformObservationRecord> {
    const input = parseInput(original);
    runtime.getTask(input.taskId);
    const base = {surface: input.surface, taskId: input.taskId, runtimeName,
      deploymentVersion: 'unavailable' as const};
    if (authorization === undefined) {
      return {...base, availability: 'unavailable' as const, reason: 'observation_authorization_unavailable'};
    }
    assertReadCurrent(input);
    if (input.surface === 'agent_run_log') {
      // A scoped log query needs a platform agent-run identity and window; both stay unknown, never guessed.
      if (input.agentRunId === undefined) {
        return {...base, availability: 'unknown_request' as const, reason: 'missing_agent_run_identity'};
      }
      if (input.window === undefined) {
        return {...base, availability: 'unknown_request' as const, reason: 'missing_observation_window'};
      }
      const {agentRunId, window} = input;
      const observation = await guardedRead(input, undefined, options => readAgentArtsRunLogs({
        deadline: input.deadline, signal: input.signal, ...options,
        query: {agentRunId, startTime: String(window.startMs),
          endTime: String(window.endMs), limit: window.limit},
      }));
      return completeRead({
        input, observation,
        runRef: input.agentRunId,
        sourceRef: LOG_SOURCE_REF,
        snapshot: {agentRunRef: shaRef(input.agentRunId), windowMs: {
          start: input.window.startMs, end: input.window.endMs, limit: input.window.limit}},
      });
    }
    const selection = readCompetitionCloudRequestIdentity(runtime, input.taskId,
      input.revision === undefined ? {} : {revision: input.revision});
    if (selection.bound === undefined) {
      return {...base, availability: 'unknown_request' as const,
        reason: input.revision === undefined ? 'missing_request_identity' : 'missing_revision_identity'};
    }
    const binding = bindingFor(selection.bound, selection.identities);
    if (binding.identityConflict) {
      return {...base, availability: 'unknown_request' as const, reason: 'identity_conflict', binding};
    }
    if (applicationId === undefined) {
      // Without the platform application id the exact join cannot be checked; the read proceeds
      // and stays `not_checked` instead of fabricating a request correlation.
      const observation = await guardedRead(input, binding, options => readAgentArtsTraceObservation({
        deadline: input.deadline, signal: input.signal, ...options,
        traceId: input.traceId ?? binding.requestId,
      }));
      return completeRead({input, observation, binding,
        runRef: binding.requestId, sourceRef: TRACE_SOURCE_REF,
        snapshot: {traceRef: shaRef(input.traceId ?? binding.requestId)}});
    }
    const observation = await guardedRead(input, binding, options => readAgentArtsTraceObservation({
      deadline: input.deadline, signal: input.signal, ...options,
      traceId: input.traceId ?? binding.requestId,
      invocation: {requestId: binding.requestId, sessionId: binding.sessionId, resourceId: applicationId},
    }));
    return completeRead({input, observation, binding,
      runRef: binding.requestId, sourceRef: TRACE_SOURCE_REF,
      snapshot: {traceRef: shaRef(input.traceId ?? binding.requestId)}});
  }

  function completeRead(context: {input: AgentArtsObservationInput;
    observation: TraceObservation | RunLogObservation;
    binding?: AgentArtsObservationBinding;
    runRef: string; sourceRef: string; snapshot: Record<string, unknown>}): AgentArtsPlatformObservationRecord {
    const {input, observation, binding, runRef, sourceRef, snapshot} = context;
    const base = {surface: input.surface, taskId: input.taskId, runtimeName,
      deploymentVersion: 'unavailable' as const};
    const timed = observation as {querySha256: string; observedAt: string};
    const evidenceRef = evidenceIdentifier({taskId: input.taskId, surface: input.surface,
      querySha256: timed.querySha256, runRef});
    const evidence: Evidence = {
      evidenceId: evidenceRef, kind: 'observation', sourceRef,
      capturedAt: timed.observedAt, summary: evidenceSummary(input.surface, observation),
      verification: 'conditional', sensitivity: 'internal',
    };
    validateContract('evidence', evidence);
    // Recheck after the asynchronous read, before either synchronous checkpoint write.
    // In particular, never restore an identity removed by private-copy erasure.
    assertReadCurrent(input, binding);
    // The deterministic evidence id overwrites the same binding re-read; platform observations
    // update the record instead of stacking unrepeatable rows onto a task.
    runtime.saveCheckpoint(input.taskId, `trusted-readback-evidence:${evidenceRef}`, evidence);
    runtime.saveCheckpoint(input.taskId, `agentarts-observation-readback:${input.surface}`, {
      formatVersion: '1.0.0', observedAt: timed.observedAt, querySha256: timed.querySha256,
      ...(binding === undefined ? {} : {binding}), ...snapshot,
    });
    return {...base, availability: 'observed' as const,
      ...(binding === undefined ? {} : {binding}), observation, evidenceRef};
  }

  return {read};
}
