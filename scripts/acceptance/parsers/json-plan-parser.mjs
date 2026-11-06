import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEnvironment,
  validateNormalizedRecord,
} from '../types.mjs';

/**
 * 解析 JSON 规划文件
 */
export function parseJsonPlan(filePath, repoRoot = '.') {
  const relativePath = path.relative(repoRoot, filePath).split(path.sep).join('/');
  let raw = '';

  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      isPlan: false,
      skippedReason: `read_error: ${err.message}`,
    };
  }

  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {
      isPlan: false,
      skippedReason: 'invalid_json',
    };
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return {
      isPlan: false,
      skippedReason: 'json_not_object',
    };
  }

  const baseName = path.basename(filePath).toLowerCase();
  if (baseName === 'pending-acceptance-index.json') {
    return {
      isPlan: false,
      skippedReason: 'tool_output_file',
      sourcePath: relativePath,
    };
  }

  const isCandidate =
    obj.isPlan === true ||
    typeof obj.closedLoop === 'boolean' ||
    Boolean(obj.planId) ||
    baseName.endsWith('.plan.json') ||
    (baseName.includes('acceptance') && baseName.includes('plan'));

  if (!isCandidate) {
    const isAcceptanceRelated =
      baseName.includes('acceptance') ||
      Boolean(obj.evidence_rules) ||
      Boolean(obj.canonical?.includes('acceptance'));

    return {
      isPlan: false,
      skippedReason: isAcceptanceRelated
        ? 'historical_acceptance_matrix_or_receipt_not_a_plan'
        : 'not_acceptance_related',
      sourcePath: relativePath,
    };
  }

  const rawEnv = obj.requiredEnvironments || obj.environments || obj.platform || obj.profile;
  const envNorm = normalizeEnvironment(rawEnv);

  const record = {
    id: obj.id || obj.planId || path.basename(filePath, '.json'),
    title: obj.title || obj.planTitle || obj.name || path.basename(filePath, '.json'),
    sourcePath: relativePath,
    planType: 'json_plan',
    closedLoop: obj.closedLoop,
    status: obj.status || (obj.pending ? 'unavailable' : undefined),
    requiredEnvironments: envNorm ? envNorm.environments : undefined,
    acceptanceSteps: obj.acceptanceSteps || obj.checklist || obj.steps,
    evidenceRequirements: obj.evidenceRequirements || obj.evidenceChecks || obj.evidence,
    reason: obj.reason || obj.notes,
    pendingItems: obj.pendingItems || obj.pending,
    hasVerifiedEvidence: obj.verified === true && !obj.mock && obj.evidenceLevel === 'verified',
    claimVerified: obj.closedLoop === true,
  };

  const validation = validateNormalizedRecord(record, relativePath);

  if (!validation.ok) {
    return {
      isPlan: true,
      ok: false,
      sourcePath: relativePath,
      title: record.title,
      missingFields: validation.missingFields,
      errors: validation.errors,
      rawRecord: record,
    };
  }

  return {
    isPlan: true,
    ok: true,
    record,
  };
}
