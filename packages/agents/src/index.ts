import { ProtocolError, PROTOCOL_VERSION } from '@personal-agent/contracts';
import type { Request, Response, TaskSnapshot, ToolDescriptor, RegisteredTool, ToolContext } from '@personal-agent/contracts';
import { validateToolArguments, validateToolProposal } from '@personal-agent/models';
import type { ModelGateway, ModelMessage, ModelResult, ToolProposal, ReasoningEffort } from '@personal-agent/models';

export interface AgentProgressInput {
  stepId: string;
  label: string;
  completedUnits?: number;
  totalUnits?: number;
}

/** Runtime-facing port owned by the Agent package, not a concrete Runtime type. */
export interface AgentWorkerContext {
  taskId: string;
  deadline: string;
  signal: AbortSignal;
  saveCheckpoint(key: string, value: unknown): void;
  loadCheckpoint(key: string): unknown;
  reportProgress(progress: AgentProgressInput): TaskSnapshot;
}

export interface AgentWorkerResult {
  resultSummary: string;
  evidenceRefs?: readonly string[];
}

export interface AgentToolInvocation {
  toolName: string;
  toolVersion: string;
  arguments: unknown;
  taskId: string;
  runId: string;
  authorizationRef: string;
  deadline: string;
  signal: AbortSignal;
  userPresent?: boolean;
}

export interface ToolInvocationResult {
  state: 'confirmed' | 'pending' | 'unknown';
  result?: unknown;
  evidenceRefs: readonly string[];
}

export interface AgentToolPort {
  list(): ToolDescriptor[];
  invoke(invocation: AgentToolInvocation): Promise<ToolInvocationResult>;
}

export interface AgentRuntimeRequestPort {
  send(input: Request, signal: AbortSignal): Promise<Response>;
}

let requestSequence = 0;

/** Uses the public Runtime request path, so unknown results can enter reconciliation. */
export class RuntimeToolInvoker implements AgentToolPort {
  constructor(
    private readonly runtime: AgentRuntimeRequestPort,
    private readonly descriptors: readonly ToolDescriptor[],
    private readonly requestIdFactory: () => string = () => `agent-tool-request-${++requestSequence}`,
  ) {}

  list(): ToolDescriptor[] { return this.descriptors.map(descriptor => structuredClone(descriptor)); }

  async invoke(invocation: AgentToolInvocation): Promise<ToolInvocationResult> {
    const request: Request = {
      kind: 'request', protocolVersion: PROTOCOL_VERSION, requestId: this.requestIdFactory(), taskId: invocation.taskId,
      idempotencyKey: invocation.runId,
      deadline: invocation.deadline, operation: 'tool.invoke',
      payload: {
        toolName: invocation.toolName, toolVersion: invocation.toolVersion,
        arguments: structuredClone(invocation.arguments) as Record<string, unknown>, scopeRef: invocation.authorizationRef,
      },
    };
    const response = await this.runtime.send(request, invocation.signal);
    if (response.outcome === 'error') throw new ProtocolError(response.error.code, response.error.message, response.error.retryable, response.error.retryAfterMs);
    const data = response.data as {state: 'confirmed' | 'pending' | 'unknown'; result?: unknown; evidenceRefs: string[]};
    return {
      state: data.state,
      ...(data.result === undefined ? {} : {result: structuredClone(data.result)}),
      evidenceRefs: [...data.evidenceRefs],
    };
  }
}

export interface AgentRunOptions {
  goal: string;
  initialMessages?: readonly ModelMessage[];
  model: ModelGateway;
  tools: AgentToolPort;
  /** 可选：宿主自有受信授权体系时覆盖；缺省用本次调用的 runId（真实网关的授权身份）。 */
  authorizationRefFor?: (toolName: string, context: AgentWorkerContext) => string | undefined;
  maxSteps: number;
  maxTokens?: number;
  maxRepairAttempts?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  thinkingBudget?: number;
  onUnknownResult?: (context: AgentWorkerContext, result: ToolInvocationResult) => void | Promise<void>;
}

