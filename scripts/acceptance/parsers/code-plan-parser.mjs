import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEnvironment,
  validateNormalizedRecord,
} from '../types.mjs';

const TOOL_SELF_FILES = new Set([
  'code-plan-parser.mjs',
  'markdown-plan-parser.mjs',
  'json-plan-parser.mjs',
  'scanner.mjs',
  'formatter.mjs',
  'types.mjs',
  'build-pending-acceptance-index.mjs',
]);

/**
 * 判断代码文件是否为验收规划候选文件（纯文件名与静态导出特征）
 */
export function isCodePlanCandidate(filePath, content = '') {
  const baseName = path.basename(filePath).toLowerCase();

  // 排除扫描工具自身实现文件
  if (TOOL_SELF_FILES.has(baseName)) {
    return false;
  }

  // 排除测试和声明文件
  if (
    baseName.includes('.test.') ||
    baseName.includes('.spec.') ||
    baseName.endsWith('.d.ts')
  ) {
    return false;
  }

  // 1. 文件名特征
  if (baseName.endsWith('.plan.mjs') || baseName.endsWith('.plan.ts') || baseName.endsWith('.plan.js')) {
    return true;
  }
  if (baseName.includes('acceptance') && baseName.includes('plan')) {
    return true;
  }

  // 2. 代码导出特征：必须明确导出 plan*Acceptance 或 *AcceptancePlan 纯函数/对象
  if (
    /export\s+(?:async\s+)?function\s+plan[A-Za-z0-9_]*Acceptance/i.test(content) ||
    /export\s+(?:async\s+)?function\s+[A-Za-z0-9_]*AcceptancePlan/i.test(content) ||
    /export\s+const\s+plan[A-Za-z0-9_]*Acceptance/i.test(content) ||
    /export\s+const\s+[A-Za-z0-9_]*AcceptancePlan/i.test(content) ||
    /export\s+(?:async\s+)?function\s+plan[A-Za-z0-9_]+/i.test(content) ||
    /export\s+const\s+plan[A-Za-z0-9_]+/i.test(content)
  ) {
    return true;
  }

  return false;
}

/**
 * 从多行文本中提取静态字符串字面量数组（支持单引号、双引号、反引号）
 */
function extractStringLiteralsFromArrayText(rawBlock) {
  const items = [];
  const regex = /(?:['"`])([^'"`\\]*(?:\\.[^'"`\\]*)*)(?:['"`])/g;
  let match;
  while ((match = regex.exec(rawBlock)) !== null) {
    const val = match[1].trim();
    if (val) {
      items.push(val);
    }
  }
  return items;
}

/**
 * 纯静态文本提取代码规划文件字段（绝不 import/require/eval/vm 执行任何代码）
 */
