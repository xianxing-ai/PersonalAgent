import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, realpathSync, statSync, unlinkSync} from 'node:fs';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext, ToolDescriptor} from '@personal-agent/contracts';
import {invokeLockedApplyHelper} from './patch-apply.js';
import {workspacePatchInflightPathFromCanonical} from './patch-reconcile.js';
import {canonicalRelativePath, isSensitivePath, pathIsWithinRoot} from './workspace-paths.js';

export const WORKSPACE_CREATE_TEXT_TOOL_NAME = 'workspace.create_text';
export const WORKSPACE_CREATE_TEXT_TOOL_VERSION = '1.0.0';
export const WORKSPACE_CREATE_TEXT_SCOPE = 'workspace:create';
export const DEFAULT_MAX_CREATE_BYTES = 256 * 1024;
const MAX_CREATE_BYTES = 1024 * 1024;
const MAX_RELATIVE_PATH_LENGTH = 1024;
const INPUT_DIGEST = /^[a-f0-9]{64}$/u;

export interface WorkspaceCreateTextOptions {
  /** Trusted host-provided workspace root. Canonicalized before registration. */
  rootPath: string;
  /** Trusted, access-controlled directory outside the workspace for the in-flight marker. */
  recoveryRootPath: string;
  /** Absolute path to the trusted Windows PowerShell executable. */
  powerShellPath: string;
  /** Optional trusted WindowsJobProcessHost executable used by the existing helper contract. */
  processIdentityHelperPath?: string;
  /** Optional byte-identical bundled helper installed outside the workspace. */
  helperScriptPath?: string;
  /** Hard ceiling for the created UTF-8 payload. */
  maxCreateBytes?: number;
  /** Trusted clock injection for deterministic deadline tests. */
  now?: () => number;
}

export interface WorkspaceCreateTextResult {
  path: string;
  encoding: 'utf-8';
  byteLength: number;
  sha256: string;
  created: true;
}

interface CreateInput {
  path: string;
  content: string;
}

const inputSchema = (maxBytes: number): ToolDescriptor['inputSchema'] => ({
  type: 'object',
  description: 'Create one new UTF-8 text file beneath the trusted workspace root. The target must not exist; existing files are never overwritten. The result is a local tool receipt, not permission to send file content to AgentArts.',
  required: ['path', 'content'],
  additionalProperties: false,
  properties: {
    path: {
      type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH,
      description: 'Canonical relative workspace path for the new file. Absolute, parent, device, UNC, ADS, symlink/junction escape, sensitive paths and existing files are rejected.',
    },
    content: {
      type: 'string', maxLength: maxBytes,
      description: 'Exact UTF-8 text to create. Byte length, not character count, is bounded by the host limit.',
    },
  },
});

const outputSchema = (): ToolDescriptor['outputSchema'] => ({
  type: 'object',
  required: ['path', 'encoding', 'byteLength', 'sha256', 'created'],
  additionalProperties: false,
  properties: {
    path: {type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH},
    encoding: {enum: ['utf-8']},
    byteLength: {type: 'integer', minimum: 0, maximum: MAX_CREATE_BYTES},
    sha256: {type: 'string', pattern: '^[a-f0-9]{64}$'},
    created: {enum: [true]},
  },
});

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function atOrWithin(root: string, candidate: string): boolean {
  const part = relative(root, candidate);
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

function check(context: ToolContext, now: () => number): number {
  for (const scope of ['workspace:read', 'workspace:write', WORKSPACE_CREATE_TEXT_SCOPE]) {
    if (!context.scopes.includes(scope)) {
      throw new ProtocolError('SCOPE_DENIED', 'Workspace create requires read, write and create scopes');
    }
  }
  if (typeof context.runId !== 'string' || !context.runId.trim()
    || !INPUT_DIGEST.test(context.argumentsDigest ?? '')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Workspace create execution identity is unavailable');
  }
  if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Workspace create was cancelled');
  const deadline = Date.parse(context.deadline);
  const remaining = deadline - now();
  if (!Number.isFinite(deadline) || remaining <= 0) {
    throw new ProtocolError('TIMEOUT', 'Workspace create deadline expired');
  }
  return remaining;
}

/** Resolves the parent without following a link out of the trusted root. */
function resolveParent(root: string, segments: readonly string[]): string {
  const parent = resolve(root, ...segments.slice(0, -1));
  if (!pathIsWithinRoot(root, parent) && parent !== root) {
    throw new ProtocolError('SCOPE_DENIED', 'Workspace create parent escapes the configured root');
  }
  let canonicalParent: string;
  try {
    canonicalParent = realpathSync.native(parent);
  } catch {
    throw new ProtocolError('NOT_FOUND', 'Workspace create parent directory does not exist');
  }
  if (!atOrWithin(root, canonicalParent) || !statSync(canonicalParent).isDirectory()) {
    throw new ProtocolError('SCOPE_DENIED', 'Workspace create parent is not a trusted directory');
  }
  return canonicalParent;
}

function targetState(target: string): {exists: boolean; sha256?: string} {
  try {
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink()) return {exists: true};
    return {exists: true, sha256: digest(readFileSync(target))};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {exists: false};
    throw new ProtocolError('SCOPE_DENIED', 'Workspace create target is not readable under the configured policy');
  }
}

