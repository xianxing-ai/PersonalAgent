/** 自动执行设置。只保留档位、可覆盖的两类、一个撤销按钮和最近记录。 */
export function riskAutonomyButtonLabel(revoked) {
  return revoked ? '恢复自动执行' : '停止自动执行';
}

export function mountRiskAutonomySettings(root, invoke) {
  const section = document.createElement('section');
  section.className = 'sheet risk-autonomy';
  section.innerHTML = `<h2>自动执行</h2>
    <label>档位<select data-risk="stance" aria-label="自动执行档位">
      <option value="autonomous">自主</option>
      <option value="balanced">平衡</option>
      <option value="conservative">保守</option>
    </select></label>
    <p>发消息、付款、删除和对外提交始终先问。</p>
    <details><summary>个别类别</summary>
      <label>只读<select data-risk="read" aria-label="只读">
        <option value="">跟随档位</option><option value="execute">直接做</option><option value="execute_and_notify">做完通知</option><option value="ask">先问</option>
      </select></label>
      <label>可回滚的本地修改<select data-risk="local_reversible_write" aria-label="可回滚的本地修改">
        <option value="">跟随档位</option><option value="execute">直接做</option><option value="execute_and_notify">做完通知</option><option value="ask">先问</option>
      </select></label>
    </details>
    <button type="button" class="btn btn-sm" data-risk="revoke">停止自动执行</button>
    <h3>最近自动执行</h3>
    <ul data-risk="audits"></ul>
    <p data-risk="status" role="status"></p>`;
  root.append(section);
  const field = name => section.querySelector(`[data-risk="${name}"]`);
  let busy = false;
  async function run(action, payload) {
    if (busy) return;
    busy = true;
    try {
      const next = await invoke(action, payload);
      render(next);
      field('status').textContent = '';
    } catch (error) {
      field('status').textContent = error.message;
    } finally {
      busy = false;
    }
  }
  field('stance').onchange = () => run('riskAutonomy.setStance', {stance: field('stance').value});
  for (const category of ['read', 'local_reversible_write']) {
    field(category).onchange = () => run('riskAutonomy.setCategory', {category, disposition: field(category).value});
  }
  field('revoke').onclick = () => run('riskAutonomy.revoke');
  function render(snapshot = {}) {
    if (!snapshot?.stance) return;
    field('stance').value = snapshot.stance;
    const overrides = Object.fromEntries((snapshot.categories ?? []).map(item => [item.category, item.override ?? '']));
    field('read').value = overrides.read ?? '';
    field('local_reversible_write').value = overrides.local_reversible_write ?? '';
    field('revoke').textContent = riskAutonomyButtonLabel(snapshot.revoked === true);
    const list = field('audits');
    list.replaceChildren();
    const audits = snapshot.audits ?? [];
    if (!audits.length) {
      const empty = document.createElement('li');
      empty.textContent = '还没有自动执行';
      list.append(empty);
      return;
    }
    for (const item of audits) {
      const row = document.createElement('li');
      const state = item.rollback === 'requested' ? '已请求撤销' : item.disposition === 'execute_and_notify' ? '已通知，可在通知中撤销' : '已自动完成';
      row.textContent = `${item.toolName} · ${state}`;
      list.append(row);
    }
  }
  return {render, show(visible) { section.hidden = !visible; }};
}
