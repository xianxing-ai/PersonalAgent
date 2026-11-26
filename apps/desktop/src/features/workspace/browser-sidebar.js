export function mountWorkspaceBrowserSidebar(shell, bar, invoke) {
  const document = shell.ownerDocument;
  const window = document.defaultView;
  const container = document.createElement('aside');
  container.id = 'workspace-browser-sidebar';
  container.className = 'cc-browser-sidebar';
  container.setAttribute('aria-label', '内置浏览器');
  container.hidden = true;
  shell.append(container);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'cc-browser-open';
  toggle.title = '展开内置浏览器';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.setAttribute('aria-controls', container.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>';
  bar.querySelector('.window-controls').before(toggle);

  const changes = new Set();
  let pane, loading, disposed = false, focusBeforeOpen, presentation = 0;
  function visibility(visible) {
    container.hidden = !visible;
    shell.classList.toggle('cc-browser-visible', visible);
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.title = visible ? '收起内置浏览器' : '展开内置浏览器';
    toggle.setAttribute('aria-label', toggle.title);
  }
  function dismiss() {
    if (container.hidden) return;
    presentation++;
    visibility(false);
    pane?.onHide?.();
    const destination = focusBeforeOpen?.isConnected && focusBeforeOpen !== document.body ? focusBeforeOpen : toggle;
    destination.focus({preventScroll: true});
  }
  async function mountVisiblePane() {
    const current = ++presentation;
    try {
      loading ??= import('../../browser/browser.js');
      const {mountBrowserPane} = await loading;
      if (disposed || container.hidden || current !== presentation) return;
      if (!pane) {
        const assistantId = shell.dataset.browserAssistantId || undefined;
        const paneId = window.crypto.randomUUID();
        const host = document.createElement('div');
        container.replaceChildren(host);
        pane = mountBrowserPane(host, {
          call(action, payload) {
            return invoke('browser.workspace.action', {
              action, paneId, ...(payload === undefined ? {} : {payload}), ...(assistantId ? {assistantId} : {}),
            });
          },
          onState(listener) {
            changes.add(listener);
            return () => changes.delete(listener);
          },
          dismiss,
        });
      }
      pane.onShow();
    } catch {
      loading = undefined;
      if (disposed || container.hidden || current !== presentation) return;
      pane?.dispose();
      pane = undefined;
      const label = document.createElement('span'), retry = document.createElement('button');
      label.setAttribute('role', 'status');
      label.textContent = '加载失败';
      retry.type = 'button'; retry.textContent = '重试';
      retry.addEventListener('click', () => { retry.disabled = true; void mountVisiblePane(); });
      container.replaceChildren(label, retry);
    }
  }
  function show() {
    if (disposed || !container.hidden) return;
    focusBeforeOpen = document.activeElement;
    visibility(true);
    return mountVisiblePane();
  }
  function changeThread() {
    presentation++;
    pane?.dispose();
    pane = undefined;
    container.replaceChildren();
    if (!disposed && !container.hidden) void mountVisiblePane();
  }
  shell.addEventListener('browser-thread-changed', changeThread);
  toggle.onclick = () => { if (container.hidden) void show(); else dismiss(); };
  const onKey = event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !container.hidden
        && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      dismiss();
    }
  };
  window.addEventListener('keydown', onKey);
  const offOpen = window.desktop?.onBrowserWorkspaceOpen?.(() => { void show(); });
  const offChange = window.desktop?.onBrowserWorkspaceChange?.(() => {
    if (!container.hidden) for (const listener of changes) listener();
  });
  window.addEventListener('unload', () => {
    disposed = true;
    offOpen?.(); offChange?.(); changes.clear();
    pane?.dispose?.();
    shell.removeEventListener('browser-thread-changed', changeThread);
    window.removeEventListener('keydown', onKey);
  }, {once: true});
}
