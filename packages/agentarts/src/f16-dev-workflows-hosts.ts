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
  execute(operation: 'actions.run.list' | 'actions.job.list' | 'actions.log.read', input: Record<string, unknown>, context: WorkflowNodeContext): Promise<unknown>;
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
      const repoSlug = `${binding.owner}/${binding.repo}`;
      try {
        // 读取 CI 运行列表并按 runId 或 commitSha 定位目标运行记录（严格对齐 schemas.ts：仅传 repo/page/perPage/status）
        let run: Record<string, unknown> | undefined;
        let currentPage = 1;
        const maxPages = 5;
        while (currentPage <= maxPages) {
          const runsResult = await options.read.execute('actions.run.list', {
            repo: repoSlug,
            page: currentPage,
            perPage: 100,
            ...(binding.runId === undefined ? {status: 'failure' as const} : {}),
          }, context);
          const runList = Array.isArray(runsResult)
            ? runsResult
            : isPlainObject(runsResult) && Array.isArray(runsResult.items)
              ? runsResult.items
              : isPlainObject(runsResult) && Array.isArray(runsResult.runs)
                ? runsResult.runs
                : isPlainObject(runsResult) && typeof runsResult.id === 'number'
                  ? [runsResult]
                  : undefined;
          if (!runList) return fail('failed', 'ci_runs_malformed');

          const matched = runList.find((item: unknown): item is Record<string, unknown> => {
            if (!isPlainObject(item)) return false;
            if (binding.runId !== undefined) return item.id === binding.runId;
            const itemSha = typeof item.headSha === 'string' ? item.headSha : typeof item.head_sha === 'string' ? item.head_sha : undefined;
            return itemSha === binding.commitSha;
          });
          if (matched) {
            run = matched;
            break;
          }
          const hasMore =
            isPlainObject(runsResult) &&
            runsResult.hasMore === true &&
            typeof runsResult.nextPage === 'number' &&
            runsResult.nextPage > currentPage;
          if (!hasMore) break;
          currentPage = runsResult.nextPage as number;
        }
        if (!isPlainObject(run) || typeof run.id !== 'number') return fail('unavailable', 'ci_run_not_found');

        // 核对运行记录的 headSha / head_sha 必须与绑定 commitSha 严格一致
        const runHeadSha = typeof run.headSha === 'string' ? run.headSha : typeof run.head_sha === 'string' ? run.head_sha : undefined;
        if (!text(runHeadSha) || runHeadSha !== binding.commitSha) {
          return fail('failed', 'ci_run_head_sha_mismatch', {
            expectedCommitSha: binding.commitSha,
            actualCommitSha: runHeadSha ?? null,
          });
        }

        // 仅接受真实失败的运行记录，严禁缺省伪造 'failure'
        if (run.conclusion !== 'failure') {
          return fail('failed', 'ci_run_not_failed', {
            runId: run.id,
            conclusion: run.conclusion ?? null,
          });
        }

        // 读取该运行下的 jobs 列表并校验结构（严格对齐 schemas.ts：仅传 repo 与 runId）
        const jobs = await options.read.execute('actions.job.list', {
          repo: repoSlug,
          runId: run.id,
        }, context);
        const jobList = Array.isArray(jobs)
          ? jobs
          : isPlainObject(jobs) && Array.isArray(jobs.items)
            ? jobs.items
            : isPlainObject(jobs) && Array.isArray(jobs.jobs)
              ? jobs.jobs
              : undefined;
        if (!jobList) return fail('failed', 'ci_jobs_malformed');

        const failedJobs = jobList.filter(
          (j: unknown): j is Record<string, unknown> =>
            isPlainObject(j) && typeof j.id === 'number' && j.conclusion === 'failure',
        );
        const firstFailedJob = failedJobs[0];
        if (!firstFailedJob) return fail('failed', 'ci_failed_job_not_found');

        // 读取首个失败 job 的日志（严格对齐 actions.log.read schema：repo, runId, jobId, maxChars）
        const primaryJobId = firstFailedJob.id as number;
        const boundedMaxChars = Math.min(Math.max(1, Math.trunc(maxLogBytes)), 65536);
        const logs = await options.read.execute('actions.log.read', {
          repo: repoSlug,
          runId: run.id,
          jobId: primaryJobId,
          maxChars: boundedMaxChars,
        }, context);
        const logText = typeof logs === 'string'
          ? logs
          : isPlainObject(logs) && typeof logs.text === 'string'
            ? logs.text
            : isPlainObject(logs) && typeof logs.content === 'string'
              ? logs.content
              : undefined;
        if (typeof logText !== 'string' || logText.trim().length === 0) {
          return fail('failed', 'ci_log_malformed');
        }

        const truncated = Buffer.byteLength(logText, 'utf8') > maxLogBytes;
        const logExcerpt = Buffer.from(logText, 'utf8').subarray(0, maxLogBytes).toString('utf8');

        return {
          state: 'completed' as const,
          value: {
            binding: {...binding},
            runId: run.id,
            headSha: runHeadSha,
            conclusion: 'failure' as const,
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

const isTestPath = (headerLine: string): boolean => /test|\.spec\./i.test(headerLine);

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
        if (line.startsWith('diff --git ')) {
          inTestFile = isTestPath(line);
          continue;
        }
        if (line.startsWith('deleted file mode')) {
          if (inTestFile && !violations.includes('Deleted entire test file')) {
            violations.push('Deleted entire test file');
          }
          continue;
        }
        if (line.startsWith('--- ')) {
          const fromPath = line.slice(4).trim();
          if (fromPath !== '/dev/null') {
            inTestFile = inTestFile || isTestPath(fromPath);
          }
          continue;
        }
        if (line.startsWith('+++ ')) {
          const toPath = line.slice(4).trim();
          if (toPath === '/dev/null') {
            if (inTestFile && !violations.includes('Deleted entire test file')) {
              violations.push('Deleted entire test file');
            }
          } else {
            inTestFile = inTestFile || isTestPath(toPath);
          }
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
          // 检查新增的跳过/专注/注掉断言（以 + 开头但不是 +++）
          if (line.startsWith('+') && !line.startsWith('+++')) {
            const trimmed = line.slice(1).trim();
            if (/\/\/\s*(assert|expect)/.test(trimmed)) {
              violations.push(`Commented out assertion: "${trimmed.slice(0, 80)}"`);
            }
            if (
              /\b(test|it|describe)\.(skip|only|todo)\b/.test(trimmed) ||
              /\b(xit|xtest|xdescribe|fit|ftest|fdescribe)\b/.test(trimmed) ||
              /\{\s*skip\s*:\s*(true|1|['"][^'"]*['"])/.test(trimmed) ||
              /\b(t|context)\.skip\s*\(/.test(trimmed)
            ) {
              violations.push(`Added test skip or focus: "${trimmed.slice(0, 80)}"`);
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
