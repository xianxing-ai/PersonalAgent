import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {attachAgentWebSocketTransport, equalInboundToken} from './websocket-transport.mjs';
import {createBindingDispatcher} from './binding-dispatch.mjs';
import {ownedRequestPath} from './request-path.mjs';
import {createStageTimeline} from './stage-timeline.mjs';

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
  getBindings, defaultControllerId, testVersionController, serviceControllers = {}, realtimeProxy, executionModels, onStageRecord, timeoutMs = 60_000, maxConcurrency = 8, websocket = {}}) {
  if (!['agentarts','standalone-validation'].includes(mode)
    || !orchestrator || typeof orchestrator.invoke !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647
    || !Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1
    || (authToken !== undefined && (typeof authToken !== 'string' || authToken.length < 32))) {
    throw new ProtocolError('INVALID_ARGUMENT','Invalid server configuration');
  }
  const bindings = createBindingDispatcher({orchestrator,getBindings,defaultControllerId});
  if (!serviceControllers || typeof serviceControllers !== 'object' || Array.isArray(serviceControllers)
    || Object.keys(serviceControllers).some(key=>!['shadowVersion','platformVersion','proactiveVersion'].includes(key)
      || typeof serviceControllers[key]!=='function')) throw new ProtocolError('INVALID_ARGUMENT','Invalid service controller configuration');
  let active = 0;
  let closing = false;
  const httpControllers = new Set();
  const httpUploads = new Map();
  const httpSockets = new Set();
  const httpResponses = new Map();
  const endSocket = socket => {
    if (![...httpResponses.values()].includes(socket)) socket.destroy();
  };
  const endUpload = (request,response) => {
    if (request.complete) return;
    if (response.destroyed || response.writableFinished) request.destroy();
    else response.once('finish',() => request.destroy());
  };
  const acquire = () => {
    if (active >= maxConcurrency) return false;
    active++; return true;
  };
  const release = () => {active--;};
  const invoke = async ({payload,deadline,signal,sessionId,requestId,bindingAuthorized=false,channel='http'}) => {
    const timeline=createStageTimeline({onRecord:onStageRecord});
    return timeline.run('invocation.dispatch',async()=>{
    const query = parsePayload(payload,workflowGoalInput);
    signal.throwIfAborted();
    let testValue;
    let catalogValue;
    let serviceValue,serviceName;
    try {
      const parsed=JSON.parse(query);
      if(parsed && typeof parsed==='object' && !Array.isArray(parsed)) {
        if(Object.hasOwn(parsed,'modelCatalogVersion'))catalogValue=parsed;
        const names=['shadowVersion','platformVersion','proactiveVersion','testVersion'].filter(key=>Object.hasOwn(parsed,key));
        if(names.length>1) throw new ProtocolError('INVALID_ARGUMENT','Multiple service protocols');
        if(names[0]==='testVersion')testValue=parsed;
        else if(names.length){serviceName=names[0];serviceValue=parsed;}
      }
    }catch(error){if(error instanceof ProtocolError)throw error;}
    if(catalogValue){
      if(!bindingAuthorized)throw new ProtocolError('UNAUTHORIZED','Model directory host credential required');
      if(Object.keys(catalogValue).length!==2||catalogValue.modelCatalogVersion!=='1.0'||catalogValue.action!=='list')throw new ProtocolError('INVALID_ARGUMENT','Invalid model directory query');
      if(!executionModels)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Model directory unavailable');
      return [{event:'message',data:{text:JSON.stringify(executionModels.catalog())}},{event:'task_end'},{event:'end'}];
    }
    const binding = testValue||serviceValue?undefined:bindings.parse(query);
    if(testValue&&(!testVersionController||!bindingAuthorized))
      throw new ProtocolError(testVersionController?'UNAUTHORIZED':'UNSUPPORTED_CAPABILITY','Test version requires explicit host configuration and credential');
    if (binding && !bindingAuthorized) throw new ProtocolError('UNAUTHORIZED','Owned binding credential required');
    if (serviceValue && !bindingAuthorized) throw new ProtocolError('UNAUTHORIZED','Service host credential required');
    if (serviceValue && !serviceControllers[serviceName]) throw new ProtocolError('UNSUPPORTED_CAPABILITY','Service controller unavailable');
    const invocation = {query,deadline,signal,sessionId,requestId};
    const result = serviceValue ? await serviceControllers[serviceName]({...invocation,value:serviceValue})
      : testValue ? await testVersionController({...invocation,value:testValue})
      : binding ? await bindings.invoke(invocation,binding) : await bindings.invokeDefault(invocation);
    signal.throwIfAborted();
    if (Date.now() >= Date.parse(deadline)) throw new ProtocolError('TIMEOUT','Invocation deadline expired');
    const text = JSON.stringify(result);
    const outputLimit = (binding?.workflow || serviceValue) && channel==='http' ? 1_100_000 : 64_000;
    if (Buffer.byteLength(text)>outputLimit) throw new ProtocolError('EXTERNAL_FAILURE','Agent output exceeds limit');
    return [{event:'message',data:{text}},{event:'task_end'},{event:'end'}];
    },{sessionId,requestId,channel});
  };
  let transport;
  const server = createServer(async (request,response) => {
    const route = ownedRequestPath(request.url);
    httpResponses.set(response,request.socket);
    response.once('finish',() => {
      httpResponses.delete(response);
      if (closing) endSocket(request.socket);
    });
    response.once('close',() => httpResponses.delete(response));
    httpUploads.set(request,response);
    request.once('close',() => httpUploads.delete(request));
    if (closing) {
      json(response,499,{event:'error',data:{error_code:'CANCELLED',status:'failed'}});
      return endUpload(request,response);
    }
    if (request.method === 'GET' && route === '/ping') {
      return json(response,200,{status:active ? 'HealthyBusy':'Healthy', time_of_last_update:Math.floor(Date.now()/1000)});
    }
    if (request.method === 'GET' && route === '/bindings') {
      if (wssAuthToken === undefined) return json(response,503,{error:{code:'UNSUPPORTED_CAPABILITY'}});
      if (!equalInboundToken(request.headers,wssAuthToken)) return json(response,401,{error:{code:'UNAUTHORIZED'}});
      try {return json(response,200,bindings.directory());}
      catch {return json(response,503,{error:{code:'UNSUPPORTED_CAPABILITY'}});}
    }
    const statusRequest = request.method === 'POST' && route === '/invocation-status';
    if (!statusRequest && (request.method !== 'POST' || route !== '/invocations')) return json(response,404,{error:{code:'NOT_FOUND'}});
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
          || !Number.isFinite(Date.parse(supplied))
          || supplied.replace(/\.000Z$/, 'Z') !== new Date(supplied).toISOString().replace(/\.000Z$/, 'Z')) throw new ProtocolError('INVALID_ARGUMENT','Invalid invocation deadline');
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
          sessionId:incomingSession ?? `pa-${randomUUID()}`,requestId:incomingId ?? randomUUID(),
          bindingAuthorized:wssAuthToken !== undefined && equalInboundToken(request.headers,wssAuthToken)});
      };
      const result = await Promise.race([execute(),expired,cancelled]);
      if (!response.destroyed) json(response,200,result);
    } catch (error) {
      const code = error instanceof ProtocolError && ['INVALID_ARGUMENT','UNAUTHORIZED','UNSUPPORTED_CAPABILITY','TIMEOUT','CANCELLED','RATE_LIMITED'].includes(error.code)
        ? error.code : 'EXTERNAL_FAILURE';
      if (!response.destroyed) json(response,code==='INVALID_ARGUMENT'?400:code==='UNAUTHORIZED'?401
        :code==='UNSUPPORTED_CAPABILITY'?503:code==='TIMEOUT'?504:code==='CANCELLED'?499:code==='RATE_LIMITED'?429:502,
        {event:'error',data:{error_code:code,status:'failed'}});
    } finally {
      httpControllers.delete(controller);
      clearTimeout(timer); if (cancel) controller.signal.removeEventListener('abort',cancel);
      request.removeListener('aborted',abort); response.removeListener('close',abort);
      if (invocationSlot) release();
      if (closing && !request.complete) {
        // Flush the cancellation response before terminating a withheld upload.
        // Otherwise close waits forever after the invocation timer is cleared.
        endUpload(request,response);
      }
    }
  });
  server.on('connection',socket => {
    httpSockets.add(socket);
    socket.once('close',() => httpSockets.delete(socket));
    if (closing) endSocket(socket);
  });
  server.requestTimeout = timeoutMs;
  server.headersTimeout = Math.min(timeoutMs,60_000);
  transport = attachAgentWebSocketTransport(server,{...websocket,realtimeProxy,authToken:wssAuthToken,
    invoke:value=>invoke({...value,bindingAuthorized:true,channel:'websocket'}),acquire,release,timeoutMs});
  // Node HTTP close does not close upgraded sockets. Stop them before awaiting close.
  const closeHttp = server.close.bind(server);
  server.close = (...args) => {
    closing = true;
    for (const controller of httpControllers) {
      controller.abort(new ProtocolError('CANCELLED','Agent server closed'));
    }
    for (const [request,response] of httpUploads) endUpload(request,response);
    const realtimeClosed=transport.close();
    for (const socket of httpSockets) endSocket(socket);
    if (typeof args[0]==='function') {
      const callback=args[0];return closeHttp(error=>{void realtimeClosed.then(()=>callback(error));});
    }
    return closeHttp(...args);
  };
  return server;
}
