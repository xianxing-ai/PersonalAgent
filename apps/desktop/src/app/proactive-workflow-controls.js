const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const modeNames = {attended:'在场值守',unattended:'无人值守',paused:'已暂停',cancel_requested:'正在取消',cancelled:'已取消'};

/** Pure projection over Desktop snapshot.proactiveWorkflow; no notifications.digest. */
export function proactiveWorkflowSessions(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.state === 'unavailable') return [];
  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  return sessions.filter(session => typeof session?.taskId === 'string' && session.taskId
    && typeof session?.sourceTaskId === 'string' && session.sourceTaskId
    && Number.isSafeInteger(session?.controlRevision) && session.controlRevision >= 0);
}

/** Mode-aware leave/return/pause/cancel; defaults to attended when mode unknown. */
export function workflowControlActions(session = {}, {busy = false} = {}) {
  const mode = ['attended','unattended','paused','cancel_requested','cancelled'].includes(session.mode)
    ? session.mode : 'attended';
  const ended = terminal.has(session.taskState) || mode === 'cancelled' || mode === 'cancel_requested';
  const ready = Boolean(session.taskId && session.sourceTaskId
    && Number.isSafeInteger(session.controlRevision) && session.controlRevision >= 0)
    && !ended && !busy;
  const catalog = {
    attended: [
      {action:'enter_unattended', label:'离开（无人值守）'},
      {action:'pause', label:'暂停'},
      {action:'cancel', label:'取消'},
    ],
    unattended: [
      {action:'return', label:'归来'},
      {action:'cancel', label:'取消'},
    ],
    paused: [
      {action:'resume', label:'继续'},
      {action:'enter_unattended', label:'离开（无人值守）'},
      {action:'cancel', label:'取消'},
    ],
  };
  return {
    mode,
    modeLabel: modeNames[mode] ?? '状态未知',
    ended,
    actions: ended ? [] : (catalog[mode] ?? []).map(item => ({...item, disabled: !ready})),
  };
}

