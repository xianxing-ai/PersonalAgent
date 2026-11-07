import { ProtocolError } from '@personal-agent/contracts';
import { getOwnedBindings } from './bindings.js';

export const PLAN_ID = 'deployment-readback-plan';
export const PLAN_TITLE = 'AgentArts 部署当前 HEAD 端到端读回离线规划';
export const DEPLOYMENT_ACCEPTANCE_PENDING_REASON = '待真云验收' as const;

/**
 * 必需环境声明（依据 docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md §1/§2）
 */
export const REQUIRED_ENVIRONMENTS = ['huawei_cloud', 'real_account'];

/**
 * 验收步骤声明（依据 docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md §2.3）
 */
export const ACCEPTANCE_STEPS = [
  '华为云账号凭据认证与受信端点绑定读回（huawei_cloud_credentials_readback）',
  '当前 HEAD 提交对应的已发布 ARM64 Runtime 部署版本状态读回（runtime_head_deployment_verified）',
  '8 工作流 / 3 控制器绑定在已发布 Runtime 的真实端到端调用读回（owned_bindings_invocation_readback）',
  'AgentArts 云端多智能体角色路由与模型推理真实回执（multi_agent_routing_and_inference）',
  '平台独立 TraceId 关联与 Token/计费读回（platform_independent_trace_and_cost）',
  '本地 Policy/ToolGateway 授权到真实目标读回与 Evidence 落盘的完整端到端闭环（local_policy_evidence_closed_loop）',
];

/**
 * 验收证据要求声明（依据 docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md §1/§2）
 */
export const EVIDENCE_REQUIREMENTS = [
  'DeploymentReadbackReceipt 合规回执（Profile 为 huawei_ict_agentarts、HTTPS origin、HEAD commit 对齐、ARM64 deploymentVersion）',
  '华为云平台独立 TraceId 关联与 Token/计费回执（非本地应用日志）',
  '本地 Policy/ToolGateway 授权与真实目标读回 Evidence 审计记录',
];

/**
 * 默认待真云验收挂起项声明（依据 docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md §2.3）
 */
export const DEFAULT_PENDING_ITEMS = [
  'huawei_cloud_credentials_readback',
  'runtime_head_deployment_verified',
  'owned_bindings_invocation_readback',
  'multi_agent_routing_and_inference',
  'platform_independent_trace_and_cost',
  'local_policy_evidence_closed_loop',
];

export interface DeploymentReadbackReceipt {
  readonly profile: 'huawei_ict_agentarts';
  readonly runtimeName: string;
  readonly runtimeId: string;
  readonly deploymentVersion: string;
  readonly gatewayUrl: string;
  readonly region: string;
  readonly sourceCommit?: string | undefined;
  readonly sourceCommitShort?: string | undefined;
  readonly sourceRevision?: string | undefined;
  readonly runtimeStatus: string;
  readonly endpoint?: string | undefined;
  readonly image?: string | undefined;
  readonly imageDigest?: string | undefined;
  readonly observedAt?: string | undefined;
  readonly evidenceLevel?: 'mock' | 'conditional' | 'verified' | undefined;
  readonly bindings?: readonly string[] | undefined;
  readonly cloudEvidence?: boolean | undefined;
  readonly configurationReadback?: Record<string, unknown> | undefined;
}

export interface DeploymentPendingItem {
  readonly item: string;
  readonly description: string;
  readonly status: 'unavailable' | 'pending';
  readonly reason: typeof DEPLOYMENT_ACCEPTANCE_PENDING_REASON | string;
}

export interface DeploymentStructuralVerification {
  readonly authenticated: boolean;
  readonly accountBound: boolean;
  readonly apiCallVerified: boolean;
  readonly traceReadbackVerified: boolean;
  readonly missingFields: readonly string[];
  readonly fullyCovered: boolean;
}

export interface DeploymentAcceptancePlan {
  readonly profile: 'huawei_ict_agentarts';
  readonly status: 'unavailable' | 'in_progress' | 'ready' | 'verified';
  readonly closedLoop: boolean;
  readonly deploymentVersion: string;
  readonly runtimeName: string;
  readonly runtimeId: string;
  readonly gatewayUrl: string;
  readonly region: string;
  readonly sourceCommit: string;
  readonly headCommit?: string | undefined;
  readonly headMatches?: boolean | undefined;
  readonly verified: readonly string[];
  readonly pending: readonly DeploymentPendingItem[];
  readonly reason: typeof DEPLOYMENT_ACCEPTANCE_PENDING_REASON | string;
  readonly limits: readonly string[];
  readonly bindingsStatus: {
    readonly expectedCount: number;
    readonly verifiedCount: number;
    readonly missingBindings: readonly string[];
  };
  readonly structuralVerification?: DeploymentStructuralVerification | undefined;
}

