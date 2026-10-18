/** Trusted main-process options. Neither credentials nor this provider enter Renderer snapshots. */
export function createAgentArtsTransportConfig({binding,environment=process.env,configurationProvider,fetchImpl=globalThis.fetch,transportPreferences={},readAppToken}) {
  const transport=environment.PA_AGENTARTS_TRANSPORT??transportPreferences.transport??'https';
  const fallback=environment.PA_AGENTARTS_HTTPS_FALLBACK??(transportPreferences.allowHttpsFallback===true?'1':'0');
  if (!['https','wss'].includes(transport) || !['0','1'].includes(fallback)) {
    throw Error('AgentArts 传输配置无效：主通道只允许 wss/https，备用开关只允许 0/1');
  }
  if (configurationProvider!==undefined && typeof configurationProvider?.read!=='function') throw Error('AgentArts 受信配置读取器无效');
  let deploymentBound=false,boundDeploymentVersion;
  const currentOptions=()=>{
    const value=configurationProvider?configurationProvider.read():{};
    if (!value || typeof value!=='object' || Array.isArray(value) || typeof value.then==='function'
      || Object.keys(value).some(key=>!['appToken','deploymentVersion'].includes(key))
      || value.appToken!==undefined && (typeof value.appToken!=='string' || !/^[\x21-\x7e]{32,4096}$/.test(value.appToken))
      || value.deploymentVersion!==undefined && (typeof value.deploymentVersion!=='string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.deploymentVersion))) {
      throw Error('AgentArts 当前受信传输配置无效');
    }
    if (deploymentBound && value.deploymentVersion!==boundDeploymentVersion) {
      throw Error('AgentArts 固定部署版本已改变，请重新绑定连接');
    }
    return value;
  };
  boundDeploymentVersion=currentOptions().deploymentVersion;
  deploymentBound=true;
  const deploymentBinding=configurationProvider?{
    ...(boundDeploymentVersion===undefined?{}:{deploymentVersion:boundDeploymentVersion}),
    assertDeploymentBinding:()=>{currentOptions();},
  }:{};
  // Only the existing Runtime HTTP port consumes this closure. No credentials are serializable options.
  const httpsOptions=()=>{
    if (!configurationProvider) return {};
    let gateway;
    try {gateway=new URL(binding.gatewayUrl);} catch {throw Error('AgentArts HTTPS 目的地无效');}
    if (gateway.protocol!=='https:' || gateway.username || gateway.password || gateway.search || gateway.hash || gateway.pathname!=='/'
      || typeof binding.runtimeName!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(binding.runtimeName)
      || typeof fetchImpl!=='function') throw Error('AgentArts HTTPS 目的地无效');
    const destination=gateway.origin+`/runtimes/${encodeURIComponent(binding.runtimeName)}/invocations`;
    return {fetchImpl:(url,init)=>{
      // Compare the original URL too: URL normalization must not accept a different path or query.
      const input=url instanceof URL?url.href:url;
      const fallbackTarget=transport==='wss' && fallback==='1' && boundDeploymentVersion!==undefined
        ?destination+'?endpoint='+boundDeploymentVersion:undefined;
      if (typeof input!=='string' || (input!==destination && input!==fallbackTarget) || init?.method!=='POST' || init.redirect!=='error') throw Error('AgentArts 请求必须使用已绑定目的地，且禁止重定向');
      if (init.signal?.aborted) throw Error('AgentArts 请求已取消');
      const headers=new Headers(init.headers);
      const options=currentOptions(),target=new URL(destination);
      const appToken=options.appToken??(transport==='wss'?environment.PA_AGENTARTS_APP_TOKEN:undefined);
      if (headers.has('X-PA-Agent-Token') && (transport!=='wss' || fallback!=='1'
        || typeof appToken!=='string' || !/^[\x21-\x7e]{32,4096}$/.test(appToken)
        || headers.get('X-PA-Agent-Token')!==`Bearer ${appToken}`)) throw Error('AgentArts 应用凭据只能来自当前受信配置');
      if (appToken!==undefined) {
        if (typeof appToken!=='string' || !/^[\x21-\x7e]{32,4096}$/.test(appToken)) throw Error('AgentArts 应用入站凭据格式无效');
        headers.set('X-PA-Agent-Token',`Bearer ${appToken}`);
      }
      if (options.deploymentVersion!==undefined) target.searchParams.set('endpoint',options.deploymentVersion);
      return fetchImpl(target.href,{...init,headers:Object.fromEntries(headers),redirect:'error'});
    }};
  };
  if (transport==='https') {
    if (fallback==='1' || environment.PA_AGENTARTS_WSS_URL!==undefined) {
      throw Error('AgentArts WSS 地址与 HTTPS 备用开关需要启用 wss 主通道');
    }
    return {transport,...deploymentBinding,...httpsOptions()};
  }
  const supplied=environment.PA_AGENTARTS_WSS_URL??transportPreferences.websocketUrl;
  if (typeof supplied!=='string' || !supplied) {
    throw Error('wss 主通道要求显式配置 PA_AGENTARTS_WSS_URL，不能自动猜测公网地址');
  }
  if (supplied!==supplied.trim() || /\s|\\|#|[\u0000-\u001f\u007f-\u009f]/.test(supplied)) {
    throw Error('AgentArts WSS 地址无效，必须是精确且无认证信息的地址');
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
  const rawTarget=pathStart<0?'':supplied.slice(pathStart),queryStart=rawTarget.indexOf('?');
  const rawPath=queryStart<0?rawTarget:rawTarget.slice(0,queryStart),rawQuery=queryStart<0?'':rawTarget.slice(queryStart);
  if (address.protocol!=='wss:' || address.origin.replace(/^wss:/,'https:')!==gateway.origin
    || !paths.includes(rawPath) || address.pathname!==rawPath
    || address.username || address.password || address.hash || address.search!==rawQuery
    || rawQuery!=='' && !/^\?endpoint=[A-Za-z0-9_.-]{1,128}$/.test(rawQuery)) {
    throw Error('AgentArts WSS 必须使用同一网关与运行时地址');
  }
  if (rawQuery!=='' && (boundDeploymentVersion===undefined || rawQuery!=='?endpoint='+boundDeploymentVersion)) {
    throw Error('AgentArts WSS 地址版本必须与当前受信部署版本完全一致');
  }
  if (boundDeploymentVersion!==undefined) address.searchParams.set('endpoint',boundDeploymentVersion);
  const readToken=()=>{
    const token=readAppToken?readAppToken():currentOptions().appToken??environment.PA_AGENTARTS_APP_TOKEN;
    if (typeof token!=='string' || !/^[\x21-\x7e]{32,4096}$/.test(token)) {
      throw Error('请在受信主机环境中配置 AgentArts 自有镜像入站凭据');
    }
    return `Bearer ${token}`;
  };
  readToken();
  return {transport,...deploymentBinding,websocketUrl:address.href,allowHttpsFallback:fallback==='1',...httpsOptions(),
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
