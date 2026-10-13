/** Trusted main-process options. Neither credentials nor this provider enter Renderer snapshots. */
export function createAgentArtsTransportConfig({binding,environment=process.env}) {
  const transport=environment.PA_AGENTARTS_TRANSPORT??'https';
  const fallback=environment.PA_AGENTARTS_HTTPS_FALLBACK??'0';
  if (!['https','wss'].includes(transport) || !['0','1'].includes(fallback)) {
    throw Error('AgentArts 传输配置无效：主通道只允许 wss/https，备用开关只允许 0/1');
  }
  if (transport==='https') {
    if (fallback==='1' || environment.PA_AGENTARTS_WSS_URL!==undefined) {
      throw Error('AgentArts WSS 地址与 HTTPS 备用开关需要启用 wss 主通道');
    }
    return {transport};
  }
  const supplied=environment.PA_AGENTARTS_WSS_URL;
  if (typeof supplied!=='string' || !supplied) {
    throw Error('wss 主通道要求显式配置 PA_AGENTARTS_WSS_URL，不能自动猜测公网地址');
  }
  if (supplied!==supplied.trim() || /\s|\\|[?#]|[\u0000-\u001f\u007f-\u009f]/.test(supplied)) {
    throw Error('AgentArts WSS 地址无效，必须是精确且无认证信息或查询参数的地址');
  }
  let gateway,address;
  try { gateway=new URL(binding.gatewayUrl);address=new URL(supplied); }
  catch { throw Error('AgentArts WSS 地址无效'); }
  const runtimeName=binding.runtimeName;
  if (gateway.protocol!=='https:' || gateway.username || gateway.password || gateway.search || gateway.hash
    || gateway.pathname!=='/' || typeof runtimeName!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(runtimeName)) {
    throw Error('AgentArts WSS 必须绑定有效 HTTPS 网关与运行时');
  }
  const paths=[`/runtimes/${encodeURIComponent(runtimeName)}/ws`,
    `/runtimes/${encodeURIComponent(runtimeName)}/invocations/ws`];
  const authorityStart=supplied.indexOf('://')+3;
  const pathStart=supplied.indexOf('/',authorityStart);
  const rawPath=pathStart<0?'':supplied.slice(pathStart);
  if (address.protocol!=='wss:' || address.origin.replace(/^wss:/,'https:')!==gateway.origin
    || !paths.includes(rawPath) || address.pathname!==rawPath
    || address.username || address.password || address.search || address.hash) {
    throw Error('AgentArts WSS 必须使用同一网关与运行时地址');
  }
  const readToken=()=>{
    const token=environment.PA_AGENTARTS_APP_TOKEN;
    if (typeof token!=='string' || !/^[\x21-\x7e]{32,4096}$/.test(token)) {
      throw Error('请在受信主机环境中配置 AgentArts 自有镜像入站凭据');
    }
    return `Bearer ${token}`;
  };
  readToken();
  return {transport,websocketUrl:address.href,allowHttpsFallback:fallback==='1',
    websocketAuthorizationProvider:{read:async()=>readToken()}};
}

export function agentArtsTransportNotice(state) {
  switch (state?.state) {
    case 'https_fallback': return '云端实时连接暂不可用，本次调用已切换 HTTPS 备用连接';
    case 'result_unknown': return '云端调用结果待核实，已停止自动重发';
    case 'auth_required': return '云端实时连接认证失败，请核对受信主机凭据';
    case 'unsupported': return '当前云端部署尚未提供兼容的实时连接';
    default: return '';
  }
}
