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
function validatePreferences(value){ if(!value||Object.keys(value).some(k=>!['catalogRevision','defaultModelId','defaultSubmodelId','reasoningEffort','submodelReasoningEffort'].includes(k))||!/^[a-f0-9]{64}$/.test(value.catalogRevision)||['defaultModelId','defaultSubmodelId'].some(k=>typeof value[k]!=='string'||!value[k]||value[k].length>200)||['reasoningEffort','submodelReasoningEffort'].some(k=>value[k]!==undefined&&(typeof value[k]!=='string'||value[k].length>30)))throw Error('模型偏好格式无效');return structuredClone(value);
}
/** Reads `?endpoint=<version>` from a pasted pinned address without normalizing the URL. */
function pinFromUrl(value) {
  const query = value.indexOf('?');
  if (query < 0) return undefined;
  return /^\?endpoint=([A-Za-z0-9_.-]{1,128})$/.exec(value.slice(query))?.[1];
}
function validate(value) {
  const binding=validateBinding(value);
  if (typeof value.authorization!=='string' || !value.authorization.trim() || value.authorization.length>4096
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value.authorization)) throw Error('请填写控制台 API 示例中的完整 Authorization 值');
  if (value.appToken!==undefined && (typeof value.appToken!=='string' || !/^[\x21-\x7e]{32,4096}$/.test(value.appToken))) throw Error('“独立镜像访问令牌”格式无效：需要 32–4096 位可见字符（不含空格）');
  if (value.deploymentVersion!==undefined && (typeof value.deploymentVersion!=='string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.deploymentVersion))) throw Error('“固定部署版本”格式无效：只允许字母、数字、下划线、点和短横线，最长 128 位');
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
    try {if(runtimeBinding())transport=publicTransport(currentTransport());}
    catch {transportFailure='AgentArts 实时连接配置不完整，请核对 WSS 地址与独立镜像凭据';}
    const preferences=readTransportPreferences();
    return {configured:Boolean(saved)&&!transportFailure,runtimeReady:Boolean(runtimeBinding()),
      gatewayUrl:saved?.gatewayUrl??defaults.gatewayUrl,runtimeName:saved?.runtimeName??defaults.runtimeName,
      appTokenConfigured:Boolean(saved?.appToken||environment.PA_AGENTARTS_APP_TOKEN),deploymentVersion:saved?.deploymentVersion??'',
      deploymentSelection:saved?.deploymentVersion===undefined?'latest':'pinned',canRestoreDefaultConnection:Boolean(saved),
      ...(transport??{transport:preferences.transport}),
      websocketUrl:transport?.transport==='https'?'':transport?.websocketUrl??saved?.websocketUrl??environment.PA_AGENTARTS_WSS_URL??'',
      allowHttpsFallback:transport?.allowHttpsFallback??preferences.allowHttpsFallback,
      effectiveTransport:saved?.transport??environment.PA_AGENTARTS_TRANSPORT??'https',
      transportSource:saved?.transport!==undefined?'saved':environment.PA_AGENTARTS_TRANSPORT!==undefined?'environment':'default',
      reason:failure||transportFailure||(saved?'已配置；真实连通以任务结果为准':'请配置 AgentArts 网关、运行时名称和 Authorization')};
  };
  const config={snapshot,runtimeBinding,isTransportCurrent,
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
    restoreDefaultConnection(input) {
      if(input!==undefined)throw Error('AgentArts 默认连接恢复不接受参数');
      if(!saved)throw Error('请先保存 AgentArts 实例与凭据，再恢复默认连接');
      // An explicit settings action changes only the saved route. No request is sent or replayed.
      return config.configure({gatewayUrl:saved.gatewayUrl,runtimeName:saved.runtimeName,
        appToken:saved.appToken,deploymentVersion:'',transport:'https',websocketUrl:'',allowHttpsFallback:false});
    },
    configure(input) {
      if (!input || Object.keys(input).some(key=>!['gatewayUrl','runtimeName','authorization','appToken','deploymentVersion','transport','websocketUrl','allowHttpsFallback'].includes(key))) throw Error('AgentArts 配置格式无效');
      if(input.transport!==undefined&&!['wss','https'].includes(input.transport)||input.allowHttpsFallback!==undefined&&typeof input.allowHttpsFallback!=='boolean'||input.websocketUrl!==undefined&&typeof input.websocketUrl!=='string')throw Error('AgentArts 传输配置无效');
      // A credential may be retained only for the same exact destination and deployment.
      const binding=validateBinding(input);
      const sameDestination=binding.gatewayUrl===saved?.gatewayUrl&&binding.runtimeName===saved?.runtimeName;
      const authorization=input.authorization===undefined||input.authorization===''?(sameDestination?saved.authorization:''):input.authorization;
      let deploymentVersion=input.deploymentVersion===undefined?(sameDestination?saved.deploymentVersion:undefined):input.deploymentVersion===''?undefined:input.deploymentVersion;
      let sameDeployment=sameDestination&&deploymentVersion===saved?.deploymentVersion;
      const websocketUrl=input.websocketUrl===undefined?(sameDeployment?saved?.websocketUrl:undefined):input.websocketUrl||undefined;
      // A pasted pinned address already names the deployment; requiring the same value twice made
      // the form reject every URL the console hands out. The address is authoritative when the
      // field is blank, and a contradiction is refused instead of silently picking one.
      const urlEndpoint=websocketUrl===undefined?undefined:pinFromUrl(websocketUrl);
      if(deploymentVersion===undefined&&urlEndpoint!==undefined)deploymentVersion=urlEndpoint;
      if(urlEndpoint!==undefined&&deploymentVersion!==undefined&&urlEndpoint!==deploymentVersion)throw Error('WSS 地址中的 endpoint 版本（'+urlEndpoint+'）与“固定部署版本”（'+deploymentVersion+'）不一致，请改成同一个版本');
      sameDeployment=sameDestination&&deploymentVersion===saved?.deploymentVersion;
      const transport=input.transport??(sameDeployment?saved?.transport:undefined);
      const appToken=input.appToken===undefined||input.appToken===''?
        (sameDestination&&transport==='wss'?(saved?.appToken??environment.PA_AGENTARTS_APP_TOKEN):
          input.transport===undefined&&sameDestination?saved?.appToken:undefined):input.appToken;
      if(!sameDeployment&&transport==='wss'&&input.websocketUrl===undefined)throw Error('目的地或部署已改变，请重新填写精确 WSS 地址');
      if(transport==='wss'&&appToken===undefined)throw Error('首次配置 WSS 主通道必须填写“独立镜像访问令牌”（至少 32 位可见字符）');
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
  return config;
}
