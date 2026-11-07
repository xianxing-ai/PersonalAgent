/**
 * Local Artifact Service for MOD-18 (Phase 1).
 *
 * Provides safe in-memory and disk-backed artifact lifecycle management:
 * creation, retrieval, enumeration, expiration, and release.
 *
 * Explicit Boundary Guarantees:
 * - This is NOT a Runtime Evidence service.
 * - This is NOT an AgentArts platform Artifact.
 * - Stored content/digests are local tool artifacts and must not be treated as
 *   an automatic Policy approval or unverified truth.
 * - Unregistered by default: this module is not registered into ToolHost unless
 *   explicitly assembled by a host caller.
 */

import {createHash, randomUUID} from 'node:crypto';
import {existsSync, realpathSync, statSync} from 'node:fs';
import {lstat, mkdir, readFile, unlink, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, resolve} from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext, ToolDescriptor} from '@personal-agent/contracts';
import {canonicalRelativePath, isSensitivePath, pathIsWithinRoot} from './workspace-paths.js';

export type ArtifactKind =
  | 'coding-repair-verification'
  | 'workspace-patch'
  | 'command-run'
  | (string & {});

export type ArtifactStatus = 'active' | 'expired' | 'released';

export interface ArtifactRecord {
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  readonly sha256: string;
  readonly byteLength: number;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly status: ArtifactStatus;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly relativePath?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ArtifactContentResult {
  readonly record: ArtifactRecord;
  readonly content: Buffer;
}

export interface ArtifactReleaseResult {
  readonly artifactId: string;
  readonly released: boolean;
  readonly alreadyReleased: boolean;
}

export interface ArtifactServiceOptions {
  /**
   * Trusted base directory for persisting artifacts to disk.
   * If omitted, artifacts are held in memory.
   */
  readonly artifactsRoot?: string;
  /**
   * Trusted clock provider for deterministic time and deadline testing.
   */
  readonly now?: () => number;
  /**
   * Default time-to-live in milliseconds. If omitted, artifacts do not automatically expire.
   */
  readonly defaultTtlMs?: number;
  /**
   * Maximum allowed single artifact byte size. Default: 10MB.
   */
  readonly maxArtifactBytes?: number;
}

export interface CreateArtifactInput {
  readonly kind: ArtifactKind;
  readonly content?: string | Uint8Array;
  readonly sha256?: string;
  readonly byteLength?: number;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly ttlMs?: number;
  readonly expiresAt?: string | null;
  readonly relativePath?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly persist?: boolean;
}

export interface ListArtifactsFilter {
  readonly kind?: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly includeExpired?: boolean;
  readonly includeReleased?: boolean;
}

const DEFAULT_MAX_ARTIFACT_BYTES = 10 * 1024 * 1024; // 10MB
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;

function canonicalRootDirectory(dirPath: string, label: string): string {
  if (typeof dirPath !== 'string' || !dirPath.trim()) {
    throw new ProtocolError('INVALID_ARGUMENT', `${label} must not be empty`);
  }
  try {
    const canonical = realpathSync.native(dirPath);
    if (!statSync(canonical).isDirectory()) {
      throw new ProtocolError('INVALID_ARGUMENT', `${label} must identify an existing directory`);
    }
    return canonical;
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError('INVALID_ARGUMENT', `${label} is not an accessible directory`);
  }
}

export class ArtifactService {
  private readonly artifactsRoot?: string;
  private readonly now: () => number;
  private readonly defaultTtlMs?: number;
  private readonly maxArtifactBytes: number;
  private readonly records = new Map<string, ArtifactRecord>();
  private readonly inMemoryBuffers = new Map<string, Buffer>();

  constructor(options: ArtifactServiceOptions = {}) {
    if (options.artifactsRoot !== undefined) {
      this.artifactsRoot = canonicalRootDirectory(options.artifactsRoot, 'artifactsRoot');
    }
    this.now = options.now ?? Date.now;
    if (options.defaultTtlMs !== undefined) {
      if (!Number.isSafeInteger(options.defaultTtlMs) || options.defaultTtlMs < 1) {
        throw new ProtocolError('INVALID_ARGUMENT', 'defaultTtlMs must be a positive integer');
      }
      this.defaultTtlMs = options.defaultTtlMs;
    }
    this.maxArtifactBytes = options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
    if (!Number.isSafeInteger(this.maxArtifactBytes) || this.maxArtifactBytes < 1) {
      throw new ProtocolError('INVALID_ARGUMENT', 'maxArtifactBytes must be a positive integer');
    }
  }

