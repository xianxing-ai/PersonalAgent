import {Ajv2020} from 'ajv/dist/2020.js';
import schema from '../schema/windows-host.json' with {type: 'json'};
import {MAX_FRAME_BYTES, ProtocolError} from './index.js';

export const WINDOWS_HOST_PROTOCOL_VERSION = '0.1.0';
export const WINDOWS_HOST_TOOL_NAME = 'computer.notepad.replace_text';

type Base = {kind: string; protocolVersion: string; requestId: string};
type Session = Base & {sessionId: string};
export type WindowsHostHello = Base & {kind: 'hello'; clientNonce: string};
export type WindowsHostHelloAck = Base & {kind: 'hello_ack'; clientNonce: string; hostNonce: string; sessionId: string};
export type WindowsHostBind = Session & {kind: 'bind'; hostNonce: string};
export type WindowsHostObserve = Session & {kind: 'observe'; deadline: string; capability: 'notepad.replace_text'};
export type WindowsHostObserved = Session & {kind: 'observed'; targetRef: string; expiresAt: string; source: 'windows-uia'};
export type WindowsHostObservationRefused = Session & {kind: 'observation_refused';
  errorCode: 'NOT_FOUND' | 'TARGET_AMBIGUOUS' | 'TARGET_STALE' | 'UNAUTHORIZED' | 'CANCELLED' | 'TIMEOUT' | 'EXTERNAL_FAILURE'};
/** Optional read-only readiness check for the original observation in the same session. */
export type WindowsHostTargetReady = Session & {kind: 'target_ready'; targetRef: string; deadline: string};
export type WindowsHostTargetReadyResult = Session & {kind: 'target_ready_result'; targetRef: string} & (
  {ready: true; expiresAt: string; errorCode?: never}
  | {ready: false; errorCode: 'TARGET_STALE' | 'TIMEOUT'; expiresAt?: never});
export type WindowsHostExecute = Session & {
  kind: 'execute'; taskId: string; runId: string; toolName: typeof WINDOWS_HOST_TOOL_NAME;
  toolVersion: '1.0.0'; authorizationRef: string; argumentsDigest: string;
  targetRef: string; deadline: string; expectedText: string; replacementText: string;
};
type RunIdentity = {taskId: string; runId: string; toolName: typeof WINDOWS_HOST_TOOL_NAME;
  toolVersion: '1.0.0'; argumentsDigest: string; targetRef: string};
export type WindowsHostCancel = Session & RunIdentity & {kind: 'cancel'};
export type WindowsHostStatus = Session & RunIdentity & {kind: 'status'};
export type WindowsHostStatusReply = Session & {kind: 'status_reply'; taskId: string; runId: string;
  state: 'in_progress' | 'not_found'};
export type WindowsHostResult = Session & {
  kind: 'result'; taskId: string; runId: string; toolName: typeof WINDOWS_HOST_TOOL_NAME;
  toolVersion: '1.0.0'; argumentsDigest: string; targetRef: string;
  state: 'verified' | 'refused' | 'cancelled' | 'result_unknown';
  startedAt: string; finishedAt: string; evidenceRef?: string; errorCode?: string;
};
export type WindowsHostFrame = WindowsHostHello | WindowsHostHelloAck | WindowsHostBind
  | WindowsHostObserve | WindowsHostObserved | WindowsHostObservationRefused | WindowsHostExecute | WindowsHostCancel
  | WindowsHostTargetReady | WindowsHostTargetReadyResult
  | WindowsHostStatus | WindowsHostStatusReply | WindowsHostResult;

const ajv = new Ajv2020({allErrors: true, strict: false});
const validate = ajv.compile(schema);

