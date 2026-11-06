import path from 'node:path';

/**
 * 必需环境枚举集合（至少覆盖五种物理/外部依赖环境）
 */
export const REQUIRED_ENVIRONMENTS = Object.freeze([
  'windows_real_machine',
  'huawei_cloud',
  'real_account',
  'rights_holder_or_human',
  'other',
]);

/**
 * 环境展示标签映射
 */
export const ENV_LABELS = Object.freeze({
  windows_real_machine: 'Windows 真机环境',
  huawei_cloud: '华为云 / AgentArts 云端环境',
  real_account: '真实账号 / 凭据授权',
  rights_holder_or_human: '权利人 / 人工审批与复核',
  other: '其他物理或定制环境',
});

/**
 * 合法状态值集合
 */
export const VALID_STATUSES = Object.freeze([
  'unavailable',
  'pending',
  'in_progress',
  'ready',
  'verified',
]);

/**
 * 已知未合并验收规划 PR（硬编码参考列表，待合并后自动纳入）
 */
export const KNOWN_UNMERGED_PRS = Object.freeze([
  {
    pr: '#594',
    branch: 'zemeng/mod19-sqlite-smoke-plan',
    title: 'MOD-19 打包后 Electron SQLite 烟测离线规划',
    targetEnvironments: ['windows_real_machine'],
    status: 'open_pending_merge',
    keyFunction: 'planPackagedSqliteSmoke',
  },
  {
    pr: '#596',
    branch: 'zemeng/mod29-deployment-readback-plan',
    title: 'MOD-29 云端部署与版本读回离线规划',
    targetEnvironments: ['huawei_cloud'],
    status: 'open_pending_merge',
    keyFunction: 'planDeploymentReadback',
  },
  {
    pr: '#598',
    branch: 'zemeng/mod19-release-acceptance-plans',
    title: 'MOD-19 安装/升级/卸载全生命周期离线规划',
    targetEnvironments: ['windows_real_machine'],
    status: 'open_pending_merge',
    keyFunction: 'planReleaseLifecycleAcceptance',
  },
  {
    pr: '#599',
    branch: 'zemeng/mod16-live-acceptance-plan',
    title: 'MOD-16 真实记事本 UIA/原生窗口读回规划',
    targetEnvironments: ['windows_real_machine'],
    status: 'open_pending_merge',
    keyFunction: 'planNotepadLiveAcceptance',
  },
  {
    pr: '#602',
    branch: 'zemeng/mod27-privacy-deletion-plan',
    title: 'MOD-27 隐私擦除与数据持久化清空规划',
    targetEnvironments: ['windows_real_machine'],
    status: 'open_pending_merge',
    keyFunction: 'planPrivacyDeletionAcceptance',
  },
  {
    pr: '#604',
    branch: 'zemeng/mod18-windows-sandbox-acceptance-plan',
    title: 'MOD-18 Windows 沙箱安全隔离执行规划',
    targetEnvironments: ['windows_real_machine'],
    status: 'open_pending_merge',
    keyFunction: 'planWindowsSandboxAcceptance',
  },
  {
    pr: '#605',
    branch: 'zemeng/f09-cloud-prefix-acceptance-plan',
    title: 'F09 订阅云前缀与会话授权读回离线规划',
    targetEnvironments: ['huawei_cloud', 'real_account'],
    status: 'open_pending_merge',
    keyFunction: 'planF09CloudPrefixAcceptance',
  },
  {
    pr: '#606',
    branch: 'zemeng/cloudpersist-acceptance-plan',
    title: 'MOD-04B 关机后云持续离线验收规划',
    targetEnvironments: ['huawei_cloud'],
    status: 'open_pending_merge',
    keyFunction: 'planCloudPersistentAcceptance',
  },
  {
    pr: '#607',
    branch: 'zemeng/mod04b-agentarts-acceptance-plan',
    title: 'MOD-04B AgentArts 端到端云编排验收规划',
    targetEnvironments: ['huawei_cloud'],
    status: 'open_pending_merge',
    keyFunction: 'planMod04bAgentArtsAcceptance',
  },
  {
    pr: '#572',
    branch: 'zemeng/real-acceptance-guide',
    title: '真实验收指引（指引规范，非闭环记录）',
    targetEnvironments: ['windows_real_machine', 'huawei_cloud', 'real_account', 'rights_holder_or_human'],
    status: 'open_pending_merge',
    keyFunction: 'guideline_only',
  },
]);

/**
 * 严格将显式环境文本/列表映射到规范化环境枚举。
 * 严禁通过上下文普通词汇（如 profile/token/windows 散落出现）猜测环境！
 * 只有明确的环境字段、字面量数组或声明值才允许传入此函数。
 */
