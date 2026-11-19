import {createHash} from 'node:crypto';
import {isProtocolError, ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext, ToolDescriptor, ToolHost} from '@personal-agent/contracts';
import {canonicalRelativePath, isSensitivePath} from './workspace-paths.js';

export const WORKSPACE_PATCH_SCOPE_TOOL_NAME = 'workspace.patch_scope_check';
export const WORKSPACE_PATCH_SCOPE_TOOL_VERSION = '1.0.0';
export const WORKSPACE_PATCH_SCOPE_SCOPE = 'workspace:read';

export interface CodingVerificationArtifactInput {
  sessionId: string;
  runId: string;
  recipeId: string;
  packageIds: readonly string[];
  inputSnapshotId: string;
  files: readonly {path: string; sha256: string | null; content?: string}[];
  exitCode: number | null;
}

/** Identifies the observed command execution. Status, diagnostics and file bodies are excluded. */
export function codingVerificationArtifactDigest(receipt: CodingVerificationArtifactInput): string {
  const canonical = {
    version: 1,
    kind: 'coding-repair-verification',
    sessionId: receipt.sessionId,
    runId: receipt.runId,
    recipeId: receipt.recipeId,
    exitCode: receipt.exitCode,
    inputSnapshotId: receipt.inputSnapshotId,
    packageIds: [...receipt.packageIds].sort(),
    files: receipt.files.map(file => ({path: file.path, sha256: file.sha256})).sort((left, right) => left.path.localeCompare(right.path)),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function freezePatchScopeAllowlist(paths: readonly string[]): readonly string[] {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 256) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Patch scope allowlist is invalid');
  }
  const seen = new Set<string>();
  const frozen: string[] = [];
  for (const value of paths) {
    if (typeof value !== 'string') throw new ProtocolError('INVALID_ARGUMENT', 'Patch scope allowlist is invalid');
    let normalized: string;
    try { normalized = canonicalRelativePath(value).normalized; }
    catch { throw new ProtocolError('INVALID_ARGUMENT', 'Patch scope allowlist is invalid'); }
    if (isSensitivePath(normalized) || seen.has(normalized)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Patch scope allowlist is invalid');
    }
    seen.add(normalized);
    frozen.push(normalized);
  }
  return Object.freeze(frozen);
}

export interface WorkspacePatchScopeResult {
  path: string;
  expectedSha256: string;
  observedSha256: string | null;
  afterSha256: string | null;
  changed: boolean | null;
  withinAuthorizedScope: boolean;
  /** This tool never writes. True means the authorized file bytes were left as read. */
  userChangesPreserved: true;
  verificationStatus: 'matched' | 'conflict';
  /** Mechanical path and digest agreement is not an API or formatting review. */
  behaviorReviewed: false;
  scopeReady: boolean;
  artifactDigest: string;
}

interface ScopeReaderResult {path: string; sha256?: string; content?: string}

function scopeDigest(result: Omit<WorkspacePatchScopeResult, 'artifactDigest' | 'scopeReady' | 'userChangesPreserved' | 'withinAuthorizedScope' | 'behaviorReviewed'> & {
  verificationStatus: WorkspacePatchScopeResult['verificationStatus'];
}): string {
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    kind: 'workspace-patch-scope',
    path: result.path,
    expectedSha256: result.expectedSha256,
    observedSha256: result.observedSha256,
    afterSha256: result.afterSha256,
    verificationStatus: result.verificationStatus,
    behaviorReviewed: false,
  })).digest('hex');
}

function scopeResult(input: {
  path: string;
  expectedSha256: string;
  observedSha256: string | null;
  afterSha256: string | null;
  changed: boolean | null;
  verificationStatus: 'matched' | 'conflict';
}): WorkspacePatchScopeResult {
  const digestInput = {
    path: input.path,
    expectedSha256: input.expectedSha256,
    observedSha256: input.observedSha256,
    afterSha256: input.afterSha256,
    changed: input.changed,
    verificationStatus: input.verificationStatus,
  };
  return {
    ...digestInput,
    withinAuthorizedScope: true,
    userChangesPreserved: true,
    behaviorReviewed: false,
    scopeReady: input.verificationStatus === 'matched',
    artifactDigest: scopeDigest(digestInput),
  };
}

