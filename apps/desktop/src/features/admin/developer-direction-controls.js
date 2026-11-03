const escape = value => String(value ?? '').replace(/[&<>"']/gu, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

/** 开发者方向的最小面板。数据来自既有 desktop:action，不另起一套界面框架。 */
export function mountDeveloperDirectionControls(root, invoke) {
  const view = document.createElement('section');
  view.className = 'sheet developer-direction';
  view.innerHTML = `<h2>开发者方向</h2>
    <p class="notice">已登记仓库默认“除不可逆外自动”。合并、强推、删分支、发布和改权限始终要确认。升档需要勾选“我在场”。未做真实 GitHub 与远端机器验收。</p>
    <p data-direction-status role="status"></p>
    <form data-direction-goal class="settings-form">
      <label>一句话目标<input name="sentence" required maxlength="4000" placeholder="修好这个 PR 的 CI"></label>
      <label>仓库<input name="repo" placeholder="owner/repository"></label>
      <label>PR 号<input name="pullRequest" type="number" min="1"></label>
      <label>分支<input name="branch" placeholder="main"></label>
      <label>完成标准<input name="doneWhen" placeholder="CI 绿，且不改公共 API"></label>
      <label>预算（CNY，估算）<input name="budget" type="number" min="1"></label>
      <button class="btn btn-sm" type="submit">下达目标</button>
    </form>
    <form data-direction-duty class="settings-form">
      <label>长期职责<input name="sentence" required value="CI 红了就修"></label>
      <label>仓库<input name="repo" required placeholder="owner/repository"></label>
      <button class="btn btn-sm" type="submit">登记职责</button>
    </form>
    <form data-direction-level class="settings-form">
      <label>仓库<input name="repo" required></label>
      <label>自主级别<select name="level"><option value="observe">观察</option><option value="suggest">建议</option><option value="act_reversible">可逆自动</option><option value="act_all_but_irreversible">除不可逆外全自动</option></select></label>
      <label><input name="present" type="checkbox">我在场，确认升档</label>
      <button class="btn btn-sm" type="submit">保存级别</button>
    </form>
    <form data-direction-subscribe class="settings-form">
      <label>通知仓库<input name="repo" required></label>
      <label><input name="interrupt" type="checkbox" checked>打断</label>
      <label><input name="digest" type="checkbox">摘要</label>
      <label><input name="silent" type="checkbox">静默</label>
      <button class="btn btn-sm" type="submit">保存订阅</button>
    </form>
    <div data-direction-board></div>
    <div data-direction-timeline></div>
    <pre data-direction-report class="notice"></pre>
    <p><button type="button" class="btn btn-sm" data-direction-refresh>刷新看板</button>
      <button type="button" class="btn btn-sm" data-direction-stop>全局急停</button></p>
    <details><summary>配置向导</summary>
      <form data-direction-wizard class="settings-form">
        <label>凭据引用（不要粘贴 token）<input name="credentialRef" required></label>
        <label>仓库<input name="repo" required></label>
        <label>AGENTS.md 或 CONTRIBUTING 摘要<textarea name="conventions" rows="3"></textarea></label>
        <button class="btn btn-sm" type="submit">生成画像并登记</button>
      </form>
    </details>`;
  root.append(view);
  const status = view.querySelector('[data-direction-status]');
  const board = view.querySelector('[data-direction-board]');
  const timeline = view.querySelector('[data-direction-timeline]');
  const report = view.querySelector('[data-direction-report]');
  const call = (action, payload) => invoke('developerDirection.invoke', {action, ...payload});
  async function refresh() {
    const value = await call('board', {});
    const items = value.items ?? [];
    board.innerHTML = `<h3>任务看板</h3>${items.length ? `<ul>${items.map(item => `<li data-direction-goal="${escape(item.id)}">${escape(item.sentence || item.goal || item.taskId)} · ${escape(item.status || item.state || '')} · ${escape(item.step || '')} · ${escape(item.headSha || '')}
      <button type="button" data-direction-act="pause" data-id="${escape(item.id)}">暂停</button>
      <button type="button" data-direction-act="resume" data-id="${escape(item.id)}">恢复</button>
      <button type="button" data-direction-act="handoff" data-id="${escape(item.id)}">我来接手</button>
      <button type="button" data-direction-act="stop" data-id="${escape(item.id)}">停止</button>
      <button type="button" data-direction-act="report" data-id="${escape(item.id)}">报告</button></li>`).join('')}</ul>` : '<p>还没有开发者目标。</p>'}`;
    const rows = value.timeline ?? [];
    timeline.innerHTML = `<h3>时间线</h3>${rows.length ? `<ol>${rows.map(item => `<li><a href="#${escape(item.evidenceRef || item.id)}">${escape(item.at)}</a> ${escape(item.summary)} · ${item.delivered ? '已投递' : '未投递'} · ${escape(item.reason || '')}</li>`).join('')}</ol>` : '<p>时间线是空的。</p>'}`;
    status.textContent = value.snapshot?.stopped ? '急停已生效，常驻授权已撤销' : '开发者方向可用（夹具/本机端口，不是真机验收）';
  }
  view.addEventListener('submit', async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      if (form.matches('[data-direction-goal]')) {
        await call('goal', {sentence: data.sentence, ...(data.repo ? {repo: data.repo} : {}), ...(data.pullRequest ? {pullRequest: Number(data.pullRequest)} : {}), ...(data.branch ? {branch: data.branch} : {}), ...(data.doneWhen ? {doneWhen: data.doneWhen} : {}), ...(data.budget ? {budget: Number(data.budget)} : {})});
      } else if (form.matches('[data-direction-duty]')) await call('duty', {sentence: data.sentence, repo: data.repo});
      else if (form.matches('[data-direction-level]')) await call('setAutonomy', {repo: data.repo, level: data.level, present: form.elements.namedItem('present').checked === true});
      else if (form.matches('[data-direction-subscribe]')) {
        const classes = ['interrupt', 'digest', 'silent'].filter(name => form.elements.namedItem(name).checked);
        await call('subscribe', {repo: data.repo, classes});
      } else if (form.matches('[data-direction-wizard]')) {
        await call('wizard', {credentialRef: data.credentialRef, repo: data.repo, files: data.conventions ? [{path: 'AGENTS.md', text: data.conventions}] : [], present: true});
      }
      status.textContent = '已保存';
      await refresh();
    } catch (error) {status.textContent = error instanceof Error ? error.message : '操作没有完成';}
  });
  view.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    try {
      if (button.matches('[data-direction-refresh]')) await refresh();
      if (button.matches('[data-direction-stop]')) {await call('emergency', {reason: '用户急停'}); await refresh();}
      const action = button.dataset.directionAct;
      const goalId = button.dataset.id;
      if (!action || !goalId) return;
      if (action === 'report') {
        const value = await call('report', {goalId});
        report.textContent = value.pullRequestBody;
        return;
      }
      const instruction = action === 'redirect' ? window.prompt('新的指示') : undefined;
      if (action === 'redirect') await call('redirect', {goalId, instruction});
      else await call(action, {goalId});
      await refresh();
    } catch (error) {status.textContent = error instanceof Error ? error.message : '操作没有完成';}
  });
  return {render: refresh, showSettings(show) {view.hidden = !show;}, close() {view.remove();}};
}
