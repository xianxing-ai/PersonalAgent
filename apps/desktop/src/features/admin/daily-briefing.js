const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function rows(items, omitted, render) {
  const list = items.length ? `<ul>${items.map(render).join('')}</ul>` : '<p class="muted">没有。</p>';
  const more = omitted > 0 ? `<p class="muted">还有 ${omitted} 项未展开。</p>` : '';
  return `${list}${more}`;
}

function titled(item) {
  return `${escape(item.title)}${item.riskLabel ? ` · 风险${escape(item.riskLabel)}` : ''}`;
}

/** Read-only briefing. Pending items jump to the existing approval card. */
export function dailyBriefingMarkup(briefing) {
  if (!briefing) return '<p class="muted">还没有简报。到达设定时间后，会显示在这里。</p>';
  return `<h3>昨天以来完成</h3>${rows(briefing.completed, briefing.completedOmitted, item => `<li>${titled(item)}</li>`)}
    <h3>失败或卡住</h3>${rows(briefing.failed, briefing.failedOmitted, item => `<li>${titled(item)}</li>`)}
    <h3>待你拍板</h3>${rows(briefing.decisions, briefing.decisionsOmitted, item => `<li>${titled(item)} <button type="button" class="btn btn-sm" data-briefing-task="${escape(item.taskId)}" data-briefing-approval="${escape(item.approvalId)}">查看审批卡</button></li>`)}
    <h3>今天的日程</h3>${rows(briefing.schedule, briefing.scheduleOmitted, item => `<li>${escape(item.displayTime)} ${titled(item)}</li>`)}`;
}

export function mountDailyBriefing(root, invoke) {
  const section = document.createElement('section');
  section.className = 'sheet daily-briefing';
  section.innerHTML = `<h2>每日结果简报</h2><p class="muted">每天在设定时间生成一份简报，并推送一条通知。全文出现在主对话里，点通知也会打开那里。</p>
    <form class="settings-form" data-briefing="form">
      <label class="notification-check"><input name="enabled" type="checkbox">每天生成</label>
      <label>时间<input name="localTime" type="time" value="08:00" required></label>
    </form>
    <p data-briefing="reason" class="muted"></p>
    <div data-briefing="body" hidden></div>`;
  root.append(section);
  const form = section.querySelector('[data-briefing=form]');
  const body = section.querySelector('[data-briefing=body]');
  const reason = section.querySelector('[data-briefing=reason]');
  let current = {available: false, enabled: true, localTime: '08:00', briefing: null};
  form.addEventListener('change', () => {
    const enabled = form.elements.namedItem('enabled').checked;
    const localTime = form.elements.namedItem('localTime').value;
    if (!TIME.test(localTime) || enabled === current.enabled && localTime === current.localTime) return;
    void invoke('briefing.update', {enabled, localTime});
  });
  body.addEventListener('click', event => {
    const button = event.target.closest('[data-briefing-task]');
    if (!button) return;
    void invoke('briefing.openDecision', {taskId: button.getAttribute('data-briefing-task'), approvalId: button.getAttribute('data-briefing-approval')});
  });
  return {
    show(visible) { section.hidden = !visible; },
    render(snapshot) {
      current = snapshot ?? current;
      const enabled = form.elements.namedItem('enabled');
      const localTime = form.elements.namedItem('localTime');
      enabled.disabled = localTime.disabled = current.available === false;
      enabled.checked = current.enabled !== false;
      if (document.activeElement !== localTime) localTime.value = current.localTime || '08:00';
      reason.textContent = current.reason ?? '';
      body.innerHTML = '';
    },
  };
}

/** Briefing content belongs in the conversation, not the settings form. */
export function mountBriefingPanel(root, invoke) {
  const section = document.createElement('details');
  section.className = 'panel-briefing';
  section.innerHTML = '<summary>今日简报</summary><div data-briefing="body"></div>';
  root.prepend(section);
  const body = section.querySelector('[data-briefing=body]');
  body.addEventListener('click', event => {
    const button = event.target.closest('[data-briefing-task]');
    if (!button) return;
    void invoke('briefing.openDecision', {taskId: button.getAttribute('data-briefing-task'), approvalId: button.getAttribute('data-briefing-approval')});
  });
  return {
    render(snapshot, {open = false} = {}) {
      const briefing = snapshot?.briefing;
      section.hidden = !briefing;
      if (!briefing) { body.replaceChildren(); return; }
      body.innerHTML = dailyBriefingMarkup(briefing);
      if (open) section.open = true;
    },
  };
}
