import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {parseWikiWorkflowRequest,parseWikiWorkflowResult} from '@personal-agent/contracts/wiki-workflow';
import type {WikiWorkflowRequest} from '@personal-agent/contracts/wiki-workflow';
import {AgentArtsWebSocketTransport,parseAgentArtsResponseText} from '@personal-agent/coordination';
import type {AgentArtsAuthorizationProvider} from '@personal-agent/coordination';
import type {RuntimeOwnedWorkflowImageOptions} from './owned-workflow-image-adapter.js';
import type {RuntimeWikiModel} from './wiki-import.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Original AgentArts transport, credentials and deadline. No direct-provider or Local fallback. */
export function createAgentArtsWikiModel(options:RuntimeOwnedWorkflowImageOptions):RuntimeWikiModel&{close():void} {
  const gateway=new URL(options.gatewayUrl);
  if(gateway.protocol!=='https:'||gateway.username||gateway.password||gateway.search||gateway.hash||gateway.pathname!=='/'
    ||!/^[A-Za-z0-9_-]{1,64}$/.test(options.runtimeName))throw new ProtocolError('INVALID_ARGUMENT','Invalid Wiki AgentArts target');
  const available=typeof options.deploymentVersion==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(options.deploymentVersion)
    &&! /^(latest|current|default)$/i.test(options.deploymentVersion);
  const endpoint=gateway.origin+'/runtimes/'+encodeURIComponent(options.runtimeName)+'/invocations'
    +(available?'?endpoint='+encodeURIComponent(options.deploymentVersion!):'');
  if(options.transport==='wss'&&options.websocketUrl){
    const url=new URL(options.websocketUrl);
    if(url.protocol!=='wss:'||url.host!==gateway.host||url.username||url.password||url.hash
      ||!['/ws',`/runtimes/${options.runtimeName}/ws`,`/runtimes/${options.runtimeName}/invocations/ws`].includes(url.pathname)
      ||[...url.searchParams].some(([key,value])=>key!=='endpoint'||value!==options.deploymentVersion))
      throw new ProtocolError('INVALID_ARGUMENT','Wiki WSS target differs from the selected deployment');
  }
  const socket=options.transport==='wss'&&options.websocketUrl
    ?new AgentArtsWebSocketTransport(options.websocketUrl,options.websocketFactory,options.onTransportState):undefined;
  const fingerprint=hash({wikiVersion:1,gateway:gateway.origin,runtime:options.runtimeName,
    deployment:options.deploymentVersion??null,transport:options.transport??'https'});
  const read=async(provider:AgentArtsAuthorizationProvider,signal:AbortSignal)=>{
    const value=await provider.read(signal);
    if(typeof value!=='string'||!value.trim()||/[\u0000-\u001f\u007f]/.test(value))throw new ProtocolError('UNAUTHORIZED','Wiki transport credential unavailable');
    return value;
  };
  return {available,fingerprint,label:`AgentArts · ${options.runtimeName} · ${options.deploymentVersion??'未固定版本'}`,
    ...(!available?{reason:'请先配置已包含 Wiki 工作流的固定 AgentArts 部署版本'}:{}),close:()=>socket?.close(),
    async invoke(request,context){
      if(!available)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Wiki requires a fixed AgentArts deployment');
      const controller=new AbortController(),deadline=new Date(Math.min(Date.parse(context.deadline),Date.now()+180_000)).toISOString();
      const signal=AbortSignal.any([context.signal,controller.signal]);
      const timer=setTimeout(()=>controller.abort(),Math.max(1,Date.parse(deadline)-Date.now()));
      const active=()=>{
        context.assertCurrent();options.assertDeploymentBinding?.();
        if(signal.aborted)throw new ProtocolError(context.signal.aborted?'CANCELLED':'TIMEOUT','Wiki model stage stopped');
        if(Date.now()>=Date.parse(deadline))throw new ProtocolError('TIMEOUT','Wiki model stage expired');
      };
      try{
        active();
        const data={stage:request.stage,system:request.system,
          input:JSON.stringify({treatment:'untrusted_source_data',data:JSON.parse(request.input),outputSchema:request.outputSchema}),
          maxOutputCharacters:request.maxOutputCharacters,maxOutputTokens:Math.min(16_384,request.maxOutputCharacters)};
        const value:WikiWorkflowRequest={wikiVersion:1,operation:'compile',requestId:request.requestId,inputDigest:hash(data),...data};
        parseWikiWorkflowRequest(value);
        const authorization=await read(options.authorizationProvider,signal);active();
        const hostAuthorization=options.websocketAuthorizationProvider?await read(options.websocketAuthorizationProvider,signal):undefined;active();
        const query=JSON.stringify(value),body=JSON.stringify(options.workflowGoalInput?{inputs:{[options.workflowGoalInput]:query}}:{query});
        if(Buffer.byteLength(body)>1_200_000)throw new ProtocolError('INVALID_ARGUMENT','Wiki stage exceeds transport size');
        const headers={'Content-Type':'application/json',Accept:'application/json,text/event-stream',Authorization:authorization,
          'X-Request-Id':request.requestId,'x-hw-agentarts-session-id':'wiki-'+request.requestId.slice(0,48),
          'X-PA-Deadline':deadline,'X-Invoke-Mode':options.invokeMode??'published'};
        const init={method:'POST' as const,body,signal,redirect:'error' as const,
          headers:{...headers,...(hostAuthorization?{'X-PA-Agent-Token':hostAuthorization}:{})}};
        let response;
        if(options.transport==='wss'){
          if(!socket)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Wiki WSS transport unavailable');
          response=await socket.invoke(init,{beforeSend:active,afterAccepted:()=>{},afterTerminal:()=>{}});
        }else{
          active();response=await (options.fetchImpl??fetch)(endpoint,
            options.fetchHandlesHostAuthorization?{...init,headers}:init);
        }
        active();
        if(response.status!==200)throw new ProtocolError(response.status===401||response.status===403?'UNAUTHORIZED':
          response.status===503?'UNSUPPORTED_CAPABILITY':'EXTERNAL_FAILURE','AgentArts Wiki workflow rejected this stage');
        const content=await parseAgentArtsResponseText(response,{signal,deadline,strictCompletion:true,maxResponseBytes:1_200_000,maxTextChars:300_000});
        active();let parsed:unknown;
        try{parsed=JSON.parse(content);}catch{throw new ProtocolError('PROTOCOL_MISMATCH','Malformed Wiki workflow response');}
        const result=parseWikiWorkflowResult(parsed,value);
        return {output:result.output,...(result.usage?{usage:result.usage}:{})};
      }finally{clearTimeout(timer);}
    }};
}
