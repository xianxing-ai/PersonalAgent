import type {ScheduleInput, ScheduleSnapshot, TaskRuntime} from '../index.js';

/** Trusted composition only. enqueue/readReceipt must use the same durable,
 * idempotent local notification queue; neither callback invokes a model/tool. */
export function createReminderDeliveryHost(options: {
  runtime: TaskRuntime;
  conversationId: string;
  enqueue(schedule: ScheduleSnapshot): void;
  readReceipt(scheduleId: string): boolean;
  now?: () => number;
}) {
  const {runtime, conversationId} = options;
  let recovered = false;
  let pending: Promise<void> | undefined;
  let closed = false;
  const now = options.now ?? Date.now;
  return {
    tick(desired: readonly ScheduleInput[]): Promise<void> {
      if (closed) return Promise.resolve();
      if (pending) return pending;
      // Source persistence is read before scheduling. Failure leaves the old
      // schedule unprocessed until its source can be read and reconciled.
      runtime.reconcileSchedules(conversationId, desired);
      if (recovered) runtime.dispatchDueSchedules(conversationId);
      else {runtime.recoverMissedSchedules(conversationId); recovered = true;}
      pending = (async () => {
        for (const schedule of runtime.listSchedules(conversationId)) {
          if (closed || schedule.status !== 'fired' || !schedule.taskId) continue;
          const task = runtime.getTask(schedule.taskId);
          if (task.cancelRequested) continue;
          if (task.state === 'created') {
            await runtime.runTask(task.taskId, async context => {
              if (closed || context.signal.aborted) throw Error('Reminder delivery stopped');
              if (!options.readReceipt(schedule.scheduleId)) options.enqueue(schedule);
              if (!options.readReceipt(schedule.scheduleId)) throw Error('Reminder queue did not confirm persistence');
              context.saveCheckpoint('local-reminder-receipt', {scheduleId:schedule.scheduleId});
              return {resultSummary:'提醒已进入宿主通知队列；尚不代表设备送达或用户已阅读'};
            }, {deadline:new Date(now() + 30_000).toISOString(), sideEffect:'local_write'});
          } else if (task.state === 'waiting_reconciliation' && options.readReceipt(schedule.scheduleId)) {
            // Readback only: unknown writes are never repeated here.
            runtime.reconcileTask(task.taskId, 'confirmed');
          }
        }
      })().finally(() => {pending = undefined;});
      return pending;
    },
    async close() {closed = true; await pending;},
  };
}
