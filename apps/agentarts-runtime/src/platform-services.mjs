import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {CallToolResultSchema,SUPPORTED_PROTOCOL_VERSIONS} from '@modelcontextprotocol/sdk/types.js';

const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)
  ?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const fail=(code,message)=>{throw new ProtocolError(code,message);};
function active(context) {
  if(!(context?.signal instanceof AbortSignal))fail('INVALID_ARGUMENT','Explicit platform cancellation signal required');
  if(context.signal.aborted)fail('CANCELLED','Platform request cancelled');
  const remaining=Date.parse(context.deadline)-Date.now();
  if(!Number.isFinite(remaining)||remaining<=0)fail('TIMEOUT','Platform request deadline expired');
  return remaining;
}
const interrupted=(context,error)=>context.signal.aborted?'CANCELLED':Date.parse(context.deadline)<=Date.now()?'TIMEOUT'
  :error?.code===401||error?.status===401?'UNAUTHORIZED'
  :['UNAUTHORIZED','SCOPE_DENIED','UNSUPPORTED_CAPABILITY','PROTOCOL_MISMATCH','RESULT_UNKNOWN','CANCELLED','TIMEOUT'].includes(error?.code)?error.code:'EXTERNAL_FAILURE';
async function authorized(authorize,request,context) {
  active(context);
  if(typeof authorize!=='function')fail('UNSUPPORTED_CAPABILITY','Trusted platform authorization callback unavailable');
  let allowed;try{allowed=await authorize(request,context);}catch{active(context);fail('UNAUTHORIZED','Trusted platform authorization check failed');}
  if(allowed!==true)fail('UNAUTHORIZED','Platform request not authorized by trusted host');
  active(context);
}
function endpoint(value,{loopback=false}={}) {
  let url;try{url=new URL(value);}catch{fail('INVALID_ARGUMENT','Invalid trusted platform endpoint');}
  if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'
    &&!(loopback&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))fail('INVALID_ARGUMENT','Invalid trusted platform endpoint');
  return url;
}