export interface AgentOutcome {
  status: 'succeeded' | 'waiting_reconciliation' | 'waiting_approval';
  resultSummary: string;
  evidenceRefs: readonly string[];
  deployment: ModelResult['deployment'];
  usage?: ModelResult['usage'];
  steps: number;
}

function validateBounds(options: AgentRunOptions): void {
  if (!options.goal.trim()) throw new ProtocolError('INVALID_ARGUMENT', 'Agent goal must not be empty');
  if (!Number.isSafeInteger(options.maxSteps) || options.maxSteps < 1) throw new ProtocolError('INVALID_ARGUMENT', 'maxSteps must be a positive integer');
  if (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1)) throw new ProtocolError('INVALID_ARGUMENT', 'maxTokens must be a positive integer');
  if (options.maxRepairAttempts !== undefined && (!Number.isSafeInteger(options.maxRepairAttempts) || options.maxRepairAttempts < 0)) throw new ProtocolError('INVALID_ARGUMENT', 'maxRepairAttempts must be a non-negative integer');
}

function checkRuntime(context: AgentWorkerContext): void {
  if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Agent task was cancelled');
}

function estimateTokens(result: ModelResult): number {
  const reported = result.usage?.totalTokens ?? result.usage?.completionTokens;
  if (reported !== undefined) return Math.max(0, reported);
  return result.response.kind === 'final' ? Math.max(1, Math.ceil(result.response.text.length / 4)) : Math.max(1, Math.ceil(JSON.stringify(result.response.proposal).length / 4));
}

function proposalError(error: unknown): ProtocolError {
  if (error instanceof ProtocolError) return error;
  return new ProtocolError('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Invalid model tool proposal');
}

/** Exact producer errors only: provider authentication/policy/transport failures are not proposals. */
function isModelProposalValidationError(error: unknown): error is ProtocolError {
  if (!(error instanceof ProtocolError)) return false;
  if (error.code === 'UNAUTHORIZED') return error.message === 'Tool proposal contains fields outside the tool contract';
  if (error.code === 'UNSUPPORTED_CAPABILITY') return error.message === 'Model proposed an unavailable tool';
  return error.code === 'INVALID_ARGUMENT' && [
    'Model returned invalid proposal JSON', 'Model response must be an object',
    'Model returned an invalid structured response', 'Model response must be a final answer or tool proposal',
    'Tool proposal must be an object', 'Tool proposal has invalid fields',
    'toolName must not be empty', 'toolVersion must not be empty',
    'Message does not match the public schema',
  ].includes(error.message);
}

function withModelMetadata(deployment: ModelResult['deployment'], usage: ModelResult['usage'], text: string): string {
  const tokens = usage?.totalTokens === undefined ? 'unknown' : String(usage.totalTokens);
  return `${text} [model=${deployment.provider}/${deployment.deployment}/${deployment.model}; verification=${deployment.verification}; tokens=${tokens}]`;
}

async function complete(context: AgentWorkerContext, options: AgentRunOptions, messages: readonly ModelMessage[], remainingTokens?: number): Promise<ModelResult> {
  checkRuntime(context);
  return options.model.complete({
    messages,
    tools: options.tools.list(),
    ...(remainingTokens === undefined ? {} : {maxOutputTokens: remainingTokens}),
    ...(options.reasoningEffort !== undefined ? {reasoningEffort: options.reasoningEffort} : {}),
    ...(options.thinkingBudget !== undefined ? {thinkingBudget: options.thinkingBudget} : {}),
    deadline: context.deadline,
    signal: context.signal,
  });
}

