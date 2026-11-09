// F16 开发工作流 host 端口实现（Potatos 分区）
// F16_N01 github.bound_ci_failure
// F16_N04 workspace.test_intent_check
import {createHash} from 'node:crypto';
import type {WorkflowHostPort, WorkflowNodeContext} from './owned-workflows.js';

const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function fail(state: 'unavailable' | 'failed' | 'unknown', reason: string, extra?: Record<string, unknown>) {
  return {state, value: {reason, ...(extra ?? {})}};
}

// ---------------------------------------------------------------------------
// F16_N01: github.bound_ci_failure
// ---------------------------------------------------------------------------
export interface CiFailureBinding {
  readonly owner: string;
  readonly repo: string;
  readonly commitSha: string;
  readonly runId?: number;
}

export interface GithubCiReadPort {
  execute(operation: 'actions.run.get' | 'actions.job.list' | 'actions.log.read', input: Record<string, unknown>, context: WorkflowNodeContext): Promise<unknown>;
}

export interface GithubCiFailureHostOptions {
  readonly read: GithubCiReadPort;
  resolveBinding(context: WorkflowNodeContext): CiFailureBinding | undefined;
  readonly maxLogBytes?: number;
}

export function createGithubBoundCiFailureHostPort(options: GithubCiFailureHostOptions): WorkflowHostPort {
  const maxLogBytes = options.maxLogBytes ?? 64_000;
  if (typeof options?.read?.execute !== 'function' || typeof options?.resolveBinding !== 'function') {
    throw new TypeError('createGithubBoundCiFailureHostPort 需要 read 端口与 resolveBinding');
  }
  return {
    capabilities: ['github.bound_ci_failure'],
    async read(context: WorkflowNodeContext) {
      const binding = options.resolveBinding(context);
      if (!binding || !text(binding.owner) || !text(binding.repo) || !text(binding.commitSha)) {
        return fail('unavailable', 'ci_binding_unavailable');
      }
      try {
        // 读取指定或最新的 CI 运行记录
        const run = await options.read.execute('actions.run.get', {
          owner: binding.owner,
          repo: binding.repo,
          commitSha: binding.commitSha,
          ...(binding.runId ? {runId: binding.runId} : {}),
        }, context);
        if (!isPlainObject(run)) return fail('failed', 'ci_run_not_found');

        // 读取失败的 jobs 与步骤
        const jobs = await options.read.execute('actions.job.list', {
          owner: binding.owner,
          repo: binding.repo,
          runId: run.id ?? binding.runId,
        }, context);
        const jobList = Array.isArray(jobs) ? jobs : isPlainObject(jobs) && Array.isArray(jobs.jobs) ? jobs.jobs : [];
        const failedJobs = jobList.filter((j: unknown) => isPlainObject(j) && (j.conclusion === 'failure' || j.status === 'completed' && j.conclusion !== 'success'));

        // 读取失败日志
        const logs = await options.read.execute('actions.log.read', {
          owner: binding.owner,
          repo: binding.repo,
          runId: run.id ?? binding.runId,
        }, context);
        const logText = typeof logs === 'string' ? logs : isPlainObject(logs) && typeof logs.content === 'string' ? logs.content : '';
        const truncated = Buffer.byteLength(logText, 'utf8') > maxLogBytes;
        const logExcerpt = Buffer.from(logText, 'utf8').subarray(0, maxLogBytes).toString('utf8');

        return {
          state: 'completed' as const,
          value: {
            binding: {...binding},
            runId: run.id ?? binding.runId,
            conclusion: run.conclusion ?? 'failure',
            failedJobCount: failedJobs.length,
            failedJobs: failedJobs.map((j: Record<string, unknown>) => ({
              id: j.id,
              name: j.name,
              conclusion: j.conclusion,
            })),
            logExcerpt,
            truncated,
            logSha256: createHash('sha256').update(logText, 'utf8').digest('hex'),
            readbackAt: new Date().toISOString(),
            source: 'ci_failure_readback',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'ci_failure_read_failed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// F16_N04: workspace.test_intent_check
// ---------------------------------------------------------------------------
export interface TestIntentCheckOptions {
  resolvePatch?(context: WorkflowNodeContext): string | undefined;
}

/** 审查修复补丁是否保留真实验收意图：严禁删测试、注掉断言、改空断言或跳过用例逃避 CI 检查。 */
export function createWorkspaceTestIntentCheckHostPort(options?: TestIntentCheckOptions): WorkflowHostPort {
  return {
    capabilities: ['workspace.test_intent_check'],
    async read(context: WorkflowNodeContext) {
      let patchText: string | undefined;
      if (options?.resolvePatch) {
        patchText = options.resolvePatch(context);
      } else if (typeof context.input === 'string') {
        patchText = context.input;
      } else if (isPlainObject(context.input)) {
        patchText = typeof context.input.patch === 'string' ? context.input.patch : typeof context.input.diff === 'string' ? context.input.diff : undefined;
      }
      if (typeof patchText !== 'string' || patchText.trim().length === 0) {
        return fail('unavailable', 'patch_text_unavailable');
      }

      const violations: string[] = [];
      const lines = patchText.split(/\r?\n/);
      let inTestFile = false;
      let checkedAssertions = 0;

      for (const line of lines) {
        if (line.startsWith('diff --git') || line.startsWith('--- ') || line.startsWith('+++ ')) {
          inTestFile = /test|\.spec\./i.test(line);
          continue;
        }

        if (inTestFile) {
          // 检查删除的行（以 - 开头但不是 ---）
          if (line.startsWith('-') && !line.startsWith('---')) {
            const trimmed = line.slice(1).trim();
            if (/\b(assert|expect|test|it)\b/.test(trimmed)) {
              violations.push(`Deleted test or assertion: "${trimmed.slice(0, 80)}"`);
            }
          }
          // 检查新增的跳过/注掉断言（以 + 开头但不是 +++）
          if (line.startsWith('+') && !line.startsWith('+++')) {
            const trimmed = line.slice(1).trim();
            if (/\/\/\s*(assert|expect)/.test(trimmed)) {
              violations.push(`Commented out assertion: "${trimmed.slice(0, 80)}"`);
            }
            if (/\b(test\.skip|it\.skip|xit|xtest)\b/.test(trimmed)) {
              violations.push(`Added test skip: "${trimmed.slice(0, 80)}"`);
            }
            if (/\bassert\.(ok|equal|strictEqual)\s*\(\s*true\s*\)/.test(trimmed)) {
              violations.push(`Trivialized assertion: "${trimmed.slice(0, 80)}"`);
            }
            if (/\b(assert|expect)\b/.test(trimmed)) {
              checkedAssertions++;
            }
          }
        }
      }

      if (violations.length > 0) {
        return {
          state: 'failed' as const,
          value: {
            preserved: false,
            reason: 'test_intent_violated',
            violations,
            checkedAssertions,
            source: 'test_intent_receipt',
          },
        };
      }

      return {
        state: 'completed' as const,
        value: {
          preserved: true,
          violations: [],
          checkedAssertions,
          patchSha256: createHash('sha256').update(patchText, 'utf8').digest('hex'),
          reviewedAt: new Date().toISOString(),
          source: 'test_intent_receipt',
        },
      };
    },
  };
}
