import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {ProtocolError} from '@personal-agent/contracts';
import {TaskRuntime} from '../dist/index.js';
import {
  authorizeDeveloperCall, createDeveloperDirectionSession, createDeveloperDutyTools, createMemoryGitWorkspace, createNodeGitWorkspace, renderPullRequestBody, standingDecisionForTool,
} from '../dist/application.js';
import {handleRunnerJob, signJob} from '../../../scripts/remote-runner/remote-runner-service.mjs';
import {createLocalRepoExecutor} from '../../../scripts/remote-runner/local-repo-executor.mjs';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const context = taskId => ({taskId, runId: 'run', signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: 'auth', scopes: ['agent:delegate', 'github:write']});

test('a goal, a long duty and a head change route one repair task', async () => {
  const session = createDeveloperDirectionSession({now: () => Date.parse('2026-11-03T00:00:00.000Z')});
  const goal = session.submitGoal({sentence: '修好这个 PR 的 CI', repo: 'octo/repo', pullRequest: 4, doneWhen: 'CI 绿', budget: 5});
  assert.equal(goal.status, 'open');
  session.addDuty({sentence: 'CI 红了就修', repo: 'octo/repo'});
  const first = await session.routeEvent({repo: 'octo/repo', source: 'check_run', deliveryId: 'd1', number: 4, headSha: sha, conclusion: 'failure'});
  assert.equal(first.status, 'spawn');
  const duplicate = await session.routeEvent({repo: 'octo/repo', source: 'check_run', deliveryId: 'd2', number: 4, headSha: sha, conclusion: 'failure'});
  assert.equal(duplicate.status, 'deduped');
  await session.stop(first.goal.id);
  const next = await session.routeEvent({repo: 'octo/repo', source: 'check_run', deliveryId: 'd3', number: 4, headSha: other, conclusion: 'failure'});
  assert.equal(next.status, 'spawn');
  assert.equal(next.superseded, first.goal.id);
  const paused = await session.pause(next.goal.id);
  assert.equal((await session.redirect(paused.id, '先补测试')).step, '先补测试');
});