export function normalizeEnvironment(rawInput) {
  if (!rawInput) {
    return null;
  }

  const rawList = Array.isArray(rawInput)
    ? rawInput
    : typeof rawInput === 'string'
      ? rawInput.split(/[,;\n|]/).map((s) => s.trim()).filter(Boolean)
      : [String(rawInput)];

  if (rawList.length === 0) {
    return null;
  }

  const resultEnvs = new Set();
  const envDetails = [];

  for (const item of rawList) {
    const raw = typeof item === 'string' ? item.trim() : String(item);
    if (!raw) continue;
    const lower = raw.toLowerCase();

    if (
      lower === 'windows_real_machine' ||
      lower === 'windows真机' ||
      lower === 'windows真机环境' ||
      lower === '桌面真机' ||
      lower === 'win32' ||
      lower.includes('windows真机')
    ) {
      resultEnvs.add('windows_real_machine');
      envDetails.push({ env: 'windows_real_machine', raw });
    } else if (
      lower === 'huawei_cloud' ||
      lower === '华为云' ||
      lower === 'agentarts云端' ||
      lower === 'agentarts' ||
      lower === '华为云真机' ||
      lower.includes('华为云') ||
      lower.includes('agentarts云端')
    ) {
      resultEnvs.add('huawei_cloud');
      envDetails.push({ env: 'huawei_cloud', raw });
    } else if (
      lower === 'real_account' ||
      lower === '真实账号' ||
      lower === '凭据授权' ||
      lower === '真凭据' ||
      lower.includes('真实账号')
    ) {
      resultEnvs.add('real_account');
      envDetails.push({ env: 'real_account', raw });
    } else if (
      lower === 'rights_holder_or_human' ||
      lower === '权利人' ||
      lower === '人工审批' ||
      lower === '人工复核' ||
      lower === '人机协同' ||
      lower.includes('权利人') ||
      lower.includes('人工审批')
    ) {
      resultEnvs.add('rights_holder_or_human');
      envDetails.push({ env: 'rights_holder_or_human', raw });
    } else {
      // 显式声明了非空环境但未在标准前四项枚举中的，映射为 'other'
      resultEnvs.add('other');
      envDetails.push({ env: 'other', raw });
    }
  }

  if (resultEnvs.size === 0) {
    return null;
  }

  return {
    environments: Array.from(resultEnvs),
    details: envDetails,
  };
}

/**
 * 校验规划记录的齐套性与契约合规性。
 * 遵循严格契约：缺字段报错并记录 cannot_confirm，绝不假齐套，绝不猜默认分支。
 */
