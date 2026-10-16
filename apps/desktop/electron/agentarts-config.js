import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';

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
  if (value.appToken!==undefined && (typeof value.appToken!=='string' || !/^[\x21-\x7e]{32,4096}$/.test(value.appToken))) {
    throw Error('AgentArts 应用入站凭据格式无效');
  }
  if (value.deploymentVersion!==undefined && (typeof value.deploymentVersion!=='string'
    || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.deploymentVersion))) throw Error('AgentArts 部署版本格式无效');
  return {...binding,authorization:value.authorization,
    ...(value.appToken===undefined?{}:{appToken:value.appToken}),
    ...(value.deploymentVersion===undefined?{}:{deploymentVersion:value.deploymentVersion})};
}

/** Host-only storage; snapshots never return either credential value. */
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
  const snapshot=()=>({configured:Boolean(saved),runtimeReady:Boolean(runtimeBinding()),gatewayUrl:saved?.gatewayUrl??defaults.gatewayUrl,
    runtimeName:saved?.runtimeName??defaults.runtimeName,
    appTokenConfigured:Boolean(saved?.appToken),deploymentVersion:saved?.deploymentVersion??'',
    reason:failure || (saved?'已配置；真实连通以任务结果为准':'请配置 AgentArts 网关、运行时名称和 Authorization')});
  return {snapshot,runtimeBinding,
    binding(){if (!saved) throw Error(snapshot().reason);return {gatewayUrl:saved.gatewayUrl,runtimeName:saved.runtimeName};},
    readAuthorization(binding) {
      if (!saved || binding.gatewayUrl!==saved.gatewayUrl || binding.runtimeName!==saved.runtimeName) throw Error('AgentArts 配置已改变，请重启应用重新绑定');
      return saved.authorization;
    },
    readTransportOptions(binding) {
      if (!saved || binding.gatewayUrl!==saved.gatewayUrl || binding.runtimeName!==saved.runtimeName) throw Error('AgentArts 配置已改变，请重启应用重新绑定');
      return {...(saved.appToken===undefined?{}:{appToken:saved.appToken}),
        ...(saved.deploymentVersion===undefined?{}:{deploymentVersion:saved.deploymentVersion})};
    },
    configure(input) {
      if (!input || Object.keys(input).some(key=>!['gatewayUrl','runtimeName','authorization','appToken','deploymentVersion'].includes(key))) throw Error('AgentArts 配置格式无效');
      // A credential may be retained only for the same exact destination.
      const binding=validateBinding(input);
      const sameDestination=binding.gatewayUrl===saved?.gatewayUrl && binding.runtimeName===saved?.runtimeName;
      const authorization=input.authorization===undefined || input.authorization===''
        ? (sameDestination ? saved.authorization : '')
        : input.authorization;
      const appToken=input.appToken===undefined || input.appToken===''
        ? (sameDestination?saved.appToken:undefined) : input.appToken;
      const deploymentVersion=input.deploymentVersion===undefined
        ? (sameDestination?saved.deploymentVersion:undefined) : input.deploymentVersion===''?undefined:input.deploymentVersion;
      const value=validate({...binding,authorization,appToken,deploymentVersion});
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
