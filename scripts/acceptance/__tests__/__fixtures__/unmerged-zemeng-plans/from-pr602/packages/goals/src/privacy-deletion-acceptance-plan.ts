import { GraphError } from './index.js';

export const PLAN_ID = 'privacy-deletion-acceptance-plan';
export const PLAN_TITLE = 'MOD-27：隐私删除与私人数据授权离线验收规划';
export const PRIVACY_ACCEPTANCE_PENDING_REASON = '待真人/真机验收' as const;
export const PENDING_REASON = PRIVACY_ACCEPTANCE_PENDING_REASON;

/**
 * 必需环境声明（依据 docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md §1/§2）
 */
export const REQUIRED_ENVIRONMENTS = ['rights_holder_or_human', 'windows_real_machine'];

/**
 * 验收步骤声明（依据 docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md §2.3）
 */
export const ACCEPTANCE_STEPS = [
  'human_user_privacy_authorization：真人用户隐私授权与敏感范围审查（现场明确授权访问与删除范围，严禁模型代签或自动放行）',
  'on_site_deletion_readback：删除现场物理读回与存储清零验证（核实持久化存储中已物理抹除，非仅图谱版本追加或逻辑撤回）',
  'graph_dependency_erasure_integrity：图谱依赖级联处理与断链校验（被删除节点后继依赖清理与一致性核验，旧版本不混淆别名）',
  'durable_storage_restart_verification：持久化存储进程重启后现场读回（重启后被抹除数据不可恢复，合规性审计凭证完备）',
  'cloud_boundary_and_leak_prevention：云端与跨进程边界防泄露核验（私人正文绝不上传云端，错误回显与日志不泄露敏感数据）',
];

/**
 * 验收证据要求声明（依据 docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md §1/§2）
 */
export const EVIDENCE_REQUIREMENTS = [
  'PrivacyDeletionReceipt 合规物理删除回执（包含 receiptId、namespace、targetId、action=\'privacy_deletion\'、physicalErasure=true、有序 erasedGraphRevisions）',
  '真人用户现场授权凭证（realUserAuthorization）与持久化存储物理擦除现场读回回执（realDeletionReadback）',
];

/**
 * 默认待现场验收挂起项声明
 */
export const DEFAULT_PENDING_ITEMS = [
  'human_user_privacy_authorization',
  'on_site_deletion_readback',
  'graph_dependency_erasure_integrity',
  'durable_storage_restart_verification',
  'cloud_boundary_and_leak_prevention',
];

export type PrivacyDeletionReceiptAction = 'withdrawal' | 'privacy_deletion';

/**
 * Receipt representing either a logical withdrawal or a trusted physical privacy deletion.
 * Distinction between logical withdrawal (preserving audit history) and physical erasure
 * (removing content-free positions from the graph and wiping storage) is strictly enforced.
 */
export interface PrivacyDeletionReceipt {
  readonly receiptId: string;
  readonly namespace: string;
  readonly targetId: string;
  readonly action: PrivacyDeletionReceiptAction;
  readonly graphRevision: number;
  readonly nodeRevision?: number | undefined;
  readonly physicalErasure?: boolean | undefined;
  readonly erasedGraphRevisions?: readonly number[] | undefined;
  readonly reason?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly evidenceLevel?: 'mock' | 'conditional' | 'verified' | undefined;
  readonly realUserAuthorization?: boolean | undefined;
  readonly realDeletionReadback?: boolean | undefined;
}

export interface RealPrivacyAcceptanceEvidence {
  readonly humanAuthorized?: boolean | undefined;
  readonly onSiteDeletionReadback?: boolean | undefined;
  readonly evidenceLevel?: 'mock' | 'conditional' | 'verified' | undefined;
  readonly auditRecordConfirmed?: boolean | undefined;
}

export interface PlanPrivacyDeletionAcceptanceOptions {
  readonly receipt?: unknown;
  readonly receipts?: readonly unknown[];
  readonly realAuthorizationEvidence?: RealPrivacyAcceptanceEvidence | undefined;
  readonly realUserAuthorization?: boolean | undefined;
  readonly realDeletionReadback?: boolean | undefined;
  readonly evidenceLevel?: 'mock' | 'conditional' | 'verified' | undefined;
  readonly mock?: boolean | undefined;
  readonly isMock?: boolean | undefined;
  readonly namespace?: string | undefined;
  readonly targetId?: string | undefined;
  readonly action?: PrivacyDeletionReceiptAction | undefined;
}

