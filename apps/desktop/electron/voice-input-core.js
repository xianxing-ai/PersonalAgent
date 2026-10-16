const CAPTURE_MS = 60_000;
const SESSION_MS = 10 * 60_000;
const VOICE_ERROR_CODES = new Set(['INVALID_ARGUMENT', 'INVALID_STATE', 'UNSUPPORTED_CAPABILITY',
  'CANCELLED', 'TIMEOUT', 'STALE_SESSION', 'EXTERNAL_FAILURE']);

function safeFailure(error) {
  if (error?.code === 'UNSUPPORTED_CAPABILITY') return '语音适配器当前不可用';
  if (error?.code === 'CANCELLED' || error?.code === 'STALE_SESSION') return '语音操作已取消';
  if (error?.code === 'TIMEOUT') return '语音操作已超时';
  return '语音处理失败';
}

/** Host-only explicit capture → ASR → Runtime consumer → playback workflow. */
export function createDesktopVoiceInputCore({source, microphoneHost, client, createBuffer,
  VoiceSessionManager, createConsumer, createSpeechPorts, onUpdate = () => {},
  enabled = false, autoPlay = false, inputMode = 'conversation', onTranscript = () => {},
  onTaskSubmitted = () => {}, now = Date.now}) {
  if (!['conversation', 'dictation'].includes(inputMode)) throw Error('无效的语音输入模式');
  const ports = createSpeechPorts();
  const manager = new VoiceSessionManager({recognition: ports.recognition, output: ports.output});
  const voiceClient = {async call(operation, payload, options) {
    const result = await client.call(operation, payload, options);
    if (operation === 'task.submit') onTaskSubmitted({taskId: result.taskId, goal: payload.goal});
    return result;
  }};
  const consumer = createConsumer({client: voiceClient, conversationId: 'desktop-voice-panel'});
  let active;
  let lastError = '';
  let lastFailure = null;
  let disposed = false;
  let releaseUnknown = false;
  const sharedCleanups = new WeakMap();
  const sharedStarts = new WeakMap();
  const publish = () => { try { onUpdate(); } catch {} };

  function recordFailure(stage, error, message = safeFailure(error)) {
    lastError = message;
    lastFailure = {stage, code: VOICE_ERROR_CODES.has(error?.code) ? error.code : 'EXTERNAL_FAILURE', message};
    publish();
  }

  function snapshot() {
    const session = active?.sessionId ? manager.current() : undefined;
    return {available: false, experimental: enabled, verification: 'unverified',
      status: active?.phase ?? (lastError ? 'error' : 'unavailable'),
      reason: lastError || (enabled ? '语音试用尚待真实设备验收' : '语音供应商尚未连接'),
      failure: lastFailure,
      capture: microphoneHost.snapshot(),
      ...(session ? {session: {state: session.state, revision: session.revision,
        transcriptReady: session.transcriptReady, replyReady: session.replyReady,
        playbackActive: session.playbackActive}} : {})};
  }

  function assertOwner(senderId) {
    if (releaseUnknown) throw Error('语音资源释放未确认，请重启应用后再启用');
    if (!active || active.senderId !== senderId) throw Error('语音操作来源不受信任');
  }

  function cleanup(record, reason = 'user') {
    if (record.cleanupPromise) return record.cleanupPromise;
    record.cleanupPromise = Promise.resolve().then(async () => {
      let releaseError;
      record.parentSignal?.removeEventListener('abort', record.onParentAbort);
      record.controller.abort();
      try { record.subscription?.unsubscribe(); } catch (error) { releaseError = error; }
      try { await record.subscription?.closed; } catch (error) { releaseError = error; }
      try { record.buffer?.dispose(); } catch (error) { releaseError ??= error; }
      if (record.startingSession) {
        try {record.sessionId = (await record.startingSession).sessionId;} catch {}
      }
      if (record.sessionId && manager.current()?.sessionId === record.sessionId) {
        try {
          // Manager publishes terminal state before its asynchronous release receipt.
          const stopped = await manager.stop(record.sessionId, reason);
          if (stopped?.resourcesReleased !== true) throw Error('语音会话资源释放未确认');
        } catch (error) { releaseError ??= error; }
      }
      if (microphoneHost.snapshot().subscriberCount === 0) {
        try { await microphoneHost.revoke(); }
        catch (error) { releaseError ??= error; }
      }
      // Keep the host busy after a failed release, even once this record is cleared.
      // Desktop uses hasActive() to guard switching to Wake and Live.
      if (releaseError) releaseUnknown = true;
      if (active === record) active = undefined;
      publish();
      if (releaseError) throw releaseError;
    });
    if (record.parentSignal) sharedCleanups.set(record.parentSignal, record.cleanupPromise);
    return record.cleanupPromise;
  }

  async function startCapture(senderId, lease) {
    if (!enabled || disposed) throw Error('语音试用当前不可用');
    if (!Number.isSafeInteger(senderId) || senderId <= 0) throw Error('语音操作来源不受信任');
    if (releaseUnknown) throw Error('语音资源释放未确认，请重启应用后再启用');
    if (active) throw Error('请先结束当前语音会话');
    if (lease && sharedCleanups.has(lease.signal)) {
      const waiting = {cancelled: false};
      const starts = sharedStarts.get(lease.signal) ?? new Set();
      starts.add(waiting);
      sharedStarts.set(lease.signal, starts);
      try {
        try {await sharedCleanups.get(lease.signal);} catch {throw Error('共享麦克风资源释放未确认');}
        if (disposed) throw Error('语音试用当前不可用');
        if (releaseUnknown) throw Error('语音资源释放未确认，请重启应用后再启用');
        if (waiting.cancelled) throw Error('语音采集已取消');
        if (active) throw Error('请先结束当前语音会话');
      } finally {
        starts.delete(waiting);
        if (starts.size === 0) sharedStarts.delete(lease.signal);
      }
    }
    const sharedDeadline = lease ? Date.parse(lease.deadline) : now() + SESSION_MS;
    if (lease && (inputMode !== 'dictation' || !Number.isFinite(sharedDeadline) || sharedDeadline <= now()
      || sharedDeadline > now() + SESSION_MS || !lease.signal || lease.signal.aborted
      || typeof lease.signal.addEventListener !== 'function' || typeof lease.signal.removeEventListener !== 'function'
      || !microphoneHost.snapshot().authorized)) throw Error('共享麦克风租约无效');
    if (!lease) microphoneHost.authorize();
    const controller = new AbortController();
    const captureDeadline = new Date(Math.min(now() + CAPTURE_MS, sharedDeadline)).toISOString();
    const sessionDeadline = new Date(sharedDeadline).toISOString();
    const record = {senderId, controller, captureDeadline, sessionDeadline, phase: 'acquiring', subscription: undefined,
      buffer: createBuffer({signal: controller.signal, deadline: sessionDeadline, maxDurationMs: CAPTURE_MS}),
      sessionId: undefined, replyId: undefined, parentSignal: lease?.signal, cancelRequested: false};
    active = record;
    if (record.parentSignal) {
      record.onParentAbort = () => {
        record.cancelRequested = true;
        record.controller.abort();
        void cleanup(record).catch(error => recordFailure('cleanup', error, '麦克风释放未确认'));
      };
      record.parentSignal.addEventListener('abort', record.onParentAbort, {once: true});
      if (record.parentSignal.aborted) record.onParentAbort();
    }
    lastError = '';
    lastFailure = null;
    publish();
    let stage = 'pcm_acquire';
    try {
      if (record.controller.signal.aborted) throw Error('语音采集已取消');
      record.subscription = source.subscribe({signal: controller.signal, deadline: captureDeadline,
        onFrame: frame => {
          if (active !== record || record.phase !== 'acquiring' && record.phase !== 'listening') return;
          try { record.buffer.append(frame.data); }
          catch { queueMicrotask(() => { if (active === record) void cancelCapture(senderId).catch(() => {
            lastError = '麦克风释放未确认'; publish();
          }); }); }
        },
        onEnd: reason => {
          if (active === record && record.phase === 'listening' && reason === 'deadline') {
            queueMicrotask(() => { if (active === record) void finishCapture(senderId).catch(error => {
              if (!lastFailure && (active === record || !active)) recordFailure('auto_finish', error);
            }); });
          } else if (active === record && ['acquiring', 'listening'].includes(record.phase)
            && reason !== 'cancelled') queueMicrotask(() => { if (active === record) void cancelCapture(senderId).catch(() => {
              lastError = '麦克风释放未确认'; publish();
            }); });
        },
      });
      await record.subscription.ready;
      if (active !== record || controller.signal.aborted) throw Error('语音采集已取消');
      stage = 'session_start';
      record.startingSession = manager.start({deadline: sessionDeadline, signal: controller.signal, locale: 'zh-CN'});
      const session = await record.startingSession;
      record.sessionId = session.sessionId;
      if (active !== record || controller.signal.aborted) throw Error('语音采集已取消');
      record.phase = 'listening';
      publish();
      return snapshot();
    } catch (error) {
      recordFailure(stage, error);
      try { await cleanup(record); } catch (releaseError) {
        recordFailure('cleanup', releaseError, '麦克风释放未确认');
      }
      throw Error(lastError);
    }
  }

  const beginCapture = senderId => startCapture(senderId);
  const beginSharedCapture = (senderId, lease) => {
    if (!lease) return Promise.reject(Error('共享麦克风租约无效'));
    return startCapture(senderId, lease);
  };

  async function cancelSharedCapture(signal) {
    if (releaseUnknown) throw Error('语音资源释放未确认，请重启应用后再启用');
    const starts = sharedStarts.get(signal);
    const cancelledStart = Boolean(starts?.size);
    for (const waiting of starts ?? []) waiting.cancelled = true;
    if (!active || active.parentSignal !== signal) {
      await sharedCleanups.get(signal);
      return {cancelled: cancelledStart};
    }
    active.cancelRequested = true;
    await cleanup(active);
    return {cancelled: true};
  }

  async function finishCapture(senderId) {
    assertOwner(senderId);
    const record = active;
    if (record.phase !== 'listening') throw Error('当前没有可提交的语音采集');
    record.phase = 'recognizing';
    publish();
    let clip;
    let stage = 'pcm_release';
    try {
      record.subscription.unsubscribe();
      await record.subscription.closed;
      stage = 'audio_buffer';
      clip = record.buffer.finish();
      record.buffer = undefined;
      stage = 'recognition';
      const transcript = await manager.recognizeAudio(record.sessionId, clip);
      clip.data.fill(0);
      if (inputMode === 'dictation') {
        let text;
        stage = 'dictation';
        await manager.consumeTranscript(record.sessionId, transcript.transcriptId, {
          consume(request) {
            text = request.text;
            return {result: Promise.resolve({replyText: text, locale: request.locale}), stop: async () => {}};
          },
        });
        if (record.controller.signal.aborted || active !== record) throw Error('语音输入已取消');
        await cleanup(record);
        // Normal cleanup also aborts the controller; explicit cancellation is separate.
        if (disposed || record.cancelRequested || record.parentSignal?.aborted
          || now() >= Date.parse(record.sessionDeadline)) {
          throw Object.assign(Error('语音输入已取消'), {code: 'CANCELLED'});
        }
        onTranscript({senderId, text});
        return {text, voice: snapshot()};
      }
      record.phase = 'consuming';
      publish();
      stage = 'consumption';
      const reply = await manager.consumeTranscript(record.sessionId, transcript.transcriptId, consumer);
      record.replyId = reply.replyId;
      record.phase = 'awaiting_speech';
      lastError = '';
      lastFailure = null;
      publish();
    } catch (error) {
      clip?.data.fill(0);
      let failureMessage = stage === 'pcm_release' ? '麦克风释放未确认' : safeFailure(error);
      recordFailure(stage, error, failureMessage);
      try { await cleanup(record); } catch (releaseError) {
        failureMessage = '麦克风释放未确认';
        recordFailure(stage === 'pcm_release' ? 'pcm_release' : 'cleanup',
          releaseError, failureMessage);
      }
      // A concurrent successful cancel can clear the shared UI error while cleanup settles.
      throw Error(failureMessage);
    }
    return autoPlay ? playReply(senderId) : snapshot();
  }

  async function playReply(senderId) {
    assertOwner(senderId);
    const record = active;
    if (record.phase !== 'awaiting_speech' || !record.replyId) throw Error('当前没有待播报回答');
    const replyId = record.replyId;
    record.replyId = undefined;
    record.phase = 'speaking';
    publish();
    try {
      const result = await manager.speakReply(record.sessionId, replyId);
      await cleanup(record);
      lastError = '';
      lastFailure = null;
      return {completed: result.completed, interrupted: result.interrupted, voice: snapshot()};
    } catch (error) {
      recordFailure('playback', error);
      try { await cleanup(record); }
      catch (releaseError) { recordFailure('cleanup', releaseError, '语音资源释放未确认'); }
      throw Error(lastError);
    }
  }

  async function stopSpeaking(senderId) {
    assertOwner(senderId);
    const record = active;
    if (record.phase !== 'speaking') return {stopped: false, reason: '当前没有正在播报的回答'};
    try {
      const result = await manager.stopSpeaking(record.sessionId);
      publish();
      return {stopped: result.playbackStopped, resourcesReleased: result.resourcesReleased};
    } catch {
      throw Error('播报停止未确认');
    }
  }

  async function cancelCapture(senderId) {
    assertOwner(senderId);
    const record = active;
    record.cancelRequested = true;
    record.phase = 'cancelling';
    publish();
    try { await cleanup(record); }
    catch { lastError = '语音资源释放未确认'; publish(); throw Error(lastError); }
    lastError = '';
    lastFailure = null;
    return {cancelled: true, voice: snapshot()};
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    let failure;
    if (active) { try { await cleanup(active, 'disposed'); } catch (error) { failure = error; } }
    try { await source.dispose?.(); } catch (error) { failure ??= error; }
    try { await ports.dispose(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  }

  return {snapshot, beginCapture, finishCapture, playReply, stopSpeaking, cancelCapture, dispose,
    beginSharedCapture, cancelSharedCapture, subscribePlayback: listener => manager.subscribe(listener),
    hasActive: () => Boolean(active || releaseUnknown)};
}
