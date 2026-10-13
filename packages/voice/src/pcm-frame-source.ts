import {VoiceSessionError} from './errors.js';
import {
  MAX_FRAME_BYTES,
  MAX_QUEUE_BYTES,
  MAX_QUEUE_FRAMES,
  VOICE_AUDIO_FORMAT,
  type VoicePcmCaptureBinding,
  type VoicePcmCaptureSink,
  type VoicePcmCaptureSubscription,
  type VoicePcmFrame,
  type VoicePcmFrameSourcePort,
  type VoicePcmFrameSubscribeOptions,
  type VoicePcmFrameSubscription,
  type VoicePcmTerminalReason,
} from './ports.js';

const MAX_TIMER_MS = 2_147_483_647;
const isoDeadline = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'byteLength',
)?.get;

function invalid(message = 'Invalid voice PCM subscription input'): never {
  throw new VoiceSessionError('INVALID_ARGUMENT', message);
}

function chunkByteLength(value: unknown): number {
  if (typedArrayByteLength === undefined) invalid('Invalid voice PCM chunk');
  try {
    return typedArrayByteLength.call(value) as number;
  } catch {
    invalid('Invalid voice PCM chunk');
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (value === null || typeof value !== 'object') return false;
  try {
    const signal = value as {aborted: unknown; addEventListener: unknown; removeEventListener: unknown};
    return typeof signal.aborted === 'boolean'
      && typeof signal.addEventListener === 'function'
      && typeof signal.removeEventListener === 'function';
  } catch {
    return false;
  }
}

function parseDeadline(value: unknown): number {
  if (typeof value !== 'string' || !isoDeadline.test(value)) {
    invalid('Invalid voice PCM subscription deadline');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    invalid('Invalid voice PCM subscription deadline');
  }
  const canonical = new Date(parsed).toISOString();
  const normalize = (input: string): string => input.replace(/\.000Z$/, 'Z');
  if (normalize(value) !== normalize(canonical)) {
    invalid('Invalid voice PCM subscription deadline');
  }
  return parsed;
}

function extractChunkData(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk !== null && typeof chunk === 'object' && 'data' in chunk) {
    const data = (chunk as {data: unknown}).data;
    if (data instanceof Uint8Array) return data;
  }
  invalid('Invalid voice PCM frame');
}

function readyErrorForReason(reason: VoicePcmTerminalReason): VoiceSessionError {
  switch (reason) {
    case 'cancelled':
      return new VoiceSessionError('CANCELLED', 'Voice PCM subscription cancelled before capture ready');
    case 'deadline':
      return new VoiceSessionError('TIMEOUT', 'Voice PCM subscription deadline expired before capture ready');
    case 'disposed':
      return new VoiceSessionError('INVALID_STATE', 'Voice PCM subscription disposed before capture ready');
    case 'revoked':
      return new VoiceSessionError('EXTERNAL_FAILURE', 'Voice PCM capture revoked before capture ready');
    case 'overflow':
      return new VoiceSessionError('EXTERNAL_FAILURE', 'Voice PCM buffer overflow before capture ready');
    case 'device_unavailable':
    default:
      return new VoiceSessionError('EXTERNAL_FAILURE', 'Voice PCM capture start failed');
  }
}

class SubscriptionSession {
  private state: 'active' | 'closed' = 'active';
  private endCalled = false;
  private isDraining = false;
  private currentInFlightFrame: VoicePcmFrame | undefined;
  private nextSequence = 0;
  private queuedBytes = 0;
  private readonly queue: VoicePcmFrame[] = [];
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onAbort = (): void => {
    this.close('cancelled');
  };
  private resolveUpstreamSub!: (sub: VoicePcmCaptureSubscription | undefined) => void;
  private rejectUpstreamSub!: (reason: unknown) => void;
  private readonly upstreamSubPromise: Promise<VoicePcmCaptureSubscription | undefined>;
  private upstreamReleasePromise: Promise<void> | undefined;
  private resolveReady!: () => void;
  private rejectReady!: (reason: unknown) => void;
  private readySettled = false;
  /**
   * Resolves only after the host capture binding has successfully returned a valid release
   * handle and confirmed capture availability. Rejects with VoiceSessionError if start fails,
   * an invalid handle is returned, or the subscription terminates before ready.
   */
  readonly ready: Promise<void>;
  private resolveClosed!: () => void;
  private rejectClosed!: (reason: unknown) => void;
  /**
   * Resolves only after successful host release of this subscription's attachment and rejects
   * with EXTERNAL_FAILURE if host release fails or start failure prevents release proof.
   * The host must not infer track release from an onEnd callback alone. Proves only that this
   * attachment was detached; physical capture continues if other subscribers remain active.
   */
  readonly closed: Promise<void>;

  get isClosed(): boolean {
    return this.state === 'closed';
  }

