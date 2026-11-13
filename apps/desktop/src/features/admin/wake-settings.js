const DURATIONS = [['minutes30', '30 分钟'], ['hours2', '2 小时'], ['untilQuit', '直到关闭应用']];

export function mountWakeSettings(root, invoke) {
  const section = document.createElement('section');
  section.className = 'sheet wake-settings';
  section.innerHTML = `<h2>语音唤醒</h2><p class="muted">说「你好小派」后开始听写，草稿仍需你发送。收起悬浮面板不会关掉唤醒。</p>
    <form class="settings-form" data-wake-form>
      <label class="notification-check"><input name="enabled" type="checkbox">允许语音唤醒</label>
      <label>开启后保持<select name="duration">${DURATIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
    </form>
    <p class="muted">选「直到关闭应用」时，单次最长 8 小时，避免麦克风一直开着。到点后如果开关还开着，可以再开一次。</p>
    <p data-wake-status role="status"></p>`;
  root.append(section);
  const form = section.querySelector('[data-wake-form]');
  const status = section.querySelector('[data-wake-status]');
  let current = {enabled: false, duration: 'untilQuit'};
  let closed = false;
  form.addEventListener('change', () => {
    const enabled = form.elements.namedItem('enabled').checked;
    const duration = form.elements.namedItem('duration').value;
    if (enabled === current.enabled && duration === current.duration) return;
    status.textContent = '正在保存…';
    void invoke('voice.wake.preference', {enabled, duration}).catch(error => {
      if (!closed) status.textContent = error?.message || '没有保存唤醒设置';
    });
  });
  return {
    show(visible) { section.hidden = !visible; },
    render(preference, wake) {
      current = preference ?? current;
      const enabled = form.elements.namedItem('enabled');
      const duration = form.elements.namedItem('duration');
      if (document.activeElement !== enabled) enabled.checked = current.enabled === true;
      if (document.activeElement !== duration && DURATIONS.some(([value]) => value === current.duration)) duration.value = current.duration;
      const listening = wake?.phase === 'listening';
      status.textContent = listening ? '正在聆听「你好小派」。' : current.enabled ? '已允许。悬浮球空闲时会显示正在聆听。' : '唤醒未开启。';
    },
    dispose() { closed = true; },
  };
}
