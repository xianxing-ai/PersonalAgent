import {ProtocolError} from '@personal-agent/contracts';
import type {TaskSnapshot} from '@personal-agent/contracts';
import type {TaskRuntime} from '../index.js';

/** Runs one Scheduler-created personal dashboard task. Desktop must not call runTask.
 * The encrypted rollup file is the durable copy; this task only records that the read finished. */
export function dispatchPersonalDashboardTask(
  runtime: TaskRuntime,
  taskId: string,
  consume: (signal: AbortSignal) => Promise<{resultSummary: string}>,
): Promise<TaskSnapshot> | undefined {
  const task = runtime.getTask(taskId);
  if (task.state !== 'created' || task.cancelRequested) return undefined;
  if (!task.conversationId?.startsWith('personal-dashboard:')) {
    throw new ProtocolError('UNAUTHORIZED', 'Personal dashboard dispatch refused');
  }
  const baseNow = Math.max(Date.now(), Date.parse(task.updatedAt) || 0);
  return runtime.runTask(taskId, async worker => {
    if (worker.signal.aborted) throw new ProtocolError('CANCELLED', 'Personal dashboard rollup cancelled');
    const result = await consume(worker.signal);
    if (worker.signal.aborted) throw new ProtocolError('CANCELLED', 'Personal dashboard rollup cancelled');
    if (!result || typeof result.resultSummary !== 'string' || !result.resultSummary.trim()) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Personal dashboard rollup missing summary');
    }
    worker.saveCheckpoint('personal-dashboard-rollup', {conversationId: task.conversationId});
    return {resultSummary: result.resultSummary};
  }, {deadline: new Date(baseNow + 60_000).toISOString(), sideEffect: 'read'});
}