  constructor(
    private readonly options: VoicePcmFrameSubscribeOptions,
    private readonly deadlineMs: number,
    private readonly startUpstream: (
      sink: VoicePcmCaptureSink,
    ) => Promise<VoicePcmCaptureSubscription> | VoicePcmCaptureSubscription,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready.catch(() => {});

    this.closed = new Promise<void>((resolve, reject) => {
      this.resolveClosed = resolve;
      this.rejectClosed = reject;
    });
    this.closed.catch(() => {});

    this.upstreamSubPromise = new Promise<VoicePcmCaptureSubscription | undefined>((resolve, reject) => {
      this.resolveUpstreamSub = resolve;
      this.rejectUpstreamSub = reject;
    });
    this.upstreamSubPromise.catch(() => {});

    try {
      options.signal.addEventListener('abort', this.onAbort, {once: true});
    } catch {
      invalid();
    }

    if (options.signal.aborted) {
      this.resolveUpstreamSub(undefined);
      this.close('cancelled');
      return;
    }

    if (deadlineMs <= Date.now()) {
      this.resolveUpstreamSub(undefined);
      this.close('deadline');
      return;
    }

    this.scheduleDeadline();
  }

  start(): void {
    if (this.isActive()) this.initUpstream();
    else this.resolveUpstreamSub(undefined);
  }

  private isActive(): boolean {
    if (this.state !== 'active') return false;
    if (this.options.signal.aborted) this.close('cancelled');
    else if (this.deadlineMs <= Date.now()) this.close('deadline');
    return this.state === 'active';
  }

  private scheduleDeadline(): void {
    if (this.state !== 'active') return;
    const remaining = this.deadlineMs - Date.now();
    if (remaining <= 0) {
      this.close('deadline');
      return;
    }
    this.deadlineTimer = setTimeout(() => this.scheduleDeadline(), Math.min(remaining, MAX_TIMER_MS));
    this.deadlineTimer.unref?.();
  }

  private initUpstream(): void {
    const sink: VoicePcmCaptureSink = {
      onFrame: (chunk: unknown) => {
        this.handleUpstreamFrame(chunk);
      },
      onRevoked: () => {
        this.close('revoked');
      },
      onDeviceUnavailable: () => {
        this.close('device_unavailable');
      },
    };

    let startResult: unknown;
    try {
      startResult = this.startUpstream(sink);
    } catch {
      this.rejectUpstreamSub(
        new VoiceSessionError('EXTERNAL_FAILURE', 'Voice PCM capture release failed'),
      );
      this.close('device_unavailable');
      return;
    }

    const handleSub = (sub: unknown): void => {
      if (sub !== null && typeof sub === 'object' && typeof (sub as VoicePcmCaptureSubscription).release === 'function') {
        this.resolveUpstreamSub(sub as VoicePcmCaptureSubscription);
        if (this.isActive() && !this.readySettled) {
          this.readySettled = true;
          this.resolveReady();
        }
      } else {
        this.rejectUpstreamSub(
          new VoiceSessionError('EXTERNAL_FAILURE', 'Voice PCM capture release failed'),
        );
        this.close('device_unavailable');
      }
    };

    if (startResult !== null && typeof startResult === 'object' && typeof (startResult as Promise<unknown>).then === 'function') {
      (startResult as Promise<unknown>)
        .then(sub => {
          handleSub(sub);
        })
        .catch(() => {
          this.rejectUpstreamSub(
            new VoiceSessionError('EXTERNAL_FAILURE', 'Voice PCM capture release failed'),
          );
          this.close('device_unavailable');
        });
    } else {
      handleSub(startResult);
    }
  }

  private handleUpstreamFrame(chunk: unknown): void {
    if (!this.isActive()) return;

    let rawData: Uint8Array;
    let length: number;
    try {
      rawData = extractChunkData(chunk);
      length = chunkByteLength(rawData);
      if (length === 0 || length % 2 !== 0 || length > MAX_FRAME_BYTES) {
        this.close('device_unavailable');
        return;
      }
    } catch {
      this.close('device_unavailable');
      return;
    }

    if (this.queue.length >= MAX_QUEUE_FRAMES || this.queuedBytes + length > MAX_QUEUE_BYTES) {
      this.close('overflow');
      return;
    }

    const copy = new Uint8Array(length);
    copy.set(rawData);
    const frame: VoicePcmFrame = Object.freeze({
      sequence: this.nextSequence++,
      data: copy,
      format: VOICE_AUDIO_FORMAT,
    });

    this.queue.push(frame);
    this.queuedBytes += length;

    if (!this.isDraining) {
      void this.drainQueue();
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.isDraining || this.state !== 'active') return;
    this.isDraining = true;
    try {
      while (this.isActive() && this.queue.length > 0) {
        const frame = this.queue.shift()!;
        this.queuedBytes -= frame.data.byteLength;
        this.currentInFlightFrame = frame;
        try {
          const res = this.options.onFrame(frame);
          if (res !== null && typeof res === 'object' && typeof (res as Promise<void>).then === 'function') {
            await res;
          }
        } catch {
          this.close('disposed');
          break;
        } finally {
          frame.data.fill(0);
          if (this.currentInFlightFrame === frame) {
            this.currentInFlightFrame = undefined;
          }
        }
      }
    } finally {
      this.isDraining = false;
    }
  }

