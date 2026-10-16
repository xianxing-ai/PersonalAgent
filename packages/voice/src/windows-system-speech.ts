import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';

import {VoiceSessionError} from './errors.js';
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
  type VoiceOperation,
  type VoiceOperationStopReason,
} from './ports.js';

const WINDOWS_SPEECH_CULTURE = 'zh-CN';
const PCM_BYTES_PER_MILLISECOND = 32;
const MAX_TIMER_MS = 2_147_483_647;
const MAX_HOST_OUTPUT_BYTES = MAX_TRANSCRIPT_CHARACTERS * 4 + 1_024;
const MAX_HOST_ERROR_BYTES = 8_192;
const isoDeadline = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const byteLengthOf = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'byteLength',
)?.get;
const setBytes = Uint8Array.prototype.set;

type SpeechHostMode = 'recognize' | 'speak';

interface SpeechHostProcess {
  readonly stdin: ChildProcessWithoutNullStreams['stdin'];
  readonly stdout: ChildProcessWithoutNullStreams['stdout'];
  readonly stderr: ChildProcessWithoutNullStreams['stderr'];
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type WindowsSpeechHostSpawner = (mode: SpeechHostMode) => SpeechHostProcess;

interface ActiveOperation {
  stop(reason: VoiceOperationStopReason): Promise<void>;
}

export interface WindowsSystemSpeechPorts {
  readonly recognition: SpeechRecognitionPort;
  readonly output: SpeechOutputPort;
  dispose(): Promise<void>;
}

function invalid(message = 'Invalid Windows speech input'): never {
  throw new VoiceSessionError('INVALID_ARGUMENT', message);
}

function fixedFailure(): VoiceSessionError {
  return new VoiceSessionError('EXTERNAL_FAILURE', 'Windows speech operation failed');
}

function fixedUnavailable(): VoiceSessionError {
  return new VoiceSessionError('UNSUPPORTED_CAPABILITY', 'Windows System.Speech is unavailable');
}

function fixedCancelled(): VoiceSessionError {
  return new VoiceSessionError('CANCELLED', 'Windows speech operation cancelled');
}

function fixedTimeout(): VoiceSessionError {
  return new VoiceSessionError('TIMEOUT', 'Windows speech operation deadline expired');
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    const signal = value as AbortSignal;
    return typeof signal.aborted === 'boolean'
      && typeof signal.addEventListener === 'function'
      && typeof signal.removeEventListener === 'function';
  } catch {
    return false;
  }
}

function parseDeadline(value: unknown): number {
  if (typeof value !== 'string' || !isoDeadline.test(value)) invalid('Invalid Windows speech deadline');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) invalid('Invalid Windows speech deadline');
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (new Date(parsed).toISOString() !== canonical) invalid('Invalid Windows speech deadline');
  return parsed;
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length
      || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) invalid();
    const captured: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) invalid();
      captured[key] = descriptor.value;
    }
    return captured;
  } catch (error) {
    if (error instanceof VoiceSessionError) throw error;
    return invalid();
  }
}

function captureCommon(
  request: unknown,
  keys: readonly string[],
): {record: Record<string, unknown>; signal: AbortSignal; deadlineMs: number} {
  const record = exactDataRecord(request, keys);
  if (typeof record.sessionId !== 'string' || record.sessionId.length === 0 || record.sessionId.length > 200) invalid();
  if (record.locale !== WINDOWS_SPEECH_CULTURE) invalid('Unsupported Windows speech locale');
  if (!isAbortSignal(record.signal)) invalid();
  return {record, signal: record.signal, deadlineMs: parseDeadline(record.deadline)};
}

