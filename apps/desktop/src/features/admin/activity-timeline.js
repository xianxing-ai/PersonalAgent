const sources = {autonomy: '自动执行', proactive: '主动触发', repair: '失败自愈', plugin: '插件'};
const risks = {low: '低', medium: '中', high: '高', irreversible: '不可逆'};
const results = {succeeded: '已完成', failed: '失败', asked: '先问', skipped: '未执行', compensated: '已撤销'};

function displayTime(value) {
  return typeof value === 'string' ? value.replace('T', ' ').slice(0, 16) : '';
}

export function activityTimelineHtml(page, escape, openWhy = new Set()) {
  const items = Array.isArray(page?.items) ? page.items : [];
  const rows = items.map(item => {
    const open = openWhy.has(item.id);
    const undo = item.undoable === true
      ? `<button type="button" class="btn btn-sm" data-activity-undo="${escape(item.id)}">撤销</button>`
      : '';
    const why = open
      ? `<p class="activity-why">触发：${escape(item.why?.trigger ?? '')}<br>依据：${escape(item.why?.basis ?? '')}</p>`
      : '';
    return `<article class="activity-item sheet"><p class="activity-meta"><time datetime="${escape(item.at)}">${escape(displayTime(item.at))}</time> · ${escape(sources[item.source] ?? '')} · ${escape(risks[item.risk] ?? '')} · ${escape(results[item.result] ?? '')}</p><p class="activity-summary">${escape(item.summary ?? '')}</p><div class="activity-actions"><button type="button" class="btn btn-sm" data-activity-why="${escape(item.id)}" aria-expanded="${open ? 'true' : 'false'}">为什么</button>${undo}</div>${why}</article>`;
  }).join('');
  const earlier = page?.earlierKept === true ? '<p class="muted">更早的记录仍留在本机。</p>' : '';
  const body = rows || '<div class="sheet empty">还没有记录</div>';
  return `<section class="activity-timeline"><div class="settings-heading"><h2>它替我做了什么</h2><p>自动执行、主动触发、失败自愈和插件变更记在这里。不显示消息正文和参数。</p></div>${body}${earlier}</section>`;
}

export function mountActivityTimeline(parent, invoke, escape) {
  const root = document.createElement('div');
  const error = parent.querySelector('#error');
  if (error) error.before(root);
  else parent.append(root);
  const openWhy = new Set();
  let page = {items: []};
  const paint = () => { root.innerHTML = activityTimelineHtml(page, escape, openWhy); };
  root.addEventListener('click', async event => {
    const why = event.target.closest('[data-activity-why]');
    if (why) {
      const id = why.dataset.activityWhy;
      if (openWhy.has(id)) openWhy.delete(id);
      else openWhy.add(id);
      paint();
      return;
    }
    const undo = event.target.closest('[data-activity-undo]');
    if (!undo || undo.disabled) return;
    undo.disabled = true;
    try {
      page = await invoke('activity.undo', {id: undo.dataset.activityUndo});
      openWhy.delete(undo.dataset.activityUndo);
      paint();
    } catch (error) {
      undo.disabled = false;
      const slot = parent.querySelector('#error');
      if (slot) slot.textContent = error.message;
    }
  });
  return {
    render(next) {
      page = next ?? {items: []};
      paint();
    },
    show(visible) { root.hidden = !visible; },
  };
}
