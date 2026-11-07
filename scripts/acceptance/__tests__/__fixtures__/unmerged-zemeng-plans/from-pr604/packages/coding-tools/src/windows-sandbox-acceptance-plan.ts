import {ProtocolError} from '@personal-agent/contracts';
import type {NativeSandboxBackend, SandboxExecutionResult} from './native-sandbox.js';

export const PLAN_ID = 'windows-sandbox-acceptance-plan';
export const PLAN_TITLE = 'Windows 原生沙箱（windows-psec）真机验收离线规划与契约校验';
export const WINDOWS_SANDBOX_ACCEPTANCE_BACKEND = 'windows-psec' as const;
export const WINDOWS_SANDBOX_ACCEPTANCE_CAPABILITY = 'workspace.run_allowed_command' as const;
export const WINDOWS_SANDBOX_ACCEPTANCE_PENDING_REASON = '待真机验收' as const;
export const PENDING_REASON = WINDOWS_SANDBOX_ACCEPTANCE_PENDING_REASON;

/**
 * 必需环境声明（依据 docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md §1/§2）
 */
export const REQUIRED_ENVIRONMENTS = ['windows_real_machine'];

/**
 * 验收步骤声明（依据 docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md §2.2）
 */
export const ACCEPTANCE_STEPS = [
  'helper_attestation：辅助进程可信身份与文件 SHA-256 Pin 核验通过',
  'psec_appcontainer_boundary：AppContainer 隔离生效且 enforced === true',
  'job_object_containment：JobObject 容器锁定且子孙进程均随 helper 终止（stopped === true）',
  'filesystem_isolation：读写根受限、副作用可控且符号链接逃逸受阻',
  'network_deny_guard：网络连接在沙箱内部被内核拦截拒绝',
  'policy_binding：参数绑定、任务引用及单次授权已被确实验证',
];

/**
 * 验收证据要求声明（依据 docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md §2.1）
 */
export const EVIDENCE_REQUIREMENTS = [
  'win32 平台 windows-psec 原生沙箱执行回执（含 helperPath、helperSha256、helperFilesSha256、enforced=true 与 outcome）',
  '辅助进程隔离审计日志与文件系统/网络内核级拦截读回证据',
];

/**
 * 默认待真机验收门控声明
 */
export const DEFAULT_PENDING_ITEMS = [
  'helper_attestation',
  'psec_appcontainer_boundary',
  'job_object_containment',
  'filesystem_isolation',
  'network_deny_guard',
  'policy_binding',
];

export const WINDOWS_SANDBOX_ACCEPTANCE_PENDING_GATES = Object.freeze([
  'helper_attestation',
  'psec_appcontainer_boundary',
  'job_object_containment',
  'filesystem_isolation',
  'network_deny_guard',
  'policy_binding',
] as const);

export type WindowsSandboxAcceptanceGate = (typeof WINDOWS_SANDBOX_ACCEPTANCE_PENDING_GATES)[number];

export interface WindowsSandboxHelperAttestation {
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly helperFilesSha256: Readonly<Record<string, string>>;
  readonly attested?: boolean | undefined;
}

