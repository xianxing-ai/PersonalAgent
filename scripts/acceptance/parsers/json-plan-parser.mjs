import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEnvironment,
  validateNormalizedRecord,
} from '../types.mjs';

/**
 * 提取 JSON 键名在源文件中的行号
 */
function findJsonKeyLines(rawText) {
  const lineMap = {};
  const lines = rawText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s*["']([^"']+)["']\s*:/);
    if (match) {
      const key = match[1];
      if (!lineMap[key]) {
        lineMap[key] = i + 1;
      }
    }
  }
  return lineMap;
}

/**
 * 解析 JSON 规划文件（附带行号 provenance）
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
      sourcePath: relativePath,
    };
  }

  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {
      isPlan: false,
      skippedReason: 'invalid_json',
      sourcePath: relativePath,
    };
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return {
      isPlan: false,
      skippedReason: 'json_not_object',
      sourcePath: relativePath,
    };
  }

  const baseName = path.basename(filePath).toLowerCase();
  if (baseName === 'pending-acceptance-index.json' || baseName.includes('sample-')) {
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

  const keyLines = findJsonKeyLines(raw);
  const provenance = {};
  const cannotConfirm = {};
  const warnings = [];

  // 1. ID
  const id = (typeof obj.id === 'string' && obj.id.trim().length > 0)
    ? obj.id.trim()
    : (typeof obj.planId === 'string' && obj.planId.trim().length > 0)
      ? obj.planId.trim()
      : undefined;

  if (id) {
    provenance.id = {
      value: id,
      sourcePath: relativePath,
      lineStart: keyLines.id || keyLines.planId || 1,
      lineEnd: keyLines.id || keyLines.planId || 1,
      source: 'json_key',
    };
  } else {
    cannotConfirm.id = {
      sourcePath: relativePath,
      reason: 'missing_id',
      details: 'No explicit id or planId string declared in JSON object. Filename cannot substitute for missing source field.',
    };
  }

  // 2. Title
  const title = (typeof obj.title === 'string' && obj.title.trim().length > 0)
    ? obj.title.trim()
    : (typeof obj.planTitle === 'string' && obj.planTitle.trim().length > 0)
      ? obj.planTitle.trim()
      : (typeof obj.name === 'string' && obj.name.trim().length > 0)
        ? obj.name.trim()
        : undefined;

  if (title) {
    provenance.title = {
      value: title,
      sourcePath: relativePath,
      lineStart: keyLines.title || keyLines.planTitle || keyLines.name || 1,
      lineEnd: keyLines.title || keyLines.planTitle || keyLines.name || 1,
      source: 'json_key',
    };
  } else {
    cannotConfirm.title = {
      sourcePath: relativePath,
      reason: 'missing_title',
      details: 'No explicit title, planTitle, or name string declared in JSON object. Filename cannot substitute for missing source field.',
    };
  }

  // 3. closedLoop
  let closedLoop = undefined;
  if (typeof obj.closedLoop === 'boolean') {
    closedLoop = obj.closedLoop;
    provenance.closedLoop = {
      value: closedLoop,
      sourcePath: relativePath,
      lineStart: keyLines.closedLoop || 1,
      lineEnd: keyLines.closedLoop || 1,
      source: 'json_key',
    };
  } else {
    cannotConfirm.closedLoop = {
      sourcePath: relativePath,
      reason: 'missing_closedLoop',
      details: 'No boolean closedLoop key in JSON object',
    };
  }

  // 4. Status
  const status = (typeof obj.status === 'string' && obj.status.trim().length > 0) ? obj.status.trim() : undefined;
  if (status) {
    provenance.status = {
      value: status,
      sourcePath: relativePath,
      lineStart: keyLines.status || 1,
      lineEnd: keyLines.status || 1,
      source: 'json_key',
    };
  } else {
    cannotConfirm.status = {
      sourcePath: relativePath,
      reason: 'missing_status',
      details: 'No explicit status key declared in JSON object',
    };
  }

  // 5. requiredEnvironments
  const rawEnv = obj.requiredEnvironments || obj.environments;
  const envNorm = normalizeEnvironment(rawEnv);
  const requiredEnvironments = envNorm ? envNorm.environments : undefined;
  if (requiredEnvironments) {
    provenance.requiredEnvironments = {
      value: requiredEnvironments,
      sourcePath: relativePath,
      lineStart: keyLines.requiredEnvironments || keyLines.environments || 1,
      lineEnd: keyLines.requiredEnvironments || keyLines.environments || 1,
      source: 'json_key',
    };
  } else {
    cannotConfirm.requiredEnvironments = {
      sourcePath: relativePath,
      reason: 'missing_environment_declaration',
      details: 'No requiredEnvironments or environments key declared in JSON object',
    };
  }

  // 6. acceptanceSteps
  const acceptanceSteps = obj.acceptanceSteps || obj.checklist || obj.steps;
  if (Array.isArray(acceptanceSteps) && acceptanceSteps.length > 0) {
    provenance.acceptanceSteps = {
      value: acceptanceSteps,
      sourcePath: relativePath,
      lineStart: keyLines.acceptanceSteps || keyLines.checklist || keyLines.steps || 1,
      lineEnd: keyLines.acceptanceSteps || keyLines.checklist || keyLines.steps || 1,
      source: 'json_key',
      itemCount: acceptanceSteps.length,
    };
  } else {
    cannotConfirm.acceptanceSteps = {
      sourcePath: relativePath,
      reason: 'missing_acceptance_steps',
      details: 'No acceptanceSteps, checklist, or steps array found in JSON object',
    };
  }

  // 7. evidenceRequirements
  const evidenceRequirements = obj.evidenceRequirements || obj.evidenceChecks || obj.evidence;
  if (Array.isArray(evidenceRequirements) && evidenceRequirements.length > 0) {
    provenance.evidenceRequirements = {
      value: evidenceRequirements,
      sourcePath: relativePath,
      lineStart: keyLines.evidenceRequirements || keyLines.evidenceChecks || keyLines.evidence || 1,
      lineEnd: keyLines.evidenceRequirements || keyLines.evidenceChecks || keyLines.evidence || 1,
      source: 'json_key',
      itemCount: evidenceRequirements.length,
    };
  } else {
    cannotConfirm.evidenceRequirements = {
      sourcePath: relativePath,
      reason: 'missing_evidence_requirements',
      details: 'No evidenceRequirements or evidenceChecks array found in JSON object',
    };
  }

  // 8. reason & pendingItems
  const reason = obj.reason || obj.notes;
  const pendingItems = obj.pendingItems || obj.pending;
  if (reason) {
    provenance.reason = {
      value: reason,
      sourcePath: relativePath,
      lineStart: keyLines.reason || keyLines.notes || 1,
      lineEnd: keyLines.reason || keyLines.notes || 1,
      source: 'json_key',
    };
  }

  const record = {
    id,
    title,
    sourcePath: relativePath,
    planType: 'json_plan',
    closedLoop,
    status,
    requiredEnvironments,
    acceptanceSteps,
    evidenceRequirements,
    reason,
    pendingItems,
    hasVerifiedEvidence: obj.verified === true && !obj.mock && obj.evidenceLevel === 'verified',
    claimVerified: obj.closedLoop === true,
    provenance,
    cannotConfirm,
    warnings,
  };

  const validation = validateNormalizedRecord(record, relativePath);

  if (!validation.ok) {
    return {
      isPlan: true,
      ok: false,
      sourcePath: relativePath,
      title: record.title || null,
      missingFields: validation.missingFields,
      errors: validation.errors,
      cannotConfirm: validation.cannotConfirm,
      rawRecord: record,
    };
  }

  return {
    isPlan: true,
    ok: true,
    record,
  };
}
