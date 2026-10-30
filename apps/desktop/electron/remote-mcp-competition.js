import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deny=()=>{throw new ProtocolError('UNAUTHORIZED','远程 MCP 公开结果许可不可用');};

/** Trusted composition: an explicitly PUBLIC, exact input and bounded text projection only. */
export function createRemoteMcpCompetition({host,config,readApplication,question}){
  const selected=config.hostConfiguration(),policy=selected?.publicExport,tool=host.tools[0];
  if(!policy || !tool)return {competitionToolAvailability:[],competitionToolExports:[],prepare:async()=>{}};
  const pin=JSON.stringify(config.binding()),requests=new Map(),requirementId='remote-mcp-public-export';
  const schema={type:'object',properties:{text:{type:'string',maxLength:policy.maxBytes}},required:['text'],additionalProperties:false};
  const identity=scope=>JSON.stringify([scope.taskId,scope.proposalId]);
  function current(taskId,signal){
    if(signal?.aborted || JSON.stringify(config.binding())!==pin || !host.snapshot().connected)return false;
    try{const app=readApplication(),task=app.runtime.getTask(taskId);
      return !task.cancelRequested && ['running','waiting_approval'].includes(task.state)
        && host.arguments(policy.arguments).bindingRef===tool.descriptor.inputSchema.properties.bindingRef.const;
    }catch{return false;}
  }
  function original(scope){
    const app=readApplication(),loop=app?.runtime.loadCheckpoint(scope.taskId,'competition-loop');
    const pending=loop?.pending?.proposalId===scope.proposalId && scope.runId===`competition-tool-${scope.taskId}-${loop.step}`
      ?loop.pending:undefined;
    const proposal=pending??loop?.receipts?.find(item=>item.runId===scope.runId && item.proposal?.proposalId===scope.proposalId)?.proposal;
    if(!current(scope.taskId,scope.signal) || !proposal || proposal.toolName!==tool.descriptor.name
      || proposal.toolVersion!==tool.descriptor.version
      || !isDeepStrictEqual(proposal.arguments,host.arguments(policy.arguments)))deny();
    return proposal;
  }
  function confirmed(scope){
    const app=readApplication();original(scope);
    const record=app.runtime.readToolExecutions(scope.taskId).find(item=>item.evidenceId===scope.runId);
    const args=host.arguments(policy.arguments),task=app.runtime.getTask(scope.taskId);
    if(!record || record.state!=='confirmed' || !record.executionStarted || record.policyDecision!=='allow'
      || record.toolName!==tool.descriptor.name || record.toolVersion!==tool.descriptor.version
      || !app.runtime.matchesToolExecutionInput(record,{arguments:args,scopeRef:scope.runId})
      || !task.evidenceRefs.includes(scope.runId))deny();
    const result=app.runtime.loadCheckpoint(scope.taskId,'tool-result-'+scope.runId)?.result;
    if(typeof result?.text!=='string' || Buffer.byteLength(result.text,'utf8')>policy.maxBytes
      || /(?:^|[\s"'(])(?:[a-z]:[\\/]|\\\\|\/(?:users|home|etc|var|tmp)\/)|\bBearer\s+\S+|\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+/i.test(result.text))deny();
    const credential=config.binding()?.credential;
    if(credential){const token=config.secretStore.read(credential.secretRef,scope.signal);if(token && result.text.includes(token))deny();}
    return {text:result.text};
  }
  const availability={toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,publicEnumPaths:['/bindingRef'],
    available:async({taskId,signal,deadline})=>{if(!current(taskId,signal))return false;
      try{await host.verifyDirectory({signal,deadline});return current(taskId,signal);}catch{return false;}}};
  const exportPolicy={toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'remote-mcp-explicit-public-text-v1',
    accepts(input){try{
      if(!current(input.taskId,input.signal) || !isDeepStrictEqual(input.arguments,host.arguments(policy.arguments)))return false;
      if(input.phase!=='final')return true;
      const saved=requests.get(identity(input));if(!saved || !isDeepStrictEqual(input.projection,saved.projection))return false;
      return isDeepStrictEqual(confirmed({...saved.scope,signal:input.signal}),saved.projection)
        && readApplication().readAuthorizationQuestionDestination(input.taskId)===saved.destination
        && question.currentRequirement({...saved.scope,signal:input.signal},requirementId)===true;
    }catch{return false;}},
    project({taskId,proposalId,result,signal}){const saved=requests.get(identity({taskId,proposalId}));if(!saved)deny();
      const value=confirmed({...saved.scope,signal});
      if(!isDeepStrictEqual(value,saved.projection) || !isDeepStrictEqual(result,readApplication().runtime.loadCheckpoint(taskId,'tool-result-'+saved.scope.runId)?.result)
        || readApplication().readAuthorizationQuestionDestination(taskId)!==saved.destination
        || question.currentRequirement({...saved.scope,signal},requirementId)!==true)deny();
      return value;}};
  return {competitionToolAvailability:[availability],competitionToolExports:[exportPolicy],
    async prepare(scope){
      if(scope.proposal?.toolName!==tool.descriptor.name)return;
      const request={...scope,proposalId:scope.proposal.proposalId};original(request);
      const key=identity(request),destination=readApplication().readAuthorizationQuestionDestination(scope.taskId),saved=requests.get(key);
      if(scope.phase==='preflight'){
        if(saved && (saved.scope.runId!==scope.runId || saved.destination!==destination))deny();
        if(saved)return;
        requests.set(key,{scope:request,destination});
        question.prepareExport(request,{requirementId,projectionSchema:schema,
          ruleBindingDigest:hash({pin,policy,destination}),summary:`允许本任务向已选 AgentArts 发送该 PUBLIC MCP 结果的 text 字段，最多 ${policy.maxBytes} 字节。`,
          assertCurrent:()=>current(scope.taskId,scope.signal) && readApplication().readAuthorizationQuestionDestination(scope.taskId)===destination});
      }else if(scope.phase==='projection'){
        if(!saved || saved.scope.runId!==scope.runId || saved.destination!==destination)deny();
        await host.verifyDirectory({signal:scope.signal,deadline:scope.deadline});
        const projection=confirmed(request);question.authorizeExport(request,projection,requirementId);
        await host.verifyDirectory({signal:scope.signal,deadline:scope.deadline});
        if(!current(scope.taskId,scope.signal))deny();
        saved.projection=projection;
      }else deny();
    }};
}

/** Product composition shares the registered service set and original authorization host. */
export function createRemoteMcpCompetitionComposition({services,readApplication,question}){
  const bindings=(services?.list()??[]).flatMap(({id})=>{const {host,config}=services.get(id);
    return host?[createRemoteMcpCompetition({host,config,readApplication,question})]:[];});
  return Object.freeze({
    competitionToolAvailability:bindings.flatMap(item=>item.competitionToolAvailability),
    competitionToolExports:bindings.flatMap(item=>item.competitionToolExports),
    ownsTool:name=>(services?.tools??[]).some(tool=>tool.descriptor.name===name),
    async prepare(scope){for(const binding of bindings)await binding.prepare(scope);},
  });
}
