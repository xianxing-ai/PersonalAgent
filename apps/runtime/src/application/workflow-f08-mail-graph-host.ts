import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {isDeepStrictEqual} from 'node:util';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
// mail.archive and mail.send must be separate original Policy children, never direct tool.execute calls.

type MailWriteResult={toolState:string;archiveOperationId?:string;sendOperationId?:string;messageId?:string;idempotencyKey?:string};
type MailWritePorts={application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;tool:RegisteredTool;
  requiredScopes:readonly string[];invoke:(scope:Scope,input:Record<string,unknown>,context:ToolContext)=>Promise<unknown>;
  verify:(scope:Scope,input:Record<string,unknown>)=>Promise<boolean>;assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:MailWriteResult)=>Promise<boolean>;now:()=>Date};
function createMailWriteHost(nodeId:'F08_N03'|'F08_N07',ports:MailWritePorts|undefined,unavailable:string) {
  const send=nodeId==='F08_N07',name=send?'mail.send':'mail.archive',operation=send?'sendOperationId':'archiveOperationId';
  if(!ports?.application?.runtime||typeof ports.application.readHostToolTask!=='function'||ports.tool?.descriptor.name!==name
    ||!ports.requiredScopes?.length||typeof ports.invoke!=='function'||typeof ports.verify!=='function'
    ||typeof ports.assertCurrent!=='function'||typeof ports.authorizeExport!=='function'||typeof ports.now!=='function')return {tools:[],unavailable};
  const runtime=ports.application.runtime,hostToolName='workflow.host.'+nodeId.toLowerCase();
  const active=(context:ToolContext,args?:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F08',nodeId,hostToolName,
    proposalArguments:args??(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:unknown})?.arguments,
    assertCurrent:ports.assertCurrent,now:ports.now});
  const tool=createOwnedWorkflowAdapter({nodeId,kind:'host',sideEffect:'external_write',requiredScopes:[...ports.requiredScopes],
    inputSchema:structuredClone(ports.tool.descriptor.inputSchema),outputSchema:{type:'object',additionalProperties:false,
      required:[operation,'toolState',...(send?['messageId','idempotencyKey']:[])],properties:{[operation]:{type:'string'},toolState:{type:'string',enum:['confirmed','unknown']},
        ...(send?{messageId:{type:'string'},idempotencyKey:{type:'string'}}:{})}},
    async execute(raw,context){const scope=active(context,raw),input=raw as Record<string,unknown>;
      if(await ports.verify(scope,input)!==true)failOwnedHost('UNAUTHORIZED','F08 original mail action binding unavailable');
      active(context,input);const action=await ports.invoke(scope,input,context);active(context,input);
      if(!plain(action)||!text(action.actionId)||!['confirmed','unknown'].includes(action.state as string)
        ||send&&(!text(action.externalId)||!text(action.idempotencyKey)))failOwnedHost('RESULT_UNKNOWN','F08 original mail action receipt unavailable');
      return {[operation]:scope.operationId,toolState:action.state,...(send?{messageId:action.externalId,idempotencyKey:action.idempotencyKey}:{})};}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result}:{context:ToolContext;result:unknown})=>{
    const scope=active(context),saved=ports.application.readHostToolTask(context.taskId);
    if(saved.commandId!==scope.operationId||saved.toolName!==hostToolName||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!==context.runId||!saved.confirmed.evidenceRefs.includes(context.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,result))failOwnedHost('UNAUTHORIZED','F08 original mail receipt unavailable');
    if(await ports.authorizeExport(scope,structuredClone(result) as MailWriteResult)!==true)failOwnedHost('UNAUTHORIZED','F08 mail export denied');
    active(context);
  }};
}

/** F08_N03: genuine archive with an independently authorized Gateway port. */
export function createRuntimeF08MailArchiveHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  mailArchive:RegisteredTool;
  invokeArchive:(scope:Scope,input:Record<string,unknown>,context:ToolContext)=>Promise<unknown>;
  requiredScopes:readonly string[];
  verifyArchiveBinding:(scope:Scope,input:Record<string,unknown>)=>Promise<boolean>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{archiveOperationId:string;toolState:string})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  return createMailWriteHost('F08_N03',options?{...options,tool:options.mailArchive,invoke:options.invokeArchive,verify:options.verifyArchiveBinding,
    authorizeExport:(scope,result)=>options.authorizeExport(scope,result as {archiveOperationId:string;toolState:string})}:undefined,'f08_mail_archive_trusted_ports_unavailable');
}

