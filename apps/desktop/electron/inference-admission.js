import {ProtocolError} from '@personal-agent/contracts';

/** One owned model, one execution slot, a removable bounded FIFO. Cancelled waiting callers do
 * not leave a Promise-tail chain retaining inputs behind a slow provider. Accepted work remains
 * accepted when the resource budget drops; the new limit applies only to new admissions. */
export function createInferenceAdmission({getLimit=()=>16}={}) {
  let active=false;const waiting=[];
  function lease() {
    active=true;let released=false;
    return ()=>{if(released)return;released=true;active=false;
      const next=waiting.shift();if(next){next.signal.removeEventListener('abort',next.abort);next.resolve(lease());}};
  }
  return {
    acquire(signal) {
      if(signal.aborted)return Promise.reject(signal.reason);
      if(!active)return Promise.resolve(lease());
      const limit=Math.max(1,Math.min(16,Math.trunc(Number(getLimit())||16)));
      if(waiting.length>=limit)return Promise.reject(new ProtocolError('RATE_LIMITED','Local Laya inference queue is full',true,1000));
      return new Promise((resolve,reject)=>{
        const entry={signal,resolve,reject,abort:()=>{
          const index=waiting.indexOf(entry);if(index>=0)waiting.splice(index,1);
          signal.removeEventListener('abort',entry.abort);reject(signal.reason);
        }};
        waiting.push(entry);signal.addEventListener('abort',entry.abort,{once:true});
        if(signal.aborted)entry.abort();
      });
    },
    snapshot(){return {active:Number(active),queued:waiting.length};},
  };
}
