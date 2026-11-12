/** Existing access control opens this sheet. Revoke is the only action on a grant. */
export function renderPermissionSheet(sheet, snapshot, invoke) {
  if (!sheet) return;
  const signature = JSON.stringify(snapshot ?? null);
  if (sheet.dataset.signature === signature) return;
  sheet.dataset.signature = signature;
  const grants = Array.isArray(snapshot?.grants) ? snapshot.grants : [];
  const audit = snapshot?.audit ?? {};
  sheet.replaceChildren();
  const status = document.createElement('p');
  status.textContent = audit.unreadable ? '审计日志无法读取'
    : audit.intact === false ? `审计链在第 ${audit.brokenAt} 条起对不上`
    : `审计链完整 · ${audit.count ?? 0} 条`;
  sheet.append(status);
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
      button.onclick = () => invoke('assistantPermissions.revoke', {id: grant.id, kind: grant.kind, revision: grant.revision});
      row.append(button);
    }
    sheet.append(row);
  }
}
