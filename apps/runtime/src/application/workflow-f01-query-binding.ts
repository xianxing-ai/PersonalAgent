import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeAtomicStatePort} from '../index.js';
import type {RuntimeApplication} from './runtime-application.js';

type Lifetime={deadline:string;signal:AbortSignal};
type Scope=Lifetime & {parentTaskId:string;localTaskId:string;operationId:string;sessionId:string};
type Selection={selectionId:string;parentTaskId:string;sessionId:string;userTaskId:string;
  factId?:string;sourceRef?:string;limit:number};
type Saved={version:1;selection:Selection;goalHash:string};
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=1024&&v.trim()===v;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}
function selectionValid(value:unknown):value is Selection {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).every(key=>['selectionId','parentTaskId','sessionId','userTaskId','factId','sourceRef','limit'].includes(key))
    &&text(v.selectionId)&&text(v.parentTaskId)&&text(v.sessionId)&&text(v.userTaskId)
    &&(v.factId===undefined||text(v.factId))&&(v.sourceRef===undefined||text(v.sourceRef))
    &&(v.factId!==undefined||v.sourceRef!==undefined)&&Number.isSafeInteger(v.limit)&&(v.limit as number)>=1&&(v.limit as number)<=100;
}

/** Trusted composition only: this is not a graph tool or an authorization grant.
 * The gate must synchronously prove the precise native user selection and its
 * current, unrevoked provenance; graph proposals and model text are not proof.
 * Gate and task state must be read from the same Runtime SQLite transaction.
 * Missing such a gate is unsupported. Export is separately checked by Policy. */
export function createF01QueryBinding(options:{
  application:Pick<RuntimeApplication,'runtime'|'readDelegatedUserTaskParent'>;
  verifyOriginalSelection:(selection:Readonly<Selection>,context:Lifetime)=>boolean;
  now:()=>Date;
}) {
  if(!options?.application?.runtime||typeof options.application.readDelegatedUserTaskParent!=='function'
    ||typeof options.verifyOriginalSelection!=='function'||typeof options.now!=='function')
    fail('UNSUPPORTED_CAPABILITY','Trusted F01 selection host unavailable');
  const runtime=options.application.runtime,store=createRuntimeAtomicStatePort(runtime,'workflow-f01-query-binding');
  const key=(parentTaskId:string)=>'selection:'+hash(parentTaskId);
  function active(context:Lifetime):void {
    const now=options.now();
    if(!(context?.signal instanceof AbortSignal)||context.signal.aborted)fail('CANCELLED','Original F01 selection cancelled');
    if(!(now instanceof Date)||!Number.isFinite(now.getTime())||!Number.isFinite(Date.parse(context.deadline))
      ||now.getTime()>=Date.parse(context.deadline))fail('TIMEOUT','Original F01 selection expired');
  }
  function original(selection:Selection,context:Lifetime):string {
    active(context);
    const parent=options.application.readDelegatedUserTaskParent(selection.parentTaskId);
    if(!parent||parent.taskId!==selection.userTaskId||parent.deadline!==context.deadline)
      fail('UNAUTHORIZED','Original F01 user task binding unavailable');
    const task=runtime.getTask(parent.taskId);
    if(task.conversationId!==parent.conversationId||!text(task.goal)
      ||runtime.loadCheckpoint(task.taskId,'private-copy-erasure')!==undefined
      ||runtime.loadCheckpoint(task.taskId,'private-copy-erasure-binding')!==undefined)
      fail('UNAUTHORIZED','Original F01 user selection source unavailable');
    return hash(task.goal);
  }
  function gate(selection:Selection,context:Lifetime):void {
    let result:unknown;
    try {result=options.verifyOriginalSelection(structuredClone(selection),context);}
    catch {return fail('UNAUTHORIZED','Original F01 selection authority unavailable');}
    if(result!==true){if(result!==false&&result!==undefined)void Promise.resolve(result).catch(()=>undefined);
      fail('UNAUTHORIZED','Original F01 selection authority unavailable');}
  }
  /** The composition calls this after an actual native selection. No graph
   * arguments can call this method or supply their own verification callback. */
  function recordSelection(value:Selection,expectedRevision:number|undefined,context:Lifetime):{revision:number} {
    if(!selectionValid(value)||expectedRevision!==undefined&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<1))
      fail('INVALID_ARGUMENT','Invalid F01 original selection');
    const selection=structuredClone(value),goalHash=original(selection,context);gate(selection,context);
    const existing=store.read(key(selection.parentTaskId));
    if(existing?.revision!==expectedRevision)fail('REVISION_CONFLICT','Original F01 selection changed');
    const saved:Saved={version:1,selection,goalHash};
    let committed:boolean;
    try {committed=runtime.compareAndSetTrustedHostStateGuarded('workflow-f01-query-binding',key(selection.parentTaskId),expectedRevision,saved,()=>{
      if(original(selection,context)!==goalHash)fail('REVISION_CONFLICT','Original F01 user source changed');
      gate(selection,context);
    });}catch {return fail('RESULT_UNKNOWN','Original F01 selection requires readback');}
    if(!committed)fail('REVISION_CONFLICT','Original F01 selection changed');
    try {if(original(selection,context)!==goalHash)throw Error('source changed');gate(selection,context);}
    catch {return fail('RESULT_UNKNOWN','Original F01 selection requires readback');}
    return {revision:(expectedRevision??0)+1};
  }
  /** Directly compatible with F01ContextHostOptions.resolveQuery. */
  async function resolveQuery(scope:Scope):Promise<{factId?:string;sourceRef?:string;limit:number}> {
    if(!scope||!text(scope.parentTaskId)||!text(scope.sessionId))fail('UNAUTHORIZED','Original F01 graph binding unavailable');
    active(scope);
    const saved=store.read(key(scope.parentTaskId)),record=saved?.value as Saved|undefined;
    if(!record||record.version!==1||!selectionValid(record.selection)||typeof record.goalHash!=='string'
      ||record.selection.parentTaskId!==scope.parentTaskId||record.selection.sessionId!==scope.sessionId)
      fail('UNSUPPORTED_CAPABILITY','Original user-selected F01 source unavailable');
    const selection=record.selection;
    if(original(selection,scope)!==record.goalHash)fail('REVISION_CONFLICT','Original F01 user source changed');
    gate(selection,scope);
    const reread=store.read(key(scope.parentTaskId));
    if(!reread||reread.revision!==saved!.revision||!isDeepStrictEqual(reread.value,record))
      fail('REVISION_CONFLICT','Original F01 selection changed');
    active(scope);
    return {...(selection.factId===undefined?{}:{factId:selection.factId}),
      ...(selection.sourceRef===undefined?{}:{sourceRef:selection.sourceRef}),limit:selection.limit};
  }
  return {recordSelection,resolveQuery};
}
