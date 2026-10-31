import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import type {AuthorizationQuestionRequest,AuthorizationQuestionReceipt,AuthorizationQuestions} from './authorization-question.js';

type Scope={parentTaskId:string;localTaskId:string;operationId:string;sessionId:string;deadline:string;signal:AbortSignal};
type Original={taskId:string;conversationId:string;deadline:string};
type OriginalConfirmation={questionTaskId:string;request:AuthorizationQuestionRequest;receipt:AuthorizationQuestionReceipt};
type Result={state:'approved';questionId:string;questionRevision:number;approvalRevision:number;toolName:string;argumentsDigest:string};
type Application=Pick<RuntimeApplication,'runtime'|'readHostToolTask'|'readDelegatedUserTaskParent'|'readToolConversation'
  |'readAuthorizationQuestionInvocation'|'readAuthorizationQuestionBinding'>;
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=2048;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}

/** Read-only observation of an existing explicit decision and already-consumed
 * question requirement. This never consumes, creates, extends or resumes a grant. */
export function createF02ConfirmationHost(options?:{
  application:Application;questions:Pick<AuthorizationQuestions,'snapshot'|'assertRequirement'>;
  requiredScopes:readonly string[];
  /** Trusted Desktop original-operation store, never a model/voice interpretation. */
  resolveOriginalConfirmation:(scope:Scope,original:Original)=>OriginalConfirmation|undefined;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:Result)=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'
    ||typeof options.application.readDelegatedUserTaskParent!=='function'||typeof options.application.readToolConversation!=='function'
    ||typeof options.application.readAuthorizationQuestionInvocation!=='function'||typeof options.application.readAuthorizationQuestionBinding!=='function'
    ||typeof options.questions?.snapshot!=='function'||typeof options.questions?.assertRequirement!=='function'
    ||typeof options.resolveOriginalConfirmation!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function'
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length||!options.requiredScopes.every(text))
    return {tools:[],unavailable:'f02_confirmation_trusted_ports_unavailable'};
  const {application,questions}=options,runtime=application.runtime,requiredScopes=[...options.requiredScopes];
  function active(context:ToolContext):Scope {
    if(context.signal.aborted)fail('CANCELLED','Original F02 confirmation cancelled');
    const now=options!.now();
    if(!(now instanceof Date)||!Number.isFinite(now.getTime())||!Number.isFinite(Date.parse(context.deadline))
      ||now.getTime()>=Date.parse(context.deadline))fail('TIMEOUT','Original F02 confirmation expired');
    if(!context.authorizationRef||!requiredScopes.every(scope=>context.scopes.includes(scope)))fail('SCOPE_DENIED','F02 confirmation scope required');
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    if(!parent?.taskId||!parent.operationId||context.runId!=='host-tool-'+context.taskId)fail('UNAUTHORIZED','Original F02 host binding unavailable');
    const intent=runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId) as
      {taskId?:string;workflowId?:string;sessionId?:string;deadline?:string;proposal?:{nodeId?:string;operationId?:string;toolName?:string;arguments?:unknown}}|undefined;
    const host=runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {commandId?:string;toolName?:string;arguments?:unknown;deadline?:string}|undefined;
    const owner=runtime.getTask(parent.taskId);
    if(owner.cancelRequested||!['running','waiting_approval'].includes(owner.state)||intent?.taskId!==parent.taskId
      ||intent.workflowId!=='F02'||!text(intent.sessionId)||intent.proposal?.nodeId!=='F02_N05'
      ||intent.proposal.operationId!==parent.operationId||intent.proposal.toolName!=='workflow.host.f02_n05'
      ||host?.commandId!==parent.operationId||host.toolName!=='workflow.host.f02_n05'||host.deadline!==context.deadline
      ||intent.deadline!==context.deadline||!isDeepStrictEqual(intent.proposal.arguments,{})||!isDeepStrictEqual(host.arguments,{}))
      fail('UNAUTHORIZED','Original F02 confirmation intent changed');
    const scope={parentTaskId:parent.taskId,localTaskId:context.taskId,operationId:parent.operationId,
      sessionId:intent.sessionId,deadline:context.deadline,signal:context.signal};
    try {const checked:unknown=options!.assertCurrent(scope,context);
      if(checked!==undefined){void Promise.resolve(checked).catch(()=>undefined);throw Error('invalid gate');}}
    catch {fail('UNAUTHORIZED','Original F02 confirmation authority unavailable');}
    return scope;
  }
  function read(scope:Scope,context:ToolContext):Result {
    const original=application.readDelegatedUserTaskParent(scope.parentTaskId);
    if(!original||original.deadline!==scope.deadline)fail('UNSUPPORTED_CAPABILITY','Original F02 user task unavailable');
    let binding:OriginalConfirmation|undefined;
    try {binding=options!.resolveOriginalConfirmation(scope,original);}catch {fail('UNAUTHORIZED','Original F02 user confirmation unavailable');}
    if(!binding||!text(binding.questionTaskId)||!binding.request||!binding.receipt)
      fail('UNSUPPORTED_CAPABILITY','Original F02 user confirmation unavailable');
    const {request,receipt}=binding;
    if(!text(request.taskId)||!text(request.runId)||!text(receipt.questionId)
      ||!['allow_once','allow_task','allow_always'].includes(receipt.decision)
      ||application.readToolConversation(request.taskId)!==original.conversationId)
      fail('UNAUTHORIZED','Original F02 user confirmation differs');
    const previousParent=runtime.loadCheckpoint(binding.questionTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    if(previousParent?.taskId!==scope.parentTaskId||!text(previousParent.operationId)
      ||application.readToolConversation(binding.questionTaskId)!==original.conversationId)
      fail('UNAUTHORIZED','Original F02 question task differs');
    const previousIntent=runtime.loadCheckpoint(scope.parentTaskId,'owned-workflow:intent:'+previousParent.operationId) as
      {taskId?:string;workflowId?:string;sessionId?:string;deadline?:string;proposal?:{nodeId?:string;operationId?:string;toolName?:string;arguments?:unknown}}|undefined;
    const previous=application.readHostToolTask(binding.questionTaskId);
    if(previousIntent?.taskId!==scope.parentTaskId||previousIntent.workflowId!=='F02'||previousIntent.sessionId!==scope.sessionId
      ||previousIntent.deadline!==scope.deadline||previousIntent.proposal?.nodeId!=='F02_N01'
      ||previousIntent.proposal.operationId!==previousParent.operationId||previousIntent.proposal.toolName!=='workflow.host.f02_n01'
      ||!isDeepStrictEqual(previousIntent.proposal.arguments,{})||previous.commandId!==previousParent.operationId
      ||previous.toolName!=='workflow.host.f02_n01'||previous.task.state!=='succeeded'
      ||previous.confirmed?.runId!=='host-tool-'+binding.questionTaskId||!previous.confirmed.evidenceRefs.includes(previous.confirmed.runId)
      ||!plain(previous.confirmed.result))fail('UNAUTHORIZED','Original F02 question receipt unavailable');
    const prior=previous.confirmed.result;
    if(prior.questionId!==receipt.questionId||prior.toolName!==request.toolName||prior.argumentsDigest!==request.argumentsDigest
      ||!Number.isSafeInteger(prior.revision)||!Number.isSafeInteger(prior.approvalRevision)
      ||receipt.revision!==(prior.revision as number)+1)fail('REVISION_CONFLICT','Original F02 question revision changed');
    const question=questions.snapshot(original.conversationId).find(item=>item.questionId===receipt.questionId
      &&item.taskId===request.taskId&&item.sourceApprovalId===request.runId&&item.revision===receipt.revision&&item.state==='allowed');
    const invocation=application.readAuthorizationQuestionInvocation(request.taskId,request.runId);
    const owner=application.readAuthorizationQuestionBinding(request);
    let approval:ReturnType<typeof runtime.getApproval>;
    try {approval=runtime.getApproval(request.runId);}catch{return fail('UNSUPPORTED_CAPABILITY','Original F02 approval unavailable');}
    const grant=runtime.policy.get(request.runId);
    if(!question||owner?.conversationId!==original.conversationId||!invocation||invocation.taskId!==request.taskId
      ||invocation.runId!==request.runId||invocation.proposalId!==request.proposalId||invocation.toolName!==request.toolName
      ||invocation.toolVersion!==request.toolVersion||invocation.argumentsDigest!==request.argumentsDigest||invocation.deadline!==request.deadline
      ||approval.approvalId!==request.runId||approval.taskId!==request.taskId||approval.toolName!==request.toolName
      ||approval.argumentsDigest!==request.argumentsDigest||approval.state!=='allowed'||approval.revision!==(prior.approvalRevision as number)+1
      ||!grant||grant.authorizationRef!==request.runId||grant.taskId!==request.taskId||grant.toolName!==request.toolName
      ||grant.argumentsDigest!==request.argumentsDigest||grant.usesRemaining!==1||grant.expiresAt!==approval.expiresAt
      ||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=options!.now().getTime()
      ||!isDeepStrictEqual([...grant.scopes].sort(),[...approval.scopes].sort()))
      fail('UNSUPPORTED_CAPABILITY','Original F02 approved operation unavailable');
    try {questions.assertRequirement(receipt,request,'tool',request.runId+':tool');}
    catch {fail('UNAUTHORIZED','Original F02 confirmation authority unavailable');}
    active(context);
    return {state:'approved',questionId:receipt.questionId,questionRevision:receipt.revision,
      approvalRevision:approval.revision,toolName:request.toolName,argumentsDigest:request.argumentsDigest};
  }
  const tool=createOwnedWorkflowAdapter({nodeId:'F02_N05',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['state','questionId','questionRevision','approvalRevision','toolName','argumentsDigest'],
      properties:{state:{const:'approved'},questionId:{type:'string'},questionRevision:{type:'integer'},approvalRevision:{type:'integer'},toolName:{type:'string'},argumentsDigest:{type:'string'}}},
    async execute(_input,context){return read(active(context),context);}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context),saved=application.readHostToolTask(context.taskId);
    if(saved.commandId!==scope.operationId||saved.toolName!=='workflow.host.f02_n05'||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!==context.runId||!saved.confirmed.evidenceRefs.includes(context.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,result)||!plain(result))fail('UNAUTHORIZED','Original F02 confirmation receipt unavailable');
    if(!isDeepStrictEqual(read(scope,context),result))fail('REVISION_CONFLICT','Original F02 confirmation changed before export');
    let allowed:boolean;
    try {allowed=await options!.authorizeExport(scope,structuredClone(result) as unknown as Result);}
    catch {active(context);return fail('UNAUTHORIZED','Original F02 confirmation export unavailable');}
    if(allowed!==true)fail('UNAUTHORIZED','Original F02 confirmation export unavailable');
    if(!isDeepStrictEqual(read(active(context),context),result))fail('REVISION_CONFLICT','Original F02 confirmation changed before export');
  }};
}
