import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {ProtocolError,validateContract,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext,ToolDescriptor,ToolHost} from '@personal-agent/contracts';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {CallToolResultSchema,ListToolsResultSchema,ToolListChangedNotificationSchema} from '@modelcontextprotocol/sdk/types.js';
import type {FetchLike,Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {McpHealth} from './index.js';

// SDK 1.31.0's exported class declaration fails exactOptionalPropertyTypes
// (sessionId getter versus Transport). Load its public runtime export through
// this narrow port, without changing dependency files or relaxing type checks.
type HttpTransport=Omit<Transport,'sessionId'> & {readonly protocolVersion:string|undefined};
const {StreamableHTTPClientTransport}=createRequire(import.meta.url)('@modelcontextprotocol/sdk/client/streamableHttp.js') as {
  StreamableHTTPClientTransport:new(url:URL,options:{fetch:FetchLike;reconnectionOptions:{maxRetries:number;initialReconnectionDelay:number;maxReconnectionDelay:number;reconnectionDelayGrowFactor:number}})=>HttpTransport;
};

export interface RemoteReadonlyMcpOptions {
  /** Trusted host configuration and transport only; never Renderer or server declarations. */
  endpoint:string;
  server:{name:string;version:string};
  tool:{remoteName:string;descriptor:Pick<ToolDescriptor,'name'|'version'|'inputSchema'|'outputSchema'|'requiredScopes'>};
  enabled?:boolean;
  fetch?:FetchLike;
  expectedDirectoryDigest?:string;
}
const MAX_BYTES=1024*1024;
// ponytail: 64 lifetime identities; Runtime owns durable replay. A full host must be replaced, never evict old identities.
const MAX_RUNS=64;
export const canonical=(value:unknown):string=>value!==null && typeof value==='object'
  ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  : JSON.stringify(value);
function fail(code:string):never{throw new ProtocolError(code,'Remote MCP request was rejected or has no confirmed result');}
export function remoteMcpDirectoryDigest(tools:readonly unknown[]):string{
  try{return createHash('sha256').update(canonical(ListToolsResultSchema.parse({tools}).tools)).digest('hex');}
  catch{fail('PROTOCOL_MISMATCH');}
}
function check(signal:AbortSignal,deadline:string){
  if(!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline)<=Date.now())fail('TIMEOUT');
  if(signal.aborted)fail('CANCELLED');
}

