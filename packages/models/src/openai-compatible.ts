import {ProtocolError} from '@personal-agent/contracts';
import type {ModelCapabilities, ModelDeployment, ModelMessage, ModelProvider, ModelRequest, ModelResult, ModelUsage, NativeReasoningConfiguration} from './index.js';

/**
 * OpenAI 兼容文本 Provider（POST {baseUrl}/chat/completions）。POTATOS-MVP §9.3「约定供应者」：
 * 适用任何 OpenAI Chat Completions 兼容端点（DeepSeek/智谱/Moonshot/vLLM 等），baseUrl 需含
 * 版本段（如 `https://api.deepseek.com/v1`）。本层只做文本补全；工具调用经现有
 * `StructuredToolProvider` 组合获得（JSON 提案协议对任意端点可用，不依赖各家原生
 * function-calling 的兼容差异——原生 function calling 待逐端点真实验收后再开）。
 */
export interface OpenAICompatibleModelProviderOptions {
  baseUrl: string;
  model: string;
  /** 展示名（缺省用 model）；同一 model 名多部署时用于区分。 */
  deployment?: string;
  /** 凭据经宿主注入（函数取值），Provider 不保存明文。 */
  apiKey: () => string | Promise<string>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** 端点上下文窗口（进 capabilities.contextLimit）；缺省 32k 保守值，按端点如实配置。 */
  contextLimitTokens?: number;
  /** Explicit Competition auxiliary-model configuration, supplied by the trusted host. */
  nativeReasoning?: NativeReasoningConfiguration;
}

function nativeReasoningConfiguration(value: NativeReasoningConfiguration): NativeReasoningConfiguration {
  const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['thinking', 'effort', 'supportedEfforts', 'outputTokenParameter'].includes(key))
    || !['enabled', 'disabled'].includes(value.thinking)
    || !['max_tokens', 'max_completion_tokens'].includes(value.outputTokenParameter)
    || !Array.isArray(value.supportedEfforts) || new Set(value.supportedEfforts).size !== value.supportedEfforts.length
    || value.supportedEfforts.some(effort => !efforts.includes(effort))
    || (value.effort !== undefined && !value.supportedEfforts.includes(value.effort))
    || (value.thinking === 'disabled' && (value.effort !== undefined || value.supportedEfforts.length > 0))) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Native reasoning configuration is invalid');
  }
  return structuredClone(value);
}

function openAiCompatibleCapabilities(contextLimitTokens: number): ModelCapabilities {
  return {text: true, streaming: false, toolCalling: false, structuredOutput: false, vision: false, contextLimit: contextLimitTokens};
}

export class OpenAICompatibleModelProvider implements ModelProvider {
  readonly deployment: ModelDeployment;
  private readonly request: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: () => string | Promise<string>;
  private readonly timeoutMs: number;
  private readonly nativeReasoning: NativeReasoningConfiguration | undefined;

