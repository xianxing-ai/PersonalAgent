import {createHash} from 'node:crypto';
export {createIsolatedCodingRepairHost,createIsolatedCodingRepairTools} from './isolated-repair.js';
export type {IsolatedCodingRepairHost,IsolatedCodingRepairHostOptions} from './isolated-repair.js';
export {captureCodingRepairSnapshot,affectedCodingRepairPackages,codingRepairVerificationState,codingRepairPackageGraphDigest} from './repair-verification.js';
export type {CapturedCodingRepairSnapshot} from './repair-verification.js';
import { constants as fsConstants, realpathSync, statSync } from 'node:fs';
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { MAX_FRAME_BYTES, ProtocolError, validateToolValue } from '@personal-agent/contracts';
import type { RegisteredTool, ToolContext, ToolDescriptor, ToolHost } from '@personal-agent/contracts';
import {
  createWorkspacePatchPreviewToolFromReader,
  MAX_WORKSPACE_PATCH_PREVIEW_BYTES,
} from './patch-preview.js';
import {createWorkspacePatchStageToolFromReader} from './patch-stage.js';
import {createWorkspacePatchApplyToolFromPreview} from './patch-apply.js';
import type {WorkspacePatchApplyHostOptions} from './patch-apply.js';
export {
  reconcileWorkspacePatchApply,
} from './patch-reconcile.js';
export type {
  WorkspacePatchProcessIdentity,
  WorkspacePatchProcessState,
  WorkspacePatchReconcileOptions,
  WorkspacePatchReconciliationResult,
} from './patch-reconcile.js';
export {
  WORKSPACE_PATCH_APPLY_SCOPE,
  WORKSPACE_PATCH_APPLY_TOOL_NAME,
  WORKSPACE_PATCH_APPLY_TOOL_VERSION,
} from './patch-apply.js';
export type {WorkspacePatchApplyHostOptions, WorkspacePatchApplyResult} from './patch-apply.js';
export {
  createWorkspaceCommandTool,
  registerWorkspaceCommand,
  WORKSPACE_COMMAND_SCOPE,
  WORKSPACE_COMMAND_TOOL_NAME,
  WORKSPACE_COMMAND_TOOL_VERSION,
} from './command.js';
export type {WorkspaceCommandOptions, WorkspaceCommandRecipe, WorkspaceCommandResult} from './command.js';
export {
  MAX_SERIALIZED_WORKSPACE_PATCH_INPUT_BYTES,
  MAX_WORKSPACE_PATCH_EDITS,
  MAX_WORKSPACE_PATCH_PREVIEW_BYTES,
  WORKSPACE_PATCH_PREVIEW_TOOL_NAME,
  WORKSPACE_PATCH_PREVIEW_TOOL_VERSION,
} from './patch-preview.js';
export type {WorkspacePatchPreviewEdit, WorkspacePatchPreviewResult} from './patch-preview.js';
export {locateTestFailures} from './test-locate/locate.js';
export type {TestFailure, TestFailureFrame, TestFailureReport, TestLocateOptions} from './test-locate/locate.js';
export {
  WORKSPACE_PATCH_STAGE_SCOPE,
  WORKSPACE_PATCH_STAGE_TOOL_NAME,
  WORKSPACE_PATCH_STAGE_TOOL_VERSION,
} from './patch-stage.js';
export type {WorkspacePatchStageResult} from './patch-stage.js';

export const WORKSPACE_READ_TOOL_NAME = 'workspace.read_text';
export const WORKSPACE_READ_TOOL_VERSION = '1.0.0';
export const WORKSPACE_READ_SCOPE = 'workspace:read';
export const DEFAULT_MAX_READ_BYTES = 256 * 1024;
export const WORKSPACE_READ_WIRE_WRAPPER_BUDGET_BYTES = 64 * 1024;
export const MAX_SERIALIZED_WORKSPACE_TOOL_RESULT_BYTES = MAX_FRAME_BYTES - WORKSPACE_READ_WIRE_WRAPPER_BUDGET_BYTES;
export const MAX_SERIALIZED_WORKSPACE_READ_RESULT_BYTES = MAX_SERIALIZED_WORKSPACE_TOOL_RESULT_BYTES;
export const WORKSPACE_LIST_TOOL_NAME = 'workspace.list_entries';
export const WORKSPACE_LIST_TOOL_VERSION = '1.0.0';
export const WORKSPACE_LIST_SCOPE = 'workspace:list';
export const DEFAULT_WORKSPACE_LIST_LIMIT = 100;
export const MAX_WORKSPACE_LIST_LIMIT = 1000;