  close(reason: VoicePcmTerminalReason): void {
    if (this.state === 'closed') return;
    this.state = 'closed';

    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(readyErrorForReason(reason));
    }

    if (this.deadlineTimer !== undefined) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = undefined;
    }
    try {
      this.options.signal.removeEventListener('abort', this.onAbort);
    } catch {
      // Best-effort
    }

    for (const item of this.queue) {
      item.data.fill(0);
    }
    this.queue.length = 0;
    this.queuedBytes = 0;

    if (this.currentInFlightFrame !== undefined) {
      this.currentInFlightFrame.data.fill(0);
      this.currentInFlightFrame = undefined;
    }

    if (!this.endCalled) {
      this.endCalled = true;
      try {
        this.options.onEnd(reason);
      } catch {
        // Callback errors contained
      }
    }

    this.releaseUpstream().then(
      () => {
        this.resolveClosed();
      },
      () => {
        this.rejectClosed(
          new VoiceSessionError('EXTERNAL_FAILURE', 'Voice PCM capture release failed'),
        );
      },
    );
  }

  private async releaseUpstream(): Promise<void> {
    if (this.upstreamReleasePromise !== undefined) return this.upstreamReleasePromise;
    this.upstreamReleasePromise = (async () => {
      const sub = await this.upstreamSubPromise;
      if (sub !== undefined && typeof sub.release === 'function') {
        await sub.release();
      }
    })();
    this.upstreamReleasePromise.catch(() => {});
    return this.upstreamReleasePromise;
  }
}

/**
 * Creates an authorized voice PCM frame source port bound to a trusted host capture source.
 * The voice package never opens a microphone, checks OS permission, or issues capture authorization.
 * The host must verify user consent and hardware capture beforehand and pass its authorized binding here.
 *
 * The host capture binding represents a single authorized physical capture source; multiple
 * subscribers attach concurrently via refcount/fanout. Each subscription exposes `ready`, which
 * resolves only after the host binding returns a valid release handle and confirms capture availability.
 * Each subscription's `closed` promise resolves only after successful host release of that
 * subscription's attachment (and rejects with EXTERNAL_FAILURE if release fails or start failure
 * prevents release proof). The host must clean up its own partial capture resources on start failure;
 * the host must not infer physical track release from an onEnd callback alone.
 * `port.dispose()` awaits all attachments and serves as the whole-source release receipt under the host contract.
 */
export function createVoicePcmFrameSourcePort(
  binding: VoicePcmCaptureBinding,
): VoicePcmFrameSourcePort {
  if (!binding || typeof binding !== 'object' || typeof binding.start !== 'function') {
    invalid('Trusted host audio capture binding is required');
  }

  const activeSubscriptions = new Set<SubscriptionSession>();
  let hasReleaseFailure = false;
  let disposed = false;
  let disposePromise: Promise<void> | undefined;

  return {
    subscribe(options: VoicePcmFrameSubscribeOptions): VoicePcmFrameSubscription {
      if (disposed) {
        throw new VoiceSessionError('INVALID_STATE', 'Voice PCM frame source port is disposed');
      }
      if (hasReleaseFailure) {
        throw new VoiceSessionError('EXTERNAL_FAILURE', 'Voice PCM capture release failed');
      }
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        invalid('Invalid voice PCM subscription options');
      }
      if (!isAbortSignal(options.signal)) {
        invalid('Invalid voice PCM subscription signal');
      }
      if (typeof options.onFrame !== 'function') {
        invalid('Invalid voice PCM subscription onFrame handler');
      }
      if (typeof options.onEnd !== 'function') {
        invalid('Invalid voice PCM subscription onEnd handler');
      }

      const deadlineMs = parseDeadline(options.deadline);

      const session = new SubscriptionSession(
        options,
        deadlineMs,
        sink => binding.start(sink),
      );

      activeSubscriptions.add(session);
      session.closed
        .catch(() => {
          hasReleaseFailure = true;
        })
        .finally(() => {
          activeSubscriptions.delete(session);
        })
        .catch(() => {});

      // Register before calling the host: start may synchronously reenter dispose.
      session.start();
      return {
        ready: session.ready,
        unsubscribe(): void {
          session.close('disposed');
        },
        closed: session.closed,
      };
    },

    dispose(): Promise<void> {
      if (disposePromise !== undefined) return disposePromise;
      disposed = true;
      disposePromise = (async () => {
        const running = Array.from(activeSubscriptions);
        for (const sub of running) {
          sub.close('disposed');
        }
        const results = await Promise.allSettled(running.map(sub => sub.closed));
        const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (rejected) {
          hasReleaseFailure = true;
        }
        if (hasReleaseFailure) {
          throw new VoiceSessionError('EXTERNAL_FAILURE', 'Voice PCM capture release failed');
        }
      })();
      disposePromise.catch(() => {});
      return disposePromise;
    },
  };
}
