import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {MAX_COORDINATION_INITIAL_QUERY_BYTES, ProtocolError} from '@personal-agent/contracts';
import {parseCoordinationContinuation, parseCoordinationToolProposal,
  type CoordinationAvailableTool, type CoordinationContinuation, type CoordinationToolProposalResult,
  type ExecutionModelSelection} from '@personal-agent/coordination';

export const EXECUTION_CAPACITY_CHECKPOINT='competition-execution-capacity:v1';

/** Host checkpoint only. A window is scheduling capacity, not a project budget. */
export interface ExecutionCapacityState {
  version: '1.0';
  mode: 'progressive';
  deadline: string;
  initialWindowSteps: number;
  windowSteps: number;
  windowEndStep: number;
  extensions: number;
  /** Present only when the user explicitly supplied a total step limit. */
  maxSteps?: number;
  evaluatedReceiptCount: number;
  /** Binds proposal/action identities; result text never grants more capacity. */
  evaluatedReceiptDigest: string;
}

/** Original Runtime records, never model claims or a generated summary. */
export interface ExecutionCapacityReceipt {
  readonly proposal: CoordinationToolProposalResult;
  readonly continuation: CoordinationContinuation;
}

export interface CreateExecutionCapacityInput {
  /** Only set by trusted composition for newly admitted tasks. */
  enabled?: boolean;
  initialWindowSteps: number;
  windowSteps?: number;
  maxSteps?: number;
  deadline: string;
}

export interface AdvanceExecutionCapacityInput {
  step: number;
  deadline: string;
  signal: AbortSignal;
  cancelRequested?: boolean;
  /** Caller supplies its clock; this module does not create or renew deadlines. */
  nowMs: number;
  receipts: readonly ExecutionCapacityReceipt[];
}

export interface ExecutionCapacityDecision {
  state: ExecutionCapacityState | undefined;
  extended: boolean;
  reason: 'disabled' | 'window_open' | 'explicit_limit' | 'unconfirmed_progress'
    | 'no_confirmed_progress' | 'extended';
}

export const MAX_PRIOR_EXECUTION_CONTINUATIONS = 32;
export const MAX_OMITTED_TOOL_SUMMARIES = 32;
const EMPTY_DIGEST = createHash('sha256').digest('hex');
const STATE_FIELDS = ['version', 'mode', 'deadline', 'initialWindowSteps', 'windowSteps',
  'windowEndStep', 'extensions', 'maxSteps', 'evaluatedReceiptCount', 'evaluatedReceiptDigest'];

function invalid(message: string): never { throw new ProtocolError('INVALID_ARGUMENT', message); }
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function digest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }

/** Called only after the existing strict Coordination JSON parsers. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(object[key])).join(',') + '}';
}

function actionFor(receipt: ExecutionCapacityReceipt): {
  proposal: CoordinationToolProposalResult; actionDigest: string;
} {
  let proposal: CoordinationToolProposalResult;
  try { proposal = parseCoordinationToolProposal(receipt.proposal); }
  catch { return invalid('Invalid original execution receipt'); }
  return {proposal, actionDigest: digest(canonicalJson({toolName: proposal.toolName,
    toolVersion: proposal.toolVersion, arguments: proposal.arguments}))};
}

function confirmed(receipt: ExecutionCapacityReceipt): boolean {
  if (!receipt || !receipt.continuation || !receipt.proposal
    || receipt.continuation.proposalId !== receipt.proposal.proposalId) {
    return invalid('Original execution receipt identity does not match');
  }
  if (receipt.continuation.state !== 'confirmed') return false;
  return true;
}

function receiptIdentity(receipt: ExecutionCapacityReceipt): string {
  const action=actionFor(receipt);
  return JSON.stringify([action.proposal.proposalId,action.actionDigest,action.proposal.verification])+'\n';
}

export function parseExecutionCapacity(state: ExecutionCapacityState): ExecutionCapacityState {
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || Object.keys(state).some(key => !STATE_FIELDS.includes(key))
    || state.version !== '1.0' || state.mode !== 'progressive' || !timestamp(state.deadline)
    || !positiveInteger(state.initialWindowSteps) || !positiveInteger(state.windowSteps)
    || !positiveInteger(state.windowEndStep) || !count(state.extensions)
    || (state.maxSteps !== undefined && !positiveInteger(state.maxSteps))
    || !count(state.evaluatedReceiptCount) || !/^[a-f0-9]{64}$/.test(state.evaluatedReceiptDigest)) {
    return invalid('Invalid persisted execution capacity');
  }
  const expanded = BigInt(state.initialWindowSteps) + BigInt(state.windowSteps) * BigInt(state.extensions);
  const expected = state.maxSteps === undefined ? expanded
    : expanded < BigInt(state.maxSteps) ? expanded : BigInt(state.maxSteps);
  if (expected > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(state.windowEndStep) !== expected) {
    return invalid('Invalid persisted execution capacity window');
  }
  return {...state};
}

/** Host readers share the original bound window without rewriting legacy budgets. */
export function resolveExecutionStepLimit(initialWindowSteps:unknown,state:unknown,deadline:unknown):number {
  if(!positiveInteger(initialWindowSteps))return invalid('Invalid persisted Competition step budget');
  if(state===undefined)return initialWindowSteps;
  const capacity=parseExecutionCapacity(state as ExecutionCapacityState);
  if(capacity.initialWindowSteps!==initialWindowSteps||capacity.deadline!==deadline)
    throw new ProtocolError('UNAUTHORIZED','Original Competition execution capacity binding changed');
  return capacity.windowEndStep;
}

