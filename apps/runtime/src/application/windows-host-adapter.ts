import {randomBytes, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {basename, isAbsolute} from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {
  WINDOWS_HOST_PROTOCOL_VERSION, WINDOWS_HOST_TOOL_NAME, encodeWindowsHostFrame, parseWindowsHostFrame,
  validateWindowsHostHandshake, validateWindowsHostObservation, validateWindowsHostResult,
  validateWindowsHostStatus, validateWindowsHostTargetReady,
} from '@personal-agent/contracts/windows-host';
import type {
  WindowsHostBind, WindowsHostExecute, WindowsHostHello,
  WindowsHostResult, WindowsHostStatus, WindowsHostStatusReply, WindowsHostFrame,
  WindowsHostTargetReady,
} from '@personal-agent/contracts/windows-host';

/** The trusted native bridge must verify the connected pipe server's OS process identity
 * before returning a frame stream. The Host independently verifies the bridge client. */
export interface VerifiedWindowsHostConnection {
  exchange(frame: WindowsHostFrame): Promise<unknown>;
  send(frame: WindowsHostFrame): Promise<void>;
  close(): Promise<void>;
}
export interface WindowsHostTransport {
  openVerifiedConnection(): Promise<VerifiedWindowsHostConnection>;
  close?(): Promise<void>;
}

/** Spawns the native bridge for one Host session. stderr is a fixed readiness channel;
 * stdin/stdout carry the unchanged Windows Host 0.1.0 JSONL frames. */
export function createWindowsHostBridgeTransport(options: {
  bridgePath: string;
  hostPath: string;
  timeoutMs?: number;
}): WindowsHostTransport & {close(): Promise<void>} {
  if (process.platform !== 'win32' || !isAbsolute(options.bridgePath)
    || !isAbsolute(options.hostPath)
    || basename(options.bridgePath).toLowerCase() !== 'windowshost.pipebridge.exe'
    || basename(options.hostPath).toLowerCase() !== 'windowshost.host.exe') {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Windows Host native bridge is unavailable');
  }
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs)
    || options.timeoutMs < 100 || options.timeoutMs > 10000)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid Windows Host transport timeout');
  }
  const bridgePath = options.bridgePath;
  const hostPath = options.hostPath;
  const timeout = options.timeoutMs ?? 5000;
  const children = new Set<ChildProcessWithoutNullStreams>();
  let closed = false;
  let releaseFailed = false;
  const stops = new WeakMap<ChildProcessWithoutNullStreams, Promise<void>>();
  const stop = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
    const previous = stops.get(child);
    if (previous) return previous;
    if (!children.has(child)) return;
    const stopping = new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        clearTimeout(timer);
        child.off('close', onClose);
        if (error) { releaseFailed = true; reject(error); }
        else resolve();
      };
      const onClose = (): void => finish();
      const timer = setTimeout(() => finish(new ProtocolError('EXTERNAL_FAILURE',
        'Windows Host bridge release is unconfirmed')), timeout);
      child.once('close', onClose);
      try { child.kill(); }
      catch { finish(new ProtocolError('EXTERNAL_FAILURE', 'Windows Host bridge release failed')); }
    });
    stops.set(child, stopping);
    return stopping;
  };
  return {
    async openVerifiedConnection() {
      if (closed) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Windows Host transport is closed');
      if (releaseFailed) throw new ProtocolError('EXTERNAL_FAILURE', 'Windows Host bridge release is unconfirmed');
      const child = spawn(bridgePath, ['--host', hostPath],
        {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
      children.add(child);
      child.on('error', () => undefined);
      child.once('close', () => children.delete(child));
      try {
        await new Promise<void>((resolve, reject) => {
          let ready = Buffer.alloc(0);
          const verified = Buffer.from('VERIFIED\n', 'ascii');
          const timer = setTimeout(() => finish(new ProtocolError('TIMEOUT', 'Windows Host bridge timed out')), timeout);
          const finish = (error?: Error): void => {
            clearTimeout(timer);
            child.stderr.off('data', onData);
            child.off('error', onError);
            child.off('close', onClose);
            error ? reject(error) : resolve();
          };
          const onData = (chunk: Buffer): void => {
            ready = Buffer.concat([ready, chunk]);
            if (ready.length > verified.length || !ready.equals(verified.subarray(0, ready.length))) {
              finish(new ProtocolError('UNAUTHORIZED', 'Windows Host bridge refused peer verification'));
            } else if (ready.length === verified.length) finish();
          };
          const onError = (): void => finish(new ProtocolError('EXTERNAL_FAILURE', 'Windows Host bridge failed to start'));
          const onClose = (): void => finish(new ProtocolError('UNAUTHORIZED', 'Windows Host bridge exited before verification'));
          child.stderr.on('data', onData);
          child.once('error', onError);
          child.once('close', onClose);
        });
      } catch (error) { await stop(child); throw error; }
      if (closed || releaseFailed) {
        await stop(child);
        throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Windows Host transport is closed');
      }
      let pending: ((value: unknown) => void) | undefined;
      let rejectPending: ((error: Error) => void) | undefined;
      let buffer = Buffer.alloc(0);
      let responseTimer: ReturnType<typeof setTimeout> | undefined;
      const fail = (error: Error): void => {
        if (responseTimer) clearTimeout(responseTimer);
        rejectPending?.(error); pending = undefined; rejectPending = undefined;
      };
      child.on('close', () => fail(new Error('Windows Host bridge disconnected')));
      child.stdin.on('error', fail);
      child.stdout.on('error', fail);
      child.stdout.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 1024 * 1024) { child.kill(); fail(new Error('Windows Host frame too large')); return; }
        const end = buffer.indexOf(10);
        if (end < 0) return;
        const line = buffer.subarray(0, end);
        buffer = buffer.subarray(end + 1);
        if (buffer.length || !pending) { child.kill(); fail(new Error('Unsolicited Windows Host frame')); return; }
        try {
          if (line.includes(13) || line.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
            throw new Error('Windows Host frame has BOM or CRLF');
          }
          const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(line)) as unknown;
          const resolve = pending;
          if (responseTimer) clearTimeout(responseTimer);
          pending = undefined; rejectPending = undefined;
          resolve(value);
        } catch { child.kill(); fail(new Error('Invalid Windows Host UTF-8 or JSON')); }
      });
      const send = async (frame: WindowsHostFrame): Promise<void> => {
        const bytes = encodeWindowsHostFrame(frame);
        if (child.stdin.destroyed || child.exitCode !== null) throw new Error('Windows Host bridge is closed');
        await new Promise<void>((resolve, reject) => child.stdin.write(bytes, error => error ? reject(error) : resolve()));
      };
      return {
        send,
        async exchange(frame: WindowsHostFrame): Promise<unknown> {
          if (pending) throw new ProtocolError('REVISION_CONFLICT', 'Windows Host request already pending');
          const answer = new Promise<unknown>((resolve, reject) => { pending = resolve; rejectPending = reject; });
          // A failed send can reject the response before it is awaited below.
          // Keep that rejection handled without changing the caller's failure.
          void answer.catch(() => undefined);
          const deadline = 'deadline' in frame ? Date.parse(frame.deadline) - Date.now() : timeout;
          responseTimer = setTimeout(() => { child.kill(); fail(new Error('Windows Host response timed out')); },
            Math.min(Math.max(1, deadline), 300_000));
          try { await send(frame); return await answer; }
          catch (error) { fail(error as Error); throw error; }
        },
        async close() { await stop(child); },
      };
    },
    async close() {
      closed = true;
      const results = await Promise.allSettled([...children].map(stop));
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      if (releaseFailed) throw new ProtocolError('EXTERNAL_FAILURE', 'Windows Host bridge release is unconfirmed');
    },
  };
}

