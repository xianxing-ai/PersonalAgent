// Optional manual adapter: importing/factory construction performs no I/O.
// The caller supplies the trusted official APIG SDK and authorizes credentials
// for this exact request. It does not replace the reader's deadline/abort race.
import {buildRunLogPath} from '@personal-agent/agentarts/observability';
const HOST = 'agentarts.cn-southwest-2.myhuaweicloud.com';
const PREFIX = `https://${HOST}/v1/ops/observation/traces/`;
const UNSIGNED = Object.freeze({Host: HOST, 'Content-Type': 'application/json', Accept: 'application/json'});
const ALLOWED_HEADERS = new Set(['host', 'content-type', 'accept', 'authorization', 'x-sdk-date', 'x-security-token']);
const OWN_ERRORS = new WeakSet();

function failure(code) {
  const error = Object.freeze(Object.assign(new Error(`AgentArts trace signing failed: ${code}`), {code}));
  OWN_ERRORS.add(error);
  return error;
}

function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('INVALID_ARGUMENT');
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
      || (allowed && !allowed.includes(key))) throw failure('INVALID_ARGUMENT');
    Object.defineProperty(result, key, {value: descriptor.value, enumerable: true});
  }
  return result;
}

function text(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);
}

function check(request) {
  if (request.signal.aborted) throw failure('CANCELLED');
  if (Date.now() >= Date.parse(request.deadline)) throw failure('TIMEOUT');
}

function requestInput(value, allowLogs) {
  const request = fields(value, ['url', 'method', 'body', 'headers', 'deadline', 'signal']);
  if (typeof request.url !== 'string' || !allowedUrl(request.url, allowLogs)
    || request.method !== 'GET' || request.body !== '' || !(request.signal instanceof AbortSignal)
    || typeof request.deadline !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(request.deadline)) throw failure('INVALID_ARGUMENT');
  const expiresAt = Date.parse(request.deadline);
  if (!Number.isFinite(expiresAt)
    || request.deadline.replace(/\.000Z$/, 'Z') !== new Date(expiresAt).toISOString().replace(/\.000Z$/, 'Z')
    || expiresAt - Date.now() > 2_147_483_647) throw failure('INVALID_ARGUMENT');
  const headers = fields(request.headers, Object.keys(UNSIGNED));
  if (Object.keys(headers).length !== 3
    || Object.entries(UNSIGNED).some(([key, content]) => headers[key] !== content)) throw failure('INVALID_ARGUMENT');
  const copy = Object.freeze({...request, headers: Object.freeze(headers)});
  check(copy);
  return copy;
}

function allowedUrl(url, allowLogs) {
  if (url.startsWith(PREFIX) && /^[A-Za-z0-9_-]{1,64}$/.test(url.slice(PREFIX.length))) return true;
  if (!allowLogs) return false;
  try {
    const parsed = new URL(url), match = parsed.pathname.match(/^\/v1\/ops\/observation\/agent-run\/([A-Za-z0-9_-]{1,64})\/log$/);
    if (!match) return false;
    const query = parsed.searchParams;
    const path = buildRunLogPath({agentRunId:match[1], startTime:query.get('start_time'),
      endTime:query.get('end_time'), limit:Number(query.get('limit'))});
    return url === `https://${HOST}${path}`;
  } catch { return false; }
}

function resultHeaders(value, token) {
  const headers = fields(value);
  const normalized = {};
  for (const [name, content] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (!ALLOWED_HEADERS.has(key) || Object.hasOwn(normalized, key) || !text(content)) throw failure('EXTERNAL_FAILURE');
    normalized[key] = content;
  }
  if (Object.entries(UNSIGNED).some(([name, content]) => normalized[name.toLowerCase()] !== content)
    || !/^SDK-(?:HMAC|ECDSA)-[A-Za-z0-9_-]+ .+/.test(normalized.authorization ?? '')
    || !/^\d{8}T\d{6}Z$/.test(normalized['x-sdk-date'] ?? '')
    || normalized['x-security-token'] !== token) throw failure('EXTERNAL_FAILURE');
  // The optional session token must enter the SDK request before signing.
  const signed = normalized.authorization.match(/(?:^|,\s*)SignedHeaders=([^,]+)/)?.[1];
  const names = Object.keys(normalized).filter(name => name !== 'authorization').sort().join(';');
  if (signed !== names) throw failure('EXTERNAL_FAILURE');
  return Object.freeze(headers);
}

