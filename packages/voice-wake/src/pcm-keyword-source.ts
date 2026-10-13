import type {WakeSignalSource, WakeSourceContext, WakeSourceEvent, WakeSubscription} from './index.js';

/** Structural host ports keep this package independent of MOD-14's voice package. */
export interface WakePcmFrame {
  readonly sequence: number;
  readonly data: Uint8Array;
  readonly format: {readonly encoding: 'pcm_s16le'; readonly sampleRateHz: 16_000; readonly channels: 1};
}

export type WakePcmEndReason =
  | 'cancelled' | 'deadline' | 'revoked' | 'device_unavailable' | 'overflow' | 'disposed';

export interface WakePcmFrameSubscription {
  unsubscribe(): void;
  /** Resolves when this subscriber's host reference has been released. */
  readonly closed: Promise<void>;
  /** Resolves only when the trusted capture host is actually ready. */
  readonly ready: Promise<void>;
}

export interface WakePcmFrameSourcePort {
  subscribe(options: {
    readonly signal: AbortSignal;
    readonly deadline: string;
    readonly onFrame: (frame: WakePcmFrame) => void;
    readonly onEnd: (reason: WakePcmEndReason) => void;
  }): WakePcmFrameSubscription;
}

export interface WakeKeywordDetectorSession {
  /** A resolved ready means the restricted grammar is running. */
  readonly ready: Promise<void>;
  readonly closed: Promise<unknown>;
  accept(frame: WakePcmFrame): void;
  stop(): Promise<void> | void;
}

export interface WakeKeywordDetectorPort {
  start(options: {
    readonly signal: AbortSignal;
    readonly deadline: string;
    readonly onDetected: () => void;
  }): WakeKeywordDetectorSession;
}

export interface WakePcmKeywordSubscription extends WakeSubscription {
  /** Wake's source reference and detector have both stopped; other capture users may remain. */
  readonly closed: Promise<void>;
}

const MAX_TIMER_MS = 2_147_483_647;
const MAX_FRAME_BYTES = 3_200;

function isPromise(value: unknown): value is Promise<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as Promise<unknown>).then === 'function';
}

function validFrame(value: unknown, expectedSequence: number): value is WakePcmFrame {
  try {
    const frame = value as WakePcmFrame;
    return frame.sequence === expectedSequence
      && frame.data instanceof Uint8Array
      && frame.data.byteLength > 0
      && frame.data.byteLength <= MAX_FRAME_BYTES
      && frame.data.byteLength % 2 === 0
      && frame.format.encoding === 'pcm_s16le'
      && frame.format.sampleRateHz === 16_000
      && frame.format.channels === 1;
  } catch {
    return false;
  }
}

