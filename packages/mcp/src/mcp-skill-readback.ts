import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';

export const MCP_FILESYSTEM_PACKAGE_VERSION = '2026.8.31';

export const PENDING_ACCEPTANCE_ITEMS = [
  'real-mcp',
  'real-skill',
  'agentarts-deployment',
  'target-system',
] as const;

export const PENDING_ACCEPTANCE_REASON = '待真机/真云验收' as const;

export interface McpReadResult {
  path: string;
  text: string;
  contentDigest: string;
  source: 'mcp';
  serverVersion: typeof MCP_FILESYSTEM_PACKAGE_VERSION;
}

export interface SkillReadbackReceipt {
  state: 'confirmed' | 'pending' | 'unknown';
  selectionRef?: string;
  sourceRef?: string;
  contentDigest?: string;
  summaryDigest?: string;
  resultSummary?: string;
  content?: string;
  byteLength?: number;
  truncated?: boolean;
  evidenceRefs?: readonly string[];
  sources?: readonly {path: string; contentDigest: string}[];
}

export interface McpSkillReadbackAcceptanceInput {
  platform?: string;
  hasRealCloud?: boolean;
  hasDeployment?: boolean;
  hasTargetSystem?: boolean;
  environment?: Record<string, unknown>;
  receipts?: unknown[];
}

export interface McpSkillReadbackAcceptancePlan {
  closedLoop: false;
  pending: readonly ['real-mcp', 'real-skill', 'agentarts-deployment', 'target-system'];
  reason: typeof PENDING_ACCEPTANCE_REASON;
  platform: string;
  offlineVerified: boolean;
  pendingCount: number;
}

const SENSITIVE_SEGMENT = /^(?:\.env|\.git|\.codex|\.agents|\.ssh|\.aws|\.azure|\.kube|\.npmrc|credentials|secrets?|passwords?|tokens?|id_(?:rsa|ed25519|ecdsa))(?:\..*)?$/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY(?: BLOCK)?-----/;
const MAX_READ_BYTES = 256 * 1024;

/**
 * Validates offline shape and safety constraints of an MCP readback receipt.
 * Enforces source==='mcp', contentDigest 64hex, serverVersion, path text surface (.txt/.md), and sensitive path prohibition.
 * Throws fixed ProtocolError codes: INVALID_ARGUMENT or PROTOCOL_MISMATCH.
 */
export function assertMcpReadbackReceipt(input: unknown): McpReadResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'MCP readback receipt must be an object');
  }

  const raw = input as Record<string, unknown>;

  if (typeof raw.path !== 'string' || !raw.path) {
    throw new ProtocolError('INVALID_ARGUMENT', 'MCP readback receipt path must be a non-empty string');
  }

  const path = raw.path;

  // Path surface check: relative only, no Windows separator, no URI/drive colon, approved text surface only (.txt or .md)
  if (
    isAbsolute(path) ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes(':')
  ) {
    throw new ProtocolError('INVALID_ARGUMENT', 'MCP path is outside the approved text surface');
  }

  const parts = path.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || SENSITIVE_SEGMENT.test(part)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'MCP path is outside the approved text surface or touches sensitive paths');
    }
  }

  if (!/\.(?:txt|md)$/i.test(path)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'MCP path is outside the approved text surface (must be .txt or .md)');
  }

  if (typeof raw.contentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(raw.contentDigest)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'MCP readback receipt contentDigest must be a 64-character lowercase hex string');
  }

  if (raw.source !== 'mcp') {
    throw new ProtocolError('PROTOCOL_MISMATCH', 'MCP readback receipt source must be "mcp"');
  }

  if (raw.serverVersion !== MCP_FILESYSTEM_PACKAGE_VERSION) {
    throw new ProtocolError('PROTOCOL_MISMATCH', `MCP readback receipt serverVersion must be "${MCP_FILESYSTEM_PACKAGE_VERSION}"`);
  }

  if (raw.text !== undefined) {
    if (typeof raw.text !== 'string') {
      throw new ProtocolError('INVALID_ARGUMENT', 'MCP readback receipt text must be a string');
    }
    if (Buffer.byteLength(raw.text) > MAX_READ_BYTES) {
      throw new ProtocolError('INVALID_ARGUMENT', 'MCP readback receipt text exceeds 256 KiB size limit');
    }
    if (PRIVATE_KEY_PATTERN.test(raw.text)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'MCP readback receipt contains private key content');
    }
    const digest = createHash('sha256').update(raw.text).digest('hex');
    if (digest !== raw.contentDigest) {
      throw new ProtocolError('INVALID_ARGUMENT', 'MCP readback receipt contentDigest does not match text content');
    }
  }

  return raw as unknown as McpReadResult;
}

/**
 * Validates minimal shape and integrity constraints of a Skill readback receipt.
 * Ensures state is valid ('confirmed' | 'pending' | 'unknown') and strictly prohibits
 * claiming confirmed state without real execution evidence or with mock/synthetic markers.
 */
