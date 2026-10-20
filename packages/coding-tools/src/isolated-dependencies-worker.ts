import {parentPort,workerData} from 'node:worker_threads';
import {ProtocolError} from '@personal-agent/contracts';
import {capturePreparedDependencyFingerprintSync,prepareIsolatedCodingDependencies} from './isolated-dependencies-internal.js';

const {operation,data,buffer,deadline}=workerData,flag=new Int32Array(buffer);
const check=()=>{
  const cancelled=Atomics.load(flag,0);
  if(cancelled===1)throw new ProtocolError('CANCELLED','Dependency operation cancelled');
  if(cancelled===2||deadline&&Date.now()>=Date.parse(deadline))throw new ProtocolError('TIMEOUT','Dependency operation expired');
};
try {
  check();
  const value=operation==='fingerprint'?capturePreparedDependencyFingerprintSync(data.root,check)
    :operation==='prepare'?await prepareIsolatedCodingDependencies({...data,deadline,signal:new AbortController().signal,assertCurrent:check})
      :(()=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY','Unknown dependency operation');})();
  check();parentPort!.postMessage({value});
}catch(error){parentPort!.postMessage({error:error instanceof ProtocolError?{code:error.code,message:error.message}
  :{code:'UNSUPPORTED_CAPABILITY',message:'Prepared dependency filesystem could not be verified'}});}
