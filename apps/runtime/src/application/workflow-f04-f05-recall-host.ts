import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {MemoryQueryPort,FactVersion} from '@personal-agent/memory';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
function validateFacts(facts:unknown,at:number):asserts facts is FactVersion[] {
  if(!Array.isArray(facts)||facts.length>100)failOwnedHost('EXTERNAL_FAILURE','Memory snapshot unavailable');
  for(const fact of facts){
    if(!plain(fact)||!plain(fact.ref)||!text(fact.ref.id)||!Number.isSafeInteger(fact.ref.revision)||(fact.ref.revision as number)<1
      ||!text(fact.summary)||!text(fact.sourceRef)||fact.sensitivity!=='public'||fact.state!=='active')
      failOwnedHost('EXTERNAL_FAILURE','Memory fact lacks current public provenance');
    if(typeof fact.observedAt!=='string'||!Number.isFinite(Date.parse(fact.observedAt))
      ||typeof fact.validFrom!=='string'||typeof fact.validUntil!=='string'||!Number.isFinite(Date.parse(fact.validFrom))||!Number.isFinite(Date.parse(fact.validUntil))
      ||Date.parse(fact.validFrom)>at||Date.parse(fact.validUntil)<=at)
      failOwnedHost('EXTERNAL_FAILURE','Memory fact timeline unavailable');
  }
}

type MemoryQueryHostBinding={workflowId:'F03'|'F04';nodeId:'F03_N05'|'F04_N05';hostToolName:string;unavailable:string};
const MEMORY_QUERY_BINDINGS={F03:{workflowId:'F03',nodeId:'F03_N05',hostToolName:'workflow.host.f03_n05',unavailable:'f03_memory_trusted_ports_unavailable'},
  F04:{workflowId:'F04',nodeId:'F04_N05',hostToolName:'workflow.host.f04_n05',unavailable:'f04_memory_trusted_ports_unavailable'}} as const;

function createRuntimeMemoryQueryHost(binding:MemoryQueryHostBinding,options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  memory:MemoryQueryPort;requiredScopes:readonly string[];
  resolveQuery:(scope:Scope)=>Promise<{factId?:string;sourceRef?:string;limit:number}>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:unknown)=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.memory?.listCurrent!=='function'
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length||!options.requiredScopes.every(text)
    ||typeof options.resolveQuery!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:binding.unavailable};
  const {application,memory}=options,runtime=application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:binding.workflowId,nodeId:binding.nodeId,
    hostToolName:binding.hostToolName,assertCurrent:options.assertCurrent,now:options.now});
  const read=async(scope:Scope,context:ToolContext)=>{
    if(!requiredScopes.every(scopeName=>context.scopes.includes(scopeName)))failOwnedHost('SCOPE_DENIED','F04 memory scope required');
    const query=await options.resolveQuery(scope);
    if(!plain(query)||!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>100
      ||query.factId===undefined&&query.sourceRef===undefined
      ||query.factId!==undefined&&!text(query.factId)||query.sourceRef!==undefined&&!text(query.sourceRef))
      failOwnedHost('UNSUPPORTED_CAPABILITY',`Trusted ${binding.workflowId} memory query unavailable`);
    const at=options.now().toISOString(),page=await memory.listCurrent({...query,at,deadline:scope.deadline,signal:scope.signal});
    active(context);validateFacts(page.facts,Date.parse(at));
    if(!text(page.snapshot)||page.facts.length>query.limit||page.facts.some(fact=>query.factId!==undefined&&fact.ref.id!==query.factId
      ||query.sourceRef!==undefined&&fact.sourceRef!==query.sourceRef))
      failOwnedHost('EXTERNAL_FAILURE',`${binding.workflowId} memory page differs from original query`);
    return {snapshot:page.snapshot,facts:structuredClone(page.facts),...(page.nextCursor?{nextCursor:page.nextCursor}:{})};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:binding.nodeId,kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['snapshot','facts'],properties:{
      snapshot:{type:'string'},facts:{type:'array'},nextCursor:{type:'string'}}},
    async execute(_input,context){return read(active(context),context);}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context);
    if(!isDeepStrictEqual(result,await read(scope,context)))failOwnedHost('REVISION_CONFLICT',`${binding.workflowId} memory changed before export`);
    if(await options.authorizeExport(scope,structuredClone(result))!==true)failOwnedHost('UNAUTHORIZED',`${binding.workflowId} memory export denied`);
    if(!isDeepStrictEqual(result,await read(active(context),context)))failOwnedHost('REVISION_CONFLICT',`${binding.workflowId} memory changed during export`);
  }};
}