  /**
   * Creates a new artifact record and optionally writes its content to the artifactsRoot directory.
   */
  async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
    if (!input || typeof input !== 'object') {
      throw new ProtocolError('INVALID_ARGUMENT', 'CreateArtifactInput must be an object');
    }
    if (typeof input.kind !== 'string' || !input.kind.trim()) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Artifact kind must be a non-empty string');
    }

    let buffer: Buffer | null = null;
    let sha256: string;
    let byteLength: number;

    if (input.content !== undefined) {
      if (typeof input.content === 'string') {
        buffer = Buffer.from(input.content, 'utf8');
      } else if (input.content instanceof Uint8Array) {
        buffer = Buffer.from(input.content.buffer, input.content.byteOffset, input.content.byteLength);
      } else {
        throw new ProtocolError('INVALID_ARGUMENT', 'Artifact content must be a string or Uint8Array');
      }

      if (buffer.byteLength > this.maxArtifactBytes) {
        throw new ProtocolError('INVALID_ARGUMENT', `Artifact size exceeds limit of ${this.maxArtifactBytes} bytes`);
      }

      byteLength = buffer.byteLength;
      sha256 = createHash('sha256').update(buffer).digest('hex');

      if (input.sha256 !== undefined) {
        if (!SHA256_PATTERN.test(input.sha256) || input.sha256.toLowerCase() !== sha256) {
          throw new ProtocolError('INVALID_ARGUMENT', 'Provided sha256 does not match artifact content digest');
        }
      }
    } else {
      if (!input.sha256 || !SHA256_PATTERN.test(input.sha256)) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Valid sha256 is required when content is omitted');
      }
      sha256 = input.sha256.toLowerCase();
      byteLength = input.byteLength ?? 0;
      if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > this.maxArtifactBytes) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Artifact byteLength must be within valid bounds');
      }
    }

    const artifactId = randomUUID();
    const currentTime = this.now();
    const createdAt = new Date(currentTime).toISOString();

    let expiresAt: string | null = null;
    if (input.expiresAt !== undefined && input.expiresAt !== null) {
      const parsed = Date.parse(input.expiresAt);
      if (!Number.isFinite(parsed)) {
        throw new ProtocolError('INVALID_ARGUMENT', 'expiresAt must be a valid ISO 8601 date string');
      }
      expiresAt = new Date(parsed).toISOString();
    } else if (input.ttlMs !== undefined) {
      if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1) {
        throw new ProtocolError('INVALID_ARGUMENT', 'ttlMs must be a positive integer');
      }
      expiresAt = new Date(currentTime + input.ttlMs).toISOString();
    } else if (this.defaultTtlMs !== undefined) {
      expiresAt = new Date(currentTime + this.defaultTtlMs).toISOString();
    }

    const isExpired = expiresAt !== null && Date.parse(expiresAt) <= currentTime;
    const status: ArtifactStatus = isExpired ? 'expired' : 'active';

    let relativePath: string | undefined;
    const shouldPersist = input.persist !== false && this.artifactsRoot !== undefined && buffer !== null;

    if (shouldPersist && buffer !== null) {
      if (input.relativePath !== undefined) {
        let canonical: {normalized: string; segments: string[]};
        try {
          canonical = canonicalRelativePath(input.relativePath);
        } catch (error) {
          if (error instanceof ProtocolError) throw error;
          throw new ProtocolError('INVALID_ARGUMENT', 'Invalid relativePath for artifact');
        }
        if (isSensitivePath(canonical.normalized)) {
          throw new ProtocolError('SCOPE_DENIED', 'Artifact relativePath is blocked by sensitive-path policy');
        }
        const targetPath = resolve(this.artifactsRoot!, ...canonical.segments);
        if (!pathIsWithinRoot(this.artifactsRoot!, targetPath)) {
          throw new ProtocolError('SCOPE_DENIED', 'Artifact relativePath escapes artifactsRoot');
        }
        relativePath = canonical.normalized;
        await mkdir(dirname(targetPath), {recursive: true});
        await writeFile(targetPath, buffer);
      } else {
        const defaultFilename = `${artifactId}.bin`;
        const targetPath = resolve(this.artifactsRoot!, defaultFilename);
        relativePath = defaultFilename;
        await writeFile(targetPath, buffer);
      }
    } else if (buffer !== null) {
      this.inMemoryBuffers.set(artifactId, buffer);
    }

    const record: ArtifactRecord = {
      artifactId,
      kind: input.kind,
      sha256,
      byteLength,
      createdAt,
      expiresAt,
      status,
      ...(input.sessionId ? {sessionId: input.sessionId} : {}),
      ...(input.runId ? {runId: input.runId} : {}),
      ...(relativePath ? {relativePath} : {}),
      ...(input.metadata ? {metadata: Object.freeze({...input.metadata})} : {}),
    };

    this.records.set(artifactId, record);
    return Object.freeze({...record});
  }

  /**
   * Retrieves an artifact's metadata record. Automatically transitions status to 'expired'
   * if the current clock time has exceeded expiresAt.
   */
  async get(artifactId: string): Promise<ArtifactRecord> {
    if (typeof artifactId !== 'string' || !artifactId.trim()) {
      throw new ProtocolError('INVALID_ARGUMENT', 'artifactId must be a non-empty string');
    }
    const record = this.records.get(artifactId);
    if (!record) {
      throw new ProtocolError('NOT_FOUND', `Artifact '${artifactId}' was not found`);
    }

    if (record.status === 'active' && record.expiresAt !== null) {
      if (Date.parse(record.expiresAt) <= this.now()) {
        const updated: ArtifactRecord = {...record, status: 'expired'};
        this.records.set(artifactId, updated);
        return Object.freeze({...updated});
      }
    }

    return Object.freeze({...record});
  }

  /**
   * Reads the stored artifact content bytes.
   * Throws PRECONDITION_FAILED if expired or released.
   */
  async read(artifactId: string): Promise<ArtifactContentResult> {
    const record = await this.get(artifactId);
    if (record.status === 'expired') {
      throw new ProtocolError('PRECONDITION_FAILED', `Artifact '${artifactId}' has expired`);
    }
    if (record.status === 'released') {
      throw new ProtocolError('PRECONDITION_FAILED', `Artifact '${artifactId}' has been released`);
    }

    if (record.relativePath && this.artifactsRoot) {
      const filePath = resolve(this.artifactsRoot, record.relativePath);
      let bytes: Buffer;
      try {
        bytes = await readFile(filePath);
      } catch (error) {
        throw new ProtocolError('NOT_FOUND', `Artifact payload file '${record.relativePath}' could not be read`);
      }
      const verifiedSha = createHash('sha256').update(bytes).digest('hex');
      if (verifiedSha !== record.sha256) {
        throw new ProtocolError('RESULT_UNKNOWN', `Artifact payload digest mismatch on disk for '${artifactId}'`);
      }
      return {record, content: bytes};
    }

    const inMemory = this.inMemoryBuffers.get(artifactId);
    if (inMemory !== undefined) {
      return {record, content: inMemory};
    }

    throw new ProtocolError('NOT_FOUND', `Artifact '${artifactId}' has no stored content payload`);
  }

  /**
   * Lists artifacts matching optional filters.
   */
  async list(filter: ListArtifactsFilter = {}): Promise<readonly ArtifactRecord[]> {
    const nowMs = this.now();
    const results: ArtifactRecord[] = [];

    for (const [id, record] of this.records.entries()) {
      let current = record;
      if (current.status === 'active' && current.expiresAt !== null && Date.parse(current.expiresAt) <= nowMs) {
        current = {...current, status: 'expired'};
        this.records.set(id, current);
      }

      if (!filter.includeExpired && current.status === 'expired') continue;
      if (!filter.includeReleased && current.status === 'released') continue;
      if (filter.kind !== undefined && current.kind !== filter.kind) continue;
      if (filter.sessionId !== undefined && current.sessionId !== filter.sessionId) continue;
      if (filter.runId !== undefined && current.runId !== filter.runId) continue;

      results.push(Object.freeze({...current}));
    }

    // Sort newer first
    results.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return Object.freeze(results);
  }

  /**
   * Explicitly marks an active artifact as expired.
   */
  async expire(artifactId: string): Promise<ArtifactRecord> {
    const record = await this.get(artifactId);
    if (record.status === 'released') {
      throw new ProtocolError('PRECONDITION_FAILED', `Cannot expire already released artifact '${artifactId}'`);
    }
    if (record.status === 'expired') {
      return record;
    }

    const updated: ArtifactRecord = {
      ...record,
      status: 'expired',
      expiresAt: new Date(this.now()).toISOString(),
    };
    this.records.set(artifactId, updated);
    return Object.freeze({...updated});
  }

  /**
   * Releases an artifact and purges its stored content from disk or memory.
   * Idempotent: repeated calls on an already-released artifact return released=false, alreadyReleased=true.
   */
  async release(artifactId: string): Promise<ArtifactReleaseResult> {
    if (typeof artifactId !== 'string' || !artifactId.trim()) {
      throw new ProtocolError('INVALID_ARGUMENT', 'artifactId must be a non-empty string');
    }
    const record = this.records.get(artifactId);
    if (!record) {
      throw new ProtocolError('NOT_FOUND', `Artifact '${artifactId}' was not found`);
    }

    if (record.status === 'released') {
      return {artifactId, released: false, alreadyReleased: true};
    }

    if (record.relativePath && this.artifactsRoot) {
      const filePath = resolve(this.artifactsRoot, record.relativePath);
      try {
        await unlink(filePath);
      } catch (error) {
        // Ignored if already removed
      }
    }

    this.inMemoryBuffers.delete(artifactId);

    const updated: ArtifactRecord = {
      ...record,
      status: 'released',
    };
    this.records.set(artifactId, updated);

    return {artifactId, released: true, alreadyReleased: false};
  }
}

