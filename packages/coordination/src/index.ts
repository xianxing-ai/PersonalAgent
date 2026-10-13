import {ProtocolError} from '@personal-agent/contracts';
import type {ToolDescriptor} from '@personal-agent/contracts';
import {Buffer} from 'node:buffer';
import {parseCoordinationRepairCandidate, type CoordinationRepairCandidateResult} from './repair-candidate.js';
export {parseCoordinationRepairCandidate};
export type {CoordinationRepairCandidateResult};

const textResultFields = ['kind', 'text', 'verification'] as const;
const proposalResultFields = ['kind', 'proposalId', 'toolName', 'toolVersion', 'arguments', 'verification'] as const;
const continuationFields = ['proposalId', 'state', 'result'] as const;
const availableToolFields = ['name', 'version', 'inputSchema'] as const;
// Total UTF-8 JSON budget, including the continuation envelope. Not a wire limit.
const MAX_CONTINUATION_JSON_BYTES = 1_048_576;
// Preserve the existing UTF-16 JSON argument limit while bounding the copy itself.
const MAX_PROPOSAL_JSON_CHARS = 65_536;
// Shared by the trusted Runtime projection and cloud request parser. Leave room
// for the user goal and request envelope within AgentArts' 32 KiB initial query.
export const MAX_AVAILABLE_TOOLS = 64;
export const MAX_AVAILABLE_TOOLS_JSON_BYTES = 24_576;
interface JsonBudget { remaining: number; unit?: 'utf8' | 'utf16'; }

function hasExactEnumerableKeys(value: object, fields: readonly string[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    return keys.length === fields.length
      && keys.every(key => typeof key === 'string' && fields.includes(key))
      && fields.every(field => Object.prototype.propertyIsEnumerable.call(value, field));
  } catch {
    return false;
  }
}

/** Only the trusted host selects and minimizes these existing descriptor fields. */
export type CoordinationAvailableTool = Pick<ToolDescriptor, 'name' | 'version' | 'inputSchema'>;

/** In-process, provisional boundary. No Runtime, credentials or history. */
export interface CoordinationRequest {
  readonly taskId: string;
  readonly revision: number;
  readonly goal: string;
  readonly deadline: string;
  readonly signal: AbortSignal;
  readonly continuation?: CoordinationContinuation;
  readonly availableTools?: readonly CoordinationAvailableTool[];
}

export interface CoordinationTextResult {
  kind: 'text';
  text: string;
  verification: 'mock' | 'unverified';
}

export interface CoordinationToolProposalResult {
  kind: 'tool_proposal';
  proposalId: string;
  toolName: string;
  toolVersion: string;
  arguments: Record<string, unknown>;
  verification: 'mock' | 'unverified';
}

export interface CoordinationContinuation {
  proposalId: string;
  state: 'confirmed';
  result: unknown;
}

export type CoordinationResult = CoordinationTextResult | CoordinationToolProposalResult | CoordinationRepairCandidateResult;

export interface CoordinationPort {
  execute(request: CoordinationRequest): Promise<CoordinationResult>;
}

/** Adapter owns deployment/identity. It may propose tools but never authorize or execute them. */
export interface CloudAgentPort {
  invoke(request: CoordinationRequest): Promise<CoordinationResult>;
}

export {AgentArtsCloudAgentPort} from './agentarts.js';
export {AgentArtsResultUnknownError} from './agentarts-websocket.js';
export type {AgentArtsTransportState, AgentArtsUnknownReceipt, AgentArtsWebSocket,
  AgentArtsWebSocketFactory, AgentArtsWebSocketConnectOptions} from './agentarts-websocket.js';
export type {
  AgentArtsAuthorizationProvider,
  AgentArtsDiagnosticStage,
  AgentArtsFetch,
  AgentArtsFetchInit,
  AgentArtsFailureDiagnostic,
  AgentArtsResponse,
  AgentArtsRuntimeConfig,
  AgentArtsSchemaCategory,
  AgentArtsWebSocketOptions,
} from './agentarts.js';

