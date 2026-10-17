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
} from './ports.js';

export type HuaweiSisRegion = 'cn-north-4' | 'cn-east-3';

/** Supplied by a trusted host with SIS-scoped IAM credentials, never AgentArts runtime bearer. */
export interface HuaweiSisTokenPort {
  getSisToken(request: {readonly region: HuaweiSisRegion; readonly deadline: string;
    readonly signal: AbortSignal}): Promise<string>;
}

/** Trusted host signs only this adapter's fixed regional SIS request. */
export interface HuaweiSisRequestAuthPort {
  getSisRequestHeaders(request: {readonly url: string; readonly method: 'POST';
    readonly body: string; readonly deadline: string; readonly signal: AbortSignal}):
    Promise<Readonly<Record<string, string>>>;
}

/** Host-owned local playback; this adapter does not open an output device. */
export interface HuaweiSisWavPlaybackPort {
  playWav(request: {readonly audio: Uint8Array; readonly deadline: string;
    readonly signal: AbortSignal}): VoiceOperation<void>;
}

export interface HuaweiSisConfig {
  readonly region: HuaweiSisRegion;
  readonly projectId: string;
  readonly tokenPort?: HuaweiSisTokenPort;
  readonly requestAuthPort?: HuaweiSisRequestAuthPort;
  readonly fetchImpl?: typeof fetch;
}

export interface HuaweiSisOutputConfig extends HuaweiSisConfig {
  readonly playback: HuaweiSisWavPlaybackPort;
  /** An official SIS TTS property supported by the selected region. */
  readonly voiceProperty?: string;
}

const ENDPOINTS: Readonly<Record<HuaweiSisRegion, string>> = Object.freeze({
  'cn-north-4': 'https://sis-ext.cn-north-4.myhuaweicloud.com',
  'cn-east-3': 'https://sis-ext.cn-east-3.myhuaweicloud.com',
});
const MAX_ASR_RESPONSE_BYTES = 64 * 1024;
const MAX_TTS_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_TTS_WAV_BYTES = 12 * 1024 * 1024;
const MAX_TTS_CHARACTERS = 500;
const MAX_TIMER_MS = 2_147_483_647;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

interface ReadyConfig {
  readonly region: HuaweiSisRegion;
  readonly baseUrl: string;
  readonly projectId: string;
  readonly tokenPort?: HuaweiSisTokenPort;
  readonly requestAuthPort?: HuaweiSisRequestAuthPort;
  readonly fetchImpl: typeof fetch;
}

function invalid(message: string): VoiceSessionError {
  return new VoiceSessionError('INVALID_ARGUMENT', message);
}

function external(): VoiceSessionError {
  return new VoiceSessionError('EXTERNAL_FAILURE', 'Huawei SIS request failed');
}

function readyConfig(config: HuaweiSisConfig): ReadyConfig {
  if (!config || !Object.hasOwn(ENDPOINTS, config.region)) {
    throw new VoiceSessionError('UNSUPPORTED_CAPABILITY', 'Huawei SIS region is unavailable');
  }
  if (typeof config.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(config.projectId)) {
    throw invalid('Huawei SIS project ID is invalid');
  }
  if ((typeof config.tokenPort?.getSisToken === 'function') ===
    (typeof config.requestAuthPort?.getSisRequestHeaders === 'function')) {
    throw new VoiceSessionError('UNSUPPORTED_CAPABILITY', 'Huawei SIS credentials are unavailable');
  }
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new VoiceSessionError('UNSUPPORTED_CAPABILITY', 'Huawei SIS transport is unavailable');
  }
  return {region: config.region, baseUrl: ENDPOINTS[config.region], projectId: config.projectId,
    ...(config.tokenPort ? {tokenPort: config.tokenPort} : {}),
    ...(config.requestAuthPort ? {requestAuthPort: config.requestAuthPort} : {}), fetchImpl};
}

