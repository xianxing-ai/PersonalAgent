const blockedStates = new Set(['blocked', 'blocked_unknown', 'waiting_reconciliation', 'result_unknown', 'unknown', 'stop_unconfirmed']);
const preparingStates = new Set(['preparing', 'starting', 'connecting', 'stopping']);
const taskId = value => typeof value === 'string' && value.trim() && value.length <= 256 ? value : undefined;
const snapshotValue = value => {
  const state = value?.computerControl ?? value;
  return state && typeof state === 'object' && !Array.isArray(state)
    && typeof state.state === 'string' && typeof state.enabled === 'boolean'
    && typeof state.available === 'boolean' && typeof state.providerAvailable === 'boolean'
    && typeof state.waitingConfirmation === 'boolean' && typeof state.observationExportAllowed === 'boolean'
    && typeof state.reason === 'string' ? state : undefined;
};
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
const phases = {configure:'保存设置',prepare:'准备组件',stop:'停止电脑输入',confirm:'确认在场',launch:'提交任务',
  launch_receipt:'读取任务受理回执',status_readback:'读回电脑状态',open_conversation:'打开原对话'};
const failureText = (error, phase) => {
  const code = error?.code ?? error?.errorCode;
  const errorCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'EXTERNAL_FAILURE';
  const stage = error?.stage ?? error?.phase ?? phase;
  const safeStage = typeof stage === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(stage) ? stage : phase;
  const message = typeof error === 'string' ? error : error?.message;
  return `${phases[phase] ?? '电脑操作'}失败 [${errorCode}]（阶段：${safeStage}）：${safeReason(message, '宿主未提供具体错误原因。')}`;
};

/** Only Main's bounded, sanitized computer action diagnostic bypasses generic classification. */
export function readComputerControlDiagnostic(value, action) {
  if(typeof action!=='string'||!action.startsWith('computer.control.')||!value||typeof value!=='object'
    ||value.kind!=='computer-control'||value.stage!==action||typeof value.code!=='string'
    ||!/^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)||typeof value.message!=='string'
    ||!value.message.trim()||value.message.length>8192)return;
  return {code:value.code,stage:value.stage,message:safeReason(value.message,'电脑操作失败')};
}

