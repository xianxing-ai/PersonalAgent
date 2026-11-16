/** 自动执行设置。只保留档位、可覆盖的两类、一个撤销按钮和最近记录。 */
export function riskAutonomyButtonLabel(revoked) {
  return revoked ? '恢复自动执行' : '停止自动执行';
}

const STANCE_LABELS = {
  autonomous: '自主',
  balanced: '平衡',
  conservative: '保守',
};

export function formatRiskAutonomyAuditState(item = {}) {
  if (item.rollback === 'requested') return '已请求撤销';
  if (item.executionState === 'authorized') return '已授权，等待执行确认';
  if (item.executionState === 'executing') return '执行中，等待完成回执';
  if (item.executionState === 'failed') return '执行失败';
  if (item.executionState === 'unknown') return '执行结果未知';
  if (item.executionState !== 'confirmed') return '已记录授权，执行状态未知（未确认可撤销）';
  if (item.disposition === 'execute_and_notify') {
    if (item.compensationReady !== true || item.rollback !== 'available') {
      return '已确认完成 · 未提供可用撤销补偿';
    }
    if (item.notificationState === 'delivered') {
      return '已确认完成 · 已通知，可在通知中撤销';
    }
    if (item.notificationState === 'failed') {
      return '已确认完成 · 通知未送达（暂不可从通知撤销）';
    }
    return '已确认完成 · 通知投递待确认';
  }
  return '已确认自动完成';
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
  let confirmedSnapshot;
  let busy = false;
  const queue = [];

  function setControlsDisabled(disabled) {
    for (const name of ['stance', 'read', 'local_reversible_write', 'revoke']) {
      const control = field(name);
      if (control) control.disabled = disabled;
    }
  }

  function applyUnconfirmedState() {
    field('stance').value = '';
    field('read').value = '';
    field('local_reversible_write').value = '';
    setControlsDisabled(true);
  }

  function applyControls(snapshot) {
    if (!snapshot?.stance) {
      applyUnconfirmedState();
      return;
    }
    field('stance').value = snapshot.stance;
    const overrides = Object.fromEntries((snapshot.categories ?? []).map(item => [item.category, item.override ?? '']));
    field('read').value = overrides.read ?? '';
    field('local_reversible_write').value = overrides.local_reversible_write ?? '';
    field('revoke').textContent = riskAutonomyButtonLabel(snapshot.revoked === true);
  }

  applyUnconfirmedState();
  field('status').textContent = '尚未收到已确认的自动执行设置';

  async function processQueue() {
    if (busy) return;
    busy = true;
    setControlsDisabled(true);
    try {
      while (queue.length > 0) {
        const {action, payload, resolve} = queue.shift();
        try {
          const next = await invoke(action, payload);
          render(next);
          if (confirmedSnapshot) field('status').textContent = '';
        } catch (error) {
          if (confirmedSnapshot) {
            applyControls(confirmedSnapshot);
            const confirmedLabel = STANCE_LABELS[confirmedSnapshot.stance] ?? confirmedSnapshot.stance;
            field('status').textContent = `${error.message}（当前已确认设置：${confirmedLabel}）`;
          } else {
            applyUnconfirmedState();
            field('status').textContent = `${error.message}（尚未收到已确认的自动执行设置）`;
          }
        } finally {
          resolve();
        }
      }
    } finally {
      busy = false;
      setControlsDisabled(!confirmedSnapshot);
    }
  }

  function run(action, payload) {
    return new Promise(resolve => {
      queue.push({action, payload, resolve});
      void processQueue();
    });
  }

  field('stance').onchange = () => run('riskAutonomy.setStance', {stance: field('stance').value});
  for (const category of ['read', 'local_reversible_write']) {
    field(category).onchange = () => run('riskAutonomy.setCategory', {category, disposition: field(category).value});
  }
  field('revoke').onclick = () => run('riskAutonomy.revoke');

  function render(snapshot = {}) {
    if (!snapshot?.stance) {
      if (!confirmedSnapshot) {
        applyUnconfirmedState();
        field('status').textContent = '尚未收到已确认的自动执行设置';
      }
      return;
    }
    confirmedSnapshot = {
      stance: snapshot.stance,
      revoked: snapshot.revoked === true,
      categories: (snapshot.categories ?? []).map(item => ({...item})),
      audits: (snapshot.audits ?? []).map(item => ({...item})),
    };
    applyControls(confirmedSnapshot);
    if (!busy) setControlsDisabled(false);
    field('status').textContent = '';
    const list = field('audits');
    list.replaceChildren();
    const audits = confirmedSnapshot.audits;
    if (!audits.length) {
      const empty = document.createElement('li');
      empty.textContent = '还没有自动执行';
      list.append(empty);
      return;
    }
    for (const item of audits) {
      const row = document.createElement('li');
      const state = formatRiskAutonomyAuditState(item);
      row.textContent = `${item.toolName} · ${state}`;
      list.append(row);
    }
  }
  return {render, show(visible) { section.hidden = !visible; }};
}
