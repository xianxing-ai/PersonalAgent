/** Shown only while a high-risk preview is waiting. One confirm, no extra navigation. */
export function renderDryRun(node, snapshot, invoke) {
  if (!node) return;
  const pending = Array.isArray(snapshot?.pending) ? snapshot.pending : [];
  const latest = Array.isArray(snapshot?.recent) ? snapshot.recent.at(-1) : undefined;
  node.replaceChildren();
  if (!pending.length && !latest) { node.hidden = true; return; }
  node.hidden = false;
  if (pending.length) {
    const preview = pending[0];
    const text = document.createElement('p');
    text.textContent = preview.summary;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '按预览执行';
    button.onclick = () => invoke('dryRun.confirm', {id: preview.id});
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消预览';
    cancel.onclick = () => invoke('dryRun.cancel', {id: preview.id});
    node.append(text, button, cancel);
    return;
  }
  const done = document.createElement('p');
  done.textContent = `${latest.label || '操作核验'}：${latest.reason}`;
  node.append(done);
}
