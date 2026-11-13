/** Settings-only budget form. Values apply on change; there is no separate save control. */
export function mountUsageBudget(parent, invoke) {
  const section = document.createElement('section');
  section.className = 'sheet usage-budget';
  section.hidden = true;
  section.innerHTML = `<div class="settings-list">
      <label class="setting-row"><span><b>每日上限</b><small>元。留空表示不限制。模型 token 与云端时长都计入估算。</small></span><input data-usage="daily" type="number" min="0" step="0.01" inputmode="decimal" aria-label="每日上限" placeholder="不限制"></label>
      <label class="setting-row"><span><b>每月上限</b><small>元。留空表示不限制。</small></span><input data-usage="monthly" type="number" min="0" step="0.01" inputmode="decimal" aria-label="每月上限" placeholder="不限制"></label>
      <label class="setting-row"><span><b>超限后的处理</b><small>手动发起的任务仍会执行并提示。</small></span><select data-usage="action" aria-label="超限后的处理"><option value="degrade">降级到更便宜的模型</option><option value="pause">暂停非必要的自主任务</option></select></label>
    </div>
    <p data-usage="line"></p>`;
  parent.append?.(section);
  const field = name => section.querySelector(`[data-usage="${name}"]`);
  const daily = field('daily'), monthly = field('monthly'), action = field('action'), line = field('line');
  let applying = false;
  function limit(input) {
    const text = input.value.trim();
    return text ? Number(text) : null;
  }
  async function commit() {
    applying = true;
    try {
      const next = await invoke('usageBudget.configure', {dailyLimitYuan: limit(daily), monthlyLimitYuan: limit(monthly), action: action.value});
      if (next?.usageLine) line.textContent = next.usageLine;
    } catch (error) {
      line.textContent = error.message;
    } finally { applying = false; }
  }
  daily.addEventListener('change', () => { void commit(); });
  monthly.addEventListener('change', () => { void commit(); });
  action.addEventListener('change', () => { void commit(); });
  return {
    update(snapshot) {
      const value = snapshot ?? {dailyLimitYuan: null, monthlyLimitYuan: null, action: 'degrade', usageLine: '用量尚未接入。'};
      if (!applying) {
        if (document.activeElement !== daily) daily.value = value.dailyLimitYuan == null ? '' : String(value.dailyLimitYuan);
        if (document.activeElement !== monthly) monthly.value = value.monthlyLimitYuan == null ? '' : String(value.monthlyLimitYuan);
        if (document.activeElement !== action && (value.action === 'degrade' || value.action === 'pause')) action.value = value.action;
      }
      if (!applying || !line.textContent) line.textContent = value.usageLine ?? '';
    },
    show(visible) { section.hidden = !visible; },
  };
}
