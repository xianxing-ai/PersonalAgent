import {WebSocket} from 'ws';
import {ProtocolError} from '@personal-agent/contracts';

export const AGENTARTS_REALTIME_PROTOCOL = 'pa.realtime.v1';
export const AGENTARTS_REALTIME_MODEL = 'qwen3.8-omni-flash-realtime';
const MAX_FRAME_BYTES = 1_200_000;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const routingKeys = ['url','endpoint','baseUrl','base_url','apiKey','api_key','authorization','headers','workspaceId','workspace_id'];
const invalid = () => new ProtocolError('INVALID_ARGUMENT','Invalid trusted realtime configuration');

/** Startup-only configuration. No endpoint, key, audio or transcript enters logs or receipts. */
export function createAgentRealtimeProxy({workspaceId,apiKey,Socket=WebSocket,
  maxBufferedBytes=1_200_000,handshakeTimeoutMs=15_000,sessionTimeoutMs=120*60_000,closeTimeoutMs=1000}) {
  if (typeof workspaceId !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(workspaceId)
    || typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(apiKey)
    || typeof Socket !== 'function') throw invalid();
  for (const value of [maxBufferedBytes,handshakeTimeoutMs,sessionTimeoutMs,closeTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw invalid();
  }
  if (sessionTimeoutMs > 120*60_000) throw invalid();
  const endpoint = `wss://${workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=${AGENTARTS_REALTIME_MODEL}`;
  const frame = (raw,isBinary,fromClient) => {
    if (isBinary) throw Error('binary');
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (bytes.byteLength > MAX_FRAME_BYTES) throw Error('size');
    const value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if (!plain(value) || typeof value.type !== 'string' || !value.type || value.type.length > 128) throw Error('frame');
    if (fromClient) {
      // Session/tool data is still untrusted model input. Only transport routing/configuration is rejected here.
      for (const config of [value,value.session,value.response].filter(plain)) {
        if (routingKeys.some(key => Object.hasOwn(config,key))
          || config.model !== undefined && config.model !== AGENTARTS_REALTIME_MODEL) throw Error('routing');
      }
    }
    return bytes;
  };
  return {
    protocol:AGENTARTS_REALTIME_PROTOCOL,
    deadline(headers) {
      const value = headers['x-pa-deadline'];
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
        || !Number.isFinite(Date.parse(value))
        || value.replace(/\.000Z$/,'Z') !== new Date(value).toISOString().replace(/\.000Z$/,'Z')) {
        throw new ProtocolError('INVALID_ARGUMENT','Original realtime deadline required');
      }
      const expires = Math.min(Date.parse(value),Date.now()+sessionTimeoutMs);
      if (expires <= Date.now()) throw new ProtocolError('TIMEOUT','Realtime deadline expired');
      return new Date(expires).toISOString();
    },
    attach(connection,{deadline}) {
      let upstream,closing=false,downClosed=connection.readyState===WebSocket.CLOSED,upClosed=false;
      let pending=[],pendingBytes=0,deadlineTimer,closeTimer,resolveClosed;
      const closed = new Promise(resolve => {resolveClosed=resolve;});
      const finish = () => {
        if (!downClosed || !upClosed) return;
        clearTimeout(deadlineTimer); clearTimeout(closeTimer);
        pending=[]; pendingBytes=0; resolveClosed();
      };
      const terminate = socket => {try {socket?.terminate();} catch { /* No external error data. */ }};
      const stop = (code=1000,reason='Realtime stopped') => {
        if (!closing) {
          closing=true; clearTimeout(deadlineTimer); pending=[]; pendingBytes=0;
          closeTimer=setTimeout(() => {terminate(connection); terminate(upstream);},closeTimeoutMs);
          if (!downClosed) {
            try {connection.close(code,reason);} catch {terminate(connection);}
          }
          if (upstream && !upClosed) {
            if (upstream.readyState===WebSocket.OPEN) {
              try {upstream.close(1000,'Realtime stopped');} catch {terminate(upstream);}
            } else terminate(upstream);
          }
        }
        finish();
      };
      const live = () => {
        if (closing) return false;
        if (Date.now() >= Date.parse(deadline)) {stop(1008,'Realtime deadline expired');return false;}
        return true;
      };
      const send = (socket,bytes) => {
        if (!live()) return;
        if (socket.readyState!==WebSocket.OPEN || socket.bufferedAmount+bytes.byteLength > maxBufferedBytes) {
          stop(1013,'Realtime buffer limit reached');return;
        }
        try {socket.send(bytes,{binary:false},error => {if (error) stop(1011,'Realtime forwarding failed');});}
        catch {stop(1011,'Realtime forwarding failed');}
      };
      connection.on('error',() => stop(1011,'Realtime connection failed'));
      connection.once('close',() => {downClosed=true;stop();finish();});
      connection.on('message',(raw,isBinary) => {
        if (!live()) return;
        let bytes;
        try {bytes=frame(raw,isBinary,true);}
        catch {stop(isBinary?1003:1008,'Invalid realtime frame');return;}
        if (upstream?.readyState===WebSocket.OPEN) send(upstream,bytes);
        else {
          if (pendingBytes+bytes.byteLength > maxBufferedBytes) {stop(1013,'Realtime buffer limit reached');return;}
          pending.push(bytes);pendingBytes+=bytes.byteLength;
        }
      });
      if (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline)<=Date.now() || downClosed) {
        upClosed=true;stop(1008,'Realtime deadline expired');
        return {closed,close:() => stop()};
      }
      deadlineTimer=setTimeout(() => stop(1008,'Realtime deadline expired'),Math.max(1,Date.parse(deadline)-Date.now()));
      try {
        upstream=new Socket(endpoint,{headers:{Authorization:`Bearer ${apiKey}`},
          handshakeTimeout:Math.min(handshakeTimeoutMs,Math.max(1,Date.parse(deadline)-Date.now())),
          maxPayload:MAX_FRAME_BYTES,followRedirects:false,perMessageDeflate:false});
        upstream.on('error',() => stop(1011,'Realtime upstream unavailable'));
        upstream.once('close',code => {upClosed=true;stop(code===1000?1000:1011,'Realtime upstream closed');finish();});
        upstream.on('open',() => {
          if (!live()) return;
          const queued=pending;pending=[];pendingBytes=0;
          for (const bytes of queued) {send(upstream,bytes);if (closing) break;}
        });
        upstream.on('message',(raw,isBinary) => {
          if (!live()) return;
          try {send(connection,frame(raw,isBinary,false));}
          catch {stop(1011,'Invalid realtime upstream frame');}
        });
      } catch {upClosed=true;stop(1011,'Realtime upstream unavailable');}
      return {closed,close:() => stop(1001,'Realtime server stopped')};
    },
  };
}

export function agentRealtimeProxyFromEnvironment(environment) {
  const workspaceId=environment.PA_AGENT_REALTIME_WORKSPACE_ID,apiKey=environment.PA_AGENT_REALTIME_API_KEY;
  if (workspaceId===undefined && apiKey===undefined) return undefined;
  return createAgentRealtimeProxy({workspaceId,apiKey});
}