export interface PrivacyDeletionPendingItem {
  readonly item: string;
  readonly description: string;
  readonly status: 'unavailable' | 'pending';
  readonly reason: typeof PRIVACY_ACCEPTANCE_PENDING_REASON | string;
}

export interface PrivacyDeletionStructuralVerification {
  readonly hasHumanAuth: boolean;
  readonly hasDeletionReadback: boolean;
  readonly isPhysicalDeletion: boolean;
  readonly missingRequirements: readonly string[];
  readonly fullyCovered: boolean;
}

export interface PrivacyDeletionAcceptancePlan {
  readonly closedLoop: boolean;
  readonly status: 'unavailable' | 'in_progress' | 'ready' | 'verified';
  readonly reason: typeof PRIVACY_ACCEPTANCE_PENDING_REASON | string;
  readonly pending: readonly PrivacyDeletionPendingItem[];
  readonly verified: readonly string[];
  readonly limits: readonly string[];
  readonly receipt?: PrivacyDeletionReceipt | undefined;
  readonly deletionKind?: PrivacyDeletionReceiptAction | undefined;
  readonly structuralVerification?: PrivacyDeletionStructuralVerification | undefined;
}

export const PRIVACY_ACCEPTANCE_PENDING_ITEMS = [
  {
    item: 'human_user_privacy_authorization',
    description: '真人用户隐私授权与敏感范围审查（现场明确授权私人数据访问与擦除范围，严禁模型代签或自动放行）',
    status: 'unavailable',
    reason: PRIVACY_ACCEPTANCE_PENDING_REASON,
  },
  {
    item: 'on_site_deletion_readback',
    description: '删除现场物理读回与存储清零验证（核实持久化存储中已物理抹除，非仅图谱版本追加或逻辑撤回）',
    status: 'unavailable',
    reason: PRIVACY_ACCEPTANCE_PENDING_REASON,
  },
  {
    item: 'graph_dependency_erasure_integrity',
    description: '图谱依赖级联处理与断链校验（被删除节点所有后继依赖的清理与一致性核验，旧版本不混淆别名）',
    status: 'unavailable',
    reason: PRIVACY_ACCEPTANCE_PENDING_REASON,
  },
  {
    item: 'durable_storage_restart_verification',
    description: '持久化存储进程重启后现场读回（重启后被抹除数据不可恢复，合规性审计凭证完备）',
    status: 'unavailable',
    reason: PRIVACY_ACCEPTANCE_PENDING_REASON,
  },
  {
    item: 'cloud_boundary_and_leak_prevention',
    description: '云端与跨进程边界防泄露核验（私人正文绝不上传云端，错误回显与日志不泄露敏感数据）',
    status: 'unavailable',
    reason: PRIVACY_ACCEPTANCE_PENDING_REASON,
  },
] as const satisfies readonly PrivacyDeletionPendingItem[];

export const PRIVACY_ACCEPTANCE_LIMITS: readonly string[] = [
  '本规划 helper 纯离线运行，严禁读取真实私人数据，严禁产生网络连接',
  '图谱撤回（state=withdrawn）仅为逻辑版本追加，严禁视为物理删除或隐私擦除',
  '无真人用户现场授权或无真机删除现场读回时，严禁将 closedLoop 标为 true',
  '禁止使用 mock / fake / synthetic 证据冒充真实闭环，真实缺项统一登记为 status: unavailable、reason: 待真人/真机验收',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new GraphError('INVALID_ARGUMENT', message);
}

/**
 * Validates the shape and structural constraints of a privacy deletion or revocation receipt.
 * Strictly distinguishes logical withdrawal vs physical privacy deletion:
 * - Prohibits calling logical withdrawal a physical deletion (e.g. claiming physicalErasure=true).
 * - Prohibits withdrawal claiming erasedGraphRevisions.
 * - Requires physical deletion to set physicalErasure=true and properly ordered erasedGraphRevisions.
 */
