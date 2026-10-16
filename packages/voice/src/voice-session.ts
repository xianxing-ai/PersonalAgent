import {randomUUID} from 'node:crypto';
import {VoiceSessionError, type VoiceErrorCode} from './errors.js';
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  MAX_SPEECH_CHARACTERS,
  MAX_TRANSCRIPT_CHARACTERS,
  VOICE_AUDIO_FORMAT,
  type SpeechOutputPort,
  type SpeechOutputRequest,
  type SpeechRecognitionPort,
  type SpeechRecognitionRequest,
  type SpeechRecognitionResult,
  type TranscriptConsumerPort,
  type TranscriptConsumptionRequest,
  type TranscriptConsumptionResult,
  type VoiceAudioClip,
  type VoiceOperation,
  type VoiceOperationStopReason,
} from './ports.js';
import {UnavailableSpeechOutputPort, UnavailableSpeechRecognitionPort} from './unavailable.js';

const isoDeadline = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const localePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const terminalStates = new Set<VoiceSessionState>(['stopped', 'cancelled', 'expired']);

export type VoiceSessionState =
  | 'listening'
  | 'recognizing'
  | 'awaiting_consume'
  | 'consuming'
  | 'awaiting_speech'
  | 'speaking'
  | 'stopped'
  | 'cancelled'
  | 'expired';

export type VoiceSessionTerminalReason = 'user' | 'cancelled' | 'deadline' | 'replaced' | 'disposed';

export interface StartVoiceSessionOptions {
  readonly deadline: string;
  readonly signal: AbortSignal;
  readonly locale?: string;
}

export interface VoiceSessionSnapshot {
  readonly sessionId: string;
  readonly state: VoiceSessionState;
  readonly revision: number;
  readonly startedAt: string;
  readonly deadline: string;
  readonly locale: string;
  readonly transcriptReady: boolean;
  readonly replyReady: boolean;
  readonly playbackActive: boolean;
  readonly terminalReason?: VoiceSessionTerminalReason;
}

export type VoiceSessionListener = (snapshot: VoiceSessionSnapshot) => void;

export interface TranscriptReceipt {
  readonly sessionId: string;
  readonly transcriptId: string;
  readonly characterCount: number;
}

export interface ReplyReceipt {
  readonly sessionId: string;
  readonly replyId: string;
  readonly characterCount: number;
}

export interface SpeechPlaybackResult {
  readonly sessionId: string;
  readonly completed: boolean;
  readonly interrupted: boolean;
}

export interface StopSpeakingResult {
  readonly sessionId: string;
  readonly playbackStopped: boolean;
  readonly resourcesReleased: boolean;
}

export interface StopVoiceSessionResult {
  readonly sessionId: string;
  readonly state: 'stopped' | 'cancelled' | 'expired';
  readonly reason: VoiceSessionTerminalReason;
  readonly stopped: true;
  readonly resourcesReleased: boolean;
}

export type VoiceIdKind = 'session' | 'transcript' | 'reply';

export interface VoiceSessionManagerOptions {
  readonly recognition?: SpeechRecognitionPort;
  readonly output?: SpeechOutputPort;
  readonly idFactory?: (kind: VoiceIdKind) => string;
}

interface PrivateTranscript {
  readonly text: string;
  readonly locale: string;
}

interface PrivateReply {
  readonly text: string;
  readonly locale: string;
}

type ActiveOperationKind = 'recognition' | 'consumption' | 'playback';

interface ActiveOperation<T = unknown> {
  readonly kind: ActiveOperationKind;
  readonly controller: AbortController;
  readonly handle: VoiceOperation<T>;
  readonly detachRoot: () => void;
  interruptedByUser: boolean;
  abortCode?: VoiceErrorCode;
  abortMessage?: string;
  releaseReason?: VoiceOperationStopReason;
  releasePromise?: Promise<boolean>;
}

