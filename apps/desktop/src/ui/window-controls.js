const paths = {
  minimize: 'M5 12h14', maximize: 'M5 5h14v14H5z',
  restore: 'M8 8h12v12H8zM16 8V4H4v12', close: 'm6 6 12 12M6 18 18 6',
};

export function windowControlsHtml(mode) {
  if (!['admin', 'workspace'].includes(mode)) throw Error('Unsupported window controls');
  return `<div class="window-controls" role="group" aria-label="窗口控制">${['minimize', 'maximize', 'close'].map(action =>
    `<button type="button" class="window-button${action === 'close' ? ' window-close' : ''}" data-window="${action}"${mode === 'admin' ? ` id="admin-${action}"` : ''} aria-label="${{minimize:'最小化',maximize:'最大化',close:mode === 'workspace' ? '关闭工作区' : '关闭'}[action]}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[action]}"/></svg></button>`).join('')}</div>`;
}

export function mountWindowControls(root, invoke, mode, report) {
  const bridge = window.desktop;
  let maximized = false, observed = false, closed = false;
  const buttons = [...root.querySelectorAll('[data-window]')];
  function paint() {
    if (closed) return;
    const english = document.documentElement.lang.startsWith('en');
    document.documentElement.dataset.windowMaximized = String(maximized);
    const labels = english
      ? {minimize:'Minimize',maximize:maximized ? 'Restore' : 'Maximize',close:mode === 'workspace' ? 'Close workspace' : 'Close'}
      : {minimize:'最小化',maximize:maximized ? '还原' : '最大化',close:mode === 'workspace' ? '关闭工作区' : '关闭'};
    for (const button of buttons) {
      button.setAttribute('aria-label', labels[button.dataset.window]);
      button.setAttribute('title', labels[button.dataset.window]);
      if (button.dataset.window === 'maximize') {
        button.dataset.maximized = String(maximized);
        button.querySelector('path').setAttribute('d', paths[maximized ? 'restore' : 'maximize']);
      }
    }
    root.querySelector('.window-controls')?.setAttribute('aria-label', english ? 'Window controls' : '窗口控制');
  }
  function apply(state) {
    if (closed || typeof state?.maximized !== 'boolean') return;
    maximized = state.maximized;paint();
  }
  const unsubscribe = bridge?.subscribeWindowState?.(state => {observed = true;apply(state);});
  if (bridge?.windowState) Promise.resolve().then(() => bridge.windowState())
    .then(state => {if (!observed) apply(state);}).catch(() => {});
  const language = new MutationObserver(paint);
  language.observe(document.documentElement, {attributes:true,attributeFilter:['lang']});
  const handlers = buttons.map(button => {
    const click = async () => {
      if (closed || button.disabled) return;
      button.disabled = true;
      try { await invoke(`${mode}.${button.dataset.window}`); }
      catch (error) { if (!closed) report(error); }
      finally { if (!closed) button.disabled = false; }
    };
    button.addEventListener('click', click);
    return [button, click];
  });
  function dispose() {
    if (closed) return;
    closed = true;language.disconnect();unsubscribe?.();
    for (const [button, click] of handlers) button.removeEventListener('click', click);
    window.removeEventListener('unload', dispose);
  }
  window.addEventListener('unload', dispose, {once:true});
  paint();
  return dispose;
}
