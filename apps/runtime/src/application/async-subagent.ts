import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, TaskSnapshot, ToolContext} from '@personal-agent/contracts';
import {
  DEFAULT_ROLE_LABELS,
  type AgentToolPort,
  type SubtaskDefinition,
  type SubtaskRole,
} from '@personal-agent/agents';
import type {ReasoningEffort} from '@personal-agent/models';
import {readCanonicalUserWorkParent} from './user-task-delegation.js';
import {RuntimeError, type TaskRuntime} from '../index.js';
import {
  desktopSubagentHostOptions,
  readRuntimeSubagentBinding,
  readRuntimeSubagentSummary,
  startRuntimeSubagentChild,
  runSubagentWorker,
  readRuntimeAsyncSubagentScope,
  type DesktopSubagentDispatchToolOptions,
  type SubagentHostOptions,
} from './subagent-host.js';
import {
  BUILTIN_SUBAGENT_ROLES,
  createSubagentTypeRegistry,
  subagentTypeChangeSummary,
  type SubagentTypeRegistry,
  type SubagentTypeProposal,
} from './subagent-type-registry.js';

export const SUBAGENT_SPAWN_TOOL_NAME = 'subagent.spawn';
export const SUBAGENT_INSTRUCT_TOOL_NAME = 'subagent.instruct';
export const SUBAGENT_STOP_TOOL_NAME = 'subagent.stop';
export const SUBAGENT_TYPE_LIST_TOOL_NAME = 'subagent.type.list';
export const SUBAGENT_TYPE_CREATE_TOOL_NAME = 'subagent.type.create';
export const SUBAGENT_TYPE_UPDATE_TOOL_NAME = 'subagent.type.update';
export const SUBAGENT_TYPE_DISABLE_TOOL_NAME = 'subagent.type.disable';
export const SUBAGENT_TYPE_ENABLE_TOOL_NAME = 'subagent.type.enable';
export const SUBAGENT_TYPE_DELETE_TOOL_NAME = 'subagent.type.delete';
export const SUBAGENT_TYPE_CONFIRM_TOOL_NAME = 'subagent.type.confirm';
export const SUBAGENT_TYPE_IMPORT_TOOL_NAME = 'subagent.type.import';
export const ASYNC_SUBAGENT_TOOL_VERSION = '1.0.0';
export const ASYNC_SUBAGENT_ADMISSION_CONVERSATION = 'async-subagent-admission';
const SPAWN_KEY = 'async-subagent-spawn:v1';
const TYPE_KEY = 'async-subagent-type:v1';
const STEP_KEY = 'async-subagent-step-cap:v1';
const CONTROL_KEY = 'async-subagent-control:v1';
const START_ERROR = 'async-subagent-start-error:v1';
const NOTE_KEY = 'async-subagent-runner-note:v1';
const PARENT_CONVERSATION_KEY = 'async-subagent-parent-conversation:v1';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export interface AsyncSubagentReport {
  parentTaskId: string;
  subtaskId: string;
  taskId: string;
  revision: number;
  state: string;
  summary: string;
  conversationId?: string;
}

export interface AsyncSubagentHandle {
  subtaskId: string;
  taskId: string;
  idempotencyKey: string;
  state: string;
  queued: boolean;
  typeName?: string;
  typeVersion?: number;
}

interface SpawnMarker {
  version: 1;
  parentTaskId: string;
  subtaskId: string;
  enqueuedAt: string;
  usesLaya: boolean;
  maxSteps: number;
  modelConfigurationRef: string | null;
  deadline: string;
  sourceTaskId?: string;
  sourceRunId?: string;
  sourceInputDigest?: string;
  parentExecutionEpoch?: number;
  sourceExecutionEpoch?: number;
  typeName?: string;
  typeVersion?: number;
  typeDigest?: string;
}

interface TypeSnap {
  name: string;
  version: number;
  digest: string;
  instructions: string;
  allowedTools: string[];
  maxSteps?: number;
  deadlineMs?: number;
  model?: string;
}

export interface AsyncSubagentController {
  readonly registry: SubagentTypeRegistry;
  readonly tools: RegisteredTool[];
  pump(): Promise<void>;
  recover(): Promise<void>;
  list(): Array<Record<string, unknown>>;
  instruct(parentTaskId: string, subtaskId: string, instruction: string, expectedControlRevision: number): {revision: number};
  stop(parentTaskId: string, subtaskId: string): {taskId: string; state: string; cancelAccepted: boolean};
}

function fail(code: 'INVALID_ARGUMENT' | 'REVISION_CONFLICT' | 'SCOPE_DENIED' | 'NOT_FOUND' | 'UNSUPPORTED_CAPABILITY' | 'RESULT_UNKNOWN', message: string): never {
  throw new ProtocolError(code, message);
}

function objectSchema(properties: Record<string, unknown>, required: string[]): {[k: string]: unknown} {
  return {type: 'object', additionalProperties: false, properties, required};
}

function descriptor(name: string, sideEffect: 'read' | 'local_write', presence: boolean, input: {[k: string]: unknown}, output: {[k: string]: unknown}): RegisteredTool['descriptor'] {
  return {name, version: ASYNC_SUBAGENT_TOOL_VERSION, inputSchema: input, outputSchema: output, sideEffect,
    requiredScopes: ['agent:delegate'], idempotencySupport: name === SUBAGENT_SPAWN_TOOL_NAME, recoverySupport: true, requiresPresence: presence};
}

