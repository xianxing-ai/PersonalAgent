import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {createProactiveConnectorHost} from '@personal-agent/connector-host';
import type {ProactiveCheckpoint,ProactiveCheckpointPort} from '@personal-agent/connector-host';

/** Existing TaskRuntime atomic state adapter, structurally injected. No new DB, table or scheduler. */
export interface ProactiveAtomicStatePort {
  read(key:string):{revision:number;value:unknown}|undefined;
  compareAndSet(key:string,expectedRevision:number|undefined,nextValue:unknown):boolean;
}
export function createProactiveCheckpointAdapter(atomic:ProactiveAtomicStatePort):ProactiveCheckpointPort {
  const key=(sourceId:string)=>'proactive-source:'+createHash('sha256').update(sourceId).digest('hex');
  return {read(sourceId){
    const saved=atomic.read(key(sourceId));if(!saved)return undefined;
    const value=saved.value as ProactiveCheckpoint;
    if(value?.sourceId!==sourceId||value.revision!==saved.revision)
      throw new ProtocolError('REVISION_CONFLICT','Source checkpoint and atomic envelope revisions differ');
    return structuredClone(value);
  },compareAndSet(sourceId,expectedRevision,next){
    if(next.sourceId!==sourceId||next.revision!==(expectedRevision??0)+1)
      throw new ProtocolError('REVISION_CONFLICT','Source checkpoint must advance exactly one atomic revision');
    return atomic.compareAndSet(key(sourceId),expectedRevision,structuredClone(next));
  }};
}
export function createRuntimeProactiveConnectorHost(options:Omit<Parameters<typeof createProactiveConnectorHost>[0],'checkpoints'>&{atomicState:ProactiveAtomicStatePort}) {
  const {atomicState,...configuration}=options;
  return createProactiveConnectorHost({...configuration,checkpoints:createProactiveCheckpointAdapter(atomicState)});
}