/** F08_N07: genuine SMTP send with an independently authorized Gateway port. */
export function createRuntimeF08MailSendHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  mailSend:RegisteredTool;
  invokeSend:(scope:Scope,input:Record<string,unknown>,context:ToolContext)=>Promise<unknown>;
  requiredScopes:readonly string[];
  verifySendBinding:(scope:Scope,input:Record<string,unknown>)=>Promise<boolean>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{sendOperationId:string;toolState:string;messageId?:string})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  return createMailWriteHost('F08_N07',options?{...options,tool:options.mailSend,invoke:options.invokeSend,verify:options.verifySendBinding,
    authorizeExport:(scope,result)=>options.authorizeExport(scope,result as {sendOperationId:string;toolState:string;messageId?:string})}:undefined,'f08_mail_send_trusted_ports_unavailable');
}

/** F08_N10: reads live Policy scope for a proposed mail operation. */
export function createRuntimeF08OperationScopeHost(options?:{
  application?:Pick<RuntimeApplication,'runtime'>;
  /** Desktop composition may bind Runtime after factory construction. */
  getApplication?:()=>Pick<RuntimeApplication,'runtime'>|undefined;
  requiredScopes:readonly string[];
  verifyOperationScope:(scope:Scope,context:ToolContext,input:{authorizationRef:string;toolName:string;toolVersion:string;argumentsDigest:string})=>Promise<{ready:boolean;blockingReason?:string}>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  now:()=>Date;
}):{tools:RegisteredTool[];unavailable:string|null} {
  const resolveRuntime=()=>options?.getApplication?.()?.runtime??options?.application?.runtime;
  if((!options?.application?.runtime&&typeof options?.getApplication!=='function')||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.verifyOperationScope!=='function'||typeof options.assertCurrent!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f08_operation_scope_trusted_ports_unavailable'};
  const requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext,args:unknown)=>{
    const runtime=resolveRuntime();
    if(!runtime)failOwnedHost('UNSUPPORTED_CAPABILITY','F08 operation scope Runtime unavailable');
    return assertOwnedWorkflowHostScope({runtime,context,workflowId:'F08',nodeId:'F08_N10',
      hostToolName:'workflow.host.f08_n10',proposalArguments:args,assertCurrent:options.assertCurrent,now:options.now});
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F08_N10',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['authorizationRef','toolName','toolVersion','argumentsDigest'],properties:{
      authorizationRef:{type:'string'},toolName:{type:'string'},toolVersion:{type:'string'},argumentsDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['ready'],properties:{ready:{type:'boolean'},blockingReason:{type:'string'}}},
    async execute(input,context){
      const scope=active(context,input),payload=input as {authorizationRef:string;toolName:string;toolVersion:string;argumentsDigest:string};
      const checked=await options.verifyOperationScope(scope,context,payload);active(context,input);
      if(!plain(checked)||typeof checked.ready!=='boolean')failOwnedHost('UNSUPPORTED_CAPABILITY','F08 operation scope unavailable');
      return {ready:checked.ready,...(text(checked.blockingReason)?{blockingReason:checked.blockingReason}:{})};
    }});
  return {tools:[tool],unavailable:null};
}

type SendBinding={taskId:string;runId:string;messageId:string;idempotencyKey:string;operationId:string};