export async function runAgent(context: AgentWorkerContext, options: AgentRunOptions): Promise<AgentOutcome> {
  validateBounds(options);
  const saved = context.loadCheckpoint('agent-loop') as {messages: ModelMessage[]; usedTokens: number; repairs: number; evidenceRefs: string[]; step: number; pending?: ModelResult} | undefined;
  let messages: ModelMessage[] = saved?.messages ?? [
    ...(options.initialMessages ?? []).map(message => structuredClone(message)),
    {role: 'user', content: options.goal},
  ];
  let usedTokens = saved?.usedTokens ?? 0;
  let repairs = saved?.repairs ?? 0;
  let evidenceRefs: string[] = saved?.evidenceRefs ?? [];
  let pending = saved?.pending;

  const repairProposal = (error: unknown, step: number, response?: ModelResult['response']): void => {
    repairs++;
    if (repairs > (options.maxRepairAttempts ?? 1)) throw proposalError(error);
    messages = [...messages,
      ...(response === undefined ? [] : [{role: 'assistant' as const, content: JSON.stringify(response)}]),
      {role: 'user', content: `The previous tool proposal was rejected: ${proposalError(error).message}. Return only one complete JSON object for a corrected proposal or final answer, without surrounding prose. A proposal must use exactly toolName, toolVersion and arguments.`},
    ];
    // Failed provider parsing supplies no trusted raw reply or usage: do not invent either.
    context.saveCheckpoint('agent-loop', {messages, usedTokens, repairs, evidenceRefs, step: step + 1});
  };

  for (let step = saved?.step ?? 1; step <= options.maxSteps; step++) {
    context.reportProgress({stepId: `agent-${step}`, label: 'model planning', completedUnits: step - 1, totalUnits: options.maxSteps});
    if (!pending && options.maxTokens !== undefined && usedTokens >= options.maxTokens) throw new ProtocolError('TIMEOUT', 'Agent token budget exhausted');
    let result: ModelResult;
    try {
      result = pending ?? await complete(context, options, messages, options.maxTokens === undefined ? undefined : options.maxTokens - usedTokens);
    } catch (error) {
      if (!isModelProposalValidationError(error)) throw error;
      // Parsing failed after provider generation, but its usage is unavailable here.
      // An explicit token budget cannot safely fund another call with unknown spend.
      if (options.maxTokens !== undefined) throw error;
      checkRuntime(context);
      repairProposal(error, step);
      continue;
    }
    if (!pending) usedTokens += estimateTokens(result);
    pending = undefined;
    if (options.maxTokens !== undefined && usedTokens > options.maxTokens) throw new ProtocolError('TIMEOUT', 'Agent token budget exhausted');

    if (result.response.kind === 'final') {
      context.reportProgress({stepId: `agent-${step}`, label: 'model answer ready', completedUnits: options.maxSteps, totalUnits: options.maxSteps});
      const outcome: AgentOutcome = {
        status: 'succeeded', resultSummary: withModelMetadata(result.deployment, result.usage, result.response.text), evidenceRefs,
        deployment: result.deployment, ...(result.usage === undefined ? {} : {usage: result.usage}), steps: step,
      };
      return outcome;
    }

    let proposal: ToolProposal;
    try {
      proposal = validateToolProposal(result.response.proposal);
      const descriptor = options.tools.list().find(item => item.name === proposal.toolName);
      if (!descriptor) throw new ProtocolError('UNSUPPORTED_CAPABILITY', `Tool ${proposal.toolName} is not registered`);
      if (descriptor.version !== proposal.toolVersion) throw new ProtocolError('PROTOCOL_MISMATCH', `Tool ${proposal.toolName} version ${proposal.toolVersion} is not available`);
      validateToolArguments(descriptor, proposal.arguments);
    } catch (error) {
      repairProposal(error, step, result.response);
      continue;
    }

    // 授权身份默认就是本次调用的 runId——与 RuntimeApplication.tools 的真实授权机制一致
    // （policy.grant 以 runId 为 authorizationRef 发放；无授予则进入审批流）。宿主不得
    // 凭格式自造授权前缀；仅在宿主确有自己的受信授权体系时经 authorizationRefFor 覆盖。
    const runId = `agent-run-${context.taskId}-${step}`;
    const authorizationRef = options.authorizationRefFor?.(proposal.toolName, context) ?? runId;
    if (!authorizationRef.trim()) throw new ProtocolError('UNAUTHORIZED', 'Trusted host did not provide an authorization reference');
    context.reportProgress({stepId: `agent-tool-${step}`, label: `calling ${proposal.toolName}`, completedUnits: step, totalUnits: options.maxSteps});
    context.saveCheckpoint('agent-loop', {messages, usedTokens, repairs, evidenceRefs, step, pending: result});
    const toolResult = await options.tools.invoke({
      toolName: proposal.toolName, toolVersion: proposal.toolVersion, arguments: structuredClone(proposal.arguments),
      taskId: context.taskId, runId, authorizationRef, deadline: context.deadline, signal: context.signal,
    });
    evidenceRefs = [...evidenceRefs, ...toolResult.evidenceRefs];
    if (toolResult.state === 'pending') {
      return {status: 'waiting_approval', resultSummary: 'Tool is awaiting approval', evidenceRefs, deployment: result.deployment, steps: step};
    }
    if (toolResult.state === 'unknown') {
      if (!options.onUnknownResult) throw new ProtocolError('RESULT_UNKNOWN', 'Tool result is unknown; reconciliation is required');
      await options.onUnknownResult(context, toolResult);
      return {status: 'waiting_reconciliation', resultSummary: 'Tool result is unknown; reconciliation is required before answering', evidenceRefs, deployment: result.deployment, ...(result.usage === undefined ? {} : {usage: result.usage}), steps: step};
    }
    messages = [...messages,
      {role: 'assistant', content: JSON.stringify(result.response)},
      {role: 'tool', content: JSON.stringify({toolName: proposal.toolName, state: toolResult.state, result: toolResult.result})},
    ];
    context.saveCheckpoint('agent-loop', {messages, usedTokens, repairs, evidenceRefs, step: step + 1});
  }
  throw new ProtocolError('TIMEOUT', `Agent reached maxSteps=${options.maxSteps} without a final answer`);
}