/** Official pinned SDK client; configuration comes only from trusted startup, never invocation arguments. */
export function createPlatformMcpService(configuration) {
  let client,transport,starting=false,disposed=false,registered=[];
  let status={state:'unavailable',missingConfiguration:['mcp.endpoint','mcp.serverIdentity','mcp.protocolVersions','mcp.bindings','mcp.getCredentialHeaders','mcp.authorize']};
  if(configuration) {
    const required=['endpoint','serverIdentity','protocolVersions','bindings','getCredentialHeaders','authorize'];
    const missing=required.filter(key=>configuration[key]===undefined);
    if(missing.length)status={state:'unavailable',missingConfiguration:missing.map(key=>'mcp.'+key)};
    else status={state:'disconnected',missingConfiguration:[]};
  }
  const config=configuration?{...configuration,serverIdentity:structuredClone(configuration.serverIdentity),
    protocolVersions:structuredClone(configuration.protocolVersions),bindings:structuredClone(configuration.bindings)}:undefined;
  const close=async()=>{registered=[];const previous=client;client=undefined;transport=undefined;
    try{await previous?.close();}catch{}status={...status,state:disposed?'disposed':status.missingConfiguration.length?'unavailable':'disconnected'};};
  async function connect(context) {
    active(context);
    if(disposed||status.missingConfiguration.length)fail('UNSUPPORTED_CAPABILITY','Platform MCP configuration unavailable');
    if(starting)fail('REVISION_CONFLICT','Platform MCP discovery already in progress');
    if(status.state==='connected')return;
    const url=endpoint(config.endpoint,{loopback:true});
    if(!plain(config.serverIdentity)||!config.serverIdentity.name||!config.serverIdentity.version
      ||!Array.isArray(config.protocolVersions)||!config.protocolVersions.length
      ||config.protocolVersions.some(version=>!SUPPORTED_PROTOCOL_VERSIONS.includes(version))
      ||!Array.isArray(config.bindings)||!config.bindings.length
      ||new Set(config.bindings.map(binding=>binding.descriptor?.name)).size!==config.bindings.length
      ||config.bindings.some(binding=>!binding.remoteName||!binding.descriptor?.name||!binding.descriptor.version
        ||!Array.isArray(binding.descriptor.requiredScopes)||!plain(binding.descriptor.inputSchema)))fail('INVALID_ARGUMENT','Invalid trusted MCP identity or tool bindings');
    starting=true;status={state:'connecting',missingConfiguration:[]};
    try {
      await authorized(config.authorize,{operation:'discover_mcp'},context);
      const request=config.fetch??fetch;
      const guardedFetch=async(input,init={})=>{
        if(init.signal?.aborted)fail('CANCELLED','MCP transport request cancelled');
        const target=new URL(typeof input==='string'||input instanceof URL?input:input.url);
        if(target.href!==url.href)fail('UNAUTHORIZED','MCP transport attempted an unconfigured endpoint');
        const headers=new Headers(init.headers),credentials=await config.getCredentialHeaders();
        if(init.signal?.aborted)fail('CANCELLED','MCP transport request cancelled');
        if(!plain(credentials))fail('UNAUTHORIZED','MCP credential headers unavailable');
        for(const [name,value] of Object.entries(credentials))headers.set(name,value);
        return request(input,{...init,headers,redirect:'error'});
      };
      transport=new StreamableHTTPClientTransport(url,{fetch:guardedFetch,
        reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1}});
      client=new Client({name:'personal-agent-platform-host',version:'1.0.0'},{capabilities:{}});
      client.onclose=()=>{registered=[];if(status.state==='connected')status={state:'disconnected',missingConfiguration:[]};};
      client.onerror=()=>{if(status.state==='connected')status={...status,state:'error',errorCode:'EXTERNAL_FAILURE'};};
      await client.connect(transport,{signal:context.signal,timeout:active(context)});
      active(context);
      const identity=client.getServerVersion();
      if(identity?.name!==config.serverIdentity.name||identity?.version!==config.serverIdentity.version
        ||!config.protocolVersions.includes(transport.protocolVersion)||!client.getServerCapabilities()?.tools)
        fail('PROTOCOL_MISMATCH','Platform MCP identity or negotiated protocol mismatch');
      const discovered=[];const cursors=new Set();let cursor;
      do {
        const page=await client.listTools(cursor?{cursor}:undefined,{signal:context.signal,timeout:active(context)});
        discovered.push(...page.tools);cursor=page.nextCursor;
        if(cursor&&cursors.has(cursor))fail('PROTOCOL_MISMATCH','Platform MCP discovery cursor did not advance');
        if(cursor)cursors.add(cursor);
      }while(cursor);
      if(new Set(discovered.map(tool=>tool.name)).size!==discovered.length)fail('PROTOCOL_MISMATCH','Platform MCP returned duplicate tool names');
      for(const binding of config.bindings) {
        const remote=discovered.find(tool=>tool.name===binding.remoteName);
        if(!remote||canonical(remote.inputSchema)!==canonical(binding.descriptor.inputSchema))
          fail('PROTOCOL_MISMATCH','Platform MCP published tool schema mismatch');
      }
      if(disposed)fail('CANCELLED','Platform MCP service disposed');
      registered=config.bindings.map(binding=>({descriptor:structuredClone(binding.descriptor),execute:async(input,toolContext)=>{
        active(toolContext);validateToolValue(binding.descriptor.inputSchema,input);
        if(status.state!=='connected'||!client)fail('UNSUPPORTED_CAPABILITY','Platform MCP session unavailable');
        if(!toolContext.authorizationRef||!binding.descriptor.requiredScopes.every(scope=>toolContext.scopes?.includes(scope)))
          fail('UNAUTHORIZED','Platform MCP tool requires original Runtime authorization');
        await authorized(config.authorize,{operation:'call_mcp',toolName:binding.descriptor.name,toolVersion:binding.descriptor.version,input:structuredClone(input)},toolContext);
        try {
          const result=CallToolResultSchema.parse(await client.callTool({name:binding.remoteName,arguments:structuredClone(input)},
            CallToolResultSchema,{signal:toolContext.signal,timeout:active(toolContext)}));
          active(toolContext);
          // MCP isError is an actual remote failure, not a confirmed successful tool result.
          if(result.isError)fail('EXTERNAL_FAILURE','Platform MCP reported tool failure');
          if(binding.descriptor.outputSchema)validateToolValue(binding.descriptor.outputSchema,result);
          return result;
        }catch(error){fail(interrupted(toolContext,error),'Platform MCP tool call did not return a verified result');}
      }}));
      status={state:'connected',missingConfiguration:[],protocolVersion:transport.protocolVersion,
        serverIdentity:structuredClone(identity),discoveredTools:discovered.length,publishedTools:registered.map(tool=>tool.descriptor.name)};
    }catch(error){await close();const code=['PROTOCOL_MISMATCH','UNAUTHORIZED','UNSUPPORTED_CAPABILITY'].includes(error?.code)?error.code:interrupted(context,error);
      status={state:'error',missingConfiguration:[],errorCode:code};fail(code,'Platform MCP connection failed');
    }finally{starting=false;}
  }
  return {connect,tools:()=>registered.slice(),status:()=>structuredClone(status),close:async()=>{disposed=true;await close();}};
}

