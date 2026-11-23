/** Project current trusted configuration; a cached startup model is not configuration evidence. */
export function agentArtsModelSnapshot(previous, settings) {
  const configured=settings?.configured===true;
  return {...previous,
    provider:'agentarts',label:'云端模型',
    status:configured?'configured':'unconfigured',verification:'unverified',
    baseUrl:settings?.gatewayUrl??'',model:'AgentArts Runtime',deployment:settings?.runtimeName??'',
    configured,keyConfigured:configured,persisted:false,enabled:true,
    capabilities:{text:true,streaming:false,toolCalling:false,structuredOutput:false,vision:false},
    reason:settings?.reason || '请在设置中配置 AgentArts；真实结果仍需任务读回验证',
    lastTestAt:null,latencyMs:null,
  };
}
