/**
 * Provisional, local wake-session lifecycle. This package does not open a
 * microphone, recognize speech, issue authorization, submit tasks, or call a
 * cloud service. The trusted host owns authorization and the source owns any
 * audio/wake algorithm.
 */

export type WakeErrorCode =
  | 'INVALID_ARGUMENT'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_UNAVAILABLE'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'DISPOSED'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_ERROR'
  | 'DEVICE_UNAVAILABLE'
  | 'AUTHORIZATION_REVOKED'
  | 'CALLBACK_FAILED';

export interface WakeError {
  readonly code: WakeErrorCode;
}

export class WakeLifecycleError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT') {
    super(`Wake lifecycle request rejected: ${code}`);
  }
}

export interface WakeTimer {
  cancel(): void;
}

export interface WakeClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): WakeTimer;
}

export interface WakeSourceContext {
  readonly signal: AbortSignal;
  readonly deadlineAtMs: number;
}

/** Source events deliberately contain no transcript, audio, URL, or error text. */
export type WakeSourceEvent =
  | {readonly kind: 'wake'}
  | {readonly kind: 'device_unavailable'}
  | {readonly kind: 'error'};

export interface WakeSubscription {
  unsubscribe(): void;
}

export interface WakeSignalSource {
  /** Resolve only after the detector and authorized source are ready to listen. */
  subscribe(listener: (event: WakeSourceEvent) => void, context: WakeSourceContext): WakeSubscription | Promise<WakeSubscription>;
}

export interface WakeAuthorizationCheck {
  readonly requestedAtMs: number;
  readonly signal: AbortSignal;
  /** Every authorization check is bounded by the caller's explicit deadline. */
  readonly deadlineAtMs: number;
}

export type WakeAuthorizationDecision =
  | {
      readonly kind: 'allowed';
      /** The host-provided authorization expiry; an infinite session is rejected. */
      readonly expiresAtMs: number;
      /** Host aborts this signal on revoke, device loss, or host shutdown. */
      readonly revocationSignal: AbortSignal;
    }
  | {
      readonly kind: 'denied';
      readonly reason: 'denied' | 'unavailable' | 'expired';
    };

/** The module consumes this check; it cannot grant or extend authorization. */
export interface WakeAuthorizationPort {
  check(input: WakeAuthorizationCheck): Promise<WakeAuthorizationDecision>;
}

export interface WakeDetectedEvent {
  readonly kind: 'wake';
  readonly sessionId: number;
  readonly occurredAtMs: number;
}

export interface WakeLifecycleOptions {
  readonly authorization: WakeAuthorizationPort;
  readonly source: WakeSignalSource;
  readonly onWake: (event: WakeDetectedEvent) => void;
  readonly onError?: (error: WakeError) => void;
  readonly clock?: WakeClock;
  /** Explicit local suppression window after an accepted wake; zero disables it. */
  readonly cooldownMs?: number;
}

export interface WakeEnableOptions {
  /** Required finite absolute deadline; enable never waits without a bound. */
  readonly deadlineAtMs: number;
  readonly signal?: AbortSignal;
}

export type WakeEnableFailure =
  | 'permission_denied'
  | 'permission_unavailable'
  | 'expired'
  | 'cancelled'
  | 'disposed'
  | 'source_unavailable';

export type WakeEnableResult =
  | {readonly kind: 'listening'; readonly sessionId: number; readonly expiresAtMs: number}
  | {readonly kind: 'not_listening'; readonly reason: WakeEnableFailure};

export interface WakeSnapshot {
  readonly state: 'disabled' | 'listening' | 'disposed';
  readonly sessionId: number | null;
  readonly expiresAtMs: number | null;
  readonly playbackActive: boolean;
  readonly cooldownUntilMs: number | null;
}

/** Fixed, read-only lifecycle projection for local host composition. */
export interface WakeLifecycleStateSnapshot {
  readonly state: 'disabled' | 'listening' | 'disposed';
  readonly sessionId: number | null;
  readonly expiresAtMs: number | null;
}

interface PendingEnable {
  readonly epoch: number;
  readonly controller: AbortController;
  readonly deadlineAtMs: number;
  readonly deadlineReached: {value: boolean};
  readonly callerSignal?: AbortSignal;
  callerListener?: () => void;
  deadlineTimer?: WakeTimer;
  promise?: Promise<WakeEnableResult>;
}

