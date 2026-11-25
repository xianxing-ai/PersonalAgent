import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
type Input={url:string};
type Result={elementsFound:number};
type Binding={localTaskId:string;operationId:string};
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

/** Observation only. The trusted invoker must submit browser.observe as its own
 * original Runtime task through Policy and ToolGateway; direct tool.execute is not a port.
 * No targetRef is exported: browser references are bound to their original task. */
export function createRuntimeF14ObservationHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  browserObserve:RegisteredTool;
  invokeObservation:(scope:Scope,context:ToolContext)=>Promise<{localTaskId:string;operationId:string}>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:Result)=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  const descriptor=options?.browserObserve?.descriptor;
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'
    ||descriptor?.name!=='browser.observe'||descriptor.version!=='1.0.0'||descriptor.sideEffect!=='read'
    ||!Array.isArray(descriptor.requiredScopes)||!descriptor.requiredScopes.length||!descriptor.requiredScopes.every(x=>typeof x==='string'&&!!x.trim())
    ||typeof options.invokeObservation!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f14_observation_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...descriptor.requiredScopes];
  const active=(context:ToolContext,input:Input)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F14',nodeId:'F14_N01',
    hostToolName:'workflow.host.f14_n01',proposalArguments:input,assertCurrent:options.assertCurrent,now:options.now});
  const bindingKey='f14:observation-binding';
  const pageUrl=(args:Input)=>{
    let url:URL;
    try{url=new URL(args.url);}catch{return failOwnedHost('INVALID_ARGUMENT','F14 observation requires a URL');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)
      failOwnedHost('UNAUTHORIZED','F14 observation requires the original credential-free page URL');
    return url;
  };
  const observe=(scope:Scope,args:Input,binding:Binding)=>{
    const url=pageUrl(args);
    if(!binding||typeof binding.localTaskId!=='string'||!binding.localTaskId||typeof binding.operationId!=='string'||!binding.operationId)
      failOwnedHost('UNSUPPORTED_CAPABILITY','Original browser observation unavailable');
    const parent=runtime.loadCheckpoint(binding.localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const original=runtime.loadCheckpoint(scope.localTaskId,'coding-repair:host:'+binding.operationId) as
      {localTaskId?:string;request?:{commandId?:string;toolName?:string;toolVersion?:string;arguments?:unknown;deadline?:string}}|undefined;
    if(parent?.taskId!==scope.localTaskId||parent.operationId!==binding.operationId||original?.localTaskId!==binding.localTaskId
      ||original.request?.commandId!==binding.operationId||original.request.toolName!=='browser.observe'
      ||original.request.toolVersion!=='1.0.0'||!isDeepStrictEqual(original.request.arguments,{})||original.request.deadline!==scope.deadline)
      failOwnedHost('UNAUTHORIZED','Original browser observation binding changed');
    const read=options.application.readHostToolTask(binding.localTaskId),value=read.confirmed?.result;
    if(read.commandId!==binding.operationId||read.toolName!=='browser.observe'||read.toolVersion!=='1.0.0'
      ||read.task.taskId!==binding.localTaskId||read.task.state!=='succeeded'||read.confirmed?.runId!=='host-tool-'+binding.localTaskId
      ||!read.confirmed.evidenceRefs.includes(read.confirmed.runId)||!plain(value)
      ||value.source!=='playwright'||value.state!=='observed'||value.goalVerified!==false||value.url!==url.href
      ||typeof value.observedAt!=='string'||typeof value.expiresAt!=='string'||!Number.isFinite(Date.parse(value.observedAt))
      ||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.observedAt)>options.now().getTime()
      ||Date.parse(value.expiresAt)<=options.now().getTime()||!Array.isArray(value.controls)||value.controls.length>100)
      failOwnedHost('UNAUTHORIZED','Original current browser observation is not confirmed');
    return {read,result:{elementsFound:value.controls.length}};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F14_N01',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['url'],properties:{url:{type:'string',minLength:1,maxLength:4096}}},
    outputSchema:{type:'object',additionalProperties:false,required:['elementsFound'],properties:{elementsFound:{type:'integer',minimum:0,maximum:100}}},
    async execute(input,context){
      const args=input as Input,scope=active(context,args);
      pageUrl(args);
      const binding=await options.invokeObservation(scope,context);active(context,args);
      const {read,result}=observe(scope,args,binding);
      if(await options.authorizeExport(scope,result)!==true)failOwnedHost('UNAUTHORIZED','F14 observation export denied');
      active(context,args);
      if(!isDeepStrictEqual(read,observe(scope,args,binding).read))
        failOwnedHost('REVISION_CONFLICT','Original browser observation changed');
      runtime.saveCheckpointOnce(scope.localTaskId,bindingKey,binding);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(scope.localTaskId,bindingKey),binding))
        failOwnedHost('REVISION_CONFLICT','Original browser observation identity changed');
      return result;
    }});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const intent=parent?.taskId&&parent.operationId?runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId) as
      {proposal?:{arguments?:unknown}}|undefined:undefined;
    const args=intent?.proposal?.arguments as Input,scope=active(context,args);
    if(!plain(result)||!Number.isInteger(result.elementsFound)||(result.elementsFound as number)<0||(result.elementsFound as number)>100)
      failOwnedHost('UNAUTHORIZED','F14 observation receipt invalid');
    const binding=runtime.loadCheckpoint(scope.localTaskId,bindingKey) as Binding|undefined;
    if(!binding)failOwnedHost('UNAUTHORIZED','Original browser observation identity unavailable');
    const observed=observe(scope,args,binding),host=options.application.readHostToolTask(scope.localTaskId);
    if(host.commandId!==scope.operationId||host.toolName!=='workflow.host.f14_n01'||host.toolVersion!=='1.0.0'
      ||host.task.taskId!==scope.localTaskId||host.task.state!=='succeeded'||host.confirmed?.runId!==context.runId
      ||!host.confirmed.evidenceRefs.includes(host.confirmed.runId)||!isDeepStrictEqual(host.confirmed.result,result)
      ||!isDeepStrictEqual(observed.result,result))failOwnedHost('UNAUTHORIZED','F14 original confirmed receipt changed');
    if(await options.authorizeExport(scope,result as Result)!==true)failOwnedHost('UNAUTHORIZED','F14 observation export denied');
    active(context,args);
    if(!isDeepStrictEqual(binding,runtime.loadCheckpoint(scope.localTaskId,bindingKey))
      ||!isDeepStrictEqual(observed.read,observe(scope,args,binding).read)
      ||!isDeepStrictEqual(host,options.application.readHostToolTask(scope.localTaskId)))
      failOwnedHost('REVISION_CONFLICT','F14 original receipt or observation changed');
  }};
}
