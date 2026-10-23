// Trusted startup bootstrap for the existing Node 24.15.0 image. No model/credential changes.
import {channel} from 'node:diagnostics_channel';
const safeCode = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : 'UNKNOWN';
const invalid=()=>{throw Error('Invalid bootstrap configuration');};
export function safeFetchError(error) {
  return {event:'model_fetch_transport_error',name:safeCode(error?.name),code:safeCode(error?.code),causeCode:safeCode(error?.cause?.code)};
}
export function safeResponseShape(response,value) {
  const choice=value?.choices?.[0],message=choice?.message;
  const shape=value=>({type:value===null?'null':Array.isArray(value)?'array':typeof value,length:typeof value==='string'?value.length:null});
  const usage={};
  for(const key of ['prompt_tokens','completion_tokens','total_tokens']) {
    const count=value?.usage?.[key];if(Number.isSafeInteger(count)&&count>=0)usage[key]=count;
  }
  const count=value?.usage?.completion_tokens_details?.reasoning_tokens;
  if(Number.isSafeInteger(count)&&count>=0)usage.reasoning_tokens=count;
  return {event:'model_response_shape',httpStatus:response.status,requestId:safeCode(response.headers.get('x-request-id')??response.headers.get('x-hw-request-id')),
    choicesCount:Array.isArray(value?.choices)?value.choices.length:null,
    finishReason:['stop','length','tool_calls','function_call','content_filter'].includes(choice?.finish_reason)?choice.finish_reason:'unknown',
    content:shape(message?.content),reasoningContent:shape(message?.reasoning_content),usage};
}
export function deadlineDispatcher(agent,timeoutMs) {
  if (!agent || typeof agent.dispatch !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    invalid();
  return {dispatch(options,handler) {
    return agent.dispatch({...options,headersTimeout:timeoutMs,bodyTimeout:timeoutMs},handler);
  }};
}
export async function installCloudFetchDeadline({environment=process.env,onError=record=>process.stderr.write(JSON.stringify(record)+'\n'),onShape=record=>process.stdout.write(JSON.stringify(record)+'\n')}={}) {
  if (process.versions.node !== '24.15.0') invalid();
  const timeoutMs=Number(environment.PA_AGENT_TIMEOUT_MS);
  const origins=new Set();
  for (const [name,value] of Object.entries(environment)) {
    if (!/^PA_AGENT_(?:(?:FAST|WORLD|PLAN|REVIEW|EXECUTION)_)?(?:MODEL_)?BASE_URL$/.test(name)) continue;
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash) invalid();
    origins.add(url.origin);
  }
  if (!origins.size) invalid();
  const original=globalThis.fetch;
  // A data URL initializes Node's bundled Undici without making a network request.
  await original('data:text/plain,bootstrap');
  const agent=globalThis[Symbol.for('undici.globalDispatcher.1')];
  const dispatcher=deadlineDispatcher(agent,timeoutMs);
  // Includes errors while reading a response body, after fetch() has returned its headers.
  channel('undici:request:error').subscribe(({request,error})=>{
    try {
      if(origins.has(new URL(request.origin).origin)&&request.path.split('?')[0].endsWith('/chat/completions'))onError(safeFetchError(error));
    } catch {}
  });
  globalThis.fetch=async function(input,init) {
    const target=new URL(input instanceof Request ? input.url : String(input));
    const method=String(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    const modelRequest=target.protocol==='https:'&&origins.has(target.origin)&&method==='POST'&&target.pathname.endsWith('/chat/completions');
    if(!modelRequest)return original(input,init);
    // Signal, TLS, redirect, headers and body remain exactly those supplied by the existing provider.
    try{
      const response=await original(input,{...init,dispatcher});
      try{onShape(safeResponseShape(response,await response.clone().json()));}catch{}
      return response;
    }
    catch(error){try{onError(safeFetchError(error));}catch{}throw error;}
  };
  return {timeoutMs,originCount:origins.size};
}
