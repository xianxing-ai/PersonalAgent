import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';

const NAME='computer.system.observe',VERSION='1.0.0';
const fail=()=>{throw new ProtocolError('UNAUTHORIZED','Original system observation export is unavailable');};
const empty=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===0;
const signalLike=value=>typeof value?.aborted==='boolean'&&typeof value.addEventListener==='function'
  &&typeof value.removeEventListener==='function';

/** Export boundary for the original RegisteredTool. No sampling or permission is started at setup. */
export function createSystemObservationConversation({getApplication,resolveUserConversation,tool,confirmExport,now=Date.now}) {
  if(typeof getApplication!=='function'||typeof resolveUserConversation!=='function'
    ||tool?.descriptor?.name!==NAME||tool.descriptor.version!==VERSION||tool.descriptor.sideEffect!=='read'
    ||typeof tool.execute!=='function')throw Error('Original system observation RegisteredTool is required');
  const permits=new Map(),pending=new Set();let closed=false;
  function current(taskId,signal,deadline) {
    if(closed||typeof confirmExport!=='function'||!signalLike(signal)||signal.aborted)fail();
    const application=getApplication(),runtime=application?.runtime,task=runtime?.getTask(taskId);
    const originalDeadline=runtime?.loadCheckpoint(taskId,'application-deadline');
    const conversationId=resolveUserConversation(taskId);
    if(task?.state!=='running'||task.cancelRequested||!conversationId||typeof conversationId!=='string'
      ||runtime.loadCheckpoint(taskId,'application-profile')!=='huawei_ict_agentarts'
      ||typeof originalDeadline!=='string'||!Number.isFinite(Date.parse(originalDeadline))
      ||!(Date.parse(originalDeadline)>now())||(deadline!==undefined&&deadline!==originalDeadline)
      ||runtime.loadCheckpoint(taskId,'private-copy-erasure')!==undefined
      ||runtime.loadCheckpoint(taskId,'private-copy-erasure-binding')!==undefined)fail();
    return {application,runtime,conversationId,deadline:originalDeadline,taskId,signal};
  }
  function proposal(scope,proposalId) {
    const loop=scope.runtime.loadCheckpoint(scope.taskId,'competition-loop'),value=loop?.pending;
    if(!Number.isSafeInteger(loop?.step)||value?.kind!=='tool_proposal'||value.proposalId!==proposalId
      ||value.toolName!==NAME||value.toolVersion!==VERSION||!empty(value.arguments))fail();
    return {runId:`competition-tool-${scope.taskId}-${loop.step}`};
  }
  function original(scope,runId) {
    const execution=scope.runtime.readToolExecutions(scope.taskId).find(value=>value.evidenceId===runId);
    if(execution?.toolName!==NAME||execution.toolVersion!==VERSION||execution.state!=='confirmed'
      ||execution.policyDecision!=='allow'||!execution.executionStarted
      ||!scope.runtime.matchesToolExecutionInput(execution,{arguments:{},scopeRef:runId}))fail();
    const result=scope.runtime.loadCheckpoint(scope.taskId,'tool-result-'+runId)?.result;
    validateToolValue(tool.descriptor.outputSchema,result);
    const value={source:result.source,capturedAt:result.capturedAt,
      ...(result.sampledFrom===undefined?{}:{sampledFrom:result.sampledFrom}),
      ...(result.sampledUntil===undefined?{}:{sampledUntil:result.sampledUntil}),
      ...(result.actualSampleWindowMs===undefined?{}:{actualSampleWindowMs:result.actualSampleWindowMs}),
      requestedSampleWindowMs:result.requestedSampleWindowMs,
      cpu:{logicalProcessorCount:result.cpu.logicalProcessorCount,utilizationPercent:result.cpu.utilizationPercent},
      memory:{totalBytes:result.memory.totalBytes,freeBytes:result.memory.freeBytes,usedBytes:result.memory.usedBytes,
        utilizationPercent:result.memory.utilizationPercent},uptimeSeconds:result.uptimeSeconds,
      unavailable:[...result.unavailable]};
    if(Buffer.byteLength(JSON.stringify(value),'utf8')>4096)fail();
    return value;
  }
  const key=(taskId,proposalId)=>JSON.stringify([taskId,proposalId]);
  const availability={toolName:NAME,toolVersion:VERSION,available:input=>{
    try{if(typeof input?.deadline!=='string')return false;
      const scope=current(input.taskId,input.signal,input.deadline);
      return Number.isSafeInteger(input.revision)&&scope.runtime.getTask(input.taskId).revision===input.revision;
    }catch{return false;}
  }};
  const exportPolicy={toolName:NAME,toolVersion:VERSION,exportPolicyVersion:'system-observation-native-exact-v1',
    accepts:input=>{
      try {
        const scope=current(input.taskId,input.signal);if(!empty(input.arguments))return false;
        if(input.phase==='preflight'){proposal(scope,input.proposalId);return true;}
        const permit=permits.get(key(input.taskId,input.proposalId));
        return !!permit&&!permit.signal.aborted&&permit.deadline===scope.deadline
          &&permit.conversationId===scope.conversationId&&isDeepStrictEqual(input.projection,permit.payload)
          &&isDeepStrictEqual(original(scope,permit.runId),permit.payload);
      }catch{return false;}
    },
    project:async({taskId,proposalId,result,signal})=>{
      const scope=current(taskId,signal),{runId}=proposal(scope,proposalId),payload=original(scope,runId);
      if(!isDeepStrictEqual(payload,result))fail();
      const controller=new AbortController();let timer,onAbort;
      const interrupted=new Promise((_,reject)=>{
        onAbort=()=>{controller.abort();reject(new ProtocolError('UNAUTHORIZED','System observation export was cancelled or expired'));};
        signal.addEventListener('abort',onAbort,{once:true});
        timer=setTimeout(onAbort,Math.max(1,Math.min(2_147_483_647,Date.parse(scope.deadline)-now())));
        if(signal.aborted)onAbort();
      });
      pending.add(onAbort);
      try {
        const allowed=await Promise.race([Promise.resolve().then(()=>{
          current(taskId,signal,scope.deadline);if(controller.signal.aborted)fail();
          return confirmExport({kind:'system_observation',taskId,conversationId:scope.conversationId,proposalId,
            payload:structuredClone(payload),deadline:scope.deadline,signal:controller.signal});
        }),interrupted]);
        if(allowed!==true)fail();
        const checked=current(taskId,signal,scope.deadline);
        if(checked.conversationId!==scope.conversationId||!isDeepStrictEqual(original(checked,runId),payload))fail();
        for(const [id,permit]of permits)try{current(permit.taskId,permit.signal,permit.deadline);}catch{permits.delete(id);}
        if(permits.size>=128&&!permits.has(key(taskId,proposalId)))fail();
        permits.set(key(taskId,proposalId),{taskId,runId,signal,deadline:scope.deadline,conversationId:scope.conversationId,payload});
        return structuredClone(payload);
      } finally {clearTimeout(timer);signal.removeEventListener('abort',onAbort);pending.delete(onAbort);}
    }};
  return {tools:[tool],competitionToolAvailability:[availability],competitionToolExports:[exportPolicy],
    close(){closed=true;permits.clear();for(const cancel of pending)cancel();pending.clear();}};
}