const MAX_SCHEMA_BYTES = 1024 * 1024;
const DEFAULT_READ_CHUNK_BYTES = 64 * 1024;
const MAX_RELATIVE_PATH_LENGTH = 1024;

const blockedDirectoryNames = new Set([
  '.aws',
  '.azure',
  '.codex',
  '.direnv',
  '.docker',
  '.git',
  '.gnupg',
  '.kube',
  '.ssh',
]);

const blockedFileNames = new Set([
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.envrc',
  'application-default-credentials.json',
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'secrets',
  'secrets.json',
  'service-account.json',
]);

const blockedPrivateKeyExtensions = new Set([
  '.jks',
  '.key',
  '.keystore',
  '.p12',
  '.pem',
  '.pfx',
  '.ppk',
]);

const privateKeyMarker = /-----BEGIN (?:DSA |EC |ENCRYPTED |OPENSSH |PGP |RSA )?PRIVATE KEY(?: BLOCK)?-----/u;
const disallowedTextControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const windowsReservedName = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;

export interface WorkspaceReadOptions {
  /** Trusted host-provided workspace root. It is canonicalized before registration. */
  rootPath: string;
  /** Hard ceiling for both the accepted file size and returned UTF-8 bytes. */
  maxReadBytes?: number;
  /** Trusted clock injection for deterministic deadline tests. */
  now?: () => number;
  /** Trusted I/O tuning. Production callers normally keep the default. */
  readChunkBytes?: number;
}

interface WorkspaceReadInput {
  path: string;
  maxBytes?: number;
}

export interface WorkspaceReadResult {
  path: string;
  encoding: 'utf-8';
  byteLength: number;
  content: string;
  /** SHA-256 of the same raw file bytes; optional for historical 1.0.0 receipts. */
  sha256?: string;
}

export interface WorkspaceListOptions {
  /** Trusted host-provided workspace root. It is canonicalized before registration. */
  rootPath: string;
  /** Hard ceiling for a request's returned entry count. */
  maxEntries?: number;
  /** Trusted clock injection for deterministic deadline tests. */
  now?: () => number;
}

interface WorkspaceListInput {
  path: string;
  limit?: number;
}

export interface WorkspaceListEntry {
  name: string;
  kind: 'file' | 'directory';
}

export interface WorkspaceListResult {
  path: string;
  entries: WorkspaceListEntry[];
  truncated: boolean;
}

export interface WorkspacePatchPreviewOptions extends WorkspaceReadOptions {
  /** Maximum UTF-8 bytes in each intermediate and returned preview candidate. */
  maxPreviewBytes?: number;
}

const utf8Encoder = new TextEncoder();

const inputSchema = (maxReadBytes: number): ToolDescriptor['inputSchema'] => ({
  type: 'object',
  description: 'Read one complete UTF-8 text file beneath the trusted host-bound workspace root. The result is local tool output and is not permission to send file content to AgentArts, logs, or another destination.',
  required: ['path'],
  additionalProperties: false,
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_RELATIVE_PATH_LENGTH,
      description: 'Canonical relative workspace path. Absolute, parent, device, UNC, ADS, symlink/junction escape, and sensitive paths are rejected.',
    },
    maxBytes: {
      type: 'integer',
      minimum: 1,
      maximum: maxReadBytes,
      description: 'Optional stricter whole-file byte ceiling. Files larger than this value are rejected rather than truncated.',
    },
  },
});

const outputSchema = (maxReadBytes: number): ToolDescriptor['outputSchema'] => ({
  type: 'object',
  required: ['path', 'encoding', 'byteLength', 'content'],
  additionalProperties: false,
  properties: {
    path: {type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH},
    encoding: {enum: ['utf-8']},
    byteLength: {type: 'integer', minimum: 0, maximum: maxReadBytes},
    content: {type: 'string'},
    sha256: {type: 'string', pattern: '^[a-f0-9]{64}$',
      description: 'SHA-256 of the raw bytes returned by this read. Use as expectedSha256 for a later patch of this path; it does not grant a write.'},
  },
});

