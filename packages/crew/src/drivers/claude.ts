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
 * Claude 驱动（P4）：Anthropic Messages HTTP API 的 API key 客户端。
 *
 * 与 P2 Codex 驱动的差别：Claude 不走本机 CLI（设计页"产品默认必须 API key"），
 * 而是凭用户自己的 API key 直接调用官方 HTTP API（按量计费）。实现 p2 的统一
 * 驱动接口（start / send / interrupt / 事件流），一个会话对应一段多轮对话：
 * 会话在内存里维护 user/assistant 历史，`system` 为 agent 注册指令。
 *
 * 合规边界（任务要求与设计页订阅合规边界）：
 * - API key 只从环境变量（`ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`）或调用方注入的
 *   `CrewApiKeyProvider` 读取；key 只经 `x-api-key` 请求头发往配置的官方端点，
 *   绝不进 URL/查询串，绝不写日志、不落盘、不进回执、不进事件流、不进错误信息；
 * - 缺密钥时 `start` 明确 `DRIVER_UNAVAILABLE`，不假装可用；
 * - 首次使用前必须经 `CrewConsentProvider.requireGranted('claude')` 同意
 *   （同意记录 loginKind='api-key'）；
 * - 不读取任何凭据文件；对话历史只在内存（随会话释放），不落盘。
 *
 * 协议说明：SSE 事件名按 2026-11 的 Anthropic Messages API 约定实现
 * （message_start / content_block_delta[text_delta] / message_stop / error）。
 * **未对真实 Claude 服务做实机验证**；单元测试用本地假 HTTP 服务器模拟。
 * 若真实协议字段有出入，只需调整本文件的 PROTOCOL_* 常量与对应解析。
 */

export const CLAUDE_DRIVER_ID: CrewDriverId = 'claude';

const PROTOCOL_MESSAGES_PATH = '/v1/messages';
const PROTOCOL_ANTHROPIC_VERSION = '2023-06-01';

const PROTOCOL_EVENT_CONTENT_BLOCK_DELTA = 'content_block_delta';
const PROTOCOL_DELTA_TEXT = 'text_delta';
const PROTOCOL_EVENT_MESSAGE_STOP = 'message_stop';
const PROTOCOL_EVENT_ERROR = 'error';

const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export interface ClaudeApiDriverOptions {
  /** 同意门：start 前必须已获用户同意（loginKind='api-key'）。 */
  readonly consent: CrewConsentProvider;
  /** API key 来源；默认从进程环境变量读取（见 `EnvCrewApiKeyProvider`）。 */
  readonly apiKeyProvider?: CrewApiKeyProvider;
  /** 官方 API 根地址；默认 https://api.anthropic.com。测试注入本地假服务器地址。 */
  readonly baseUrl?: string;
  /** 模型名；默认 claude-sonnet-4-5（未实机验证，可配置）。 */
  readonly model?: string;
  /** 单次请求输出上限（Messages API 必填字段）；默认 8192。 */
  readonly maxTokens?: number;
  /** anthropic-version 请求头；默认 2023-06-01。 */
  readonly anthropicVersion?: string;
  /** fetch 实现；默认全局 fetch（本地假 HTTP 服务器直接用真实 fetch 访问 127.0.0.1）。 */
  readonly fetchImpl?: typeof fetch;
  /** 整轮请求（含流读取）的超时，默认 120s。 */
  readonly requestTimeoutMs?: number;
  readonly sessionIdPrefix?: string;
}

interface ClaudeTurnMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

function missingKeyReason(): string {
  const names = apiKeyEnvNames('claude').join(' 或 ');
  return `未配置 Claude API key：请在环境变量 ${names} 中配置你自己的 key，或向驱动注入 CrewApiKeyProvider；产品不读取凭据文件、不代取 key`;
}

