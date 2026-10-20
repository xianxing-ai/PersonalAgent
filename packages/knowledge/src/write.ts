import {createHash} from 'node:crypto';
import {closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync,
  renameSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {isAbsolute, join, relative, sep} from 'node:path';
import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext, ToolDescriptor, ToolHost} from '@personal-agent/contracts';
import {createWorkspaceReadTool, createWorkspacePatchPreviewTool, createWorkspacePatchApplyTool,
  reconcileWorkspacePatchApply} from '@personal-agent/coding-tools';
import type {WorkspaceReadResult, WorkspacePatchPreviewResult} from '@personal-agent/coding-tools';
import {openReadOnlyVault} from './filesystem.js';
import {finalizeControlledVaultWrite} from './write-finalize.js';
import type {KnowledgeWriteFinalizationAcceptance, KnowledgeWriteFinalizationResult} from './write-finalize.js';
export type {KnowledgeWriteFinalizationAcceptance, KnowledgeWriteFinalizationResult} from './write-finalize.js';

export const KNOWLEDGE_WRITE_TOOL_NAME = 'knowledge.apply_note_patch';
export const KNOWLEDGE_WRITE_TOOL_VERSION = '1.0.0';
// All scopes are declared to Policy. The adapter never manufactures workspace authorization.
export const KNOWLEDGE_WRITE_SCOPES = ['knowledge:read', 'knowledge:write',
  'workspace:read', 'workspace:write', 'workspace:apply'] as const;
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
function inputDigest(input: unknown): string {
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
  };
  return hash(canonical(input));
}
const sha = {type: 'string', pattern: '^[a-f0-9]{64}$'};
const text = {type: 'string', minLength: 1, maxLength: 128};
export const knowledgeWriteInputSchema: ToolDescriptor['inputSchema'] = {
  type: 'object', additionalProperties: false,
  required: ['sourceId', 'configRevision', 'path', 'expectedSha256', 'edits'],
  properties: {
    sourceId: text, configRevision: {type: 'integer', minimum: 1},
    path: {type: 'string', minLength: 1, maxLength: 1024}, expectedSha256: sha,
    edits: {type: 'array', minItems: 1, maxItems: 16, items: {
      type: 'object', additionalProperties: false, required: ['oldText', 'newText'],
      properties: {oldText: {type: 'string', minLength: 1, maxLength: 16384},
        newText: {type: 'string', maxLength: 16384}}
    }}
  }
};
export interface KnowledgeNotePatch {
  sourceId: string; configRevision: number; path: string; expectedSha256: string;
  edits: {oldText: string; newText: string}[];
}
export interface KnowledgeWriteReceipt {
  sourceId: string; configRevision: number; path: string; beforeSha256: string;
  afterSha256: string; operationId: string; backupId: string;
  state: 'verified' | 'conflict'; changed: boolean;
}
interface PendingWrite {
  version: 1; taskId: string; runId: string; argumentsDigest: string;
  sourceId: string; configRevision: number; path: string;
  beforeSha256: string; afterSha256: string; operationId: string; backupId: string;
  receipt?: KnowledgeWriteReceipt;
}
/** A separate host-only write port. It is not a replacement for KnowledgePort.search. */
export interface KnowledgeWritePort {
  apply(input: KnowledgeNotePatch, context: ToolContext): Promise<KnowledgeWriteReceipt>;
  /** Read back an interrupted attempt. Never starts a helper, retries, or restores a backup. */
  reconcile(input: {taskId: string; runId: string; argumentsDigest: string},
    context: Pick<ToolContext, 'signal' | 'deadline'>): Promise<{
      state: 'in_progress' | 'applied' | 'not_applied' | 'unknown';
      operationId: string; backupId: string; lockRetained: boolean; currentSha256?: string;
    }>;
  /** Trusted Runtime accepts the ORIGINAL known execution/evidence, then clears only matching metadata locks. */
  finalize(accepted: KnowledgeWriteFinalizationAcceptance,
    context: Pick<ToolContext, 'signal' | 'deadline'>): Promise<KnowledgeWriteFinalizationResult>;
}

