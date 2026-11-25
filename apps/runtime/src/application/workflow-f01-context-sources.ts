import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {parseExecutionModelSelection} from '@personal-agent/coordination';
import type {RuntimeApplication} from './runtime-application.js';
import {readPersistedRuntimeProactiveWorkflow} from './proactive-workflow-application.js';
import type {F01ModelSnapshot,F01ResponsibilitySnapshot} from './workflow-f01-context-host.js';

type Scope={parentTaskId:string;localTaskId:string;operationId:string;sessionId:string;deadline:string;signal:AbortSignal};
type OriginalUser={taskId:string;conversationId:string;deadline:string};
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}
function assertGate(check:(scope:Scope)=>void,scope:Scope):void {
  try {
    const result:unknown=check(scope);
    if(result!==undefined){void Promise.resolve(result).catch(()=>undefined);fail('UNAUTHORIZED','F01 source gate must be synchronous');}
  }catch {fail('UNAUTHORIZED','Original F01 source authority unavailable');}
  if(scope.signal.aborted)fail('CANCELLED','Original F01 task cancelled');
}
function user(application:Pick<RuntimeApplication,'runtime'|'readDelegatedUserTaskParent'>,scope:Scope):OriginalUser {
  if(scope.signal.aborted)fail('CANCELLED','Original F01 task cancelled');
  const original=application.readDelegatedUserTaskParent(scope.parentTaskId);
  if(!original||original.deadline!==scope.deadline)fail('UNSUPPORTED_CAPABILITY','Original F01 user task unavailable');
  const source=application.runtime.getTask(original.taskId);
  if(!text(source.goal)||source.conversationId!==original.conversationId
    ||application.runtime.loadCheckpoint(source.taskId,'private-copy-erasure')!==undefined
    ||application.runtime.loadCheckpoint(source.taskId,'private-copy-erasure-binding')!==undefined)
    fail('UNAUTHORIZED','Original F01 user source withheld');
  return original;
}

/** Reads a specified existing proactive session. Selection is host-owned; every
 * responsibility quote is revalidated against its original Runtime task. */
export function createF01ResponsibilitySource(options:{
  application:Pick<RuntimeApplication,'runtime'|'readDelegatedUserTaskParent'>;
  resolveOriginalSession:(scope:Scope,original:OriginalUser)=>{taskId:string;sessionId:string}|undefined;
  resolveUserConversation:(taskId:string)=>string|undefined;
  /** The current authority/lifecycle source, not a model inference or a quote alone. */
  verifyCurrentResponsibility:(scope:Scope,reference:{id:string;revision:number})=>boolean;
  assertCurrent:(scope:Scope)=>void;
}) {
  if(!options?.application?.runtime||typeof options.application.readDelegatedUserTaskParent!=='function'
    ||typeof options.resolveOriginalSession!=='function'||typeof options.resolveUserConversation!=='function'
    ||typeof options.verifyCurrentResponsibility!=='function'
    ||typeof options.assertCurrent!=='function')fail('INVALID_ARGUMENT','Original responsibility source ports required');
  return async(scope:Scope):Promise<F01ResponsibilitySnapshot>=>{
    const original=user(options.application,scope);assertGate(options.assertCurrent,scope);
    const selected=options.resolveOriginalSession(scope,original);
    if(!selected||!text(selected.taskId)||!text(selected.sessionId))fail('UNSUPPORTED_CAPABILITY','Original responsibility session unavailable');
    const runtime=options.application.runtime,desktop=runtime.loadCheckpoint(selected.taskId,'desktop-proactive-workflow-v1');
    if(!plain(desktop)||desktop.version!==1||desktop.taskId!==selected.taskId||desktop.sessionId!==selected.sessionId
      ||!text(desktop.sourceTaskId)||!text(desktop.contractRef)
      ||options.resolveUserConversation(desktop.sourceTaskId)!==original.conversationId
      ||runtime.loadCheckpoint(desktop.sourceTaskId,'private-copy-erasure')!==undefined
      ||runtime.loadCheckpoint(desktop.sourceTaskId,'private-copy-erasure-binding')!==undefined)
      fail('UNAUTHORIZED','Original responsibility conversation binding unavailable');
    const persisted=readPersistedRuntimeProactiveWorkflow(runtime,selected.taskId,selected.sessionId);
    if(!persisted||persisted.application.state.contractRef!==desktop.contractRef
      ||persisted.application.state.binding.taskDeadline!==desktop.taskDeadline)
      fail('UNSUPPORTED_CAPABILITY','Original responsibility state unavailable');
    const responsibilities=persisted.application.state.responsibilities;
    if(!plain(responsibilities)||Object.keys(responsibilities).length>100)fail('EXTERNAL_FAILURE','Original responsibility state invalid');
    const items=Object.entries(responsibilities).sort(([a],[b])=>a.localeCompare(b)).map(([id,entry])=>{
      if(!plain(entry)||entry.id!==id||!Number.isSafeInteger(entry.revision)||(entry.revision as number)<1
        ||!['explicit_instruction','inferred_interest'].includes(String(entry.authority))
        ||!Array.isArray(entry.sourceQuotes)||!entry.sourceQuotes.length||entry.sourceQuotes.length>32)
        return fail('UNSUPPORTED_CAPABILITY','Responsibility source proof unavailable');
      const current:unknown=options.verifyCurrentResponsibility(scope,{id,revision:entry.revision as number});
      if(current!==true) {
        if(current!==false&&current!==undefined)void Promise.resolve(current).catch(()=>undefined);
        return fail('UNSUPPORTED_CAPABILITY','Current responsibility lifecycle unavailable');
      }
      const sourceQuotes=entry.sourceQuotes.map(value=>{
        if(!plain(value)||!text(value.messageId)||!text(value.conversationId)||!text(value.quoteRef)
          ||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))
          return fail('EXTERNAL_FAILURE','Responsibility quotation invalid');
        const source=runtime.getTask(value.messageId);
        if(!text(source.goal)||source.conversationId!==value.conversationId
          ||options.resolveUserConversation(source.taskId)!==original.conversationId
          ||value.quoteRef!=='runtime:task:'+source.taskId+':goal'||hash(source.goal)!==value.sha256
          ||runtime.loadCheckpoint(source.taskId,'private-copy-erasure')!==undefined
          ||runtime.loadCheckpoint(source.taskId,'private-copy-erasure-binding')!==undefined)
          return fail('REVISION_CONFLICT','Responsibility original quote changed or was withheld');
        return {conversationId:value.conversationId,messageId:value.messageId,quoteRef:value.quoteRef,sha256:value.sha256};
      });
      return {id,revision:entry.revision as number,authority:entry.authority as 'explicit_instruction'|'inferred_interest',sourceQuotes};
    });
    user(options.application,scope);assertGate(options.assertCurrent,scope);
    return {revision:String(persisted.application.revision),items};
  };
}