/** 单个 Claude API 会话：内存多轮历史 + SSE 流式响应。 */
class ClaudeApiSession implements CrewDriverSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly driver = CLAUDE_DRIVER_ID;
  private readonly events = new CrewSessionEventBus();
  private readonly options: Omit<ClaudeApiDriverOptions, 'consent' | 'apiKeyProvider'>;
  private readonly apiKey: string;
  private readonly instructions: string;
  private readonly messages: ClaudeTurnMessage[] = [];
  private closed = false;
  private active: {controller: AbortController; timedOut: {value: boolean}; interruptRequested: {value: boolean}} | null = null;

  constructor(input: {
    sessionId: string;
    agentId: string;
    options: Omit<ClaudeApiDriverOptions, 'consent' | 'apiKeyProvider'>;
    apiKey: string;
    instructions: string;
  }) {
    this.sessionId = input.sessionId;
    this.agentId = input.agentId;
    this.options = input.options;
    this.apiKey = input.apiKey;
    this.instructions = input.instructions;
  }

  /** 发送一条用户消息并跑完一轮请求：流中 delta → output 事件，message_stop → completed。 */
  send(text: string): Promise<void> {
    if (this.closed) {
      return Promise.reject(new CrewError('DRIVER_FAILED', 'Claude 会话已关闭，无法发送'));
    }
    if (this.active) {
      return Promise.reject(new CrewError('CONFLICT', '上一条 Claude 请求仍在进行中，不能并发发送'));
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
    return (this.options.baseUrl ?? DEFAULT_CLAUDE_BASE_URL).replace(/\/+$/, '');
  }

  private requestTimeoutMs(): number {
    return this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** 失败/被打断的一轮不留在历史里（下一条消息仍是合法的 user 开头）。 */
  private popLastUserMessage(): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === 'user') this.messages.pop();
  }

  /** 一轮对话：POST /v1/messages（stream: true），SSE 事件映射为 crew 事件。 */
  private async runTurn(): Promise<void> {
    const {state, timer} = startTurnAbort(this.requestTimeoutMs());
    this.active = state;
    let finalText = '';
    let streamError: string | undefined;
    let sawMessageStop = false;
    try {
      const fetchImpl = this.options.fetchImpl ?? fetch;
      const response = await fetchImpl(`${this.baseUrl()}${PROTOCOL_MESSAGES_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.options.anthropicVersion ?? PROTOCOL_ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.options.model ?? DEFAULT_CLAUDE_MODEL,
          max_tokens: this.options.maxTokens ?? DEFAULT_MAX_TOKENS,
          stream: true,
          system: this.instructions,
          messages: this.messages,
        }),
        signal: state.controller.signal,
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        this.emitFailed(`Claude API 请求失败（HTTP ${response.status}）：${describeVendorError(bodyText)}`);
        this.popLastUserMessage();
        return;
      }
      await readSseResponse(response, payload => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return; // 忽略无法解析的负载（协议演进容错）。
        }
        if (!isRecord(parsed)) return;
        switch (parsed['type']) {
          case PROTOCOL_EVENT_CONTENT_BLOCK_DELTA: {
            const delta = isRecord(parsed['delta']) ? parsed['delta'] : undefined;
            if (optionalString(delta?.['type']) !== PROTOCOL_DELTA_TEXT) return;
            const text = optionalString(delta?.['text']) ?? '';
            if (!text) return;
            finalText += text;
            this.emit({type: 'output', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, text});
            return;
          }
          case PROTOCOL_EVENT_MESSAGE_STOP: {
            sawMessageStop = true;
            return;
          }
          case PROTOCOL_EVENT_ERROR: {
            const error = isRecord(parsed['error']) ? parsed['error'] : undefined;
            streamError = optionalString(error?.['message']) ?? optionalString(error?.['type']) ?? '未知流内错误';
            return;
          }
          default:
            return; // message_start 等其余事件不产生 crew 事件。
        }
      });
      if (streamError !== undefined) {
        this.emitFailed(`Claude API 流返回错误：${streamError}`);
        this.popLastUserMessage();
        return;
      }
      if (!sawMessageStop) {
        this.emitFailed('Claude API 流在 message_stop 之前结束');
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
        this.emitFailed(`Claude API 请求超时（${this.requestTimeoutMs()}ms）`);
      } else {
        this.emitFailed(`Claude API 请求失败：${describeTransportError(error)}`);
      }
      this.popLastUserMessage();
    } finally {
      clearTimeout(timer);
      this.active = null;
    }
  }
}

/** Claude（Anthropic Messages API）的 API key 驱动。见模块级注释的合规边界与未实机验证说明。 */
export class ClaudeApiDriver implements CrewDriver {
  readonly driverId = CLAUDE_DRIVER_ID;

  private readonly consent: CrewConsentProvider;
  private readonly apiKeyProvider: CrewApiKeyProvider;
  private readonly sessionOptions: Omit<ClaudeApiDriverOptions, 'consent' | 'apiKeyProvider'>;
  private readonly sessionIdPrefix: string;
  private sessionCounter = 0;

  constructor(options: ClaudeApiDriverOptions) {
    this.consent = options.consent;
    this.apiKeyProvider = options.apiKeyProvider ?? {getApiKey: () => undefined};
    this.sessionOptions = {
      ...(options.baseUrl === undefined ? {} : {baseUrl: options.baseUrl}),
      ...(options.model === undefined ? {} : {model: options.model}),
      ...(options.maxTokens === undefined ? {} : {maxTokens: options.maxTokens}),
      ...(options.anthropicVersion === undefined ? {} : {anthropicVersion: options.anthropicVersion}),
      ...(options.fetchImpl === undefined ? {} : {fetchImpl: options.fetchImpl}),
      ...(options.requestTimeoutMs === undefined ? {} : {requestTimeoutMs: options.requestTimeoutMs}),
    };
    this.sessionIdPrefix = options.sessionIdPrefix ?? 'claude-session';
  }

  /** 探测本机可用性：只检查密钥来源是否已配置（不发起网络请求、不验证 key 有效性）。 */
  async probe(): Promise<CrewDriverProbe> {
    const key = this.apiKeyProvider.getApiKey(CLAUDE_DRIVER_ID);
    if (!key) return {status: 'unavailable', reason: missingKeyReason()};
    return {status: 'available'};
  }

  async start(input: CrewDriverStartInput): Promise<CrewDriverSession> {
    // 1. 同意门：未同意/已撤销必须拒绝（不产生任何请求）。
    this.consent.requireGranted(CLAUDE_DRIVER_ID);
    // 2. 密钥来源：缺 key 明确 unavailable，不假装可用。
    const apiKey = this.apiKeyProvider.getApiKey(CLAUDE_DRIVER_ID);
    if (!apiKey) throw new CrewError('DRIVER_UNAVAILABLE', `Claude 驱动不可用：${missingKeyReason()}`);
    // 3. 会话在内存建立（不发预检请求）；首次网络调用发生在 send。
    const session = new ClaudeApiSession({
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
