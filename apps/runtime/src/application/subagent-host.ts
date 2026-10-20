import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, TaskSnapshot, ToolContext, ToolDescriptor} from '@personal-agent/contracts';
import {
  createSubagentDispatchTool,
  dispatchSubtasks,
  DEFAULT_ROLE_LABELS,
  computeSubtaskInputDigest,
  SUBAGENT_DISPATCH_TOOL_NAME,
  SUBAGENT_DISPATCH_TOOL_VERSION,
  type AgentWorkerContext,
  type AgentToolPort,
  type SubtaskDefinition,
  type SubtaskExecutionSummary,
  type SubtaskProgress,
  type SubtaskProgressRecord,
} from '@personal-agent/agents';
import {runAgent} from '@personal-agent/agents';
import {CLOUD_SKILL_TOOL_NAME} from '@personal-agent/skills';
import {parseExecutionModelSelection} from '@personal-agent/coordination';
import {
  ModelGateway,
  FakeModelProvider,
  PanguModelProvider,
  type ModelMessage,
  type ModelRequest,
  type PanguModelProviderOptions,
  type ReasoningEffort,
  StructuredToolProvider,
  OpenAICompatibleModelProvider,
  type ModelProvider,
  type NativeReasoningConfiguration,
  type VisibleRequestTokenBudget,
  type OpenAICompatibleRequestFormat,
} from '@personal-agent/models';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {isDeepStrictEqual} from 'node:util';
import type {TaskRuntime, WorkerContext, WorkerResult, SubmitTaskInput} from '../index.js';

export {SUBAGENT_DISPATCH_TOOL_NAME, SUBAGENT_DISPATCH_TOOL_VERSION};
export const DEVELOPER_HARNESS_TOOL_NAME = 'developer.harness.run';
export const DEVELOPER_HARNESS_EXECUTOR = 'developer-harness-executor:v1';

export interface RuntimeSubagentSiblingBinding {
  version: '1.0'; parentTaskId: string; ownerTaskId: string; planId: string; planDigest: string;
  workspaceRef: string; configurationRef: string; harnessConfigurationRef: string; deadline: string; tools: ToolDescriptor[];
}
export interface RuntimeSubagentSiblingExecutor {
  binding: RuntimeSubagentSiblingBinding; definition: SubtaskDefinition; maxSteps: number;
}

/** A marker is recognized only against the owner's exact persisted admission. */
export function readRuntimeSubagentSibling(runtime: TaskRuntime, taskId: string): RuntimeSubagentSiblingExecutor | undefined {
  const marker = runtime.loadCheckpoint(taskId, DEVELOPER_HARNESS_EXECUTOR) as RuntimeSubagentSiblingExecutor | undefined;
  if (marker === undefined) return undefined;
  const binding = marker.binding;
  const plan = binding && runtime.loadCheckpoint(binding.ownerTaskId, `developer-harness:plan:${binding.planId}`) as
    {version?:string;binding?: RuntimeSubagentSiblingBinding; executors?: RuntimeSubagentSiblingExecutor[]} | undefined;
  const parent = runtime.loadCheckpoint(taskId, 'subtask-parent') as ChildBinding | undefined;
  const owner = binding && childBinding(runtime,binding.ownerTaskId);
  const delegation = binding && runtime.loadCheckpoint(binding.parentTaskId,'required-subagent-delegation:v1') as
    {version?:string;parentTaskId?:string;deadline?:string;subtask?:SubtaskDefinition}|undefined;
  if (!binding || binding.version !== '1.0' || plan?.version !== '1.0' || !isDeepStrictEqual(plan.binding, binding)
    || !plan?.executors?.some(item => isDeepStrictEqual(item, marker))
    || !Number.isSafeInteger(marker.maxSteps) || marker.maxSteps < 1
    || parent?.parentTaskId !== binding.parentTaskId || parent.parentDeadline !== binding.deadline
    || computeSubtaskInputDigest(parent) !== computeSubtaskInputDigest(marker.definition)
    || owner?.parentTaskId !== binding.parentTaskId || owner.subtaskId !== 'user-work' || owner.parentDeadline !== binding.deadline
    || delegation?.version !== '1.0' || delegation.parentTaskId !== binding.parentTaskId || delegation.deadline !== binding.deadline
    || !delegation.subtask || computeSubtaskInputDigest(owner) !== computeSubtaskInputDigest(delegation.subtask)
    || runtime.findTaskByIdempotencyKey(`subagent-dispatch-${binding.parentTaskId}-user-work`)?.taskId !== binding.ownerTaskId
    || runtime.findTaskByIdempotencyKey(`subagent-dispatch-${binding.parentTaskId}-${marker.definition.subtaskId}`)?.taskId !== taskId
    || runtime.getTask(taskId).conversationId !== `desktop-subtask:${binding.parentTaskId}`) {
    throw new ProtocolError('UNAUTHORIZED', 'Executor does not match its original broker admission');
  }
  return structuredClone(marker);
}

export interface ConfiguredSubagentModelOptions {
  profile?: 'huawei_ict_agentarts';
  provider: 'pangu' | 'openai-compatible';
  baseUrl: string;
  model: string;
  deployment: string;
  apiKey: () => string | Promise<string>;
  fetch?: typeof globalThis.fetch;
  nativeReasoning?: NativeReasoningConfiguration;
  contextLimitTokens?: number;
  requestTokenBudget?: VisibleRequestTokenBudget;
  requestFormat?: OpenAICompatibleRequestFormat;
}

/** Runtime composition only; Desktop injects credentials, never imports providers. */
export function createConfiguredSubagentModelGateway(
  config: ConfiguredSubagentModelOptions,
  decorateProvider?: (provider: ModelProvider) => ModelProvider,
): ModelGateway {
  if (config.profile !== undefined && config.profile !== 'huawei_ict_agentarts') {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Subagent model profile is unavailable');
  }
  if (config.provider !== 'pangu' && config.provider !== 'openai-compatible') {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Subagent model provider is unavailable');
  }
  if (config.nativeReasoning !== undefined && config.provider !== 'openai-compatible') {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Native reasoning configuration requires the OpenAI-compatible auxiliary provider');
  }
  if (config.requestTokenBudget !== undefined && config.provider !== 'openai-compatible') {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Visible request budgets require the OpenAI-compatible auxiliary provider');
  }
  if (config.requestFormat !== undefined && config.provider !== 'openai-compatible') {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Request formats require the OpenAI-compatible auxiliary provider');
  }
  const Provider = config.provider === 'pangu' ? PanguModelProvider : OpenAICompatibleModelProvider;
  const provider = new StructuredToolProvider(new Provider(config));
  return new ModelGateway(decorateProvider ? decorateProvider(provider) : provider);
}

