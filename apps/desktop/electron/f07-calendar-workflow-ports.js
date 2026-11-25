import {isDeepStrictEqual} from 'node:util';
import {calendarSnapshotVersion} from '@personal-agent/calendar';
import {ProtocolError} from '@personal-agent/contracts';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
const version=result=>{
  if(!result||result.hasMore!==false||result.nextCursor!==''||!Array.isArray(result.items)||!result.window
    ||result.sourceVersion!==calendarSnapshotVersion(result.window,result.items))
    fail('UNSUPPORTED_CAPABILITY','F07 requires a complete original calendar window');
  return result.sourceVersion;
};

/** Fixed child actions must map recheck to calendar.events and create to calendar.create.
 * Source versions cover the exact bounded read, never the whole account or an atomic write lease. */
export function createF07CalendarWorkflowPorts({getApplication,bridge,authorizeExport,now=Date.now}={}) {
  if(typeof getApplication!=='function'||typeof bridge?.invoke!=='function'||typeof authorizeExport!=='function')
    throw Error('F07 requires Runtime binding and child Policy bridge');
  const binding=scope=>{
    if(scope.signal.aborted||Date.parse(scope.deadline)<=now())fail('CANCELLED','F07 operation is no longer active');
    const bound=getApplication().readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId:'F07',
      sessionId:scope.sessionId,signal:scope.signal});
    if(!bound||bound.deadline!==scope.deadline)fail('UNAUTHORIZED','F07 original workflow binding unavailable');
    return bound;
  };
  const baseline=scope=>{
    const bound=binding(scope),read=bound.confirmedOperations.find(op=>op.nodeId==='F07_N02'&&op.toolName==='calendar.events');
    const intent=read&&getApplication().runtime.loadCheckpoint(read.localTaskId,'host-tool-intent');
    if(!read||!isDeepStrictEqual(intent?.arguments,bound.input.calendarReadArguments))
      fail('UNAUTHORIZED','F07 original calendar read unavailable');
    return {bound,sourceVersion:version(read.result)};
  };
  return {
    assertCurrent:scope=>{binding(scope);},
    async verifyReadBinding(scope,input){
      const read=baseline(scope);return input.calendarVersionAtRead===read.sourceVersion&&input.calendarVersionNow===read.sourceVersion;
    },
    async readSourceVersion(scope,context,phase='execute'){
      if(!['execute','before_export','after_export'].includes(phase))fail('UNAUTHORIZED','F07 read phase is not host configured');
      const {bound}=baseline(scope),receipt=await bridge.invoke({actionKey:'f07.calendar.recheck.'+phase,input:bound.input.calendarReadArguments},context);
      binding(scope);
      if(receipt.toolName!=='calendar.events'||!isDeepStrictEqual(receipt.arguments,bound.input.calendarReadArguments))
        fail('UNAUTHORIZED','F07 fresh read receipt changed');
      return version(receipt.result);
    },
    async verifyWriteBinding(scope,input){
      const {bound,sourceVersion}=baseline(scope),fresh=bound.confirmedOperations.find(op=>op.nodeId==='F07_N04'&&op.toolName==='workflow.host.f07_n04');
      return isDeepStrictEqual(input,{title:bound.input.title,slot:bound.input.slot})
        &&fresh?.result?.versionConsistent===true&&fresh.result.sourceVersion===sourceVersion;
    },
    async invokeCalendarCreate(input,context,scope){
      const receipt=await bridge.invoke({actionKey:'f07.calendar.create',input:structuredClone(input)},context);
      if(receipt.toolName!=='calendar.create'||!isDeepStrictEqual(receipt.arguments,input)
        ||receipt.result?.state!=='created'||receipt.result.item?.source!=='calendar'
        ||receipt.result.item.validFor!==input.startUtc+'/'+input.endUtc)
        fail('RESULT_UNKNOWN','F07 confirmed calendar creation readback unavailable');
      binding(scope);
      const original={operationId:scope.operationId,taskId:receipt.taskId,runId:receipt.runId,
        toolVersion:receipt.toolVersion,scopeRef:receipt.scopeRef,arguments:receipt.arguments};
      const runtime=getApplication().runtime,key='f07:created:'+scope.sessionId;
      runtime.saveCheckpointOnce(scope.parentTaskId,key,original);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(scope.parentTaskId,key),original))
        fail('REVISION_CONFLICT','F07 original calendar child changed');
      return receipt.result;
    },
    readCreatedEvent(scope){
      const bound=binding(scope),app=getApplication(),saved=app.runtime.loadCheckpoint(scope.parentTaskId,'f07:created:'+scope.sessionId);
      const host=bound.confirmedOperations.find(op=>op.nodeId==='F07_N05'&&op.toolName==='workflow.host.f07_n05');
      const expected={summary:bound.input.title,startUtc:bound.input.slot.startUtc,endUtc:bound.input.slot.endUtc,
        ...(bound.input.slot.location!==undefined?{location:bound.input.slot.location}:{})};
      if(!saved||saved.operationId!==host?.operationId||!isDeepStrictEqual(saved.arguments,expected))
        fail('UNAUTHORIZED','F07 original calendar child binding unavailable');
      const readback=app.readHostToolTask(saved.taskId),record=app.runtime.readToolExecutions(saved.taskId).find(item=>item.evidenceId===saved.runId);
      if(readback.toolName!=='calendar.create'||readback.task.state!=='succeeded'||readback.confirmed?.runId!==saved.runId
        ||!readback.confirmed.evidenceRefs.includes(saved.runId)||!record||record.toolName!=='calendar.create'
        ||record.toolVersion!==saved.toolVersion||record.policyDecision!=='allow'||!record.executionStarted||record.state!=='confirmed'
        ||!app.runtime.matchesToolExecutionInput(record,{arguments:saved.arguments,scopeRef:saved.scopeRef})
        ||readback.confirmed.result?.state!=='created'||readback.confirmed.result.item?.source!=='calendar'
        ||readback.confirmed.result.item.validFor!==expected.startUtc+'/'+expected.endUtc)
        fail('RESULT_UNKNOWN','F07 original calendar creation proof unavailable');
      return structuredClone(readback.confirmed.result.item);
    },
    async authorizeExport(scope,result){binding(scope);const allowed=await authorizeExport(scope,result);binding(scope);return allowed===true;},
  };
}
