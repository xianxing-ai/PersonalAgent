import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext,ToolDescriptor,TaskSnapshot} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {TaskRuntime} from '../index.js';
import type {RuntimeApplication,SubmitHostToolTaskRequest,HostToolTaskReadback} from './runtime-application.js';

export interface OriginalMailSendBinding {
  taskId:string;runId:string;toolVersion:string;arguments:Record<string,unknown>;scopeRef:string;
  accountRef:string;configurationRef:string;
}
export interface OriginalMailSendIdentity {
  version:1;taskId:string;runId:string;toolName:'mail.send';toolVersion:string;argumentsDigest:string;
  scopeRef:string;accountRef:string;configurationRef:string;messageId:string;idempotencyKey:string;deadline:string;
}
const key=(runId:string)=>'mail-send-identity:'+runId;
const denied=():never=>{throw new ProtocolError('UNAUTHORIZED','Original mail send identity does not match its authorized execution');};
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=1000;

function original(runtime:TaskRuntime,binding:OriginalMailSendBinding) {
  if(![binding.taskId,binding.runId,binding.toolVersion,binding.scopeRef,binding.accountRef].every(text)
    || !/^[a-f0-9]{64}$/u.test(binding.configurationRef)||!binding.arguments||Array.isArray(binding.arguments))denied();
  if(runtime.loadCheckpoint(binding.taskId,'private-copy-erasure')!==undefined)denied();
  const record=runtime.readToolExecutions(binding.taskId).find(value=>value.evidenceId===binding.runId);
  if(!record||record.toolName!=='mail.send'||record.toolVersion!==binding.toolVersion
    ||!record.executionStarted||record.policyDecision!=='allow'
    ||!runtime.matchesToolExecutionInput(record,{arguments:binding.arguments,scopeRef:binding.scopeRef}))return denied();
  return record;
}

/** Private trusted-host read only. No permission, SMTP, task transition, or claim that delivery occurred. */
export function readOriginalMailSendIdentity(runtime:TaskRuntime,binding:OriginalMailSendBinding):Readonly<OriginalMailSendIdentity>|undefined {
  const stored=runtime.loadCheckpoint(binding.taskId,key(binding.runId)) as OriginalMailSendIdentity|undefined;
  if(stored===undefined)return undefined;
  original(runtime,binding);
  const expected={version:1,taskId:binding.taskId,runId:binding.runId,toolName:'mail.send',toolVersion:binding.toolVersion,
    argumentsDigest:toolArgumentsDigest(binding.arguments),scopeRef:binding.scopeRef,accountRef:binding.accountRef,
    configurationRef:binding.configurationRef,messageId:stored.messageId,idempotencyKey:binding.runId,deadline:stored.deadline};
  if(!isDeepStrictEqual(stored,expected)||!/^<[^<>\s]{1,998}>$/u.test(stored.messageId)
    ||!Number.isFinite(Date.parse(stored.deadline)))denied();
  return Object.freeze(structuredClone(stored));
}

/** Called inside the original mail.send execution, after Policy and before the provider's first SMTP call. */
export function prepareOriginalMailSendIdentity(runtime:TaskRuntime,binding:OriginalMailSendBinding,
  identity:Readonly<{idempotencyKey:string;messageId:string}>,context:ToolContext,now=Date.now):'persisted'|'existing' {
  if(context.signal.aborted)throw new ProtocolError('CANCELLED','Original mail send cancelled before identity persistence');
  if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=now())
    throw new ProtocolError('TIMEOUT','Original mail send deadline expired');
  const task=runtime.getTask(binding.taskId),record=original(runtime,binding);
  if(task.state!=='running'||task.cancelRequested||record.state!=='started'
    ||context.taskId!==binding.taskId||context.runId!==binding.runId||context.authorizationRef!==binding.scopeRef
    ||context.argumentsDigest!==toolArgumentsDigest(binding.arguments)||!context.scopes.includes('mail:send')
    ||identity.idempotencyKey!==binding.runId||!/^<[^<>\s]{1,998}>$/u.test(identity.messageId)
    ||!runtime.readToolDescriptors().some(value=>value.name==='mail.send'&&value.version===binding.toolVersion
      &&value.sideEffect==='external_write'&&value.requiredScopes.includes('mail:send')))denied();
  const value:OriginalMailSendIdentity={version:1,taskId:binding.taskId,runId:binding.runId,toolName:'mail.send',toolVersion:binding.toolVersion,
    argumentsDigest:toolArgumentsDigest(binding.arguments),scopeRef:binding.scopeRef,accountRef:binding.accountRef,
    configurationRef:binding.configurationRef,...identity,deadline:context.deadline};
  if(runtime.saveCheckpointOnce(binding.taskId,key(binding.runId),value))return 'persisted';
  if(!isDeepStrictEqual(readOriginalMailSendIdentity(runtime,binding),value))denied();
  return 'existing';
}