export interface SubagentHostOptions {
  competitionOnly?:true;
  getRuntime: () => TaskRuntime;
  getTools?: (() => AgentToolPort | undefined) | undefined;
  getModelGateway?: ((modelName?: string) => ModelGateway | undefined) | undefined;
  /** Only explicitly supported provider parameters; step budgets are separate. */
  getModelReasoningEfforts?: ((modelName?: string) => readonly ReasoningEffort[]) | undefined;
  /** Opaque config SHA/ref supplied by native config; never contains credentials. */
  getModelConfigurationRef?: ((modelName?:string,taskId?:string)=>string|undefined) | undefined;
  /** Trusted Competition worker; it must reuse the original loop without calling runTask again. */
  runDefaultWorker?: ((subtask: SubtaskDefinition, worker: WorkerContext, tools: AgentToolPort) => Promise<WorkerResult>) | undefined;
  /** Trusted host may narrow tools per role/child; this never creates authorization. */
  getToolsForSubtask?: ((subtask: SubtaskDefinition, worker: WorkerContext) => AgentToolPort | undefined) | undefined;
  /** Trusted worker capability resolves its original nested input; the common approval guard below still runs. */
  resolveWorkerApproval?:(taskId:string,proposal:unknown)=>{runId:string;toolName:string;arguments:Record<string,unknown>}|undefined;
  now?: (() => number) | undefined;
  maxRecursionDepth?: number | undefined;
}

type ChildBinding = SubtaskDefinition & {parentTaskId: string; parentDeadline: string};
function childBinding(runtime: TaskRuntime, taskId: string): ChildBinding {
  const binding = runtime.loadCheckpoint(taskId, 'subtask-parent') as ChildBinding | undefined;
  if (!binding || typeof binding.parentTaskId !== 'string' || !binding.parentTaskId.trim()
    || typeof binding.subtaskId !== 'string' || !binding.subtaskId.trim()
    || typeof binding.goal !== 'string' || !binding.goal.trim() || !Object.hasOwn(DEFAULT_ROLE_LABELS, binding.role)
    || (binding.roleLabel !== undefined && typeof binding.roleLabel !== 'string')
    || typeof binding.parentDeadline !== 'string' || !Number.isFinite(Date.parse(binding.parentDeadline))
    || (binding.model !== undefined && (typeof binding.model !== 'string' || !binding.model.trim()))
    || (binding.reasoningEffort !== undefined && !['none','minimal','low','medium','high','xhigh','max'].includes(binding.reasoningEffort))
    || (binding.thinkingDepth !== undefined && (!Number.isInteger(binding.thinkingDepth)
      || binding.thinkingDepth < 0 || binding.thinkingDepth > 5))) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid persisted subagent binding');
  }
  const task = runtime.getTask(taskId);
  const roleLabel = binding.roleLabel?.trim() || DEFAULT_ROLE_LABELS[binding.role];
  if (task.conversationId !== `desktop-subtask:${binding.parentTaskId}`
    || task.goal !== `[${roleLabel}] ${binding.goal}`
    || runtime.findTaskByIdempotencyKey(`subagent-dispatch-${binding.parentTaskId}-${binding.subtaskId}`)?.taskId !== taskId) {
    throw new ProtocolError('REVISION_CONFLICT', 'Subagent binding does not match the persisted task');
  }
  return binding;
}

function subagentSideEffect(options:SubagentHostOptions,runtime:TaskRuntime,taskId:string):'read'|'local_write'|'external_write' {
  const frozen=runtime.loadCheckpoint(taskId,'subtask-tools-binding') as ToolDescriptor[]|undefined;
  const tools=frozen??options.getTools?.()?.list()??[];
  const selectable=tools.filter(tool=>tool.name!==SUBAGENT_DISPATCH_TOOL_NAME);
  return selectable.some(tool=>tool.sideEffect==='external_write')?'external_write'
    :selectable.some(tool=>tool.sideEffect==='local_write')?'local_write':'read';
}

