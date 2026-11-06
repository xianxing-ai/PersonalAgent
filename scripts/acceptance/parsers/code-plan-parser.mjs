import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
 * 判断代码文件是否为验收规划候选文件
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

  // 2. 代码导出特征：必须明确导出 plan*Acceptance 或 *AcceptancePlan 纯函数
  if (
    /export\s+(?:async\s+)?function\s+plan[A-Za-z0-9_]*Acceptance/i.test(content) ||
    /export\s+(?:async\s+)?function\s+[A-Za-z0-9_]*AcceptancePlan/i.test(content) ||
    /export\s+const\s+plan[A-Za-z0-9_]*Acceptance/i.test(content) ||
    /export\s+const\s+[A-Za-z0-9_]*AcceptancePlan/i.test(content)
  ) {
    return true;
  }

  return false;
}

/**
 * 静态提取 TypeScript 或不可直接 import 的代码文件中的规划属性
 */
function staticallyExtractPlanRecord(content, filePath, repoRoot) {
  const relativePath = path.relative(repoRoot, filePath).split(path.sep).join('/');
  const baseName = path.basename(filePath, path.extname(filePath));

  // 提取 planId / id
  let id = null;
  const idMatch = content.match(/(?:planId|id|capability)\s*[:=]\s*['"]([^'"]+)['"]/);
  if (idMatch) {
    id = idMatch[1];
  } else {
    id = baseName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  }

  // 提取 title
  let title = null;
  const titleMatch = content.match(/(?:title|planTitle|name)\s*[:=]\s*['"]([^'"]+)['"]/);
  if (titleMatch) {
    title = titleMatch[1];
  } else {
    title = id;
  }

  // 提取 closedLoop
  let closedLoop = undefined;
  const closedLoopMatch = content.match(/closedLoop\s*[:=]\s*(true|false)/);
  if (closedLoopMatch) {
    closedLoop = closedLoopMatch[1] === 'true';
  }

  // 提取 status
  let status = null;
  const statusMatch = content.match(/status\s*[:=]\s*['"](unavailable|pending|in_progress|ready|verified)['"]/);
  if (statusMatch) {
    status = statusMatch[1];
  } else if (content.includes("status: 'unavailable'") || content.includes('status: "unavailable"')) {
    status = 'unavailable';
  } else if (content.includes('pending: true')) {
    status = 'unavailable';
  }

  // 提取 reason
  let reason = null;
  const reasonMatch = content.match(/reason\s*[:=]\s*(?:['"]([^'"]+)['"]|([A-Z0-9_]+))/);
  if (reasonMatch) {
    if (reasonMatch[1]) {
      reason = reasonMatch[1];
    } else if (reasonMatch[2]) {
      const constName = reasonMatch[2];
      const constDef = content.match(new RegExp(`(?:const|let|var)\\s+${constName}\\s*=\\s*['"]([^'"]+)['"]`));
      if (constDef) reason = constDef[1];
    }
  }

  // 提取 checklist 或 steps
  let acceptanceSteps = [];
  const checklistMatch = content.match(/(?:checklist|acceptanceSteps|DEFAULT_CHECKLIST)\s*[:=]\s*(?:Object\.freeze\()?\[([\s\S]*?)\]/);
  if (checklistMatch) {
    const rawItems = checklistMatch[1].match(/['"]([^'"]+)['"]/g);
    if (rawItems) {
      acceptanceSteps = rawItems.map((s) => s.slice(1, -1).trim()).filter(Boolean);
    }
  }

  // 提取 evidence
  let evidenceRequirements = [];
  const evidenceMatch = content.match(/(?:evidenceRequirements|evidenceChecks|evidence)\s*[:=]\s*(?:Object\.freeze\()?\[([\s\S]*?)\]/);
  if (evidenceMatch) {
    const rawItems = evidenceMatch[1].match(/['"]([^'"]+)['"]/g);
    if (rawItems) {
      evidenceRequirements = rawItems.map((s) => s.slice(1, -1).trim()).filter(Boolean);
    }
  } else {
    // 检查是否有 PLACEHOLDER_RELATIVE_PATH 或 evidence 文件引用
    const placeholderMatch = content.match(/(?:PLACEHOLDER_RELATIVE_PATH|receiptPath|evidencePath)\s*=\s*['"]([^'"]+)['"]/);
    if (placeholderMatch) {
      evidenceRequirements.push(`外部读回/证据文件：${placeholderMatch[1]}`);
    }
  }

  // 提取环境
  let rawEnvs = [];
  if (content.includes('platform === \'win32\'') || content.includes('win32') || content.includes('windows')) {
    rawEnvs.push('windows_real_machine');
  }
  if (content.includes('huawei_ict_agentarts') || content.includes('agentarts') || content.includes('真云')) {
    rawEnvs.push('huawei_cloud');
  }
  if (content.includes('account') || content.includes('token') || content.includes('凭据')) {
    rawEnvs.push('real_account');
  }

  const envNorm = normalizeEnvironment(rawEnvs.length > 0 ? rawEnvs : null);
  const requiredEnvironments = envNorm ? envNorm.environments : undefined;

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
    pendingItems: [],
  };
}

/**
 * 解析代码规划文件（.plan.mjs, .plan.ts, 等）
 */
export async function parseCodePlan(filePath, repoRoot = '.') {
  const relativePath = path.relative(repoRoot, filePath).split(path.sep).join('/');
  let content = '';

  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      isPlan: false,
      skippedReason: `read_error: ${err.message}`,
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

  // 优先尝试动态加载纯函数执行（仅限受控 .mjs 或 .js）
  let planObj = null;
  const ext = path.extname(filePath);

  if (ext === '.mjs' || ext === '.js') {
    try {
      const fileUrl = pathToFileURL(path.resolve(filePath)).href;
      const mod = await import(fileUrl);

      let targetFn = null;
      for (const [key, val] of Object.entries(mod)) {
        if (
          typeof val === 'function' &&
          (/^plan.*Acceptance/i.test(key) || /AcceptancePlan$/i.test(key) || /^plan/i.test(key))
        ) {
          targetFn = val;
          break;
        }
      }

      if (targetFn) {
        // 调用离线纯函数规划器（绝不传入真实环境参数）
        const res = targetFn({ projectRoot: repoRoot, dryRun: true });
        if (res && typeof res === 'object') {
          const rawEnvs = res.requiredEnvironments || res.environments || res.platform || res.profile;
          const envNorm = normalizeEnvironment(rawEnvs);

          planObj = {
            id: res.id || res.planId || res.capability || path.basename(filePath, ext),
            title: res.title || res.planTitle || res.name || res.planId || path.basename(filePath, ext),
            sourcePath: relativePath,
            planType: 'code_plan_module',
            closedLoop: res.closedLoop,
            status: res.status || (res.pending ? 'unavailable' : undefined),
            requiredEnvironments: envNorm ? envNorm.environments : undefined,
            acceptanceSteps: res.acceptanceSteps || res.checklist || res.steps || [],
            evidenceRequirements: res.evidenceRequirements || res.evidenceChecks || res.evidence || [],
            reason: res.reason || res.notes,
            pendingItems: res.pendingItems || res.pending,
            hasVerifiedEvidence: res.verified === true && !res.mock && res.evidenceLevel === 'verified',
            claimVerified: res.closedLoop === true,
          };
        }
      }
    } catch {
      // 动态导入失败则回退至静态解析
      planObj = null;
    }
  }

  if (!planObj) {
    planObj = staticallyExtractPlanRecord(content, filePath, repoRoot);
  }

  const validation = validateNormalizedRecord(planObj, relativePath);

  if (!validation.ok) {
    return {
      isPlan: true,
      ok: false,
      sourcePath: relativePath,
      title: planObj.title || path.basename(filePath),
      missingFields: validation.missingFields,
      errors: validation.errors,
      rawRecord: planObj,
    };
  }

  return {
    isPlan: true,
    ok: true,
    record: planObj,
  };
}
