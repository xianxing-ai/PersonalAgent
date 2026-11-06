import {ProtocolError} from '@personal-agent/contracts';

export const PLAN_ID = 'notepad-live-acceptance';
export const PLAN_TITLE = 'Windows 记事本真机验收离线规划与契约校验';
export const NOTEPAD_LIVE_ACCEPTANCE_CAPABILITY = 'notepad.replace_text' as const;
export const NOTEPAD_LIVE_ACCEPTANCE_TOOL_NAME = 'computer.notepad.replace_text' as const;
export const NOTEPAD_LIVE_ACCEPTANCE_PENDING_REASON = '待真机验收' as const;
export const PENDING_REASON = NOTEPAD_LIVE_ACCEPTANCE_PENDING_REASON;

/**
 * 必需环境声明（依据 docs/modules/MOD-16-NOTEPAD-LIVE-ACCEPTANCE-PLAN-20261107.md §1/§2）
 */
export const REQUIRED_ENVIRONMENTS = ['windows_real_machine', 'rights_holder_or_human'];

/**
 * 验收步骤声明（依据 docs/modules/MOD-16-NOTEPAD-LIVE-ACCEPTANCE-PLAN-20261107.md §2.2）
 */
export const ACCEPTANCE_STEPS = [
  'f9_confirmation_gate：确认物理 F9 按键或受信操作者现场确认生效',
  'uia_write：由独立 WindowsHost 经 UI Automation 对前台单一已确认记事本编辑控件执行文本替换',
  'independent_readback：具备独立 UIA 读回摘要并计算 SHA-256 摘要核对一致',
  'policy_authorization：精确凭据/策略授权校验放行（exactGrantConsumed 或 policyDecision 为 allow）',
  'windows_host_pipe：受信管道通信与隔离日志读回（isolatedJournalReadback 核验）',
];

/**
 * 验收证据要求声明（依据 docs/modules/MOD-16-NOTEPAD-LIVE-ACCEPTANCE-PLAN-20261107.md §2.1）
 */
export const EVIDENCE_REQUIREMENTS = [
  'win32 平台原生记事本写入证据（含 capability、confirmationGate、targetRef 与 runId）',
  '独立 UIA 读回 SHA-256 摘要（readbackDigest）与 isolatedJournalReadback 审计日志',
];

/**
 * 默认待真机验收门控声明
 */
export const DEFAULT_PENDING_ITEMS = [
  'f9_confirmation_gate',
  'uia_write',
  'independent_readback',
  'policy_authorization',
  'windows_host_pipe',
];

export const NOTEPAD_LIVE_ACCEPTANCE_PENDING_GATES = Object.freeze([
  'f9_confirmation_gate',
  'uia_write',
  'independent_readback',
  'policy_authorization',
  'windows_host_pipe',
] as const);

export type NotepadLiveAcceptanceGate = (typeof NOTEPAD_LIVE_ACCEPTANCE_PENDING_GATES)[number];

export interface NotepadConfirmationGateEvidence {
  readonly confirmed: boolean;
  readonly gate?: string | undefined;
  readonly source?: string | undefined;
  readonly confirmedAt?: string | undefined;
  readonly targetRef?: string | undefined;
}

export interface NotepadReadbackSummary {
  readonly readbackDigest: string;
  readonly verified?: boolean | undefined;
  readonly verifiedAt?: string | undefined;
  readonly targetRef?: string | undefined;
  readonly source?: string | undefined;
}

export interface NotepadLiveEvidence {
  readonly platform: 'win32';
  readonly capability: typeof NOTEPAD_LIVE_ACCEPTANCE_CAPABILITY | typeof NOTEPAD_LIVE_ACCEPTANCE_TOOL_NAME;
  readonly confirmationGate: NotepadConfirmationGateEvidence;
  readonly readbackSummary?: NotepadReadbackSummary | string | undefined;
  readonly readbackDigest?: string | undefined;
  readonly source?: 'windows-uia' | string | undefined;
  readonly nativeReadbackVerified?: boolean | undefined;
  readonly isolatedJournalReadback?: boolean | undefined;
  readonly exactGrantConsumed?: boolean | undefined;
  readonly taskId?: string | undefined;
  readonly runId?: string | undefined;
  readonly targetRef?: string | undefined;
  readonly evidenceRef?: string | undefined;
  readonly profile?: string | undefined;
  readonly mock?: boolean | undefined;
  readonly isMock?: boolean | undefined;
  readonly evidenceLevel?: 'mock' | 'conditional' | 'verified' | undefined;
  readonly [key: string]: unknown;
}

