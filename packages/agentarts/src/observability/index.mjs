// Read-only projections of documented Huawei observation responses. No I/O.
import {createHash} from 'node:crypto';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const ref = value => value == null ? null : digest(value);
const errors = new WeakSet();
const failure = code => {
  const error = Object.freeze(Object.assign(new Error('Invalid platform observation'), {code}));
  errors.add(error); return error;
};
const fail = () => { throw failure('EXTERNAL_FAILURE'); };
const record = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const copy = Object.create(null);
  // Do not run accessors supplied by an in-process consumer.
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !field?.enumerable || !Object.hasOwn(field, 'value')) fail();
    Object.defineProperty(copy, key, {value:field.value, enumerable:true});
  }
  return copy;
};
const number = value => {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
};
const identity = value => {
  if (value == null) return null;
  if (!id(value)) fail();
  return value;
};
function dense(value) {
  if (!Array.isArray(value)) fail();
  const copy = [];
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, index);
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) fail();
    copy.push(field.value);
  }
  return copy;
}

/** Snapshot of the actual HTTP InvokeRuntime request, supplied by its trusted host.
 * This does not authenticate the snapshot or authorize any network request.
 * resourceId is the application ID, never a configured runtime name/version.
 */
export function validateInvocationIdentity(value) {
  try {
    value = record(value);
    if (Object.keys(value).length !== 3 || !['requestId','sessionId','resourceId'].every(key => id(value[key]))) fail();
    return Object.freeze({requestId:value.requestId, sessionId:value.sessionId, resourceId:value.resourceId});
  } catch { throw failure('INVALID_ARGUMENT'); }
}

/** Each span remains a separate measurement; parent and child usage is never summed.
 * A lookup of a supplied trace ID alone proves no local invocation association.
 */
export function projectTraceObservation(body, traceId, invocation) {
  try { return traceObservation(body, traceId, invocation); }
  catch (error) { throw errors.has(error) ? error : failure('EXTERNAL_FAILURE'); }
}

function traceObservation(body, traceId, invocation) {
  if (!id(traceId)) fail();
  const expected = invocation === undefined ? undefined : validateInvocationIdentity(invocation);
  body = record(body);
  if (number(body.total) === null) fail();
  const ids = new Set();
  let missing = false, conflict = false;
  const spans = dense(body.span_list).map((raw, index) => {
    const span = record(raw);
    if (span.trace_id !== traceId || (span.is_error != null && typeof span.is_error !== 'boolean')) fail();
    const spanId = identity(span.span_id), parentId = identity(span.parent_span_id);
    const sessionId = identity(span.session_id), resourceId = identity(span.resource_id);
    if (spanId !== null) { if (ids.has(spanId)) fail(); ids.add(spanId); }
    if (expected) {
      if (sessionId === null || resourceId === null) missing = true;
      if ((sessionId !== null && sessionId !== expected.sessionId) || (resourceId !== null && resourceId !== expected.resourceId)) conflict = true;
    }
    return Object.freeze({index, spanRef:ref(spanId), parentSpanRef:ref(parentId),
      sessionRef:ref(sessionId), resourceRef:ref(resourceId), startTimeMs:number(span.start_time),
      durationMs:number(span.duration), tokens:number(span.tokens), inputTokens:number(span.input_tokens),
      outputTokens:number(span.output_tokens), isError:span.is_error ?? null});
  });
  if (body.total < spans.length) fail();
  const status = !expected ? 'not_checked' : expected.requestId !== traceId || conflict ? 'mismatch'
    : spans.length === 0 || missing ? 'unknown' : 'exact_id_match';
  return Object.freeze({formatVersion:'1.0.0', surface:'ShowOpsTrace', region:'cn-southwest-2',
    traceRef:ref(traceId), total:body.total, returnedSpanCount:spans.length,
    coverage:body.total === spans.length ? 'complete' : 'partial', spans:Object.freeze(spans),
    requestCorrelation:Object.freeze({status, basis:'trace_id+session_id+resource_id',
      scope:'returned_spans', snapshotTrust:'caller_supplied', requestRef:expected ? ref(expected.requestId) : null}),
    deploymentVersion:'unavailable', cost:'unavailable', usageAggregation:'not_performed'});
}

/** One page of actual platform logs, with content/labels/line IDs withheld.
 * A scoped log query does not establish an invocation/deployment/trace join.
 */
export function projectRunLogObservation(body) {
  try { return runLogObservation(body); }
  catch (error) { throw errors.has(error) ? error : failure('EXTERNAL_FAILURE'); }
}

function runLogObservation(body) {
  body = record(body);
  if (number(body.count) === null || body.count > 1_000_000 || typeof body.is_query_complete !== 'boolean') fail();
  if (body.scroll_id != null && (typeof body.scroll_id !== 'string' || body.scroll_id.length > 64)) fail();
  const logs = dense(body.logs).map((raw, index) => {
    const log = record(raw);
    if (typeof log.content !== 'string' || typeof log.line_num !== 'string' || log.line_num.length > 64) fail();
    const labels = record(log.labels);
    if (Object.values(labels).some(value => typeof value !== 'string')) fail();
    return Object.freeze({index, lineRef:ref(log.line_num), contentSha256:digest(log.content),
      contentBytes:Buffer.byteLength(log.content, 'utf8'), labelCount:Object.keys(labels).length});
  });
  // The published example has count=10 but one log: keep both, never synthesize rows.
  if (body.count < logs.length) fail();
  return Object.freeze({formatVersion:'1.0.0', surface:'ListOpsAgentRunLog', region:'cn-southwest-2',
    count:body.count, returnedLogCount:logs.length, queryComplete:body.is_query_complete,
    hasContinuation:Boolean(body.scroll_id), logs:Object.freeze(logs),
    requestCorrelation:'not_checked', deploymentVersion:'unavailable', cost:'unavailable'});
}

/** Canonical restricted GET scope shared by the reader and optional SDK adapter. */
export function buildRunLogPath(value) {
  try {
    value = record(value);
    if (Object.keys(value).some(key => !['agentRunId','startTime','endTime','limit'].includes(key))
      || !id(value.agentRunId) || typeof value.startTime !== 'string' || typeof value.endTime !== 'string'
      || !/^\d{13}$/.test(value.startTime) || !/^\d{13}$/.test(value.endTime)
      || value.startTime > value.endTime || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 1000) fail();
    // Sorted query keys match the official SDK's canonical emitted path.
    return `/v1/ops/observation/agent-run/${value.agentRunId}/log?end_time=${value.endTime}&limit=${value.limit}&log_type=agent&start_time=${value.startTime}`;
  } catch { throw failure('INVALID_ARGUMENT'); }
}
