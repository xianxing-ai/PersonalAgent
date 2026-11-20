import {stateNames} from '../features/conversation/state.js';

const roleNames = {
  coordinator: '任务执行', coder: '代码执行', researcher: '研究', reviewer: '审查',
  planner: '规划', verifier: '验证',
};
const activityNames = {
  tool_call: '开始执行', tool_result: '工具返回', approval_wait: '等待授权',
  approval_result: '授权结果',
};
const stepStates = {
  ...stateNames, completed: '已完成', allowed: '已授权', denied: '授权被拒绝', expired: '已过期',
};

function activityRows({steps = [], toolActivity = []}) {
  return [...steps, ...toolActivity];
}

export function mountPanelDelegatedTasks(root, {invoke, escape, report}) {
  const cards = new Map();

  function paintActivity(record) {
    const rows = activityRows(record.history ?? record.child);
    const html = rows.map(({label, kind, state}) => {
      const status = kind === 'tool_call' || kind === 'approval_wait'
        ? activityNames[kind] : stepStates[state] ?? activityNames[kind];
      return `<li data-state="${escape(state ?? '')}"><span>${escape(label)}</span>${status ? `<small>${escape(status)}</small>` : ''}</li>`;
    }).join('');
    if (html !== record.activityHtml) {
      record.activityHtml = html;
      record.steps.innerHTML = html;
    }
    record.message.textContent = record.readError ?? (rows.length ? '' : record.reading ? '读取执行步骤…' : '暂无执行步骤');
  }

  function readActivity(record) {
    if (!record.details.open || record.reading || record.readRevision === record.revision) return;
    const {parentTaskId, taskId} = record.child;
    const revision = record.revision;
    record.readRevision = revision;
    record.reading = true;
    record.readError = undefined;
    paintActivity(record);
    void invoke('task.subagentConversation', {parentTaskId, taskId}).then(history => {
      record.history = {steps: history.steps, toolActivity: history.toolActivity};
    }, () => {
      record.readError = '读取执行步骤失败';
    }).finally(() => {
      record.reading = false;
      paintActivity(record);
      if (cards.get(taskId) === record) readActivity(record);
    });
  }

  function createCard() {
    const element = document.createElement('section');
    element.className = 'delegated-task-card';
    element.innerHTML = `
      <header><strong></strong><span class="delegated-task-state"></span><button type="button">打开子对话</button></header>
      <p class="delegated-task-receipts"></p>
      <details><summary>执行步骤 <span></span></summary><ol></ol><p class="delegated-task-message"></p></details>`;
    const record = {
      element,
      role: element.querySelector('strong'),
      state: element.querySelector('.delegated-task-state'),
      receipts: element.querySelector('.delegated-task-receipts'),
      details: element.querySelector('details'),
      latest: element.querySelector('summary span'),
      steps: element.querySelector('ol'),
      message: element.querySelector('.delegated-task-message'),
    };
    const open = element.querySelector('button');
    open.onclick = async () => {
      const {parentTaskId, taskId} = record.child;
      open.disabled = true;
      try { await invoke('task.openSubagentConversation', {parentTaskId, taskId}); }
      catch (error) { if (element.isConnected) report(error); }
      finally { open.disabled = false; }
    };
    record.details.addEventListener('toggle', () => {
      if (record.details.open && record.readError) record.readRevision = undefined;
      readActivity(record);
    });
    return record;
  }

  return childrenByParent => {
    const visible = new Set();
    for (const slot of root.querySelectorAll('[data-delegated-for]')) {
      const children = childrenByParent.get(slot.dataset.delegatedFor) ?? [];
      children.forEach((child, index) => {
        visible.add(child.taskId);
        let record = cards.get(child.taskId);
        if (!record) {
          record = createCard();
          cards.set(child.taskId, record);
        }
        record.child = child;
        record.revision = JSON.stringify([child.updatedAt, child.state, child.steps, child.toolActivity, child.evidenceRefCount]);
        record.role.textContent = roleNames[child.role] ?? '子智能体';
        record.state.textContent = stateNames[child.state] ?? '状态未知';
        record.state.dataset.state = child.state;
        record.receipts.textContent = child.evidenceRefCount > 0 ? `回执 ${child.evidenceRefCount} 项` : '';
        record.latest.textContent = activityRows(child).at(-1)?.label ?? '';
        if (slot.children[index] !== record.element) slot.insertBefore(record.element, slot.children[index] ?? null);
        readActivity(record);
      });
    }
    for (const [taskId, card] of cards) {
      if (visible.has(taskId)) continue;
      card.element.remove();
      cards.delete(taskId);
    }
  };
}