export function assertPrivacyDeletionReceipt(value: unknown): asserts value is PrivacyDeletionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Privacy deletion receipt must be an object');
  }

  const raw = value as Record<string, unknown>;

  if (typeof raw.receiptId !== 'string' || raw.receiptId.trim().length === 0) {
    fail('Privacy deletion receipt receiptId must be a non-empty string');
  }

  if (typeof raw.namespace !== 'string' || raw.namespace.trim().length === 0) {
    fail('Privacy deletion receipt namespace must be a non-empty string');
  }

  if (typeof raw.targetId !== 'string' || raw.targetId.trim().length === 0) {
    fail('Privacy deletion receipt targetId must be a non-empty string');
  }

  if (raw.action !== 'withdrawal' && raw.action !== 'privacy_deletion') {
    fail('Privacy deletion receipt action must be "withdrawal" or "privacy_deletion"');
  }

  if (!Number.isSafeInteger(raw.graphRevision) || (raw.graphRevision as number) < 0) {
    fail('Privacy deletion receipt graphRevision must be a non-negative integer');
  }

  // Strictly distinguish withdrawal vs privacy deletion: prohibit calling withdrawal physical deletion
  if (raw.action === 'withdrawal') {
    if (raw.physicalErasure === true || raw.isPhysicalDeletion === true || raw.physicalDeletion === true) {
      fail('Cannot describe withdrawal as physical deletion');
    }
    if (raw.erasedGraphRevisions !== undefined) {
      if (Array.isArray(raw.erasedGraphRevisions) && raw.erasedGraphRevisions.length > 0) {
        fail('Withdrawal preserves historical versions and must not specify erasedGraphRevisions');
      }
    }
  }

  if (raw.action === 'privacy_deletion') {
    if (raw.physicalErasure !== undefined && raw.physicalErasure !== true) {
      fail('Privacy deletion requires physicalErasure to be true');
    }
    if (raw.erasedGraphRevisions !== undefined) {
      if (!Array.isArray(raw.erasedGraphRevisions) || raw.erasedGraphRevisions.some((rev, idx, arr) =>
        !Number.isSafeInteger(rev) || rev < 1 || (idx > 0 && rev <= arr[idx - 1]!)
      )) {
        fail('Privacy deletion erasedGraphRevisions must be a sorted array of positive unique integers');
      }
    }
  }

  if (raw.nodeRevision !== undefined && (!Number.isSafeInteger(raw.nodeRevision) || (raw.nodeRevision as number) < 1)) {
    fail('Privacy deletion receipt nodeRevision must be a positive integer');
  }

  if (raw.timestamp !== undefined) {
    if (typeof raw.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw.timestamp)) {
      fail('Privacy deletion receipt timestamp must be a valid ISO-8601 string');
    }
    const n = Date.parse(raw.timestamp);
    if (!Number.isFinite(n) || new Date(n).toISOString() !== raw.timestamp) {
      fail('Privacy deletion receipt timestamp must be a valid UTC ISO-8601 timestamp');
    }
  }

  if (raw.evidenceLevel !== undefined && !['mock', 'conditional', 'verified'].includes(raw.evidenceLevel as string)) {
    fail('Privacy deletion receipt evidenceLevel must be "mock", "conditional", or "verified"');
  }

  if (raw.reason !== undefined && typeof raw.reason !== 'string') {
    fail('Privacy deletion receipt reason must be a string');
  }

  if (raw.realUserAuthorization !== undefined && typeof raw.realUserAuthorization !== 'boolean') {
    fail('Privacy deletion receipt realUserAuthorization must be a boolean');
  }

  if (raw.realDeletionReadback !== undefined && typeof raw.realDeletionReadback !== 'boolean') {
    fail('Privacy deletion receipt realDeletionReadback must be a boolean');
  }
}

/**
 * Convenience parser returning typed PrivacyDeletionReceipt or throwing GraphError.
 */
export function parsePrivacyDeletionReceipt(value: unknown): PrivacyDeletionReceipt {
  assertPrivacyDeletionReceipt(value);
  return value;
}