export interface RealCloudEvidence {
  readonly authenticated: boolean;
  readonly accountBound?: boolean | undefined;
  readonly apiCallVerified?: boolean | undefined;
  readonly traceReadbackVerified?: boolean | undefined;
}

export interface PlanDeploymentAcceptanceOptions {
  readonly receipt: unknown;
  readonly headCommit?: string | undefined;
  readonly realCloudEvidence?: RealCloudEvidence | undefined;
  readonly requiredBindings?: readonly string[] | undefined;
  readonly customPendingItems?: readonly string[] | undefined;
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ProtocolError('INVALID_ARGUMENT', message);
}

/**
 * Validates the shape and structural constraints of a deployment readback receipt.
 * Ensures strict profile matching ("huawei_ict_agentarts"), valid gateway HTTPS origin,
 * and standard deployment identifiers.
 */
export function assertDeploymentReadbackReceipt(value: unknown): asserts value is DeploymentReadbackReceipt {
  if (!plain(value)) {
    fail('Deployment readback receipt must be an object');
  }

  if (value.profile !== 'huawei_ict_agentarts') {
    fail('Deployment readback receipt profile must be "huawei_ict_agentarts"');
  }

  if (typeof value.runtimeName !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.runtimeName)) {
    fail('Deployment readback receipt runtimeName must be 1-64 characters (alphanumeric, underscore, dash)');
  }

  if (typeof value.runtimeId !== 'string' || value.runtimeId.trim().length === 0) {
    fail('Deployment readback receipt runtimeId must be non-empty string');
  }

  if (typeof value.deploymentVersion !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.deploymentVersion)) {
    fail('Deployment readback receipt deploymentVersion must be 1-128 characters (alphanumeric, dash, underscore, dot)');
  }

  const gateway = value.gatewayUrl ?? value.gatewayOrigin;
  if (typeof gateway !== 'string') {
    fail('Deployment readback receipt gatewayUrl must be a valid HTTPS URL string');
  }

  try {
    const url = new URL(gateway);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
      fail('Deployment readback receipt gatewayUrl must be an HTTPS URL with origin only (no path, credentials or query)');
    }
  } catch (err) {
    if (err instanceof ProtocolError) throw err;
    fail('Deployment readback receipt gatewayUrl must be a valid HTTPS URL');
  }

  if (typeof value.region !== 'string' || value.region.trim().length === 0) {
    fail('Deployment readback receipt region must be non-empty string');
  }

  const commit = value.sourceCommit ?? value.sourceRevision ?? value.sourceCommitShort;
  if (typeof commit !== 'string' || commit.trim().length === 0) {
    fail('Deployment readback receipt must specify sourceCommit, sourceRevision, or sourceCommitShort');
  }

  if (typeof value.runtimeStatus !== 'string' || value.runtimeStatus.trim().length === 0) {
    fail('Deployment readback receipt runtimeStatus must be non-empty string');
  }

  if (value.observedAt !== undefined && (typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt)))) {
    fail('Deployment readback receipt observedAt must be a valid ISO date string');
  }

  if (value.bindings !== undefined && (!Array.isArray(value.bindings) || value.bindings.some(b => typeof b !== 'string'))) {
    fail('Deployment readback receipt bindings must be an array of strings');
  }

  if (value.imageDigest !== undefined && (typeof value.imageDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(value.imageDigest))) {
    fail('Deployment readback receipt imageDigest must be sha256 hex digest');
  }
}

/**
 * Convenience parser returning typed DeploymentReadbackReceipt or throwing ProtocolError.
 */
export function parseDeploymentReadbackReceipt(value: unknown): DeploymentReadbackReceipt {
  assertDeploymentReadbackReceipt(value);
  return value;
}

/**
 * Plans deployment acceptance verification for MOD-29.
 * When real authenticated Huawei Cloud evidence is absent, closedLoop is strictly false,
 * status is unavailable, and all pending items require real cloud acceptance.
 */