/** Runtime validates even typed adapters. Text is not execution evidence. */
export function parseCoordinationTextResult(value: unknown): CoordinationTextResult {
  let array = false;
  try {
    array = Array.isArray(value);
  } catch {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid coordination result');
  }
  if (value === null || typeof value !== 'object' || array) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid coordination result');
  }
  const result = value as Record<string, unknown>;
  if (!hasExactEnumerableKeys(result, textResultFields)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Expected bounded text without tool proposals, evidence or task state');
  }
  let kind: unknown;
  let text: unknown;
  let verification: unknown;
  try {
    kind = result.kind;
    text = result.text;
    verification = result.verification;
  } catch {
    // A provider-controlled getter/proxy must not leak its exception message.
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid coordination result');
  }
  if (kind !== 'text' || typeof text !== 'string'
    || text.trim().length === 0 || text.length > 16_000
    || !['mock', 'unverified'].includes(verification as string)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Expected bounded text without tool proposals, evidence or task state');
  }
  return {kind: 'text', text, verification: verification as CoordinationTextResult['verification']};
}

function invalidResult(): never {
  throw new ProtocolError('INVALID_ARGUMENT', 'Invalid coordination result');
}

function takeJsonUnits(budget: JsonBudget | undefined, units: number): void {
  if (budget === undefined) return;
  if (units > budget.remaining) invalidResult();
  budget.remaining -= units;
}

function takeJsonString(budget: JsonBudget | undefined, value: string): void {
  if (budget === undefined) return;
  // Reject obviously oversized strings before allocating their escaped form.
  if (value.length + 2 > budget.remaining) invalidResult();
  const serialized = JSON.stringify(value);
  takeJsonUnits(budget, budget.unit === 'utf16' ? serialized.length : Buffer.byteLength(serialized, 'utf8'));
}

function cloneJsonValue(value: unknown, seen = new Set<object>(), depth = 0, budget?: JsonBudget): unknown {
  if (depth > 16) invalidResult();
  if (typeof value === 'string') { takeJsonString(budget, value); return value; }
  if (value === null || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) {
    takeJsonUnits(budget, JSON.stringify(value).length);
    return value;
  }
  if (typeof value !== 'object') invalidResult();
  if (seen.has(value)) invalidResult();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      // Never invoke a provider-controlled map/getter or skip sparse entries.
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 256) invalidResult();
      const keys = Reflect.ownKeys(value);
      if (keys.length !== length + 1 || !keys.includes('length')
        || keys.some(key => key !== 'length' && (typeof key !== 'string'
          || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) invalidResult();
      takeJsonUnits(budget, 2 + Math.max(0, length - 1));
      const result: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor)) invalidResult();
        result.push(cloneJsonValue(descriptor.value, seen, depth + 1, budget));
      }
      return result;
    }
    let prototype: object | null;
    let descriptors: PropertyDescriptorMap;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return invalidResult();
    }
    if (prototype !== Object.prototype && prototype !== null) invalidResult();
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 128 || keys.some(key => typeof key !== 'string')) invalidResult();
    takeJsonUnits(budget, 2 + Math.max(0, keys.length - 1));
    const result: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) invalidResult();
      takeJsonString(budget, key);
      takeJsonUnits(budget, 1); // Colon between the key and its value.
      // JSON keys are data, including __proto__; assignment would invoke its
      // legacy setter on a normal object and silently change the argument shape.
      Object.defineProperty(result, key, {
        value: cloneJsonValue(descriptor.value, seen, depth + 1, budget),
        enumerable: true, writable: true, configurable: true,
      });
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function boundedIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function parseCoordinationToolProposal(value: unknown): CoordinationToolProposalResult {
  try {
    return parseToolProposal(value);
  } catch {
    return invalidResult();
  }
}