export function createArtifactService(options?: ArtifactServiceOptions): ArtifactService {
  return new ArtifactService(options);
}

// ---------------------------------------------------------------------------
// Windows Recovery Artifact Planning / Binding
// ---------------------------------------------------------------------------

export interface WindowsRecoveryArtifactInput {
  readonly rootPath: string;
  readonly recoveryRootPath: string;
  readonly relativePath: string;
  readonly runId?: string;
  readonly argumentsDigest?: string;
  readonly beforeSha256?: string;
  readonly afterSha256?: string;
  readonly powerShellPath?: string;
  readonly processIdentityHelperPath?: string;
}

export interface WindowsRecoveryArtifactPlan {
  readonly available: boolean;
  readonly reason: 'unavailable' | 'planned';
  readonly platform: string;
  readonly bindingDigest: string;
  readonly markerFileName: string;
  readonly message: string;
}

/**
 * Pure planning function for Windows recovery artifact binding.
 *
 * Explicit rules:
 * - When running on non-Windows (e.g. Linux) or when helpers are missing, returns
 *   `{available: false, reason: 'unavailable'}` without ever faking success.
 * - Computes a deterministic canonical binding digest covering workspace root,
 *   recovery root, target path, and run/patch digests.
 * - Never executes PowerShell or starts native processes.
 */