export function createAgentWorker(options: AgentRunOptions): (context: AgentWorkerContext) => Promise<AgentWorkerResult> {
  return async context => {
    const outcome = await runAgent(context, options);
    return {resultSummary: outcome.resultSummary, evidenceRefs: outcome.evidenceRefs};
  };
}

export type SubtaskRole = 'researcher' | 'coder' | 'reviewer' | 'planner' | 'coordinator';

export interface SubtaskDefinition {
  subtaskId: string;
  role: SubtaskRole;
  roleLabel?: string;
  goal: string;
  model?: string;
  /** Native provider control, independent of the 0-5 execution step budget. */
  reasoningEffort?: ReasoningEffort;
  thinkingDepth?: number;
}

export interface SubtaskProgress {
  subtaskId: string;
  role: SubtaskRole;
  roleLabel: string;
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
}

export interface SubtaskExecutionSummary {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  subtasks: readonly SubtaskProgress[];
  aggregatedSummary: string;
}

export const DEFAULT_ROLE_LABELS: Record<SubtaskRole, string> = {
  researcher: '资料检索与调研',
  coder: '代码与工程实现',
  reviewer: '质量与安全审查',
  planner: '规划与任务拆解',
  coordinator: '多智能体协作与汇总',
};

export interface SubtaskProgressRecord {
  parentTaskId: string;
  subtaskId: string;
  inputDigest: string;
  state: SubtaskProgress['state'];
  result?: string;
  error?: string;
}

export function computeSubtaskInputDigest(subtask: SubtaskDefinition): string {
  return JSON.stringify({
    subtaskId: subtask.subtaskId.trim(),
    role: subtask.role,
    goal: subtask.goal.trim(),
    ...(subtask.model ? {model: subtask.model.trim()} : {}),
    ...(subtask.reasoningEffort !== undefined ? {reasoningEffort:subtask.reasoningEffort} : {}),
    ...(subtask.thinkingDepth !== undefined ? {thinkingDepth: subtask.thinkingDepth} : {}),
  });
}

