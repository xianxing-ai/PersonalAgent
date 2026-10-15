import {ProtocolError} from '@personal-agent/contracts';

/** Test-only adapter. Image owns model URLs/keys; caller can select only advertised roles. */
export async function createTestImageModelProvider({url,token,modelRef='plan',reasoningEffort,signal,deadline,fetchImpl=fetch}) {
  const endpoint=new URL(url);
  if(endpoint.pathname!=='/invocations'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash
    ||!['http:','https:'].includes(endpoint.protocol)||!token)throw TypeError('Authenticated /invocations URL required');
  if(endpoint.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))throw TypeError('HTTP is restricted to loopback');
  async function invoke(value,requestSignal=signal,requestDeadline=deadline) {
    if(!Number.isFinite(Date.parse(requestDeadline))||Date.parse(requestDeadline)<=Date.now())throw new ProtocolError('TIMEOUT','Image request deadline expired');
    const combined=AbortSignal.any([...(requestSignal?[requestSignal]:[]),AbortSignal.timeout(Math.max(1,Date.parse(requestDeadline)-Date.now()))]);
    let response;
    try {response=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/json','x-pa-agent-token':'Bearer '+token},
      body:JSON.stringify({query:JSON.stringify(value)}),signal:combined});}
    catch {throw new ProtocolError(combined.aborted?'CANCELLED':'EXTERNAL_FAILURE','Image model transport failed');}
    if(!response.ok)throw new ProtocolError('EXTERNAL_FAILURE','Image model HTTP '+response.status);
    let envelope,payload;
    try {envelope=await response.json();payload=JSON.parse(envelope[0].data.text);}
    catch {throw new ProtocolError('EXTERNAL_FAILURE','Invalid image model envelope');}
    if(payload?.testVersion!==1)throw new ProtocolError('EXTERNAL_FAILURE','Unexpected image test version');
    return payload;
  }
  const capabilities=await invoke({testVersion:1,operation:'capabilities'});
  const advertised=capabilities.models?.find(item=>item.ref===modelRef);
  if(!advertised?.deployment)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Image model role is unavailable');
  return {deployment:structuredClone(advertised.deployment),complete:async request=>{
    const effort=request.reasoningEffort??reasoningEffort;
    const result=(await invoke({testVersion:1,operation:'model_turn',modelRef,messages:request.messages,
      ...(effort===undefined?{}:{reasoningEffort:effort}),
      ...(request.maxOutputTokens===undefined?{}:{maxOutputTokens:request.maxOutputTokens})},request.signal,request.deadline)).result;
    if(!result||result.response?.kind!=='final'||typeof result.response.text!=='string')throw new ProtocolError('EXTERNAL_FAILURE','Invalid image model result');
    return result;
  }};
}
