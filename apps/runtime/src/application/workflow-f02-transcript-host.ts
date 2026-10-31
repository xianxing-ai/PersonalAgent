import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import type {AuthorizationQuestions} from './authorization-question.js';

type Scope={parentTaskId:string;localTaskId:string;operationId:string;sessionId:string;deadline:string;signal:AbortSignal};
type Original={taskId:string;conversationId:string;deadline:string};
type VoiceBinding={questionTaskId:string;questionId:string;questionRevision:number;sourceTaskId:string;sourceApprovalId:string;
  sessionId:string;utteranceId:string};
/** Existing Live event receipt; echo and question playback are deliberately not presumed. */
export interface F02LiveFinalReceipt {sessionId:string;utteranceId:string;conversationId:string;questionId:string;questionRevision:number;
  sourceTaskId:string;sourceApprovalId:string;text:string;transcriptDigest:string;source:'live_input_audio';phase:'final';origin:'user';
  echo:'unknown';questionPlaybackVerified:false;startedAt:string;completedAt:string;expiresAt:string}
type Result={questionId:string;questionRevision:number;sessionId:string;utteranceId:string;text:string;transcriptDigest:string};
type Application=Pick<RuntimeApplication,'runtime'|'readHostToolTask'|'readDelegatedUserTaskParent'|'readToolConversation'|'readPendingToolInvocation'>;
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=2048;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}

/** A final transcription is an observation, never an authorization decision.
 * The host must independently prove original microphone/provider event, absence
 * of echo, and delivery of this question; an unverified flag is not proof. */
