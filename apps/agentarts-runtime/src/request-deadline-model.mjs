import {OpenAICompatibleModelProvider} from '@personal-agent/models';
import {invocationExpiry,MAX_TIMER_MS} from './invocation-timeout.mjs';

/** Keep the existing provider/route; size each call's timeout from its original deadline. */
export function createRequestDeadlineModel(options, {timeoutMs,createProvider = value => new OpenAICompatibleModelProvider(value)} = {}) {
  const descriptor = createProvider({...options,timeoutMs:timeoutMs ?? MAX_TIMER_MS});
  return {
    deployment:descriptor.deployment,
    complete(request) {
      request.signal?.throwIfAborted();
      const expiresAt = invocationExpiry(request.deadline,timeoutMs);
      const provider = createProvider({...options,timeoutMs:Math.min(MAX_TIMER_MS,Math.max(1,expiresAt-Date.now()))});
      return provider.complete(request);
    },
  };
}
