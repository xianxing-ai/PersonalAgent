import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {MemoryQueryPort,FactVersion} from '@personal-agent/memory';
import type {RuntimeApplication} from './runtime-application.js';

type Scope={parentTaskId:string;localTaskId:string;operationId:string;sessionId:string;deadline:string;signal:AbortSignal};
type Quote={conversationId:string;messageId:string;quoteRef:string;sha256:string};
export interface F01ResponsibilitySnapshot {revision:string;items:{id:string;revision:number;
  authority:'explicit_instruction'|'inferred_interest';sourceQuotes:Quote[]}[]}
export interface F01ModelSnapshot {revision:string;models:{id:string;verification:'conditional'|'verified';
  capabilities:{text:boolean;streaming:boolean;toolCalling:boolean;structuredOutput:boolean;vision:boolean}}[]}
export interface F01ContextHostOptions {
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  /** Public-scoped real MemoryQueryPort. It owns namespace, withdrawal and erasure checks. */
  memory:MemoryQueryPort;
  requiredScopes:readonly string[];
  /** Must bind the user's current task/resource and revalidate the original grant. */
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  /** Read the current original responsibility store, including source quote revisions. */
  readResponsibilities:(scope:Scope)=>Promise<F01ResponsibilitySnapshot>;
  /** Read actual trusted catalog declarations; conditional is not verified execution. */
  readModels:(scope:Scope)=>Promise<F01ModelSnapshot>;
  /** A host-chosen existing query restriction, never graph/model input. */
  resolveQuery:(scope:Scope)=>Promise<{factId?:string;sourceRef?:string;limit:number}>;
  /** Exact payload export permission for the confirmed local HostTask result. */
  authorizeExport:(scope:Scope,result:F01ContextResult)=>Promise<boolean>;
  now:()=>Date;
}
export interface F01ContextResult {memory:{snapshot:string;facts:FactVersion[];nextCursor?:string};
  responsibilities:F01ResponsibilitySnapshot;models:F01ModelSnapshot}
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=1024;
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}
const scopesOkay=(value:unknown):value is string[]=>Array.isArray(value)&&value.length>0&&value.every(text);
function validateResponsibilities(value:unknown):asserts value is F01ResponsibilitySnapshot {
  if(!plain(value)||Object.keys(value).sort().join(',')!=='items,revision'||!text(value.revision)
    ||!Array.isArray(value.items)||value.items.length>100)fail('EXTERNAL_FAILURE','Responsibility snapshot unavailable');
  for(const item of value.items){
    if(!plain(item)||Object.keys(item).sort().join(',')!=='authority,id,revision,sourceQuotes'||!text(item.id)
      ||!Number.isSafeInteger(item.revision)||(item.revision as number)<1||!['explicit_instruction','inferred_interest'].includes(String(item.authority))
      ||!Array.isArray(item.sourceQuotes)||item.sourceQuotes.length>32
      ||item.authority==='explicit_instruction'&&!item.sourceQuotes.length)fail('EXTERNAL_FAILURE','Responsibility provenance unavailable');
    for(const q of item.sourceQuotes)if(!plain(q)||Object.keys(q).sort().join(',')!=='conversationId,messageId,quoteRef,sha256'
      ||!text(q.conversationId)||!text(q.messageId)||!text(q.quoteRef)||typeof q.sha256!=='string'||!/^[a-f0-9]{64}$/.test(q.sha256))
      fail('EXTERNAL_FAILURE','Responsibility source unavailable');
  }
}
function validateModels(value:unknown):asserts value is F01ModelSnapshot {
  if(!plain(value)||Object.keys(value).sort().join(',')!=='models,revision'||!text(value.revision)
    ||!Array.isArray(value.models)||!value.models.length||value.models.length>100)fail('UNSUPPORTED_CAPABILITY','Trusted model catalog unavailable');
  for(const model of value.models){
    if(!plain(model)||Object.keys(model).sort().join(',')!=='capabilities,id,verification'||!text(model.id)
      ||!['conditional','verified'].includes(String(model.verification))||!plain(model.capabilities)
      ||Object.keys(model.capabilities).sort().join(',')!=='streaming,structuredOutput,text,toolCalling,vision'
      ||Object.values(model.capabilities).some(value=>typeof value!=='boolean'))fail('EXTERNAL_FAILURE','Invalid trusted model capabilities');
  }
}
function validateFacts(facts:unknown,at:number):asserts facts is FactVersion[] {
  if(!Array.isArray(facts)||facts.length>100)fail('EXTERNAL_FAILURE','Memory snapshot unavailable');
  for(const fact of facts){
    if(!plain(fact)||Object.keys(fact).some(key=>!['ref','summary','sourceRef','observedAt','validFrom','validUntil','sensitivity','state','confirmation','corrects'].includes(key))
      ||!plain(fact.ref)||Object.keys(fact.ref).sort().join(',')!=='id,revision'||!text(fact.ref.id)
      ||!Number.isSafeInteger(fact.ref.revision)||(fact.ref.revision as number)<1
      ||!text(fact.summary)||!text(fact.sourceRef)||fact.sensitivity!=='public'||fact.state!=='active'
      ||!['external_observation','model_inference','user_confirmed'].includes(String(fact.confirmation))
      ||typeof fact.observedAt!=='string'||!Number.isFinite(Date.parse(fact.observedAt))
      ||fact.corrects!==undefined&&(!plain(fact.corrects)||Object.keys(fact.corrects).sort().join(',')!=='id,revision'
        ||!text(fact.corrects.id)||!Number.isSafeInteger(fact.corrects.revision)||(fact.corrects.revision as number)<1)
      ||typeof fact.validFrom!=='string'||typeof fact.validUntil!=='string'||!Number.isFinite(Date.parse(fact.validFrom))
      ||!Number.isFinite(Date.parse(fact.validUntil))||Date.parse(fact.validFrom)>at||Date.parse(fact.validUntil)<=at)
      fail('EXTERNAL_FAILURE','Memory fact lacks current public provenance');
  }
}

