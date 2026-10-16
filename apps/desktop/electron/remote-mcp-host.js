import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {createBoundRemoteReadonlyMcpHost,remoteMcpArgumentsDigest} from '@personal-agent/mcp';

function fail(code){throw new ProtocolError(code,'远程 MCP 尚未连接、配置已变更或本次会话未获确认');}

/** Trusted composition only. Configuration/connection consent never grants a tool call. */
export function createDesktopRemoteMcpHost({config,confirmConnection=async()=>false,fetch,readRuntime}){
  const selected=config.hostConfiguration(),pin=JSON.stringify(config.binding()),lifetime=new AbortController();
  const service=createBoundRemoteReadonlyMcpHost(selected?{
    endpoint:selected.endpoint,server:selected.server,tool:selected.tool,binding:selected.binding,
    readCurrentBinding:config.binding,revocationSignal:config.revocationSignal(),secretStore:config.secretStore,
    enabled:false,...(fetch?{fetch}:{}),
    ...(readRuntime?{readRunReceipt(query){
      const runtime=readRuntime();if(!runtime)fail('UNSUPPORTED_CAPABILITY');
      const record=runtime.readToolExecutions(query.taskId).find(item=>item.evidenceId===query.runId);
      if(!record)fail('UNAUTHORIZED');
      const intent=runtime.loadCheckpoint(query.taskId,'host-tool-intent');
      if(record.toolName!==selected.tool.descriptor.name || record.toolVersion!==selected.tool.descriptor.version
        || !intent || intent.toolName!==record.toolName || intent.toolVersion!==record.toolVersion
        || intent.arguments.bindingRef!==service.tools[0].descriptor.inputSchema.properties.bindingRef.const
        || remoteMcpArgumentsDigest(intent.arguments.arguments)!==query.argumentsDigest
        || !runtime.matchesToolExecutionInput(record,{arguments:intent.arguments,scopeRef:query.runId}))fail('REVISION_CONFLICT');
      const argumentsDigest=query.argumentsDigest;
      if(record.state==='confirmed'){
        const saved=runtime.loadCheckpoint(query.taskId,'tool-result-'+query.runId);
        if(!saved || !Object.hasOwn(saved,'result') || !record.executionStarted || record.policyDecision!=='allow')fail('EXTERNAL_FAILURE');
        return {argumentsDigest,state:'confirmed',result:saved.result};
      }
      if(record.state==='failed')return {argumentsDigest,state:'failed'};
      if(record.state==='started' && record.executionStarted && record.policyDecision==='allow' && runtime.isToolExecutionActive(record))return undefined;
      return {argumentsDigest,state:'unknown'};
    }}:{}),
  }:undefined);
  let closed=false,busy=false,consent=new AbortController();
  function current(){
    if(closed)fail('UNSUPPORTED_CAPABILITY');
    if(JSON.stringify(config.binding())!==pin)fail('REVISION_CONFLICT');
    if(!selected)fail('UNSUPPORTED_CAPABILITY');
    if(config.snapshot().status==='expired')fail('UNAUTHORIZED');
  }
  function check(signal,deadline){
    if(Date.parse(deadline)<=Date.now() || !Number.isFinite(Date.parse(deadline)) || signal.reason?.name==='TimeoutError')fail('TIMEOUT');
    if(signal.aborted)fail('CANCELLED');current();
  }
  function snapshot(){const active=service.health(),saved=config.snapshot(),changed=JSON.stringify(config.binding())!==pin;
    return {...saved,status:active.connected?'connected':saved.configured&&changed?'reassembly_required':saved.status,
      connected:active.connected,sessionAllowed:active.connected,toolAvailable:active.connected,requiresReassembly:changed,
      ...(active.errorCode?{errorCode:active.errorCode}:{})};}
  return Object.freeze({tools:service.tools,register:host=>service.register(host),snapshot,
    async connect(context){
      const {signal:callerSignal,deadline}=context;
      check(callerSignal,deadline);
      if(busy)fail('REVISION_CONFLICT');
      if(service.health().connected)return snapshot();
      busy=true;consent=new AbortController();
      const signal=AbortSignal.any([callerSignal,config.revocationSignal(),lifetime.signal,consent.signal,AbortSignal.timeout(Math.max(1,Math.min(30000,Date.parse(deadline)-Date.now())))]);
      try{
        const approved=await new Promise((resolve,reject)=>{
          const abort=()=>reject(new ProtocolError(signal.reason?.name==='TimeoutError'?'TIMEOUT':'CANCELLED','远程 MCP 会话确认已结束'));
          signal.addEventListener('abort',abort,{once:true});
          if(signal.aborted){abort();return;}
          Promise.resolve().then(()=>{check(signal,deadline);return confirmConnection(Object.freeze({endpoint:selected.endpoint,
            server:Object.freeze({...selected.server}),toolName:selected.tool.descriptor.name,toolVersion:selected.tool.descriptor.version,
            directoryDigest:selected.binding.directoryDigest,hasCredentials:!!selected.binding.credential,signal,deadline}));})
            .then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
        });
        check(signal,deadline);if(approved!==true)fail('UNAUTHORIZED');
        await service.setEnabled(true);await service.start({signal,deadline});check(signal,deadline);
        return snapshot();
      }catch(error){
        try{await service.setEnabled(false);}catch{/* Preserve the first failure during disposal. */}
        if(JSON.stringify(config.binding())!==pin)fail('REVISION_CONFLICT');
        fail(error instanceof ProtocolError?error.code:'EXTERNAL_FAILURE');
      }finally{busy=false;}
    },
    arguments(input){current();const bindingRef=service.currentConfigurationRef();if(!bindingRef)fail('UNSUPPORTED_CAPABILITY');
      const value={bindingRef,arguments:structuredClone(input)};validateToolValue(service.tools[0].descriptor.inputSchema,value);return value;},
    disconnect(){consent.abort();return service.setEnabled(false);},
    async dispose(){if(closed)return;closed=true;lifetime.abort();await service.dispose();},
  });
}