export async function dispatchSubtasks(
  context: AgentWorkerContext,
  subtasks: readonly SubtaskDefinition[],
  executor: (subtask: SubtaskDefinition, signal: AbortSignal) => Promise<string>,
): Promise<SubtaskExecutionSummary> {
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Subtasks must be a non-empty array');
  }

  const seenIds = new Set<string>();
  for (let i = 0; i < subtasks.length; i++) {
    const subtask = subtasks[i];
    if (!subtask.subtaskId?.trim()) throw new ProtocolError('INVALID_ARGUMENT', `Subtask ${i} missing subtaskId`);
    if (!subtask.goal?.trim()) throw new ProtocolError('INVALID_ARGUMENT', `Subtask ${subtask.subtaskId} missing goal`);
    if (seenIds.has(subtask.subtaskId.trim())) {
      throw new ProtocolError('INVALID_ARGUMENT', `Duplicate subtaskId: ${subtask.subtaskId}`);
    }
    seenIds.add(subtask.subtaskId.trim());
  }

  const progressList: SubtaskProgress[] = [];
  const checkpointKey = 'subtask-progress-records';
  const saved = context.loadCheckpoint(checkpointKey) as Record<string, SubtaskProgressRecord> | undefined;
  const progressMap = new Map<string, SubtaskProgressRecord>(
    saved ? Object.entries(saved) : [],
  );

  const total = subtasks.length;
  let completedCount = 0;

  for (let i = 0; i < subtasks.length; i++) {
    const subtask = subtasks[i];
    const roleLabel = subtask.roleLabel?.trim() || (DEFAULT_ROLE_LABELS as Record<string, string>)[subtask.role] || String(subtask.role);
    const inputDigest = computeSubtaskInputDigest(subtask);

    // Check if already finished in saved checkpoint
    const previous = progressMap.get(subtask.subtaskId);
    if (previous) {
      if (previous.parentTaskId && previous.parentTaskId !== context.taskId) {
        throw new ProtocolError('REVISION_CONFLICT', `Subtask ${subtask.subtaskId} belongs to parent task ${previous.parentTaskId}, not ${context.taskId}`);
      }
      if (previous.inputDigest && previous.inputDigest !== inputDigest) {
        throw new ProtocolError('REVISION_CONFLICT', `Subtask ${subtask.subtaskId} input changed from prior execution; cannot reuse old result`);
      }
      if (previous.state === 'succeeded' || previous.state === 'failed' || previous.state === 'cancelled') {
        progressList.push({
          subtaskId: subtask.subtaskId,
          role: subtask.role,
          roleLabel,
          state: previous.state,
          ...(previous.result !== undefined ? {result: previous.result} : {}),
          ...(previous.error !== undefined ? {error: previous.error} : {}),
        });
        completedCount++;
        continue;
      }
    }

    if (context.signal.aborted) {
      progressList.push({
        subtaskId: subtask.subtaskId,
        role: subtask.role,
        roleLabel,
        state: 'cancelled',
        error: 'Cancelled before execution',
      });
      progressMap.set(subtask.subtaskId, {
        parentTaskId: context.taskId,
        subtaskId: subtask.subtaskId,
        inputDigest,
        state: 'cancelled',
        error: 'Cancelled before execution',
      });
      context.saveCheckpoint(checkpointKey, Object.fromEntries(progressMap.entries()));
      continue;
    }

    context.reportProgress({
      stepId: `subtask-${subtask.subtaskId}`,
      label: `[${roleLabel}] 正在执行: ${subtask.goal}`,
      completedUnits: completedCount,
      totalUnits: total,
    });

    try {
      const result = await executor(subtask, context.signal);
      completedCount++;
      progressList.push({
        subtaskId: subtask.subtaskId,
        role: subtask.role,
        roleLabel,
        state: 'succeeded',
        result,
      });
      progressMap.set(subtask.subtaskId, {
        parentTaskId: context.taskId,
        subtaskId: subtask.subtaskId,
        inputDigest,
        state: 'succeeded',
        result,
      });
      context.reportProgress({
        stepId: `subtask-${subtask.subtaskId}`,
        label: `[${roleLabel}] 执行完成: ${subtask.goal}`,
        completedUnits: completedCount,
        totalUnits: total,
      });
    } catch (err) {
      if (context.signal.aborted) {
        progressList.push({
          subtaskId: subtask.subtaskId,
          role: subtask.role,
          roleLabel,
          state: 'cancelled',
          error: err instanceof Error ? err.message : 'Cancelled',
        });
        progressMap.set(subtask.subtaskId, {
          parentTaskId: context.taskId,
          subtaskId: subtask.subtaskId,
          inputDigest,
          state: 'cancelled',
          error: err instanceof Error ? err.message : 'Cancelled',
        });
      } else {
        completedCount++;
        progressList.push({
          subtaskId: subtask.subtaskId,
          role: subtask.role,
          roleLabel,
          state: 'failed',
          error: err instanceof Error ? err.message : 'Subtask execution failed',
        });
        progressMap.set(subtask.subtaskId, {
          parentTaskId: context.taskId,
          subtaskId: subtask.subtaskId,
          inputDigest,
          state: 'failed',
          error: err instanceof Error ? err.message : 'Subtask execution failed',
        });
        context.reportProgress({
          stepId: `subtask-${subtask.subtaskId}`,
          label: `[${roleLabel}] 执行失败: ${err instanceof Error ? err.message : '执行失败'}`,
          completedUnits: completedCount,
          totalUnits: total,
        });
      }
    }
    context.saveCheckpoint(checkpointKey, Object.fromEntries(progressMap.entries()));
  }

  const succeeded = progressList.filter(p => p.state === 'succeeded').length;
  const failed = progressList.filter(p => p.state === 'failed').length;
  const cancelled = progressList.filter(p => p.state === 'cancelled').length;

  const sections = progressList.map(p => {
    if (p.state === 'succeeded') {
      return `### 【${p.roleLabel}】(${p.role})\n${p.result?.trim() ?? '无输出'}`;
    }
    if (p.state === 'cancelled') {
      return `### 【${p.roleLabel}】(${p.role}) · 已取消\n${p.error ?? '任务已取消'}`;
    }
    return `### 【${p.roleLabel}】(${p.role}) · 失败\n${p.error ?? '执行失败'}`;
  });

  const aggregatedSummary = `## 次级智能体协作汇总（共 ${total} 项：成功 ${succeeded}，失败 ${failed}，取消 ${cancelled}）\n\n${sections.join('\n\n')}`;

  return {
    total,
    succeeded,
    failed,
    cancelled,
    subtasks: progressList,
    aggregatedSummary,
  };
}

