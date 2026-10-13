import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {createAgentArtsTransportConfig} from './agentarts-transport-config.js';

const transportEnvironment=value=>({PA_AGENTARTS_TRANSPORT:value.transport,
  ...(value.transport==='wss'?{PA_AGENTARTS_WSS_URL:value.websocketUrl,
    PA_AGENTARTS_HTTPS_FALLBACK:value.allowHttpsFallback?'1':'0',PA_AGENTARTS_APP_TOKEN:value.appToken}:{})});
const transportKey=value=>JSON.stringify([value.transport,value.websocketUrl??'',value.allowHttpsFallback===true]);
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
function validate(value) {
  const binding=validateBinding(value);
  if (typeof value.authorization!=='string' || !value.authorization.trim() || value.authorization.length>4096
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value.authorization)) throw Error('请填写控制台 API 示例中的完整 Authorization 值');
  if (value.transport===undefined) return {...binding,authorization:value.authorization};
  if (value.allowHttpsFallback!==undefined && typeof value.allowHttpsFallback!=='boolean') throw Error('AgentArts 备用开关格式无效');
  if (value.transport==='https' && (value.websocketUrl || value.appToken || value.allowHttpsFallback)) throw Error('HTTPS 兼容配置不能携带 WSS 配置');
  const options=createAgentArtsTransportConfig({binding,environment:transportEnvironment(value)});
  return {...binding,authorization:value.authorization,...publicTransport(options),
    ...(options.transport==='wss'?{appToken:value.appToken}:{})};
}