interface SessionRecord {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly deadline: string;
  readonly expiresAt: number;
  readonly locale: string;
  readonly root: AbortController;
  readonly parentSignal: AbortSignal;
  readonly transcripts: Map<string, PrivateTranscript>;
  readonly replies: Map<string, PrivateReply>;
  readonly operations: Set<ActiveOperation>;
  state: VoiceSessionState;
  revision: number;
  terminalReason?: VoiceSessionTerminalReason;
  abortCode?: VoiceErrorCode;
  abortMessage?: string;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  parentAbortListener?: () => void;
  stopPromise?: Promise<StopVoiceSessionResult>;
}

interface VoiceListenerRegistration {
  readonly listener: VoiceSessionListener;
  active: boolean;
  lastSessionId?: string;
  lastRevision?: number;
}

function invalidArgument(message = 'Invalid voice session input'): never {
  throw new VoiceSessionError('INVALID_ARGUMENT', message);
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

function signalAborted(signal: AbortSignal): boolean {
  try {
    if (typeof signal.aborted !== 'boolean') invalidArgument();
    return signal.aborted;
  } catch {
    invalidArgument();
  }
}

function parseDeadline(value: unknown): number {
  if (typeof value !== 'string' || !isoDeadline.test(value)) {
    invalidArgument('Invalid voice session deadline');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) invalidArgument('Invalid voice session deadline');
  const canonical = new Date(parsed).toISOString();
  const normalize = (input: string): string => input.replace(/\.000Z$/, 'Z');
  if (normalize(value) !== normalize(canonical)) invalidArgument('Invalid voice session deadline');
  return parsed;
}

function validateLocale(value: unknown): string {
  if (value === undefined) return 'zh-CN';
  if (typeof value !== 'string' || value.length > 35 || !localePattern.test(value)) {
    invalidArgument('Invalid voice locale');
  }
  return value;
}

function exactAudioFormat(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const format = value as Record<string, unknown>;
    const keys = Reflect.ownKeys(format);
    return keys.length === 3
      && keys.every(key => typeof key === 'string' && ['encoding', 'sampleRateHz', 'channels'].includes(key))
      && format.encoding === VOICE_AUDIO_FORMAT.encoding
      && format.sampleRateHz === VOICE_AUDIO_FORMAT.sampleRateHz
      && format.channels === VOICE_AUDIO_FORMAT.channels;
  } catch {
    return false;
  }
}

function validateAudioClip(clip: VoiceAudioClip): {data: Uint8Array; durationMs: number} {
  let data: unknown;
  let format: unknown;
  let durationMs: unknown;
  try {
    if (clip === null || typeof clip !== 'object' || Array.isArray(clip)) invalidArgument();
    data = clip.data;
    format = clip.format;
    durationMs = clip.durationMs;
  } catch {
    invalidArgument();
  }
  if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_AUDIO_BYTES
    || !exactAudioFormat(format)
    || typeof durationMs !== 'number' || !Number.isSafeInteger(durationMs)
    || durationMs <= 0 || durationMs > MAX_AUDIO_DURATION_MS) {
    invalidArgument('Invalid or oversized voice audio');
  }
  return {data: new Uint8Array(data), durationMs};
}

function validateBoundedText(value: unknown, maximum: number, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new VoiceSessionError('EXTERNAL_FAILURE', message);
  }
  return value;
}

function parseRecognitionResult(value: unknown, fallbackLocale: string): PrivateTranscript {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VoiceSessionError('EXTERNAL_FAILURE', 'Speech recognition failed');
  }
  try {
    const result = value as Record<string, unknown>;
    const keys = Reflect.ownKeys(result);
    if (!keys.every(key => typeof key === 'string' && ['text', 'locale'].includes(key))) {
      throw new VoiceSessionError('EXTERNAL_FAILURE', 'Speech recognition failed');
    }
    const text = validateBoundedText(result.text, MAX_TRANSCRIPT_CHARACTERS, 'Speech recognition failed');
    const locale = result.locale === undefined ? fallbackLocale : validateLocale(result.locale);
    return {text, locale};
  } catch (error) {
    if (error instanceof VoiceSessionError && error.code === 'EXTERNAL_FAILURE') throw error;
    throw new VoiceSessionError('EXTERNAL_FAILURE', 'Speech recognition failed');
  }
}