const listInputSchema = (maxEntries: number): ToolDescriptor['inputSchema'] => ({
  type: 'object',
  description: "List only the direct, non-sensitive file and directory children beneath a trusted workspace directory. Use '.' for the trusted root.",
  required: ['path'],
  additionalProperties: false,
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_RELATIVE_PATH_LENGTH,
      description: "Canonical relative workspace directory, or '.' for the trusted root. Symlinks and junctions are not traversed.",
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: maxEntries,
      description: 'Maximum returned direct children. Omission uses the smaller of 100 and the host ceiling.',
    },
  },
});

const listOutputSchema = (maxEntries: number): ToolDescriptor['outputSchema'] => ({
  type: 'object',
  required: ['path', 'entries', 'truncated'],
  additionalProperties: false,
  properties: {
    path: {type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH},
    entries: {
      type: 'array',
      maxItems: maxEntries,
      items: {
        type: 'object',
        required: ['name', 'kind'],
        additionalProperties: false,
        properties: {
          name: {type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH},
          kind: {enum: ['file', 'directory']},
        },
      },
    },
    truncated: {type: 'boolean'},
  },
});

function boundedInteger(value: number | undefined, fallback: number, field: string, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new ProtocolError('INVALID_ARGUMENT', `${field} must be an integer from 1 to ${maximum}`);
  }
  return result;
}

function canonicalRoot(rootPath: string): string {
  if (typeof rootPath !== 'string' || !rootPath.trim()) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Workspace rootPath must not be empty');
  }
  try {
    // Match the OS-native canonicalization used by asynchronous realpath on Windows.
    // Mixing the legacy sync resolver with the async resolver can preserve different
    // aliases for the same GitHub Actions temporary directory and falsely deny children.
    const root = realpathSync.native(rootPath);
    if (!statSync(root).isDirectory()) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Workspace rootPath must identify a directory');
    }
    return root;
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError('INVALID_ARGUMENT', 'Workspace rootPath is not an accessible directory');
  }
}

function canonicalRelativePath(value: string): {normalized: string; segments: string[]} {
  if (value.length > MAX_RELATIVE_PATH_LENGTH || value.includes('\0')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Workspace path is invalid');
  }
  if (isAbsolute(value) || win32.isAbsolute(value) || value.startsWith('/') || value.startsWith('\\')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Workspace path must be relative');
  }
  if (value.includes(':')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Drive-qualified and alternate data stream paths are not allowed');
  }

  const segments = value.split(/[\\/]/u);
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Workspace path must use canonical child segments');
  }
  for (const segment of segments) {
    if (/[. ]$/u.test(segment)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Workspace path contains a Windows-ambiguous segment');
    }
    const deviceCandidate = segment.split('.')[0] ?? segment;
    if (windowsReservedName.test(deviceCandidate)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Windows device names are not allowed');
    }
  }
  return {normalized: segments.join('/'), segments};
}

function canonicalRelativeDirectoryPath(value: string): {normalized: string; segments: string[]} {
  if (value === '.') return {normalized: '.', segments: []};
  return canonicalRelativePath(value);
}

function pathIsWithinRoot(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation !== '' && relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

function pathIsAtOrWithinRoot(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

function sameCanonicalPath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US') : left === right;
}

function isSensitivePath(normalizedPath: string): boolean {
  const segments = normalizedPath.toLocaleLowerCase('en-US').split('/');
  if (segments.some(segment => blockedDirectoryNames.has(segment))) return true;
  const fileName = segments.at(-1) ?? '';
  if (blockedFileNames.has(fileName) || /^\.env(?:\..+)?$/u.test(fileName)) return true;
  if (/^(?:credentials|secrets|service-account)(?:\..+)?$/u.test(fileName)) return true;
  const extensionIndex = fileName.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex) : '';
  return blockedPrivateKeyExtensions.has(extension);
}

