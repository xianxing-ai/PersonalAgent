import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const origin='https://agentarts.cn-southwest-2.myhuaweicloud.com';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const fail=code=>{throw new ProtocolError(code,'AgentArts 原固定部署读回未获确认');};

/** Official ShowCoreRuntime + ShowCoreRuntimeEndpoint. The raw body may contain
 * environment credentials: only the explicit deployment projection leaves this reader. */
export async function readAgentArtsDeployment({runtimeId,runtimeName,endpointId,endpointName,version,imageReference,deadline,signal,
  authorize,assertCurrent,fetchImpl=fetch}={}) {
  if(!uuid(runtimeId)||!uuid(endpointId)||typeof runtimeName!=='string'||!/^[a-z][a-z0-9-]{0,46}[a-z0-9]$/u.test(runtimeName)
    ||typeof endpointName!=='string'||!/^[A-Za-z][A-Za-z0-9-]{0,46}[A-Za-z0-9]$/u.test(endpointName)||/^(latest|current|default)$/iu.test(endpointName)
    ||typeof version!=='string'||!/^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$/u.test(version)
    ||['latest','current','default'].includes(version)||typeof imageReference!=='string'
    ||!/^swr\.cn-southwest-2\.myhuaweicloud\.com\/[a-z0-9._-]+\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/u.test(imageReference)
    ||typeof authorize!=='function'||typeof assertCurrent!=='function'||!(signal instanceof AbortSignal))fail('INVALID_ARGUMENT');
  function active(){
    if(signal.aborted)fail('CANCELLED');const remaining=Date.parse(deadline)-Date.now();
    if(!Number.isFinite(remaining)||remaining<=0||remaining>2147483647)fail('TIMEOUT');
    const current=assertCurrent();if(current!==undefined){void Promise.resolve(current).catch(()=>{});fail('UNAUTHORIZED');}return remaining;
  }
  async function get(path){
    active();const url=origin+path,headers={Host:new URL(origin).hostname,'Content-Type':'application/json',Accept:'application/json'};
    let signed;try{signed=await authorize({method:'GET',url,body:'',headers,deadline,signal});}catch{fail('UNAUTHORIZED');}
    active();let normalized;try{normalized=new Headers(signed);}catch{fail('UNAUTHORIZED');}
    if(!/^SDK-HMAC-SHA256 Access=/.test(normalized.get('authorization')??'')
      ||!/^\d{8}T\d{6}Z$/.test(normalized.get('x-sdk-date')??'')
      ||Object.entries(headers).some(([name,value])=>normalized.get(name)!==value)
      ||[...normalized.keys()].some(name=>!['host','content-type','accept','authorization','x-sdk-date','x-security-token'].includes(name)))fail('UNAUTHORIZED');
    let response;try{response=await fetchImpl(url,{method:'GET',headers:signed,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(active())])});}
    catch{active();fail('EXTERNAL_FAILURE');}
    active();if(response.status!==200){await response.body?.cancel().catch(()=>{});fail(response.status===401?'UNAUTHORIZED':response.status===403?'SCOPE_DENIED':'EXTERNAL_FAILURE');}
    if(!response.headers.get('content-type')?.includes('application/json')){await response.body?.cancel().catch(()=>{});fail('PROTOCOL_MISMATCH');}
    const reader=response.body?.getReader();if(!reader)fail('PROTOCOL_MISMATCH');let bytes=0;const chunks=[];
    try{while(true){const part=await reader.read();active();if(part.done)break;bytes+=part.value.byteLength;
      if(bytes>1024*1024){await reader.cancel();fail('PROTOCOL_MISMATCH');}chunks.push(Buffer.from(part.value));}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch(error){if(error instanceof ProtocolError)throw error;active();fail('PROTOCOL_MISMATCH');}finally{reader.releaseLock();}
  }
  const runtimePath=`/v1/core/runtimes/${runtimeId}?version=${encodeURIComponent(version)}`;
  function runtimeProjection(value){
    if(value?.id!==runtimeId||value.name!==runtimeName||!['READY','DELETING'].includes(value.status)||value.arch!=='arm64'
      ||value.version_detail?.version!==version||value.version_detail.artifact_source?.url!==imageReference)fail('REVISION_CONFLICT');
    return {runtimeId,runtimeName:value.name,version,architecture:value.arch,imageReference,runtimeReady:value.status==='READY'};
  }
  const runtime=runtimeProjection(await get(runtimePath));
  function endpointProjection(endpoint){const weights=endpoint?.routing_config?.version_weights;
  if(endpoint?.runtime_id!==runtimeId||endpoint.id!==endpointId||endpoint.name!==endpointName||endpoint.target_version_name!==version
    ||weights!==undefined&&(!Array.isArray(weights)||!weights.length||new Set(weights.map(item=>item?.version_name)).size!==weights.length
      ||weights.some(item=>!item||typeof item.version_name!=='string'||!Number.isFinite(item.weight)||item.weight<0||item.weight>100
        ||item.version_name!==version&&item.weight!==0)||weights.filter(item=>item.version_name===version&&item.weight===100).length!==1))fail('REVISION_CONFLICT');
    return {endpointId,endpointName,version,weights};
  }
  const endpointPath=`/v1/core/runtimes/${runtimeId}/endpoints/${endpointId}`,endpoint=endpointProjection(await get(endpointPath));
  if(!isDeepStrictEqual(runtime,runtimeProjection(await get(runtimePath))))fail('REVISION_CONFLICT');active();
  if(!isDeepStrictEqual(endpoint,endpointProjection(await get(endpointPath))))fail('REVISION_CONFLICT');active();
  const result={...runtime,endpointId,endpointName,pinnedRouting:true,
    containerExecution:'unverified',readinessProbe:'unverified'};
  return {...result,digest:createHash('sha256').update(JSON.stringify(result)).digest('hex')};
}