function parseConsumptionResult(value: unknown, fallbackLocale: string): PrivateReply {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VoiceSessionError('EXTERNAL_FAILURE', 'Transcript consumption failed');
  }
  try {
    const result = value as Record<string, unknown>;
    const keys = Reflect.ownKeys(result);
    if (!keys.every(key => typeof key === 'string' && ['replyText', 'locale'].includes(key))) {
      throw new VoiceSessionError('EXTERNAL_FAILURE', 'Transcript consumption failed');
    }
    const text = validateBoundedText(result.replyText, MAX_SPEECH_CHARACTERS, 'Transcript consumption failed');
    const locale = result.locale === undefined ? fallbackLocale : validateLocale(result.locale);
    return {text, locale};
  } catch (error) {
    if (error instanceof VoiceSessionError && error.code === 'EXTERNAL_FAILURE') throw error;
    throw new VoiceSessionError('EXTERNAL_FAILURE', 'Transcript consumption failed');
  }
}

function isOperation<T>(value: unknown): value is VoiceOperation<T> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const operation = value as {result?: unknown; stop?: unknown};
    return operation.result instanceof Promise && typeof operation.stop === 'function';
  } catch {
    return false;
  }
}

function providerError(kind: ActiveOperationKind, error: unknown): VoiceSessionError {
  try {
    if (error instanceof VoiceSessionError && error.code === 'UNSUPPORTED_CAPABILITY') {
      const message = kind === 'recognition'
        ? 'Speech recognition is unavailable'
        : kind === 'playback'
          ? 'Speech output is unavailable'
          : 'Transcript consumption is unavailable';
      return new VoiceSessionError('UNSUPPORTED_CAPABILITY', message);
    }
  } catch {
    // Provider-controlled errors are never surfaced.
  }
  const message = kind === 'recognition'
    ? 'Speech recognition failed'
    : kind === 'playback'
      ? 'Speech output failed'
      : 'Transcript consumption failed';
  return new VoiceSessionError('EXTERNAL_FAILURE', message);
}

function terminalState(reason: VoiceSessionTerminalReason): 'stopped' | 'cancelled' | 'expired' {
  if (reason === 'deadline') return 'expired';
  if (reason === 'cancelled') return 'cancelled';
  return 'stopped';
}

function abortDetails(reason: VoiceSessionTerminalReason): {code: VoiceErrorCode; message: string} {
  if (reason === 'deadline') return {code: 'TIMEOUT', message: 'Voice session deadline expired'};
  if (reason === 'replaced') return {code: 'STALE_SESSION', message: 'Voice session was replaced'};
  return {code: 'CANCELLED', message: 'Voice session cancelled'};
}

/**
 * In-process provisional session lifecycle. It owns no microphone, Runtime task, provider
 * credentials or persistence and keeps at most one active push-to-talk session.
 */
export class VoiceSessionManager {
  private readonly recognition: SpeechRecognitionPort;
  private readonly output: SpeechOutputPort;
  private readonly idFactory: (kind: VoiceIdKind) => string;
  private readonly listeners = new Set<VoiceListenerRegistration>();
  private readonly notificationQueue: VoiceSessionSnapshot[] = [];
  private publishingNotifications = false;
  private active?: SessionRecord;
  // A rejected stop leaves resource ownership unknown. Do not erase that fact
  // when removing an operation or replacing its session.
  private releaseFailed = false;

  constructor(options: VoiceSessionManagerOptions = {}) {
    this.recognition = options.recognition ?? new UnavailableSpeechRecognitionPort();
    this.output = options.output ?? new UnavailableSpeechOutputPort();
    this.idFactory = options.idFactory ?? (kind => `${kind}-${randomUUID()}`);
  }

