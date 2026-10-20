import {randomUUID} from 'node:crypto';
import {VoiceSessionError} from './errors.js';
import type {SpeechOutputPort, VoiceOperation} from './ports.js';

/** Trusted host adapter to the existing Live/Wake lifecycle, not a new audio loop. */
export interface ContinuousVoiceListeningPort {
  /** Existing host owns each bounded capture lease and its renewal; no second expiry loop. */
  readonly renewsOwnLease?: boolean;
  start(request: {readonly signal: AbortSignal; readonly deadline: string}): {
    readonly ready: Promise<void>;
    /** Must cover pending startup as well as an established session. */
    stop(): Promise<{readonly resourcesReleased: boolean}>;
  };
}

/** Adapter for Desktop's existing Live host; it never owns a second session loop. */
export function createVoiceHostListeningPort(host: {
  start(): Promise<{readonly status: string}>;
  stop(): Promise<unknown>;
  hasActive(): boolean;
}): ContinuousVoiceListeningPort {
  return {renewsOwnLease:true, start(request) {
    if (request.signal.aborted || Date.now() >= Date.parse(request.deadline) || host.hasActive()) {
      throw new VoiceSessionError('INVALID_STATE', 'Voice host unavailable');
    }
    let attempted = false, closed = false;
    let release: Promise<{resourcesReleased: boolean}> | undefined;
    return {ready: Promise.resolve().then(async () => {
      if (closed || request.signal.aborted || Date.now() >= Date.parse(request.deadline)) {
        throw new VoiceSessionError('CANCELLED', 'Voice host start cancelled');
      }
      if (host.hasActive()) throw new VoiceSessionError('INVALID_STATE', 'Voice host unavailable');
      attempted = true;
      const result = await host.start();
      if (result.status !== 'listening') throw new VoiceSessionError('EXTERNAL_FAILURE', 'Voice host not listening');
    }), stop() {
      closed = true;
      release ??= Promise.resolve().then(async () => {
        if (attempted) await host.stop();
        return {resourcesReleased: !attempted || !host.hasActive()};
      });
      return release;
    }};
  }};
}

export interface VoiceStartupRequest {
  /** Current trusted user settings; absence of consent must be represented as false. */
  readonly enabled: boolean;
  readonly greet: boolean;
  readonly listen: boolean;
  readonly signal: AbortSignal;
  readonly deadline: string;
}

export interface VoiceStartupSnapshot {
  readonly state: 'disabled' | 'starting' | 'listening' | 'stopping' | 'stopped'
    | 'unavailable' | 'release_unconfirmed' | 'disposed';
  readonly greeting: 'not_requested' | 'pending' | 'completed' | 'failed' | 'unavailable';
  readonly resourcesReleased: boolean;
  readonly verification: 'unverified';
}

export interface VoiceStartupController {
  start(request: VoiceStartupRequest): Promise<VoiceStartupSnapshot>;
  /** Host-triggered resume never repeats the application greeting or renews an old grant. */
  resume(request: VoiceStartupRequest): Promise<VoiceStartupSnapshot>;
  stop(): Promise<VoiceStartupSnapshot>;
  dispose(): Promise<VoiceStartupSnapshot>;
  snapshot(): VoiceStartupSnapshot;
}

type ListeningHandle = ReturnType<ContinuousVoiceListeningPort['start']>;
type RecordState = {
  controller: AbortController;
  request: VoiceStartupRequest;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
  onAbort: () => void;
  speech?: VoiceOperation<void>;
  speechRelease?: Promise<void>;
  listening?: ListeningHandle;
  starting?: Promise<VoiceStartupSnapshot>;
  stopping?: Promise<VoiceStartupSnapshot>;
};

const GREETING = '你好，PersonalAgent 已启动。';

