import {TASK_FAILURE_REPAIR_CHECKPOINT, applyRepairOperatorChoice, repairCardView} from '@personal-agent/agentarts';

const actions = new Set(['retry', 'abandon', 'replan']);

/** 桌面只转发三个操作。批准不能由渲染进程打开。 */
export function createFailureRepairHost(runtime) {
  return {
    view(taskId) {
      return repairCardView(runtime.loadCheckpoint(taskId, TASK_FAILURE_REPAIR_CHECKPOINT));
    },
    act(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('失败处理参数无效');
      if (Object.keys(input).some(key => key !== 'taskId' && key !== 'action')) throw Error('失败处理不接受额外字段');
      if (typeof input.taskId !== 'string' || !input.taskId.trim() || !actions.has(input.action)) throw Error('失败处理参数无效');
      const task = runtime.getTask(input.taskId);
      if (task.state !== 'failed' && !(task.state === 'waiting_reconciliation' && task.error?.code === 'RESULT_UNKNOWN')) {
        throw Error('只有失败或待核实的任务可以处理');
      }
      const result = applyRepairOperatorChoice(
        runtime.loadCheckpoint(task.taskId, TASK_FAILURE_REPAIR_CHECKPOINT),
        {action: input.action},
        new Date().toISOString(),
      );
      runtime.saveCheckpoint(task.taskId, TASK_FAILURE_REPAIR_CHECKPOINT, result.record);
      let followUpTaskId;
      if (result.enqueueRead && typeof task.goal === 'string' && task.goal.trim() && !task.goal.startsWith('[')) {
        followUpTaskId = runtime.submitTask({
          goal: task.goal,
          conversationId: task.conversationId,
          idempotencyKey: `repair-${task.taskId}-${result.record.trace.attempts.length}`,
        }).taskId;
      }
      return {accepted: result.accepted, reason: result.reason, ...(followUpTaskId ? {followUpTaskId} : {}), repair: repairCardView(result.record)};
    },
  };
}
