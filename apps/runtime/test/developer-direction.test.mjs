import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {ProtocolError} from '@personal-agent/contracts';
import {TaskRuntime} from '../dist/index.js';
import {
  createDeveloperDirectionSession, createDeveloperDutyTools, createMemoryGitWorkspace, createNodeGitWorkspace, renderPullRequestBody,
} from '../dist/application.js';
import {handleRunnerJob, signJob} from '../../../scripts/remote-runner/remote-runner-service.mjs';

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
    const created = await real.openLease({repo: 'octo/repo', repoPath: root, baseSha: head, taskId: 'local-task', slug: 'ci', epoch: 1});
    assert.equal(execFileSync('git', ['-C', created.path, 'rev-parse', 'HEAD']).toString().trim(), head);
    const job = await real.executeRepoJob({repo: 'octo/repo', repoPath: root, baseSha: head, taskId: 'local-job', recipeIds: ['test'], slug: 'job'});
    assert.equal(job.evidenceLevel, 'executed-local');
    assert.equal(job.leaseExtended, true);
    assert.match(job.testReport, /local recipe/);
    await real.releaseLease('local-task');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('automatic duty comments write through the controlled port and still require authorization by default', async () => {
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
  assert.equal(page[0].comment, true);
  assert.equal(seen.length, 1);
  const owner = runtime.findTaskByIdempotencyKey('developer-duty-registry:v1');
  const stored = runtime.loadCheckpoint(owner.taskId, 'developer-duty-fixture-comments:v1');
  assert.equal(stored.items.length, 1);
  runtime.close();
});

test('repo-task runner checks out through the injected workspace and refuses an unconfigured executor', async () => {
  const token = 'runner-token-0123456789abcdef0123456789abcdef';
  const message = {v: 1, id: 'job-1', kind: 'repo-task', idempotencyKey: 'repo-1', payload: {repo: 'octo/repo', baseSha: sha, branch: 'agent/fix', recipeIds: ['test']}};
  message.signature = signJob(message, token);
  const missing = await handleRunnerJob({version: 1, jobs: {}, cursors: {}, comments: {}, recent: []}, message, {token, now: () => Date.parse('2026-11-03T00:00:00.000Z')});
  assert.equal(missing.needsConfig, true);
  assert.equal(missing.evidenceLevel, 'fixture');
  let heartbeats = 0;
  const executed = await handleRunnerJob({version: 1, jobs: {}, cursors: {}, comments: {}, recent: []}, {...message, id: 'job-2', idempotencyKey: 'repo-2', signature: signJob({...message, id: 'job-2', idempotencyKey: 'repo-2'}, token)}, {token, now: () => Date.parse('2026-11-03T00:00:00.000Z'),
    executeRepoTask: async job => {job.heartbeat(); heartbeats += 1; return {ok: true, evidenceLevel: 'fixture', diffSummary: 'diff', testReport: 'pass', artifactSummary: 'none', summary: 'fixture workspace'};}});
  assert.equal(executed.state, 'succeeded');
  assert.equal(executed.verification, 'executed');
  assert.equal(heartbeats, 1);
  assert.equal(executed.leaseExtended, true);
});
