import {mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {ProtocolError} from '@personal-agent/contracts';
import {computerControlFailure} from './computer-control-errors.js';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
const sources=new Set(['agentarts-proxy','openai-compatible']);
// Huawei documents a 5 MB whole-body limit for Base64 image requests. Use a conservative
// decimal boundary because the platform document does not define MB in exact bytes.
// https://support.huaweicloud.com/model-call-maas/model-call-011.html
const agentArtsMaxRequestBytes=5_000_000;
function assertAgentArtsRequestBody(body){
  if(typeof body!=='string')fail('INVALID_ARGUMENT','AgentArts 视觉请求体必须是已编码的 JSON 字符串');
  const bytes=Buffer.byteLength(body,'utf8');
  if(bytes>agentArtsMaxRequestBytes)fail('INVALID_ARGUMENT',`AgentArts 视觉请求体为 ${bytes} UTF-8 字节，超过本机保守上限 ${agentArtsMaxRequestBytes} 字节（5 MB）；图像 Base64、文本及 JSON 开销均计入`);
  let parsed;try{parsed=JSON.parse(body);}catch{fail('INVALID_ARGUMENT','AgentArts 视觉请求体 JSON 格式无效');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('INVALID_ARGUMENT','AgentArts 视觉请求体必须是 JSON 对象');
}
const cleanText=(value,max,label)=>typeof value==='string'&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/u.test(value)
  ?value.trim():fail('INVALID_ARGUMENT',`${label}格式无效`);
function destination(source,baseUrl,model,allowEmpty=false){
  if(!sources.has(source))fail('INVALID_ARGUMENT','视觉模型来源无效');
  const base=cleanText(baseUrl,2048,'视觉 Endpoint'),name=cleanText(model,200,'视觉模型');
  if(allowEmpty&&!base&&!name)return {source,baseUrl:'',model:''};
  if(!base||!name)fail('INVALID_ARGUMENT','请填写视觉模型 Endpoint 和模型名称');
  let url;try{url=new URL(base);}catch{fail('INVALID_ARGUMENT','视觉模型 Endpoint 不是有效 URL');}
  if(url.username||url.password||url.search||url.hash)fail('INVALID_ARGUMENT','视觉 Endpoint 不能包含凭据、查询参数或片段');
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(source==='agentarts-proxy'){
    if(url.protocol!=='https:'||!url.hostname.endsWith('.huaweicloud-agentarts.com')
      ||url.pathname.replace(/\/+$/u,'')!=='/inference/v1'||url.port)fail('INVALID_ARGUMENT','AgentArts 视觉 Endpoint 必须为 HTTPS 的 *.huaweicloud-agentarts.com/inference/v1');
  }else if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))fail('INVALID_ARGUMENT','自定义视觉 Endpoint 必须为 HTTPS；明确的 localhost 服务可用 HTTP');
  return {source,baseUrl:url.href.replace(/\/+$/u,''),model:name};
}
const sameDestination=(a,b)=>a.source===b.source&&a.baseUrl===b.baseUrl&&a.model===b.model;
const publicBinding=value=>({revision:value.revision,source:value.source,baseUrl:value.baseUrl,model:value.model});
const parseJson=(text,label)=>{try{return JSON.parse(text);}catch{fail('PROTOCOL_MISMATCH',`${label} JSON 无效，无法恢复视觉配置`);}};