export interface WindowsSandboxEvidence {
  readonly platform: 'win32';
  readonly backend: typeof WINDOWS_SANDBOX_ACCEPTANCE_BACKEND;
  readonly enforced: boolean;
  readonly outcome: SandboxExecutionResult['outcome'];
  readonly executionStarted: boolean;
  readonly stopped: boolean;
  readonly helper?: WindowsSandboxHelperAttestation | undefined;
  readonly helperPath?: string | undefined;
  readonly helperSha256?: string | undefined;
  readonly helperFilesSha256?: Readonly<Record<string, string>> | undefined;
  readonly exitCode?: number | null | undefined;
  readonly signal?: string | null | undefined;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
  readonly sideEffects?: SandboxExecutionResult['sideEffects'] | undefined;
  readonly reason?: string | undefined;
  readonly capability?: string | undefined;
  readonly profile?: string | Record<string, unknown> | undefined;
  readonly sandboxRef?: string | undefined;
  readonly taskId?: string | undefined;
  readonly runId?: string | undefined;
  readonly authorizationRef?: string | undefined;
  readonly argumentsDigest?: string | undefined;
  readonly evidenceRef?: string | undefined;
  readonly targetRef?: string | undefined;
  readonly mock?: boolean | undefined;
  readonly isMock?: boolean | undefined;
  readonly synthetic?: boolean | undefined;
  readonly evidenceLevel?: 'mock' | 'conditional' | 'verified' | undefined;
  readonly appContainer?: boolean | undefined;
  readonly psecVerified?: boolean | undefined;
  readonly jobObjectVerified?: boolean | undefined;
  readonly descendantsStopped?: boolean | undefined;
  readonly filesystemVerified?: boolean | undefined;
  readonly networkDenyVerified?: boolean | undefined;
  readonly networkBlocked?: boolean | undefined;
  readonly networkVerified?: boolean | undefined;
  readonly bindingVerified?: boolean | undefined;
  readonly assertCurrentVerified?: boolean | undefined;
  readonly exactGrantConsumed?: boolean | undefined;
  readonly helperVerified?: boolean | undefined;
  readonly [key: string]: unknown;
}

export interface PlanWindowsSandboxAcceptanceOptions {
  readonly platform?: string | undefined;
  readonly helperPath?: string | undefined;
  readonly helperAvailable?: boolean | undefined;
  readonly evidence?: unknown | undefined;
  readonly hasRealMachineEvidence?: boolean | undefined;
  readonly mock?: boolean | undefined;
  readonly isMock?: boolean | undefined;
  readonly evidenceLevel?: 'mock' | 'conditional' | 'verified' | undefined;
  readonly closedLoop?: boolean | undefined;
  readonly requiredGates?: readonly WindowsSandboxAcceptanceGate[] | undefined;
  readonly customPendingItems?: readonly WindowsSandboxAcceptanceGate[] | undefined;
}

export interface WindowsSandboxStructuralVerification {
  readonly verifiedGates: readonly WindowsSandboxAcceptanceGate[];
  readonly missingGates: readonly WindowsSandboxAcceptanceGate[];
  readonly missingFields: readonly string[];
  readonly fullyCovered: boolean;
  readonly pinAttestationGap: string;
}

export interface WindowsSandboxAcceptancePlan {
  readonly profile: string;
  readonly platform: string;
  readonly backend: string;
  readonly capability: string;
  readonly status: 'unavailable' | 'verified';
  readonly closedLoop: boolean;
  readonly reason: string;
  readonly pending: readonly WindowsSandboxAcceptanceGate[];
  readonly verifiedGates: readonly WindowsSandboxAcceptanceGate[];
  readonly structuralGates?: readonly WindowsSandboxAcceptanceGate[] | undefined;
  readonly structuralVerification?: WindowsSandboxStructuralVerification | undefined;
  readonly evidenceSummary?: {
    readonly taskId?: string | undefined;
    readonly runId?: string | undefined;
    readonly sandboxRef?: string | undefined;
    readonly authorizationRef?: string | undefined;
    readonly helperSha256?: string | undefined;
    readonly helperPath?: string | undefined;
    readonly outcome?: string | undefined;
    readonly exitCode?: number | null | undefined;
    readonly enforced?: boolean | undefined;
  } | undefined;
  readonly limits: readonly string[];
}

export const WINDOWS_SANDBOX_ACCEPTANCE_LIMITS = Object.freeze([
  '本规划为 MOD-18 Windows 原生沙箱（windows-psec）离线验收契约与规划工具，未启动真实 WindowsJobProcessHost 辅助进程',
  '非 Windows (win32) 平台、辅助进程不可用、无实机执行凭据或 mock 模式下，强制 closedLoop=false 且 status="unavailable"',
  '禁止使用合成回执、Fake 桩或单元测试断言冒充 Windows AppContainer 隔离、JobObject 约束及网络拦截真机闭环',
  '完整闭环需在普通用户 Windows 会话中执行真实辅助进程并取得现场核验证据',
] as const);

