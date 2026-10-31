import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
type OriginalRead={taskId:string;runId:string;toolVersion:string;scopeRef:string;arguments:Record<string,unknown>};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=512):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const sha=(v:unknown):v is string=>typeof v==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(v);
const repo=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(v);

type HostBundle={tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null};

function basePorts(options?:{application?:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;requiredScopes?:readonly string[];
  assertCurrent?:(scope:Scope,context:ToolContext)=>void;authorizeExport?:(scope:Scope,result:unknown)=>Promise<boolean>;now?:()=>Date}) {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'||!Array.isArray(options.requiredScopes)
    ||!options.requiredScopes.length||!options.requiredScopes.every(v=>text(v,256))||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')return undefined;
  return {runtime:options.application.runtime,readHostToolTask:options.application.readHostToolTask.bind(options.application),
    requiredScopes:[...options.requiredScopes],assertCurrent:options.assertCurrent,authorizeExport:options.authorizeExport,now:options.now};
}

function cacheOriginal(runtime:RuntimeApplication['runtime'],binding:OriginalRead,toolName:string):unknown {
  if(!object(binding)||!text(binding.taskId)||!text(binding.runId)||!text(binding.toolVersion)||!text(binding.scopeRef)||!object(binding.arguments))
    failOwnedHost('UNSUPPORTED_CAPABILITY','F18 original read binding unavailable');
  let record:ReturnType<typeof runtime.readToolExecutions>[number]|undefined,saved:unknown;
  try {
    const task=runtime.getTask(binding.taskId);
    if(!task.evidenceRefs.includes(binding.runId))failOwnedHost('UNAUTHORIZED','F18 original evidence unavailable');
    record=runtime.readToolExecutions(binding.taskId).find(item=>item.evidenceId===binding.runId);
    saved=runtime.loadCheckpoint(binding.taskId,'tool-result-'+binding.runId);
  }catch{return failOwnedHost('UNAUTHORIZED','F18 original evidence unavailable');}
  if(!record||record.taskId!==binding.taskId||record.toolName!==toolName||record.toolVersion!==binding.toolVersion
    ||record.policyDecision!=='allow'||!record.executionStarted||record.state!=='confirmed'
    ||!runtime.matchesToolExecutionInput(record,{arguments:binding.arguments,scopeRef:binding.scopeRef})
    ||!object(saved)||!Object.hasOwn(saved,'result'))failOwnedHost('UNAUTHORIZED','F18 original GitHub read unavailable');
  return saved.result;
}

