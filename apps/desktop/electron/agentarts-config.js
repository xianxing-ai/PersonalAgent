import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {createAgentArtsTransportConfig} from './agentarts-transport-config.js';

const transportEnvironment=value=>({PA_AGENTARTS_TRANSPORT:value.transport,
  ...(value.transport==='wss'?{PA_AGENTARTS_WSS_URL:value.websocketUrl,
    PA_AGENTARTS_HTTPS_FALLBACK:value.allowHttpsFallback?'1':'0',PA_AGENTARTS_APP_TOKEN:value.appToken}:{})});
const transportKey=value=>JSON.stringify([value.transport,value.websocketUrl??'',value.allowHttpsFallback===true,value.deploymentVersion??'']);
const publicTransport=value=>({transport:value.transport,...(value.transport==='wss'
  ?{websocketUrl:value.websocketUrl,allowHttpsFallback:value.allowHttpsFallback}: {})});

function endpoint(value) {
  const url=new URL(value);
  if (url.protocol!=='https:' || url.username || url.password || url.port || url.search || url.hash
    || url.pathname!=='/' || !url.hostname.endsWith('.huaweicloud-agentarts.com')) throw Error('请填写华为 AgentArts 网关 HTTPS 地址');
  return url.origin;
}
function validateBinding(value) {
  const gatewayUrl=endpoint(value.gatewayUrl);
  if (typeof value.runtimeName!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.runtimeName)) throw Error('请填写运行时实例名称');
  return {gatewayUrl,runtimeName:value.runtimeName};
}
function validatePreferences(value){
 if(!value||Object.keys(value).some(k=>!['catalogRevision','defaultModelId','defaultSubmodelId','reasoningEffort','submodelReasoningEffort'].includes(k))||!/^[a-f0-9]{64}$/.test(value.catalogRevision)||['defaultModelId','defaultSubmodelId'].some(k=>typeof value[k]!=='string'||!value[k]||value[k].length>200)||['reasoningEffort','submodelReasoningEffort'].some(k=>value[k]!==undefined&&(typeof value[k]!=='string'||value[k].length>30)))throw Error('模型偏好格式无效');return structuredClone(value);
}
function validate(value) {
  const binding=validateBinding(value);
  if (typeof value.authorization!=='string' || !value.authorization.trim() || value.authorization.length>4096
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value.authorization)) throw Error('请填写控制台 API 示例中的完整 Authorization 值');
  if (value.appToken!==undefined && (typeof value.appToken!=='string' || !/^[\x21-\x7e]{32,4096}$/.test(value.appToken))) throw Error('AgentArts 应用入站凭据格式无效');
  if (value.deploymentVersion!==undefined && (typeof value.deploymentVersion!=='string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.deploymentVersion))) throw Error('AgentArts 部署版本格式无效');
  if(value.transport!==undefined&&!['https','wss'].includes(value.transport)||value.allowHttpsFallback!==undefined&&typeof value.allowHttpsFallback!=='boolean'||value.websocketUrl!==undefined&&typeof value.websocketUrl!=='string')throw Error('AgentArts 传输配置无效');
  if(value.transport==='wss') createAgentArtsTransportConfig({binding,environment:{},transportPreferences:value,
    configurationProvider:{read:()=>({...value.appToken===undefined?{}:{appToken:value.appToken},...value.deploymentVersion===undefined?{}:{deploymentVersion:value.deploymentVersion}})}});
  else if(value.websocketUrl!==undefined||value.allowHttpsFallback===true) throw Error('WSS 地址和 HTTPS 备用需要 WSS 主通道');
  return {...binding,authorization:value.authorization,
    ...(value.appToken===undefined?{}:{appToken:value.appToken}),
    ...(value.deploymentVersion===undefined?{}:{deploymentVersion:value.deploymentVersion}),
    ...(value.modelPreferences===undefined?{}:{modelPreferences:validatePreferences(value.modelPreferences)}),
    ...(value.transport===undefined?{}:{transport:value.transport}),
    ...(value.websocketUrl===undefined?{}:{websocketUrl:value.websocketUrl}),
    ...(value.allowHttpsFallback===undefined?{}:{allowHttpsFallback:value.allowHttpsFallback})};
}

/** Host-only storage; snapshots never return either credential value. */
export function createAgentArtsConfig({userData,safeStorage,environment=process.env,fetchImpl=globalThis.fetch}) {
  const file=path.join(userData,'agentarts-config.json');
  let saved,failure='';
  const defaults={gatewayUrl:environment.PA_AGENTARTS_GATEWAY_URL??'',runtimeName:environment.PA_AGENTARTS_RUNTIME_NAME??''};
  try {
    if (existsSync(file)) {
      const data=JSON.parse(readFileSync(file,'utf8'));
      if (data.version!==1 || !safeStorage.isEncryptionAvailable() || typeof data.encrypted!=='string') throw Error();
      saved=validate(JSON.parse(safeStorage.decryptString(Buffer.from(data.encrypted,'base64'))));
    } else if (environment.PA_AGENTARTS_AUTHORIZATION) saved=validate({...defaults,authorization:environment.PA_AGENTARTS_AUTHORIZATION});
  } catch {failure='AgentArts 配置不可用，请在设置中重新保存';}
  const runtimeBinding=()=>{try{return validateBinding(saved??defaults);}catch{return undefined;}};
  const effectiveEnvironment=()=>saved?.transport===undefined?environment:transportEnvironment(saved);
  const readTransportPreferences=()=>({transport:saved?.transport??environment.PA_AGENTARTS_TRANSPORT??'https',
    ...(saved?.websocketUrl?{websocketUrl:saved.websocketUrl}:{}),
    allowHttpsFallback:saved?.allowHttpsFallback??environment.PA_AGENTARTS_HTTPS_FALLBACK==='1'});
  const readTransportOptions=binding=>{
    const current=runtimeBinding();
    if (!current || binding.gatewayUrl!==current.gatewayUrl || binding.runtimeName!==current.runtimeName) throw Error('AgentArts 配置已改变，请重启应用重新绑定');
    return {...(saved?.appToken===undefined?{}:{appToken:saved.appToken}),
      ...(saved?.deploymentVersion===undefined?{}:{deploymentVersion:saved.deploymentVersion})};
  };
  const currentTransport=()=>createAgentArtsTransportConfig({binding:runtimeBinding(),environment:effectiveEnvironment(),
    transportPreferences:readTransportPreferences(),configurationProvider:{read:()=>readTransportOptions(runtimeBinding())}});
  const isTransportCurrent=options=>{try{return transportKey(options)===transportKey(currentTransport());}catch{return false;}};
  function assertBinding(binding,options) {
    if (!saved || binding.gatewayUrl!==saved.gatewayUrl || binding.runtimeName!==saved.runtimeName
      || (options && !isTransportCurrent(options))) throw Error('AgentArts 配置已改变或撤销，请重启应用重新绑定');
  }
  const snapshot=()=>{
    let transport,transportFailure='';
    try {transport=publicTransport(currentTransport());}
    catch {transportFailure='AgentArts 实时连接配置不完整，请核对 WSS 地址与独立镜像凭据';}
    const preferences=readTransportPreferences();
    return {configured:Boolean(saved)&&!transportFailure,runtimeReady:Boolean(runtimeBinding()),
      gatewayUrl:saved?.gatewayUrl??defaults.gatewayUrl,runtimeName:saved?.runtimeName??defaults.runtimeName,
      appTokenConfigured:Boolean(saved?.appToken||environment.PA_AGENTARTS_APP_TOKEN),deploymentVersion:saved?.deploymentVersion??'',
      ...(transport??{transport:!saved&&!environment.PA_AGENTARTS_TRANSPORT&&!environment.PA_AGENTARTS_AUTHORIZATION?'wss':preferences.transport}),
      ...(!saved&&!environment.PA_AGENTARTS_TRANSPORT&&!environment.PA_AGENTARTS_AUTHORIZATION?{transport:'wss'}:{}),
      websocketUrl:transport?.websocketUrl??saved?.websocketUrl??environment.PA_AGENTARTS_WSS_URL??'',
      allowHttpsFallback:transport?.allowHttpsFallback??preferences.allowHttpsFallback,
      effectiveTransport:saved?.transport??environment.PA_AGENTARTS_TRANSPORT??'https',
      transportSource:saved?.transport!==undefined?'saved':environment.PA_AGENTARTS_TRANSPORT!==undefined?'environment':'default',
      reason:failure||transportFailure||(saved?'已配置；真实连通以任务结果为准':'请配置 AgentArts 网关、运行时名称和 Authorization')};
  };
  return {snapshot,runtimeBinding,isTransportCurrent,
    transportConfig(binding) {
      const initial=currentTransport();
      // Keep the HTTPS destination guard even without WSS options.
      return createAgentArtsTransportConfig({binding,fetchImpl,environment:effectiveEnvironment(),transportPreferences:readTransportPreferences(),
        configurationProvider:{read:()=>readTransportOptions(binding)},readAppToken:()=>{
          assertBinding(binding,initial);
          return readTransportOptions(binding).appToken??effectiveEnvironment().PA_AGENTARTS_APP_TOKEN;
        }});
    },
    readTransportPreferences,
    readModelPreferences(){return saved?.modelPreferences?structuredClone(saved.modelPreferences):undefined;},
    saveModelPreferences(value){value=validatePreferences(value);if(!safeStorage.isEncryptionAvailable())throw Error('本机安全存储不可用');if(!saved)throw Error(snapshot().reason);const next={...saved,modelPreferences:structuredClone(value)};const encrypted=safeStorage.encryptString(JSON.stringify(next)).toString('base64');mkdirSync(userData,{recursive:true});writeFileSync(file+'.tmp',JSON.stringify({version:1,encrypted}),'utf8');renameSync(file+'.tmp',file);saved=next;},
    binding(){if (!saved) throw Error(snapshot().reason);return {gatewayUrl:saved.gatewayUrl,runtimeName:saved.runtimeName};},
    readAuthorization(binding,transport) {assertBinding(binding,transport);return saved.authorization;},
    readTransportOptions,
    configure(input) {
      if (!input || Object.keys(input).some(key=>!['gatewayUrl','runtimeName','authorization','appToken','deploymentVersion','transport','websocketUrl','allowHttpsFallback'].includes(key))) throw Error('AgentArts 配置格式无效');
      if(input.transport!==undefined&&!['wss','https'].includes(input.transport)||input.allowHttpsFallback!==undefined&&typeof input.allowHttpsFallback!=='boolean'||input.websocketUrl!==undefined&&typeof input.websocketUrl!=='string')throw Error('AgentArts 传输配置无效');
      // A credential may be retained only for the same exact destination and deployment.
      const binding=validateBinding(input);
      const sameDestination=binding.gatewayUrl===saved?.gatewayUrl&&binding.runtimeName===saved?.runtimeName;
      const authorization=input.authorization===undefined||input.authorization===''?(sameDestination?saved.authorization:''):input.authorization;
      const deploymentVersion=input.deploymentVersion===undefined?(sameDestination?saved.deploymentVersion:undefined):input.deploymentVersion===''?undefined:input.deploymentVersion;
      const sameDeployment=sameDestination&&deploymentVersion===saved?.deploymentVersion;
      const transport=input.transport??(sameDeployment?saved?.transport:undefined);
      const appToken=input.appToken===undefined||input.appToken===''?
        (sameDestination&&transport==='wss'?(saved?.appToken??environment.PA_AGENTARTS_APP_TOKEN):
          input.transport===undefined&&sameDestination?saved?.appToken:undefined):input.appToken;
      const websocketUrl=input.websocketUrl===undefined?(sameDeployment?saved?.websocketUrl:undefined):input.websocketUrl||undefined;
      if(!sameDeployment&&transport==='wss'&&input.websocketUrl===undefined)throw Error('目的地或部署已改变，请重新填写精确 WSS 地址');
      const allowHttpsFallback=input.allowHttpsFallback??(sameDeployment?saved?.allowHttpsFallback:undefined);
      const value=validate({...binding,authorization,appToken,deploymentVersion,transport,
        websocketUrl:transport==='https'?undefined:websocketUrl,
        allowHttpsFallback:transport==='https'?false:allowHttpsFallback,
        ...(sameDestination&&deploymentVersion===saved?.deploymentVersion&&saved?.modelPreferences?{modelPreferences:saved.modelPreferences}:{})});
      if (!safeStorage.isEncryptionAvailable()) throw Error('本机安全存储不可用，未保存');
      const encrypted=safeStorage.encryptString(JSON.stringify(value)).toString('base64');
      mkdirSync(userData,{recursive:true});
      writeFileSync(file+'.tmp',JSON.stringify({version:1,encrypted}),'utf8');renameSync(file+'.tmp',file);
      saved=value;failure='';return snapshot();
    },
    revoke() {
      saved=undefined;failure='';
      try {unlinkSync(file);} catch(error) {
        if(error?.code!=='ENOENT') {failure='未能删除本机 AgentArts 配置；撤销尚未确认，请检查本机存储后重试';throw Error(failure);}
      }
      return snapshot();
    },
  };
}