/** Host-only storage; snapshots never return the Authorization value. */
export function createAgentArtsConfig({userData,safeStorage,environment=process.env}) {
  const file=path.join(userData,'agentarts-config.json');
  let saved,failure='';
  const defaults={gatewayUrl:environment.PA_AGENTARTS_GATEWAY_URL??'',runtimeName:environment.PA_AGENTARTS_RUNTIME_NAME??''};
  try {
    if (existsSync(file)) {
      const data=JSON.parse(readFileSync(file,'utf8'));
      if (data.version!==1 || !safeStorage.isEncryptionAvailable() || typeof data.encrypted!=='string') throw Error();
      saved=validate(JSON.parse(safeStorage.decryptString(Buffer.from(data.encrypted,'base64'))));
    } else if (environment.PA_AGENTARTS_AUTHORIZATION) {
      saved=validate({...defaults,authorization:environment.PA_AGENTARTS_AUTHORIZATION});
    }
  } catch {failure='AgentArts 配置不可用，请在设置中重新保存';}
  // A known destination can host local Runtime/Live services while credentials remain unavailable.
  // This never writes configuration or permits an unauthenticated AgentArts request.
  const runtimeBinding=()=>{try{return validateBinding(saved??defaults);}catch{return undefined;}};
  const effectiveEnvironment=()=>saved?.transport===undefined?environment:transportEnvironment(saved);
  const currentTransport=()=>createAgentArtsTransportConfig({binding:runtimeBinding(),environment:effectiveEnvironment()});
  const isTransportCurrent=options=>{try{return transportKey(options)===transportKey(currentTransport());}catch{return false;}};
  function assertBinding(binding,options) {
    if (!saved || binding.gatewayUrl!==saved.gatewayUrl || binding.runtimeName!==saved.runtimeName
      || (options && !isTransportCurrent(options))) throw Error('AgentArts 配置已改变或撤销，请重启应用重新绑定');
  }
  const snapshot=()=>{
    let transport,transportFailure='';
    try {transport=publicTransport(currentTransport());}
    catch {transportFailure='AgentArts 实时连接配置不完整，请核对 WSS 地址与独立镜像凭据';}
    return {configured:Boolean(saved)&&!transportFailure,runtimeReady:Boolean(runtimeBinding()),
      gatewayUrl:saved?.gatewayUrl??defaults.gatewayUrl,runtimeName:saved?.runtimeName??defaults.runtimeName,
      // A new UI configuration starts with WSS; a legacy saved/environment profile stays explicit HTTPS.
      ...(transport??{transport:'wss'}),
      ...(!saved && !environment.PA_AGENTARTS_TRANSPORT && !environment.PA_AGENTARTS_AUTHORIZATION?{transport:'wss'}:{}),
      reason:failure || transportFailure || (saved?'已配置；真实连通以任务结果为准':'请配置 AgentArts 网关、运行时名称和调用凭据')};
  };
  return {snapshot,runtimeBinding,
    isTransportCurrent,
    transportConfig(binding) {
      const initial=currentTransport();
      return createAgentArtsTransportConfig({binding,environment:effectiveEnvironment(),readAppToken:()=>{
        assertBinding(binding,initial);
        return effectiveEnvironment().PA_AGENTARTS_APP_TOKEN;
      }});
    },
    binding(){if (!saved) throw Error(snapshot().reason);return {gatewayUrl:saved.gatewayUrl,runtimeName:saved.runtimeName};},
    readAuthorization(binding,transport) {
      assertBinding(binding,transport);
      return saved.authorization;
    },
    configure(input) {
      if (!input || Object.keys(input).some(key=>!['gatewayUrl','runtimeName','authorization','transport','websocketUrl','appToken','allowHttpsFallback'].includes(key))) throw Error('AgentArts 配置格式无效');
      if (input.transport!==undefined && !['wss','https'].includes(input.transport)) throw Error('AgentArts 连接方式无效');
      if (input.allowHttpsFallback!==undefined && typeof input.allowHttpsFallback!=='boolean') throw Error('AgentArts 备用开关格式无效');
      if (input.transport==='https' && (input.websocketUrl || input.appToken || input.allowHttpsFallback)) throw Error('HTTPS 兼容配置不能携带 WSS 配置');
      // A credential may be retained only for the same exact destination.
      const binding=validateBinding(input);
      const authorization=input.authorization===undefined || input.authorization===''
        ? (binding.gatewayUrl===saved?.gatewayUrl && binding.runtimeName===saved?.runtimeName ? saved.authorization : '')
        : input.authorization;
      const sameDestination=binding.gatewayUrl===saved?.gatewayUrl && binding.runtimeName===saved?.runtimeName;
      const transport=input.transport??(sameDestination?saved?.transport:undefined);
      const appToken=input.appToken===undefined || input.appToken===''
        ? (sameDestination && transport==='wss' ? effectiveEnvironment().PA_AGENTARTS_APP_TOKEN : undefined) : input.appToken;
      if (transport===undefined && ['websocketUrl','appToken','allowHttpsFallback'].some(key=>input[key]!==undefined)) throw Error('WSS 配置需要明确连接方式');
      const value=validate({...binding,authorization,...(transport===undefined?{}:transport==='https'?{transport}:{transport,
        websocketUrl:input.websocketUrl??(sameDestination?saved?.websocketUrl:undefined),
        allowHttpsFallback:input.allowHttpsFallback??(sameDestination?saved?.allowHttpsFallback:undefined),
        appToken})});
      if (!safeStorage.isEncryptionAvailable()) throw Error('本机安全存储不可用，未保存');
      const encrypted=safeStorage.encryptString(JSON.stringify(value)).toString('base64');
      mkdirSync(userData,{recursive:true});
      writeFileSync(file+'.tmp',JSON.stringify({version:1,encrypted}),'utf8');renameSync(file+'.tmp',file);
      saved=value;failure='';return snapshot();
    },
    revoke() {
      saved=undefined;failure='';
      try { unlinkSync(file); } catch (error) {
        if (error?.code!=='ENOENT') {
          failure='未能删除本机 AgentArts 配置；撤销尚未确认，请检查本机存储后重试';
          throw Error(failure);
        }
      }
      return snapshot();
    },
  };
}