export const SUBAGENT_DISPATCH_TOOL_NAME = 'subagent.dispatch';
export const SUBAGENT_DISPATCH_TOOL_VERSION = '1.0.0';

export function createSubagentDispatchTool(
  handler: (input: {subtasks: readonly SubtaskDefinition[]}, context: ToolContext) => Promise<unknown>,
): RegisteredTool {
  if (typeof handler !== 'function') {
    throw new ProtocolError('INVALID_ARGUMENT', 'Subagent dispatch handler is required');
  }
  return {
    descriptor: {
      name: SUBAGENT_DISPATCH_TOOL_NAME,
      version: SUBAGENT_DISPATCH_TOOL_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                subtaskId: {type: 'string', minLength: 1},
                role: {type: 'string', enum: ['researcher', 'coder', 'reviewer', 'planner', 'coordinator']},
                roleLabel: {type: 'string'},
                goal: {type: 'string', minLength: 1},
                model: {type: 'string'},
                reasoningEffort: {type:'string',enum:['none','minimal','low','medium','high','xhigh','max']},
                thinkingDepth: {type: 'integer', minimum: 0, maximum: 5},
              },
              required: ['subtaskId', 'role', 'goal'],
              additionalProperties: false,
            },
            minItems: 1,
          },
        },
        required: ['subtasks'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          total: {type: 'integer'},
          succeeded: {type: 'integer'},
          failed: {type: 'integer'},
          cancelled: {type: 'integer'},
          summary: {type: 'string'},
        },
        required: ['total', 'succeeded', 'failed', 'cancelled', 'summary'],
        additionalProperties: true,
      },
      sideEffect: 'read',
      requiredScopes: ['agent:delegate'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (rawInput, context) => {
      const input = rawInput as {subtasks: readonly SubtaskDefinition[]};
      return handler(input, context);
    },
  };
}