type MailRecoveryApplication=Pick<RuntimeApplication,'runtime'|'prepareHostToolTask'|'finalizeHostToolTask'|'readHostToolTask'>;
interface MailReconciliationBinding {
  version:1;identity:OriginalMailSendIdentity;originalInputDigest:string;descriptor:ToolDescriptor;
  request:SubmitHostToolTaskRequest;localTaskId:string;
}
const recoveryKey=(runId:string)=>'mail-send-reconciliation:'+runId;
const childKey='mail-send-reconciliation:original';

function readReconciliationBinding(runtime:TaskRuntime,taskId:string,runId:string,configurationRef:string) {
  const saved=runtime.loadCheckpoint(taskId,recoveryKey(runId)) as MailReconciliationBinding|undefined;
  if(!saved)return undefined;
  const record=runtime.readToolExecutions(taskId).find(value=>value.evidenceId===runId),identity=saved.identity;
  if(saved.version!==1||!identity||identity.taskId!==taskId||identity.runId!==runId||identity.configurationRef!==configurationRef
    ||runtime.loadCheckpoint(taskId,'private-copy-erasure')!==undefined
    ||!isDeepStrictEqual(identity,runtime.loadCheckpoint(taskId,key(runId)))
    ||!record||record.inputDigest!==saved.originalInputDigest||record.toolName!=='mail.send'||record.toolVersion!==identity.toolVersion
    ||!record.executionStarted||record.policyDecision!=='allow'
    ||saved.descriptor.name!=='mail.reconcile_send'||saved.descriptor.sideEffect!=='read'
    ||!isDeepStrictEqual(saved.descriptor,runtime.readToolDescriptors().find(value=>value.name===saved.descriptor.name))
    ||saved.request.toolName!==saved.descriptor.name||saved.request.toolVersion!==saved.descriptor.version
    ||!isDeepStrictEqual(saved.request.arguments,{account:identity.accountRef,messageId:identity.messageId,idempotencyKey:identity.runId}))denied();
  return saved;
}

/** Recheck the original private source at execution after the independent read approval. Ordinary reads remain unchanged. */
export function assertOriginalMailSendReconciliation(runtime:TaskRuntime,taskId:string,configurationRef:string,args:unknown,context:ToolContext,now=Date.now):void {
  const parent=runtime.loadCheckpoint(taskId,childKey) as {taskId:string;runId:string}|undefined;
  if(!parent)return;
  const saved=readReconciliationBinding(runtime,parent.taskId,parent.runId,configurationRef);
  if(!saved||saved.localTaskId!==taskId||!isDeepStrictEqual(saved.request.arguments,args)||context.runId!=='host-tool-'+taskId
    ||context.deadline!==saved.request.deadline||context.signal.aborted||Date.parse(context.deadline)<=now()
    ||runtime.loadCheckpoint(taskId,'private-copy-erasure')!==undefined
    ||!isDeepStrictEqual(runtime.loadCheckpoint(taskId,'coding-repair:parent'),{taskId:parent.taskId,operationId:saved.request.commandId})
    ||!isDeepStrictEqual(runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+saved.request.commandId),{localTaskId:taskId,request:saved.request}))denied();
}

/** Fixed original read child: repeated admission observes the same task; it never resends SMTP or repeats an unknown read. */
export function prepareOriginalMailSendReconciliation(application:MailRecoveryApplication,binding:OriginalMailSendBinding,
  scope:{deadline:string;signal:AbortSignal},now=Date.now) {
  const {runtime}=application,identity=readOriginalMailSendIdentity(runtime,binding);
  if(!identity)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original SMTP identity is unavailable');
  if(runtime.isTaskActive(binding.taskId))throw new ProtocolError('REVISION_CONFLICT','Original SMTP execution is still active');
  if(scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.parse(scope.deadline)<=now())denied();
  let saved=readReconciliationBinding(runtime,binding.taskId,binding.runId,binding.configurationRef);
  if(!saved){
    const descriptor=runtime.readToolDescriptors().find(value=>value.name==='mail.reconcile_send');
    if(!descriptor||descriptor.sideEffect!=='read'||!descriptor.requiredScopes.includes('mail:read'))denied();
    const commandId='mail-reconcile-'+createHash('sha256').update(JSON.stringify([binding.taskId,binding.runId])).digest('hex');
    const request={commandId,toolName:'mail.reconcile_send',toolVersion:descriptor!.version,
      arguments:{account:identity.accountRef,messageId:identity.messageId,idempotencyKey:identity.runId},deadline:scope.deadline};
    const child=application.prepareHostToolTask(request);
    saved={version:1,identity,originalInputDigest:original(runtime,binding).inputDigest,descriptor:descriptor!,request,localTaskId:child.taskId};
    if(!runtime.saveCheckpointOnce(binding.taskId,recoveryKey(binding.runId),saved)
      &&!isDeepStrictEqual(runtime.loadCheckpoint(binding.taskId,recoveryKey(binding.runId)),saved))denied();
  }
  const child=runtime.getTask(saved.localTaskId),parent={taskId:binding.taskId,runId:binding.runId};
  const bind=(taskId:string,key:string,value:unknown)=>{if(!runtime.saveCheckpointOnce(taskId,key,value)
    &&!isDeepStrictEqual(runtime.loadCheckpoint(taskId,key),value))denied();};
  if(child.state==='created'){
    bind(child.taskId,childKey,parent);
    bind(child.taskId,'coding-repair:parent',{taskId:binding.taskId,operationId:saved.request.commandId});
    bind(binding.taskId,'coding-repair:host:'+saved.request.commandId,{localTaskId:child.taskId,request:saved.request});
    application.finalizeHostToolTask({taskId:child.taskId,commandId:saved.request.commandId,expectedTaskRevision:child.revision,arguments:saved.request.arguments});
  }else if(!isDeepStrictEqual(runtime.loadCheckpoint(child.taskId,childKey),parent))denied();
  return application.readHostToolTask(child.taskId);
}

