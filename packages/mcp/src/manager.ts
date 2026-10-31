import {ProtocolError} from '@personal-agent/contracts';
import type {ToolHost} from '@personal-agent/contracts';
import {createBoundRemoteReadonlyMcpHost} from './bound-remote.js';
import type {BoundRemoteReadonlyMcpOptions} from './bound-remote.js';

/** Trusted composition supplies the existing Runtime's persistent receipt reader. */
type ManagedOptions=Omit<BoundRemoteReadonlyMcpOptions,'revocationSignal'|'serverId'> & Required<Pick<BoundRemoteReadonlyMcpOptions,'readRunReceipt'>>;
type ManagedHost=ReturnType<typeof createBoundRemoteReadonlyMcpHost>;
type Entry={host:ManagedHost;revocation:AbortController;release:()=>void};
function fail(code:string):never{throw new ProtocolError(code,'Managed MCP service is unavailable');}

/** In-memory connection registry only; authorization and execution remain in ToolGateway. */
export function createMcpConnectionManager(gateway:ToolHost){
  const entries=new Map<string,Entry>();let disposed=false;
  function get(id:string):Entry{if(disposed)fail('UNSUPPORTED_CAPABILITY');const entry=entries.get(id);if(!entry)fail('NOT_FOUND');return entry;}
  return {
    async add(id:string,options:ManagedOptions){
      if(disposed)fail('UNSUPPORTED_CAPABILITY');
      if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)||entries.has(id)
        ||typeof options?.readRunReceipt!=='function')fail('INVALID_ARGUMENT');
      const revocation=new AbortController();
      const host=createBoundRemoteReadonlyMcpHost({...options,serverId:id,revocationSignal:revocation.signal});
      let release:()=>void;
      try{release=host.register(gateway);}catch(error){await host.dispose();throw error;}
      entries.set(id,{host,revocation,release});
      return host.health();
    },
    /** Trusted Desktop composition may attach its existing consent-wrapped host. */
    async adoptTrusted(id:string,host:ManagedHost){
      if(disposed)fail('UNSUPPORTED_CAPABILITY');
      if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)||entries.has(id)
        ||!host || typeof host.register!=='function' || typeof host.currentConfigurationRef!=='function')fail('INVALID_ARGUMENT');
      let release:()=>void;
      try{release=host.register(gateway);}catch(error){await host.dispose();throw error;}
      entries.set(id,{host,revocation:new AbortController(),release});return host.health();
    },
    tools(id:string){return get(id).host.tools;},
    list(){if(disposed)fail('UNSUPPORTED_CAPABILITY');return [...entries.keys()];},
    health(id:string){return get(id).host.health();},
    currentConfigurationRef(id:string){return get(id).host.currentConfigurationRef();},
    async connect(id:string,context:{signal:AbortSignal;deadline:string}){const {host}=get(id);await host.setEnabled(true);await host.start(context);return host.health();},
    async disconnect(id:string){return get(id).host.setEnabled(false);},
    async remove(id:string){const entry=get(id);entries.delete(id);entry.revocation.abort();entry.release();await entry.host.dispose();},
    async dispose(){if(disposed)return;disposed=true;const owned=[...entries.values()];entries.clear();
      for(const entry of owned){entry.revocation.abort();entry.release();}
      const results=await Promise.allSettled(owned.map(entry=>entry.host.dispose()));
      if(results.some(result=>result.status==='rejected'))fail('EXTERNAL_FAILURE');},
  };
}
