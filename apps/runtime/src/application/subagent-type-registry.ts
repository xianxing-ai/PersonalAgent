import {createHash, randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {DEFAULT_ROLE_LABELS, type SubtaskRole} from '@personal-agent/agents';
import type {TaskRuntime} from '../index.js';

/** Built-in roles stay exactly the five names the synchronous dispatcher already accepts. */
export const BUILTIN_SUBAGENT_ROLES = Object.keys(DEFAULT_ROLE_LABELS) as SubtaskRole[];
export const SUBAGENT_TYPE_MAX_STEPS = 12;
export const SUBAGENT_TYPE_MAX_DEADLINE_MS = 24 * 60 * 60 * 1000;
const REGISTRY_KEY = 'subagent-type-registry:v1';
const REGISTRY_CONVERSATION = 'subagent-type-registry';
const REGISTRY_GOAL = '子智能体类型登记';
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

export interface SubagentTypeDefinition {
  name: string;
  description: string;
  instructions: string;
  allowedTools: string[];
  baseRole: SubtaskRole;
  model?: string;
  maxSteps?: number;
  deadlineMs?: number;
  enabled: boolean;
}

export interface SubagentTypeRecord {
  name: string;
  version: number;
  digest: string;
  definition: SubagentTypeDefinition;
  updatedAt: string;
  deleted?: boolean;
}

export interface SubagentTypeProposal {
  proposalId: string;
  kind: 'create' | 'update' | 'enable' | 'disable' | 'delete';
  name: string;
  digest: string;
  baseVersion?: number;
  definition?: SubagentTypeDefinition;
  createdAt: string;
}

export interface SubagentTypeRegistry {
  list(): SubagentTypeRecord[];
  get(name: string): SubagentTypeRecord | undefined;
  propose(input: {kind: SubagentTypeProposal['kind']; definition?: unknown; name?: string},
    grantedTools: readonly string[]): SubagentTypeProposal;
  confirm(proposalId: string, digest: string, grantedTools: readonly string[]): SubagentTypeRecord | {deleted: true; name: string; version: number};
  proposeConfig(text: string, grantedTools: readonly string[]): SubagentTypeProposal[];
}

function fail(code: 'INVALID_ARGUMENT' | 'REVISION_CONFLICT' | 'SCOPE_DENIED' | 'NOT_FOUND', message: string): never {
  throw new ProtocolError(code, message);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function subagentTypeDigest(definition: SubagentTypeDefinition): string {
  return createHash('sha256').update(canonical(definition)).digest('hex');
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > max) {
    fail('INVALID_ARGUMENT', `${label} is invalid`);
  }
  return value;
}

/** Reject unknown tools and any name that collides with a built-in role. Granted tools are a ceiling. */
export function validateSubagentTypeDefinition(input: unknown, grantedTools: readonly string[]): SubagentTypeDefinition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_ARGUMENT', 'Subagent type definition is invalid');
  const raw = input as Record<string, unknown>;
  const allowedKeys = ['name', 'description', 'instructions', 'allowedTools', 'baseRole', 'model', 'maxSteps', 'deadlineMs', 'enabled'];
  if (Object.keys(raw).some(key => !allowedKeys.includes(key))) fail('INVALID_ARGUMENT', 'Subagent type definition has unknown fields');
  const name = text(raw.name, 'name', 32);
  if (!NAME.test(name) || BUILTIN_SUBAGENT_ROLES.includes(name as SubtaskRole)) {
    fail('INVALID_ARGUMENT', 'Custom subagent type name collides with a built-in role or is invalid');
  }
  const description = text(raw.description, 'description', 200);
  const instructions = text(raw.instructions, 'instructions', 4000);
  if (!Array.isArray(raw.allowedTools) || raw.allowedTools.length > 32
    || new Set(raw.allowedTools).size !== raw.allowedTools.length) {
    fail('INVALID_ARGUMENT', 'allowedTools must be a unique list');
  }
  const granted = new Set(grantedTools);
  const allowedTools = raw.allowedTools.map(tool => {
    if (typeof tool !== 'string' || !TOOL_NAME.test(tool)) fail('INVALID_ARGUMENT', 'allowedTools contains an invalid tool name');
    if (!granted.has(tool)) fail('SCOPE_DENIED', `Tool ${tool} is not in the tools the user already granted`);
    return tool;
  });
  if (typeof raw.baseRole !== 'string' || !BUILTIN_SUBAGENT_ROLES.includes(raw.baseRole as SubtaskRole)) {
    fail('INVALID_ARGUMENT', 'baseRole must be one of the five built-in roles');
  }
  let model: string | undefined;
  if (raw.model !== undefined) {
    model = text(raw.model, 'model', 120);
  }
  let maxSteps: number | undefined;
  if (raw.maxSteps !== undefined) {
    if (!Number.isInteger(raw.maxSteps) || (raw.maxSteps as number) < 1 || (raw.maxSteps as number) > SUBAGENT_TYPE_MAX_STEPS) {
      fail('INVALID_ARGUMENT', `maxSteps must be an integer from 1 to ${SUBAGENT_TYPE_MAX_STEPS}`);
    }
    maxSteps = raw.maxSteps as number;
  }
  let deadlineMs: number | undefined;
  if (raw.deadlineMs !== undefined) {
    if (!Number.isInteger(raw.deadlineMs) || (raw.deadlineMs as number) < 1000 || (raw.deadlineMs as number) > SUBAGENT_TYPE_MAX_DEADLINE_MS) {
      fail('INVALID_ARGUMENT', 'deadlineMs exceeds the existing deadline cap');
    }
    deadlineMs = raw.deadlineMs as number;
  }
  if (typeof raw.enabled !== 'boolean') fail('INVALID_ARGUMENT', 'enabled must be boolean');
  return {name, description, instructions, allowedTools, baseRole: raw.baseRole as SubtaskRole, enabled: raw.enabled,
    ...(model === undefined ? {} : {model}), ...(maxSteps === undefined ? {} : {maxSteps}),
    ...(deadlineMs === undefined ? {} : {deadlineMs})};
}

