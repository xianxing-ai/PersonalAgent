import {createHash} from 'node:crypto';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext,ToolHost} from '@personal-agent/contracts';
import type {SecretStorePort} from '@personal-agent/connector-host';
import {canonical,createRemoteReadonlyMcpHost} from './remote.js';
import type {RemoteReadonlyMcpOptions} from './remote.js';

export interface RemoteMcpConfigurationBinding {
  configurationRef:string;
  revision:number;
  directoryDigest:string;
  /** Metadata for an access token already issued specifically for this resource. */
  credential?:{secretRef:string;revision:number;resource:string;expiresAt:string};
}
export interface BoundRemoteReadonlyMcpOptions extends Omit<RemoteReadonlyMcpOptions,'expectedDirectoryDigest'> {
  binding:RemoteMcpConfigurationBinding;
  readCurrentBinding:()=>RemoteMcpConfigurationBinding|undefined;
  revocationSignal:AbortSignal;
  secretStore?:SecretStorePort;
}
const ref={type:'string',minLength:1,maxLength:256};
const revision={type:'integer',minimum:1};
const bindingSchema={type:'object',properties:{configurationRef:ref,revision,directoryDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},
  credential:{type:'object',properties:{secretRef:ref,revision,resource:{type:'string',minLength:1,maxLength:2048},expiresAt:{type:'string',minLength:1,maxLength:64}},required:['secretRef','revision','resource','expiresAt'],additionalProperties:false}},
required:['configurationRef','revision','directoryDigest'],additionalProperties:false};
function fail(code:string):never{throw new ProtocolError(code,'Bound remote MCP configuration is unavailable or the request was rejected');}

