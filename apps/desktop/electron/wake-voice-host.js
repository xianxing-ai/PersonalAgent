import {WakeLifecycleController, createPcmKeywordWakeSignalSource,
  createVoicePcmFrameSourcePort, createWindowsSystemSpeechKeywordDetector} from '@personal-agent/voice';

const LEASE_MS = 10 * 60_000;
const RELEASE_MS = 5000;
const KEYWORD = '你好小派';

/** Visible-panel wake ownership. Logical sources share the existing physical microphone host. */
export function createDesktopWakeVoiceHost({getPanel, microphoneHost, voiceInput,
  onUpdate = () => {}, isBusy = () => false, now = Date.now,
  createSource = createVoicePcmFrameSourcePort,
  createDetector = () => createWindowsSystemSpeechKeywordDetector({keyword: KEYWORD})}) {
  let active, phase = 'disabled', reason = '唤醒默认关闭', disposed = false, releaseUnknown = false;
  const publish = () => {try {onUpdate();} catch {}};
  const snapshot = () => ({...(active?.wake?.snapshot() ?? {state: disposed ? 'disposed' : 'disabled',
    sessionId: null, expiresAtMs: null, playbackActive: false, cooldownUntilMs: null}),
    phase, reason, verification: 'unverified'});

  function panelFor(senderId) {
    const panel = getPanel();
    if (!Number.isSafeInteger(senderId) || senderId <= 0 || !panel || panel.isDestroyed()
      || !panel.isVisible() || panel.webContents.isDestroyed() || panel.webContents.id !== senderId) {
      throw Error('唤醒只允许从可见可信面板启用');
    }
    return panel;
  }

  function stop(record) {
    if (record.stopPromise) return record.stopPromise;
    record.stopPromise = Promise.resolve().then(async () => {
      const errors = [];
      try {record.controller.abort();} catch (error) {errors.push(error);}
      try {record.wake?.disable();} catch (error) {errors.push(error);}
      try {record.unsubscribePlayback?.();} catch (error) {errors.push(error);}
      try {record.unsubscribeLifecycle?.();} catch (error) {errors.push(error);}
      const releasing = Promise.allSettled([
        Promise.resolve().then(() => record.source?.dispose()),
        Promise.resolve().then(() => record.detector?.dispose()),
        record.adapterStart?.then(subscription => subscription.closed, () => {}),
        Promise.resolve().then(() => voiceInput.cancelSharedCapture(record.controller.signal)),
        Promise.resolve().then(() => {if (record.ownsLease) return microphoneHost.revoke();}),
      ]);
      let timer;
      try {
        const results = await Promise.race([releasing, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('唤醒释放确认已超时')), RELEASE_MS);
        })]);
        for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
      } catch (error) {errors.push(error);}
      finally {clearTimeout(timer);}
      try {record.wake?.dispose();} catch (error) {errors.push(error);}
      if (active === record) active = undefined;
      if (errors.length) {
        releaseUnknown = true; phase = 'release_unconfirmed'; reason = '唤醒音频释放未确认，请重启应用后再启用';
        publish(); throw Error(reason);
      }
      phase = disposed ? 'disposed' : 'disabled'; reason = '唤醒已关闭'; publish();
      return snapshot();
    });
    phase = 'disabling'; reason = '正在关闭唤醒并确认音频释放'; publish();
    return record.stopPromise;
  }

  async function beginCapture(senderId) {
    panelFor(senderId);
    const record = active;
    if (!record || phase !== 'listening' || record.senderId !== senderId || record.controller.signal.aborted
      || now() >= record.expiresAtMs || isBusy()) throw Error('唤醒麦克风租约当前不可用');
    return voiceInput.beginSharedCapture(senderId, {signal: record.controller.signal,
      deadline: new Date(record.expiresAtMs).toISOString()});
  }

  async function enable(senderId) {
    panelFor(senderId);
    if (disposed) throw Error('唤醒宿主已关闭');
    if (releaseUnknown) throw Error(reason);
    if (active || isBusy() || voiceInput.hasActive()) throw Error('请先结束当前语音或唤醒操作');
    const record = {senderId, controller: new AbortController(), expiresAtMs: now() + LEASE_MS};
    active = record; phase = 'enabling'; reason = '正在检查唤醒检测器和麦克风'; publish();
    try {
      const grant = microphoneHost.authorize({deadline: new Date(record.expiresAtMs).toISOString()});
      record.ownsLease = true;
      const expiry = Date.parse(grant?.expiresAt);
      if (!grant?.authorized || !Number.isFinite(expiry) || expiry <= now() || expiry > record.expiresAtMs) {
        throw Error('唤醒麦克风租约不可用');
      }
      record.expiresAtMs = expiry;
      record.source = createSource(microphoneHost.binding);
      record.detector = createDetector();
      const source = createPcmKeywordWakeSignalSource(record.source, record.detector);
      record.wake = new WakeLifecycleController({
        authorization: {async check({signal, deadlineAtMs}) {
          if (signal.aborted || record.controller.signal.aborted || active !== record
            || now() >= record.expiresAtMs || deadlineAtMs > record.expiresAtMs) return {kind: 'denied', reason: 'expired'};
          panelFor(senderId);
          return {kind: 'allowed', expiresAtMs: record.expiresAtMs, revocationSignal: record.controller.signal};
        }},
        source: {subscribe(listener, context) {
          record.adapterStart = source.subscribe(listener, context);
          return record.adapterStart;
        }},
        cooldownMs: 1000,
        onWake() {
          if (active !== record || phase !== 'listening' || voiceInput.hasActive()) return;
          void beginCapture(senderId).catch(() => {
            if (active === record && phase === 'listening') {reason = '唤醒后的听写未启动，请检查语音状态';publish();}
          });
        },
        onError() {
          if (active === record && !record.stopPromise) {
            void stop(record).then(() => {if (!disposed && !record.requestedStop && !active && !releaseUnknown) {phase = 'unavailable';reason = '唤醒来源不可用，请检查中文识别器和设备';publish();}}).catch(() => {});
          }
        },
      });
      record.unsubscribePlayback = voiceInput.subscribePlayback(value => record.wake.setPlaybackActive(Boolean(value.playbackActive)));
      record.unsubscribeLifecycle = record.wake.subscribeLifecycle(value => {
        if (active === record && phase === 'listening' && value.state !== 'listening') void stop(record).catch(() => {});
      });
      const result = await record.wake.enable({deadlineAtMs: record.expiresAtMs, signal: record.controller.signal});
      if (result.kind !== 'listening' || active !== record || record.controller.signal.aborted || record.stopPromise) {
        throw Error('唤醒来源不可用');
      }
      panelFor(senderId);
      phase = 'listening'; reason = '已开启唤醒，说“你好小派”开始听写'; publish();
      return snapshot();
    } catch {
      await stop(record);
      if (disposed || record.requestedStop) throw Error('唤醒启用已取消');
      if (!active && !releaseUnknown) {phase = 'unavailable';reason = '唤醒来源不可用，请检查中文识别器和设备';publish();}
      throw Error(reason);
    }
  }

  async function disable() {
    if (active) {active.requestedStop = true;return stop(active);}
    if (releaseUnknown) throw Error(reason);
    phase = disposed ? 'disposed' : 'disabled'; reason = '唤醒已关闭';publish();
    return snapshot();
  }

  async function dispose() {
    disposed = true;
    return disable();
  }

  return {enable, disable, dispose, beginCapture, snapshot,
    hasActive: () => Boolean(active || releaseUnknown)};
}
