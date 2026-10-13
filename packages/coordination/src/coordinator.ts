import {ProtocolError} from '@personal-agent/contracts';
import {parseCoordinationAvailableTools, parseCoordinationContinuation, parseCoordinationResult} from './index.js';
import {AgentArtsResultUnknownError} from './agentarts-websocket.js';
import type {
  CloudAgentPort, CoordinationAvailableTool, CoordinationContinuation, CoordinationPort, CoordinationRequest,
  CoordinationResult,
} from './index.js';

const requestFields = ['taskId', 'revision', 'goal', 'deadline', 'signal'];
const continuationRequestFields = [...requestFields, 'continuation'];
const availableToolsRequestFields = [...requestFields, 'availableTools'];
const isoDeadline = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

interface ValidatedRequest {
  readonly taskId: string;
  readonly revision: number;
  readonly goal: string;
  readonly deadline: string;
  readonly signal: AbortSignal;
  readonly expiresAt: number;
  readonly continuation?: CoordinationContinuation;
  readonly availableTools?: readonly CoordinationAvailableTool[];
}

function invalidRequest(): never {
  throw new ProtocolError('INVALID_ARGUMENT', 'Invalid coordination request');
}

function hasExactEnumerableKeys(value: object, fields: readonly string[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    return keys.length === fields.length
      && keys.every(key => typeof key === 'string' && fields.includes(key))
      && fields.every(field => Object.prototype.propertyIsEnumerable.call(value, field));
  } catch {
    return false;
  }
}

/** Accept native signals from another realm without relying on this realm's constructor. */
function isAbortSignal(value: unknown): value is AbortSignal {
  if (value === null || typeof value !== 'object') return false;
  try {
    const signal = value as {aborted: unknown; addEventListener: unknown; removeEventListener: unknown};
    return typeof signal.aborted === 'boolean'
      && typeof signal.addEventListener === 'function'
      && typeof signal.removeEventListener === 'function';
  } catch {
    return false;
  }
}

function readSignalAborted(signal: AbortSignal): boolean {
  try {
    const aborted = signal.aborted;
    if (typeof aborted !== 'boolean') invalidRequest();
    return aborted;
  } catch {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid coordination request');
  }
}

function parseIsoDeadline(value: string): number | undefined {
  if (!isoDeadline.test(value)) return undefined;
  const expiresAt = Date.parse(value);
  if (!Number.isFinite(expiresAt)) return undefined;
  try {
    const canonical = new Date(expiresAt).toISOString();
    const withoutMilliseconds = (input: string): string => input.replace(/\.000Z$/, 'Z');
    // Date.parse accepts and normalizes impossible dates; canonical comparison rejects them.
    if (withoutMilliseconds(value) !== withoutMilliseconds(canonical)) return undefined;
  } catch {
    return undefined;
  }
  return expiresAt;
}

function validateRequest(request: CoordinationRequest): ValidatedRequest {
  let taskId: unknown;
  let revision: unknown;
  let goal: unknown;
  let deadline: unknown;
  let signal: unknown;
  let continuationValue: unknown;
  let availableToolsValue: unknown;
  let hasAvailableTools = false;
  try {
    const hasContinuation = request !== null && typeof request === 'object'
      && Object.prototype.hasOwnProperty.call(request, 'continuation');
    hasAvailableTools = request !== null && typeof request === 'object'
      && Object.prototype.hasOwnProperty.call(request, 'availableTools');
    if (request === null || typeof request !== 'object' || Array.isArray(request)
      || (hasContinuation && hasAvailableTools)
      || !hasExactEnumerableKeys(request, hasContinuation ? continuationRequestFields
        : hasAvailableTools ? availableToolsRequestFields : requestFields)) invalidRequest();
    taskId = request.taskId;
    revision = request.revision;
    goal = request.goal;
    deadline = request.deadline;
    signal = request.signal;
    continuationValue = hasContinuation ? request.continuation : undefined;
    availableToolsValue = hasAvailableTools ? request.availableTools : undefined;
  } catch {
    // Request getters and proxies are untrusted input; never echo their errors.
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid coordination request');
  }

  if (typeof taskId !== 'string' || !taskId.trim()
    || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0
    || typeof goal !== 'string' || !goal.trim()
    || typeof deadline !== 'string' || !isAbortSignal(signal)) invalidRequest();
  const expiresAt = parseIsoDeadline(deadline);
  if (expiresAt === undefined) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid coordination deadline');
  }
  if (readSignalAborted(signal)) throw new ProtocolError('CANCELLED', 'Coordination cancelled');
  if (expiresAt <= Date.now()) throw new ProtocolError('TIMEOUT', 'Coordination deadline expired');
  const continuation = continuationValue === undefined ? undefined : parseCoordinationContinuation(continuationValue);
  const availableTools = hasAvailableTools ? parseCoordinationAvailableTools(availableToolsValue) : undefined;
  return {taskId, revision, goal, deadline, signal, expiresAt,
    ...(continuation === undefined ? {} : {continuation}),
    ...(availableTools === undefined ? {} : {availableTools})};
}

