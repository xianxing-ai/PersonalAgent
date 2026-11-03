import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {parseAgentArtsResponseText} from '@personal-agent/coordination';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Same fixed Desktop deployment and credential adapter as the original workflow transport. */
export async function invokeF23PairedEvaluation({configuration,input,context,assertCurrent}){
  const binding=configuration.binding(),transport=configuration.transportConfig(binding),options=configuration.readTransportOptions(binding);
  if(!options.deploymentVersion)throw new ProtocolError('UNSUPPORTED_CAPABILITY','F23 requires a fixed deployment');
  const current=()=>{assertCurrent();if(!isDeepStrictEqual(options,configuration.readTransportOptions(binding)))
    throw new ProtocolError('REVISION_CONFLICT','Original F23 transport changed');};
  current();const requestId=context.runId,sessionId=randomUUID(),body=JSON.stringify({query:JSON.stringify(input)}),startedAt=new Date().toISOString();
  const destination=binding.gatewayUrl+'/runtimes/'+encodeURIComponent(binding.runtimeName)+'/invocations?endpoint='+encodeURIComponent(options.deploymentVersion),
    signal=AbortSignal.any([context.signal,AbortSignal.timeout(Math.max(1,Date.parse(context.deadline)-Date.now()))]);
  const lease=await transport.preparePayload?.({requestId,destination,payload:body,deadline:context.deadline,signal,isCurrent:()=>{current();return true;}});
  current();lease?.assertBeforeSend({destination,payload:body});
  const response=await transport.fetchImpl(destination,{
    method:'POST',redirect:'error',signal,
    headers:{Authorization:configuration.readAuthorization(binding,transport),'Content-Type':'application/json','X-Request-Id':requestId,
      'x-hw-agentarts-session-id':sessionId,'X-Invoke-Mode':'published','X-PA-Deadline':context.deadline},body});
  current();if(response.status!==200){await response.body?.cancel().catch(()=>{});throw new ProtocolError('EXTERNAL_FAILURE','Original F23 invocation not confirmed');}
  const text=await parseAgentArtsResponseText(response,{signal:context.signal,deadline:context.deadline,strictCompletion:true,maxResponseBytes:1100000,maxTextChars:1000000});
  let result;try{result=JSON.parse(text);}catch{throw new ProtocolError('PROTOCOL_MISMATCH','Invalid F23 result');}current();
  if(result?.evaluationVersion!==1||result.requestId!==requestId||result.sessionId!==sessionId||result.inputDigest!==hash(input))
    throw new ProtocolError('REVISION_CONFLICT','F23 original response binding changed');
  return {deployment:{...binding,version:options.deploymentVersion},requestId,sessionId,startedAt,finishedAt:new Date().toISOString(),result};
}