interface ActiveSession {
  readonly epoch: number;
  readonly sessionId: number;
  readonly controller: AbortController;
  readonly expiresAtMs: number;
  readonly revocationSignal: AbortSignal;
  readonly revocationListener: () => void;
  readonly callerSignal?: AbortSignal;
  readonly callerListener?: () => void;
  expiryTimer: WakeTimer;
  subscription?: WakeSubscription;
}

type ExternalWaitResult =
  | {readonly kind: 'decision'; readonly value: unknown}
  | {readonly kind: 'rejected'}
  | {readonly kind: 'aborted'};

interface LifecycleListenerEntry {
  readonly listener: (snapshot: WakeLifecycleStateSnapshot) => void;
  active: boolean;
  lastSnapshot: WakeLifecycleStateSnapshot;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

const systemClock: WakeClock = {
  now: () => Date.now(),
  setTimeout(callback, delayMs) {
    const handle = globalThis.setTimeout(callback, Math.min(Math.max(0, delayMs), MAX_TIMEOUT_MS));
    return {cancel: () => globalThis.clearTimeout(handle)};
  },
};

function finiteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    const signal = value as AbortSignal;
    return typeof signal.aborted === 'boolean'
      && typeof signal.addEventListener === 'function'
      && typeof signal.removeEventListener === 'function';
  } catch {
    return false;
  }
}

function dataProperty(value: unknown, key: string): unknown {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function validDecision(value: unknown): value is WakeAuthorizationDecision {
  const kind = dataProperty(value, 'kind');
  if (kind === 'denied') {
    const reason = dataProperty(value, 'reason');
    return reason === 'denied' || reason === 'unavailable' || reason === 'expired';
  }
  if (kind !== 'allowed') return false;
  return finiteTime(dataProperty(value, 'expiresAtMs'))
    && isAbortSignal(dataProperty(value, 'revocationSignal'));
}

function validSubscription(value: unknown): value is WakeSubscription {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    return typeof (value as WakeSubscription).unsubscribe === 'function';
  } catch {
    return false;
  }
}

export class WakeLifecycleController {
  private readonly clock: WakeClock;
  private readonly cooldownMs: number;
  private readonly onError: (error: WakeError) => void;
  private epoch = 0;
  private nextSessionId = 1;
  private pending: PendingEnable | undefined;
  private active: ActiveSession | undefined;
  private disposed = false;
  private playbackActive = false;
  private cooldownUntilMs: number | null = null;
  private readonly lifecycleListeners = new Set<LifecycleListenerEntry>();
  private lastLifecycleSnapshot: WakeLifecycleStateSnapshot = Object.freeze({
    state: 'disabled',
    sessionId: null,
    expiresAtMs: null,
  });
  private pendingLifecycleSnapshot: WakeLifecycleStateSnapshot | undefined;
  private publishingLifecycle = false;

  constructor(private readonly options: WakeLifecycleOptions) {
    if (!options || !options.authorization || typeof options.authorization.check !== 'function'
      || !options.source || typeof options.source.subscribe !== 'function'
      || typeof options.onWake !== 'function') {
      throw new WakeLifecycleError('INVALID_ARGUMENT');
    }
    const cooldownMs = options.cooldownMs ?? 0;
    if (!finiteTime(cooldownMs)) throw new WakeLifecycleError('INVALID_ARGUMENT');
    this.clock = options.clock ?? systemClock;
    if (!this.clock || typeof this.clock.now !== 'function' || typeof this.clock.setTimeout !== 'function') {
      throw new WakeLifecycleError('INVALID_ARGUMENT');
    }
    this.cooldownMs = cooldownMs;
    this.onError = typeof options.onError === 'function' ? options.onError : () => {};
  }

