const periodLabel = {daily: '每天', weekly: '每周', monthly: '每月'};

/** One board: trend cards and the single period control. No refresh or save action. */
export function personalDashboardHtml(data, escape) {
  const view = data ?? {available: false, period: 'weekly', cards: [], reason: '个人数据看板尚未装配'};
  const options = ['daily', 'weekly', 'monthly'].map(period =>
    `<option value="${period}"${view.period === period ? ' selected' : ''}>${periodLabel[period]}</option>`).join('');
  const note = view.summaryPeriod && view.summaryPeriod !== view.period
    ? `<p class="muted">周期已改为${periodLabel[view.period]}，下一轮按新周期汇总。当前仍是上次的${periodLabel[view.summaryPeriod]}结果。</p>`
    : '';
  const when = view.generatedAt ? `<p class="muted">最近汇总 ${escape(view.generatedAt)}</p>` : '';
  const cards = Array.isArray(view.cards) && view.cards.length
    ? `<div class="dashboard-cards">${view.cards.map(card => cardHtml(card, escape)).join('')}</div>`
    : `<p class="empty">${escape(view.reason || '还没有汇总。连接并授权日历、邮件或花销后，到点才会出现对应趋势。')}</p>`;
  return `<section class="dashboard-page"><label class="dashboard-period">汇总周期<select id="dashboard-period" aria-label="汇总周期">${options}</select></label>${note}${when}${cards}</section>`;
}

function cardHtml(card, escape) {
  const max = Math.max(...card.series.map(value => Math.abs(Number(value) || 0)), 0);
  const bars = (card.series ?? []).map(value => {
    const height = max === 0 ? 8 : Math.max(8, Math.round(Math.abs(Number(value)) / max * 100));
    return `<i style="height:${height}%"></i>`;
  }).join('');
  const caption = card.caption ? `<span>${escape(card.caption)}</span>` : '';
  return `<article class="card"><span>${escape(card.title)}</span><b>${escape(card.value)} ${escape(card.unit)}</b><span>较上期 ${escape(card.delta)}</span>${caption}<div class="dashboard-bars" aria-hidden="true">${bars}</div></article>`;
}
