const HEATMAP_COLUMNS = 26;
const HEATMAP_DAYS = HEATMAP_COLUMNS * 7;

export function formatCompactTokens(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '0';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(num));
}

export function formatCompactYuan(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '¥0.00';
  if (num >= 1000) return `¥${(num / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  if (num >= 100) return `¥${num.toFixed(1)}`;
  return `¥${num.toFixed(2)}`;
}

export function formatActiveDuration(ms) {
  const num = Number(ms);
  if (!Number.isFinite(num) || num <= 0) return '0m';
  const totalMinutes = Math.max(1, Math.round(num / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function emptyHeatmap() {
  return {
    daily: Array.from({length: HEATMAP_DAYS}, () => ({date: '', tokens: 0, yuan: 0, count: 0, tokenLevel: 0, costLevel: 0})),
    monthLabels: new Array(HEATMAP_COLUMNS).fill(''),
  };
}

function renderBreakdownRows(items, {metric, escape, altBar = false}) {
  if (!Array.isArray(items) || !items.length) {
    return `<p class="ud-empty">暂无本机消耗记录，完成对话后将自动汇总。</p>`;
  }
  return items.map(item => {
    const pct = metric === 'cost' ? Number(item.costPercent ?? item.percent ?? 0) : Number(item.percent ?? 0);
    const bounded = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
    const metricValue = metric === 'cost'
      ? formatCompactYuan(item.yuan)
      : item.tokens > 0
        ? formatCompactTokens(item.tokens)
        : `${item.calls ?? 0} 次`;
    return `<div class="ud-bar-row">
      <span class="ud-bar-name" title="${escape(item.name)}">${escape(item.name)}</span>
      <progress class="ud-bar${altBar ? ' ud-bar-alt' : ''}" value="${bounded}" max="100"></progress>
      <span class="ud-bar-val">${escape(metricValue)}</span>
      <span class="ud-bar-pct">${bounded.toFixed(1)}%</span>
    </div>`;
  }).join('');
}

/** Zero-inline-style Obsidian Usage Dashboard driven strictly by real local ledger & task records. */
export function usageDashboardHtml(dashboard, usageBudget, escape, {metric = 'tokens'} = {}) {
  const activeMetric = metric === 'cost' ? 'cost' : 'tokens';
  const fallback = emptyHeatmap();
  const data = dashboard && typeof dashboard === 'object' ? dashboard : {};
  const daily = Array.isArray(data.daily) && data.daily.length === HEATMAP_DAYS ? data.daily : fallback.daily;
  const monthLabels = Array.isArray(data.monthLabels) && data.monthLabels.length === HEATMAP_COLUMNS ? data.monthLabels : fallback.monthLabels;
  const totalTokens = Number(data.totalTokens) || 0;
  const totalYuan = Number(data.totalYuan) || 0;
  const activeDays = Number(data.activeDays) || 0;
  const streakDays = Number(data.streakDays) || 0;
  const activeDurationMs = Number(data.activeDurationMs) || 0;
  const peakDayTokens = Number(data.peakDayTokens) || 0;
  const peakDayYuan = Number(data.peakDayYuan) || 0;
  const topModel = typeof data.topModel === 'string' && data.topModel.trim() ? data.topModel.trim() : '—';
  const messageCount = Number(data.messageCount) || 0;
  const peakLabel = activeMetric === 'cost' ? formatCompactYuan(peakDayYuan) : formatCompactTokens(peakDayTokens);
  const heatTitle = activeMetric === 'cost' ? '花费活动' : 'Token 活动';

  const kpis = [
    {label: '总 TOKEN', value: formatCompactTokens(totalTokens), title: `${totalTokens.toLocaleString('zh-CN')} tokens`},
    {label: '总花费', value: formatCompactYuan(totalYuan), title: `¥${totalYuan.toFixed(4)}（本机估算）`},
    {label: '活跃天数', value: String(activeDays), title: `累计活跃 ${activeDays} 天`},
    {label: '连续天数', value: String(streakDays), title: `当前连续活跃 ${streakDays} 天`},
    {label: '活跃时间', value: formatActiveDuration(activeDurationMs), title: '有记录的任务与云端运行累计时长'},
    {label: '峰值单日', value: peakLabel, title: '近 26 周内最高单日消耗'},
    {label: '常用模型', value: topModel, title: topModel === '—' ? '暂无已记录的模型调用' : topModel, model: true},
    {label: '消息数', value: formatCompactTokens(messageCount), title: `本机已记录 ${messageCount} 条任务/调用`},
  ];

  const cellsHtml = daily.map(cell => {
    const level = activeMetric === 'cost' ? (Number(cell.costLevel) || 0) : (Number(cell.tokenLevel) || 0);
    const clamped = Math.max(0, Math.min(4, Math.round(level)));
    const tip = cell.date
      ? `${cell.date} · ${Number(cell.tokens || 0).toLocaleString('zh-CN')} tokens · ¥${Number(cell.yuan || 0).toFixed(2)}`
      : '无记录';
    return `<span class="ud-cell" data-heat="${clamped}" title="${escape(tip)}"></span>`;
  }).join('');

  const monthAxisHtml = monthLabels.map(label => `<span class="ud-month-tick">${escape(label)}</span>`).join('');
  const usageLine = typeof usageBudget?.usageLine === 'string' && usageBudget.usageLine.trim()
    ? usageBudget.usageLine.trim()
    : '用量账本仅记录本机模型估算与云端调用，数据保存在加密账本中。';

  return `<section class="ud-shell" aria-label="使用仪表盘">
    <div class="ud-head">
      <div class="ud-head-title">
        <h2>使用仪表盘</h2>
        <span class="ud-caption">${escape(usageLine)}</span>
      </div>
      <div class="ud-metric-switch" role="group" aria-label="热力图指标切换">
        <button type="button" data-ud-metric="tokens" aria-pressed="${activeMetric === 'tokens'}">Tokens</button>
        <button type="button" data-ud-metric="cost" aria-pressed="${activeMetric === 'cost'}">成本</button>
      </div>
    </div>
    <div class="ud-kpi-strip" role="region" aria-label="关键用量指标">
      ${kpis.map(item => `<div class="ud-kpi" title="${escape(item.title)}"><strong class="ud-kpi-value${item.model ? ' is-model' : ''}">${escape(item.value)}</strong><span class="ud-kpi-label">${escape(item.label)}</span></div>`).join('')}
    </div>
    <section class="ud-heatmap-card" aria-label="${heatTitle}">
      <div class="ud-heatmap-head">
        <h3>${heatTitle}</h3>
        <div class="ud-legend" aria-hidden="true"><span>少</span><span class="ud-cell" data-heat="0"></span><span class="ud-cell" data-heat="1"></span><span class="ud-cell" data-heat="2"></span><span class="ud-cell" data-heat="3"></span><span class="ud-cell" data-heat="4"></span><span>多</span></div>
      </div>
      <div class="ud-heatmap-wrap">
        <div class="ud-heatmap-grid" role="img" aria-label="近 26 周每日活动热力图">${cellsHtml}</div>
        <div class="ud-month-axis" aria-hidden="true">${monthAxisHtml}</div>
      </div>
    </section>
    <div class="ud-breakdown">
      <section class="ud-col">
        <h3>按模型</h3>
        <div class="ud-bar-list">${renderBreakdownRows(data.byModel, {metric: activeMetric, escape, altBar: false})}</div>
      </section>
      <section class="ud-col">
        <h3>按工具与来源</h3>
        <div class="ud-bar-list">${renderBreakdownRows(data.byTool, {metric: activeMetric, escape, altBar: true})}</div>
      </section>
    </div>
  </section>`;
}
