import {timingSafeEqual, randomUUID} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';
import {ProtocolError} from '@personal-agent/contracts';
import {ownedRequestPath} from './request-path.mjs';
import {
  AGENTARTS_TRANSPORT_VERSION,
  parseAgentArtsTransportFrame,
  encodeAgentArtsTransportFrame,
  digestAgentArtsPayload,
} from '@personal-agent/contracts/agentarts-transport';

const MAX_FRAME_BYTES = 1_200_000;
const MAX_BUFFERED_BYTES = 1_200_000;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const common = frame => ({protocolVersion:AGENTARTS_TRANSPORT_VERSION, sessionId:frame.sessionId,
  requestId:frame.requestId, idempotencyKey:frame.idempotencyKey, payloadDigest:frame.payloadDigest});
const failureCode = error => error instanceof ProtocolError
  && ['INVALID_ARGUMENT','UNAUTHORIZED','UNSUPPORTED_CAPABILITY','TIMEOUT','CANCELLED','RATE_LIMITED'].includes(error.code)
  ? error.code : 'EXTERNAL_FAILURE';

export function equalInboundToken(headers, token) {
  // An explicit invalid inner credential must not fall back to the outer IAM credential.
  const actual = headers['x-pa-agent-token'] ?? headers.authorization;
  if (typeof actual !== 'string') return false;
  const left = Buffer.from(actual), right = Buffer.from(`Bearer ${token}`);
  return left.length === right.length && timingSafeEqual(left,right);
}

