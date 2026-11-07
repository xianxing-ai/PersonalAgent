import { ProtocolError } from '@personal-agent/contracts';

export const PLAN_ID = 'mod04b-agentarts-acceptance-plan';
export const PLAN_TITLE = 'MOD-04B：AgentArts 多 Agent 结果与文字协调离线验收规划';
export const MOD04B_AGENTARTS_PROFILE = 'huawei_ict_agentarts' as const;
export const MOD04B_AGENTARTS_CAPABILITY = 'competition_coordination' as const;
export const MOD04B_AGENTARTS_PENDING_REASON = '待真云验收' as const;
export const PENDING_REASON = MOD04B_AGENTARTS_PENDING_REASON;

/**
 * 必需环境声明（依据 docs/modules/MOD-04B-AGENTARTS-ACCEPTANCE-PLAN-20261107.md §1/§2）
 */
export const REQUIRED_ENVIRONMENTS = ['huawei_cloud'];

/**
 * 验收步骤声明（依据 docs/modules/MOD-04B-AGENTARTS-ACCEPTANCE-PLAN-20261107.md §2.3）
 */
export const ACCEPTANCE_STEPS = [
  'agentarts_real_cloud_endpoint：华为云 AgentArts 真实端点（HTTPS/WSS）与有效凭据（Authorization）端到端连通读回（非本地 Fake）',
  'agentarts_multi_agent_routing：AgentArts 云端多智能体协作网络（主协调器与专业子 Agent）角色路由与分派结果真实读回',
  'agentarts_continuation_roundtrip：基于真实提案 proposalId 的受限 continuation 工具结果回传与多轮续答闭环读回',
  'agentarts_tool_proposal_verification：云端生成 ToolProposal 到本地 Policy/ToolGateway 授权审批与结果核实的双向读回',
  'platform_independent_trace_and_cost：华为云平台独立 TraceId 关联、步骤耗时与 Token 消耗/计费真实读回（非本地模拟）',
  'local_cancellation_and_deadline_settlement：真实网络延迟下的本地 deadline 与取消信号传播、不交付迟到结果的对账读回',
];

/**
 * 验收证据要求声明（依据 docs/modules/MOD-04B-AGENTARTS-ACCEPTANCE-PLAN-20261107.md §1/§2）
 */
export const EVIDENCE_REQUIREMENTS = [
  'Mod04bAgentArtsEvidence 合规回执（含 gatewayUrl HTTPS/WSS、CloudTraceId、时序因果 completedAt >= invokedAt、至少 2 位不同非 Mock Agent 与/或 confirmed 状态 continuation）',
  '华为云 AgentArts 平台独立 TraceId 关联、Token/计费在线读回与双向授权审计凭据',
];

/**
 * 默认待真云验收挂起项声明
 */
export const DEFAULT_PENDING_ITEMS = [
  'agentarts_real_cloud_endpoint',
  'agentarts_multi_agent_routing',
  'agentarts_continuation_roundtrip',
  'agentarts_tool_proposal_verification',
  'platform_independent_trace_and_cost',
  'local_cancellation_and_deadline_settlement',
];

export interface Mod04bAgentRole {
  readonly role: string;
  readonly agentName?: string | undefined;
  readonly agentId?: string | undefined;
}

export interface Mod04bMultiAgentDetail {
  readonly coordinator?: string | undefined;
  readonly agents: readonly (string | Mod04bAgentRole)[];
  readonly handoffCount?: number | undefined;
  readonly routingTrace?: readonly string[] | undefined;
}

export interface Mod04bContinuationEvidence {
  readonly proposalId: string;
  readonly state: 'confirmed';
  readonly toolName?: string | undefined;
  readonly round?: number | undefined;
  readonly resultDigest?: string | undefined;
  readonly responseSummary?: string | undefined;
}

export interface Mod04bAgentArtsEvidence {
  readonly profile: 'huawei_ict_agentarts';
  readonly capability?: 'competition_coordination' | undefined;
  readonly taskId: string;
  readonly sessionId: string;
  readonly cloudTraceId: string;
  readonly runtimeName?: string | undefined;
  readonly gatewayUrl?: string | undefined;
  readonly invokedAt?: string | undefined;
  readonly completedAt?: string | undefined;
  readonly executionStatus?: 'completed' | 'in_progress' | 'succeeded' | undefined;
  readonly multiAgent?: Mod04bMultiAgentDetail | undefined;
  readonly agents?: readonly (string | Mod04bAgentRole)[] | undefined;
  readonly continuation?: Mod04bContinuationEvidence | undefined;
  readonly continuations?: readonly Mod04bContinuationEvidence[] | undefined;
  readonly evidenceLevel?: 'mock' | 'conditional' | 'verified' | undefined;
  readonly cloudEvidence?: boolean | undefined;
  readonly mock?: boolean | undefined;
  readonly isMock?: boolean | undefined;
  readonly synthetic?: boolean | undefined;
  readonly simulated?: boolean | undefined;
  readonly localOnly?: boolean | undefined;
  readonly isLocalOnly?: boolean | undefined;
  readonly sourceCommit?: string | undefined;
}

