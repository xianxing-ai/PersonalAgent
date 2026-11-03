import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';

/** Exact deployment pin. Latest, other versions and other images are not this loop. */
export interface PinnedDeploymentIdentity {
  runtimeId:string;runtimeName:string;endpointId:string;endpointName:string;version:string;imageDigest:string;
}
export interface PinnedReadonlyTool {name:string;version:string;}
export interface PlatformSurfaceReport {state:string;verified:false;missingConfiguration:string[];}
export interface PinnedReadonlyCorrelation {
  version:1;state:'correlated';deployment:PinnedDeploymentIdentity;platformRequestId:string;localEvidenceId:string;
  tool:PinnedReadonlyTool;argumentsDigest:string;localExecuted:true;localTaskCompleted:false;
  cloudSuccessIsNotLocalCompletion:true;runtimeReady:boolean|null;containerExecution:'unverified';readinessProbe:'unverified';
  surfaces:{knowledge:PlatformSurfaceReport;mcp:PlatformSurfaceReport;trace:PlatformSurfaceReport;evaluation:PlatformSurfaceReport};
  modelProxy:{state:'separate_from_mcp';verified:false};
  realEnvironmentAcceptance:'not_performed';
}
export interface PinnedReadonlyPorts {
  deployment:PinnedDeploymentIdentity;allowedTool:PinnedReadonlyTool;
  readDeployment:(context:PinnedReadonlyContext)=>Promise<PinnedDeploymentIdentity&{runtimeReady?:boolean}>;
  /** Injectable CloudAgentPort-shaped call. A fake stands in when no cloud credential exists. */
  invokeCloud:(request:{tool:PinnedReadonlyTool;arguments:Record<string,unknown>},context:PinnedReadonlyContext)=>Promise<{requestId:string;kind:string;toolName?:string;toolVersion?:string;arguments?:unknown}>;
  /** Original local Runtime/Policy/ToolGateway execution. This module does not grant scopes. */
  executeLocalReadonly:(request:{tool:PinnedReadonlyTool;arguments:Record<string,unknown>;platformRequestId:string},context:PinnedReadonlyContext)=>Promise<{evidenceId:string;state?:string}>;
  authorize:(request:{tool:PinnedReadonlyTool;arguments:Record<string,unknown>},context:PinnedReadonlyContext)=>Promise<boolean>;
  recordEvidence?:(draft:{platformRequestId:string;evidenceId:string;deployment:PinnedDeploymentIdentity;argumentsDigest:string},context:PinnedReadonlyContext)=>Promise<{evidenceId:string}>;
  surfaceStatus?:()=>{knowledge?:{state?:string;missingConfiguration?:string[]};mcp?:{state?:string;missingConfiguration?:string[]};
    trace?:{state?:string;missingConfiguration?:string[]};evaluation?:{state?:string;missingConfiguration?:string[]};verified?:boolean};
}
export interface PinnedReadonlyContext {signal:AbortSignal;deadline:string;requestId:string;taskId?:string;runId?:string;}

const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=(code:string,message:string):never=>{throw new ProtocolError(code,message);};
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const toolName=/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const digest=/^sha256:[a-f0-9]{64}$/;
const canonical=(value:unknown):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)
  ?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value as Record<string,unknown>).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
export function pinnedReadonlyArgumentsDigest(value:unknown):string {return createHash('sha256').update(canonical(value)).digest('hex');}
function active(context:PinnedReadonlyContext) {
  if(!(context?.signal instanceof AbortSignal))fail('INVALID_ARGUMENT','Explicit pinned-read cancellation signal required');
  if(context.signal.aborted)fail('CANCELLED','Pinned readonly request cancelled');
  if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now())fail('TIMEOUT','Pinned readonly deadline expired');
  if(!text(context.requestId)||!id.test(context.requestId))fail('INVALID_ARGUMENT','Original platform request id required');
}
function pin(value:PinnedDeploymentIdentity,label:string):PinnedDeploymentIdentity {
  if(!plain(value)||!text(value.runtimeId)||!id.test(value.runtimeId)||!text(value.runtimeName)||!id.test(value.runtimeName)
    ||!text(value.endpointId)||!id.test(value.endpointId)||!text(value.endpointName)||!id.test(value.endpointName)
    ||!text(value.version)||!id.test(value.version)||/latest/i.test(value.version)||value.endpointName!==value.version
    ||!digest.test(value.imageDigest))fail('INVALID_ARGUMENT',label);
  return {runtimeId:value.runtimeId,runtimeName:value.runtimeName,endpointId:value.endpointId,endpointName:value.endpointName,version:value.version,imageDigest:value.imageDigest};
}
function samePin(left:PinnedDeploymentIdentity,right:PinnedDeploymentIdentity) {
  return left.runtimeId===right.runtimeId&&left.runtimeName===right.runtimeName&&left.endpointId===right.endpointId
    &&left.endpointName===right.endpointName&&left.version===right.version&&left.imageDigest===right.imageDigest;
}
function surface(value:{state?:string;missingConfiguration?:string[]}|undefined,key:string):PlatformSurfaceReport {
  const state=text(value?.state)?value.state:'unavailable';
  const missing=Array.isArray(value?.missingConfiguration)?value.missingConfiguration.filter(text):[key];
  return {state,verified:false,missingConfiguration:state==='unavailable'&&missing.length===0?[key]:missing};
}
async function attempt<T>(context:PinnedReadonlyContext,fn:()=>Promise<T>,code:string,message:string):Promise<T> {
  try{return await fn();}
  catch(error){active(context);if(error instanceof ProtocolError)throw error;return fail(code,message);}
}
function surfaces(read:PinnedReadonlyPorts['surfaceStatus']):PinnedReadonlyCorrelation['surfaces'] {
  let raw:ReturnType<NonNullable<PinnedReadonlyPorts['surfaceStatus']>>|undefined;
  try{raw=read?.();}catch{raw=undefined;}
  return {knowledge:surface(raw?.knowledge,'knowledge'),mcp:surface(raw?.mcp,'mcp'),trace:surface(raw?.trace,'trace'),evaluation:surface(raw?.evaluation,'evaluation')};
}

