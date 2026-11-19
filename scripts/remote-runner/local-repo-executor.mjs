import {execFile} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {promisify} from 'node:util';

const exec = promisify(execFile);

export const REPO_TASK_SETUP_STEPS = [
  '1. 准备本机已有的 git 仓库目录，设为执行器 sourcePath。不要填 https:// 地址，本地执行器不会访问外网。',
  '2. 配置 recipes，把配方 id 映射到 argv 数组，例如 test: ["node","--test","test.mjs"]。任务载荷不能自带命令。',
  '3. 调用 createLocalRepoExecutor({sourcePath, recipes})，把返回的 executeRepoTask 交给 handleRunnerJob。',
  '4. baseSha 必须是该仓库里已有的 40 位提交，branch 只能是 agent/ 开头。跑完后工作区会被删除。',
];

export function describeRepoTaskExecutor(options = {}) {
  const missing = [];
  if (typeof options.sourcePath !== 'string' || !options.sourcePath.trim() || options.sourcePath.includes('://')) missing.push(REPO_TASK_SETUP_STEPS[0]);
  const recipes = options.recipes;
  if (!recipes || typeof recipes !== 'object' || Array.isArray(recipes) || !Object.keys(recipes).length) missing.push(REPO_TASK_SETUP_STEPS[1]);
  return {needsConfig: missing.length > 0, steps: missing.length ? missing : REPO_TASK_SETUP_STEPS,
    summary: missing.length ? `仓库任务执行器还没配好。${missing.join(' ')}` : '仓库任务执行器已配置。'};
}

function git(cwd, args) {
  return exec('git', args, {timeout: 30_000, windowsHide: true, env: {...process.env, GIT_TERMINAL_PROMPT: '0'}, ...(cwd ? {cwd} : {})});
}

function emptyResult(extra) {
  return {ok: false, evidenceLevel: 'fixture', diffSummary: '', testReport: '', artifactSummary: '工作区未创建', ...extra};
}

/** 在本机 clone 本地仓库、检出提交、建 agent 分支、跑已配置配方、回传 diff 和测试输出，然后删除工作区。 */
export function createLocalRepoExecutor(options) {
  const described = describeRepoTaskExecutor(options);
  return {
    configured: described.needsConfig !== true,
    describe: () => described,
    async executeRepoTask(job) {
      if (described.needsConfig) return emptyResult({needsConfig: true, summary: described.summary, steps: described.steps});
      if (!job || !/^agent\/[A-Za-z0-9._-]{1,64}$/.test(String(job.branch ?? '')) || !/^[0-9a-f]{40}$/i.test(String(job.baseSha ?? ''))) {
        return emptyResult({evidenceLevel: 'executed-local', summary: 'branch 必须是 agent/ 开头，baseSha 必须是 40 位提交'});
      }
      const source = resolve(options.sourcePath);
      if (!isAbsolute(source) || source.includes('://') || !existsSync(join(source, '.git'))) {
        return emptyResult({needsConfig: true, summary: described.summary, steps: REPO_TASK_SETUP_STEPS});
      }
      const workspace = mkdtempSync(join(tmpdir(), 'repo-task-'));
      try {
        await git(undefined, ['clone', '--local', '--no-hardlinks', source, workspace]);
        await git(workspace, ['checkout', '--detach', job.baseSha]);
        await git(workspace, ['switch', '-c', job.branch]);
        job.heartbeat?.();
        const reports = [];
        let failed = false;
        for (const recipeId of job.recipeIds ?? []) {
          const argv = options.recipes[recipeId];
          if (!Array.isArray(argv) || !argv.length || argv.some(part => typeof part !== 'string' || !part.trim())) {
            failed = true;
            reports.push(`${recipeId} is not a configured recipe`);
            continue;
          }
          const [bin, ...args] = argv;
          try {
            const result = await exec(bin, args, {cwd: workspace, timeout: 30_000, windowsHide: true, env: {...process.env, GIT_TERMINAL_PROMPT: '0'}});
            reports.push(`${recipeId} exit 0: ${String(result.stdout || '').slice(0, 500)}`);
          } catch (error) {
            failed = true;
            const stdout = error && error.stdout ? String(error.stdout) : '';
            const stderr = error && error.stderr ? String(error.stderr) : '';
            reports.push(`${recipeId} exit ${error && error.code !== undefined ? error.code : 'unknown'}: ${`${stdout}\n${stderr}`.slice(0, 500)}`);
          }
          job.heartbeat?.();
        }
        let diff = '';
        try {
          const tracked = await git(workspace, ['diff', '--stat', 'HEAD']);
          const untracked = await git(workspace, ['status', '--short']);
          diff = `${tracked.stdout || ''}${untracked.stdout || ''}`.trim().slice(0, 2000);
        } catch {diff = 'diff unavailable';}
        return {ok: !failed, needsConfig: false, evidenceLevel: 'executed-local', diffSummary: diff || '没有差异', testReport: reports.join('\n'), artifactSummary: '工作区已删除', summary: failed ? '配方没有全部通过' : '本机工作区已跑完并清理', steps: []};
      } finally {
        rmSync(workspace, {recursive: true, force: true});
      }
    },
  };
}
