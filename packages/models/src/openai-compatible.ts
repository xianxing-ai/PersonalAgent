import {ProtocolError} from '@personal-agent/contracts';
import {snapshotModelImages} from './index.js';
import type {ModelCapabilities, ModelDeployment, ModelMessage, ModelProvider, ModelRequest, ModelResult, ModelUsage, NativeReasoningConfiguration, VisibleRequestTokenBudget, RequestTokenBudgetBinding, ModelRequestBudget, OpenAICompatibleRequestFormat} from './index.js';

/**
 * OpenAI 兼容文本 Provider（POST {baseUrl}/chat/completions）。POTATOS-MVP §9.3「约定供应者」：
 * 适用任何 OpenAI Chat Completions 兼容端点（DeepSeek/智谱/Moonshot/vLLM 等），baseUrl 需含
 * 版本段（如 `https://api.deepseek.com/v1`）。默认文本补全，受信 vision:true 可启用 PNG；工具调用经现有
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
  /** Trusted Competition input meter; requires explicit contextLimitTokens. */
  requestTokenBudget?: VisibleRequestTokenBudget;
  /** Competition host selection; no endpoint/model-name inference in the Provider. */
  requestFormat?: OpenAICompatibleRequestFormat;
  /** Trusted JSON-only role output; does not imply native tools or JSON Schema support. */
  responseFormat?: 'json_object';
  /** Trusted declaration of PNG image_url content support; default false, conditional until verified. */
  vision?: boolean;
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

function openAiCompatibleCapabilities(contextLimitTokens: number, vision: boolean): ModelCapabilities {
  return {text: true, streaming: false, toolCalling: false, structuredOutput: false, vision, contextLimit: contextLimitTokens};
}

export class OpenAICompatibleModelProvider implements ModelProvider {
  readonly deployment: ModelDeployment;
  private readonly request: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: () => string | Promise<string>;
  private readonly timeoutMs: number;
  private readonly nativeReasoning: NativeReasoningConfiguration | undefined;
  private readonly requestFormat: OpenAICompatibleRequestFormat | undefined;
  private readonly responseFormat: 'json_object' | undefined;
  private readonly vision: boolean;
  private readonly tokenBudget: (RequestTokenBudgetBinding & {countInputTokens: VisibleRequestTokenBudget['countInputTokens']}) | undefined;

  constructor(options: OpenAICompatibleModelProviderOptions) {
    if (options.vision !== undefined && typeof options.vision !== 'boolean') {
      throw new ProtocolError('INVALID_ARGUMENT', 'Model vision declaration must be boolean');
    }
    this.vision = options.vision ?? false;
    if (options.responseFormat !== undefined && options.responseFormat !== 'json_object') {
      throw new ProtocolError('INVALID_ARGUMENT', 'Model response format is unsupported');
    }
    this.responseFormat = options.responseFormat;
    if (options.requestFormat !== undefined && options.requestFormat !== 'huawei-maas-deepseek-thinking-v1') {
      throw new ProtocolError('INVALID_ARGUMENT', 'Model request format is unsupported');
    }
    this.requestFormat = options.requestFormat;
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
    const budget = options.requestTokenBudget;
    if (budget !== undefined) {
      if (!budget || budget.model !== this.model || options.contextLimitTokens === undefined
        || typeof budget.tokenizerRef !== 'string' || typeof budget.configurationRef !== 'string'
        || !/^[a-zA-Z0-9._:/-]{1,256}$/.test(budget.tokenizerRef)
        || !/^[a-zA-Z0-9._:/-]{1,256}$/.test(budget.configurationRef)
        || !Number.isSafeInteger(budget.reservedOutputTokens) || budget.reservedOutputTokens < 1
        || budget.reservedOutputTokens > contextLimitTokens || typeof budget.countInputTokens !== 'function') {
        throw new ProtocolError('INVALID_ARGUMENT', 'Visible model request budget is invalid');
      }
      this.tokenBudget = {scope: 'provider-body', model: this.model, tokenizerRef: budget.tokenizerRef,
        configurationRef: budget.configurationRef, contextTokens: contextLimitTokens,
        ...(this.requestFormat === undefined ? {} : {requestFormat: this.requestFormat}),
        reservedOutputTokens: budget.reservedOutputTokens, countInputTokens: budget.countInputTokens};
    }
    this.deployment = {
      provider: 'openai-compatible',
      deployment: typeof options.deployment === 'string' && options.deployment.trim() ? options.deployment.trim() : this.model,
      model: this.model,
      verification: 'conditional',
      capabilities: {...openAiCompatibleCapabilities(contextLimitTokens, this.vision),
        ...(this.requestFormat === undefined ? {} : {requestFormat: this.requestFormat}),
        ...(this.tokenBudget === undefined ? {} : {requestTokenBudget: this.budgetBinding()}),
        ...(this.nativeReasoning === undefined ? {} : {nativeReasoning: structuredClone(this.nativeReasoning)})},
    };
  }

  private budgetBinding(): RequestTokenBudgetBinding {
    const {countInputTokens: _count, ...binding} = this.tokenBudget!;
    return binding;
  }