function deadlineMs(deadline: string): number {
  if (typeof deadline !== 'string' || !ISO_UTC.test(deadline)) throw invalid('Voice deadline is invalid');
  const value = Date.parse(deadline);
  if (!Number.isFinite(value)) throw invalid('Voice deadline is invalid');
  if (value <= Date.now()) throw new VoiceSessionError('TIMEOUT', 'Voice deadline expired');
  return value;
}

function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // A host can synchronously revoke while returning a rejected promise.
    void task.catch(() => {});
    return Promise.reject(new Error('aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { signal.removeEventListener('abort', onAbort); reject(new Error('aborted')); };
    signal.addEventListener('abort', onAbort, {once: true});
    if (signal.aborted) onAbort();
    task.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, error => {
      signal.removeEventListener('abort', onAbort); reject(error);
    });
  });
}

function operation<T>(request: {readonly deadline: string; readonly signal: AbortSignal},
  run: (signal: AbortSignal, checkActive: () => void,
    setChild: (child: VoiceOperation<void> | undefined) => void) => Promise<T>): VoiceOperation<T> {
  const expiresAt = deadlineMs(request.deadline);
  const controller = new AbortController();
  let abortCode: 'CANCELLED' | 'TIMEOUT' | undefined;
  let child: VoiceOperation<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  const abort = (code: 'CANCELLED' | 'TIMEOUT'): void => {
    if (abortCode) return;
    abortCode = code;
    controller.abort();
  };
  const onParentAbort = (): void => abort('CANCELLED');
  request.signal.addEventListener('abort', onParentAbort, {once: true});
  if (request.signal.aborted) onParentAbort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleDeadline = (): void => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) abort('TIMEOUT');
    else timer = setTimeout(scheduleDeadline, Math.min(MAX_TIMER_MS, remaining));
  };
  scheduleDeadline();
  const checkActive = (): void => {
    // Timer delivery can lag behind wall time after sleep or a busy event loop.
    if (Date.now() >= expiresAt) abort('TIMEOUT');
    if (controller.signal.aborted) throw new Error('aborted');
  };
  const result = Promise.resolve().then(() => {
    checkActive();
    return run(controller.signal, checkActive, next => {
      child = next;
    });
  }).then(value => {
    checkActive();
    return value;
  }).catch((error: unknown) => {
    if (abortCode) throw new VoiceSessionError(abortCode,
      abortCode === 'TIMEOUT' ? 'Voice deadline expired' : 'Voice operation cancelled');
    if (error instanceof VoiceSessionError) throw error;
    throw external();
  }).finally(() => {
    if (timer) clearTimeout(timer);
    request.signal.removeEventListener('abort', onParentAbort);
  });
  return {result, stop(reason) {
    if (!stopPromise) {
      abort(reason === 'deadline' ? 'TIMEOUT' : 'CANCELLED');
      stopPromise = (async () => {
        let releaseFailed = false;
        const stoppingChild = child;
        try { await stoppingChild?.stop(reason); }
        catch { releaseFailed = true; }
        await result.catch(() => {});
        // A reentrant host may have returned its handle after stop began.
        if (child && child !== stoppingChild) {
          try { await child.stop(reason); }
          catch { releaseFailed = true; }
        }
        if (releaseFailed) throw new VoiceSessionError('EXTERNAL_FAILURE', 'Voice playback release failed');
      })();
    }
    return stopPromise;
  }};
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