function checkContext(
  context: ToolContext,
  now: () => number,
  requiredScope = WORKSPACE_READ_SCOPE,
  operationLabel = 'Workspace read',
): void {
  if (!context.scopes.includes(requiredScope)) {
    throw new ProtocolError('SCOPE_DENIED', `Tool requires ${requiredScope}`);
  }
  if (context.signal.aborted) {
    throw new ProtocolError('CANCELLED', `${operationLabel} was cancelled`);
  }
  const deadline = Date.parse(context.deadline);
  if (!Number.isFinite(deadline)) {
    throw new ProtocolError('INVALID_ARGUMENT', `${operationLabel} deadline is invalid`);
  }
  if (deadline <= now()) {
    throw new ProtocolError('TIMEOUT', `${operationLabel} deadline expired`);
  }
}

function mapFileSystemError(error: unknown): never {
  if (error instanceof ProtocolError) throw error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    throw new ProtocolError('NOT_FOUND', 'Workspace file was not found');
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') {
    throw new ProtocolError('SCOPE_DENIED', 'Workspace file is not readable under the configured policy');
  }
  throw new ProtocolError('EXTERNAL_FAILURE', 'Workspace file read failed');
}

function sameFileIdentity(left: Awaited<ReturnType<typeof stat>>, right: Awaited<ReturnType<typeof stat>>): boolean {
  if (left.dev === 0 && left.ino === 0 && right.dev === 0 && right.ino === 0) return true;
  return left.dev === right.dev && left.ino === right.ino;
}

function unchangedFile(left: Awaited<ReturnType<typeof stat>>, right: Awaited<ReturnType<typeof stat>>): boolean {
  return sameFileIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function assertSerializedResultFits(result: unknown, errorMessage: string): void {
  const serializedBytes = utf8Encoder.encode(JSON.stringify(result)).byteLength;
  if (serializedBytes > MAX_SERIALIZED_WORKSPACE_TOOL_RESULT_BYTES) {
    throw new ProtocolError('INVALID_ARGUMENT', errorMessage);
  }
}

function compareEntryNames(left: WorkspaceListEntry, right: WorkspaceListEntry): number {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

function retainSortedEntry(entries: WorkspaceListEntry[], entry: WorkspaceListEntry, limit: number): void {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareEntryNames(entries[middle]!, entry) <= 0) low = middle + 1;
    else high = middle;
  }
  if (low >= limit && entries.length >= limit) return;
  entries.splice(low, 0, entry);
  if (entries.length > limit) entries.pop();
}