export interface PlanNotepadLiveAcceptanceOptions {
  readonly platform?: string | undefined;
  readonly evidence?: unknown | undefined;
  readonly hasRealMachineEvidence?: boolean | undefined;
  readonly mock?: boolean | undefined;
  readonly isMock?: boolean | undefined;
  readonly evidenceLevel?: 'mock' | 'conditional' | 'verified' | undefined;
  readonly closedLoop?: boolean | undefined;
  readonly requiredGates?: readonly NotepadLiveAcceptanceGate[] | undefined;
  readonly customPendingItems?: readonly NotepadLiveAcceptanceGate[] | undefined;
}

export interface NotepadLiveAcceptancePlan {
  readonly profile: string;
  readonly platform: string;
  readonly capability: string;
  readonly status: 'unavailable' | 'verified';
  readonly closedLoop: boolean;
  readonly reason: string;
  readonly pending: readonly NotepadLiveAcceptanceGate[];
  readonly verifiedGates: readonly NotepadLiveAcceptanceGate[];
  readonly evidenceSummary?: {
    readonly taskId?: string | undefined;
    readonly runId?: string | undefined;
    readonly targetRef?: string | undefined;
    readonly evidenceRef?: string | undefined;
    readonly readbackDigest?: string | undefined;
    readonly confirmedAt?: string | undefined;
    readonly confirmationSource?: string | undefined;
  } | undefined;
  readonly limits: readonly string[];
}

export const NOTEPAD_LIVE_ACCEPTANCE_LIMITS = Object.freeze([
  '本规划为 MOD-16 Windows 记事本离线验收契约与规划工具，未执行 Windows 真实进程写入',
  '非 Windows (win32) 平台、无实机执行凭据或 mock 模式下，强制 closedLoop=false 且 status="unavailable"',
  '禁止使用合成回执、Fake 桩或单元测试断言冒充 Windows F9 确认、UIA 写入及物理独立读回真机闭环',
  '完整闭环需在普通用户 Windows 会话中执行 tests/manual/windows/notepad-full-access-acceptance.mjs 现场核验',
] as const);

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ProtocolError('INVALID_ARGUMENT', message);
}

function extractReadbackDigest(evidence: NotepadLiveEvidence): string | undefined {
  if (typeof evidence.readbackDigest === 'string' && evidence.readbackDigest.trim().length > 0) {
    return evidence.readbackDigest.trim();
  }
  if (typeof evidence.readbackSummary === 'string' && evidence.readbackSummary.trim().length > 0) {
    return evidence.readbackSummary.trim();
  }
  if (isObject(evidence.readbackSummary)) {
    const summary = evidence.readbackSummary as Record<string, unknown>;
    const digest = summary.readbackDigest ?? summary.digest ?? summary.textDigest;
    if (typeof digest === 'string' && digest.trim().length > 0) {
      return digest.trim();
    }
  }
  return undefined;
}

/**
 * Validates that the provided value strictly conforms to the expected shape of
 * Windows Notepad real machine execution evidence.
 *
 * Requirements:
 * - Must be a non-null object.
 * - Platform must be strictly "win32".
 * - Capability must be "notepad.replace_text" or "computer.notepad.replace_text".
 * - confirmationGate must be present, non-null object, with confirmed: true.
 * - Independent readback summary or digest must be present and non-empty.
 * - Prohibits mock evidence (mock / isMock === true, evidenceLevel === 'mock').
 *
 * Throws ProtocolError('INVALID_ARGUMENT', message) on validation failure.
 */