export type WindowsHostRunIdentity = Pick<WindowsHostExecute,
  'taskId' | 'runId' | 'toolName' | 'toolVersion' | 'argumentsDigest' | 'targetRef'>;

export interface WindowsHostAttemptStore {
  /** Durable, create-only record. Must reject reuse of a runId before Host execute. Never store text. */
  record(identity: WindowsHostRunIdentity): Promise<void>;
  read(taskId: string, runId: string): Promise<WindowsHostRunIdentity | undefined>;
}

export interface WindowsHostAdapterOptions {
  transport: WindowsHostTransport;
  attempts: WindowsHostAttemptStore;
  now?: () => number;
  /** Trusted Desktop may open a new target and wait for a local confirmation gesture.
   * Runs after hello/bind so the Host's old-window baseline precedes target creation.
   * Cancellation/deadline closes this reserved connection without observation or execution.
   * Full-access preparation may request metadata-only NOT_FOUND polling in this same
   * bound session, retaining its pre-open old-window baseline. No other refusal retries.
   * This is not tool authorization and must not inspect or select private windows. */
  prepareObservation?(input: {taskId: string; deadline: string; signal: AbortSignal}):
    Promise<void | {waitForFreshTarget: true}>;
  /** Desktop derives live local presence for this task. Checked at observation and again before execution. */
  authorizePresence(input: {taskId: string; targetRef?: string; deadline: string;
    signal: AbortSignal}): Promise<boolean>;
}

