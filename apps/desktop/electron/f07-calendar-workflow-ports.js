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
      const {bound,sourceVersion}=baseline(scope),fresh=bound.confirmedOperations.find(op=>op.nodeId==='F07_N04');
      return isDeepStrictEqual(input,{title:bound.input.title,slot:bound.input.slot})
        &&fresh?.result?.versionConsistent===true&&fresh.result.sourceVersion===sourceVersion;
    },
    async invokeCalendarCreate(input,context){
      const receipt=await bridge.invoke({actionKey:'f07.calendar.create',input:structuredClone(input)},context);
      if(receipt.toolName!=='calendar.create'||!isDeepStrictEqual(receipt.arguments,input)
        ||receipt.result?.state!=='created'||receipt.result.item?.source!=='calendar'
        ||receipt.result.item.validFor!==input.startUtc+'/'+input.endUtc)
        fail('RESULT_UNKNOWN','F07 confirmed calendar creation readback unavailable');
      return receipt.result;
    },
    async authorizeExport(scope,result){binding(scope);const allowed=await authorizeExport(scope,result);binding(scope);return allowed===true;},
  };
}