function captureRecognition(request: SpeechRecognitionRequest): {
  readonly input: Uint8Array;
  readonly signal: AbortSignal;
  readonly deadlineMs: number;
} {
  const {record, signal, deadlineMs} = captureCommon(request, [
    'sessionId', 'audio', 'format', 'durationMs', 'locale', 'deadline', 'signal',
  ]);
  const format = exactDataRecord(record.format, ['encoding', 'sampleRateHz', 'channels']);
  if (format.encoding !== VOICE_AUDIO_FORMAT.encoding
    || format.sampleRateHz !== VOICE_AUDIO_FORMAT.sampleRateHz
    || format.channels !== VOICE_AUDIO_FORMAT.channels) invalid('Unsupported Windows speech audio format');
  if (!types.isUint8Array(record.audio) || byteLengthOf === undefined) invalid('Invalid Windows speech audio');
  let byteLength: number;
  try {
    byteLength = byteLengthOf.call(record.audio) as number;
  } catch {
    invalid('Invalid Windows speech audio');
  }
  if (byteLength === 0 || byteLength % 2 !== 0 || byteLength > MAX_AUDIO_BYTES
    || typeof record.durationMs !== 'number'
    || !Number.isSafeInteger(record.durationMs)
    || record.durationMs !== Math.ceil(byteLength / PCM_BYTES_PER_MILLISECOND)
    || record.durationMs > MAX_AUDIO_DURATION_MS) invalid('Invalid Windows speech audio');
  const input = new Uint8Array(byteLength);
  try {
    setBytes.call(input, record.audio as Uint8Array);
  } catch {
    input.fill(0);
    invalid('Invalid Windows speech audio');
  }
  return {input, signal, deadlineMs};
}

function captureSpeech(request: SpeechOutputRequest): {
  readonly input: Uint8Array;
  readonly signal: AbortSignal;
  readonly deadlineMs: number;
} {
  const {record, signal, deadlineMs} = captureCommon(request, [
    'sessionId', 'replyId', 'text', 'locale', 'deadline', 'signal',
  ]);
  if (typeof record.replyId !== 'string' || record.replyId.length === 0 || record.replyId.length > 200
    || typeof record.text !== 'string' || record.text.trim().length === 0
    || record.text.length > MAX_SPEECH_CHARACTERS) invalid();
  const input = new TextEncoder().encode(record.text);
  return {input, signal, deadlineMs};
}

function parseHostEnvelope(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fixedFailure();
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    const keys = Reflect.ownKeys(record);
    if (keys.length !== 2 || !keys.includes('ok') || !keys.includes('code')) throw fixedFailure();
    if (record.code === 'UNSUPPORTED_CAPABILITY') throw fixedUnavailable();
    throw fixedFailure();
  }
  if (record.ok !== true) throw fixedFailure();
  return record;
}

function parseRecognitionResponse(value: unknown): SpeechRecognitionResult {
  const record = parseHostEnvelope(value);
  const keys = Reflect.ownKeys(record);
  if (keys.length !== 3 || !keys.includes('ok') || !keys.includes('text') || !keys.includes('locale')
    || typeof record.text !== 'string' || record.text.trim().length === 0
    || record.text.length > MAX_TRANSCRIPT_CHARACTERS
    || record.locale !== WINDOWS_SPEECH_CULTURE) throw fixedFailure();
  return Object.freeze({text: record.text, locale: WINDOWS_SPEECH_CULTURE});
}

function parseSpeechResponse(value: unknown): void {
  const record = parseHostEnvelope(value);
  const keys = Reflect.ownKeys(record);
  if (keys.length !== 2 || !keys.includes('ok') || !keys.includes('locale')
    || record.locale !== WINDOWS_SPEECH_CULTURE) throw fixedFailure();
}

function failedOperation<T>(error: VoiceSessionError): VoiceOperation<T> {
  return {result: Promise.reject(error), async stop(): Promise<void> {}};
}

function isHostCurrent(executable: string, source: string): boolean {
  try {
    if (!existsSync(executable) || !existsSync(source)) return false;
    const exeStat = statSync(executable);
    if (!exeStat.isFile() || exeStat.size === 0) return false;
    const srcStat = statSync(source);
    if (srcStat.mtimeMs > exeStat.mtimeMs) return false;
    return true;
  } catch {
    return false;
  }
}