/**
 * Plans offline acceptance verification for MOD-27 privacy deletion / personal data authorization.
 * When real human user authorization evidence or real deletion on-site readback is absent,
 * closedLoop is strictly false, status is 'unavailable', reason is '待真人/真机验收',
 * and pending items require real acceptance.
 * Mock/synthetic evidence is strictly forbidden from claiming closedLoop.
 * Pure offline function: does not read private personal data, does not access network.
 */
export function planPrivacyDeletionAcceptance(
  receiptOrOptions?: unknown | PlanPrivacyDeletionAcceptanceOptions
): PrivacyDeletionAcceptancePlan {
  let receiptInput: unknown;
  let realAuthEvidence: RealPrivacyAcceptanceEvidence | boolean | undefined;
  let realUserAuth: boolean | undefined;
  let realDeletionReadback: boolean | undefined;
  let evidenceLevel: 'mock' | 'conditional' | 'verified' | undefined;
  let isMockExplicit = false;

  if (receiptOrOptions && typeof receiptOrOptions === 'object') {
    const opts = receiptOrOptions as PlanPrivacyDeletionAcceptanceOptions & Record<string, unknown>;
    if ('receipt' in opts || 'realAuthorizationEvidence' in opts || 'realUserAuthorization' in opts || 'realDeletionReadback' in opts) {
      receiptInput = opts.receipt;
      realAuthEvidence = opts.realAuthorizationEvidence;
      realUserAuth = opts.realUserAuthorization;
      realDeletionReadback = opts.realDeletionReadback;
      evidenceLevel = opts.evidenceLevel;
      isMockExplicit = opts.mock === true || opts.isMock === true;
      if (opts.receipts && Array.isArray(opts.receipts)) {
        for (const r of opts.receipts) assertPrivacyDeletionReceipt(r);
      }
    } else if ('receiptId' in opts && 'targetId' in opts && 'action' in opts) {
      // Direct receipt object passed
      receiptInput = opts;
    }
  }

  let receipt: PrivacyDeletionReceipt | undefined;
  if (receiptInput !== undefined) {
    assertPrivacyDeletionReceipt(receiptInput);
    receipt = receiptInput;
  }

  // Runtime defense against caller passing boolean for realAuthorizationEvidence
  if (typeof realAuthEvidence === 'boolean') {
    fail('realAuthorizationEvidence must be an object, boolean is not supported');
  }

  let typedAuthEvidence: RealPrivacyAcceptanceEvidence | undefined;
  if (realAuthEvidence !== undefined) {
    if (!isPlainObject(realAuthEvidence)) {
      fail('realAuthorizationEvidence must be an object');
    }
    typedAuthEvidence = realAuthEvidence as unknown as RealPrivacyAcceptanceEvidence;
  }

  // Derive human authorization flag (only from valid structured object or receipt)
  let hasHumanAuth = false;
  if (typeof realUserAuth === 'boolean') {
    hasHumanAuth = realUserAuth;
  } else if (typedAuthEvidence) {
    hasHumanAuth = typedAuthEvidence.humanAuthorized === true;
  } else if (receipt?.realUserAuthorization === true) {
    hasHumanAuth = true;
  }

  // Derive deletion readback flag (only valid when receipt.action is privacy_deletion)
  let hasDeletionReadback = false;
  if (receipt && receipt.action === 'privacy_deletion' && receipt.physicalErasure === true) {
    if (typeof realDeletionReadback === 'boolean') {
      hasDeletionReadback = realDeletionReadback;
    } else if (typedAuthEvidence) {
      hasDeletionReadback = typedAuthEvidence.onSiteDeletionReadback === true;
    } else if (receipt.realDeletionReadback === true) {
      hasDeletionReadback = true;
    }
  }

  // Resolve evidence level and check mock prohibition
  const effectiveEvidenceLevel = evidenceLevel ?? (typedAuthEvidence ? typedAuthEvidence.evidenceLevel : undefined) ?? receipt?.evidenceLevel;
  if (effectiveEvidenceLevel === 'mock' || isMockExplicit) {
    hasHumanAuth = false;
    hasDeletionReadback = false;
  }

  const verified: string[] = [];
  if (receipt) {
    const isWithdrawal = receipt.action === 'withdrawal';
    verified.push(`回执校验：${isWithdrawal ? '逻辑撤回' : '隐私物理删除'} 回执格式合规 (ID: ${receipt.receiptId}, namespace: ${receipt.namespace}, target: ${receipt.targetId})`);
    if (isWithdrawal) {
      verified.push('语义区分：明确标识为撤回历史（保留旧版本与摘要），禁止把撤回称为物理删除');
      if (typeof realDeletionReadback === 'boolean' || typedAuthEvidence?.onSiteDeletionReadback === true) {
        verified.push('结构告警：撤回回执（withdrawal）不可关联物理删除读回证据，忽略调用方物理删除声明');
      }
    } else {
      verified.push('擦除语义：明确标识为隐私物理删除（physicalErasure=true），记录擦除版本位置');
    }
  }

  // Offline verification boundaries:
  // In pure offline context, passing receipt schema validation and self-reported options
  // does not substitute for on-site human authorization or durable storage erasure audit.
  // Hence closedLoop is strictly false and all required pending gates remain open regardless of self-reported flags.
  const pending: PrivacyDeletionPendingItem[] = [
    {
      item: 'human_user_privacy_authorization',
      description: '真人用户隐私授权与敏感范围审查（现场明确授权私人数据访问与擦除范围，严禁模型代签或自动放行）',
      status: 'unavailable',
      reason: PRIVACY_ACCEPTANCE_PENDING_REASON,
    },
    {
      item: 'on_site_deletion_readback',
      description: '删除现场物理读回与存储清零验证（核实持久化存储中已物理抹除，非仅图谱版本追加或逻辑撤回）',
      status: 'unavailable',
      reason: PRIVACY_ACCEPTANCE_PENDING_REASON,
    },
    {
      item: 'graph_dependency_erasure_integrity',
      description: '图谱依赖级联处理与断链校验（被删除节点所有后继依赖的清理与一致性核验，旧版本不混淆别名）',
      status: 'unavailable',
      reason: PRIVACY_ACCEPTANCE_PENDING_REASON,
    },
    {
      item: 'durable_storage_restart_verification',
      description: '持久化存储进程重启后现场读回（重启后被抹除数据不可恢复，合规性审计凭证完备）',
      status: 'unavailable',
      reason: PRIVACY_ACCEPTANCE_PENDING_REASON,
    },
    {
      item: 'cloud_boundary_and_leak_prevention',
      description: '云端与跨进程边界防泄露核验（私人正文绝不上传云端，错误回显与日志不泄露敏感数据）',
      status: 'unavailable',
      reason: PRIVACY_ACCEPTANCE_PENDING_REASON,
    },
  ];

  if (hasHumanAuth) {
    verified.push('调用方声明：提供自报真人授权字段（未进行现场真人独立验签，待真人验收）');
  }
  if (hasDeletionReadback) {
    verified.push('调用方声明：提供自报删除读回字段（未进行存储清零现场独立审计，待现场验收）');
  }

  const missingRequirements: string[] = [];
  const isPhysicalDeletion = receipt?.action === 'privacy_deletion' && receipt.physicalErasure === true;
  if (!isPhysicalDeletion && receipt) {
    missingRequirements.push('action_must_be_privacy_deletion_with_physical_erasure');
  }
  if (!hasHumanAuth) {
    missingRequirements.push('missing_human_user_privacy_authorization');
  }
  if (!hasDeletionReadback) {
    missingRequirements.push('missing_on_site_deletion_readback');
  }

  const structuralVerification: PrivacyDeletionStructuralVerification = {
    hasHumanAuth,
    hasDeletionReadback,
    isPhysicalDeletion: Boolean(isPhysicalDeletion),
    missingRequirements: Object.freeze(missingRequirements),
    fullyCovered: missingRequirements.length === 0,
  };

  return {
    closedLoop: false,
    status: 'unavailable',
    reason: PRIVACY_ACCEPTANCE_PENDING_REASON,
    pending,
    verified,
    limits: PRIVACY_ACCEPTANCE_LIMITS,
    receipt,
    deletionKind: receipt?.action,
    structuralVerification,
  };
}
