import {ProtocolError} from '@personal-agent/contracts';
import {
  AGENTARTS_TRANSPORT_VERSION,
  digestAgentArtsPayload,
  encodeAgentArtsTransportFrame,
  parseAgentArtsTransportFrame,
  MAX_AGENTARTS_TRANSPORT_BYTES,
  MAX_AGENTARTS_RESULT_BYTES,
} from '@personal-agent/contracts/agentarts-transport';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import WebSocket from 'ws';
import type {AgentArtsFetchInit, AgentArtsResponse} from './agentarts.js';

const MAX_FRAME_BYTES = MAX_AGENTARTS_TRANSPORT_BYTES;
const MAX_RESULT_BYTES = MAX_AGENTARTS_RESULT_BYTES;
const MAX_CONNECTIONS = 64;
const MAX_TOMBSTONES = 128;
const OPEN = 1;

/** The host may inject an offline socket. Production keeps TLS verification and redirects disabled. */
export type AgentArtsWebSocket = Pick<WebSocket, 'readyState' | 'on' | 'send' | 'close' | 'terminate'>;
export interface AgentArtsWebSocketConnectOptions {
  readonly headers: Readonly<Record<string, string>>;
  readonly maxPayload: number;
  readonly perMessageDeflate: false;
  readonly followRedirects: false;
  readonly rejectUnauthorized: true;
}
export type AgentArtsWebSocketFactory =
  (url: string, options: AgentArtsWebSocketConnectOptions) => AgentArtsWebSocket;

export interface AgentArtsTransportState {
  readonly state: 'connecting' | 'wss_ready' | 'https_fallback' | 'auth_required'
    | 'unsupported' | 'result_unknown' | 'closed';
  readonly sessionId: string;
  readonly requestId?: string;
}

export interface AgentArtsUnknownReceipt {
  readonly sessionId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly payloadDigest: string;
  readonly accepted: boolean;
}

export function createAgentArtsUnknownReceipt(init: AgentArtsFetchInit): AgentArtsUnknownReceipt {
  const payload = JSON.parse(init.body) as {query: string} | {inputs: Record<string, string>};
  const requestId = init.headers['X-Request-Id']!;
  return {sessionId: init.headers['x-hw-agentarts-session-id']!, requestId,
    idempotencyKey: requestId, payloadDigest: digestAgentArtsPayload(payload), accepted: false};
}

/** Created only by the local adapter. A remote JSON error cannot create this classification. */
export class AgentArtsResultUnknownError extends ProtocolError {
  readonly receipt: AgentArtsUnknownReceipt;
  constructor(receipt: AgentArtsUnknownReceipt) {
    super('EXTERNAL_FAILURE', 'AgentArts result requires reconciliation', false);
    this.receipt = Object.freeze({...receipt});
  }
}

/** An invoke frame has never been handed to the socket. This is the only automatic fallback condition. */
class BeforeInvokeConnectionError extends ProtocolError {
  constructor() { super('EXTERNAL_FAILURE', 'AgentArts WebSocket connection is unavailable', false); }
}

interface Pending {
  readonly receipt: AgentArtsUnknownReceipt;
  readonly deadline: string;
  sent: boolean;
  accepted: boolean;
  resolve(response: AgentArtsResponse): void;
  reject(error: unknown): void;
  afterAccepted(receipt: AgentArtsUnknownReceipt): void;
  afterTerminal(receipt: AgentArtsUnknownReceipt): void;
  cleanup(): void;
}
interface Connection {
  readonly sessionId: string;
  readonly fingerprint: string;
  readonly socket: AgentArtsWebSocket;
  readonly ready: Promise<void>;
  resolveReady(): void;
  rejectReady(error: unknown): void;
  readonly pending: Map<string, Pending>;
  readonly tombstones: Set<string>;
  opened: boolean;
  negotiated: boolean;
  closed: boolean;
  leases: number;
  serverInstanceId?: string;
}
export interface AgentArtsSendGuards {
  beforeCatalog?(): Promise<void>;
  /** No await separates this guard from the invoke frame or HTTPS fetch. */
  beforeSend(receipt?: AgentArtsUnknownReceipt): void;
  /** Persist the server admission before a later cancellation can lose that fact. */
  afterAccepted?(receipt: AgentArtsUnknownReceipt): void;
  /** Transport receipt only; the Runtime must durably consume the application result before clearing intent. */
  afterTerminal?(receipt: AgentArtsUnknownReceipt): void;
}

