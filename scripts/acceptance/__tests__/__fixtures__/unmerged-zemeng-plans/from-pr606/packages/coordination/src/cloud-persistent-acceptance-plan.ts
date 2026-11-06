import { ProtocolError } from '@personal-agent/contracts';

export const CLOUD_PERSISTENT_PENDING_REASON = '待真云关机验收' as const;
export const CLOUD_PERSISTENT_PROFILE = 'huawei_ict_agentarts' as const;

export const CLOUD_PERSISTENT_PHASES = [
  'device_shutdown_detected',
  'cloud_host_handover',
  'unattended_cloud_execution',
  'cloud_checkpoint_persistence',
  'device_reconnect_reconciliation',
] as const;

export type CloudPersistentPhase = typeof CLOUD_PERSISTENT_PHASES[number];

export interface CloudPersistentEvidence {
  readonly profile: 'huawei_ict_agentarts';
  readonly capability: 'cloud_persistent';
  readonly taskId: string;
  readonly sessionId: string;
  readonly deviceShutdownAt: string;
  readonly cloudExecutionStartedAt: string;
  readonly cloudExecutionCompletedAt?: string | undefined;
  readonly cloudPersistentHost: string;
  readonly executionStatus?: 'completed' | 'in_progress' | 'succeeded' | undefined;
  readonly cloudTraceId: string;
  readonly cloudReceiptDigests?: readonly string[] | undefined;
  readonly checkpointRef?: string | undefined;
  readonly evidenceLevel?: 'mock' | 'conditional' | 'verified' | undefined;
  readonly cloudEvidence?: boolean | undefined;
  readonly mock?: boolean | undefined;
  readonly isMock?: boolean | undefined;
  readonly synthetic?: boolean | undefined;
  readonly simulated?: boolean | undefined;
  readonly localOnly?: boolean | undefined;
  readonly isLocalOnly?: boolean | undefined;
  readonly sourceCommit?: string | undefined;
  readonly phases?: readonly string[] | undefined;
}

export interface CloudPersistentPendingItem {
  readonly item: string;
  readonly description: string;
  readonly status: 'unavailable';
  readonly reason: typeof CLOUD_PERSISTENT_PENDING_REASON | string;
}

export interface RealCloudShutdownEvidence {
  readonly authenticated: boolean;
  readonly shutdownVerified: boolean;
  readonly cloudHostActive: boolean;
  readonly unattendedExecutionVerified?: boolean | undefined;
  readonly checkpointVerified?: boolean | undefined;
  readonly reconciliationVerified?: boolean | undefined;
}

export interface PlanCloudPersistentAcceptanceOptions {
  readonly evidence?: unknown | undefined;
  readonly receipt?: unknown | undefined;
  readonly headCommit?: string | undefined;
  readonly realCloudEvidence?: RealCloudShutdownEvidence | boolean | undefined;
  readonly customPendingItems?: readonly string[] | undefined;
  readonly taskId?: string | undefined;
}

export interface CloudPersistentAcceptancePlan {
  readonly profile: 'huawei_ict_agentarts';
  readonly capability: 'cloud_persistent';
  readonly status: 'unavailable' | 'in_progress' | 'ready' | 'verified';
  readonly closedLoop: boolean;
  readonly taskId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly cloudPersistentHost?: string | undefined;
  readonly deviceShutdownAt?: string | undefined;
  readonly cloudExecutionStartedAt?: string | undefined;
  readonly cloudExecutionCompletedAt?: string | undefined;
  readonly cloudTraceId?: string | undefined;
  readonly sourceCommit?: string | undefined;
  readonly headCommit?: string | undefined;
  readonly headMatches?: boolean | undefined;
  readonly verified: readonly string[];
  readonly pending: readonly CloudPersistentPendingItem[];
  readonly reason: typeof CLOUD_PERSISTENT_PENDING_REASON | string;
  readonly limits: readonly string[];
  readonly phasesStatus: {
    readonly expectedPhases: readonly string[];
    readonly reportedPhases: readonly string[];
    readonly missingPhases: readonly string[];
  };
}

