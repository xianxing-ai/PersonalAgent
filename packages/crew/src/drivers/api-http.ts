import {CrewError} from '../errors.js';
import {redactSensitiveText} from '../sanitize.js';

/**
 * Claude/Grok HTTP API 驱动共享的传输底座（P4）。
 *
 * 合规边界：API key 只经 HTTP 请求头发往配置的官方端点（绝不进 URL/查询串）；
 * 错误信息只提取厂商错误对象中的 message/type 字段并截断，绝不回显请求头、
 * 请求体或密钥。驱动不写任何日志。
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * SSE 事件读取器：按行缓冲，`data:` 行累积为一个事件负载，空行派发。
 * 处理 \r\n 与 `:` 注释行；多行 data 按 SSE 规范以 \n 连接。
 * 无法解析的负载由调用方决定忽略（协议演进容错）。
 */
export class SseEventReader {
  private buffer = '';
  private dataLines: string[] = [];

  /** 喂入一个文本块，返回此次完整派发的 data 负载。 */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const payloads: string[] = [];
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      const payload = this.handleLine(line);
      if (payload !== undefined) payloads.push(payload);
    }
    return payloads;
  }

  /** 流正常结束时调用：派发未以空行终结的残余行（含无换行的尾部负载）。 */
  flush(): string[] {
    const payloads: string[] = [];
    const rest = this.buffer;
    this.buffer = '';
    if (rest) {
      const payload = this.handleLine(rest);
      if (payload !== undefined) payloads.push(payload);
    }
    const payload = this.handleLine('');
    if (payload !== undefined) payloads.push(payload);
    return payloads;
  }

  private handleLine(line: string): string | undefined {
    if (line === '') {
      if (this.dataLines.length === 0) return undefined;
      const payload = this.dataLines.join('\n');
      this.dataLines = [];
      return payload;
    }
    if (line.startsWith(':')) return undefined;
    if (line.startsWith('data:')) {
      const value = line.slice('data:'.length);
      this.dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    }
    // event/id/retry 行不影响按 data 派发的语义，忽略。
    return undefined;
  }
}

/** 读取 fetch Response 的 SSE 流并逐负载回调；abort/网络错误原样抛给调用方分类。 */
export async function readSseResponse(response: Response, onPayload: (payload: string) => void): Promise<void> {
  const body = response.body;
  if (!body) throw new CrewError('DRIVER_PROTOCOL', 'API 响应缺少可读的 SSE 流');
  const reader = body.getReader();
  const sse = new SseEventReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      for (const payload of sse.push(decoder.decode(value, {stream: true}))) onPayload(payload);
    }
    for (const payload of sse.flush()) onPayload(payload);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 流已关闭或读取器已释放，忽略。
    }
  }
}

/**
 * 从厂商错误响应体中提取可安全展示的摘要：只取解析后的 error.message /
 * error.type / message 字段并截断到 300 字符；无法解析时只说明形状，
 * 绝不回显原始响应体（避免任何请求回显把密钥带进错误信息）。
 */
export function describeVendorError(bodyText: string): string {
  if (!bodyText.trim()) return '（厂商未返回错误详情）';
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return `（厂商返回非 JSON 错误体，${bodyText.length} 字符，不予回显）`;
  }
  if (!isRecord(parsed)) return '（厂商错误体不是对象，不予回显）';
  const errorField = isRecord(parsed['error']) ? parsed['error'] : undefined;
  const message = optionalString(errorField?.['message']) ?? optionalString(parsed['message']);
  const type = optionalString(errorField?.['type']) ?? optionalString(errorField?.['code']) ?? optionalString(parsed['type']);
  const parts: string[] = [];
  if (type) parts.push(`type=${truncate(redactSensitiveText(type))}`);
  if (message) parts.push(truncate(redactSensitiveText(message)));
  // 字段名列表（不含值）帮助诊断，避免把完整 JSON 塞进回执。
  const keys = Object.keys(errorField ?? parsed).slice(0, 8);
  if (!parts.length && keys.length) parts.push(`fields=${keys.join(',')}`);
  return parts.length ? parts.join('：') : '（厂商错误体缺少可展示字段，不予回显）';
}

/**
 * F7：生产 baseUrl 必须是 https；测试可用 allowHttpLoopback 放行 127.0.0.1/localhost 的 http。
 */
export function assertSafeApiBaseUrl(baseUrl: string, options: {readonly allowHttpLoopback?: boolean} = {}): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new CrewError('INVALID_INPUT', `baseUrl is not a valid URL: ${baseUrl}`);
  }
  const host = parsed.hostname.toLowerCase();
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (parsed.protocol === 'https:') return baseUrl.replace(/\/+$/, '');
  if (parsed.protocol === 'http:' && options.allowHttpLoopback === true && loopback) {
    return baseUrl.replace(/\/+$/, '');
  }
  throw new CrewError('INVALID_INPUT', `baseUrl must use https (got ${parsed.protocol}//${host}); set allowHttpLoopback for local fake servers in tests`);
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 一次 HTTP turn 的打断/超时状态：共享同一个 AbortController，超时先行记旗。 */
export interface TurnAbortState {
  readonly controller: AbortController;
  readonly timedOut: {value: boolean};
  readonly interruptRequested: {value: boolean};
}

export function startTurnAbort(timeoutMs: number): {state: TurnAbortState; timer: NodeJS.Timeout} {
  const controller = new AbortController();
  const timedOut = {value: false};
  const interruptRequested = {value: false};
  const timer = setTimeout(() => {
    timedOut.value = true;
    controller.abort();
  }, timeoutMs);
  return {state: {controller, timedOut, interruptRequested}, timer};
}

/** 把底层异常分类为安全的失败消息（不含密钥：abort 与网络错误消息里不会有请求头）。 */
export function describeTransportError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