test('standing autonomy, budget, locks, knowledge and reports stay inside the session', async () => {
  const sent = [];
  const session = createDeveloperDirectionSession({now: () => Date.parse('2026-11-03T00:00:00.000Z'), channel: {name: 'desktop', async send(notice) {sent.push(notice); return {accepted: true, evidenceRef: `desktop:${notice.id}`};}}});
  assert.throws(() => session.enroll({repo: 'octo/repo', credentialRef: 'ghp_secret'}), error => error instanceof ProtocolError && error.code === 'SCOPE_DENIED');
  session.enroll({repo: 'octo/repo', credentialRef: 'github-credential-ref'});
  assert.equal(session.decide({repo: 'octo/repo', branch: 'agent/fix', toolName: 'github.pr.merge', action: 'merge'}).allow, false);
  assert.equal(session.decide({repo: 'octo/repo', branch: 'agent/fix', toolName: 'github.pr.comment', sideEffect: 'external_write'}).mode, 'auto');
  session.setAutonomy({repo: 'octo/repo', level: 'observe', present: false});
  assert.throws(() => session.setAutonomy({repo: 'octo/repo', level: 'act_reversible', present: false}), error => error.code === 'SCOPE_DENIED');
  const goal = session.submitGoal({sentence: '观察', repo: 'octo/repo', budget: 1});
  const reserved = session.reserveCost({taskId: goal.id, repo: 'octo/repo', tokens: {input: 2_000_000, output: 0}});
  assert.equal(reserved.evidenceLevel, 'estimated');
  assert.equal(reserved.action, 'pause');
  assert.equal(session.acquireLock({repo: 'octo/repo', ref: 'pr:4', taskId: 'a', mode: 'write', epoch: 1}).status, 'acquired');
  assert.equal(session.acquireLock({repo: 'octo/repo', ref: 'pr:4', taskId: 'b', mode: 'write', epoch: 1}).status, 'joined');
  assert.throws(() => session.acquireLock({repo: 'octo/repo', ref: 'pr:5', taskId: 'a', mode: 'write', epoch: 1}), error => error.code === 'REVISION_CONFLICT');
  const profile = session.rememberProfile(session.applyWizard({repo: 'octo/repo', credentialRef: 'github-credential-ref', files: [{path: 'AGENTS.md', text: '用中文'}], present: true}).profile);
  session.rememberFix('octo/repo', {failureSignature: 'error ts', patchSummary: '补上类型', prUrl: 'https://example.test/pull/4'});
  assert.equal(session.profileFor('octo/repo').pastFixes.length, 1);
  assert.equal(profile.privateRepo, false);
  const notice = await session.notify({repo: 'octo/repo', kind: 'failure', summary: '需要看一眼'});
  assert.equal(notice.delivered, true);
  assert.equal(sent.length, 1);
  const report = session.report(goal.id, {commands: [{command: 'npm test', result: 'fixture pass'}], ciUrl: 'https://example.test/ci'});
  assert.match(renderPullRequestBody(report), /## 目标/);
  assert.match(session.periodReport({period: 'daily', failing: ['octo/repo#4']}), /失败 CI/);
  assert.equal((await session.compensate({action: 'close_pr', repo: 'octo/repo', number: 4})).available, false);
  let loop = session.repair({repo: 'octo/repo', number: 4, signal: 'diagnosed'});
  loop = session.repair({repo: 'octo/repo', number: 4, signal: 'patched'});
  assert.equal(loop.phase, 'local_verify');
  const drift = session.checkApiDrift({implemented: ['GET /tasks'], documented: []});
  assert.equal(drift.missingInDocs[0], 'GET /tasks');
  const stopped = session.emergencyStop('急停');
  assert.ok(stopped.revoked >= 1);
  assert.equal(session.decide({repo: 'octo/repo', branch: 'agent/fix', toolName: 'git.push', sideEffect: 'external_write'}).allow, false);
});

test('memory and node git worktrees run recipes and yield when the human moves the branch', async () => {
  const git = createMemoryGitWorkspace();
  let active = 0;
  let maxSeen = 0;
  const session = createDeveloperDirectionSession({git, maxConcurrent: 1, runRecipe: async () => {
    active += 1;
    maxSeen = Math.max(maxSeen, active);
    await new Promise(resolve => setImmediate(resolve));
    active -= 1;
    return {exitCode: 0, output: 'ok'};
  }});
  const blocked = await session.executeRepoJob({repo: 'octo/repo', repoPath: '/tmp/repo', baseSha: sha, taskId: 'job-blocked', recipeIds: ['test'], slug: 'blocked'});
  assert.equal(blocked.refused, true);
  assert.equal(blocked.heartbeats, 0);
  session.enroll({repo: 'octo/repo', credentialRef: 'github-credential-ref'});
  const lease = await session.openLease({repo: 'octo/repo', repoPath: '/tmp/repo', baseSha: other, taskId: 'task-1', slug: 'fix', epoch: 2});
  assert.match(lease.branch, /^agent\/task-1-fix$/);
  assert.equal((await session.noteHumanPush({repoPath: '/tmp/repo', taskId: 'task-1'})).yielded, true);
  await session.releaseLease('task-1');
  await Promise.all([
    session.executeRepoJob({repo: 'octo/repo', repoPath: '/tmp/repo', baseSha: sha, taskId: 'job-a', recipeIds: ['test'], slug: 'a'}),
    session.executeRepoJob({repo: 'octo/repo', repoPath: '/tmp/repo', baseSha: sha, taskId: 'job-b', recipeIds: ['test'], slug: 'b'}),
  ]);
  assert.equal(maxSeen, 1);
  assert.ok(git.calls.some(call => call.startsWith('add ')));

  const root = mkdtempSync(path.join(tmpdir(), 'developer-direction-git-'));
  try {
    execFileSync('git', ['init'], {cwd: root});
    execFileSync('git', ['config', 'user.email', 'dev@example.test'], {cwd: root});
    execFileSync('git', ['config', 'user.name', 'Developer Direction'], {cwd: root});
    writeFileSync(path.join(root, 'README.md'), 'hello\n');
    execFileSync('git', ['add', 'README.md'], {cwd: root});
    execFileSync('git', ['commit', '-m', 'init'], {cwd: root});
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root}).toString().trim();
    const real = createDeveloperDirectionSession({git: createNodeGitWorkspace(), runRecipe: async () => ({exitCode: 0, output: 'local recipe'})});
    real.enroll({repo: 'octo/repo', credentialRef: 'github-credential-ref'});
    const created = await real.openLease({repo: 'octo/repo', repoPath: root, baseSha: head, taskId: 'local-task', slug: 'ci', epoch: 1});
    assert.equal(execFileSync('git', ['-C', created.path, 'rev-parse', 'HEAD']).toString().trim(), head);
    const job = await real.executeRepoJob({repo: 'octo/repo', repoPath: root, baseSha: head, taskId: 'local-job', recipeIds: ['test'], slug: 'job'});
    assert.equal(job.evidenceLevel, 'executed-local');
    assert.equal(job.leaseExtended, true);
    assert.match(job.testReport, /local recipe/);
    await real.releaseLease('local-task');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('duty polling keeps complete comment content pending even when legacy automatic options are supplied', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'duty-parent'});
  const seen = [];
  const {tools, poll} = createDeveloperDutyTools({getRuntime: () => runtime, useFixtureComments: true, automaticComments: true,
    autonomyForComment: () => ({allow: true, mode: 'auto', risk: 'reversible_write'}),
    onEvents: async (_repo, events) => seen.push(...events),
    readPage: async () => ({repo: 'octo/repo', connected: true, gap: false, evidenceLevel: 'fixture', events: [{id: 'e1', repo: 'octo/repo', type: 'check_run', deliveryId: 'e1', receivedAt: '2026-11-03T00:00:00.000Z', headSha: sha}],
      pullRequests: [{number: 4, headSha: sha, ci: 'failure', conclusion: 'CI red'}], next: {deliveryId: 'e1'}})});
  await tools.find(tool => tool.descriptor.name === 'duty.watch').execute({repo: 'octo/repo'}, context(parent.taskId));
  await tools.find(tool => tool.descriptor.name === 'duty.policy.set').execute({repo: 'octo/repo', allowed: true, comment: true}, context(parent.taskId));
  const page = await poll();
  assert.notEqual(page[0].comment, true);
  assert.equal(page[0].reason, 'comment requires ToolGateway content authorization');
  assert.equal(seen.length, 1);
  const owner = runtime.findTaskByIdempotencyKey('developer-duty-registry:v1');
  const stored = runtime.loadCheckpoint(owner.taskId, 'developer-duty-fixture-comments:v1');
  assert.equal(stored?.items?.length ?? 0, 0);
  runtime.close();
});