const REQUIRED_HELPER_FILES = Object.freeze([
  'WindowsJobProcessHost.dll',
  'WindowsJobProcessHost.deps.json',
  'WindowsJobProcessHost.runtimeconfig.json',
] as const);

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const HELPER_EXE_NAME_PATTERN = /(?:^|[\\/])WindowsJobProcessHost\.exe$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ProtocolError('INVALID_ARGUMENT', message);
}

function extractHelperInfo(evidence: Record<string, unknown>): WindowsSandboxHelperAttestation | undefined {
  if (isObject(evidence.helper)) {
    return evidence.helper as unknown as WindowsSandboxHelperAttestation;
  }
  if (isObject(evidence.helperAttestation)) {
    return evidence.helperAttestation as unknown as WindowsSandboxHelperAttestation;
  }
  if (isObject(evidence.helperIdentity)) {
    return evidence.helperIdentity as unknown as WindowsSandboxHelperAttestation;
  }
  if (typeof evidence.helperPath === 'string' && typeof evidence.helperSha256 === 'string') {
    return {
      helperPath: evidence.helperPath,
      helperSha256: evidence.helperSha256,
      helperFilesSha256: isObject(evidence.helperFilesSha256)
        ? (evidence.helperFilesSha256 as Record<string, string>)
        : {},
      attested: typeof evidence.helperVerified === 'boolean' ? evidence.helperVerified : undefined,
    };
  }
  return undefined;
}

/**
 * Validates that the provided value strictly conforms to the expected shape of
 * Windows Native Sandbox (windows-psec) real machine execution evidence.
 *
 * Requirements:
 * - Must be a non-null object.
 * - Platform must be strictly "win32".
 * - Backend must be strictly "windows-psec".
 * - Outcome must be a valid SandboxExecutionResult outcome ('exited', 'cancelled', 'timeout', 'unknown', 'unavailable').
 * - Enforced must be strictly boolean and true for verified live sandbox execution.
 * - Execution lifecycle flags (executionStarted, stopped) must be booleans.
 * - Helper attestation must point to WindowsJobProcessHost.exe with valid 64-char hex SHA-256
 *   and valid hashes for required helper dependency files (dll, deps.json, runtimeconfig.json).
 * - Prohibits mock/synthetic evidence (mock / isMock === true, evidenceLevel === 'mock', synthetic === true).
 *
 * Throws ProtocolError('INVALID_ARGUMENT', message) on validation failure.
 */
