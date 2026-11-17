import {
  TASK_FAILURE_READONLY_RETRY_CHECKPOINT,
  TASK_FAILURE_REPAIR_CHECKPOINT,
  applyRepairOperatorChoice,
  goalContainsWriteIntent,
  repairCardView,
} from '@personal-agent/agentarts';

const actions = new Set(['retry', 'abandon', 'replan']);

function inspectReadRetryEligibility(runtime, task) {
  const records = typeof runtime.readToolExecutions === 'function' ? runtime.readToolExecutions(task.taskId) : [];
  if (records.slice(0, -1).some(record => record.executionStarted || record.state === 'confirmed' || record.state === 'unknown')) {
    return {allowed: false, reason: '此前步骤已有执行或副作用，不能单独重试只读，请交给父 agent 重新规划'};
  }
  if (typeof task?.goal !== 'string' || !task.goal.trim() || task.goal.startsWith('[') || goalContainsWriteIntent(task.goal)) {
    return {allowed: false, reason: '原任务目标包含写入或修改操作，不能作为只读重试，请交给父 agent 重新规划'};
  }
  const lastRecord = records.at(-1);
  return {
    allowed: true,
    ...(lastRecord
      ? {
          boundTool: {
            toolName: lastRecord.toolName,
            toolVersion: lastRecord.toolVersion,
            inputDigest: lastRecord.inputDigest,
          },
        }
      : {}),
  };
}

/** 桌面只转发三个操作。批准不能由渲染进程打开。 */
export function createFailureRepairHost(runtime) {
  return {
    view(taskId) {
      const card = repairCardView(runtime.loadCheckpoint(taskId, TASK_FAILURE_REPAIR_CHECKPOINT));
      if (!card || !card.canRetryRead) return card;
      try {
        const task = runtime.getTask?.(taskId);
        if (task && !inspectReadRetryEligibility(runtime, task).allowed) {
          return {...card, canRetryRead: false};
        }
      } catch {
        return {...card, canRetryRead: false};
      }
      return card;
    },
    act(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('失败处理参数无效');
      if (Object.keys(input).some(key => key !== 'taskId' && key !== 'action')) throw Error('失败处理不接受额外字段');
      if (typeof input.taskId !== 'string' || !input.taskId.trim() || !actions.has(input.action)) throw Error('失败处理参数无效');
      const task = runtime.getTask(input.taskId);
      if (task.state !== 'failed' && !(task.state === 'waiting_reconciliation' && task.error?.code === 'RESULT_UNKNOWN')) {
        throw Error('只有失败或待核实的任务可以处理');
      }
      const eligibility = inspectReadRetryEligibility(runtime, task);
      if (input.action === 'retry' && !eligibility.allowed) {
        return {
          accepted: false,
          reason: eligibility.reason,
          repair: this.view(task.taskId),
        };
      }
      const result = applyRepairOperatorChoice(
        runtime.loadCheckpoint(task.taskId, TASK_FAILURE_REPAIR_CHECKPOINT),
        {action: input.action},
        new Date().toISOString(),
      );
      runtime.saveCheckpoint(task.taskId, TASK_FAILURE_REPAIR_CHECKPOINT, result.record);
      let followUpTaskId;
      if (result.enqueueRead && eligibility.allowed) {
        const binding = {
          version: 1,
          sourceTaskId: task.taskId,
          readOnly: true,
          ...(eligibility.boundTool ?? {}),
        };
        const submitInput = {
          goal: task.goal,
          conversationId: task.conversationId,
          idempotencyKey: `repair-${task.taskId}-${result.record.trace.attempts.length}`,
        };
        if (typeof runtime.submitTaskWithCheckpoint === 'function') {
          followUpTaskId = runtime.submitTaskWithCheckpoint(submitInput, TASK_FAILURE_READONLY_RETRY_CHECKPOINT, binding).taskId;
        } else {
          followUpTaskId = runtime.submitTask(submitInput).taskId;
          runtime.saveCheckpoint?.(followUpTaskId, TASK_FAILURE_READONLY_RETRY_CHECKPOINT, binding);
        }
      }
      return {accepted: result.accepted, reason: result.reason, ...(followUpTaskId ? {followUpTaskId} : {}), repair: this.view(task.taskId)};
    },
  };
}
