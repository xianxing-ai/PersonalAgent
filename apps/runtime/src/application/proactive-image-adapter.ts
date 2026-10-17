import {ProtocolError} from '@personal-agent/contracts';
import {createProactiveHostProofs,proactiveWorkflowDigest} from '@personal-agent/agentarts';
import type {ProactiveAdvanceRequest,ProactiveWorkflowResult} from '@personal-agent/agentarts';
import type {AgentArtsRuntimeConfig,AgentArtsAuthorizationProvider,AgentArtsFetch,AgentArtsResponse} from '@personal-agent/coordination';

export interface RuntimeProactiveImageAdapterOptions {
  /** Original trusted AgentArts transport configuration; never read from a model/event/Renderer request. */
  config?:AgentArtsRuntimeConfig & {deploymentVersion?:string};
  /** Trusted composition rejects configuration changes before any credentials/send. */
  assertDeploymentBinding?:()=>void;
  /** Explicit startup endpoint, mutually exclusive with config. HTTP is restricted to loopback fixtures. */
  endpoint?:string;
  authorizationProvider:AgentArtsAuthorizationProvider;
  hostAuthorizationProvider?:AgentArtsAuthorizationProvider;
  receiptSecret:string;invokeMode?:'debug'|'published';workflowGoalInput?:string;fetchImpl?:AgentArtsFetch;
}
export type RuntimeProactiveImageResult=ProactiveWorkflowResult&{proactiveVersion:1;requestId:string;proof:string};
export type RuntimeProactiveImageContext=Pick<ProactiveAdvanceRequest,'taskId'|'sessionId'|'controlRevision'|'taskDeadline'|'requestId'|'deadline'|'signal'>;
export interface RuntimeProactiveImageDescription {
  proactiveVersion:1;verification:'unverified';descriptor:Record<string,unknown>;adapters:readonly Record<string,unknown>[];
  contracts:readonly {id:string;version:string;qualifiedForMain:boolean}[];
}
const MAX_BYTES=1_200_000; // Existing image HTTP envelope limit, not an execution/token budget.
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:unknown,required:readonly string[],optional:readonly string[]=[])=>plain(value)
  &&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>[...required,...optional].includes(key));
