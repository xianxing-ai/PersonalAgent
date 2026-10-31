import {createMcpConnectionManager} from '@personal-agent/mcp';
import {createDesktopRemoteMcpHost} from './remote-mcp-host.js';

/** Trusted startup composition. Runtime registers this collector's tools in its own Gateway. */
export async function createDesktopRemoteMcpServices({registry,readRuntime,confirmConnection,fetch,fetchFor}){
  if(typeof readRuntime!=='function' || typeof confirmConnection!=='function')throw Error('MCP Runtime receipt and native connection confirmation are required');
  const tools=[],hosts=new Map(),conflicts=new Set();let closed=false;
  const collector={register(tool){
    if(tools.some(item=>item.descriptor.name===tool.descriptor.name))throw Error('Duplicate MCP tool identity');
    tools.push(tool);return ()=>{const index=tools.indexOf(tool);if(index>=0)tools.splice(index,1);};
  }};
  const manager=createMcpConnectionManager(collector);
  try{for(const entry of registry.list()){
    const config=registry.get(entry.id),selectedFetch=fetchFor?.(entry.id)??fetch;
    const host=createDesktopRemoteMcpHost({config,readRuntime,confirmConnection,...(selectedFetch?{fetch:selectedFetch}:{})});
    const health=()=>{const state=host.snapshot();return {configured:state.configured,enabled:state.connected,
      state:state.connected?'connected':'disabled',connected:state.connected,discoveredTools:state.connected?host.tools.length:0,
      exposedTools:state.connected?host.tools.map(tool=>tool.descriptor.name):[]};};
    const adapter={tools:host.tools,register:target=>host.register(target),health,
      currentConfigurationRef:()=>host.snapshot().connected?host.tools[0]?.descriptor.inputSchema.properties.bindingRef.const:undefined,
      start:scope=>host.connect(scope),stop:()=>host.disconnect(),setEnabled:enabled=>enabled?health():host.disconnect(),dispose:()=>host.dispose()};
    if(host.tools.some(tool=>tools.some(existing=>existing.descriptor.name===tool.descriptor.name))){
      conflicts.add(entry.id);await host.dispose();continue;
    }
    await manager.adoptTrusted(entry.id,adapter);hosts.set(entry.id,host);
  }}catch(error){try{await manager.dispose();}finally{registry.dispose();}throw error;}
  return Object.freeze({
    tools:Object.freeze([...tools]),
    list(){return registry.list().map(item=>({...item,...(hosts.has(item.id)?hosts.get(item.id).snapshot():{}),
      ...(conflicts.has(item.id)?{status:'identity_conflict',connected:false,toolAvailable:false}:{}),
      ...(!hosts.has(item.id)&&!conflicts.has(item.id)?{status:'reassembly_required',requiresReassembly:true}:{} )}));},
    get(id){if(closed)throw Error('MCP services closed');return {config:registry.get(id),host:hosts.get(id)};},
    add:(id,input)=>registry.add(id,input),migrate:id=>registry.migrateLegacy(id),
    connect:(id,context)=>manager.connect(id,context),disconnect:id=>manager.disconnect(id),
    async revoke(id){const host=hosts.get(id);
      if(id==='legacy'){await host?.disconnect();registry.get(id).revoke();return;}
      if(host){await manager.remove(id);hosts.delete(id);}registry.revoke(id);},
    async dispose(){if(closed)return;closed=true;try{await manager.dispose();}finally{registry.dispose();}},
  });
}
