import { ProtocolError } from '@personal-agent/contracts';

export const F09_ACCEPTANCE_PENDING_REASON = '待真云验收' as const;

export const F09_WORKFLOW_NODES = [
  'F09_N01',
  'F09_N02',
  'F09_N03',
  'F09_N04',
] as const;

export interface F09SessionAuthReadback {
  readonly sessionId: string;
  readonly authorizationRef: string;
  readonly grantedScopes: readonly string[];
  readonly expiresAt: string;
  readonly sessionState: 'active' | 'authorized' | 'granted';
  readonly grantedAt?: string | undefined;
  readonly mock?: boolean | undefined;
}

export interface F09CloudPrefixReceipt {
  readonly profile: 'huawei_ict_agentarts';
  readonly workflowId: 'F09';
  readonly gatewayUrl: string;
  readonly cloudPrefix: string;
  readonly runtimeName: string;
  readonly deploymentVersion?: string | undefined;
  readonly runtimeId?: string | undefined;
  readonly region?: string | undefined;
  readonly sessionAuth: F09SessionAuthReadback;
  readonly prefixVerified: boolean;
  readonly observedAt?: string | undefined;
  readonly evidenceLevel?: 'mock' | 'conditional' | 'verified' | undefined;
  readonly cloudEvidence?: boolean | undefined;
  readonly mock?: boolean | undefined;
  readonly sourceCommit?: string | undefined;
  readonly nodes?: readonly string[] | undefined;
}

export interface F09PendingItem {
  readonly item: string;
  readonly description: string;
  readonly status: 'unavailable';
  readonly reason: typeof F09_ACCEPTANCE_PENDING_REASON | string;
}

export interface RealCloudEvidence {
  readonly authenticated: boolean;
  readonly apiCallVerified?: boolean | undefined;
  readonly prefixRouteVerified?: boolean | undefined;
  readonly sessionAuthVerified?: boolean | undefined;
  readonly traceReadbackVerified?: boolean | undefined;
}

export interface PlanF09CloudPrefixAcceptanceOptions {
  readonly receipt?: unknown | undefined;
  readonly headCommit?: string | undefined;
  readonly realCloudEvidence?: RealCloudEvidence | boolean | undefined;
  readonly customPendingItems?: readonly string[] | undefined;
}

export interface F09CloudPrefixAcceptancePlan {
  readonly profile: 'huawei_ict_agentarts';
  readonly workflowId: 'F09';
  readonly status: 'unavailable' | 'in_progress' | 'ready' | 'verified';
  readonly closedLoop: boolean;
  readonly cloudPrefix?: string | undefined;
  readonly gatewayUrl?: string | undefined;
  readonly runtimeName?: string | undefined;
  readonly sourceCommit?: string | undefined;
  readonly headCommit?: string | undefined;
  readonly headMatches?: boolean | undefined;
  readonly verified: readonly string[];
  readonly pending: readonly F09PendingItem[];
  readonly reason: typeof F09_ACCEPTANCE_PENDING_REASON | string;
  readonly limits: readonly string[];
  readonly nodesStatus: {
    readonly expectedNodes: readonly string[];
    readonly reportedNodes: readonly string[];
    readonly missingNodes: readonly string[];
  };
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ProtocolError('INVALID_ARGUMENT', message);
}

/**
 * Validates the shape and structural constraints of an F09 Cloud Prefix / Session Auth readback receipt.
 * Strictly checks profile ("huawei_ict_agentarts"), workflowId ("F09"), gatewayUrl HTTPS origin,
 * cloudPrefix starting with "/", runtimeName format, sessionAuth structure, and rejects any mock evidence.
 */
