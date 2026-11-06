import {
  REQUIRED_ENVIRONMENTS,
  ENV_LABELS,
  KNOWN_UNMERGED_PRS,
} from './types.mjs';

function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
}

/**
 * 格式化 Markdown 待验收总表 (pending-acceptance-by-env.md)
 */
export function formatMarkdownReport({ records, errors, skipped, summary, generatedAt }) {
  const timestamp = generatedAt || new Date().toISOString();

  const lines = [
    '# 真环境待验收总表',
    '',
    `<!-- generatedAt: ${timestamp} -->`,
    `> 生成时间：\`${timestamp}\` · 依据规范：[AGENTS.md](../../AGENTS.md) · [当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md) · 扫描范围：仅当前工作树`,
    '',
    '> [!IMPORTANT]',
    '> 本总表由离线工具 `scripts/acceptance/build-pending-acceptance-index.mjs` 静态扫描生成。',
    '> **核心声明**：仅假设这些文件合入后的离线输入汇总、非真实验收、非已合并主干。',
    '> **安全红线**：未连接任何真机/华为云环境，未读取密钥凭据，未执行任何规划文本内的指令（所有输入文件纯粹作为静态文本读取，严禁 import/eval/执行）。',
    '> **诚实原则**：`closedLoop: false` 属于合规待真实验收状态；缺失真环境独立读回证据前，工具绝不推断或背书「已闭环」。',
    '',
    '## 1. 扫描与待验收概览',
    '',
    `| 指标 | 数量 | 说明 |`,
    `| --- | --- | --- |`,
    `| 扫描文件总数 | ${summary.totalFilesScanned} | 排除 .git / node_modules / dist / .worktrees |`,
    `| 合规待验收规划 | ${summary.validPlans} | 结构完整、字段齐全的规划记录 |`,
    `| 校验异常/缺字段项 | ${summary.errorsCount} | 识别为规划但缺 closedLoop/环境/步骤/证据等字段 |`,
    `| 跳过的历史非规划文件 | ${summary.skippedCount} | 历史证据/回执/矩阵，不作为规划执行 |`,
    '',
  ];

  // 2. 按环境分组
  lines.push('## 2. 各环境待验收规划汇总');
  lines.push('');

  for (const env of REQUIRED_ENVIRONMENTS) {
    const label = ENV_LABELS[env] || env;
    const recordsInEnv = records.filter(
      (r) => Array.isArray(r.requiredEnvironments) && r.requiredEnvironments.includes(env),
    );

    lines.push(`### ${label} (\`${env}\`，共 ${recordsInEnv.length} 项)`);
    lines.push('');

    if (recordsInEnv.length === 0) {
      lines.push('*当前环境在当前工作树暂无独立合规规划条目（待未合并 PR 合入后自动纳入，详见下文）。*');
      lines.push('');
      continue;
    }

    lines.push('| 规划 ID / 标题 | 来源路径与行号 | 状态 | closedLoop | 步骤摘要 | 证据要求 | 原因 / 挂起项 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');

    for (const r of recordsInEnv) {
      const titleLink = `[${escapeMarkdown(r.title)}](../../${r.sourcePath})`;
      const provPath = r.provenance?.closedLoop?.lineStart
        ? `\`${r.sourcePath}:${r.provenance.closedLoop.lineStart}\``
        : `\`${r.sourcePath}\``;
      const stepsSummary = escapeMarkdown(
        Array.isArray(r.acceptanceSteps)
          ? r.acceptanceSteps.slice(0, 3).map((s, idx) => `${idx + 1}. ${s}`).join('<br/>') +
              (r.acceptanceSteps.length > 3 ? `<br/>...等共 ${r.acceptanceSteps.length} 步` : '')
          : '',
      );
      const evidenceSummary = escapeMarkdown(
        Array.isArray(r.evidenceRequirements)
          ? r.evidenceRequirements.slice(0, 2).map((e, idx) => `• ${e}`).join('<br/>') +
              (r.evidenceRequirements.length > 2 ? `<br/>...等共 ${r.evidenceRequirements.length} 项` : '')
          : '',
      );
      const reasonSummary = escapeMarkdown(
        r.reason || (Array.isArray(r.pendingItems) ? r.pendingItems.join('；') : ''),
      );

      lines.push(
        `| ${titleLink} | ${provPath} | \`${r.status}\` | \`${r.closedLoop}\` | ${stepsSummary} | ${evidenceSummary} | ${reasonSummary} |`,
      );
    }

    lines.push('');
  }

  // 3. 规划声称已闭环（需人工复核 - 工具不背书）
  const claimedVerifiedRecords = records.filter((r) => r.closedLoop === true);
  if (claimedVerifiedRecords.length > 0) {
    lines.push('## 3. 规划声称已闭环（需人工复核 - 工具不背书）');
    lines.push('');
    lines.push('> [!WARNING]');
    lines.push('> 以下规划条目在源文件中声称已完成验收并具备证据标记。');
    lines.push('> 本工具仅为离线静态扫描与契约校验，**不代表确认或背书真实环境验收已完成**。必须由对应负责人在真实物理设备/真云账号中人工复核独立读回。');
    lines.push('');
    lines.push('| 规划 ID / 标题 | 来源路径 | 状态 | 证据标记 | 步骤数量 |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const r of claimedVerifiedRecords) {
      lines.push(
        `| [${escapeMarkdown(r.title)}](../../${r.sourcePath}) | \`${r.sourcePath}\` | \`${r.status}\` | \`${r.hasVerifiedEvidence ? 'verified' : 'unknown'}\` | ${r.acceptanceSteps?.length || 0} |`,
      );
    }
    lines.push('');
  }

  // 4. 已知未合并验收规划 PR（待合并后自动纳入）
  lines.push('## 4. 已知未合并验收规划 PR（待合并后自动纳入）');
  lines.push('');
  lines.push('以下分支/PR 包含 zemeng 离线规划纯函数及标准 Markdown 验收规划。当前**尚未合并至 main**，本工具遵循诚实原则**未将其作为工作树已有文件纳入上表统计**。待合入后无需修改本工具即可自动纳入：');
  lines.push('');
  lines.push('| PR | 分支 / 描述 | 规划目标 | 涉及环境 | 状态 | 核心函数/依据 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');

  for (const item of KNOWN_UNMERGED_PRS) {
    const envs = item.targetEnvironments.map((e) => `\`${e}\``).join(', ');
    lines.push(
      `| **${item.pr}** | \`${item.branch}\` | ${escapeMarkdown(item.title)} | ${envs} | \`${item.status}\` | \`${item.keyFunction}\` |`,
    );
  }
  lines.push('');

  // 5. 校验异常清单（含逐字段来源与 cannot_confirm 原因）
  if (errors.length > 0) {
    lines.push(`## 5. 扫描校验异常清单 (${errors.length} 项)`);
    lines.push('');
    lines.push('> [!CAUTION]');
    lines.push('> 以下文件被识别为验收规划候选，但因字段缺失、分支歧义或防伪校验失败而报错。工具已如实记录，绝不静默跳过、绝不猜测默认分支、绝不伪造字段：');
    lines.push('');
    lines.push('| 来源路径 | 规划标题 | 缺失字段 | 无法确认原因 (cannot_confirm) | 错误详情 |');
    lines.push('| --- | --- | --- | --- | --- |');

    for (const err of errors) {
      const missing = err.missingFields?.length > 0 ? err.missingFields.map((f) => `\`${f}\``).join(', ') : '无';
      const cannotConfirmReasons = Object.entries(err.cannotConfirm || {})
        .map(([k, v]) => `\`${k}\`: ${v.reason || 'unknown'}`)
        .join('<br/>') || '无';
      const errMsg = escapeMarkdown(err.errors?.join('； ') || '未知错误');
      lines.push(`| \`${err.sourcePath}\` | ${escapeMarkdown(err.title)} | ${missing} | ${cannotConfirmReasons} | ${errMsg} |`);
    }
    lines.push('');
  }

  // 6. 跳过的历史非规划文件
  if (skipped.length > 0) {
    lines.push(`## 6. 跳过的历史验收文件清单 (共 ${skipped.length} 篇)`);
    lines.push('');
    lines.push('历史中存在若干名称包含 `ACCEPTANCE` 但仅为执行回执/证据/矩阵、不构成待验收规划的文件，已做区分并安全跳过（未标为已验收）：');
    lines.push('');
    lines.push('| 文件路径 | 识别结果 / 跳过理由 |');
    lines.push('| --- | --- |');

    for (const item of skipped.slice(0, 50)) {
      lines.push(`| \`${item.sourcePath}\` | \`${item.reason}\` |`);
    }
    if (skipped.length > 50) {
      lines.push(`| ...等共 ${skipped.length} 篇 | 更多历史回执已保留 |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 格式化 JSON 待验收索引 (pending-acceptance-index.json)
 */
export function formatJsonReport({ records, errors, skipped, summary, generatedAt, scanRoots }) {
  const payload = {
    schemaVersion: '1.0.0',
    disclaimer: '仅假设这些文件合入后的离线输入汇总、非真实验收、非已合并主干',
    generatedAt: generatedAt || new Date().toISOString(),
    scanRoots: scanRoots || ['.'],
    summary,
    records,
    errors,
    skipped,
    unmergedPrReference: KNOWN_UNMERGED_PRS,
  };

  return JSON.stringify(payload, null, 2);
}
