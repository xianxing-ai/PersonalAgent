import {randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {performance} from 'node:perf_hooks';
const fields=new Set(['taskId','sessionId','requestId','workflowId','nodeId','itemId','operationId','sourceId','eventId','branch','modelRef','channel']);
/** Diagnostic spans only. No request text, credentials, authorization, task state or persistence. */
export function createStageTimeline({onRecord=()=>{},clock=()=>new Date(),monotonic=()=>performance.now(),traceId=randomUUID()}={}) {
  if(typeof onRecord!=='function'||typeof clock!=='function'||typeof monotonic!=='function')throw TypeError('Timing callbacks required');
  const emit=record=>{try{onRecord(structuredClone(record));}catch{/* diagnostics never replace the actual operation result */}};
  function start(stage,metadata={}) {
    if(typeof stage!=='string'||!/^[a-zA-Z0-9_.:-]+$/.test(stage))throw TypeError('Stable stage name required');
    const context=Object.fromEntries(Object.entries(metadata).filter(([key,value])=>fields.has(key)&&typeof value==='string'&&value.length<=256));
    const startedAtUtc=clock().toISOString(),begin=monotonic(),spanId=randomUUID();
    emit({event:'stage_timing',traceId,spanId,stage,status:'started',startedAtUtc,...context});
    let completed;
    return (status='completed',error)=>{
      if(completed)return structuredClone(completed);
      const finishedAtUtc=clock().toISOString(),wallMs=Math.max(0,monotonic()-begin);
      completed={event:'stage_timing',traceId,spanId,stage,status,startedAtUtc,finishedAtUtc,wallMs,...context,
        ...(error?{errorCode:error instanceof ProtocolError?error.code:'EXTERNAL_FAILURE'}:{})};
      emit(completed);return structuredClone(completed);
    };
  }
  return {start,async run(stage,work,metadata={}) {
    const finish=start(stage,metadata);
    try{const value=await work();finish();return value;}catch(error){finish('failed',error);throw error;}
  }};
}