/** Only consumes injected ports after explicit enablement. Owns no settings or Runtime tasks. */
export function createVoiceStartupController({output, listening}: {
  readonly output?: SpeechOutputPort;
  readonly listening?: ContinuousVoiceListeningPort;
} = {}): VoiceStartupController {
  let state: VoiceStartupSnapshot['state'] = 'disabled';
  let greeting: VoiceStartupSnapshot['greeting'] = 'not_requested';
  let active: RecordState | undefined;
  let greetingAttempted = false, releaseUnknown = false, disposed = false;
  let intent = 0;
  const snapshot = (): VoiceStartupSnapshot => Object.freeze({state, greeting,
    resourcesReleased: !active && !releaseUnknown, verification: 'unverified'});
  const failure = () => new VoiceSessionError('EXTERNAL_FAILURE', 'Voice startup unavailable');
  const releaseSpeech = (record: RecordState, reason: 'completed' | 'cancelled') => {
    record.speechRelease ??= Promise.resolve().then(() => record.speech?.stop(reason));
    return record.speechRelease;
  };
  const assertCurrent = (record: RecordState) => {
    if (record.controller.signal.aborted || record.request.signal.aborted || active !== record
      || Date.now() >= record.expiresAt || disposed) {
      throw new VoiceSessionError('CANCELLED', 'Voice startup cancelled or expired');
    }
  };

  function stop(record = active): Promise<VoiceStartupSnapshot> {
    if (!record) return Promise.resolve(snapshot());
    if (record.stopping) return record.stopping;
    if (active !== record) return Promise.resolve(snapshot());
    state = 'stopping';
    // Install the shared release promise before dispatching reentrant abort listeners.
    record.stopping = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        releaseSpeech(record, 'cancelled'),
        Promise.resolve().then(async () => {
          if (record.listening && (await record.listening.stop()).resourcesReleased !== true) throw failure();
        }),
      ]);
      if (results.some(result => result.status === 'rejected')) releaseUnknown = true;
      if (active === record) active = undefined;
      state = releaseUnknown ? 'release_unconfirmed' : disposed ? 'disposed' : 'stopped';
      return snapshot();
    });
    clearTimeout(record.timer);
    record.request.signal.removeEventListener('abort', record.onAbort);
    record.controller.abort();
    return record.stopping;
  }

  async function run(record: RecordState, greet: boolean): Promise<VoiceStartupSnapshot> {
    const stopped = new Promise<never>((_, reject) => {
      record.controller.signal.addEventListener('abort', () => reject(
        new VoiceSessionError('CANCELLED', 'Voice startup cancelled or expired')), {once: true});
    });
    stopped.catch(() => {});
    try {
      assertCurrent(record);
      if (greet && !greetingAttempted) {
        greetingAttempted = true;
        if (!output) greeting = 'unavailable';
        else {
          greeting = 'pending';
          record.speech = output.speak({sessionId: randomUUID(), replyId: randomUUID(), text: GREETING,
            locale: 'zh-CN', signal: record.controller.signal, deadline: record.request.deadline});
          try {
            await Promise.race([record.speech.result, stopped]);
            assertCurrent(record);
            greeting = 'completed';
          } catch (error) {
            greeting = 'failed';
            // A failed greeting may continue only after its exact output handle is released.
            if (record.controller.signal.aborted) throw error;
          }
          await Promise.race([releaseSpeech(record, 'completed'), stopped]);
          delete record.speech;
          assertCurrent(record);
        }
      }
      if (record.request.listen) {
        if (!listening) throw failure();
        assertCurrent(record);
        record.listening = listening.start({signal: record.controller.signal, deadline: record.request.deadline});
        await Promise.race([record.listening.ready, stopped]);
        assertCurrent(record);
        if (listening.renewsOwnLease === true) clearTimeout(record.timer);
        state = 'listening';
        return snapshot();
      }
      await stop();
      return snapshot();
    } catch (error) {
      const wasCurrent = active === record;
      const cancelled = record.controller.signal.aborted || record.request.signal.aborted || disposed;
      await stop(record);
      if (wasCurrent && !active && !releaseUnknown && !cancelled && !disposed) state = 'unavailable';
      if (cancelled) throw new VoiceSessionError('CANCELLED', 'Voice startup cancelled or expired');
      throw failure();
    }
  }

  function start(request: VoiceStartupRequest, resuming = false): Promise<VoiceStartupSnapshot> {
    if (!request || typeof request.enabled !== 'boolean' || typeof request.greet !== 'boolean'
      || typeof request.listen !== 'boolean' || !request.signal
      || typeof request.signal.addEventListener !== 'function'
      || typeof request.signal.removeEventListener !== 'function'
      || typeof request.deadline !== 'string' || !Number.isFinite(Date.parse(request.deadline))) {
      return Promise.reject(new VoiceSessionError('INVALID_ARGUMENT', 'Invalid voice startup request'));
    }
    if (disposed) return Promise.reject(new VoiceSessionError('INVALID_STATE', 'Voice startup disposed'));
    if (releaseUnknown) return Promise.reject(failure());
    if (!request.enabled) return stop();
    if (active) return Promise.reject(new VoiceSessionError('INVALID_STATE', 'Voice startup already active'));
    const expiresAt = Date.parse(request.deadline);
    if (request.signal.aborted || expiresAt <= Date.now() || expiresAt - Date.now() > 2_147_483_647) {
      return Promise.reject(new VoiceSessionError('CANCELLED', 'Voice startup cancelled or expired'));
    }
    const record: RecordState = {request: Object.freeze({...request}), expiresAt,
      controller: new AbortController(), onAbort: () => {void stop();}};
    active = record; state = 'starting';
    record.request.signal.addEventListener('abort', record.onAbort, {once: true});
    record.timer = setTimeout(record.onAbort, Math.max(1, expiresAt - Date.now()));
    record.timer.unref?.();
    record.starting = run(record, !resuming && request.greet);
    return record.starting;
  }

  return {start(request) {intent++; return start(request);},
    async resume(request) {
      const revision = ++intent;
      await stop();
      if (revision !== intent) throw new VoiceSessionError('CANCELLED', 'Voice startup cancelled');
      return start(request, true);
    }, stop() {intent++; return stop();}, snapshot,
    async dispose() {intent++; disposed = true; await stop(); if (!releaseUnknown) state = 'disposed'; return snapshot();}};
}
