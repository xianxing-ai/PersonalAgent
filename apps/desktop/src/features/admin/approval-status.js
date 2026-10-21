const stateLabels = {
  pending: '待处理',
  allowed: '已允许',
  denied: '已拒绝',
  expired: '已失效',
  invalid: '期限无效',
  cancelled: '已取消',
};

function expiryMillis(expiresAt) {
  if (typeof expiresAt !== 'string') return Number.NaN;
  return Date.parse(expiresAt);
}

export function approvalPresentation(item, now = Date.now()) {
  const expiresAtMillis = expiryMillis(item?.expiresAt);
  const hasValidExpiry = Number.isFinite(expiresAtMillis);
  const sourceState = ['pending', 'allowed', 'denied'].includes(item?.state) ? item.state : 'invalid';
  const state = sourceState === 'denied' && item?.systemExpired === true ? 'expired'
    :sourceState==='denied'&&item?.systemInvalidated==='stale'?'expired'
      :sourceState==='denied'&&item?.systemInvalidated==='cancelled'?'cancelled': sourceState === 'pending'
    ? (!hasValidExpiry ? 'invalid' : expiresAtMillis <= now ? 'expired' : 'pending')
    : sourceState;
  const scopes = Array.isArray(item?.scopes)
    ? item.scopes.filter(scope => typeof scope === 'string' && scope.length > 0)
    : [];
  return {
    action: typeof item?.action === 'string' && item.action ? item.action : 'Runtime 未公开工具',
    scopesLabel: scopes.length ? scopes.join(', ') : 'Runtime 未公开范围',
    argumentLabel: item?.argumentSummary === 'redacted' ? '已由 Runtime 脱敏' : 'Runtime 未公开参数',
    expiresAtLabel: hasValidExpiry ? new Date(expiresAtMillis).toISOString() : 'Runtime 未公开有效期限',
    state,
    stateLabel: stateLabels[state],
    actionable: state === 'pending',
    expiresAtMillis,
  };
}

export function nextApprovalExpiry(items, now = Date.now()) {
  let next;
  for (const item of items ?? []) {
    const presentation = approvalPresentation(item, now);
    if (!presentation.actionable) continue;
    if (next === undefined || presentation.expiresAtMillis < next) next = presentation.expiresAtMillis;
  }
  return next;
}

function revocationControl(item, presentation, escape, {canRevoke = false, revocations = new Map()} = {}) {
  const revision = Number.isSafeInteger(item?.revision) ? item.revision : 0;
  const status = revocations.get(`${item.approvalId}:${revision}`);
  if (status?.state === 'confirmed') {
    return `<span class="status-note">${status.revoked ? '已撤销' : '已无有效授权'}（授权存储读回）</span>`;
  }
  if (!canRevoke || presentation.state !== 'allowed' || revision < 1) {
    return '<span class="status-note">不可操作</span>';
  }
  return `<button class="btn btn-sm btn-danger" data-revoke="${escape(item.approvalId)}" data-task="${escape(item.taskId)}" data-revision="${revision}" ${status?.state === 'checking' ? 'disabled' : ''}>${status?.state === 'error' ? '重试撤销' : '核验并撤销'}</button>${status?.state === 'error' ? '<small role="alert">撤销未获确认</small>' : ''}`;
}

export function authorizationListHtml(items, escape, now = Date.now(), options = {}) {
  const rows = (items ?? []).map(item => {
    const presentation = approvalPresentation(item, now);
    const revision = Number.isSafeInteger(item?.revision) ? item.revision : 0;
    const decisions = presentation.actionable
      ? `<button class="btn btn-sm" data-approval="allow_once" data-id="${escape(item.approvalId)}" data-task="${escape(item.taskId)}" data-revision="${revision}">允许一次</button> <button class="btn btn-sm btn-danger" data-approval="deny" data-id="${escape(item.approvalId)}" data-task="${escape(item.taskId)}" data-revision="${revision}">拒绝</button>`
      : revocationControl(item, presentation, escape, options);
    return `<tr><td>${escape(item.approvalId)}</td><td>${escape(item.taskId)}</td><td><b>${escape(presentation.action)}</b><br><small>参数：${escape(presentation.argumentLabel)}</small><br><small>范围：${escape(presentation.scopesLabel)}</small></td><td>${escape(presentation.stateLabel)}<br><small>到期：${escape(presentation.expiresAtLabel)}</small></td><td>${revision}<br>${decisions}</td></tr>`;
  }).join('');
  return `<div class="sheet"><h2>授权状态</h2><p class="muted">撤销需受信宿主逐次鉴权并读回授权存储；仅阻止后续使用，已开始的操作不会回滚。</p><div class="table-scroll"><table><thead><tr><th>授权</th><th>任务</th><th>工具与范围</th><th>状态与期限</th><th>决定</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">没有待处理授权。授权决定由 Runtime 校验，界面不直接授予权限。</td></tr>'}</tbody></table></div></div>`;
}

export function authorizationHistoryHtml(items, escape, status, now = Date.now(), options = {}) {
  const rows = items.filter(item => item.state !== 'pending').map(item => {
    const presentation = approvalPresentation(item, now);
    return `<tr><td>${escape(item.approvalId)}</td><td>${escape(item.taskId)}</td><td><b>${escape(presentation.action)}</b><br><small>参数：${escape(presentation.argumentLabel)}</small><br><small>范围：${escape(presentation.scopesLabel)}</small></td><td>${escape(presentation.stateLabel)}</td><td>${revocationControl(item, presentation, escape, options)}</td></tr>`;
  }).join('');
  const empty = status.loading && !status.loaded ? '正在读取授权历史…'
    : status.error ? '授权历史读取失败，可重试。'
      : status.loaded ? '没有已处理的授权记录。' : '授权历史尚未加载。';
  const control = status.loading ? '<span class="status-note">正在读取…</span>'
    : status.error ? '<button class="btn btn-sm" id="approval-history-retry">重试</button>'
      : !status.loaded ? '<span class="status-note">尚未加载</span>'
      : '<button class="btn btn-sm" id="approval-history-refresh">刷新</button>'
        + (status.nextBeforeRowId !== undefined
          ? '<button class="btn btn-sm" id="approval-history-more">加载更早记录</button>'
          : '<span class="status-note">已到最早记录</span>');
  return `<div class="sheet"><div class="row"><h2>授权历史</h2><span class="spacer"></span>${control}</div><p class="muted">每次从 Runtime 读取最多 50 条脱敏记录；历史记录不可再次批准。撤销仅阻止后续使用，需授权存储读回确认。</p><div class="table-scroll"><table><thead><tr><th>授权</th><th>任务</th><th>工具与范围</th><th>状态</th><th>撤销</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">${empty}</td></tr>`}</tbody></table></div>${status.error && rows ? '<p role="alert">授权历史读取失败，已加载记录仍可查看。</p>' : ''}</div>`;
}
