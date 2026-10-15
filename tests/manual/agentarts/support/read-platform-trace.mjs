// Manual, read-only observation entry. Importing this module performs no I/O.
// This origin is published for cn-southwest-2; other regions are not inferred.
import {buildRunLogPath, projectRunLogObservation, projectTraceObservation, validateInvocationIdentity}
  from '@personal-agent/agentarts/observability';
import {createHash} from 'node:crypto';
const ORIGIN = 'https://agentarts.cn-southwest-2.myhuaweicloud.com';
const MAX_BYTES = 1024 * 1024;
const OWN_ERRORS = new WeakSet();
const HEADER_NAMES = new Set(['host', 'content-type', 'accept', 'authorization', 'x-sdk-date', 'x-security-token']);

function failure(code, httpStatus) {
  const error = Object.assign(new Error(`AgentArts trace read failed: ${code}`), {
    code, ...(httpStatus === undefined ? {} : {httpStatus}),
  });
  OWN_ERRORS.add(error);
  return Object.freeze(error);
}

function dataFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('INVALID_ARGUMENT');
  const copy = {};
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !field?.enumerable || !Object.hasOwn(field, 'value')) throw failure('INVALID_ARGUMENT');
    Object.defineProperty(copy, key, {value: field.value, enumerable: true});
  }
  return copy;
}

function inputs(options, surface) {
  try {
    const copy = dataFields(options);
    const extra = surface === 'log' ? ['query'] : surface === 'correlated_trace' ? ['traceId', 'invocation'] : ['traceId'];
    if (Object.keys(copy).some(key => ![...extra, 'deadline', 'signal', 'authorize', 'fetchImpl'].includes(key))) throw 0;
    const {traceId, deadline, signal, authorize, fetchImpl = globalThis.fetch} = copy;
    // The manual entry accepts the safe identifier subset used by platform traces.
    if ((surface !== 'log' && (typeof traceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(traceId)))
      || typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(deadline)
      || !(signal instanceof AbortSignal) || typeof authorize !== 'function' || typeof fetchImpl !== 'function') throw 0;
    const expiresAt = Date.parse(deadline);
    if (!Number.isFinite(expiresAt) || deadline.replace(/\.000Z$/, 'Z') !== new Date(expiresAt).toISOString().replace(/\.000Z$/, 'Z')
      || expiresAt <= Date.now() || expiresAt - Date.now() > 2_147_483_647) throw 0;
    const path = surface === 'log' ? buildRunLogPath(copy.query) : `/v1/ops/observation/traces/${traceId}`;
    const invocation = copy.invocation === undefined ? undefined : validateInvocationIdentity(copy.invocation);
    return {traceId, deadline, signal, authorize, fetchImpl, expiresAt, path, invocation};
  } catch { throw failure('INVALID_ARGUMENT'); }
}

function signedHeaders(value, unsigned) {
  const headers = dataFields(value);
  const normalized = {};
  for (const [name, content] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (!HEADER_NAMES.has(key) || Object.hasOwn(normalized, key) || typeof content !== 'string'
      || !content || content.length > 4096 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(content)) throw failure('INVALID_ARGUMENT');
    normalized[key] = content;
  }
  for (const [name, content] of Object.entries(unsigned)) {
    if (normalized[name.toLowerCase()] !== content) throw failure('INVALID_ARGUMENT');
  }
  // Credentials and actual signature generation belong to the explicit caller.
  if (!/^SDK-(?:HMAC|ECDSA)-[A-Za-z0-9_-]+ .+/.test(normalized.authorization ?? '')
    || !/^\d{8}T\d{6}Z$/.test(normalized['x-sdk-date'] ?? '')) throw failure('UNAUTHORIZED');
  return Object.freeze(headers);
}

function discard(response) {
  try { void Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch { /* Never expose provider errors. */ }
}

function number(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw failure('EXTERNAL_FAILURE');
  return value;
}

function summarize(body, traceId) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.span_list)
    || number(body.total) === null) throw failure('EXTERNAL_FAILURE');
  const spans = body.span_list.map((span, index) => {
    if (!span || typeof span !== 'object' || Array.isArray(span) || span.trace_id !== traceId
      || (span.is_error !== undefined && span.is_error !== null && typeof span.is_error !== 'boolean')) throw failure('EXTERNAL_FAILURE');
    return Object.freeze({index, durationMs: number(span.duration), tokens: number(span.tokens),
      inputTokens: number(span.input_tokens), outputTokens: number(span.output_tokens), isError: span.is_error ?? null});
  });
  return Object.freeze({surface: 'ShowOpsTrace', region: 'cn-southwest-2', httpStatus: 200,
    total: body.total, returnedSpanCount: spans.length, spans: Object.freeze(spans),
    requestCorrelation: 'not_checked', deploymentVersion: 'not_checked', cost: 'not_checked'});
}