/** One authorized public read on a pinned deployment. Cloud output is not a local task terminal state. */
export async function correlatePinnedReadonlyTool(ports:PinnedReadonlyPorts,request:{arguments:Record<string,unknown>},context:PinnedReadonlyContext):Promise<PinnedReadonlyCorrelation> {
  active(context);
  if(!ports?.readDeployment||!ports.invokeCloud||!ports.executeLocalReadonly||!ports.authorize)
    fail('UNSUPPORTED_CAPABILITY','Pinned readonly loop requires deployment read, cloud invoke, local execution and authorization ports');
  const deployment=pin(ports.deployment,'Pinned deployment rejects Latest, mismatched endpoint name, or a non-sha256 image');
  const tool=ports.allowedTool;
  if(!tool||!toolName.test(tool.name??'')||!toolName.test(tool.version??''))fail('INVALID_ARGUMENT','One public readonly tool name and version required');
  if(!plain(request)||!plain(request.arguments)||canonical(request.arguments).length>16000)fail('INVALID_ARGUMENT','Readonly tool arguments must be a bounded object');
  const allowed={name:tool.name,version:tool.version},args=structuredClone(request.arguments),argumentsDigest=pinnedReadonlyArgumentsDigest(args);
  let allowedByHost=false;
  try{allowedByHost=await ports.authorize({tool:allowed,arguments:structuredClone(args)},context);}catch{active(context);fail('UNAUTHORIZED','Pinned readonly authorization check failed');}
  active(context);
  if(allowedByHost!==true)fail('UNAUTHORIZED','Pinned readonly tool was not authorized');
  const before=await attempt(context,()=>ports.readDeployment(context),'EXTERNAL_FAILURE','Pinned deployment read failed');
  active(context);
  const seen=pin(before,'Deployment readback is not an exact pinned version');
  if(!samePin(seen,deployment))fail('REVISION_CONFLICT','Deployment readback does not match the pinned version');
  const cloud=await attempt(context,()=>ports.invokeCloud({tool:allowed,arguments:structuredClone(args)},context),'RESULT_UNKNOWN','Pinned cloud invoke did not return a confirmed proposal');
  active(context);
  if(cloud?.requestId!==context.requestId||cloud.kind!=='tool_proposal'||cloud.toolName!==allowed.name||cloud.toolVersion!==allowed.version
    ||canonical(cloud.arguments)!==canonical(args))fail('UNAUTHORIZED','Cloud proposal is not the one authorized readonly tool');
  const executed=await attempt(context,()=>ports.executeLocalReadonly({tool:allowed,arguments:structuredClone(args),platformRequestId:context.requestId},context),'RESULT_UNKNOWN','Local readonly execution has no confirmed evidence');
  active(context);
  if(!text(executed?.evidenceId)||!id.test(executed.evidenceId))fail('EXTERNAL_FAILURE','Local readonly evidence id missing');
  if(ports.recordEvidence) {
    const recorded=await attempt(context,()=>ports.recordEvidence!({platformRequestId:context.requestId,evidenceId:executed.evidenceId,deployment,argumentsDigest},context),'RESULT_UNKNOWN','Pinned request and local evidence were not both recorded');
    active(context);
    if(recorded?.evidenceId!==executed.evidenceId)fail('REVISION_CONFLICT','Evidence correlation id changed');
  }
  const after=await attempt(context,()=>ports.readDeployment(context),'RESULT_UNKNOWN','Deployment changed or became unreadable after the readonly call');
  active(context);
  if(!samePin(pin(after,'Deployment readback is not an exact pinned version'),deployment))
    fail('REVISION_CONFLICT','Deployment changed after the readonly call');
  return {version:1,state:'correlated',deployment,platformRequestId:context.requestId,localEvidenceId:executed.evidenceId,
    tool:allowed,argumentsDigest,localExecuted:true,localTaskCompleted:false,cloudSuccessIsNotLocalCompletion:true,
    runtimeReady:before.runtimeReady===true&&after.runtimeReady===true,containerExecution:'unverified',readinessProbe:'unverified',
    surfaces:surfaces(ports.surfaceStatus),modelProxy:{state:'separate_from_mcp',verified:false},realEnvironmentAcceptance:'not_performed'};
}