/** Bounded transport receipts only. Runtime remains the durable task/evidence authority. */
export function attachAgentWebSocketTransport(server, {
  authToken, invoke, acquire, release, timeoutMs,
  maxConnections = 64, receiptLimit = 256, receiptTtlMs = 300_000, heartbeatMs = 15_000,
}) {
  for (const value of [maxConnections,receiptLimit,receiptTtlMs,heartbeatMs]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new ProtocolError('INVALID_ARGUMENT','Invalid WebSocket transport limit');
    }
  }
  if (authToken !== undefined && (typeof authToken !== 'string' || authToken.length < 32)) {
    throw new ProtocolError('INVALID_ARGUMENT','Invalid WebSocket credential configuration');
  }
  const serverInstanceId = randomUUID();
  const records = new Map();
  const connections = new Set();
  const wss = new WebSocketServer({noServer:true, maxPayload:MAX_FRAME_BYTES, perMessageDeflate:false});
  let closed = false;
  const removeExpired = () => {
    const cutoff = Date.now() - receiptTtlMs;
    for (const [key, record] of records) {
      if (record.state !== 'running' && record.finishedAt < cutoff) records.delete(key);
    }
  };
  const identity = frame => `${frame.sessionId}:${frame.idempotencyKey}`;
  const response = (frame, type, fields={}) => ({...common(frame),type,serverInstanceId,...fields});
  const assertBound = (record, frame) => {
    if (record.requestId !== frame.requestId || record.payloadDigest !== frame.payloadDigest
      || (frame.type === 'invoke' && record.deadline !== frame.deadline)) {
      throw new ProtocolError('INVALID_ARGUMENT','Transport identity conflicts with original invocation');
    }
  };
  const lookup = frame => {
    removeExpired();
    const record = records.get(identity(frame));
    if (record) assertBound(record,frame);
    return record;
  };
  const status = frame => {
    const record = lookup(frame);
    return response(frame,'status',{state:record?.state ?? 'unknown',
      ...(record?.events ? {events:record.events} : {}), ...(record?.code ? {code:record.code} : {})});
  };
  const send = (connection, frame) => {
    if (connection.readyState !== WebSocket.OPEN) return;
    if (connection.bufferedAmount > MAX_BUFFERED_BYTES) {
      connection.terminate();
      return;
    }
    try { connection.send(encodeAgentArtsTransportFrame(frame)); }
    catch { connection.close(1011,'Transport response invalid'); }
  };
  const terminal = record => record.events
    ? response(record,'result',{events:record.events})
    : response(record,'error',{code:record.code,accepted:true});
  const cancelRecord = record => {
    if (record?.state === 'running') {
      record.controller.abort(new ProtocolError('CANCELLED','Invocation cancelled'));
    }
  };
  const run = async record => {
    const expiresAt = Math.min(Date.parse(record.deadline),Date.now()+timeoutMs);
    let timer, abortListener;
    try {
      const cancelled = new Promise((_,reject) => {
        abortListener = () => reject(record.controller.signal.reason);
        record.controller.signal.addEventListener('abort',abortListener,{once:true});
        if (record.controller.signal.aborted) abortListener();
      });
      const expired = new Promise((_,reject) => {
        timer = setTimeout(() => {
          const error = new ProtocolError('TIMEOUT','Invocation deadline expired');
          record.controller.abort(error); reject(error);
        },Math.max(1,expiresAt-Date.now()));
      });
      const events = await Promise.race([
        Promise.resolve().then(() => invoke({payload:record.payload,
          deadline:new Date(expiresAt).toISOString(),signal:record.controller.signal,
          sessionId:record.sessionId,requestId:record.requestId})), cancelled, expired,
      ]);
      if (record.controller.signal.aborted) throw record.controller.signal.reason;
      if (Date.now() >= expiresAt) throw new ProtocolError('TIMEOUT','Invocation deadline expired');
      try { encodeAgentArtsTransportFrame(response(record,'result',{events})); }
      catch { throw new ProtocolError('EXTERNAL_FAILURE','Agent output does not match transport contract'); }
      record.events = events;
      record.state = 'completed';
    } catch (error) {
      record.code = failureCode(error);
      record.state = record.code === 'CANCELLED' ? 'cancelled' : 'failed';
    } finally {
      clearTimeout(timer);
      record.controller.signal.removeEventListener('abort',abortListener);
      record.finishedAt = Date.now();
      record.owner.ownedInvocations.delete(record);
      delete record.payload;
      release();
      for (const connection of record.listeners) send(connection,terminal(record));
      record.listeners.clear();
    }
  };
  const handle = (connection, frame) => {
    if (Object.hasOwn(frame,'serverInstanceId')) {
      throw new ProtocolError('INVALID_ARGUMENT','Server transport message cannot be submitted by client');
    }
    if (frame.sessionId !== connection.sessionId) {
      throw new ProtocolError('UNAUTHORIZED','Transport session does not match authenticated connection');
    }
    if (frame.type === 'status') return send(connection,status(frame));
    if (frame.type === 'cancel') {
      const record = lookup(frame);
      cancelRecord(record);
      // running is honest until the bounded invocation race acknowledges cancellation.
      return send(connection,status(frame));
    }
    if (frame.type !== 'invoke') throw new ProtocolError('INVALID_ARGUMENT','Client transport message unsupported');
    if (digestAgentArtsPayload(frame.payload) !== frame.payloadDigest) {
      throw new ProtocolError('INVALID_ARGUMENT','Invocation payload digest mismatch');
    }
    const existing = lookup(frame);
    if (existing) {
      // Replaying admission preserves the same accepted -> terminal event order as a fresh call.
      send(connection,response(existing,'accepted',{deadline:existing.deadline}));
      if (existing.state === 'running') {
        existing.listeners.add(connection);
      } else send(connection,terminal(existing));
      return;
    }
    if (Date.parse(frame.deadline) <= Date.now()) throw new ProtocolError('TIMEOUT','Invocation deadline expired');
    if (records.size >= receiptLimit || !acquire()) throw new ProtocolError('RATE_LIMITED','Transport invocation limit reached');
    const record = {...common(frame),deadline:frame.deadline,payload:frame.payload,state:'running',
      controller:new AbortController(),listeners:new Set([connection]),owner:connection,finishedAt:undefined};
    records.set(identity(frame),record);
    connection.ownedInvocations.add(record);
    send(connection,response(record,'accepted',{deadline:record.deadline}));
    void run(record);
  };
  wss.on('connection',(connection,request) => {
    connection.sessionId = request.headers['x-hw-agentarts-session-id'];
    connection.ownedInvocations = new Set();
    connection.alive = true;
    connections.add(connection);
    connection.on('pong',() => {connection.alive = true;});
    connection.on('error',() => { /* Never echo provider/request data. Close handles cancellation. */ });
    connection.on('message',(bytes,isBinary) => {
      if (isBinary) return connection.close(1003,'Text frames required');
      let frame;
      try {
        frame = parseAgentArtsTransportFrame(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
        handle(connection,frame);
      } catch (error) {
        if (!frame || !['invoke','status','cancel'].includes(frame.type)) {
          return connection.close(1008,'Invalid transport frame');
        }
        send(connection,response(frame,'error',{code:failureCode(error),accepted:false}));
      }
    });
    connection.once('close',() => {
      connections.delete(connection);
      for (const record of connection.ownedInvocations) cancelRecord(record);
      connection.ownedInvocations.clear();
      for (const record of records.values()) record.listeners.delete(connection);
    });
    send(connection,{protocolVersion:AGENTARTS_TRANSPORT_VERSION,type:'ready',serverInstanceId,
      capabilities:['invoke','status','cancel','ephemeral-replay'],restartRecovery:false,heartbeatMs});
  });
  const rejectUpgrade = (socket,status,reason) => {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const upgrade = (request,socket,head) => {
    if (request.method !== 'GET' || ownedRequestPath(request.url) !== '/ws') return rejectUpgrade(socket,404,'Not Found');
    if (closed || authToken === undefined) return rejectUpgrade(socket,503,'Service Unavailable');
    if (!equalInboundToken(request.headers,authToken)) return rejectUpgrade(socket,401,'Unauthorized');
    if (!safeId(request.headers['x-hw-agentarts-session-id'])) return rejectUpgrade(socket,400,'Bad Request');
    if (connections.size >= maxConnections) return rejectUpgrade(socket,429,'Too Many Requests');
    wss.handleUpgrade(request,socket,head,connection => wss.emit('connection',connection,request));
  };
  server.on('upgrade',upgrade);
  const heartbeat = setInterval(() => {
    removeExpired();
    for (const connection of connections) {
      if (!connection.alive) {connection.terminate(); continue;}
      connection.alive = false;
      connection.ping();
    }
  },heartbeatMs);
  heartbeat.unref();
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const record of records.values()) cancelRecord(record);
    for (const connection of connections) connection.terminate();
    wss.close();
    server.removeListener('upgrade',upgrade);
  };
  server.once('close',close);
  return {
    serverInstanceId,
    close,
    status(frame,headers) {
      if (authToken === undefined) throw new ProtocolError('UNSUPPORTED_CAPABILITY','WebSocket transport disabled');
      if (!equalInboundToken(headers,authToken)) throw new ProtocolError('UNAUTHORIZED','Transport credential required');
      const parsed = parseAgentArtsTransportFrame(frame);
      if (parsed.type !== 'status' || Object.hasOwn(parsed,'serverInstanceId') || !safeId(headers['x-hw-agentarts-session-id'])
        || parsed.sessionId !== headers['x-hw-agentarts-session-id']) {
        throw new ProtocolError('INVALID_ARGUMENT','Status identity invalid');
      }
      return parseAgentArtsTransportFrame(status(parsed));
    },
  };
}
