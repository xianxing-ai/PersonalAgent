// The trusted main process owns this lease. Renderer requests cannot create or extend it.
export function createMicrophonePermissionGate({expectedPageUrl, isTrustedWindow, now = Date.now}) {
  const page = new URL(expectedPageUrl);
  if (page.protocol !== 'file:' || typeof isTrustedWindow !== 'function') throw Error('Invalid microphone permission gate');
  let lease;

  function isCapturePage(url, contents) {
    try {
      const candidate = new URL(url);
      const params = [...candidate.searchParams];
      return candidate.protocol === 'file:' && candidate.host === page.host && candidate.pathname === page.pathname &&
        !candidate.hash && params.length === 1 && params[0][0] === 'mode'
        && ['panel','workspace'].includes(params[0][1]) && isTrustedWindow(contents,params[0][1]);
    } catch { return false; }
  }

  function revoke() {
    if (!lease) return;
    const old = lease;
    lease = undefined;
    clearTimeout(old.timer);
    old.signal?.removeEventListener('abort', old.revoke);
    old.webContents.removeListener('destroyed', old.revoke);
    old.webContents.removeListener('did-start-navigation', old.revoke);
    old.webContents.removeListener('render-process-gone', old.revoke);
    old.onRevoke?.();
  }

  function grant({webContents, deadlineAtMs, signal, onRevoke}) {
    if (lease && (now() >= lease.deadlineAtMs || lease.signal?.aborted)) revoke();
    if (lease) throw Error('Microphone permission is already leased');
    if (!Number.isFinite(deadlineAtMs) || deadlineAtMs <= now() || signal?.aborted ||
        !webContents || typeof webContents.on !== 'function' || typeof webContents.removeListener !== 'function' ||
        webContents.isDestroyed() || !isCapturePage(webContents.getURL(),webContents)) {
      throw Error('Invalid microphone permission lease');
    }
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw Error('Invalid microphone permission signal');
    }
    if (onRevoke !== undefined && typeof onRevoke !== 'function') throw Error('Invalid microphone revoke handler');
    const active = {webContents, url: webContents.getURL(), deadlineAtMs, signal, onRevoke};
    active.revoke = () => { if (lease === active) revoke(); };
    lease = active;
    signal?.addEventListener('abort', active.revoke, {once: true});
    webContents.on('destroyed', active.revoke);
    webContents.on('did-start-navigation', active.revoke);
    webContents.on('render-process-gone', active.revoke);
    if (signal?.aborted || webContents.isDestroyed() || webContents.getURL() !== active.url) {
      active.revoke();
      throw Error('Microphone permission lease expired during setup');
    }
    const scheduleExpiry = () => {
      if (lease !== active) return;
      const remaining = active.deadlineAtMs - now();
      if (remaining <= 0) { revoke(); return; }
      active.timer = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647));
      active.timer.unref?.();
    };
    scheduleExpiry();
    return active.revoke;
  }

  function permits(webContents, permission, details) {
    if (!lease || permission !== 'media') return false;
    if (now() >= lease.deadlineAtMs || lease.signal?.aborted) { revoke(); return false; }
    try {
      return webContents === lease.webContents && !webContents.isDestroyed() && isCapturePage(lease.url,webContents) &&
        webContents.getURL() === lease.url && details?.isMainFrame === true && details.requestingUrl === lease.url;
    } catch { return false; }
  }

  function request(webContents, permission, callback, details) {
    callback(permits(webContents, permission, details) &&
      Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio');
  }

  function check(webContents, permission, _requestingOrigin, details) {
    return permits(webContents, permission, details) && details.mediaType === 'audio';
  }

  return {grant, revoke, request, check};
}