export interface Mod04bAgentArtsPendingItem {
  readonly item: string;
  readonly description: string;
  readonly status: 'unavailable';
  readonly reason: typeof MOD04B_AGENTARTS_PENDING_REASON | string;
}

export interface RealCloudMultiAgentEvidence {
  readonly authenticated: boolean;
  readonly multiAgentRoutingVerified?: boolean | undefined;
  readonly continuationVerified?: boolean | undefined;
  readonly toolProposalVerified?: boolean | undefined;
  readonly traceReadbackVerified?: boolean | undefined;
}

export interface Mod04bStructuralVerification {
  readonly hasGatewayUrl: boolean;
  readonly hasCausalTimestamps: boolean;
  readonly isMultiAgent: boolean;
  readonly hasContinuation: boolean;
  readonly authenticated: boolean;
  readonly multiAgentRoutingVerified: boolean;
  readonly continuationVerified: boolean;
  readonly toolProposalVerified: boolean;
  readonly traceReadbackVerified: boolean;
  readonly missingFields: readonly string[];
  readonly fullyCovered: boolean;
}

export interface PlanMod04bAgentArtsAcceptanceOptions {
  readonly evidence?: unknown | undefined;
  readonly receipt?: unknown | undefined;
  readonly headCommit?: string | undefined;
  readonly realCloudEvidence?: RealCloudMultiAgentEvidence | undefined;
  readonly customPendingItems?: readonly string[] | undefined;
  readonly taskId?: string | undefined;
}

export interface Mod04bAgentArtsAcceptancePlan {
  readonly profile: 'huawei_ict_agentarts';
  readonly capability: 'competition_coordination';
  readonly status: 'unavailable' | 'in_progress' | 'ready' | 'verified';
  readonly closedLoop: boolean;
  readonly taskId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly cloudTraceId?: string | undefined;
  readonly runtimeName?: string | undefined;
  readonly gatewayUrl?: string | undefined;
  readonly invokedAt?: string | undefined;
  readonly completedAt?: string | undefined;
  readonly sourceCommit?: string | undefined;
  readonly headCommit?: string | undefined;
  readonly headMatches?: boolean | undefined;
  readonly verified: readonly string[];
  readonly pending: readonly Mod04bAgentArtsPendingItem[];
  readonly reason: typeof MOD04B_AGENTARTS_PENDING_REASON | string;
  readonly limits: readonly string[];
  readonly structuralVerification?: Mod04bStructuralVerification | undefined;
  readonly multiAgentStatus: {
    readonly isMultiAgent: boolean;
    readonly agentCount: number;
    readonly agents: readonly string[];
  };
  readonly continuationStatus: {
    readonly hasContinuation: boolean;
    readonly proposalId?: string | undefined;
    readonly state?: string | undefined;
  };
}

