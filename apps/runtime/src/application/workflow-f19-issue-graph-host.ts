import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
type OriginalRead={taskId:string;runId:string;toolVersion:string;scopeRef:string;arguments:Record<string,unknown>};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=512):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
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
    failOwnedHost('UNSUPPORTED_CAPABILITY','F19 original read binding unavailable');
  let record:ReturnType<typeof runtime.readToolExecutions>[number]|undefined,saved:unknown;
  try {
    const task=runtime.getTask(binding.taskId);
    if(!task.evidenceRefs.includes(binding.runId))failOwnedHost('UNAUTHORIZED','F19 original evidence unavailable');
    record=runtime.readToolExecutions(binding.taskId).find(item=>item.evidenceId===binding.runId);
    saved=runtime.loadCheckpoint(binding.taskId,'tool-result-'+binding.runId);
  }catch{return failOwnedHost('UNAUTHORIZED','F19 original evidence unavailable');}
  if(!record||record.taskId!==binding.taskId||record.toolName!==toolName||record.toolVersion!==binding.toolVersion
    ||record.policyDecision!=='allow'||!record.executionStarted||record.state!=='confirmed'
    ||!runtime.matchesToolExecutionInput(record,{arguments:binding.arguments,scopeRef:binding.scopeRef})
    ||!object(saved)||!Object.hasOwn(saved,'result'))failOwnedHost('UNAUTHORIZED','F19 original issue read unavailable');
  return saved.result;
}

export function createRuntimeF19IssueSnapshotHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  requiredScopes:readonly string[];
  now:()=>Date;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  resolveIssueSnapshot:(scope:Scope)=>Promise<{repo:string;snapshotRead:OriginalRead}|undefined>;
  authorizeExport:(scope:Scope,result:{count:number})=>Promise<boolean>;
}):HostBundle {
  const ports=basePorts(options as Parameters<typeof basePorts>[0]);
  if(!ports||typeof options?.resolveIssueSnapshot!=='function')return {tools:[],unavailable:'f19_issue_snapshot_trusted_ports_unavailable'};
  const {runtime,requiredScopes}=ports;
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F19',nodeId:'F19_N01',
    hostToolName:'workflow.host.f19_n01',assertCurrent:ports.assertCurrent,now:ports.now});
  const read=async(context:ToolContext)=>{
    const scope=active(context);let binding:Awaited<ReturnType<NonNullable<typeof options>['resolveIssueSnapshot']>>;
    try {binding=await options.resolveIssueSnapshot(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F19 issue snapshot unavailable');}
    active(context);
    if(!binding||!repo(binding.repo))failOwnedHost('UNSUPPORTED_CAPABILITY','F19 issue snapshot unavailable');
    const args=binding.snapshotRead?.arguments;
    if(!object(args)||args.repo!==binding.repo)failOwnedHost('UNAUTHORIZED','F19 issue snapshot identity changed');
    const snapshot=cacheOriginal(runtime,binding.snapshotRead,'github.issue_snapshot');
    if(!object(snapshot)||!Number.isSafeInteger(snapshot.count)||(snapshot.count as number)<0)
      failOwnedHost('UNSUPPORTED_CAPABILITY','F19 issue snapshot evidence unavailable');
    return {count:snapshot.count as number};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F19_N01',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['count'],properties:{count:{type:'integer',minimum:0}}},
    async execute(_input,context){const result=await read(context);active(context);
      if(await ports.authorizeExport(active(context),structuredClone(result))!==true)failOwnedHost('UNAUTHORIZED','F19 issue snapshot export denied');
      return result;}});
  return {tools:[tool],unavailable:null};
}

export function createRuntimeF19EnqueueRepairHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  requiredScopes:readonly string[];
  now:()=>Date;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  verifyEnqueueBinding:(scope:Scope)=>Promise<boolean>;
  enqueueIssueRepair:(scope:Scope)=>Promise<{repairTaskId:string;issueId:number}>;
  authorizeExport:(scope:Scope,result:{repairTaskId:string;issueId:number})=>Promise<boolean>;
}):HostBundle {
  const ports=basePorts(options as Parameters<typeof basePorts>[0]);
  if(!ports||typeof options?.verifyEnqueueBinding!=='function'||typeof options?.enqueueIssueRepair!=='function')
    return {tools:[],unavailable:'f19_enqueue_repair_trusted_ports_unavailable'};
  const {runtime,requiredScopes}=ports;
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F19',nodeId:'F19_N03',
    hostToolName:'workflow.host.f19_n03',assertCurrent:ports.assertCurrent,now:ports.now});
  const read=async(context:ToolContext)=>{
    const scope=active(context);let allowed:boolean;
    try {allowed=await options.verifyEnqueueBinding(scope);}catch{return failOwnedHost('UNAUTHORIZED','F19 enqueue binding unavailable');}
    active(context);if(allowed!==true)failOwnedHost('UNAUTHORIZED','F19 enqueue binding unavailable');
    let result:{repairTaskId:string;issueId:number};
    try {result=await options.enqueueIssueRepair(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F19 issue repair enqueue unavailable');}
    active(context);
    if(!text(result.repairTaskId,256)||!Number.isSafeInteger(result.issueId)||result.issueId<=0)
      failOwnedHost('UNSUPPORTED_CAPABILITY','F19 issue repair enqueue unavailable');
    return result;
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F19_N03',kind:'host',sideEffect:'local_write',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['repairTaskId','issueId'],
      properties:{repairTaskId:{type:'string'},issueId:{type:'integer',minimum:1}}},
    async execute(_input,context){const result=await read(context);active(context);
      if(await ports.authorizeExport(active(context),structuredClone(result))!==true)failOwnedHost('UNAUTHORIZED','F19 enqueue export denied');
      active(context);if(!isDeepStrictEqual(result,await read(context)))failOwnedHost('REVISION_CONFLICT','F19 enqueue changed during export');
      return result;}});
  return {tools:[tool],unavailable:null};
}