async function runSubagentWorker(options: SubagentHostOptions, subtask: SubtaskDefinition,
  childWorker: WorkerContext): Promise<WorkerResult> {
  if (childWorker.signal.aborted) throw new ProtocolError('CANCELLED', 'Subtask cancelled during execution');
  const runtime = options.getRuntime();
  const roleLabel = subtask.roleLabel?.trim() || DEFAULT_ROLE_LABELS[subtask.role];
  childWorker.reportProgress({stepId: `child-${subtask.subtaskId}`, label: `[${roleLabel}] 正在执行: ${subtask.goal}`});
  const priorExecution = childWorker.loadCheckpoint('subtask-execution-binding') as {kind?:string}|undefined;
  const kind = priorExecution?.kind ?? (options.runDefaultWorker && (options.competitionOnly || subtask.model===undefined) ? 'competition' : 'model');
  if(!['competition','model'].includes(kind) || (kind==='competition' && !options.runDefaultWorker)
    || (kind==='model' && options.competitionOnly)) {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original subagent execution strategy is unavailable');
  }
  if (priorExecution !== undefined && !isDeepStrictEqual(priorExecution, {kind})) {
    throw new ProtocolError('REVISION_CONFLICT', 'Subagent execution strategy changed');
  }
  if ((kind === 'competition' && (childWorker.loadCheckpoint('subtask-model-binding') !== undefined
    || childWorker.loadCheckpoint('agent-loop') !== undefined))
    || (kind === 'model' && childWorker.loadCheckpoint('subtask-coordination-binding') !== undefined)) {
    throw new ProtocolError('REVISION_CONFLICT', 'Subagent cannot switch its persisted execution strategy');
  }
  childWorker.saveCheckpoint('subtask-execution-binding', {kind});
  const sourceTools = options.getToolsForSubtask ? options.getToolsForSubtask(subtask, childWorker) : options.getTools?.();
  const sibling = readRuntimeSubagentSibling(runtime, childWorker.taskId);
  const required = runtime.loadCheckpoint(childBinding(runtime, childWorker.taskId).parentTaskId, 'required-subagent-delegation:v1') as
    {subtask?: SubtaskDefinition} | undefined;
  const isOriginalUserWorker = !sibling && subtask.subtaskId === 'user-work'
    && required?.subtask !== undefined && computeSubtaskInputDigest(required.subtask) === computeSubtaskInputDigest(subtask);
  const available = sourceTools?.list() ?? [];
  const descriptors = structuredClone(available.filter(item => item.name !== SUBAGENT_DISPATCH_TOOL_NAME
    && (item.name !== DEVELOPER_HARNESS_TOOL_NAME || isOriginalUserWorker)
    && (!sibling || sibling.binding.tools.some(allowed => isDeepStrictEqual(allowed, item)))));
  descriptors.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const previousTools = childWorker.loadCheckpoint('subtask-tools-binding');
  if (previousTools !== undefined && !isDeepStrictEqual(previousTools, descriptors)) {
    throw new ProtocolError('REVISION_CONFLICT', 'Subagent tool scope changed');
  }
  childWorker.saveCheckpoint('subtask-tools-binding', descriptors);
  const tools: AgentToolPort = {list: () => structuredClone(descriptors), invoke: async request => {
    const descriptor = descriptors.find(item => item.name === request.toolName && item.version === request.toolVersion);
    if (!sourceTools || !descriptor || request.taskId !== childWorker.taskId || request.deadline !== childWorker.deadline
      || !isDeepStrictEqual(sourceTools.list().find(item => item.name === request.toolName && item.version === request.toolVersion), descriptor)) {
      throw new ProtocolError('UNAUTHORIZED', 'Tool is outside the bound child scope');
    }
    return sourceTools.invoke({...request, signal: childWorker.signal});
  }};
  const maxSteps = subtask.thinkingDepth !== undefined ? Math.max(2, (subtask.thinkingDepth + 1) * 2) : 6;
  if (kind === 'competition') {
    childWorker.saveCheckpoint('subtask-thinking-binding', {depth: subtask.thinkingDepth ?? null,
      stepBudget: {maxSteps}, modelReasoning: {requestedEffort: null, effort: null, supported: false,
        verification: 'conditional', thinkingBudgetSupported: false, reason: 'Competition native reasoning is not declared'}});
    return options.runDefaultWorker!(subtask, childWorker, tools);
  }
  const model = options.getModelGateway?.(subtask.model);
  if (!model) {
    const modelLabel = subtask.model ? `模型 ${subtask.model}` : '默认模型';
    throw new ProtocolError('UNSUPPORTED_CAPABILITY',
      `子任务无法执行：${modelLabel} 未配置或不受支持。请在受信设置中配置模型后重试`);
  }
  const identity = {provider: model.deployment.provider, deployment: model.deployment.deployment, model: model.deployment.model,
    configurationRef:options.getModelConfigurationRef?.(subtask.model,childWorker.taskId)??null,
    ...(model.deployment.capabilities.nativeReasoning === undefined ? {} : {
      nativeReasoning: structuredClone(model.deployment.capabilities.nativeReasoning)}),
    ...(model.deployment.capabilities.requestFormat === undefined ? {} : {
      requestFormat: model.deployment.capabilities.requestFormat}),
    ...(model.deployment.capabilities.requestTokenBudget === undefined ? {} : {
      requestTokenBudget: structuredClone(model.deployment.capabilities.requestTokenBudget)})};
  const previousIdentity = childWorker.loadCheckpoint('subtask-model-binding') as typeof identity | undefined;
  const pendingLoop = childWorker.loadCheckpoint('agent-loop') as {pending?: import('@personal-agent/models').ModelResult} | undefined;
  const expected = previousIdentity ?? pendingLoop?.pending?.deployment;
  if (expected && (expected.provider !== identity.provider || expected.deployment !== identity.deployment || expected.model !== identity.model
    || (previousIdentity && (previousIdentity.configurationRef!==identity.configurationRef
      || !isDeepStrictEqual(previousIdentity.nativeReasoning, identity.nativeReasoning)
      || previousIdentity.requestFormat !== identity.requestFormat
      || !isDeepStrictEqual(previousIdentity.requestTokenBudget, identity.requestTokenBudget))))) {
    throw new ProtocolError('REVISION_CONFLICT', 'Subagent model configuration changed; the prior proposal cannot be resumed');
  }
  if (!previousIdentity) childWorker.saveCheckpoint('subtask-model-binding', identity);
  const effortLevels = ['none', 'low', 'low', 'medium', 'high', 'high'] as const;
  const requestedEffort = subtask.thinkingDepth === undefined ? undefined : effortLevels[subtask.thinkingDepth];
  const reasoningEffort = requestedEffort !== undefined
    && identity.nativeReasoning === undefined
    && options.getModelReasoningEfforts?.(subtask.model).includes(requestedEffort) ? requestedEffort : undefined;
  childWorker.saveCheckpoint('subtask-thinking-binding', {depth: subtask.thinkingDepth ?? null,
    stepBudget: {maxSteps}, modelReasoning: {requestedEffort: identity.nativeReasoning === undefined
      ? requestedEffort ?? null : identity.nativeReasoning.effort ?? null,
      effort: identity.nativeReasoning?.effort ?? reasoningEffort ?? null,
      supported: identity.nativeReasoning !== undefined || reasoningEffort !== undefined,
      ...(identity.nativeReasoning === undefined ? {} : {thinking: identity.nativeReasoning.thinking,
        outputTokenParameter: identity.nativeReasoning.outputTokenParameter}),
      verification: 'conditional', thinkingBudgetSupported: false,
      reason: identity.nativeReasoning !== undefined ? 'Version-bound native configuration is independent of the step budget'
        : reasoningEffort !== undefined ? 'Trusted host explicitly configured this reasoning_effort'
        : requestedEffort === undefined ? 'No native reasoning effort selected' : 'Selected effort is not configured for this model'}});
  const rolePrompt: ModelMessage = {role: 'system',
    content: `你是专业次级智能体，当前承担职责为【${roleLabel}】(${subtask.role})。请聚焦于此职责，独立执行指派的目标。`};
  const outcome = await runAgent(childWorker, {goal: subtask.goal, initialMessages: [rolePrompt], model,
    tools,
    maxSteps,
    ...(reasoningEffort === undefined ? {} : {reasoningEffort}),
    onUnknownResult: () => {
      if (runtime.getTask(childWorker.taskId).state === 'running') runtime.transitionTask(childWorker.taskId, 'waiting_reconciliation');
    },
  });
  if (outcome.status === 'waiting_approval' && runtime.getTask(childWorker.taskId).state === 'running') {
    // This is a wait state only; no approval or grant is issued by the model/worker.
    runtime.transitionTask(childWorker.taskId, 'waiting_approval');
  }
  return {resultSummary: outcome.resultSummary, evidenceRefs: outcome.evidenceRefs};
}

