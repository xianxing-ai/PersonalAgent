export function mountWorkspaceBrowserSidebar(shell, bar, invoke, report) {
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
  const api = {
    call: (action, payload) => invoke('browser.workspace.action', payload === undefined ? {action} : {action, payload}),
    onState(listener) {
      changes.add(listener);
      return () => changes.delete(listener);
    },
    dismiss,
  };
  async function show() {
    if (disposed || !container.hidden) return;
    const current = ++presentation;
    focusBeforeOpen = document.activeElement;
    visibility(true);
    try {
      loading ??= import('../../browser/browser.js').then(({mountBrowserPane}) => {
        if (!disposed) pane = mountBrowserPane(container, api);
      });
      await loading;
      if (!disposed && current === presentation) pane?.onShow?.();
    } catch (error) {
      loading = undefined;
      if (!disposed && current === presentation) { dismiss(); report(error); }
    }
  }
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
    window.removeEventListener('keydown', onKey);
  }, {once: true});
}