async function boundedJson(response: Response, limit: number, signal: AbortSignal,
  checkActive: () => void): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw external();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      checkActive();
      const part = await abortable(reader.read(), signal);
      checkActive();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw external();
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8')) as unknown;
  } catch {
    throw external();
  } finally {
    if (size > limit || signal.aborted) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function callSis(config: ReadyConfig, path: string, body: unknown, deadline: string,
  signal: AbortSignal, responseLimit: number, checkActive: () => void): Promise<unknown> {
  checkActive();
  const url = `${config.baseUrl}/v1/${config.projectId}/${path}`;
  const serialized = JSON.stringify(body);
  let headers: Record<string, string>;
  try {
    if (config.requestAuthPort) {
      const signed = await abortable(Promise.resolve(config.requestAuthPort.getSisRequestHeaders({
        url, method: 'POST', body: serialized, deadline, signal})), signal);
      if (!signed || typeof signed !== 'object' || Array.isArray(signed)
        || Object.keys(signed).length !== 3
        || Object.keys(signed).some(key => !['Authorization', 'X-Sdk-Date', 'X-Project-Id'].includes(key))
        || signed['X-Project-Id'] !== config.projectId
        || !/^SDK-HMAC-SHA256 Access=[A-Za-z0-9]+, SignedHeaders=content-type;host;x-project-id;x-sdk-date, Signature=[a-f0-9]{64}$/.test(signed.Authorization ?? '')
        || !/^\d{8}T\d{6}Z$/.test(signed['X-Sdk-Date'] ?? '')) throw external();
      headers = {...signed};
    } else {
      const token = await abortable(Promise.resolve(config.tokenPort!.getSisToken({region: config.region,
        deadline, signal})), signal);
      if (typeof token !== 'string' || token.length === 0 || token.length > 16_384
        || token.trim() !== token || /[\r\n]/.test(token))
        throw new VoiceSessionError('UNSUPPORTED_CAPABILITY', 'Huawei SIS credentials are unavailable');
      headers = {'X-Auth-Token': token};
    }
  } catch (error) {
    if (error instanceof VoiceSessionError && error.code === 'UNSUPPORTED_CAPABILITY') throw error;
    throw external();
  }
  checkActive();
  let response: Response;
  try {
    response = await abortable(config.fetchImpl(url,
      {method: 'POST', headers: {'Content-Type': 'application/json', ...headers},
        body: serialized, signal, redirect: 'error'}).then(incoming => {
      // A non-cooperative transport can return after abortable has already settled.
      if (signal.aborted) void incoming.body?.cancel().catch(() => {});
      return incoming;
    }), signal);
  } catch { throw external(); }
  try { checkActive(); }
  catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw external();
  }
  return boundedJson(response, responseLimit, signal, checkActive);
}

function validateChineseLocale(locale: string): void {
  if (locale !== 'zh-CN') {
    throw new VoiceSessionError('UNSUPPORTED_CAPABILITY', 'Huawei SIS locale is unavailable');
  }
}

function asrBody(request: SpeechRecognitionRequest): {readonly data: string; readonly config: object} {
  validateChineseLocale(request.locale);
  const format = request.format;
  if (format?.encoding !== VOICE_AUDIO_FORMAT.encoding
    || format.sampleRateHz !== VOICE_AUDIO_FORMAT.sampleRateHz
    || format.channels !== VOICE_AUDIO_FORMAT.channels
    || !(request.audio instanceof Uint8Array)
    || request.audio.byteLength === 0 || request.audio.byteLength > MAX_AUDIO_BYTES
    || request.audio.byteLength % 2 !== 0
    || !Number.isFinite(request.durationMs) || request.durationMs <= 0
    || request.durationMs > MAX_AUDIO_DURATION_MS) throw invalid('Voice audio format or length is invalid');
  const copy = Buffer.from(request.audio);
  try {
    return {data: copy.toString('base64'),
      config: {audio_format: 'pcm16k16bit', property: 'chinese_16k_general', add_punc: 'yes'}};
  } finally { copy.fill(0); }
}

/** Explicit short-audio ASR. Construction and missing credentials never select a local fallback. */
export function createHuaweiSisRecognitionPort(options: HuaweiSisConfig): SpeechRecognitionPort {
  const config = readyConfig(options);
  return {recognize(request) {
    const body = asrBody(request);
    return operation(request, async (signal, checkActive) => {
      const payload = record(await callSis(config, 'asr/short-audio', body, request.deadline,
        signal, MAX_ASR_RESPONSE_BYTES, checkActive));
      checkActive();
      const result = record(payload?.result);
      if (typeof result?.text !== 'string' || !result.text.trim()
        || result.text.length > MAX_TRANSCRIPT_CHARACTERS) throw external();
      return {text: result.text, locale: request.locale} satisfies SpeechRecognitionResult;
    });
  }};
}

