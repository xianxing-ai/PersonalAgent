import { ProtocolError } from '@personal-agent/contracts';
import { getOwnedBindings } from './bindings.js';

export const DEPLOYMENT_ACCEPTANCE_PENDING_REASON = '待真云验收' as const;

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
  readonly realCloudEvidence?: RealCloudEvidence | boolean | undefined;
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
  receiptOrOptions: unknown | PlanDeploymentAcceptanceOptions,
  extraOptions?: Omit<PlanDeploymentAcceptanceOptions, 'receipt'>
): DeploymentAcceptancePlan {
  let receiptInput: unknown;
  let headCommit: string | undefined;
  let realCloudEvidence: RealCloudEvidence | boolean | undefined;
  let requiredBindings: readonly string[] | undefined;
  let customPendingItems: readonly string[] | undefined;

  if (receiptOrOptions && typeof receiptOrOptions === 'object' && 'receipt' in (receiptOrOptions as Record<string, unknown>)) {
    const opts = receiptOrOptions as PlanDeploymentAcceptanceOptions;
    receiptInput = opts.receipt;
    headCommit = opts.headCommit ?? extraOptions?.headCommit;
    realCloudEvidence = opts.realCloudEvidence ?? extraOptions?.realCloudEvidence;
    requiredBindings = opts.requiredBindings ?? extraOptions?.requiredBindings;
    customPendingItems = opts.customPendingItems ?? extraOptions?.customPendingItems;
  } else {
    receiptInput = receiptOrOptions;
    headCommit = extraOptions?.headCommit;
    realCloudEvidence = extraOptions?.realCloudEvidence;
    requiredBindings = extraOptions?.requiredBindings;
    customPendingItems = extraOptions?.customPendingItems;
  }

  assertDeploymentReadbackReceipt(receiptInput);
  const receipt = receiptInput as DeploymentReadbackReceipt;

  const rawGateway = (receipt.gatewayUrl ?? (receipt as { gatewayOrigin?: string }).gatewayOrigin) as string;
  const gatewayOrigin = new URL(rawGateway).origin;
  const receiptCommit = receipt.sourceCommit ?? receipt.sourceRevision ?? receipt.sourceCommitShort ?? '';

  let headMatches: boolean | undefined;
  if (typeof headCommit === 'string' && headCommit.trim().length > 0) {
    const normalizedHead = headCommit.trim();
    headMatches = receiptCommit.startsWith(normalizedHead) || normalizedHead.startsWith(receiptCommit);
  }

  let hasRealCloud = false;
  if (typeof realCloudEvidence === 'boolean') {
    hasRealCloud = realCloudEvidence;
  } else if (realCloudEvidence && typeof realCloudEvidence === 'object') {
    hasRealCloud = realCloudEvidence.authenticated === true && realCloudEvidence.apiCallVerified === true;
  }

  if (receipt.cloudEvidence === false || receipt.evidenceLevel === 'mock') {
    hasRealCloud = false;
  }

  const expectedBindingIds = requiredBindings && requiredBindings.length > 0
    ? [...requiredBindings]
    : getOwnedBindings().map(b => b.id);
  const reportedBindings = receipt.bindings ? new Set(receipt.bindings) : new Set<string>();
  const missingBindings = expectedBindingIds.filter(id => !reportedBindings.has(id));
  const verifiedBindingsCount = expectedBindingIds.length - missingBindings.length;

  const verified: string[] = [
    `契约结构：Profile "${receipt.profile}" 校验通过`,
    `部署标识：Runtime "${receipt.runtimeName}" (${receipt.runtimeId})，版本 "${receipt.deploymentVersion}"`,
    `网关与区域：${gatewayOrigin} (${receipt.region})，运行时状态 "${receipt.runtimeStatus}"`,
  ];

  if (headMatches === true) {
    verified.push(`代码对齐：当前 HEAD 提交 (${headCommit}) 与部署源提交 (${receiptCommit}) 一致`);
  }

  if (reportedBindings.size > 0) {
    verified.push(`绑定核验：上报 ${reportedBindings.size} 项，覆盖目标绑定 ${verifiedBindingsCount}/${expectedBindingIds.length}`);
  }

  const limits: readonly string[] = [
    '本规划仅执行本地契约结构与离线约束校验，未连接华为云或使用真实账号',
    '缺少华为云真实执行证据时，全链路闭环标记为 closedLoop=false，状态标记为 unavailable',
    '本地 Fake/合成回执不能代替华为云 AgentArts 控制台与在线 Runtime API 的端到端读回',
  ];

  if (!hasRealCloud || headMatches === false) {
    const pendingSpecs: { item: string; description: string }[] = [];

    if (headMatches === false) {
      pendingSpecs.push({
        item: 'head_commit_alignment',
        description: `部署源提交 (${receiptCommit}) 与当前 HEAD (${headCommit}) 不一致，需重新构建部署或核实代码基线`,
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
        description: '8 工作流 / 3 控制器绑定在已发布 Runtime 的真实端到端调用读回',
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
      profile: receipt.profile,
      status: 'unavailable',
      closedLoop: false,
      deploymentVersion: receipt.deploymentVersion,
      runtimeName: receipt.runtimeName,
      runtimeId: receipt.runtimeId,
      gatewayUrl: gatewayOrigin,
      region: receipt.region,
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
    };
  }

  // Real cloud evidence is present and headMatches !== false
  return {
    profile: receipt.profile,
    status: 'verified',
    closedLoop: true,
    deploymentVersion: receipt.deploymentVersion,
    runtimeName: receipt.runtimeName,
    runtimeId: receipt.runtimeId,
    gatewayUrl: gatewayOrigin,
    region: receipt.region,
    sourceCommit: receiptCommit,
    headCommit,
    headMatches,
    verified,
    pending: [],
    reason: '已验证真实云端读回',
    limits,
    bindingsStatus: {
      expectedCount: expectedBindingIds.length,
      verifiedCount: verifiedBindingsCount,
      missingBindings,
    },
  };
}
