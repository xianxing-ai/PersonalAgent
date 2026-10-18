/** Panel one-line SIS status. Credential state comes from the host snapshot only;
 * token values never reach the renderer (configured=false ⇒ ask for re-login). */
export function sisStatusLine(voice, configuration){
  if(configuration?.configured===true) return 'SIS 听写：已配置 · 在语音设置中管理；经 AgentArts 暂不可用。';
  if(voice?.hostReady) return `SIS 听写：配置未就绪${configuration?.reason?`（${configuration.reason}）`:''} · 请在语音设置中重新登录；经 AgentArts 暂不可用。`;
  return 'SIS 听写：未配置 · 在语音设置中管理；经 AgentArts 暂不可用。';
}
