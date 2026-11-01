import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {TaskRuntime} from '../index.js';

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
