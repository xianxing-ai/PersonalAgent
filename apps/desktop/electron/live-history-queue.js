const MAX_MESSAGES = 1024;
const MAX_BYTES = 8 * 1024 * 1024;

function validate(message) {
  if (!message || !['user', 'assistant'].includes(message.role)
    || !['id', 'sessionId'].every(key => typeof message[key] === 'string' && message[key].length > 0 && message[key].length <= 256)
    || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 100000
    || !Number.isFinite(Date.parse(message.createdAt))) throw Error('Live 历史消息格式无效');
  if(message.conversationId!==undefined && (typeof message.conversationId!=='string' || !message.conversationId.trim() || message.conversationId.length>256))throw Error('Live 历史对话归属无效');
  return {id: message.id, sessionId: message.sessionId, role: message.role, text: message.text,
    ...(message.conversationId===undefined?{}:{conversationId:message.conversationId}),
    createdAt: new Date(message.createdAt).toISOString()};
}

/** A transcript recovery cache, never a task store or an execution/retry queue.
 * store is a trusted synchronous {read(), write(messages)} port. write must atomically
 * replace its snapshot or throw; the sink must upsert by message.id.
 */
export function createLiveHistoryQueue({store, maxMessages = MAX_MESSAGES, maxBytes = MAX_BYTES} = {}) {
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw Error('Live 历史容量无效');
  let pending = new Map(), journalFailed = false, loaded = !store, draining = false;
  let rejected = 0;
  const bytes = values => new TextEncoder().encode(JSON.stringify(values)).byteLength;
  const persist = () => {
    if (!store) return;
    try {store.write([...pending.values()]); journalFailed = false;}
    catch {journalFailed = true;}
  };
  const recover = () => {
    if (loaded) return true;
    try {
      const values = store.read();
      if (!Array.isArray(values) || values.length > maxMessages || bytes(values) > maxBytes) throw Error();
      const recovered = new Map();
      for (const value of values) {
        const message = validate(value);
        if (recovered.has(message.id)) throw Error();
        recovered.set(message.id, message);
      }
      // Memory revisions received while recovery was unavailable win by stable identity.
      for (const [id, message] of pending) {
        const prior = recovered.get(id);
        if (prior && (prior.sessionId !== message.sessionId || prior.role !== message.role || (prior.conversationId??'desktop-panel')!==(message.conversationId??'desktop-panel'))) throw Error();
        recovered.set(id, message);
      }
      if (recovered.size > maxMessages || bytes([...recovered.values()]) > maxBytes) throw Error();
      pending = recovered; loaded = true; journalFailed = false;
      return true;
    } catch {journalFailed = true; return false;}
  };
  recover();
  return {
    enqueue(value) {
      const message = validate(value);
      const prior = pending.get(message.id);
      if (prior && (prior.sessionId !== message.sessionId || prior.role !== message.role || (prior.conversationId??'desktop-panel')!==(message.conversationId??'desktop-panel'))) throw Error('Live 历史消息标识冲突');
      const next = new Map(pending); next.set(message.id, message);
      if (next.size > maxMessages || bytes([...next.values()]) > maxBytes) {
        rejected++; throw Error('Live 历史待保存容量已满，请恢复存储后继续');
      }
      pending = next;
      // Never overwrite an unread/corrupt cache with the current memory snapshot.
      if (recover()) persist();
    },
    flush(sink) {
      if (draining) return;
      if (!recover()) return;
      draining = true;
      try {
        persist();
        for (const [id, message] of [...pending]) {
          try {
            const result = sink({...message});
            if (result && typeof result.then === 'function') {
              // This port is synchronous, matching Conversations.addLiveMessage.
              result.catch?.(() => {});
              throw Error('Live 历史保存端口必须同步确认');
            }
          } catch {break;}
          if (pending.get(id) === message) pending.delete(id);
        }
        persist();
      } finally {draining = false;}
    },
    snapshot() {return {pending: pending.size, durable: Boolean(store) && loaded && !journalFailed,
      degraded: pending.size > 0 || journalFailed, rejected};},
    messages() {return [...pending.values()].map(message => ({...message}));},
  };
}