function sameDefinition(left: SubagentTypeDefinition, right: SubagentTypeDefinition): boolean {
  return subagentTypeDigest(left) === subagentTypeDigest(right);
}

/** Text the user must approve. Confirmation rejects a summary that does not match the stored proposal. */
export function subagentTypeChangeSummary(proposal: SubagentTypeProposal): string {
  if (proposal.kind === 'delete') return `删除自定义子智能体类型 ${proposal.name}（当前 version ${proposal.baseVersion}）`;
  const definition = proposal.definition;
  if (!definition) fail('INVALID_ARGUMENT', 'Subagent type proposal is incomplete');
  const tools = definition.allowedTools.length ? definition.allowedTools.join(', ') : '无';
  return `${proposal.kind} 自定义子智能体类型 ${definition.name}（基于 version ${proposal.baseVersion ?? 0}）：${definition.description}。基础角色 ${definition.baseRole}。允许工具 ${tools}。启用 ${definition.enabled}。步骤上限 ${definition.maxSteps ?? '沿用现有预算'}。`;
}

export function parseSubagentTypeConfig(text: string): unknown[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { fail('INVALID_ARGUMENT', 'Subagent type config is not JSON'); }
  const types = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as {types?: unknown}).types)
    ? (parsed as {types: unknown[]}).types : undefined;
  if (!types || !types.length || types.length > 32) fail('INVALID_ARGUMENT', 'Subagent type config needs a types array');
  return types;
}