/** Consume one authorized PCM subscription and one host-configured, fixed-keyword detector. */
export function createPcmKeywordWakeSignalSource(
  pcm: WakePcmFrameSourcePort,
  detector: WakeKeywordDetectorPort,
): WakeSignalSource {
  if (typeof pcm?.subscribe !== 'function' || typeof detector?.start !== 'function') {
    throw new TypeError('Wake PCM source and keyword detector are required');
  }

  return {
    async subscribe(listener: (event: WakeSourceEvent) => void, context: WakeSourceContext): Promise<WakePcmKeywordSubscription> {
      const deadlineAtMs = context?.deadlineAtMs;
      if (typeof listener !== 'function' || !context?.signal || !Number.isSafeInteger(deadlineAtMs)
        || deadlineAtMs <= Date.now() || deadlineAtMs > 253_402_300_799_999) {
        throw new TypeError('Invalid wake PCM subscription');
      }

      const deadline = new Date(deadlineAtMs).toISOString();
      let source: WakePcmFrameSubscription | undefined;
      let session: WakeKeywordDetectorSession | undefined;
      let sourceStarting = false;
      let stopped = false;
      let failed = false;
      let listening = false;
      let nextSequence = 0;
      let releasePromise: Promise<void> | undefined;
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      let resolveSourceStart!: () => void;
      let resolveAbort!: () => void;
      let resolveTerminal!: () => void;
      let resolveClosed!: () => void;
      let rejectClosed!: (error: Error) => void;
      const aborted = new Promise<void>(resolve => { resolveAbort = resolve; });
      const terminal = new Promise<void>(resolve => { resolveTerminal = resolve; });
      const sourceStartFinished = new Promise<void>(resolve => { resolveSourceStart = resolve; });
      const closed = new Promise<void>((resolve, reject) => {
        resolveClosed = resolve;
        rejectClosed = reject;
      });
      // A failed pre-ready subscription has no returned handle that can observe closed.
      void closed.catch(() => {});

      const release = (): Promise<void> => {
        if (releasePromise) return releasePromise;
        stopped = true;
        listening = false;
        resolveAbort();
        context.signal.removeEventListener('abort', onAbort);
        if (deadlineTimer) clearTimeout(deadlineTimer);
        releasePromise = (async () => {
          // A synchronous detector start may revoke before assigning its returned handle.
          await Promise.resolve();
          // A host may revoke synchronously from inside subscribe before its handle returns.
          if (sourceStarting) await sourceStartFinished;
          let unsubscribeFailed = false;
          try { source?.unsubscribe(); } catch { unsubscribeFailed = true; }
          let stopResult: Promise<void>;
          try { stopResult = Promise.resolve(session?.stop()); }
          catch { stopResult = Promise.reject(new Error('Keyword detector stop failed')); }
          const results = await Promise.allSettled([
            source?.closed ?? Promise.resolve(),
            session?.closed ?? Promise.resolve(),
            stopResult,
          ]);
          if (unsubscribeFailed || results.some(result => result.status === 'rejected')) {
            throw new Error('Wake source release failed');
          }
        })();
        void releasePromise.then(resolveClosed, () => rejectClosed(new Error('Wake source release failed')));
        return releasePromise;
      };

      const fail = (kind: 'device_unavailable' | 'error'): void => {
        if (failed || stopped) return;
        failed = true;
        resolveTerminal();
        try { listener({kind}); } catch { /* The lifecycle owns callback error reporting. */ }
        // onEnd may run synchronously inside pcm.subscribe before its handle is returned.
        if (!sourceStarting) void release();
      };
      const ensureActive = (): boolean => {
        if (stopped || failed) return false;
        if (Date.now() < deadlineAtMs) return true;
        // A suspended host may resume before its deadline timer is dispatched.
        fail('error');
        return false;
      };
      const onAbort = (): void => { void release(); };
      const armDeadline = (): void => {
        if (stopped) return;
        const remaining = deadlineAtMs - Date.now();
        if (remaining <= 0) { fail('error'); return; }
        deadlineTimer = setTimeout(armDeadline, Math.min(remaining, MAX_TIMER_MS));
        deadlineTimer.unref?.();
      };
      const waitReady = async (ready: Promise<void>): Promise<boolean> => Promise.race([
        Promise.resolve(ready).then(() => true, () => false),
        aborted.then(() => false),
        terminal.then(() => false),
      ]);

      context.signal.addEventListener('abort', onAbort, {once: true});
      if (context.signal.aborted) onAbort();
      else armDeadline();

      try {
        if (!ensureActive()) throw new Error('Wake subscription stopped');
        session = detector.start({signal: context.signal, deadline, onDetected: () => {
          if (ensureActive() && listening) listener({kind: 'wake'});
        }});
        if (!session || !isPromise(session.ready) || !isPromise(session.closed)
          || typeof session.accept !== 'function' || typeof session.stop !== 'function') {
          throw new Error('Keyword detector readiness unavailable');
        }
        void session.closed.then(() => fail('error'), () => fail('error'));
        if (!ensureActive() || !await waitReady(session.ready) || !ensureActive()) {
          throw new Error('Keyword detector unavailable');
        }

        sourceStarting = true;
        try {
          source = pcm.subscribe({
            signal: context.signal,
            deadline,
            onFrame: frame => {
              if (!ensureActive()) return;
              if (!validFrame(frame, nextSequence++)) { fail('error'); return; }
              try { session?.accept(frame); } catch { fail('error'); }
            },
            onEnd: reason => fail(reason === 'device_unavailable' ? 'device_unavailable' : 'error'),
          });
        } finally {
          sourceStarting = false;
          resolveSourceStart();
        }
        if (!source || typeof source.unsubscribe !== 'function' || !isPromise(source.closed)
          || !isPromise(source.ready)) {
          throw new Error('Trusted capture readiness unavailable');
        }
        void source.closed.then(() => fail('device_unavailable'), () => fail('error'));
        if (!ensureActive() || !await waitReady(source.ready) || !ensureActive()) {
          throw new Error('Trusted capture unavailable');
        }
        listening = true;
        return {unsubscribe: () => { void release(); }, closed};
      } catch {
        void release();
        throw new Error('Wake PCM source unavailable');
      }
    },
  };
}