  async start(options: StartVoiceSessionOptions): Promise<VoiceSessionSnapshot> {
    let deadline: unknown;
    let signal: unknown;
    let locale: unknown;
    try {
      if (options === null || typeof options !== 'object' || Array.isArray(options)) invalidArgument();
      deadline = options.deadline;
      signal = options.signal;
      locale = options.locale;
    } catch {
      invalidArgument();
    }
    if (!isAbortSignal(signal)) invalidArgument();
    if (signalAborted(signal)) throw new VoiceSessionError('CANCELLED', 'Voice session cancelled');
    const expiresAt = parseDeadline(deadline);
    if (expiresAt <= Date.now()) throw new VoiceSessionError('TIMEOUT', 'Voice session deadline expired');
    const validLocale = validateLocale(locale);

    // Another start can install a session while we await the old cleanup.
    // Recheck and clean that session too before replacing the active pointer.
    while (this.active !== undefined) {
      const previous = this.active;
      await this.terminate(previous, 'replaced');
      if (this.active === previous) break;
    }
    if (signalAborted(signal)) throw new VoiceSessionError('CANCELLED', 'Voice session cancelled');
    if (expiresAt <= Date.now()) throw new VoiceSessionError('TIMEOUT', 'Voice session deadline expired');
    this.assertResourcesReleased();

    const sessionId = this.createId('session');
    const record: SessionRecord = {
      sessionId,
      startedAt: new Date().toISOString(),
      deadline: deadline as string,
      expiresAt,
      locale: validLocale,
      root: new AbortController(),
      parentSignal: signal,
      transcripts: new Map(),
      replies: new Map(),
      operations: new Set(),
      state: 'listening',
      revision: 0,
    };
    record.parentAbortListener = () => { void this.terminate(record, 'cancelled'); };
    try {
      signal.addEventListener('abort', record.parentAbortListener, {once: true});
    } catch {
      invalidArgument();
    }
    this.active = record;
    this.scheduleDeadline(record);
    if (signalAborted(signal)) await this.terminate(record, 'cancelled');
    if (record.state === 'cancelled') throw new VoiceSessionError('CANCELLED', 'Voice session cancelled');
    this.notify(record);
    return this.snapshot(record);
  }

  current(): VoiceSessionSnapshot | undefined {
    return this.active === undefined ? undefined : this.snapshot(this.active);
  }

  /** Read-only state updates. A subscription added during delivery starts on the next update. */
  subscribe(listener: VoiceSessionListener): () => void {
    if (typeof listener !== 'function') invalidArgument('Invalid voice session listener');
    const registration: VoiceListenerRegistration = {listener, active: true};
    this.listeners.add(registration);
    return () => {
      if (!registration.active) return;
      registration.active = false;
      this.listeners.delete(registration);
    };
  }

  async recognizeAudio(sessionId: string, clip: VoiceAudioClip): Promise<TranscriptReceipt> {
    const record = this.requireSession(sessionId);
    this.requireState(record, ['listening']);
    const audio = validateAudioClip(clip);
    this.transition(record, 'recognizing');
    this.assertUsable(record);
    const controller = new AbortController();
    const request: SpeechRecognitionRequest = Object.freeze({
      sessionId: record.sessionId,
      audio: audio.data,
      format: VOICE_AUDIO_FORMAT,
      durationMs: audio.durationMs,
      locale: record.locale,
      deadline: record.deadline,
      signal: controller.signal,
    });

    let active: ActiveOperation<SpeechRecognitionResult> | undefined;
    try {
      active = this.startOperation(record, 'recognition', controller,
        () => this.recognition.recognize(request));
      const raw = await this.waitForOperation(record, active);
      this.assertUsable(record);
      const transcript = parseRecognitionResult(raw, record.locale);
      await this.finishOperation(record, active, 'completed');
      this.assertUsable(record);
      const transcriptId = this.createId('transcript');
      record.transcripts.clear();
      record.transcripts.set(transcriptId, transcript);
      this.transition(record, 'awaiting_consume');
      return {sessionId: record.sessionId, transcriptId, characterCount: transcript.text.length};
    } catch (error) {
      if (active !== undefined) await this.finishOperation(record, active, 'completed');
      if (this.active === record && !terminalStates.has(record.state)) this.transition(record, 'listening');
      throw error;
    } finally {
      audio.data.fill(0);
      if (active !== undefined) await this.finishOperation(record, active, 'completed');
    }
  }

