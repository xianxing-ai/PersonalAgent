import {randomUUID} from 'node:crypto';
import {pcmLevel} from './audio-level.js';

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 5_000;
const MAX_FRAME_BYTES = 3_200;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return {promise, resolve, reject};
}

/** One renderer-owned physical microphone, shared by all trusted Voice sinks. */
export function createMicrophoneCaptureHost({permissionGate, getPanel, now = Date.now, onLevel} = {}) {
  let authorization;
  let capture;
  let releaseUnknown = false;
  let lastRelease = {stopped: true, verified: false, reason: 'never_started'};

  function validPanel() {
    const panel = getPanel();
    return panel && !panel.isDestroyed() && panel.isVisible() && !panel.webContents.isDestroyed()
      ? panel : null;
  }

  function authorize({deadline} = {}) {
    if (releaseUnknown) throw Error('上次麦克风释放未确认，不能重新开启');
    if (capture || authorization) throw Error('麦克风会话已存在');
    const panel = validPanel();
    if (!panel) throw Error('请先显示可信面板');
    // Only the trusted host supplies a longer Live lease; Renderer cannot extend it.
    const expiresAt = deadline === undefined ? now() + 10 * 60_000 : Date.parse(deadline);
    if (!Number.isFinite(expiresAt) || expiresAt <= now() || expiresAt - now() > 120 * 60_000) throw Error('麦克风授权期限无效');
    authorization = {contents: panel.webContents, expiresAt};
    return {authorized: true, expiresAt: new Date(authorization.expiresAt).toISOString()};
  }

  function revoke() {
    authorization = undefined;
    return capture ? stop(capture, 'revoked') : Promise.resolve();
  }

  function snapshot() {
    return {authorized: Boolean(authorization && now() < authorization.expiresAt),
      active: Boolean(capture?.readyState === 'ready' && !capture.stopPromise),
      busy: Boolean(capture),
      subscriberCount: capture?.sinks.size ?? 0, lastRelease};
  }

  async function start(sink) {
    if (!sink || typeof sink.onFrame !== 'function') throw Error('无效的语音采集消费者');
    if (!authorization || now() >= authorization.expiresAt || validPanel()?.webContents !== authorization.contents) {
      authorization = undefined;
      throw Error('请在可信面板明确启用麦克风');
    }
    let session = capture;
    if (session?.stopPromise) throw Error('麦克风正在关闭');
    if (!session) {
      const token = randomUUID();
      const ready = deferred();
      const stopped = deferred();
      session = {token, contents: authorization.contents, sinks: new Set(), ready,
        stopped, readyState: 'starting', stopPromise: undefined, revokePermission: undefined};
      capture = session;
      lastRelease = {stopped: false, verified: false, reason: 'capturing'};
      try {
        session.revokePermission = permissionGate.grant({webContents: session.contents,
          deadlineAtMs: authorization.expiresAt,
          onRevoke: () => { if (capture === session) void stop(session, 'revoked'); }});
        session.contents.send('desktop:microphone-command', {type: 'start', token});
        const timer = setTimeout(() => { if (capture === session && session.readyState === 'starting') {
          session.ready.reject(Error('麦克风启动超时'));
          void stop(session, 'device_unavailable');
        } }, START_TIMEOUT_MS);
        timer.unref?.();
        session.ready.promise.finally(() => clearTimeout(timer)).catch(() => {});
      } catch (error) {
        session.ready.reject(error);
        void stop(session, 'device_unavailable');
      }
    }
    const subscription = {sink};
    session.sinks.add(subscription);
    try { await session.ready.promise; }
    catch (error) { session.sinks.delete(subscription); await session.stopPromise?.catch(() => {}); throw error; }
    if (session.stopPromise) {
      session.sinks.delete(subscription);
      await session.stopPromise.catch(() => {});
      throw Error('麦克风采集已经停止');
    }
    let released = false;
    return {release: async () => {
      if (released) return session.stopPromise;
      released = true;
      session.sinks.delete(subscription);
      if (session.sinks.size === 0) await stop(session, 'released');
      else if (session.stopPromise) await session.stopPromise;
    }};
  }

  function stop(session, reason) {
    if (session.stopPromise) return session.stopPromise;
    authorization = undefined;
    if (session.readyState === 'starting') session.ready.reject(Error('麦克风在启动时被停止'));
    session.readyState = 'stopping';
    if (reason === 'revoked' || reason === 'device_unavailable') {
      for (const {sink} of session.sinks) {
        try { (reason === 'revoked' ? sink.onRevoked : sink.onDeviceUnavailable)?.(); } catch {}
      }
    }
    session.sinks.clear();
    const closing = Promise.resolve().then(async () => {
      session.revokePermission?.();
      try { session.contents.send('desktop:microphone-command', {type: 'stop', token: session.token}); }
      catch { session.stopped.reject(Error('无法向采集页面发送停止请求')); }
      const timer = setTimeout(() => session.stopped.reject(Error('麦克风释放未获物理 track 读回')), STOP_TIMEOUT_MS);
      timer.unref?.();
      try {
        await session.stopped.promise;
        lastRelease = {stopped: true, verified: true, reason};
      } catch (error) {
        lastRelease = {stopped: false, verified: false, reason};
        releaseUnknown = true;
        throw error;
      } finally {
        clearTimeout(timer);
        if (capture === session) capture = undefined;
      }
    });
    closing.catch(() => {});
    session.stopPromise = closing;
    return closing;
  }

  function receive(event, message) {
    const session = capture;
    if (!session || event.sender !== session.contents || event.senderFrame !== session.contents.mainFrame
      || !message || message.token !== session.token) return false;
    if (message.type === 'ready' && session.readyState === 'starting'
      && message.trackLive === true && message.sampleRate === 16_000) {
      session.readyState = 'ready';
      session.ready.resolve();
      return true;
    }
    if (message.type === 'ready' && session.readyState === 'starting') {
      session.ready.reject(Error('麦克风格式或 track 状态无效'));
      void stop(session, 'device_unavailable');
      return false;
    }
    if (message.type === 'frame' && session.readyState === 'ready' && !session.stopPromise) {
      const data = message.data;
      if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength % 2
        || data.byteLength > MAX_FRAME_BYTES) { void stop(session, 'device_unavailable'); return false; }
      try { onLevel?.(pcmLevel(data)); } catch { /* Loudness is visual and must not affect capture. */ }
      for (const {sink} of session.sinks) {
        try { sink.onFrame(data); } catch { void stop(session, 'device_unavailable'); }
      }
      data.fill(0);
      return true;
    }
    if (message.type === 'stopped') {
      if (message.tracksStopped === true) session.stopped.resolve();
      else session.stopped.reject(Error('麦克风 track 未全部停止'));
      if (!session.stopPromise) void stop(session, 'device_unavailable');
      return true;
    }
    if (message.type === 'error') {
      session.ready.reject(Error('麦克风采集不可用'));
      void stop(session, 'device_unavailable');
      return true;
    }
    return false;
  }

  return {authorize, revoke, snapshot, binding: {start}, receive};
}
