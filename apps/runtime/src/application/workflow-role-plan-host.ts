import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {ProtocolError,isProtocolError} from '@personal-agent/contracts';
import type {ToolContext,TaskSnapshot} from '@personal-agent/contracts';
import {parseExecutionModelSelection} from '@personal-agent/coordination';
import {WorkflowRolePlanNotCommittedError} from '../index.js';
import type {TaskRuntime} from '../index.js';
import {parseRuntimeWorkflowRolePlan,RUNTIME_WORKFLOW_ROLE_PLAN_KEY,RUNTIME_WORKFLOW_ROLE_ATTEMPT_KEY,RUNTIME_WORKFLOW_CHILD_ROLE_KEY,workflowRoleMatchesChild} from '../workflow-role-plan.js';
import type {RuntimeWorkflowRolePlan} from '../workflow-role-plan.js';

export interface RuntimeWorkflowRolePlanHost {
  bind(input:RuntimeWorkflowRolePlan,expectedRevision:number,context:ToolContext):Promise<RuntimeWorkflowRolePlan>;
  /** Read-only reconciliation of the trusted original operation; never a grant or retry instruction. */
  reconcile(context:ToolContext):Promise<{state:'matched'|'conflict'|'not_found'}>;
  read(context:ToolContext):Promise<{state:'bound'|'unavailable';roles:Array<
    {role:RuntimeWorkflowRolePlan['roles'][number]['role'];state:'unavailable';reason:string}
    |{role:RuntimeWorkflowRolePlan['roles'][number]['role'];state:'bound';childTaskId:string;taskState:TaskSnapshot['state'];
      model:RuntimeWorkflowRolePlan['roles'][number]['selection'];stepBudget:{maxSteps:number};verificationPolicyRef:string;
      nativeReasoningVerification:'conditional';providerExecution:'not_verified'}>}>;
}