export function createWorkspaceCreateTextTool(options: WorkspaceCreateTextOptions): RegisteredTool {
  if (process.platform !== 'win32') throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Locked workspace create requires Windows');
  const root = realpathSync.native(options.rootPath);
  const recoveryRoot = realpathSync.native(options.recoveryRootPath);
  const powerShell = realpathSync.native(options.powerShellPath);
  const helper = realpathSync.native(options.helperScriptPath
    ?? fileURLToPath(new URL('../scripts/locked-apply.ps1', import.meta.url)));
  if (!statSync(root).isDirectory() || !statSync(recoveryRoot).isDirectory()
    || !statSync(powerShell).isFile() || !statSync(helper).isFile()
    || atOrWithin(root, recoveryRoot) || atOrWithin(recoveryRoot, root)
    || atOrWithin(root, powerShell) || atOrWithin(root, helper) || atOrWithin(recoveryRoot, helper)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Workspace create host paths must be distinct trusted locations');
  }
  const maxCreateBytes = options.maxCreateBytes ?? DEFAULT_MAX_CREATE_BYTES;
  if (!Number.isSafeInteger(maxCreateBytes) || maxCreateBytes < 1 || maxCreateBytes > MAX_CREATE_BYTES) {
    throw new ProtocolError('INVALID_ARGUMENT', `maxCreateBytes must be an integer from 1 to ${MAX_CREATE_BYTES}`);
  }
  const now = options.now ?? Date.now;
  const descriptor: ToolDescriptor = {
    name: WORKSPACE_CREATE_TEXT_TOOL_NAME,
    version: WORKSPACE_CREATE_TEXT_TOOL_VERSION,
    inputSchema: inputSchema(maxCreateBytes),
    outputSchema: outputSchema(),
    sideEffect: 'local_write',
    requiredScopes: ['workspace:read', 'workspace:write', WORKSPACE_CREATE_TEXT_SCOPE],
    idempotencySupport: false,
    recoverySupport: false,
    requiresPresence: false,
  };
  return {
    descriptor,
    execute: async (input: unknown, context: ToolContext): Promise<WorkspaceCreateTextResult> => {
      validateToolValue(descriptor.inputSchema, input);
      check(context, now);
      const request = input as CreateInput;
      const path = canonicalRelativePath(request.path);
      if (isSensitivePath(path.normalized)) {
        throw new ProtocolError('SCOPE_DENIED', 'Workspace path is blocked by the default sensitive-file policy');
      }
      const bytes = Buffer.from(request.content, 'utf8');
      if (bytes.length > maxCreateBytes) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Workspace create content exceeds the byte limit');
      }
      if (bytes.includes(0)) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Workspace create accepts UTF-8 text without NUL bytes');
      }
      const parent = resolveParent(root, path.segments);
      const target = resolve(parent, path.segments.at(-1) ?? '');
      if (!atOrWithin(root, target)) {
        throw new ProtocolError('SCOPE_DENIED', 'Workspace create target escapes the configured root');
      }
      if (targetState(target).exists) {
        throw new ProtocolError('REVISION_CONFLICT', 'Workspace create target already exists');
      }
      const sha256 = digest(bytes);
      const marker = workspacePatchInflightPathFromCanonical(root, recoveryRoot, path.normalized);
      let response;
      try {
        response = await invokeLockedApplyHelper(powerShell, helper, options.processIdentityHelperPath, {
          operation: 'create', rootPath: root, sourcePath: target,
          afterSha256: sha256, afterBase64: bytes.toString('base64'),
        }, marker, context, now, {requiredScopes: ['workspace:read', 'workspace:write', WORKSPACE_CREATE_TEXT_SCOPE]});
      } catch (error) {
        if (error instanceof ProtocolError) throw error;
        throw new ProtocolError('RESULT_UNKNOWN', 'Workspace create helper did not confirm a receipt');
      }
      if (response.state === 'exists' || response.state === 'conflict') {
        throw new ProtocolError('REVISION_CONFLICT', 'Workspace create target already exists');
      }
      if (response.state !== 'created') {
        throw new ProtocolError('RESULT_UNKNOWN', 'Workspace create requires reconciliation');
      }
      return {path: path.normalized, encoding: 'utf-8', byteLength: bytes.length, sha256, created: true};
    },
  };
}