export function createAsyncSubagentController(options: {
  host: SubagentHostOptions;
  registry?: SubagentTypeRegistry;
  globalCap?: number;
  perParentCap?: number;
  now?: () => number;
  getGrantedTools?: () => readonly string[];
  verifyUnknownWrite?: (taskId: string) => Promise<'applied' | 'not_applied' | 'unknown'>;
  onReport?: (report: AsyncSubagentReport) => void;
  startChild?: (taskId: string, deadline: string, host: SubagentHostOptions) => Promise<TaskSnapshot>;
}): AsyncSubagentController {
  const globalCap = options.globalCap ?? 3;
  const perParentCap = options.perParentCap ?? 3;
  if (!Number.isInteger(globalCap) || globalCap < 1 || globalCap > 32 || !Number.isInteger(perParentCap) || perParentCap < 1 || perParentCap > globalCap) {
    fail('INVALID_ARGUMENT', 'Async subagent caps must stay within the existing pool');
  }
  const now = options.now ?? Date.now;
  const runtime = () => {
    const value = options.host.getRuntime();
    if (!value) fail('UNSUPPORTED_CAPABILITY', 'Runtime is not available');
    return value;
  };
  let boundRegistry=options.registry;
  const registry=()=>boundRegistry??(boundRegistry=createSubagentTypeRegistry(runtime()));
  const granted = () => options.getGrantedTools?.() ?? options.host.getTools?.()?.list().map(tool => tool.name) ?? [];
  const startChild = options.startChild ?? ((taskId: string, deadline: string, host: SubagentHostOptions) => startRuntimeSubagentChild(host, taskId, deadline));
  let chain: Promise<void> = Promise.resolve();
  let epoch = 1;
  const starting = new Set<string>();
  const scheduleId = (taskId: string) => `async-subagent-admit:${taskId}`;
  const readSchedule = (taskId: string) => {
    try { return runtime().getSchedule(scheduleId(taskId)); }
    catch (error) {
      if (error instanceof RuntimeError && error.code === 'NOT_FOUND') return undefined;
      throw error;
    }
  };
  const spawned = () => {
    const found: TaskSnapshot[] = [];
    let before: number | undefined;
    let snapshot: number | undefined;
    do {
      const page = runtime().listTaskCheckpointPage({limit: 100,
        ...(before === undefined ? {} : {beforeSequence: before}),
        ...(snapshot === undefined ? {} : {snapshotSequence: snapshot})}, [SPAWN_KEY]);
      found.push(...page.items);
      before = page.nextBeforeSequence;
      snapshot = page.snapshotSequence;
    } while (before !== undefined);
    return found;
  };
  const markerOf = (taskId: string) => runtime().loadCheckpoint(taskId, SPAWN_KEY) as SpawnMarker | undefined;
  const typeOf = (taskId: string) => runtime().loadCheckpoint(taskId, TYPE_KEY) as TypeSnap | undefined;
  const childOf = (parentTaskId: string, subtaskId: string) => {
    const task = runtime().findTaskByIdempotencyKey(`subagent-dispatch-${parentTaskId}-${subtaskId}`);
    if (!task) fail('NOT_FOUND', 'Asynchronous subagent does not exist');
    const marker = markerOf(task.taskId);
    if (!marker || marker.parentTaskId !== parentTaskId || marker.subtaskId !== subtaskId) {
      fail('REVISION_CONFLICT', 'Subagent identity does not match the async spawn');
    }
    return task;
  };
  const reportTerminal = () => {
    for (const child of spawned()) {
      if (!TERMINAL.has(child.state)) continue;
      const marker = markerOf(child.taskId);
      if (!marker) continue;
      let summary = '';
      try {
        const binding = readRuntimeSubagentBinding(runtime(), child.taskId);
        summary = readRuntimeSubagentSummary(runtime(), marker.parentTaskId, [{
          subtaskId: binding.subtaskId, role: binding.role, goal: binding.goal,
          ...(typeof binding.roleLabel === 'string' ? {roleLabel: binding.roleLabel} : {}),
          ...(binding.model === undefined ? {} : {model: binding.model}),
          ...(binding.reasoningEffort === undefined ? {} : {reasoningEffort: binding.reasoningEffort}),
          ...(binding.thinkingDepth === undefined ? {} : {thinkingDepth: binding.thinkingDepth}),
        }]).summary;
      } catch { summary = child.resultSummary ?? child.error?.message ?? child.state; }
      const note = runtime().loadCheckpoint(child.taskId, NOTE_KEY) as {location?: string; reason?: string} | undefined;
      if (note?.reason) {
        const line = `（${note.location === 'remote' ? '远端执行' : '本地执行'}：${note.reason}）`;
        if (!summary.includes(line)) summary = `${summary}\n${line}`;
      }
      const key = `async-subagent-report:${marker.subtaskId}:${child.revision}`;
      if (!runtime().saveCheckpointOnce(marker.parentTaskId, key, {subtaskId: marker.subtaskId, taskId: child.taskId,
        revision: child.revision, state: child.state, summary})) continue;
      try {
        runtime().recordProgress(marker.parentTaskId, {stepId: `async-subagent-${marker.subtaskId}`, label: summary.slice(0, 200)});
      } catch { /* A finished parent keeps the checkpoint; its terminal state is not reopened. */ }
      const conversation = runtime().loadCheckpoint(child.taskId, PARENT_CONVERSATION_KEY) as {conversationId?: string} | undefined;
      options.onReport?.({parentTaskId: marker.parentTaskId, subtaskId: marker.subtaskId, taskId: child.taskId,
        revision: child.revision, state: child.state, summary, ...(conversation?.conversationId ? {conversationId: conversation.conversationId} : {})});
    }
  };
  const invalidate = (taskId: string, message: string) => {
    const task = runtime().getTask(taskId);
    if (task.state === 'created' && !runtime().isTaskActive(taskId)) {
      runtime().transitionTask(taskId, 'failed', {error: {code: 'REVISION_CONFLICT', message, retryable: false}});
    }
    fail('REVISION_CONFLICT', message);
  };
  const assertRunnable = (taskId: string) => {
    const marker = markerOf(taskId);
    const snap = typeOf(taskId);
    if (marker) {
      const binding = readRuntimeSubagentBinding(runtime(), taskId);
      const ref = options.host.getModelConfigurationRef?.(binding.model, taskId) ?? null;
      if (ref !== marker.modelConfigurationRef) invalidate(taskId, 'F28 model configuration changed; the pending subagent is no longer valid');
    }
    if (!snap) return;
    const current = registry().get(snap.name);
    if (!current || !current.definition.enabled || current.version !== snap.version || current.digest !== snap.digest) {
      invalidate(taskId, 'Custom subagent type changed; the pending proposal is no longer valid');
    }
    const allowed = new Set(granted());
    if (snap.allowedTools.some(name => !allowed.has(name))) {
      const task = runtime().getTask(taskId);
      if (task.state === 'created') runtime().transitionTask(taskId, 'failed', {error: {code: 'SCOPE_DENIED', message: 'Custom subagent tools are no longer granted', retryable: false}});
      fail('SCOPE_DENIED', 'Custom subagent tools are no longer granted');
    }
  };
  const narrow = (taskId: string): SubagentHostOptions => {
    const snap = typeOf(taskId);
    if (!snap) return options.host;
    const allowed = new Set(snap.allowedTools);
    const wrap = (inner: AgentToolPort | undefined): AgentToolPort | undefined => inner && {
      list: () => inner.list().filter(tool => allowed.has(tool.name) && tool.name !== 'subagent.dispatch' && !tool.name.startsWith('subagent.')),
      invoke: async request => {
        if (!allowed.has(request.toolName) || request.toolName === 'subagent.dispatch' || request.toolName.startsWith('subagent.')) {
          fail('SCOPE_DENIED', 'Tool is outside the custom subagent type');
        }
        return inner.invoke(request);
      },
    };
    return {...options.host,
      getTools: () => wrap(options.host.getTools?.()),
      getToolsForSubtask: (subtask, worker) => wrap(options.host.getToolsForSubtask?.(subtask, worker) ?? options.host.getTools?.())};
  };
  const deadlineFor = (taskId: string) => {
    const binding = readRuntimeSubagentBinding(runtime(), taskId);
    return markerOf(taskId)?.deadline??binding.parentDeadline;
  };
  const runOne = async (taskId: string) => {
    assertRunnable(taskId);
    const schedule = readSchedule(taskId);
    const wakeId = schedule?.taskId;
    const wake = wakeId ? runtime().getTask(wakeId) : undefined;
    const execute = async () => {
      try {return await startChild(taskId, deadlineFor(taskId), narrow(taskId));}
      catch(error) {
        // A rejected original authority is terminal even when the admission wake owns the outer worker.
        // No child operation started, so use Runtime's normal failure transition without a retry.
        if((error instanceof ProtocolError||error instanceof RuntimeError)&&['UNAUTHORIZED','REVISION_CONFLICT','CANCELLED'].includes(error.code)
          &&runtime().getTask(taskId).state==='created'&&!runtime().isTaskActive(taskId))
          return runtime().runTask(taskId,async()=>{throw error;},{deadline:deadlineFor(taskId),sideEffect:'read'});
        throw error;
      }
    };
    if (wake && wake.state === 'created' && !runtime().isTaskActive(wake.taskId)) {
      await runtime().runTask(wake.taskId, async () => {
        await execute();
        return {resultSummary: `admitted ${taskId}`};
      }, {deadline: deadlineFor(taskId), sideEffect: 'read'});
      return;
    }
    await execute();
  };
  const launch = (taskId: string) => {
    starting.add(taskId);
    let settled = false;
    const work = (async () => {
      try { await runOne(taskId); }
      catch (error) {
        const task = runtime().getTask(taskId);
        if (task.state === 'created' && !runtime().isTaskActive(taskId)) {
          runtime().saveCheckpoint(taskId, START_ERROR, {epoch, message: error instanceof Error ? error.message : 'start failed'});
        }
      } finally {
        settled = true;
        starting.delete(taskId);
        reportTerminal();
      }
    })();
    const admitted = (async () => {
      while (!settled) {
        const task = runtime().getTask(taskId);
        if (task.state !== 'created' || runtime().isTaskActive(taskId) || starting.has(taskId) === false) return;
        await new Promise(resolve => setImmediate(resolve));
      }
    })();
    return Promise.race([work.then(() => undefined), admitted]);
  };
  const occupied = (task: TaskSnapshot) => {
    if (TERMINAL.has(task.state)) return false;
    if (starting.has(task.taskId) || runtime().isTaskActive(task.taskId)) return true;
    const schedule = readSchedule(task.taskId);
    return schedule?.status === 'pending' || schedule?.status === 'fired';
  };
  const pumpBody = async () => {
    for (const child of spawned()) {
      if (child.state !== 'waiting_reconciliation') continue;
      const key = `async-subagent-f24-readback:${child.revision}`;
      if (runtime().loadCheckpoint(child.taskId, key) !== undefined) continue;
      const verdict = options.verifyUnknownWrite ? await options.verifyUnknownWrite(child.taskId) : 'unknown';
      runtime().saveCheckpointOnce(child.taskId, key, {verdict, redo: false, revision: child.revision});
    }
    reportTerminal();
    const children = spawned();
    const running = children.filter(occupied);
    const layaRunning = running.filter(task => markerOf(task.taskId)?.usesLaya === true).length;
    const baseParentCount = (parentTaskId: string) => running.filter(task => markerOf(task.taskId)?.parentTaskId === parentTaskId).length;
    const admittedParents = new Map<string, number>();
    let slots = globalCap - running.length;
    let layaSlots = 1 - layaRunning;
    const queued = children.filter(task => task.state === 'created' && !task.cancelRequested && !readSchedule(task.taskId) && !starting.has(task.taskId))
      .sort((left, right) => (markerOf(left.taskId)?.enqueuedAt ?? '').localeCompare(markerOf(right.taskId)?.enqueuedAt ?? '')
        || (markerOf(left.taskId)?.subtaskId ?? '').localeCompare(markerOf(right.taskId)?.subtaskId ?? '')
        || left.taskId.localeCompare(right.taskId));
    for (const child of queued) {
      const marker = markerOf(child.taskId);
      const parentSlots = marker ? baseParentCount(marker.parentTaskId) + (admittedParents.get(marker.parentTaskId) ?? 0) : perParentCap;
      if (!marker || slots <= 0 || parentSlots >= perParentCap) continue;
      if (marker.usesLaya && layaSlots <= 0) continue;
      runtime().createSchedule({scheduleId: scheduleId(child.taskId), goal: `异步子任务入场 ${child.taskId}`,
        conversationId: ASYNC_SUBAGENT_ADMISSION_CONVERSATION, runAt: new Date(now()).toISOString(), timeZone: 'UTC',
        missedRunPolicy: 'run_once', taskIdempotencyKey: `async-subagent-wake:${child.taskId}`});
      admittedParents.set(marker.parentTaskId, (admittedParents.get(marker.parentTaskId) ?? 0) + 1);
      slots -= 1;
      if (marker.usesLaya) layaSlots -= 1;
    }
    runtime().recoverMissedSchedules(ASYNC_SUBAGENT_ADMISSION_CONVERSATION);
    runtime().dispatchDueSchedules(ASYNC_SUBAGENT_ADMISSION_CONVERSATION);
    const launches: Promise<void>[] = [];
    for (const child of spawned()) {
      if (child.state !== 'created' || child.cancelRequested || starting.has(child.taskId) || runtime().isTaskActive(child.taskId)) continue;
      const schedule = readSchedule(child.taskId);
      if (schedule?.status !== 'fired') continue;
      const error = runtime().loadCheckpoint(child.taskId, START_ERROR) as {epoch?: number} | undefined;
      if (error?.epoch === epoch) continue;
      launches.push(launch(child.taskId));
    }
    await Promise.all(launches);
  };
  const pump = () => {
    const run = chain.then(pumpBody);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
  const assertParent = (taskId: string) => {
    const parent = runtime().getTask(taskId);
    if (!parent) fail('NOT_FOUND', 'Parent task not found');
    if (parent.conversationId?.startsWith('desktop-subtask:') || runtime().loadCheckpoint(taskId, 'subtask-parent')) {
      const original=readCanonicalUserWorkParent(runtime(),taskId);
      if(original)return runtime().getTask(original);
      fail('INVALID_ARGUMENT', 'Subagent recursive delegation is not allowed');
    }
    return parent;
  };
  const resolve = (raw: Record<string, unknown>, parentTaskId: string): {definition: SubtaskDefinition; type?: TypeSnap; maxSteps: number} => {
    const subtaskId = typeof raw.subtaskId === 'string' ? raw.subtaskId.trim() : '';
    const goal = typeof raw.goal === 'string' ? raw.goal.trim() : '';
    if (!subtaskId || !goal || (raw.model !== undefined && (typeof raw.model !== 'string' || !raw.model.trim()))
      || (raw.reasoningEffort !== undefined && !EFFORTS.includes(String(raw.reasoningEffort)))
      || (raw.thinkingDepth !== undefined && (!Number.isInteger(raw.thinkingDepth) || (raw.thinkingDepth as number) < 0 || (raw.thinkingDepth as number) > 5))) {
      fail('INVALID_ARGUMENT', 'Subtask identity, goal or explicit model is invalid');
    }
    const typeName = typeof raw.typeName === 'string' ? raw.typeName.trim() : '';
    let role = typeof raw.role === 'string' ? raw.role as SubtaskRole : undefined;
    let roleLabel = typeof raw.roleLabel === 'string' && raw.roleLabel.trim() ? raw.roleLabel.trim() : undefined;
    let model = typeof raw.model === 'string' ? raw.model.trim() : undefined;
    let type: TypeSnap | undefined;
    if (typeName) {
      if (BUILTIN_SUBAGENT_ROLES.includes(typeName as SubtaskRole)) fail('INVALID_ARGUMENT', 'Custom type name collides with a built-in role');
      const record = registry().get(typeName);
      if (!record?.definition.enabled) fail('INVALID_ARGUMENT', 'Custom subagent type is unknown or disabled');
      if (role && role !== record.definition.baseRole) fail('REVISION_CONFLICT', 'Custom type base role does not match the requested role');
      if (model && record.definition.model && model !== record.definition.model) fail('REVISION_CONFLICT', 'Custom type model does not match the requested model');
      const allowed = new Set(granted());
      if (record.definition.allowedTools.some(name => !allowed.has(name))) fail('SCOPE_DENIED', 'Custom subagent type asks for a tool the user has not granted');
      role = record.definition.baseRole;
      roleLabel = roleLabel ?? typeName;
      model = model ?? record.definition.model;
      type = {name: record.name, version: record.version, digest: record.digest, instructions: record.definition.instructions,
        allowedTools: [...record.definition.allowedTools], ...(record.definition.maxSteps === undefined ? {} : {maxSteps: record.definition.maxSteps}),
        ...(record.definition.deadlineMs === undefined ? {} : {deadlineMs: record.definition.deadlineMs}),
        ...(model === undefined ? {} : {model})};
    }
    if (!role || !Object.hasOwn(DEFAULT_ROLE_LABELS, role)) fail('INVALID_ARGUMENT', 'Subtask role is not a built-in role');
    const definition: SubtaskDefinition = {subtaskId, role, goal, ...(roleLabel ? {roleLabel} : {}),
      ...(model ? {model} : {}),
      ...(typeof raw.reasoningEffort === 'string' ? {reasoningEffort: raw.reasoningEffort as ReasoningEffort} : {}),
      ...(raw.thinkingDepth === undefined ? {} : {thinkingDepth: raw.thinkingDepth as number})};
    const maxSteps = definition.thinkingDepth !== undefined ? Math.max(2, (definition.thinkingDepth + 1) * 2) : 6;
    if (type?.maxSteps !== undefined && type.maxSteps > maxSteps) fail('INVALID_ARGUMENT', 'Custom type step limit exceeds the existing cap');
    return {definition, ...(type ? {type} : {}), maxSteps: type?.maxSteps ?? maxSteps};
  };
  const spawn = (raw: {subtasks?: unknown}, context: ToolContext): {accepted: true; handles: AsyncSubagentHandle[]; admission: {globalCap: number; perParentCap: number; queued: number}} => {
    const current = runtime();
    const parent=assertParent(context.taskId);
    if (!Number.isFinite(Date.parse(context.deadline))) fail('INVALID_ARGUMENT', 'Parent deadline is invalid');
    if (!Array.isArray(raw?.subtasks) || raw.subtasks.length === 0 || raw.subtasks.length > 10) fail('INVALID_ARGUMENT', 'Subtasks must be a non-empty array of at most 10');
    const seen = new Set<string>();
    const handles: AsyncSubagentHandle[] = [];
    for (const item of raw.subtasks) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail('INVALID_ARGUMENT', 'Subtask is invalid');
      const resolved = resolve(item as Record<string, unknown>, parent.taskId);
      if(resolved.definition.subtaskId==='user-work')fail('INVALID_ARGUMENT','The original user worker identity is reserved');
      if (seen.has(resolved.definition.subtaskId)) fail('INVALID_ARGUMENT', 'Subtask identity is duplicated');
      seen.add(resolved.definition.subtaskId);
      const roleLabel = resolved.definition.roleLabel?.trim() || DEFAULT_ROLE_LABELS[resolved.definition.role];
      const idempotencyKey = `subagent-dispatch-${parent.taskId}-${resolved.definition.subtaskId}`;
      const modelConfigurationRef = options.host.getModelConfigurationRef?.(resolved.definition.model, context.taskId) ?? null;
      const previous = current.findTaskByIdempotencyKey(idempotencyKey);
      const priorMarker=previous?markerOf(previous.taskId):undefined;
      const deadline=priorMarker?.deadline??new Date(Math.min(Date.parse(context.deadline),now()+(resolved.type?.deadlineMs??Infinity))).toISOString();
      const source=current.readToolExecutions(context.taskId).find(record=>record.evidenceId===context.runId
        &&record.toolName===SUBAGENT_SPAWN_TOOL_NAME&&record.executionStarted&&record.policyDecision==='allow'
        &&current.matchesToolExecutionInput(record,{arguments:raw as Record<string,unknown>,scopeRef:context.authorizationRef}));
      const identity: SpawnMarker = {version: 1, parentTaskId: parent.taskId, subtaskId: resolved.definition.subtaskId,
        enqueuedAt: new Date(now()).toISOString(), usesLaya: /laya/i.test(resolved.definition.model ?? ''), maxSteps: resolved.maxSteps,
        modelConfigurationRef,deadline,sourceTaskId:context.taskId,parentExecutionEpoch:current.readExecutionEpoch(parent.taskId),
        sourceExecutionEpoch:current.readExecutionEpoch(context.taskId),...(source?{sourceRunId:context.runId,sourceInputDigest:source.inputDigest}:{}),
        ...(resolved.type ? {typeName: resolved.type.name, typeVersion: resolved.type.version, typeDigest: resolved.type.digest} : {})};
      const task = current.submitTaskWithSubagentBinding({conversationId: `desktop-subtask:${parent.taskId}`,
        goal: `[${roleLabel}] ${resolved.definition.goal}`, idempotencyKey}, {
        parentTaskId: parent.taskId, subtaskId: resolved.definition.subtaskId, role: resolved.definition.role, roleLabel,
        goal: resolved.definition.goal, ...(resolved.definition.model ? {model: resolved.definition.model} : {}),
        ...(resolved.definition.reasoningEffort === undefined ? {} : {reasoningEffort: resolved.definition.reasoningEffort}),
        ...(resolved.definition.thinkingDepth === undefined ? {} : {thinkingDepth: resolved.definition.thinkingDepth}),
        parentDeadline: context.deadline});
      const saved = current.loadCheckpoint(task.taskId, SPAWN_KEY) as SpawnMarker | undefined;
      const comparable = (value: SpawnMarker) => ({...value,parentExecutionEpoch:value.parentExecutionEpoch??0,
        sourceExecutionEpoch:value.sourceExecutionEpoch??0,enqueuedAt: ''});
      if (saved && !isDeepStrictEqual(comparable(saved), comparable(identity))) fail('REVISION_CONFLICT', 'Async subagent input changed');
      if (!saved) {
        if (previous) fail('REVISION_CONFLICT', 'Existing child was not created by asynchronous spawn');
        current.saveCheckpoint(task.taskId, SPAWN_KEY, identity);
        const parentConversationId = parent.conversationId;
        if (typeof parentConversationId === 'string' && parentConversationId) {
          current.saveCheckpoint(task.taskId, PARENT_CONVERSATION_KEY, {conversationId: parentConversationId});
        }
        if (resolved.type) current.saveCheckpoint(task.taskId, TYPE_KEY, resolved.type);
        if (resolved.type?.maxSteps !== undefined) current.saveCheckpoint(task.taskId, STEP_KEY, {maxSteps: resolved.type.maxSteps});
      }
      handles.push({subtaskId: resolved.definition.subtaskId, taskId: task.taskId, idempotencyKey, state: task.state,
        queued: task.state === 'created', ...(resolved.type ? {typeName: resolved.type.name, typeVersion: resolved.type.version} : {})});
    }
    return {accepted: true, handles, admission: {globalCap, perParentCap, queued: handles.filter(item => item.queued).length}};
  };
  const instruct = (parentTaskId: string, subtaskId: string, instruction: string, expectedControlRevision: number) => {
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 4000 || !Number.isInteger(expectedControlRevision) || expectedControlRevision < 0) {
      fail('INVALID_ARGUMENT', 'Follow-up instruction is invalid');
    }
    const child = childOf(parentTaskId, subtaskId);
    if (TERMINAL.has(child.state) || child.state === 'waiting_reconciliation') fail('REVISION_CONFLICT', 'Follow-up cannot change a finished or unknown subagent');
    if(child.state!=='created'||runtime().isTaskActive(child.taskId))fail('UNSUPPORTED_CAPABILITY','Follow-up for an already started subagent requires execution-epoch control; no instruction was accepted');
    const current = runtime().loadCheckpoint(child.taskId, CONTROL_KEY) as {revision?: number; instructions?: string[]} | undefined;
    const revision = current?.revision ?? 0;
    if (revision !== expectedControlRevision || !Array.isArray(current?.instructions ?? [])) fail('REVISION_CONFLICT', 'controlRevision does not match');
    const next = {revision: revision + 1, instructions: [...(current?.instructions ?? []), instruction.trim()]};
    runtime().saveCheckpoint(child.taskId, CONTROL_KEY, next);
    return {revision: next.revision};
  };
  const stop = (parentTaskId: string, subtaskId: string) => {
    const child = childOf(parentTaskId, subtaskId);
    const requested = runtime().requestCancel(child.taskId, 'User stopped asynchronous subagent');
    const current = runtime().getTask(child.taskId);
    if (current.state === 'cancelling' && !runtime().isTaskActive(current.taskId) && runtime().readToolExecutions(current.taskId).length === 0
      && current.error?.code !== 'RESULT_UNKNOWN' && runtime().loadCheckpoint(current.taskId, `async-subagent-f24-readback:${current.revision}`) === undefined) {
      const done = runtime().confirmCancellation(current.taskId);
      return {taskId: done.taskId, state: done.state, cancelAccepted: true};
    }
    return {taskId: current.taskId, state: current.state, cancelAccepted: requested.cancelAccepted};
  };
  const list = () => spawned().map(task => {
    const marker = markerOf(task.taskId);
    const control = runtime().loadCheckpoint(task.taskId, CONTROL_KEY) as {revision?: number} | undefined;
    const report = marker && TERMINAL.has(task.state)
      ? runtime().loadCheckpoint(marker.parentTaskId, `async-subagent-report:${marker.subtaskId}:${task.revision}`) as {summary?: string} | undefined : undefined;
    const reported = report !== undefined;
    let role = '';
    let goal = '';
    try {
      const binding = readRuntimeSubagentBinding(runtime(), task.taskId);
      role = binding.roleLabel || DEFAULT_ROLE_LABELS[binding.role];
      goal = binding.goal;
    } catch { /* A damaged binding stays visible by id only. */ }
    const conversation = runtime().loadCheckpoint(task.taskId, PARENT_CONVERSATION_KEY) as {conversationId?: string} | undefined;
    return {parentTaskId: marker?.parentTaskId, taskId: task.taskId, subtaskId: marker?.subtaskId, state: task.state,
      revision: task.revision, role, goal, updatedAt: task.updatedAt, queued: task.state === 'created' && !readSchedule(task.taskId), reported,
      ...(conversation?.conversationId ? {conversationId: conversation.conversationId} : {}),
      ...(typeof report?.summary === 'string' ? {summary: report.summary} : {}),
      controlRevision: control?.revision ?? 0, ...(marker?.typeName ? {typeName: marker.typeName, typeVersion: marker.typeVersion} : {})};
  });
  const mainOnly = (context: ToolContext) => {
    assertParent(context.taskId);
  };
  const proposalResult = (proposal: SubagentTypeProposal) => ({state: 'pending_confirmation' as const, proposalId: proposal.proposalId,
    digest: proposal.digest, kind: proposal.kind, name: proposal.name, summary: subagentTypeChangeSummary(proposal),
    effect: 'none' as const});
  const subtaskSchema = {type: 'object', additionalProperties: false, required: ['subtaskId', 'goal'], properties: {
    subtaskId: {type: 'string', minLength: 1}, role: {type: 'string', enum: [...BUILTIN_SUBAGENT_ROLES]},
    typeName: {type: 'string', description: '已确认的自定义子智能体类型名称。五种内置角色仍用 role。'},
    roleLabel: {type: 'string'}, goal: {type: 'string', minLength: 1}, model: {type: 'string'},
    reasoningEffort: {type: 'string', enum: EFFORTS}, thinkingDepth: {type: 'integer', minimum: 0, maximum: 5}}};
  const definitionSchema = {type: 'object', additionalProperties: false, required: ['name', 'description', 'instructions', 'allowedTools', 'baseRole', 'enabled'], properties: {
    name: {type: 'string'}, description: {type: 'string'}, instructions: {type: 'string'},
    allowedTools: {type: 'array', items: {type: 'string'}}, baseRole: {type: 'string', enum: [...BUILTIN_SUBAGENT_ROLES]},
    model: {type: 'string'}, maxSteps: {type: 'integer', minimum: 1, maximum: 12}, deadlineMs: {type: 'integer'}, enabled: {type: 'boolean'}}};
  const tools: RegisteredTool[] = [
    {descriptor: {...descriptor(SUBAGENT_SPAWN_TOOL_NAME, 'read', false, {type: 'object', additionalProperties: false, required: ['subtasks'], properties: {
      subtasks: {type: 'array', minItems: 1, maxItems: 10, items: subtaskSchema},
    }, description: '异步创建子任务并立即返回句柄，不阻塞当前对话。自定义类型用 typeName。'}, {type: 'object', additionalProperties: true}), idempotencySupport: true},
    execute: async (input, context) => spawn(input as {subtasks?: unknown}, context)},
    {descriptor: descriptor(SUBAGENT_INSTRUCT_TOOL_NAME, 'local_write', false, objectSchema({subtaskId: {type: 'string'}, instruction: {type: 'string'}, expectedControlRevision: {type: 'integer', minimum: 0}}, ['subtaskId', 'instruction', 'expectedControlRevision']), {type: 'object', additionalProperties: true}),
      execute: async (input, context) => {
        const raw = input as {subtaskId?: string; instruction?: string; expectedControlRevision?: number};
        return instruct(assertParent(context.taskId).taskId, String(raw.subtaskId ?? ''), String(raw.instruction ?? ''), Number(raw.expectedControlRevision));
      }},
    {descriptor: descriptor(SUBAGENT_STOP_TOOL_NAME, 'local_write', false, objectSchema({subtaskId: {type: 'string'}}, ['subtaskId']), {type: 'object', additionalProperties: true}),
      execute: async (input, context) => stop(assertParent(context.taskId).taskId, String((input as {subtaskId?: string}).subtaskId ?? ''))},
    {descriptor: descriptor(SUBAGENT_TYPE_LIST_TOOL_NAME, 'read', false, objectSchema({}, []), {type: 'object', additionalProperties: true, description: '列出已确认的自定义子智能体类型。'}),
      execute: async (_input, context) => { mainOnly(context); return {types: registry().list()}; }},
    {descriptor: descriptor(SUBAGENT_TYPE_CREATE_TOOL_NAME, 'local_write', false, objectSchema({definition: definitionSchema}, ['definition']), {type: 'object', additionalProperties: true, description: '根据用户原话起草自定义子智能体类型。未确认前不生效。'}),
      execute: async (input, context) => { mainOnly(context); return proposalResult(registry().propose({kind: 'create', definition: (input as {definition?: unknown}).definition}, granted())); }},
    {descriptor: descriptor(SUBAGENT_TYPE_UPDATE_TOOL_NAME, 'local_write', false, objectSchema({definition: definitionSchema}, ['definition']), {type: 'object', additionalProperties: true}),
      execute: async (input, context) => { mainOnly(context); return proposalResult(registry().propose({kind: 'update', definition: (input as {definition?: unknown}).definition}, granted())); }},
    {descriptor: descriptor(SUBAGENT_TYPE_DISABLE_TOOL_NAME, 'local_write', false, objectSchema({name: {type: 'string'}}, ['name']), {type: 'object', additionalProperties: true}),
      execute: async (input, context) => { mainOnly(context); const name = (input as {name?: string}).name; if (!name) fail('INVALID_ARGUMENT', 'Subagent type name is required'); return proposalResult(registry().propose({kind: 'disable', name}, granted())); }},
    {descriptor: descriptor(SUBAGENT_TYPE_ENABLE_TOOL_NAME, 'local_write', false, objectSchema({name: {type: 'string'}}, ['name']), {type: 'object', additionalProperties: true}),
      execute: async (input, context) => { mainOnly(context); const name = (input as {name?: string}).name; if (!name) fail('INVALID_ARGUMENT', 'Subagent type name is required'); return proposalResult(registry().propose({kind: 'enable', name}, granted())); }},
    {descriptor: descriptor(SUBAGENT_TYPE_DELETE_TOOL_NAME, 'local_write', false, objectSchema({name: {type: 'string'}}, ['name']), {type: 'object', additionalProperties: true}),
      execute: async (input, context) => { mainOnly(context); const name = (input as {name?: string}).name; if (!name) fail('INVALID_ARGUMENT', 'Subagent type name is required'); return proposalResult(registry().propose({kind: 'delete', name}, granted())); }},
    {descriptor: descriptor(SUBAGENT_TYPE_CONFIRM_TOOL_NAME, 'local_write', true, objectSchema({proposalId: {type: 'string'}, digest: {type: 'string'}, summary: {type: 'string'}}, ['proposalId', 'digest', 'summary']), {type: 'object', additionalProperties: true, description: '只有用户明确确认摘要后才写入类型。确认会作废绑定旧版本的待执行提案。'}),
      execute: async (input, context) => {
        mainOnly(context);
        const raw = input as {proposalId?: string; digest?: string; summary?: string};
        const pendingKey = `subagent-type-proposal:${raw.proposalId}`;
        const owner = runtime().findTaskByIdempotencyKey('subagent-type-registry:v1');
        const proposal = owner ? runtime().loadCheckpoint(owner.taskId, pendingKey) as SubagentTypeProposal | undefined : undefined;
        if (!proposal || raw.summary !== subagentTypeChangeSummary(proposal)) fail('REVISION_CONFLICT', 'Confirmation summary does not match the pending type change');
        return {state: 'confirmed' as const, record: registry().confirm(String(raw.proposalId), String(raw.digest), granted())};
      }},
    {descriptor: descriptor(SUBAGENT_TYPE_IMPORT_TOOL_NAME, 'local_write', false, objectSchema({text: {type: 'string', description: '用户提供的类型配置 JSON，不会按模型自选路径读取磁盘。'}}, ['text']), {type: 'object', additionalProperties: true}),
      execute: async (input, context) => {
        mainOnly(context);
        return {state: 'pending_confirmation' as const, proposals: registry().proposeConfig(String((input as {text?: string}).text ?? ''), granted()).map(proposalResult)};
      }},
  ];
  return {get registry(){return registry();}, tools, pump, recover() { epoch += 1; return pump(); }, list, instruct, stop};
}

