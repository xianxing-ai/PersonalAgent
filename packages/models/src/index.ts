import { ProtocolError, validateToolValue } from '@personal-agent/contracts';
import type { ToolDescriptor } from '@personal-agent/contracts';
export {StructuredToolProvider} from './structured-tools.js';
export {QwenRealtimeModelGateway} from './realtime.js';
export type {RealtimeEvent, RealtimeRequest, RealtimeSession, RealtimeSocket,
  RealtimeSocketConstructor, RealtimeConnectionPort, RealtimePreparedConnection, QwenRealtimeDirectConfig} from './realtime.js';
export {AgentArtsRealtimeModelGateway, createAgentArtsRealtimeConnection} from './agentarts-realtime.js';
export type {AgentArtsRealtimeModelGatewayOptions, RealtimeAuthorizationProvider} from './agentarts-realtime.js';
export {OpenAICompatibleModelProvider} from './openai-compatible.js';
export type {OpenAICompatibleModelProviderOptions} from './openai-compatible.js';

export type ModelCapability = 'text' | 'streaming' | 'toolCalling' | 'structuredOutput' | 'vision';
export type Verification = 'mock' | 'verified' | 'conditional';
export type OpenAICompatibleRequestFormat = 'huawei-maas-deepseek-thinking-v1';

export interface ModelCapabilities {
  text: boolean;
  streaming: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  vision: boolean;
  contextLimit?: number;
  rateLimit?: {requestsPerMinute?: number; tokensPerMinute?: number};
  /** Trusted endpoint declaration; not proof of real native support. */
  nativeReasoning?: NativeReasoningConfiguration;
  /** Trusted visible-request budget binding; not a verified tokenizer declaration. */
  requestTokenBudget?: RequestTokenBudgetBinding;
  /** Explicit trusted-host wire format, applied before visible-request measurement. */
  requestFormat?: OpenAICompatibleRequestFormat;
}

export interface ModelDeployment {
  provider: string;
  deployment: string;
  model: string;
  verification: Verification;
  capabilities: ModelCapabilities;
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ToolProposal {
  toolName: string;
  toolVersion: string;
  arguments: Record<string, unknown>;
}

export type ModelResponse =
  | {kind: 'final'; text: string}
  | {kind: 'tool_proposal'; proposal: ToolProposal};

export interface ModelUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface NativeReasoningConfiguration {
  thinking: 'enabled' | 'disabled';
  effort?: ReasoningEffort;
  supportedEfforts: readonly ReasoningEffort[];
  outputTokenParameter: 'max_tokens' | 'max_completion_tokens';
}

export interface RequestTokenBudgetBinding {
  scope: 'provider-body';
  model: string;
  tokenizerRef: string;
  configurationRef: string;
  contextTokens: number;
  reservedOutputTokens: number;
  requestFormat?: OpenAICompatibleRequestFormat;
}

export interface VisibleRequestTokenBudget {
  model: string;
  tokenizerRef: string;
  configurationRef: string;
  reservedOutputTokens: number;
  /** Count model input, including its framing, from the complete serialized provider body. */
  countInputTokens(serializedBody: string): number;
}

export type ModelRequestBudget =
  | {state: 'unmeasured'; scope: 'provider-body'; hiddenContext: 'unknown'}
  | (RequestTokenBudgetBinding & {state: 'measured'; inputTokens: number; hiddenContext: 'unknown'});

export interface ModelRequest {
  messages: readonly ModelMessage[];
  tools: readonly ToolDescriptor[];
  requiredCapabilities?: readonly ModelCapability[];
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  thinkingBudget?: number;
  deadline: string;
  signal: AbortSignal;
}

export interface ModelResult {
  response: ModelResponse;
  deployment: ModelDeployment;
  usage?: ModelUsage;
  latencyMs: number;
  stopReason: string;
  requestBudget?: ModelRequestBudget;
}

export interface ModelProvider {
  readonly deployment: ModelDeployment;
  complete(request: ModelRequest): Promise<ModelResult>;
}

export type ModelPort = ModelProvider;

const allCapabilities = (): ModelCapabilities => ({
  text: true, streaming: false, toolCalling: true, structuredOutput: true, vision: false, contextLimit: 32_000,
});

const unavailableCapabilities = (): ModelCapabilities => ({
  text: false, streaming: false, toolCalling: false, structuredOutput: false, vision: false,
});

function requiredText(value: string, field: string): string {
  const result = value.trim();
  if (!result) throw new ProtocolError('INVALID_ARGUMENT', `${field} must not be empty`);
  return result;
}

function validateRequest(request: ModelRequest): void {
  if (request.maxOutputTokens !== undefined && (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'maxOutputTokens must be a positive integer');
  }
  if (request.reasoningEffort !== undefined && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(request.reasoningEffort)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'reasoningEffort is invalid');
  }
  if (request.thinkingBudget !== undefined && (!Number.isSafeInteger(request.thinkingBudget) || request.thinkingBudget < 0)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'thinkingBudget must be a non-negative integer');
  }
  if (!Number.isFinite(Date.parse(request.deadline))) throw new ProtocolError('INVALID_ARGUMENT', 'deadline must be an ISO timestamp');
  if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Model request was cancelled');
}