export function assertNotepadLiveEvidence(value: unknown): asserts value is NotepadLiveEvidence {
  if (!isObject(value)) {
    fail('Notepad live evidence must be a non-null object');
  }

  if (value.mock === true || value.isMock === true || value.evidenceLevel === 'mock') {
    fail('Mock evidence cannot be asserted as Notepad live evidence');
  }

  if (value.platform !== 'win32') {
    fail(`Notepad live evidence platform must be "win32" (received: ${String(value.platform)})`);
  }

  if (
    value.capability !== NOTEPAD_LIVE_ACCEPTANCE_CAPABILITY &&
    value.capability !== NOTEPAD_LIVE_ACCEPTANCE_TOOL_NAME
  ) {
    fail(
      `Notepad live evidence capability must be "${NOTEPAD_LIVE_ACCEPTANCE_CAPABILITY}" or "${NOTEPAD_LIVE_ACCEPTANCE_TOOL_NAME}" (received: ${String(value.capability)})`,
    );
  }

  if (!isObject(value.confirmationGate)) {
    fail('Notepad live evidence confirmationGate must be a non-null object');
  }

  const gate = value.confirmationGate as Record<string, unknown>;
  if (gate.confirmed !== true) {
    fail('Notepad live evidence confirmationGate.confirmed must be strictly true');
  }

  if (gate.confirmedAt !== undefined) {
    if (
      typeof gate.confirmedAt !== 'string' ||
      !ISO_TIMESTAMP_PATTERN.test(gate.confirmedAt) ||
      Number.isNaN(Date.parse(gate.confirmedAt))
    ) {
      fail('Notepad confirmation timestamp must be a valid UTC ISO string');
    }
  }

  if (gate.source !== undefined && (typeof gate.source !== 'string' || gate.source.trim().length === 0)) {
    fail('Notepad confirmationGate.source must be a non-empty string when provided');
  }

  if (gate.gate !== undefined && (typeof gate.gate !== 'string' || gate.gate.trim().length === 0)) {
    fail('Notepad confirmationGate.gate must be a non-empty string when provided');
  }

  const digest = extractReadbackDigest(value as unknown as NotepadLiveEvidence);
  if (!digest) {
    fail('Notepad live evidence must contain readbackSummary or readbackDigest');
  }

  if (value.readbackSummary !== undefined) {
    if (typeof value.readbackSummary === 'string') {
      if (value.readbackSummary.trim().length === 0) {
        fail('Notepad live evidence readbackSummary string must not be empty');
      }
    } else if (isObject(value.readbackSummary)) {
      const summary = value.readbackSummary as Record<string, unknown>;
      const innerDigest = summary.readbackDigest ?? summary.digest ?? summary.textDigest;
      if (typeof innerDigest !== 'string' || innerDigest.trim().length === 0) {
        fail('Notepad live evidence readbackSummary object must contain a non-empty digest string');
      }
    } else {
      fail('Notepad live evidence readbackSummary must be a string or object');
    }
  }

  if (value.source !== undefined) {
    if (typeof value.source !== 'string' || value.source.trim().length === 0) {
      fail('Notepad live evidence source must be a non-empty string');
    }
  }

  if (value.targetRef !== undefined && (typeof value.targetRef !== 'string' || value.targetRef.trim().length === 0)) {
    fail('Notepad live evidence targetRef must be a non-empty string');
  }

  if (value.taskId !== undefined && (typeof value.taskId !== 'string' || value.taskId.trim().length === 0)) {
    fail('Notepad live evidence taskId must be a non-empty string');
  }

  if (value.runId !== undefined && (typeof value.runId !== 'string' || value.runId.trim().length === 0)) {
    fail('Notepad live evidence runId must be a non-empty string');
  }

  if (value.evidenceRef !== undefined && (typeof value.evidenceRef !== 'string' || value.evidenceRef.trim().length === 0)) {
    fail('Notepad live evidence evidenceRef must be a non-empty string');
  }
}

/**
 * Returns true if the provided value conforms to NotepadLiveEvidence, false otherwise.
 */