export function createRuntimeF19MergedRepairReadbackHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  requiredScopes:readonly string[];
  now:()=>Date;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  resolveMergedReadback:(scope:Scope)=>Promise<{repo:string;issueId:number;readback:OriginalRead}|undefined>;
  authorizeExport:(scope:Scope,result:{verified:boolean;issueId:number})=>Promise<boolean>;
}):HostBundle {
  const ports=basePorts(options as Parameters<typeof basePorts>[0]);
  if(!ports||typeof options?.resolveMergedReadback!=='function')return {tools:[],unavailable:'f19_merged_repair_readback_trusted_ports_unavailable'};
  const {runtime,requiredScopes}=ports;
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F19',nodeId:'F19_N04',
    hostToolName:'workflow.host.f19_n04',assertCurrent:ports.assertCurrent,now:ports.now});
  const read=async(context:ToolContext)=>{
    const scope=active(context);let binding:Awaited<ReturnType<NonNullable<typeof options>['resolveMergedReadback']>>;
    try {binding=await options.resolveMergedReadback(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F19 merged repair readback unavailable');}
    active(context);
    if(!binding||!repo(binding.repo)||!Number.isSafeInteger(binding.issueId)||binding.issueId<=0)
      failOwnedHost('UNSUPPORTED_CAPABILITY','F19 merged repair readback unavailable');
    const args=binding.readback?.arguments;
    if(!object(args)||args.repo!==binding.repo||args.issueId!==binding.issueId)failOwnedHost('UNAUTHORIZED','F19 merged readback identity changed');
    const readback=cacheOriginal(runtime,binding.readback,'github.merged_repair_readback');
    if(!object(readback)||readback.issueId!==binding.issueId||typeof readback.verified!=='boolean')
      failOwnedHost('UNSUPPORTED_CAPABILITY','F19 merged repair evidence unavailable');
    return {verified:readback.verified as boolean,issueId:binding.issueId};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F19_N04',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['verified','issueId'],
      properties:{verified:{type:'boolean'},issueId:{type:'integer',minimum:1}}},
    async execute(_input,context){const result=await read(context);active(context);
      if(await ports.authorizeExport(active(context),structuredClone(result))!==true)failOwnedHost('UNAUTHORIZED','F19 merged readback export denied');
      return result;}});
  return {tools:[tool],unavailable:null};
}

export function createRuntimeF19CloseIssueHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  requiredScopes:readonly string[];
  now:()=>Date;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  resolveCloseIssue:(scope:Scope)=>Promise<{repo:string;issueId:number;closeRead:OriginalRead}|undefined>;
  authorizeExport:(scope:Scope,result:{issueId:number;closed:boolean})=>Promise<boolean>;
}):HostBundle {
  const ports=basePorts(options as Parameters<typeof basePorts>[0]);
  if(!ports||typeof options?.resolveCloseIssue!=='function')return {tools:[],unavailable:'f19_close_issue_trusted_ports_unavailable'};
  const {runtime,requiredScopes}=ports;
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F19',nodeId:'F19_N05',
    hostToolName:'workflow.host.f19_n05',assertCurrent:ports.assertCurrent,now:ports.now});
  const read=async(context:ToolContext)=>{
    const scope=active(context);let binding:Awaited<ReturnType<NonNullable<typeof options>['resolveCloseIssue']>>;
    try {binding=await options.resolveCloseIssue(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F19 close issue unavailable');}
    active(context);
    if(!binding||!repo(binding.repo)||!Number.isSafeInteger(binding.issueId)||binding.issueId<=0)
      failOwnedHost('UNSUPPORTED_CAPABILITY','F19 close issue unavailable');
    const args=binding.closeRead?.arguments;
    if(!object(args)||args.repo!==binding.repo||args.issueId!==binding.issueId)failOwnedHost('UNAUTHORIZED','F19 close issue identity changed');
    const closed=cacheOriginal(runtime,binding.closeRead,'github.registered_close_issue');
    if(!object(closed)||closed.issueId!==binding.issueId||typeof closed.closed!=='boolean'||closed.closed!==true)
      failOwnedHost('UNSUPPORTED_CAPABILITY','F19 close issue evidence unavailable');
    return {issueId:binding.issueId,closed:true};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F19_N05',kind:'host',sideEffect:'external_write',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['issueId','closed'],
      properties:{issueId:{type:'integer',minimum:1},closed:{const:true}}},
    async execute(_input,context){const result=await read(context);active(context);
      if(await ports.authorizeExport(active(context),structuredClone(result))!==true)failOwnedHost('UNAUTHORIZED','F19 close issue export denied');
      return result;}});
  return {tools:[tool],unavailable:null};
}