export function validateNormalizedRecord(record, sourcePath = '') {
  const missingFields = [];
  const errors = [];
  const cannotConfirm = record?.cannotConfirm ? { ...record.cannotConfirm } : {};

  if (!record || typeof record !== 'object') {
    return {
      ok: false,
      missingFields: ['record'],
      errors: ['Record must be a non-null object'],
      cannotConfirm: { record: { reason: 'not_an_object' } },
    };
  }

  // 1. id
  if (typeof record.id !== 'string' || record.id.trim().length === 0) {
    missingFields.push('id');
    errors.push('Missing or empty id');
    if (!cannotConfirm.id) cannotConfirm.id = { reason: 'missing_id' };
  }

  // 2. title
  if (typeof record.title !== 'string' || record.title.trim().length === 0) {
    missingFields.push('title');
    errors.push('Missing or empty title');
    if (!cannotConfirm.title) cannotConfirm.title = { reason: 'missing_title' };
  }

  // 3. sourcePath
  if (typeof record.sourcePath !== 'string' || record.sourcePath.trim().length === 0) {
    missingFields.push('sourcePath');
    errors.push('Missing or empty sourcePath');
  }

  // 4. closedLoop: 必须明确为布尔值，缺则报错，绝对不得默认 true 或从 false 出现盲推默认
  if (typeof record.closedLoop !== 'boolean') {
    missingFields.push('closedLoop');
    const cc = cannotConfirm.closedLoop;
    if (cc?.reason === 'ambiguous_closedLoop') {
      errors.push(
        'Ambiguous closedLoop: multiple conditional branches or dynamic expressions detected in code. Static analysis cannot determine default branch without runtime execution.',
      );
    } else {
      errors.push('Missing closedLoop boolean (must be explicitly true or false; never default to true or guess from partial conditions)');
      if (!cannotConfirm.closedLoop) cannotConfirm.closedLoop = { reason: 'missing_closedLoop' };
    }
  }

  // 5. status
  if (typeof record.status !== 'string' || record.status.trim().length === 0) {
    missingFields.push('status');
    errors.push('Missing status string');
    if (!cannotConfirm.status) cannotConfirm.status = { reason: 'missing_status' };
  } else if (!VALID_STATUSES.includes(record.status)) {
    errors.push(`Invalid status "${record.status}"; expected one of: ${VALID_STATUSES.join(', ')}`);
  }

  // 6. requiredEnvironments: 必须是非空数组，且每个元素属于已知枚举
  if (
    !Array.isArray(record.requiredEnvironments) ||
    record.requiredEnvironments.length === 0
  ) {
    missingFields.push('requiredEnvironments');
    errors.push('Missing or empty requiredEnvironments (must be a non-empty array of environment enums)');
    if (!cannotConfirm.requiredEnvironments) {
      cannotConfirm.requiredEnvironments = {
        reason: 'missing_environment_declaration',
        details: 'No explicit requiredEnvironments literal or field found. Keyword guessing is strictly prohibited.',
      };
    }
  } else {
    for (const env of record.requiredEnvironments) {
      if (!REQUIRED_ENVIRONMENTS.includes(env)) {
        errors.push(`Unknown requiredEnvironment "${env}"; expected one of: ${REQUIRED_ENVIRONMENTS.join(', ')}`);
      }
    }
  }

  // 7. acceptanceSteps: 非空步骤列表
  if (!Array.isArray(record.acceptanceSteps) || record.acceptanceSteps.length === 0) {
    missingFields.push('acceptanceSteps');
    errors.push('Missing or empty acceptanceSteps (must contain at least one step string)');
    if (!cannotConfirm.acceptanceSteps) {
      cannotConfirm.acceptanceSteps = {
        reason: 'missing_acceptance_steps',
        details: 'No explicit acceptance steps or checklist declared.',
      };
    }
  } else {
    const validSteps = record.acceptanceSteps.filter(
      (s) => typeof s === 'string' && s.trim().length > 0,
    );
    if (validSteps.length === 0) {
      missingFields.push('acceptanceSteps');
      errors.push('acceptanceSteps contains no non-empty strings');
      if (!cannotConfirm.acceptanceSteps) {
        cannotConfirm.acceptanceSteps = { reason: 'empty_acceptance_steps' };
      }
    }
  }

  // 8. evidenceRequirements: 非空证据要求
  if (
    !Array.isArray(record.evidenceRequirements) ||
    record.evidenceRequirements.length === 0
  ) {
    missingFields.push('evidenceRequirements');
    errors.push('Missing or empty evidenceRequirements (must contain at least one requirement string)');
    if (!cannotConfirm.evidenceRequirements) {
      cannotConfirm.evidenceRequirements = {
        reason: 'missing_evidence_requirements',
        details: 'No explicit evidence requirements declared.',
      };
    }
  } else {
    const validEvidence = record.evidenceRequirements.filter(
      (s) => typeof s === 'string' && s.trim().length > 0,
    );
    if (validEvidence.length === 0) {
      missingFields.push('evidenceRequirements');
      errors.push('evidenceRequirements contains no non-empty strings');
      if (!cannotConfirm.evidenceRequirements) {
        cannotConfirm.evidenceRequirements = { reason: 'empty_evidence_requirements' };
      }
    }
  }

  // 9. closedLoop === false 时的 reason 或 pendingItems
  if (record.closedLoop === false) {
    const hasReason = typeof record.reason === 'string' && record.reason.trim().length > 0;
    const hasPendingItems =
      Array.isArray(record.pendingItems) &&
      record.pendingItems.some(
        (p) =>
          (typeof p === 'string' && p.trim().length > 0) ||
          (p && typeof p === 'object' && typeof p.description === 'string' && p.description.trim().length > 0),
      );

    if (!hasReason && !hasPendingItems) {
      missingFields.push('reason/pendingItems');
      errors.push('closedLoop is false, so either reason or non-empty pendingItems must be provided');
      if (!cannotConfirm.reason) cannotConfirm.reason = { reason: 'missing_reason_or_pending' };
    }
  }

  // 10. closedLoop === true 时的防伪造检查：
  if (record.closedLoop === true) {
    const hasEvidenceProof =
      record.hasVerifiedEvidence === true ||
      (typeof record.evidenceDigest === 'string' && record.evidenceDigest.trim().length > 0) ||
      (Array.isArray(record.receiptDigests) && record.receiptDigests.length > 0);

    const isMarkedMock =
      record.mock === true ||
      record.isMock === true ||
      record.synthetic === true ||
      record.simulated === true ||
      record.evidenceLevel === 'mock' ||
      record.evidenceLevel === 'unverified';

    if (!hasEvidenceProof || isMarkedMock) {
      errors.push(
        'Anti-forgery violation: closedLoop claimed true without sufficient verified real-environment evidence. Falsified or unverified acceptance claims are strictly prohibited.',
      );
      cannotConfirm.closedLoop = {
        reason: 'unverified_closedLoop_claim',
        details: 'Claimed closedLoop:true but lacking verified evidence proof, or marked mock/synthetic.',
      };
    }
  }

  return {
    ok: errors.length === 0,
    missingFields,
    errors,
    cannotConfirm,
  };
}
