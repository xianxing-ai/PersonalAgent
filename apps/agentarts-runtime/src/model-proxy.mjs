import {ProtocolError} from '@personal-agent/contracts';
import {createStageTimeline} from './stage-timeline.mjs';
const bad=()=>{throw new ProtocolError('INVALID_ARGUMENT','Invalid trusted AgentArts model proxy configuration');};
const deniedHeaders=new Set(['host','content-length','connection','cookie','proxy-authorization','transfer-encoding']);
/** Reuses the existing text Provider/ModelGateway. Inbound gateway auth replaces backend Bearer auth. */
export function createAgentArtsModelFetch({endpoint,model,authentication,requestProfile='standard',fetch:request=globalThis.fetch,onRecord}={}) {
  let base;try{base=new URL(endpoint);}catch{bad();}
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname.replace(/\/$/u,'')!=='/inference/v1'
    ||typeof model!=='string'||!model.trim()||!['standard','deepseek-native-v1','bailian-deepseek-v1','huawei-openai-v1'].includes(requestProfile))bad();
  if(!authentication||!['api_key','iam'].includes(authentication.kind))bad();
  if(authentication.kind==='api_key'&&(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(authentication.headerName??'')
    ||deniedHeaders.has(authentication.headerName.toLowerCase())||typeof authentication.readSecret!=='function'
    ||!['','Bearer'].includes(authentication.keyPrefix??'')))bad();
  if(authentication.kind==='iam'&&typeof authentication.signRequest!=='function')bad();
  const target=base.href.replace(/\/$/u,'')+'/chat/completions';
  return async(input,init)=>{
    if(String(input)!==target||init?.method!=='POST'||typeof init.body!=='string'||!(init.signal instanceof AbortSignal))bad();
    init.signal.throwIfAborted();const payload=JSON.parse(init.body);
    if(payload.model!==model||payload.stream!==false)bad();
    if(requestProfile==='huawei-openai-v1'&&payload.reasoning_effort!==undefined) {
      // Platform StandardOpenAI backend protocol, not the separate native /v2 protocol.
      if(!['none','low','high','max'].includes(payload.reasoning_effort))throw new ProtocolError('UNSUPPORTED_CAPABILITY','This backend reasoning depth is unavailable');
      const thinking=payload.reasoning_effort!=='none';
      if(!thinking)delete payload.reasoning_effort;
      payload.chat_template_kwargs={...payload.chat_template_kwargs,thinking};
    }
    if(requestProfile==='deepseek-native-v1'&&payload.reasoning_effort!==undefined) {
      if(payload.reasoning_effort==='none'){delete payload.reasoning_effort;payload.thinking={type:'disabled'};}
      else payload.thinking={type:'enabled'};
    }
    if(requestProfile==='bailian-deepseek-v1'&&payload.reasoning_effort!==undefined) {
      payload.enable_thinking=payload.reasoning_effort!=='none';
      // Published DeepSeek V4.1 Flash effort aliases on the Bailian backend. Still requires live validation.
      if(payload.reasoning_effort==='none')delete payload.reasoning_effort;
      else {
        const effort={minimal:'low',low:'low',medium:'high',high:'high',xhigh:'high',max:'max',ultra:'max'}[payload.reasoning_effort];
        if(!effort)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Unknown provider reasoning effort');
        payload.reasoning_effort=effort;
      }
    }
    const encoded=JSON.stringify(payload),headers=new Headers(init.headers);headers.delete('authorization');headers.delete('x-auth-token');
    if(authentication.kind==='api_key') {
      const secret=await authentication.readSecret();
      if(typeof secret!=='string'||!secret.trim()||/[\r\n]/u.test(secret))throw new ProtocolError('UNAUTHORIZED','AgentArts gateway credential unavailable');
      headers.set(authentication.headerName,authentication.keyPrefix==='Bearer'?'Bearer '+secret:secret);
    } else {
      const signed=await authentication.signRequest({url:target,method:'POST',headers:Object.fromEntries(headers),body:encoded,signal:init.signal});
      if(!signed||typeof signed!=='object'||Array.isArray(signed))bad();
      for(const [name,value]of Object.entries(signed)) {
        if(deniedHeaders.has(name.toLowerCase())||typeof value!=='string'||/[\r\n]/u.test(value))bad();headers.set(name,value);
      }
      if(!headers.has('authorization'))throw new ProtocolError('UNAUTHORIZED','IAM request signature unavailable');
    }
    init.signal.throwIfAborted();const timeline=createStageTimeline({onRecord});
    return timeline.run('model.agentarts_proxy',async()=>{
      // No fallback origin, no redirect, no retry of an unknown paid request.
      const response=await request(target,{...init,headers,body:encoded,redirect:'error'});
      let responseModel=null;
      if(response.ok){try{const value=await response.clone().json();if(typeof value.model==='string'&&value.model.length<256)responseModel=value.model;}catch{/* Original Provider validates the body. */}}
      try{onRecord?.({event:'model_proxy_response',observedAtUtc:new Date().toISOString(),route:'agentarts_model_proxy',configuredModel:model,
        responseModel,httpStatus:response.status,requestId:response.headers.get('x-request-id')??response.headers.get('x-hw-request-id')??null,
        streaming:false,verification:'response_received_not_platform_trace_readback'});}catch{/* Telemetry is not task state. */}
      return response;
    },{modelRef:model});
  };
}