export const DEFAULT_CLOUD_PERSISTENT_PENDING_ITEMS: readonly CloudPersistentPendingItem[] = Object.freeze([
  {
    item: 'device_shutdown_detection',
    description: '本机桌面系统关机/休眠/离线事件捕获与状态读回（localDevice=false）',
    status: 'unavailable' as const,
    reason: CLOUD_PERSISTENT_PENDING_REASON,
  },
  {
    item: 'cloud_persistent_host_handover',
    description: '向 AgentArts 云端常驻宿主（cloudPersistentHost）原子交接执行会话与检查点恢复',
    status: 'unavailable' as const,
    reason: CLOUD_PERSISTENT_PENDING_REASON,
  },
  {
    item: 'unattended_cloud_autonomous_dispatch',
    description: '关机脱机期间云端自主调度器（Scheduler）唤醒与工具执行（非本机轮询驱动）',
    status: 'unavailable' as const,
    reason: CLOUD_PERSISTENT_PENDING_REASON,
  },
  {
    item: 'cloud_checkpoint_persistence',
    description: '关机持续运行期间任务状态、阶段时间线与回执在华为云端的原子持久化读回',
    status: 'unavailable' as const,
    reason: CLOUD_PERSISTENT_PENDING_REASON,
  },
  {
    item: 'device_reconnect_reconciliation',
    description: '宿主机开机重新连接后云端执行结果与本地 TaskRuntime 状态双向对账读回',
    status: 'unavailable' as const,
    reason: CLOUD_PERSISTENT_PENDING_REASON,
  },
  {
    item: 'platform_independent_trace_and_cost',
    description: '华为云 AgentArts 平台独立 TraceId、调用耗时与计费读回（非本机应用模拟日志）',
    status: 'unavailable' as const,
    reason: CLOUD_PERSISTENT_PENDING_REASON,
  },
]);

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ProtocolError('INVALID_ARGUMENT', message);
}

function parseIsoTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  try {
    const canonical = new Date(ms).toISOString();
    const withoutMs = (s: string) => s.replace(/\.000Z$/, 'Z');
    if (!value.includes('.')) {
      if (withoutMs(canonical) !== value) return undefined;
    }
  } catch {
    return undefined;
  }
  return ms;
}

/**
 * Validates the shape and structural constraints of a cloud persistent (关机后云持续) execution evidence.
 * Strictly checks profile ("huawei_ict_agentarts"), capability ("cloud_persistent"),
 * taskId, sessionId, valid ISO timestamps with causality ordering (shutdown before cloud start),
 * cloud persistent host endpoint, platform independent trace ID, and rejects any mock, local fake,
 * or localhost simulator.
 */
