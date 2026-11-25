import { ProtocolError } from '@personal-agent/contracts';
import type { CalendarReadContext } from './provider.js';

const TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT', 'ECONNABORTED',
]);

export const CALENDAR_CERT_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'ERR_CERT_AUTHORITY_INVALID',
]);

export function transportErrorCode(error: unknown): string | null {
  for (const candidate of [error, error instanceof Error ? error.cause : undefined]) {
    if (candidate !== null && typeof candidate === 'object') {
      const code = (candidate as {code?: unknown}).code;
      if (typeof code === 'string' && code !== '') return code;
    }
  }
  return null;
}

export function isTransportTimeout(error: unknown, code: string | null): boolean {
  return (code !== null && TIMEOUT_CODES.has(code)) || (error instanceof Error && error.name === 'TimeoutError');
}

export function assertReadActive(context?: CalendarReadContext, now: () => number = Date.now): void {
  if (context?.signal?.aborted) throw new ProtocolError('CANCELLED', 'Calendar read cancelled');
  if (context?.deadline !== undefined) {
    const deadlineMs = Date.parse(context.deadline);
    if (!Number.isFinite(deadlineMs)) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid calendar read deadline');
    if (deadlineMs <= now()) throw new ProtocolError('TIMEOUT', 'Calendar read deadline exceeded', true);
  }
}
