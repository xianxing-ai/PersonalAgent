import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {deriveOwnedWorkflowKeys} from '@personal-agent/agentarts';
import type {OwnedWorkflowAdvanceRequest,OwnedWorkflowAdvanceResult} from '@personal-agent/agentarts';
import {AgentArtsWebSocketTransport,parseAgentArtsResponseText} from '@personal-agent/coordination';
import type {AgentArtsAuthorizationProvider,AgentArtsFetch,AgentArtsWebSocketFactory,AgentArtsTransportState} from '@personal-agent/coordination';
import type {RuntimeCodingRepairImagePort} from './coding-repair-application.js';
export interface RuntimeOwnedWorkflowImageOptions {
  gatewayUrl:string;runtimeName:string;deploymentVersion?:string;transport?:'https'|'wss';websocketUrl?:string;
  allowHttpsFallback?:boolean;authorizationProvider:AgentArtsAuthorizationProvider;websocketAuthorizationProvider?:AgentArtsAuthorizationProvider;
  /** Only the original trusted Desktop HTTP wrapper may inject the host credential itself. */
  fetchHandlesHostAuthorization?:true;
  websocketFactory?:AgentArtsWebSocketFactory;fetchImpl?:AgentArtsFetch;invokeMode?:'debug'|'published';workflowGoalInput?:string;
  assertDeploymentBinding?:()=>void;onTransportState?:(state:AgentArtsTransportState)=>void;
  /** Host-only compatibility for a deployed explicit key override. No Renderer configuration. */
  readReceiptSecret?:(signal:AbortSignal)=>Promise<string>;
}
/** Same original AgentArts target/credentials and public transports as normal tasks. */
export function createRuntimeOwnedWorkflowImageAdapter(options:RuntimeOwnedWorkflowImageOptions):RuntimeCodingRepairImagePort&{close():void} {
  let gateway:URL;try{gateway=new URL(options.gatewayUrl);}catch{throw new ProtocolError('INVALID_ARGUMENT','Invalid owned-workflow AgentArts gateway');}
  if(gateway.protocol!=='https:'||gateway.username||gateway.password||gateway.search||gateway.hash||gateway.pathname!=='/'
    ||!/^[A-Za-z0-9_-]{1,64}$/.test(options.runtimeName)||options.deploymentVersion!==undefined&&!/^[A-Za-z0-9_.-]{1,128}$/.test(options.deploymentVersion))
    throw new ProtocolError('INVALID_ARGUMENT','Invalid fixed owned-workflow AgentArts deployment');
  const destination=gateway.origin+'/runtimes/'+encodeURIComponent(options.runtimeName)+'/invocations';
  const endpoint=destination+(options.deploymentVersion===undefined?'':'?endpoint='+encodeURIComponent(options.deploymentVersion));
  if(options.transport==='wss'&&options.websocketUrl) {
    const address=new URL(options.websocketUrl);
    if(address.protocol!=='wss:'||address.origin!=='wss://'+gateway.host||address.username||address.password||address.hash
      ||!['/ws','/runtimes/'+encodeURIComponent(options.runtimeName)+'/ws','/runtimes/'+encodeURIComponent(options.runtimeName)+'/invocations/ws'].includes(address.pathname)
      ||[...address.searchParams].length!==(options.deploymentVersion===undefined?0:1)
      ||options.deploymentVersion!==undefined&&address.searchParams.get('endpoint')!==options.deploymentVersion)
      throw new ProtocolError('REVISION_CONFLICT','Owned-workflow WSS must retain the same fixed deployment');
  }
  const ws=options.transport==='wss'&&options.websocketUrl?new AgentArtsWebSocketTransport(options.websocketUrl,options.websocketFactory,options.onTransportState):undefined;
  const bindingId=createHash('sha256').update(JSON.stringify({gatewayUrl:gateway.origin,runtimeName:options.runtimeName,version:options.deploymentVersion??null,
    transport:options.transport??'https',websocketUrl:options.websocketUrl??null,invokeMode:options.invokeMode??'published',workflowGoalInput:options.workflowGoalInput??null})).digest('hex');
  const active=(request:OwnedWorkflowAdvanceRequest)=>{
    if(!(request.signal instanceof AbortSignal)||!Number.isFinite(Date.parse(request.deadline))
      ||!Number.isFinite(Date.parse(request.taskDeadline??request.deadline)))throw new ProtocolError('INVALID_ARGUMENT','Invalid owned-workflow invocation lifetime');
    options.assertDeploymentBinding?.();if(request.signal.aborted)throw new ProtocolError('CANCELLED','Original graph request cancelled');
    if(Date.now()>=Math.min(Date.parse(request.deadline),Date.parse(request.taskDeadline??request.deadline)))throw new ProtocolError('TIMEOUT','Original graph deadline expired');};
  const read=async(provider:AgentArtsAuthorizationProvider,signal:AbortSignal)=>{const value=await provider.read(signal);
    if(typeof value!=='string'||!value.trim()||/[\u0000-\u001f\u007f]/.test(value))throw new ProtocolError('UNAUTHORIZED','Owned-workflow credential unavailable');return value;};
  return {bindingId,receiptSecret:async signal=>{
    if(options.readReceiptSecret)return options.readReceiptSecret(signal);
    if(!options.websocketAuthorizationProvider)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Owned-workflow host receipt identity unavailable');
    const authorization=await read(options.websocketAuthorizationProvider,signal);
    if(!/^Bearer [\x21-\x7e]+$/.test(authorization))throw new ProtocolError('UNAUTHORIZED','Owned-workflow host credential unavailable');
    const secret=deriveOwnedWorkflowKeys({transportToken:authorization.slice(7)}).receiptSecret;
    if(!secret)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Owned-workflow receipt identity unavailable');return secret;
  },close:()=>ws?.close(),advance:async request=>{
    active(request);
    const auth=await read(options.authorizationProvider,request.signal),hostAuth=options.websocketAuthorizationProvider?await read(options.websocketAuthorizationProvider,request.signal):undefined;
    active(request);
    const {signal:ignored,deadline:_deadline,requestId:_requestId,sessionId:_sessionId,resultFits:_resultFits,...data}=request;
    const query=JSON.stringify({workflowVersion:'1.0.0',operation:'advance',...data});
    const body=JSON.stringify(options.workflowGoalInput?{inputs:{[options.workflowGoalInput]:query}}:{query});
    if(Buffer.byteLength(query)>1_100_000)throw new ProtocolError('INVALID_ARGUMENT','Owned-workflow request exceeds original image capacity');
    const init={method:'POST' as const,headers:{'Content-Type':'application/json',Accept:'application/json,text/event-stream',Authorization:auth,
      'x-hw-agentarts-session-id':request.sessionId,'X-Request-Id':request.requestId,'X-PA-Deadline':request.deadline,
      'X-Invoke-Mode':options.invokeMode??'published',...(hostAuth?{'X-PA-Agent-Token':hostAuth}:{})},body,signal:request.signal,redirect:'error' as const};
    const httpInit=options.fetchHandlesHostAuthorization?{...init,headers:{'Content-Type':'application/json',Accept:'application/json,text/event-stream',Authorization:auth,
      'x-hw-agentarts-session-id':request.sessionId,'X-Request-Id':request.requestId,'X-PA-Deadline':request.deadline,'X-Invoke-Mode':options.invokeMode??'published'}}:init;
    let response;
    if(options.transport==='wss') {
      if(!ws)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original owned-workflow WSS endpoint unavailable');
      try {response=await ws.invoke(init,{beforeSend:()=>active(request),afterAccepted:()=>{},afterTerminal:()=>{}});}
      catch(error) {
        if(!options.allowHttpsFallback||!ws.canFallback(error))throw error;
        active(request);ws.reportFallback(request.sessionId,request.requestId);
        response=await (options.fetchImpl??fetch)(endpoint,httpInit);
      }
    }else response=await (options.fetchImpl??fetch)(endpoint,httpInit);
    active(request);
    if(response.status!==200)throw new ProtocolError(response.status===401||response.status===403?'UNAUTHORIZED':'EXTERNAL_FAILURE','Owned-workflow AgentArts invocation rejected');
    const text=await parseAgentArtsResponseText(response,{signal:request.signal,deadline:request.deadline,strictCompletion:true,
      maxResponseBytes:1_200_000,maxTextChars:1_200_000});
    active(request);let value:unknown;try{value=JSON.parse(text);}catch{throw new ProtocolError('PROTOCOL_MISMATCH','Malformed owned-workflow image result');}
    if(!value||typeof value!=='object'||Array.isArray(value))throw new ProtocolError('PROTOCOL_MISMATCH','Invalid owned-workflow image result');
    return value as OwnedWorkflowAdvanceResult;
  }};
}