/** Reuse the exact child and pending agent invocation after trusted approval. */
export async function resumeRuntimeSubagentTask(options: SubagentHostOptions, childTaskId: string,
  parentSignal?: AbortSignal, startup?:{assertBeforeFirstSend:()=>void}): Promise<TaskSnapshot> {
  const runtime = options.getRuntime();
  const binding = childBinding(runtime, childTaskId);
  const child = runtime.getTask(childTaskId);
  if (['succeeded', 'failed', 'cancelled'].includes(child.state)) return child;
  const parent = runtime.getTask(binding.parentTaskId);
  if (parent.cancelRequested || parentSignal?.aborted) {
    runtime.requestCancel(childTaskId, 'Parent task cancelled');
    return runtime.getTask(childTaskId);
  }
  if (['succeeded', 'failed', 'cancelled'].includes(parent.state) || child.state !== 'waiting_approval') {
    throw new ProtocolError('REVISION_CONFLICT', 'Subagent is not resumable for this parent');
  }
  const runOriginalWorker = async (): Promise<TaskSnapshot> => {
    const cancel = () => {
      try {runtime.requestCancel(childTaskId, 'Parent task cancelled');}
      catch { /* A terminal child cannot be cancelled or reopened. */ }
    };
    parentSignal?.addEventListener('abort', cancel, {once: true});
    try {
      return await runtime.runTask(childTaskId, worker => runSubagentWorker(options, binding, worker),
        {deadline: binding.parentDeadline, sideEffect: subagentSideEffect(options,runtime,childTaskId), resume: true});
    } finally {parentSignal?.removeEventListener('abort', cancel);}
  };
  const execution = runtime.loadCheckpoint(childTaskId, 'subtask-execution-binding') as {kind?: string} | undefined;
  const defaultChild = execution?.kind === 'competition' || runtime.loadCheckpoint(childTaskId, 'subtask-coordination-binding') !== undefined;
  const selectedModel = runtime.loadCheckpoint(childTaskId, 'execution-model');
  if (defaultChild && (binding.model !== undefined || selectedModel !== undefined)) {
    const sibling = readRuntimeSubagentSibling(runtime, childTaskId);
    const records = runtime.loadCheckpoint(sibling?.binding.ownerTaskId ?? binding.parentTaskId,
      sibling ? `developer-harness:progress:${sibling.binding.planId}` : 'subtask-progress-records') as Record<string, SubtaskProgressRecord> | undefined;
    const record = records && Object.hasOwn(records, binding.subtaskId) ? records[binding.subtaskId] : undefined;
    if (!isDeepStrictEqual(execution, {kind: 'competition'}) || !record
      || record.parentTaskId !== binding.parentTaskId || record.subtaskId !== binding.subtaskId
      || record.inputDigest !== computeSubtaskInputDigest(binding)) {
      throw new ProtocolError('REVISION_CONFLICT', 'Competition child selection no longer matches its original dispatch');
    }
    let selection;
    try {selection = parseExecutionModelSelection(selectedModel);}
    catch {throw new ProtocolError('REVISION_CONFLICT', 'Competition child has no valid original model selection');}
    if ((binding.model !== undefined && selection.modelId !== binding.model.trim())
      || (binding.reasoningEffort !== undefined && selection.reasoningEffort !== binding.reasoningEffort)) {
      throw new ProtocolError('REVISION_CONFLICT', 'Competition child model selection changed');
    }
  }
  const competition=runtime.loadCheckpoint(childTaskId,'competition-loop') as {pending?:unknown;continuation?:unknown}|undefined;
  if(startup) {
    if(options.competitionOnly!==true||!defaultChild||competition!==undefined
      ||runtime.readToolExecutions(childTaskId).length!==0
      ||runtime.loadCheckpoint(childTaskId,'competition-cloud-inflight')
      ||runtime.loadCheckpoint(childTaskId,'competition-cloud-unknown')
      ||!Array.isArray(runtime.loadCheckpoint(childTaskId,'subtask-tools-binding'))) {
      throw new ProtocolError('RESULT_UNKNOWN','Startup child requires its exact original unattempted Competition worker');
    }
    startup.assertBeforeFirstSend();
    return runOriginalWorker();
  }
  const replay=runtime.loadCheckpoint(childTaskId,'competition-confirmed-replay') as {runId:string;inputDigest:string}|undefined;
  if(defaultChild && !competition?.pending && competition?.continuation && replay
    && runtime.readToolExecutions(childTaskId).some(record=>record.evidenceId===replay.runId && record.inputDigest===replay.inputDigest
      && record.state==='confirmed' && record.executionStarted && record.policyDecision==='allow')) {
    return runOriginalWorker();
  }
  let runId: string, toolName: string, argumentsValue: Record<string, unknown>;
  if (defaultChild) {
    const loop = runtime.loadCheckpoint(childTaskId, 'competition-loop') as {step?: number; pending?: {toolName?: string; arguments?: Record<string, unknown>}} | undefined;
    if (!options.runDefaultWorker || !Number.isSafeInteger(loop?.step) || (loop?.step ?? 0) < 1
      || typeof loop?.pending?.toolName !== 'string' || !loop.pending.arguments || Array.isArray(loop.pending.arguments)) {
      throw new ProtocolError('NOT_FOUND', 'Default child has no original pending Competition invocation');
    }
    runId = `competition-tool-${childTaskId}-${loop.step}`;
    toolName = loop.pending.toolName; argumentsValue = loop.pending.arguments;
    const nested=options.resolveWorkerApproval?.(childTaskId,loop.pending);
    if(nested){runId=nested.runId;toolName=nested.toolName;argumentsValue=nested.arguments;}
  } else {
    const loop = runtime.loadCheckpoint(childTaskId, 'agent-loop') as {step?: number; pending?: import('@personal-agent/models').ModelResult} | undefined;
    if (!Number.isSafeInteger(loop?.step) || (loop?.step ?? 0) < 1 || !loop?.pending || loop.pending.response.kind !== 'tool_proposal') {
      throw new ProtocolError('NOT_FOUND', 'Subagent has no pending agent invocation');
    }
    runId = `agent-run-${childTaskId}-${loop.step}`;
    toolName = loop.pending.response.proposal.toolName; argumentsValue = loop.pending.response.proposal.arguments;
  }
  if(toolName===CLOUD_SKILL_TOOL_NAME) {
    const intent=runtime.loadCheckpoint(childTaskId,'application-reference-skill-v1') as {input:{digest:string;path:string}}|undefined;
    const selection=runtime.loadCheckpoint(childTaskId,'skill:cloud-selection:v1') as {choice:unknown;source:{path:string}}|undefined;
    if(!intent || !selection || !isDeepStrictEqual(argumentsValue,selection.choice) || intent.input.path!==selection.source.path)throw new ProtocolError('UNAUTHORIZED','Skill pending binding changed');
    runId=`skill-read-${childTaskId}-${intent.input.digest.slice(0,16)}`;
    toolName='mcp.workspace.read_text';argumentsValue={path:intent.input.path};
  }
  const confirmedRecord=runtime.readToolExecutions(childTaskId).find(record=>record.evidenceId===runId
    && record.state==='confirmed' && record.executionStarted && record.policyDecision==='allow'
    && record.toolName===toolName && runtime.matchesToolExecutionInput(record,{arguments:argumentsValue,scopeRef:runId}));
  const routine=runtime.loadCheckpoint(childTaskId,`routine-tool-policy:${runId}`) as
    {toolName?:string;toolVersion?:string;argumentsDigest?:string;source?:string}|undefined;
  // A trusted routine invocation has no Approval object. Only its exact original
  // confirmed readback may resume the worker; an unknown or different run cannot.
  if(defaultChild&&confirmedRecord&&((replay?.runId===runId&&replay.inputDigest===confirmedRecord.inputDigest)
      || toolName===DEVELOPER_HARNESS_TOOL_NAME)
    &&routine?.source==='trusted-routine-tool-policy'&&routine.toolName===toolName
    &&routine.toolVersion===confirmedRecord.toolVersion&&routine.argumentsDigest===toolArgumentsDigest(argumentsValue))
    return runOriginalWorker();
  const approval = runtime.getApproval(runId);
  const confirmed=confirmedRecord!==undefined;
  if (approval.taskId !== childTaskId || approval.state !== 'allowed'
    || approval.toolName !== toolName
    || approval.argumentsDigest !== toolArgumentsDigest(argumentsValue)
    || (!confirmed && !runtime.policy.get(runId))) {
    throw new ProtocolError('UNAUTHORIZED', 'Subagent invocation is not approved or grant was revoked');
  }
  return runOriginalWorker();
}