/** Composition-only local host. No provider, source, task or permission is invented. */
export function createRuntimeF01ContextHost(options?:F01ContextHostOptions):{tools:RegisteredTool[];
  authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'
    ||typeof options.memory?.listCurrent!=='function'||typeof options.memory?.getVersion!=='function'
    ||!scopesOkay(options.requiredScopes)||typeof options.assertCurrent!=='function'||typeof options.readResponsibilities!=='function'
    ||typeof options.readModels!=='function'||typeof options.resolveQuery!=='function'||typeof options.authorizeExport!=='function'
    ||typeof options.now!=='function')return {tools:[],unavailable:'f01_context_trusted_ports_unavailable'};
  const {application,memory}=options,runtime=application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext):Scope=>{
    if(context.signal.aborted)fail('CANCELLED','Original F01 context cancelled');
    const now=options.now();if(!(now instanceof Date)||!Number.isFinite(now.getTime())||!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=now.getTime())
      fail('TIMEOUT','Original F01 context expired');
    if(!context.authorizationRef||!requiredScopes.every(scope=>context.scopes.includes(scope)))fail('SCOPE_DENIED','F01 context scope required');
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    if(!parent?.taskId||!parent.operationId||context.runId!=='host-tool-'+context.taskId)fail('UNAUTHORIZED','Original F01 host binding missing');
    const intent=runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId) as
      {taskId?:string;workflowId?:string;sessionId?:string;deadline?:string;proposal?:{nodeId?:string;operationId?:string;toolName?:string;arguments?:unknown}}|undefined;
    const host=runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {commandId?:string;toolName?:string;arguments?:unknown;deadline?:string}|undefined;
    const owner=runtime.getTask(parent.taskId);
    if(owner.cancelRequested||!['running','waiting_approval'].includes(owner.state)||intent?.taskId!==parent.taskId
      ||intent.workflowId!=='F01'||!text(intent.sessionId)||intent.proposal?.nodeId!=='F01_N02'
      ||intent.proposal.operationId!==parent.operationId||intent.proposal.toolName!=='workflow.host.f01_n02'
      ||host?.commandId!==parent.operationId||host.toolName!=='workflow.host.f01_n02'||host.deadline!==context.deadline
      ||intent.deadline!==context.deadline||!isDeepStrictEqual(intent.proposal.arguments,{})||!isDeepStrictEqual(host.arguments,{}))
      fail('UNAUTHORIZED','Original F01 host intent changed');
    const scope={parentTaskId:parent.taskId,localTaskId:context.taskId,operationId:parent.operationId,
      sessionId:intent.sessionId,deadline:context.deadline,signal:context.signal};
    try {
      const result:unknown=options.assertCurrent(scope,context);
      if(result!==undefined){void Promise.resolve(result).catch(()=>undefined);fail('UNAUTHORIZED','F01 current gate must be synchronous');}
    }catch {fail('UNAUTHORIZED','F01 original access is unavailable');}
    return scope;
  };
  const safeRead=async<T>(context:ToolContext,work:()=>Promise<T>):Promise<T>=>{
    try {return await work();}catch(error) {
      active(context);
      if(error instanceof ProtocolError&&error.code==='UNSUPPORTED_CAPABILITY')
        return fail('UNSUPPORTED_CAPABILITY','F01 trusted source unavailable');
      return fail('EXTERNAL_FAILURE','F01 trusted source unavailable');
    }
  };
  const read=async(scope:Scope,context:ToolContext):Promise<F01ContextResult>=>{
    const query=await safeRead(context,()=>options.resolveQuery(scope));active(context);
    if(!plain(query)||Object.keys(query).some(key=>!['factId','sourceRef','limit'].includes(key))
      ||!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>100
      ||query.factId===undefined&&query.sourceRef===undefined
      ||query.factId!==undefined&&!text(query.factId)||query.sourceRef!==undefined&&!text(query.sourceRef))
      fail('UNSUPPORTED_CAPABILITY','Trusted F01 memory query unavailable');
    const at=options.now().toISOString(),page=await safeRead(context,()=>memory.listCurrent({...query,at,deadline:scope.deadline,signal:scope.signal}));active(context);
    if(!plain(page)||!text(page.snapshot)||page.nextCursor!==undefined&&!text(page.nextCursor))fail('EXTERNAL_FAILURE','Memory page unavailable');
    validateFacts(page.facts,Date.parse(at));
    if(page.facts.length>query.limit)fail('EXTERNAL_FAILURE','Memory page exceeds trusted query limit');
    if(page.facts.some(fact=>query.factId!==undefined&&fact.ref.id!==query.factId
      ||query.sourceRef!==undefined&&fact.sourceRef!==query.sourceRef))
      fail('EXTERNAL_FAILURE','Memory page differs from the original selected source');
    const responsibilities=await safeRead(context,()=>options.readResponsibilities(scope));active(context);validateResponsibilities(responsibilities);
    const models=await safeRead(context,()=>options.readModels(scope));active(context);validateModels(models);
    return {memory:{snapshot:page.snapshot,facts:structuredClone(page.facts),...(page.nextCursor?{nextCursor:page.nextCursor}:{})},
      responsibilities:structuredClone(responsibilities),models:structuredClone(models)};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F01_N02',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['memory','responsibilities','models'],properties:{
      memory:{type:'object'},responsibilities:{type:'object'},models:{type:'object'}}},
    async execute(_input,context){const scope=active(context);return read(scope,context);}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context),saved=application.readHostToolTask(context.taskId);
    if(saved.commandId!==scope.operationId||saved.toolName!=='workflow.host.f01_n02'||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!==context.runId||!saved.confirmed.evidenceRefs.includes(context.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,result))fail('UNAUTHORIZED','F01 original context receipt unavailable');
    const verifyCurrent=async()=>{
      const current=await read(scope,context);
      // Snapshot tokens may change on a repeat query; compare actual content
      // and pagination, then verify each public head separately.
      if(!plain(result)||!plain(result.memory)||!Array.isArray(result.memory.facts)
        ||!isDeepStrictEqual(result.memory.facts,current.memory.facts)||result.memory.nextCursor!==current.memory.nextCursor
        ||!isDeepStrictEqual(result.responsibilities,current.responsibilities)||!isDeepStrictEqual(result.models,current.models))
        fail('REVISION_CONFLICT','F01 context changed before export');
      for(const original of result.memory.facts as FactVersion[]){
        const page=await safeRead(context,()=>memory.listCurrent({factId:original.ref.id,at:options.now().toISOString(),limit:1,deadline:scope.deadline,signal:scope.signal}));
        active(context);if(page.facts.length!==1||!isDeepStrictEqual(page.facts[0],original))fail('REVISION_CONFLICT','F01 fact changed before export');
      }
    };
    await verifyCurrent();
    if(await safeRead(context,()=>options.authorizeExport(scope,structuredClone(result) as unknown as F01ContextResult))!==true)
      fail('UNAUTHORIZED','F01 exact context export denied');
    active(context);await verifyCurrent();
  }};
}
