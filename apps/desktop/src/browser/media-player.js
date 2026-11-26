// Receives only ordered WebM fragments from the already playing, host-owned tab.
export function createBrowserMediaPlayer(video, {read, changed}) {
  let generation = 0, timer, reading, enabled = false, restart = true;
  let streamId, source, buffer, objectUrl, pending = [], pendingSize = 0;
  let state = 'idle', detail = '', retried = false;
  let stopped = Promise.resolve();
  const report = (next, message = '') => {
    if (state === next && detail === message) return;
    state = next; detail = message;
    changed(state, detail);
  };
  function clearPlayer() {
    streamId = undefined;
    if (buffer) {
      buffer.removeEventListener('updateend', append);
      buffer.removeEventListener('error', decodeError);
    }
    buffer = source = undefined;
    pending = []; pendingSize = 0;
    if (objectUrl) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
      objectUrl = undefined;
    }
  }
  function unavailable(message) {
    clearPlayer();
    enabled = false;
    clearTimeout(timer);
    stopped = read({stop: true}).catch(() => {});
    report('unavailable', message);
  }
  function decodeError() {
    if (!enabled) return;
    clearPlayer();
    if (retried) { unavailable('侧栏未能解码此媒体。'); return; }
    retried = restart = true;
    report('waiting', '正在重新连接播放器…');
  }
  function append() {
    if (!buffer || buffer.updating || source.readyState !== 'open') return;
    try {
      if (buffer.buffered.length) {
        const ranges = buffer.buffered, end = ranges.end(ranges.length - 1);
        if (end - video.currentTime > 2.5) video.currentTime = Math.max(ranges.start(ranges.length - 1), end - 0.55);
        const cutoff = video.currentTime - 12;
        if (cutoff > ranges.start(0) + 3) { buffer.remove(0, cutoff); return; }
      }
      if (!pending.length) return;
      const next = pending.shift();
      pendingSize -= next.byteLength;
      buffer.appendBuffer(next);
    } catch { decodeError(); }
  }
  function receive(packet) {
    if (packet?.state === 'waiting') return;
    if (packet?.state === 'unavailable') {
      unavailable('此网页的媒体无法在侧栏播放。');
      return;
    }
    if (packet?.state === 'idle' || packet?.state === 'ended') {
      clearPlayer();
      report(packet.state);
      return;
    }
    if (packet?.state !== 'streaming' || typeof packet.streamId !== 'string' || !Array.isArray(packet.chunks)) return;
    if (streamId !== packet.streamId) {
      clearPlayer();
      const mime = packet.mimeType;
      if (typeof mime !== 'string' || !/^(?:audio|video)\/webm(?:;|$)/i.test(mime) || !globalThis.MediaSource?.isTypeSupported(mime)) {
        unavailable('此媒体的编码不受侧栏播放器支持。'); return;
      }
      streamId = packet.streamId;
      const nextSource = source = new MediaSource();
      nextSource.addEventListener('sourceopen', () => {
        if (source !== nextSource || !enabled) return;
        try {
          buffer = source.addSourceBuffer(mime);
          buffer.addEventListener('updateend', append);
          buffer.addEventListener('error', decodeError);
          append();
        } catch { decodeError(); }
      }, {once: true});
      video.src = objectUrl = URL.createObjectURL(source);
      report('buffering', '正在缓冲…');
      void video.play().catch(error => {
        if (source === nextSource && error.name === 'NotAllowedError') report('gesture', '点击播放以观看。');
      });
    }
    for (const part of packet.chunks) {
      if (typeof part !== 'string' || part.length > 8 * 1024 * 1024) { decodeError(); return; }
      const bytes = typeof Uint8Array.fromBase64 === 'function' ? Uint8Array.fromBase64(part) : Uint8Array.from(atob(part), char => char.charCodeAt(0));
      pending.push(bytes);
      pendingSize += bytes.byteLength;
      if (pendingSize > 8 * 1024 * 1024) { decodeError(); return; }
    }
    append();
  }
  async function pull(owner) {
    if (!enabled || owner !== generation) return;
    try {
      await stopped;
      if (!enabled || owner !== generation) return;
      const payload = restart ? {restart: true} : {};
      restart = false;
      const packet = await read(payload);
      if (enabled && owner === generation) receive(packet);
    } catch {
      if (enabled && owner === generation) unavailable('未能连接当前网页的媒体。');
    } finally {
      if (enabled && owner === generation) timer = setTimeout(() => { reading = pull(owner); }, 300);
    }
  }
  video.addEventListener('playing', () => { if (enabled && source) report('playing'); });
  video.addEventListener('error', () => { if (enabled && source && video.error) decodeError(); });
  return {
    start() {
      if (enabled || state === 'unavailable') return;
      enabled = true; restart = true; retried = false;
      report('waiting', '正在连接网页播放器…');
      reading = pull(++generation);
    },
    stop() {
      if (!enabled && state === 'idle') return;
      ++generation;
      enabled = false;
      clearTimeout(timer);
      clearPlayer();
      report('idle');
      const prior = reading;
      stopped = Promise.resolve(prior).catch(() => {}).then(() => read({stop: true})).catch(() => {});
    },
  };
}