  private measureBudget(body: string, outputTokens: number | undefined): ModelRequestBudget {
    if (!this.tokenBudget) return {state: 'unmeasured', scope: 'provider-body', hiddenContext: 'unknown'};
    let count: unknown;
    const meter = this.tokenBudget.countInputTokens;
    try {count = meter(body);}
    catch {throw new ProtocolError('INVALID_ARGUMENT', 'Visible model request measurement failed');}
    if (count instanceof Promise) void count.catch(() => {});
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Visible model request meter must return a synchronous non-negative integer');
    }
    if (outputTokens! > this.tokenBudget.reservedOutputTokens
      || count > this.tokenBudget.contextTokens - outputTokens!) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Visible model input and output reservation exceed the budget');
    }
    return {...this.budgetBinding(), reservedOutputTokens: outputTokens!, state: 'measured', inputTokens: count, hiddenContext: 'unknown'};
  }

  async complete(request: ModelRequest): Promise<ModelResult> {
    if (!request || !(request.signal instanceof AbortSignal) || !Number.isFinite(Date.parse(request.deadline))) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Model request is invalid');
    }
    request = {...request, messages: request.messages.map(message => ({...message})),
      tools: [...request.tools],
      ...(request.requiredCapabilities === undefined ? {} : {requiredCapabilities: [...request.requiredCapabilities]}),
      ...(request.images === undefined ? {} : {images: snapshotModelImages(request.images)!})};
    if (request.images?.length && !this.vision) {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Model endpoint is not configured for vision');
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
    if (request.tools.length > 0 || request.requiredCapabilities?.some(capability => capability !== 'text' && !(capability === 'vision' && this.vision))) {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY',
        'OpenAI-compatible provider capability is unsupported; compose StructuredToolProvider for tool calling');
    }
    type ContentPart = {type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string}};
    const messages: {role: string; content: string | ContentPart[]}[] = [];
    for (const message of request.messages) {
      if (message.role === 'tool') {
        throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Text provider does not accept tool messages; route them through StructuredToolProvider');
      }
      const content = typeof message.content === 'string' ? message.content : '';
      if (!content.trim()) throw new ProtocolError('INVALID_ARGUMENT', 'Model message content must not be empty');
      messages.push({role: message.role, content});
    }
    if (request.images?.length) {
      const target = messages.findLast(message => message.role === 'user');
      if (!target) throw new ProtocolError('INVALID_ARGUMENT', 'Model images require a user message');
      target.content = [{type: 'text', text: target.content as string},
        ...request.images.map(image => ({type: 'image_url' as const, image_url: {url: `data:image/png;base64,${image.dataBase64}`}}))];
    }
    if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Model request was cancelled');
    if (Date.parse(request.deadline) <= Date.now()) throw new ProtocolError('TIMEOUT', 'Model request deadline has expired', true);
    const outputTokens = request.maxOutputTokens ?? this.tokenBudget?.reservedOutputTokens;
    const serializedBody = JSON.stringify({
      model: this.model, messages,
      ...(this.responseFormat === undefined ? {} : {response_format: {type: this.responseFormat}}),
      ...(native === undefined ? {} : {thinking: {type: native.thinking}}),
      ...(outputTokens === undefined ? {} : {[native?.outputTokenParameter ?? 'max_tokens']: outputTokens}),
      ...(this.requestFormat === 'huawei-maas-deepseek-thinking-v1' && effort === 'none'
        ? {chat_template_kwargs: {thinking: false}}
        : effort === undefined ? {} : {reasoning_effort: effort}), stream: false,
    });
    const requestBudget = this.measureBudget(serializedBody, outputTokens);
    const deadlineMs = Date.parse(request.deadline) - Date.now();
    if (deadlineMs <= 0) throw new ProtocolError('TIMEOUT', 'Model request deadline has expired', true);
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort('Model request timed out'); }, Math.min(this.timeoutMs, deadlineMs));
    request.signal.addEventListener('abort', abort, {once: true});
    if (request.signal.aborted) abort();
    const started = Date.now();
    let removeInterruptAbort = () => {};
    try {
      const interrupted = new Promise<never>((_, reject) => {
        const fail = () => reject(new ProtocolError(timedOut ? 'TIMEOUT' : 'CANCELLED',
          timedOut ? 'Model request timed out' : 'Model request was cancelled'));
        controller.signal.addEventListener('abort', fail, {once: true});
        removeInterruptAbort = () => controller.signal.removeEventListener('abort', fail);
        if (controller.signal.aborted) fail();
      });
      if (controller.signal.aborted) await interrupted;
      const key = await Promise.race([Promise.resolve().then(() => this.apiKey()), interrupted]);
      if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Model request was cancelled');
      if (!key || !key.trim()) throw new ProtocolError('UNAUTHORIZED', 'Model API key is not configured');
      if (JSON.stringify(this.measureBudget(serializedBody, outputTokens)) !== JSON.stringify(requestBudget)) {
        throw new ProtocolError('REVISION_CONFLICT', 'Visible model request measurement changed during credential acquisition');
      }
      if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Model request was cancelled');
      if (controller.signal.aborted || Date.parse(request.deadline) <= Date.now()) {
        throw new ProtocolError('TIMEOUT', 'Model request deadline has expired', true);
      }
      // A trusted injected guarded fetch must recheck the exact export lease immediately before network I/O.
      const response = await Promise.race([this.request(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${key}`},
        body: serializedBody,
        signal: controller.signal,
      }), interrupted]);
      if (!response.ok) throw openAiError(response.status, response.headers.get('retry-after'));
      let body: unknown;
      try { body = await Promise.race([response.json(), interrupted]); }
      catch (error) {
        if (error instanceof ProtocolError) throw error;
        throw new ProtocolError('EXTERNAL_FAILURE', 'Model endpoint returned invalid JSON');
      }
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
        requestBudget,
      };
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Model request was cancelled');
      if (timedOut) throw new ProtocolError('TIMEOUT', 'Model request timed out', true);
      throw new ProtocolError('EXTERNAL_FAILURE', 'Model request failed', true);
    } finally {
      removeInterruptAbort();
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
