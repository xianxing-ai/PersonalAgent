import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {ToolDescriptor} from '@personal-agent/contracts';
import type {SubtaskDefinition} from '@personal-agent/agents';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {TaskRuntime} from '../index.js';

const actions = ['continue', 'summary', 'notify_controller', 'request_controller'] as const;
export type OriginalControllerAction = typeof actions[number];
export interface OriginalChildControllerReport {
  reportId: string; parentTaskId: string; childTaskId: string; expectedChildRevision: number;
  problem: string; candidates: string[]; nextSteps: string[];
}
export interface OriginalChildControllerAdvice {advice: string; nextTool: string | null;}
export interface OriginalChildControllerPorts {
  /** Synchronous so a crash cannot sit between the advice and its durable report. */
  decide(input: {report: OriginalChildControllerReport; signal: AbortSignal; deadline: string}): {selectedId: string; decided_by: string};
  advise?(input: {report: OriginalChildControllerReport; availableTools: Array<{name: string; version: string}>; signal: AbortSignal; deadline: string}): OriginalChildControllerAdvice;
  listTools(): readonly ToolDescriptor[];
}
export interface OriginalChildControllerDecision {
  version: 1; inputDigest: string; reportId: string; parentTaskId: string; childTaskId: string; subtaskId: string;
  childRevision: number; action: OriginalControllerAction; decidedBy: string; trainingPerformed: false;
  executionRequiresOriginalPolicy: true; controllerAdvice?: OriginalChildControllerAdvice;
  notification: {stepId: string; state: 'published' | 'pending' | 'not_requested'};
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function fail(code: 'INVALID_ARGUMENT' | 'UNAUTHORIZED' | 'REVISION_CONFLICT' | 'UNSUPPORTED_CAPABILITY' | 'TIMEOUT' | 'CANCELLED', message: string): never {
  throw new ProtocolError(code, message);
}
function live(deadline: string, signal: AbortSignal): void {
  if (signal.aborted) fail('CANCELLED', 'Original child report was cancelled');
  if (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= Date.now()) fail('TIMEOUT', 'Original child report deadline expired');
}
function childBinding(runtime: TaskRuntime, report: OriginalChildControllerReport) {
  const bound = runtime.loadCheckpoint(report.childTaskId, 'subtask-parent') as (SubtaskDefinition & {parentTaskId?: string}) | undefined;
  const child = runtime.getTask(report.childTaskId), parent = runtime.getTask(report.parentTaskId);
  const subtaskId = bound?.subtaskId;
  if (!bound || !subtaskId || bound.parentTaskId !== report.parentTaskId || child.conversationId !== 'desktop-subtask:' + report.parentTaskId
    || runtime.findTaskByIdempotencyKey('subagent-dispatch-' + report.parentTaskId + '-' + subtaskId)?.taskId !== child.taskId)
    fail('UNAUTHORIZED', 'Child report is not bound to the original parent');
  if (child.revision !== report.expectedChildRevision) fail('REVISION_CONFLICT', 'Child report revision changed');
  if ([parent, child].some(task => task.cancelRequested || ['cancelling', 'cancelled'].includes(task.state))
    || ['succeeded', 'failed'].includes(parent.state)) fail('REVISION_CONFLICT', 'Parent or child no longer accepts a new report');
  return {subtaskId, child, parent};
}
/**
 * Consume one already bound child report on the parent. Teacher advice may only name a tool
 * from the child's original registration and never creates a grant.
 */
export function consumeOriginalChildControllerAdvice(runtime: TaskRuntime, report: OriginalChildControllerReport,
  ports: OriginalChildControllerPorts, context: {deadline: string; signal: AbortSignal}): OriginalChildControllerDecision {
  live(context.deadline, context.signal);
  if (!text(report.reportId) || !text(report.parentTaskId) || !text(report.childTaskId) || !text(report.problem)
    || !Number.isSafeInteger(report.expectedChildRevision) || ![report.candidates, report.nextSteps].every(items => Array.isArray(items) && items.every(text))
    || typeof ports.decide !== 'function' || typeof ports.listTools !== 'function')
    fail('INVALID_ARGUMENT', 'Original child report is incomplete');
  const inputDigest = toolArgumentsDigest(report);
  const childKey = 'delegation:controller:' + report.reportId;
  const prior = runtime.loadCheckpoint(report.childTaskId, childKey) as OriginalChildControllerDecision | undefined;
  if (prior) {
    if (prior.inputDigest !== inputDigest || prior.parentTaskId !== report.parentTaskId) fail('REVISION_CONFLICT', 'Original child report changed');
    return prior;
  }
  const {subtaskId, child} = childBinding(runtime, report);
  const intent = {inputDigest, expectedChildRevision: child.revision};
  if (!runtime.saveCheckpointOnce(report.childTaskId, childKey + ':intent', intent)
    && !isDeepStrictEqual(runtime.loadCheckpoint(report.childTaskId, childKey + ':intent'), intent))
    fail('REVISION_CONFLICT', 'Original child report intent changed');
  const selected = ports.decide({report: structuredClone(report), signal: context.signal, deadline: context.deadline});
  if (!actions.includes(selected.selectedId as OriginalControllerAction) || !text(selected.decided_by))
    fail('INVALID_ARGUMENT', 'Unknown controller action');
  childBinding(runtime, report);
  let controllerAdvice: OriginalChildControllerAdvice | undefined;
  if (selected.selectedId === 'request_controller') {
    const frozen = runtime.loadCheckpoint(report.childTaskId, 'subtask-tools-binding');
    const registered: readonly ToolDescriptor[] = Array.isArray(frozen) ? frozen as ToolDescriptor[] : [];
    if (!registered.length) fail('UNSUPPORTED_CAPABILITY', 'Original child tool binding is unavailable');
    const current = ports.listTools();
    if (registered.some(tool => !current.some(item => item.name === tool.name && item.version === tool.version)))
      fail('UNSUPPORTED_CAPABILITY', 'Bound child tool registration changed');
    const advise = ports.advise;
    if (typeof advise !== 'function') fail('UNSUPPORTED_CAPABILITY', 'Original controller advice is unavailable');
    controllerAdvice = advise({report: structuredClone(report), availableTools: registered.map(tool => ({name: tool.name, version: tool.version})),
      signal: context.signal, deadline: context.deadline});
    if (!controllerAdvice || !text(controllerAdvice.advice)) fail('UNSUPPORTED_CAPABILITY', 'Controller advice is malformed');
    const nextTool = controllerAdvice.nextTool;
    if (nextTool !== null && !registered.some(tool => tool.name === nextTool))
      fail('UNSUPPORTED_CAPABILITY', 'Controller requested an unregistered tool');
    childBinding(runtime, report);
  }
  const stepId = 'delegation-' + report.childTaskId + '-' + report.reportId;
  const value: OriginalChildControllerDecision = {version: 1, inputDigest, reportId: report.reportId, parentTaskId: report.parentTaskId,
    childTaskId: report.childTaskId, subtaskId, childRevision: child.revision, action: selected.selectedId as OriginalControllerAction,
    decidedBy: selected.decided_by, trainingPerformed: false, executionRequiresOriginalPolicy: true,
    ...(controllerAdvice ? {controllerAdvice} : {}),
    notification: {stepId, state: selected.selectedId === 'notify_controller' || selected.selectedId === 'request_controller' ? 'pending' : 'not_requested'}};
  if (!runtime.saveCheckpointOnce(report.childTaskId, childKey, value)) fail('REVISION_CONFLICT', 'Original child report changed');
  runtime.saveCheckpoint(report.parentTaskId, 'delegation:child:' + subtaskId, value);
  if (value.notification.state === 'pending') {
    try {runtime.recordProgress(report.parentTaskId, {stepId, label: 'Bound child ' + subtaskId + ' ' + value.action}); value.notification = {...value.notification, state: 'published'};}
    catch {value.notification = {...value.notification, state: runtime.readEvents().some(event => event.taskId === report.parentTaskId && event.type === 'task.progress' && (event.payload as {stepId?: string}).stepId === stepId) ? 'published' : 'pending'};}
    runtime.saveCheckpoint(report.childTaskId, childKey, value);
    runtime.saveCheckpoint(report.parentTaskId, 'delegation:child:' + subtaskId, value);
  }
  return value;
}
