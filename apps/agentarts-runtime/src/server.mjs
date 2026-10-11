import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {attachAgentWebSocketTransport, equalInboundToken} from './websocket-transport.mjs';

const MAX_BYTES = 1_200_000;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const json = (response, status, data) => {
  response.writeHead(status, {'content-type':'application/json; charset=utf-8', 'cache-control':'no-store'});
  response.end(JSON.stringify(data));
};
function parsePayload(payload, workflowGoalInput) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ProtocolError('INVALID_ARGUMENT','Invalid invocation payload');
  const keys = Object.keys(payload);
  let query;
  if (keys.length === 1 && keys[0] === 'query') query = payload.query;
  else if (keys.length === 1 && keys[0] === 'inputs' && workflowGoalInput
    && payload.inputs && typeof payload.inputs === 'object' && !Array.isArray(payload.inputs)
    && Object.keys(payload.inputs).length === 1 && Object.hasOwn(payload.inputs,workflowGoalInput)) query = payload.inputs[workflowGoalInput];
  if (typeof query !== 'string' || !query.trim()) throw new ProtocolError('INVALID_ARGUMENT','Invalid invocation query');
  return query;
}
/** Both modes serve the same code. Only trusted startup selects mode/authentication. */
export function createAgentServer({orchestrator, mode, authToken, wssAuthToken = authToken, workflowGoalInput,
  timeoutMs = 60_000, maxConcurrency = 8, websocket = {}}) {
  if (!['agentarts','standalone-validation'].includes(mode)
    || !orchestrator || typeof orchestrator.invoke !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647
    || !Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1
    || (authToken !== undefined && (typeof authToken !== 'string' || authToken.length < 32))) {
    throw new ProtocolError('INVALID_ARGUMENT','Invalid server configuration');
  }
  let active = 0;
  let closing = false;
  const httpControllers = new Set();
  const acquire = () => {
    if (active >= maxConcurrency) return false;
    active++; return true;
  };
  const release = () => {active--;};
  const invoke = async ({payload,deadline,signal,sessionId,requestId}) => {
    const query = parsePayload(payload,workflowGoalInput);
    signal.throwIfAborted();
    const result = await orchestrator.invoke({query,deadline,signal,sessionId,requestId});
    signal.throwIfAborted();
    if (Date.now() >= Date.parse(deadline)) throw new ProtocolError('TIMEOUT','Invocation deadline expired');
    const text = JSON.stringify(result);
    if (Buffer.byteLength(text)>64_000) throw new ProtocolError('EXTERNAL_FAILURE','Agent output exceeds limit');
    return [{event:'message',data:{text}},{event:'task_end'},{event:'end'}];
  };
  let transport;
  const server = createServer(async (request,response) => {
    if (closing) return json(response,499,{event:'error',data:{error_code:'CANCELLED',status:'failed'}});
    if (request.method === 'GET' && request.url === '/ping') {
      return json(response,200,{status:active ? 'HealthyBusy':'Healthy', time_of_last_update:Math.floor(Date.now()/1000)});
    }
    const statusRequest = request.method === 'POST' && request.url === '/invocation-status';
    if (!statusRequest && (request.method !== 'POST' || request.url !== '/invocations')) return json(response,404,{error:{code:'NOT_FOUND'}});
    const innerCredential = request.headers['x-pa-agent-token'] !== undefined;
    const inboundToken = statusRequest || innerCredential ? wssAuthToken : authToken;
    if (statusRequest && inboundToken === undefined) return json(response,503,{error:{code:'UNSUPPORTED_CAPABILITY'}});
    if (inboundToken !== undefined && !equalInboundToken(request.headers,inboundToken)) return json(response,401,{error:{code:'UNAUTHORIZED'}});
    const invocationSlot = !statusRequest;
    if (invocationSlot && !acquire()) return json(response,429,{error:{code:'RATE_LIMITED'}});
    const controller = new AbortController();
    httpControllers.add(controller);
    const abort = () => { if (!response.writableEnded) controller.abort(new ProtocolError('CANCELLED','Invocation disconnected')); };
    request.once('aborted',abort); response.once('close',abort);
    const receivedAt = Date.now();
    let expiresAt = receivedAt + timeoutMs;
    let timer;
    let cancel;
    try {
      const supplied = request.headers['x-pa-deadline'];
      if (supplied !== undefined) {
        if (typeof supplied !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(supplied)
          || !Number.isFinite(Date.parse(supplied))) throw new ProtocolError('INVALID_ARGUMENT','Invalid invocation deadline');
        expiresAt = Math.min(expiresAt,Date.parse(supplied));
      }
      if (expiresAt <= Date.now()) throw new ProtocolError('TIMEOUT','Invocation deadline expired');
      // Covers uploads, non-cooperative providers and serialization, not only model calls.
      const expired = new Promise((_,reject) => {
        timer = setTimeout(() => {const error = new ProtocolError('TIMEOUT','Invocation deadline expired'); controller.abort(error); reject(error);}, expiresAt-Date.now());
      });
      const cancelled = new Promise((_,reject) => {
        cancel = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort',cancel,{once:true});
        if (controller.signal.aborted) cancel();
      });
      const execute = async () => {
        if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new ProtocolError('INVALID_ARGUMENT','JSON content type required');
        const chunks = []; let size = 0;
        for await (const chunk of request) {
          controller.signal.throwIfAborted();
          size += chunk.length;
          if (size > MAX_BYTES) throw new ProtocolError('INVALID_ARGUMENT','Invocation exceeds body limit');
          chunks.push(chunk);
        }
        controller.signal.throwIfAborted();
        let payload;
        try { payload = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
        catch { throw new ProtocolError('INVALID_ARGUMENT','Invalid invocation JSON'); }
        if (statusRequest) return transport.status(payload,request.headers);
        const incomingSession = request.headers['x-hw-agentarts-session-id'];
        const incomingId = request.headers['x-request-id'];
        if ((incomingSession !== undefined && !safeId(incomingSession)) || (incomingId !== undefined && !safeId(incomingId))) throw new ProtocolError('INVALID_ARGUMENT','Invalid request correlation');
        return invoke({payload,deadline:new Date(expiresAt).toISOString(),signal:controller.signal,
          sessionId:incomingSession ?? `pa-${randomUUID()}`,requestId:incomingId ?? randomUUID()});
      };
      const result = await Promise.race([execute(),expired,cancelled]);
      if (!response.destroyed) json(response,200,result);
    } catch (error) {
      const code = error instanceof ProtocolError && ['INVALID_ARGUMENT','UNAUTHORIZED','UNSUPPORTED_CAPABILITY','TIMEOUT','CANCELLED','RATE_LIMITED'].includes(error.code)
        ? error.code : 'EXTERNAL_FAILURE';
      if (!response.destroyed) json(response,code==='INVALID_ARGUMENT'?400:code==='TIMEOUT'?504:code==='CANCELLED'?499:502,
        {event:'error',data:{error_code:code,status:'failed'}});
    } finally {
      httpControllers.delete(controller);
      clearTimeout(timer); if (cancel) controller.signal.removeEventListener('abort',cancel);
      request.removeListener('aborted',abort); response.removeListener('close',abort);
      if (invocationSlot) release();
      if (closing && !request.complete) {
        // Flush the cancellation response before terminating a withheld upload.
        // Otherwise close waits forever after the invocation timer is cleared.
        if (response.destroyed || response.writableFinished) request.destroy();
        else response.once('finish',() => request.destroy());
      }
    }
  });
  server.requestTimeout = timeoutMs;
  server.headersTimeout = Math.min(timeoutMs,60_000);
  transport = attachAgentWebSocketTransport(server,{...websocket,authToken:wssAuthToken,invoke,acquire,release,timeoutMs});
  // Node HTTP close does not close upgraded sockets. Stop them before awaiting close.
  const closeHttp = server.close.bind(server);
  server.close = (...args) => {
    closing = true;
    for (const controller of httpControllers) {
      controller.abort(new ProtocolError('CANCELLED','Agent server closed'));
    }
    transport.close();
    return closeHttp(...args);
  };
  return server;
}