test('repo-task runner checks out through the injected workspace and refuses an unconfigured executor', async () => {
  const token = 'runner-token-0123456789abcdef0123456789abcdef';
  const message = {v: 1, id: 'job-1', kind: 'repo-task', idempotencyKey: 'repo-1', payload: {repo: 'octo/repo', baseSha: sha, branch: 'agent/fix', recipeIds: ['test']}};
  message.signature = signJob(message, token);
  const missing = await handleRunnerJob({version: 1, jobs: {}, cursors: {}, comments: {}, recent: []}, message, {token, now: () => Date.parse('2026-11-03T00:00:00.000Z')});
  assert.equal(missing.needsConfig, true);
  assert.equal(missing.evidenceLevel, 'fixture');
  assert.match(missing.summary, /sourcePath/);
  assert.ok(missing.steps.some(step => step.includes('recipes')));
  let heartbeats = 0;
  const executed = await handleRunnerJob({version: 1, jobs: {}, cursors: {}, comments: {}, recent: []}, {...message, id: 'job-2', idempotencyKey: 'repo-2', signature: signJob({...message, id: 'job-2', idempotencyKey: 'repo-2'}, token)}, {token, now: () => Date.parse('2026-11-03T00:00:00.000Z'),
    executeRepoTask: async job => {job.heartbeat(); heartbeats += 1; return {ok: true, evidenceLevel: 'fixture', diffSummary: 'diff', testReport: 'pass', artifactSummary: 'none', summary: 'fixture workspace'};}});
  assert.equal(executed.state, 'succeeded');
  assert.equal(executed.verification, 'executed');
  assert.equal(heartbeats, 1);
  assert.equal(executed.leaseExtended, true);
});

