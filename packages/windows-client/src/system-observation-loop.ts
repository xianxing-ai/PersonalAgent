import {ProtocolError} from '@personal-agent/contracts';
import type {SystemObservation} from './index.js';

export const SYSTEM_OBSERVATION_LOOP_SUPPORTED_METRICS = Object.freeze([
  'cpu',
  'memory',
  'uptime',
] as const);

export const SYSTEM_OBSERVATION_LOOP_UNAVAILABLE_METRICS = Object.freeze([
  'process_breakdown',
  'disk_io',
  'thermal',
  'network_activity',
] as const);

export const SYSTEM_OBSERVATION_LOOP_ERROR_CODES = Object.freeze([
  'EXTERNAL_FAILURE',
  'CANCELLED',
  'TIMEOUT',
  'INVALID_ARGUMENT',
] as const);

export const SYSTEM_OBSERVATION_ACCEPTANCE_PENDING = Object.freeze([
  'policy',
  'agentarts',
  'desktop-ui',
  'windows-provider',
] as const);

export type SystemObservationAcceptanceGate = (typeof SYSTEM_OBSERVATION_ACCEPTANCE_PENDING)[number];

export interface SystemObservationAcceptancePlan {
  readonly closedLoop: false;
  readonly pending: readonly SystemObservationAcceptanceGate[];
  readonly reason: string;
}

export interface SystemObservationAcceptanceInput {
  readonly platform?: string;
  readonly evidence?: unknown;
  readonly hasRealMachineEvidence?: boolean;
  readonly productionAuthorizationVerified?: boolean;
  readonly agentArtsVerified?: boolean;
  readonly desktopUiVerified?: boolean;
  readonly windowsProviderVerified?: boolean;
  readonly [key: string]: unknown;
}

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'source',
  'capturedAt',
  'sampledFrom',
  'sampledUntil',
  'actualSampleWindowMs',
  'requestedSampleWindowMs',
  'cpu',
  'memory',
  'uptimeSeconds',
  'unavailable',
]);

const FORBIDDEN_PROPERTY_NAMES = new Set([
  'process_breakdown',
  'disk_io',
  'thermal',
  'network_activity',
  'hostname',
  'username',
  'processName',
  'commandLine',
  'path',
  'address',
  'credential',
]);

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Asserts that the given value strictly conforms to a valid SystemObservation result.
 *
 * Validates:
 * - Only supported metrics ('cpu', 'memory', 'uptime') are present.
 * - 'source' is strictly 'node:os' or 'injected'.
 * - Failures are not masqueraded using fabricated zero values (logicalProcessorCount >= 1, totalBytes >= 1).
 * - Unavailable metrics ('process_breakdown', 'disk_io', 'thermal', 'network_activity') are explicitly declared.
 * - Memory consistency (usedBytes === totalBytes - freeBytes).
 * - Timestamps and sample windows conform to ISO standards and bounds.
 */
