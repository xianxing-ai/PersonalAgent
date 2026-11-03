import {CrewError} from '../errors.js';
import {
  CrewSessionEventBus,
  type CrewDriver,
  type CrewDriverEvent,
  type CrewDriverProbe,
  type CrewDriverSession,
  type CrewDriverStartInput,
  type CrewDriverUnsubscribe,
} from '../driver.js';
import type {CrewConsentProvider} from '../consent.js';
import {apiKeyEnvNames, type CrewApiKeyProvider} from '../secrets.js';
import type {CrewDriverId} from '../store.js';
import {
  describeTransportError,
  describeVendorError,
  isRecord,
  optionalString,
  readSseResponse,
  startTurnAbort,
} from './api-http.js';

/**
 * Grok 驱动（P4）：xAI OpenAI 兼容 Chat Completions HTTP API 的 API key 客户端。
 *
 * 设计页结论（订阅合规边界）："API key 先行；订阅条款核实前不开订阅模式"——
 * 本驱动只支持 API key（按量计费），不走本机 CLI。实现 p2 的统一驱动接口
 * （start / send / interrupt / 事件流），一个会话对应一段多轮对话：会话在内存里
 * 维护 user/assistant 历史，每轮请求都带 `system`（agent 注册指令）。
 *
 * 合规边界（任务要求）：
 * - API key 只从环境变量（`XAI_API_KEY` / `GROK_API_KEY`）或调用方注入的
 *   `CrewApiKeyProvider` 读取；key 只经 `Authorization: Bearer` 请求头发往配置的
 *   官方端点，绝不进 URL/查询串，绝不写日志、不落盘、不进回执、不进事件流、
 *   不进错误信息；
 * - 缺密钥时 `start` 明确 `DRIVER_UNAVAILABLE`，不假装可用；
 * - 首次使用前必须经 `CrewConsentProvider.requireGranted('grok')` 同意
 *   （同意记录 loginKind='api-key'）；
 * - 不读取任何凭据文件；对话历史只在内存（随会话释放），不落盘。
 *
 * 协议说明：SSE 数据帧按 2026-11 的 xAI OpenAI 兼容 Chat Completions 约定实现
 * （`data: {"choices":[{"delta":{"content":…}}]}`，`data: [DONE]` 结束）。
 * **未对真实 Grok 服务做实机验证**；单元测试用本地假 HTTP 服务器模拟。
 * 若真实协议字段有出入，只需调整本文件的 PROTOCOL_* 常量与对应解析。
 */

export const GROK_DRIVER_ID: CrewDriverId = 'grok';

const PROTOCOL_CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

const PROTOCOL_DONE_PAYLOAD = '[DONE]';

const DEFAULT_GROK_BASE_URL = 'https://api.x.ai';
const DEFAULT_GROK_MODEL = 'grok-4';
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export interface GrokApiDriverOptions {
  /** 同意门：start 前必须已获用户同意（loginKind='api-key'）。 */
  readonly consent: CrewConsentProvider;
  /** API key 来源；默认从进程环境变量读取（见 `EnvCrewApiKeyProvider`）。 */
  readonly apiKeyProvider?: CrewApiKeyProvider;
  /** 官方 API 根地址；默认 https://api.x.ai。测试注入本地假服务器地址。 */
  readonly baseUrl?: string;
  /** 模型名；默认 grok-4（未实机验证，可配置）。 */
  readonly model?: string;
  /** 单次请求输出上限；省略时不下发该字段（由服务端默认）。 */
  readonly maxTokens?: number;
  /** fetch 实现；默认全局 fetch（本地假 HTTP 服务器直接用真实 fetch 访问 127.0.0.1）。 */
  readonly fetchImpl?: typeof fetch;
  /** 整轮请求（含流读取）的超时，默认 120s。 */
  readonly requestTimeoutMs?: number;
  readonly sessionIdPrefix?: string;
}

interface GrokTurnMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

function missingKeyReason(): string {
  const names = apiKeyEnvNames('grok').join(' 或 ');
  return `未配置 Grok API key：请在环境变量 ${names} 中配置你自己的 key，或向驱动注入 CrewApiKeyProvider；产品不读取凭据文件、不代取 key`;
}

