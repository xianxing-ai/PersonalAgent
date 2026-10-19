import {ProtocolError} from '@personal-agent/contracts';

/** One trusted native gesture confirms one visible request, never a Policy grant. */
export function createToolPresenceHost({registerNativeShortcut,isTaskCurrent,readTaskBinding,onPrompt,
  now=Date.now,receiptTtlMs=30000,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  if(typeof registerNativeShortcut!=='function'||typeof isTaskCurrent!=='function'||typeof readTaskBinding!=='function'
    ||typeof onPrompt!=='function'||!Number.isSafeInteger(receiptTtlMs)||receiptTtlMs<1||receiptTtlMs>30000)
    throw new ProtocolError('INVALID_ARGUMENT','Trusted native presence ports are required');
  const queue=[],receipts=new Map();let closed=false,unregister,sequence=0,promptId,nativeGeneration=0;
  const failure=(code,message)=>new ProtocolError(code,message);
  const clock=()=>{const value=now();if(!Number.isFinite(value))throw failure('UNAUTHORIZED','Presence clock is unavailable');return value;};
  const binding=taskId=>{try{const value=readTaskBinding(taskId);return isTaskCurrent(taskId)===true&&typeof value==='string'&&value?value:undefined;}catch{return undefined;}};
  const valid=entry=>{try{return !closed&&!entry.signal.aborted&&binding(entry.taskId)===entry.binding
    &&clock()>=entry.requestedAt&&clock()<entry.deadlineMs;}catch{return false;}};
  const detach=()=>{nativeGeneration++;if(!unregister)return;const dispose=unregister;unregister=undefined;try{dispose();}catch{/* No stale registration is reused. */}};
  const remove=entry=>{const index=queue.indexOf(entry);if(index<0)return false;queue.splice(index,1);
    if(entry.timer!==undefined)clearTimer(entry.timer);entry.signal?.removeEventListener('abort',entry.onAbort);return true;};
  const reject=(entry,code,message)=>{if(remove(entry))entry.reject?.(failure(code,message));};
  const revoke=receipt=>{if(receipts.get(receipt.taskId)!==receipt)return;receipts.delete(receipt.taskId);
    receipt.signal.removeEventListener('abort',receipt.onAbort);if(receipt.timer!==undefined)clearTimer(receipt.timer);};
  function publish(){
    while(queue[0]?.kind==='presence'&&!valid(queue[0]))reject(queue[0],queue[0].signal.aborted?'CANCELLED':'UNAUTHORIZED','Pending presence scope expired or changed');
    if(!queue.length){detach();if(promptId!==undefined){promptId=undefined;try{onPrompt({state:'idle'});}catch{}}return false;}
    if(!unregister){try{const generation=++nativeGeneration;const dispose=registerNativeShortcut(()=>{if(generation===nativeGeneration)gesture();});
      if(typeof dispose==='function')unregister=dispose;}catch{}}
    if(!unregister){for(const entry of [...queue])reject(entry,'UNSUPPORTED_CAPABILITY','Native confirmation shortcut is unavailable');return false;}
    const head=queue[0],key=head.id+':'+queue.length;
    if(promptId!==key){promptId=key;
      try{onPrompt({state:'waiting',kind:head.kind,requestId:head.id,...(head.kind==='presence'?{taskId:head.taskId,deadline:head.deadline}:{}),queued:queue.length-1});}
      catch{for(const entry of [...queue])reject(entry,'UNSUPPORTED_CAPABILITY','Native presence prompt is unavailable');detach();promptId=undefined;return false;}}
    return true;
  }
  function gesture(){
    if(closed)return;const head=queue[0];if(!head)return;
    // Never fall through to another request on the same native event.
    if(head.kind==='confirmation'){remove(head);try{head.callback();}catch{}publish();return;}
    if(!valid(head)){reject(head,head.signal.aborted?'CANCELLED':'UNAUTHORIZED','Presence request is no longer current');publish();return;}
    let issuedAt;try{issuedAt=clock();}catch{reject(head,'UNAUTHORIZED','Presence clock is unavailable');publish();return;}
    if(issuedAt>=head.deadlineMs){reject(head,'TIMEOUT','Presence request expired');publish();return;}
    const expiresAtMs=Math.min(head.deadlineMs,issuedAt+receiptTtlMs);
    remove(head);const prior=receipts.get(head.taskId);if(prior)revoke(prior);
    const receipt={taskId:head.taskId,binding:head.binding,signal:head.signal,issuedAt,expiresAtMs,
      onAbort:()=>revoke(receipt),timer:undefined};
    receipts.set(receipt.taskId,receipt);receipt.signal.addEventListener('abort',receipt.onAbort,{once:true});
    receipt.timer=setTimer(()=>revoke(receipt),Math.max(1,expiresAtMs-issuedAt));receipt.timer?.unref?.();
    if(receipt.signal.aborted)revoke(receipt);
    head.resolve(Object.freeze({taskId:head.taskId,expiresAt:new Date(expiresAtMs).toISOString()}));publish();
  }
  const host={
    requestPresence(input){
      if(closed)return Promise.reject(failure('UNSUPPORTED_CAPABILITY','Presence host is closed'));
      if(!input||typeof input.taskId!=='string'||!input.taskId||!(input.signal instanceof AbortSignal)
        ||typeof input.deadline!=='string'||!Number.isFinite(Date.parse(input.deadline)))
        return Promise.reject(failure('INVALID_ARGUMENT','Original task presence scope is required'));
      const {taskId,deadline,signal}=input,deadlineMs=Date.parse(deadline);let requestedAt;
      try{requestedAt=clock();}catch(error){return Promise.reject(error);}
      if(signal.aborted)return Promise.reject(failure('CANCELLED','Presence request cancelled'));
      if(deadlineMs<=requestedAt)return Promise.reject(failure('TIMEOUT','Presence request expired'));
      const originalBinding=binding(taskId);if(!originalBinding)return Promise.reject(failure('UNAUTHORIZED','Task is outside the current trusted session'));
      return new Promise((resolve,rejectPromise)=>{
        const entry={kind:'presence',id:'presence-'+(++sequence),taskId,deadline,deadlineMs,signal,binding:originalBinding,requestedAt,resolve,reject:rejectPromise,
          onAbort:()=>{reject(entry,'CANCELLED','Presence request cancelled');publish();},timer:undefined};
        queue.push(entry);signal.addEventListener('abort',entry.onAbort,{once:true});
        entry.timer=setTimer(()=>{reject(entry,'TIMEOUT','Presence request expired');publish();},Math.min(2147483647,deadlineMs-requestedAt));entry.timer?.unref?.();
        if(signal.aborted)entry.onAbort();else publish();
      });
    },
    isUserPresent(taskId){
      const receipt=receipts.get(taskId);if(!receipt)return false;
      try{const time=clock();if(closed||receipt.signal.aborted||binding(taskId)!==receipt.binding||time<receipt.issuedAt||time>=receipt.expiresAtMs){revoke(receipt);return false;}}
      catch{revoke(receipt);return false;}return true;
    },
    /** Legacy Notepad owns its task/target binding; it gets no reusable broker receipt. */
    registerConfirmation(callback){
      if(closed||queue.length||typeof callback!=='function')return undefined;
      const entry={kind:'confirmation',id:'confirmation-'+(++sequence),callback};queue.push(entry);
      if(!publish())return undefined;let active=true;
      return()=>{if(!active)return;active=false;remove(entry);publish();};
    },
    close(){if(closed)return;closed=true;for(const entry of [...queue])reject(entry,'CANCELLED','Presence host closed');
      for(const receipt of [...receipts.values()])revoke(receipt);detach();promptId=undefined;try{onPrompt({state:'idle'});}catch{}},
  };
  const descriptor={name:'desktop.request_presence',version:'1.0.0',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    outputSchema:{type:'object',properties:{state:{type:'string',enum:['present']},expiresAt:{type:'string'},authorizationGranted:{type:'boolean',enum:[false]}},
      required:['state','expiresAt','authorizationGranted'],additionalProperties:false},
    sideEffect:'read',requiredScopes:['desktop:request_presence'],requiresPresence:false,idempotencySupport:true,recoverySupport:true};
  const empty=input=>input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===0;
  host.tools=[{descriptor,execute:async(input,context)=>{
    if(!empty(input))throw failure('INVALID_ARGUMENT','Presence request takes no model-supplied scope');
    const receipt=await host.requestPresence(context);
    return {state:'present',expiresAt:receipt.expiresAt,authorizationGranted:false};
  }}];
  host.competitionToolAvailability=[{toolName:descriptor.name,toolVersion:descriptor.version,
    available:({taskId,deadline,signal})=>{try{return !closed&&!signal.aborted&&!!binding(taskId)&&Date.parse(deadline)>clock();}catch{return false;}}}];
  host.competitionToolExports=[{toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'native-task-presence-v1',
    accepts:({taskId,arguments:args,signal})=>!closed&&!signal?.aborted&&!!binding(taskId)&&empty(args),
    project:({taskId,result,signal})=>{
      const receipt=receipts.get(taskId);
      if(signal.aborted||!host.isUserPresent(taskId)||result?.state!=='present'||result?.authorizationGranted!==false
        ||result?.expiresAt!==new Date(receipt.expiresAtMs).toISOString())throw failure('UNAUTHORIZED','Native presence receipt is no longer current');
      return {state:'present',expiresAt:result.expiresAt,authorizationGranted:false};
    }}];
  return host;
}