function supports(capabilities: ModelCapabilities, capability: ModelCapability): boolean {
  if (capability === 'text') return capabilities.text;
  if (capability === 'streaming') return capabilities.streaming;
  if (capability === 'toolCalling') return capabilities.toolCalling;
  if (capability === 'structuredOutput') return capabilities.structuredOutput;
  return capabilities.vision;
}

function validateResponse(response: ModelResponse): void {
  if (!response || typeof response !== 'object') throw new ProtocolError('INVALID_ARGUMENT', 'Model response must be an object');
  if (response.kind === 'final') {
    requiredText(response.text, 'model response text');
    return;
  }
  if (response.kind !== 'tool_proposal' || !response.proposal || typeof response.proposal !== 'object') {
    throw new ProtocolError('INVALID_ARGUMENT', 'Model response must be a final answer or tool proposal');
  }
}

export interface ModelCapabilityProbe {
  probe(provider: ModelProvider): Promise<ModelCapabilities>;
}

export class DeclaredCapabilityProbe implements ModelCapabilityProbe {
  async probe(provider: ModelProvider): Promise<ModelCapabilities> {
    return structuredClone(provider.deployment.capabilities);
  }
}

export class ModelCapabilityRegistry {
  private readonly deployments = new Map<string, ModelDeployment>();

  async probe(provider: ModelProvider, capabilityProbe: ModelCapabilityProbe = new DeclaredCapabilityProbe()): Promise<ModelDeployment> {
    const deployment = {...provider.deployment, capabilities: await capabilityProbe.probe(provider)};
    const key = `${deployment.provider}/${deployment.deployment}/${deployment.model}`;
    this.deployments.set(key, structuredClone(deployment));
    return structuredClone(deployment);
  }

  get(provider: string, deployment: string, model: string): ModelDeployment | undefined {
    const value = this.deployments.get(`${provider}/${deployment}/${model}`);
    return value ? structuredClone(value) : undefined;
  }
}

export class ModelGateway implements ModelPort {
  readonly deployment: ModelDeployment;

  constructor(private readonly provider: ModelProvider, deployment: ModelDeployment = provider.deployment) {
    this.deployment = structuredClone(deployment);
  }

  static async fromProvider(provider: ModelProvider, capabilityProbe: ModelCapabilityProbe = new DeclaredCapabilityProbe()): Promise<ModelGateway> {
    const capabilities = await capabilityProbe.probe(provider);
    return new ModelGateway(provider, {...provider.deployment, capabilities});
  }

  async complete(request: ModelRequest): Promise<ModelResult> {
    validateRequest(request);
    const required = new Set<ModelCapability>(request.requiredCapabilities ?? ['text']);
    if (request.tools.length > 0) {
      required.add('toolCalling');
      required.add('structuredOutput');
    }
    for (const capability of required) {
      if (!supports(this.deployment.capabilities, capability)) {
        throw new ProtocolError('UNSUPPORTED_CAPABILITY', `${this.deployment.provider}/${this.deployment.model} does not support ${capability}`);
      }
    }
    const remaining = Date.parse(request.deadline) - Date.now();
    if (remaining <= 0) throw new ProtocolError('TIMEOUT', 'Model request deadline expired');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = (): void => {};
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => { controller.abort(); reject(new ProtocolError('CANCELLED', 'Model request was cancelled')); };
      request.signal.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => { controller.abort(); reject(new ProtocolError('TIMEOUT', 'Model request deadline expired')); }, Math.min(remaining, 2_147_483_647));
      if (request.signal.aborted) abort();
    });
    let result: ModelResult;
    try {
      result = await Promise.race([this.provider.complete({...request, signal: controller.signal, tools: structuredClone(request.tools)}), interrupted]);
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      throw new ProtocolError('EXTERNAL_FAILURE', 'Model provider request failed');
    } finally {
      if (timer) clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
    }
    validateResponse(result.response);
    if (result.deployment.provider !== this.deployment.provider || result.deployment.deployment !== this.deployment.deployment || result.deployment.model !== this.deployment.model) {
      throw new ProtocolError('EXTERNAL_FAILURE', 'Model provider returned a different deployment identity');
    }
    if (!Number.isFinite(result.latencyMs) || result.latencyMs < 0) throw new ProtocolError('EXTERNAL_FAILURE', 'Model provider returned an invalid latency');
    for (const count of Object.values(result.usage ?? {})) {
      if (!Number.isSafeInteger(count) || count < 0) throw new ProtocolError('EXTERNAL_FAILURE', 'Model provider returned invalid usage');
    }
    return structuredClone(result);
  }
}