test('each compensation uses its own port and a directory scan keeps an incremental profile', async () => {
  const calls = [];
  const git = createMemoryGitWorkspace();
  const session = createDeveloperDirectionSession({git, compensation: {
    async deleteComment(input) {calls.push(`comment ${input.commentId}`); return {evidence: `deleted ${input.commentId}`};},
    async closePullRequest(input) {calls.push(`pr ${input.number}`); return {evidence: `closed ${input.number}`};},
  }});
  assert.deepEqual(session.listCompensations().map(item => item.available), [true, true, true, true]);
  assert.equal((await session.compensate({action: 'revert_commit', repoPath: '/tmp/repo', sha})).available, true);
  assert.equal((await session.compensate({action: 'restore_branch', repoPath: '/tmp/repo', branch: 'agent/fix', sha})).available, true);
  assert.equal((await session.compensate({action: 'delete_comment', repo: 'octo/repo', commentId: 9})).available, true);
  assert.equal((await session.compensate({action: 'close_pr', repo: 'octo/repo', number: 4})).available, true);
  assert.deepEqual(calls, ['comment 9', 'pr 4']);
  const bare = createDeveloperDirectionSession();
  assert.equal(bare.listCompensations().every(item => item.available === false), true);
  assert.equal((await bare.compensate({action: 'close_pr', repo: 'octo/repo', number: 4})).available, false);
  const goal = session.submitGoal({sentence: '扫描仓库', repo: 'octo/repo'});
  assert.equal(session.report(goal.id).compensations.every(item => item.available), true);

  const root = mkdtempSync(path.join(tmpdir(), 'developer-knowledge-'));
  try {
    writeFileSync(path.join(root, 'AGENTS.md'), '# listTasks\n用中文\n');
    writeFileSync(path.join(root, 'api.ts'), 'export function listTasks() {}\n');
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({scripts: {build: 'tsc', test: 'node --test'}}));
    const policy = {maxFileBytes: 200, maxTotalBytes: 8_000_000, maxFiles: 50, ignore: ['node_modules', 'dist', '.git']};
    const scanned = session.scanKnowledge({repo: 'octo/repo', root, policy});
    assert.equal(scanned.index.evidenceLevel, 'local-scan');
    assert.ok(scanned.profile.buildRecipes.includes('build'));
    assert.equal(scanned.drift.drift, false);
    assert.equal(session.profileFor('octo/repo').digest, scanned.index.digest);
    session.rememberFix('octo/repo', {failureSignature: 'error ts', patchSummary: '补类型'});
    const again = session.scanKnowledge({repo: 'octo/repo', root, policy});
    assert.equal(again.index.files.find(file => file.path === 'api.ts')?.reused, true);
    assert.equal(session.profileFor('octo/repo').pastFixes.length, 1);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('tool loop, duty comments, subagent control and repo tasks share one decision', () => {
  const session = createDeveloperDirectionSession({now: () => Date.parse('2026-11-03T00:00:00.000Z')});
  const unenrolled = authorizeDeveloperCall(session, {repo: 'octo/repo', branch: 'agent/fix', toolName: 'duty.comment.publish', sideEffect: 'external_write'});
  assert.equal(unenrolled.allow, false);
  assert.equal(standingDecisionForTool(session, {toolName: 'duty.comment.publish', sideEffect: 'external_write', arguments: {repo: 'octo/repo', branch: 'agent/fix'}}), undefined);
  session.enroll({repo: 'octo/repo', credentialRef: 'github-credential-ref'});
  for (const spec of [
    {toolName: 'duty.comment.publish', sideEffect: 'external_write'},
    {toolName: 'subagent.pause', sideEffect: 'local_write'},
    {toolName: 'repo.task.run', sideEffect: 'local_write'},
    {toolName: 'github.pr.comment', sideEffect: 'external_write'},
  ]) {
    const decision = authorizeDeveloperCall(session, {repo: 'octo/repo', branch: 'agent/fix', ...spec});
    const loop = standingDecisionForTool(session, {toolName: spec.toolName, sideEffect: spec.sideEffect, arguments: {repo: 'octo/repo', branch: 'agent/fix'}});
    assert.equal(decision.mode, 'auto', spec.toolName);
    assert.equal(loop.allow, decision.allow);
    assert.equal(loop.risk, decision.risk);
  }
  const merge = authorizeDeveloperCall(session, {repo: 'octo/repo', branch: 'agent/fix', toolName: 'github.pr.merge', action: 'merge', sideEffect: 'external_write'});
  assert.equal(merge.allow, false);
  assert.equal(merge.risk, 'irreversible');
});

test('session quiet hours hold ordinary notices and a digest flushes once', async () => {
  const sent = [];
  const session = createDeveloperDirectionSession({now: () => Date.parse('2026-11-03T08:00:00.000Z'), channel: {name: 'desktop', async send(notice) {sent.push(notice.title); return {accepted: true, evidenceRef: `desktop:${notice.id}`};}}});
  session.configureNotices({quiet: {startLocal: '00:00', endLocal: '23:59', timeZone: 'UTC'}, perHour: 1, perDay: 1});
  assert.equal((await session.notify({repo: 'octo/repo', kind: 'failure', summary: '夜里'})).delivered, false);
  assert.equal((await session.notify({repo: 'octo/repo', kind: 'gate', summary: '确认'})).delivered, true);
  assert.equal((await session.flushDigest()).delivered, true);
  assert.equal((await session.flushDigest()).reason, 'digest is empty');
  assert.deepEqual(sent, ['需要你确认', '开发者摘要']);
});

test('local repo executor clones a fixture, runs a recipe, returns the diff, and deletes the workspace', async () => {
  const source = mkdtempSync(path.join(tmpdir(), 'repo-task-source-'));
  const workspaceHint = [];
  try {
    execFileSync('git', ['init'], {cwd: source});
    execFileSync('git', ['config', 'user.email', 'dev@example.test'], {cwd: source});
    execFileSync('git', ['config', 'user.name', 'Developer Direction'], {cwd: source});
    writeFileSync(path.join(source, 'write.mjs'), 'import {writeFileSync} from "node:fs"; writeFileSync("note.txt", "ran\\n"); console.log("recipe ok");\n');
    execFileSync('git', ['add', 'write.mjs'], {cwd: source});
    execFileSync('git', ['commit', '-m', 'init'], {cwd: source});
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: source}).toString().trim();
    const executor = createLocalRepoExecutor({sourcePath: source, recipes: {test: ['node', 'write.mjs']}});
    assert.equal(executor.configured, true);
    const result = await executor.executeRepoTask({repo: 'octo/repo', baseSha: head, branch: 'agent/local-fix', recipeIds: ['test'], heartbeat() {workspaceHint.push('beat');}});
    assert.equal(result.ok, true);
    assert.equal(result.evidenceLevel, 'executed-local');
    assert.match(result.testReport, /recipe ok/);
    assert.match(result.diffSummary, /note.txt/);
    assert.equal(result.artifactSummary, '工作区已删除');
    assert.equal(workspaceHint.length, 2);
    assert.equal(existsSync(path.join(source, 'note.txt')), false);
    const missingRecipe = await executor.executeRepoTask({repo: 'octo/repo', baseSha: head, branch: 'agent/other', recipeIds: ['rm-rf'], heartbeat() {}});
    assert.equal(missingRecipe.ok, false);
    assert.match(missingRecipe.testReport, /not a configured recipe/);
  } finally {rmSync(source, {recursive: true, force: true});}
});
