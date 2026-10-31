import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import {locateTestFailures} from '@personal-agent/coding-tools';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {awaitF16Port,readF16Source} from './f16-source-receipts.js';
import type {F17Reproduction} from './f17-reproduction-ports.js';

type Scope=OwnedWorkflowHostScope;
type Report={failureCount:number;locatedFrameCount:number;reportRef:string;all6PassResolved:false};
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=512;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** F17 local redacted failure report. It cannot issue a fix or claim tests passed. */
export function createRuntimeF17FailureReportHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  /** Trusted original workflow driver checkpoint, never model supplied. */
  driverCheckpointKey:string;
  /** Trusted workspace root for local parser classification; snippet reads remain disabled. */
  workspaceRoot:string;
  requiredScopes:readonly string[];
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:Report)=>Promise<boolean>;
  now:()=>Date;
  resolveReproduction:(scope:Scope,command:{taskId:string;operationId:string;arguments:Record<string,unknown>})=>Promise<F17Reproduction>;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'||!text(options.driverCheckpointKey)
    ||!text(options.workspaceRoot)||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||!options.requiredScopes.every(text)||typeof options.assertCurrent!=='function'||typeof options.authorizeExport!=='function'
    ||typeof options.now!=='function'||typeof options.resolveReproduction!=='function')return {tools:[],unavailable:'f17_failure_report_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext)=>{
    if(!requiredScopes.every(v=>context.scopes.includes(v)))failOwnedHost('SCOPE_DENIED','F17 report scope required');
    return assertOwnedWorkflowHostScope({runtime,context,workflowId:'F17',nodeId:'F17_N04',
      hostToolName:'workflow.host.f17_n04',proposalArguments:{},assertCurrent:options.assertCurrent,now:options.now});
  };
  const deriveSource=(scope:Scope)=>{
    const state=runtime.loadCheckpoint(scope.parentTaskId,options.driverCheckpointKey) as {sessionId?:string;controlRevision?:number;
      confirmedOperations?:Record<string,{nodeId?:string;toolName?:string;localTaskId?:string;operationId?:string;result?:unknown}>}|undefined;
    const binding=runtime.loadCheckpoint(scope.parentTaskId,options.driverCheckpointKey+':driver-binding') as
      {taskId?:string;workflowId?:string;sessionId?:string;deadline?:string}|undefined;
    if(state?.sessionId!==scope.sessionId||binding?.taskId!==scope.parentTaskId||binding.workflowId!=='F17'
      ||binding.sessionId!==scope.sessionId||binding.deadline!==scope.deadline)
      failOwnedHost('UNAUTHORIZED','F17 original driver binding unavailable');
    const entries=Object.values(state.confirmedOperations??{}).filter(item=>item.nodeId==='F17_N03'&&item.toolName==='workspace.run_allowed_command');
    if(entries.length!==1||!text(entries[0]?.operationId)||!text(entries[0]?.localTaskId))
      failOwnedHost('UNSUPPORTED_CAPABILITY','Original F17 test command receipt unavailable');
    const entry=entries[0]!,operationId=entry.operationId!,localTaskId=entry.localTaskId!;
    const operation=runtime.loadCheckpoint(scope.parentTaskId,'owned-workflow:operation:'+operationId) as
      {taskId?:string;sessionId?:string;workflowId?:string;localTaskId?:string;proposal?:{nodeId?:string;operationId?:string;toolName?:string;arguments?:unknown}}|undefined;
    const original=runtime.loadCheckpoint(scope.parentTaskId,'coding-repair:host:'+operationId) as
      {localTaskId?:string;request?:{commandId?:string;toolName?:string;toolVersion?:string;arguments?:unknown;deadline?:string}}|undefined;
    const parent=runtime.loadCheckpoint(localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const read=options.application.readHostToolTask(localTaskId),value=read.confirmed?.result;
    if(operation?.taskId!==scope.parentTaskId||operation.sessionId!==scope.sessionId||operation.workflowId!=='F17'
      ||operation.localTaskId!==localTaskId||operation.proposal?.nodeId!=='F17_N03'||operation.proposal.operationId!==operationId
      ||operation.proposal.toolName!=='workspace.run_allowed_command'||!plain(operation.proposal.arguments)
      ||original?.localTaskId!==localTaskId||original.request?.commandId!==operationId||original.request.toolName!=='workspace.run_allowed_command'
      ||original.request.toolVersion!=='1.0.0'||original.request.deadline!==scope.deadline
      ||!isDeepStrictEqual(original.request.arguments,operation.proposal.arguments)||parent?.taskId!==scope.parentTaskId||parent.operationId!==operationId
      ||read.commandId!==operationId||read.toolName!=='workspace.run_allowed_command'||read.toolVersion!=='1.0.0'
      ||read.task.taskId!==localTaskId||read.task.state!=='succeeded'||read.confirmed?.runId!=='host-tool-'+localTaskId
      ||!read.confirmed.evidenceRefs.includes(read.confirmed.runId)||!isDeepStrictEqual(value,entry.result)||!plain(value)
      ||value.recipeId!==operation.proposal.arguments.recipeId||!Number.isSafeInteger(value.exitCode)||(value.exitCode as number)===0
      ||typeof value.stdout!=='string'||typeof value.stderr!=='string')
      failOwnedHost('UNAUTHORIZED','Original failed test command is not confirmed');
    const command=readF16Source(options.application,scope,{taskId:localTaskId,runId:read.confirmed.runId,
      toolVersion:read.toolVersion,scopeRef:read.confirmed.runId,arguments:operation.proposal.arguments},'workspace.run_allowed_command');
    return {entry,operation,original,parent,read,command,value,operationId,localTaskId};
  };
  const derive=async(scope:Scope)=>{
    const source=deriveSource(scope),{value,operationId,localTaskId,read}=source;
    const reproduction=await awaitF16Port(scope,options.now,()=>options.resolveReproduction(scope,{taskId:localTaskId,operationId,
      arguments:source.command.ref.arguments}));
    if(!isDeepStrictEqual(source,deriveSource(scope))||reproduction.command.taskId!==localTaskId
      ||reproduction.command.runId!==read.confirmed!.runId||!isDeepStrictEqual(reproduction.command.arguments,source.command.ref.arguments))
      failOwnedHost('REVISION_CONFLICT','F17 source changed during version read');
    let parsed:ReturnType<typeof locateTestFailures>;
    try {parsed=locateTestFailures(value.stdout+'\n'+value.stderr,{root:options.workspaceRoot,allowedPaths:[],maxSnippetReads:0});}
    catch {return failOwnedHost('UNSUPPORTED_CAPABILITY','Original test output cannot be safely located');}
    if(!parsed.totalFailures)failOwnedHost('UNSUPPORTED_CAPABILITY','Original failed test contains no supported failure locations');
    const locatedFrameCount=parsed.failures.reduce((sum,item)=>sum+item.frames.length,0);
    const document={version:1,parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,operationId,
      runId:read.confirmed!.runId,sourceDigest:digest(value),reproduction,failures:parsed};
    const reportRef='f17-report:'+digest(document);
    const report:Report={failureCount:parsed.totalFailures,locatedFrameCount,reportRef,all6PassResolved:false};
    return {report,source,document};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F17_N04',kind:'host',sideEffect:'local_write',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},outputSchema:{type:'object',additionalProperties:false,
      required:['failureCount','locatedFrameCount','reportRef','all6PassResolved'],properties:{failureCount:{type:'integer',minimum:1},
        locatedFrameCount:{type:'integer',minimum:0},reportRef:{type:'string'},all6PassResolved:{const:false}}},
    async execute(input,context){
      if(!isDeepStrictEqual(input,{}))failOwnedHost('INVALID_ARGUMENT','F17 host takes no model report');
      const scope=active(context),before=await derive(scope),key='f17:failure-report:'+scope.operationId;
      active(context);
      runtime.saveCheckpointOnce(scope.localTaskId,key,before);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(scope.localTaskId,key),before))
        failOwnedHost('REVISION_CONFLICT','Original F17 report changed');
      active(context);
      if(!isDeepStrictEqual(before,await derive(scope)))failOwnedHost('REVISION_CONFLICT','Original failed test changed');
      active(context);
      return before.report;
    }});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context),key='f17:failure-report:'+scope.operationId,host=options.application.readHostToolTask(scope.localTaskId);
    const before=await derive(scope),saved=runtime.loadCheckpoint(scope.localTaskId,key);
    if(host.commandId!==scope.operationId||host.toolName!=='workflow.host.f17_n04'||host.toolVersion!=='1.0.0'
      ||host.task.taskId!==scope.localTaskId||host.task.state!=='succeeded'||host.confirmed?.runId!==context.runId
      ||!host.confirmed.evidenceRefs.includes(context.runId)||!isDeepStrictEqual(host.confirmed.result,result)
      ||!isDeepStrictEqual(saved,before)||!isDeepStrictEqual(before.report,result))
      failOwnedHost('UNAUTHORIZED','Original F17 report receipt unavailable');
    if(await awaitF16Port(scope,options.now,()=>options.authorizeExport(scope,structuredClone(before.report)))!==true)
      failOwnedHost('UNAUTHORIZED','F17 exact report export denied');
    active(context);
    if(!isDeepStrictEqual(before,await derive(scope))||!isDeepStrictEqual(saved,runtime.loadCheckpoint(scope.localTaskId,key))
      ||!isDeepStrictEqual(host,options.application.readHostToolTask(scope.localTaskId)))
      failOwnedHost('REVISION_CONFLICT','Original F17 report changed during export');
    active(context);
  }};
}
