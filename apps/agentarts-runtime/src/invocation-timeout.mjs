import {ProtocolError} from '@personal-agent/contracts';

export const MAX_TIMER_MS = 2_147_483_647;
export function invocationExpiry(deadline, timeoutMs, now = Date.now()) {
  const parsed = typeof deadline === 'string' ? Date.parse(deadline) : NaN;
  if (!Number.isFinite(parsed)) throw new ProtocolError('INVALID_ARGUMENT','Invocation deadline required');
  if (parsed <= now) throw new ProtocolError('TIMEOUT','Invocation deadline expired');
  return timeoutMs === undefined ? parsed : Math.min(parsed,now + timeoutMs);
}

// Re-arm long deadlines instead of allowing Node's timer overflow to expire immediately.
export function scheduleExpiry(expiresAt, callback) {
  let timer;
  const arm = () => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return callback();
    timer = setTimeout(arm,Math.min(remaining,MAX_TIMER_MS));
  };
  arm();
  return () => clearTimeout(timer);
}