/** F08_N12 reads the original authorized send and N11 reconciliation. It never sends again. */
export function createRuntimeF08WaitReconciliationHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  mailReconcile:RegisteredTool;
  requiredScopes:readonly string[];
  resolveOriginalSend:(scope:Scope)=>Promise<SendBinding|undefined>;
  readReconciliation:(scope:Scope,original:SendBinding)=>Promise<{state:string}|undefined>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{reconciliationState:string;originalSendIdentity:string})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'||options.mailReconcile?.descriptor.name!=='mail.reconcile_send'
    ||!options.requiredScopes?.length||typeof options.resolveOriginalSend!=='function'||typeof options.readReconciliation!=='function'
    ||typeof options.assertCurrent!=='function'||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f08_wait_reconciliation_trusted_ports_unavailable'};
  const runtime=options.application.runtime;
  const active=(context:ToolContext,args:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F08',nodeId:'F08_N12',
    hostToolName:'workflow.host.f08_n12',proposalArguments:args,assertCurrent:options.assertCurrent,now:options.now});
  const tool=createOwnedWorkflowAdapter({nodeId:'F08_N12',kind:'host',sideEffect:'local_write',requiredScopes:[...options.requiredScopes],
    inputSchema:{type:'object',additionalProperties:false,required:['sendOperationId'],properties:{sendOperationId:{type:'string',minLength:1}}},
    outputSchema:{type:'object',additionalProperties:false,required:['reconciliationState','originalSendIdentity'],properties:{
      reconciliationState:{const:'confirmed'},originalSendIdentity:{type:'string'}}},
    async execute(args,context){const scope=active(context,args),original=await options.resolveOriginalSend(scope);active(context,args);
      if(!original||original.operationId!==(args as {sendOperationId:string}).sendOperationId||original.idempotencyKey!==original.runId)
        failOwnedHost('UNAUTHORIZED','F08 original send identity unavailable');
      const read=options.application.readHostToolTask(original.taskId);
      if(read.toolName!=='mail.send'||read.task.state!=='succeeded'||read.confirmed?.runId!==original.runId
        ||(read.confirmed.result as {externalId?:string})?.externalId!==original.messageId)
        failOwnedHost('UNAUTHORIZED','F08 original send receipt unavailable');
      const reconciliation=await options.readReconciliation(scope,original);active(context,args);
      if(reconciliation?.state!=='confirmed')failOwnedHost('RESULT_UNKNOWN','F08 original send still requires reconciliation');
      const result={reconciliationState:'confirmed',originalSendIdentity:original.runId};
      if(await options.authorizeExport(scope,result)!==true)failOwnedHost('UNAUTHORIZED','F08 reconciliation export denied');
      active(context,args);return result;
    }});
  return {tools:[tool],unavailable:null};
}

/** F08_N13: versioned replan hook; composition supplies F03 bridge, never a model guess. */
export function createRuntimeF08VersionedReplanHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  requiredScopes:readonly string[];
  submitVersionedReplan:(scope:Scope,input:{changeReason:string;priorOperationId:string})=>Promise<{changeReason:string;originalEffectChain:unknown}>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{changeReason:string;originalEffectChain:unknown})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.submitVersionedReplan!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f08_versioned_replan_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext,args?:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F08',nodeId:'F08_N13',
    hostToolName:'workflow.host.f08_n13',proposalArguments:args??(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:unknown})?.arguments,
    assertCurrent:options.assertCurrent,now:options.now});
  const tool=createOwnedWorkflowAdapter({nodeId:'F08_N13',kind:'host',sideEffect:'local_write',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['changeReason','priorOperationId'],properties:{
      changeReason:{type:'string',minLength:1},priorOperationId:{type:'string',minLength:1}}},
    outputSchema:{type:'object',additionalProperties:false,required:['changeReason','originalEffectChain'],properties:{
      changeReason:{type:'string'},originalEffectChain:{}}},
    async execute(input,context){
      const scope=active(context,input),payload=input as {changeReason:string;priorOperationId:string};
      if(!text(payload.changeReason)||!text(payload.priorOperationId))failOwnedHost('INVALID_ARGUMENT','F08 replan arguments invalid');
      const result=await options.submitVersionedReplan(scope,payload);active(context,input);
      if(!plain(result)||!text(result.changeReason))failOwnedHost('UNSUPPORTED_CAPABILITY','F08 versioned replan unavailable');
      return {changeReason:result.changeReason,originalEffectChain:structuredClone(result.originalEffectChain)};
    }});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context);
    if(!plain(result)||!text(result.changeReason))failOwnedHost('UNAUTHORIZED','F08 replan receipt unavailable');
    if(await options.authorizeExport(scope,structuredClone(result) as {changeReason:string;originalEffectChain:unknown})!==true)
      failOwnedHost('UNAUTHORIZED','F08 replan export denied');
  }};
}