export interface ObservedNotepad {
  targetRef: string;
  expiresAt: string;
}
export type WindowsHostRecovery = {state: 'unknown'; reason: 'in_progress' | 'not_found' | 'host_result';
  hostResult?: WindowsHostResult};

const VERSION = '1.0.0';
const SCOPE = 'computer:notepad:write';
type Input = {targetRef: string; expectedText: string; replacementText: string};
type Bound = {connection: VerifiedWindowsHostConnection; sessionId: string};
const id = (): string => randomUUID();
const frameBase = (sessionId: string) => ({protocolVersion: WINDOWS_HOST_PROTOCOL_VERSION,
  requestId: id(), sessionId});
function unknown(message: string): never { throw new ProtocolError('RESULT_UNKNOWN', message); }
function observationCode(code: string): string {
  if (code === 'TARGET_AMBIGUOUS') return 'UNAUTHORIZED';
  if (code === 'TARGET_STALE') return 'NOT_FOUND';
  return code;
}
function active(context: Pick<ToolContext, 'signal' | 'deadline'>, now: () => number): void {
  if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Windows Host request cancelled');
  if (now() >= Date.parse(context.deadline)) throw new ProtocolError('TIMEOUT', 'Windows Host deadline expired');
}
async function open(transport: WindowsHostTransport): Promise<Bound> {
  const connection = await transport.openVerifiedConnection();
  try {
    const hello: WindowsHostHello = {kind: 'hello', protocolVersion: WINDOWS_HOST_PROTOCOL_VERSION,
      requestId: id(), clientNonce: randomBytes(16).toString('hex')};
    const reply = parseWindowsHostFrame(await connection.exchange(hello));
    if (reply.kind !== 'hello_ack') throw new ProtocolError('PROTOCOL_MISMATCH', 'Windows Host hello was not acknowledged');
    const bind: WindowsHostBind = {kind: 'bind', protocolVersion: WINDOWS_HOST_PROTOCOL_VERSION,
      requestId: hello.requestId, sessionId: reply.sessionId, hostNonce: reply.hostNonce};
    validateWindowsHostHandshake(hello, reply, bind);
    await connection.send(bind);
    return {connection, sessionId: reply.sessionId};
  } catch (error) { await connection.close(); throw error; }
}