export function createWorkspaceReadTool(options: WorkspaceReadOptions): RegisteredTool {
  const root = canonicalRoot(options?.rootPath);
  const maxReadBytes = boundedInteger(options.maxReadBytes, DEFAULT_MAX_READ_BYTES, 'maxReadBytes', MAX_SCHEMA_BYTES);
  const readChunkBytes = boundedInteger(
    options.readChunkBytes,
    Math.min(DEFAULT_READ_CHUNK_BYTES, maxReadBytes),
    'readChunkBytes',
    maxReadBytes,
  );
  const now = options.now ?? Date.now;
  const descriptor: ToolDescriptor = {
    name: WORKSPACE_READ_TOOL_NAME,
    version: WORKSPACE_READ_TOOL_VERSION,
    inputSchema: inputSchema(maxReadBytes),
    outputSchema: outputSchema(maxReadBytes),
    sideEffect: 'read',
    requiredScopes: [WORKSPACE_READ_SCOPE],
    idempotencySupport: true,
    recoverySupport: true,
    requiresPresence: false,
  };

  return {
    descriptor,
    execute: async (input: unknown, context: ToolContext): Promise<WorkspaceReadResult> => {
      validateToolValue(descriptor.inputSchema, input);
      checkContext(context, now);
      const request = input as WorkspaceReadInput;
      const path = canonicalRelativePath(request.path);
      if (isSensitivePath(path.normalized)) {
        throw new ProtocolError('SCOPE_DENIED', 'Workspace path is blocked by the default sensitive-file policy');
      }
      const effectiveMaxBytes = request.maxBytes ?? maxReadBytes;
      const candidate = resolve(root, ...path.segments);
      if (!pathIsWithinRoot(root, candidate)) {
        throw new ProtocolError('SCOPE_DENIED', 'Workspace path escapes the configured root');
      }

      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        checkContext(context, now);
        const resolvedBeforeOpen = await realpath(candidate);
        if (!pathIsWithinRoot(root, resolvedBeforeOpen)) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace symlink or junction escapes the configured root');
        }
        const resolvedPolicyPath = relative(root, resolvedBeforeOpen).split(sep).join('/');
        if (isSensitivePath(resolvedPolicyPath)) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace symlink or junction resolves to a sensitive path');
        }

        const flags = process.platform === 'win32'
          ? fsConstants.O_RDONLY
          : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
        handle = await open(resolvedBeforeOpen, flags);
        const openedStat = await handle.stat();
        if (!openedStat.isFile()) {
          throw new ProtocolError('INVALID_ARGUMENT', 'Workspace path must identify a regular file');
        }
        if (openedStat.size > effectiveMaxBytes) {
          throw new ProtocolError('INVALID_ARGUMENT', `Workspace file exceeds the ${effectiveMaxBytes}-byte read limit`);
        }

        checkContext(context, now);
        const resolvedAfterOpen = await realpath(candidate);
        if (!pathIsWithinRoot(root, resolvedAfterOpen) || !sameCanonicalPath(resolvedBeforeOpen, resolvedAfterOpen)) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace path changed during containment validation');
        }
        const pathStat = await stat(resolvedAfterOpen);
        if (!sameFileIdentity(openedStat, pathStat)) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace path changed during file open');
        }

        const chunks: Buffer[] = [];
        let position = 0;
        while (position < openedStat.size) {
          checkContext(context, now);
          const length = Math.min(readChunkBytes, openedStat.size - position);
          const chunk = Buffer.allocUnsafe(length);
          const {bytesRead} = await handle.read(chunk, 0, length, position);
          checkContext(context, now);
          if (bytesRead === 0) {
            throw new ProtocolError('EXTERNAL_FAILURE', 'Workspace file changed while it was being read');
          }
          chunks.push(bytesRead === length ? chunk : chunk.subarray(0, bytesRead));
          position += bytesRead;
        }

        const completedStat = await handle.stat();
        if (!unchangedFile(openedStat, completedStat)) {
          throw new ProtocolError('EXTERNAL_FAILURE', 'Workspace file changed while it was being read');
        }
        const bytes = Buffer.concat(chunks, position);
        let content: string;
        try {
          // Preserve a UTF-8 BOM so re-encoding for patch preview hashes the
          // exact bytes read, including BOM and the original line endings.
          content = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
        } catch {
          throw new ProtocolError('INVALID_ARGUMENT', 'Workspace file is not valid UTF-8 text');
        }
        if (disallowedTextControls.test(content)) {
          throw new ProtocolError('INVALID_ARGUMENT', 'Workspace file appears to be binary');
        }
        if (privateKeyMarker.test(content)) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace file contains private-key material blocked by policy');
        }
        const result: WorkspaceReadResult = {
          path: path.normalized,
          encoding: 'utf-8',
          byteLength: bytes.byteLength,
          content,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
        assertSerializedResultFits(result, 'Workspace read result exceeds the bounded serialized-output limit');
        checkContext(context, now);
        return result;
      } catch (error) {
        mapFileSystemError(error);
      } finally {
        await handle?.close();
      }
    },
  };
}

export function createWorkspacePatchPreviewTool(options: WorkspacePatchPreviewOptions): RegisteredTool {
  const maxReadBytes = boundedInteger(options.maxReadBytes, DEFAULT_MAX_READ_BYTES, 'maxReadBytes', MAX_SCHEMA_BYTES);
  const maxPreviewBytes = boundedInteger(
    options.maxPreviewBytes,
    maxReadBytes,
    'maxPreviewBytes',
    MAX_WORKSPACE_PATCH_PREVIEW_BYTES,
  );
  const reader = createWorkspaceReadTool({...options, maxReadBytes});
  return createWorkspacePatchPreviewToolFromReader({
    reader,
    requiredScope: WORKSPACE_READ_SCOPE,
    maxReadBytes,
    maxPreviewBytes,
    maxSerializedResultBytes: MAX_SERIALIZED_WORKSPACE_TOOL_RESULT_BYTES,
    now: options.now ?? Date.now,
  });
}