export function assertCloudPersistentEvidence(value: unknown): asserts value is CloudPersistentEvidence {
  if (!plain(value)) {
    fail('Cloud persistent evidence must be an object');
  }

  // Reject mock explicitly
  if (
    value.mock === true ||
    (value as { isMock?: unknown }).isMock === true ||
    (value as { synthetic?: unknown }).synthetic === true ||
    (value as { simulated?: unknown }).simulated === true ||
    value.evidenceLevel === 'mock'
  ) {
    fail('Cloud persistent evidence rejects mock evidence');
  }

  // Reject local-only execution pretending to be cloud continuation
  if (
    (value as { localOnly?: unknown }).localOnly === true ||
    (value as { isLocalOnly?: unknown }).isLocalOnly === true
  ) {
    fail('Cloud persistent evidence rejects local-only execution');
  }

  if (value.cloudEvidence === false) {
    fail('Cloud persistent evidence requires cloudEvidence to be true or omitted');
  }

  // Profile check
  if (value.profile !== CLOUD_PERSISTENT_PROFILE) {
    fail('Cloud persistent evidence profile must be "huawei_ict_agentarts"');
  }

  // Capability check
  if (value.capability !== 'cloud_persistent') {
    fail('Cloud persistent evidence capability must be "cloud_persistent"');
  }

  // TaskId check
  if (typeof value.taskId !== 'string' || value.taskId.trim().length === 0 || value.taskId.length > 128) {
    fail('Cloud persistent evidence taskId must be a non-empty string (1-128 chars)');
  }

  // SessionId check
  if (typeof value.sessionId !== 'string' || value.sessionId.trim().length === 0 || value.sessionId.length > 128) {
    fail('Cloud persistent evidence sessionId must be a non-empty string (1-128 chars)');
  }

  // deviceShutdownAt check
  const shutdownMs = parseIsoTimestamp(value.deviceShutdownAt);
  if (shutdownMs === undefined) {
    fail('Cloud persistent evidence deviceShutdownAt must be a valid ISO timestamp string');
  }

  // cloudExecutionStartedAt check
  const startMs = parseIsoTimestamp(value.cloudExecutionStartedAt);
  if (startMs === undefined) {
    fail('Cloud persistent evidence cloudExecutionStartedAt must be a valid ISO timestamp string');
  }

  // Causality: cloud continuation after shutdown cannot start before the device shut down
  if (startMs < shutdownMs) {
    fail('Cloud execution start time cannot precede device shutdown time');
  }

  // cloudExecutionCompletedAt check (optional)
  if (value.cloudExecutionCompletedAt !== undefined) {
    const completeMs = parseIsoTimestamp(value.cloudExecutionCompletedAt);
    if (completeMs === undefined) {
      fail('Cloud persistent evidence cloudExecutionCompletedAt must be a valid ISO timestamp string');
    }
    if (completeMs < startMs) {
      fail('Cloud execution completion time cannot precede cloud start time');
    }
  }

  // cloudPersistentHost check
  const host = value.cloudPersistentHost;
  if (typeof host !== 'string' || host.trim().length === 0) {
    fail('Cloud persistent evidence cloudPersistentHost must be a non-empty string');
  }

  if (host.includes('://')) {
    try {
      const url = new URL(host);
      if (url.protocol !== 'https:' && url.protocol !== 'wss:') {
        fail('Cloud persistent host URL must use https: or wss: protocol');
      }
      if (url.username || url.password) {
        fail('Cloud persistent host URL must not contain credentials');
      }
      const hostname = url.hostname.toLowerCase();
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
        fail('Cloud persistent host URL must not target localhost');
      }
      if (hostname.includes('mock') || hostname.includes('fake')) {
        fail('Cloud persistent host URL must not target mock or fake hosts');
      }
    } catch (err) {
      if (err instanceof ProtocolError) throw err;
      fail('Cloud persistent evidence cloudPersistentHost must be a valid HTTPS/WSS URL or host identifier');
    }
  } else {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(host)) {
      fail('Cloud persistent evidence cloudPersistentHost identifier must be 1-128 characters (alphanumeric, dash, underscore, dot)');
    }
    const lower = host.toLowerCase();
    if (lower.includes('localhost') || lower.includes('mock') || lower.includes('fake')) {
      fail('Cloud persistent host identifier must not indicate localhost, mock, or fake');
    }
  }

  // cloudTraceId check
  if (typeof value.cloudTraceId !== 'string' || value.cloudTraceId.trim().length === 0 || value.cloudTraceId.length > 128) {
    fail('Cloud persistent evidence cloudTraceId must be a non-empty string (1-128 chars)');
  }

  // executionStatus check (optional)
  if (
    value.executionStatus !== undefined &&
    !['completed', 'in_progress', 'succeeded'].includes(value.executionStatus as string)
  ) {
    fail('Cloud persistent evidence executionStatus must be "completed", "in_progress", or "succeeded"');
  }

  // evidenceLevel check (optional)
  if (value.evidenceLevel !== undefined && !['conditional', 'verified'].includes(value.evidenceLevel as string)) {
    fail('Cloud persistent evidence evidenceLevel must be "conditional" or "verified"');
  }

  // cloudReceiptDigests check (optional)
  if (value.cloudReceiptDigests !== undefined) {
    if (!Array.isArray(value.cloudReceiptDigests) || value.cloudReceiptDigests.some(d => typeof d !== 'string' || d.trim().length === 0)) {
      fail('Cloud persistent evidence cloudReceiptDigests must be an array of non-empty strings');
    }
  }

  // checkpointRef check (optional)
  if (value.checkpointRef !== undefined && (typeof value.checkpointRef !== 'string' || value.checkpointRef.trim().length === 0)) {
    fail('Cloud persistent evidence checkpointRef must be a non-empty string');
  }

  // sourceCommit check (optional)
  if (value.sourceCommit !== undefined && (typeof value.sourceCommit !== 'string' || value.sourceCommit.trim().length === 0)) {
    fail('Cloud persistent evidence sourceCommit must be a non-empty string');
  }

  // phases check (optional)
  if (value.phases !== undefined && (!Array.isArray(value.phases) || value.phases.some(p => typeof p !== 'string'))) {
    fail('Cloud persistent evidence phases must be an array of strings');
  }
}