/** 单个 Grok API 会话：内存多轮历史 + OpenAI 兼容 SSE 流式响应。 */
class GrokApiSession implements CrewDriverSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly driver = GROK_DRIVER_ID;
  private readonly events = new CrewSessionEventBus();
  private readonly options: Omit<GrokApiDriverOptions, 'consent' | 'apiKeyProvider'>;
  private readonly apiKey: string;
  private readonly instructions: string;
  private readonly messages: GrokTurnMessage[] = [];
  private closed = false;
  private active: {controller: AbortController; timedOut: {value: boolean}; interruptRequested: {value: boolean}} | null = null;

  constructor(input: {
    sessionId: string;
    agentId: string;
    options: Omit<GrokApiDriverOptions, 'consent' | 'apiKeyProvider'>;
    apiKey: string;
    instructions: string;
  }) {
    this.sessionId = input.sessionId;
    this.agentId = input.agentId;
    this.options = input.options;
    this.apiKey = input.apiKey;
    this.instructions = input.instructions;
  }

  /** 发送一条用户消息并跑完一轮请求：流中 delta → output 事件，[DONE] → completed。 */
  send(text: string): Promise<void> {
    if (this.closed) {
      return Promise.reject(new CrewError('DRIVER_FAILED', 'Grok 会话已关闭，无法发送'));
    }
    if (this.active) {
      return Promise.reject(new CrewError('CONFLICT', '上一条 Grok 请求仍在进行中，不能并发发送'));
    }
    this.messages.push({role: 'user', content: text});
    return this.runTurn();
  }

  /** 打断当前运行：abort 在途请求并立即产生 interrupted 事件（请求侧异常按打断吞掉）。 */
  interrupt(reason: string): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.active) {
      this.active.interruptRequested.value = true;
      this.active.controller.abort();
    }
    this.emit({type: 'interrupted', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, reason});
    return Promise.resolve();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.active) this.active.controller.abort();
    // HTTP 会话没有子进程：exited 仅表示会话终止（exitCode=null）。
    this.emit({type: 'exited', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, exitCode: null, signal: null});
  }

  onEvent(listener: (event: CrewDriverEvent) => void): CrewDriverUnsubscribe {
    return this.events.subscribe(listener);
  }

  /** 会话建立即产生 started 事件（由驱动在 start 返回前调用）。 */
  emitStarted(): void {
    this.emit({type: 'started', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver});
  }

  private emit(event: CrewDriverEvent): void {
    this.events.emit(event);
  }

  private emitFailed(message: string): void {
    this.emit({type: 'failed', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, message});
  }

  private baseUrl(): string {
    return (this.options.baseUrl ?? DEFAULT_GROK_BASE_URL).replace(/\/+$/, '');
  }

  private requestTimeoutMs(): number {
    return this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** 失败/被打断的一轮不留在历史里（下一条消息仍是合法的 user 开头）。 */
  private popLastUserMessage(): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === 'user') this.messages.pop();
  }

  private requestBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.options.model ?? DEFAULT_GROK_MODEL,
      stream: true,
      // 每轮都带 system（agent 注册指令）；历史只含内存中的 user/assistant 轮次。
      messages: [{role: 'system', content: this.instructions}, ...this.messages],
    };
    if (this.options.maxTokens !== undefined) body['max_tokens'] = this.options.maxTokens;
    return body;
  }

  /** 一轮对话：POST /v1/chat/completions（stream: true），SSE 数据帧映射为 crew 事件。 */
  private async runTurn(): Promise<void> {
    const {state, timer} = startTurnAbort(this.requestTimeoutMs());
    this.active = state;
    let finalText = '';
    let sawDone = false;
    let streamFailed = false;
    try {
      const fetchImpl = this.options.fetchImpl ?? fetch;
      const response = await fetchImpl(`${this.baseUrl()}${PROTOCOL_CHAT_COMPLETIONS_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(this.requestBody()),
        signal: state.controller.signal,
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        this.emitFailed(`Grok API 请求失败（HTTP ${response.status}）：${describeVendorError(bodyText)}`);
        this.popLastUserMessage();
        return;
      }
      await readSseResponse(response, payload => {
        if (payload.trim() === PROTOCOL_DONE_PAYLOAD) {
          sawDone = true;
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return; // 忽略无法解析的负载（协议演进容错）。
        }
        if (!isRecord(parsed)) return;
        if (isRecord(parsed['error'])) {
          const raw = optionalString(parsed['error']['message']) ?? optionalString(parsed['error']['code']) ?? '未知流内错误';
          finalText = ''; // 流内错误：本轮已累计文本不构成结果。
          streamFailed = true;
          this.emitFailed(`Grok API 流返回错误：${raw}`);
          return;
        }
        const choice = Array.isArray(parsed['choices']) && isRecord(parsed['choices'][0]) ? parsed['choices'][0] : undefined;
        const delta = isRecord(choice?.['delta']) ? choice['delta'] : undefined;
        const text = optionalString(delta?.['content']) ?? '';
        if (!text) return;
        finalText += text;
        this.emit({type: 'output', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, text});
      });
      // 流内错误已发 failed（不重复发终态）；这里只在正常结束时结算。
      if (streamFailed) {
        this.popLastUserMessage();
        return;
      }
      if (!sawDone) {
        this.emitFailed('Grok API 流在 [DONE] 之前结束');
        this.popLastUserMessage();
        return;
      }
      const result = finalText.trim();
      if (result) this.messages.push({role: 'assistant', content: finalText});
      this.emit({type: 'completed', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, result});
    } catch (error) {
      if (state.interruptRequested.value) return; // 打断路径：interrupted 事件已由 interrupt() 发出。
      if (this.closed) return; // close() 主动终止：exited 事件已由 close() 发出。
      if (state.timedOut.value) {
        this.emitFailed(`Grok API 请求超时（${this.requestTimeoutMs()}ms）`);
      } else {
        this.emitFailed(`Grok API 请求失败：${describeTransportError(error)}`);
      }
      this.popLastUserMessage();
    } finally {
      clearTimeout(timer);
      this.active = null;
    }
  }
}

/** Grok（xAI OpenAI 兼容 API）的 API key 驱动。见模块级注释的合规边界与未实机验证说明。 */
export class GrokApiDriver implements CrewDriver {
  readonly driverId = GROK_DRIVER_ID;

  private readonly consent: CrewConsentProvider;
  private readonly apiKeyProvider: CrewApiKeyProvider;
  private readonly sessionOptions: Omit<GrokApiDriverOptions, 'consent' | 'apiKeyProvider'>;
  private readonly sessionIdPrefix: string;
  private sessionCounter = 0;

  constructor(options: GrokApiDriverOptions) {
    this.consent = options.consent;
    this.apiKeyProvider = options.apiKeyProvider ?? {getApiKey: () => undefined};
    this.sessionOptions = {
      ...(options.baseUrl === undefined ? {} : {baseUrl: options.baseUrl}),
      ...(options.model === undefined ? {} : {model: options.model}),
      ...(options.maxTokens === undefined ? {} : {maxTokens: options.maxTokens}),
      ...(options.fetchImpl === undefined ? {} : {fetchImpl: options.fetchImpl}),
      ...(options.requestTimeoutMs === undefined ? {} : {requestTimeoutMs: options.requestTimeoutMs}),
    };
    this.sessionIdPrefix = options.sessionIdPrefix ?? 'grok-session';
  }

  /** 探测本机可用性：只检查密钥来源是否已配置（不发起网络请求、不验证 key 有效性）。 */
  async probe(): Promise<CrewDriverProbe> {
    const key = this.apiKeyProvider.getApiKey(GROK_DRIVER_ID);
    if (!key) return {status: 'unavailable', reason: missingKeyReason()};
    return {status: 'available'};
  }

  async start(input: CrewDriverStartInput): Promise<CrewDriverSession> {
    // 1. 同意门：未同意/已撤销必须拒绝（不产生任何请求）。
    this.consent.requireGranted(GROK_DRIVER_ID);
    // 2. 密钥来源：缺 key 明确 unavailable，不假装可用。
    const apiKey = this.apiKeyProvider.getApiKey(GROK_DRIVER_ID);
    if (!apiKey) throw new CrewError('DRIVER_UNAVAILABLE', `Grok 驱动不可用：${missingKeyReason()}`);
    // 3. 会话在内存建立（不发预检请求）；首次网络调用发生在 send。
    const session = new GrokApiSession({
      sessionId: `${this.sessionIdPrefix}-${++this.sessionCounter}`,
      agentId: input.agentId,
      options: this.sessionOptions,
      apiKey,
      instructions: input.instructions,
    });
    session.emitStarted();
    return session;
  }
}
