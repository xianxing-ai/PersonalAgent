/** One status line. Hidden until external content or a blocked effect exists. */
export function renderContentFence(node, snapshot) {
  if (!node) return;
  const sources = Array.isArray(snapshot?.sources) ? snapshot.sources : [];
  const blocked = typeof snapshot?.blocked === 'string' ? snapshot.blocked : '';
  if (!sources.length && !blocked) {
    node.hidden = true;
    node.textContent = '';
    return;
  }
  node.hidden = false;
  const origin = sources.slice(-3).map(source => `${source.label ?? source.kind} ${source.ref ?? ''}`.trim()).join('、');
  node.textContent = blocked ? blocked : `外部内容已围栏${origin ? ` · ${origin}` : ''}`;
}