/** F18_N01: bound PR diff through previously confirmed github.bound_pr_diff reads only. */
export function createRuntimeF18BoundPrDiffHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  requiredScopes:readonly string[];
  now:()=>Date;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  resolveBoundDiff:(scope:Scope)=>Promise<{repo:string;prNumber:number;headSha:string;diffRead:OriginalRead}|undefined>;
  authorizeExport:(scope:Scope,result:{headSha:string;filesChanged:number;additions:number;deletions:number})=>Promise<boolean>;
}):HostBundle {
  const ports=basePorts(options as Parameters<typeof basePorts>[0]);
  if(!ports||typeof options?.resolveBoundDiff!=='function')return {tools:[],unavailable:'f18_bound_pr_diff_trusted_ports_unavailable'};
  const {runtime,requiredScopes}=ports;
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F18',nodeId:'F18_N01',
    hostToolName:'workflow.host.f18_n01',assertCurrent:ports.assertCurrent,now:ports.now});
  const read=async(context:ToolContext)=>{
    const scope=active(context);let binding:Awaited<ReturnType<NonNullable<typeof options>['resolveBoundDiff']>>;
    try {binding=await options.resolveBoundDiff(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F18 bound PR diff unavailable');}
    active(context);
    if(!binding||!repo(binding.repo)||!Number.isSafeInteger(binding.prNumber)||binding.prNumber<=0||!sha(binding.headSha))
      failOwnedHost('UNSUPPORTED_CAPABILITY','F18 bound PR diff unavailable');
    const args=binding.diffRead?.arguments;
    if(!object(args)||args.repo!==binding.repo||args.prNumber!==binding.prNumber||args.headSha!==binding.headSha)
      failOwnedHost('UNAUTHORIZED','F18 PR diff identity changed');
    const diff=cacheOriginal(runtime,binding.diffRead,'github.bound_pr_diff');
    if(!object(diff)||diff.headSha!==binding.headSha||!Number.isSafeInteger(diff.filesChanged)||!Number.isSafeInteger(diff.additions)
      ||!Number.isSafeInteger(diff.deletions)||(diff.filesChanged as number)<0||(diff.additions as number)<0||(diff.deletions as number)<0)
      failOwnedHost('UNSUPPORTED_CAPABILITY','F18 bound PR diff evidence unavailable');
    return {headSha:binding.headSha,filesChanged:diff.filesChanged as number,additions:diff.additions as number,deletions:diff.deletions as number};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F18_N01',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['headSha','filesChanged','additions','deletions'],
      properties:{headSha:{type:'string'},filesChanged:{type:'integer',minimum:0},additions:{type:'integer',minimum:0},deletions:{type:'integer',minimum:0}}},
    async execute(_input,context){const result=await read(context);active(context);
      if(await ports.authorizeExport(active(context),structuredClone(result))!==true)failOwnedHost('UNAUTHORIZED','F18 PR diff export denied');
      active(context);if(!isDeepStrictEqual(result,await read(context)))failOwnedHost('REVISION_CONFLICT','F18 PR diff changed during export');
      return result;}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context),saved=ports.readHostToolTask(context.taskId);
    if(saved.commandId!==scope.operationId||saved.toolName!=='workflow.host.f18_n01'||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!==context.runId||!saved.confirmed.evidenceRefs.includes(context.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,result))failOwnedHost('UNAUTHORIZED','F18 PR diff receipt unavailable');
    if(!isDeepStrictEqual(result,await read(context)))failOwnedHost('REVISION_CONFLICT','F18 PR diff changed');
    if(await ports.authorizeExport(scope,structuredClone(result) as {headSha:string;filesChanged:number;additions:number;deletions:number})!==true)
      failOwnedHost('UNAUTHORIZED','F18 PR diff export denied');
  }};
}