  async consumeTranscript(
    sessionId: string,
    transcriptId: string,
    consumer: TranscriptConsumerPort,
  ): Promise<ReplyReceipt> {
    const record = this.requireSession(sessionId);
    this.requireState(record, ['awaiting_consume']);
    const transcript = record.transcripts.get(transcriptId);
    if (transcript === undefined) throw new VoiceSessionError('INVALID_ARGUMENT', 'Unknown voice transcript receipt');
    if (consumer === null || typeof consumer !== 'object' || typeof consumer.consume !== 'function') invalidArgument();

    // One-shot removal prevents an ambiguous consumer outcome from being submitted twice.
    record.transcripts.delete(transcriptId);
    this.transition(record, 'consuming');
    this.assertUsable(record);
    const controller = new AbortController();
    const request: TranscriptConsumptionRequest = Object.freeze({
      sessionId: record.sessionId,
      transcriptId,
      text: transcript.text,
      locale: transcript.locale,
      deadline: record.deadline,
      signal: controller.signal,
    });

    let active: ActiveOperation<TranscriptConsumptionResult> | undefined;
    try {
      active = this.startOperation(record, 'consumption', controller, () => consumer.consume(request));
      const raw = await this.waitForOperation(record, active);
      this.assertUsable(record);
      const reply = parseConsumptionResult(raw, transcript.locale);
      await this.finishOperation(record, active, 'completed');
      this.assertUsable(record);
      const replyId = this.createId('reply');
      record.replies.clear();
      record.replies.set(replyId, reply);
      this.transition(record, 'awaiting_speech');
      return {sessionId: record.sessionId, replyId, characterCount: reply.text.length};
    } catch (error) {
      if (active !== undefined) await this.finishOperation(record, active, 'completed');
      if (this.active === record && !terminalStates.has(record.state)) this.transition(record, 'listening');
      throw error;
    } finally {
      if (active !== undefined) await this.finishOperation(record, active, 'completed');
    }
  }

  async speakReply(sessionId: string, replyId: string): Promise<SpeechPlaybackResult> {
    const record = this.requireSession(sessionId);
    this.requireState(record, ['awaiting_speech']);
    const reply = record.replies.get(replyId);
    if (reply === undefined) throw new VoiceSessionError('INVALID_ARGUMENT', 'Unknown voice reply receipt');
    record.replies.delete(replyId);
    const controller = new AbortController();
    const request: SpeechOutputRequest = Object.freeze({
      sessionId: record.sessionId,
      replyId,
      text: reply.text,
      locale: reply.locale,
      deadline: record.deadline,
      signal: controller.signal,
    });

    let active: ActiveOperation<void> | undefined;
    try {
      active = this.startOperation(record, 'playback', controller, () => this.output.speak(request));
      this.assertUsable(record);
      this.transition(record, 'speaking');
      await this.waitForOperation(record, active);
      await this.finishOperation(record, active, 'completed');
      this.assertResourcesReleased();
      if (active.interruptedByUser) {
        return {sessionId: record.sessionId, completed: false, interrupted: true};
      }
      this.assertUsable(record);
      this.transition(record, 'listening');
      return {sessionId: record.sessionId, completed: true, interrupted: false};
    } catch (error) {
      const interrupted = active?.interruptedByUser === true
        && this.active === record && !terminalStates.has(record.state);
      const released = active === undefined || await this.finishOperation(record, active, 'completed');
      if (interrupted && released) {
        if (this.active === record && record.state === 'speaking') this.transition(record, 'listening');
        return {sessionId: record.sessionId, completed: false, interrupted: true};
      }
      if (this.active === record && !terminalStates.has(record.state)) this.transition(record, 'listening');
      throw error;
    } finally {
      if (active !== undefined) await this.finishOperation(record, active, 'completed');
    }
  }

