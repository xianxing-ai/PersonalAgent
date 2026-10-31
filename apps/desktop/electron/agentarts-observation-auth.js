import {createHash, createHmac} from 'node:crypto';

const HOST = 'agentarts.cn-southwest-2.myhuaweicloud.com';
const ORIGIN = `https://${HOST}`;
const TRACE = /^\/v1\/ops\/observation\/traces\/[A-Za-z0-9_-]{1,64}$/;
const RUN_LOG = /^\/v1\/ops\/observation\/agent-run\/[A-Za-z0-9_-]{1,64}\/log$/;
const ACCESS_KEY = /^[A-Za-z0-9]{10,128}$/;
const SECRET = value => typeof value === 'string' && value.length >= 16 && value.length <= 256
  && !/[\r\n\0]/.test(value);
const TOKEN = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);
const UNSIGNED = Object.freeze({
  Host: HOST,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

const hash = value => createHash('sha256').update(value).digest('hex');

function encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(searchParams) {
  const pairs = [];
  for (const key of [...new Set(searchParams.keys())].sort()) {
    const values = searchParams.getAll(key).map(String).sort();
    for (const value of values) pairs.push(`${encode(key)}=${encode(value)}`);
  }
  return pairs.join('&');
}

/**
 * Trusted main-process only. Signs AgentArts observation GETs with SDK-HMAC-SHA256.
 * Scope is limited to published cn-southwest-2 ShowOpsTrace / ListOpsAgentRunLog URLs.
 * Never accepts or emits invoke Bearer tokens.
 * https://support.huaweicloud.com/devg-apisign/api-sign-algorithm-001.html
 */
export function createAgentArtsObservationRequestAuth(
  {accessKey, secretKey, securityToken} = {},
  {now = Date.now} = {},
) {
  if (!ACCESS_KEY.test(accessKey) || !SECRET(secretKey)
    || (securityToken !== undefined && !TOKEN(securityToken))) {
    throw Error('AgentArts observation signing configuration is invalid');
  }
  return {
    async authorize(request) {
      const timestamp = now();
      if (!(request?.signal instanceof AbortSignal) || request.signal.aborted) {
        throw Error('AgentArts observation signing request cancelled');
      }
      if (!Number.isFinite(Date.parse(request.deadline)) || Date.parse(request.deadline) <= timestamp) {
        throw Error('AgentArts observation signing request expired');
      }
      if (!request || request.method !== 'GET' || request.body !== ''
        || typeof request.url !== 'string') {
        throw Error('AgentArts observation signing request is outside the configured scope');
      }
      let target;
      try { target = new URL(request.url); } catch {
        throw Error('AgentArts observation signing request is outside the configured scope');
      }
      if (target.origin !== ORIGIN || target.username || target.password || target.hash
        || !(TRACE.test(target.pathname) || RUN_LOG.test(target.pathname))
        || (TRACE.test(target.pathname) && target.search)
        || Object.entries(UNSIGNED).some(([name, value]) => request.headers?.[name] !== value)
        || Object.keys(request.headers ?? {}).length !== 3) {
        throw Error('AgentArts observation signing request is outside the configured scope');
      }
      const date = new Date(timestamp).toISOString().replace(/[:-]|\.\d{3}/g, '');
      const headerMap = {
        accept: 'application/json',
        'content-type': 'application/json',
        host: HOST,
        'x-sdk-date': date,
        ...(securityToken === undefined ? {} : {'x-security-token': securityToken}),
      };
      const signedNames = Object.keys(headerMap).sort();
      const signedHeaders = signedNames.join(';');
      const canonicalHeaders = signedNames.map(name => `${name}:${headerMap[name]}\n`).join('');
      // Official CanonicalURI may add a trailing slash for signing only.
      const canonical = [
        'GET',
        `${target.pathname}/`,
        canonicalQuery(target.searchParams),
        canonicalHeaders,
        signedHeaders,
        hash(''),
      ].join('\n');
      const signature = createHmac('sha256', secretKey)
        .update(`SDK-HMAC-SHA256\n${date}\n${hash(canonical)}`).digest('hex');
      return {
        Host: HOST,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `SDK-HMAC-SHA256 Access=${accessKey}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'X-Sdk-Date': date,
        ...(securityToken === undefined ? {} : {'X-Security-Token': securityToken}),
      };
    },
  };
}

/**
 * Build createAgentArtsRuntimeApplication observation options from trusted settings.
 * Absent credentials keep observation explicitly unavailable — never Fake, never Bearer.
 */
export function resolveDesktopAgentArtsObservation(configuration, {
  createAuthorizer = createAgentArtsObservationRequestAuth,
} = {}) {
  if (!configuration || typeof configuration.readCredentials !== 'function'
    || typeof configuration.readApplicationId !== 'function') {
    return undefined;
  }
  const credentials = configuration.readCredentials();
  const applicationId = configuration.readApplicationId();
  if (!credentials && applicationId === undefined) return undefined;
  return Object.freeze({
    ...(credentials ? {observationAuthorization: createAuthorizer(credentials)} : {}),
    ...(applicationId === undefined ? {} : {observationApplicationId: applicationId}),
  });
}