/** Settings submit intent only. Main owns components, task binding, Policy and input. */
export function mountComputerControls(root, invoke) {
  const document = root.ownerDocument ?? globalThis.document;
  const section = document.createElement('section');
  section.className = 'sheet computer-controls';
  section.setAttribute('aria-label', '通用电脑操作');
  section.innerHTML = `<h2>电脑操作</h2>
    <p class="computer-controls-intro">在主对话中说明要操作哪个窗口、完成什么。应用会核对目标，执行状态和结果以原任务记录为准。</p>
    <label class="computer-control-toggle"><input type="checkbox" data-computer="enabled" checked disabled><span>启用电脑操作</span></label>
    <label class="computer-control-toggle"><input type="checkbox" data-computer="export" disabled><span>允许将目标窗口观察用于当前模型对话</span></label>
    <p class="computer-controls-hint">完全访问模式会自动同意应用授权，也会尊重你明确关闭目标窗口观察导出的选择；受限模式沿用当前任务的授权卡。这里的在场确认只继续原任务，不代替操作授权。切换窗口或扩大范围仍需重新核对。</p>
    <p data-computer="status" role="status" aria-live="polite"></p>
    <p data-computer="provider" class="computer-controls-hint"></p>
    <p data-computer="browser" class="computer-controls-hint"></p>
    <p data-computer="failure" role="alert" aria-live="polite"></p>
    <div class="form-actions computer-controls-actions">
      <button type="button" class="btn" data-computer-action="prepare" disabled>准备 / 重试</button>
      <button type="button" class="btn btn-danger" data-computer-action="stop" disabled>立即停止电脑输入</button>
      <button type="button" class="btn" data-computer-action="confirm" hidden disabled>确认本次在场</button>
      <button type="button" class="btn" data-computer-action="open" disabled>查看原对话</button>
    </div>
    <p class="computer-controls-hint">停止后会核实最后一步；结果未知时不会自动重做。准备组件不会替你执行任务。</p>
    <form class="computer-controls-form">
      <label>要做什么<textarea data-computer="text" maxlength="4000" rows="3" placeholder="例如：在当前窗口填写一段文字，先不要提交"></textarea></label>
      <div class="form-actions"><button type="submit" class="btn btn-primary" data-computer="launch" disabled>在主对话开始操作</button><button type="button" class="btn" data-computer-action="demo">填入演示</button></div>
    </form>
    <p data-computer="feedback" role="status" aria-live="polite"></p>`;
  const anchor = root.querySelector('#error');
  if (anchor) anchor.before(section); else root.append(section);
  const field = name => section.querySelector(`[data-computer="${name}"]`);
  const button = name => section.querySelector(`[data-computer-action="${name}"]`);
  const form = section.querySelector('form');
  let state, pending, operation = 0, publication = 0, closed = false, unconfirmed = false;
  let launchUnknown = false, lastTaskId, feedback = '', feedbackFailed = false;
  const blocked = () => blockedStates.has(state?.state) || state?.input?.state === 'blocked';
  const busy = () => state?.input?.busy === true;
  const originalTask = () => taskId(state?.recoveryTaskId) ?? taskId(state?.activeTaskId) ?? lastTaskId;
  function paint() {
    if (closed) return;
    const known = Boolean(state);
    section.setAttribute('aria-busy', String(Boolean(pending)));
    field('enabled').checked = state?.enabled ?? true;
    field('export').checked = state?.observationExportAllowed ?? false;
    field('enabled').disabled = field('export').disabled = !known || Boolean(pending) || unconfirmed;
    field('status').textContent = !known ? '正在等待可信宿主报告电脑操作状态。'
      : blocked() ? '最后一次电脑操作或停止结果待核实，后续输入已暂停。'
        : state.waitingConfirmation ? '原任务正在等待本次在场确认；请保持目标窗口不变，再确认或按 F9。'
          : busy() ? '原任务正在操作电脑；你可以随时停止输入。'
            : !state.enabled ? '电脑操作已关闭。'
              : state.input?.writeBlocked === true ? '电脑输入已暂停，请准备组件或查看原对话。'
                : safeReason(state.reason, state.available ? '电脑操作已准备好；任务执行后仍需核对结果。' : '电脑操作暂不可用，请准备组件或重试。');
    const source = {'windows-native':'Windows 原生组件', 'windows-native-broker':'Windows 原生组件',
      'windows-broker':'Windows 原生组件', 'windows-mcp':'兼容电脑组件', synthetic:'离线联调组件'}[state?.provider?.source];
    field('provider').textContent = !known ? '' : `本机操作：${state.providerAvailable ? '组件已连接' : '组件未就绪'}${source ? ` · ${source}` : ''}`;
    const browser = state?.browser;
    field('browser').textContent = browser ? `独立浏览器：${browser.available === true ? '已准备' : '未就绪'}${browser.reason ? ` · ${safeReason(browser.reason, '请准备浏览器组件后重试')}` : ''}${browser.connected ? `；现有浏览器：${safeReason(browser.connected.reason, '需要 OpenCLI 扩展连接')}` : ''}` : '';
    field('failure').textContent = state?.failure ? failureText(state.failure, 'host') : '';
    button('prepare').disabled = !known || !state.enabled || Boolean(pending) || blocked() || unconfirmed
      || preparingStates.has(state.state) || busy() || state.waitingConfirmation;
    button('stop').disabled = pending === 'stop' || !known && !pending && !unconfirmed
      || known && !state.enabled && !state.providerAvailable && !busy() && !state.waitingConfirmation && !pending && !unconfirmed && !launchUnknown;
    button('confirm').hidden = state?.waitingConfirmation !== true;
    button('confirm').disabled = !known || !state.enabled || !state.waitingConfirmation
      || !taskId(state.activeTaskId) || Boolean(pending) || blocked() || unconfirmed;
    button('open').disabled = !originalTask() || Boolean(pending);
    field('launch').disabled = !known || !state.enabled || !state.available || Boolean(pending)
      || preparingStates.has(state.state) || state.waitingConfirmation || busy() || blocked()
      || state.input?.writeBlocked === true || unconfirmed || launchUnknown || !field('text').value.trim();
    field('feedback').textContent = feedback || (launchUnknown ? '任务受理结果未获确认；请先停止并查看原对话，避免重复执行。' : '');
    field('feedback').setAttribute('role', unconfirmed || launchUnknown || feedbackFailed ? 'alert' : 'status');
  }
  function render(value) {
    if (closed) return;
    const next = snapshotValue(value);
    if (next) {state = next; publication++; unconfirmed = false;}
    paint();
  }
  async function run(kind, payload) {
    if (closed || pending && kind !== 'stop') return;
    const id = ++operation, before = publication;
    pending = kind; unconfirmed = false; feedbackFailed = false;
    feedback = kind === 'stop' ? '正在停止电脑输入，并核对最后一步…'
      : kind === 'launch' ? '正在向原主对话提交任务…' : '正在等待可信宿主读回…';
    paint();
    let receipt, operationError = '';
    try {receipt = await invoke(`computer.control.${kind}`, payload);}
    catch (error) {operationError = failureText(error, kind);}
    if (closed || id !== operation) return;
    if (kind === 'launch') {
      const accepted = taskId(receipt?.taskId);
      if (!operationError && accepted) {lastTaskId = accepted; launchUnknown = false;}
      else {
        launchUnknown = true;
        operationError ||= failureText({code:'PROTOCOL_MISMATCH',message:'宿主没有返回有效的原任务标识，无法确认任务是否已受理。'}, 'launch_receipt');
      }
    }
    // A host publication wins over a reply captured before it. Readback also handles lost replies.
    if (publication === before) {const next = snapshotValue(receipt); if (next) state = next;}
    const observed = publication;
    try {
      const readback = await invoke('snapshot');
      if (closed || id !== operation) return;
      const latest = publication === observed ? snapshotValue(readback?.computerControl) : state;
      if (!latest) throw Object.assign(Error('宿主没有返回完整的电脑状态，无法核实本次操作。'), {code:'PROTOCOL_MISMATCH'});
      state = latest; unconfirmed = false;
      if (kind === 'stop' && !blocked() && !busy() && !state.waitingConfirmation && !taskId(state.activeTaskId)) launchUnknown = false;
      feedbackFailed = Boolean(operationError);
      feedback = [operationError, launchUnknown ? '任务受理结果未获确认；请先停止并查看原对话，避免重复执行。'
        : operationError ? '上方为当前宿主状态，请按需停止或查看原对话。'
          : kind === 'launch' ? '任务已受理；请在原对话查看授权、执行状态和结果。' : ''].filter(Boolean).join('\n');
    } catch (error) {
      if (!closed && id === operation) {
        unconfirmed = true;
        feedbackFailed = true;
        feedback = [operationError, failureText(error, 'status_readback'),
          '当前电脑操作状态未获确认；请停止输入并核对原对话。输入内容已保留。'].filter(Boolean).join('\n');
      }
    } finally {if (!closed && id === operation) {pending = undefined; paint();}}
  }
  function change(event) {
    if (closed || ![field('enabled'), field('export')].includes(event.target) || event.target.disabled) return;
    return run('configure', {enabled: field('enabled').checked, allowObservationExport: field('export').checked});
  }
  async function click(event) {
    const target = event.target.closest('[data-computer-action]');
    if (closed || !target || !section.contains(target) || target.disabled) return;
    const action = target.dataset.computerAction;
    if (action === 'demo') {field('text').value = '在当前窗口输入“PersonalAgent 电脑操作演示”，先不要发送或提交。'; paint(); return;}
    if (action === 'open') {
      const original = originalTask(); if (!original) return;
      try {await invoke('task.openConversation', {taskId: original});}
      catch (error) {if (!closed) {feedback = failureText(error, 'open_conversation'); feedbackFailed = true; paint();}}
      return;
    }
    if (action === 'confirm') return run('confirm', {taskId: state.activeTaskId});
    if (action === 'prepare' || action === 'stop') return run(action, {});
  }
  function submit(event) {
    event.preventDefault?.();
    if (closed || field('launch').disabled) return;
    const text = field('text').value.trim();
    if (!text || text.length > 4000) return;
    return run('launch', {text});
  }
  const input = () => paint();
  section.addEventListener('change', change); section.addEventListener('click', click);
  form.addEventListener('submit', submit); form.addEventListener('input', input);
  paint();
  return {render, show(visible) {if (!closed) section.hidden = !visible;}, dispose() {
    closed = true; operation++;
    section.removeEventListener('change', change); section.removeEventListener('click', click);
    form.removeEventListener('submit', submit); form.removeEventListener('input', input); section.remove();
  }};
}