export function isNotepadLiveEvidence(value: unknown): value is NotepadLiveEvidence {
  try {
    assertNotepadLiveEvidence(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Evaluates whether Windows Notepad execution has achieved real physical closed loop.
 *
 * Rules:
 * - Non-win32 platform -> closedLoop: false, status: 'unavailable', reason: '待真机验收'.
 * - Missing real machine evidence (no evidence or hasRealMachineEvidence !== true) -> closedLoop: false.
 * - Mock mode (options or evidence marked as mock) -> closedLoop: false.
 * - Prohibits fake success: caller cannot override closedLoop: true without passing all real machine gates.
 *
 * Only when running on win32 (or platform: 'win32') with verified real machine evidence
 * satisfying all required acceptance gates (F9 confirmation, UIA write, independent readback,
 * policy authorization, host pipe) will closedLoop be true.
 */
export function planNotepadLiveAcceptance(
  options: PlanNotepadLiveAcceptanceOptions = {},
): NotepadLiveAcceptancePlan {
  const targetPlatform = options.platform ?? process.platform;
  const isWin32 = targetPlatform === 'win32';
  const isMock =
    options.mock === true ||
    options.isMock === true ||
    options.evidenceLevel === 'mock' ||
    (isObject(options.evidence) &&
      (options.evidence.mock === true ||
        options.evidence.isMock === true ||
        options.evidence.evidenceLevel === 'mock'));

  const hasReal = options.hasRealMachineEvidence === true;
  const requiredGates = options.requiredGates ?? NOTEPAD_LIVE_ACCEPTANCE_PENDING_GATES;

  // Fail-closed gate: non-win32, mock, or missing real machine evidence
  if (!isWin32 || isMock || !hasReal || options.evidence === undefined) {
    const pendingList: NotepadLiveAcceptanceGate[] = [...requiredGates];
    if (options.customPendingItems) {
      for (const item of options.customPendingItems) {
        if (!pendingList.includes(item)) {
          pendingList.push(item);
        }
      }
    }

    return Object.freeze({
      profile: 'huawei_ict_agentarts',
      platform: targetPlatform,
      capability: NOTEPAD_LIVE_ACCEPTANCE_CAPABILITY,
      status: 'unavailable',
      closedLoop: false,
      reason: NOTEPAD_LIVE_ACCEPTANCE_PENDING_REASON,
      pending: Object.freeze(pendingList),
      verifiedGates: Object.freeze([]),
      limits: NOTEPAD_LIVE_ACCEPTANCE_LIMITS,
    });
  }

  // Real evidence was supplied on win32 - validate structural shape
  assertNotepadLiveEvidence(options.evidence);
  const evidence = options.evidence as NotepadLiveEvidence;

  const verified: NotepadLiveAcceptanceGate[] = [];
  const pending: NotepadLiveAcceptanceGate[] = [];

  // Check Gate 1: F9 Confirmation Gate
  if (evidence.confirmationGate?.confirmed === true) {
    verified.push('f9_confirmation_gate');
  } else {
    pending.push('f9_confirmation_gate');
  }

  // Check Gate 2: UIA Write Execution
  if (evidence.source === 'windows-uia' || evidence.uiaWriteVerified === true) {
    verified.push('uia_write');
  } else {
    pending.push('uia_write');
  }

  // Check Gate 3: Independent Readback
  const digest = extractReadbackDigest(evidence);
  const readbackVerified =
    evidence.nativeReadbackVerified === true ||
    (isObject(evidence.readbackSummary) &&
      (evidence.readbackSummary as Record<string, unknown>).verified === true);

  if (digest && readbackVerified) {
    verified.push('independent_readback');
  } else {
    pending.push('independent_readback');
  }

  // Check Gate 4: Policy Authorization
  if (evidence.exactGrantConsumed === true || evidence.policyDecision === 'allow') {
    verified.push('policy_authorization');
  } else {
    pending.push('policy_authorization');
  }

  // Check Gate 5: Windows Host Pipe
  if (evidence.isolatedJournalReadback === true || evidence.pipeVerified === true) {
    verified.push('windows_host_pipe');
  } else {
    pending.push('windows_host_pipe');
  }

  if (options.customPendingItems) {
    for (const item of options.customPendingItems) {
      if (!pending.includes(item)) {
        pending.push(item);
      }
    }
  }

  const isClosedLoop = pending.length === 0;

  return Object.freeze({
    profile: typeof evidence.profile === 'string' ? evidence.profile : 'huawei_ict_agentarts',
    platform: targetPlatform,
    capability: evidence.capability,
    status: isClosedLoop ? 'verified' : 'unavailable',
    closedLoop: isClosedLoop,
    reason: isClosedLoop ? '已通过 Windows 真机验收' : NOTEPAD_LIVE_ACCEPTANCE_PENDING_REASON,
    pending: Object.freeze(pending),
    verifiedGates: Object.freeze(verified),
    evidenceSummary: Object.freeze({
      taskId: typeof evidence.taskId === 'string' ? evidence.taskId : undefined,
      runId: typeof evidence.runId === 'string' ? evidence.runId : undefined,
      targetRef: typeof evidence.targetRef === 'string' ? evidence.targetRef : undefined,
      evidenceRef: typeof evidence.evidenceRef === 'string' ? evidence.evidenceRef : undefined,
      readbackDigest: digest,
      confirmedAt: evidence.confirmationGate?.confirmedAt,
      confirmationSource: evidence.confirmationGate?.source ?? evidence.confirmationGate?.gate,
    }),
    limits: NOTEPAD_LIVE_ACCEPTANCE_LIMITS,
  });
}