export function createSubagentTypeRegistry(runtime: TaskRuntime, options: {now?: () => Date; idFactory?: () => string} = {}): SubagentTypeRegistry {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => randomUUID());
  const task = () => {
    const existing = runtime.findTaskByIdempotencyKey(REGISTRY_KEY);
    if (existing) return existing;
    return runtime.submitTask({conversationId: REGISTRY_CONVERSATION, goal: REGISTRY_GOAL, idempotencyKey: REGISTRY_KEY});
  };
  const defKey = (name: string) => `subagent-type-def:${name}`;
  const seqKey = (name: string) => `subagent-type-seq:${name}`;
  const proposalKey = (id: string) => `subagent-type-proposal:${id}`;
  const readStored = (name: string): SubagentTypeRecord | undefined => {
    const value = runtime.loadCheckpoint(task().taskId, defKey(name)) as SubagentTypeRecord | undefined;
    return value && value.name === name ? structuredClone(value) : undefined;
  };
  const readRecord = (name: string): SubagentTypeRecord | undefined => {
    const value = readStored(name);
    return value && value.deleted !== true && value.definition ? value : undefined;
  };
  const readProposal = (id: string): SubagentTypeProposal | undefined => {
    const value = runtime.loadCheckpoint(task().taskId, proposalKey(id)) as SubagentTypeProposal | undefined;
    return value && value.proposalId === id ? structuredClone(value) : undefined;
  };
  const nextVersion = (name: string): number => {
    const current = runtime.loadCheckpoint(task().taskId, seqKey(name));
    const version = typeof current === 'number' && Number.isInteger(current) && current >= 0 ? current + 1 : 1;
    runtime.saveCheckpoint(task().taskId, seqKey(name), version);
    return version;
  };
  const storeProposal = (proposal: SubagentTypeProposal): SubagentTypeProposal => {
    runtime.saveCheckpoint(task().taskId, proposalKey(proposal.proposalId), proposal);
    return structuredClone(proposal);
  };
  return {
    list() {
      const owner = task();
      return runtime.listCheckpointKeys(owner.taskId)
        .filter(key => key.startsWith('subagent-type-def:'))
        .map(key => runtime.loadCheckpoint(owner.taskId, key) as SubagentTypeRecord)
        .filter(record => record && record.deleted !== true && record.definition && typeof record.name === 'string')
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(record => structuredClone(record));
    },
    get: readRecord,
    propose(input, grantedTools) {
      const kind = input.kind;
      if (!['create', 'update', 'enable', 'disable', 'delete'].includes(kind)) fail('INVALID_ARGUMENT', 'Unknown subagent type change');
      const requestedName = typeof input.name === 'string' ? input.name : undefined;
      if (kind === 'create') {
        const definition = validateSubagentTypeDefinition(input.definition, grantedTools);
        if (readRecord(definition.name)) fail('REVISION_CONFLICT', 'Subagent type already exists');
        return storeProposal({proposalId: idFactory(), kind, name: definition.name, digest: subagentTypeDigest(definition),
          definition, createdAt: now().toISOString()});
      }
      const name = requestedName ?? (input.definition && typeof input.definition === 'object'
        ? (input.definition as {name?: string}).name : undefined);
      if (typeof name !== 'string' || !name) fail('INVALID_ARGUMENT', 'Subagent type name is required');
      const current = readRecord(name);
      if (!current) fail('NOT_FOUND', 'Subagent type does not exist');
      if (kind === 'delete') {
        return storeProposal({proposalId: idFactory(), kind, name, digest: `delete:${current.version}`,
          baseVersion: current.version, createdAt: now().toISOString()});
      }
      const source = kind === 'update' ? input.definition : {...current.definition, enabled: kind === 'enable'};
      const definition = kind === 'disable'
        ? {...current.definition, enabled: false}
        : validateSubagentTypeDefinition(source, grantedTools);
      if (definition.name !== name) fail('INVALID_ARGUMENT', 'Subagent type cannot be renamed');
      if (kind !== 'update' && !sameDefinition({...current.definition, enabled: definition.enabled}, definition)) {
        fail('INVALID_ARGUMENT', 'Enable or disable cannot change other fields');
      }
      if (sameDefinition(current.definition, definition)) fail('INVALID_ARGUMENT', 'Subagent type definition is unchanged');
      return storeProposal({proposalId: idFactory(), kind, name, digest: subagentTypeDigest(definition),
        baseVersion: current.version, definition, createdAt: now().toISOString()});
    },
    confirm(proposalId, digest, grantedTools) {
      const proposal = readProposal(proposalId);
      if (!proposal || proposal.digest !== digest) fail('REVISION_CONFLICT', 'Subagent type confirmation does not match the pending proposal');
      const current = readRecord(proposal.name);
      if (proposal.kind === 'create') {
        if (current) fail('REVISION_CONFLICT', 'Subagent type was created by another confirmation');
        const definition = validateSubagentTypeDefinition(proposal.definition, grantedTools);
        if (subagentTypeDigest(definition) !== digest) fail('REVISION_CONFLICT', 'Confirmed definition changed');
        const version = nextVersion(definition.name);
        const record: SubagentTypeRecord = {name: definition.name, version, digest, definition, updatedAt: now().toISOString()};
        runtime.saveCheckpoint(task().taskId, defKey(definition.name), record);
        return structuredClone(record);
      }
      if (!current || current.version !== proposal.baseVersion) {
        fail('REVISION_CONFLICT', 'Subagent type changed; confirm the new version');
      }
      if (proposal.kind === 'delete') {
        const version = nextVersion(proposal.name);
        runtime.saveCheckpoint(task().taskId, defKey(proposal.name), {name: proposal.name, version,
          digest: proposal.digest, deleted: true, updatedAt: now().toISOString(),
          definition: current.definition});
        return {deleted: true, name: proposal.name, version};
      }
      const definition = validateSubagentTypeDefinition(proposal.definition, grantedTools);
      if (subagentTypeDigest(definition) !== digest) fail('REVISION_CONFLICT', 'Confirmed definition changed');
      const version = nextVersion(definition.name);
      const record: SubagentTypeRecord = {name: definition.name, version, digest, definition, updatedAt: now().toISOString()};
      runtime.saveCheckpoint(task().taskId, defKey(definition.name), record);
      return structuredClone(record);
    },
    proposeConfig(text, grantedTools) {
      const proposals: SubagentTypeProposal[] = [];
      for (const raw of parseSubagentTypeConfig(text)) {
        const definition = validateSubagentTypeDefinition(raw, grantedTools);
        const current = readRecord(definition.name);
        if (current && sameDefinition(current.definition, definition)) continue;
        proposals.push(this.propose({kind: current ? 'update' : 'create', definition}, grantedTools));
      }
      return proposals;
    },
  };
}
