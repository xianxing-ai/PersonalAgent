import {createConnection} from 'node:net';

export const CLOUD_RUNTIME_SOCKET = '/run/personal-agent-cloud-runtime/runtime.sock';
export const CLOUD_RUNTIME_MAX_BYTES = 1024 * 1024;
const STATES = new Set(['succeeded', 'failed', 'unknown', 'rejected']);
const RECEIPT_KEYS = new Set(['v', 'jobId', 'idempotencyKey', 'kind', 'state', 'data', 'redo']);

/** One signed envelope to one host-configured local socket. No retries or execution fallback. */
export function forwardCloudPersistentJob(message, options = {}) {
  const socketPath = options.socketPath ?? process.env.PA_CLOUD_RUNTIME_SOCKET ?? CLOUD_RUNTIME_SOCKET;
  const deadline = typeof message?.deadline === 'string' ? Date.parse(message.deadline) : NaN;
  const outcome = (sent, reason) => ({v: 1, jobId: message?.id, idempotencyKey: message?.idempotencyKey,
    kind: message?.kind, state: sent ? 'unknown' : 'rejected', data: {transport: sent ? 'unknown' : 'not_sent', reason}, redo: false});
  // Only a trusted fixture override may select a Windows local named pipe.
  const fixturePipe = process.platform === 'win32' && options.socketPath !== undefined && typeof socketPath === 'string' && socketPath.startsWith('\\\\.\\pipe\\');
  if (typeof socketPath !== 'string' || /[\r\n\0]/.test(socketPath) || (!socketPath.startsWith('/') && !fixturePipe)) {
    return Promise.resolve(outcome(false, 'invalid_socket_configuration'));
  }
  if (message?.kind !== 'cloud-persistent' || !Number.isFinite(deadline) || deadline <= Date.now()) {
    return Promise.resolve(outcome(false, 'deadline_or_kind'));
  }
  let request;
  try {request = Buffer.from(`${JSON.stringify(message)}\n`);} catch {return Promise.resolve(outcome(false, 'invalid_envelope'));}
  if (request.length > CLOUD_RUNTIME_MAX_BYTES) return Promise.resolve(outcome(false, 'request_too_large'));

  return new Promise(resolve => {
    let socket, timer, settled = false, sent = false, size = 0;
    const chunks = [];
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve(result);
    };
    const armDeadline = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) finish(outcome(sent, 'deadline'));
      else timer = setTimeout(armDeadline, Math.min(remaining, 2_147_483_647));
    };
    armDeadline();
    if (settled) return;
    try {socket = createConnection({path: socketPath});}
    catch {finish(outcome(false, 'connect_failed')); return;}
    socket.once('connect', () => {
      if (settled || Date.now() >= deadline) {finish(outcome(sent, 'deadline')); return;}
      // Even a partially flushed write may have reached the daemon; never downgrade it to not_sent.
      sent = true;
      try {socket.write(request);} catch {finish(outcome(true, 'write_failed'));}
    });
    socket.on('data', chunk => {
      size += chunk.length;
      if (size > CLOUD_RUNTIME_MAX_BYTES) {finish(outcome(sent, 'response_too_large')); return;}
      chunks.push(chunk);
    });
    socket.once('end', () => {
      if (Date.now() >= deadline) {finish(outcome(sent, 'deadline')); return;}
      let value;
      try {value = JSON.parse(Buffer.concat(chunks).toString('utf8'));}
      catch {finish(outcome(sent, 'invalid_receipt')); return;}
      if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !RECEIPT_KEYS.has(key))
        || value.v !== 1 || value.jobId !== message.id || value.idempotencyKey !== message.idempotencyKey
        || value.kind !== message.kind || !STATES.has(value.state) || value.redo !== false) {
        finish(outcome(sent, 'invalid_receipt')); return;
      }
      finish(value);
    });
    socket.once('error', () => finish(outcome(sent, sent ? 'socket_error' : 'connect_failed')));
    socket.once('close', () => finish(outcome(sent, 'closed_without_receipt')));
  });
}