/** Read-only aggregation from persistent children; never reopens a terminal parent. */
export function readRuntimeSubagentSummary(runtime: TaskRuntime, parentTaskId: string,
  definitions?: readonly SubtaskDefinition[]): SubtaskExecutionSummary & {summary: string} {
  const records = runtime.loadCheckpoint(parentTaskId, 'subtask-progress-records') as Record<string, SubtaskProgressRecord> | undefined;
  const subtasks = definitions ?? Object.values(records ?? {}).map(record => {
    try {
      const definition = JSON.parse(record.inputDigest) as SubtaskDefinition;
      // The digest normalizes text; the record retains the actual dispatch identity.
      return {...definition, subtaskId: record.subtaskId};
    }
    catch {throw new ProtocolError('INVALID_ARGUMENT', 'Invalid subtask progress binding');}
  });
  const progress: SubtaskProgress[] = subtasks.map(subtask => {
    const record = records && Object.hasOwn(records, subtask.subtaskId) ? records[subtask.subtaskId] : undefined;
    if (record && (record.parentTaskId !== parentTaskId || record.inputDigest !== computeSubtaskInputDigest(subtask))) {
      throw new ProtocolError('REVISION_CONFLICT', 'Subtask input changed from the persisted dispatch');
    }
    const child = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parentTaskId}-${subtask.subtaskId}`);
    const binding = child ? childBinding(runtime, child.taskId) : undefined;
    if (binding && computeSubtaskInputDigest(binding) !== computeSubtaskInputDigest(subtask)) {
      throw new ProtocolError('REVISION_CONFLICT', 'Subtask definition does not match the persistent child');
    }
    const roleLabel = binding?.roleLabel?.trim() || subtask.roleLabel?.trim() || DEFAULT_ROLE_LABELS[subtask.role];
    const state: SubtaskProgress['state'] = !child ? record?.state ?? 'pending'
      : ['succeeded', 'failed', 'cancelled'].includes(child.state) ? child.state as 'succeeded' | 'failed' | 'cancelled'
        : child.state === 'running' || child.state === 'cancelling' ? 'running' : 'pending';
    return {subtaskId: subtask.subtaskId, role: subtask.role, roleLabel, state,
      ...(state === 'succeeded' ? {result: child?.resultSummary ?? record?.result ?? ''} : {}),
      ...(state === 'failed' || state === 'cancelled' ? {error: child?.error?.message ?? record?.error ?? 'Subtask execution stopped'}
        : state === 'pending' || state === 'running' ? {error: `Subtask is ${child?.state ?? state}; execution is not complete`} : {}),
    };
  });
  const succeeded = progress.filter(item => item.state === 'succeeded').length;
  const failed = progress.filter(item => item.state === 'failed').length;
  const cancelled = progress.filter(item => item.state === 'cancelled').length;
  const pending = progress.length - succeeded - failed - cancelled;
  // One successful child is the answer itself; only real multi-child coordination keeps the header.
  const summary = progress.length === 1 && succeeded === 1
    ? progress[0]?.result?.trim() || '无输出'
    : `## 次级智能体协作汇总（共 ${progress.length} 项：成功 ${succeeded}，失败 ${failed}，取消 ${cancelled}，未完成 ${pending}）\n\n`
      + progress.map(item => `### 【${item.roleLabel}】(${item.role}) · ${item.state}\n${item.result ?? item.error ?? ''}`).join('\n\n');
  return {total: progress.length, succeeded, failed, cancelled, subtasks: progress, aggregatedSummary: summary, summary};
}

/** Internal broker entry, reached after the owner's Gateway authorization. No root ToolContext is fabricated. */
export async function dispatchRuntimeSubagentSiblings(options: SubagentHostOptions,
  input: {executors: readonly RuntimeSubagentSiblingExecutor[]; signal: AbortSignal;
    assertCurrent: () => void; reportProgress: AgentWorkerContext['reportProgress']}): Promise<TaskSnapshot[]> {
  const runtime = options.getRuntime();
  const snapshots = new Map<string, TaskSnapshot>();
  await Promise.all(input.executors.map(async executor => {
    const {binding, definition} = executor;
    const key = `developer-harness:progress:${binding.planId}`;
    const bridge: AgentWorkerContext = {taskId: binding.parentTaskId, signal: input.signal, deadline: binding.deadline,
      loadCheckpoint: name => {
        if (name !== 'subtask-progress-records') return undefined;
        const records = runtime.loadCheckpoint(binding.ownerTaskId, key) as Record<string, SubtaskProgressRecord> | undefined;
        const record = records?.[definition.subtaskId];
        return record ? {[definition.subtaskId]: record} : undefined;
      },
      saveCheckpoint: (name, value) => {
        if (name !== 'subtask-progress-records') throw new ProtocolError('SCOPE_DENIED', 'Unexpected broker checkpoint');
        runtime.saveCheckpoint(binding.ownerTaskId, key, {
          ...runtime.loadCheckpoint(binding.ownerTaskId, key) as Record<string, SubtaskProgressRecord> | undefined,
          ...value as Record<string, SubtaskProgressRecord>});
      }, reportProgress: input.reportProgress};
    await dispatchSubtasks(bridge, [definition], async (_definition, signal) => {
      input.assertCurrent();
      if (signal.aborted) throw new ProtocolError('CANCELLED', 'Broker cancelled before executor admission');
      const idempotencyKey = `subagent-dispatch-${binding.parentTaskId}-${definition.subtaskId}`;
      let child = runtime.findTaskByIdempotencyKey(idempotencyKey);
      if (!child) child = runtime.submitTaskWithCheckpoint({idempotencyKey,
        conversationId: `desktop-subtask:${binding.parentTaskId}`,
        goal: `[${definition.roleLabel ?? DEFAULT_ROLE_LABELS[definition.role]}] ${definition.goal}`}, 'subtask-parent',
      {...definition, parentTaskId: binding.parentTaskId, parentDeadline: binding.deadline});
      const original = childBinding(runtime, child.taskId);
      if (original.parentTaskId !== binding.parentTaskId || original.parentDeadline !== binding.deadline
        || computeSubtaskInputDigest(original) !== computeSubtaskInputDigest(definition)) {
        throw new ProtocolError('REVISION_CONFLICT', 'Executor identity belongs to another admission');
      }
      const previous = runtime.loadCheckpoint(child.taskId, DEVELOPER_HARNESS_EXECUTOR);
      if (previous === undefined) {
        if (child.state !== 'created' || runtime.readToolExecutions(child.taskId).length) {
          throw new ProtocolError('UNAUTHORIZED', 'Existing execution cannot acquire broker authority');
        }
        runtime.saveCheckpointOnce(child.taskId, DEVELOPER_HARNESS_EXECUTOR, executor);
      } else if (!isDeepStrictEqual(previous, executor)) throw new ProtocolError('REVISION_CONFLICT', 'Executor admission changed');
      readRuntimeSubagentSibling(runtime, child.taskId);
      const cancel = () => {
        if (!['succeeded', 'failed', 'cancelled'].includes(runtime.getTask(child!.taskId).state)) {
          runtime.requestCancel(child!.taskId, 'Original broker owner cancelled');
        }
      };
      signal.addEventListener('abort', cancel, {once: true});
      try {
        input.assertCurrent();
        if (signal.aborted) cancel();
        if (child.state === 'created' && !signal.aborted) {
          child = await runtime.runTask(child.taskId, worker => runSubagentWorker(options, definition, worker),
            {deadline: binding.deadline, sideEffect: subagentSideEffect(options, runtime, child.taskId)});
        }
        child = runtime.getTask(child.taskId);
        snapshots.set(definition.subtaskId, child);
        if (child.state !== 'succeeded') throw new ProtocolError(child.state === 'waiting_reconciliation' ? 'RESULT_UNKNOWN'
          : child.state === 'cancelled' ? 'CANCELLED' : 'EXTERNAL_FAILURE', `Executor is ${child.state}`);
        return child.resultSummary ?? '';
      } finally { signal.removeEventListener('abort', cancel); }
    });
    const child = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${binding.parentTaskId}-${definition.subtaskId}`);
    if (child) snapshots.set(definition.subtaskId, child);
  }));
  return [...snapshots.values()];
}

export function createRuntimeSubagentDispatchTool(options: SubagentHostOptions): RegisteredTool {
  if (typeof options.getRuntime !== 'function') {
    throw new ProtocolError('INVALID_ARGUMENT', 'getRuntime must be a function');
  }

  const handler = async (
    input: {subtasks: readonly SubtaskDefinition[]},
    context: ToolContext,
  ): Promise<SubtaskExecutionSummary & {summary: string}> => {
    const runtime = options.getRuntime();
    if (!runtime) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Runtime is not available');

    // 1. 父任务检查与防无界递归
    const parentTask = runtime.getTask(context.taskId);
    if (!parentTask) throw new ProtocolError('NOT_FOUND', `Parent task ${context.taskId} not found`);

    if (parentTask.conversationId?.startsWith('desktop-subtask:')) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Subagent recursive delegation is not allowed');
    }

    if (!Array.isArray(input.subtasks) || input.subtasks.length === 0) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Subtasks must be a non-empty array');
    }
    if (input.subtasks.length > 10) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Subtasks count cannot exceed 10');
    }
    const seen = new Set<string>();
    for (const subtask of input.subtasks) {
      if (!subtask.subtaskId?.trim() || !subtask.goal?.trim() || seen.has(subtask.subtaskId.trim())
        || (subtask.model !== undefined && !subtask.model.trim())
        || (subtask.reasoningEffort !== undefined && !['none','minimal','low','medium','high','xhigh','max'].includes(subtask.reasoningEffort))) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Subtask identity, goal or explicit model is invalid');
      }
      seen.add(subtask.subtaskId.trim());
      const saved = runtime.loadCheckpoint(context.taskId, 'subtask-progress-records') as Record<string, SubtaskProgressRecord> | undefined;
      const record = saved && Object.hasOwn(saved, subtask.subtaskId) ? saved[subtask.subtaskId] : undefined;
      if (record && (record.parentTaskId !== context.taskId || record.inputDigest !== computeSubtaskInputDigest(subtask))) {
        throw new ProtocolError('REVISION_CONFLICT', 'Subtask input changed from the prior dispatch');
      }
    }

    // 2. 构造父任务 WorkerContext 桥接对象供 dispatchSubtasks 记录进度与检查点
    const workerBridge: AgentWorkerContext = {
      taskId: context.taskId,
      deadline: context.deadline,
      signal: context.signal,
      saveCheckpoint: (key: string, value: unknown) => {
        if (key === 'subtask-progress-records') {
          const records = {...runtime.loadCheckpoint(context.taskId, key) as Record<string, SubtaskProgressRecord> | undefined,
            ...structuredClone(value) as Record<string, SubtaskProgressRecord>};
          for (const record of Object.values(records)) {
            const child = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${context.taskId}-${record.subtaskId}`);
            if (child && ['waiting_approval', 'waiting_reconciliation'].includes(child.state)) {
              record.state = 'pending'; delete record.result;
            }
          }
          runtime.saveCheckpoint(context.taskId, key, records);
        } else runtime.saveCheckpoint(context.taskId, key, value);
      },
      loadCheckpoint: (key: string) => runtime.loadCheckpoint(context.taskId, key),
      reportProgress: (progress) => runtime.recordProgress(context.taskId, progress),
    };

    // 3. 子任务真实执行器
    const executor = async (subtask: SubtaskDefinition, signal: AbortSignal): Promise<string> => {
      const idempotencyKey = `subagent-dispatch-${context.taskId}-${subtask.subtaskId}`;

      if (signal.aborted || context.signal.aborted) {
        throw new ProtocolError('CANCELLED', 'Subtask cancelled before execution');
      }

      const roleLabel = subtask.roleLabel?.trim()
        || (DEFAULT_ROLE_LABELS as Record<string, string>)[subtask.role]
        || String(subtask.role);

      // 4. 在 TaskRuntime 中创建并追踪真实子任务
      const existing = runtime.findTaskByIdempotencyKey(idempotencyKey);
      let taskSnapshot: TaskSnapshot;
      if (existing) {
        taskSnapshot = existing;
        const original=childBinding(runtime,existing.taskId);
        if(original.parentTaskId!==context.taskId || original.subtaskId!==subtask.subtaskId
          || original.goal!==subtask.goal || original.role!==subtask.role || original.model!==subtask.model
          || original.reasoningEffort!==subtask.reasoningEffort
          || original.thinkingDepth!==subtask.thinkingDepth || original.parentDeadline!==context.deadline
          || (original.roleLabel?.trim()||DEFAULT_ROLE_LABELS[original.role])!==roleLabel) {
          throw new ProtocolError('REVISION_CONFLICT','Existing child is bound to a different dispatch');
        }
      } else {
        const subtaskInput: SubmitTaskInput = {
          conversationId: `desktop-subtask:${context.taskId}`,
          goal: `[${roleLabel}] ${subtask.goal}`,
          idempotencyKey,
        };
        taskSnapshot = runtime.submitTaskWithCheckpoint(
          subtaskInput,
          'subtask-parent',
          {
            parentTaskId: context.taskId,
            subtaskId: subtask.subtaskId,
            role: subtask.role,
            roleLabel,
            goal: subtask.goal,
            model: subtask.model,
            ...(subtask.reasoningEffort===undefined?{}:{reasoningEffort:subtask.reasoningEffort}),
            thinkingDepth: subtask.thinkingDepth,
            parentDeadline: context.deadline,
          },
        );
      }

      // 如果已在终态，直接读取
      if (['succeeded', 'failed', 'cancelled'].includes(taskSnapshot.state)) {
        if (taskSnapshot.state === 'cancelled') throw new ProtocolError('CANCELLED', 'Subtask was cancelled');
        if (taskSnapshot.state === 'failed') throw new Error(taskSnapshot.error?.message || taskSnapshot.resultSummary || 'Subtask execution failed');
        return taskSnapshot.resultSummary ?? '';
      }
      if (taskSnapshot.state !== 'created') {
        throw new ProtocolError('UNSUPPORTED_CAPABILITY', `Subtask is ${taskSnapshot.state}; execution is not complete`);
      }

      // 5. 使用 runtime.runTask 真实运行子任务并监听父级取消以联动取消子任务
      const childDeadline = context.deadline;
      const abortListener = () => {
        try {
          runtime.requestCancel(taskSnapshot.taskId, 'Parent task cancelled');
        } catch {
          // ignore if already terminal
        }
      };
      if (signal.aborted || context.signal.aborted) {
        abortListener();
      } else {
        signal.addEventListener('abort', abortListener, {once: true});
        context.signal.addEventListener('abort', abortListener, {once: true});
      }

      try {
        const outcome = await runtime.runTask(
          taskSnapshot.taskId,
          async (childWorker: WorkerContext) => {
            if (signal.aborted || childWorker.signal.aborted || context.signal.aborted) {
              throw new ProtocolError('CANCELLED', 'Subtask cancelled during execution');
            }
            return runSubagentWorker(options, subtask, childWorker);
          },
          {
            deadline: childDeadline,
            sideEffect: subagentSideEffect(options,runtime,taskSnapshot.taskId),
          },
        );

        if (outcome.state === 'cancelled') {
          throw new ProtocolError('CANCELLED', 'Subtask was cancelled');
        }
        if (outcome.state === 'failed') {
          throw new Error(outcome.error?.message || outcome.resultSummary || 'Subtask execution failed');
        }

        if (outcome.state !== 'succeeded') {
          throw new ProtocolError('UNSUPPORTED_CAPABILITY', `Subtask is ${outcome.state}; execution is not complete`);
        }
        return outcome.resultSummary ?? '';
      } finally {
        signal.removeEventListener('abort', abortListener);
        context.signal.removeEventListener('abort', abortListener);
      }
    };

    // Reuse the existing dispatcher per child. Each checkpoint slice merges synchronously,
    // so parallel completions cannot overwrite a sibling's durable progress.
    await Promise.all(input.subtasks.map(subtask => dispatchSubtasks({...workerBridge,
      loadCheckpoint: key => {
        const value = workerBridge.loadCheckpoint(key);
        if (key !== 'subtask-progress-records') return value;
        const record = (value as Record<string, SubtaskProgressRecord> | undefined)?.[subtask.subtaskId];
        return record ? {[subtask.subtaskId]: record} : undefined;
      },
      reportProgress: progress => workerBridge.reportProgress({...progress, totalUnits: input.subtasks.length,
        completedUnits: input.subtasks.filter(item => {
          const child = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${context.taskId}-${item.subtaskId}`);
          return child && ['succeeded', 'failed', 'cancelled'].includes(child.state);
        }).length}),
    }, [subtask], executor)));
    return readRuntimeSubagentSummary(runtime, context.taskId, input.subtasks);
  };

  return createSubagentDispatchTool(handler);
}

export interface DesktopSubagentDispatchToolOptions {
  competitionOnly?:true;
  getRuntime: () => TaskRuntime;
  getTools?: (() => AgentToolPort | undefined) | undefined;
  fakeModelMode?: boolean;
  /** Trusted host selection. An unknown name must return undefined, never default. */
  getModelGateway?: ((modelName?: string) => ModelGateway | undefined) | undefined;
  getModelReasoningEfforts?: ((modelName?: string) => readonly ReasoningEffort[]) | undefined;
  runDefaultWorker?: SubagentHostOptions['runDefaultWorker'];
  getToolsForSubtask?: SubagentHostOptions['getToolsForSubtask'];
  getModelConfigurationRef?:SubagentHostOptions['getModelConfigurationRef'];
  modelConfig?: {
    baseUrl?: string;
    model?: string;
    deployment?: string;
    apiKey?: string;
  };
  /** Trusted model aliases; unregistered names fail instead of falling back to Pangu. */
  modelRegistry?: Readonly<Record<string, (modelName: string) => ModelGateway | undefined>>;
  now?: (() => number) | undefined;
  maxRecursionDepth?: number | undefined;
}

export function createDesktopSubagentDispatchTool(options: DesktopSubagentDispatchToolOptions): RegisteredTool {
  const {getRuntime, getTools, fakeModelMode, modelConfig, modelRegistry, now, maxRecursionDepth} = options;
  return createRuntimeSubagentDispatchTool({
    ...(options.competitionOnly?{competitionOnly:true as const}:{}),
    getRuntime,
    getTools,
    now,
    maxRecursionDepth,
    getModelReasoningEfforts: options.getModelReasoningEfforts,
    runDefaultWorker: fakeModelMode ? undefined : options.runDefaultWorker,
    getToolsForSubtask: options.getToolsForSubtask,
    getModelConfigurationRef:options.getModelConfigurationRef,
    getModelGateway: (modelName?: string) => {
      if (fakeModelMode) {
        return new ModelGateway(new FakeModelProvider(
          Array.from({length: 16}, () => (req: ModelRequest) => ({
            kind: 'final',
            text: `[次级智能体 ${modelName || 'default'}] 完成分析与执行：${req.messages.at(-1)?.content || ''}`,
          })),
          {
            provider: 'fake',
            deployment: 'desktop-subagent-fake',
            model: modelName || 'fake-subagent-model',
            verification: 'mock',
            capabilities: {text: true, streaming: false, toolCalling: true, structuredOutput: true, vision: false},
          },
        ));
      }
      if (modelRegistry) {
        const requested = modelName?.trim() || 'default';
        const factory = Object.hasOwn(modelRegistry, requested) ? modelRegistry[requested] : undefined;
        return factory?.(requested);
      }
      if (options.getModelGateway) return options.getModelGateway(modelName);
      if (modelConfig?.baseUrl && modelConfig?.apiKey && (modelName === 'pangu' || modelName === 'default' || !modelName)) {
        const apiKey = modelConfig.apiKey;
        const panguOptions: PanguModelProviderOptions = {
          baseUrl: modelConfig.baseUrl,
          model: modelConfig.model ?? 'default',
          apiKey: () => apiKey,
        };
        if (modelConfig.deployment !== undefined) {
          panguOptions.deployment = modelConfig.deployment;
        }
        return new ModelGateway(new StructuredToolProvider(new PanguModelProvider(panguOptions)));
      }
      return undefined;
    },
  });
}