export interface RuntimeWorkflowRolePlanHostOptions {
  runtime:Pick<TaskRuntime,'getTask'|'loadCheckpoint'|'beginWorkflowRolePlanAttempt'|'findTaskByIdempotencyKey'|'freezeWorkflowRolePlan'>;
  requiredScopes:readonly string[];
  /** The same trusted clock supplied to the owning TaskRuntime. */
  now:()=>Date;
  /** Trusted original Policy check over the exact plan. */
  authorize:(context:ToolContext,action:'bind'|'read',plan:RuntimeWorkflowRolePlan)=>Promise<boolean>;
  /** Existing trusted Competition catalog lookup, with no credential material. */
  resolveSelection:(selection:RuntimeWorkflowRolePlan['roles'][number]['selection'],context:ToolContext)=>Promise<unknown>;
  /** Synchronously revalidate the original grant and all catalog selections before use. */
  assertCurrent:(context:ToolContext,plan:RuntimeWorkflowRolePlan)=>void;
  /** Read the original host-owned operation and its immutable request digest, not model input. */
  resolveBindIntent?:(context:ToolContext)=>Promise<{parentTaskId:string;operationId:string;requestDigest:string}|undefined>;
  /** Optional separately authorized audit. Binding must come from the original immutable host intent. */
  reconciliation?:{
    requiredScopes:readonly string[];
    resolveOriginal:(context:ToolContext)=>Promise<{parentTaskId:string;operationId:string;requestDigest:string;expectedPlanSha256:string}|undefined>;
    authorize:(context:ToolContext,binding:{parentTaskId:string;operationId:string;requestDigest:string;expectedPlanSha256:string})=>Promise<boolean>;
    assertCurrent:(context:ToolContext,binding:{parentTaskId:string;operationId:string;requestDigest:string;expectedPlanSha256:string})=>void;
  };
}
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const canonical=(value:unknown):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)
  ?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const safeError=(error:unknown):ProtocolError=>{
  const allowed=['INVALID_ARGUMENT','UNAUTHORIZED','SCOPE_DENIED','CANCELLED','TIMEOUT','REVISION_CONFLICT','UNSUPPORTED_CAPABILITY'];
  const code=isProtocolError(error)&&allowed.includes(error.code)?error.code:'EXTERNAL_FAILURE';
  return new ProtocolError(code,'Trusted role host operation failed');
};
/** Trusted host entry; plans and checks never grant authorization or claim provider execution. */
export function createRuntimeWorkflowRolePlanHost(options:RuntimeWorkflowRolePlanHostOptions):RuntimeWorkflowRolePlanHost {
  if(!options?.runtime||typeof options.runtime.freezeWorkflowRolePlan!=='function'||typeof options.runtime.beginWorkflowRolePlanAttempt!=='function'||!Array.isArray(options.requiredScopes)
    ||!options.requiredScopes.length||!options.requiredScopes.every(text)||typeof options.authorize!=='function'
    ||typeof options.resolveSelection!=='function'||typeof options.assertCurrent!=='function'||typeof options.now!=='function')
    throw new ProtocolError('INVALID_ARGUMENT','Trusted role Policy and model catalog required');
  const scopes=[...options.requiredScopes],runtime=options.runtime;
  const call=async<T>(fn:()=>Promise<T>):Promise<T>=>{try{return await fn();}catch(error){throw safeError(error);}};
  const sync=(fn:()=>unknown):void=>{
    let value:unknown;try{value=fn();}catch(error){throw safeError(error);}
    if(value!==undefined){void Promise.resolve(value).catch(()=>undefined);throw new ProtocolError('UNAUTHORIZED','Role host gate must be synchronous');}
  };
  const active=(context:ToolContext,requiredScopes:readonly string[]=scopes)=>{
    if(!context?.authorizationRef||!requiredScopes.every(scope=>context.scopes?.includes(scope)))throw new ProtocolError('SCOPE_DENIED','Original role authorization required');
    if(!(context.signal instanceof AbortSignal))throw new ProtocolError('INVALID_ARGUMENT','Cancellation signal required');
    if(context.signal.aborted)throw new ProtocolError('CANCELLED','Role plan cancelled');
    let now:Date;try{now=options.now();}catch(error){throw safeError(error);}
    if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new ProtocolError('INVALID_ARGUMENT','Trusted Runtime clock unavailable');
    if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=now.getTime())throw new ProtocolError('TIMEOUT','Role plan deadline expired');
  };
  const check=async(context:ToolContext,action:'bind'|'read',plan:RuntimeWorkflowRolePlan)=>{
    active(context);if(context.taskId!==plan.parentTaskId||context.deadline!==plan.deadline)throw new ProtocolError('UNAUTHORIZED','Original graph task binding required');
    if(await call(()=>options.authorize(context,action,structuredClone(plan)))!==true)throw new ProtocolError('SCOPE_DENIED','Role plan authorization denied');
    for(const role of plan.roles) {
      const selection=await call(()=>options.resolveSelection(structuredClone(role.selection),context));active(context);
      if(selection===undefined||!isDeepStrictEqual(parseExecutionModelSelection(selection),role.selection))
        throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original model catalog selection unavailable');
    }
    sync(()=>options.assertCurrent(context,structuredClone(plan)));
    active(context);
  };
  async function bind(input:RuntimeWorkflowRolePlan,expectedRevision:number,context:ToolContext) {
    const plan=parseRuntimeWorkflowRolePlan(input);await check(context,'bind',plan);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new ProtocolError('INVALID_ARGUMENT','Invalid parent revision');
    if(typeof options.resolveBindIntent!=='function')throw new ProtocolError('UNSUPPORTED_CAPABILITY','Trusted original role-plan intent unavailable');
    const original=await call(()=>options.resolveBindIntent!(context));active(context);
    const requestDigest=digest({plan,expectedRevision});
    if(!original||!text(original.parentTaskId)||!text(original.operationId)||original.operationId.length>256
      ||!/^[a-f0-9]{64}$/u.test(original.requestDigest)||original.parentTaskId!==plan.parentTaskId
      ||original.requestDigest!==requestDigest)throw new ProtocolError('REVISION_CONFLICT','Original role-plan intent changed or is unavailable');
    // A missing parent is a read-only validation failure, before starting the write.
    const parent=runtime.getTask(plan.parentTaskId);
    if(parent.revision!==expectedRevision)throw new ProtocolError('REVISION_CONFLICT','Original role-plan parent changed');
    const intent={operationId:original.operationId,requestDigest};
    let created:boolean;
    try {created=runtime.beginWorkflowRolePlanAttempt(plan,expectedRevision,intent);}
    catch(error) {
      if(error instanceof WorkflowRolePlanNotCommittedError)throw error;
      throw new ProtocolError('RESULT_UNKNOWN','Original role-plan attempt requires read-only reconciliation');
    }
    if(!created) {
      throw new ProtocolError('RESULT_UNKNOWN','Original role-plan attempt requires read-only reconciliation');
    }
    let result:RuntimeWorkflowRolePlan;
    try {sync(()=>options.assertCurrent(context,structuredClone(plan)));active(context);result=runtime.freezeWorkflowRolePlan(plan,expectedRevision,intent);}
    catch(error) {
      // Runtime emits this marker only for a validation failure before the write.
      if(error instanceof WorkflowRolePlanNotCommittedError)throw error;
      throw new ProtocolError('RESULT_UNKNOWN','Original role-plan write requires read-only reconciliation');
    }
    try {
      // A late revocation cannot make the persisted plan into authority.
      sync(()=>options.assertCurrent(context,structuredClone(plan)));
      active(context);return result;
    } catch {throw new ProtocolError('RESULT_UNKNOWN','Original role-plan write requires read-only reconciliation');}
  }
  async function reconcile(context:ToolContext):Promise<{state:'matched'|'conflict'|'not_found'}> {
    const audit=options.reconciliation;
    if(!audit||!Array.isArray(audit.requiredScopes)||!audit.requiredScopes.length||!audit.requiredScopes.every(text)
      ||typeof audit.resolveOriginal!=='function'||typeof audit.authorize!=='function'||typeof audit.assertCurrent!=='function')
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Trusted original role-plan reconciliation unavailable');
    active(context,audit.requiredScopes);
    const binding=await call(()=>audit.resolveOriginal(context));active(context,audit.requiredScopes);
    if(!binding||!text(binding.parentTaskId)||!text(binding.operationId)||binding.operationId.length>256
      ||!/^[a-f0-9]{64}$/u.test(binding.requestDigest)||!/^[a-f0-9]{64}$/u.test(binding.expectedPlanSha256))
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original role-plan intent unavailable');
    const fixed=structuredClone(binding);
    if(await call(()=>audit.authorize(context,structuredClone(fixed)))!==true)throw new ProtocolError('SCOPE_DENIED','Role-plan audit authorization denied');
    active(context,audit.requiredScopes);
    let saved:unknown,attempt:unknown;
    try {attempt=runtime.loadCheckpoint(fixed.parentTaskId,RUNTIME_WORKFLOW_ROLE_ATTEMPT_KEY);saved=runtime.loadCheckpoint(fixed.parentTaskId,RUNTIME_WORKFLOW_ROLE_PLAN_KEY);}
    catch {throw new ProtocolError('RESULT_UNKNOWN','Original role-plan readback unavailable');}
    sync(()=>audit.assertCurrent(context,structuredClone(fixed)));
    active(context,audit.requiredScopes);
    if(attempt===undefined)return {state:'not_found'};
    if(!plain(attempt)||attempt.version!==1||attempt.parentTaskId!==fixed.parentTaskId||attempt.operationId!==fixed.operationId
      ||attempt.requestDigest!==fixed.requestDigest||attempt.planSha256!==fixed.expectedPlanSha256)return {state:'conflict'};
    if(saved===undefined)return {state:'not_found'};
    let plan:RuntimeWorkflowRolePlan;
    try {plan=parseRuntimeWorkflowRolePlan(saved);}catch {throw new ProtocolError('RESULT_UNKNOWN','Original role-plan readback invalid');}
    if(plan.parentTaskId!==fixed.parentTaskId)throw new ProtocolError('RESULT_UNKNOWN','Original role-plan task binding invalid');
    return {state:createHash('sha256').update(canonical(plan)).digest('hex')===fixed.expectedPlanSha256?'matched':'conflict'};
  }
  async function read(context:ToolContext):ReturnType<RuntimeWorkflowRolePlanHost['read']> {
    active(context);const saved=runtime.loadCheckpoint(context.taskId,RUNTIME_WORKFLOW_ROLE_PLAN_KEY);
    if(saved===undefined)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original role plan unavailable');
    const plan=parseRuntimeWorkflowRolePlan(saved);await check(context,'read',plan);
    const planSha256=createHash('sha256').update(canonical(plan)).digest('hex');
    const roles=plan.roles.map(role=>{
      const child=runtime.findTaskByIdempotencyKey(`subagent-dispatch-${plan.parentTaskId}-${role.definition.subtaskId}`);
      if(!child)return {role:role.role,state:'unavailable' as const,reason:'original_child_not_dispatched'};
      const binding=runtime.loadCheckpoint(child.taskId,'subtask-parent'),marker=runtime.loadCheckpoint(child.taskId,RUNTIME_WORKFLOW_CHILD_ROLE_KEY);
      if(!workflowRoleMatchesChild(plan,role,binding)||!plain(marker)||marker.parentTaskId!==plan.parentTaskId||marker.role!==role.role
        ||marker.planSha256!==planSha256||!isDeepStrictEqual(marker.selection,role.selection)||marker.maxSteps!==role.maxSteps
        ||marker.verificationPolicyRef!==role.verificationPolicyRef)
        throw new ProtocolError('REVISION_CONFLICT','Original child role binding changed');
      const model=runtime.loadCheckpoint(child.taskId,'execution-model'),thinking=runtime.loadCheckpoint(child.taskId,'subtask-thinking-binding');
      if(model===undefined||thinking===undefined)return {role:role.role,state:'unavailable' as const,reason:'original_child_model_not_bound'};
      if(!isDeepStrictEqual(parseExecutionModelSelection(model),role.selection)||!plain(thinking)||!plain(thinking.stepBudget)
        ||!plain(thinking.modelReasoning)||thinking.stepBudget.maxSteps!==role.maxSteps
        ||thinking.modelReasoning.effort!==(role.selection.reasoningEffort??null))
        throw new ProtocolError('REVISION_CONFLICT','Original child model or step budget changed');
      return {role:role.role,state:'bound' as const,childTaskId:child.taskId,taskState:child.state,
        model:role.selection,stepBudget:{maxSteps:role.maxSteps},verificationPolicyRef:role.verificationPolicyRef,
        nativeReasoningVerification:'conditional' as const,providerExecution:'not_verified' as const};
    });
    sync(()=>options.assertCurrent(context,structuredClone(plan)));
    active(context);return {state:roles.every(value=>value.state==='bound')?'bound':'unavailable',roles};
  }
  return {bind,read,reconcile};
}