function sanitizeProviderError(error: unknown): never {
  // Only the local transport class carries this category; remote JSON cannot
  // promote itself into a trusted Runtime reconciliation decision.
  if (error instanceof AgentArtsResultUnknownError) throw error;
  let code: unknown;
  try {
    if (error instanceof ProtocolError) code = error.code;
  } catch {
    // A hostile error object must still produce the fixed public error below.
  }
  if (code === 'UNSUPPORTED_CAPABILITY') {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Cloud coordination is unavailable');
  }
  // Provider-owned CANCELLED/TIMEOUT are not coordinator lifecycle signals; do not trust them.
  throw new ProtocolError('EXTERNAL_FAILURE', 'Cloud coordination failed');
}

/** Explicit absence of a cloud provider; never selects a fixture or Local Agent. */
export class UnavailableCloudAgentPort implements CloudAgentPort {
  async invoke(request: CoordinationRequest): Promise<CoordinationResult> {
    validateRequest(request);
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Cloud coordination is unavailable');
  }
}

/** One bounded exchange. Runtime owns task identity, tools, persistence and terminal state. */
export class CompetitionCoordinator implements CoordinationPort {
  constructor(private readonly cloud: CloudAgentPort) {}

  async execute(request: CoordinationRequest): Promise<CoordinationResult> {
    const validated = validateRequest(request);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interrupt: (error: ProtocolError) => void = () => {};
    const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
    // Keep an early setup failure from turning a pre-race interruption into an unhandled rejection.
    void interrupted.catch(() => {});
    let stopped: 'CANCELLED' | 'TIMEOUT' | undefined;
    const stop = (code: 'CANCELLED' | 'TIMEOUT', message: string): void => {
      if (stopped !== undefined) return;
      stopped = code;
      // Settle the public error before notifying a cooperative provider.
      interrupt(new ProtocolError(code, message));
      controller.abort();
    };
    const cancel = (): void => stop('CANCELLED', 'Coordination cancelled');
    const scheduleDeadline = (): void => {
      const remaining = validated.expiresAt - Date.now();
      if (remaining <= 0) {
        stop('TIMEOUT', 'Coordination deadline expired');
        return;
      }
      timer = setTimeout(scheduleDeadline, Math.min(remaining, 2_147_483_647));
    };

    let listening = false;
    try {
      try {
        listening = true;
        validated.signal.addEventListener('abort', cancel, {once: true});
      } catch {
        throw new ProtocolError('INVALID_ARGUMENT', 'Invalid coordination request');
      }
      scheduleDeadline();
      if (readSignalAborted(validated.signal)) cancel();
      const input: CoordinationRequest = Object.freeze({
        taskId: validated.taskId,
        revision: validated.revision,
        goal: validated.goal,
        deadline: validated.deadline,
        signal: controller.signal,
        ...(validated.continuation === undefined ? {} : {continuation: validated.continuation}),
        ...(validated.availableTools === undefined ? {} : {availableTools: validated.availableTools}),
      });
      const invocation = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new ProtocolError('CANCELLED', 'Coordination cancelled');
        return this.cloud.invoke(input);
      }).catch(error => sanitizeProviderError(error));
      const result = await Promise.race([invocation, interrupted]);
      if (readSignalAborted(validated.signal)) throw new ProtocolError('CANCELLED', 'Coordination cancelled');
      if (validated.expiresAt <= Date.now()) throw new ProtocolError('TIMEOUT', 'Coordination deadline expired');
      const parsed = parseCoordinationResult(result);
      // A result getter may synchronously cancel the caller while it is being parsed.
      if (readSignalAborted(validated.signal)) throw new ProtocolError('CANCELLED', 'Coordination cancelled');
      if (validated.expiresAt <= Date.now()) throw new ProtocolError('TIMEOUT', 'Coordination deadline expired');
      return parsed;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (listening) {
        try {
          validated.signal.removeEventListener('abort', cancel);
        } catch {
          // Cleanup errors from a provider/host signal must not mask the public result.
        }
      }
    }
  }
}
