import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
type OriginalRead={taskId:string;runId:string;toolVersion:string;scopeRef:string;arguments:Record<string,unknown>};
export interface F16FailureBinding {repo:string;headSha:string;runId:number;jobId:number;runList:OriginalRead;jobList:OriginalRead;logRead:OriginalRead}
export interface F16FailureResult {errorClass:'unknown';commitSha:string;runId:number;jobId:number;logSnippet:string;truncated:boolean}
export interface F16CiFailureOptions {
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  requiredScopes:readonly string[];now:()=>Date;
  /** Synchronously checks the actual graph frontier, current authority, and source binding. */
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  /** Resolve the original user's selection and authorized tool invocations. */
  resolveFailure:(scope:Scope)=>Promise<F16FailureBinding|undefined>;
  /** Read the real workspace HEAD, through the existing authorized Runtime tool. */
  readCurrentHead:(scope:Scope)=>Promise<string>;
  /** Authorize this exact log snippet and identity for the actual graph destination. */
  authorizeExport:(scope:Scope,result:F16FailureResult)=>Promise<boolean>;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=512):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
const sha=(v:unknown):v is string=>typeof v==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(v);

/** HostBridge adapter over previously confirmed source tools. It performs no
 * external CI request and cannot turn absent or synthetic results into CI proof. */
export function createRuntimeF16CiFailureHost(options?:F16CiFailureOptions):{tools:RegisteredTool[];
  authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length||!options.requiredScopes.every(v=>text(v))
    ||typeof options.now!=='function'||typeof options.assertCurrent!=='function'||typeof options.resolveFailure!=='function'
    ||typeof options.readCurrentHead!=='function'||typeof options.authorizeExport!=='function')
    return {tools:[],unavailable:'f16_ci_failure_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext)=>{
    if(!requiredScopes.every(s=>context.scopes.includes(s)))failOwnedHost('SCOPE_DENIED','F16 CI scope required');
    return assertOwnedWorkflowHostScope({runtime,context,workflowId:'F16',nodeId:'F16_N01',hostToolName:'workflow.host.f16_n01',
      assertCurrent:options.assertCurrent,now:options.now});
  };
  const cache=(binding:OriginalRead,name:string):unknown=>{
    if(!object(binding)||!text(binding.taskId)||!text(binding.runId)||!text(binding.toolVersion)||!text(binding.scopeRef)||!object(binding.arguments))
      failOwnedHost('UNSUPPORTED_CAPABILITY','F16 original read binding unavailable');
    let record:ReturnType<typeof runtime.readToolExecutions>[number]|undefined,saved:unknown;
    try {
      const task=runtime.getTask(binding.taskId);
      if(!task.evidenceRefs.includes(binding.runId))failOwnedHost('UNAUTHORIZED','F16 original evidence unavailable');
      record=runtime.readToolExecutions(binding.taskId).find(item=>item.evidenceId===binding.runId);
      saved=runtime.loadCheckpoint(binding.taskId,'tool-result-'+binding.runId);
    }catch{return failOwnedHost('UNAUTHORIZED','F16 original evidence unavailable');}
    if(!record||record.taskId!==binding.taskId||record.toolName!==name||record.toolVersion!==binding.toolVersion
      ||record.policyDecision!=='allow'||!record.executionStarted||record.state!=='confirmed'
      ||!runtime.matchesToolExecutionInput(record,{arguments:binding.arguments,scopeRef:binding.scopeRef})
      ||!object(saved)||!Object.hasOwn(saved,'result'))failOwnedHost('UNAUTHORIZED','F16 original CI read unavailable');
    return saved.result;
  };
  const read=async(context:ToolContext):Promise<F16FailureResult>=>{
    const scope=active(context);let binding:F16FailureBinding|undefined;
    try {binding=await options.resolveFailure(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F16 original failure unavailable');}
    active(context);
    if(!binding||!text(binding.repo,201)||!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(binding.repo)
      ||!sha(binding.headSha)||!positive(binding.runId)||!positive(binding.jobId))
      failOwnedHost('UNSUPPORTED_CAPABILITY','F16 original failure unavailable');
    const a=binding.runList?.arguments,b=binding.jobList?.arguments,c=binding.logRead?.arguments;
    if(!object(a)||!object(b)||!object(c)||a.repo!==binding.repo||a.status!=='failure'||b.repo!==binding.repo
      ||b.runId!==binding.runId||c.repo!==binding.repo||c.runId!==binding.runId||c.jobId!==binding.jobId)
      failOwnedHost('UNAUTHORIZED','F16 CI read identity changed');
    const runs=cache(binding.runList,'github.actions.run.list'),jobs=cache(binding.jobList,'github.actions.job.list'),log=cache(binding.logRead,'github.actions.log.read');
    const run=object(runs)&&Array.isArray(runs.items)?runs.items.find(v=>object(v)&&v.id===binding.runId):undefined;
    const job=object(jobs)&&Array.isArray(jobs.items)?jobs.items.find(v=>object(v)&&v.id===binding.jobId):undefined;
    if(!object(run)||run.status!=='completed'||run.conclusion!=='failure'||run.headSha!==binding.headSha
      ||!object(job)||job.conclusion!=='failure'||job.runId!==undefined&&job.runId!==binding.runId
      ||!object(log)||!text(log.text,65536)||typeof log.truncated!=='boolean')
      failOwnedHost('UNSUPPORTED_CAPABILITY','F16 bound failure evidence unavailable');
    let head:string;try {head=await options.readCurrentHead(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F16 workspace head unavailable');}
    active(context);if(head!==binding.headSha)failOwnedHost('REVISION_CONFLICT','F16 workspace head changed');
    return {errorClass:'unknown',commitSha:binding.headSha,runId:binding.runId,jobId:binding.jobId,
      logSnippet:log.text,truncated:log.truncated};
  };
  const allow=async(context:ToolContext,result:F16FailureResult)=>{
    const scope=active(context);let allowed:boolean;
    try {allowed=await options.authorizeExport(scope,structuredClone(result));}catch{return failOwnedHost('UNAUTHORIZED','F16 CI export denied');}
    if(allowed!==true)failOwnedHost('UNAUTHORIZED','F16 CI export denied');
    active(context);
    if(!isDeepStrictEqual(result,await read(context)))failOwnedHost('REVISION_CONFLICT','F16 CI evidence changed during export');
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F16_N01',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},outputSchema:{type:'object',additionalProperties:false,
      required:['errorClass','commitSha','runId','jobId','logSnippet','truncated'],properties:{errorClass:{type:'string',enum:['unknown']},
        commitSha:{type:'string'},runId:{type:'integer'},jobId:{type:'integer'},logSnippet:{type:'string'},truncated:{type:'boolean'}}},
    async execute(_input,context){const result=await read(context);await allow(context,result);return result;}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context),saved=options.application.readHostToolTask(context.taskId);
    if(saved.commandId!==scope.operationId||saved.toolName!=='workflow.host.f16_n01'||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!==context.runId||!saved.confirmed.evidenceRefs.includes(context.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,result))failOwnedHost('UNAUTHORIZED','F16 original receipt unavailable');
    if(!isDeepStrictEqual(result,await read(context)))failOwnedHost('REVISION_CONFLICT','F16 CI evidence changed');
    await allow(context,result as F16FailureResult);
  }};
}
