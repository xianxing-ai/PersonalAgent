import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEnvironment,
  validateNormalizedRecord,
} from '../types.mjs';

/**
 * 提取 YAML 风格 Front-matter（包含行号记录）
 */
function parseFrontMatterWithLines(content) {
  if (!content.startsWith('---')) {
    return { frontMatter: null, body: content, fmLineCount: 0 };
  }

  const lines = content.split('\n');
  if (lines[0].trim() !== '---') {
    return { frontMatter: null, body: content, fmLineCount: 0 };
  }

  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endLine = i;
      break;
    }
  }

  if (endLine === -1) {
    return { frontMatter: null, body: content, fmLineCount: 0 };
  }

  const fm = {};
  const fmProvenance = {};
  let currentKey = null;

  for (let i = 1; i < endLine; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 检查列表项 "- item"
    if (trimmed.startsWith('-') && currentKey) {
      const val = trimmed.replace(/^-\s*/, '').trim();
      if (!Array.isArray(fm[currentKey])) {
        fm[currentKey] = [];
      }
      fm[currentKey].push(val);
      if (fmProvenance[currentKey]) {
        fmProvenance[currentKey].lineEnd = lineNum;
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const rawVal = trimmed.slice(colonIdx + 1).trim();

      if (rawVal.length === 0) {
        currentKey = key;
        fm[key] = [];
        fmProvenance[key] = { lineStart: lineNum, lineEnd: lineNum, raw: line };
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
        fmProvenance[key] = { lineStart: lineNum, lineEnd: lineNum, raw: line };
      }
    }
  }

  const body = lines.slice(endLine + 1).join('\n');
  return { frontMatter: fm, fmProvenance, body, fmLineCount: endLine + 1 };
}

/**
 * 判断是否为验收规划候选文件（文件名特征、FrontMatter或显式规划标题）
 */
export function isMarkdownPlanCandidate(filePath, content) {
  const baseName = path.basename(filePath).toLowerCase();

  // 排除生成的总表自身与本工具设计说明
  if (
    baseName === 'pending-acceptance-by-env.md' ||
    baseName === 'pending-acceptance-index.json' ||
    baseName.startsWith('acceptance-plan-index-') ||
    baseName === 'acceptance-plan-index-20261107.md'
  ) {
    return false;
  }

  // 1. 文件名特征
  const hasAcceptance = baseName.includes('acceptance');
  const hasPlan = baseName.includes('plan');
  if (hasAcceptance && hasPlan) {
    return true;
  }

  // 1.1 文件名包含 plan，且正文包含验收/acceptance，亦明确属于验收规划候选（避免误归为历史）
  const isAcceptanceRelated =
    hasAcceptance ||
    baseName.includes('验收') ||
    content.includes('验收') ||
    content.includes('acceptance');

  if (hasPlan && isAcceptanceRelated) {
    return true;
  }

  // 2. Front-matter 声明
  if (content.startsWith('---')) {
    const { frontMatter } = parseFrontMatterWithLines(content);
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

  // 3. 标题或正文前部显式声明为验收规划
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
 * 解析 Markdown 章节与列表项（记录行号）
 */
function extractSectionsWithLines(content, lineOffset = 0) {
  const sections = {};
  let currentSection = null;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1 + lineOffset;
    const trimmed = lines[i].trim();

    // 二级或三级标题
    const headingMatch = trimmed.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      const headingText = headingMatch[1].trim();
      currentSection = headingText;
      if (!sections[currentSection]) {
        sections[currentSection] = {
          heading: headingText,
          headingLine: lineNum,
          items: [],
          itemLines: [],
        };
      }
      continue;
    }

    // 列表项（有序 1. 或无序 - / * 或复选框 - [ ]）
    const itemMatch = trimmed.match(/^(?:(?:\d+\.|\-|\*|(?:\-\s*\[[ xX]?\]))\s+)(.+)$/);
    if (itemMatch && currentSection) {
      sections[currentSection].items.push(itemMatch[1].trim());
      sections[currentSection].itemLines.push({
        line: lineNum,
        text: itemMatch[1].trim(),
      });
    }
  }

  return sections;
}

/**
 * 从文本行中提取显式元数据列表行（记录精确行号）
 * 遵循严格契约：Profile 不是所需环境，严禁猜套环境！
 */
