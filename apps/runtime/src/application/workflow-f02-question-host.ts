import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import type {AuthorizationQuestions} from './authorization-question.js';

type Scope={parentTaskId:string;localTaskId:string;operationId:string;sessionId:string;deadline:string;signal:AbortSignal};
type Original={taskId:string;conversationId:string;deadline:string};
type QuestionBinding={questionId:string;sourceTaskId:string;runId:string};
type Result={questionId:string;revision:number;approvalRevision:number;toolName:string;summary:string;argumentsDigest:string;expiresAt:string};
type Application=Pick<RuntimeApplication,'runtime'|'readHostToolTask'|'readDelegatedUserTaskParent'|'readPendingToolInvocation'|'readToolConversation'>;
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=2048;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}

/** Trusted composition only. Question selection and exact export must be tied
 * to the original user's choice and destination; same conversation is not a
 * selection or export grant. This host never decides or consumes a question. */
export function createF02PendingQuestionHost(options?:{
  application:Application;
  questions:Pick<AuthorizationQuestions,'snapshot'|'refresh'>;
  requiredScopes:readonly string[];
  resolveOriginalQuestion:(scope:Scope,original:Original)=>QuestionBinding|undefined;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:Result)=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'
    ||typeof options.application.readDelegatedUserTaskParent!=='function'||typeof options.application.readPendingToolInvocation!=='function'
    ||typeof options.application.readToolConversation!=='function'||typeof options.questions?.snapshot!=='function'
    ||typeof options.questions?.refresh!=='function'||typeof options.resolveOriginalQuestion!=='function'
    ||typeof options.assertCurrent!=='function'||typeof options.authorizeExport!=='function'||typeof options.now!=='function'
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length||!options.requiredScopes.every(text))
    return {tools:[],unavailable:'f02_question_trusted_ports_unavailable'};
  const {application,questions}=options,runtime=application.runtime,requiredScopes=[...options.requiredScopes];
  function active(context:ToolContext):Scope {
    if(context.signal.aborted)fail('CANCELLED','Original F02 question cancelled');
    const now=options!.now();
    if(!(now instanceof Date)||!Number.isFinite(now.getTime())||!Number.isFinite(Date.parse(context.deadline))
      ||now.getTime()>=Date.parse(context.deadline))fail('TIMEOUT','Original F02 question expired');
    if(!context.authorizationRef||!requiredScopes.every(scope=>context.scopes.includes(scope)))fail('SCOPE_DENIED','F02 question scope required');
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    if(!parent?.taskId||!parent.operationId||context.runId!=='host-tool-'+context.taskId)fail('UNAUTHORIZED','Original F02 host binding unavailable');
    const intent=runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId) as
      {taskId?:string;workflowId?:string;sessionId?:string;deadline?:string;proposal?:{nodeId?:string;operationId?:string;toolName?:string;arguments?:unknown}}|undefined;
    const host=runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {commandId?:string;toolName?:string;arguments?:unknown;deadline?:string}|undefined;
    const owner=runtime.getTask(parent.taskId);
    if(owner.cancelRequested||!['running','waiting_approval'].includes(owner.state)||intent?.taskId!==parent.taskId
      ||intent.workflowId!=='F02'||!text(intent.sessionId)||intent.proposal?.nodeId!=='F02_N01'
      ||intent.proposal.operationId!==parent.operationId||intent.proposal.toolName!=='workflow.host.f02_n01'
      ||host?.commandId!==parent.operationId||host.toolName!=='workflow.host.f02_n01'||host.deadline!==context.deadline
      ||intent.deadline!==context.deadline||!isDeepStrictEqual(intent.proposal.arguments,{})||!isDeepStrictEqual(host.arguments,{}))
      fail('UNAUTHORIZED','Original F02 graph intent changed');
    const scope={parentTaskId:parent.taskId,localTaskId:context.taskId,operationId:parent.operationId,
      sessionId:intent.sessionId,deadline:context.deadline,signal:context.signal};
    try {const checked:unknown=options!.assertCurrent(scope,context);
      if(checked!==undefined){void Promise.resolve(checked).catch(()=>undefined);throw Error('invalid gate');}}
    catch {fail('UNAUTHORIZED','Original F02 question authority unavailable');}
    return scope;
  }
  function read(scope:Scope,context:ToolContext):Result {
    const original=application.readDelegatedUserTaskParent(scope.parentTaskId);
    if(!original||original.deadline!==scope.deadline)fail('UNSUPPORTED_CAPABILITY','Original F02 user task unavailable');
    let binding:QuestionBinding|undefined;
    try {binding=options!.resolveOriginalQuestion(scope,original);}catch {fail('UNAUTHORIZED','Original F02 question selection unavailable');}
    if(!binding||!text(binding.questionId)||!text(binding.sourceTaskId)||!text(binding.runId))
      fail('UNSUPPORTED_CAPABILITY','Original F02 question selection unavailable');
    if(application.readToolConversation(binding.sourceTaskId)!==original.conversationId)
      fail('UNAUTHORIZED','Original F02 question source differs');
    try {questions.refresh();}catch {fail('UNSUPPORTED_CAPABILITY','Original F02 question host unavailable');}
    const matches=questions.snapshot(original.conversationId).filter(item=>item.questionId===binding!.questionId
      &&item.taskId===binding!.sourceTaskId&&item.sourceApprovalId===binding!.runId&&item.state==='pending');
    if(matches.length!==1)fail('UNSUPPORTED_CAPABILITY','Original pending F02 question unavailable');
    const question=matches[0]!,invocation=application.readPendingToolInvocation(binding.sourceTaskId,binding.runId);
    let approval:ReturnType<typeof runtime.getApproval>;
    try {approval=runtime.getApproval(binding.runId);}catch {return fail('UNSUPPORTED_CAPABILITY','Original pending F02 approval unavailable');}
    if(!invocation||invocation.toolName!==question.toolName||!text(question.description)||!text(question.questionId)
      ||!Number.isSafeInteger(question.revision)||question.revision<1||!Number.isFinite(Date.parse(question.expiresAt))
      ||Date.parse(question.expiresAt)<=options!.now().getTime()||!/^[a-f0-9]{64}$/u.test(invocation.argumentsDigest)
      ||approval.approvalId!==binding.runId||approval.taskId!==binding.sourceTaskId||approval.state!=='pending'
      ||approval.toolName!==invocation.toolName||approval.argumentsDigest!==invocation.argumentsDigest
      ||!Number.isSafeInteger(approval.revision)||approval.revision<1||!Number.isFinite(Date.parse(approval.expiresAt))
      ||Date.parse(approval.expiresAt)<=options!.now().getTime())
      fail('UNSUPPORTED_CAPABILITY','Original pending F02 operation unavailable');
    active(context);
    return {questionId:question.questionId,revision:question.revision,approvalRevision:approval.revision,toolName:question.toolName,
      summary:question.description,argumentsDigest:invocation.argumentsDigest,expiresAt:question.expiresAt};
  }
  const tool=createOwnedWorkflowAdapter({nodeId:'F02_N01',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['questionId','revision','approvalRevision','toolName','summary','argumentsDigest','expiresAt'],
      properties:{questionId:{type:'string'},revision:{type:'integer'},approvalRevision:{type:'integer'},toolName:{type:'string'},summary:{type:'string'},argumentsDigest:{type:'string'},expiresAt:{type:'string'}}},
    async execute(_input,context){return read(active(context),context);}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context),saved=application.readHostToolTask(context.taskId);
    if(saved.commandId!==scope.operationId||saved.toolName!=='workflow.host.f02_n01'||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!==context.runId||!saved.confirmed.evidenceRefs.includes(context.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,result)||!plain(result))fail('UNAUTHORIZED','Original F02 question receipt unavailable');
    if(!isDeepStrictEqual(read(scope,context),result))fail('REVISION_CONFLICT','Original F02 question changed before export');
    let allowed:boolean;
    try {allowed=await options!.authorizeExport(scope,structuredClone(result) as unknown as Result);}
    catch {active(context);return fail('UNAUTHORIZED','Original F02 export authorization unavailable');}
    if(allowed!==true)fail('UNAUTHORIZED','Original F02 export authorization unavailable');
    if(!isDeepStrictEqual(read(active(context),context),result))fail('REVISION_CONFLICT','Original F02 question changed before export');
  }};
}