function sdkScope(request, path) {
  const parsed = new URL(`https://${HOST}${path}`), expected = Object.fromEntries(parsed.searchParams);
  const query = fields(request.query);
  if (request.host !== HOST || request.uri !== parsed.pathname || request.method !== 'GET'
    || request.body !== '' || Object.keys(query).length !== Object.keys(expected).length
    || Object.entries(expected).some(([key, value]) => !Array.isArray(query[key]) || query[key].length !== 1 || query[key][0] !== value)) throw failure('EXTERNAL_FAILURE');
}

/**
 * Creates only the existing readAgentArtsTrace authorize callback. sdk must be
 * the explicitly trusted official module with HttpRequest and Signer exports;
 * readCredentials(request) is the trusted per-request authorization/credential
 * callback, returning {accessKey, secretKey, securityToken?} or no credentials.
 * No SDK download/import, credential discovery/cache, network or retry occurs.
 * The official CanonicalURI may add a signing slash; the transport path stays
 * exactly the reader's URL. No query/filter or region scope is added here.
 */
export function createAgentArtsTraceAuthorizer(options) {
  return createAuthorizer(options, false);
}

/** Explicitly opt in to the restricted trace + agent-run log GET scopes. */
export function createAgentArtsObservationAuthorizer(options) {
  return createAuthorizer(options, true);
}

function createAuthorizer(options, allowLogs) {
  let HttpRequest, Signer, readCredentials;
  try {
    const input = fields(options, ['sdk', 'readCredentials']);
    HttpRequest = Object.getOwnPropertyDescriptor(input.sdk, 'HttpRequest')?.value;
    Signer = Object.getOwnPropertyDescriptor(input.sdk, 'Signer')?.value;
    readCredentials = input.readCredentials;
    if (typeof HttpRequest !== 'function' || typeof Signer !== 'function'
      || typeof readCredentials !== 'function') throw failure('INVALID_ARGUMENT');
  } catch (error) {
    throw OWN_ERRORS.has(error) ? error : failure('INVALID_ARGUMENT');
  }
  return async function authorize(value) {
    let request;
    let signer;
    try {
      request = requestInput(value, allowLogs);
      const supplied = await readCredentials(request);
      check(request);
      if (supplied === undefined || supplied === null) throw failure('UNAUTHORIZED');
      const credentials = fields(supplied, ['accessKey', 'secretKey', 'securityToken']);
      if (!text(credentials.accessKey) || !text(credentials.secretKey)
        || (credentials.securityToken !== undefined && !text(credentials.securityToken))) throw failure('UNAUTHORIZED');
      const headers = {...request.headers};
      if (credentials.securityToken !== undefined) headers['X-Security-Token'] = credentials.securityToken;
      const expectedHeaders = {...headers};
      const sdkRequest = new HttpRequest(request.method, request.url, headers, request.body);
      const path = request.url.slice(`https://${HOST}`.length);
      sdkScope(sdkRequest, path);
      const prepared = fields(sdkRequest.headers);
      if (Object.keys(prepared).length !== Object.keys(expectedHeaders).length
        || Object.entries(expectedHeaders).some(([name, content]) => prepared[name] !== content)) throw failure('EXTERNAL_FAILURE');
      signer = new Signer();
      signer.Key = credentials.accessKey;
      signer.Secret = credentials.secretKey;
      check(request);
      const signed = fields(signer.Sign(sdkRequest), ['hostname', 'path', 'method', 'headers']);
      check(request);
      if (signed.hostname !== HOST || signed.path !== path || signed.method !== request.method) throw failure('EXTERNAL_FAILURE');
      sdkScope(sdkRequest, path);
      const result = resultHeaders(signed.headers, credentials.securityToken);
      // A signer returning a separate header object cannot hide mutated inputs.
      resultHeaders(sdkRequest.headers, credentials.securityToken);
      check(request);
      return result;
    } catch (error) {
      if (request) check(request);
      throw OWN_ERRORS.has(error) ? error : failure('EXTERNAL_FAILURE');
    } finally {
      // Best effort only: the injected SDK is trusted, not a secret-storage API.
      if (signer) {
        try { signer.Key = ''; signer.Secret = ''; } catch { /* Never expose SDK errors. */ }
      }
    }
  };
}