export function assertWindowsSandboxEvidence(value: unknown): asserts value is WindowsSandboxEvidence {
  if (!isObject(value)) {
    fail('Windows sandbox evidence must be a non-null object');
  }

  if (
    value.mock === true ||
    value.isMock === true ||
    value.synthetic === true ||
    value.evidenceLevel === 'mock'
  ) {
    fail('Mock evidence cannot be asserted as Windows sandbox live evidence');
  }

  if (value.platform !== 'win32') {
    fail(`Windows sandbox live evidence platform must be "win32" (received: ${String(value.platform)})`);
  }

  if (value.backend !== WINDOWS_SANDBOX_ACCEPTANCE_BACKEND) {
    fail(`Windows sandbox live evidence backend must be "${WINDOWS_SANDBOX_ACCEPTANCE_BACKEND}" (received: ${String(value.backend)})`);
  }

  if (typeof value.enforced !== 'boolean') {
    fail('Windows sandbox live evidence enforced must be a boolean');
  }

  if (value.enforced !== true) {
    fail('Windows sandbox live evidence enforced must be strictly true');
  }

  const validOutcomes = ['exited', 'cancelled', 'timeout', 'unknown', 'unavailable'];
  if (typeof value.outcome !== 'string' || !validOutcomes.includes(value.outcome)) {
    fail(`Windows sandbox live evidence outcome must be a valid outcome (received: ${String(value.outcome)})`);
  }

  if (typeof value.executionStarted !== 'boolean') {
    fail('Windows sandbox live evidence executionStarted must be a boolean');
  }

  if (typeof value.stopped !== 'boolean') {
    fail('Windows sandbox live evidence stopped must be a boolean');
  }

  if (value.sideEffects !== undefined) {
    if (!['none', 'possible', 'unknown'].includes(String(value.sideEffects))) {
      fail('Windows sandbox live evidence sideEffects must be "none", "possible", or "unknown"');
    }
  }

  if (value.exitCode !== undefined && value.exitCode !== null && !Number.isSafeInteger(value.exitCode)) {
    fail('Windows sandbox live evidence exitCode must be an integer or null');
  }

  // Validate helper attestation
  const helper = extractHelperInfo(value);
  if (!helper || !isObject(helper)) {
    fail('Windows sandbox live evidence must contain helper attestation (helperPath, helperSha256, helperFilesSha256)');
  }

  if (typeof helper.helperPath !== 'string' || !HELPER_EXE_NAME_PATTERN.test(helper.helperPath)) {
    fail('Windows sandbox helperPath must point to WindowsJobProcessHost.exe');
  }

  if (typeof helper.helperSha256 !== 'string' || !SHA256_HEX_PATTERN.test(helper.helperSha256)) {
    fail('Windows sandbox helperSha256 must be a 64-character hex string');
  }

  if (!isObject(helper.helperFilesSha256)) {
    fail('Windows sandbox helperFilesSha256 must be a non-null object');
  }

  for (const fileName of REQUIRED_HELPER_FILES) {
    const pin = (helper.helperFilesSha256 as Record<string, unknown>)[fileName];
    if (typeof pin !== 'string' || !SHA256_HEX_PATTERN.test(pin)) {
      fail(`Windows sandbox helperFilesSha256 must include a valid 64-character hex digest for "${fileName}"`);
    }
  }

  if (value.argumentsDigest !== undefined) {
    if (typeof value.argumentsDigest !== 'string' || !SHA256_HEX_PATTERN.test(value.argumentsDigest)) {
      fail('Windows sandbox live evidence argumentsDigest must be a 64-character hex string');
    }
  }

  if (value.taskId !== undefined && (typeof value.taskId !== 'string' || value.taskId.trim().length === 0)) {
    fail('Windows sandbox live evidence taskId must be a non-empty string when provided');
  }

  if (value.runId !== undefined && (typeof value.runId !== 'string' || value.runId.trim().length === 0)) {
    fail('Windows sandbox live evidence runId must be a non-empty string when provided');
  }

  if (value.sandboxRef !== undefined && (typeof value.sandboxRef !== 'string' || value.sandboxRef.trim().length === 0)) {
    fail('Windows sandbox live evidence sandboxRef must be a non-empty string when provided');
  }

  if (value.authorizationRef !== undefined && (typeof value.authorizationRef !== 'string' || value.authorizationRef.trim().length === 0)) {
    fail('Windows sandbox live evidence authorizationRef must be a non-empty string when provided');
  }

  if (value.evidenceRef !== undefined && (typeof value.evidenceRef !== 'string' || value.evidenceRef.trim().length === 0)) {
    fail('Windows sandbox live evidence evidenceRef must be a non-empty string when provided');
  }

  if (value.targetRef !== undefined && (typeof value.targetRef !== 'string' || value.targetRef.trim().length === 0)) {
    fail('Windows sandbox live evidence targetRef must be a non-empty string when provided');
  }
}

/**
 * Returns true if the provided value conforms to WindowsSandboxEvidence, false otherwise.
 */
