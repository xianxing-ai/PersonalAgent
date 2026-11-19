// F02 原生语音：声学防回声软件闸 + final 回执 + 设备证据。
// 对应 OPEN_WORK zemeng 第 2 项「F02 原生语音能力：声学防回声、final 回执、设备证据」（UI 接线归 lab）。
// 定位：这是纯软件的防回声兜底闸（TTS 输出窗口 + 尾静音期内，麦克风输入一律视为疑似回声，
// 不进入用户 final），不是设备级 AEC 的替代；真机（扬声器/麦克风互扰、误触、回声实测）待真机验收。
// 全部路径 fail-closed：拿不到回执/证据的 final 不作为已确认用户输入交付。
import {createHash, randomUUID} from 'node:crypto';

const DEFAULT_TAIL_MS = 350;
const MIN_TAIL_MS = 0;
const MAX_TAIL_MS = 2_000;
const MAX_ACTIVE_WINDOWS = 8;

const isFiniteMs = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export interface VoiceEchoGuardOptions {
  /** TTS 结束后的尾静音保护窗（毫秒）。默认 350，上限 2000。 */
  readonly tailMs?: number;
  now?(): number;
}

export interface VoiceEchoWindow {
  readonly replyId: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
}

export interface VoiceEchoDecision {
  readonly deliverable: boolean;
  readonly echoSuspected: boolean;
  readonly guardRemainingMs: number;
  readonly reason: 'no_active_output' | 'during_speech_output' | 'within_output_tail';
}

/** TTS 输出窗口闸：窗口内与尾静音期内的麦克风输入判为疑似回声，不交付为用户语音。 */
export interface VoiceEchoGuard {
  beginSpeechOutput(replyId?: string): VoiceEchoWindow;
  endSpeechOutput(replyId: string): boolean;
  inspect(at?: number): VoiceEchoDecision;
  activeWindows(): readonly VoiceEchoWindow[];
}

export function createVoiceEchoGuard(options: VoiceEchoGuardOptions = {}): VoiceEchoGuard {
  const tailMs = options.tailMs ?? DEFAULT_TAIL_MS;
  if (!isFiniteMs(tailMs) || tailMs < MIN_TAIL_MS || tailMs > MAX_TAIL_MS) {
    throw new RangeError(`tailMs 必须在 ${MIN_TAIL_MS}..${MAX_TAIL_MS} 毫秒`);
  }
  const now = options.now ?? Date.now;
  const windows: VoiceEchoWindow[] = [];
  const guard = {
    beginSpeechOutput(replyId?: string): VoiceEchoWindow {
      const window: VoiceEchoWindow = {replyId: replyId ?? randomUUID(), startedAt: now(), endedAt: null};
      windows.push(window);
      while (windows.length > MAX_ACTIVE_WINDOWS) windows.shift();
      return window;
    },
    endSpeechOutput(replyId: string): boolean {
      const window = [...windows].reverse().find((w) => w.replyId === replyId && w.endedAt === null);
      if (!window) return false;
      (window as {endedAt: number | null}).endedAt = now();
      return true;
    },
    inspect(at?: number): VoiceEchoDecision {
      const t = isFiniteMs(at) ? at : now();
      // 过期窗口清理：endedAt + tailMs 已过 → 移除（防状态积压）
      for (let i = windows.length - 1; i >= 0; i--) {
        const w = windows[i]!;
        if (w.endedAt !== null && t > w.endedAt + tailMs) windows.splice(i, 1);
      }
      for (const w of windows) {
        if (w.endedAt === null) {
          return {deliverable: false, echoSuspected: true, guardRemainingMs: Number.POSITIVE_INFINITY,
            reason: 'during_speech_output'};
        }
        const remaining = w.endedAt + tailMs - t;
        if (remaining > 0) {
          return {deliverable: false, echoSuspected: true, guardRemainingMs: remaining, reason: 'within_output_tail'};
        }
      }
      return {deliverable: true, echoSuspected: false, guardRemainingMs: 0, reason: 'no_active_output'};
    },
    activeWindows: () => [...windows].map((w) => ({...w})),
  };
  return guard;
}

