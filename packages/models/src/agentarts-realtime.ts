import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {ProtocolError} from '@personal-agent/contracts';
import {QwenRealtimeModelGateway} from './realtime.js';
import type {RealtimeConnectionPort, RealtimeRequest, RealtimeSession} from './realtime.js';

export interface RealtimeAuthorizationProvider {
  read(signal: AbortSignal): Promise<string>;
}
export interface AgentArtsRealtimeModelGatewayOptions {
  /** Same gateway/runtime URL already validated by the trusted Competition root. */
  websocketUrl?: string;
  authorizationProvider: RealtimeAuthorizationProvider;
  websocketAuthorizationProvider?: RealtimeAuthorizationProvider;
}

function liveRemaining(request: Pick<RealtimeRequest, 'signal' | 'deadline'>): number {
  if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'AgentArts Live 连接已取消');
  const remaining = Date.parse(request.deadline) - Date.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(request.deadline)
    || !(remaining > 0) || remaining > 120 * 60_000) {
    throw new ProtocolError('DEADLINE_EXCEEDED', 'AgentArts Live 会话期限无效或已到期');
  }
  return remaining;
}

function realtimeUrl(value: unknown): string {
  if (value === undefined) {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'AgentArts WSS 实时语音未配置');
  }
  if (typeof value !== 'string' || value !== value.trim() || /\s|\\|#/u.test(value)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'AgentArts Live 需要固定版本的 WSS 地址');
  }
  let url: URL;
  try {url = new URL(value);} catch {
    throw new ProtocolError('INVALID_ARGUMENT', 'AgentArts Live 需要固定版本的 WSS 地址');
  }
  const authorityEnd = value.indexOf('/', value.indexOf('://') + 3);
  const rawTarget = authorityEnd < 0 ? '' : value.slice(authorityEnd);
  const queryAt = rawTarget.indexOf('?');
  const rawPath = queryAt < 0 ? rawTarget : rawTarget.slice(0, queryAt);
  const rawQuery = queryAt < 0 ? '' : rawTarget.slice(queryAt);
  if (url.protocol !== 'wss:' || url.username || url.password || url.hash
    || url.pathname !== rawPath || url.search !== rawQuery
    || !/^\/runtimes\/[A-Za-z0-9_-]{1,64}\/(?:ws|invocations(?:\/ws)?)$/u.test(rawPath)
    || !/^\?endpoint=[A-Za-z0-9_.-]{1,128}$/u.test(rawQuery)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'AgentArts Live 需要固定版本的 WSS 地址');
  }
  return url.href;
}

async function authorization(provider: RealtimeAuthorizationProvider,
  request: Pick<RealtimeRequest, 'signal' | 'deadline'>, inner: boolean): Promise<string> {
  let value: unknown;
  try {value = await provider.read(request.signal);} catch {
    liveRemaining(request);
    throw new ProtocolError('UNAUTHORIZED', 'AgentArts Live 凭据不可用或已撤销');
  }
  liveRemaining(request);
  if (typeof value !== 'string' || value.length > 4096 || value !== value.trim()
    || !/^[\x20-\x7e]+$/u.test(value) || (inner && !/^Bearer [\x21-\x7e]+$/u.test(value))) {
    throw new ProtocolError('UNAUTHORIZED', 'AgentArts Live 凭据不可用或已撤销');
  }
  return value;
}

/** Credentials are read for each connect; preparation never opens or retries a socket. */
export function createAgentArtsRealtimeConnection(
  options: AgentArtsRealtimeModelGatewayOptions,
  Socket: typeof WebSocket = WebSocket,
): RealtimeConnectionPort {
  const {websocketUrl, authorizationProvider, websocketAuthorizationProvider} = options;
  return {
    async prepare(request) {
      liveRemaining(request);
      const url = realtimeUrl(websocketUrl);
      if (typeof authorizationProvider?.read !== 'function'
        || typeof websocketAuthorizationProvider?.read !== 'function') {
        throw new ProtocolError('UNAUTHORIZED', 'AgentArts Live 双凭据未配置或已撤销');
      }
      const outer = await authorization(authorizationProvider, request, false);
      const inner = await authorization(websocketAuthorizationProvider, request, true);
      liveRemaining(request);
      const headers = Object.freeze({Authorization: outer, 'X-PA-Agent-Token': inner,
        'X-Hw-Agentarts-Session-Id': randomUUID(), 'X-Request-Id': randomUUID(),
        'x-invoke-mode': 'published', 'x-pa-deadline': request.deadline});
      return {
        failureMessage: 'AgentArts Live 连接失败，请检查 WSS 配置、凭据和网络',
        createSocket() {
          const remaining = liveRemaining(request);
          try {
            return new Socket(url, 'pa.realtime.v1', {headers: {...headers},
              handshakeTimeout: Math.min(15_000, remaining), maxPayload: 2 * 1024 * 1024,
              followRedirects: false, perMessageDeflate: false, rejectUnauthorized: true});
          } catch {
            throw new ProtocolError('EXTERNAL_FAILURE', 'AgentArts Live 连接不可用');
          }
        },
      };
    },
  };
}

/** Native Qwen JSON/PCM handling is shared; AgentArts owns only this transport. */
export class AgentArtsRealtimeModelGateway {
  private readonly gateway: QwenRealtimeModelGateway;
  constructor(options: AgentArtsRealtimeModelGatewayOptions, Socket: typeof WebSocket = WebSocket) {
    this.gateway = new QwenRealtimeModelGateway(createAgentArtsRealtimeConnection(options, Socket));
  }
  connect(request: RealtimeRequest): Promise<RealtimeSession> {return this.gateway.connect(request);}
}
