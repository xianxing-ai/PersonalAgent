const safeReason = (value, fallback) => typeof value === 'string' && value.trim() ? value
  .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, '[凭据已遮蔽]')
  .replace(/\b((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+/giu, '$1[凭据已遮蔽]')
  .replace(/\bsk-[\w-]{8,}/gu, '[凭据已遮蔽]')
  .replace(/(?:\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|authorization|password|secret|cookie|set-cookie)|("?(?:密钥|密码|令牌)"?))(["']?\s*[:=：]\s*)(?!\[(?:凭据|正文|路径)已遮蔽\](?=[\s,&;，；}\]]|$))(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,&;，；]+)/giu, (_all, key, chinese, separator) => `${key ?? chinese}${separator}[凭据已遮蔽]`)
  .replace(/(?:\b((?:response[ _-]?|request[ _-]?|email[ _-]?)?body|content|text|prompt|stdout|stderr|html|page[_-]?text|window[_-]?text)|((?:邮件)?正文))(["']?\s*[:=：]\s*)(?!\[(?:凭据|正文|路径)已遮蔽\](?=[\s,&;，；}\]]|$))(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;；][^;；\r\n]*)/giu, (_all, key, chinese, separator) => `${key ?? chinese}${separator}[正文已遮蔽]`)
  .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu, '$1[凭据已遮蔽]@')
  .replace(/\bfile:\/\/[^\s"'<>，；。！？,;)\]}]+/giu, '[路径已遮蔽]')
  .replace(/(["'])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\r\n]*?\1/gu, '[路径已遮蔽]')
  .replace(/\b[A-Za-z]:[\\/][^\s"'<>，；。！？,;)\]}]+/gu, '[路径已遮蔽]')
  .replace(/\\\\[^\s\\]+\\[^\s"'<>，；。！？,;)\]}]+/gu, '[路径已遮蔽]')
  .replace(/(?<![:/\w])\/(?:[^/\s"'<>，；。！？,;)\]}]+\/)*[^/\s"'<>，；。！？,;)\]}]+/gu, '[路径已遮蔽]') : fallback;
/** Only Main's bounded, sanitized computer action diagnostic bypasses generic classification. */
export function readComputerControlDiagnostic(value, action) {
  if(typeof action!=='string'||!action.startsWith('computer.control.')||!value||typeof value!=='object'
    ||value.kind!=='computer-control'||value.stage!==action||typeof value.code!=='string'
    ||!/^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)||typeof value.message!=='string'
    ||!value.message.trim()||value.message.length>8192)return;
  return {code:value.code,stage:value.stage,message:safeReason(value.message,'电脑操作失败')};
}

export function mountComputerControls(root, invoke) {
  const document = root.ownerDocument;
  const section = document.createElement('section');
  section.className = 'sheet';
  section.innerHTML = `<h2>本机权限</h2>
    <label class="computer-control-toggle"><input type="checkbox" name="enabled" disabled>允许工人操作本机</label>
    <label class="computer-control-toggle" data-pro-only="true"><input type="checkbox" name="allowObservationExport" disabled>允许任务模型读取目标窗口内容</label>
    <p role="status" aria-live="polite" hidden></p>`;
  root.append(section);
  const enabled = section.querySelector('[name="enabled"]');
  const observation = section.querySelector('[name="allowObservationExport"]');
  const status = section.querySelector('[role="status"]');
  let state, pending = false, closed = false, error = '';
  function render(next) {
    if (closed) return;
    state = next;
    const ready = Number.isSafeInteger(state?.preferenceRevision);
    enabled.checked = state?.enabled === true;
    observation.checked = state?.observationPreference === true;
    enabled.disabled = !ready || pending;
    observation.disabled = !ready || !enabled.checked || pending;
    status.textContent = error || (enabled.checked && state?.failure ? state.reason : '');
    status.hidden = !status.textContent;
  }
  async function change(event) {
    const field = event.target;
    if ((field !== enabled && field !== observation) || field.disabled || pending) return;
    const payload = {expectedRevision:state.preferenceRevision, [field.name]:field.checked};
    pending = true;
    error = '';
    render(state);
    try {
      const result = await invoke('computer.control.configure',payload);
      if (closed) return;
      if (result?.computerControl?.preferenceRevision >= state.preferenceRevision) state = result.computerControl;
    } catch (cause) {
      if (!closed) error = safeReason(cause?.message,'设置未保存，请重新打开安全与权限。');
    } finally {
      pending = false;
      render(state);
    }
  }
  section.addEventListener('change',change);
  return {render,show(visible){section.hidden = !visible;},dispose(){closed = true; section.removeEventListener('change',change);}};
}

export function mountBrowserConnections(root, invoke) {
  const section = root.ownerDocument.createElement('section');
  section.className = 'sheet';
  section.innerHTML = '<h2>浏览器连接</h2><p data-managed></p><p data-connected role="status"></p><button type="button" class="btn">检测现有浏览器扩展</button>';
  root.append(section);
  const probe = section.querySelector('button');
  const managed = section.querySelector('[data-managed]');
  const connected = section.querySelector('[data-connected]');
  let state, pending = false, closed = false, error = '', revision = 0;
  function paint() {
    const browser = state?.browser;
    managed.textContent = '内置受控浏览器 · ' + (browser?.available ? '已就绪' : safeReason(browser?.reason, '尚未就绪'));
    const link = browser?.connected;
    connected.textContent = error || (link?.extension?.connected || link?.extension?.available || link?.available
      ? '现有浏览器扩展已连通' : safeReason(link?.guide || link?.extension?.guide || link?.reason, '等待检测现有浏览器扩展'));
    probe.disabled = !state?.enabled || pending;
  }
  probe.onclick = async () => {
    if (probe.disabled || closed) return;
    const before = revision;
    pending = true;
    error = '';
    paint();
    try {
      const result = await invoke('computer.control.probeConnectedBrowser', {});
      if (!closed && revision === before && result?.computerControl) state = result.computerControl;
    } catch (cause) {
      error = safeReason(cause?.message, '扩展检测失败');
    } finally {
      pending = false;
      if (!closed) paint();
    }
  };
  return {render(value){if (!closed) {state = value; revision++; paint();}},
    show(visible){section.hidden = !visible;}, dispose(){closed = true; probe.onclick = null;}};
}