/** Validate the original evaluated prefix without copying results or issuing execution authority. */
export function assertExecutionCapacityReceiptPrefix(saved:unknown,receipts:readonly ExecutionCapacityReceipt[]):void {
  const state=parseExecutionCapacity(saved as ExecutionCapacityState);
  if(!Array.isArray(receipts))return invalid('Invalid original execution receipt history');
  if(state.evaluatedReceiptCount>receipts.length)
    throw new ProtocolError('REVISION_CONFLICT','Original execution receipt history was shortened');
  const prefix=createHash('sha256');
  for(let index=0;index<state.evaluatedReceiptCount;index++) {
    const receipt=receipts[index]!;
    if(!confirmed(receipt))throw new ProtocolError('REVISION_CONFLICT','Original evaluated execution is not confirmed');
    prefix.update(receiptIdentity(receipt),'utf8');
  }
  if(prefix.digest('hex')!==state.evaluatedReceiptDigest)
    throw new ProtocolError('REVISION_CONFLICT','Original execution receipt history changed');
}

/** Undefined is deliberate: legacy tasks cannot acquire progressive capacity on resume. */
export function createExecutionCapacity(input: CreateExecutionCapacityInput): ExecutionCapacityState | undefined {
  if (input.enabled !== true) return undefined;
  if (!timestamp(input.deadline) || !positiveInteger(input.initialWindowSteps)
    || (input.windowSteps !== undefined && !positiveInteger(input.windowSteps))
    || (input.maxSteps !== undefined && !positiveInteger(input.maxSteps))) {
    return invalid('Invalid execution capacity configuration');
  }
  return {version: '1.0', mode: 'progressive', deadline: input.deadline,
    initialWindowSteps: input.initialWindowSteps, windowSteps: input.windowSteps ?? input.initialWindowSteps,
    windowEndStep: Math.min(input.initialWindowSteps, input.maxSteps ?? input.initialWindowSteps),
    extensions: 0, ...(input.maxSteps === undefined ? {} : {maxSteps: input.maxSteps}),
    evaluatedReceiptCount: 0, evaluatedReceiptDigest: EMPTY_DIGEST};
}

/**
 * Extend only at the current window boundary after a new original confirmed action.
 * Identical tool/version/canonical arguments never earn capacity again, even if a
 * result contains a changing timestamp or the planner issues another proposal ID.
 * We scan the retained Runtime originals rather than growing a second history Map.
 * The host still owns confirmation, Policy, cancellation and the original deadline.
 */