function deny(code: 'SCOPE_DENIED' | 'REVISION_CONFLICT' | 'RESULT_UNKNOWN' | 'INVALID_ARGUMENT'): never {
  throw new ProtocolError(code, 'Knowledge write ' + code.toLowerCase());
}
function active(context: Pick<ToolContext, 'signal' | 'deadline'>): void {
  if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Knowledge write cancelled');
  if (!Number.isFinite(Date.parse(context.deadline)) || Date.parse(context.deadline) <= Date.now()) {
    throw new ProtocolError('TIMEOUT', 'Knowledge write deadline expired');
  }
}
function notePath(value: string): string {
  if (typeof value !== 'string' || !/\.md$/i.test(value) || value.includes('\\')
    || value.includes(':') || value.includes('\0') || isAbsolute(value)
    || value.split('/').some(part => !part || part.startsWith('.') || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) deny('INVALID_ARGUMENT');
  return value;
}
function metadata(content: string): string {
  // Exact frontmatter preservation, including BOM and line endings.
  if (!/^(?:\uFEFF)?---\r?\n/.test(content)) return '';
  const bodyOffset = content.indexOf('\n') + 1;
  const match = /^(?:---|\.\.\.)(?:\r?\n|$)/m.exec(content.slice(bodyOffset));
  if (!match) deny('INVALID_ARGUMENT');
  return content.slice(0, bodyOffset + match.index + match[0].length);
}
function links(content: string): string[] {
  // Conservative tokenizer: preserve every bracket span, including shortcut references and code spans.
  // Balanced/escaped destinations are consumed fully; malformed spans refuse the patch rather than guess.
  const protectedSpans: string[] = [];
  function closing(start: number, left: string, right: string): number {
    let depth = 0, quote = '', angled = false;
    for (let i = start; i < content.length; i++) {
      const character = content[i]!;
      if (character === '\\') {i++; continue;}
      if (left === '(') {
        if (quote) {if (character === quote) quote = ''; continue;}
        if (angled) {if (character === '>') angled = false; continue;}
        if ((character === '"' || character === "'") && /\s/.test(content[i - 1] ?? '')) {quote = character; continue;}
        if (character === '<') {angled = true; continue;}
      }
      if (character === left) depth++;
      else if (character === right && --depth === 0) return i;
    }
    deny('SCOPE_DENIED');
  }
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\\') {i++; continue;}
    if (content[i] !== '[') continue;
    const start = content[i - 1] === '!' ? i - 1 : i;
    let end = closing(i, '[', ']');
    if (content[end + 1] === '(') end = closing(end + 1, '(', ')');
    else if (content[end + 1] === '[') end = closing(end + 1, '[', ']');
    else if (content[end + 1] === ':') {
      const newline = content.indexOf('\n', end + 1);
      end = newline < 0 ? content.length - 1 : newline - 1;
    }
    protectedSpans.push(content.slice(start, end + 1)); i = end;
  }
  protectedSpans.push(...[...content.matchAll(/<https?:\/\/[^>\r\n]+>|(?:^|\s)\^[A-Za-z0-9-]+(?=\s|$)/gm)].map(item => item[0]));
  return protectedSpans;
}
function protect(before: string, after: string): void {
  if (metadata(before) !== metadata(after)) deny('SCOPE_DENIED');
  const remaining = links(after);
  for (const link of links(before)) {
    const index = remaining.indexOf(link);
    if (index < 0) deny('SCOPE_DENIED');
    remaining.splice(index, 1);
  }
}
function durable(file: string, value: string | Uint8Array, exclusive = true): void {
  const fd = openSync(file, exclusive ? 'wx' : 'w', 0o600);
  try {writeFileSync(fd, value); fsyncSync(fd);}
  finally {closeSync(fd);}
}

