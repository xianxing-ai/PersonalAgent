import {Client} from '@personal-agent/client';

// MOD-11 integration entry. The trusted host supplies the MOD-02 transport.
// No fallback runtime, private database or credentials are owned by the renderer.
export async function register(host) {
  const client = new Client(host.transport, host.now ?? Date.now);
  await client.connect();
  const release = host.attachClient?.(client);
  return {
    client,
    readEvents: host.readEvents,
    dispose() {
      release?.();
    },
  };
}

export async function requestTaskCancellation(client, taskId, refreshTask) {
  const result = await client.call('task.cancel', {taskId, reason: '用户取消任务'});
  const task = await refreshTask(taskId);
  return {...result, state: task.state};
}

export function submitConversationTask(client, payload, {competition = false} = {}) {
  // Runtime persists the submit request's deadline for the complete task.
  // Client's 10s RPC default is too short for a deployed cloud workflow.
  return client.call('task.submit', payload, {
    idempotencyKey: crypto.randomUUID(),
    ...(competition ? {timeoutMs: 30 * 60_000} : {}),
  });
}