/** The mutually authenticated Host's verified result includes its same-target UIA readback. */
export function createWindowsHostNotepadAdapter(options: WindowsHostAdapterOptions): {
  tool: RegisteredTool;
  observe(taskId: string, deadline: string, signal: AbortSignal): Promise<ObservedNotepad>;
  checkObservationReady(taskId: string, deadline: string, signal: AbortSignal): Promise<ObservedNotepad & {taskId: string}>;
  releaseObservation(taskId: string): Promise<void>;
  recover(taskId: string, runId: string): Promise<WindowsHostRecovery>;
  close(): Promise<void>;
} {
  if (!options.transport || !options.attempts || typeof options.attempts.record !== 'function'
    || typeof options.attempts.read !== 'function' || typeof options.authorizePresence !== 'function') {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Trusted Host, durable attempt store and presence are required');
  }
  const observed = new Map<string, {bound: Bound; target: ObservedNotepad}>();
  const now = options.now ?? Date.now;
  const lifetime = new AbortController();
  let closed = false;
  let occupied = false;
  let observationReservation: object | undefined;
  let checking = false;
  let releaseFailed = false;
  let closePromise: Promise<void> | undefined;
  const closures = new WeakMap<VerifiedWindowsHostConnection, Promise<void>>();
  const closeConnection = (connection: VerifiedWindowsHostConnection): Promise<void> => {
    let closing = closures.get(connection);
    if (!closing) {
      closing = Promise.resolve().then(() => connection.close()).catch(() => {
        releaseFailed = true;
        throw new ProtocolError('EXTERNAL_FAILURE', 'Windows Host connection release is unconfirmed');
      });
      closures.set(connection, closing);
    }
    return closing;
  };
  const ensureOpen = () => {
    if (closed) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Windows Host adapter is closed');
    if (releaseFailed) throw new ProtocolError('EXTERNAL_FAILURE', 'Windows Host connection release is unconfirmed');
  };
  const presenceAllowed = async (input: Parameters<WindowsHostAdapterOptions['authorizePresence']>[0]): Promise<boolean> => {
    try { return await options.authorizePresence(input) === true; }
    catch { return false; } // The trusted host may include private desktop details in an error.
  };

  async function observe(taskId: string, deadline: string, signal: AbortSignal): Promise<ObservedNotepad> {
    ensureOpen();
    active({deadline, signal}, now);
    if (occupied) throw new ProtocolError('REVISION_CONFLICT', 'Windows Host session is occupied');
    // Reserve before the first asynchronous presence check, not after it.
    occupied = true;
    const reservation = {};
    observationReservation = reservation;
    const requireCurrentReservation = (): void => {
      ensureOpen();
      active({deadline, signal}, now);
      if (observationReservation !== reservation) {
        throw new ProtocolError('REVISION_CONFLICT', 'Windows Host observation reservation changed');
      }
    };
    let bound: Bound | undefined;
    let waitForFreshTarget = false;
    try {
      const allowed = await presenceAllowed({taskId, deadline, signal});
      // Presence can finish after cancellation or close; never open a late session.
      requireCurrentReservation();
      if (!allowed) {
        throw new ProtocolError('UNAUTHORIZED', 'Local user presence was not authorized');
      }
      bound = await open(options.transport);
      ensureOpen();
      active({deadline, signal}, now);
      if (options.prepareObservation) {
        const preparation = new AbortController();
        const abort = () => preparation.abort();
        signal.addEventListener('abort', abort, {once: true});
        lifetime.signal.addEventListener('abort', abort, {once: true});
        const timer = setTimeout(abort, Math.max(1, Date.parse(deadline) - now()));
        try {
          const prepared = await new Promise<void | {waitForFreshTarget: true}>((resolve, reject) => {
            preparation.signal.addEventListener('abort', () => reject(new ProtocolError(
              signal.aborted || lifetime.signal.aborted ? 'CANCELLED' : 'TIMEOUT',
              'Windows Host target preparation ended')), {once: true});
            if (signal.aborted || lifetime.signal.aborted) { abort(); return; }
            Promise.resolve().then(() => options.prepareObservation!({taskId, deadline,
              signal: preparation.signal})).then(resolve, reject);
          });
          waitForFreshTarget = prepared?.waitForFreshTarget === true;
        } finally {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          lifetime.signal.removeEventListener('abort', abort);
          preparation.abort();
        }
      }
      for (;;) {
        requireCurrentReservation();
        if (waitForFreshTarget && !await presenceAllowed({taskId, deadline, signal})) {
          throw new ProtocolError('UNAUTHORIZED', 'Local target preparation policy changed');
        }
        requireCurrentReservation();
        const request = {kind: 'observe' as const, ...frameBase(bound.sessionId), deadline,
          capability: 'notepad.replace_text' as const};
        const reply = parseWindowsHostFrame(await bound.connection.exchange(request));
        if (reply.kind !== 'observed' && reply.kind !== 'observation_refused') {
          throw new ProtocolError('PROTOCOL_MISMATCH', 'Windows Host observation reply mismatch');
        }
        validateWindowsHostObservation(request, reply);
        requireCurrentReservation();
        if (waitForFreshTarget && !await presenceAllowed({taskId, deadline, signal})) {
          throw new ProtocolError('UNAUTHORIZED', 'Local target preparation policy changed');
        }
        requireCurrentReservation();
        if (reply.kind === 'observation_refused') {
          if (!waitForFreshTarget || reply.errorCode !== 'NOT_FOUND') {
            throw new ProtocolError(observationCode(reply.errorCode), 'Windows Host refused Notepad observation');
          }
          // Readiness is proved by the next native observation, never by elapsed time.
          // Poll only metadata and never reopen/rebind (which would replace the baseline).
          await new Promise<void>((resolve, reject) => {
            const finish = (error?: Error): void => {
              clearTimeout(timer);
              signal.removeEventListener('abort', abort);
              lifetime.signal.removeEventListener('abort', abort);
              error ? reject(error) : resolve();
            };
            const abort = (): void => finish(new ProtocolError('CANCELLED', 'Windows Host target wait cancelled'));
            const timer = setTimeout(() => finish(), Math.min(50, Math.max(1, Date.parse(deadline) - now())));
            signal.addEventListener('abort', abort, {once: true});
            lifetime.signal.addEventListener('abort', abort, {once: true});
            if (signal.aborted || lifetime.signal.aborted) abort();
          });
          continue;
        }
        if (Date.parse(reply.expiresAt) <= now()) throw new ProtocolError('TIMEOUT', 'Notepad target already expired');
        const target = {targetRef: reply.targetRef, expiresAt: reply.expiresAt};
        observed.set(taskId, {bound, target});
        observationReservation = undefined;
        return {...target};
      }
    } catch (error) {
      try { if (bound) await closeConnection(bound.connection); } finally {
        if (observationReservation === reservation) observationReservation = undefined;
        occupied = false;
      }
      throw error;
    }
  }

  async function releaseObservation(taskId: string): Promise<void> {
    ensureOpen();
    const entry = observed.get(taskId);
    if (!entry) return;
    observed.delete(taskId);
    try { await closeConnection(entry.bound.connection); } finally { occupied = false; }
  }

  /** Fresh Host-side check before Desktop submits allow_once; this neither renews nor authorizes the target. */
  async function checkObservationReady(taskId: string, deadline: string,
    signal: AbortSignal): Promise<ObservedNotepad & {taskId: string}> {
    ensureOpen();
    const entry = observed.get(taskId);
    if (!entry || checking) throw new ProtocolError('UNAUTHORIZED', 'Notepad observation is unavailable');
    checking = true;
    try {
      active({deadline, signal}, now);
      if (now() >= Date.parse(entry.target.expiresAt)) {
        throw new ProtocolError('TIMEOUT', 'Notepad observation expired');
      }
      const request: WindowsHostTargetReady = {kind: 'target_ready',
        ...frameBase(entry.bound.sessionId), targetRef: entry.target.targetRef, deadline};
      const reply = parseWindowsHostFrame(await entry.bound.connection.exchange(request));
      if (reply.kind !== 'target_ready_result') {
        throw new ProtocolError('PROTOCOL_MISMATCH', 'Windows Host target readiness reply mismatch');
      }
      validateWindowsHostTargetReady(request, reply);
      active({deadline, signal}, now);
      if (observed.get(taskId) !== entry || closed) {
        throw new ProtocolError('UNAUTHORIZED', 'Notepad observation was released');
      }
      if (!reply.ready) {
        throw new ProtocolError(reply.errorCode === 'TIMEOUT' ? 'TIMEOUT' : 'UNAUTHORIZED',
          'Windows Host target is not ready');
      }
      if (reply.expiresAt !== entry.target.expiresAt || now() >= Date.parse(reply.expiresAt)) {
        throw new ProtocolError('UNAUTHORIZED', 'Windows Host target readiness expired or changed');
      }
      return {taskId, ...entry.target};
    } catch (error) {
      if (observed.get(taskId) === entry) {
        observed.delete(taskId);
        try { await closeConnection(entry.bound.connection); } finally { occupied = false; }
      }
      throw error instanceof ProtocolError ? error
        : new ProtocolError('UNAUTHORIZED', 'Windows Host target readiness unavailable');
    } finally { checking = false; }
  }

  async function poll(bound: Bound, identity: WindowsHostRunIdentity): Promise<WindowsHostResult | WindowsHostStatusReply> {
    const status: WindowsHostStatus = {kind: 'status', ...frameBase(bound.sessionId), ...identity};
    const reply = parseWindowsHostFrame(await bound.connection.exchange(status));
    if (reply.kind !== 'result' && reply.kind !== 'status_reply') {
      throw new ProtocolError('PROTOCOL_MISMATCH', 'Windows Host status reply mismatch');
    }
    validateWindowsHostStatus(status, reply);
    return reply;
  }

  async function reconcile(identity: WindowsHostRunIdentity): Promise<WindowsHostRecovery> {
    const bound = await open(options.transport);
    try {
      const reply = await poll(bound, identity);
      return reply.kind === 'result' ? {state: 'unknown', reason: 'host_result', hostResult: reply}
        : {state: 'unknown', reason: reply.state};
    }
    finally { await closeConnection(bound.connection); }
    // A Host not_found reply means unknown, never permission to execute again.
  }

  async function recover(taskId: string, runId: string): Promise<WindowsHostRecovery> {
    ensureOpen();
    if (occupied) throw new ProtocolError('REVISION_CONFLICT', 'Windows Host session is occupied');
    occupied = true;
    try {
      const identity = await options.attempts.read(taskId, runId);
      if (!identity || identity.taskId !== taskId || identity.runId !== runId) {
        throw new ProtocolError('NOT_FOUND', 'Original Windows Host run identity is unavailable');
      }
      return await reconcile(identity);
    } finally { occupied = false; }
  }

  const tool: RegisteredTool = {
    descriptor: {
      name: WINDOWS_HOST_TOOL_NAME, version: VERSION,
      inputSchema: {type: 'object', required: ['targetRef', 'expectedText', 'replacementText'],
        additionalProperties: false, properties: {
          targetRef: {type: 'string', minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$'},
          expectedText: {type: 'string', maxLength: 4096},
          replacementText: {type: 'string', maxLength: 4096},
        }},
      outputSchema: {type: 'object', required: ['state', 'hostEvidenceRef'], additionalProperties: false,
        properties: {state: {const: 'verified'}, hostEvidenceRef: {type: 'string', minLength: 1}}},
      sideEffect: 'local_write', requiredScopes: [SCOPE], idempotencySupport: true,
      // Runtime's current wire tool.invoke does not carry trusted userPresent. This adapter
      // requires Desktop's task-bound live presence check and the short-lived Host target.
      recoverySupport: true, requiresPresence: false,
    },
    async execute(raw, context) {
      ensureOpen();
      if (checking) throw new ProtocolError('REVISION_CONFLICT', 'Windows Host target readiness is pending');
      const input = raw as Input;
      const entry = observed.get(context.taskId);
      if (!entry) throw new ProtocolError('UNAUTHORIZED', 'Notepad target is absent for this task');
      observed.delete(context.taskId); // one observation, one attempt
      const {bound} = entry;
      const requireLiveTarget = (): void => {
        ensureOpen();
        active(context, now);
        if (input.targetRef !== entry.target.targetRef
          || now() >= Date.parse(entry.target.expiresAt)) {
          throw new ProtocolError('UNAUTHORIZED', 'Notepad target is stale or belongs to another task');
        }
      };
      let identity: WindowsHostRunIdentity | undefined;
      let exchangeAttempted = false;
      try {
        requireLiveTarget();
        identity = {taskId: context.taskId, runId: context.runId,
          toolName: WINDOWS_HOST_TOOL_NAME, toolVersion: VERSION,
          argumentsDigest: toolArgumentsDigest(input), targetRef: input.targetRef};
        const runIdentity = identity;
        if (!await presenceAllowed({taskId: context.taskId, targetRef: input.targetRef,
          deadline: context.deadline, signal: context.signal})) {
          throw new ProtocolError('UNAUTHORIZED', 'Local user presence was not authorized');
        }
        requireLiveTarget();
        if (input.expectedText === input.replacementText) {
          throw new ProtocolError('INVALID_ARGUMENT', 'Notepad replacement must change text');
        }
        if (await options.attempts.read(context.taskId, context.runId)) {
          unknown('Windows Host run already exists; reconcile it without replay');
        }
        requireLiveTarget();
        await options.attempts.record(runIdentity);
        requireLiveTarget();
        const execute: WindowsHostExecute = {kind: 'execute', ...frameBase(bound.sessionId),
          ...runIdentity, authorizationRef: context.authorizationRef, deadline: context.deadline,
          expectedText: input.expectedText, replacementText: input.replacementText};
        const onAbort = (): void => {
          if (!exchangeAttempted) return;
          const cancel = {kind: 'cancel' as const, ...frameBase(bound.sessionId), ...runIdentity};
          void bound.connection.send(cancel).finally(() => closeConnection(bound.connection)).catch(() => undefined);
        };
        requireLiveTarget(); // final local gate before a Host execute can be sent
        context.signal.addEventListener('abort', onAbort, {once: true});
        try {
          exchangeAttempted = true;
          const reply = parseWindowsHostFrame(await bound.connection.exchange(execute));
          if (reply.kind !== 'result') unknown('Windows Host did not return a terminal result');
          validateWindowsHostResult(execute, reply);
          if (context.signal.aborted) unknown('Windows Host cancellation requires status reconciliation');
          if (reply.state !== 'verified' || !reply.evidenceRef) unknown('Windows Host write requires reconciliation');
          active(context, now);
          // Host's verified journal receipt is issued only after same-target UIA text readback.
          // Runtime's tool execution record projects this correlated receipt as local Evidence.
          return {state: 'verified', hostEvidenceRef: reply.evidenceRef};
        } finally { context.signal.removeEventListener('abort', onAbort); }
      } catch (error) {
        if (!exchangeAttempted || !identity) throw error;
        // Never replay execute. A new authenticated Host session may query the journal.
        await closeConnection(bound.connection);
        try { await reconcile(identity); } catch { /* original unknown remains */ }
        unknown('Windows Host execution outcome requires reconciliation');
      } finally {
        try { await closeConnection(bound.connection); } finally { occupied = false; }
      }
    },
  };

  return {tool, observe, checkObservationReady, releaseObservation, recover, close() {
    if (closePromise) return closePromise;
    closed = true;
    observationReservation = undefined;
    lifetime.abort();
    const pending = [...observed.values()];
    observed.clear();
    closePromise = (async () => {
      const results = await Promise.allSettled([
        ...pending.map(item => closeConnection(item.bound.connection)),
        Promise.resolve().then(() => options.transport.close?.()),
      ]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected' || releaseFailed) {
        releaseFailed = true;
        throw new ProtocolError('EXTERNAL_FAILURE', 'Windows Host connection release is unconfirmed');
      }
    })();
    return closePromise;
  }};
}