export function createF02FinalTranscriptHost(options?:{
  application:Application;questions:Pick<AuthorizationQuestions,'snapshot'|'refresh'>;requiredScopes:readonly string[];
  resolveOriginalVoice:(scope:Scope,original:Original)=>VoiceBinding|undefined;
  readFinal:(binding:VoiceBinding & {conversationId:string;deadline:string;signal:AbortSignal})=>F02LiveFinalReceipt|undefined;
  /** Observe the already authorized original live session; never starts ASR or retries audio. */
  waitForFinal?:(scope:Scope,context:ToolContext)=>Promise<void>;
  verifyAudioEvidence:(scope:Scope,binding:VoiceBinding,receipt:F02LiveFinalReceipt)=>boolean;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:Result)=>Promise<boolean>;now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'
    ||typeof options.application.readDelegatedUserTaskParent!=='function'||typeof options.application.readToolConversation!=='function'
    ||typeof options.application.readPendingToolInvocation!=='function'||typeof options.questions?.snapshot!=='function'
    ||typeof options.questions?.refresh!=='function'||typeof options.resolveOriginalVoice!=='function'
    ||typeof options.readFinal!=='function'||typeof options.verifyAudioEvidence!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function'
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length||!options.requiredScopes.every(text))
    return {tools:[],unavailable:'f02_transcript_trusted_ports_unavailable'};
  const {application,questions}=options,runtime=application.runtime,requiredScopes=[...options.requiredScopes];
  function active(context:ToolContext):Scope {
    if(context.signal.aborted)fail('CANCELLED','Original F02 transcript cancelled');
    const now=options!.now();
    if(!(now instanceof Date)||!Number.isFinite(now.getTime())||!Number.isFinite(Date.parse(context.deadline))
      ||now.getTime()>=Date.parse(context.deadline))fail('TIMEOUT','Original F02 transcript expired');
    if(!context.authorizationRef||!requiredScopes.every(scope=>context.scopes.includes(scope)))fail('SCOPE_DENIED','F02 transcript scope required');
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    if(!parent?.taskId||!parent.operationId||context.runId!=='host-tool-'+context.taskId)fail('UNAUTHORIZED','Original F02 host binding unavailable');
    const intent=runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId) as
      {taskId?:string;workflowId?:string;sessionId?:string;deadline?:string;proposal?:{nodeId?:string;operationId?:string;toolName?:string;arguments?:unknown}}|undefined;
    const host=runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {commandId?:string;toolName?:string;arguments?:unknown;deadline?:string}|undefined;
    const owner=runtime.getTask(parent.taskId);
    if(owner.cancelRequested||!['running','waiting_approval'].includes(owner.state)||intent?.taskId!==parent.taskId
      ||intent.workflowId!=='F02'||!text(intent.sessionId)||intent.proposal?.nodeId!=='F02_N03'
      ||intent.proposal.operationId!==parent.operationId||intent.proposal.toolName!=='workflow.host.f02_n03'
      ||host?.commandId!==parent.operationId||host.toolName!=='workflow.host.f02_n03'||host.deadline!==context.deadline
      ||intent.deadline!==context.deadline||!isDeepStrictEqual(intent.proposal.arguments,{})||!isDeepStrictEqual(host.arguments,{}))
      fail('UNAUTHORIZED','Original F02 transcript intent changed');
    const scope={parentTaskId:parent.taskId,localTaskId:context.taskId,operationId:parent.operationId,
      sessionId:intent.sessionId,deadline:context.deadline,signal:context.signal};
    try {const checked:unknown=options!.assertCurrent(scope,context);
      if(checked!==undefined){void Promise.resolve(checked).catch(()=>undefined);throw Error('invalid gate');}}
    catch {fail('UNAUTHORIZED','Original F02 transcript authority unavailable');}
    return scope;
  }
  function read(scope:Scope,context:ToolContext):Result {
    const original=application.readDelegatedUserTaskParent(scope.parentTaskId);
    if(!original||original.deadline!==scope.deadline)fail('UNSUPPORTED_CAPABILITY','Original F02 user task unavailable');
    let binding:VoiceBinding|undefined;
    try {binding=options!.resolveOriginalVoice(scope,original);}catch {fail('UNAUTHORIZED','Original F02 voice binding unavailable');}
    if(!binding||![binding.questionTaskId,binding.questionId,binding.sourceTaskId,binding.sourceApprovalId,binding.sessionId,binding.utteranceId].every(text)
      ||!Number.isSafeInteger(binding.questionRevision)||binding.questionRevision<1)
      fail('UNSUPPORTED_CAPABILITY','Original F02 voice binding unavailable');
    const previousParent=runtime.loadCheckpoint(binding.questionTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    if(previousParent?.taskId!==scope.parentTaskId||!text(previousParent.operationId)
      ||application.readToolConversation(binding.questionTaskId)!==original.conversationId
      ||application.readToolConversation(binding.sourceTaskId)!==original.conversationId)
      fail('UNAUTHORIZED','Original F02 question task differs');
    const priorIntent=runtime.loadCheckpoint(scope.parentTaskId,'owned-workflow:intent:'+previousParent.operationId) as
      {taskId?:string;workflowId?:string;sessionId?:string;deadline?:string;proposal?:{nodeId?:string;operationId?:string;toolName?:string;arguments?:unknown}}|undefined;
    const priorTask=application.readHostToolTask(binding.questionTaskId),prior=priorTask.confirmed?.result;
    if(priorIntent?.taskId!==scope.parentTaskId||priorIntent.workflowId!=='F02'||priorIntent.sessionId!==scope.sessionId
      ||priorIntent.deadline!==scope.deadline||priorIntent.proposal?.nodeId!=='F02_N01'
      ||priorIntent.proposal.operationId!==previousParent.operationId||priorIntent.proposal.toolName!=='workflow.host.f02_n01'
      ||!isDeepStrictEqual(priorIntent.proposal.arguments,{})||priorTask.commandId!==previousParent.operationId
      ||priorTask.toolName!=='workflow.host.f02_n01'||priorTask.task.state!=='succeeded'
      ||priorTask.confirmed?.runId!=='host-tool-'+binding.questionTaskId||!priorTask.confirmed.evidenceRefs.includes(priorTask.confirmed.runId)
      ||!plain(prior)||prior.questionId!==binding.questionId||prior.revision!==binding.questionRevision)
      fail('UNAUTHORIZED','Original F02 question receipt unavailable');
    try {questions.refresh();}catch {fail('UNSUPPORTED_CAPABILITY','Original F02 question unavailable');}
    const question=questions.snapshot(original.conversationId).find(item=>item.questionId===binding!.questionId
      &&item.revision===binding!.questionRevision&&item.taskId===binding!.sourceTaskId
      &&item.sourceApprovalId===binding!.sourceApprovalId&&item.state==='pending');
    const invocation=application.readPendingToolInvocation(binding.sourceTaskId,binding.sourceApprovalId);
    let approval:ReturnType<typeof runtime.getApproval>;
    try {approval=runtime.getApproval(binding.sourceApprovalId);}catch{return fail('UNSUPPORTED_CAPABILITY','Original pending F02 approval unavailable');}
    if(!question||!invocation||question.toolName!==prior.toolName||invocation.toolName!==prior.toolName
      ||invocation.argumentsDigest!==prior.argumentsDigest||approval.state!=='pending'||approval.taskId!==binding.sourceTaskId
      ||approval.approvalId!==binding.sourceApprovalId||approval.revision!==prior.approvalRevision
      ||approval.argumentsDigest!==invocation.argumentsDigest||!Number.isFinite(Date.parse(question.expiresAt))
      ||Date.parse(question.expiresAt)<=options!.now().getTime())
      fail('UNSUPPORTED_CAPABILITY','Original pending F02 question unavailable');
    let receipt:F02LiveFinalReceipt|undefined;
    try {receipt=options!.readFinal({...binding,conversationId:original.conversationId,deadline:scope.deadline,signal:scope.signal});}
    catch {fail('UNAUTHORIZED','Original F02 audio read unavailable');}
    if(!receipt||receipt.source!=='live_input_audio'||receipt.phase!=='final'||receipt.origin!=='user'
      ||receipt.echo!=='unknown'||receipt.questionPlaybackVerified!==false
      ||receipt.sessionId!==binding.sessionId||receipt.utteranceId!==binding.utteranceId||receipt.conversationId!==original.conversationId
      ||receipt.questionId!==binding.questionId||receipt.questionRevision!==binding.questionRevision
      ||receipt.sourceTaskId!==binding.sourceTaskId||receipt.sourceApprovalId!==binding.sourceApprovalId
      ||typeof receipt.text!=='string'||!receipt.text.trim()||receipt.text.length>24000
      ||receipt.transcriptDigest!==createHash('sha256').update(receipt.text).digest('hex')
      ||!Number.isFinite(Date.parse(receipt.startedAt))||!Number.isFinite(Date.parse(receipt.completedAt))||!Number.isFinite(Date.parse(receipt.expiresAt))
      ||Date.parse(receipt.startedAt)>Date.parse(receipt.completedAt)||Date.parse(receipt.completedAt)>options!.now().getTime()
      ||Date.parse(receipt.expiresAt)<=options!.now().getTime()||Date.parse(receipt.expiresAt)>Date.parse(question.expiresAt))
      fail('UNSUPPORTED_CAPABILITY','Original final F02 audio unavailable');
    let verified:unknown;
    try {verified=options!.verifyAudioEvidence(scope,structuredClone(binding),structuredClone(receipt));}
    catch {fail('UNAUTHORIZED','Original F02 audio evidence unavailable');}
    if(verified!==true){if(verified!==false&&verified!==undefined)void Promise.resolve(verified).catch(()=>undefined);
      fail('UNSUPPORTED_CAPABILITY','Original F02 audio evidence unavailable');}
    active(context);
    return {questionId:binding.questionId,questionRevision:binding.questionRevision,sessionId:binding.sessionId,
      utteranceId:binding.utteranceId,text:receipt.text,transcriptDigest:receipt.transcriptDigest};
  }
  const tool=createOwnedWorkflowAdapter({nodeId:'F02_N03',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['questionId','questionRevision','sessionId','utteranceId','text','transcriptDigest'],
      properties:{questionId:{type:'string'},questionRevision:{type:'integer'},sessionId:{type:'string'},utteranceId:{type:'string'},text:{type:'string'},transcriptDigest:{type:'string'}}},
    async execute(_input,context){const scope=active(context);await options.waitForFinal?.(scope,context);return read(active(context),context);}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context),saved=application.readHostToolTask(context.taskId);
    if(saved.commandId!==scope.operationId||saved.toolName!=='workflow.host.f02_n03'||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!==context.runId||!saved.confirmed.evidenceRefs.includes(context.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,result)||!plain(result))fail('UNAUTHORIZED','Original F02 transcript receipt unavailable');
    if(!isDeepStrictEqual(read(scope,context),result))fail('REVISION_CONFLICT','Original F02 transcript changed before export');
    let allowed:boolean;
    try {allowed=await options!.authorizeExport(scope,structuredClone(result) as unknown as Result);}
    catch {active(context);return fail('UNAUTHORIZED','Original F02 transcript export unavailable');}
    if(allowed!==true)fail('UNAUTHORIZED','Original F02 transcript export unavailable');
    if(!isDeepStrictEqual(read(active(context),context),result))fail('REVISION_CONFLICT','Original F02 transcript changed before export');
  }};
}