export function advanceExecutionCapacity(saved: ExecutionCapacityState | undefined,
  input: AdvanceExecutionCapacityInput): ExecutionCapacityDecision {
  if (!timestamp(input.deadline) || !Number.isFinite(input.nowMs) || !positiveInteger(input.step)
    || !(input.signal instanceof AbortSignal) || !Array.isArray(input.receipts)) {
    return invalid('Invalid execution capacity input');
  }
  if (input.signal.aborted || input.cancelRequested) throw new ProtocolError('CANCELLED', 'Execution capacity cancelled');
  if (input.nowMs >= Date.parse(input.deadline)) throw new ProtocolError('TIMEOUT', 'Original execution deadline expired');
  if (saved === undefined) return {state: undefined, extended: false, reason: 'disabled'};
  const state = parseExecutionCapacity(saved);
  if (state.deadline !== input.deadline) throw new ProtocolError('UNAUTHORIZED', 'Execution capacity deadline changed');
  if (input.step > state.windowEndStep) return invalid('Execution capacity boundary was skipped');
  if (input.step < state.windowEndStep) return {state, extended: false, reason: 'window_open'};
  if (state.maxSteps !== undefined && state.windowEndStep >= state.maxSteps) {
    return {state, extended: false, reason: 'explicit_limit'};
  }
  if (state.evaluatedReceiptCount > input.receipts.length) {
    throw new ProtocolError('REVISION_CONFLICT', 'Original execution receipt history was shortened');
  }
  const prefix = createHash('sha256');
  const complete = createHash('sha256');
  for (let index = 0; index < input.receipts.length; index++) {
    const receipt = input.receipts[index]!;
    if (!confirmed(receipt)) return {state, extended: false, reason: 'unconfirmed_progress'};
    const identity = receiptIdentity(receipt);
    complete.update(identity, 'utf8');
    if (index < state.evaluatedReceiptCount) prefix.update(identity, 'utf8');
  }
  if (prefix.digest('hex') !== state.evaluatedReceiptDigest) {
    throw new ProtocolError('REVISION_CONFLICT', 'Original execution receipt history changed');
  }
  let progress = false;
  for (let index = state.evaluatedReceiptCount; index < input.receipts.length; index++) {
    const action = actionFor(input.receipts[index]!);
    let seen = action.proposal.verification === 'mock';
    for (let priorIndex = 0; priorIndex < index; priorIndex++) {
      const original = input.receipts[priorIndex]!;
      // Finding progress or a repeated action cannot skip another original
      // binding with this proposal ID. Only action comparison may stop early.
      if (original.proposal.proposalId !== action.proposal.proposalId && (progress || seen)) continue;
      const prior = actionFor(original);
      if (prior.proposal.proposalId === action.proposal.proposalId && prior.actionDigest !== action.actionDigest) {
        throw new ProtocolError('REVISION_CONFLICT', 'Original execution proposal identity changed');
      }
      if (prior.proposal.verification !== 'mock' && prior.actionDigest === action.actionDigest) seen = true;
    }
    progress ||= !seen;
  }
  if (!progress) return {state, extended: false, reason: 'no_confirmed_progress'};
  const remaining = state.maxSteps === undefined ? state.windowSteps : state.maxSteps - state.windowEndStep;
  const increment = Math.min(state.windowSteps, remaining);
  if (increment > Number.MAX_SAFE_INTEGER - state.windowEndStep || state.extensions === Number.MAX_SAFE_INTEGER) {
    return invalid('Execution capacity exceeds the safe integer range');
  }
  return {state: {...state, windowEndStep: state.windowEndStep + increment, extensions: state.extensions + 1,
    evaluatedReceiptCount: input.receipts.length, evaluatedReceiptDigest: complete.digest('hex')},
    extended: true, reason: 'extended'};
}

export interface OmittedExecutionToolSummary {
  toolName: string;
  toolVersion: string;
  count: number;
  digest: string;
}
export interface OmittedExecutionSummary {
  count: number;
  digest: string;
  tools: OmittedExecutionToolSummary[];
  /** Additional public tool groups are represented by count/digest only. */
  unlisted: {count: number; digest: string};
}
export interface SelectContinuationContextInput {
  receipts: readonly ExecutionCapacityReceipt[];
  current: CoordinationContinuation;
  /** The exact remaining cloud query fields, including the final goal and selected tools. */
  queryBase?: {goal?: string; availableTools?: readonly CoordinationAvailableTool[]; executionModel?: ExecutionModelSelection};
  /** May narrow the transport ceiling, never raise it. */
  maxQueryBytes?: number;
}
export interface SelectedContinuationContext {
  continuation: CoordinationContinuation;
  priorContinuations: CoordinationContinuation[];
  currentReceiptIndex: number;
  /** Original indices let the existing export guard revalidate only the actual sent receipts. */
  priorReceiptIndices: number[];
  queryBytes: number;
  /** Metadata only; not a fabricated tool result or a replacement for original receipts. */
  omitted: OmittedExecutionSummary;
}

function originalContinuation(receipt: ExecutionCapacityReceipt): CoordinationContinuation {
  if (!confirmed(receipt)) throw new ProtocolError('RESULT_UNKNOWN', 'Continuation requires an original confirmed receipt');
  try { return parseCoordinationContinuation(receipt.continuation); }
  catch { return invalid('Invalid original execution continuation'); }
}

/**
 * Select recent original projections within both the 32-prior and whole-query UTF-8
 * limits. Current is mandatory and never shortened; an oversized current fails.
 * Full Runtime receipts are neither mutated nor replaced by the omission metadata.
 * Transient selection/group indices are bounded independently of project length.
 */