function extractMetadataLinesWithLineNumbers(content) {
  const metadata = {};
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('-') && !trimmed.startsWith('*')) continue;

    // 匹配形如 - **状态**：unavailable 或 - 状态: unavailable
    const match = trimmed.match(/^[-\*]\s*\*{0,2}([^:*：\n]+?)\*{0,2}\s*[:：]\s*(.+)$/);
    if (!match) continue;

    const rawKey = match[1].trim().toLowerCase();
    const rawVal = match[2].trim().replace(/^\*{1,2}|\*{1,2}$/g, '').trim();

    if (rawKey === 'id' || rawKey === 'plan_id' || rawKey === 'planid' || rawKey === '标识') {
      metadata.id = { value: rawVal, line: lineNum };
    } else if (rawKey === 'title' || rawKey === '标题' || rawKey === '模块') {
      metadata.title = { value: rawVal, line: lineNum };
    } else if (rawKey === 'closedloop' || rawKey === 'closed_loop' || rawKey === '闭环' || rawKey === '是否闭环') {
      const boolVal = rawVal === 'true' || rawVal === '是' || rawVal === 'yes' ? true : (rawVal === 'false' || rawVal === '否' || rawVal === 'no' ? false : undefined);
      metadata.closedLoop = { value: boolVal, line: lineNum, raw: rawVal };
    } else if (rawKey === 'status' || rawKey === '状态') {
      const cleanVal = rawVal.replace(/[`'"]/g, '').split(/[（(]/)[0].trim();
      metadata.status = { value: cleanVal, line: lineNum };
    } else if (
      rawKey === 'requiredenvironments' ||
      rawKey === 'required_environments' ||
      rawKey === '所需环境' ||
      rawKey === '依赖环境' ||
      rawKey === '执行环境' ||
      rawKey === '运行环境'
    ) {
      // 明确声明的环境字段
      metadata.requiredEnvironments = { value: rawVal, line: lineNum };
    } else if (rawKey === 'reason' || rawKey === '原因' || rawKey === '未闭环原因') {
      metadata.reason = { value: rawVal, line: lineNum };
    }
  }

  return metadata;
}

/**
 * 解析 Markdown 规划文件（纯静态文本解析，附带逐字段行号 provenance）
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
      sourcePath: relativePath,
    };
  }

  // 候选判断
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

  const { frontMatter, fmProvenance, body, fmLineCount } = parseFrontMatterWithLines(content);
  const metadataLines = extractMetadataLinesWithLineNumbers(content);
  const sections = extractSectionsWithLines(body, fmLineCount);

  const provenance = {};
  const cannotConfirm = {};
  const warnings = [];

  // 1. Title
  let title = null;
  if (frontMatter?.title) {
    title = frontMatter.title;
    provenance.title = {
      value: title,
      sourcePath: relativePath,
      lineStart: fmProvenance?.title?.lineStart || 1,
      lineEnd: fmProvenance?.title?.lineEnd || 1,
      source: 'markdown_frontmatter',
    };
  } else if (metadataLines.title) {
    title = metadataLines.title.value;
    provenance.title = {
      value: title,
      sourcePath: relativePath,
      lineStart: metadataLines.title.line,
      lineEnd: metadataLines.title.line,
      source: 'markdown_metadata_line',
    };
  } else {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
      title = h1Match[1].trim();
      provenance.title = {
        value: title,
        sourcePath: relativePath,
        source: 'markdown_h1_heading',
      };
    }
  }
  if (!title) {
    title = path.basename(filePath, path.extname(filePath));
    cannotConfirm.title = {
      sourcePath: relativePath,
      reason: 'missing_title',
      details: 'No title found in frontmatter, metadata line, or H1 heading',
    };
  }

  // 2. ID
  let id = null;
  if (frontMatter?.id || frontMatter?.planId) {
    id = frontMatter.id || frontMatter.planId;
    provenance.id = {
      value: id,
      sourcePath: relativePath,
      lineStart: fmProvenance?.id?.lineStart || fmProvenance?.planId?.lineStart || 1,
      lineEnd: fmProvenance?.id?.lineEnd || fmProvenance?.planId?.lineEnd || 1,
      source: 'markdown_frontmatter',
    };
  } else if (metadataLines.id) {
    id = metadataLines.id.value;
    provenance.id = {
      value: id,
      sourcePath: relativePath,
      lineStart: metadataLines.id.line,
      lineEnd: metadataLines.id.line,
      source: 'markdown_metadata_line',
    };
  } else {
    // 从文件名推导作为默认回退
    const baseWithoutExt = path.basename(filePath, path.extname(filePath));
    id = baseWithoutExt.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    cannotConfirm.id = {
      sourcePath: relativePath,
      reason: 'inferred_id_from_filename',
      details: 'No explicit id declared in frontmatter or metadata line',
    };
  }

  // 3. closedLoop
  let closedLoop = undefined;
  if (typeof frontMatter?.closedLoop === 'boolean') {
    closedLoop = frontMatter.closedLoop;
    provenance.closedLoop = {
      value: closedLoop,
      sourcePath: relativePath,
      lineStart: fmProvenance?.closedLoop?.lineStart || 1,
      lineEnd: fmProvenance?.closedLoop?.lineEnd || 1,
      source: 'markdown_frontmatter',
    };
  } else if (typeof frontMatter?.closed_loop === 'boolean') {
    closedLoop = frontMatter.closed_loop;
    provenance.closedLoop = {
      value: closedLoop,
      sourcePath: relativePath,
      lineStart: fmProvenance?.closed_loop?.lineStart || 1,
      lineEnd: fmProvenance?.closed_loop?.lineEnd || 1,
      source: 'markdown_frontmatter',
    };
  } else if (typeof metadataLines.closedLoop?.value === 'boolean') {
    closedLoop = metadataLines.closedLoop.value;
    provenance.closedLoop = {
      value: closedLoop,
      sourcePath: relativePath,
      lineStart: metadataLines.closedLoop.line,
      lineEnd: metadataLines.closedLoop.line,
      source: 'markdown_metadata_line',
    };
  }
  if (typeof closedLoop !== 'boolean') {
    cannotConfirm.closedLoop = {
      sourcePath: relativePath,
      reason: 'missing_closedLoop',
      details: 'No explicit closedLoop boolean declaration found in frontmatter or metadata lines',
    };
  }

  // 4. status
  let status = null;
  if (frontMatter?.status) {
    status = frontMatter.status;
    provenance.status = {
      value: status,
      sourcePath: relativePath,
      lineStart: fmProvenance?.status?.lineStart || 1,
      lineEnd: fmProvenance?.status?.lineEnd || 1,
      source: 'markdown_frontmatter',
    };
  } else if (metadataLines.status?.value) {
    status = metadataLines.status.value;
    provenance.status = {
      value: status,
      sourcePath: relativePath,
      lineStart: metadataLines.status.line,
      lineEnd: metadataLines.status.line,
      source: 'markdown_metadata_line',
    };
  }
  if (!status) {
    cannotConfirm.status = {
      sourcePath: relativePath,
      reason: 'missing_status',
      details: 'No explicit status found in frontmatter or metadata lines',
    };
  }

  // 5. requiredEnvironments（严禁猜测，只认明确字段声明）
  let requiredEnvironments = undefined;
  if (frontMatter?.requiredEnvironments || frontMatter?.environments) {
    const raw = frontMatter.requiredEnvironments || frontMatter.environments;
    const norm = normalizeEnvironment(raw);
    if (norm && norm.environments.length > 0) {
      requiredEnvironments = norm.environments;
      provenance.requiredEnvironments = {
        value: requiredEnvironments,
        sourcePath: relativePath,
        lineStart: fmProvenance?.requiredEnvironments?.lineStart || fmProvenance?.environments?.lineStart || 1,
        lineEnd: fmProvenance?.requiredEnvironments?.lineEnd || fmProvenance?.environments?.lineEnd || 1,
        source: 'markdown_frontmatter',
      };
    }
  } else if (metadataLines.requiredEnvironments?.value) {
    const norm = normalizeEnvironment(metadataLines.requiredEnvironments.value);
    if (norm && norm.environments.length > 0) {
      requiredEnvironments = norm.environments;
      provenance.requiredEnvironments = {
        value: requiredEnvironments,
        sourcePath: relativePath,
        lineStart: metadataLines.requiredEnvironments.line,
        lineEnd: metadataLines.requiredEnvironments.line,
        source: 'markdown_metadata_line',
      };
    }
  }
  if (!requiredEnvironments) {
    cannotConfirm.requiredEnvironments = {
      sourcePath: relativePath,
      reason: 'missing_environment_declaration',
      details: 'No explicit requiredEnvironments frontmatter or metadata bullet found. Profile mentions do not count as environment declarations.',
    };
  }

  // 6. acceptanceSteps
  let acceptanceSteps = undefined;
  if (Array.isArray(frontMatter?.acceptanceSteps) && frontMatter.acceptanceSteps.length > 0) {
    acceptanceSteps = frontMatter.acceptanceSteps;
    provenance.acceptanceSteps = {
      value: acceptanceSteps,
      sourcePath: relativePath,
      lineStart: fmProvenance?.acceptanceSteps?.lineStart || 1,
      lineEnd: fmProvenance?.acceptanceSteps?.lineEnd || 1,
      source: 'markdown_frontmatter',
    };
  } else if (Array.isArray(frontMatter?.steps) && frontMatter.steps.length > 0) {
    acceptanceSteps = frontMatter.steps;
    provenance.acceptanceSteps = {
      value: acceptanceSteps,
      sourcePath: relativePath,
      lineStart: fmProvenance?.steps?.lineStart || 1,
      lineEnd: fmProvenance?.steps?.lineEnd || 1,
      source: 'markdown_frontmatter',
    };
  } else {
    for (const [secTitle, sec] of Object.entries(sections)) {
      if (/^(验收步骤|步骤|执行步骤|Checklist|Steps|流程|验收清单)/i.test(secTitle)) {
        if (sec.items.length > 0) {
          acceptanceSteps = sec.items;
          provenance.acceptanceSteps = {
            value: acceptanceSteps,
            sourcePath: relativePath,
            lineStart: sec.headingLine,
            lineEnd: sec.itemLines[sec.itemLines.length - 1]?.line || sec.headingLine,
            source: 'markdown_section_list',
            sectionHeading: secTitle,
          };
          break;
        }
      }
    }
  }
  if (!acceptanceSteps) {
    cannotConfirm.acceptanceSteps = {
      sourcePath: relativePath,
      reason: 'missing_acceptance_steps',
      details: 'No explicit acceptance steps found in frontmatter or markdown checklist sections.',
    };
  }

  // 7. evidenceRequirements
  let evidenceRequirements = undefined;
  if (Array.isArray(frontMatter?.evidenceRequirements) && frontMatter.evidenceRequirements.length > 0) {
    evidenceRequirements = frontMatter.evidenceRequirements;
    provenance.evidenceRequirements = {
      value: evidenceRequirements,
      sourcePath: relativePath,
      lineStart: fmProvenance?.evidenceRequirements?.lineStart || 1,
      lineEnd: fmProvenance?.evidenceRequirements?.lineEnd || 1,
      source: 'markdown_frontmatter',
    };
  } else if (Array.isArray(frontMatter?.evidence) && frontMatter.evidence.length > 0) {
    evidenceRequirements = frontMatter.evidence;
    provenance.evidenceRequirements = {
      value: evidenceRequirements,
      sourcePath: relativePath,
      lineStart: fmProvenance?.evidence?.lineStart || 1,
      lineEnd: fmProvenance?.evidence?.lineEnd || 1,
      source: 'markdown_frontmatter',
    };
  } else {
    for (const [secTitle, sec] of Object.entries(sections)) {
      if (/^(证据要求|验收证据|证据|Evidence Requirements|Evidence)/i.test(secTitle)) {
        if (sec.items.length > 0) {
          evidenceRequirements = sec.items;
          provenance.evidenceRequirements = {
            value: evidenceRequirements,
            sourcePath: relativePath,
            lineStart: sec.headingLine,
            lineEnd: sec.itemLines[sec.itemLines.length - 1]?.line || sec.headingLine,
            source: 'markdown_section_list',
            sectionHeading: secTitle,
          };
          break;
        }
      }
    }
  }
  if (!evidenceRequirements) {
    cannotConfirm.evidenceRequirements = {
      sourcePath: relativePath,
      reason: 'missing_evidence_requirements',
      details: 'No explicit evidence requirements found in frontmatter or evidence sections.',
    };
  }

  // 8. reason / pendingItems
  let reason = frontMatter?.reason || metadataLines.reason?.value;
  let pendingItems = frontMatter?.pendingItems || frontMatter?.pending;
  if (!Array.isArray(pendingItems) || pendingItems.length === 0) {
    for (const [secTitle, sec] of Object.entries(sections)) {
      if (/^(挂起项|待验收项|待办|未闭环原因|Pending Items|Pending)/i.test(secTitle)) {
        if (sec.items.length > 0) {
          pendingItems = sec.items;
          if (!reason) reason = sec.items.join('；');
          provenance.pendingItems = {
            value: pendingItems,
            sourcePath: relativePath,
            lineStart: sec.headingLine,
            lineEnd: sec.itemLines[sec.itemLines.length - 1]?.line || sec.headingLine,
            source: 'markdown_section_list',
          };
          break;
        }
      }
    }
  }

  const record = {
    id,
    title,
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
      title: record.title,
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