export function assertF09CloudPrefixReceipt(value: unknown): asserts value is F09CloudPrefixReceipt {
  if (!plain(value)) {
    fail('F09 cloud prefix receipt must be an object');
  }

  // Reject mock explicitly
  if (value.mock === true || (value as { isMock?: unknown }).isMock === true || value.evidenceLevel === 'mock') {
    fail('F09 cloud prefix receipt rejects mock evidence');
  }

  if (value.profile !== 'huawei_ict_agentarts') {
    fail('F09 cloud prefix receipt profile must be "huawei_ict_agentarts"');
  }

  if (value.workflowId !== 'F09') {
    fail('F09 cloud prefix receipt workflowId must be "F09"');
  }

  const gateway = value.gatewayUrl;
  if (typeof gateway !== 'string') {
    fail('F09 cloud prefix receipt gatewayUrl must be a valid HTTPS URL string');
  }

  try {
    const url = new URL(gateway);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
      fail('F09 cloud prefix receipt gatewayUrl must be an HTTPS URL with origin only (no path, credentials or query)');
    }
  } catch (err) {
    if (err instanceof ProtocolError) throw err;
    fail('F09 cloud prefix receipt gatewayUrl must be a valid HTTPS URL');
  }

  if (typeof value.cloudPrefix !== 'string' || !/^\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(value.cloudPrefix)) {
    fail('F09 cloud prefix receipt cloudPrefix must be a valid path starting with "/"');
  }

  if (typeof value.runtimeName !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.runtimeName)) {
    fail('F09 cloud prefix receipt runtimeName must be 1-64 characters (alphanumeric, underscore, dash)');
  }

  if (typeof value.prefixVerified !== 'boolean') {
    fail('F09 cloud prefix receipt prefixVerified must be a boolean');
  }

  // Session authorization validation
  if (!plain(value.sessionAuth)) {
    fail('F09 cloud prefix receipt sessionAuth must be an object');
  }

  const auth = value.sessionAuth as Record<string, unknown>;

  if (auth.mock === true || auth.isMock === true) {
    fail('F09 session auth readback rejects mock authorization');
  }

  if (typeof auth.sessionId !== 'string' || auth.sessionId.trim().length === 0) {
    fail('F09 session auth readback sessionId must be a non-empty string');
  }

  if (typeof auth.authorizationRef !== 'string' || auth.authorizationRef.trim().length === 0) {
    fail('F09 session auth readback authorizationRef must be a non-empty string');
  }

  if (!Array.isArray(auth.grantedScopes) || auth.grantedScopes.length === 0 || auth.grantedScopes.some(s => typeof s !== 'string' || s.trim().length === 0)) {
    fail('F09 session auth readback grantedScopes must be a non-empty array of non-empty strings');
  }

  if (typeof auth.expiresAt !== 'string' || !Number.isFinite(Date.parse(auth.expiresAt))) {
    fail('F09 session auth readback expiresAt must be a valid ISO date string');
  }

  if (typeof auth.sessionState !== 'string' || !['active', 'authorized', 'granted'].includes(auth.sessionState)) {
    fail('F09 session auth readback sessionState must be "active", "authorized", or "granted"');
  }

  if (auth.grantedAt !== undefined && (typeof auth.grantedAt !== 'string' || !Number.isFinite(Date.parse(auth.grantedAt)))) {
    fail('F09 session auth readback grantedAt must be a valid ISO date string');
  }

  // Optional fields
  if (value.deploymentVersion !== undefined && (typeof value.deploymentVersion !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.deploymentVersion))) {
    fail('F09 cloud prefix receipt deploymentVersion must be 1-128 characters (alphanumeric, dash, underscore, dot)');
  }

  if (value.runtimeId !== undefined && (typeof value.runtimeId !== 'string' || value.runtimeId.trim().length === 0)) {
    fail('F09 cloud prefix receipt runtimeId must be a non-empty string');
  }

  if (value.region !== undefined && (typeof value.region !== 'string' || value.region.trim().length === 0)) {
    fail('F09 cloud prefix receipt region must be a non-empty string');
  }

  if (value.observedAt !== undefined && (typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt)))) {
    fail('F09 cloud prefix receipt observedAt must be a valid ISO date string');
  }

  if (value.evidenceLevel !== undefined && !['conditional', 'verified'].includes(value.evidenceLevel as string)) {
    fail('F09 cloud prefix receipt evidenceLevel must be "conditional" or "verified"');
  }

  if (value.cloudEvidence !== undefined && typeof value.cloudEvidence !== 'boolean') {
    fail('F09 cloud prefix receipt cloudEvidence must be a boolean');
  }

  if (value.sourceCommit !== undefined && (typeof value.sourceCommit !== 'string' || value.sourceCommit.trim().length === 0)) {
    fail('F09 cloud prefix receipt sourceCommit must be a non-empty string');
  }

  if (value.nodes !== undefined && (!Array.isArray(value.nodes) || value.nodes.some(n => typeof n !== 'string'))) {
    fail('F09 cloud prefix receipt nodes must be an array of string node IDs');
  }
}

/**
 * Convenience parser returning typed F09CloudPrefixReceipt or throwing ProtocolError.
 */
export function parseF09CloudPrefixReceipt(value: unknown): F09CloudPrefixReceipt {
  assertF09CloudPrefixReceipt(value);
  return value;
}

