import {ProtocolError} from '@personal-agent/contracts';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {performance} from 'node:perf_hooks';

/** Bound the native image response before parsing, including streamed cloud responses. */
export async function readTestImageResponseText(response,limit=1_200_000) {
  if(!response.body?.getReader) {
    const text=JSON.stringify(await response.json());
    if(Buffer.byteLength(text)>limit)throw new ProtocolError('EXTERNAL_FAILURE','Image response limit exceeded');
    return text;
  }
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    while(true) {
      const item=await reader.read();if(item.done)break;
      size+=item.value.byteLength;if(size>limit)throw new ProtocolError('EXTERNAL_FAILURE','Image response limit exceeded');
      chunks.push(Buffer.from(item.value));
    }
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
function modelEnvelope(text,contentType) {
  try {
    let events;
    if(contentType?.split(';',1)[0].trim()==='text/event-stream') {
      const normalized=text.replaceAll('\r\n','\n');if(normalized.includes('\r'))throw Error();events=[];
      for(const frame of normalized.split('\n\n')) {
        if(!frame.trim())continue;
        let event;const data=[];
        for(const line of frame.split('\n')) {
          if(!line||line.startsWith(':'))continue;
          if(line.startsWith('event:'))event=line.slice(6).trim();
          else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));
          else if(!/^(?:id|retry):/.test(line))throw Error();
        }
        if(!data.length||data.join('\n')==='[DONE]')continue;
        const value=JSON.parse(data.join('\n'));
        for(const item of Array.isArray(value)?value:[value])events.push(item.event===undefined&&event?{...item,event}:item);
      }
    }else events=JSON.parse(text);
    if(!Array.isArray(events))throw Error();
    let state='open';const parts=[],indexed=new Map();
    for(const item of events) {
      if(!item||typeof item.event!=='string'||item.event==='error'||item.data?.error_code!==undefined)throw Error();
      if(item.event==='message') {
        if(state!=='open'||!item.data||item.data.text!==null&&typeof item.data.text!=='string')throw Error();
        if(item.data.text===null)continue;
        if(item.data.index===undefined)parts.push(item.data.text);
        else {
          if(!Number.isSafeInteger(item.data.index)||item.data.index<0||indexed.has(item.data.index)&&indexed.get(item.data.index)!==item.data.text)throw Error();
          indexed.set(item.data.index,item.data.text);
        }
      }else if(item.event==='task_end'){if(state!=='open')throw Error();state='task-ended';}
      else if(item.event==='end'){if(state!=='task-ended')throw Error();state='ended';}
    }
    if(state!=='ended'||indexed.size&&parts.length)throw Error();
    const fragments=indexed.size?[...indexed].sort((a,b)=>a[0]-b[0]).map(([index,value],i)=>{if(index!==i)throw Error();return value;}):parts;
    const payload=JSON.parse(fragments.join(''));if(payload?.testVersion!==1)throw Error();return payload;
  }catch{throw new ProtocolError('EXTERNAL_FAILURE','Invalid image model envelope');}
}

/** Test-only adapter. Image owns model URLs/keys; caller can select only advertised roles. */
export async function createTestImageModelProvider({url,token,inboundAuthorization,modelRef='plan',reasoningEffort,signal,deadline,
  sessionId='teacher-'+randomUUID(),invokeMode='published',onRecord=()=>{},fetchImpl=fetch}) {
  const endpoint=new URL(url);
  const cloud=/^\/runtimes\/[A-Za-z0-9_-]{1,128}\/invocations$/.test(endpoint.pathname);
  const versions=endpoint.searchParams.getAll('endpoint'),version=versions[0]??null;
  if(endpoint.pathname!=='/invocations'&&!cloud||endpoint.username||endpoint.password||endpoint.hash
    ||!['http:','https:'].includes(endpoint.protocol)||typeof token!=='string'||!token||/\s/.test(token)
    ||[...endpoint.searchParams.keys()].some(key=>key!=='endpoint')||versions.length>1
    ||versions.length&&!/^[A-Za-z0-9_.-]{1,128}$/.test(version)
    ||cloud&&(endpoint.protocol!=='https:'||!version||!inboundAuthorization)
    ||inboundAuthorization!==undefined&&!/^Bearer [\x21-\x7e]+$/.test(inboundAuthorization)
    ||!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)||!['published','debug'].includes(invokeMode))throw TypeError('Authenticated /invocations URL required');
  if(endpoint.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))throw TypeError('HTTP is restricted to loopback');
  async function invoke(value,requestSignal=signal,requestDeadline=deadline) {
    const expires=Math.min(Date.parse(deadline),Date.parse(requestDeadline));
    const active=()=>{
      if(signal?.aborted||requestSignal?.aborted)throw new ProtocolError('CANCELLED','Image model request cancelled');
      if(!Number.isFinite(expires)||expires<=Date.now())throw new ProtocolError('TIMEOUT','Image request deadline expired');
    };active();
    const combined=AbortSignal.any([...[signal,requestSignal].filter(Boolean),AbortSignal.timeout(Math.max(1,expires-Date.now()))]);
    const record={surface:'auxiliary_test_version_model',operation:value.operation,modelRef:value.modelRef??null,
      requestId:'teacher-'+randomUUID(),sessionId,requestedVersion:version,startedAt:new Date().toISOString(),status:'sent_or_unknown'};
    const started=performance.now();onRecord(structuredClone(record));
    try {
      const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json',accept:'application/json,text/event-stream',
        'x-pa-agent-token':'Bearer '+token,...(inboundAuthorization?{authorization:inboundAuthorization}:{}),
        'x-hw-agentarts-session-id':sessionId,'x-request-id':record.requestId,'x-pa-deadline':new Date(expires).toISOString(),'x-invoke-mode':invokeMode},
        body:JSON.stringify({query:JSON.stringify(value)}),signal:combined});
      active();record.httpStatus=response.status;
      if(!response.ok)throw new ProtocolError('EXTERNAL_FAILURE','Image model HTTP '+response.status);
      const text=await readTestImageResponseText(response);active();
      const payload=modelEnvelope(text,response.headers?.get('content-type'));record.status='returned';return payload;
    }catch(error){
      record.status='failed_or_unknown';record.errorCode=error instanceof ProtocolError?error.code:'EXTERNAL_FAILURE';
      active();if(error instanceof ProtocolError)throw error;
      throw new ProtocolError('EXTERNAL_FAILURE','Image model transport failed');
    }finally{record.finishedAt=new Date().toISOString();record.wallMs=performance.now()-started;onRecord(structuredClone(record));}
  }
  const capabilities=await invoke({testVersion:1,operation:'capabilities'});
  const advertised=capabilities.models?.find(item=>item.ref===modelRef);
  if(!advertised?.deployment)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Image model role is unavailable');
  return {deployment:structuredClone(advertised.deployment),complete:async request=>{
    if(request.tools?.length)throw new ProtocolError('INVALID_ARGUMENT','Image teacher accepts text-only model requests');
    const effort=request.reasoningEffort??reasoningEffort;
    const result=(await invoke({testVersion:1,operation:'model_turn',modelRef,messages:request.messages,
      ...(effort===undefined?{}:{reasoningEffort:effort}),
      ...(request.maxOutputTokens===undefined?{}:{maxOutputTokens:request.maxOutputTokens})},request.signal,request.deadline)).result;
    if(!result||result.response?.kind!=='final'||typeof result.response.text!=='string'
      ||!isDeepStrictEqual(result.deployment,advertised.deployment))throw new ProtocolError('EXTERNAL_FAILURE','Invalid image model result');
    return result;
  }};
}