/**
 * Convenience parser returning typed CloudPersistentEvidence or throwing ProtocolError.
 */
export function parseCloudPersistentEvidence(value: unknown): CloudPersistentEvidence {
  assertCloudPersistentEvidence(value);
  return value;
}

function isPlanOptions(value: unknown): value is PlanCloudPersistentAcceptanceOptions {
  if (!plain(value)) return false;
  if ('evidence' in value || 'receipt' in value || 'customPendingItems' in value || 'realCloudEvidence' in value) {
    return true;
  }
  if ('headCommit' in value && !('deviceShutdownAt' in value || 'cloudPersistentHost' in value || 'cloudExecutionStartedAt' in value)) {
    return true;
  }
  return false;
}

/**
 * Plans cloudPersistent (关机后云持续) acceptance verification.
 * When real authenticated Huawei Cloud shutdown evidence is absent, closedLoop is strictly false,
 * status is unavailable, reason is '待真云关机验收', and all pending items require real cloud shutdown acceptance.
 * Pure offline helper: does not connect to cloud, does not read secret credentials.
 */
export function planCloudPersistentAcceptance(
  evidenceOrOptions?: unknown | PlanCloudPersistentAcceptanceOptions,
  extraOptions?: Omit<PlanCloudPersistentAcceptanceOptions, 'evidence' | 'receipt'>
): CloudPersistentAcceptancePlan {
  let evidenceInput: unknown;
  let headCommit: string | undefined;
  let realCloudEvidence: RealCloudShutdownEvidence | boolean | undefined;
  let customPendingItems: readonly string[] | undefined;
  let explicitTaskId: string | undefined;

  if (isPlanOptions(evidenceOrOptions)) {
    evidenceInput = evidenceOrOptions.evidence ?? evidenceOrOptions.receipt;
    headCommit = evidenceOrOptions.headCommit ?? extraOptions?.headCommit;
    realCloudEvidence = evidenceOrOptions.realCloudEvidence ?? extraOptions?.realCloudEvidence;
    customPendingItems = evidenceOrOptions.customPendingItems ?? extraOptions?.customPendingItems;
    explicitTaskId = evidenceOrOptions.taskId ?? extraOptions?.taskId;
  } else {
    evidenceInput = evidenceOrOptions;
    headCommit = extraOptions?.headCommit;
    realCloudEvidence = extraOptions?.realCloudEvidence;
    customPendingItems = extraOptions?.customPendingItems;
    explicitTaskId = extraOptions?.taskId;
  }

  const limits: readonly string[] = [
    '本规划为离线契约 helper，不连接华为云，不读取任何云凭据或密钥',
    '关机后云持续执行（cloudPersistent）必须具备真实华为云端到端关机后运行证据，严禁在无证据时宣称 closedLoop=true',
    '严禁使用本地 Fake、合成数据或本机后台运行冒充关机后云端持续执行',
    '遵循 AGENTS.md 与华为比赛 Profile 规范：无真实云关机证据时 closedLoop=false，状态标记为 unavailable，待真云关机验收',
  ];

  const expectedPhases = [...CLOUD_PERSISTENT_PHASES];

  // Case 1: No evidence input provided -> default offline plan
  if (!evidenceInput) {
    const pending: CloudPersistentPendingItem[] = DEFAULT_CLOUD_PERSISTENT_PENDING_ITEMS.map(spec => ({
      item: spec.item,
      description: spec.description,
      status: 'unavailable' as const,
      reason: CLOUD_PERSISTENT_PENDING_REASON,
    }));

    if (customPendingItems) {
      for (const item of customPendingItems) {
        pending.push({
          item,
          description: item,
          status: 'unavailable' as const,
          reason: CLOUD_PERSISTENT_PENDING_REASON,
        });
      }
    }

    return {
      profile: CLOUD_PERSISTENT_PROFILE,
      capability: 'cloud_persistent',
      status: 'unavailable',
      closedLoop: false,
      taskId: explicitTaskId,
      headCommit,
      verified: ['离线规划：未提供关机后云持续读回证据，已生成 AgentArts 关机后云持续离线验收规划'],
      pending,
      reason: CLOUD_PERSISTENT_PENDING_REASON,
      limits,
      phasesStatus: {
        expectedPhases,
        reportedPhases: [],
        missingPhases: expectedPhases,
      },
    };
  }

  // Case 2: Evidence input provided -> validate evidence
  assertCloudPersistentEvidence(evidenceInput);
  const evidence = evidenceInput as CloudPersistentEvidence;

  const receiptCommit = evidence.sourceCommit ?? '';

  let headMatches: boolean | undefined;
  if (typeof headCommit === 'string' && headCommit.trim().length > 0 && receiptCommit.length > 0) {
    const normalizedHead = headCommit.trim();
    headMatches = receiptCommit.startsWith(normalizedHead) || normalizedHead.startsWith(receiptCommit);
  }

  let hasRealCloud = false;
  if (typeof realCloudEvidence === 'boolean') {
    hasRealCloud = realCloudEvidence;
  } else if (realCloudEvidence && typeof realCloudEvidence === 'object') {
    hasRealCloud =
      realCloudEvidence.authenticated === true &&
      realCloudEvidence.shutdownVerified === true &&
      realCloudEvidence.cloudHostActive === true &&
      realCloudEvidence.checkpointVerified === true;
  }

  if (evidence.cloudEvidence === false || evidence.evidenceLevel === 'mock') {
    hasRealCloud = false;
  }

  const reportedPhases = evidence.phases ? [...evidence.phases] : [];
  const missingPhases = expectedPhases.filter(p => !reportedPhases.includes(p));

  const verified: string[] = [
    `契约结构：Profile "${evidence.profile}"、Capability "${evidence.capability}" 校验通过`,
    `任务会话：TaskId "${evidence.taskId}"，SessionId "${evidence.sessionId}"，TraceId "${evidence.cloudTraceId}"`,
    `时序因果：关机时间 ${evidence.deviceShutdownAt}，云端开始时间 ${evidence.cloudExecutionStartedAt}`,
    `常驻宿主：cloudPersistentHost "${evidence.cloudPersistentHost}"，执行状态 "${evidence.executionStatus ?? 'completed'}"`,
  ];

  if (evidence.cloudExecutionCompletedAt) {
    verified.push(`云端完成：完成时间 ${evidence.cloudExecutionCompletedAt}`);
  }

  if (headMatches === true) {
    verified.push(`代码对齐：当前 HEAD 提交 (${headCommit}) 与证据源提交 (${receiptCommit}) 一致`);
  }

  if (reportedPhases.length > 0) {
    verified.push(`阶段核验：覆盖 ${reportedPhases.length}/${expectedPhases.length} 持续执行阶段 [${reportedPhases.join(', ')}]`);
  }

  if (!hasRealCloud || headMatches === false) {
    const pending: CloudPersistentPendingItem[] = [];

    if (!hasRealCloud) {
      for (const item of DEFAULT_CLOUD_PERSISTENT_PENDING_ITEMS) {
        pending.push({
          item: item.item,
          description: item.description,
          status: 'unavailable' as const,
          reason: CLOUD_PERSISTENT_PENDING_REASON,
        });
      }
    }

    if (headMatches === false) {
      pending.push({
        item: 'source_head_commit_alignment',
        description: `代码基线失配：当前 HEAD (${headCommit}) 与证据提交 (${receiptCommit}) 不一致，待在当前 HEAD 重放关机验收`,
        status: 'unavailable' as const,
        reason: CLOUD_PERSISTENT_PENDING_REASON,
      });
    }

    if (customPendingItems) {
      for (const item of customPendingItems) {
        pending.push({
          item,
          description: item,
          status: 'unavailable' as const,
          reason: CLOUD_PERSISTENT_PENDING_REASON,
        });
      }
    }

    return {
      profile: CLOUD_PERSISTENT_PROFILE,
      capability: 'cloud_persistent',
      status: 'unavailable',
      closedLoop: false,
      taskId: evidence.taskId,
      sessionId: evidence.sessionId,
      cloudPersistentHost: evidence.cloudPersistentHost,
      deviceShutdownAt: evidence.deviceShutdownAt,
      cloudExecutionStartedAt: evidence.cloudExecutionStartedAt,
      cloudExecutionCompletedAt: evidence.cloudExecutionCompletedAt,
      cloudTraceId: evidence.cloudTraceId,
      sourceCommit: evidence.sourceCommit,
      headCommit,
      headMatches,
      verified,
      pending,
      reason: CLOUD_PERSISTENT_PENDING_REASON,
      limits,
      phasesStatus: {
        expectedPhases,
        reportedPhases,
        missingPhases,
      },
    };
  }

  // Real cloud shutdown evidence verified and aligned with HEAD commit
  const pending: CloudPersistentPendingItem[] = [];
  if (customPendingItems) {
    for (const item of customPendingItems) {
      pending.push({
        item,
        description: item,
        status: 'unavailable' as const,
        reason: CLOUD_PERSISTENT_PENDING_REASON,
      });
    }
  }

  return {
    profile: CLOUD_PERSISTENT_PROFILE,
    capability: 'cloud_persistent',
    status: pending.length > 0 ? 'in_progress' : 'verified',
    closedLoop: pending.length === 0,
    taskId: evidence.taskId,
    sessionId: evidence.sessionId,
    cloudPersistentHost: evidence.cloudPersistentHost,
    deviceShutdownAt: evidence.deviceShutdownAt,
    cloudExecutionStartedAt: evidence.cloudExecutionStartedAt,
    cloudExecutionCompletedAt: evidence.cloudExecutionCompletedAt,
    cloudTraceId: evidence.cloudTraceId,
    sourceCommit: evidence.sourceCommit,
    headCommit,
    headMatches,
    verified,
    pending,
    reason: pending.length > 0 ? CLOUD_PERSISTENT_PENDING_REASON : '已完成真实华为云关机后云持续端到端读实验收',
    limits,
    phasesStatus: {
      expectedPhases,
      reportedPhases,
      missingPhases,
    },
  };
}
