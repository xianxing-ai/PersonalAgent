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

export function taskProgress(tasks, computer, authorization = {}) {
  const task = currentTask(Array.isArray(tasks) ? tasks : []);
  if (!task) return null;
  if (['running','planning','waiting_approval'].includes(task.state) && authorization.conversationId
    && authorization.questions?.some(question=>question.conversationId===authorization.conversationId
      && question.state==='pending' && Date.parse(question.expiresAt)>(authorization.now??Date.now()))) {
    return {state:task.state,label:'等待操作授权',detail:'操作尚未获准执行。请查看下方授权卡；也可以停止当前任务。'};
  }
  // Main has already restricted this projection to the visible conversation,
  // including its executing child. Do not relabel the persisted Runtime state.
  if (['running', 'planning', 'waiting_approval'].includes(task.state)
    && computer?.waitingConfirmation === true && typeof computer.activeTaskId === 'string') {
    return {state: task.state, label: '等待本机确认',confirmationTaskId:computer.activeTaskId,
      detail: '电脑操作尚未开始。确认本次在场后继续原任务；也可保持目标应用在前台按 F9。任务中的停止按钮随时可用。'};
  }
  const step = ['running', 'planning', 'verifying'].includes(task.state)
    ? task.steps?.find(item => ['running', 'executing', 'verifying'].includes(item.state)) : undefined;
  return {state: task.state, label: stateNames[task.state] ?? '状态待确认',
    detail: task.state==='waiting_reconciliation'&&task.error?.message ? task.error.message
      : step?.label ? `当前步骤：${step.label}` : hints[task.state] ?? '等待新的任务状态。'};
}

// Presentation only: consumes the existing Runtime snapshot and never advances task state.
export function mountTaskProgress(container, before = null, confirmPresence) {
  const status = document.createElement('section');
  status.className = 'task-progress';status.hidden = true;
  status.setAttribute('role', 'status');status.setAttribute('aria-live', 'polite');status.setAttribute('aria-atomic', 'true');
  const label = document.createElement('strong'), detail = document.createElement('span');
  status.append(label, detail);container.insertBefore(status, before);
  let signature,current,pending=false;
  const confirm=typeof confirmPresence==='function'?document.createElement('button'):null;
  if(confirm){confirm.type='button';confirm.textContent='确认本次在场';confirm.hidden=true;status.append(confirm);
    confirm.onclick=async()=>{
      const taskId=current?.confirmationTaskId;if(!taskId||pending)return;
      pending=true;confirm.disabled=true;
      try{await confirmPresence(taskId);}
      catch{if(current?.confirmationTaskId===taskId)detail.textContent='本次确认未获回执，请查看原任务状态；不会自动重试。';}
      finally{pending=false;confirm.disabled=false;}
    };
  }
  return (tasks, computer, authorization) => {
    const value = taskProgress(tasks, computer, authorization), next = JSON.stringify(value);
    current=value;if(confirm)confirm.hidden=!value?.confirmationTaskId;
    if (signature === next) return;
    signature = next;status.hidden = !value;
    if (!value) {label.textContent = '';detail.textContent = '';delete status.dataset.state;return;}
    status.dataset.state = value.state;label.textContent = value.label;detail.textContent = value.detail;
  };
}