  /** No subscription is created until this method is explicitly called. */
  enable(input: WakeEnableOptions): Promise<WakeEnableResult> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new WakeLifecycleError('INVALID_ARGUMENT');
    }
    if (!finiteTime(input.deadlineAtMs)) {
      throw new WakeLifecycleError('INVALID_ARGUMENT');
    }
    if (input.signal !== undefined && !isAbortSignal(input.signal)) {
      throw new WakeLifecycleError('INVALID_ARGUMENT');
    }
    if (this.disposed) return Promise.resolve({kind: 'not_listening', reason: 'disposed'});
    const now = this.clock.now();
    if (!finiteTime(now)) throw new WakeLifecycleError('INVALID_ARGUMENT');
    // A suspended host may resume after the expiry before its timer callback runs.
    // Never report that the old audio subscription is still authorized.
    if (this.active && now >= this.active.expiresAtMs) this.expire(this.active.epoch);
    if (this.active?.subscription) return Promise.resolve({kind: 'listening', sessionId: this.active.sessionId, expiresAtMs: this.active.expiresAtMs});
    if (this.pending && now >= this.pending.deadlineAtMs) {
      this.pending.deadlineReached.value = true;
      this.pending.controller.abort();
    }
    if (this.pending?.promise) return this.pending.promise;
    if (input.deadlineAtMs <= now) {
      this.report('EXPIRED');
      return Promise.resolve({kind: 'not_listening', reason: 'expired'});
    }
    if (input.signal?.aborted) return Promise.resolve({kind: 'not_listening', reason: 'cancelled'});

    const epoch = ++this.epoch;
    const controller = new AbortController();
    const deadlineReached = {value: false};
    const pending: PendingEnable = {
      epoch,
      controller,
      deadlineReached,
      deadlineAtMs: input.deadlineAtMs,
      ...(input.signal === undefined ? {} : {callerSignal: input.signal}),
    };
    const callerListener = (): void => {
      if (this.active?.epoch === epoch) {
        this.deactivateActive(epoch, 'CANCELLED');
      } else {
        controller.abort();
      }
    };
    if (input.signal) {
      pending.callerListener = callerListener;
      input.signal.addEventListener('abort', callerListener, {once: true});
    }
    pending.deadlineTimer = this.scheduleAt(input.deadlineAtMs, () => {
      deadlineReached.value = true;
      if (this.active?.epoch === epoch) this.expire(epoch);
      else controller.abort();
    });
    this.pending = pending;
    const promise = this.runEnable(pending).finally(() => {
      if (this.pending?.epoch === epoch) this.pending = undefined;
      if (this.active?.epoch !== epoch) this.cleanupPending(pending);
    });
    pending.promise = promise;
    return promise;
  }

  /** Alias used by hosts that model the lifecycle as start/stop. */
  stop(): void {
    this.disable();
  }

  /** Stop the current session and invalidate all callbacks from older epochs. */
  disable(): void {
    this.epoch++;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      pending.deadlineTimer?.cancel();
      pending.controller.abort();
      this.cleanupPending(pending);
    }
    const active = this.active;
    this.active = undefined;
    this.cooldownUntilMs = null;
    if (active) {
      active.expiryTimer.cancel();
      active.revocationSignal.removeEventListener('abort', active.revocationListener);
      if (active.callerSignal && active.callerListener) active.callerSignal.removeEventListener('abort', active.callerListener);
      try { active.subscription?.unsubscribe(); } catch { this.report('SOURCE_ERROR'); }
      active.controller.abort();
    }
    this.publishLifecycleIfChanged();
  }

  /** Idempotent disposal; no later enable or source callback can revive this object. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disable();
  }

  /** Playback is owned by MOD-14; this only supplies a suppression signal. */
  setPlaybackActive(active: boolean): void {
    if (typeof active !== 'boolean') throw new WakeLifecycleError('INVALID_ARGUMENT');
    this.playbackActive = active;
  }

  /**
   * Observe a fixed local lifecycle projection. This does not grant access to
   * authorization, source signals, audio, Runtime, or controller mutation.
   */
  subscribeLifecycle(listener: (snapshot: WakeLifecycleStateSnapshot) => void): () => void {
    if (typeof listener !== 'function') throw new WakeLifecycleError('INVALID_ARGUMENT');
    const initial = this.createLifecycleSnapshot();
    const entry: LifecycleListenerEntry = {listener, active: true, lastSnapshot: initial};
    this.lifecycleListeners.add(entry);
    try { listener(initial); } catch { this.report('CALLBACK_FAILED'); }
    return () => {
      if (!entry.active) return;
      entry.active = false;
      this.lifecycleListeners.delete(entry);
    };
  }

  snapshot(): WakeSnapshot {
    if (this.active && this.clock.now() >= this.active.expiresAtMs) this.expire(this.active.epoch);
    if (this.cooldownUntilMs !== null && this.clock.now() >= this.cooldownUntilMs) this.cooldownUntilMs = null;
    const active = this.active;
    return {
      state: this.disposed ? 'disposed' : active?.subscription ? 'listening' : 'disabled',
      sessionId: active?.subscription ? active.sessionId : null,
      expiresAtMs: active?.subscription ? active.expiresAtMs : null,
      playbackActive: this.playbackActive,
      cooldownUntilMs: this.cooldownUntilMs,
    };
  }

  private async runEnable(pending: PendingEnable): Promise<WakeEnableResult> {
    if (!this.isCurrentPending(pending) || pending.controller.signal.aborted) {
      return {kind: 'not_listening', reason: this.abortReason(pending)};
    }
    const request: WakeAuthorizationCheck = {
      requestedAtMs: this.clock.now(),
      signal: pending.controller.signal,
      deadlineAtMs: pending.deadlineAtMs,
    };
    const authorizationResult = await this.awaitExternal(pending, () => this.options.authorization.check(request));
    if (authorizationResult.kind === 'aborted') {
      return {kind: 'not_listening', reason: this.abortReason(pending)};
    }
    if (authorizationResult.kind === 'rejected') {
      if (pending.controller.signal.aborted) return {kind: 'not_listening', reason: this.abortReason(pending)};
      this.report('PERMISSION_UNAVAILABLE');
      return {kind: 'not_listening', reason: 'permission_unavailable'};
    }
    const decision = authorizationResult.value;
    if (!this.isCurrentPending(pending) || pending.controller.signal.aborted) {
      return {kind: 'not_listening', reason: this.abortReason(pending)};
    }
    if (!validDecision(decision)) {
      this.report('PERMISSION_UNAVAILABLE');
      return {kind: 'not_listening', reason: 'permission_unavailable'};
    }
    if (decision.kind === 'denied') {
      const code: WakeErrorCode = decision.reason === 'unavailable'
        ? 'PERMISSION_UNAVAILABLE' : decision.reason === 'expired' ? 'EXPIRED' : 'PERMISSION_DENIED';
      this.report(code);
      return {kind: 'not_listening', reason: code === 'PERMISSION_UNAVAILABLE' ? 'permission_unavailable'
        : code === 'EXPIRED' ? 'expired' : 'permission_denied'};
    }
    const now = this.clock.now();
    const expiresAtMs = Math.min(decision.expiresAtMs, pending.deadlineAtMs);
    if (!finiteTime(expiresAtMs) || expiresAtMs <= now) {
      this.report('EXPIRED');
      return {kind: 'not_listening', reason: 'expired'};
    }
    if (decision.revocationSignal.aborted) {
      this.report('AUTHORIZATION_REVOKED');
      return {kind: 'not_listening', reason: 'permission_denied'};
    }

    pending.deadlineTimer?.cancel();
    const sessionId = this.nextSessionId++;
    const revocationListener = (): void => this.deactivateActive(pending.epoch, 'AUTHORIZATION_REVOKED');
    const active: ActiveSession = {
      epoch: pending.epoch,
      sessionId,
      controller: pending.controller,
      expiresAtMs,
      revocationSignal: decision.revocationSignal,
      revocationListener,
      ...(pending.callerSignal === undefined ? {} : {callerSignal: pending.callerSignal}),
      ...(pending.callerListener === undefined ? {} : {callerListener: pending.callerListener}),
      expiryTimer: this.scheduleAt(expiresAtMs, () => this.expire(pending.epoch)),
    };
    this.active = active;
    decision.revocationSignal.addEventListener('abort', revocationListener, {once: true});
    try {
      let released = false;
      const release = (value: unknown): void => {
        if (released || !validSubscription(value)) return;
        released = true;
        this.safeUnsubscribe(value);
      };
      const sourceResult = await this.awaitExternal(
        pending,
        () => this.options.source.subscribe(
          event => this.handleSourceEvent(event, pending.epoch),
          {signal: pending.controller.signal, deadlineAtMs: expiresAtMs},
        ),
        value => {
          if (!this.isActive(pending.epoch)) release(value);
        },
      );
      // Source readiness can resume after expiry before the host runs its timer.
      this.expire(pending.epoch);
      if (sourceResult.kind === 'aborted') {
        return {kind: 'not_listening', reason: this.abortReason(pending)};
      }
      if (!this.isActive(pending.epoch)) {
        if (sourceResult.kind === 'decision') release(sourceResult.value);
        return {kind: 'not_listening', reason: this.abortReason(pending)};
      }
      if (sourceResult.kind === 'rejected' || !validSubscription(sourceResult.value)) {
        this.deactivateActive(pending.epoch);
        this.report('SOURCE_UNAVAILABLE');
        return {kind: 'not_listening', reason: 'source_unavailable'};
      }
      const subscription = sourceResult.value;
      active.subscription = subscription;
      this.publishLifecycleIfChanged();
      if (!this.isActive(pending.epoch)) {
        return {kind: 'not_listening', reason: this.disposed ? 'disposed' : 'cancelled'};
      }
    } catch {
      this.deactivateActive(pending.epoch);
      this.report('SOURCE_UNAVAILABLE');
      return {kind: 'not_listening', reason: 'source_unavailable'};
    }
    return {kind: 'listening', sessionId, expiresAtMs};
  }

  /**
   * Authorization and source readiness are external async boundaries. The
   * internal signal wins even when either never settles. Late results and
   * rejections are consumed; late source subscriptions are released.
   */
  private async awaitExternal(
    pending: PendingEnable,
    invoke: () => unknown,
    onResult?: (value: unknown) => void,
  ): Promise<ExternalWaitResult> {
    let check: Promise<ExternalWaitResult>;
    try {
      check = Promise.resolve(invoke()).then(
        value => {
          try { onResult?.(value); } catch { this.report('SOURCE_ERROR'); }
          return {kind: 'decision', value} as const;
        },
        () => ({kind: 'rejected'} as const),
      );
    } catch {
      check = Promise.resolve({kind: 'rejected'} as const);
    }
    let detach = (): void => {};
    const aborted = new Promise<ExternalWaitResult>(resolve => {
      const onAbort = (): void => resolve({kind: 'aborted'});
      if (pending.controller.signal.aborted) {
        resolve({kind: 'aborted'});
        return;
      }
      detach = (): void => pending.controller.signal.removeEventListener('abort', onAbort);
      pending.controller.signal.addEventListener('abort', onAbort, {once: true});
    });
    try {
      return await Promise.race([check, aborted]);
    } finally {
      detach();
    }
  }

  private handleSourceEvent(event: WakeSourceEvent, epoch: number): void {
    if (!this.isActive(epoch)) return;
    const kind = dataProperty(event, 'kind');
    if (kind === 'device_unavailable') {
      this.deactivateActive(epoch, 'DEVICE_UNAVAILABLE');
      return;
    }
    if (kind === 'error') {
      this.deactivateActive(epoch, 'SOURCE_ERROR');
      return;
    }
    if (kind !== 'wake') return;
    const active = this.active;
    if (!active?.subscription) return;
    const now = this.clock.now();
    if (now >= active.expiresAtMs) {
      this.expire(epoch);
      return;
    }
    if (this.playbackActive) return;
    if (this.cooldownUntilMs !== null && now < this.cooldownUntilMs) return;
    if (this.cooldownUntilMs !== null && now >= this.cooldownUntilMs) this.cooldownUntilMs = null;
    this.cooldownUntilMs = this.cooldownMs === 0 ? null : now + this.cooldownMs;
    const detected: WakeDetectedEvent = {kind: 'wake', sessionId: active.sessionId, occurredAtMs: now};
    try { this.options.onWake(detected); } catch { this.report('CALLBACK_FAILED'); }
  }

  private expire(epoch: number): void {
    const active = this.active;
    if (!active || active.epoch !== epoch) return;
    if (this.clock.now() < active.expiresAtMs) return;
    if (this.pending?.epoch === epoch) this.pending.deadlineReached.value = true;
    this.deactivateActive(epoch, 'EXPIRED');
  }

  private deactivateActive(epoch: number, error?: WakeErrorCode): void {
    const active = this.active;
    if (!active || active.epoch !== epoch) return;
    this.epoch++;
    this.active = undefined;
    this.cooldownUntilMs = null;
    active.expiryTimer.cancel();
    active.revocationSignal.removeEventListener('abort', active.revocationListener);
    if (active.callerSignal && active.callerListener) active.callerSignal.removeEventListener('abort', active.callerListener);
    if (active.subscription) this.safeUnsubscribe(active.subscription);
    active.controller.abort();
    if (error) this.report(error);
    this.publishLifecycleIfChanged();
  }

  private createLifecycleSnapshot(): WakeLifecycleStateSnapshot {
    const active = this.active;
    return Object.freeze({
      state: this.disposed ? 'disposed' : active?.subscription ? 'listening' : 'disabled',
      sessionId: active?.subscription ? active.sessionId : null,
      expiresAtMs: active?.subscription ? active.expiresAtMs : null,
    });
  }

  private sameLifecycleSnapshot(
    left: WakeLifecycleStateSnapshot,
    right: WakeLifecycleStateSnapshot,
  ): boolean {
    return left.state === right.state
      && left.sessionId === right.sessionId
      && left.expiresAtMs === right.expiresAtMs;
  }

  private publishLifecycleIfChanged(): void {
    const next = this.createLifecycleSnapshot();
    if (this.sameLifecycleSnapshot(this.lastLifecycleSnapshot, next)) return;
    this.lastLifecycleSnapshot = next;
    this.pendingLifecycleSnapshot = next;
    if (this.publishingLifecycle) return;

    this.publishingLifecycle = true;
    try {
      while (this.pendingLifecycleSnapshot) {
        const snapshot = this.pendingLifecycleSnapshot;
        this.pendingLifecycleSnapshot = undefined;
        for (const entry of [...this.lifecycleListeners]) {
          if (this.pendingLifecycleSnapshot) break;
          if (!entry.active || !this.lifecycleListeners.has(entry)) continue;
          if (this.sameLifecycleSnapshot(entry.lastSnapshot, snapshot)) continue;
          entry.lastSnapshot = snapshot;
          try { entry.listener(snapshot); } catch { this.report('CALLBACK_FAILED'); }
        }
      }
    } finally {
      this.publishingLifecycle = false;
    }
  }

  private isCurrentPending(pending: PendingEnable): boolean {
    return !this.disposed && this.pending?.epoch === pending.epoch && this.epoch === pending.epoch;
  }

  private isActive(epoch: number): boolean {
    return !this.disposed && this.active?.epoch === epoch && !this.active.controller.signal.aborted;
  }

  private abortReason(pending: PendingEnable): WakeEnableFailure {
    if (this.disposed) return 'disposed';
    if (pending.deadlineReached.value || this.clock.now() >= pending.deadlineAtMs) return 'expired';
    return 'cancelled';
  }

  private cleanupPending(pending: PendingEnable): void {
    pending.deadlineTimer?.cancel();
    if (pending.callerSignal && pending.callerListener) pending.callerSignal.removeEventListener('abort', pending.callerListener);
  }

  private safeUnsubscribe(subscription: WakeSubscription): void {
    try { subscription.unsubscribe(); } catch { this.report('SOURCE_ERROR'); }
  }

  private scheduleAt(whenMs: number, callback: () => void): WakeTimer {
    let cancelled = false;
    let timer: WakeTimer | undefined;
    const arm = (): void => {
      const remaining = Math.max(0, whenMs - this.clock.now());
      timer = this.clock.setTimeout(() => {
        if (cancelled) return;
        if (this.clock.now() < whenMs) arm();
        else callback();
      }, remaining);
    };
    arm();
    return {
      cancel: () => {
        cancelled = true;
        timer?.cancel();
      },
    };
  }

  private report(code: WakeErrorCode): void {
    try { this.onError({code}); } catch { /* Error reporting is deliberately best effort and sanitized. */ }
  }
}

export function createWakeLifecycleController(options: WakeLifecycleOptions): WakeLifecycleController {
  return new WakeLifecycleController(options);
}

export {FakeWakeAuthorization, FakeWakeClock, FakeWakeSource} from './testing.js';
export {
  createPcmKeywordWakeSignalSource,
  type WakeKeywordDetectorPort,
  type WakeKeywordDetectorSession,
  type WakePcmFrame,
  type WakePcmFrameSourcePort,
  type WakePcmFrameSubscription,
  type WakePcmKeywordSubscription,
} from './pcm-keyword-source.js';