export class FakeModelProvider implements ModelProvider {
  readonly deployment: ModelDeployment;
  private cursor = 0;
  private readonly seenRequests: ModelRequest[] = [];

  constructor(
    private readonly steps: readonly (ModelResponse | ((request: ModelRequest) => ModelResponse | Promise<ModelResponse>))[],
    deployment: Partial<ModelDeployment> = {},
  ) {
    this.deployment = {
      provider: deployment.provider ?? 'fake', deployment: deployment.deployment ?? 'fake-deployment', model: deployment.model ?? 'fake-model',
      verification: deployment.verification ?? 'mock', capabilities: deployment.capabilities ?? allCapabilities(),
    };
  }

  get requests(): readonly ModelRequest[] { return this.seenRequests; }

  static async fromProvider(provider: ModelProvider, capabilityProbe: ModelCapabilityProbe = new DeclaredCapabilityProbe()): Promise<ModelGateway> {
    const capabilities = await capabilityProbe.probe(provider);
    return new ModelGateway(provider, {...provider.deployment, capabilities});
  }

  async complete(request: ModelRequest): Promise<ModelResult> {
    validateRequest(request);
    this.seenRequests.push({...request, messages: request.messages.map(message => ({...message})), tools: request.tools.map(tool => structuredClone(tool))});
    const step = this.steps[this.cursor++];
    if (!step) throw new ProtocolError('EXTERNAL_FAILURE', 'Fake model has no response step remaining');
    const response = typeof step === 'function' ? await step(request) : step;
    validateResponse(response);
    return {response: structuredClone(response), deployment: structuredClone(this.deployment), usage: {promptTokens: 1, completionTokens: 1, totalTokens: 2}, latencyMs: 0, stopReason: 'fixture'};
  }
}

export class UnavailableModelProvider implements ModelProvider {
  readonly deployment: ModelDeployment;

  constructor(provider = 'unavailable', model = 'not-configured') {
    this.deployment = {provider, deployment: 'not-configured', model, verification: 'conditional', capabilities: unavailableCapabilities()};
  }

  async complete(_request: ModelRequest): Promise<ModelResult> {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', `${this.deployment.provider} model provider is not configured`);
  }
}

export interface PanguModelProviderOptions {
  baseUrl: string;
  model: string;
  deployment?: string;
  apiKey: () => string | Promise<string>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

function panguCapabilities(): ModelCapabilities {
  return {text: true, streaming: false, toolCalling: false, structuredOutput: false, vision: false};
}

function panguText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ProtocolError('EXTERNAL_FAILURE', `Pangu response is missing ${field}`);
  return value;
}

function panguError(status: number, retryAfter: string | null): ProtocolError {
  if (status === 401 || status === 403) return new ProtocolError('UNAUTHORIZED', 'Pangu authentication failed');
  if (status === 429) {
    const seconds = retryAfter === null ? undefined : Number(retryAfter);
    const retryAfterMs = seconds !== undefined && Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : undefined;
    return new ProtocolError('RATE_LIMITED', 'Pangu rate limit exceeded', true, retryAfterMs);
  }
  return new ProtocolError('EXTERNAL_FAILURE', `Pangu request failed with HTTP ${status}`, status === 408 || status >= 500);
}

/**
 * Resolve the chat-completions path without making callers duplicate provider
 * URL knowledge.  The original Pangu endpoint is rooted at the host and uses
 * `/api/v2/chat/completions`; ModelArts MaaS exposes the OpenAI-compatible
 * surface under an endpoint such as `/openai/v1`, where the endpoint already
 * contains the version prefix and only `/chat/completions` should be added.
 */
function panguCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  let pathname = '';
  try { pathname = new URL(normalized).pathname.replace(/\/+$/, '').toLowerCase(); } catch { /* constructor validates the URL */ }
  if (pathname.endsWith('/openai/v1') || pathname.endsWith('/api/v2') || pathname.endsWith('/v1')) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/api/v2/chat/completions`;
}

/** Pangu V2 OpenAI-format text provider. Credentials are supplied by the trusted host. */
export class PanguModelProvider implements ModelProvider {
  readonly deployment: ModelDeployment;
  private readonly request: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly deploymentName: string;
  private readonly apiKey: () => string | Promise<string>;
  private readonly timeoutMs: number;

  constructor(options: PanguModelProviderOptions) {
    this.baseUrl = requiredText(options.baseUrl, 'baseUrl').replace(/\/+$/, '');
    this.model = requiredText(options.model, 'model');
    this.deploymentName = requiredText(options.deployment ?? options.model, 'deployment');
    if (typeof options.apiKey !== 'function') throw new ProtocolError('INVALID_ARGUMENT', 'apiKey provider is required');
    this.apiKey = options.apiKey;
    this.request = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!this.request) throw new ProtocolError('INVALID_ARGUMENT', 'fetch is required for Pangu provider');
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) throw new ProtocolError('INVALID_ARGUMENT', 'timeoutMs must be a positive integer');
    this.deployment = {provider: 'pangu', deployment: this.deploymentName, model: this.model, verification: 'conditional', capabilities: panguCapabilities()};
  }

  async complete(request: ModelRequest): Promise<ModelResult> {
    validateRequest(request);
    if (request.tools.length > 0 || request.requiredCapabilities?.some(capability => capability !== 'text')) {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Pangu provider currently supports text completion only');
    }
    const messages = request.messages.map(message => {
      if (message.role === 'tool') throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Pangu text provider does not accept tool messages');
      return {role: message.role, content: message.content};
    });
    const key = await this.apiKey();
    if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Model request was cancelled');
    if (!key || !key.trim()) throw new ProtocolError('UNAUTHORIZED', 'Pangu API key is not configured');
    const deadlineMs = Date.parse(request.deadline) - Date.now();
    if (deadlineMs <= 0) throw new ProtocolError('TIMEOUT', 'Pangu request deadline has expired', true);
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort('Pangu request timed out'); }, Math.min(this.timeoutMs, deadlineMs));
    request.signal.addEventListener('abort', abort, {once: true});
    const started = Date.now();
    try {
      const response = await this.request(panguCompletionsUrl(this.baseUrl), {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${key}`},
        body: JSON.stringify({
          model: this.model,
          messages,
          ...(request.maxOutputTokens === undefined ? {} : {max_tokens: request.maxOutputTokens}),
          ...(request.reasoningEffort !== undefined ? {reasoning_effort: request.reasoningEffort} : {}),
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw panguError(response.status, response.headers.get('retry-after'));
      let body: unknown;
      try { body = await response.json(); } catch { throw new ProtocolError('EXTERNAL_FAILURE', 'Pangu returned invalid JSON'); }
      if (!body || typeof body !== 'object') throw new ProtocolError('EXTERNAL_FAILURE', 'Pangu returned an invalid response');
      const record = body as Record<string, unknown>;
      const choices = record.choices;
      if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') throw new ProtocolError('EXTERNAL_FAILURE', 'Pangu response is missing choices');
      const choice = choices[0] as Record<string, unknown>;
      const message = choice.message;
      if (!message || typeof message !== 'object') throw new ProtocolError('EXTERNAL_FAILURE', 'Pangu response is missing message');
      const text = panguText((message as Record<string, unknown>).content, 'message content');
      const usageValue = record.usage;
      const usage = usageValue && typeof usageValue === 'object' ? usageValue as Record<string, unknown> : undefined;
      const toCount = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
      const promptTokens = toCount(usage?.prompt_tokens);
      const completionTokens = toCount(usage?.completion_tokens);
      const totalTokens = toCount(usage?.total_tokens);
      const parsedUsage: ModelUsage = {
        ...(promptTokens === undefined ? {} : {promptTokens}),
        ...(completionTokens === undefined ? {} : {completionTokens}),
        ...(totalTokens === undefined ? {} : {totalTokens}),
      };
      return {
        response: {kind: 'final', text}, deployment: structuredClone(this.deployment),
        ...(Object.keys(parsedUsage).length === 0 ? {} : {usage: parsedUsage}),
        latencyMs: Date.now() - started, stopReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop',
      };
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Model request was cancelled');
      if (timedOut) throw new ProtocolError('TIMEOUT', 'Pangu request timed out', true);
      throw new ProtocolError('EXTERNAL_FAILURE', 'Pangu request failed', true);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
    }
  }
}

export function validateToolProposal(value: unknown): ToolProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProtocolError('INVALID_ARGUMENT', 'Tool proposal must be an object');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'arguments,toolName,toolVersion') throw new ProtocolError('UNAUTHORIZED', 'Tool proposal contains fields outside the tool contract');
  const args = record.arguments;
  if (typeof record.toolName !== 'string' || typeof record.toolVersion !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Tool proposal has invalid fields');
  }
  return {toolName: requiredText(record.toolName, 'toolName'), toolVersion: requiredText(record.toolVersion, 'toolVersion'), arguments: structuredClone(args as Record<string, unknown>)};
}

export function validateToolArguments(descriptor: ToolDescriptor, value: unknown): void {
  validateToolValue(descriptor.inputSchema, value);
}
