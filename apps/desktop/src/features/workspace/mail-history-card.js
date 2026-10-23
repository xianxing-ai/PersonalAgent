/** A local aggregate is historical display data, never permission to read mail. */
export function historicalMailCard(mail, escape) {
  const total = mail.counts?.total;
  if (!Number.isSafeInteger(total) || total <= 0 || mail.sessionAllowed === true
    || mail.monitoring?.enabled === true || !['disabled', 'ready', 'complete'].includes(mail.status)) return;
  const summary = `历史分类 ${total} 封 · 非实时`;
  return {
    status: '需重新授权',
    preview: `<div class="mail-preview"><span class="mail-avatar">M</span><div><strong>${escape(mail.account || mail.user || '电子邮箱')}</strong><small>${escape(summary)}</small></div></div><p class="preview-excerpt">已有分类记录已保留；读取许可已过期，点击进入连接设置重新授权。此卡片不会读取新邮件。</p>`,
    footer: `仅展示历史数量 · ${escape(summary)}`,
  };
}
