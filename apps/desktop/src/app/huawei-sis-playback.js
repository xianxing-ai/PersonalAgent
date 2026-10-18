/** Play only the WAV bytes sent by the trusted main process. */
export function mountHuaweiSisPlayback(bridge) {
  let current, disposed = false;

  async function finish(operation, type) {
    if (operation.finished) return operation.finishing;
    operation.finished = true;
    clearTimeout(operation.timer);
    operation.audio?.fill(0);
    operation.finishing = Promise.resolve().then(async () => {
      if (operation.source) operation.source.onended = null;
      try { operation.source?.stop(); } catch {}
      try { operation.source?.disconnect(); } catch {}
      if (operation.context) {
        try {
          if (operation.context.state !== 'closed') await operation.context.close();
          if (operation.context.state !== 'closed') type = 'release_failed';
        } catch { type = 'release_failed'; }
      }
      if (type !== 'release_failed') {
        if (operation.stopping) type = 'stopped';
        if (current === operation) current = undefined;
      }
      bridge.report({type, id: operation.id});
    });
    return operation.finishing;
  }

  async function readyWithin(promise, milliseconds = 5_000) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Audio device readiness timed out')), milliseconds);
    })]); } finally { clearTimeout(timer); }
  }

  async function start(command) {
    if (current || !command || typeof command.id !== 'string'
      || !(command.audio instanceof Uint8Array)) {
      if (typeof command?.id === 'string') bridge.report({type: 'error', id: command.id});
      return;
    }
    const operation = {id: command.id, audio: command.audio,
      finished: false, stopping: false};
    current = operation;
    try {
      operation.context = new AudioContext();
      const bytes = operation.audio.slice().buffer;
      bridge.report({type: 'decoding', id: operation.id});
      const decoded = await readyWithin(operation.context.decodeAudioData(bytes));
      operation.audio.fill(0);
      if (operation.finished) return;
      if (operation.stopping || current !== operation) return void await finish(operation, 'stopped');
      operation.source = operation.context.createBufferSource();
      operation.source.buffer = decoded;
      operation.source.connect(operation.context.destination);
      operation.source.onended = () => {
        void finish(operation, operation.stopping ? 'stopped' : 'completed');
      };
      bridge.report({type: 'resuming', id: operation.id});
      await readyWithin(operation.context.resume());
      if (operation.finished) return;
      if (operation.stopping || current !== operation) return void await finish(operation, 'stopped');
      operation.source.start();
      bridge.report({type: 'started', id: operation.id});
      operation.timer=setTimeout(() => { void finish(operation, 'error'); }, Math.ceil(decoded.duration * 1_000) + 5_000);
    } catch { await finish(operation, operation.stopping ? 'stopped' : 'error'); }
  }

  const unsubscribe = bridge.onCommand(command => {
    if (disposed) return;
    if (command?.type === 'start') void start(command);
    else if (command?.type === 'stop' && current?.id === command.id) {
      current.stopping = true;
      void finish(current, 'stopped');
    }
  });
  const onVisibility = () => {
    if (document.hidden && current) {
      current.stopping = true;
      void finish(current, 'stopped');
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onPageHide = () => {
    if (current) {
      current.stopping = true;
      void finish(current, 'stopped');
    }
  };
  window.addEventListener('pagehide', onPageHide);
  return () => {
    disposed = true;
    unsubscribe();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    if (current) {
      current.stopping = true;
      void finish(current, 'stopped');
    }
  };
}
