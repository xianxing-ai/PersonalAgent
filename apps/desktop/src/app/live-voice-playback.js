/** Streaming PCM output; no model credentials or network access in the renderer. */
export function mountLiveVoicePlayback(bridge, AudioContextClass = globalThis.AudioContext) {
  let current, disposed = false;
  const clear = record => {
    let released = true;
    for (const source of record.sources) {
      source.onended = null;
      try {source.stop();} catch {released = false;}
      try {source.disconnect();} catch {released = false;}
    }
    record.sources.clear(); record.nextAt = record.context.currentTime; record.drain = false;
    return released;
  };
  async function stop(record) {
    if (record.stopping) return record.stopping;
    record.stopping = Promise.resolve().then(async () => {
      clear(record);
      try {
        if (record.context.state !== 'closed') await record.context.close();
        if (record.context.state !== 'closed') throw Error();
        if (current === record) current = undefined;
        bridge.report({token: record.token, type: 'stopped'});
      } catch {bridge.report({token: record.token, type: 'error'});}
    });
    return record.stopping;
  }
  const unsubscribe = bridge.onCommand(async message => {
    const {token, type} = message ?? {};
    if (disposed || typeof token !== 'string') return;
    if (type === 'start') {
      if (current) {bridge.report({token, type: 'error'}); return;}
      let record;
      try {
        const context = new AudioContextClass({sampleRate: 24000, latencyHint: 'interactive'});
        record = {token, context, sources: new Set(), nextAt: 0, drain: false};
        current = record;
        await context.resume();
        if (current !== record || record.stopping || disposed) return;
        if (context.state !== 'running') throw Error();
        bridge.report({token, type: 'ready'});
      } catch {
        if (record?.stopping || (record && current !== record)) return;
        bridge.report({token, type: 'error'});
        if (record) await stop(record);
      }
      return;
    }
    const record = current;
    if (!record || record.token !== token) {
      if (type === 'stop') bridge.report({token, type: 'stopped'});
      return;
    }
    if (type === 'stop') {await stop(record); return;}
    if (record.stopping) return;
    if (type === 'clear') {
      if (!clear(record)) {bridge.report({token, type: 'error'}); await stop(record);}
      return;
    }
    if (type === 'drain') {
      record.drain = true;
      if (!record.sources.size) bridge.report({token, type: 'drained'});
      return;
    }
    if (type !== 'audio') return;
    try {
      const bytes = message.data;
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length % 2 || bytes.length > 384000) throw Error();
      if (record.nextAt - record.context.currentTime > 15) throw Error();
      const audio = record.context.createBuffer(1, bytes.length / 2, 24000);
      const samples = audio.getChannelData(0), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      const source = record.context.createBufferSource();
      source.buffer = audio; source.connect(record.context.destination); record.sources.add(source); record.drain = false;
      source.onended = () => {try {source.disconnect();} catch {} record.sources.delete(source);
        if (current === record && !record.stopping && !disposed && record.drain && !record.sources.size) bridge.report({token, type: 'drained'});};
      const at = Math.max(record.nextAt, record.context.currentTime + 0.015);
      source.start(at); record.nextAt = at + audio.duration;
    } catch {bridge.report({token, type: 'error'}); await stop(record);}
  });
  return () => {disposed = true; unsubscribe(); if (current) void stop(current);};
}