function newCommandId() {
  return `ui-control-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

/**
 * Renderer entry for IPC proactive.workflow.control (leave/return/pause/resume/cancel).
 * Leave/return never use notifications.digest.
 */
export function mountProactiveWorkflowControls(container, invoke, {settings = false} = {}) {
  const document = container.ownerDocument ?? globalThis.document;
  const section = document.createElement('section');
  section.className = settings ? 'feature-page proactive-workflow-controls' : 'proactive-workflow-controls';
  section.setAttribute('aria-label', '持续工作流值守');
  section.innerHTML = `<h2>${settings ? '持续责任控制' : '离开 / 归来'}</h2>
    ${settings ? '<p class="notice">离开与归来走原 <code>proactive.workflow.control</code>，不使用通知摘要代替归来。实际执行仍经 Policy 与原控制 revision。</p>' : ''}
    <p class="notice" data-workflow-status role="status"></p>
    <div data-workflow-sessions></div>`;
  container.append(section);
  const status = section.querySelector('[data-workflow-status]');
  const list = section.querySelector('[data-workflow-sessions]');
  const modes = new Map();
  let current, pending = new Map(), closed = false;

  function withMode(session) {
    const known = modes.get(session.taskId);
    return {
      ...session,
      mode: known?.mode ?? session.mode,
      controlRevision: Number.isSafeInteger(known?.controlRevision) ? known.controlRevision : session.controlRevision,
    };
  }

  async function control(session, action) {
    if (closed || pending.has(session.taskId)) return;
    const expectedControlRevision = session.controlRevision;
    pending.set(session.taskId, action);
    render(current);
    status.textContent = action === 'enter_unattended' ? '正在请求离开（无人值守）…'
      : action === 'return' ? '正在请求归来…'
      : action === 'pause' ? '正在请求暂停…'
      : action === 'resume' ? '正在请求继续…'
      : '正在请求取消…';
    try {
      const result = await invoke('proactive.workflow.control', {
        taskId: session.taskId,
        sourceTaskId: session.sourceTaskId,
        commandId: newCommandId(),
        action,
        expectedControlRevision,
      });
      if (result && typeof result === 'object') {
        const nextMode = ['attended','unattended','paused','cancel_requested','cancelled'].includes(result.mode)
          ? result.mode : undefined;
        const nextRevision = Number.isSafeInteger(result.controlRevision) && result.controlRevision >= 0
          ? result.controlRevision : undefined;
        if (nextMode || nextRevision !== undefined) {
          modes.set(session.taskId, {
            mode: nextMode ?? modes.get(session.taskId)?.mode,
            controlRevision: nextRevision ?? modes.get(session.taskId)?.controlRevision ?? expectedControlRevision + 1,
          });
        }
        if (!closed) {
          if (action === 'return' && result.returnSummary) {
            const summary = result.returnSummary;
            status.textContent = `已归来 · 完成 ${summary.done?.length ?? 0} · 变化 ${summary.changed?.length ?? 0} · 待办 ${summary.pending?.length ?? 0} · 受阻 ${summary.blocked?.length ?? 0}`;
          } else {
            status.textContent = '控制请求已返回；模式与 revision 以当前读回为准。';
          }
        }
      } else if (!closed) {
        status.textContent = '控制请求已返回；模式与 revision 以当前读回为准。';
      }
    } catch (error) {
      if (!closed) status.textContent = error?.message || '持续工作流控制未完成';
    } finally {
      pending.delete(session.taskId);
      if (!closed) render(current);
    }
  }

  function render(snapshot) {
    if (closed) return;
    current = snapshot;
    const sessions = proactiveWorkflowSessions(snapshot).map(withMode);
    if (!settings) section.hidden = sessions.length === 0 && snapshot?.state !== 'configured_not_verified';
    if (!snapshot) {
      status.textContent = '持续工作流尚未连接';
      list.replaceChildren();
      return;
    }
    if (snapshot.state === 'unavailable') {
      status.textContent = '持续工作流宿主不可用（需比赛装配与镜像契约）';
      list.replaceChildren();
      return;
    }
    if (sessions.length === 0) {
      status.textContent = settings
        ? '当前没有已恢复的持续责任会话。先由对话工具启动后，可在此离开、归来、暂停或取消。'
        : '暂无进行中的持续责任';
      list.replaceChildren();
      return;
    }
    if (![...pending.keys()].length && !status.textContent.includes('已归来')) {
      status.textContent = `已连接 · ${sessions.length} 个会话`;
    }
    const ids = new Set(sessions.map(session => session.taskId));
    for (const node of [...list.children]) {
      if (!ids.has(node.dataset.taskId)) node.remove();
    }
    for (const session of sessions) {
      let row = [...list.children].find(node => node.dataset.taskId === session.taskId);
      const projection = workflowControlActions(session, {busy: pending.has(session.taskId)});
      if (!row) {
        row = document.createElement('article');
        row.className = 'task';
        row.dataset.taskId = session.taskId;
        row.innerHTML = `<p data-summary></p>
          <div class="form-actions" data-actions></div>
          <p class="notice" data-action-status role="status"></p>`;
        list.append(row);
      }
      row.querySelector('[data-summary]').textContent =
        `任务 ${session.taskId.slice(0, 12)}… · ${projection.modeLabel} · 状态 ${session.taskState ?? '未知'} · revision ${session.controlRevision}`
        + (session.taskDeadline ? ` · 期限 ${session.taskDeadline}` : '');
      const busyAction = pending.get(session.taskId);
      row.querySelector('[data-action-status]').textContent = busyAction
        ? (projection.actions.find(item => item.action === busyAction)?.label
          ?? ({enter_unattended:'离开（无人值守）',return:'归来',pause:'暂停',resume:'继续',cancel:'取消'})[busyAction]
          ?? busyAction) + '处理中…'
        : projection.ended ? '会话已结束，控制不可用' : '';
      const actions = row.querySelector('[data-actions]');
      const wanted = projection.actions.map(item => item.action).join(',');
      if (actions.dataset.actions !== wanted) {
        actions.dataset.actions = wanted;
        actions.replaceChildren();
        for (const item of projection.actions) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn btn-sm';
          button.setAttribute('data-action', item.action);
          button.textContent = item.label;
          button.disabled = item.disabled;
          button.addEventListener('click', () => {
            const latest = proactiveWorkflowSessions(current).map(withMode).find(value => value.taskId === session.taskId);
            if (!latest || button.disabled) return;
            void control(latest, item.action);
          });
          actions.append(button);
        }
      } else {
        for (const button of actions.querySelectorAll('button[data-action]')) {
          const item = projection.actions.find(value => value.action === button.dataset.action);
          button.disabled = !item || item.disabled;
        }
      }
    }
  }

  return {
    render,
    show(visible) { section.hidden = !visible; },
    close() { closed = true; section.remove(); },
  };
}