export function assertSystemObservationLoopResult(result: unknown): asserts result is SystemObservation {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'System observation result must be a non-null object');
  }

  const record = result as Record<string, unknown>;

  // Check for unexpected or unsupported top-level fields
  for (const key of Object.keys(record)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new ProtocolError(
        'INVALID_ARGUMENT',
        `Unsupported or unexpected property '${key}' in system observation result`,
      );
    }
  }

  // Explicit check against forbidden metrics or sensitive properties as top-level fields
  for (const forbidden of FORBIDDEN_PROPERTY_NAMES) {
    if (Object.prototype.hasOwnProperty.call(record, forbidden)) {
      throw new ProtocolError(
        'INVALID_ARGUMENT',
        `Unsupported metric or sensitive field '${forbidden}' must not be present as a data property`,
      );
    }
  }

  // Source must be 'node:os' or 'injected'
  if (record.source !== 'node:os' && record.source !== 'injected') {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      `Invalid source '${String(record.source)}': must be 'node:os' or 'injected'`,
    );
  }

  // ISO timestamps validation
  for (const field of ['capturedAt', 'sampledFrom', 'sampledUntil'] as const) {
    const val = record[field];
    if (typeof val !== 'string' || !ISO_TIMESTAMP_PATTERN.test(val) || Number.isNaN(Date.parse(val))) {
      throw new ProtocolError(
        'INVALID_ARGUMENT',
        `Timestamp field '${field}' must be a valid ISO 8601 UTC string`,
      );
    }
  }

  // Sample windows
  const requested = record.requestedSampleWindowMs;
  if (!Number.isSafeInteger(requested) || (requested as number) < 1 || (requested as number) > 5000) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'requestedSampleWindowMs must be a safe integer between 1 and 5000',
    );
  }

  const actual = record.actualSampleWindowMs;
  if (typeof actual !== 'number' || !Number.isFinite(actual) || actual < 0) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'actualSampleWindowMs must be a non-negative finite number',
    );
  }

  // CPU metric validation: cannot fake zero cores or invalid percentages
  const cpu = record.cpu;
  if (!cpu || typeof cpu !== 'object' || Array.isArray(cpu)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'cpu metric must be an object');
  }
  const cpuRecord = cpu as Record<string, unknown>;
  for (const key of Object.keys(cpuRecord)) {
    if (key !== 'logicalProcessorCount' && key !== 'utilizationPercent') {
      throw new ProtocolError('INVALID_ARGUMENT', `Unexpected property '${key}' in cpu metric`);
    }
  }

  const cores = cpuRecord.logicalProcessorCount;
  if (!Number.isSafeInteger(cores) || (cores as number) < 1) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'cpu.logicalProcessorCount must be an integer >= 1 (fabricated zero values are rejected)',
    );
  }

  const cpuUtil = cpuRecord.utilizationPercent;
  if (typeof cpuUtil !== 'number' || !Number.isFinite(cpuUtil) || cpuUtil < 0 || cpuUtil > 100) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'cpu.utilizationPercent must be a finite number between 0 and 100',
    );
  }

  // Memory metric validation: cannot fake zero memory or inconsistent usedBytes
  const memory = record.memory;
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'memory metric must be an object');
  }
  const memRecord = memory as Record<string, unknown>;
  for (const key of Object.keys(memRecord)) {
    if (key !== 'totalBytes' && key !== 'freeBytes' && key !== 'usedBytes' && key !== 'utilizationPercent') {
      throw new ProtocolError('INVALID_ARGUMENT', `Unexpected property '${key}' in memory metric`);
    }
  }

  const totalBytes = memRecord.totalBytes;
  if (!Number.isSafeInteger(totalBytes) || (totalBytes as number) < 1) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'memory.totalBytes must be an integer >= 1 (fabricated zero values are rejected)',
    );
  }

  const freeBytes = memRecord.freeBytes;
  if (!Number.isSafeInteger(freeBytes) || (freeBytes as number) < 0 || (freeBytes as number) > (totalBytes as number)) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'memory.freeBytes must be a non-negative integer <= totalBytes',
    );
  }

  const usedBytes = memRecord.usedBytes;
  if (!Number.isSafeInteger(usedBytes) || (usedBytes as number) < 0 || (usedBytes as number) > (totalBytes as number)) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'memory.usedBytes must be a non-negative integer <= totalBytes',
    );
  }

  if ((usedBytes as number) !== (totalBytes as number) - (freeBytes as number)) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      `memory.usedBytes (${String(usedBytes)}) must equal totalBytes (${String(totalBytes)}) - freeBytes (${String(freeBytes)})`,
    );
  }

  const memUtil = memRecord.utilizationPercent;
  if (typeof memUtil !== 'number' || !Number.isFinite(memUtil) || memUtil < 0 || memUtil > 100) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'memory.utilizationPercent must be a finite number between 0 and 100',
    );
  }

  // Uptime validation
  const uptime = record.uptimeSeconds;
  if (typeof uptime !== 'number' || !Number.isFinite(uptime) || uptime < 0) {
    throw new ProtocolError('INVALID_ARGUMENT', 'uptimeSeconds must be a non-negative finite number');
  }

  // Unavailable metrics declaration
  const unavailable = record.unavailable;
  if (!Array.isArray(unavailable) || unavailable.length !== 4) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'unavailable must be an array of exactly 4 declared unavailable metrics',
    );
  }

  const unavailableSet = new Set(unavailable);
  for (const expected of SYSTEM_OBSERVATION_LOOP_UNAVAILABLE_METRICS) {
    if (!unavailableSet.has(expected)) {
      throw new ProtocolError(
        'INVALID_ARGUMENT',
        `unavailable metrics must include '${expected}'`,
      );
    }
  }

  // Check serialized content against sensitive leaks
  const serialized = JSON.stringify(record);
  if (/hostname|username|processName|commandLine|path|address|credential/i.test(serialized)) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'Observation result contains forbidden sensitive property patterns',
    );
  }
}

/**
 * Returns true if the given value strictly conforms to a valid SystemObservation result.
 */
export function isSystemObservationLoopResult(result: unknown): result is SystemObservation {
  try {
    assertSystemObservationLoopResult(result);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates that an observation failure adheres to the strict protocol semantics:
 * - Must be an error object with an allowed error code ('EXTERNAL_FAILURE', 'CANCELLED', 'TIMEOUT', 'INVALID_ARGUMENT').
 * - Must not return or embed a fabricated observation payload.
 * - Must not leak local sensitive paths or credentials in error messages.
 */
export function assertSystemObservationFailure(error: unknown): asserts error is ProtocolError {
  if (!error || typeof error !== 'object') {
    throw new ProtocolError('INVALID_ARGUMENT', 'System observation failure must be an error object');
  }

  const code = (error as {code?: unknown}).code;
  if (typeof code !== 'string' || !SYSTEM_OBSERVATION_LOOP_ERROR_CODES.includes(code as any)) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      `Unsupported system observation error code: '${String(code)}'`,
    );
  }

  const record = error as Record<string, unknown>;
  if ('cpu' in record || 'memory' in record || 'uptimeSeconds' in record || 'source' in record) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'System observation failure must not fabricate or embed observation results',
    );
  }

  const message = typeof (error as Error).message === 'string' ? (error as Error).message : '';
  if (/Users|secret|private|credential|\\Users/i.test(message)) {
    throw new ProtocolError(
      'INVALID_ARGUMENT',
      'Error message leaks sensitive system information',
    );
  }
}

/**
 * Returns true if the error represents a system observation cancellation.
 */
export function isSystemObservationCancellation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as {code?: unknown}).code === 'CANCELLED';
}

/**
 * Returns true if the error represents a system observation deadline timeout.
 */
export function isSystemObservationTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as {code?: unknown}).code === 'TIMEOUT';
}

/**
 * Evaluates whether system observation has achieved verified end-to-end closed loop.
 *
 * In non-Windows environments (such as Linux or macOS) or in the absence of verified
 * physical machine execution receipts across all four prerequisite gates
 * ('policy', 'agentarts', 'desktop-ui', 'windows-provider'), this strictly returns
 * closedLoop: false with reason '待真机验收'.
 *
 * It never returns closedLoop: true in synthetic, offline, or unverified environments.
 */
export function planSystemObservationAcceptance(
  _input?: SystemObservationAcceptanceInput,
): SystemObservationAcceptancePlan {
  return Object.freeze({
    closedLoop: false,
    pending: SYSTEM_OBSERVATION_ACCEPTANCE_PENDING,
    reason: '待真机验收',
  });
}