/** F18_N04: merge gate from confirmed github.current_head_merge_gate reads and trusted head checks. */
export function createRuntimeF18MergeGateHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  requiredScopes:readonly string[];
  now:()=>Date;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  resolveMergeGate:(scope:Scope)=>Promise<{repo:string;prNumber:number;headSha:string;gateRead:OriginalRead}|undefined>;
  readCurrentHead:(scope:Scope)=>Promise<string>;
  authorizeExport:(scope:Scope,result:{mergeRequirementsSatisfied:boolean;headSha:string})=>Promise<boolean>;
}):HostBundle {
  const ports=basePorts(options as Parameters<typeof basePorts>[0]);
  if(!ports||typeof options?.resolveMergeGate!=='function'||typeof options.readCurrentHead!=='function')
    return {tools:[],unavailable:'f18_merge_gate_trusted_ports_unavailable'};
  const {runtime,requiredScopes}=ports;
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F18',nodeId:'F18_N04',
    hostToolName:'workflow.host.f18_n04',assertCurrent:ports.assertCurrent,now:ports.now});
  const read=async(context:ToolContext)=>{
    const scope=active(context);let binding:Awaited<ReturnType<NonNullable<typeof options>['resolveMergeGate']>>;
    try {binding=await options.resolveMergeGate(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F18 merge gate unavailable');}
    active(context);
    if(!binding||!repo(binding.repo)||!Number.isSafeInteger(binding.prNumber)||binding.prNumber<=0||!sha(binding.headSha))
      failOwnedHost('UNSUPPORTED_CAPABILITY','F18 merge gate unavailable');
    const args=binding.gateRead?.arguments;
    if(!object(args)||args.repo!==binding.repo||args.prNumber!==binding.prNumber||args.headSha!==binding.headSha)
      failOwnedHost('UNAUTHORIZED','F18 merge gate identity changed');
    const gate=cacheOriginal(runtime,binding.gateRead,'github.current_head_merge_gate');
    if(!object(gate)||gate.headSha!==binding.headSha||typeof gate.mergeRequirementsSatisfied!=='boolean')
      failOwnedHost('UNSUPPORTED_CAPABILITY','F18 merge gate evidence unavailable');
    let head:string;try {head=await options.readCurrentHead(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F18 workspace head unavailable');}
    active(context);if(head!==binding.headSha)failOwnedHost('REVISION_CONFLICT','F18 workspace head changed');
    return {mergeRequirementsSatisfied:gate.mergeRequirementsSatisfied as boolean,headSha:binding.headSha};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F18_N04',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['mergeRequirementsSatisfied','headSha'],
      properties:{mergeRequirementsSatisfied:{type:'boolean'},headSha:{type:'string'}}},
    async execute(_input,context){const result=await read(context);active(context);
      if(await ports.authorizeExport(active(context),structuredClone(result))!==true)failOwnedHost('UNAUTHORIZED','F18 merge gate export denied');
      active(context);if(!isDeepStrictEqual(result,await read(context)))failOwnedHost('REVISION_CONFLICT','F18 merge gate changed during export');
      return result;}});
  return {tools:[tool],unavailable:null};
}

/** F18_N05: registered merge through confirmed github.registered_merge evidence only. */
export function createRuntimeF18RegisteredMergeHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  requiredScopes:readonly string[];
  now:()=>Date;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  resolveRegisteredMerge:(scope:Scope)=>Promise<{repo:string;prNumber:number;mergeRead:OriginalRead}|undefined>;
  authorizeExport:(scope:Scope,result:{mergedSha:string;prClosed:boolean})=>Promise<boolean>;
}):HostBundle {
  const ports=basePorts(options as Parameters<typeof basePorts>[0]);
  if(!ports||typeof options?.resolveRegisteredMerge!=='function')return {tools:[],unavailable:'f18_registered_merge_trusted_ports_unavailable'};
  const {runtime,requiredScopes}=ports;
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F18',nodeId:'F18_N05',
    hostToolName:'workflow.host.f18_n05',assertCurrent:ports.assertCurrent,now:ports.now});
  const read=async(context:ToolContext)=>{
    const scope=active(context);let binding:Awaited<ReturnType<NonNullable<typeof options>['resolveRegisteredMerge']>>;
    try {binding=await options.resolveRegisteredMerge(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F18 registered merge unavailable');}
    active(context);
    if(!binding||!repo(binding.repo)||!Number.isSafeInteger(binding.prNumber)||binding.prNumber<=0)
      failOwnedHost('UNSUPPORTED_CAPABILITY','F18 registered merge unavailable');
    const args=binding.mergeRead?.arguments;
    if(!object(args)||args.repo!==binding.repo||args.prNumber!==binding.prNumber)failOwnedHost('UNAUTHORIZED','F18 merge identity changed');
    const merged=cacheOriginal(runtime,binding.mergeRead,'github.registered_merge');
    if(!object(merged)||!sha(merged.mergedSha)||typeof merged.prClosed!=='boolean')
      failOwnedHost('UNSUPPORTED_CAPABILITY','F18 registered merge evidence unavailable');
    return {mergedSha:merged.mergedSha as string,prClosed:merged.prClosed as boolean};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F18_N05',kind:'host',sideEffect:'external_write',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['mergedSha','prClosed'],
      properties:{mergedSha:{type:'string'},prClosed:{type:'boolean'}}},
    async execute(_input,context){const result=await read(context);active(context);
      if(await ports.authorizeExport(active(context),structuredClone(result))!==true)failOwnedHost('UNAUTHORIZED','F18 merge export denied');
      active(context);if(!isDeepStrictEqual(result,await read(context)))failOwnedHost('REVISION_CONFLICT','F18 merge changed during export');
      return result;}});
  return {tools:[tool],unavailable:null};
}