function createFixedHostSpawner(): WindowsSpeechHostSpawner {
  if (process.platform !== 'win32') return () => { throw fixedUnavailable(); };
  const root = process.env.SystemRoot;
  if (typeof root !== 'string' || !path.win32.isAbsolute(root) || root.includes('\0')) {
    return () => { throw fixedUnavailable(); };
  }
  const systemRoot = path.win32.resolve(root);
  const executable = fileURLToPath(new URL('../host/windows-system-speech-host.exe', import.meta.url));
  const source = fileURLToPath(new URL('../host/WindowsSystemSpeechHost.cs', import.meta.url));
  if (!isHostCurrent(executable, source)) return () => { throw fixedUnavailable(); };
  // Speech needs Windows/profile locations, never the Desktop's cloud credentials.
  const environment: NodeJS.ProcessEnv = {SystemRoot: systemRoot, WINDIR: systemRoot};
  for (const key of ['TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return mode => {
    if (!isHostCurrent(executable, source)) throw fixedUnavailable();
    return spawn(executable, [
      '--mode', mode,
    ], {
      shell: false,
      windowsHide: true,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  };
}

class WindowsSystemSpeechAdapter {
  readonly recognition: SpeechRecognitionPort;
  readonly output: SpeechOutputPort;
  private readonly active = new Set<ActiveOperation>();
  private disposed = false;
  private disposePromise?: Promise<void>;

  constructor(private readonly spawnHost: WindowsSpeechHostSpawner) {
    this.recognition = Object.freeze({
      recognize: (request: SpeechRecognitionRequest): VoiceOperation<SpeechRecognitionResult> => {
        const captured = captureRecognition(request);
        return this.invoke('recognize', captured.input, captured.signal, captured.deadlineMs, parseRecognitionResponse);
      },
    });
    this.output = Object.freeze({
      speak: (request: SpeechOutputRequest): VoiceOperation<void> => {
        const captured = captureSpeech(request);
        return this.invoke('speak', captured.input, captured.signal, captured.deadlineMs, parseSpeechResponse);
      },
    });
  }

  dispose(): Promise<void> {
    if (this.disposePromise !== undefined) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = Promise.resolve().then(async () => {
      await Promise.all([...this.active].map(operation => operation.stop('disposed')));
    });
    return this.disposePromise;
  }

  private invoke<T>(
    mode: SpeechHostMode,
    input: Uint8Array,
    signal: AbortSignal,
    deadlineMs: number,
    parse: (value: unknown) => T,
  ): VoiceOperation<T> {
    if (this.disposed) {
      input.fill(0);
      return failedOperation(new VoiceSessionError('INVALID_STATE', 'Windows speech ports are disposed'));
    }
    if (signal.aborted) {
      input.fill(0);
      return failedOperation(fixedCancelled());
    }
    if (deadlineMs <= Date.now()) {
      input.fill(0);
      return failedOperation(fixedTimeout());
    }

    let child: SpeechHostProcess;
    try {
      child = this.spawnHost(mode);
    } catch (error) {
      input.fill(0);
      return failedOperation(error instanceof VoiceSessionError ? error : fixedFailure());
    }

    let settled = false;
    let terminalError: VoiceSessionError | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];
    let resolveResult: (value: T) => void = () => {};
    let rejectResult: (error: VoiceSessionError) => void = () => {};
    let resolveClosed: () => void = () => {};
    const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const cleanup = (): void => {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
      try { signal.removeEventListener('abort', onParentAbort); } catch { /* Best-effort detach. */ }
      input.fill(0);
      this.active.delete(activeOperation);
    };
    const clearStdout = (): void => {
      for (const chunk of stdout) chunk.fill(0);
      stdout.length = 0;
    };
    const terminate = (error: VoiceSessionError): void => {
      if (settled || terminalError !== undefined) return;
      terminalError = error;
      try { child.kill(); } catch { /* Close/error remains the release boundary. */ }
    };
    const onParentAbort = (): void => terminate(fixedCancelled());
    const scheduleDeadline = (): void => {
      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) {
        terminate(fixedTimeout());
        return;
      }
      deadlineTimer = setTimeout(scheduleDeadline, Math.min(remaining, MAX_TIMER_MS));
      deadlineTimer.unref?.();
    };
    const activeOperation: ActiveOperation = {
      stop: async (reason: VoiceOperationStopReason): Promise<void> => {
        terminate(reason === 'deadline' ? fixedTimeout() : fixedCancelled());
        try { await result; } catch { /* Stop reports release, not operation output. */ }
        await closed;
      },
    };
    this.active.add(activeOperation);

    child.stdout.on('data', chunk => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += bytes.byteLength;
      if (stdoutBytes > MAX_HOST_OUTPUT_BYTES) {
        terminate(fixedFailure());
        return;
      }
      stdout.push(Buffer.from(bytes));
    });
    child.stderr.on('data', chunk => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += bytes.byteLength;
      if (stderrBytes > MAX_HOST_ERROR_BYTES) terminate(fixedFailure());
    });
    child.once('error', () => terminate(fixedFailure()));
    child.once('close', code => {
      if (settled) return;
      // The close event may run before an already-due deadline timer.
      if (terminalError === undefined) {
        if (signal.aborted) terminalError = fixedCancelled();
        else if (deadlineMs <= Date.now()) terminalError = fixedTimeout();
      }
      settled = true;
      cleanup();
      resolveClosed();
      if (terminalError !== undefined) {
        clearStdout();
        rejectResult(terminalError);
        return;
      }
      let text = '';
      try {
        text = Buffer.concat(stdout, stdoutBytes).toString('utf8').trim();
        if (text.length === 0) {
          throw code === 0 ? fixedFailure() : fixedUnavailable();
        }
        const envelope = JSON.parse(text) as unknown;
        if (code !== 0 && !(envelope && typeof envelope === 'object' && (envelope as Record<string, unknown>).ok === false)) {
          throw fixedFailure();
        }
        resolveResult(parse(envelope));
      } catch (error) {
        rejectResult(error instanceof VoiceSessionError ? error : fixedFailure());
      } finally {
        clearStdout();
        text = '';
      }
    });

    try {
      signal.addEventListener('abort', onParentAbort, {once: true});
    } catch {
      terminate(fixedFailure());
    }
    if (signal.aborted) onParentAbort();
    scheduleDeadline();

    if (terminalError !== undefined) {
      child.stdin.destroy();
    } else {
      try {
        const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
        child.stdin.once('error', () => terminate(fixedFailure()));
        child.stdin.end(bytes);
      } catch {
        terminate(fixedFailure());
      }
    }

    return {result, stop: activeOperation.stop};
  }
}

export function createWindowsSystemSpeechPorts(): WindowsSystemSpeechPorts {
  const adapter = new WindowsSystemSpeechAdapter(createFixedHostSpawner());
  return Object.freeze({
    recognition: adapter.recognition,
    output: adapter.output,
    dispose: (): Promise<void> => adapter.dispose(),
  });
}

/** Internal deterministic test seam; not exported from the package entrypoint. */
export function createWindowsSystemSpeechPortsForTesting(
  spawnHost: WindowsSpeechHostSpawner,
): WindowsSystemSpeechPorts {
  if (typeof spawnHost !== 'function') invalid();
  const adapter = new WindowsSystemSpeechAdapter(spawnHost);
  return Object.freeze({
    recognition: adapter.recognition,
    output: adapter.output,
    dispose: (): Promise<void> => adapter.dispose(),
  });
}
