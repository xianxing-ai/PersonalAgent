import {ProtocolError} from '@personal-agent/contracts';
import type {TaskRuntime,TrustedHostStateStore} from './index.js';

export interface RuntimeAtomicStatePort {
  read(key:string):{revision:number;value:unknown}|undefined;
  compareAndSet(key:string,expectedRevision:number|undefined,nextValue:unknown):boolean;
}
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const envelope=(value:unknown):value is {_paAtomicStateVersion:1;revision:number;value:unknown}=>plain(value)
  &&value._paAtomicStateVersion===1&&Number.isSafeInteger(value.revision)&&(value.revision as number)>=1
  &&Object.keys(value).sort().join(',')==='_paAtomicStateVersion,revision,value';
/** Existing Runtime SQLite host namespace, never container disk or another database.
 * Legacy raw values are revision 0 and remain available without destructive migration.
 */
export function createRuntimeAtomicStatePort(runtime:Pick<TaskRuntime,'bindTrustedHostState'>,namespace:string):RuntimeAtomicStatePort & {
  storage:Pick<TrustedHostStateStore,'get'|'set'|'delete'>;
} {
  const store=runtime.bindTrustedHostState(namespace);
  if(typeof store.compareAndSet!=='function')throw new ProtocolError('UNSUPPORTED_CAPABILITY','Atomic Runtime host state unavailable');
  const read=(key:string)=>{
    const value=store.get(key);
    return value===undefined?undefined:envelope(value)?{revision:value.revision,value:structuredClone(value.value)}:{revision:0,value:structuredClone(value)};
  };
  const compareAndSet=(key:string,expectedRevision:number|undefined,nextValue:unknown)=>{
    if(expectedRevision!==undefined&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0))
      throw new ProtocolError('INVALID_ARGUMENT','Invalid expected host revision');
    const original=store.get(key),revision=original===undefined?undefined:envelope(original)?original.revision:0;
    if(revision!==expectedRevision)return false;
    const nextRevision=(revision??0)+1;
    if(!Number.isSafeInteger(nextRevision))throw new ProtocolError('REVISION_CONFLICT','Host state revision exhausted');
    return store.compareAndSet!(key,original,{_paAtomicStateVersion:1,revision:nextRevision,value:structuredClone(nextValue)});
  };
  return {read,compareAndSet,storage:{
    get:key=>read(key)?.value,
    set:(key,value)=>{const old=read(key);if(!compareAndSet(key,old?.revision,value))throw new ProtocolError('REVISION_CONFLICT','Host state changed during update');},
    delete:key=>store.delete(key),
  }};
}
