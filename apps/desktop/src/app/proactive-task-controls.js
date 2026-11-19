const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const labels = {submitted: '已开始', waiting_approval: '等待确认', quiet: '静默中', deferred: '已暂缓', denied: '已拒绝',
  baseline: '已建立基线', unauthorized: '未授权', source_failed: '读取失败', rate_limited: '稍后继续', stale: '已过期'};

/** 只保留开关、来源、目录授权和最近记录。规则只读，不提供编辑或统计。 */
export function mountProactiveTaskControls(container, invoke) {
  const section = document.createElement('section');
  section.className = 'feature-page';
  section.setAttribute('aria-label', '主动任务');
  section.innerHTML = `<h2>主动任务</h2><p class="notice">开启后，日历和邮件的变化会自动发起低风险任务。会议改期会先出现在现有审批卡里。默认 22:00–07:00 不发起。</p><label class="setting-row"><input type="checkbox" data-field="enabled">开启主动任务</label><label class="setting-row"><input type="checkbox" data-field="calendar">日历</label><label class="setting-row"><input type="checkbox" data-field="mail">邮件</label><label class="setting-row"><input type="checkbox" data-field="quiet">22:00–07:00 不打扰</label><form class="setting-row"><input data-field="directory" type="text" placeholder="授权一个目录" aria-label="授权目录"><button type="submit">授权</button></form><ul data-directories></ul><ul data-rules></ul><ul data-recent></ul><p data-status class="notice" role="status"></p>`;
  container.append(section);
  const field = name => section.querySelector(`[data-field="${name}"]`);
  const status = section.querySelector('[data-status]');
  let snapshot;
  const paint = value => {
    snapshot = value;
    if (!value) return;
    for (const name of ['enabled', 'calendar', 'mail', 'quiet']) field(name).checked = value[name] === true;
    section.querySelector('[data-directories]').innerHTML = (value.directories ?? []).map(root =>
      `<li>${escape(root)} <button type="button" data-revoke="${escape(root)}">撤销</button></li>`).join('');
    section.querySelector('[data-rules]').innerHTML = (value.rules ?? []).map(rule => `<li>${escape(rule)}</li>`).join('');
    section.querySelector('[data-recent]').innerHTML = (value.recent ?? []).map(item =>
      `<li>${escape(labels[item.status] ?? item.status)}</li>`).join('');
  };
  const run = async (name, payload) => {
    try { paint(await invoke(name, payload)); status.textContent = ''; }
    catch (error) { status.textContent = error.message ?? '设置没有保存'; }
  };
  for (const name of ['enabled', 'calendar', 'mail', 'quiet']) {
    field(name).addEventListener('change', () => run('proactiveTasks.update', {[name]: field(name).checked}));
  }
  section.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const root = field('directory').value.trim();
    field('directory').value = '';
    if (root) return run('proactiveTasks.authorize', {root});
  });
  section.addEventListener('click', event => {
    const root = event.target?.dataset?.revoke;
    if (root) return run('proactiveTasks.revoke', {root});
  });
  return {render: paint, show(visible) { section.hidden = !visible; }};
}