/** F03_N05 / F04_N05: host-owned memory query only; never infers authorization references. */
export function createRuntimeF03MemoryQueryHost(options?:Parameters<typeof createRuntimeMemoryQueryHost>[1]) {
  return createRuntimeMemoryQueryHost(MEMORY_QUERY_BINDINGS.F03,options);
}
export function createRuntimeF04MemoryQueryHost(options?:Parameters<typeof createRuntimeMemoryQueryHost>[1]) {
  return createRuntimeMemoryQueryHost(MEMORY_QUERY_BINDINGS.F04,options);
}

/** F05_N02: parallel recall through existing memory and knowledge tools; host binds both queries. */
export function createRuntimeF05JointRecallHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  memory:MemoryQueryPort;
  knowledgeSearch:RegisteredTool;
  /** Invoke the registered tool through the existing Runtime Policy/ToolGateway. */
  invokeKnowledgeSearch:(input:{query:string;limit:number},context:ToolContext)=>Promise<unknown>;
  requiredMemoryScopes:readonly string[];requiredKnowledgeScopes:readonly string[];
  resolveMemoryQuery:(scope:Scope)=>Promise<{factId?:string;sourceRef?:string;limit:number}>;
  resolveKnowledgeQuery:(scope:Scope)=>Promise<{query:string;limit:number}>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:unknown)=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.memory?.listCurrent!=='function'
    ||options.knowledgeSearch?.descriptor?.name!=='knowledge.search'||typeof options.invokeKnowledgeSearch!=='function'
    ||!Array.isArray(options.requiredMemoryScopes)||!options.requiredMemoryScopes.length
    ||!Array.isArray(options.requiredKnowledgeScopes)||!options.requiredKnowledgeScopes.length
    ||typeof options.resolveMemoryQuery!=='function'||typeof options.resolveKnowledgeQuery!=='function'
    ||typeof options.assertCurrent!=='function'||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f05_recall_trusted_ports_unavailable'};
  const {application,memory}=options,runtime=application.runtime;
  const requiredScopes=[...new Set([...options.requiredMemoryScopes,...options.requiredKnowledgeScopes])];
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F05',nodeId:'F05_N02',
    hostToolName:'workflow.host.f05_n02',assertCurrent:options.assertCurrent,now:options.now});
  const read=async(scope:Scope,context:ToolContext)=>{
    if(!requiredScopes.every(item=>context.scopes.includes(item))||!options.knowledgeSearch.descriptor.requiredScopes.every(item=>context.scopes.includes(item)))
      failOwnedHost('SCOPE_DENIED','F05 recall scope required');
    const memQuery=await options.resolveMemoryQuery(scope),knowQuery=await options.resolveKnowledgeQuery(scope);
    active(context);
    if(!plain(memQuery)||!Number.isSafeInteger(memQuery.limit)||memQuery.limit<1||memQuery.limit>100
      ||memQuery.factId===undefined&&memQuery.sourceRef===undefined
      ||memQuery.factId!==undefined&&!text(memQuery.factId)||memQuery.sourceRef!==undefined&&!text(memQuery.sourceRef))
      failOwnedHost('UNSUPPORTED_CAPABILITY','F05 memory query unavailable');
    if(!plain(knowQuery)||!text(knowQuery.query)||!Number.isSafeInteger(knowQuery.limit)||knowQuery.limit<1||knowQuery.limit>20)
      failOwnedHost('UNSUPPORTED_CAPABILITY','F05 knowledge query unavailable');
    const at=options.now().toISOString();
    const memoryPage=await memory.listCurrent({...memQuery,at,deadline:scope.deadline,signal:scope.signal});
    active(context);validateFacts(memoryPage.facts,Date.parse(at));
    if(!text(memoryPage.snapshot)||memoryPage.facts.length>memQuery.limit||memoryPage.facts.some(fact=>memQuery.factId!==undefined&&fact.ref.id!==memQuery.factId
      ||memQuery.sourceRef!==undefined&&fact.sourceRef!==memQuery.sourceRef))
      failOwnedHost('EXTERNAL_FAILURE','F05 memory page differs from original query');
    const knowledgeHits=await options.invokeKnowledgeSearch({query:knowQuery.query,limit:knowQuery.limit},context);
    active(context);
    return {memory:{snapshot:memoryPage.snapshot,facts:structuredClone(memoryPage.facts),
        ...(memoryPage.nextCursor?{nextCursor:memoryPage.nextCursor}:{})},knowledge:knowledgeHits};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F05_N02',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['memory','knowledge'],properties:{memory:{type:'object'},knowledge:{type:'object'}}},
    async execute(_input,context){return read(active(context),context);}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context);
    if(!isDeepStrictEqual(result,await read(scope,context)))failOwnedHost('REVISION_CONFLICT','F05 recall changed before export');
    if(await options.authorizeExport(scope,structuredClone(result))!==true)failOwnedHost('UNAUTHORIZED','F05 recall export denied');
    if(!isDeepStrictEqual(result,await read(active(context),context)))failOwnedHost('REVISION_CONFLICT','F05 recall changed during export');
  }};
}
