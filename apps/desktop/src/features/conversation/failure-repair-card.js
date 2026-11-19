const labels = {
  transient: '瞬时', correctable: '可修正', unrecoverable: '不可恢复',
  backoff_retry: '退避后重试', change_arguments: '更换参数', change_tool: '更换工具',
  degrade_readonly: '改为只读', request_parent_replan: '交给父 agent', reconcile_status: '先查状态', stop: '停止',
  selected: '已选择', awaiting_approval: '等待批准', held_for_backoff: '等待退避', stopped: '已停止', reconcile: '核对状态',
};

/** 失败卡片只保留分类、时间线和当前真正能做的操作。 */
export function failureRepairModel(tasks) {
  const task = [...(Array.isArray(tasks) ? tasks : [])].reverse().find(item => item?.state === 'failed' && item.repair);
  const repair = task?.repair;
  if (!repair) return undefined;
  const buttons = [];
  if (repair.canRetryRead) buttons.push({action: 'retry', label: '重试'});
  if (repair.canReplan) buttons.push({action: 'replan', label: '交给父 agent'});
  if (repair.canAbandon) buttons.push({action: 'abandon', label: '放弃'});
  return {
    taskId: task.taskId,
    title: `失败 · ${labels[repair.classification] ?? '未分类'}`,
    reason: repair.risk === 'high' && !repair.abandoned
      ? '高风险动作需要原有授权通过后才能重试或交给父 agent。'
      : repair.recovery?.reason ?? '',
    attempts: (repair.attempts ?? []).map(item => ({
      when: item.observedAt,
      strategy: labels[item.strategy] ?? item.strategy,
      result: labels[item.result] ?? item.result,
      reason: item.reason,
    })),
    replayNote: '这次查看只重放决策，没有重新执行。',
    buttons,
    errorMessage: typeof task.error?.message === 'string' ? task.error.message : '',
    hasDiagnostic: Boolean(task.hasCommandDiagnostic || task.error?.message),
  };
}

export function formatLocatedFailureLines(report) {
  const failures = report && typeof report === 'object' && Array.isArray(report.failures) ? report.failures : [];
  if (!failures.length) return ['未能从错误输出定位到源码位置'];
  return failures.slice(0, 3).map(failure => {
    const top = Array.isArray(failure?.frames) ? failure.frames[0] : undefined;
    const location = top
      ? `${top.file}:${top.line}${top.column !== undefined ? `:${top.column}` : ''}（置信度 ${Math.round((Number(top.confidence) || 0) * 100)}%）`
      : '无源码帧';
    return `${failure?.name ?? '诊断'} · ${location}`;
  });
}

export function mountFailureRepairCard(container, before, invoke) {
  const section = document.createElement('section');
  section.className = 'task-progress failure-repair';
  section.dataset.state = 'failed';
  section.hidden = true;
  container.insertBefore(section, before);
  let signature = '';
  let pending = false;
  let locatePending = false;
  let currentModel;
  section.addEventListener('click', event => {
    const locateButton = event.target.closest('button[data-repair-locate]');
    if (locateButton) {
      if (locateButton.disabled || locatePending || !currentModel) return;
      const resultNode = section.querySelector('[data-repair-locate-result]');
      locatePending = true;
      locateButton.disabled = true;
      if (resultNode) { resultNode.hidden = false; resultNode.textContent = '定位中…'; }
      const targetTaskId = currentModel.taskId;
      void Promise.resolve(invoke('task.locate', {taskId: targetTaskId, text: currentModel.errorMessage}))
        .then(report => {
          if (currentModel?.taskId !== targetTaskId || !resultNode) return;
          resultNode.hidden = false;
          resultNode.textContent = formatLocatedFailureLines(report).join('\n');
        }, error => {
          if (currentModel?.taskId !== targetTaskId || !resultNode) return;
          resultNode.hidden = false;
          resultNode.textContent = `定位失败：${error?.message || '未知错误'}`;
        })
        .finally(() => { locatePending = false; locateButton.disabled = false; });
      return;
    }
    const button = event.target.closest('button[data-repair]');
    if (!button || button.disabled || pending) return;
    pending = true;
    button.disabled = true;
    void Promise.resolve(invoke('task.repair', {taskId: button.dataset.id, action: button.dataset.repair}))
      .finally(() => {pending = false; button.disabled = false;});
  });
  return tasks => {
    const model = failureRepairModel(tasks);
    currentModel = model;
    const next = JSON.stringify(model);
    if (signature === next) return;
    signature = next;
    section.replaceChildren();
    section.hidden = !model;
    if (!model) return;
    const title = document.createElement('strong');
    title.textContent = model.title;
    const body = document.createElement('div');
    const reason = document.createElement('p');
    reason.textContent = model.reason;
    const list = document.createElement('ol');
    for (const item of model.attempts) {
      const row = document.createElement('li');
      const when = Number.isFinite(Date.parse(item.when)) ? new Date(item.when).toLocaleString() : item.when;
      row.textContent = `${when} · ${item.strategy} · ${item.result} · ${item.reason}`;
      list.append(row);
    }
    const note = document.createElement('p');
    note.textContent = model.replayNote;
    body.append(reason, list, note);
    const actions = document.createElement('p');
    for (const button of model.buttons) {
      const element = document.createElement('button');
      element.type = 'button';
      element.dataset.repair = button.action;
      element.dataset.id = model.taskId;
      element.textContent = button.label;
      actions.append(element);
    }
    if (model.hasDiagnostic) {
      const locate = document.createElement('button');
      locate.type = 'button';
      locate.dataset.repairLocate = '1';
      locate.dataset.id = model.taskId;
      locate.textContent = '定位源码位置';
      actions.append(locate);
    }
    if (actions.childNodes.length) body.append(actions);
    if (model.hasDiagnostic) {
      const locateResult = document.createElement('pre');
      locateResult.dataset.repairLocateResult = '1';
      locateResult.hidden = true;
      body.append(locateResult);
    }
    section.append(title, body);
  };
}