export function assertSkillReadbackReceipt(input: unknown): SkillReadbackReceipt {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Skill readback receipt must be an object');
  }

  const raw = input as Record<string, unknown>;

  if (typeof raw.state !== 'string' || !['confirmed', 'pending', 'unknown'].includes(raw.state)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Skill readback receipt state must be "confirmed", "pending", or "unknown"');
  }

  // Check for fake/mock/synthetic markers
  const isMock =
    raw.mock === true ||
    raw.synthetic === true ||
    raw.fake === true ||
    raw.isFake === true ||
    raw.verification === 'mock' ||
    raw.verification === 'synthetic' ||
    raw.isMock === true;

  if (raw.state === 'confirmed') {
    if (isMock) {
      throw new ProtocolError('UNAUTHORIZED', 'Mock or synthetic execution cannot be claimed as confirmed skill receipt');
    }

    // Must have verified execution evidence (either valid sources array or verified contentDigest)
    let hasExecutionProof = false;

    if (raw.sources !== undefined) {
      if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Confirmed skill readback receipt sources must be a non-empty array');
      }
      for (const item of raw.sources) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt source must be an object');
        }
        const sourceItem = item as Record<string, unknown>;
        if (typeof sourceItem.path !== 'string' || !sourceItem.path) {
          throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt source path must be a non-empty string');
        }
        if (
          isAbsolute(sourceItem.path) ||
          sourceItem.path.startsWith('/') ||
          sourceItem.path.includes('\\') ||
          sourceItem.path.includes(':')
        ) {
          throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt source path must be relative');
        }
        const parts = sourceItem.path.split('/');
        for (const part of parts) {
          if (!part || part === '.' || part === '..' || SENSITIVE_SEGMENT.test(part)) {
            throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt source path is outside approved text surface or touches sensitive paths');
          }
        }
        if (!/\.(?:txt|md)$/i.test(sourceItem.path)) {
          throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt source path must be .txt or .md');
        }
        if (typeof sourceItem.contentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(sourceItem.contentDigest)) {
          throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt source contentDigest must be a 64-character lowercase hex string');
        }
      }
      hasExecutionProof = true;
    }

    if (raw.contentDigest !== undefined) {
      if (typeof raw.contentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(raw.contentDigest)) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Skill readback receipt contentDigest must be a 64-character lowercase hex string');
      }
      hasExecutionProof = true;
    }

    if (!hasExecutionProof) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Confirmed skill readback receipt lacks real execution proof (requires contentDigest or sources)');
    }

    if (raw.summaryDigest !== undefined) {
      if (typeof raw.summaryDigest !== 'string' || !/^[a-f0-9]{64}$/.test(raw.summaryDigest)) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt summaryDigest must be a 64-character lowercase hex string');
      }
    }

    if (raw.resultSummary !== undefined && typeof raw.resultSummary !== 'string') {
      throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt resultSummary must be a string');
    }

    if (raw.content !== undefined && typeof raw.content !== 'string') {
      throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt content must be a string');
    }

    if (raw.selectionRef !== undefined && (typeof raw.selectionRef !== 'string' || !raw.selectionRef)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt selectionRef must be a non-empty string');
    }

    if (raw.sourceRef !== undefined && (typeof raw.sourceRef !== 'string' || !raw.sourceRef)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt sourceRef must be a non-empty string');
    }

    if (raw.evidenceRefs !== undefined) {
      if (!Array.isArray(raw.evidenceRefs) || raw.evidenceRefs.some(ref => typeof ref !== 'string' || !ref)) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Skill receipt evidenceRefs must be an array of non-empty strings');
      }
    }
  } else {
    // state is 'pending' or 'unknown'
    const hasAnyField =
      raw.selectionRef !== undefined ||
      raw.sourceRef !== undefined ||
      raw.evidenceRefs !== undefined ||
      raw.sources !== undefined ||
      raw.resultSummary !== undefined ||
      raw.contentDigest !== undefined;
    if (!hasAnyField) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Skill readback receipt lacks identifying fields');
    }
  }

  return raw as unknown as SkillReadbackReceipt;
}

/**
 * Plans acceptance roadmap for MCP/Skill readback verification.
 * In offline/local environments lacking verified cloud/deployment evidence,
 * always returns closedLoop: false with pending items and fixed reason.
 * NEVER returns closedLoop: true.
 */
export function planMcpSkillReadbackAcceptance(
  input?: McpSkillReadbackAcceptanceInput,
): McpSkillReadbackAcceptancePlan {
  const platform = input?.platform ?? process.platform;
  return {
    closedLoop: false,
    pending: PENDING_ACCEPTANCE_ITEMS,
    reason: PENDING_ACCEPTANCE_REASON,
    platform,
    offlineVerified: true,
    pendingCount: PENDING_ACCEPTANCE_ITEMS.length,
  };
}

/**
 * Normalizes Fake / fixture test receipts into production McpReadResult shape.
 * Automatically computes contentDigest from text/content if omitted, sets fixed
 * source and serverVersion, and validates via assertMcpReadbackReceipt.
 */
export function normalizeMcpReadResult(input: unknown): McpReadResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Cannot normalize invalid MCP receipt input');
  }

  const raw = input as Record<string, unknown>;
  const path = typeof raw.path === 'string' ? raw.path : '';
  const text = typeof raw.text === 'string' ? raw.text : typeof raw.content === 'string' ? raw.content : '';
  const contentDigest =
    typeof raw.contentDigest === 'string' && /^[a-f0-9]{64}$/.test(raw.contentDigest)
      ? raw.contentDigest
      : createHash('sha256').update(text).digest('hex');

  const normalized: McpReadResult = {
    path,
    text,
    contentDigest,
    source: 'mcp',
    serverVersion: MCP_FILESYSTEM_PACKAGE_VERSION,
  };

  assertMcpReadbackReceipt(normalized);
  return normalized;
}