function staticallyExtractPlanRecord(content, filePath, repoRoot) {
  const relativePath = path.relative(repoRoot, filePath).split(path.sep).join('/');
  const lines = content.split('\n');

  const provenance = {};
  const cannotConfirm = {};
  const warnings = [];

  // 1. 提取 ID / Capability
  let id = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const capMatch = line.match(/(?:export\s+const\s+[A-Z0-9_]*CAPABILITY\s*=\s*|const\s+PLAN_ID\s*=\s*|(?:planId|id|capability)\s*[:=]\s*)['"]([^'"]+)['"]/);
    if (capMatch) {
      id = capMatch[1];
      provenance.id = {
        value: id,
        sourcePath: relativePath,
        lineStart: i + 1,
        lineEnd: i + 1,
        source: 'ts_code_literal',
        raw: line.trim(),
      };
      break;
    }
  }
  if (!id) {
    cannotConfirm.id = {
      sourcePath: relativePath,
      reason: 'missing_id',
      details: 'No explicit id/planId/capability string literal found in code. Filename cannot substitute for missing source field.',
    };
  }

  // 2. 提取 Title
  let title = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const titleMatch = line.match(/(?:const\s+PLAN_TITLE\s*=\s*|(?:title|planTitle|name)\s*[:=]\s*)['"]([^'"]+)['"]/);
    if (titleMatch) {
      title = titleMatch[1];
      provenance.title = {
        value: title,
        sourcePath: relativePath,
        lineStart: i + 1,
        lineEnd: i + 1,
        source: 'ts_code_literal',
        raw: line.trim(),
      };
      break;
    }
  }
  if (!title) {
    cannotConfirm.title = {
      sourcePath: relativePath,
      reason: 'missing_title',
      details: 'No explicit title/planTitle string literal found in code. ID or filename cannot substitute for missing source field.',
    };
  }

  // 3. 提取 closedLoop
  // 查找文件中所有的 closedLoop 出现行（排除纯类型定义行，如 readonly closedLoop: boolean）
  const closedLoopOccurrences = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跳过纯类型定义
    if (/readonly\s+closedLoop\s*:\s*boolean/i.test(line) || /closedLoop\s*:\s*boolean/i.test(line)) {
      continue;
    }
    const match = line.match(/closedLoop\s*[:=]\s*([^,\n;]+)/);
    if (match) {
      const rawVal = match[1].trim();
      closedLoopOccurrences.push({
        line: i + 1,
        rawVal,
        fullLine: line.trim(),
      });
    }
  }

  let closedLoop = undefined;
  if (closedLoopOccurrences.length === 0) {
    cannotConfirm.closedLoop = {
      sourcePath: relativePath,
      reason: 'missing_closedLoop',
      details: 'No closedLoop property found in code',
    };
  } else if (closedLoopOccurrences.length === 1) {
    const occ = closedLoopOccurrences[0];
    if (occ.rawVal === 'false') {
      closedLoop = false;
      provenance.closedLoop = {
        value: false,
        sourcePath: relativePath,
        lineStart: occ.line,
        lineEnd: occ.line,
        source: 'ts_code_literal',
        raw: occ.fullLine,
      };
    } else if (occ.rawVal === 'true') {
      closedLoop = true;
      provenance.closedLoop = {
        value: true,
        sourcePath: relativePath,
        lineStart: occ.line,
        lineEnd: occ.line,
        source: 'ts_code_literal',
        raw: occ.fullLine,
      };
    } else {
      // 动态表达式（如 closedLoop: isClosedLoop 或 closedLoop: pending.length === 0）
      cannotConfirm.closedLoop = {
        sourcePath: relativePath,
        reason: 'ambiguous_closedLoop',
        lineStart: occ.line,
        lineEnd: occ.line,
        details: `Dynamic expression for closedLoop detected: "${occ.rawVal}". Static analysis cannot evaluate runtime boolean expression.`,
        occurrences: closedLoopOccurrences,
      };
    }
  } else {
    // 存在多个条件分支返回不同 closedLoop
    // 必须严格报错 ambiguous_closedLoop，绝不能盲猜默认分支，更不能从出现 false 盲推或将 true 改 false
    cannotConfirm.closedLoop = {
      sourcePath: relativePath,
      reason: 'ambiguous_closedLoop',
      details: `Multiple conditional branches (${closedLoopOccurrences.length}) assigning closedLoop detected in code. Static analysis cannot determine default branch without runtime execution.`,
      occurrences: closedLoopOccurrences,
    };
  }

  // 4. 提取 status
  let status = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跳过纯类型定义
    if (/status\s*:\s*['"]?[a-z_]+['"]?\s*\|/i.test(line)) continue;
    const stMatch = line.match(/status\s*[:=]\s*['"](unavailable|pending|in_progress|ready|verified)['"]/);
    if (stMatch) {
      status = stMatch[1];
      provenance.status = {
        value: status,
        sourcePath: relativePath,
        lineStart: i + 1,
        lineEnd: i + 1,
        source: 'ts_code_literal',
        raw: line.trim(),
      };
      break;
    }
  }
  if (!status) {
    cannotConfirm.status = {
      sourcePath: relativePath,
      reason: 'missing_status',
      details: 'No explicit status literal found in code',
    };
  }

  // 5. 提取 reason
  let reason = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rMatch = line.match(/(?:export\s+const\s+[A-Z0-9_]*PENDING_REASON\s*=\s*|reason\s*[:=]\s*)['"]([^'"]+)['"]/);
    if (rMatch) {
      reason = rMatch[1];
      provenance.reason = {
        value: reason,
        sourcePath: relativePath,
        lineStart: i + 1,
        lineEnd: i + 1,
        source: 'ts_code_literal',
        raw: line.trim(),
      };
      break;
    }
  }

  // 6. 提取 requiredEnvironments（严禁全文关键词猜测环境，只读明确字面量数组）
  let requiredEnvironments = undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const envMatch = line.match(/(?:export\s+const\s+REQUIRED_ENVIRONMENTS\s*=\s*|(?:requiredEnvironments|environments)\s*[:=]\s*)\[([\s\S]*?)\]/);
    if (envMatch) {
      const rawItems = extractStringLiteralsFromArrayText(envMatch[1]);
      const norm = normalizeEnvironment(rawItems);
      if (norm && norm.environments.length > 0) {
        requiredEnvironments = norm.environments;
        provenance.requiredEnvironments = {
          value: requiredEnvironments,
          sourcePath: relativePath,
          lineStart: i + 1,
          lineEnd: i + 1,
          source: 'ts_code_literal',
          raw: line.trim(),
        };
        break;
      }
    }
  }
  if (!requiredEnvironments) {
    // 检查是否跨多行声明了 REQUIRED_ENVIRONMENTS 数组
    const multiMatch = content.match(/(?:export\s+const\s+REQUIRED_ENVIRONMENTS\s*=\s*|(?:requiredEnvironments|environments)\s*[:=]\s*)\[([\s\S]*?)\]/);
    if (multiMatch) {
      const rawItems = extractStringLiteralsFromArrayText(multiMatch[1]);
      const norm = normalizeEnvironment(rawItems);
      if (norm && norm.environments.length > 0) {
        requiredEnvironments = norm.environments;
        provenance.requiredEnvironments = {
          value: requiredEnvironments,
          sourcePath: relativePath,
          source: 'ts_code_multiline_literal',
          raw: multiMatch[0].slice(0, 100),
        };
      }
    }
  }
  if (!requiredEnvironments) {
    cannotConfirm.requiredEnvironments = {
      sourcePath: relativePath,
      reason: 'missing_environment_declaration',
      details: 'No explicit requiredEnvironments literal array found in code. Context keywords (such as profile/token/windows) are strictly prohibited from inferring required environments.',
    };
  }

  // 7. 提取 acceptanceSteps（严禁借用 pending 填补步骤）
  let acceptanceSteps = undefined;
  const stepsRegex = /(?:const\s+DEFAULT_CHECKLIST\s*=\s*|const\s+ACCEPTANCE_STEPS\s*=\s*|(?:acceptanceSteps|checklist|DEFAULT_STEPS)\s*[:=]\s*)(?:Object\.freeze\()?\[([\s\S]*?)\]/g;
  let stepsMatch;
  while ((stepsMatch = stepsRegex.exec(content)) !== null) {
    const rawItems = extractStringLiteralsFromArrayText(stepsMatch[1]);
    if (rawItems.length > 0) {
      acceptanceSteps = rawItems;
      provenance.acceptanceSteps = {
        value: acceptanceSteps,
        sourcePath: relativePath,
        source: 'ts_code_checklist_literal',
        itemCount: acceptanceSteps.length,
      };
      break;
    }
  }
  if (!acceptanceSteps) {
    cannotConfirm.acceptanceSteps = {
      sourcePath: relativePath,
      reason: 'missing_acceptance_steps',
      details: 'No explicit checklist/acceptanceSteps array literal found in code. Borrowing pending descriptions to fake steps is strictly prohibited.',
    };
  }

  // 8. 提取 evidenceRequirements（严禁借用 pending 填补证据）
  let evidenceRequirements = undefined;
  const evRegex = /(?:const\s+EVIDENCE_REQUIREMENTS\s*=\s*|const\s+EVIDENCE_CHECKS\s*=\s*|(?:evidenceRequirements|evidenceChecks|DEFAULT_EVIDENCE)\s*[:=]\s*)(?:Object\.freeze\()?\[([\s\S]*?)\]/g;
  let evMatch;
  while ((evMatch = evRegex.exec(content)) !== null) {
    const rawItems = extractStringLiteralsFromArrayText(evMatch[1]);
    if (rawItems.length > 0) {
      evidenceRequirements = rawItems;
      provenance.evidenceRequirements = {
        value: evidenceRequirements,
        sourcePath: relativePath,
        source: 'ts_code_evidence_literal',
        itemCount: evidenceRequirements.length,
      };
      break;
    }
  }
  if (!evidenceRequirements) {
    cannotConfirm.evidenceRequirements = {
      sourcePath: relativePath,
      reason: 'missing_evidence_requirements',
      details: 'No explicit evidenceRequirements or evidenceChecks array literal found in code. Borrowing pending items or path strings is strictly prohibited.',
    };
  }

  // 9. 提取 pendingItems
  let pendingItems = [];
  const pendRegex = /(?:DEFAULT_[A-Z0-9_]*PENDING_ITEMS\s*=\s*|pendingItems\s*[:=]\s*)(?:Object\.freeze\()?\[([\s\S]*?)\]/g;
  let pendMatch;
  while ((pendMatch = pendRegex.exec(content)) !== null) {
    const rawItems = extractStringLiteralsFromArrayText(pendMatch[1]);
    if (rawItems.length > 0) {
      pendingItems = rawItems;
      provenance.pendingItems = {
        value: pendingItems,
        sourcePath: relativePath,
        source: 'ts_code_pending_literal',
        itemCount: pendingItems.length,
      };
      break;
    }
  }

  return {
    id,
    title,
    sourcePath: relativePath,
    planType: 'code_plan_static',
    closedLoop,
    status,
    requiredEnvironments,
    acceptanceSteps,
    evidenceRequirements,
    reason,
    pendingItems,
    provenance,
    cannotConfirm,
    warnings,
  };
}

/**
 * 解析代码规划文件（纯文本静态分析，绝不动态 import/require/eval/vm 执行任何文件）
 */
export function parseCodePlan(filePath, repoRoot = '.') {
  const relativePath = path.relative(repoRoot, filePath).split(path.sep).join('/');
  let content = '';

  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      isPlan: false,
      skippedReason: `read_error: ${err.message}`,
      sourcePath: relativePath,
    };
  }

  if (!isCodePlanCandidate(filePath, content)) {
    const baseName = path.basename(filePath).toLowerCase();
    const isAcceptanceRelated =
      baseName.includes('acceptance') ||
      content.includes('acceptance') ||
      content.includes('验收');

    return {
      isPlan: false,
      skippedReason: isAcceptanceRelated
        ? 'historical_acceptance_code_not_a_plan'
        : 'not_acceptance_related',
      sourcePath: relativePath,
    };
  }

  // 纯静态文本提取
  const planObj = staticallyExtractPlanRecord(content, filePath, repoRoot);
  const validation = validateNormalizedRecord(planObj, relativePath);

  if (!validation.ok) {
    return {
      isPlan: true,
      ok: false,
      sourcePath: relativePath,
      title: planObj.title || null,
      missingFields: validation.missingFields,
      errors: validation.errors,
      cannotConfirm: validation.cannotConfirm,
      rawRecord: planObj,
    };
  }

  return {
    isPlan: true,
    ok: true,
    record: planObj,
  };
}