function decodeWav(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TTS_RESPONSE_BYTES
    || value.length % 4 !== 0) {
    throw external();
  }
  const contentLength = value.length - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  // Scan once without a repeated regex group that can exhaust the stack on large WAVs.
  for (let index = 0; index < contentLength; index++) {
    const code = value.charCodeAt(index);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57) || code === 43 || code === 47) continue;
    throw external();
  }
  const audio = Buffer.from(value, 'base64');
  if (audio.byteLength < 44 || audio.byteLength > MAX_TTS_WAV_BYTES
    || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    audio.fill(0);
    throw external();
  }
  return audio;
}

function ttsSegments(text: string): string[] {
  const points = [...text];
  const segments: string[] = [];
  for (let start = 0; start < points.length;) {
    let end = Math.min(start + MAX_TTS_CHARACTERS, points.length);
    if (end < points.length) {
      for (let i = end - 1; i >= start + Math.floor(MAX_TTS_CHARACTERS / 2); i--) {
        if (/[。！？!?；;\n]/u.test(points[i] ?? '')) { end = i + 1; break; }
      }
    }
    segments.push(points.slice(start, end).join(''));
    start = end;
  }
  return segments;
}

function playbackHandle(handle: VoiceOperation<void>): VoiceOperation<void> {
  let release: Promise<void> | undefined;
  return {result: handle.result, stop(reason) {
    // Completion, interruption and parent abort all share the first release receipt.
    release ??= Promise.resolve().then(() => handle.stop(reason)).catch(() => {
      throw new VoiceSessionError('EXTERNAL_FAILURE', 'Voice playback release failed');
    });
    return release;
  }};
}

/** SIS TTS creates WAV bytes; only the injected trusted host may play them locally. */
export function createHuaweiSisOutputPort(options: HuaweiSisOutputConfig): SpeechOutputPort {
  const config = readyConfig(options);
  if (typeof options.playback?.playWav !== 'function') {
    throw new VoiceSessionError('UNSUPPORTED_CAPABILITY', 'Local speech playback is unavailable');
  }
  const property = options.voiceProperty ?? 'chinese_xiaoyu_common';
  if (typeof property !== 'string' || !/^[a-z][a-z0-9_]{1,127}$/.test(property)) {
    throw invalid('Huawei SIS voice property is invalid');
  }
  return {speak(request: SpeechOutputRequest) {
    validateChineseLocale(request.locale);
    if (typeof request.text !== 'string' || !request.text.trim()
      || [...request.text].length > MAX_SPEECH_CHARACTERS) {
      throw invalid('Huawei SIS TTS text length is invalid');
    }
    const segments = ttsSegments(request.text);
    return operation(request, async (signal, checkActive, setChild) => {
      for (const segment of segments) {
        checkActive();
        const payload = record(await callSis(config, 'tts',
          {text: segment, config: {audio_format: 'wav', sample_rate: '16000', property}},
          request.deadline, signal, MAX_TTS_RESPONSE_BYTES, checkActive));
        const result = record(payload?.result);
        const audio = decodeWav(result?.data);
        let playback: VoiceOperation<void> | undefined;
        try {
          checkActive();
          try { playback = playbackHandle(options.playback.playWav({audio, deadline: request.deadline, signal})); }
          catch { throw external(); }
          setChild(playback);
          try { await abortable(playback.result, signal); }
          catch { throw external(); }
          checkActive();
        } finally {
          try {
            if (playback) await playback.stop(signal.aborted ? 'cancelled' : 'completed');
            setChild(undefined);
          }
          finally { audio.fill(0); }
        }
      }
    });
  }};
}
