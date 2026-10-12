const escape = value => String(value ?? '').replace(/[&<>"']/g,
  char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const taskState = value => ({created:'已创建',running:'运行中',cancelling:'正在取消',waiting_approval:'等待审批',
  waiting_reconciliation:'等待结果核实',succeeded:'已完成',failed:'失败',cancelled:'已取消'}[value] ?? value);

/** Only metadata and opaque references enter this independent admin component. */
export function memoryLearningControlsHtml({status = {}, refs = [], version = null,
  active = null, taskId = '', runningTask = null, message = '', form = {}} = {}) {
  const workflow = version ? `<p>版本 v${escape(version.revision)} · ${escape({candidate:'待验证',passed:'验证通过',failed:'验证失败'}[version.validation] ?? version.validation)} ·
    ${version.hasEvidence ? '有 Runtime 验证记录' : '等待验证'}</p>` : '<p>尚未选择流程版本。</p>';
  const memories = refs.map((ref, index) => `<div class="setting-row"><span>私人记忆 ${index + 1} · v${escape(ref.revision)}</span>
    <div class="setting-control"><button class="btn btn-sm" data-ml-use="${index}" data-conversation="desktop-panel">用于主对话</button>
    <button class="btn btn-sm" data-ml-use="${index}" data-conversation="desktop-workspace">用于工作区</button>
    <button class="btn btn-sm" data-ml-withdraw="${index}">撤回消费</button>
    <button class="btn btn-sm" data-ml-delete="${index}">删除历史</button></div></div>`).join('');
  return `<section class="card memory-learning-panel" aria-label="私人记忆与流程学习">
    <h3>私人记忆</h3><p>${status.writeEnabled ? '确认写入已接通' : '写入未接通'} · 当前应用库删除保障</p>
    <p class="muted">撤回立即停止消费；删除保留 Vault 原文件。外部副本由用户自行管理。</p>
    ${memories || '<p>没有选中的私人记忆引用。</p>'}
    <h3>流程学习</h3><p class="muted">固定参考摘要 Skill：验证任务通过后单独确认启用，可选择旧已验证版本回退。</p>
    <div class="settings-form">
    <label>流程 ID<input name="ml-workflow" value="${escape(form.workflowId ?? version?.workflowId ?? 'reference-review')}" maxlength="128"></label>
    <label>参考文件相对路径<input name="ml-path" value="${escape(form.path ?? '')}" placeholder="reference.md" maxlength="480"></label>
    <label>流程说明<input name="ml-summary" value="${escape(form.summary ?? '')}" maxlength="1024" placeholder="读取已授权参考并返回摘要"></label>
    <label>查看版本<input name="ml-revision" type="text" inputmode="numeric" value="${escape(form.revision ?? version?.revision ?? 1)}"></label>
    </div>
    ${workflow}<p>当前启用：${active ? `v${escape(active.revision)}` : '无'}</p>
    ${taskId ? `<p>验证任务：${escape(taskId)}</p>` : ''}
    ${runningTask ? `<p>可停止任务：${escape(runningTask.taskId)} · v${escape(runningTask.revision)}</p>` : ''}
    <div class="form-actions">
      <button class="btn btn-sm" data-ml-action="read">读取版本</button>
      <button class="btn btn-sm" data-ml-action="propose">生成候选</button>
      <button class="btn btn-sm" data-ml-action="startValidation" ${!version || taskId ? 'disabled' : ''}>提交验证任务</button>
      <button class="btn btn-sm" data-ml-action="validate" ${taskId ? '' : 'disabled'}>读回验证</button>
      <button class="btn btn-sm" data-ml-action="activate" ${version?.validation === 'passed' ? '' : 'disabled'}>确认启用此版本</button>
      <button class="btn btn-sm" data-ml-action="run" ${active ? '' : 'disabled'}>运行已启用版本</button>
      <button class="btn btn-sm" data-ml-action="stop" ${runningTask ? '' : 'disabled'}>停止或核实此任务</button>
      <button class="btn btn-sm" data-ml-action="erase" ${version ? '' : 'disabled'}>删除流程</button>
    </div><p class="muted">${status.learningAvailable ? '学习宿主已配置' : '学习宿主未配置'}</p>
    <p role="status" aria-live="polite">${escape(message)}</p></section>`;
}

/** P8 mounts this inside the trusted admin surface; invoke uses its sender-checked preload. */
export function mountMemoryLearningControls(root, {invoke, status, refs = [], onMemoryChanged}) {
  const state = {status, refs: structuredClone(refs), version: null, active: null, taskId: '',
    runningTask: null, message: '', form: {}};
  const events = new AbortController();
  let busy = false;
  let disposed = false;
  let renderedHtml;
  const render = resolvedRevision => {
    if (disposed) return;
    let html=memoryLearningControlsHtml(state);
    if (html===renderedHtml) return;
    const active = root.ownerDocument?.activeElement;
    const focusedName = active && root.contains?.(active) ? active.name : null;
    const selection = focusedName && typeof active.selectionStart === 'number'
      ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
    for (const [key, name] of [['workflowId', 'ml-workflow'], ['path', 'ml-path'],
      ['summary', 'ml-summary'], ['revision', 'ml-revision']]) {
      const input = root.querySelector?.(`[name="${name}"]`);
      if (input) state.form[key] = input.value;
    }
    if(resolvedRevision!==undefined)state.form.revision=resolvedRevision;
    html=memoryLearningControlsHtml(state);
    root.innerHTML=html;renderedHtml=html;
    if (focusedName) {
      const input = root.querySelector?.(`[name="${focusedName}"]`);
      input?.focus({preventScroll: true});
      if (selection && typeof input?.setSelectionRange === 'function') input.setSelectionRange(...selection);
    }
  };
  render();
  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button) || busy || button.disabled) return;
    const action = button.dataset.mlAction;
    const withdraw = button.dataset.mlWithdraw;
    const deletion = button.dataset.mlDelete;
    const use = button.dataset.mlUse;
    if (!action && withdraw === undefined && deletion === undefined && use === undefined) return;
    const value = name => root.querySelector(`[name="ml-${name}"]`)?.value.trim();
    const workflowId = value('workflow');
    const revision = Number(value('revision'));
    const path = value('path');
    const summary = value('summary');
    const previous = state.version;
    state.form = {workflowId, revision, path, summary};
    busy = true;
    button.disabled = true;
    let resolvedRevision;
    try {
      let result;
      if (use !== undefined) {
        const ref=state.refs[Number(use)];
        if (!ref) throw Error('请刷新记忆引用');
        result=await invoke('memory.selectForConversation',{conversationId:button.dataset.conversation,ref});
        state.message='已选择；每个新任务发送前会单独确认私人记忆范围。';
      } else if (withdraw !== undefined || deletion !== undefined) {
        const index = Number(withdraw ?? deletion);
        const ref = state.refs[index];
        if (!ref) throw Error('请刷新记忆引用');
        result = await invoke(withdraw !== undefined ? 'memory.withdraw' : 'memory.delete', {ref});
        if (result.state === 'withdrawn') state.refs[index] = {...ref, revision: result.revision};
        const sourceErased = result.state === 'deleted' || (result.state === 'pending' && result.phase === 'private_copy_erasure');
        if (sourceErased) state.refs.splice(index, 1);
        if (result.state === 'withdrawn' || sourceErased) await onMemoryChanged?.();
      } else {
        const payload = {workflowId, revision};
        if (action === 'propose') Object.assign(payload, {summary, path,
          expectedRevision: state.version?.workflowId === workflowId ? state.version.revision : null});
        if (action === 'validate') payload.taskId = state.taskId;
        if (action === 'activate') payload.expectedActiveRevision = state.active?.revision ?? null;
        if (action === 'run') payload.revision = state.active.revision;
        if (action === 'stop') Object.assign(payload, state.runningTask);
        if (action === 'erase') payload.expectedRevision = revision;
        result = await invoke(`learning.${action}`, payload);
        if (result.version) state.version = result.version;
        if (action === 'read') {
          state.version = result.version;
          state.active = result.active;
          if (previous?.workflowId !== workflowId || previous?.revision !== revision) state.taskId = '';
        }
        if (action === 'propose') state.taskId = '';
        if (result.version) resolvedRevision = result.version.revision;
        if (action === 'startValidation') state.taskId = result.taskId;
        if (['startValidation', 'run'].includes(action)) {
          state.runningTask = {taskId: result.taskId, workflowId, revision: payload.revision};
        }
        if (action === 'stop' && ['succeeded', 'failed', 'cancelled'].includes(result.state)) {
          state.runningTask = null;
        }
        if (action === 'activate' && result.state === 'activated') state.active = state.version;
        if (action === 'erase' && result.state === 'deleted') {
          state.version = null; state.active = null; state.taskId = '';
        }
      }
      state.message = action === 'stop' ? (result.cancelRequested && state.runningTask
        ? `停止请求已受理，任务仍为${taskState(result.state)}，尚未确认停止；可再次点击“停止或核实此任务”读回。`
        : `任务当前为${taskState(result.state)}。`)
        : action === 'read' && !result.version ? '所选版本不存在；当前启用状态已读回。'
        : result.state === 'declined' ? '已取消确认，未更改。'
        : result.state === 'pending' ? (result.phase === 'private_copy_erasure'
          ? '来源已停止引用，关联任务副本仍待核实清除，请在任务区处理后读回。'
          : `任务仍为${taskState(result.taskState)}，请在任务区处理后读回。`)
          : result.taskId ? `任务已受理：${result.taskId}（${taskState(result.state)}）`
            : result.version?.validation === 'failed' ? '验证失败，不能启用。'
              : result.state === 'deleted' ? '删除读回完成。'
                : result.state === 'withdrawn' ? '已撤回，后续任务不可消费。' : '状态已读回。';
    } catch (error) {
      if (action === 'read') { state.version = null; state.active = null; state.taskId = ''; }
      state.message = `${action === 'read' ? '版本未读回，已清除旧选择。' : ''}${error?.message ?? '操作失败，请刷新后核对。'}`;
    }
    finally { busy = false; render(resolvedRevision); }
  }, {signal: events.signal});
  return Object.freeze({dispose() { disposed = true; events.abort(); },
    update({status: next, refs: nextRefs}) {
      if (next) state.status = next;
      if (nextRefs) state.refs = structuredClone(nextRefs);
      render();
    }});
}
