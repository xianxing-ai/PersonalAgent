import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEnvironment,
  validateNormalizedRecord,
} from '../types.mjs';

/**
 * 提取 YAML 风格 Front-matter
 */
function parseFrontMatter(content) {
  if (!content.startsWith('---')) {
    return { frontMatter: null, body: content };
  }

  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontMatter: null, body: content };
  }

  const rawFm = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 4);

  const fm = {};
  const lines = rawFm.split('\n');
  let currentKey = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 检查列表项 "- item"
    if (trimmed.startsWith('-') && currentKey) {
      const val = trimmed.replace(/^-\s*/, '').trim();
      if (!Array.isArray(fm[currentKey])) {
        fm[currentKey] = [];
      }
      fm[currentKey].push(val);
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const rawVal = trimmed.slice(colonIdx + 1).trim();

      if (rawVal.length === 0) {
        currentKey = key;
        fm[key] = [];
      } else {
        currentKey = key;
        let parsedVal = rawVal;
        if (rawVal === 'true' || rawVal === 'false') {
          parsedVal = rawVal === 'true';
        } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
          try {
            parsedVal = JSON.parse(rawVal);
          } catch {
            parsedVal = rawVal.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
          }
        } else if (
          (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
          (rawVal.startsWith("'") && rawVal.endsWith("'"))
        ) {
          parsedVal = rawVal.slice(1, -1);
        }
        fm[key] = parsedVal;
      }
    }
  }

  return { frontMatter: fm, body };
}

/**
 * 判断是否为验收规划候选文件
 */
export function isMarkdownPlanCandidate(filePath, content) {
  const baseName = path.basename(filePath).toLowerCase();

  // 排除生成的总表自身与本工具设计说明（文件名含 acceptance+plan 但不是验收规划）
  if (
    baseName === 'pending-acceptance-by-env.md' ||
    baseName === 'pending-acceptance-index.json' ||
    baseName.startsWith('acceptance-plan-index-') ||
    baseName === 'acceptance-plan-index-20261107.md'
  ) {
    return false;
  }

  // 1. 文件名包含 acceptance 与 plan（无论先后与分隔符）
  const hasAcceptance = baseName.includes('acceptance');
  const hasPlan = baseName.includes('plan');
  if (hasAcceptance && hasPlan) {
    return true;
  }

  // 2. Front-matter 声明
  if (content.startsWith('---')) {
    const { frontMatter } = parseFrontMatter(content);
    if (
      frontMatter &&
      (frontMatter.isPlan === true ||
        frontMatter.plan === true ||
        frontMatter.kind === 'acceptance_plan' ||
        frontMatter.type === 'acceptance_plan')
    ) {
      return true;
    }
  }

  // 3. 标题或正文显式声明为验收规划
  const lines = content.split('\n', 40);
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('#') &&
      (trimmed.includes('验收规划') ||
        trimmed.includes('待验收规划') ||
        /acceptance\s+plan/i.test(trimmed))
    ) {
      return true;
    }
    if (
      trimmed.includes('This is an acceptance plan') ||
      trimmed.includes('本文件为验收规划')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * 解析 Markdown 列表项与章节
 */
function extractSections(body) {
  const sections = {};
  let currentSection = null;

  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // 二级或三级标题
    const headingMatch = trimmed.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      const headingText = headingMatch[1].trim();
      currentSection = headingText;
      if (!sections[currentSection]) {
        sections[currentSection] = [];
      }
      continue;
    }

    // 列表项（有序 1. 或无序 - / * 或复选框 - [ ]）
    const itemMatch = trimmed.match(/^(?:(?:\d+\.|\-|\*|(?:\-\s*\[[ xX]?\]))\s+)(.+)$/);
    if (itemMatch && currentSection) {
      sections[currentSection].push(itemMatch[1].trim());
    }
  }

  return sections;
}

/**
 * 从文本行中提取元数据字段（如 - 状态: unavailable）
 */
function extractMetadataLines(content) {
  const metadata = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('-') && !trimmed.startsWith('*')) continue;

    const match = trimmed.match(/^[-*]\s*([^:：]+)[:：]\s*(.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase();
      const val = match[2].trim();

      if (key === 'id' || key === 'planid') {
        metadata.id = val;
      } else if (key === 'status' || key === '状态') {
        metadata.status = val;
      } else if (key === 'closedloop' || key === 'closed_loop' || key === '闭环') {
        if (/^(true|是|yes|已闭环)$/i.test(val)) metadata.closedLoop = true;
        else if (/^(false|否|no|未闭环|待验收)$/i.test(val)) metadata.closedLoop = false;
      } else if (
        key === 'requiredenvironments' ||
        key === 'environments' ||
        key === '环境' ||
        key === '依赖环境' ||
        key === '运行环境'
      ) {
        metadata.requiredEnvironments = val;
      } else if (key === 'reason' || key === '原因' || key === '未闭环原因') {
        metadata.reason = val;
      }
    }
  }

  return metadata;
}