  constructor(options: OpenAICompatibleModelProviderOptions) {
    this.nativeReasoning = options.nativeReasoning === undefined ? undefined : nativeReasoningConfiguration(options.nativeReasoning);
    const base = options.baseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//u.test(base)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'baseUrl must be an absolute http(s) URL including the version segment (e.g. https://api.deepseek.com/v1)');
    }
    this.baseUrl = base;
    this.model = typeof options.model === 'string' && options.model.trim() ? options.model.trim() : '';
    if (!this.model) throw new ProtocolError('INVALID_ARGUMENT', 'model must not be empty');
    if (typeof options.apiKey !== 'function') throw new ProtocolError('INVALID_ARGUMENT', 'apiKey provider is required');
    this.apiKey = options.apiKey;
    this.request = options.fetch ?? globalThis.fetch;
    if (!this.request) throw new ProtocolError('INVALID_ARGUMENT', 'fetch is required for the OpenAI-compatible provider');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new ProtocolError('INVALID_ARGUMENT', 'timeoutMs must be a positive integer');
    }
    const contextLimitTokens = options.contextLimitTokens ?? 32_000;
    if (!Number.isSafeInteger(contextLimitTokens) || contextLimitTokens < 1) {
      throw new ProtocolError('INVALID_ARGUMENT', 'contextLimitTokens must be a positive integer');
    }
    this.deployment = {
      provider: 'openai-compatible',
      deployment: typeof options.deployment === 'string' && options.deployment.trim() ? options.deployment.trim() : this.model,
      model: this.model,
      verification: 'conditional',
      capabilities: {...openAiCompatibleCapabilities(contextLimitTokens),
        ...(this.nativeReasoning === undefined ? {} : {nativeReasoning: structuredClone(this.nativeReasoning)})},
    };
  }

  async complete(request: ModelRequest): Promise<ModelResult> {
    if (!request || !(request.signal instanceof AbortSignal) || !Number.isFinite(Date.parse(request.deadline))) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Model request is invalid');
    }
    const native = this.nativeReasoning;
    const effort = request.reasoningEffort ?? native?.effort;
    if (native && effort !== undefined && (native.thinking !== 'enabled' || !native.supportedEfforts.includes(effort))) {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Native reasoning effort is not declared for this configuration');
    }
    if (request.thinkingBudget !== undefined) {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'This provider does not support thinkingBudget');
    }
    if (request.maxOutputTokens !== undefined && (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'maxOutputTokens must be a positive integer');
    }
    if (request.tools.length > 0 || request.requiredCapabilities?.some(capability => capability !== 'text')) {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY',
        'OpenAI-compatible provider is text-only; compose StructuredToolProvider for tool calling');
    }
    const messages: {role: string; content: string}[] = [];
    for (const message of request.messages) {
      if (message.role === 'tool') {
        throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Text provider does not accept tool messages; route them through StructuredToolProvider');
      }
      const content = typeof message.content === 'string' ? message.content : '';
      if (!content.trim()) throw new ProtocolError('INVALID_ARGUMENT', 'Model message content must not be empty');
      messages.push({role: message.role, content});
    }
    const key = await this.apiKey();
    if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Model request was cancelled');
    if (!key || !key.trim()) throw new ProtocolError('UNAUTHORIZED', 'Model API key is not configured');
    const deadlineMs = Date.parse(request.deadline) - Date.now();
    if (deadlineMs <= 0) throw new ProtocolError('TIMEOUT', 'Model request deadline has expired', true);
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort('Model request timed out'); }, Math.min(this.timeoutMs, deadlineMs));
    request.signal.addEventListener('abort', abort, {once: true});
    const started = Date.now();
    try {
      const response = await this.request(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${key}`},
        body: JSON.stringify({
          model: this.model,
          messages,
          ...(native === undefined ? {} : {thinking: {type: native.thinking}}),
          ...(request.maxOutputTokens === undefined ? {} : {[native?.outputTokenParameter ?? 'max_tokens']: request.maxOutputTokens}),
          ...(effort === undefined ? {} : {reasoning_effort: effort}),
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw openAiError(response.status, response.headers.get('retry-after'));
      let body: unknown;
      try { body = await response.json(); } catch { throw new ProtocolError('EXTERNAL_FAILURE', 'Model endpoint returned invalid JSON'); }
      if (!body || typeof body !== 'object') throw new ProtocolError('EXTERNAL_FAILURE', 'Model endpoint returned an invalid response');
      const record = body as Record<string, unknown>;
      const choices = record.choices;
      if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') {
        throw new ProtocolError('EXTERNAL_FAILURE', 'Model response is missing choices');
      }
      const choice = choices[0] as Record<string, unknown>;
      const message = choice.message;
      if (!message || typeof message !== 'object') throw new ProtocolError('EXTERNAL_FAILURE', 'Model response is missing message');
      const rawContent = (message as Record<string, unknown>).content;
      if (typeof rawContent !== 'string' || !rawContent.trim()) {
        throw new ProtocolError('EXTERNAL_FAILURE', 'Model response is missing message content');
      }
      const usageValue = record.usage;
      const usage = usageValue && typeof usageValue === 'object' ? usageValue as Record<string, unknown> : undefined;
      const toCount = (value: unknown): number | undefined =>
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
      const promptTokens = toCount(usage?.prompt_tokens);
      const completionTokens = toCount(usage?.completion_tokens);
      const totalTokens = toCount(usage?.total_tokens);
      const parsedUsage: ModelUsage = {
        ...(promptTokens === undefined ? {} : {promptTokens}),
        ...(completionTokens === undefined ? {} : {completionTokens}),
        ...(totalTokens === undefined ? {} : {totalTokens}),
      };
      return {
        response: {kind: 'final', text: rawContent},
        deployment: structuredClone(this.deployment),
        ...(Object.keys(parsedUsage).length === 0 ? {} : {usage: parsedUsage}),
        latencyMs: Date.now() - started,
        stopReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop',
      };
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Model request was cancelled');
      if (timedOut) throw new ProtocolError('TIMEOUT', 'Model request timed out', true);
      throw new ProtocolError('EXTERNAL_FAILURE', 'Model request failed', true);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
    }
  }
}

function openAiError(status: number, retryAfter: string | null): ProtocolError {
  if (status === 401 || status === 403) return new ProtocolError('UNAUTHORIZED', 'Model endpoint authentication failed');
  if (status === 429) {
    // retry-after 按秒（OpenAI 惯例）；毫秒形式的数值一并容忍。
    const raw = retryAfter === null ? undefined : Number(retryAfter);
    const seconds = raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : undefined;
    const retryAfterMs = seconds !== undefined
      ? (seconds > 10_000 ? Math.round(seconds) : Math.round(seconds * 1000)) : undefined;
    return new ProtocolError('RATE_LIMITED', 'Model endpoint rate limit reached', true, retryAfterMs);
  }
  if (status >= 500) return new ProtocolError('EXTERNAL_FAILURE', `Model endpoint returned HTTP ${status}`, true);
  return new ProtocolError('EXTERNAL_FAILURE', `Model endpoint returned HTTP ${status}`, false);
}