/** Reads only the original selected model's existing ModelGateway declaration.
 * A missing matching gateway or changing catalog is unavailable, not a guessed capability. */
export function createF01ModelGatewaySource(options:{
  application:Pick<RuntimeApplication,'runtime'|'readDelegatedUserTaskParent'>;
  resolveExecutionModel:(selection:{modelId:string;reasoningEffort?:string;catalogRevision?:string})=>unknown;
  readModelConfiguration:(modelId:string)=>{configurationRef:string}|undefined;
  getModelGateway:(modelId:string,configurationRef:string)=>{deployment:unknown}|undefined;
  /** Synchronously prove this gateway is the original selected AgentArts deployment;
   * matching model IDs alone is never sufficient. */
  verifyOriginalGateway:(scope:Scope,selection:{catalogRevision:string;modelId:string;reasoningEffort?:string},
    configurationRef:string,deployment:unknown)=>boolean;
  assertCurrent:(scope:Scope)=>void;
}) {
  if(!options?.application?.runtime||typeof options.application.readDelegatedUserTaskParent!=='function'
    ||typeof options.resolveExecutionModel!=='function'||typeof options.readModelConfiguration!=='function'
    ||typeof options.getModelGateway!=='function'||typeof options.assertCurrent!=='function')
    fail('INVALID_ARGUMENT','Original ModelGateway sources required');
  if(typeof options.verifyOriginalGateway!=='function')return async(_scope:Scope):Promise<F01ModelSnapshot>=>
    fail('UNSUPPORTED_CAPABILITY','Original ModelGateway identity verification unavailable');
  return async(scope:Scope):Promise<F01ModelSnapshot>=>{
    user(options.application,scope);assertGate(options.assertCurrent,scope);
    const raw=options.application.runtime.loadCheckpoint(scope.parentTaskId,'execution-model');
    if(raw===undefined)fail('UNSUPPORTED_CAPABILITY','Original selected model unavailable');
    const selected=parseExecutionModelSelection(raw),configuration=options.readModelConfiguration(selected.modelId);
    if(!configuration||!text(configuration.configurationRef))fail('UNSUPPORTED_CAPABILITY','Original model configuration unavailable');
    if(!isDeepStrictEqual(options.resolveExecutionModel(selected),selected))fail('REVISION_CONFLICT','Original model catalog changed');
    const gateway=options.getModelGateway(selected.modelId,configuration.configurationRef),deployment=structuredClone(gateway?.deployment);
    if(!plain(deployment)||!plain(deployment.capabilities)||!['conditional','verified'].includes(String(deployment.verification)))
      fail('UNSUPPORTED_CAPABILITY','Original ModelGateway declaration unavailable');
    const checkIdentity=()=>{
      const verified:unknown=options.verifyOriginalGateway(scope,structuredClone(selected),configuration.configurationRef,structuredClone(deployment));
      if(verified!==true){if(verified!==false&&verified!==undefined)void Promise.resolve(verified).catch(()=>undefined);
        fail('UNSUPPORTED_CAPABILITY','Original ModelGateway deployment identity unavailable');}
    };
    checkIdentity();
    const caps=deployment.capabilities,keys=['text','streaming','toolCalling','structuredOutput','vision'] as const;
    if(keys.some(key=>typeof caps[key]!=='boolean'))fail('UNSUPPORTED_CAPABILITY','Original model capabilities unavailable');
    const capabilities={text:caps.text as boolean,streaming:caps.streaming as boolean,toolCalling:caps.toolCalling as boolean,
      structuredOutput:caps.structuredOutput as boolean,vision:caps.vision as boolean};
    const again=options.readModelConfiguration(selected.modelId);
    if(!isDeepStrictEqual(again,configuration)||!isDeepStrictEqual(options.resolveExecutionModel(selected),selected)
      ||!isDeepStrictEqual(options.getModelGateway(selected.modelId,configuration.configurationRef)?.deployment,deployment))
      fail('REVISION_CONFLICT','Original model configuration changed');
    checkIdentity();user(options.application,scope);assertGate(options.assertCurrent,scope);
    return {revision:hash(JSON.stringify([selected,configuration.configurationRef,capabilities,deployment.verification])),
      models:[{id:selected.modelId,verification:deployment.verification as 'conditional'|'verified',capabilities}]};
  };
}