/** Existing KnowledgePort shape; routes are explicitly bound and never fall back to another source. */
export function createPlatformKnowledgeRouter(configuration={}) {
  const {local,platform,route='local',authorize}=configuration;
  return {status:()=>({state:(route==='local'?local:platform)?.search&&typeof authorize==='function'?'configured_not_verified':'unavailable',
    route,missingConfiguration:[...(!(route==='local'?local:platform)?.search?['knowledge.'+route+'.search']:[]),...(typeof authorize!=='function'?['knowledge.authorize']:[])]}),
    async search(request) {
      active(request);
      if(!plain(request)||Object.keys(request).some(key=>!['query','limit','deadline','signal'].includes(key))
        ||typeof request.query!=='string'||!request.query.trim()||!Number.isSafeInteger(request.limit)||request.limit<1)
        fail('INVALID_ARGUMENT','Invalid public KnowledgePort query');
      if(!['local','platform'].includes(route))fail('INVALID_ARGUMENT','Unknown trusted knowledge route');
      const port=route==='local'?local:platform;
      if(!port?.search)fail('UNSUPPORTED_CAPABILITY','Configured knowledge adapter unavailable');
      await authorized(authorize,{operation:'knowledge_search',route,query:request.query,limit:request.limit},request);
      let result;try{result=await port.search({...request});}catch(error){fail(interrupted(request,error),'Knowledge adapter read failed');}
      active(request);
      if(!plain(result)||!Array.isArray(result.hits)||typeof result.truncated!=='boolean'
        ||result.hits.some(hit=>typeof hit.excerpt!=='string'||!plain(hit.source)||!hit.source.vaultId||!hit.source.path
          ||!Number.isSafeInteger(hit.source.line)||hit.source.line<1||!hit.source.revision))fail('EXTERNAL_FAILURE','Knowledge adapter returned invalid source references');
      return structuredClone(result);
    }};
}

// These exact region/paths are already used by the repository's reviewed MOD-32 observation reader.
const OBSERVATION_ORIGIN='https://agentarts.cn-southwest-2.myhuaweicloud.com';
export function createAgentArtsObservationReader({origin,authorizeRequest,fetch:request=fetch}={}) {
  const configured=origin===OBSERVATION_ORIGIN&&typeof authorizeRequest==='function';
  return {status:()=>({state:configured?'configured_not_verified':'unavailable',missingConfiguration:[
    ...(origin!==OBSERVATION_ORIGIN?['observation.confirmed_region_contract']:[]),...(typeof authorizeRequest!=='function'?['observation.authorizeRequest']:[])]}),
    async read({surface,traceId,query},context,projectors) {
      active(context);if(!configured)fail('UNSUPPORTED_CAPABILITY','Observation region or authorization contract unavailable');
      if(!projectors?.buildRunLogPath)fail('UNSUPPORTED_CAPABILITY','Public observation projector unavailable');
      if(!['trace','log'].includes(surface)||surface==='trace'&&(typeof traceId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(traceId)))
        fail('INVALID_ARGUMENT','Invalid observation query');
      const path=surface==='log'?projectors.buildRunLogPath(query):'/v1/ops/observation/traces/'+traceId;
      const url=new URL(path,origin);
      if(url.origin!==OBSERVATION_ORIGIN||!url.pathname.startsWith('/v1/ops/observation/'))fail('INVALID_ARGUMENT','Observation path is outside the confirmed contract');
      const unsigned={'content-type':'application/json'};
      let headers;try{headers=await authorizeRequest({method:'GET',url:url.href,headers:unsigned},context);}catch{active(context);fail('UNAUTHORIZED','Observation signing failed');}
      active(context);
      if(!plain(headers))fail('UNAUTHORIZED','Observation request has no signed host headers');
      headers=Object.fromEntries(new Headers(headers));
      if(!/^SDK-(?:HMAC|ECDSA)-[A-Za-z0-9_-]+ .+/.test(headers.authorization??'')||!/^\d{8}T\d{6}Z$/.test(headers['x-sdk-date']??''))
        fail('UNAUTHORIZED','Observation request has no signed host headers');
      try {
        const response=await request(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.any([context.signal,AbortSignal.timeout(active(context))])});
        if(!response.ok)fail(response.status===401||response.status===403?'UNAUTHORIZED':'EXTERNAL_FAILURE','Observation request rejected');
        const result=await response.json();active(context);return result;
      }catch(error){fail(interrupted(context,error),'Observation read failed');}
    }};
}

