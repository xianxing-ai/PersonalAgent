import {currentTask, stateNames} from './state.js';

const hints = {
  created: '任务已受理，等待开始。', planning: '正在整理执行计划。',
  running: '正在执行，新的进展会显示在这里。', verifying: '正在核对执行结果。',
  waiting_approval: '需要你的确认后才能继续，请查看任务中的授权请求。',
  waiting_external: '正在等待外部结果。',
  waiting_reconciliation: '未取得有效执行回执，暂不能确认是否已执行；请勿重复提交同一操作。',
  cancelling: '已请求停止，正在等待执行结束。',
  succeeded: '任务已完成，可以查看这轮对话的结果。',
  failed: '任务未完成，请查看这轮对话中的错误说明。',
  cancelled: '任务已取消；已经发生的外部操作不会因此自动撤销。',
};

export function taskProgress(tasks) {
  const task = currentTask(Array.isArray(tasks) ? tasks : []);
  if (!task) return null;
  const step = ['running', 'planning', 'verifying'].includes(task.state)
    ? task.steps?.find(item => ['running', 'executing', 'verifying'].includes(item.state)) : undefined;
  return {state: task.state, label: stateNames[task.state] ?? '状态待确认',
    detail: task.state==='waiting_reconciliation'&&task.error?.message ? task.error.message
      : step?.label ? `当前步骤：${step.label}` : hints[task.state] ?? '等待新的任务状态。'};
}

// Presentation only: consumes the existing Runtime snapshot and never advances task state.
export function mountTaskProgress(container, before = null) {
  const status = document.createElement('section');
  status.className = 'task-progress';status.hidden = true;
  status.setAttribute('role', 'status');status.setAttribute('aria-live', 'polite');status.setAttribute('aria-atomic', 'true');
  const label = document.createElement('strong'), detail = document.createElement('span');
  status.append(label, detail);container.insertBefore(status, before);
  let signature;
  return tasks => {
    const value = taskProgress(tasks), next = JSON.stringify(value);
    if (signature === next) return;
    signature = next;status.hidden = !value;
    if (!value) {label.textContent = '';detail.textContent = '';delete status.dataset.state;return;}
    status.dataset.state = value.state;label.textContent = value.label;detail.textContent = value.detail;
  };
}