export interface WorkspaceCreateTextReconcileOptions {
  rootPath: string;
  recoveryRootPath: string;
  relativePath: string;
  expectedRunId: string;
  expectedArgumentsDigest: string;
  expectedSha256: string;
  /** Optional process identity probe; without it an absent target stays in_progress. */
  isProcessAlive?: (identity: {pid: number; startTimeTicks: string}) => boolean;
  /** Keep the marker until Runtime has persisted the reconciliation outcome. */
  retainMarker?: boolean;
}

export type WorkspaceCreateTextReconciliation =
  | {path: string; state: 'clear'}
  | {path: string; state: 'in_progress'; runId: string; argumentsDigest: string}
  | {path: string; state: 'reconciled'; runId: string; argumentsDigest: string;
    outcome: 'created' | 'not_created' | 'unknown'; currentSha256?: string | undefined};

/** Reads the durable create marker and the target; never writes or deletes the target. */
export function reconcileWorkspaceCreateText(options: WorkspaceCreateTextReconcileOptions): WorkspaceCreateTextReconciliation {
  const root = realpathSync.native(options.rootPath);
  const recoveryRoot = realpathSync.native(options.recoveryRootPath);
  const path = canonicalRelativePath(options.relativePath);
  const marker = workspacePatchInflightPathFromCanonical(root, recoveryRoot, path.normalized);
  let saved: {operation?: string; runId?: string; argumentsDigest?: string; pid?: number; startTimeTicks?: string; afterSha256?: string};
  try {
    saved = JSON.parse(readFileSync(marker, 'utf8')) as typeof saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {path: path.normalized, state: 'clear'};
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace create marker is unreadable');
  }
  if (saved.operation !== 'create' || saved.runId !== options.expectedRunId
    || saved.argumentsDigest !== options.expectedArgumentsDigest
    || saved.afterSha256 !== options.expectedSha256) {
    throw new ProtocolError('REVISION_CONFLICT', 'Workspace create marker belongs to a different operation');
  }
  const target = resolve(root, ...path.segments);
  const state = targetState(target);
  if (state.exists && state.sha256 === options.expectedSha256) {
    if (!options.retainMarker) unlinkSync(marker);
    return {path: path.normalized, state: 'reconciled', runId: options.expectedRunId,
      argumentsDigest: options.expectedArgumentsDigest, outcome: 'created', currentSha256: state.sha256};
  }
  if (state.exists) {
    return {path: path.normalized, state: 'reconciled', runId: options.expectedRunId,
      argumentsDigest: options.expectedArgumentsDigest, outcome: 'unknown',
      ...(state.sha256 === undefined ? {} : {currentSha256: state.sha256})};
  }
  const pid = saved.pid;
  const startTimeTicks = saved.startTimeTicks;
  if (options.isProcessAlive && typeof pid === 'number' && Number.isSafeInteger(pid) && typeof startTimeTicks === 'string') {
    if (options.isProcessAlive({pid, startTimeTicks})) {
      return {path: path.normalized, state: 'in_progress', runId: options.expectedRunId,
        argumentsDigest: options.expectedArgumentsDigest};
    }
    if (!options.retainMarker) unlinkSync(marker);
    return {path: path.normalized, state: 'reconciled', runId: options.expectedRunId,
      argumentsDigest: options.expectedArgumentsDigest, outcome: 'not_created'};
  }
  return {path: path.normalized, state: 'in_progress', runId: options.expectedRunId,
    argumentsDigest: options.expectedArgumentsDigest};
}

