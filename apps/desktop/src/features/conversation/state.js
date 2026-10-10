export function orbState(task) {
  if (!task) return 'idle';
  if (task.state === 'planning') return 'thinking';
  if (['running','verifying'].includes(task.state)) return 'executing';
  if (task.state.startsWith('waiting_') || task.state === 'cancelling') return 'waiting';
  return task.state === 'failed' ? 'error' : 'idle';
}
export const stateNames = {created:'已创建',planning:'思考中',running:'执行中',verifying:'验证中',waiting_approval:'等待授权',waiting_external:'等待外部结果',waiting_reconciliation:'结果待核实',cancelling:'正在取消',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
export const isTerminal = task => ['succeeded','failed','cancelled'].includes(task.state);
const liveStatusNames={connecting:'正在连接',reconnecting:'正在续接',listening:'正在聆听',speaking:'正在回答',working:'正在处理任务',stopping:'正在关闭',error:'连接失败'};
export function orbStatusLabel(data) {
  const task=currentTask(Array.isArray(data?.tasks)?data.tasks:[]);
  if(task&&(!isTerminal(task)||task.state==='failed'))return stateNames[task.state]??'待机';
  if(data?.live?.active)return liveStatusNames[data.live.status]??'Live 已开启';
  return stateNames[task?.state]??'待机';
}
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
