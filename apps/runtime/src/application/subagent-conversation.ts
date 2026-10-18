import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateContract} from '@personal-agent/contracts';
import type {TaskSnapshot,ToolDescriptor} from '@personal-agent/contracts';
import {DEFAULT_ROLE_LABELS} from '@personal-agent/agents';
import type {SubtaskDefinition} from '@personal-agent/agents';
import {parseExecutionModelSelection} from '@personal-agent/coordination';
import type {ExecutionModelSelection} from '@personal-agent/coordination';
import type {TaskRuntime} from '../index.js';
import {isRuntimeDispatchTool} from './coding-repair-application.js';

export const SUBAGENT_CONVERSATION_MESSAGE='subagent-conversation-message:v1';
export const isTerminalTask=(task:TaskSnapshot):boolean=>['succeeded','failed','cancelled'].includes(task.state);
const text=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value===value.trim();
export interface SubagentConversationScope {parentTaskId:string;taskId:string;}
export interface SubmitSubagentConversationMessage extends SubagentConversationScope {text:string;requestId:string;deadline?:string;}
export interface SubagentConversationSnapshot extends SubagentConversationScope {
  conversationId:string;messages:{taskId:string;userText:string;replyText?:string;state:TaskSnapshot['state'];error?:NonNullable<TaskSnapshot['error']>}[];
  activeTaskId?:string;canSubmit:boolean;submitUnavailableReason?:string;updatedAt:string;
}
export interface SubagentConversationList {
  items:{parentTaskId:string;taskId:string;role:string;modelId:string;state:TaskSnapshot['state'];updatedAt:string;goal?:string}[];
  nextCursor?:string;
}
export function decodeSubagentConversationCursor(cursor?:string):{beforeSequence?:number;snapshotSequence?:number;seenTaskIds:string[]} {
  if(cursor===undefined)return {seenTaskIds:[]};
  try {
    if(typeof cursor!=='string'||!cursor||!/^[A-Za-z0-9_-]+$/u.test(cursor))throw Error();
    const parsed=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')) as {beforeSequence:number;snapshotSequence:number;seenTaskIds:string[]};
    if(!parsed||Object.keys(parsed).sort().join(',')!=='beforeSequence,seenTaskIds,snapshotSequence'
      ||!Number.isSafeInteger(parsed.beforeSequence)||parsed.beforeSequence<1
      ||!Number.isSafeInteger(parsed.snapshotSequence)||parsed.snapshotSequence<0
      ||!Array.isArray(parsed.seenTaskIds)||parsed.seenTaskIds.some(item=>!text(item))
      ||new Set(parsed.seenTaskIds).size!==parsed.seenTaskIds.length)throw Error();
    return parsed;
  } catch {throw new ProtocolError('INVALID_ARGUMENT','Invalid subagent conversation cursor');}
}
export interface SubagentConversationOrigin {
  parentTaskId:string;task:TaskSnapshot;definition:SubtaskDefinition;conversationId:string;configurationRef:string;
  tools:ToolDescriptor[];model?:ExecutionModelSelection;maxSteps:number;digest:string;
}
export interface SubagentConversationMessageBinding {
  version:'1.0';parentTaskId:string;originTaskId:string;requestId:string;userText:string;deadline:string;originDigest:string;
}
export function assertConversationScope(input:SubagentConversationScope,extra:string[]=[]):void {
  if(!input||typeof input!=='object'||Array.isArray(input)||!text(input.parentTaskId)||!text(input.taskId)
    ||Object.keys(input).some(key=>!['parentTaskId','taskId',...extra].includes(key))) {
    throw new ProtocolError('INVALID_ARGUMENT','Invalid subagent conversation scope');
  }
}
export function subagentConversationMessageKey(originTaskId:string,requestId:string):string {
  return 'subagent-conversation-message-'+createHash('sha256').update(JSON.stringify([originTaskId,requestId])).digest('hex');
}
export function subagentConversationGoal(origin:SubagentConversationOrigin,userText:string):string {
  return `[${origin.definition.roleLabel?.trim()||DEFAULT_ROLE_LABELS[origin.definition.role]}] ${userText}`;
}
export function readSubagentConversationOrigin(runtime:TaskRuntime,scope:SubagentConversationScope):SubagentConversationOrigin {
  runtime.getTask(scope.parentTaskId);
  const task=runtime.getTask(scope.taskId);
  const saved=runtime.loadCheckpoint(task.taskId,'subtask-parent') as (SubtaskDefinition&{parentTaskId:string;parentDeadline:string})|undefined;
  if(!saved||saved.parentTaskId!==scope.parentTaskId||!text(saved.subtaskId)||!text(saved.goal)
    ||!Object.hasOwn(DEFAULT_ROLE_LABELS,saved.role)||task.conversationId!==`desktop-subtask:${scope.parentTaskId}`
    ||runtime.findTaskByIdempotencyKey(`subagent-dispatch-${scope.parentTaskId}-${saved.subtaskId}`)?.taskId!==task.taskId) {
    throw new ProtocolError('SCOPE_DENIED','Subagent does not belong to this original parent');
  }
  const {parentTaskId:_parent,parentDeadline:_deadline,...definition}=saved;
  const roleLabel=definition.roleLabel?.trim()||DEFAULT_ROLE_LABELS[definition.role];
  if(task.goal!==`[${roleLabel}] ${definition.goal}`)throw new ProtocolError('REVISION_CONFLICT','Original subagent identity changed');
  const execution=runtime.loadCheckpoint(task.taskId,'subtask-execution-binding') as {kind?:string}|undefined;
  const coordination=runtime.loadCheckpoint(task.taskId,'subtask-coordination-binding') as {profile?:string;configurationRef?:string}|undefined;
  const frozen=runtime.loadCheckpoint(task.taskId,'subtask-tools-binding') as ToolDescriptor[]|undefined;
  const maxSteps=runtime.loadCheckpoint(task.taskId,'competition-max-steps');
  if(execution?.kind!=='competition'||coordination?.profile!=='huawei_ict_agentarts'||!text(coordination.configurationRef)
    ||!Array.isArray(frozen)||typeof maxSteps!=='number'||!Number.isSafeInteger(maxSteps)||maxSteps<1) {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original Competition subagent execution scope is unavailable');
  }
  for(const descriptor of frozen)validateContract('tool',descriptor);
  const selection=runtime.loadCheckpoint(task.taskId,'execution-model');
  const model=selection===undefined?undefined:parseExecutionModelSelection(selection);
  if((definition.model!==undefined&&model?.modelId!==definition.model)
    ||(definition.reasoningEffort!==undefined&&model?.reasoningEffort!==definition.reasoningEffort)) {
    throw new ProtocolError('REVISION_CONFLICT','Original subagent model selection changed');
  }
  const identity={parentTaskId:scope.parentTaskId,originTaskId:task.taskId,definition,
    configurationRef:coordination.configurationRef,tools:frozen,model:model??null,maxSteps};
  return {parentTaskId:scope.parentTaskId,task,definition,conversationId:`desktop-subagent-conversation:${task.taskId}`,
    configurationRef:coordination.configurationRef,tools:frozen.filter(tool=>!isRuntimeDispatchTool(tool.name)),
    ...(model?{model}:{}),maxSteps,digest:createHash('sha256').update(JSON.stringify(identity)).digest('hex')};
}
export function readSubagentConversationMessage(runtime:TaskRuntime,taskId:string,
  origin?:SubagentConversationOrigin):SubagentConversationMessageBinding|undefined {
  const binding=runtime.loadCheckpoint(taskId,SUBAGENT_CONVERSATION_MESSAGE) as SubagentConversationMessageBinding|undefined;
  if(binding===undefined)return undefined;
  const task=runtime.getTask(taskId);
  const source=origin??readSubagentConversationOrigin(runtime,{parentTaskId:binding.parentTaskId,taskId:binding.originTaskId});
  if(binding.version!=='1.0'||!text(binding.requestId)||binding.parentTaskId!==source.parentTaskId) {
    throw new ProtocolError('SCOPE_DENIED','Subagent message scope changed');
  }
  if(binding.originTaskId!==source.task.taskId||binding.originDigest!==source.digest||typeof binding.userText!=='string'
    ||!binding.userText.trim()||subagentConversationGoal(source,binding.userText)!==task.goal
    ||typeof binding.deadline!=='string'||!Number.isFinite(Date.parse(binding.deadline))
    ||task.conversationId!==source.conversationId
    ||runtime.findTaskByIdempotencyKey(subagentConversationMessageKey(binding.originTaskId,binding.requestId))?.taskId!==taskId) {
    throw new ProtocolError('REVISION_CONFLICT','Subagent message does not match its persistent conversation');
  }
  return binding;
}
export function listSubagentConversationMessages(runtime:TaskRuntime,origin:SubagentConversationOrigin):TaskSnapshot[] {
  const items:TaskSnapshot[]=[];let beforeSequence:number|undefined;let snapshotSequence:number|undefined;
  for(;;) {
    const page=runtime.listTasks({conversationId:origin.conversationId,limit:100,
      ...(beforeSequence===undefined?{}:{beforeSequence}),...(snapshotSequence===undefined?{}:{snapshotSequence})});
    for(const task of page.items) {
      if(!readSubagentConversationMessage(runtime,task.taskId,origin))throw new ProtocolError('SCOPE_DENIED','Unbound task in subagent conversation');
      items.push(task);
    }
    if(page.nextBeforeSequence===undefined)return items.reverse();
    beforeSequence=page.nextBeforeSequence;snapshotSequence=page.snapshotSequence;
  }
}
export function sameConversationTools(expected:readonly ToolDescriptor[],current:readonly ToolDescriptor[]):boolean {
  return expected.every(tool=>!isRuntimeDispatchTool(tool.name)&&current.some(candidate=>isDeepStrictEqual(candidate,tool)));
}
