import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RuntimeApplication} from './runtime-application.js';
import type {OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {readWorkflowBusinessToolSource} from './workflow-business-tool-bridge.js';

export type F16SourceRead={taskId:string;runId:string;toolVersion:string;scopeRef:string;arguments:Record<string,unknown>};
export type F16SourceApplication=Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
export const sourceObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const sourceText=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=2048;
export function sourceFailure(message:string):never {throw new ProtocolError('UNAUTHORIZED',message);}

/** Read only original confirmed child receipts. Never dispatch, reconcile or replay. */
export function readF16Source(application:F16SourceApplication,scope:Pick<OwnedWorkflowHostScope,'parentTaskId'|'deadline'>&{sessionId?:string},
  ref:F16SourceRead,toolName:string) {
  if(!sourceObject(ref)||![ref.taskId,ref.runId,ref.toolVersion,ref.scopeRef].every(sourceText)||!sourceObject(ref.arguments)
    ||ref.runId!=='host-tool-'+ref.taskId||ref.scopeRef!==ref.runId)sourceFailure('Original source identity unavailable');
  const {runtime}=application;
  const parent=runtime.loadCheckpoint(ref.taskId,'coding-repair:parent');
  const intent=runtime.loadCheckpoint(ref.taskId,'host-tool-intent');
  if(sourceObject(parent)&&parent.taskId!==scope.parentTaskId){
    if(!sourceText(scope.sessionId))sourceFailure('Original business source session unavailable');
    const proof=readWorkflowBusinessToolSource(application,{parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,
      deadline:scope.deadline},ref,toolName);
    const read=application.readHostToolTask(ref.taskId);
    return structuredClone({ref,read,record:proof.record,result:proof.receipt.result,
      provenance:{kind:'business' as const,proof}});
  }
  if(!sourceObject(parent)||parent.taskId!==scope.parentTaskId||!sourceText(parent.operationId)
    ||!sourceObject(intent)||intent.commandId!==parent.operationId||intent.toolName!==toolName||intent.toolVersion!==ref.toolVersion
    ||intent.deadline!==scope.deadline||!isDeepStrictEqual(intent.arguments,ref.arguments))sourceFailure('Original source parent or intent changed');
  const original=runtime.loadCheckpoint(scope.parentTaskId,'coding-repair:host:'+parent.operationId);
  if(!sourceObject(original)||original.localTaskId!==ref.taskId||!sourceObject(original.request)
    ||original.request.commandId!==parent.operationId||original.request.toolName!==toolName||original.request.toolVersion!==ref.toolVersion
    ||original.request.deadline!==scope.deadline||!isDeepStrictEqual(original.request.arguments,ref.arguments))
    sourceFailure('Original source host binding changed');
  const read=application.readHostToolTask(ref.taskId),record=runtime.readToolExecutions(ref.taskId).find(v=>v.evidenceId===ref.runId);
  const saved=runtime.loadCheckpoint(ref.taskId,'tool-result-'+ref.runId);
  if(read.task.taskId!==ref.taskId||read.task.state!=='succeeded'||read.task.cancelRequested||read.commandId!==parent.operationId
    ||read.toolName!==toolName||read.toolVersion!==ref.toolVersion||read.confirmed?.runId!==ref.runId
    ||!read.confirmed.evidenceRefs.includes(ref.runId)||!read.task.evidenceRefs.includes(ref.runId)
    ||!record||record.taskId!==ref.taskId||record.toolName!==toolName||record.toolVersion!==ref.toolVersion
    ||record.policyDecision!=='allow'||!record.executionStarted||record.state!=='confirmed'
    ||!runtime.matchesToolExecutionInput(record,{arguments:ref.arguments,scopeRef:ref.scopeRef})
    ||!sourceObject(saved)||!Object.hasOwn(saved,'result')||!isDeepStrictEqual(saved.result,read.confirmed.result))
    sourceFailure('Original source is not confirmed');
  return structuredClone({ref,read,record,result:saved.result,provenance:{kind:'direct' as const,parent,intent,original}});
}

export function assertF16SourceAction(source:ReturnType<typeof readF16Source>,scope:OwnedWorkflowHostScope,actionKey:string) {
  if(source.provenance.kind==='business'){
    const proof=source.provenance.proof;
    if(proof.sourceHost.taskId!==scope.localTaskId||proof.sourceHost.runId!=='host-tool-'+scope.localTaskId
      ||proof.graph.operationId!==scope.operationId||proof.actionKey!==actionKey)sourceFailure('Original business action changed');
  }else if(source.read.commandId!==scope.localTaskId+':'+actionKey)sourceFailure('Original direct action changed');
}

/** Bound uncooperative trusted ports too; expiry never starts another operation. */
export async function awaitF16Port<T>(scope:OwnedWorkflowHostScope,now:()=>Date,work:()=>Promise<T>):Promise<T> {
  const check=()=>{
    if(scope.signal.aborted)throw new ProtocolError('CANCELLED','Original workflow cancelled');
    const remaining=Date.parse(scope.deadline)-now().getTime();
    if(!Number.isFinite(remaining)||remaining<=0)throw new ProtocolError('TIMEOUT','Original workflow expired');
    return remaining;
  };
  check();let timer:ReturnType<typeof setTimeout>|undefined;let abort=()=>{};
  try {
    const interrupted=new Promise<never>((_,reject)=>{
      abort=()=>reject(new ProtocolError('CANCELLED','Original workflow cancelled'));
      scope.signal.addEventListener('abort',abort,{once:true});
      const expire=()=>{try{timer=setTimeout(expire,Math.min(check(),2_147_483_647));}catch(error){reject(error);}};
      expire();
    });
    const result=await Promise.race([interrupted,Promise.resolve().then(()=>{check();return work();})]);
    check();return result;
  }finally{clearTimeout(timer);scope.signal.removeEventListener('abort',abort);}
}