function failProtocol(): ProtocolError {
  return new ProtocolError('EXTERNAL_FAILURE', 'AgentArts WebSocket protocol is invalid');
}
function socketFactory(url: string, options: AgentArtsWebSocketConnectOptions): AgentArtsWebSocket {
  return new WebSocket(url, {...options, headers: {...options.headers}});
}
function frameText(value: unknown, binary: unknown): string {
  if (binary === true) throw failProtocol();
  let bytes: Uint8Array;
  if (typeof value === 'string') bytes = Buffer.from(value, 'utf8');
  else if (value instanceof Uint8Array) bytes = value;
  else throw failProtocol();
  if (bytes.byteLength > MAX_FRAME_BYTES) throw failProtocol();
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { throw failProtocol(); }
}
function waitForReady(connection: Connection, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = (): void => { cleanup(); reject(new ProtocolError('CANCELLED', 'AgentArts request cancelled')); };
    const cleanup = (): void => signal.removeEventListener('abort', cancel);
    signal.addEventListener('abort', cancel, {once: true});
    connection.ready.then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
    if (signal.aborted) cancel();
  });
}

/** Session-scoped reusable connections, with no retries or persisted credentials/payloads. */
export class AgentArtsWebSocketTransport {
  private readonly connections = new Map<string, Connection>();
  private disposed = false;
  constructor(private readonly url: string,
    private readonly factory: AgentArtsWebSocketFactory = socketFactory,
    private readonly observe?: (state: AgentArtsTransportState) => void) {}