/** Dispatch a child to a healthy remote host when one exists; otherwise use the local worker. */
export function createRemoteAwareSubagentStarter(options: {
  host: SubagentHostOptions;
  getRemote?: () => {list: () => Array<{enabled: boolean; repos?: string[]}>; submit: (job: {kind: 'async-subagent'; idempotencyKey: string; taskId: string; repo?: string; payload: Record<string, unknown>;signal:AbortSignal;deadline:string;assertCurrent:()=>void}) => Promise<{location: string; reason?: string; receipt?: {state?: string; summary?: string; error?: string; needsConfig?: boolean; verification?: string}}>} | undefined;
}): (taskId: string, deadline: string, host: SubagentHostOptions) => Promise<TaskSnapshot> {
  return async (taskId, deadline, host) => {
    const runtime = options.host.getRuntime();
    const remote = options.getRemote?.();
    const enabled = remote?.list().filter(item => item.enabled) ?? [];
    const note = (reason: string) => runtime.saveCheckpoint(taskId, NOTE_KEY, {location: 'local', reason});
    const asyncScope=readRuntimeAsyncSubagentScope(runtime,taskId);
    if(!remote||!enabled.length||asyncScope?.type||asyncScope?.control){
      if(asyncScope?.type||asyncScope?.control)note('远端尚不能执行原自定义类型或后续指示约束，未发送');
      else if(remote)note('no healthy remote host');
      return startRuntimeSubagentChild(host,taskId,deadline);
    }
    const child=runtime.getTask(taskId),binding=readRuntimeSubagentBinding(runtime,taskId);
    if(child.state==='waiting_reconciliation'||child.error?.code==='RESULT_UNKNOWN')throw new ProtocolError('RESULT_UNKNOWN','Original remote child must not be replayed');
    if(child.state!=='created'||child.cancelRequested)throw new ProtocolError('REVISION_CONFLICT','Original remote child is not waiting for admission');
    if(deadline!==(asyncScope?.deadline??binding.parentDeadline))throw new ProtocolError('UNAUTHORIZED','Original remote child deadline changed');
    const executionEpoch=runtime.readExecutionEpoch(taskId),parentEpoch=runtime.readExecutionEpoch(binding.parentTaskId);
    return runtime.runTask(taskId,async worker=>{
      let submitted=false;
      const unknown=()=>{
        worker.saveCheckpoint('async-subagent-remote-dispatch:v1',{state:'unknown',redo:false});
        const state=runtime.getTask(taskId).state;
        if(['running','cancelling'].includes(state))runtime.transitionTask(taskId,'waiting_reconciliation',{
          error:{code:'RESULT_UNKNOWN',message:'Remote subagent result is unknown; cancellation is not proof that remote execution stopped',retryable:false}});
      };
      const abort=()=>{if(submitted)unknown();};
      worker.signal.addEventListener('abort',abort,{once:true});
      try{
        if(worker.signal.aborted)throw new ProtocolError('CANCELLED','Remote child cancelled before dispatch');
        readRuntimeAsyncSubagentScope(runtime,taskId);
        worker.saveCheckpoint('async-subagent-remote-dispatch:v1',{state:'inflight',redo:false});
        submitted=true;
        const result=await remote.submit({kind:'async-subagent',idempotencyKey:`remote-subagent:${taskId}`,taskId,
          ...(enabled[0]?.repos?.[0]?{repo:enabled[0].repos[0]}:{}),payload:{goal:binding.goal,subtaskId:binding.subtaskId},
          signal:worker.signal,deadline:worker.deadline,assertCurrent:()=>{
            runtime.assertExecutionEpoch(taskId,executionEpoch);runtime.assertExecutionEpoch(binding.parentTaskId,parentEpoch);
            const current=runtime.getTask(taskId);
            if(!asyncScope?.confirmedSpawn||worker.signal.aborted||current.cancelRequested||current.state!=='running'
              ||!isDeepStrictEqual(readRuntimeSubagentBinding(runtime,taskId),binding)
              ||!isDeepStrictEqual(readRuntimeAsyncSubagentScope(runtime,taskId),asyncScope))
              throw new ProtocolError('UNAUTHORIZED','Original remote subagent scope changed');
          }});
        if(worker.signal.aborted||result.location==='remote'&&result.receipt?.state==='unknown'){
          unknown();return {resultSummary:'Remote subagent result requires reconciliation'};
        }
        if(result.location==='remote'&&result.receipt?.state==='succeeded'&&result.receipt.verification==='executed'&&result.receipt.needsConfig!==true){
          worker.saveCheckpoint('async-subagent-remote-dispatch:v1',{state:'confirmed',redo:false});
          return {resultSummary:`${String(result.receipt.summary||'远端执行器已回执')}\n（远端执行）`};
        }
        if(result.location==='remote'&&result.receipt?.state==='rejected'&&result.receipt.verification==='not-sent'){
          submitted=false;worker.saveCheckpoint('async-subagent-remote-dispatch:v1',{state:'not_sent',redo:false});
          throw new ProtocolError('UNAUTHORIZED','Remote dispatch was not authorized; no payload was sent');
        }
        if(result.location==='remote'&&result.receipt?.state==='failed'&&result.receipt.needsConfig!==true&&result.receipt.verification!=='needs-config'){
          worker.saveCheckpoint('async-subagent-remote-dispatch:v1',{state:'failed',redo:false});
          submitted=false;throw new ProtocolError('EXTERNAL_FAILURE',String(result.receipt.summary||result.receipt.error||'远端子任务失败'));
        }
        const needsConfiguration=result.receipt?.state==='failed'&&result.receipt.needsConfig===true&&result.receipt.verification==='needs-config';
        if(result.location!=='local'&&!needsConfiguration){
          unknown();return {resultSummary:'Remote subagent receipt is not conclusive'};
        }
        submitted=false;
        worker.saveCheckpoint('async-subagent-remote-dispatch:v1',{state:'not_sent',redo:false});
        note(result.location==='remote'?'远端主机没有配置模型命令':result.reason||'no healthy remote host');
        return runSubagentWorker(host,binding,worker);
      }catch(error){if(submitted){unknown();return {resultSummary:'Remote subagent result requires reconciliation'};}throw error;}
      finally{worker.signal.removeEventListener('abort',abort);}
    },{deadline,sideEffect:'external_write'});
  };
}

export function createDesktopAsyncSubagentTools(options: DesktopSubagentDispatchToolOptions & {
  globalCap?: number; perParentCap?: number; onReport?: (report: AsyncSubagentReport) => void;
  verifyUnknownWrite?: (taskId: string) => Promise<'applied' | 'not_applied' | 'unknown'>;
  getGrantedTools?: () => readonly string[];
  startChild?: (taskId: string, deadline: string, host: SubagentHostOptions) => Promise<TaskSnapshot>;
}): AsyncSubagentController {
  return createAsyncSubagentController({host: desktopSubagentHostOptions(options),
    ...(options.globalCap === undefined ? {} : {globalCap: options.globalCap}),
    ...(options.perParentCap === undefined ? {} : {perParentCap: options.perParentCap}),
    ...(options.onReport === undefined ? {} : {onReport: options.onReport}),
    ...(options.verifyUnknownWrite === undefined ? {} : {verifyUnknownWrite: options.verifyUnknownWrite}),
    ...(options.getGrantedTools === undefined ? {} : {getGrantedTools: options.getGrantedTools}),
    ...(options.startChild === undefined ? {} : {startChild: options.startChild})});
}