export function createWorkspacePatchStageTool(options: WorkspacePatchPreviewOptions): RegisteredTool {
  const preview = createWorkspacePatchPreviewTool(options);
  const reader = createWorkspaceReadTool(options);
  return createWorkspacePatchStageToolFromReader({
    rootPath: options.rootPath,
    preview,
    reader,
    now: options.now ?? Date.now,
  });
}

export function createWorkspacePatchApplyTool(
  options: WorkspacePatchPreviewOptions & WorkspacePatchApplyHostOptions,
): RegisteredTool {
  const preview = createWorkspacePatchPreviewTool(options);
  return createWorkspacePatchApplyToolFromPreview({
    rootPath: options.rootPath,
    recoveryRootPath: options.recoveryRootPath,
    powerShellPath: options.powerShellPath,
    ...(options.helperScriptPath !== undefined ? {helperScriptPath: options.helperScriptPath} : {}),
    preview,
    now: options.now ?? Date.now,
  });
}

export function createWorkspaceListTool(options: WorkspaceListOptions): RegisteredTool {
  const root = canonicalRoot(options?.rootPath);
  const maxEntries = boundedInteger(
    options.maxEntries,
    MAX_WORKSPACE_LIST_LIMIT,
    'maxEntries',
    MAX_WORKSPACE_LIST_LIMIT,
  );
  const defaultLimit = Math.min(DEFAULT_WORKSPACE_LIST_LIMIT, maxEntries);
  const now = options.now ?? Date.now;
  const descriptor: ToolDescriptor = {
    name: WORKSPACE_LIST_TOOL_NAME,
    version: WORKSPACE_LIST_TOOL_VERSION,
    inputSchema: listInputSchema(maxEntries),
    outputSchema: listOutputSchema(maxEntries),
    sideEffect: 'read',
    requiredScopes: [WORKSPACE_LIST_SCOPE],
    idempotencySupport: true,
    recoverySupport: true,
    requiresPresence: false,
  };

  return {
    descriptor,
    execute: async (input: unknown, context: ToolContext): Promise<WorkspaceListResult> => {
      validateToolValue(descriptor.inputSchema, input);
      checkContext(context, now, WORKSPACE_LIST_SCOPE, 'Workspace listing');
      const request = input as WorkspaceListInput;
      const path = canonicalRelativeDirectoryPath(request.path);
      if (path.normalized !== '.' && isSensitivePath(path.normalized)) {
        throw new ProtocolError('SCOPE_DENIED', 'Workspace directory is blocked by the default sensitive-file policy');
      }
      const effectiveLimit = boundedInteger(request.limit, defaultLimit, 'limit', maxEntries);
      const candidate = resolve(root, ...path.segments);
      if (!pathIsAtOrWithinRoot(root, candidate)) {
        throw new ProtocolError('SCOPE_DENIED', 'Workspace directory escapes the configured root');
      }

      try {
        checkContext(context, now, WORKSPACE_LIST_SCOPE, 'Workspace listing');
        const requestedStat = await lstat(candidate);
        if (requestedStat.isSymbolicLink()) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace directory links are not traversed');
        }

        const resolvedBeforeOpen = await realpath(candidate);
        if (!pathIsAtOrWithinRoot(root, resolvedBeforeOpen)) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace directory escapes the configured root');
        }
        if (!sameCanonicalPath(candidate, resolvedBeforeOpen)) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace directory aliases are not traversed');
        }
        const resolvedPolicyPath = relative(root, resolvedBeforeOpen).split(sep).join('/');
        if (resolvedPolicyPath && isSensitivePath(resolvedPolicyPath)) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace directory resolves to a sensitive path');
        }

        const openedStat = await stat(resolvedBeforeOpen);
        if (!openedStat.isDirectory()) {
          throw new ProtocolError('INVALID_ARGUMENT', 'Workspace path must identify a directory');
        }

        checkContext(context, now, WORKSPACE_LIST_SCOPE, 'Workspace listing');
        const entries: WorkspaceListEntry[] = [];
        let eligibleCount = 0;
        const directory = await opendir(resolvedBeforeOpen);
        for await (const dirent of directory) {
          checkContext(context, now, WORKSPACE_LIST_SCOPE, 'Workspace listing');
          const kind = dirent.isFile() ? 'file' : dirent.isDirectory() ? 'directory' : undefined;
          if (!kind) continue;
          const entryPath = path.normalized === '.' ? dirent.name : `${path.normalized}/${dirent.name}`;
          try {
            canonicalRelativePath(entryPath);
          } catch (error) {
            if (error instanceof ProtocolError) continue;
            throw error;
          }
          if (isSensitivePath(entryPath)) continue;
          eligibleCount = Math.min(effectiveLimit + 1, eligibleCount + 1);
          retainSortedEntry(entries, {name: dirent.name, kind}, effectiveLimit);
        }

        checkContext(context, now, WORKSPACE_LIST_SCOPE, 'Workspace listing');
        const requestedAfterRead = await lstat(candidate);
        if (requestedAfterRead.isSymbolicLink()) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace directory changed during enumeration');
        }
        const resolvedAfterRead = await realpath(candidate);
        if (!pathIsAtOrWithinRoot(root, resolvedAfterRead)
          || !sameCanonicalPath(resolvedBeforeOpen, resolvedAfterRead)) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace directory changed during enumeration');
        }
        const completedStat = await stat(resolvedAfterRead);
        if (!sameFileIdentity(openedStat, completedStat)) {
          throw new ProtocolError('SCOPE_DENIED', 'Workspace directory changed during enumeration');
        }

        const result: WorkspaceListResult = {
          path: path.normalized,
          entries,
          truncated: eligibleCount > effectiveLimit,
        };
        assertSerializedResultFits(result, 'Workspace list result exceeds the bounded serialized-output limit');
        checkContext(context, now, WORKSPACE_LIST_SCOPE, 'Workspace listing');
        return result;
      } catch (error) {
        mapFileSystemError(error);
      }
    },
  };
}