class ProactiveImageTransportError extends ProtocolError {}
const fail=(code:string,message:string):never=>{throw new ProactiveImageTransportError(code,message);};
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/u.test(value);
function endpointOf(options:RuntimeProactiveImageAdapterOptions):string {
  if(Boolean(options.config)===Boolean(options.endpoint))fail('INVALID_ARGUMENT','One trusted AgentArts configuration or endpoint required');
  let value=options.endpoint;
  if(options.config) {
    const config=options.config;let gateway:URL;
    try {gateway=new URL(config.gatewayUrl);}catch {return fail('INVALID_ARGUMENT','Invalid trusted AgentArts gateway');}
    if(gateway.protocol!=='https:'||gateway.username||gateway.password||gateway.search||gateway.hash||!['','/'].includes(gateway.pathname)
      ||!/^[A-Za-z0-9_-]{1,64}$/u.test(config.runtimeName))fail('INVALID_ARGUMENT','Invalid trusted AgentArts gateway/runtime');
    value=gateway.origin+'/runtimes/'+encodeURIComponent(config.runtimeName)+'/invocations';
    let version=config.deploymentVersion;
    if(config.websocketUrl!==undefined){
      let websocket:URL;try{websocket=new URL(config.websocketUrl);}catch{return fail('INVALID_ARGUMENT','Invalid bound proactive WSS endpoint');}
      if(websocket.protocol!=='wss:'||websocket.username||websocket.password||websocket.hash
        ||websocket.origin.replace(/^wss:/u,'https:')!==gateway.origin
        ||![`/runtimes/${config.runtimeName}/ws`,`/runtimes/${config.runtimeName}/invocations/ws`].includes(websocket.pathname)
        ||websocket.search&&!/^\?endpoint=[A-Za-z0-9_.-]{1,128}$/u.test(websocket.search))fail('INVALID_ARGUMENT','Invalid bound proactive WSS endpoint');
      const selected=websocket.searchParams.get('endpoint')??undefined;
      if(version!==undefined&&selected!==undefined&&version!==selected)fail('INVALID_ARGUMENT','Proactive deployment version mismatch');
      version??=selected;
    }
    if(version!==undefined){
      if(typeof version!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/u.test(version))fail('INVALID_ARGUMENT','Invalid proactive deployment version');
      value+='?endpoint='+version;
    }
  }
  let url:URL;
  try {url=new URL(value!);}catch {return fail('INVALID_ARGUMENT','Invalid trusted proactive endpoint');}
  if(value!==value?.trim()||/[\s\\]/u.test(value!)||url.username||url.password||url.hash
    ||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(url.hostname))
    ||!/^\/(?:runtimes\/[A-Za-z0-9_-]{1,64}\/)?invocations$/u.test(url.pathname)
    ||url.search&&([...url.searchParams].length!==1||!url.searchParams.has('endpoint')||!/^[A-Za-z0-9_.-]{1,128}$/u.test(url.searchParams.get('endpoint')!)))
    fail('INVALID_ARGUMENT','Invalid trusted proactive endpoint');
  return url.href;
}
function eventsFrom(payload:string,contentType:string|undefined):unknown[] {
  const parse=(text:string):unknown=>{try{return JSON.parse(text);}catch{return fail('PROTOCOL_MISMATCH','Malformed proactive image event JSON');}};
  const media=contentType?.split(';',1)[0]?.trim().toLowerCase();
  if(media==='application/json') {const events=parse(payload);if(!Array.isArray(events))fail('PROTOCOL_MISMATCH','Proactive image event array required');return events as unknown[];}
  if(media!=='text/event-stream')return fail('PROTOCOL_MISMATCH','Unsupported proactive image response content type');
  const values:unknown[]=[];let data:string[]=[],done=false;
  const flush=()=>{
    if(!data.length)return;
    const text=data.join('\n');data=[];
    if(text.trim()==='[DONE]'){done=true;return;}
    if(done)fail('PROTOCOL_MISMATCH','Proactive image event after stream terminator');
    let parsed:unknown;
    try {parsed=JSON.parse(text);}catch {
      // Existing AgentArts compatibility: one complete JSON event per data line without blank separators.
      const lines=text.split('\n');if(lines.length<2)fail('PROTOCOL_MISMATCH','Malformed proactive image SSE');
      for(const line of lines){const item=parse(line);values.push(...(Array.isArray(item)?item:[item]));}return;
    }
    values.push(...(Array.isArray(parsed)?parsed:[parsed]));
  };
  for(const line of payload.split(/\r\n|\n|\r/u)) {
    if(!line){flush();continue;}if(line.startsWith(':'))continue;
    if(done||!line.startsWith('data:'))fail('PROTOCOL_MISMATCH','Malformed proactive image SSE');
    data.push(line.slice(5).replace(/^ /u,''));
  }
  flush();return values;
}
function resultFromEvents(events:unknown[]):unknown {
  let text='',taskEnd=false,end=false,messages=0;
  for(const event of events) {
    if(!plain(event))return fail('PROTOCOL_MISMATCH','Invalid proactive image event shape');
    if(typeof event.event!=='string'||end)fail('PROTOCOL_MISMATCH','Invalid proactive image event order');
    if(event.event==='message') {
      if(taskEnd||!exact(event,['event','data'])||!plain(event.data)||!exact(event.data,['text'])||typeof event.data.text!=='string')
        fail('PROTOCOL_MISMATCH','Invalid proactive image message');
      text+=(event.data as {text:string}).text;messages++;
    }else if(event.event==='task_end') {
      if(taskEnd||!messages||!exact(event,['event']))fail('PROTOCOL_MISMATCH','Invalid proactive image task completion');taskEnd=true;
    }else if(event.event==='end') {
      if(!taskEnd||!exact(event,['event']))fail('PROTOCOL_MISMATCH','Incomplete proactive image event stream');end=true;
    }else fail('PROTOCOL_MISMATCH','Unexpected proactive image event');
  }
  if(!messages||!taskEnd||!end)fail('PROTOCOL_MISMATCH','Incomplete proactive image event stream');
  try{return JSON.parse(text);}catch{return fail('PROTOCOL_MISMATCH','Proactive image application JSON required');}
}
/** Actual HTTPS frontier adapter. No model/tool execution, permission issuer, retry loop or fallback. */
export function createRuntimeProactiveImageAdapter(options:RuntimeProactiveImageAdapterOptions) {
  const endpoint=endpointOf(options),proofs=createProactiveHostProofs(options.receiptSecret);
  if(typeof options.authorizationProvider?.read!=='function'||options.hostAuthorizationProvider&&typeof options.hostAuthorizationProvider.read!=='function'
    ||options.fetchImpl!==undefined&&typeof options.fetchImpl!=='function')fail('INVALID_ARGUMENT','Trusted proactive transport providers required');
  const invokeMode=options.invokeMode??options.config?.invokeMode??'published',workflowGoalInput=options.workflowGoalInput??options.config?.workflowGoalInput;
  if(!['debug','published'].includes(invokeMode)||workflowGoalInput!==undefined&&!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(workflowGoalInput))
    fail('INVALID_ARGUMENT','Invalid trusted proactive envelope configuration');
  const fetchImpl:AgentArtsFetch=options.fetchImpl??((url,init)=>globalThis.fetch(url,init));
  const validContext=(input:RuntimeProactiveImageContext)=>{
    if(!input||!id(input.taskId)||!id(input.sessionId)||!id(input.requestId)||!Number.isSafeInteger(input.controlRevision)||input.controlRevision<0
      ||!(input.signal instanceof AbortSignal)||!Number.isFinite(Date.parse(input.deadline))||!Number.isFinite(Date.parse(input.taskDeadline)))
      fail('INVALID_ARGUMENT','Original proactive request identity/lifetime required');
  };
  const validInput=(input:ProactiveAdvanceRequest)=>{
    validContext(input);
    if(!plain(input)||Object.keys(input).some(key=>!['taskId','sessionId','controlRevision','taskDeadline','deadline','requestId','signal','checkpoint','events','responsibilities','receipts','control','hostAvailability','availableCapabilities'].includes(key))
      ||!id(input.taskId)||!id(input.sessionId)||!id(input.requestId)||!Number.isSafeInteger(input.controlRevision)||input.controlRevision<0
      ||!(input.signal instanceof AbortSignal)||!Number.isFinite(Date.parse(input.deadline))||!Number.isFinite(Date.parse(input.taskDeadline))
      ||input.checkpoint!==undefined&&(typeof input.checkpoint!=='string'||!input.checkpoint.trim())
      ||[input.events,input.responsibilities,input.receipts].some(value=>value!==undefined&&!Array.isArray(value))
      ||input.control!==undefined&&!plain(input.control)||!exact(input.hostAvailability,['localDevice','cloudPersistentHost'])
      ||typeof input.hostAvailability.localDevice!=='boolean'||typeof input.hostAvailability.cloudPersistentHost!=='boolean'||!Array.isArray(input.availableCapabilities))
      fail('INVALID_ARGUMENT','Original proactive request identity/lifetime required');
  };
  const verifyAdvance=(result:ProactiveWorkflowResult,input:ProactiveAdvanceRequest):boolean=>{
    try {
      validInput(input);
      if(input.signal.aborted||Date.now()>=Math.min(Date.parse(input.deadline),Date.parse(input.taskDeadline)))return false;
      const value=result as unknown as Record<string,unknown>;
      return exact(value,['proactiveVersion','requestId','profileAddon','verification','checkpoint','advanceRevision','taskDeadline','mode','items','proposals','timeline','cancellationRequirements','proof'],['returnSummary'])
        &&value.proactiveVersion===1&&value.requestId===input.requestId&&value.profileAddon==='proactive.responsibility.v1'&&value.verification==='unverified'
        &&typeof value.checkpoint==='string'&&!!value.checkpoint&&Number.isSafeInteger(value.advanceRevision)&&(value.advanceRevision as number)>=1
        &&value.taskDeadline===input.taskDeadline&&['attended','unattended','paused','cancel_requested','cancelled'].includes(String(value.mode))
        &&plain(value.items)&&Array.isArray(value.proposals)&&Array.isArray(value.timeline)&&Array.isArray(value.cancellationRequirements)
        &&value.proposals.every(proposal=>exact(proposal,['proposalId','operationId','itemIds','stage','capabilityRef','capabilityKind','effect','location','arguments','argumentsDigest','originControlRevision','taskDeadline','createdAt'])
          &&plain(proposal)&&proposal.originControlRevision===input.controlRevision&&proposal.taskDeadline===input.taskDeadline
          &&id(proposal.proposalId)&&id(proposal.operationId)&&Array.isArray(proposal.itemIds)&&proposal.itemIds.every(id)
          &&['retrieve','laya','teacher','action','update','wake'].includes(String(proposal.stage))&&typeof proposal.capabilityRef==='string'&&!!proposal.capabilityRef
          &&typeof proposal.capabilityKind==='string'&&['read','write'].includes(String(proposal.effect))&&['local_device','cloud_persistent'].includes(String(proposal.location))
          &&input.availableCapabilities.some(cap=>cap.kind===proposal.capabilityKind&&cap.ref===proposal.capabilityRef
            &&cap.effect===proposal.effect&&cap.location===proposal.location)
          &&plain(proposal.arguments)&&proposal.argumentsDigest===proactiveWorkflowDigest(proposal.arguments)&&typeof proposal.createdAt==='string'&&Number.isFinite(Date.parse(proposal.createdAt)))
        &&proofs.verify('advance_result',value,input);
    }catch{return false;}
  };
  const isDescription=(value:unknown):value is RuntimeProactiveImageDescription=>exact(value,['proactiveVersion','verification','descriptor','adapters','contracts'])&&plain(value)
    &&value.proactiveVersion===1&&value.verification==='unverified'&&plain(value.descriptor)
    &&value.descriptor.id==='proactive.responsibility.v1'&&value.descriptor.profile==='huawei_ict_agentarts'
    &&Array.isArray(value.adapters)&&value.adapters.every(item=>plain(item)&&item.hostOnly===true&&item.requiresActualEvidence===true)
    &&Array.isArray(value.contracts)&&value.contracts.every(item=>exact(item,['id','version','qualifiedForMain'])&&plain(item)
      &&typeof item.id==='string'&&!!item.id&&typeof item.version==='string'&&!!item.version&&typeof item.qualifiedForMain==='boolean')
    &&new Set(value.contracts.map(item=>(item as {id:string}).id)).size===value.contracts.length;
  async function invoke(input:RuntimeProactiveImageContext,describeOnly:boolean):Promise<RuntimeProactiveImageResult|RuntimeProactiveImageDescription> {
    const assertBinding=()=>{try{options.assertDeploymentBinding?.();}catch{fail('REVISION_CONFLICT','Original proactive image deployment changed');}};
    assertBinding();
    validContext(input);if(!describeOnly)validInput(input as ProactiveAdvanceRequest);
    else if(!exact(input,['taskId','sessionId','controlRevision','taskDeadline','requestId','deadline','signal']))fail('INVALID_ARGUMENT','Unexpected proactive description context');
    const originalSignal=input.signal;
    try {const {signal:ignored,...data}=input;input={...structuredClone(data),signal:originalSignal};}
    catch {fail('INVALID_ARGUMENT','Proactive image request must be immutable JSON data');}
    const limit=Math.min(Date.parse(input.deadline),Date.parse(input.taskDeadline));
    if(input.signal.aborted)fail('CANCELLED','Proactive image invocation cancelled');
    if(Date.now()>=limit)fail('TIMEOUT','Original proactive image deadline expired');
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const abort=()=>controller.abort();input.signal.addEventListener('abort',abort,{once:true});
    const tick=()=>{const remaining=limit-Date.now();if(remaining<=0)controller.abort();else {timer=setTimeout(tick,Math.min(remaining,2_147_483_647));timer.unref();}};tick();
    const signal=controller.signal;
    const active=()=>{if(input.signal.aborted)fail('CANCELLED','Proactive image invocation cancelled');if(signal.aborted||Date.now()>=limit)fail('TIMEOUT','Original proactive image deadline expired');};
    async function bounded<T>(work:()=>Promise<T>):Promise<T> {
      active();let stop:()=>void=()=>{};
      const cancelled=new Promise<never>((_resolve,reject)=>{stop=()=>{try{active();}catch(error){reject(error);}};signal.addEventListener('abort',stop,{once:true});});
      try {const result=await Promise.race([Promise.resolve().then(()=>{active();return work();}),cancelled]);active();return result;}
      finally {signal.removeEventListener('abort',stop);}
    }
    const authorization=async(provider:AgentArtsAuthorizationProvider)=>{
      let value:string;try{value=await bounded(()=>provider.read(signal));}catch {active();return fail('UNAUTHORIZED','Proactive image authorization unavailable');}
      if(typeof value!=='string'||!value.trim()||value.length>4096||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value))fail('UNAUTHORIZED','Proactive image authorization unavailable');return value;
    };
    let response:AgentArtsResponse|undefined;
    try {
      const auth=await authorization(options.authorizationProvider),hostAuth=options.hostAuthorizationProvider?await authorization(options.hostAuthorizationProvider):undefined;
      if(hostAuth!==undefined&&!/^Bearer [\x21-\x7e]+$/u.test(hostAuth))fail('UNAUTHORIZED','Proactive image host credential unavailable');
      const request=input as ProactiveAdvanceRequest;
      const value=describeOnly?{proactiveVersion:1,operation:'describe'}:{proactiveVersion:1,operation:'advance',taskId:input.taskId,controlRevision:input.controlRevision,taskDeadline:input.taskDeadline,
        ...(request.checkpoint===undefined?{}:{checkpoint:request.checkpoint}),events:request.events??[],responsibilities:request.responsibilities??[],receipts:request.receipts??[],
        ...(request.control===undefined?{}:{control:request.control}),hostFrame:proofs.sign('frame',{requestId:input.requestId,
          hostAvailability:request.hostAvailability,availableCapabilities:request.availableCapabilities},input)};
      proactiveWorkflowDigest(value);const query=JSON.stringify(value),payload=workflowGoalInput===undefined?{query}:{inputs:{[workflowGoalInput]:query}};
      const body=JSON.stringify(payload);if(Buffer.byteLength(body)>MAX_BYTES)fail('INVALID_ARGUMENT','Proactive image request exceeds existing transport limit');
      assertBinding();
      response=await bounded(()=>fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json,text/event-stream',Authorization:auth,
        'x-hw-agentarts-session-id':input.sessionId,'X-Request-Id':input.requestId,'X-Invoke-Mode':invokeMode,'X-PA-Deadline':new Date(limit).toISOString(),
        ...(hostAuth===undefined?{}:{'X-PA-Agent-Token':hostAuth})},body,signal,redirect:'error'}));
      if(response.status!==200)fail(response.status===401||response.status===403?'UNAUTHORIZED':'EXTERNAL_FAILURE','Proactive image invocation rejected; no automatic retry');
      const chunks:Uint8Array[]=[];let bytes=0;
      const add=(chunk:Uint8Array)=>{bytes+=chunk.byteLength;if(bytes>MAX_BYTES)fail('PROTOCOL_MISMATCH','Proactive image response exceeds existing transport limit');chunks.push(chunk);};
      if(response.body&&'getReader' in response.body) {
        const reader=response.body.getReader();try {for(;;){const item=await bounded(()=>reader.read());if(item.done)break;if(item.value)add(item.value);}}
        finally {try{void Promise.resolve(reader.cancel?.()).catch(()=>undefined);}catch{}reader.releaseLock?.();}
      }else if(response.body&&Symbol.asyncIterator in response.body) {
        const reader=response.body[Symbol.asyncIterator]();try {for(;;){const item=await bounded(()=>reader.next());if(item.done)break;add(item.value);}}
        finally {try{void Promise.resolve(reader.return?.()).catch(()=>undefined);}catch{}}
      }else if(response.arrayBuffer)add(new Uint8Array(await bounded(()=>response!.arrayBuffer!())));
      else if(response.text)add(Buffer.from(await bounded(()=>response!.text!())));
      else fail('PROTOCOL_MISMATCH','Proactive image response body unavailable');
      let payloadText:string;try{payloadText=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{return fail('PROTOCOL_MISMATCH','Proactive image response UTF-8 invalid');}
      const result=resultFromEvents(eventsFrom(payloadText,response.headers?.get('content-type')??undefined));active();
      if(describeOnly) {
        if(!isDescription(result))fail('PROTOCOL_MISMATCH','Invalid proactive image description');return result as RuntimeProactiveImageDescription;
      }
      if(!verifyAdvance(result as ProactiveWorkflowResult,request))fail('UNAUTHORIZED','Proactive image response does not match original signed context');return result as RuntimeProactiveImageResult;
    }catch(error) {
      active();if(error instanceof ProactiveImageTransportError)throw error;
      return fail('RESULT_UNKNOWN','Proactive image outcome unknown; reconcile the original request without automatic retry');
    }finally {if(timer)clearTimeout(timer);input.signal.removeEventListener('abort',abort);controller.abort();}
  }
  return {advancePort:(input:ProactiveAdvanceRequest)=>invoke(input,false) as Promise<RuntimeProactiveImageResult>,verifyAdvance,sign:proofs.sign,
    /** Existing unsigned catalog is observation only; it never upgrades qualification or authorizes a proposal. */
    describe:(context:RuntimeProactiveImageContext)=>invoke(context,true) as Promise<RuntimeProactiveImageDescription>};
}