export function isWindowsSandboxEvidence(value: unknown): value is WindowsSandboxEvidence {
  try {
    assertWindowsSandboxEvidence(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Evaluates whether Windows Native Sandbox (windows-psec) execution has achieved real physical closed loop.
 *
 * Rules:
 * - Non-win32 platform -> closedLoop is false, status is 'unavailable', reason is '待真机验收'.
 * - Helper unavailable (explicitly or invalid path) -> closedLoop is false, status is 'unavailable', reason is '待真机验收'.
 * - Missing real machine evidence (no evidence or hasRealMachineEvidence !== true) -> closedLoop is false.
 * - Mock mode (options or evidence marked as mock) -> closedLoop is false.
 * - Prohibits fake success: caller cannot override closedLoop without passing all real machine gates.
 * - Offline safety: does NOT launch real helper process, does NOT connect to network.
 *
 * Real physical closed loop requires execution in genuine Windows environment with verified helper.
 */
export function planWindowsSandboxAcceptance(
  options: PlanWindowsSandboxAcceptanceOptions = {},
): WindowsSandboxAcceptancePlan {
  const targetPlatform = options.platform ?? process.platform;
  const isWin32 = targetPlatform === 'win32';
  const isMock =
    options.mock === true ||
    options.isMock === true ||
    options.evidenceLevel === 'mock' ||
    (isObject(options.evidence) &&
      (options.evidence.mock === true ||
        options.evidence.isMock === true ||
        options.evidence.synthetic === true ||
        options.evidence.evidenceLevel === 'mock'));

  const hasReal = options.hasRealMachineEvidence === true;
  const helperAvailable =
    options.helperAvailable !== false &&
    (options.helperPath === undefined || HELPER_EXE_NAME_PATTERN.test(options.helperPath));
  const requiredGates = options.requiredGates ?? WINDOWS_SANDBOX_ACCEPTANCE_PENDING_GATES;

  const verified: WindowsSandboxAcceptanceGate[] = [];
  const pending: WindowsSandboxAcceptanceGate[] = [];
  let evidence: WindowsSandboxEvidence | undefined;
  let helper: WindowsSandboxHelperAttestation | undefined;
  let structuralVerificationResult: WindowsSandboxStructuralVerification | undefined;

  // Fail-closed gate: non-win32, helper unavailable, mock, or missing real machine evidence
  if (!isWin32 || !helperAvailable || isMock || !hasReal || options.evidence === undefined) {
    for (const g of requiredGates) {
      pending.push(g);
    }
  } else {
    // Real evidence was supplied on win32 - validate structural shape
    assertWindowsSandboxEvidence(options.evidence);
    evidence = options.evidence as WindowsSandboxEvidence;
    helper = extractHelperInfo(evidence);

    const structuralGates: WindowsSandboxAcceptanceGate[] = [];
    const missingGates: WindowsSandboxAcceptanceGate[] = [];
    const missingFields: string[] = [];

    // Gate 1: Helper Attestation (No outcome: 'exited' short-circuit!)
    // 依据事实核验：仅对 helper 及其 3 依赖文件进行格式与非空 64-hex SHA-256 结构校验，
    // 未比对固定受信 Pin 清单（代码库中无硬编码 Pin 清单，实机凭证依赖带签名清单的现场读回）。
    const gate1Passed = Boolean(
      helper &&
      helper.helperSha256 &&
      helper.helperFilesSha256 &&
      REQUIRED_HELPER_FILES.every(file => typeof helper?.helperFilesSha256?.[file] === 'string') &&
      (evidence.helperVerified === true || helper.attested === true)
    );
    if (gate1Passed) {
      structuralGates.push('helper_attestation');
    } else {
      missingGates.push('helper_attestation');
      missingFields.push('helper_attestation_hash_or_verified');
    }

    // Gate 2: PSEC AppContainer Boundary (No outcome: 'exited' short-circuit!)
    const gate2Passed = Boolean(
      evidence.backend === 'windows-psec' &&
      evidence.enforced === true &&
      (evidence.appContainer === true || evidence.psecVerified === true)
    );
    if (gate2Passed) {
      structuralGates.push('psec_appcontainer_boundary');
    } else {
      missingGates.push('psec_appcontainer_boundary');
      missingFields.push('appContainer_or_psecVerified');
    }

    // Gate 3: JobObject Containment & Process Lifecycle (No outcome: 'exited' short-circuit!)
    const gate3Passed = Boolean(
      evidence.stopped === true &&
      (evidence.jobObjectVerified === true || evidence.descendantsStopped === true)
    );
    if (gate3Passed) {
      structuralGates.push('job_object_containment');
    } else {
      missingGates.push('job_object_containment');
      missingFields.push('jobObjectVerified_or_descendantsStopped');
    }

    // Gate 4: Filesystem Isolation (Strictly sideEffects === 'none' AND filesystemVerified === true)
    const gate4Passed = Boolean(
      evidence.sideEffects === 'none' &&
      evidence.filesystemVerified === true
    );
    if (gate4Passed) {
      structuralGates.push('filesystem_isolation');
    } else {
      missingGates.push('filesystem_isolation');
      missingFields.push('filesystemVerified_none_sideEffects');
    }

    // Gate 5: Network Deny Guard (No outcome: 'exited' short-circuit!)
    const gate5Passed = Boolean(
      evidence.networkDenyVerified === true ||
      evidence.networkBlocked === true ||
      evidence.networkVerified === true
    );
    if (gate5Passed) {
      structuralGates.push('network_deny_guard');
    } else {
      missingGates.push('network_deny_guard');
      missingFields.push('networkDenyVerified');
    }

    // Gate 6: Policy Binding & Single-use Authorization (Strictly requires exactGrantConsumed === true)
    const gate6Passed = Boolean(
      evidence.exactGrantConsumed === true &&
      (evidence.bindingVerified === true ||
       evidence.assertCurrentVerified === true ||
       (typeof evidence.authorizationRef === 'string' && evidence.authorizationRef.length > 0))
    );
    if (gate6Passed) {
      structuralGates.push('policy_binding');
    } else {
      missingGates.push('policy_binding');
      missingFields.push('exactGrantConsumed');
    }

    // 在离线/纯模拟环境下，结构校验通过不替代物理 Windows 会话中 WindowsJobProcessHost 的内核级沙箱与网络拦截执行。
    // 全部 6 项实机验收门控无条件保持在 pending 中，绝不因自报或模拟结构齐全而消失！
    for (const g of requiredGates) {
      pending.push(g);
    }

    structuralVerificationResult = {
      verifiedGates: Object.freeze(structuralGates),
      missingGates: Object.freeze(missingGates),
      missingFields: Object.freeze(missingFields),
      fullyCovered: missingGates.length === 0,
      pinAttestationGap: 'helper 及其依赖文件 hash 仅执行结构存在性与格式校验，未与固定受信 Pin 清单比对，实机受信依赖真实 Windows 运行环境现场签发读回',
    };
  }

  if (options.customPendingItems) {
    for (const item of options.customPendingItems) {
      if (!pending.includes(item)) {
        pending.push(item);
      }
    }
  }

  // Real sandbox execution authority boundary:
  // Offline structure assertions and self-reported flags do NOT substitute for live helper execution
  // and Windows AppContainer OS kernel containment. Full closed loop remains false.
  return Object.freeze({
    profile: typeof evidence?.profile === 'string' ? evidence.profile : 'huawei_ict_agentarts',
    platform: targetPlatform,
    backend: evidence?.backend ?? WINDOWS_SANDBOX_ACCEPTANCE_BACKEND,
    capability: typeof evidence?.capability === 'string' ? evidence.capability : WINDOWS_SANDBOX_ACCEPTANCE_CAPABILITY,
    status: 'unavailable',
    closedLoop: false,
    reason: WINDOWS_SANDBOX_ACCEPTANCE_PENDING_REASON,
    pending: Object.freeze(pending),
    verifiedGates: Object.freeze(verified),
    structuralGates: structuralVerificationResult ? structuralVerificationResult.verifiedGates : undefined,
    structuralVerification: structuralVerificationResult,
    evidenceSummary: evidence ? Object.freeze({
      taskId: typeof evidence.taskId === 'string' ? evidence.taskId : undefined,
      runId: typeof evidence.runId === 'string' ? evidence.runId : undefined,
      sandboxRef: typeof evidence.sandboxRef === 'string' ? evidence.sandboxRef : undefined,
      authorizationRef: typeof evidence.authorizationRef === 'string' ? evidence.authorizationRef : undefined,
      helperSha256: helper?.helperSha256,
      helperPath: helper?.helperPath,
      outcome: evidence.outcome,
      exitCode: evidence.exitCode,
      enforced: evidence.enforced,
    }) : undefined,
    limits: WINDOWS_SANDBOX_ACCEPTANCE_LIMITS,
  });
}