/** Trusted host adapter; credential bytes never become tool arguments/results. */
export function createBoundRemoteReadonlyMcpHost(input?:BoundRemoteReadonlyMcpOptions){
  if(!input)return {...createRemoteReadonlyMcpHost(),currentConfigurationRef:():string|undefined=>undefined};
  const options={...input,binding:structuredClone(input.binding),server:{...input.server},tool:structuredClone(input.tool)};
  const binding=options.binding;
  let endpoint:string;
  try{
    endpoint=new URL(options.endpoint).href;
    validateToolValue(bindingSchema,binding);
    if(binding.credential && (!options.secretStore || binding.credential.resource!==endpoint || !Number.isFinite(Date.parse(binding.credential.expiresAt))))fail('INVALID_ARGUMENT');
  }catch{fail('INVALID_ARGUMENT');}
  const bindingRef=createHash('sha256').update(canonical({endpoint,server:options.server,tool:options.tool,binding})).digest('hex');
  const lifetime=new AbortController();
  let revokedCode:string|undefined,disposed=false;
  function revoke(code:string){if(revokedCode || disposed)return;revokedCode=code;lifetime.abort();void base.stop();}
  function assertCurrent(signal:AbortSignal){
    if(disposed)fail('UNSUPPORTED_CAPABILITY');
    if(base.health().state==='error' && base.health().errorCode==='REVISION_CONFLICT')revoke('REVISION_CONFLICT');
    if(revokedCode)fail(revokedCode);
    if(signal.aborted)fail('CANCELLED');
    let current:RemoteMcpConfigurationBinding|undefined;
    try{current=structuredClone(options.readCurrentBinding());if(current)validateToolValue(bindingSchema,current);}
    catch{revoke('REVISION_CONFLICT');fail('REVISION_CONFLICT');}
    if(!current || canonical(current)!==canonical(binding)){revoke(current?'REVISION_CONFLICT':'UNAUTHORIZED');fail(revokedCode!);}
    if(binding.credential && Date.parse(binding.credential.expiresAt)<=Date.now()){revoke('UNAUTHORIZED');fail('UNAUTHORIZED');}
    if(revokedCode)fail(revokedCode);
    if(signal.aborted)fail('CANCELLED');
  }
  async function readToken(signal:AbortSignal):Promise<string>{
    signal=AbortSignal.any([signal,AbortSignal.timeout(30000)]);
    assertCurrent(signal);
    const value=await new Promise<string|undefined>((resolve,reject)=>{
      const abort=()=>reject(new ProtocolError('CANCELLED','Remote MCP credential read was cancelled'));
      signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted){abort();return;}
      Promise.resolve().then(()=>{assertCurrent(signal);return options.secretStore!.read(binding.credential!.secretRef,signal);})
        .then(resolve,()=>reject(new ProtocolError('UNAUTHORIZED','Remote MCP credential is unavailable')))
        .finally(()=>signal.removeEventListener('abort',abort));
    });
    assertCurrent(signal);
    if(typeof value!=='string' || !value || value.length>8192 || !/^[A-Za-z0-9._~+/-]+=*$/.test(value))fail('UNAUTHORIZED');
    return value;
  }
  const base=createRemoteReadonlyMcpHost({endpoint:options.endpoint,server:options.server,tool:options.tool,enabled:options.enabled??false,expectedDirectoryDigest:binding.directoryDigest,fetch:async(url,init)=>{
    if(String(url)!==endpoint)fail('INVALID_ARGUMENT');
    const signal=AbortSignal.any([lifetime.signal,...(init?.signal?[init.signal]:[])]);
    assertCurrent(signal);
    const headers=new Headers(init?.headers);
    if(headers.has('authorization') || headers.has('cookie'))fail('INVALID_ARGUMENT');
    if(binding.credential)headers.set('authorization',`Bearer ${await readToken(signal)}`);
    assertCurrent(signal);
    return (options.fetch??fetch)(url,{...init,headers,signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});
  }});
  const revokeListener=()=>revoke('REVISION_CONFLICT');
  options.revocationSignal.addEventListener('abort',revokeListener,{once:true});
  if(options.revocationSignal.aborted)revokeListener();
  const inputSchema={type:'object',properties:{bindingRef:{const:bindingRef,type:'string'},arguments:options.tool.descriptor.inputSchema},required:['bindingRef','arguments'],additionalProperties:false};
  const inner=base.tools[0]!;
  async function guarded<T>(signal:AbortSignal,action:()=>Promise<T>):Promise<T>{
    try{assertCurrent(signal);const result=await action();assertCurrent(signal);return result;}
    catch(error){
      if(base.health().state==='error' && base.health().errorCode==='REVISION_CONFLICT')revoke('REVISION_CONFLICT');
      fail(revokedCode??(signal.aborted?'CANCELLED':error instanceof ProtocolError?error.code:'EXTERNAL_FAILURE'));
    }
  }
  const tool:RegisteredTool={descriptor:{...structuredClone(inner.descriptor),inputSchema},execute:(value,context:ToolContext)=>guarded(context.signal,async()=>{
    validateToolValue(inputSchema,value);
    const result=await inner.execute((value as {arguments:unknown}).arguments,{...context,signal:AbortSignal.any([context.signal,lifetime.signal])});
    assertCurrent(context.signal);return result;
  })};
  const registrations=new Set<()=>void>();
  const currentConfigurationRef=():string|undefined=>{try{assertCurrent(lifetime.signal);return base.health().connected?bindingRef:undefined;}catch{return undefined;}};
  return {tools:[tool] as readonly RegisteredTool[],currentConfigurationRef,
    health(){currentConfigurationRef();const health=base.health();return revokedCode && !disposed && health.enabled?{...health,state:'error' as const,connected:false,exposedTools:[],errorCode:revokedCode}:health;},
    start:(context:{signal:AbortSignal;deadline:string})=>guarded(context.signal,()=>base.start({...context,signal:AbortSignal.any([context.signal,lifetime.signal])})),
    stop:()=>base.stop(),
    async setEnabled(enabled:boolean){if(enabled)assertCurrent(lifetime.signal);return base.setEnabled(enabled);},
    register(host:ToolHost){const remove=host.register(tool);const release=()=>{registrations.delete(release);remove();};registrations.add(release);return release;},
    async dispose(){if(disposed)return;disposed=true;options.revocationSignal.removeEventListener('abort',revokeListener);lifetime.abort();for(const release of registrations)release();await base.dispose();},
  };
}
