import {createVoiceStartupController, createVoiceHostListeningPort} from '@personal-agent/voice';

/** Application lifecycle only; audio/renewal and Runtime work remain in the original Live host. */
export function createDesktopVoiceStartupHost({config, liveVoice, output, prepare,
  disposeOutput = async () => {}, onUpdate = () => {}, now = Date.now}) {
  const controller = createVoiceStartupController({output, listening:createVoiceHostListeningPort(liveVoice)});
  let resumeAllowed = false, revision = 0, failure = '', disposed = false;
  const publish = () => {try {onUpdate();} catch {}};
  const snapshot = () => {
    const value=controller.snapshot(), live=liveVoice.snapshot?.();
    if(value.state==='listening'&&live&&['idle','error'].includes(live.status)){
      resumeAllowed=false;
      return {...value,state:'unavailable',resumeAllowed,reason:failure||'原 Live 会话已停止，请检查设备后手动重开'};
    }
    return {...value,resumeAllowed,reason:failure};
  };
  async function stop({suspend = false} = {}) {
    revision++;
    if (!suspend) resumeAllowed = false;
    const result = await controller.stop(); publish();
    if (!result.resourcesReleased) throw Error('启动语音资源释放未确认，请重启应用');
    return snapshot();
  }
  async function start({resume = false} = {}) {
    if (disposed) throw Error('启动语音宿主已关闭');
    if (resume && !resumeAllowed) return snapshot();
    const current = ++revision, settings = config.snapshot();
    const greet = !resume && settings.startupGreeting === true;
    const listen = settings.continuousListening === true;
    if (!greet && !listen) return stop();
    try {
      if (!settings.configured || !settings.audioConsent) throw Error('请先完成 Live 配置并同意音频用途');
      const previous = await controller.stop();
      if (!previous.resourcesReleased) throw Error('启动语音资源释放未确认');
      // A hide, suspend or quit can supersede startup while release is pending.
      // Preparation itself opens the panel, so guard it before that side effect.
      if (current !== revision || disposed) return snapshot();
      await prepare();
      if (current !== revision || disposed) return snapshot();
      // Recheck settings after asynchronous panel/Wake preparation; never use an old enabled bit.
      const latest = config.snapshot();
      if (!latest.configured || !latest.audioConsent || latest.startupGreeting !== settings.startupGreeting
        || latest.continuousListening !== settings.continuousListening) return snapshot();
      resumeAllowed = listen; failure = '';
      // Same startup bound as live-voice-host SESSION_MS. Once ready, the adapter delegates
      // all ongoing lease expiry/renewal to that host; this is not a two-hour listening cap.
      const request = {enabled:true,greet,listen,signal:new AbortController().signal,
        deadline:new Date(now()+120*60_000).toISOString()};
      const result = await (resume ? controller.resume(request) : controller.start(request));
      if (current === revision) {publish(); return {...result,resumeAllowed,reason:failure};}
      return snapshot();
    } catch {
      if (current === revision) {failure='启动语音未就绪，请检查配置和设备；未自动重试';resumeAllowed=false;publish();}
      throw Error('启动语音未就绪，请检查配置和设备');
    }
  }
  return {snapshot, start, stop, suspend:()=>stop({suspend:true}), resume:()=>start({resume:true}),
    async dispose() {
      disposed=true;revision++;resumeAllowed=false;
      const result=await controller.dispose();await disposeOutput();publish();
      if(!result.resourcesReleased)throw Error('启动语音资源释放未确认');return snapshot();
    }};
}