  async stopSpeaking(sessionId: string): Promise<StopSpeakingResult> {
    const record = this.requireSession(sessionId, true);
    if (terminalStates.has(record.state)) {
      // Terminal state is published before cleanup completes. Reuse its actual
      // release result instead of treating termination as release confirmation.
      const stopped = await this.terminate(record, record.terminalReason ?? 'user');
      return {sessionId: record.sessionId, playbackStopped: false,
        resourcesReleased: stopped.resourcesReleased};
    }
    const playback = [...record.operations].find(operation => operation.kind === 'playback');
    if (playback === undefined) {
      return {sessionId: record.sessionId, playbackStopped: false, resourcesReleased: !this.releaseFailed};
    }
    playback.interruptedByUser = true;
    playback.abortCode = 'CANCELLED';
    playback.abortMessage = 'Speech playback interrupted';
    const releasePromise = this.releaseOperation(playback, 'interrupted');
    playback.controller.abort();
    const released = await releasePromise;
    if (!released) await this.terminate(record, 'disposed');
    if (this.active === record && record.state === 'speaking') {
      this.transition(record, 'listening');
    }
    return {sessionId: record.sessionId, playbackStopped: true, resourcesReleased: released};
  }

  async interrupt(sessionId: string): Promise<StopSpeakingResult> {
    return this.stopSpeaking(sessionId);
  }

  async stop(sessionId: string, reason: 'user' | 'disposed' = 'user'): Promise<StopVoiceSessionResult> {
    const record = this.requireSession(sessionId, true);
    return this.terminate(record, reason);
  }