/** Public, pinned read-only service. Discovery never creates execution permission. */
export function createRemoteReadonlyMcpHost(input?:RemoteReadonlyMcpOptions){
  const options=input ? {...input,server:{...input.server},tool:structuredClone(input.tool)} : undefined;
  let endpoint:URL|undefined;
  const descriptor:ToolDescriptor|undefined=options ? {...options.tool.descriptor,sideEffect:'read',idempotencySupport:true,recoverySupport:false,requiresPresence:false} : undefined;
  if(options){
    try{
      endpoint=new URL(options.endpoint);
      if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !options.server.name || !options.server.version || !options.tool.remoteName || !descriptor?.requiredScopes.length || descriptor.inputSchema.type!=='object' || descriptor.outputSchema.type!=='object')fail('INVALID_ARGUMENT');
      validateContract('tool',descriptor);
      if(options.expectedDirectoryDigest!==undefined && !/^[a-f0-9]{64}$/.test(options.expectedDirectoryDigest))fail('INVALID_ARGUMENT');
    }catch{fail('INVALID_ARGUMENT');}
  }
  let enabled=options?.enabled ?? false,disposed=false,busy=false,starting=false,generation=0;
  let state:McpHealth['state']=options ? enabled?'disconnected':'disabled' : 'unavailable';
  let errorCode:string|undefined,discoveredTools=0;
  let client:Client|undefined,transport:HttpTransport|undefined;
  let session=new AbortController(),operation:AbortSignal|undefined;
  type RequestScope={signal:AbortSignal;deadline:string;active:boolean};
  let operationScope:RequestScope|undefined;
  const sending=new Map<string,RequestScope>();
  const registrations=new Set<()=>void>();
  const runs=new Map<string,{binding:string;generation:number;result?:unknown;confirmed:boolean}>();
  const health=():McpHealth=>({configured:!!options,enabled,state,connected:state==='connected',discoveredTools,
    ...(errorCode?{errorCode}:{}),...(state==='connected' && transport?.protocolVersion?{protocolVersion:transport.protocolVersion}:{}),
    exposedTools:state==='connected'?[descriptor!.name]:[]});
  function invalidate(code:string,epoch:number){
    if(epoch!==generation || state==='error')return;
    errorCode=code;state='error';session.abort();
  }
  async function stop(){
    generation++;session.abort();
    for(const run of runs.values()){run.result=undefined;run.confirmed=false;}
    const previous=client;client=undefined;transport=undefined;discoveredTools=0;
    state=disposed?'disposed':!options?'unavailable':enabled?'disconnected':'disabled';
    try{await previous?.close();}catch{/* Remote diagnostics never reach status or errors. */}
  }
  async function scoped<T>(context:{signal:AbortSignal;deadline:string},action:()=>Promise<T>):Promise<T>{
    check(context.signal,context.deadline);
    if(busy)fail('REVISION_CONFLICT');
    busy=true;
    const timer=new AbortController();
    const timeout=setTimeout(()=>timer.abort(),Math.min(Date.parse(context.deadline)-Date.now(),30000));
    operation=AbortSignal.any([context.signal,session.signal,timer.signal]);
    const scope:RequestScope={signal:operation,deadline:context.deadline,active:true};operationScope=scope;
    try{return await action();}
    catch(error){
      if(timer.signal.aborted || Date.parse(context.deadline)<=Date.now())fail('TIMEOUT');
      if(context.signal.aborted)fail('CANCELLED');
      if(state==='error' && errorCode)fail(errorCode);
      if(error instanceof ProtocolError)throw error;
      fail(session.signal.aborted?'CANCELLED':'EXTERNAL_FAILURE');
    }finally{scope.active=false;clearTimeout(timeout);operationScope=undefined;operation=undefined;busy=false;}
  }
  async function start(context:{signal:AbortSignal;deadline:string}){
    check(context.signal,context.deadline);
    if(disposed || !enabled || !options)fail('UNSUPPORTED_CAPABILITY');
    if(busy || starting)fail('REVISION_CONFLICT');
    if(state==='connected')return;
    starting=true;
    const previousGeneration=generation;
    await stop();
    if(generation!==previousGeneration+1 || disposed || !enabled){starting=false;fail('CANCELLED');}
    session=new AbortController();
    const connectionSession=session;
    const configured=options!;
    const epoch=++generation;state='connecting';errorCode=undefined;
    try{await scoped(context,async()=>{
      const guardedFetch:FetchLike=async(url,init)=>{
        if(epoch!==generation || connectionSession.signal.aborted)fail('CANCELLED');
        if(String(url)!==endpoint!.href || typeof init?.body==='string' && Buffer.byteLength(init.body)>MAX_BYTES)fail('INVALID_ARGUMENT');
        const scope=typeof init?.body==='string'?sending.get(init.body):undefined;
        if(init?.method!=='GET'){
          if(!scope?.active)fail('CANCELLED');
          check(scope.signal,scope.deadline);
        }
        const signal=AbortSignal.any([connectionSession.signal,...(init?.signal?[init.signal]:[]),...(scope?[scope.signal]:[])]);
        const response=await (configured.fetch ?? fetch)(url,{...init,signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});
        if(response.status>=300 && response.status<400 || response.redirected){await response.body?.cancel();fail('EXTERNAL_FAILURE');}
        if(response.status===401 || response.status===403){await response.body?.cancel();fail('UNAUTHORIZED');}
        const length=response.headers.get('content-length');
        if(length && (!/^\d+$/.test(length) || Number(length)>MAX_BYTES)){await response.body?.cancel();fail('EXTERNAL_FAILURE');}
        let bytes=0;
        const body=response.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>MAX_BYTES)throw new ProtocolError('EXTERNAL_FAILURE','Remote MCP response exceeded limit');controller.enqueue(chunk);}}));
        return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
      };
      const nextTransport=new StreamableHTTPClientTransport(endpoint!,{fetch:guardedFetch,reconnectionOptions:{maxRetries:0,initialReconnectionDelay:0,maxReconnectionDelay:0,reconnectionDelayGrowFactor:1}});
      // The SDK awaits headers before fetch. Bind each send before that await;
      // a later operation must never lend its signal to an earlier queued send.
      const send=nextTransport.send.bind(nextTransport);
      nextTransport.send=async(message,sendOptions)=>{
        const scope=operationScope;if(!scope?.active)fail('CANCELLED');
        const body=JSON.stringify(message);sending.set(body,scope);
        try{await send(message,sendOptions);}
        finally{if(sending.get(body)===scope)sending.delete(body);}
      };
      const next=new Client({name:'personal-agent-remote-readonly-host',version:'1.0.0'},{capabilities:{}});
      client=next;transport=nextTransport;
      next.onclose=()=>invalidate('EXTERNAL_FAILURE',epoch);
      next.onerror=error=>invalidate(error instanceof ProtocolError?error.code:'EXTERNAL_FAILURE',epoch);
      next.setNotificationHandler(ToolListChangedNotificationSchema,()=>invalidate('REVISION_CONFLICT',epoch));
      await next.connect(nextTransport,{signal:operation!,timeout:Math.max(1,Math.min(30000,Date.parse(context.deadline)-Date.now()))});
      const server=next.getServerVersion();
      if(server?.name!==configured.server.name || server.version!==configured.server.version || nextTransport.protocolVersion!=='2025-11-25' || !next.getServerCapabilities()?.tools)fail('PROTOCOL_MISMATCH');
      const listed=await next.listTools(undefined,{signal:operation!,timeout:Math.max(1,Date.parse(context.deadline)-Date.now())});
      if(listed.nextCursor)fail('PROTOCOL_MISMATCH');
      if(configured.expectedDirectoryDigest && remoteMcpDirectoryDigest(listed.tools)!==configured.expectedDirectoryDigest)fail('REVISION_CONFLICT');
      const selected=listed.tools.filter(tool=>tool.name===configured.tool.remoteName);
      if(selected.length!==1 || canonical(selected[0]!.inputSchema)!==canonical(descriptor!.inputSchema) || canonical(selected[0]!.outputSchema)!==canonical(descriptor!.outputSchema))fail('PROTOCOL_MISMATCH');
      check(operation!,context.deadline);if(epoch!==generation)fail('CANCELLED');
      discoveredTools=listed.tools.length;state='connected';
    });}catch(error){
      const code=error instanceof ProtocolError?error.code:'EXTERNAL_FAILURE';
      if(epoch===generation){await stop();if(enabled&&!disposed)state='error';errorCode=code;}
      fail(code);
    }finally{starting=false;}
  }
  async function execute(value:unknown,context:ToolContext){
    if(disposed || state!=='connected' || !enabled || !client)fail('UNSUPPORTED_CAPABILITY');
    validateToolValue(descriptor!.inputSchema,value);check(context.signal,context.deadline);
    if(!descriptor!.requiredScopes.every(scope=>context.scopes.includes(scope)))fail('UNAUTHORIZED');
    const args=structuredClone(value) as Record<string,unknown>;
    const key=canonical([context.taskId,context.runId]);
    const binding=createHash('sha256').update(canonical(args)).digest('hex');
    const saved=runs.get(key);
    if(saved){
      if(saved.binding!==binding)fail('REVISION_CONFLICT');
      if(saved.confirmed && saved.generation===generation)return structuredClone(saved.result);
      fail('RESULT_UNKNOWN');
    }
    // No request has been sent for this identity. Do not create a false
    // reconciliation obligation when only the local retention limit is full.
    if(runs.size>=MAX_RUNS)fail('EXTERNAL_FAILURE');
    const epoch=generation,active=client!;
    return scoped(context,async()=>{
      if(options!.expectedDirectoryDigest){
        const listed=await active.listTools(undefined,{signal:operation!,timeout:Math.max(1,Date.parse(context.deadline)-Date.now())});
        if(listed.nextCursor || remoteMcpDirectoryDigest(listed.tools)!==options!.expectedDirectoryDigest){invalidate('REVISION_CONFLICT',epoch);fail('REVISION_CONFLICT');}
        check(operation!,context.deadline);
      }
      const run={binding,generation:epoch,confirmed:false,result:undefined as unknown};runs.set(key,run);
      const result=await active.callTool({name:options!.tool.remoteName,arguments:args},CallToolResultSchema,{signal:operation!,timeout:Math.max(1,Date.parse(context.deadline)-Date.now())});
      check(operation!,context.deadline);
      if(epoch!==generation || state!=='connected')fail('CANCELLED');
      if(result.isError || !result.structuredContent || Buffer.byteLength(JSON.stringify(result.structuredContent))>MAX_BYTES)fail('EXTERNAL_FAILURE');
      try{validateToolValue(descriptor!.outputSchema,result.structuredContent);}catch{fail('PROTOCOL_MISMATCH');}
      run.result=structuredClone(result.structuredContent);run.confirmed=true;
      return structuredClone(run.result);
    });
  }
  const tools:readonly RegisteredTool[]=descriptor?[{descriptor:structuredClone(descriptor),execute:async(value,context)=>{
    try{return await execute(value,context);}catch(error){fail(error instanceof ProtocolError?error.code:'EXTERNAL_FAILURE');}
  }}]:[];
  return {tools,health,start,stop,
    async setEnabled(value:boolean){if(disposed)fail('UNSUPPORTED_CAPABILITY');enabled=value;if(!value)await stop();else if(state==='disabled')state=options?'disconnected':'unavailable';return health();},
    register(host:ToolHost){const releases=tools.map(tool=>host.register(tool));const release=()=>{registrations.delete(release);for(const item of releases)item();};registrations.add(release);return release;},
    async dispose(){if(disposed)return;disposed=true;enabled=false;for(const release of registrations)release();await stop();runs.clear();},
  };
}