function isPlanOptions(value: unknown): value is PlanF09CloudPrefixAcceptanceOptions {
  if (!plain(value)) return false;
  if ('receipt' in value || 'customPendingItems' in value || 'realCloudEvidence' in value) {
    return true;
  }
  if ('headCommit' in value && !('gatewayUrl' in value || 'cloudPrefix' in value || 'workflowId' in value || 'sessionAuth' in value)) {
    return true;
  }
  return false;
}

/**
 * Plans F09 Cloud Prefix and Session Auth acceptance verification.
 * When real authenticated Huawei Cloud evidence is absent, closedLoop is strictly false,
 * status is unavailable, and all pending items require real cloud acceptance.
 * Pure offline helper: does not connect to cloud, does not read secret credentials.
 */
export function planF09CloudPrefixAcceptance(
  receiptOrOptions?: unknown | PlanF09CloudPrefixAcceptanceOptions,
  extraOptions?: Omit<PlanF09CloudPrefixAcceptanceOptions, 'receipt'>
): F09CloudPrefixAcceptancePlan {
  let receiptInput: unknown;
  let headCommit: string | undefined;
  let realCloudEvidence: RealCloudEvidence | boolean | undefined;
  let customPendingItems: readonly string[] | undefined;

  if (isPlanOptions(receiptOrOptions)) {
    receiptInput = receiptOrOptions.receipt;
    headCommit = receiptOrOptions.headCommit ?? extraOptions?.headCommit;
    realCloudEvidence = receiptOrOptions.realCloudEvidence ?? extraOptions?.realCloudEvidence;
    customPendingItems = receiptOrOptions.customPendingItems ?? extraOptions?.customPendingItems;
  } else {
    receiptInput = receiptOrOptions;
    headCommit = extraOptions?.headCommit;
    realCloudEvidence = extraOptions?.realCloudEvidence;
    customPendingItems = extraOptions?.customPendingItems;
  }


  const limits: readonly string[] = [
    '本规划仅执行本地契约结构与离线约束校验，未连接华为云或使用真实账号凭据',
    '缺少华为云真实前缀读回与真实会话授权时，全链路闭环标记为 closedLoop=false，状态标记为 unavailable',
    '本地 Fake 订阅/合成数据不能代替真实 feeds 提供者（Potatos498）与华为云 AgentArts 联跑证据',
    '遵循 AGENTS.md 规范：不静默回退 Local，真实缺项如实登记待真云验收',
  ];

  const defaultPendingSpecs = [
    {
      item: 'huawei_cloud_prefix_route_readback',
      description: '华为云 AgentArts 托管运行时前缀路由（/invocations/*）公网端点实际映射与读回',
    },
    {
      item: 'cloud_session_auth_and_source_grant',
      description: '华为云端到端会话授权与 feed-source-grant: 租约凭据在线读回（非本地 mock）',
    },
    {
      item: 'real_feeds_provider_binding',
      description: '真实 feeds 连接器（Potatos498 负责）多源订阅流拉取、增量 cursor 与去重校验',
    },
    {
      item: 'agentarts_decision_model_inference',
      description: 'AgentArts 代理决策模型（DeepSeek/Laya）对动态信号的语义相关性与价值判别在线推理',
    },
    {
      item: 'enqueue_research_cross_workflow_handoff',
      description: 'F09_N04 到 F10 深度研究队列的跨工作流真实任务投递与回执确认',
    },
    {
      item: 'platform_independent_trace_and_cost',
      description: 'AgentArts 平台独立 TraceId 关联与 Token/计费读回（非本地应用日志）',
    },
  ];

  const expectedNodes = [...F09_WORKFLOW_NODES];

  // Case 1: No receipt input provided -> default offline plan
  if (!receiptInput) {
    const pending: F09PendingItem[] = defaultPendingSpecs.map(spec => ({
      item: spec.item,
      description: spec.description,
      status: 'unavailable' as const,
      reason: F09_ACCEPTANCE_PENDING_REASON,
    }));

    if (customPendingItems) {
      for (const item of customPendingItems) {
        pending.push({
          item,
          description: item,
          status: 'unavailable' as const,
          reason: F09_ACCEPTANCE_PENDING_REASON,
        });
      }
    }

    return {
      profile: 'huawei_ict_agentarts',
      workflowId: 'F09',
      status: 'unavailable',
      closedLoop: false,
      headCommit,
      verified: ['离线规划：未提供读回回执，已生成 F09 华为云前缀与会话授权离线验收规划'],
      pending,
      reason: F09_ACCEPTANCE_PENDING_REASON,
      limits,
      nodesStatus: {
        expectedNodes,
        reportedNodes: [],
        missingNodes: expectedNodes,
      },
    };
  }

  // Case 2: Receipt input provided -> validate receipt
  assertF09CloudPrefixReceipt(receiptInput);
  const receipt = receiptInput as F09CloudPrefixReceipt;

  const rawGateway = receipt.gatewayUrl;
  const gatewayOrigin = new URL(rawGateway).origin;
  const receiptCommit = receipt.sourceCommit ?? '';

  let headMatches: boolean | undefined;
  if (typeof headCommit === 'string' && headCommit.trim().length > 0 && receiptCommit.length > 0) {
    const normalizedHead = headCommit.trim();
    headMatches = receiptCommit.startsWith(normalizedHead) || normalizedHead.startsWith(receiptCommit);
  }

  let hasRealCloud = false;
  if (typeof realCloudEvidence === 'boolean') {
    hasRealCloud = realCloudEvidence;
  } else if (realCloudEvidence && typeof realCloudEvidence === 'object') {
    hasRealCloud = realCloudEvidence.authenticated === true &&
      realCloudEvidence.apiCallVerified === true &&
      realCloudEvidence.prefixRouteVerified === true &&
      realCloudEvidence.sessionAuthVerified === true;
  }

  if (receipt.cloudEvidence === false || receipt.evidenceLevel === 'mock' || receipt.prefixVerified === false) {
    hasRealCloud = false;
  }

  const reportedNodes = receipt.nodes ? [...receipt.nodes] : [];
  const missingNodes = expectedNodes.filter(n => !reportedNodes.includes(n));

  const verified: string[] = [
    `契约结构：Profile "${receipt.profile}"、WorkflowId "${receipt.workflowId}" 校验通过`,
    `云端前缀：网关 ${gatewayOrigin}，前缀路径 "${receipt.cloudPrefix}"，运行时 "${receipt.runtimeName}"`,
    `会话授权：SessionId "${receipt.sessionAuth.sessionId}"，授权引用 "${receipt.sessionAuth.authorizationRef}"，范围 [${receipt.sessionAuth.grantedScopes.join(', ')}]，状态 "${receipt.sessionAuth.sessionState}"`,
  ];

  if (headMatches === true) {
    verified.push(`代码对齐：当前 HEAD 提交 (${headCommit}) 与前缀回执源提交 (${receiptCommit}) 一致`);
  }

  if (reportedNodes.length > 0) {
    verified.push(`节点核验：覆盖 ${reportedNodes.length}/${expectedNodes.length} 工作流节点 [${reportedNodes.join(', ')}]`);
  }

  if (!hasRealCloud || headMatches === false) {
    const pendingSpecs: { item: string; description: string }[] = [];

    if (headMatches === false) {
      pendingSpecs.push({
        item: 'head_commit_alignment',
        description: `前缀源提交 (${receiptCommit}) 与当前 HEAD (${headCommit}) 不一致，需核实代码基线`,
      });
    }

    pendingSpecs.push(...defaultPendingSpecs);

    if (customPendingItems) {
      for (const item of customPendingItems) {
        pendingSpecs.push({ item, description: item });
      }
    }

    const pending: F09PendingItem[] = pendingSpecs.map(spec => ({
      item: spec.item,
      description: spec.description,
      status: 'unavailable' as const,
      reason: F09_ACCEPTANCE_PENDING_REASON,
    }));

    return {
      profile: receipt.profile,
      workflowId: receipt.workflowId,
      status: 'unavailable',
      closedLoop: false,
      cloudPrefix: receipt.cloudPrefix,
      gatewayUrl: gatewayOrigin,
      runtimeName: receipt.runtimeName,
      sourceCommit: receiptCommit || undefined,
      headCommit,
      headMatches,
      verified,
      pending,
      reason: F09_ACCEPTANCE_PENDING_REASON,
      limits,
      nodesStatus: {
        expectedNodes,
        reportedNodes,
        missingNodes,
      },
    };
  }

  // Real cloud evidence is present and headMatches !== false
  return {
    profile: receipt.profile,
    workflowId: receipt.workflowId,
    status: 'verified',
    closedLoop: true,
    cloudPrefix: receipt.cloudPrefix,
    gatewayUrl: gatewayOrigin,
    runtimeName: receipt.runtimeName,
    sourceCommit: receiptCommit || undefined,
    headCommit,
    headMatches,
    verified,
    pending: [],
    reason: '已验证真实云端读回',
    limits,
    nodesStatus: {
      expectedNodes,
      reportedNodes,
      missingNodes,
    },
  };
}
