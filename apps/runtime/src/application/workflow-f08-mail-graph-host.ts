import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
// mark_seen is not archive, save_draft is not send, and calling a registered
// tool directly bypasses ToolGateway/Policy. These factories stay unavailable
// until composition provides semantically correct, independently authorized ports.

/** F08_N03: unavailable until a genuine archive operation has a Gateway port. */
export function createRuntimeF08MailArchiveHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  mailMarkSeen:RegisteredTool;
  requiredScopes:readonly string[];
  verifyArchiveBinding:(scope:Scope,input:{folder:string;uid:number;account?:string})=>Promise<boolean>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{archiveOperationId:string;toolState:string})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  void options;
  return {tools:[],unavailable:'f08_mail_archive_trusted_ports_unavailable'};
}

/** F08_N07: unavailable until a genuine send operation has a Gateway port. */
export function createRuntimeF08MailSendHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  mailSend:RegisteredTool;
  requiredScopes:readonly string[];
  verifySendBinding:(scope:Scope,input:{to:string;subject:string;text:string;account?:string})=>Promise<boolean>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{sendOperationId:string;toolState:string;messageId?:string})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  void options;
  return {tools:[],unavailable:'f08_mail_send_trusted_ports_unavailable'};
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
  const active=(context:ToolContext)=>{
    const runtime=resolveRuntime();
    if(!runtime)failOwnedHost('UNSUPPORTED_CAPABILITY','F08 operation scope Runtime unavailable');
    return assertOwnedWorkflowHostScope({runtime,context,workflowId:'F08',nodeId:'F08_N10',
      hostToolName:'workflow.host.f08_n10',assertCurrent:options.assertCurrent,now:options.now});
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F08_N10',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['authorizationRef','toolName','toolVersion','argumentsDigest'],properties:{
      authorizationRef:{type:'string'},toolName:{type:'string'},toolVersion:{type:'string'},argumentsDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['ready'],properties:{ready:{type:'boolean'},blockingReason:{type:'string'}}},
    async execute(input,context){
      const scope=active(context),payload=input as {authorizationRef:string;toolName:string;toolVersion:string;argumentsDigest:string};
      const checked=await options.verifyOperationScope(scope,context,payload);active(context);
      if(!plain(checked)||typeof checked.ready!=='boolean')failOwnedHost('UNSUPPORTED_CAPABILITY','F08 operation scope unavailable');
      return {ready:checked.ready,...(text(checked.blockingReason)?{blockingReason:checked.blockingReason}:{})};
    }});
  return {tools:[tool],unavailable:null};
}

type SendBinding={taskId:string;runId:string;messageId:string;idempotencyKey:string};

/** F08_N12: unavailable until reconciliation has an independently authorized Gateway port. */
export function createRuntimeF08WaitReconciliationHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  mailReconcile:RegisteredTool;
  requiredScopes:readonly string[];
  resolveOriginalSend:(scope:Scope)=>Promise<SendBinding|undefined>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{reconciliationState:string;originalSendIdentity:string})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  void options;
  return {tools:[],unavailable:'f08_wait_reconciliation_trusted_ports_unavailable'};
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
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F08',nodeId:'F08_N13',
    hostToolName:'workflow.host.f08_n13',assertCurrent:options.assertCurrent,now:options.now});
  const tool=createOwnedWorkflowAdapter({nodeId:'F08_N13',kind:'host',sideEffect:'local_write',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['changeReason','priorOperationId'],properties:{
      changeReason:{type:'string',minLength:1},priorOperationId:{type:'string',minLength:1}}},
    outputSchema:{type:'object',additionalProperties:false,required:['changeReason','originalEffectChain'],properties:{
      changeReason:{type:'string'},originalEffectChain:{}}},
    async execute(input,context){
      const scope=active(context),payload=input as {changeReason:string;priorOperationId:string};
      if(!text(payload.changeReason)||!text(payload.priorOperationId))failOwnedHost('INVALID_ARGUMENT','F08 replan arguments invalid');
      const result=await options.submitVersionedReplan(scope,payload);active(context);
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