export function register(host: ToolHost, options: WorkspaceReadOptions): () => void {
  return host.register(createWorkspaceReadTool(options));
}

export function registerWorkspaceList(host: ToolHost, options: WorkspaceListOptions): () => void {
  return host.register(createWorkspaceListTool(options));
}

export function registerWorkspacePatchPreview(
  host: ToolHost,
  options: WorkspacePatchPreviewOptions,
): () => void {
  return host.register(createWorkspacePatchPreviewTool(options));
}

export function registerWorkspacePatchStage(host: ToolHost, options: WorkspacePatchPreviewOptions): () => void {
  return host.register(createWorkspacePatchStageTool(options));
}

export function registerWorkspacePatchApply(
  host: ToolHost,
  options: WorkspacePatchPreviewOptions & WorkspacePatchApplyHostOptions,
): () => void {
  return host.register(createWorkspacePatchApplyTool(options));
}
export {createGitTools, registerGitTools, readGitWorkspaceFingerprint,
  GIT_HEAD_TOOL, GIT_COMMIT_TOOL, GIT_PUSH_TOOL, GIT_READ_SCOPE, GIT_COMMIT_SCOPE, GIT_PUSH_SCOPE} from './dev-workflows/git-tools.js';
export type {GitFileHash, GitVerificationReceipt, GitToolsOptions, GitHeadResult, GitCommitInput,
  GitCommitResult, GitPushInput, GitPushResult} from './dev-workflows/git-tools-types.js';
export {runCiFix, createCiFixWorkflow} from './dev-workflows/ci-fix.js';
export {createCiRunDiscoveryWorkflow} from './dev-workflows/ci-run-discovery.js';
export type {CiDiscoveredRun, CiRunListRequest, CiRunListResult, CiRunDiscoveryOptions,
  CiRunDiscoveryWorkflowPort} from './dev-workflows/ci-run-discovery.js';
export type {ToolExecutionPort, CiFixProposal, CiFixGitTools, CiFixOptions,
  CiFixWorkflowPort, CiFixOutcome} from './dev-workflows/ci-fix-types.js';
