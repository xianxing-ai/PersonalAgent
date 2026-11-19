// F18/F19：PR/Issue 图路径的平台绑定读回 host 端口。
// 对应 OPEN_WORK zemeng 第 5 项「F18/F19：PR/Issue 图路径与平台/授权读回」。
// F18_N01 github.bound_pr_diff / F18_N04 github.current_head_merge_gate /
// F19_N01 github.issue_snapshot / F19_N04 github.merged_repair_readback
// 此前只有模板声明；本模块给出消费既有 GitHub 连接器（packages/connectors/github，
// pr.get/pr.diff/issue.get 只读操作）的 WorkflowHostPort 生产实现：
//  · 绑定由受信组合提供（resolveBinding），绝不接受用户自由文本查询；
//  · 平台授权/合并闸门状态一律来自平台真实读回（source:'platform_readback'），字段缺失记 unknown，不猜；
//  · 连接器未注入 → unavailable；绑定不匹配 → failed；一切失败保持图状态语义。
import {createHash} from 'node:crypto';
import type {WorkflowHostPort, WorkflowNodeContext} from './owned-workflows.js';

const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export interface GithubBinding {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export interface GithubWorkflowReadPort {
  /** 既有 GitHub 连接器端口（GitHubService/FakeGitHubProvider 均满足该结构面）。只允许只读操作。 */
  execute(operation: 'pr.get' | 'pr.diff' | 'issue.get', input: Record<string, unknown>, context: WorkflowNodeContext): Promise<unknown>;
}

const READ_ONLY = new Set(['pr.get', 'pr.diff', 'issue.get']);
const MAX_DIFF_BYTES = 64_000;

function fail(state: 'unavailable' | 'failed' | 'unknown', reason: string, extra?: Record<string, unknown>) {
  return {state, value: {reason, ...(extra ?? {})}};
}

async function readPlatform(port: GithubWorkflowReadPort, operation: 'pr.get' | 'pr.diff' | 'issue.get',
  binding: GithubBinding, context: WorkflowNodeContext): Promise<unknown> {
  if (!READ_ONLY.has(operation)) throw new TypeError(`只允许只读操作：${operation}`);
  return port.execute(operation, {owner: binding.owner, repo: binding.repo, number: binding.number}, context);
}

function bindingMatches(value: unknown, binding: GithubBinding): boolean {
  if (!isPlainObject(value)) return false;
  const repo = value.repository ?? value.repo;
  const number = value.number ?? value.prNumber ?? value.issueNumber;
  if (typeof number === 'number' && number !== binding.number) return false;
  if (typeof repo === 'string' && repo !== `${binding.owner}/${binding.repo}`) return false;
  if (isPlainObject(repo) && (repo.owner !== binding.owner || repo.name !== binding.repo)) return false;
  return true;
}

/** F18_N01：绑定 PR 的 diff 读回（有界 + 指纹），绑定来自受信组合。 */
export function createGithubBoundPrDiffHostPort(options: {
  read: GithubWorkflowReadPort;
  resolveBinding(context: WorkflowNodeContext): GithubBinding | undefined;
  maxDiffBytes?: number;
}): WorkflowHostPort {
  const maxDiffBytes = options.maxDiffBytes ?? MAX_DIFF_BYTES;
  if (typeof options?.read?.execute !== 'function' || typeof options?.resolveBinding !== 'function') {
    throw new TypeError('createGithubBoundPrDiffHostPort 需要 read 端口与 resolveBinding');
  }
  return {
    capabilities: ['github.bound_pr_diff'],
    async read(context: WorkflowNodeContext) {
      const binding = options.resolveBinding(context);
      if (!binding || !text(binding.owner) || !text(binding.repo) || !Number.isSafeInteger(binding.number)) {
        return fail('unavailable', 'pr_binding_unavailable');
      }
      try {
        const pr = await readPlatform(options.read, 'pr.get', binding, context);
        if (!isPlainObject(pr)) return fail('failed', 'pr_readback_malformed');
        if (!bindingMatches(pr, binding)) return fail('failed', 'pr_binding_mismatch');
        const diff = await readPlatform(options.read, 'pr.diff', binding, context);
        const diffText = typeof diff === 'string' ? diff : isPlainObject(diff) && typeof diff.diff === 'string' ? diff.diff : undefined;
        if (typeof diffText !== 'string') return fail('unknown', 'diff_unavailable');
        const truncated = Buffer.byteLength(diffText, 'utf8') > maxDiffBytes;
        const diffExcerpt = Buffer.from(diffText, 'utf8').subarray(0, maxDiffBytes).toString('utf8');
        return {
          state: 'completed' as const,
          value: {
            binding: {...binding},
            headSha: typeof pr.headSha === 'string' ? pr.headSha : typeof (pr as Record<string, unknown>).head === 'string' ? (pr as Record<string, unknown>).head : undefined,
            diffExcerpt,
            truncated,
            diffSha256: createHash('sha256').update(diffText, 'utf8').digest('hex'),
            readbackAt: new Date().toISOString(),
            source: 'platform_readback',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'platform_read_failed');
      }
    },
  };
}

/** F18_N04：合并闸门状态——平台真实读回，字段缺失记 unknown，绝不猜测。 */
export function createGithubMergeGateHostPort(options: {
  read: GithubWorkflowReadPort;
  resolveBinding(context: WorkflowNodeContext): GithubBinding | undefined;
}): WorkflowHostPort {
  if (typeof options?.read?.execute !== 'function' || typeof options?.resolveBinding !== 'function') {
    throw new TypeError('createGithubMergeGateHostPort 需要 read 端口与 resolveBinding');
  }
  return {
    capabilities: ['github.current_head_merge_gate'],
    async read(context: WorkflowNodeContext) {
      const binding = options.resolveBinding(context);
      if (!binding) return fail('unavailable', 'pr_binding_unavailable');
      try {
        const pr = await readPlatform(options.read, 'pr.get', binding, context);
        if (!isPlainObject(pr)) return fail('failed', 'pr_readback_malformed');
        if (!bindingMatches(pr, binding)) return fail('failed', 'pr_binding_mismatch');
        const mergeable = pr.mergeable;
        const mergeStateStatus = pr.mergeStateStatus ?? pr.merge_state_status;
        if (mergeable === undefined && !text(mergeStateStatus)) return fail('unknown', 'merge_gate_fields_missing');
        return {
          state: 'completed' as const,
          value: {
            binding: {...binding},
            mergeable: mergeable === undefined ? undefined : mergeable === true,
            mergeStateStatus: text(mergeStateStatus) ? mergeStateStatus : undefined,
            headSha: typeof pr.headSha === 'string' ? pr.headSha : undefined,
            readbackAt: new Date().toISOString(),
            source: 'platform_readback',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'platform_read_failed');
      }
    },
  };
}

/** F19_N01：Issue 快照（有界），绑定来自受信组合。 */
export function createGithubIssueSnapshotHostPort(options: {
  read: GithubWorkflowReadPort;
  resolveBinding(context: WorkflowNodeContext): GithubBinding | undefined;
}): WorkflowHostPort {
  if (typeof options?.read?.execute !== 'function' || typeof options?.resolveBinding !== 'function') {
    throw new TypeError('createGithubIssueSnapshotHostPort 需要 read 端口与 resolveBinding');
  }
  return {
    capabilities: ['github.issue_snapshot'],
    async read(context: WorkflowNodeContext) {
      const binding = options.resolveBinding(context);
      if (!binding) return fail('unavailable', 'issue_binding_unavailable');
      try {
        const issue = await readPlatform(options.read, 'issue.get', binding, context);
        if (!isPlainObject(issue)) return fail('failed', 'issue_readback_malformed');
        if (!bindingMatches(issue, binding)) return fail('failed', 'issue_binding_mismatch');
        return {
          state: 'completed' as const,
          value: {
            binding: {...binding},
            state: typeof issue.state === 'string' ? issue.state : undefined,
            title: typeof issue.title === 'string' ? issue.title : '',
            labels: Array.isArray(issue.labels) ? issue.labels.map((l) => (isPlainObject(l) && typeof l.name === 'string' ? l.name : l)).slice(0, 32) : [],
            updatedAt: typeof issue.updatedAt === 'string' ? issue.updatedAt : undefined,
            readbackAt: new Date().toISOString(),
            source: 'platform_readback',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'platform_read_failed');
      }
    },
  };
}

/** F19_N04：修复 PR 合并读回——期望修复 PR 由受信组合绑定，合并状态来自平台真实读回。 */
export function createGithubMergedRepairReadbackHostPort(options: {
  read: GithubWorkflowReadPort;
  resolveBinding(context: WorkflowNodeContext): {issue: GithubBinding; repairPr: number} | undefined;
}): WorkflowHostPort {
  if (typeof options?.read?.execute !== 'function' || typeof options?.resolveBinding !== 'function') {
    throw new TypeError('createGithubMergedRepairReadbackHostPort 需要 read 端口与 resolveBinding');
  }
  return {
    capabilities: ['github.merged_repair_readback'],
    async read(context: WorkflowNodeContext) {
      const binding = options.resolveBinding(context);
      if (!binding || !Number.isSafeInteger(binding.repairPr)) return fail('unavailable', 'repair_binding_unavailable');
      try {
        const pr = await readPlatform(options.read, 'pr.get', {...binding.issue, number: binding.repairPr}, context);
        if (!isPlainObject(pr)) return fail('failed', 'pr_readback_malformed');
        const number = typeof pr.number === 'number' ? pr.number : undefined;
        if (number !== undefined && number !== binding.repairPr) return fail('failed', 'repair_binding_mismatch');
        const merged = pr.merged === true;
        const state = typeof pr.state === 'string' ? pr.state : undefined;
        return {
          state: 'completed' as const,
          value: {
            issue: {...binding.issue}, repairPr: binding.repairPr,
            merged, state, mergedAt: typeof pr.mergedAt === 'string' ? pr.mergedAt : undefined,
            readbackAt: new Date().toISOString(),
            source: 'platform_readback',
            note: merged ? undefined : '修复 PR 尚未合并；不编造 PR 号或合并状态',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'platform_read_failed');
      }
    },
  };
}