/** Windows locked write with durable recovery. Recovery root must have a host-verified private ACL. */
export function openControlledVaultWriter(options: {
  rootPath: string; recoveryRootPath: string; powerShellPath: string; processIdentityHelperPath?: string;
  sourceId: string; configRevision: number; allowedNotePaths: readonly string[];
  /** Trusted host binding, permission and ACL check, rechecked before dispatch and readback. */
  bindingCurrent: () => boolean;
}): KnowledgeWritePort {
  if (!options.sourceId || !Number.isSafeInteger(options.configRevision) || options.configRevision < 1
    || !Array.isArray(options.allowedNotePaths) || !options.allowedNotePaths.length
    || options.allowedNotePaths.length > 32) deny('INVALID_ARGUMENT');
  for (const directory of [options.rootPath, options.recoveryRootPath]) {
    if (!isAbsolute(directory) || lstatSync(directory).isSymbolicLink()
      || !statSync(directory).isDirectory()) deny('SCOPE_DENIED');
  }
  const root = realpathSync.native(options.rootPath);
  const recovery = realpathSync.native(options.recoveryRootPath);
  const relation = relative(root, recovery), inverse = relative(recovery, root);
  const inside = (part: string): boolean => part === '' || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
  if (inside(relation) || inside(inverse)) deny('SCOPE_DENIED');
  const allowed = new Set(options.allowedNotePaths.map(notePath));
  const reader = createWorkspaceReadTool({rootPath: root, maxReadBytes: 512 * 1024});
  const preview = createWorkspacePatchPreviewTool({rootPath: root, maxReadBytes: 512 * 1024,
    maxPreviewBytes: 512 * 1024});
  const apply = createWorkspacePatchApplyTool({rootPath: root, maxReadBytes: 512 * 1024,
    maxPreviewBytes: 512 * 1024, recoveryRootPath: recovery, powerShellPath: options.powerShellPath,
    ...(options.processIdentityHelperPath === undefined ? {} : {processIdentityHelperPath: options.processIdentityHelperPath})});
  const assertBinding = (): void => {if (!options.bindingCurrent()) deny('SCOPE_DENIED');};
  const receiptFile = (id: string): string => join(recovery, id + '.knowledge-operation.json');
  const pathLock = (path: string): string => join(recovery, hash(root + '\n' + path) + '.knowledge-pending');
  const save = (record: PendingWrite): void => {
    const file = receiptFile(record.operationId), tmp = file + '.tmp';
    durable(tmp, JSON.stringify(record)); renameSync(tmp, file);
  };
  return {
    finalize: (accepted, context) => finalizeControlledVaultWrite({rootPath: root, recoveryRootPath: recovery,
      powerShellPath: options.powerShellPath, allowedNotePaths: allowed, bindingCurrent: options.bindingCurrent,
      digest: inputDigest, hash}, accepted, context),
    async apply(input, context) {
      validateToolValue(knowledgeWriteInputSchema, input); active(context); assertBinding();
      if (KNOWLEDGE_WRITE_SCOPES.some(scope => !context.scopes.includes(scope))) deny('SCOPE_DENIED');
      if (input.sourceId !== options.sourceId || input.configRevision !== options.configRevision) deny('REVISION_CONFLICT');
      if (!allowed.has(notePath(input.path))) deny('SCOPE_DENIED');
      if (!context.taskId || !context.runId || !/^[a-f0-9]{64}$/.test(context.argumentsDigest ?? '')) deny('INVALID_ARGUMENT');
      if (context.argumentsDigest !== inputDigest(input)) deny('SCOPE_DENIED');
      const operationId = hash(context.taskId + '\n' + context.runId);
      const file = receiptFile(operationId);
      if (existsSync(file)) {
        const prior = JSON.parse(readFileSync(file, 'utf8')) as PendingWrite;
        if (prior.argumentsDigest !== context.argumentsDigest || prior.sourceId !== input.sourceId
          || prior.configRevision !== input.configRevision || prior.path !== input.path) deny('RESULT_UNKNOWN');
        // Runtime replays confirmed results. This port never repeats a prior write, even after restart.
        deny('RESULT_UNKNOWN');
      }
      if (existsSync(pathLock(input.path))) deny('RESULT_UNKNOWN');
      const patch = {path: input.path, expectedSha256: input.expectedSha256, edits: input.edits};
      const before = await reader.execute({path: input.path}, context) as WorkspaceReadResult;
      if (hash(Buffer.from(before.content, 'utf8')) !== input.expectedSha256) deny('REVISION_CONFLICT');
      const candidate = await preview.execute(patch, context) as WorkspacePatchPreviewResult;
      protect(before.content, candidate.previewText); active(context); assertBinding();
      const backupId = operationId + '.knowledge-backup';
      const record: PendingWrite = {version: 1, taskId: context.taskId, runId: context.runId,
        argumentsDigest: context.argumentsDigest!, sourceId: options.sourceId, configRevision: options.configRevision,
        path: input.path, beforeSha256: input.expectedSha256, afterSha256: candidate.afterSha256, operationId, backupId};
      // Durable note-level lock survives both helper failure and app restart. It is not cleared on unknown.
      try {durable(pathLock(input.path), operationId);} catch {deny('RESULT_UNKNOWN');}
      try {
        durable(join(recovery, backupId), Buffer.from(before.content, 'utf8'));
        if (hash(readFileSync(join(recovery, backupId))) !== input.expectedSha256) deny('RESULT_UNKNOWN');
        durable(file, JSON.stringify(record));
      } catch {deny('RESULT_UNKNOWN');}
      active(context); assertBinding();
      try {
        await apply.execute(patch, context);
        active(context); assertBinding();
        const readback = await reader.execute({path: input.path}, context) as WorkspaceReadResult;
        active(context); assertBinding();
        if (hash(Buffer.from(readback.content, 'utf8')) !== candidate.afterSha256) deny('RESULT_UNKNOWN');
        const receipt: KnowledgeWriteReceipt = {sourceId: options.sourceId, configRevision: options.configRevision,
          path: input.path, beforeSha256: input.expectedSha256, afterSha256: candidate.afterSha256,
          operationId, backupId, state: 'verified', changed: candidate.changed};
        record.receipt = receipt; save(record); unlinkSync(pathLock(input.path));
        return receipt;
      } catch (error) {
        if (error instanceof ProtocolError && error.code === 'REVISION_CONFLICT') {
          const receipt: KnowledgeWriteReceipt = {sourceId: options.sourceId, configRevision: options.configRevision,
            path: input.path, beforeSha256: input.expectedSha256, afterSha256: candidate.afterSha256,
            operationId, backupId, state: 'conflict', changed: false};
          record.receipt = receipt; save(record); unlinkSync(pathLock(input.path)); return receipt;
        }
        deny('RESULT_UNKNOWN');
      }
    },
    async reconcile(input, context) {
      active(context); assertBinding();
      const operationId = hash(input.taskId + '\n' + input.runId);
      const record = JSON.parse(readFileSync(receiptFile(operationId), 'utf8')) as PendingWrite;
      if (record.taskId !== input.taskId || record.runId !== input.runId
        || record.argumentsDigest !== input.argumentsDigest
        || !allowed.has(notePath(record.path))) deny('SCOPE_DENIED');
      const helper = await reconcileWorkspacePatchApply({rootPath: root, recoveryRootPath: recovery,
        relativePath: record.path,
        ...(options.processIdentityHelperPath === undefined ? {} : {processIdentityHelperPath: options.processIdentityHelperPath}),
        expectedRunId: input.runId, expectedArgumentsDigest: input.argumentsDigest,
        expectedBeforeSha256: record.beforeSha256, retainMarker: true});
      active(context); assertBinding();
      if (helper.state === 'in_progress') return {state: 'in_progress', operationId, backupId: record.backupId, lockRetained: true};
      // Host-authorized read-only port, not an invented ToolContext or a write authorization.
      const readback = await openReadOnlyVault({vaultId: options.sourceId, rootPath: root});
      const result = await readback.readNote({path: record.path, ...context});
      active(context); assertBinding();
      // Every shared readback retains its marker. The shared default clear also removes unknown markers,
      // so this read-only bridge must never call it to release an interrupted helper automatically.
      const finalHelper = await reconcileWorkspacePatchApply({rootPath: root, recoveryRootPath: recovery,
        relativePath: record.path,
        ...(options.processIdentityHelperPath === undefined ? {} : {processIdentityHelperPath: options.processIdentityHelperPath}),
        expectedRunId: input.runId, expectedArgumentsDigest: input.argumentsDigest,
        expectedBeforeSha256: record.beforeSha256, retainMarker: true});
      active(context); assertBinding();
      if (finalHelper.state === 'in_progress') return {state: 'in_progress', operationId, backupId: record.backupId, lockRetained: true};
      const currentSha256 = finalHelper.state === 'reconciled' ? finalHelper.currentSha256
        : (await readback.readNote({path: record.path, ...context})).revision;
      active(context); assertBinding();
      const unchanged = result.revision === currentSha256
        && (helper.state !== 'reconciled' || helper.currentSha256 === currentSha256);
      const state = unchanged && currentSha256 === record.afterSha256 ? 'applied'
        : unchanged && currentSha256 === record.beforeSha256 ? 'not_applied' : 'unknown';
      // Unknown or a still-present shared marker remains locked for trusted Runtime finalization.
      const lockRetained = state === 'unknown' || finalHelper.state !== 'clear';
      if (!lockRetained) {
        if (existsSync(pathLock(record.path)) && readFileSync(pathLock(record.path), 'utf8') === operationId) {
          unlinkSync(pathLock(record.path));
        }
      }
      return {state, operationId, backupId: record.backupId, currentSha256, lockRetained};
    }
  };
}

export function createKnowledgeWriteTool(port: KnowledgeWritePort): RegisteredTool {
  return {descriptor: {
    name: KNOWLEDGE_WRITE_TOOL_NAME, version: KNOWLEDGE_WRITE_TOOL_VERSION,
    inputSchema: knowledgeWriteInputSchema,
    outputSchema: {type: 'object', additionalProperties: false,
      required: ['sourceId', 'configRevision', 'path', 'beforeSha256', 'afterSha256', 'operationId', 'backupId', 'state', 'changed'],
      properties: {sourceId: text, configRevision: {type: 'integer', minimum: 1}, path: {type: 'string'},
        beforeSha256: sha, afterSha256: sha, operationId: sha, backupId: {type: 'string'},
        state: {type: 'string', enum: ['verified', 'conflict']}, changed: {type: 'boolean'}}},
    sideEffect: 'local_write', requiredScopes: [...KNOWLEDGE_WRITE_SCOPES],
    idempotencySupport: false, recoverySupport: false, requiresPresence: false
  }, execute: (input, context) => port.apply(input as KnowledgeNotePatch, context)};
}
export function registerKnowledgeWriter(host: ToolHost, port: KnowledgeWritePort): () => void {
  return host.register(createKnowledgeWriteTool(port));
}