/** Projection and evaluation adapt actual readbacks; neither has authority to complete a local task. */
export function createPlatformReadbacks({observation,evaluation,loadProjectors=()=>import('@personal-agent/agentarts/observability')}={}) {
  const reader=observation?.reader??(observation?createAgentArtsObservationReader(observation):undefined);
  return {status:()=>({observation:reader?.status?.()??{state:'unavailable',missingConfiguration:['observation.reader']},
    evaluation:{state:evaluation?.readResult&&evaluation?.validateResult&&evaluation?.authorize?'configured_not_verified':'unavailable',
      missingConfiguration:['readResult','validateResult','authorize'].filter(key=>typeof evaluation?.[key]!=='function').map(key=>'evaluation.'+key)}}),
    async observe(input,context) {
      active(context);
      if(!plain(input)||Object.keys(input).some(key=>!['surface','traceId','query','invocation'].includes(key))||!['trace','log'].includes(input.surface))
        fail('INVALID_ARGUMENT','Invalid observation operation');
      if(!reader?.read)fail('UNSUPPORTED_CAPABILITY','Platform observation reader unavailable');
      let projectors;try{projectors=await loadProjectors();}catch{fail('UNSUPPORTED_CAPABILITY','Public observation projection module unavailable');}
      let body;try{body=await reader.read(structuredClone(input),context,projectors);}catch(error){
        fail(['UNAUTHORIZED','UNSUPPORTED_CAPABILITY','INVALID_ARGUMENT'].includes(error?.code)?error.code:interrupted(context,error),'Platform observation read failed');}
      active(context);
      try{return input.surface==='trace'?projectors.projectTraceObservation(body,input.traceId,input.invocation):projectors.projectRunLogObservation(body);}
      catch{fail('EXTERNAL_FAILURE','Platform observation response contract mismatch');}
    },
    async readEvaluation(input,context) {
      active(context);
      if(!plain(input)||Object.keys(input).some(key=>!['evaluationId','revision'].includes(key))||!input.evaluationId||!input.revision)
        fail('INVALID_ARGUMENT','Versioned evaluation reference required');
      if(!evaluation?.readResult||!evaluation?.validateResult)fail('UNSUPPORTED_CAPABILITY','Evaluation API adapter/response contract unavailable');
      await authorized(evaluation.authorize,{operation:'evaluation_read',...structuredClone(input)},context);
      let result;try{result=await evaluation.readResult(structuredClone(input),context);active(context);
        const validated=await evaluation.validateResult(result,input,context);active(context);
        if(validated===undefined||validated===false)fail('EXTERNAL_FAILURE','Evaluation response not validated');
        return structuredClone(validated);
      }catch(error){fail(interrupted(context,error),'Evaluation readback failed');}
    }};
}