export function planDeploymentAcceptance(
  receiptOrOptions?: unknown | PlanDeploymentAcceptanceOptions,
  extraOptions?: Omit<PlanDeploymentAcceptanceOptions, 'receipt'>
): DeploymentAcceptancePlan {
  let receiptInput: unknown;
  let headCommit: string | undefined;
  let realCloudEvidence: unknown;
  let requiredBindings: readonly string[] | undefined;
  let customPendingItems: readonly string[] | undefined;

  if (receiptOrOptions && typeof receiptOrOptions === 'object') {
    const obj = receiptOrOptions as Record<string, unknown>;
    if ('receipt' in obj) {
      receiptInput = obj.receipt;
      headCommit = (obj.headCommit as string | undefined) ?? extraOptions?.headCommit;
      realCloudEvidence = obj.realCloudEvidence ?? extraOptions?.realCloudEvidence;
      requiredBindings = (obj.requiredBindings as readonly string[] | undefined) ?? extraOptions?.requiredBindings;
      customPendingItems = (obj.customPendingItems as readonly string[] | undefined) ?? extraOptions?.customPendingItems;
    } else if ('profile' in obj) {
      receiptInput = receiptOrOptions;
      headCommit = extraOptions?.headCommit;
      realCloudEvidence = extraOptions?.realCloudEvidence;
      requiredBindings = extraOptions?.requiredBindings;
      customPendingItems = extraOptions?.customPendingItems;
    } else if (Object.keys(obj).length === 0) {
      receiptInput = undefined;
      headCommit = extraOptions?.headCommit;
    } else {
      receiptInput = receiptOrOptions;
      headCommit = extraOptions?.headCommit;
    }
  } else {
    receiptInput = receiptOrOptions;
    headCommit = extraOptions?.headCommit;
  }

  // Runtime defense against caller passing boolean for realCloudEvidence
  if (typeof realCloudEvidence === 'boolean') {
    fail('realCloudEvidence must be an object, boolean is not supported');
  }

  let structuralVerification: DeploymentStructuralVerification | undefined;

  let typedCloudEvidence: RealCloudEvidence | undefined;
  if (realCloudEvidence !== undefined) {
    if (!plain(realCloudEvidence)) {
      fail('realCloudEvidence must be an object');
    }
    typedCloudEvidence = realCloudEvidence as unknown as RealCloudEvidence;
  }

  const limits: readonly string[] = [
    '本规划仅执行本地契约结构与离线约束校验，未连接华为云或使用真实账号',
    '缺少华为云真实执行证据时，全链路闭环标记为 closedLoop=false，状态标记为 unavailable',
    '本地自报/合成回执不能代替华为云 AgentArts 控制台与在线 Runtime API 的端到端读回',
  ];

  const expectedBindingIds = requiredBindings && requiredBindings.length > 0
    ? [...requiredBindings]
    : getOwnedBindings().map(b => b.id);

  let receipt: DeploymentReadbackReceipt | undefined;
  let gatewayOrigin = '';
  let receiptCommit = '';
  let headMatches: boolean | undefined;
  let verifiedBindingsCount = 0;
  let missingBindings: readonly string[] = expectedBindingIds;
  const verified: string[] = [];

  if (receiptInput !== undefined) {
    assertDeploymentReadbackReceipt(receiptInput);
    receipt = receiptInput;

    const rawGateway = (receipt.gatewayUrl ?? (receipt as { gatewayOrigin?: string }).gatewayOrigin) as string;
    gatewayOrigin = new URL(rawGateway).origin;
    receiptCommit = receipt.sourceCommit ?? receipt.sourceRevision ?? receipt.sourceCommitShort ?? '';

    if (typeof headCommit === 'string' && headCommit.trim().length > 0) {
      const normalizedHead = headCommit.trim();
      headMatches = receiptCommit.startsWith(normalizedHead) || normalizedHead.startsWith(receiptCommit);
    }

    const reportedBindings = receipt.bindings ? new Set(receipt.bindings) : new Set<string>();
    missingBindings = expectedBindingIds.filter(id => !reportedBindings.has(id));
    verifiedBindingsCount = expectedBindingIds.length - missingBindings.length;

    verified.push(
      `契约结构：Profile "${receipt.profile}" 校验通过`,
      `部署标识：Runtime "${receipt.runtimeName}" (${receipt.runtimeId})，版本 "${receipt.deploymentVersion}"`,
      `网关与区域：${gatewayOrigin} (${receipt.region})，运行时状态 "${receipt.runtimeStatus}"`
    );

    if (headMatches === true) {
      verified.push(`代码对齐：当前 HEAD 提交 (${headCommit}) 与部署源提交 (${receiptCommit}) 一致`);
    }

    if (reportedBindings.size > 0) {
      verified.push(`绑定核验：上报 ${reportedBindings.size} 项，覆盖目标绑定 ${verifiedBindingsCount}/${expectedBindingIds.length}`);
    }

    if (typedCloudEvidence) {
      const missingFields: string[] = [];
      if (typedCloudEvidence.authenticated !== true) missingFields.push('authenticated');
      if (typedCloudEvidence.accountBound !== true) missingFields.push('accountBound');
      if (typedCloudEvidence.apiCallVerified !== true) missingFields.push('apiCallVerified');
      if (typedCloudEvidence.traceReadbackVerified !== true) missingFields.push('traceReadbackVerified');

      structuralVerification = {
        authenticated: typedCloudEvidence.authenticated === true,
        accountBound: typedCloudEvidence.accountBound === true,
        apiCallVerified: typedCloudEvidence.apiCallVerified === true,
        traceReadbackVerified: typedCloudEvidence.traceReadbackVerified === true,
        missingFields: Object.freeze(missingFields),
        fullyCovered: missingFields.length === 0,
      };

      if (structuralVerification.fullyCovered) {
        verified.push('结构核验：自报云证据对象包含认证、API调用、Trace读回及账号绑定全量声明（离线占位，待真云验收）');
      } else {
        verified.push(`结构告警：自报云证据对象未完整包含全部结构字段，缺失项: [${missingFields.join(', ')}]`);
      }
    }
  } else {
    verified.push('离线规划：未提供部署读回回执，已生成 AgentArts 部署读回离线验收规划');
  }

  const pendingSpecs: { item: string; description: string }[] = [];

  if (receipt && headMatches !== true) {
    pendingSpecs.push({
      item: 'head_commit_alignment',
      description: headMatches === false
        ? `部署源提交 (${receiptCommit}) 与当前 HEAD (${headCommit}) 不一致，需重新构建部署或核实代码基线`
        : `未提供当前 HEAD 提交进行代码对齐比对，需显式传入 headCommit 验证对齐`,
    });
  }

  pendingSpecs.push(
    {
      item: 'huawei_cloud_credentials_readback',
      description: '华为云账号凭据认证与受信端点绑定读回',
    },
    {
      item: 'runtime_head_deployment_verified',
      description: '当前 HEAD 提交对应的已发布 ARM64 Runtime 部署版本状态读回',
    },
    {
      item: 'owned_bindings_invocation_readback',
      description: missingBindings.length === 0
        ? '8 工作流 / 3 控制器绑定在已发布 Runtime 的真实端到端调用读回'
        : `8 工作流 / 3 控制器绑定真实端到端调用读回（缺失绑定: ${missingBindings.join(', ')}）`,
    },
    {
      item: 'multi_agent_routing_and_inference',
      description: 'AgentArts 云端多智能体角色路由与模型推理真实回执',
    },
    {
      item: 'platform_independent_trace_and_cost',
      description: '平台独立 TraceId 关联与 Token/计费读回（非本地应用日志）',
    },
    {
      item: 'local_policy_evidence_closed_loop',
      description: '本地 Policy/ToolGateway 授权到真实目标读回与 Evidence 落盘的完整端到端闭环',
    }
  );

  if (customPendingItems) {
    for (const item of customPendingItems) {
      pendingSpecs.push({ item, description: item });
    }
  }

  const pending: DeploymentPendingItem[] = pendingSpecs.map(spec => ({
    item: spec.item,
    description: spec.description,
    status: 'unavailable' as const,
    reason: DEPLOYMENT_ACCEPTANCE_PENDING_REASON,
  }));

  return {
    profile: receipt ? receipt.profile : 'huawei_ict_agentarts',
    status: 'unavailable',
    closedLoop: false,
    deploymentVersion: receipt ? receipt.deploymentVersion : '',
    runtimeName: receipt ? receipt.runtimeName : '',
    runtimeId: receipt ? receipt.runtimeId : '',
    gatewayUrl: gatewayOrigin,
    region: receipt ? receipt.region : '',
    sourceCommit: receiptCommit,
    headCommit,
    headMatches,
    verified,
    pending,
    reason: DEPLOYMENT_ACCEPTANCE_PENDING_REASON,
    limits,
    bindingsStatus: {
      expectedCount: expectedBindingIds.length,
      verifiedCount: verifiedBindingsCount,
      missingBindings,
    },
    structuralVerification,
  };
}