export function planWindowsRecoveryArtifact(
  input: WindowsRecoveryArtifactInput,
): WindowsRecoveryArtifactPlan {
  if (!input || typeof input !== 'object') {
    throw new ProtocolError('INVALID_ARGUMENT', 'Windows recovery artifact input is required');
  }
  if (!input.rootPath || !input.recoveryRootPath || !input.relativePath) {
    throw new ProtocolError('INVALID_ARGUMENT', 'rootPath, recoveryRootPath, and relativePath are required');
  }

  let canonicalPath: string;
  try {
    canonicalPath = canonicalRelativePath(input.relativePath).normalized;
  } catch {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid relativePath for recovery artifact');
  }

  const canonicalBinding = {
    version: 1,
    kind: 'windows-recovery-binding',
    relativePath: canonicalPath,
    runId: input.runId ?? null,
    argumentsDigest: input.argumentsDigest ?? null,
    beforeSha256: input.beforeSha256 ?? null,
    afterSha256: input.afterSha256 ?? null,
  };
  const bindingDigest = createHash('sha256').update(JSON.stringify(canonicalBinding)).digest('hex');

  const sourceKey = createHash('sha256')
    .update(`${input.rootPath}\n${canonicalPath}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  const markerFileName = `${sourceKey}.inflight`;

  if (process.platform !== 'win32') {
    return {
      available: false,
      reason: 'unavailable',
      platform: process.platform,
      bindingDigest,
      markerFileName,
      message: 'Windows recovery artifact requires Windows (win32) runtime environment',
    };
  }

  const hasPowerShell = typeof input.powerShellPath === 'string' && existsSync(input.powerShellPath);
  const hasIdentityHelper = typeof input.processIdentityHelperPath === 'string' && existsSync(input.processIdentityHelperPath);

  if (!hasPowerShell && !hasIdentityHelper) {
    return {
      available: false,
      reason: 'unavailable',
      platform: 'win32',
      bindingDigest,
      markerFileName,
      message: 'Windows recovery helper executable is unavailable or not found',
    };
  }

  return {
    available: true,
    reason: 'planned',
    platform: 'win32',
    bindingDigest,
    markerFileName,
    message: 'Windows recovery artifact plan generated (helper present; execution not triggered)',
  };
}

/**
 * Validates and checks a recovery artifact binding without executing helpers.
 * Returns the plan outcome. On non-Windows platforms, available will always be false.
 */
export function assertRecoveryArtifactBinding(
  input: WindowsRecoveryArtifactInput,
): WindowsRecoveryArtifactPlan {
  return planWindowsRecoveryArtifact(input);
}

// ---------------------------------------------------------------------------
// Optional ToolHost Assembler (Unregistered by default)
// ---------------------------------------------------------------------------

export const ARTIFACT_GET_TOOL_NAME = 'artifact.get';
export const ARTIFACT_LIST_TOOL_NAME = 'artifact.list';
export const ARTIFACT_CREATE_TOOL_NAME = 'artifact.create';
export const ARTIFACT_SCOPE = 'artifact:manage';

export function assembleArtifactServiceTools(service: ArtifactService): RegisteredTool[] {
  const getTool: RegisteredTool = {
    descriptor: {
      name: ARTIFACT_GET_TOOL_NAME,
      version: '1.0.0',
      inputSchema: {
        type: 'object',
        required: ['artifactId'],
        additionalProperties: false,
        properties: {artifactId: {type: 'string'}},
      },
      outputSchema: {type: 'object'},
      sideEffect: 'read',
      requiredScopes: [ARTIFACT_SCOPE],
      idempotencySupport: true,
      recoverySupport: false,
      requiresPresence: false,
    },
    execute: async (input: unknown, context: ToolContext) => {
      const {artifactId} = input as {artifactId: string};
      return await service.get(artifactId);
    },
  };

  const listTool: RegisteredTool = {
    descriptor: {
      name: ARTIFACT_LIST_TOOL_NAME,
      version: '1.0.0',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: {type: 'string'},
          sessionId: {type: 'string'},
          runId: {type: 'string'},
          includeExpired: {type: 'boolean'},
          includeReleased: {type: 'boolean'},
        },
      },
      outputSchema: {type: 'array', items: {type: 'object'}},
      sideEffect: 'read',
      requiredScopes: [ARTIFACT_SCOPE],
      idempotencySupport: true,
      recoverySupport: false,
      requiresPresence: false,
    },
    execute: async (input: unknown, context: ToolContext) => {
      return await service.list((input as ListArtifactsFilter) ?? {});
    },
  };

  const createTool: RegisteredTool = {
    descriptor: {
      name: ARTIFACT_CREATE_TOOL_NAME,
      version: '1.0.0',
      inputSchema: {
        type: 'object',
        required: ['kind'],
        additionalProperties: false,
        properties: {
          kind: {type: 'string'},
          content: {type: 'string'},
          sha256: {type: 'string'},
          sessionId: {type: 'string'},
          runId: {type: 'string'},
          ttlMs: {type: 'integer', minimum: 1},
        },
      },
      outputSchema: {type: 'object'},
      sideEffect: 'local_write',
      requiredScopes: [ARTIFACT_SCOPE],
      idempotencySupport: false,
      recoverySupport: false,
      requiresPresence: false,
    },
    execute: async (input: unknown, context: ToolContext) => {
      return await service.create(input as CreateArtifactInput);
    },
  };

  return [getTool, listTool, createTool];
}