/**
 * The caller explicitly authorizes this one GET and signs the complete request
 * with the official AK/SK SDK. No saved Runtime Bearer, credentials, CLI, retries,
 * raw trace output, persistence, invocation join or cloud writes are provided.
 */
export async function readAgentArtsTrace(options) {
  return readObservation(options, 'trace');
}

/** Opt-in ID comparison using the trusted host's actual InvokeRuntime identity. */
export async function readAgentArtsTraceObservation(options) {
  return readObservation(options, 'correlated_trace');
}

/** One explicitly scoped platform log page; never starts an agent run or retries. */
export async function readAgentArtsRunLogs(options) {
  return readObservation(options, 'log');
}

async function readObservation(options, surface) {
  const {traceId, deadline, signal, authorize, fetchImpl, expiresAt, path, invocation} = inputs(options, surface);
  const controller = new AbortController();
  let stopCode;
  let reader;
  let response;
  let rejectStopped;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  // Consume a cancellation even if it occurs between two awaited stages.
  void stopped.catch(() => {});
  const stop = code => {
    if (stopCode) return;
    stopCode = code;
    controller.abort();
    try { void Promise.resolve(reader?.cancel()).catch(() => {}); } catch { /* Keep bounded cancellation. */ }
    rejectStopped(failure(code));
  };
  const onAbort = () => stop('CANCELLED');
  const check = () => {
    if (signal.aborted) stop('CANCELLED');
    else if (Date.now() >= expiresAt) stop('TIMEOUT');
    if (stopCode) throw failure(stopCode);
  };
  const wait = async operation => {
    check();
    const result = await Promise.race([Promise.resolve().then(() => { check(); return operation(); }), stopped]);
    check();
    return result;
  };
  signal.addEventListener('abort', onAbort, {once: true});
  const timer = setTimeout(() => stop('TIMEOUT'), Math.max(0, expiresAt - Date.now()));
  try {
    check();
    const url = `${ORIGIN}${path}`;
    const unsigned = Object.freeze({'Host': new URL(ORIGIN).host, 'Content-Type': 'application/json', 'Accept': 'application/json'});
    const request = Object.freeze({url, method: 'GET', body: '', headers: unsigned, deadline, signal: controller.signal});
    const headers = signedHeaders(await wait(() => authorize(request)), unsigned);
    response = await wait(async () => {
      const received = await fetchImpl(url, {method: 'GET', headers, signal: controller.signal, redirect: 'error'});
      if (controller.signal.aborted || signal.aborted || Date.now() >= expiresAt) {
        discard(received);
        check();
      }
      return received;
    });
    if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599) throw failure('EXTERNAL_FAILURE');
    if (response.status !== 200) throw failure([401, 403].includes(response.status) ? 'UNAUTHORIZED' : 'EXTERNAL_FAILURE', response.status);
    if (response.headers?.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw failure('EXTERNAL_FAILURE');
    reader = response.body?.getReader();
    if (!reader) throw failure('EXTERNAL_FAILURE');
    let bytes = 0;
    const chunks = [];
    while (true) {
      const item = await wait(() => reader.read());
      if (!item || typeof item.done !== 'boolean') throw failure('EXTERNAL_FAILURE');
      if (item.done) break;
      if (!(item.value instanceof Uint8Array)) throw failure('EXTERNAL_FAILURE');
      bytes += item.value.byteLength;
      if (bytes > MAX_BYTES) throw failure('EXTERNAL_FAILURE');
      chunks.push(Uint8Array.from(item.value));
    }
    const all = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(all));
    const projection = surface === 'log' ? projectRunLogObservation(body)
      : surface === 'correlated_trace' ? projectTraceObservation(body, traceId, invocation) : summarize(body, traceId);
    const result = surface === 'trace' ? projection : Object.freeze({...projection, httpStatus:200,
      querySha256:createHash('sha256').update(url, 'utf8').digest('hex'), observedAt:new Date().toISOString()});
    check();
    return result;
  } catch (error) {
    if (stopCode) throw failure(stopCode);
    throw OWN_ERRORS.has(error) ? error : failure('EXTERNAL_FAILURE');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    if (reader) {
      try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* No private errors. */ }
      try { reader.releaseLock(); } catch { /* A pending cancelled read may retain its lock. */ }
    } else discard(response);
  }
}
