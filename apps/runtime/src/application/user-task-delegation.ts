import {ProtocolError} from '@personal-agent/contracts';
import {parseExecutionModelSelection} from '@personal-agent/coordination';
import type {CoordinationPort, CoordinationToolProposalResult} from '@personal-agent/coordination';
import type {SubtaskDefinition} from '@personal-agent/agents';
import {SUBAGENT_DISPATCH_TOOL_NAME, SUBAGENT_DISPATCH_TOOL_VERSION} from './subagent-host.js';
import type {TaskRuntime} from '../index.js';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {isDeepStrictEqual} from 'node:util';

export const USER_TASK_DELEGATION = 'required-subagent-delegation:v1';
export interface UserTaskDelegation {
  version: '1.0'; parentTaskId: string; goal: string; deadline: string; maxSteps: number; subtask: SubtaskDefinition;
}

/** Only newly accepted user tasks receive this trusted binding; existing tasks are never redelegated. */
export function readUserTaskDelegation(runtime: TaskRuntime, taskId: string): UserTaskDelegation | undefined {
  const saved = runtime.loadCheckpoint(taskId, USER_TASK_DELEGATION) as UserTaskDelegation | undefined;
  if (saved === undefined) return undefined;
  const task = runtime.getTask(taskId);
  const model = runtime.loadCheckpoint(taskId, 'execution-model');
  const selected = model === undefined ? undefined : parseExecutionModelSelection(model);
  const thinking = runtime.loadCheckpoint(taskId, 'task-thinking') as {depth?: number;maxSteps?:number} | undefined;
  const expected = {subtaskId: 'user-work', role: 'coordinator', roleLabel: '任务执行', goal: task.goal,
    thinkingDepth: thinking?.depth,
    ...(selected ? {model: selected.modelId, ...(selected.reasoningEffort ? {reasoningEffort: selected.reasoningEffort} : {})} : {})};
  if (saved.version !== '1.0' || saved.parentTaskId !== taskId || saved.goal !== task.goal
    || saved.deadline !== runtime.loadCheckpoint(taskId, 'application-deadline')
    || !Number.isSafeInteger(saved.maxSteps) || saved.maxSteps < 2 || saved.maxSteps !== thinking?.maxSteps
    || saved.maxSteps !== runtime.loadCheckpoint(taskId, 'competition-max-steps')
    || !Number.isInteger(thinking?.depth) || !isDeepStrictEqual(saved.subtask, expected)) {
    throw new ProtocolError('REVISION_CONFLICT', 'Original user task delegation binding changed');
  }
  return saved;
}

export function userTaskDelegationProposal(binding: UserTaskDelegation): CoordinationToolProposalResult {
  return {kind: 'tool_proposal', proposalId: `required-delegation-${binding.parentTaskId}`,
    toolName: SUBAGENT_DISPATCH_TOOL_NAME, toolVersion: SUBAGENT_DISPATCH_TOOL_VERSION,
    arguments: {subtasks: [structuredClone(binding.subtask)]}, verification: 'unverified'};
}

/** Enforced both before requesting approval and by the actual Gateway policy boundary. */
export function assertUserTaskDelegationInvocation(runtime: TaskRuntime,
  input: {taskId: string; toolName: string; authorizationRef: string; argumentsDigest?: string}): void {
  const binding = readUserTaskDelegation(runtime, input.taskId);
  if (!binding) return;
  const proposal = userTaskDelegationProposal(binding);
  if (input.toolName !== proposal.toolName || input.authorizationRef !== `competition-tool-${input.taskId}-1`
    || input.argumentsDigest !== toolArgumentsDigest(proposal.arguments)) {
    throw new ProtocolError('SCOPE_DENIED', 'User conversation may only dispatch its original bound child');
  }
}

/** Reuses the original Competition loop and authorization path; no additional executor or scheduler. */
export function userTaskDelegationPort(runtime: TaskRuntime, port: CoordinationPort,
  binding: UserTaskDelegation): CoordinationPort {
  return {execute: async request => {
    const current = readUserTaskDelegation(runtime, request.taskId);
    if (!isDeepStrictEqual(current, binding) || request.goal !== binding.goal || request.deadline !== binding.deadline) {
      throw new ProtocolError('REVISION_CONFLICT', 'Original user task delegation scope changed');
    }
    const proposal = userTaskDelegationProposal(binding);
    // The host, not a prompt or a model decision, requires a real child before any cloud summary.
    if (request.continuation === undefined) return proposal;
    const runId = `competition-tool-${request.taskId}-1`;
    const child = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${request.taskId}-${binding.subtask.subtaskId}`);
    const record = runtime.readToolExecutions(request.taskId).find(item => item.evidenceId === runId);
    if (request.continuation.proposalId !== proposal.proposalId || !child
      || child.conversationId !== `desktop-subtask:${request.taskId}`
      || !['succeeded', 'failed', 'cancelled'].includes(child.state)
      || !record || record.toolName !== proposal.toolName || record.toolVersion !== proposal.toolVersion
      || record.state !== 'confirmed' || !record.executionStarted || record.policyDecision !== 'allow'
      || !runtime.matchesToolExecutionInput(record, {arguments: proposal.arguments, scopeRef: runId})) {
      throw new ProtocolError('UNAUTHORIZED', 'User summary requires its original confirmed child receipt');
    }
    const result = await port.execute(request);
    if (result.kind !== 'text') throw new ProtocolError('SCOPE_DENIED', 'User conversation may only summarize delegated results');
    return result;
  }};
}