  private report(state: AgentArtsTransportState): void {
    try { this.observe?.(Object.freeze(state)); } catch { /* Observation never changes execution. */ }
  }
  private remember(connection: Connection, requestId: string): void {
    connection.tombstones.add(requestId);
    if (connection.tombstones.size > MAX_TOMBSTONES) {
      connection.tombstones.delete(connection.tombstones.values().next().value!);
    }
  }
  private dropPending(connection: Connection, requestId: string): Pending | undefined {
    const pending = connection.pending.get(requestId);
    if (pending) { connection.pending.delete(requestId); pending.cleanup(); this.remember(connection, requestId); }
    return pending;
  }
  private breakConnection(connection: Connection, error: unknown): void {
    if (connection.closed) return;
    connection.closed = true;
    if (this.connections.get(connection.sessionId) === connection) this.connections.delete(connection.sessionId);
    connection.rejectReady(error);
    for (const [requestId, pending] of connection.pending) {
      this.dropPending(connection, requestId);
      if (pending.sent) {
        this.report({state: 'result_unknown', sessionId: connection.sessionId, requestId});
        pending.reject(new AgentArtsResultUnknownError({...pending.receipt, accepted: pending.accepted}));
      } else pending.reject(error);
    }
    try { connection.socket.terminate(); } catch { /* Best-effort socket cleanup. */ }
    this.report({state: 'closed', sessionId: connection.sessionId});
  }
  private createConnection(sessionId: string, fingerprint: string, headers: Record<string, string>): Connection {
    let resolveReady: () => void = () => {};
    let rejectReady: (error: unknown) => void = () => {};
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void ready.catch(() => {});
    let socket: AgentArtsWebSocket;
    try {
      socket = this.factory(this.url, {headers: {
        Authorization: headers.Authorization!,
        'X-PA-Agent-Token': headers['X-PA-Agent-Token']!,
        'x-hw-agentarts-session-id': sessionId,
        'X-Invoke-Mode': headers['X-Invoke-Mode']!,
      }, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false, followRedirects: false,
      rejectUnauthorized: true});
    } catch { throw new BeforeInvokeConnectionError(); }
    const connection: Connection = {sessionId, fingerprint, socket, ready, resolveReady, rejectReady,
      pending: new Map(), tombstones: new Set(), opened: false, negotiated: false, closed: false, leases: 0};
    this.connections.set(sessionId, connection);
    this.report({state: 'connecting', sessionId});
    socket.on('open', () => { connection.opened = true; });
    socket.on('unexpected-response', (_request: unknown, response: {statusCode?: number; resume?: () => void}) => {
      const status = response?.statusCode;
      try { response?.resume?.(); } catch { /* Do not parse an external failure body. */ }
      if (status === 401 || status === 403) {
        this.report({state: 'auth_required', sessionId});
        this.breakConnection(connection, new ProtocolError('UNAUTHORIZED', 'AgentArts WebSocket authorization denied'));
      } else {
        this.report({state: 'unsupported', sessionId});
        this.breakConnection(connection, new ProtocolError('UNSUPPORTED_CAPABILITY', 'AgentArts WebSocket upgrade is unavailable'));
      }
    });
    socket.on('error', () => this.breakConnection(connection,
      connection.opened ? failProtocol() : new BeforeInvokeConnectionError()));
    socket.on('close', () => this.breakConnection(connection,
      connection.opened ? failProtocol() : new BeforeInvokeConnectionError()));
    socket.on('message', (data: unknown, binary: unknown) => {
      if (connection.closed) return;
      try {
        const frame = parseAgentArtsTransportFrame(JSON.parse(frameText(data, binary)));
        if (frame.type === 'ready') {
          if (!connection.opened || connection.negotiated || connection.pending.size
            || !frame.capabilities.includes('invoke') || !frame.capabilities.includes('cancel')) throw failProtocol();
          connection.serverInstanceId = frame.serverInstanceId;
          connection.negotiated = true;
          connection.resolveReady();
          this.report({state: 'wss_ready', sessionId});
          return;
        }
        if (!connection.negotiated || !('requestId' in frame) || !('serverInstanceId' in frame)
          || frame.serverInstanceId !== connection.serverInstanceId || frame.sessionId !== sessionId) throw failProtocol();
        const pending = connection.pending.get(frame.requestId);
        if (!pending) {
          if (connection.tombstones.has(frame.requestId)) return;
          throw failProtocol();
        }
        if (frame.idempotencyKey !== pending.receipt.idempotencyKey
          || frame.payloadDigest !== pending.receipt.payloadDigest) throw failProtocol();
        if (frame.type === 'accepted') {
          if (!pending.sent || pending.accepted || frame.deadline !== pending.deadline) throw failProtocol();
          pending.accepted = true;
          pending.afterAccepted({...pending.receipt, accepted: true});
          return;
        }
        if (frame.type === 'result') {
          if (!pending.sent || !pending.accepted) throw failProtocol();
          const payload = JSON.stringify(frame.events);
          if (Buffer.byteLength(payload, 'utf8') > MAX_RESULT_BYTES) throw failProtocol();
          pending.afterTerminal({...pending.receipt, accepted: true});
          this.dropPending(connection, frame.requestId);
          pending.resolve({status: 200, headers: {get: () => 'application/json'},
            text: async () => payload});
          return;
        }
        if (frame.type === 'error') {
          if (!pending.sent || frame.accepted !== pending.accepted) throw failProtocol();
          pending.afterTerminal({...pending.receipt, accepted: pending.accepted});
          this.dropPending(connection, frame.requestId);
          pending.reject(new ProtocolError('EXTERNAL_FAILURE', 'AgentArts WebSocket invocation failed'));
          return;
        }
        throw failProtocol();
      } catch { this.breakConnection(connection, failProtocol()); }
    });
    return connection;
  }

