import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {MAX_COORDINATION_GOAL_CHARACTERS,ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext, ToolDescriptor, TaskSnapshot} from '@personal-agent/contracts';
import type {SubtaskDefinition, AgentToolPort} from '@personal-agent/agents';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {TaskRuntime} from '../index.js';
import {readUserTaskDelegation} from './user-task-delegation.js';
import {DEVELOPER_HARNESS_TOOL_NAME, SUBAGENT_DISPATCH_TOOL_NAME, dispatchRuntimeSubagentSiblings,
  type SubagentHostOptions, type RuntimeSubagentSiblingBinding, type RuntimeSubagentSiblingExecutor} from './subagent-host.js';

export {DEVELOPER_HARNESS_TOOL_NAME};
export const DEVELOPER_HARNESS_TOOL_VERSION = '1.0.0';
export interface RuntimeDeveloperHarnessOptions {
  /** Identity of the already confined workspace in the original tool host; never a filesystem grant. */
  workspaceRef: string;
  /** Trusted aggregate executor-step allowance shared by every plan of one user worker. */
  maxExecutorSteps: number;
  /** Opaque trusted configuration revision; changing it invalidates existing plan admission. */
  configurationRef?: string;
  assertCurrent?: () => void;
}
interface ExecutorProposal {
  id: string; role: 'researcher' | 'coder' | 'reviewer'; goal: string; dependsOn: string[]; maxSteps: number;
}
interface PlanProposal {planId: string; expectedRevision?: number; tasks: ExecutorProposal[];}
interface PlanRecord {
  version: '1.0'; proposal: PlanProposal; runId: string; binding: RuntimeSubagentSiblingBinding;
  sourceRevision: number; parentRevision: number; ownerRevision: number; executors: RuntimeSubagentSiblingExecutor[];
}
interface BudgetRecord {limit: number; configurationRef: string; reservations: Record<string, {digest: string; steps: number}>;}
export interface DeveloperHarnessResult {
  planId: string; parentTaskId: string; ownerTaskId: string;
  state: 'completed' | 'waiting_approval' | 'waiting_reconciliation' | 'cancelled';
  executors: {id: string; taskId?: string; state: TaskSnapshot['state'] | 'blocked' | 'not_started';
    resultSummary?: string; evidenceRefs: string[]}[];
}
export const DEVELOPER_HARNESS_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['planId', 'tasks'],
  properties: {
    planId: {type: 'string', minLength: 1, maxLength: 64},
    expectedRevision: {type: 'integer', minimum: 0},
    tasks: {type: 'array', minItems: 1, maxItems: 10, items: {
      type: 'object', additionalProperties: false, required: ['id', 'role', 'goal', 'dependsOn', 'maxSteps'],
      properties: {
        id: {type: 'string', minLength: 1, maxLength: 64},
        role: {type: 'string', enum: ['researcher', 'coder', 'reviewer']},
        goal: {type: 'string', minLength: 1, maxLength: 8000},
        dependsOn: {type: 'array', maxItems: 9, items: {type: 'string', minLength: 1, maxLength: 64}},
        maxSteps: {type: 'integer', minimum: 1},
      },
    }},
  },
};
const terminal = (task: TaskSnapshot) => ['succeeded', 'failed', 'cancelled'].includes(task.state);
const name = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const planKey = (id: string) => `developer-harness:plan:${id}`;
function parseProposal(input: unknown): PlanProposal {
  validateToolValue(DEVELOPER_HARNESS_INPUT_SCHEMA, input);
  const proposal = structuredClone(input) as PlanProposal;
  if (!name.test(proposal.planId) || proposal.tasks.some(task => !name.test(task.id) || !task.goal.trim()
    || task.goal !== task.goal.trim() || new Set(task.dependsOn).size !== task.dependsOn.length)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid developer plan identity or dependency');
  }
  const tasks = new Map(proposal.tasks.map(task => [task.id, task]));
  if (tasks.size !== proposal.tasks.length || proposal.tasks.some(task => task.dependsOn.some(id => !tasks.has(id) || id === task.id))) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Developer plan dependencies must identify unique tasks');
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new ProtocolError('INVALID_ARGUMENT', 'Developer plan has a dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tasks.get(id)!.dependsOn) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const id of tasks.keys()) visit(id);
  return proposal;
}
export function assertDeveloperHarnessConfiguration(config: RuntimeDeveloperHarnessOptions): void {
  if (!config || typeof config.workspaceRef !== 'string' || !config.workspaceRef.trim()
    || config.workspaceRef !== config.workspaceRef.trim() || config.workspaceRef.length > 256
    || !Number.isSafeInteger(config.maxExecutorSteps) || config.maxExecutorSteps < 1
    || (config.configurationRef !== undefined && (typeof config.configurationRef !== 'string'
      || !config.configurationRef.trim() || config.configurationRef !== config.configurationRef.trim()
      || config.configurationRef.length > 256))
    || (config.assertCurrent !== undefined && typeof config.assertCurrent !== 'function')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Developer harness requires a trusted workspace and total executor budget');
  }
}
export function developerHarnessConfigurationRef(configuration: RuntimeDeveloperHarnessOptions): string {
  return createHash('sha256').update(JSON.stringify([configuration.workspaceRef,
    configuration.maxExecutorSteps, configuration.configurationRef ?? null])).digest('hex');
}
/** Read synchronously at every admission boundary; host configuration is never a model tool. */
export function readDeveloperHarnessConfiguration(read: () => RuntimeDeveloperHarnessOptions | undefined):
  RuntimeDeveloperHarnessOptions | undefined {
  const configuration = read();
  if (configuration === undefined) return undefined;
  assertDeveloperHarnessConfiguration(configuration);
  const snapshot = {...configuration};
  const guarded: unknown = snapshot.assertCurrent?.();
  if (guarded !== undefined) {
    void Promise.resolve(guarded).catch(()=>undefined);
    throw new ProtocolError('UNAUTHORIZED', 'Developer configuration guard must complete synchronously');
  }
  return snapshot;
}
interface Host {
  getRuntime: () => TaskRuntime;
  getTools: () => AgentToolPort | undefined;
  getSubagentOptions: () => SubagentHostOptions;
  configurationRef: string;
  readConfiguration: () => RuntimeDeveloperHarnessOptions | undefined;
  now: () => number;
}
function ownerScope(host: Host, context: ToolContext) {
  const runtime = host.getRuntime(), owner = runtime.getTask(context.taskId);
  const saved = runtime.loadCheckpoint(owner.taskId, 'subtask-parent') as (SubtaskDefinition & {parentTaskId: string; parentDeadline: string}) | undefined;
  const root = saved && readUserTaskDelegation(runtime, saved.parentTaskId);
  if (!saved || !root || saved.subtaskId !== 'user-work' || saved.parentDeadline !== root.deadline
    || !isDeepStrictEqual(saved, {...root.subtask, parentTaskId: root.parentTaskId, parentDeadline: root.deadline})
    || runtime.findTaskByIdempotencyKey(`subagent-dispatch-${root.parentTaskId}-user-work`)?.taskId !== owner.taskId
    || owner.conversationId !== `desktop-subtask:${root.parentTaskId}`
    || context.deadline !== root.deadline || !context.scopes.includes('agent:delegate')) {
    throw new ProtocolError('SCOPE_DENIED', 'Only the original trusted user worker can propose a developer plan');
  }
  const parent = runtime.getTask(root.parentTaskId);
  if (context.signal.aborted || owner.cancelRequested || parent.cancelRequested
    || owner.state !== 'running' || !['running','waiting_approval','waiting_reconciliation'].includes(parent.state)) {
    throw new ProtocolError('CANCELLED', 'Original developer owner is inactive');
  }
  if (host.now() >= Date.parse(root.deadline)) throw new ProtocolError('TIMEOUT', 'Developer plan cannot extend its original deadline');
  const configuration = readDeveloperHarnessConfiguration(host.readConfiguration);
  if (!configuration) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Developer harness is disabled');
  const frozen = runtime.loadCheckpoint(owner.taskId, 'subtask-tools-binding') as ToolDescriptor[] | undefined;
  const currentTools = host.getTools()?.list() ?? [];
  if (!Array.isArray(frozen) || frozen.some(tool => !currentTools.some(item => isDeepStrictEqual(tool, item)))) {
    throw new ProtocolError('REVISION_CONFLICT', 'Original developer tool scope changed');
  }
  return {owner, parent, root, configuration, tools: frozen.filter(tool =>
    tool.name !== SUBAGENT_DISPATCH_TOOL_NAME && tool.name !== DEVELOPER_HARNESS_TOOL_NAME)};
}
/** Returns metadata for a registered, available host. This does not grant execution authority. */
export function developerHarnessAvailable(host: Host, taskId: string, deadline: string, signal: AbortSignal): boolean {
  try {
    ownerScope(host, {taskId, deadline, signal, scopes: ['agent:delegate'], runId: '', authorizationRef: ''});
    return true;
  } catch {return false;}
}
export interface RuntimeDeveloperHarnessTool extends RegisteredTool {
  /** Trusted continuation of one confirmed orchestration receipt; never starts an unknown executor again. */
  continueOriginal(input: unknown, context: ToolContext): Promise<unknown>;
}
export function createRuntimeDeveloperHarnessTool(host: Host): RuntimeDeveloperHarnessTool {
  const active = new Set<string>();
  const continuations = new WeakSet<ToolContext>();
  const tool: RuntimeDeveloperHarnessTool = {
    descriptor: {name: DEVELOPER_HARNESS_TOOL_NAME, version: DEVELOPER_HARNESS_TOOL_VERSION,
      inputSchema: DEVELOPER_HARNESS_INPUT_SCHEMA, outputSchema: {type: 'object', additionalProperties: true},
      sideEffect: 'read', requiredScopes: ['agent:delegate'], idempotencySupport: true,
      recoverySupport: true, requiresPresence: false},
    execute: async (raw, context) => {
      const proposal = parseProposal(raw), runtime = host.getRuntime();
      const continuing = continuations.has(context);
      const {owner, parent, root, tools, configuration} = ownerScope(host, context);
      const configurationRef = developerHarnessConfigurationRef(configuration);
      const pending = runtime.loadCheckpoint(owner.taskId,'competition-loop') as
        {step?:number;pending?:{toolName?:string;toolVersion?:string;arguments?:unknown};pendingRevision?:number} | undefined;
      if (context.runId !== `competition-tool-${owner.taskId}-${pending?.step}`
        || pending?.pending?.toolName !== DEVELOPER_HARNESS_TOOL_NAME
        || pending.pending.toolVersion !== DEVELOPER_HARNESS_TOOL_VERSION
        || !isDeepStrictEqual(pending.pending.arguments,proposal)) {
        throw new ProtocolError('UNAUTHORIZED','Developer plan must be the original user worker pending proposal');
      }
      const sourceRevision = pending.pendingRevision;
      if (typeof sourceRevision !== 'number' || !Number.isSafeInteger(sourceRevision) || sourceRevision < 0) {
        throw new ProtocolError('REVISION_CONFLICT','Original developer proposal revision is unavailable');
      }
      const execution = runtime.readToolExecutions(owner.taskId).find(record => record.evidenceId === context.runId);
      if (context.authorizationRef !== context.runId || execution?.toolName !== DEVELOPER_HARNESS_TOOL_NAME
        || execution.toolVersion !== DEVELOPER_HARNESS_TOOL_VERSION || execution.policyDecision !== 'allow'
        || !execution.executionStarted || execution.state !== (continuing ? 'confirmed' : 'started')
        || !runtime.matchesToolExecutionInput(execution, {arguments: {...proposal}, scopeRef: context.runId})) {
        throw new ProtocolError('UNAUTHORIZED', 'Developer plan requires its original owner Gateway execution');
      }
      const assertGrant = () => {
        const grant = runtime.policy.get(context.authorizationRef);
        if (!grant || grant.taskId !== owner.taskId || grant.toolName !== DEVELOPER_HARNESS_TOOL_NAME
          || grant.argumentsDigest !== toolArgumentsDigest(proposal) || !grant.scopes.includes('agent:delegate')
          || host.now() >= Date.parse(grant.expiresAt)) {
          throw new ProtocolError('UNAUTHORIZED','Original developer plan authorization expired or was revoked');
        }
      };
      assertGrant();
      const key = planKey(proposal.planId), identity = `${owner.taskId}:${proposal.planId}`;
      if (active.has(identity)) throw new ProtocolError('REVISION_CONFLICT', 'Original developer plan is already active');
      const digest = toolArgumentsDigest(proposal);
      let plan = runtime.loadCheckpoint(owner.taskId, key) as PlanRecord | undefined;
      if (continuing) {
        const loop = runtime.loadCheckpoint(owner.taskId,'competition-loop') as
          {step?:number;pending?:{toolName?:string;toolVersion?:string;arguments?:unknown}} | undefined;
        const cached = runtime.loadCheckpoint(owner.taskId,'tool-result-'+context.runId) as {result?:unknown} | undefined;
        if (!plan || plan.runId !== context.runId || plan.sourceRevision !== pending.pendingRevision
          || !cached || !Object.hasOwn(cached,'result')
          || context.runId !== `competition-tool-${owner.taskId}-${loop?.step}`
          || loop?.pending?.toolName !== DEVELOPER_HARNESS_TOOL_NAME || loop.pending.toolVersion !== DEVELOPER_HARNESS_TOOL_VERSION
          || !isDeepStrictEqual(loop.pending.arguments,proposal)) {
          throw new ProtocolError('UNAUTHORIZED','Only the original confirmed broker invocation can continue');
        }
      }
      if (plan) {
        if (plan.version !== '1.0' || plan.runId !== context.runId || !isDeepStrictEqual(plan.proposal, proposal)
          || plan.binding.planDigest !== digest || plan.binding.configurationRef !== host.configurationRef
          || plan.binding.harnessConfigurationRef !== configurationRef
          || plan.binding.workspaceRef !== configuration.workspaceRef || !isDeepStrictEqual(plan.binding.tools, tools)) {
          throw new ProtocolError('REVISION_CONFLICT', 'Original developer plan scope changed');
        }
      } else {
        const loop = runtime.loadCheckpoint(owner.taskId, 'competition-loop') as {pendingRevision?: number} | undefined;
        if (proposal.expectedRevision !== undefined && proposal.expectedRevision !== (loop?.pendingRevision ?? owner.revision)) {
          throw new ProtocolError('REVISION_CONFLICT', 'Developer proposal uses a different owner revision');
        }
        const steps = proposal.tasks.reduce((sum, task) => sum + task.maxSteps, 0);
        if (!Number.isSafeInteger(steps)) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid executor budget');
        const budgetKey = 'developer-harness:budget:v1';
        const budget = runtime.loadCheckpoint(owner.taskId, budgetKey) as BudgetRecord | undefined
          ?? {limit: configuration.maxExecutorSteps, configurationRef, reservations: {}};
        if (budget.limit !== configuration.maxExecutorSteps || budget.configurationRef !== configurationRef
          || !budget.reservations || typeof budget.reservations !== 'object'
          || Array.isArray(budget.reservations) || Object.values(budget.reservations).some(item=>!item
            || !Number.isSafeInteger(item.steps) || item.steps < 1 || !/^[a-f0-9]{64}$/.test(item.digest))) {
          throw new ProtocolError('REVISION_CONFLICT', 'Original executor budget changed');
        }
        const reservation = Object.hasOwn(budget.reservations,proposal.planId) ? budget.reservations[proposal.planId] : undefined;
        if (reservation && (reservation.digest !== digest || reservation.steps !== steps)) {
          throw new ProtocolError('REVISION_CONFLICT', 'Original plan budget reservation changed');
        }
        const used = Object.values(budget.reservations).reduce((sum, item) => sum + item.steps, 0);
        if (!Number.isSafeInteger(used) || (!reservation && used + steps > budget.limit)) {
          throw new ProtocolError('SCOPE_DENIED', 'Plan exceeds the trusted total executor budget');
        }
        budget.reservations[proposal.planId] = {digest, steps};
        // Synchronous admission, before any asynchronous work or child creation.
        runtime.saveCheckpoint(owner.taskId, budgetKey, budget);
        plan = {version: '1.0', proposal, runId: context.runId, sourceRevision, parentRevision: parent.revision, ownerRevision: owner.revision,
          binding: {version: '1.0', parentTaskId: root.parentTaskId, ownerTaskId: owner.taskId, planId: proposal.planId,
            planDigest: digest, workspaceRef: configuration.workspaceRef, configurationRef: host.configurationRef,
            harnessConfigurationRef: configurationRef,
            deadline: root.deadline, tools: structuredClone(tools)}, executors: []};
        runtime.saveCheckpointOnce(owner.taskId, key, plan);
      }
      const state = plan;
      if (continuing) {
        state.parentRevision = parent.revision; state.ownerRevision = owner.revision;
        runtime.saveCheckpoint(owner.taskId,key,state);
      }
      const check = () => {
        assertGrant();
        const current = ownerScope(host, context);
        if (current.parent.revision !== state.parentRevision || current.owner.revision !== state.ownerRevision
          || developerHarnessConfigurationRef(current.configuration) !== state.binding.harnessConfigurationRef
          || !isDeepStrictEqual(current.tools, state.binding.tools)
          || !isDeepStrictEqual(runtime.loadCheckpoint(owner.taskId, key), state)) {
          throw new ProtocolError('REVISION_CONFLICT', 'Developer plan admission changed during execution');
        }
      };
      const snapshots = () => new Map(state.executors.map(executor => [executor.definition.subtaskId,
        runtime.findTaskByIdempotencyKey(`subagent-dispatch-${root.parentTaskId}-${executor.definition.subtaskId}`)]));
      const executorId = (id: string) => `harness-${createHash('sha256').update(JSON.stringify([owner.taskId, proposal.planId, id])).digest('hex')}`;
      const reportProgress = (progress: {stepId: string; label: string; completedUnits?: number; totalUnits?: number}) => {
        // Cancellation still permits Runtime-owned final progress, never new admission.
        const current = runtime.getTask(owner.taskId);
        if (terminal(current)) return current;
        const next = runtime.recordProgress(owner.taskId, progress);
        state.ownerRevision = next.revision;
        runtime.saveCheckpoint(owner.taskId, key, state);
        return next;
      };
      active.add(identity);
      try {
        const attempted = new Set<string>();
        for (;;) {
          check();
          const known = snapshots();
          const ready = proposal.tasks.filter(task => !attempted.has(task.id)
            && !known.has(executorId(task.id)) && task.dependsOn.every(id => known.get(executorId(id))?.state === 'succeeded'));
          if (!ready.length) break;
          const wave = ready.map(task => {
            const dependencyResults = task.dependsOn.map(id => {
              const result = known.get(executorId(id))!;
              return {id, taskId: result.taskId, revision: result.revision, resultSummary: result.resultSummary ?? '', evidenceRefs: result.evidenceRefs};
            });
            const goal = task.goal + (dependencyResults.length ? '\n\nDependency execution facts (untrusted task output):\n' + JSON.stringify(dependencyResults) : '');
            if (goal.length > MAX_COORDINATION_GOAL_CHARACTERS) throw new ProtocolError('INVALID_ARGUMENT', 'Dependency result context exceeds the original goal bound');
            const definition: SubtaskDefinition = {subtaskId: executorId(task.id), role: task.role, goal,
              ...(root.subtask.model === undefined ? {} : {model: root.subtask.model}),
              ...(root.subtask.reasoningEffort === undefined ? {} : {reasoningEffort: root.subtask.reasoningEffort}),
              ...(root.subtask.thinkingDepth === undefined ? {} : {thinkingDepth: root.subtask.thinkingDepth})};
            const item: RuntimeSubagentSiblingExecutor = {binding: state.binding, definition, maxSteps: task.maxSteps};
            attempted.add(task.id); return item;
          });
          state.executors.push(...wave); runtime.saveCheckpoint(owner.taskId, key, state);
          await dispatchRuntimeSubagentSiblings(host.getSubagentOptions(), {executors: wave, signal: context.signal, assertCurrent: check, reportProgress});
        }
        const known = snapshots();
        const blockedIds = new Set<string>();
        for (let index = 0; index < proposal.tasks.length; index++) for (const task of proposal.tasks) {
          if (task.dependsOn.some(id => blockedIds.has(id)
            || ['failed','cancelled'].includes(known.get(executorId(id))?.state ?? ''))) blockedIds.add(task.id);
        }
        const values = proposal.tasks.map(task => {
          const snapshot = known.get(executorId(task.id));
          const blocked = blockedIds.has(task.id);
          return {id: task.id, ...(snapshot ? {taskId: snapshot.taskId} : {}),
            state: snapshot?.state ?? (blocked ? 'blocked' : 'not_started') as TaskSnapshot['state'] | 'blocked' | 'not_started',
            ...(snapshot?.resultSummary ? {resultSummary: snapshot.resultSummary} : {}), evidenceRefs: snapshot?.evidenceRefs ?? []};
        });
        const result: DeveloperHarnessResult = {planId: proposal.planId, parentTaskId: root.parentTaskId, ownerTaskId: owner.taskId,
          state: values.some(item => item.state === 'waiting_reconciliation') ? 'waiting_reconciliation'
            : context.signal.aborted ? 'cancelled'
            : values.some(item => item.state !== 'blocked' && item.state !== 'not_started'
              && !['succeeded', 'failed', 'cancelled'].includes(item.state)) ? 'waiting_approval' : 'completed',
          executors: values};
        runtime.saveCheckpoint(owner.taskId, `developer-harness:result:${proposal.planId}`, result);
        return result;
      } finally {active.delete(identity);}
    },
    continueOriginal:async (input,context)=>{
      continuations.add(context);
      try{return await tool.execute(input,context);}finally{continuations.delete(context);}
    },
  };
  return tool;
}
