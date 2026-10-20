import {Worker} from 'node:worker_threads';
import {ProtocolError} from '@personal-agent/contracts';
import {capturePreparedDependencyFingerprintSync,hasPreparedCodingDependenciesSync} from './isolated-dependencies-internal.js';
import type {IsolatedDependencyPreparation as InternalPreparation} from './isolated-dependencies-internal.js';

export {capturePreparedDependencyFingerprintSync,hasPreparedCodingDependenciesSync};
export type IsolatedDependencyPreparation=Omit<InternalPreparation,'assertCurrent'>;
export interface DependencyFingerprintOptions {signal:AbortSignal;deadline?:string;now?:()=>number}

/** One FS operation in a disposable thread. No task queue, commands or inherited credentials. */
async function inWorker<T>(operation:string,data:Record<string,unknown>,options:DependencyFingerprintOptions):Promise<T> {
  const now=options.now??Date.now;
  const failure=()=>options.signal.aborted?'CANCELLED':options.deadline!==undefined
    &&(!Number.isFinite(Date.parse(options.deadline))||now()>=Date.parse(options.deadline))?'TIMEOUT':undefined;
  const rejected=(code:string)=>new ProtocolError(code as 'CANCELLED'|'TIMEOUT',code==='CANCELLED'?'Dependency operation cancelled':'Dependency operation expired');
  const initial=failure();if(initial)throw rejected(initial);
  const buffer=new SharedArrayBuffer(4),flag=new Int32Array(buffer);
  return await new Promise<T>((resolve,reject)=>{
    let reply:any,workerError=false;
    const worker=new Worker(new URL('./isolated-dependencies-worker.js',import.meta.url),{env:{},execArgv:[],
      workerData:{operation,data,buffer,...(options.deadline?{deadline:new Date(Date.parse(options.deadline)-now()+Date.now()).toISOString()}:{})}});
    const cancel=()=>{const code=failure();if(code)Atomics.store(flag,0,code==='CANCELLED'?1:2);};
    options.signal.addEventListener('abort',cancel,{once:true});
    const timer=setInterval(cancel,25);cancel();
    worker.on('message',value=>{reply=value;});worker.on('error',()=>{workerError=true;});
    worker.on('exit',code=>{
      clearInterval(timer);options.signal.removeEventListener('abort',cancel);
      const stale=failure();if(stale){reject(rejected(stale));return;}
      if(code!==0||workerError||!reply){reject(new ProtocolError('UNSUPPORTED_CAPABILITY','Dependency worker did not complete'));return;}
      if(reply.error){reject(new ProtocolError(reply.error.code,reply.error.message));return;}
      resolve(reply.value as T);
    });
  });
}
export async function capturePreparedDependencyFingerprint(root:string,options:DependencyFingerprintOptions):Promise<string|undefined> {
  return inWorker('fingerprint',{root},options);
}
export async function prepareIsolatedCodingDependencies(input:IsolatedDependencyPreparation):Promise<{ready:boolean;reason?:string}> {
  const {signal,now,...data}=input;
  return inWorker('prepare',data,{signal,deadline:input.deadline,...(now?{now}:{})});
}