export function createPlatformServices(configuration={}) {
  const mcp=createPlatformMcpService(configuration.mcp),knowledge=createPlatformKnowledgeRouter(configuration.knowledge),readbacks=createPlatformReadbacks(configuration);
  const status=()=>({mcp:mcp.status(),knowledge:knowledge.status(),...readbacks.status(),
    toolExecution:{state:configuration.toolExecutionPort?.invoke&&configuration.toolExecutionPort?.list&&configuration.getToolInvocationContext?'configured_not_verified':'unavailable',
      missingConfiguration:[...(!configuration.toolExecutionPort?.invoke||!configuration.toolExecutionPort?.list?['existing Runtime toolExecutionPort']:[]),
        ...(typeof configuration.getToolInvocationContext!=='function'?['trusted getToolInvocationContext']:[])]},
    learning:{state:'unavailable',missingConfiguration:['existing trusted learning host/validator port; no platform learning API contract confirmed']}});
  const list=()=>({status:status(),mcpTools:mcp.tools().map(tool=>structuredClone(tool.descriptor)),
    executionBoundary:'RegisteredTool factories must be registered in the original Runtime; public mcp.call requires its injected toolExecutionPort',
    operations:['mcp.discover','mcp.list','mcp.call','knowledge.search','observation.read','evaluation.read']});
  async function execute(input,context) {
    active(context);
    if(!plain(input)||typeof input.operation!=='string')fail('INVALID_ARGUMENT','Platform operation required');
    const allowed={
      'mcp.discover':['operation'],'mcp.list':['operation'],
      'mcp.call':['operation','toolName','toolVersion','arguments'],
      'knowledge.search':['operation','query','limit'],
      'observation.read':['operation','request'],'evaluation.read':['operation','request'],
    }[input.operation];
    if(!allowed||Object.keys(input).some(key=>!allowed.includes(key)))fail('INVALID_ARGUMENT','Unknown platform operation or fields');
    if(input.operation==='mcp.discover'){await mcp.connect(context);return list();}
    if(input.operation==='mcp.list')return list();
    if(input.operation==='knowledge.search')return knowledge.search({query:input.query,limit:input.limit,deadline:context.deadline,signal:context.signal});
    if(input.operation==='observation.read')return readbacks.observe(input.request,context);
    if(input.operation==='evaluation.read')return readbacks.readEvaluation(input.request,context);
    const descriptor=mcp.tools().find(tool=>tool.descriptor.name===input.toolName&&tool.descriptor.version===input.toolVersion)?.descriptor;
    if(!descriptor)fail('UNSUPPORTED_CAPABILITY','Requested platform MCP tool was not discovered and published');
    validateToolValue(descriptor.inputSchema,input.arguments);
    if(status().toolExecution.state==='unavailable')fail('UNSUPPORTED_CAPABILITY','Original Runtime tool execution/context port unavailable');
    const published=await configuration.toolExecutionPort.list();active(context);
    if(!published.some(tool=>tool.name===descriptor.name&&tool.version===descriptor.version
      &&canonical(tool.inputSchema)===canonical(descriptor.inputSchema)))fail('UNSUPPORTED_CAPABILITY','Platform tool is not registered in the original Runtime');
    let original;try{original=await configuration.getToolInvocationContext(structuredClone(input),context);}catch{active(context);fail('UNAUTHORIZED','Original Runtime invocation context unavailable');}
    if(!original?.taskId||!original.runId||!original.authorizationRef||!(original.signal instanceof AbortSignal)
      ||!Number.isFinite(Date.parse(original.deadline)))fail('UNAUTHORIZED','Trusted Runtime identity and original authorization required');
    const invocation={toolName:input.toolName,toolVersion:input.toolVersion,arguments:structuredClone(input.arguments),
      taskId:original.taskId,runId:original.runId,authorizationRef:original.authorizationRef,
      deadline:new Date(Math.min(Date.parse(original.deadline),Date.parse(context.deadline))).toISOString(),
      signal:AbortSignal.any([original.signal,context.signal])};
    active(invocation);
    // No direct execution, Policy issuer, replay table or retry loop in this public image surface.
    try{return await configuration.toolExecutionPort.invoke(invocation);}
    catch(error){const code=['UNAUTHORIZED','SCOPE_DENIED','RESULT_UNKNOWN','CANCELLED','TIMEOUT','UNSUPPORTED_CAPABILITY'].includes(error?.code)?error.code:interrupted(invocation,error);
      fail(code,'Original Runtime tool execution did not return a confirmed result');}
  }
  return {mcp,knowledge,readbacks,status,list,execute,close:()=>mcp.close()};
}
