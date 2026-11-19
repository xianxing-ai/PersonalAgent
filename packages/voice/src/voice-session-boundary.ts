import {VoiceSessionError} from './errors.js';
import type {HuaweiSisRegion} from './huawei-sis.js';

export interface VoiceSessionContext {
  readonly deadline: string;
  readonly signal: AbortSignal;
}

export interface ValidatedVoiceSessionContext {
  readonly deadline: string;
  readonly expiresAt: number;
  readonly remainingMs: number;
  readonly signal: AbortSignal;
}

export interface AssertVoiceSessionContextOptions {
  readonly nowMs?: number;
}

const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SIS_REGIONS = new Set<HuaweiSisRegion>(['cn-north-4', 'cn-east-3']);
const SIS_ENDPOINTS: Readonly<Record<HuaweiSisRegion, string>> = Object.freeze({
  'cn-north-4': 'https://sis-ext.cn-north-4.myhuaweicloud.com',
  'cn-east-3': 'https://sis-ext.cn-east-3.myhuaweicloud.com',
});
const PROJECT_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

function isAbortSignal(value: unknown): value is AbortSignal {
  if (value === null || typeof value !== 'object') return false;
  try {
    const s = value as {aborted?: unknown; addEventListener?: unknown; removeEventListener?: unknown};
    return typeof s.aborted === 'boolean'
      && typeof s.addEventListener === 'function'
      && typeof s.removeEventListener === 'function';
  } catch {
    return false;
  }
}

/**
 * Asserts voice session deadline and cancellation constraints without starting resources.
 */
export function assertVoiceSessionContext(
  context: unknown,
  options?: AssertVoiceSessionContextOptions
): ValidatedVoiceSessionContext {
  if (context === null || typeof context !== 'object' || Array.isArray(context)) {
    throw new VoiceSessionError('INVALID_ARGUMENT', 'Invalid voice session context');
  }

  const candidate = context as {deadline?: unknown; signal?: unknown};

  if (typeof candidate.deadline !== 'string' || !ISO_UTC_REGEX.test(candidate.deadline)) {
    throw new VoiceSessionError('INVALID_ARGUMENT', 'Invalid voice session deadline');
  }

  const expiresAt = Date.parse(candidate.deadline);
  if (!Number.isFinite(expiresAt)) {
    throw new VoiceSessionError('INVALID_ARGUMENT', 'Invalid voice session deadline');
  }

  const canonical = new Date(expiresAt).toISOString();
  const normalize = (input: string): string => input.replace(/\.000Z$/, 'Z');
  if (normalize(candidate.deadline) !== normalize(canonical)) {
    throw new VoiceSessionError('INVALID_ARGUMENT', 'Invalid voice session deadline');
  }

  const now = typeof options?.nowMs === 'number' && Number.isFinite(options.nowMs)
    ? options.nowMs
    : Date.now();

  if (expiresAt <= now) {
    throw new VoiceSessionError('TIMEOUT', 'Voice session deadline expired');
  }

  if (!isAbortSignal(candidate.signal)) {
    throw new VoiceSessionError('INVALID_ARGUMENT', 'Invalid voice session signal');
  }

  if (candidate.signal.aborted) {
    throw new VoiceSessionError('CANCELLED', 'Voice session cancelled');
  }

  return Object.freeze({
    deadline: candidate.deadline,
    expiresAt,
    remainingMs: expiresAt - now,
    signal: candidate.signal,
  });
}

export interface HuaweiSisAvailabilityInput {
  readonly region?: unknown;
  readonly projectId?: unknown;
  readonly tokenPort?: unknown;
  readonly requestAuthPort?: unknown;
  readonly fetchImpl?: unknown;
}

export interface HuaweiSisAvailabilityPlan {
  readonly available: boolean;
  readonly reason: 'ready' | 'unavailable';
  readonly region?: HuaweiSisRegion;
  readonly projectId?: string;
  readonly authMode?: 'token' | 'signature';
  readonly endpoint?: string;
  readonly detail?: string;
}

/**
 * Pure offline availability planner for Huawei SIS.
 * Never touches network, never invokes auth token/headers ports, and never reads credentials.
 */
export function planHuaweiSisAvailability(input?: unknown): HuaweiSisAvailabilityPlan {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return Object.freeze({available: false, reason: 'unavailable', detail: 'missing_config'});
  }

  const config = input as HuaweiSisAvailabilityInput;

  if (typeof config.region !== 'string' || !SIS_REGIONS.has(config.region as HuaweiSisRegion)) {
    return Object.freeze({available: false, reason: 'unavailable', detail: 'invalid_or_missing_region'});
  }

  if (typeof config.projectId !== 'string' || !PROJECT_ID_REGEX.test(config.projectId)) {
    return Object.freeze({available: false, reason: 'unavailable', detail: 'invalid_or_missing_project_id'});
  }

  const tokenPort = config.tokenPort as {getSisToken?: unknown} | undefined;
  const requestAuthPort = config.requestAuthPort as {getSisRequestHeaders?: unknown} | undefined;

  const hasToken = tokenPort !== null && typeof tokenPort === 'object'
    && typeof tokenPort.getSisToken === 'function';
  const hasRequestAuth = requestAuthPort !== null && typeof requestAuthPort === 'object'
    && typeof requestAuthPort.getSisRequestHeaders === 'function';

  // Exactly one credential port must be available (consistent with huawei-sis.ts readyConfig).
  if (hasToken === hasRequestAuth) {
    return Object.freeze({
      available: false,
      reason: 'unavailable',
      detail: hasToken ? 'ambiguous_credentials' : 'missing_credentials_port',
    });
  }

  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return Object.freeze({available: false, reason: 'unavailable', detail: 'missing_transport'});
  }

  const region = config.region as HuaweiSisRegion;
  return Object.freeze({
    available: true,
    reason: 'ready',
    region,
    projectId: config.projectId,
    authMode: hasRequestAuth ? 'signature' : 'token',
    endpoint: SIS_ENDPOINTS[region],
    detail: 'configured',
  });
}
