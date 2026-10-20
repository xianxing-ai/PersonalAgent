import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

export const COMPETITION_CONTEXT_CHECKPOINT = 'competition-context:v1';
export const COORDINATION_GOAL_CHARACTER_LIMIT = 16_000;

/** Trusted synchronous meter for the compiled goal only, not the provider's entire request. */
export interface CoordinationGoalTokenBudget {
  readonly tokenizerRef: string;
  readonly contextTokens: number;
  readonly reservedOutputTokens: number;
  readonly countTokens: (compiledGoal: string) => number;
}

export interface CompiledContextInput {
  readonly taskId: string;
  readonly conversationId: string;
  readonly deadline: string;
  readonly configurationRef: string;
  readonly publicGoal: string;
  readonly preparedGoal: string;
  readonly compiledGoal: string;
  readonly messages: readonly {id:string;role:string;content:string;taskId?:string}[];
  readonly privateBinding?: unknown;
  readonly compactionReceipt?: unknown;
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export function measureCompiledGoal(compiledGoal: string, budget?: CoordinationGoalTokenBudget) {
  if (compiledGoal.length > COORDINATION_GOAL_CHARACTER_LIMIT) {
    throw new ProtocolError('INVALID_ARGUMENT','Compiled goal exceeds the character budget');
  }
  let tokens: {state:'unmeasured'} | {state:'measured';tokenizerRef:string;inputTokens:number;
    contextTokens:number;reservedOutputTokens:number} = {state:'unmeasured'};
  if (budget !== undefined) {
    if (!budget || !/^[a-zA-Z0-9._:/-]{1,256}$/.test(budget.tokenizerRef)
      || !Number.isSafeInteger(budget.contextTokens) || budget.contextTokens < 1
      || !Number.isSafeInteger(budget.reservedOutputTokens) || budget.reservedOutputTokens < 0
      || budget.reservedOutputTokens >= budget.contextTokens || typeof budget.countTokens !== 'function') {
      throw new ProtocolError('INVALID_ARGUMENT','Invalid compiled goal token budget');
    }
    let count: unknown;
    try {count = budget.countTokens(compiledGoal);} catch {
      throw new ProtocolError('INVALID_ARGUMENT','Compiled goal token measurement failed');
    }
    if (count && typeof (count as Promise<unknown>).then === 'function') {
      void Promise.resolve(count).catch(()=>undefined);
    }
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      throw new ProtocolError('INVALID_ARGUMENT','Compiled goal token meter must return a synchronous count');
    }
    if ((count as number) > budget.contextTokens - budget.reservedOutputTokens) {
      throw new ProtocolError('INVALID_ARGUMENT','Compiled goal and output reservation exceed the token budget');
    }
    tokens = {state:'measured',tokenizerRef:budget.tokenizerRef,inputTokens:count as number,
      contextTokens:budget.contextTokens,reservedOutputTokens:budget.reservedOutputTokens};
  }
  return {characters:compiledGoal.length,characterLimit:COORDINATION_GOAL_CHARACTER_LIMIT,tokens};
}

/** No bodies, source paths, credentials or raw message ids enter the checkpoint. */
export function bindCompiledContext(input: CompiledContextInput, budget?: CoordinationGoalTokenBudget) {
  const projected=input.messages.length ? JSON.parse(input.compiledGoal).conversationContext : undefined;
  const included=new Set<string>((projected?.messages??[]).map((message:{id:string})=>message.id));
  return {version:1,taskId:input.taskId,conversationId:input.conversationId,deadline:input.deadline,
    configurationRef:input.configurationRef,publicGoalDigest:digest(input.publicGoal),
    preparedGoalDigest:digest(input.preparedGoal),compiledGoalDigest:digest(input.compiledGoal),
    messages:input.messages.map(message=>({identityDigest:digest(JSON.stringify([message.id,message.taskId ?? null])),
      role:message.role,contentDigest:digest(message.content)})),
    selection:{policy:projected?.selection?.policy??'complete-history-v1',sourceMessages:input.messages.length,
      includedMessages:included.size,omittedAssistantDigests:input.messages.filter(message=>!included.has(message.id))
        .map(message=>digest(JSON.stringify([message.id,message.taskId??null])))},
    ...(input.privateBinding === undefined ? {} : {privateBindingDigest:digest(JSON.stringify(input.privateBinding))}),
    ...(input.compactionReceipt === undefined ? {} : {compactionReceiptDigest:digest(JSON.stringify(input.compactionReceipt))}),
    budget:measureCompiledGoal(input.compiledGoal,budget)};
}

export function assertCompiledContextUnchanged(saved: unknown, current: unknown): void {
  if (!isDeepStrictEqual(saved,current)) {
    throw new ProtocolError('REVISION_CONFLICT','Task context version or budget changed; submit a new task');
  }
}