  private createId(kind: VoiceIdKind): string {
    let value: unknown;
    try {
      value = this.idFactory(kind);
    } catch {
      throw new VoiceSessionError('EXTERNAL_FAILURE', 'Voice identifier generation failed');
    }
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) {
      throw new VoiceSessionError('EXTERNAL_FAILURE', 'Voice identifier generation failed');
    }
    return value;
  }

  private requireSession(sessionId: string, allowTerminal = false): SessionRecord {
    if (typeof sessionId !== 'string' || sessionId.length === 0) invalidArgument();
    const record = this.active;
    if (record === undefined || record.sessionId !== sessionId) {
      throw new VoiceSessionError('STALE_SESSION', 'Voice session is not current');
    }
    if (!allowTerminal) this.assertUsable(record);
    return record;
  }

  private requireState(record: SessionRecord, expected: readonly VoiceSessionState[]): void {
    if (!expected.includes(record.state)) {
      throw new VoiceSessionError('INVALID_STATE', 'Voice session action is not allowed in the current state');
    }
  }

  private assertUsable(record: SessionRecord): void {
    this.assertResourcesReleased();
    if (this.active !== record) throw new VoiceSessionError('STALE_SESSION', 'Voice session was replaced');
    if (record.abortCode !== undefined || record.root.signal.aborted) {
      throw new VoiceSessionError(record.abortCode ?? 'CANCELLED', record.abortMessage ?? 'Voice session cancelled');
    }
    if (record.expiresAt <= Date.now()) {
      void this.terminate(record, 'deadline');
      throw new VoiceSessionError('TIMEOUT', 'Voice session deadline expired');
    }
    if (terminalStates.has(record.state)) {
      const details = abortDetails(record.terminalReason ?? 'cancelled');
      throw new VoiceSessionError(details.code, details.message);
    }
  }

  private assertResourcesReleased(): void {
    if (this.releaseFailed) {
      throw new VoiceSessionError('EXTERNAL_FAILURE', 'Voice operation resource release failed');
    }
  }

  private transition(record: SessionRecord, state: VoiceSessionState): void {
    if (record.state === state) return;
    record.state = state;
    record.revision += 1;
    this.notify(record);
  }

  private snapshot(record: SessionRecord): VoiceSessionSnapshot {
    const playbackActive = record.state === 'speaking';
    const snapshot: VoiceSessionSnapshot = {
      sessionId: record.sessionId,
      state: record.state,
      revision: record.revision,
      startedAt: record.startedAt,
      deadline: record.deadline,
      locale: record.locale,
      transcriptReady: record.transcripts.size > 0,
      replyReady: record.replies.size > 0,
      playbackActive,
      ...(record.terminalReason === undefined ? {} : {terminalReason: record.terminalReason}),
    };
    return Object.freeze(snapshot);
  }

  private notify(record: SessionRecord): void {
    const queued = this.snapshot(record);
    this.notificationQueue.push(queued);
    if (this.publishingNotifications) return;

    this.publishingNotifications = true;
    try {
      while (this.notificationQueue.length > 0) {
        const snapshot = this.notificationQueue.shift();
        if (snapshot === undefined) continue;
        const round = [...this.listeners];
        for (const registration of round) {
          if (this.hasSupersedingNotification(snapshot)) break;
          if (!registration.active) continue;
          if (registration.lastSessionId === snapshot.sessionId
            && registration.lastRevision === snapshot.revision) continue;
          registration.lastSessionId = snapshot.sessionId;
          registration.lastRevision = snapshot.revision;
          try {
            registration.listener(Object.freeze({...snapshot}));
          } catch {
            // Listener failures are isolated and their messages are never surfaced.
          }
          if (this.hasSupersedingNotification(snapshot)) break;
        }
      }
    } finally {
      this.publishingNotifications = false;
    }
  }

  private hasSupersedingNotification(snapshot: VoiceSessionSnapshot): boolean {
    return this.notificationQueue.some(candidate => candidate.sessionId === snapshot.sessionId
      && candidate.revision > snapshot.revision);
  }

  private scheduleDeadline(record: SessionRecord): void {
    const schedule = (): void => {
      const remaining = record.expiresAt - Date.now();
      if (remaining <= 0) {
        void this.terminate(record, 'deadline');
        return;
      }
      record.deadlineTimer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    };
    schedule();
  }

  private startOperation<T>(
    record: SessionRecord,
    kind: ActiveOperationKind,
    controller: AbortController,
    start: () => VoiceOperation<T>,
  ): ActiveOperation<T> {
    let resolveHandle!: (handle: VoiceOperation<T> | undefined) => void;
    const started = new Promise<VoiceOperation<T> | undefined>(resolve => { resolveHandle = resolve; });
    // Register ownership before a provider can synchronously reenter stop/start.
    // Its eventual handle must be released before any stop receipt can succeed.
    const bridge: VoiceOperation<T> = {
      result: started.then(handle => {
        if (!handle) throw providerError(kind, undefined);
        return handle.result;
      }),
      async stop(reason) { await (await started)?.stop(reason); },
    };
    void bridge.result.catch(() => {});
    const active = this.attachOperation(record, kind, controller, bridge);
    let returned: VoiceOperation<T> | undefined;
    try {
      const handle = start();
      if (!isOperation<T>(handle)) throw providerError(kind, undefined);
      returned = handle;
      // A terminal reentrant callback may prevent the usual result wait from starting.
      void handle.result.catch(() => {});
      return active;
    } catch (error) {
      active.detachRoot();
      record.operations.delete(active);
      throw providerError(kind, error);
    } finally {
      resolveHandle(returned);
    }
  }

  private attachOperation<T>(
    record: SessionRecord,
    kind: ActiveOperationKind,
    controller: AbortController,
    handle: VoiceOperation<T>,
  ): ActiveOperation<T> {
    if (!isOperation<T>(handle)) throw providerError(kind, undefined);
    const abortFromRoot = (): void => {
      const details = {
        code: record.abortCode ?? 'CANCELLED',
        message: record.abortMessage ?? 'Voice session cancelled',
      };
      active.abortCode = details.code;
      active.abortMessage = details.message;
      controller.abort();
    };
    const active: ActiveOperation<T> = {
      kind,
      controller,
      handle,
      detachRoot: () => record.root.signal.removeEventListener('abort', abortFromRoot),
      interruptedByUser: false,
    };
    record.root.signal.addEventListener('abort', abortFromRoot, {once: true});
    record.operations.add(active);
    if (record.root.signal.aborted) abortFromRoot();
    return active;
  }

  private async waitForOperation<T>(record: SessionRecord, active: ActiveOperation<T>): Promise<T> {
    let rejectInterrupted: (error: VoiceSessionError) => void = () => {};
    const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
    void interrupted.catch(() => {});
    const onAbort = (): void => {
      rejectInterrupted(new VoiceSessionError(
        active.abortCode ?? record.abortCode ?? 'CANCELLED',
        active.abortMessage ?? record.abortMessage ?? 'Voice session cancelled',
      ));
    };
    active.controller.signal.addEventListener('abort', onAbort, {once: true});
    if (active.controller.signal.aborted) onAbort();
    const provider = Promise.resolve()
      .then(() => active.handle.result)
      .catch(error => { throw providerError(active.kind, error); });
    try {
      return await Promise.race([provider, interrupted]);
    } finally {
      active.controller.signal.removeEventListener('abort', onAbort);
    }
  }

  private async finishOperation(
    record: SessionRecord,
    active: ActiveOperation,
    reason: VoiceOperationStopReason,
  ): Promise<boolean> {
    const released = await this.releaseOperation(active, reason);
    active.detachRoot();
    record.operations.delete(active);
    if (!released) {
      // Drop private receipts and stop any other in-flight work without retrying
      // the failed release. terminate preserves the sticky failure in its receipt.
      void this.terminate(record, 'disposed');
      // Do not replace an existing cancellation/provider error in a finally.
      // Successful paths call assertUsable after this cleanup before publishing.
    }
    return released;
  }

  private releaseOperation(active: ActiveOperation, reason: VoiceOperationStopReason): Promise<boolean> {
    if (active.releasePromise !== undefined) return active.releasePromise;
    active.releaseReason = reason;
    active.releasePromise = Promise.resolve().then(() => this.safeStop(active.handle, reason));
    return active.releasePromise;
  }

  private async safeStop(operation: VoiceOperation<unknown>, reason: VoiceOperationStopReason): Promise<boolean> {
    try {
      await operation.stop(reason);
      return true;
    } catch {
      this.releaseFailed = true;
      return false;
    }
  }

  private terminate(record: SessionRecord, reason: VoiceSessionTerminalReason): Promise<StopVoiceSessionResult> {
    if (record.stopPromise !== undefined) return record.stopPromise;
    let resolveStop: (result: StopVoiceSessionResult) => void = () => {};
    const stopPromise = new Promise<StopVoiceSessionResult>(resolve => { resolveStop = resolve; });
    // Publish the promise before terminal listeners run so reentrant stop calls stay idempotent.
    record.stopPromise = stopPromise;
    const details = abortDetails(reason);
    record.terminalReason = reason;
    record.abortCode = details.code;
    record.abortMessage = details.message;
    record.transcripts.clear();
    record.replies.clear();
    this.transition(record, terminalState(reason));
    if (record.deadlineTimer !== undefined) clearTimeout(record.deadlineTimer);
    if (record.parentAbortListener !== undefined) {
      try {
        record.parentSignal.removeEventListener('abort', record.parentAbortListener);
      } catch {
        // A hostile cross-realm signal cannot prevent internal cleanup.
      }
    }
    record.root.abort();
    const operations = [...record.operations];
    void Promise.all(operations.map(async operation => {
      operation.abortCode = details.code;
      operation.abortMessage = details.message;
      operation.controller.abort();
      return this.releaseOperation(operation, reason);
    })).then(results => {
      resolveStop({
        sessionId: record.sessionId,
        state: terminalState(reason),
        reason,
        stopped: true,
        resourcesReleased: !this.releaseFailed && results.every(Boolean),
      });
    });
    return stopPromise;
  }
}