  async invoke(init: AgentArtsFetchInit, guards: AgentArtsSendGuards): Promise<AgentArtsResponse> {
    if (this.disposed) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'AgentArts transport is closed');
    const sessionId = init.headers['x-hw-agentarts-session-id']!;
    const requestId = init.headers['X-Request-Id']!;
    const fingerprint = createHash('sha256').update(init.headers.Authorization!).update('\0')
      .update(init.headers['X-PA-Agent-Token']!).digest('hex');
    let connection = this.connections.get(sessionId);
    if (connection && connection.fingerprint !== fingerprint) {
      this.breakConnection(connection, new ProtocolError('UNAUTHORIZED', 'AgentArts connection credentials changed'));
      connection = undefined;
    }
    if (!connection) {
      if (this.connections.size >= MAX_CONNECTIONS) {
        const idle = [...this.connections.values()].find(item => item.leases === 0 && item.pending.size === 0);
        if (idle) this.breakConnection(idle, new ProtocolError('UNSUPPORTED_CAPABILITY', 'AgentArts idle connection released'));
        else throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'AgentArts connection capacity reached');
      }
      connection = this.createConnection(sessionId, fingerprint, init.headers);
    }
    const selected = connection;
    selected.leases++;
    try {
      await waitForReady(selected, init.signal);
      if (init.signal.aborted) throw new ProtocolError('CANCELLED', 'AgentArts request cancelled');
      await guards.beforeCatalog?.();
      if (init.signal.aborted) throw new ProtocolError('CANCELLED', 'AgentArts request cancelled');
      if (selected.closed || selected.socket.readyState !== OPEN) throw failProtocol();
      const payload = JSON.parse(init.body) as {query: string} | {inputs: Record<string, string>};
      const receipt = createAgentArtsUnknownReceipt(init);
      const payloadDigest = receipt.payloadDigest;
      const deadline = init.headers['X-PA-Deadline']!;
      const frame = encodeAgentArtsTransportFrame({protocolVersion: AGENTARTS_TRANSPORT_VERSION,
        type: 'invoke', sessionId, requestId, idempotencyKey: requestId, payloadDigest, deadline, payload});
      return await new Promise<AgentArtsResponse>((resolve, reject) => {
        const abort = (): void => {
          const pending = this.dropPending(selected, requestId);
          if (!pending) return;
          if (pending.sent && selected.socket.readyState === OPEN) {
            try { selected.socket.send(encodeAgentArtsTransportFrame({protocolVersion: AGENTARTS_TRANSPORT_VERSION,
              type: 'cancel', sessionId, requestId, idempotencyKey: requestId, payloadDigest})); }
            catch { /* Cancellation acknowledgement is not required for local cancellation. */ }
          }
          reject(new ProtocolError('CANCELLED', 'AgentArts request cancelled'));
        };
        const pending: Pending = {receipt, deadline, sent: false, accepted: false, resolve, reject,
          afterAccepted: receipt => guards.afterAccepted?.(receipt),
          afterTerminal: receipt => guards.afterTerminal?.(receipt),
          cleanup: () => init.signal.removeEventListener('abort', abort)};
        if (selected.pending.has(requestId)) { reject(failProtocol()); return; }
        selected.pending.set(requestId, pending);
        init.signal.addEventListener('abort', abort, {once: true});
        try {
          if (init.signal.aborted) { abort(); return; }
          guards.beforeSend(receipt);
          if (init.signal.aborted) { abort(); return; }
          // Once send is attempted, delivery/acceptance may be unknown even if the callback fails.
          pending.sent = true;
          selected.socket.send(frame, error => {
            if (error) this.breakConnection(selected, failProtocol());
          });
        } catch (error) {
          if (pending.sent) this.breakConnection(selected, failProtocol());
          else { this.dropPending(selected, requestId); reject(error); }
        }
      });
    } finally {
      selected.leases--;
      if (!selected.negotiated && selected.leases === 0 && selected.pending.size === 0) {
        this.breakConnection(selected, new ProtocolError('CANCELLED', 'AgentArts connection setup abandoned'));
      }
    }
  }
  canFallback(error: unknown): boolean { return error instanceof BeforeInvokeConnectionError; }
  reportFallback(sessionId: string, requestId: string): void {
    this.report({state: 'https_fallback', sessionId, requestId});
  }
  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const connection of this.connections.values()) {
      this.breakConnection(connection, new ProtocolError('CANCELLED', 'AgentArts transport closed'));
    }
  }
}