export const DEFAULT_MOD04B_AGENTARTS_PENDING_ITEMS: readonly Mod04bAgentArtsPendingItem[] = Object.freeze([
  {
    item: 'agentarts_real_cloud_endpoint',
    description: '华为云 AgentArts 真实端点（HTTPS/WSS）与有效凭据（Authorization）端到端连通读回（非本地 Fake）',
    status: 'unavailable' as const,
    reason: MOD04B_AGENTARTS_PENDING_REASON,
  },
  {
    item: 'agentarts_multi_agent_routing',
    description: 'AgentArts 云端多智能体协作网络（主协调器与专业子 Agent）角色路由与分派结果真实读回',
    status: 'unavailable' as const,
    reason: MOD04B_AGENTARTS_PENDING_REASON,
  },
  {
    item: 'agentarts_continuation_roundtrip',
    description: '基于真实提案 proposalId 的受限 continuation 工具结果回传与多轮续答闭环读回',
    status: 'unavailable' as const,
    reason: MOD04B_AGENTARTS_PENDING_REASON,
  },
  {
    item: 'agentarts_tool_proposal_verification',
    description: '云端生成 ToolProposal 到本地 Policy/ToolGateway 授权审批与结果核实的双向读回',
    status: 'unavailable' as const,
    reason: MOD04B_AGENTARTS_PENDING_REASON,
  },
  {
    item: 'platform_independent_trace_and_cost',
    description: '华为云平台独立 TraceId 关联、步骤耗时与 Token 消耗/计费真实读回（非本地模拟）',
    status: 'unavailable' as const,
    reason: MOD04B_AGENTARTS_PENDING_REASON,
  },
  {
    item: 'local_cancellation_and_deadline_settlement',
    description: '真实网络延迟下的本地 deadline 与取消信号传播、不交付迟到结果的对账读回',
    status: 'unavailable' as const,
    reason: MOD04B_AGENTARTS_PENDING_REASON,
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

function extractAgentName(item: unknown): string {
  if (typeof item === 'string') {
    const trimmed = item.trim();
    if (trimmed.length === 0 || trimmed.length > 128 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
      fail('Agent name must be a non-empty string without control characters (1-128 chars)');
    }
    const lower = trimmed.toLowerCase();
    if (lower.includes('mock') || lower.includes('fake')) {
      fail('Agent name must not indicate mock or fake agents');
    }
    return trimmed;
  }
  if (plain(item)) {
    if (typeof item.role !== 'string' || item.role.trim().length === 0 || item.role.length > 128) {
      fail('Agent role must be a non-empty string (1-128 chars)');
    }
    const roleTrimmed = item.role.trim();
    const roleLower = roleTrimmed.toLowerCase();
    if (roleLower.includes('mock') || roleLower.includes('fake')) {
      fail('Agent role must not indicate mock or fake agents');
    }
    if (item.agentName !== undefined) {
      if (typeof item.agentName !== 'string' || item.agentName.trim().length === 0 || item.agentName.length > 128) {
        fail('Agent agentName must be a non-empty string (1-128 chars)');
      }
    }
    if (item.agentId !== undefined) {
      if (typeof item.agentId !== 'string' || item.agentId.trim().length === 0 || item.agentId.length > 128) {
        fail('Agent agentId must be a non-empty string (1-128 chars)');
      }
    }
    return (typeof item.agentName === 'string' && item.agentName.trim().length > 0) ? item.agentName.trim() : roleTrimmed;
  }
  fail('Agent item must be a string or role object');
}

function validateContinuationItem(continuation: unknown): void {
  if (!plain(continuation)) {
    fail('Continuation evidence must be an object');
  }
  if (
    typeof continuation.proposalId !== 'string' ||
    continuation.proposalId.trim().length === 0 ||
    continuation.proposalId.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(continuation.proposalId)
  ) {
    fail('Continuation proposalId must be a non-empty string (1-128 chars, no control characters)');
  }
  const propLower = continuation.proposalId.toLowerCase();
  if (propLower.includes('mock') || propLower.includes('fake')) {
    fail('Continuation proposalId must not indicate mock or fake proposals');
  }
  if (continuation.state !== 'confirmed') {
    fail('Continuation state must be "confirmed"');
  }
  if (continuation.toolName !== undefined) {
    if (
      typeof continuation.toolName !== 'string' ||
      continuation.toolName.trim().length === 0 ||
      continuation.toolName.length > 128
    ) {
      fail('Continuation toolName must be a non-empty string (1-128 chars)');
    }
  }
  if (continuation.round !== undefined) {
    if (!Number.isSafeInteger(continuation.round) || (continuation.round as number) < 0) {
      fail('Continuation round must be a non-negative integer');
    }
  }
}

/**
 * Validates the shape and structural constraints of MOD-04B AgentArts multi-agent and continuation execution evidence.
 * Strictly checks profile ("huawei_ict_agentarts"), capability ("competition_coordination"),
 * taskId, sessionId, cloudTraceId, gatewayUrl, runtimeName, multi-agent roles and/or continuation roundtrip,
 * and rejects any mock, synthetic, simulated, local-only or fake results.
 */
export function assertMod04bAgentArtsEvidence(value: unknown): asserts value is Mod04bAgentArtsEvidence {
  if (!plain(value)) {
    fail('MOD-04B AgentArts evidence must be an object');
  }

  // Reject mock explicitly
  if (
    value.mock === true ||
    (value as { isMock?: unknown }).isMock === true ||
    (value as { synthetic?: unknown }).synthetic === true ||
    (value as { simulated?: unknown }).simulated === true ||
    value.evidenceLevel === 'mock'
  ) {
    fail('MOD-04B AgentArts evidence rejects mock evidence');
  }

  // Reject local-only execution pretending to be cloud multi-agent coordination
  if (
    (value as { localOnly?: unknown }).localOnly === true ||
    (value as { isLocalOnly?: unknown }).isLocalOnly === true
  ) {
    fail('MOD-04B AgentArts evidence rejects local-only execution');
  }

  if (value.cloudEvidence === false) {
    fail('MOD-04B AgentArts evidence requires cloudEvidence to be true or omitted');
  }

  // Profile check
  if (value.profile !== MOD04B_AGENTARTS_PROFILE) {
    fail('MOD-04B AgentArts evidence profile must be "huawei_ict_agentarts"');
  }

  // Capability check (if specified)
  if (value.capability !== undefined && value.capability !== MOD04B_AGENTARTS_CAPABILITY) {
    fail('MOD-04B AgentArts evidence capability must be "competition_coordination"');
  }

  // TaskId check
  if (typeof value.taskId !== 'string' || value.taskId.trim().length === 0 || value.taskId.length > 128) {
    fail('MOD-04B AgentArts evidence taskId must be a non-empty string (1-128 chars)');
  }

  // SessionId check
  if (typeof value.sessionId !== 'string' || value.sessionId.trim().length === 0 || value.sessionId.length > 128) {
    fail('MOD-04B AgentArts evidence sessionId must be a non-empty string (1-128 chars)');
  }

  // CloudTraceId check
  if (typeof value.cloudTraceId !== 'string' || value.cloudTraceId.trim().length === 0 || value.cloudTraceId.length > 128) {
    fail('MOD-04B AgentArts evidence cloudTraceId must be a non-empty string (1-128 chars)');
  }

  // RuntimeName check (optional)
  if (value.runtimeName !== undefined) {
    if (typeof value.runtimeName !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.runtimeName)) {
      fail('MOD-04B AgentArts evidence runtimeName must be 1-64 characters (alphanumeric, dash, underscore)');
    }
  }

  // GatewayUrl check (optional)
  if (value.gatewayUrl !== undefined) {
    if (typeof value.gatewayUrl !== 'string' || value.gatewayUrl.trim().length === 0) {
      fail('MOD-04B AgentArts evidence gatewayUrl must be a non-empty string');
    }
    try {
      const url = new URL(value.gatewayUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'wss:') {
        fail('Gateway URL must use https: or wss: protocol');
      }
      if (url.username || url.password) {
        fail('Gateway URL must not contain credentials');
      }
      const hostname = url.hostname.toLowerCase();
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
        fail('Gateway URL must not target localhost');
      }
      if (hostname.includes('mock') || hostname.includes('fake')) {
        fail('Gateway URL must not target mock or fake hosts');
      }
    } catch (err) {
      if (err instanceof ProtocolError) throw err;
      fail('MOD-04B AgentArts evidence gatewayUrl must be a valid HTTPS/WSS URL');
    }
  }

  // Timestamps check (optional)
  let invokedMs: number | undefined;
  if (value.invokedAt !== undefined) {
    invokedMs = parseIsoTimestamp(value.invokedAt);
    if (invokedMs === undefined) {
      fail('MOD-04B AgentArts evidence invokedAt must be a valid ISO timestamp string');
    }
  }

  if (value.completedAt !== undefined) {
    const completedMs = parseIsoTimestamp(value.completedAt);
    if (completedMs === undefined) {
      fail('MOD-04B AgentArts evidence completedAt must be a valid ISO timestamp string');
    }
    if (invokedMs !== undefined && completedMs < invokedMs) {
      fail('Completed time cannot precede invocation time');
    }
  }

  // Multi-Agent validation
  const hasMultiAgent = value.multiAgent !== undefined;
  const hasAgents = value.agents !== undefined;
  if (hasMultiAgent) {
    if (!plain(value.multiAgent)) {
      fail('MOD-04B AgentArts evidence multiAgent must be an object');
    }
    if (!Array.isArray(value.multiAgent.agents) || value.multiAgent.agents.length < 2) {
      fail('Multi-agent coordination requires an array of at least 2 distinct agents');
    }
    const agentNames = new Set<string>();
    for (const item of value.multiAgent.agents) {
      const name = extractAgentName(item);
      if (agentNames.has(name)) {
        fail(`Duplicate agent detected in multi-agent group: "${name}"`);
      }
      agentNames.add(name);
    }
    if (value.multiAgent.coordinator !== undefined) {
      if (typeof value.multiAgent.coordinator !== 'string' || value.multiAgent.coordinator.trim().length === 0 || value.multiAgent.coordinator.length > 128) {
        fail('Multi-agent coordinator must be a non-empty string (1-128 chars)');
      }
    }
    if (value.multiAgent.handoffCount !== undefined) {
      if (!Number.isSafeInteger(value.multiAgent.handoffCount) || (value.multiAgent.handoffCount as number) < 0) {
        fail('Multi-agent handoffCount must be a non-negative integer');
      }
    }
  } else if (hasAgents) {
    if (!Array.isArray(value.agents) || value.agents.length < 2) {
      fail('Multi-agent coordination requires an array of at least 2 distinct agents');
    }
    const agentNames = new Set<string>();
    for (const item of value.agents) {
      const name = extractAgentName(item);
      if (agentNames.has(name)) {
        fail(`Duplicate agent detected in multi-agent group: "${name}"`);
      }
      agentNames.add(name);
    }
  }

  // Continuation validation
  const hasContinuation = value.continuation !== undefined;
  const hasContinuations = value.continuations !== undefined;
  if (hasContinuation) {
    validateContinuationItem(value.continuation);
  }
  if (hasContinuations) {
    if (!Array.isArray(value.continuations) || value.continuations.length === 0) {
      fail('Continuations must be a non-empty array of continuation items');
    }
    for (const item of value.continuations) {
      validateContinuationItem(item);
    }
  }

  // Must contain either multi-agent details or continuation details
  if (!hasMultiAgent && !hasAgents && !hasContinuation && !hasContinuations) {
    fail('MOD-04B AgentArts evidence must contain multiAgent or continuation details');
  }

  // ExecutionStatus check (optional)
  if (
    value.executionStatus !== undefined &&
    !['completed', 'in_progress', 'succeeded'].includes(value.executionStatus as string)
  ) {
    fail('MOD-04B AgentArts evidence executionStatus must be "completed", "in_progress", or "succeeded"');
  }

  // EvidenceLevel check (optional)
  if (value.evidenceLevel !== undefined && !['conditional', 'verified'].includes(value.evidenceLevel as string)) {
    fail('MOD-04B AgentArts evidence evidenceLevel must be "conditional" or "verified"');
  }

  // SourceCommit check (optional)
  if (value.sourceCommit !== undefined && (typeof value.sourceCommit !== 'string' || value.sourceCommit.trim().length === 0)) {
    fail('MOD-04B AgentArts evidence sourceCommit must be a non-empty string');
  }
}

/**
 * Convenience parser returning typed Mod04bAgentArtsEvidence or throwing ProtocolError.
 */
export function parseMod04bAgentArtsEvidence(value: unknown): Mod04bAgentArtsEvidence {
  assertMod04bAgentArtsEvidence(value);
  return value;
}

function isPlanOptions(value: unknown): value is PlanMod04bAgentArtsAcceptanceOptions {
  if (!plain(value)) return false;
  if ('evidence' in value || 'receipt' in value || 'customPendingItems' in value || 'realCloudEvidence' in value) {
    return true;
  }
  if ('headCommit' in value && !('taskId' in value && 'sessionId' in value && 'cloudTraceId' in value)) {
    return true;
  }
  return false;
}

/**
 * Plans MOD-04B Competition text coordination and AgentArts multi-agent / continuation acceptance verification.
 * When real authenticated Huawei Cloud evidence is absent, closedLoop is strictly false,
 * status is unavailable, reason is '待真云验收', and pending items require real cloud acceptance.
 * Pure offline helper: does not connect to cloud, does not read secret credentials.
 */
export function planMod04bAgentArtsAcceptance(
  evidenceOrOptions?: unknown | PlanMod04bAgentArtsAcceptanceOptions,
  extraOptions?: Omit<PlanMod04bAgentArtsAcceptanceOptions, 'evidence' | 'receipt'>
): Mod04bAgentArtsAcceptancePlan {
  let evidenceInput: unknown;
  let headCommit: string | undefined;
  let realCloudEvidence: RealCloudMultiAgentEvidence | boolean | undefined;
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

  // 严格防御：禁止通过布尔标记伪造真实多智能体云端读回
  if (typeof realCloudEvidence === 'boolean') {
    fail('realCloudEvidence must be an object with structured verification fields, boolean flag is prohibited');
  }

  if (realCloudEvidence !== undefined) {
    if (!plain(realCloudEvidence)) {
      fail('realCloudEvidence must be an object with structured verification fields');
    }
    const rce = realCloudEvidence as unknown as RealCloudMultiAgentEvidence;
    if (typeof rce.authenticated !== 'boolean') {
      fail('realCloudEvidence.authenticated must be a boolean');
    }
  }

  const limits: readonly string[] = [
    '本规划为离线契约 helper，不连接华为云，不读取任何云凭据或密钥',
    '真实 AgentArts 多 Agent 结果与 continuation 闭环必须具备华为云真实端到端读回证据，严禁在无证据时宣称 closedLoop=true',
    '严禁使用本地 Fake、Mock、合成数据或单 Agent 假装多 Agent 协作闭环',
    '遵循 AGENTS.md 与华为比赛 Profile 规范：无真实云证据时 closedLoop=false，状态标记为 unavailable，待真云验收',
  ];

  let evidence: Mod04bAgentArtsEvidence | undefined;
  let receiptCommit = '';
  let headMatches: boolean | undefined;
  let isMultiAgent = false;
  let agentList: string[] = [];
  let continuationItem: Mod04bContinuationEvidence | undefined;
  let hasContinuation = false;
  let hasGatewayUrl = false;
  let hasCausalTimestamps = false;
  let structuralVerification: Mod04bStructuralVerification | undefined;
  const verified: string[] = [];

  const rce = plain(realCloudEvidence) ? (realCloudEvidence as unknown as RealCloudMultiAgentEvidence) : undefined;
  const toolProposalVerified = rce?.toolProposalVerified === true;
  const multiAgentRoutingVerified = rce?.multiAgentRoutingVerified === true;
  const continuationVerified = rce?.continuationVerified === true;
  const traceReadbackVerified = rce?.traceReadbackVerified === true;

  // Case 1: No evidence input provided -> default offline plan
  if (!evidenceInput) {
    verified.push('离线规划：未提供 AgentArts 多 Agent / continuation 真云读回证据，已生成 MOD-04B 离线验收规划');
  } else {
    // Case 2: Evidence input provided -> validate evidence structure
    assertMod04bAgentArtsEvidence(evidenceInput);
    evidence = evidenceInput as Mod04bAgentArtsEvidence;

    const rawAgents = evidence.multiAgent?.agents ?? evidence.agents;
    if (Array.isArray(rawAgents)) {
      for (const a of rawAgents) {
        agentList.push(extractAgentName(a));
      }
    }

    isMultiAgent = agentList.length >= 2;
    continuationItem = evidence.continuation ?? (Array.isArray(evidence.continuations) && evidence.continuations.length > 0 ? evidence.continuations[0] : undefined);
    hasContinuation = Boolean(continuationItem);

    hasGatewayUrl = typeof evidence.gatewayUrl === 'string' && evidence.gatewayUrl.trim().length > 0;
    const hasInvokedAt = evidence.invokedAt !== undefined;
    const hasCompletedAt = evidence.completedAt !== undefined;
    if (hasInvokedAt && hasCompletedAt) {
      const invokedMs = parseIsoTimestamp(evidence.invokedAt);
      const completedMs = parseIsoTimestamp(evidence.completedAt);
      hasCausalTimestamps = invokedMs !== undefined && completedMs !== undefined && completedMs >= invokedMs;
    }

    receiptCommit = evidence.sourceCommit ?? '';
    if (typeof headCommit === 'string' && headCommit.trim().length > 0 && receiptCommit.length > 0) {
      const normalizedHead = headCommit.trim();
      headMatches = receiptCommit.startsWith(normalizedHead) || normalizedHead.startsWith(receiptCommit);
    }

    verified.push(
      `契约结构：Profile "${evidence.profile}"、Capability "${evidence.capability ?? MOD04B_AGENTARTS_CAPABILITY}" 校验通过`,
      `任务会话：TaskId "${evidence.taskId}"，SessionId "${evidence.sessionId}"，CloudTraceId "${evidence.cloudTraceId}"`
    );

    if (isMultiAgent) {
      verified.push(`多智能体：识别到 ${agentList.length} 位协作 Agent [${agentList.join(', ')}]${evidence.multiAgent?.coordinator ? `，主协调器 "${evidence.multiAgent.coordinator}"` : ''}`);
    }

    if (hasContinuation && continuationItem) {
      verified.push(`工具延续：ProposalId "${continuationItem.proposalId}"，状态 "${continuationItem.state}"${continuationItem.toolName ? `，工具 "${continuationItem.toolName}"` : ''}`);
    }

    if (hasGatewayUrl) {
      verified.push(`云端网关：gatewayUrl "${evidence.gatewayUrl}" 校验通过（安全协议，非回环/非Mock）`);
    } else {
      verified.push('结构告警：回执中缺少有效 gatewayUrl (HTTPS/WSS) 声明');
    }

    if (evidence.runtimeName) {
      verified.push(`运行时名称：runtimeName "${evidence.runtimeName}" 校验通过`);
    }

    if (hasCausalTimestamps) {
      verified.push(`因果时序：调用时间 ${evidence.invokedAt}，完成时间 ${evidence.completedAt}（单调递增）`);
    } else if (hasInvokedAt || hasCompletedAt) {
      verified.push('结构告警：调用与完成时间戳缺失或不满足因果时序单调性');
    }

    if (typeof headMatches === 'boolean') {
      verified.push(`源码提交：sourceCommit "${receiptCommit}" ${headMatches ? '匹配' : '不匹配'} HEAD "${headCommit}"`);
    }

    if (toolProposalVerified) {
      verified.push('工具提案核验：toolProposalVerified 核验通过（本地 Policy/ToolGateway 双向授权匹配）');
    }

    if (multiAgentRoutingVerified) {
      verified.push('路由分派核验：multiAgentRoutingVerified 核验通过');
    }

    if (continuationVerified) {
      verified.push('多轮续答核验：continuationVerified 核验通过');
    }

    if (traceReadbackVerified) {
      verified.push('链路追踪核验：traceReadbackVerified 核验通过');
    }
  }

  // Real cloud execution authority boundary:
  // In offline context, schema validation of multi-agent results and continuation items does NOT substitute
  // for genuine AgentArts cloud multi-agent orchestration, live model inference, and external trace readback.
  // Hence closedLoop strictly remains false and status remains unavailable.
  const pending: Mod04bAgentArtsPendingItem[] = [];

  // Item 1: agentarts_real_cloud_endpoint
  if (!evidence || !hasGatewayUrl || !hasCausalTimestamps) {
    pending.push({
      item: 'agentarts_real_cloud_endpoint',
      description: '华为云 AgentArts 真实端点未核验（回执缺少有效 gatewayUrl HTTPS/WSS 或调用/完成时间戳时序倒挂/缺失）',
      status: 'unavailable' as const,
      reason: MOD04B_AGENTARTS_PENDING_REASON,
    });
  } else {
    pending.push({
      item: 'agentarts_real_cloud_endpoint',
      description: '华为云 AgentArts 真实端点（HTTPS/WSS）与有效凭据（Authorization）端到端连通读回（非本地 Fake）',
      status: 'unavailable' as const,
      reason: MOD04B_AGENTARTS_PENDING_REASON,
    });
  }

  // Item 2: agentarts_multi_agent_routing
  if (!isMultiAgent || !multiAgentRoutingVerified) {
    pending.push({
      item: 'agentarts_multi_agent_routing',
      description: 'AgentArts 云端多智能体协作网络角色路由未核验（需至少 2 位不同 Agent 且 multiAgentRoutingVerified=true）',
      status: 'unavailable' as const,
      reason: MOD04B_AGENTARTS_PENDING_REASON,
    });
  } else {
    pending.push({
      item: 'agentarts_multi_agent_routing',
      description: 'AgentArts 云端多智能体协作网络（主协调器与专业子 Agent）角色路由与分派结果真实读回',
      status: 'unavailable' as const,
      reason: MOD04B_AGENTARTS_PENDING_REASON,
    });
  }

  // Item 3: agentarts_continuation_roundtrip
  if (!hasContinuation || !continuationVerified) {
    pending.push({
      item: 'agentarts_continuation_roundtrip',
      description: '基于真实提案 proposalId 的受限 continuation 延续未核验（需 confirmed 延续回执且 continuationVerified=true）',
      status: 'unavailable' as const,
      reason: MOD04B_AGENTARTS_PENDING_REASON,
    });
  } else {
    pending.push({
      item: 'agentarts_continuation_roundtrip',
      description: '基于真实提案 proposalId 的受限 continuation 工具结果回传与多轮续答闭环读回',
      status: 'unavailable' as const,
      reason: MOD04B_AGENTARTS_PENDING_REASON,
    });
  }

  // Item 4: agentarts_tool_proposal_verification
  if (!toolProposalVerified) {
    pending.push({
      item: 'agentarts_tool_proposal_verification',
      description: '云端生成 ToolProposal 授权与结果核实未通过（需 toolProposalVerified=true 经本地 Policy/ToolGateway 双向读回）',
      status: 'unavailable' as const,
      reason: MOD04B_AGENTARTS_PENDING_REASON,
    });
  } else {
    pending.push({
      item: 'agentarts_tool_proposal_verification',
      description: '云端生成 ToolProposal 到本地 Policy/ToolGateway 授权审批与结果核实的双向读回',
      status: 'unavailable' as const,
      reason: MOD04B_AGENTARTS_PENDING_REASON,
    });
  }

  // Item 5: platform_independent_trace_and_cost
  if (!traceReadbackVerified) {
    pending.push({
      item: 'platform_independent_trace_and_cost',
      description: '华为云平台独立 TraceId 关联与计费未核验（需 traceReadbackVerified=true）',
      status: 'unavailable' as const,
      reason: MOD04B_AGENTARTS_PENDING_REASON,
    });
  } else {
    pending.push({
      item: 'platform_independent_trace_and_cost',
      description: '华为云平台独立 TraceId 关联、步骤耗时与 Token 消耗/计费真实读回（非本地模拟）',
      status: 'unavailable' as const,
      reason: MOD04B_AGENTARTS_PENDING_REASON,
    });
  }

  // Item 6: local_cancellation_and_deadline_settlement
  pending.push({
    item: 'local_cancellation_and_deadline_settlement',
    description: '真实网络延迟下的本地 deadline 与取消信号传播、不交付迟到结果的对账读回',
    status: 'unavailable' as const,
    reason: MOD04B_AGENTARTS_PENDING_REASON,
  });

  if (evidence && headMatches !== true) {
    pending.push({
      item: 'source_head_commit_alignment',
      description: typeof headCommit === 'string' && headCommit.trim().length > 0
        ? `读回源提交 (${receiptCommit}) 与当前 HEAD (${headCommit}) 不对齐，需在当前代码构建下重新执行真云验收`
        : '未提供当前 HEAD commit 比对，需在当前代码构建下重新执行真云验收',
      status: 'unavailable' as const,
      reason: MOD04B_AGENTARTS_PENDING_REASON,
    });
  }

  if (evidence) {
    const missingFields: string[] = [];
    if (!hasGatewayUrl) missingFields.push('gatewayUrl');
    if (!hasCausalTimestamps) missingFields.push('causal_timestamps');
    if (!isMultiAgent) missingFields.push('multiAgent');
    if (!hasContinuation) missingFields.push('continuation');
    if (rce?.authenticated !== true) missingFields.push('authenticated');
    if (!multiAgentRoutingVerified) missingFields.push('multiAgentRoutingVerified');
    if (!continuationVerified) missingFields.push('continuationVerified');
    if (!toolProposalVerified) missingFields.push('toolProposalVerified');
    if (!traceReadbackVerified) missingFields.push('traceReadbackVerified');

    structuralVerification = {
      hasGatewayUrl,
      hasCausalTimestamps,
      isMultiAgent,
      hasContinuation,
      authenticated: rce?.authenticated === true,
      multiAgentRoutingVerified,
      continuationVerified,
      toolProposalVerified,
      traceReadbackVerified,
      missingFields,
      fullyCovered: missingFields.length === 0,
    };
  }

  if (customPendingItems) {
    for (const item of customPendingItems) {
      pending.push({
        item,
        description: item,
        status: 'unavailable' as const,
        reason: MOD04B_AGENTARTS_PENDING_REASON,
      });
    }
  }

  return {
    profile: MOD04B_AGENTARTS_PROFILE,
    capability: MOD04B_AGENTARTS_CAPABILITY,
    status: 'unavailable',
    closedLoop: false,
    taskId: evidence ? evidence.taskId : explicitTaskId,
    sessionId: evidence?.sessionId,
    cloudTraceId: evidence?.cloudTraceId,
    runtimeName: evidence?.runtimeName,
    gatewayUrl: evidence?.gatewayUrl,
    invokedAt: evidence?.invokedAt,
    completedAt: evidence?.completedAt,
    sourceCommit: evidence?.sourceCommit,
    headCommit,
    headMatches,
    verified,
    pending,
    reason: MOD04B_AGENTARTS_PENDING_REASON,
    limits,
    structuralVerification,
    multiAgentStatus: {
      isMultiAgent,
      agentCount: agentList.length,
      agents: agentList,
    },
    continuationStatus: {
      hasContinuation,
      proposalId: continuationItem?.proposalId,
      state: continuationItem?.state,
    },
  };
}