export function selectContinuationContext(input: SelectContinuationContextInput): SelectedContinuationContext {
  const limit = input.maxQueryBytes ?? MAX_COORDINATION_INITIAL_QUERY_BYTES;
  if (!positiveInteger(limit) || limit > MAX_COORDINATION_INITIAL_QUERY_BYTES || !Array.isArray(input.receipts)) {
    return invalid('Invalid continuation context budget');
  }
  const queryBase = input.queryBase ?? {};
  if (Object.keys(queryBase).some(key => !['goal', 'availableTools', 'executionModel'].includes(key))) {
    return invalid('Invalid continuation query fields');
  }
  let current: CoordinationContinuation;
  let baseBytes: number;
  let priorEnvelopeBytes: number;
  try {
    current = parseCoordinationContinuation(input.current);
    baseBytes = Buffer.byteLength(JSON.stringify({...queryBase, continuation: current}), 'utf8');
    priorEnvelopeBytes = Buffer.byteLength(JSON.stringify({...queryBase, continuation: current, priorContinuations: []}), 'utf8') - baseBytes;
  } catch { return invalid('Invalid current continuation context'); }
  if (baseBytes > limit) return invalid('Current continuation exceeds the complete query byte budget');
  let currentReceiptIndex = -1;
  for (let index = input.receipts.length - 1; index >= 0; index--) {
    if (input.receipts[index]?.proposal.proposalId !== current.proposalId) continue;
    if (!isDeepStrictEqual(originalContinuation(input.receipts[index]!), current)) {
      throw new ProtocolError('UNAUTHORIZED', 'Current continuation does not match its original receipt');
    }
    if (currentReceiptIndex === -1) currentReceiptIndex = index;
  }
  if (currentReceiptIndex === -1) throw new ProtocolError('UNAUTHORIZED', 'Current continuation has no original receipt');
  const selected: {index: number; continuation: CoordinationContinuation}[] = [];
  let selectedBytes = 0;
  for (let index = input.receipts.length - 1; index >= 0; index--) {
    const receipt = input.receipts[index]!;
    if (receipt.proposal.proposalId === current.proposalId) continue;
    if (selected.length >= MAX_PRIOR_EXECUTION_CONTINUATIONS) continue;
    const duplicate = selected.find(item => item.continuation.proposalId === receipt.proposal.proposalId);
    const continuation = originalContinuation(receipt);
    if (duplicate) {
      if (!isDeepStrictEqual(duplicate.continuation, continuation)) {
        throw new ProtocolError('REVISION_CONFLICT', 'Original execution proposal identity changed');
      }
      continue;
    }
    const bytes = Buffer.byteLength(JSON.stringify(continuation), 'utf8');
    if (baseBytes + priorEnvelopeBytes + selectedBytes + bytes + selected.length > limit) continue;
    selected.push({index, continuation});
    selectedBytes += bytes;
  }
  selected.reverse();
  const retainedIndices = new Set([currentReceiptIndex, ...selected.map(item => item.index)]);
  const omittedDigest = createHash('sha256');
  const unlistedDigest = createHash('sha256');
  const groups: {toolName: string; toolVersion: string; count: number; hash: ReturnType<typeof createHash>}[] = [];
  let omittedCount = 0, unlistedCount = 0;
  for (let index = 0; index < input.receipts.length; index++) {
    if (retainedIndices.has(index)) continue;
    const receipt = input.receipts[index]!;
    const {proposal, actionDigest} = actionFor(receipt);
    const continuation = originalContinuation(receipt);
    const entryDigest = digest(canonicalJson([actionDigest, continuation]));
    omittedDigest.update(entryDigest, 'utf8');
    omittedCount++;
    let group = groups.find(item => item.toolName === proposal.toolName && item.toolVersion === proposal.toolVersion);
    if (!group && groups.length < MAX_OMITTED_TOOL_SUMMARIES) {
      group = {toolName: proposal.toolName, toolVersion: proposal.toolVersion, count: 0, hash: createHash('sha256')};
      groups.push(group);
    }
    if (group) { group.count++; group.hash.update(entryDigest, 'utf8'); }
    else { unlistedCount++; unlistedDigest.update(entryDigest, 'utf8'); }
  }
  return {continuation: current, priorContinuations: selected.map(item => item.continuation), currentReceiptIndex,
    priorReceiptIndices: selected.map(item => item.index),
    queryBytes: baseBytes + (selected.length ? priorEnvelopeBytes + selectedBytes + selected.length - 1 : 0),
    omitted: {count: omittedCount, digest: omittedDigest.digest('hex'),
      tools: groups.map(group => ({toolName: group.toolName, toolVersion: group.toolVersion,
        count: group.count, digest: group.hash.digest('hex')})), unlisted: {count: unlistedCount, digest: unlistedDigest.digest('hex')}}};
}