/** Main-only encrypted optional vision configuration. Saving never contacts a model. */
export function createComputerVisionConfig({userData,safeStorage,createGateway,fetchImpl=globalThis.fetch,onUpdate=()=>{},profile='huawei_ict_agentarts'}){
  const file=path.join(userData,'computer-vision-config.json'),pending=new Set(),calls=new AsyncLocalStorage();
  let value={version:1,revision:randomUUID(),enabled:false,source:'agentarts-proxy',baseUrl:'',model:'',apiKey:''},disposed=false,failure;
  const diagnostic=(error,stage,secrets=[])=>{
    const safe=computerControlFailure(error,stage);
    for(const secret of secrets)if(secret)safe.message=safe.message.replaceAll(secret,'[凭据已遮蔽]');
    return safe;
  };
  const revoke=()=>{for(const controller of pending)controller.abort('Vision configuration changed');};
  const publish=()=>{try{onUpdate();}catch(error){failure=diagnostic(error,'computer.vision.notify',[value.apiKey]);}};
  try{
    let raw;try{raw=readFileSync(file,'utf8');}catch(error){if(error?.code!=='ENOENT')throw error;}
    if(raw!==undefined){
      if(safeStorage?.isEncryptionAvailable()!==true)fail('UNSUPPORTED_CAPABILITY','本机安全存储不可用，无法解密视觉配置');
      const envelope=parseJson(raw,'视觉加密信封');
      if(envelope?.version!==1||typeof envelope.encrypted!=='string'||!envelope.encrypted
        ||envelope.encrypted.length>64_000||!/^[A-Za-z0-9+/]+={0,2}$/u.test(envelope.encrypted))fail('PROTOCOL_MISMATCH','视觉配置加密信封或版本无效');
      const saved=parseJson(safeStorage.decryptString(Buffer.from(envelope.encrypted,'base64')),'解密后的视觉配置');
      if(!saved||saved.version!==1||typeof saved.enabled!=='boolean'||typeof saved.revision!=='string'
        ||!saved.revision||saved.revision.length>100||Object.keys(saved).some(key=>!['version','revision','enabled','source','baseUrl','model','apiKey'].includes(key)))fail('PROTOCOL_MISMATCH','视觉配置内容或版本无效');
      const endpoint=destination(saved.source,saved.baseUrl,saved.model,!saved.enabled);
      const apiKey=cleanText(saved.apiKey,8192,'视觉 API Key');
      if(saved.enabled&&(!endpoint.model||!apiKey))fail('PROTOCOL_MISMATCH','启用的视觉配置缺少目的地或凭据');
      value={...saved,...endpoint,apiKey};
    }
  }catch(error){failure=diagnostic(error,'computer.vision.restore');}
  const configured=()=>Boolean(value.baseUrl&&value.model&&value.apiKey);
  const supported=()=>profile==='huawei_ict_agentarts'&&typeof createGateway==='function'&&typeof fetchImpl==='function';
  const snapshot=()=>({source:value.source,baseUrl:value.baseUrl,model:value.model,revision:value.revision,
    configured:configured(),available:!disposed&&!failure&&supported()&&value.enabled&&configured(),enabled:value.enabled,
    keyConfigured:Boolean(value.apiKey),reason:disposed?'视觉配置宿主已释放':failure?failure.message
      :!supported()?'当前 Competition 视觉模型网关不可用':!configured()?'可选视觉尚未配置；默认 AgentArts 文本规划继续使用'
        :!value.enabled?'可选视觉已关闭；默认 AgentArts 文本规划继续使用':'可选视觉已配置；真实端点识别能力尚未验证',
    ...(failure?{failure:{...failure}}:{})});
  const isCurrent=binding=>Boolean(!disposed&&!failure&&supported()&&value.enabled&&configured()&&binding
    &&['revision','source','baseUrl','model'].every(key=>binding[key]===value[key]));
  const assertCurrent=binding=>{if(!isCurrent(binding))fail('REVISION_CONFLICT','视觉模型配置已关闭、撤销或变更，请使用当前配置版本');};
  const assertCall=context=>{
    assertCurrent(context.binding);
    if(context.signal.aborted)fail('CANCELLED','视觉分析已取消');
    if(Date.parse(context.deadline)<=Date.now())fail('TIMEOUT','视觉分析超过原任务期限');
  };
  return Object.freeze({snapshot,isCurrent,
    configure(input){
      if(disposed)fail('CANCELLED','视觉配置宿主已释放');
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['expectedRevision','enabled','source','baseUrl','model','apiKey'].includes(key))
        ||typeof input.enabled!=='boolean'||(input.apiKey!==undefined&&typeof input.apiKey!=='string'))fail('INVALID_ARGUMENT','视觉设置字段无效');
      if(input.expectedRevision!==value.revision)fail('REVISION_CONFLICT','视觉配置版本已变化，请刷新后重新保存');
      if(profile!=='huawei_ict_agentarts')fail('UNSUPPORTED_CAPABILITY','视觉配置只服务 AgentArts Competition Profile');
      const endpoint=destination(input.source,input.baseUrl,input.model,!input.enabled);
      const key=cleanText(input.apiKey??'',8192,'视觉 API Key');
      if(!sameDestination(value,endpoint)&&endpoint.model&&!key)fail('INVALID_ARGUMENT','新的视觉模型目的地需要重新填写 API Key');
      const apiKey=key||(sameDestination(value,endpoint)?value.apiKey:'');
      if(input.enabled&&!apiKey)fail('INVALID_ARGUMENT','启用视觉分析需要填写 API Key');
      const next={version:1,revision:randomUUID(),enabled:input.enabled,...endpoint,apiKey};
      revoke();
      try{
        if(safeStorage?.isEncryptionAvailable()!==true)fail('UNSUPPORTED_CAPABILITY','本机安全存储不可用，未保存视觉配置');
        const encrypted=safeStorage.encryptString(JSON.stringify(next)).toString('base64');
        mkdirSync(userData,{recursive:true});
        const temporary=file+'.next-'+randomUUID();
        writeFileSync(temporary,JSON.stringify({version:1,encrypted})+'\n',{encoding:'utf8',mode:0o600});
        renameSync(temporary,file);value=next;failure=undefined;
      }catch(error){failure=diagnostic(error,'computer.vision.configure',[value.apiKey,apiKey]);publish();
        const safe=new ProtocolError(failure.code,failure.message);safe.stage=failure.stage;throw safe;}
      publish();return snapshot();
    },
    readGateway(binding,beforeSend){
      assertCurrent(binding);
      if(typeof beforeSend!=='function')fail('INVALID_ARGUMENT','视觉分析必须提供精确图像出机守卫');
      const selected=publicBinding(value),secret=value.apiKey;
      const gateway=createGateway({profile,provider:'openai-compatible',baseUrl:selected.baseUrl,model:selected.model,
        deployment:'computer-vision@'+selected.revision,vision:true,
        apiKey:()=>{const context=calls.getStore();if(!context)fail('UNAUTHORIZED','缺少当前视觉调用上下文');assertCall(context);return secret;},
        fetch:async(url,init)=>{
          const context=calls.getStore();if(!context)fail('UNAUTHORIZED','缺少当前视觉调用上下文');assertCall(context);
          if(String(url)!==selected.baseUrl+'/chat/completions')fail('UNAUTHORIZED','视觉请求目的地与当前模型不一致');
          // Keep the exact measured immutable body across the asynchronous export guard.
          const transport={...init,redirect:'error'};
          if(selected.source==='agentarts-proxy')assertAgentArtsRequestBody(transport.body);
          await beforeSend({binding:{...selected},signal:context.signal,deadline:context.deadline});
          assertCall(context);
          if(transport.signal?.aborted)fail('CANCELLED','视觉传输已取消');
          return fetchImpl(url,transport);
        }});
      if(!gateway||typeof gateway.complete!=='function')fail('UNSUPPORTED_CAPABILITY','受信视觉网关不可用');
      return Object.freeze({deployment:structuredClone(gateway.deployment),async complete(request){
        assertCurrent(selected);
        if(!request||!(request.signal instanceof AbortSignal)||!Number.isFinite(Date.parse(request.deadline)))fail('INVALID_ARGUMENT','视觉请求期限或取消信号无效');
        const sourceSignal=request.signal,controller=new AbortController(),abort=()=>controller.abort(sourceSignal.reason);
        sourceSignal.addEventListener('abort',abort,{once:true});if(sourceSignal.aborted)abort();pending.add(controller);
        const context={binding:selected,signal:controller.signal,deadline:request.deadline};
        const remaining=Date.parse(context.deadline)-Date.now();
        let removeAbort=()=>{},timer;
        try{
          assertCall(context);
          const interrupted=new Promise((_,reject)=>{
            const cancelled=()=>reject(new ProtocolError('CANCELLED','视觉分析已取消或配置已撤销'));
            controller.signal.addEventListener('abort',cancelled,{once:true});removeAbort=()=>controller.signal.removeEventListener('abort',cancelled);
            timer=setTimeout(()=>{reject(new ProtocolError('TIMEOUT','视觉分析超过原任务期限'));controller.abort();},Math.min(remaining,2_147_483_647));
            if(controller.signal.aborted)cancelled();
          });
          const result=await Promise.race([calls.run(context,()=>gateway.complete({...request,signal:controller.signal})),interrupted]);
          assertCall(context);return result;
        }finally{clearTimeout(timer);removeAbort();sourceSignal.removeEventListener('abort',abort);pending.delete(controller);controller.abort('Vision call closed');}
      }});
    },
    dispose(){if(disposed)return;disposed=true;revoke();value={...value,apiKey:''};},
  });
}
