export function orbState(task) {
  if (!task) return 'idle';
  if (task.state === 'planning') return 'thinking';
  if (['running','verifying'].includes(task.state)) return 'executing';
  if (task.state.startsWith('waiting_') || task.state === 'cancelling') return 'waiting';
  return task.state === 'failed' ? 'error' : 'idle';
}
export const stateNames = {created:'已创建',planning:'思考中',running:'执行中',verifying:'验证中',waiting_approval:'等待授权',waiting_external:'等待外部结果',waiting_reconciliation:'结果待核实',cancelling:'正在取消',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
export const isTerminal = task => ['succeeded','failed','cancelled'].includes(task.state);
// A later completed turn must not hide an earlier task that is still running.
export function currentTask(tasks) {
  return tasks.findLast(task => !isTerminal(task)) ?? tasks.at(-1);
}
const LIVE_VOICE = new Set(['listening', 'speaking', 'connecting', 'reconnecting']);
/** Task motion wins over Live. Live speech follows the microphone and playback level. */
export function visualOrbState(data) {
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const base = data?.orbStateOverride ?? orbState(currentTask(tasks));
  if (base === 'thinking' || base === 'executing' || base === 'waiting' || base === 'error') return base;
  const live = data?.live;
  if (live?.active && live.status === 'working') return 'executing';
  if (live?.active && LIVE_VOICE.has(live.status)) return 'listening';
  return base;
}
