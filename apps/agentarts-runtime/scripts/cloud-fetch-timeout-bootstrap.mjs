// Trusted startup bootstrap for the existing Node 24.15.0 image. No model/credential changes.
import {channel} from 'node:diagnostics_channel';
const safeCode = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : 'UNKNOWN';
export function safeFetchError(error) {
  return {event:'model_fetch_transport_error',name:safeCode(error?.name),code:safeCode(error?.code),causeCode:safeCode(error?.cause?.code)};
}
export function deadlineDispatcher(agent,timeoutMs) {
  if (!agent || typeof agent.dispatch !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw Error('Invalid trusted fetch dispatcher configuration');
  return {dispatch(options,handler) {
    return agent.dispatch({...options,headersTimeout:timeoutMs,bodyTimeout:timeoutMs},handler);
  }};
}
export async function installCloudFetchDeadline({environment=process.env,onError=record=>process.stderr.write(JSON.stringify(record)+'\n')}={}) {
  if (process.versions.node !== '24.15.0') throw Error('Trusted bootstrap requires Node 24.15.0');
  const timeoutMs=Number(environment.PA_AGENT_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw Error('Explicit trusted fetch timeout required');
  const origins=new Set();
  for (const [name,value] of Object.entries(environment)) {
    if (!/^PA_AGENT_(?:(?:FAST|WORLD|PLAN|REVIEW|EXECUTION)_)?(?:MODEL_)?BASE_URL$/.test(name)) continue;
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash) throw Error('Invalid trusted model origin');
    origins.add(url.origin);
  }
  if (!origins.size) throw Error('Explicit trusted model origin required');
  const original=globalThis.fetch;
  if(typeof original!=='function') throw Error('Native fetch unavailable');
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
    try{return await original(input,{...init,dispatcher});}
    catch(error){try{onError(safeFetchError(error));}catch{}throw error;}
  };
  return {timeoutMs,originCount:origins.size};
}