/** Verify an actual approved read receipt. apply changes only the original unknown execution; cancelled/terminal tasks stay untouched. */
export interface OriginalMailSendReconciliation {state:'unavailable'|'pending'|'unknown'|'confirmed';task?:TaskSnapshot;readback?:HostToolTaskReadback}
export function readOriginalMailSendReconciliation(application:MailRecoveryApplication,binding:OriginalMailSendBinding,apply=false):OriginalMailSendReconciliation {
  const {runtime}=application,identity=readOriginalMailSendIdentity(runtime,binding);
  const saved=readReconciliationBinding(runtime,binding.taskId,binding.runId,binding.configurationRef);
  if(!identity||!saved)return {state:'unavailable' as const};
  const child=application.readHostToolTask(saved.localTaskId),runId='host-tool-'+saved.localTaskId;
  const intent=runtime.loadCheckpoint(saved.localTaskId,'host-tool-intent') as {arguments?:unknown;deadline?:string}|undefined;
  if(child.commandId!==saved.request.commandId||child.toolName!=='mail.reconcile_send'||child.toolVersion!==saved.descriptor.version
    ||!isDeepStrictEqual(intent?.arguments,saved.request.arguments)||intent?.deadline!==saved.request.deadline
    ||runtime.loadCheckpoint(saved.localTaskId,'private-copy-erasure')!==undefined
    ||!isDeepStrictEqual(runtime.loadCheckpoint(saved.localTaskId,childKey),{taskId:binding.taskId,runId:binding.runId})
    ||!isDeepStrictEqual(runtime.loadCheckpoint(saved.localTaskId,'coding-repair:parent'),{taskId:binding.taskId,operationId:saved.request.commandId})
    ||!isDeepStrictEqual(runtime.loadCheckpoint(binding.taskId,'coding-repair:host:'+saved.request.commandId),{localTaskId:saved.localTaskId,request:saved.request}))denied();
  if(!child.confirmed)return {state:['failed','cancelled','waiting_reconciliation'].includes(child.task.state)?'unknown':'pending',readback:child};
  const record=runtime.readToolExecutions(saved.localTaskId).find(value=>value.evidenceId===runId),result=child.confirmed.result as
    {state?:string;actionId?:string;externalId?:string;evidenceRefs?:string[]};
  if(!record||record.state!=='confirmed'||record.toolName!=='mail.reconcile_send'||record.toolVersion!==saved.descriptor.version
    ||!record.executionStarted||record.policyDecision!=='allow'||!runtime.matchesToolExecutionInput(record,{arguments:saved.request.arguments,scopeRef:runId})
    ||result?.externalId!==identity.messageId||result.actionId!=='mail-send:'+identity.runId)return denied();
  if(result.state!=='confirmed')return {state:'unknown' as const,readback:child};
  let task=runtime.getTask(binding.taskId);
  if(apply){
    const evidenceId='mail-readback-'+createHash('sha256').update(JSON.stringify([binding.taskId,binding.runId,runId])).digest('hex');
    const observation={evidenceId,kind:'observation',sourceRef:'mail.reconcile_send',capturedAt:record.finishedAt,
      summary:'Original SMTP Message-ID verified by an independently authorized mailbox read',verification:'verified',sensitivity:'private'};
    if(!runtime.saveCheckpointOnce(binding.taskId,'trusted-readback-evidence:'+evidenceId,observation)
      &&!isDeepStrictEqual(runtime.loadCheckpoint(binding.taskId,'trusted-readback-evidence:'+evidenceId),observation))denied();
    if(!task.cancelRequested&&task.state==='waiting_reconciliation')
      task=runtime.reconcileToolExecution(binding.taskId,binding.runId,'applied',result,[evidenceId],{deferTaskCompletion:true});
  }
  return {state:'confirmed' as const,task,readback:child};
}
