import {DecisionError} from './proactive-decision.js';

/** Operation-local deadline only, not a scheduler. Late port results cannot reopen the caller. */
export async function withCognitionDeadline<T>(input: {deadline: string; signal: AbortSignal},
  work: (context: {deadline: string; signal: AbortSignal}) => Promise<T>, now: () => number = Date.now): Promise<T> {
  if (!(input?.signal instanceof AbortSignal) || !Number.isFinite(Date.parse(input.deadline))) throw new DecisionError('INVALID_ARGUMENT');
  input = {...input};
  if (input.signal.aborted) throw new DecisionError('CANCELLED');
  const deadline = Date.parse(input.deadline);
  if (now() >= deadline) throw new DecisionError('TIMEOUT');
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  let timedOut = false, timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  const expire = (): void => {
    const remaining = deadline - now();
    if (remaining <= 0) {timedOut = true; controller.abort();}
    else timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
  };
  try {
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new DecisionError(timedOut ? 'TIMEOUT' : 'CANCELLED'));
      signal.addEventListener('abort', abort, {once: true});
      expire();
    });
    const operation = Promise.resolve().then(() => {
      if (signal.aborted) throw new DecisionError(timedOut ? 'TIMEOUT' : 'CANCELLED');
      return work({deadline: input.deadline, signal});
    });
    const result = await Promise.race([interrupted, operation]);
    // The port can block the event loop or settle ahead of a queued interrupt.
    // A winning promise is not proof that the caller is still within its lease.
    if (signal.aborted) throw new DecisionError(timedOut ? 'TIMEOUT' : 'CANCELLED');
    if (now() >= deadline) {
      timedOut = true; controller.abort();
      throw new DecisionError('TIMEOUT');
    }
    return result;
  } finally {clearTimeout(timer); signal.removeEventListener('abort', abort);}
}