/** final 转写回执：final 必须携带可核对的会话/时长/证据；缺回执不作为已确认用户输入。 */
export interface FinalTranscriptReceipt {
  readonly version: 1;
  readonly sessionId: string;
  readonly transcriptId: string;
  readonly capturedAt: string;
  readonly durationMs: number;
  readonly evidenceRefs: readonly string[];
  readonly deviceId?: string;
}

export interface FinalTranscriptVerdict {
  readonly verified: boolean;
  readonly reason: 'verified' | 'missing_receipt' | 'malformed' | 'stale' | 'empty_evidence' | 'non_positive_duration';
}

export function buildFinalTranscriptReceipt(input: {
  sessionId: string; durationMs: number; evidenceRefs: readonly string[]; deviceId?: string;
  capturedAt?: string; transcriptId?: string;
}): FinalTranscriptReceipt {
  if (typeof input?.sessionId !== 'string' || !input.sessionId.trim()) {
    throw new TypeError('buildFinalTranscriptReceipt 需要 sessionId');
  }
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0) {
    throw new TypeError('buildFinalTranscriptReceipt 需要 evidenceRefs');
  }
  if (!Number.isFinite(input.durationMs)) throw new TypeError('buildFinalTranscriptReceipt 需要 durationMs');
  return {
    version: 1,
    sessionId: input.sessionId,
    transcriptId: input.transcriptId ?? randomUUID(),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    durationMs: input.durationMs,
    evidenceRefs: [...input.evidenceRefs],
    ...(input.deviceId ? {deviceId: input.deviceId} : {}),
  };
}

export function verifyFinalTranscriptReceipt(receipt: FinalTranscriptReceipt | undefined | null, options: {
  now?(): number; maxAgeMs?: number;
} = {}): FinalTranscriptVerdict {
  if (!receipt) return {verified: false, reason: 'missing_receipt'};
  const textOk = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
  if (receipt.version !== 1 || !textOk(receipt.sessionId) || !textOk(receipt.transcriptId)
    || !textOk(receipt.capturedAt) || !Number.isFinite(Date.parse(receipt.capturedAt))
    || !isFiniteMs(receipt.durationMs)) return {verified: false, reason: 'malformed'};
  if (!Array.isArray(receipt.evidenceRefs) || receipt.evidenceRefs.length === 0
    || !receipt.evidenceRefs.every(textOk)) return {verified: false, reason: 'empty_evidence'};
  if (receipt.durationMs <= 0) return {verified: false, reason: 'non_positive_duration'};
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  if (now() - Date.parse(receipt.capturedAt) > maxAgeMs) return {verified: false, reason: 'stale'};
  return {verified: true, reason: 'verified'};
}

/** 设备证据：绑定设备描述的有界指纹记录；真实设备验收（回声/误触/物理释放）另行现场取证。 */
export interface VoiceDeviceEvidence {
  readonly version: 1;
  readonly deviceId: string;
  readonly descriptorSha256: string;
  readonly format: {readonly sampleRate: number; readonly channels: number; readonly bitDepth: number};
  readonly capturedAt: string;
  readonly acceptance: 'pending_real_device';
}

export function buildVoiceDeviceEvidence(input: {
  deviceId: string; format: {sampleRate: number; channels: number; bitDepth: number};
  capturedAt?: string;
}): VoiceDeviceEvidence {
  if (typeof input?.deviceId !== 'string' || !input.deviceId.trim()) throw new TypeError('deviceId 必填');
  const {sampleRate, channels, bitDepth} = input.format ?? {};
  for (const [key, value] of Object.entries({sampleRate, channels, bitDepth})) {
    if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new TypeError(`format.${key} 必须为正整数`);
  }
  return {
    version: 1,
    deviceId: input.deviceId,
    descriptorSha256: createHash('sha256').update(JSON.stringify({deviceId: input.deviceId, format: input.format})).digest('hex'),
    format: {sampleRate, channels, bitDepth},
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    acceptance: 'pending_real_device',
  };
}