/**
 * 解析 Markdown 规划文件
 */
export function parseMarkdownPlan(filePath, repoRoot = '.') {
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

  // 校验是否为规划文件
  if (!isMarkdownPlanCandidate(filePath, content)) {
    const baseName = path.basename(filePath).toLowerCase();
    const isAcceptanceRelated =
      baseName.includes('acceptance') ||
      baseName.includes('验收') ||
      content.includes('验收') ||
      content.includes('acceptance');

    return {
      isPlan: false,
      skippedReason: isAcceptanceRelated
        ? 'historical_acceptance_evidence_or_receipt_not_a_plan'
        : 'not_acceptance_related',
      sourcePath: relativePath,
    };
  }

  // 开始解析规划字段
  const { frontMatter, body } = parseFrontMatter(content);
  const metadataLines = extractMetadataLines(content);
  const sections = extractSections(body);

  // 1. Title
  let title = frontMatter?.title || metadataLines.title;
  if (!title) {
    const h1Match = body.match(/^#\s+(.+)$/m);
    if (h1Match) {
      title = h1Match[1].trim();
    }
  }

  // 2. ID
  let id = frontMatter?.id || frontMatter?.planId || metadataLines.id;
  if (!id) {
    // 尝试从文件名推导 id
    const baseWithoutExt = path.basename(filePath, path.extname(filePath));
    id = baseWithoutExt.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  }

  // 3. closedLoop
  let closedLoop = undefined;
  if (typeof frontMatter?.closedLoop === 'boolean') {
    closedLoop = frontMatter.closedLoop;
  } else if (typeof frontMatter?.closed_loop === 'boolean') {
    closedLoop = frontMatter.closed_loop;
  } else if (typeof metadataLines.closedLoop === 'boolean') {
    closedLoop = metadataLines.closedLoop;
  }

  // 4. status
  const status = frontMatter?.status || metadataLines.status;

  // 5. requiredEnvironments
  const rawEnv =
    frontMatter?.requiredEnvironments ||
    frontMatter?.environments ||
    metadataLines.requiredEnvironments;
  const envNorm = normalizeEnvironment(rawEnv);
  const requiredEnvironments = envNorm ? envNorm.environments : undefined;

  // 6. acceptanceSteps
  let acceptanceSteps = frontMatter?.acceptanceSteps || frontMatter?.steps;
  if (!Array.isArray(acceptanceSteps) || acceptanceSteps.length === 0) {
    for (const [secTitle, items] of Object.entries(sections)) {
      if (/^(验收步骤|步骤|执行步骤|Checklist|Steps|流程)/i.test(secTitle)) {
        acceptanceSteps = items;
        break;
      }
    }
  }

  // 7. evidenceRequirements
  let evidenceRequirements =
    frontMatter?.evidenceRequirements || frontMatter?.evidence;
  if (!Array.isArray(evidenceRequirements) || evidenceRequirements.length === 0) {
    for (const [secTitle, items] of Object.entries(sections)) {
      if (/^(证据要求|验收证据|证据|Evidence Requirements|Evidence)/i.test(secTitle)) {
        evidenceRequirements = items;
        break;
      }
    }
  }

  // 8. reason / pendingItems
  let reason = frontMatter?.reason || metadataLines.reason;
  let pendingItems = frontMatter?.pendingItems || frontMatter?.pending;
  if (!Array.isArray(pendingItems) || pendingItems.length === 0) {
    for (const [secTitle, items] of Object.entries(sections)) {
      if (/^(挂起项|待验收项|待办|未闭环原因|Pending Items|Pending)/i.test(secTitle)) {
        pendingItems = items;
        if (!reason && items.length > 0) {
          reason = items.join('；');
        }
        break;
      }
    }
  }

  const record = {
    id,
    title: title || path.basename(filePath),
    sourcePath: relativePath,
    planType: 'markdown_plan',
    closedLoop,
    status,
    requiredEnvironments,
    acceptanceSteps,
    evidenceRequirements,
    reason,
    pendingItems,
    hasVerifiedEvidence: frontMatter?.hasVerifiedEvidence === true,
    claimVerified: closedLoop === true,
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