function parseToolProposal(value: unknown): CoordinationToolProposalResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !hasExactEnumerableKeys(value, proposalResultFields)) invalidResult();
  const proposal = value as Record<string, unknown>;
  let kind: unknown;
  let proposalId: unknown;
  let toolName: unknown;
  let toolVersion: unknown;
  let argumentsValue: unknown;
  let verification: unknown;
  try {
    ({kind, proposalId, toolName, toolVersion, arguments: argumentsValue, verification} = proposal);
  } catch {
    return invalidResult();
  }
  const argumentsClone = cloneJsonValue(argumentsValue, new Set<object>(), 0,
    {remaining: MAX_PROPOSAL_JSON_CHARS, unit: 'utf16'});
  if (kind !== 'tool_proposal' || !boundedIdentifier(proposalId, 128)
    || !boundedIdentifier(toolName, 128) || !boundedIdentifier(toolVersion, 64)
    || argumentsClone === null || typeof argumentsClone !== 'object' || Array.isArray(argumentsClone)
    || !['mock', 'unverified'].includes(verification as string)
    || JSON.stringify(argumentsClone).length > MAX_PROPOSAL_JSON_CHARS) invalidResult();
  return {kind, proposalId, toolName, toolVersion,
    arguments: argumentsClone as Record<string, unknown>,
    verification: verification as CoordinationToolProposalResult['verification']};
}

export function parseCoordinationContinuation(value: unknown): CoordinationContinuation {
  // Reflection on revoked proxies or hostile descriptors must remain sanitized.
  try {
    return parseContinuation(value);
  } catch {
    return invalidResult();
  }
}

/** Defensive JSON snapshot of a trusted, already filtered tool directory. */
export function parseCoordinationAvailableTools(value: unknown): readonly CoordinationAvailableTool[] {
  let copy: unknown;
  try {
    copy = cloneJsonValue(value, new Set<object>(), 0, {remaining: MAX_AVAILABLE_TOOLS_JSON_BYTES});
  } catch {
    return invalidResult();
  }
  if (!Array.isArray(copy) || copy.length > MAX_AVAILABLE_TOOLS
    || Buffer.byteLength(JSON.stringify(copy), 'utf8') > MAX_AVAILABLE_TOOLS_JSON_BYTES) invalidResult();
  const names = new Set<string>();
  for (const tool of copy) {
    if (tool === null || typeof tool !== 'object' || Array.isArray(tool)
      || !hasExactEnumerableKeys(tool, availableToolFields)) invalidResult();
    const entry = tool as Record<string, unknown>;
    if (!boundedIdentifier(entry.name, 128) || !boundedIdentifier(entry.version, 64)
      || names.has(entry.name) || entry.inputSchema === null
      || typeof entry.inputSchema !== 'object' || Array.isArray(entry.inputSchema)) invalidResult();
    names.add(entry.name);
  }
  const freeze = (item: unknown): void => {
    if (item !== null && typeof item === 'object') {
      for (const value of Object.values(item)) freeze(value);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy as CoordinationAvailableTool[];
}

function parseContinuation(value: unknown): CoordinationContinuation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !hasExactEnumerableKeys(value, continuationFields)) invalidResult();
  const continuation = value as Record<string, unknown>;
  let proposalId: unknown;
  let state: unknown;
  let result: unknown;
  try {
    ({proposalId, state, result} = continuation);
  } catch {
    return invalidResult();
  }
  if (!boundedIdentifier(proposalId, 128) || state !== 'confirmed') invalidResult();
  const budget: JsonBudget = {remaining: MAX_CONTINUATION_JSON_BYTES};
  // Count the exact envelope without serializing the untrusted result.
  takeJsonUnits(budget, Buffer.byteLength(JSON.stringify({proposalId, state, result: null}), 'utf8') - 4);
  return {proposalId, state, result: cloneJsonValue(result, new Set<object>(), 0, budget)};
}

export function parseCoordinationResult(value: unknown): CoordinationResult {
  let kind: unknown;
  try {
    kind = value !== null && typeof value === 'object' ? (value as {kind?: unknown}).kind : undefined;
  } catch {
    return invalidResult();
  }
  if (kind === 'text') return parseCoordinationTextResult(value);
  if (kind === 'tool_proposal') return parseCoordinationToolProposal(value);
  if (kind === 'repair_candidate') return parseCoordinationRepairCandidate(value);
  return invalidResult();
}

export {CompetitionCoordinator, UnavailableCloudAgentPort} from './coordinator.js';