export function assembleWorkspacePatchScopeTool(options: {
  allowedPaths: readonly string[];
  reader: RegisteredTool;
  preview: RegisteredTool;
  now?: () => number;
}): RegisteredTool {
  const allowed = new Set(freezePatchScopeAllowlist(options.allowedPaths));
  const now = options.now ?? Date.now;
  const descriptor: ToolDescriptor = {
    name: WORKSPACE_PATCH_SCOPE_TOOL_NAME,
    version: WORKSPACE_PATCH_SCOPE_TOOL_VERSION,
    inputSchema: options.preview.descriptor.inputSchema,
    outputSchema: {
      type: 'object',
      required: ['path', 'expectedSha256', 'observedSha256', 'afterSha256', 'changed', 'withinAuthorizedScope',
        'userChangesPreserved', 'verificationStatus', 'behaviorReviewed', 'scopeReady', 'artifactDigest'],
      additionalProperties: false,
      properties: {
        path: {type: 'string'},
        expectedSha256: {type: 'string', pattern: '^[a-f0-9]{64}$'},
        observedSha256: {type: ['string', 'null']},
        afterSha256: {type: ['string', 'null']},
        changed: {type: ['boolean', 'null']},
        withinAuthorizedScope: {type: 'boolean'},
        userChangesPreserved: {const: true},
        verificationStatus: {enum: ['matched', 'conflict']},
        behaviorReviewed: {const: false},
        scopeReady: {type: 'boolean'},
        artifactDigest: {type: 'string', pattern: '^[a-f0-9]{64}$'},
      },
    },
    sideEffect: 'read',
    requiredScopes: [WORKSPACE_PATCH_SCOPE_SCOPE],
    idempotencySupport: false,
    recoverySupport: false,
    requiresPresence: false,
  };
  return {
    descriptor,
    execute: async (input: unknown, context: ToolContext): Promise<WorkspacePatchScopeResult> => {
      validateToolValue(descriptor.inputSchema, input);
      if (!context.scopes.includes(WORKSPACE_PATCH_SCOPE_SCOPE)) {
        throw new ProtocolError('SCOPE_DENIED', 'Workspace patch scope check requires read scope');
      }
      if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Workspace patch scope check was cancelled');
      const deadline = Date.parse(context.deadline);
      if (!Number.isFinite(deadline) || now() >= deadline) {
        throw new ProtocolError('TIMEOUT', 'Workspace patch scope check deadline expired');
      }
      const request = input as {path: string; expectedSha256: string; edits: {oldText: string; newText: string}[]};
      let path: string;
      try { path = canonicalRelativePath(request.path).normalized; }
      catch { throw new ProtocolError('SCOPE_DENIED', 'Workspace patch path is outside the authorized scope'); }
      if (!allowed.has(path)) throw new ProtocolError('SCOPE_DENIED', 'Workspace patch path is outside the authorized scope');
      const read = await options.reader.execute({path}, context) as ScopeReaderResult;
      if (read.path !== path || typeof read.sha256 !== 'string') {
        throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch scope read did not return the authorized file digest');
      }
      if (read.sha256 !== request.expectedSha256) {
        return scopeResult({
          path, expectedSha256: request.expectedSha256, observedSha256: read.sha256,
          afterSha256: null, changed: null, verificationStatus: 'conflict',
        });
      }
      try {
        const preview = await options.preview.execute({path, expectedSha256: request.expectedSha256, edits: request.edits}, context) as {
          path?: string; beforeSha256?: string; afterSha256?: string; changed?: boolean; previewText?: string;
        };
        if (preview.path !== path || preview.beforeSha256 !== request.expectedSha256
          || typeof preview.afterSha256 !== 'string' || typeof preview.changed !== 'boolean'
          || typeof preview.previewText === 'undefined') {
          throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch scope preview did not match the authorized file');
        }
        return scopeResult({
          path, expectedSha256: request.expectedSha256, observedSha256: preview.beforeSha256,
          afterSha256: preview.afterSha256, changed: preview.changed, verificationStatus: 'matched',
        });
      } catch (error) {
        if (!isProtocolError(error) || error.code !== 'REVISION_CONFLICT') throw error;
        const again = await options.reader.execute({path}, context) as ScopeReaderResult;
        return scopeResult({
          path, expectedSha256: request.expectedSha256,
          observedSha256: typeof again.sha256 === 'string' ? again.sha256 : null,
          afterSha256: null, changed: null, verificationStatus: 'conflict',
        });
      }
    },
  };
}

export function registerWorkspacePatchScope(host: ToolHost, tool: RegisteredTool): () => void {
  if (tool.descriptor.name !== WORKSPACE_PATCH_SCOPE_TOOL_NAME) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Patch scope registration requires the scope tool');
  }
  return host.register(tool);
}
