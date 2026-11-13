/** Existing access control opens this sheet. Revoke and navigating to full permission settings stay explicit. */
export function renderPermissionSheet(sheet, snapshot, invoke, report = () => {}) {
  if (!sheet) return;
  const signature = JSON.stringify(snapshot ?? null);
  if (sheet.dataset.signature === signature) return;
  sheet.dataset.signature = signature;
  const grants = Array.isArray(snapshot?.grants) ? snapshot.grants : [];
  const audit = snapshot?.audit ?? {};
  sheet.replaceChildren();
  const status = document.createElement('p');
  const broken = Boolean(audit.unreadable || audit.intact === false || audit.recordingStopped);
  if (broken) status.setAttribute?.('role', 'alert');
  status.textContent = broken
    ? `警告：${audit.warning || (audit.unreadable ? '审计日志无法读取，已停止记录' : `审计链在第 ${audit.brokenAt} 条损坏，已停止追加后续记录`)}`
    : `审计链完整 · ${audit.count ?? 0} 条`;
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.textContent = '打开权限设置';
  settingsButton.onclick = () => Promise.resolve(invoke('admin.open', {page: 'authorizations'})).catch(report);
  sheet.append(status, settingsButton);
  if (!grants.length) {
    const empty = document.createElement('p');
    empty.textContent = '当前没有可撤销的额外许可';
    sheet.append(empty);
    return;
  }
  for (const grant of grants) {
    const row = document.createElement('p');
    row.textContent = grant.label ?? grant.kind;
    if (grant.revocable) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '撤销';
      button.onclick = () => Promise.resolve(invoke('assistantPermissions.revoke', {
        id: grant.id,
        kind: grant.kind,
        revision: grant.revision,
      })).catch(report);
      row.append(button);
    }
    sheet.append(row);
  }
}