function invalid(message: string): never { throw new ProtocolError('INVALID_ARGUMENT', message); }
function isUtc(value: string): boolean {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

/** Validates the private Host wire frame. This does not authenticate the pipe peer or authorize an action. */
export function parseWindowsHostFrame(value: unknown): WindowsHostFrame {
  if (!validate(value)) invalid('Windows Host frame does not match schema');
  const frame = value as WindowsHostFrame;
  const times = frame.kind === 'execute' || frame.kind === 'observe' || frame.kind === 'target_ready'
    ? [frame.deadline]
    : frame.kind === 'observed' || (frame.kind === 'target_ready_result' && frame.ready)
      ? [frame.expiresAt]
      : frame.kind === 'result' ? [frame.startedAt, frame.finishedAt] : [];
  if (times.some((time) => !isUtc(time))) invalid('Windows Host frame has an invalid UTC time');
  if (frame.kind === 'result') {
    if (Date.parse(frame.finishedAt) < Date.parse(frame.startedAt)) invalid('Windows Host result time order is invalid');
    if (frame.state === 'verified') {
      if (!frame.evidenceRef || frame.errorCode) invalid('Verified result requires evidence and no error');
    } else if (!frame.errorCode) invalid('Nonverified result requires an error code');
  }
  return frame;
}

export function encodeWindowsHostFrame(value: WindowsHostFrame): Uint8Array {
  parseWindowsHostFrame(value);
  const bytes = new TextEncoder().encode(JSON.stringify(value) + '\n');
  if (bytes.length > MAX_FRAME_BYTES) invalid('Windows Host frame exceeds 1 MiB');
  return bytes;
}

/** Call only after verifying the pipe peer belongs to the expected current-user process. */
export function validateWindowsHostHandshake(hello: WindowsHostHello, ack: WindowsHostHelloAck, bind: WindowsHostBind): void {
  parseWindowsHostFrame(hello); parseWindowsHostFrame(ack); parseWindowsHostFrame(bind);
  if (hello.kind !== 'hello' || ack.kind !== 'hello_ack' || bind.kind !== 'bind'
    || hello.requestId !== ack.requestId || hello.clientNonce !== ack.clientNonce
    || ack.sessionId !== bind.sessionId || ack.hostNonce !== bind.hostNonce
    || hello.protocolVersion !== ack.protocolVersion || ack.protocolVersion !== bind.protocolVersion) {
    invalid('Windows Host handshake correlation mismatch');
  }
}

export function validateWindowsHostObservation(request: WindowsHostObserve,
  reply: WindowsHostObserved | WindowsHostObservationRefused): void {
  parseWindowsHostFrame(request); parseWindowsHostFrame(reply);
  if (request.kind !== 'observe' || !['observed', 'observation_refused'].includes(reply.kind)
    || request.requestId !== reply.requestId || request.sessionId !== reply.sessionId
    || request.protocolVersion !== reply.protocolVersion) invalid('Windows Host observation correlation mismatch');
}

/** Readiness is a fresh Host observation, never an authorization or target renewal. */
export function validateWindowsHostTargetReady(request: WindowsHostTargetReady,
  reply: WindowsHostTargetReadyResult): void {
  parseWindowsHostFrame(request); parseWindowsHostFrame(reply);
  if (request.kind !== 'target_ready' || reply.kind !== 'target_ready_result'
    || request.requestId !== reply.requestId || request.sessionId !== reply.sessionId
    || request.protocolVersion !== reply.protocolVersion || request.targetRef !== reply.targetRef) {
    invalid('Windows Host target readiness correlation mismatch');
  }
}

/** A status poll may use a new requestId; pass it explicitly while retaining the original execute frame. */
export function validateWindowsHostResult(request: WindowsHostExecute, reply: WindowsHostResult, responseRequestId = request.requestId): void {
  parseWindowsHostFrame(request); parseWindowsHostFrame(reply);
  if (request.kind !== 'execute' || reply.kind !== 'result'
    || reply.requestId !== responseRequestId || reply.sessionId !== request.sessionId
    || reply.protocolVersion !== request.protocolVersion || reply.taskId !== request.taskId
    || reply.runId !== request.runId || reply.toolName !== request.toolName
    || reply.toolVersion !== request.toolVersion || reply.argumentsDigest !== request.argumentsDigest
    || reply.targetRef !== request.targetRef) {
    invalid('Windows Host result correlation mismatch');
  }
}

export function validateWindowsHostStatus(request: WindowsHostStatus, reply: WindowsHostStatusReply | WindowsHostResult): void {
  parseWindowsHostFrame(request); parseWindowsHostFrame(reply);
  if (request.kind !== 'status' || !['status_reply', 'result'].includes(reply.kind)
    || reply.requestId !== request.requestId || reply.sessionId !== request.sessionId
    || reply.protocolVersion !== request.protocolVersion || reply.taskId !== request.taskId
    || reply.runId !== request.runId || (reply.kind === 'result' && (
      reply.toolName !== request.toolName || reply.toolVersion !== request.toolVersion
      || reply.argumentsDigest !== request.argumentsDigest || reply.targetRef !== request.targetRef))) {
    invalid('Windows Host status correlation mismatch');
  }
}

/** Reconnected polling uses a new session; the original targetRef is only a historical run identity. */
export function validateWindowsHostRecoveredResult(original: WindowsHostExecute,
  poll: WindowsHostStatus, reply: WindowsHostResult): void {
  parseWindowsHostFrame(original);
  validateWindowsHostStatus(poll, reply);
  if (poll.sessionId === original.sessionId || poll.taskId !== original.taskId
    || poll.runId !== original.runId || poll.toolName !== original.toolName
    || poll.toolVersion !== original.toolVersion || poll.argumentsDigest !== original.argumentsDigest
    || poll.targetRef !== original.targetRef) {
    invalid('Windows Host recovered run identity mismatch');
  }
}

export type NotepadConfirmationGateInput = {
  confirmed: boolean;
  source?: string | undefined;
  confirmedAt?: string | undefined;
  targetRef?: string | undefined;
};

export type NotepadConfirmationGateResult =
  | { state: 'confirmed'; allowed: true; source: string; confirmedAt: string; targetRef?: string | undefined }
  | { state: 'refused'; allowed: false; errorCode: 'UNAUTHORIZED'; reason: string; targetRef?: string | undefined };

/**
 * Asserts the F9 / manual confirmation gate for restricted Notepad actions.
 * In production, F9 receipt / confirmation is captured in Desktop/Runtime before execution.
 * At the contract level, this pure function codifies that without confirmed: true,
 * execution must be refused with state: 'refused' and errorCode: 'UNAUTHORIZED'.
 *
 * NOTE: Real physical F9 keypress on Windows remains pending field acceptance (待真机验收).
 */
export function assertNotepadConfirmationGate(input: NotepadConfirmationGateInput): NotepadConfirmationGateResult {
  if (!input || !input.confirmed) {
    return {
      state: 'refused',
      allowed: false,
      errorCode: 'UNAUTHORIZED',
      reason: 'F9 or explicit manual confirmation is required before Notepad execution',
      targetRef: input?.targetRef,
    };
  }
  if (input.confirmedAt && !isUtc(input.confirmedAt)) {
    return {
      state: 'refused',
      allowed: false,
      errorCode: 'UNAUTHORIZED',
      reason: 'Confirmation timestamp must be a valid UTC ISO string',
      targetRef: input.targetRef,
    };
  }
  return {
    state: 'confirmed',
    allowed: true,
    source: input.source ?? 'f9_hotkey',
    confirmedAt: input.confirmedAt ?? new Date().toISOString(),
    targetRef: input.targetRef,
  };
}

/**
 * Validates that an execute frame is paired with verified user confirmation.
 * Rejects unconfirmed requests, stale confirmation, or mismatched targetRef.
 */
export function validateWindowsHostExecuteConfirmation(
  execute: WindowsHostExecute,
  confirmation: NotepadConfirmationGateInput,
): void {
  parseWindowsHostFrame(execute);
  const verdict = assertNotepadConfirmationGate(confirmation);
  if (!verdict.allowed) {
    invalid(verdict.reason);
  }
  if (confirmation.targetRef && confirmation.targetRef !== execute.targetRef) {
    invalid('Confirmation targetRef does not match execute frame');
  }
}
