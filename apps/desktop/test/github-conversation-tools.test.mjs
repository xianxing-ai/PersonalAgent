import test from 'node:test';
import assert from 'node:assert/strict';
import {GitHubRestProvider} from '@personal-agent/github';
import {createGitHubConversationTools} from '../electron/github-conversation-tools.js';
import {classifyKnownEgressContent} from '../electron/egress-host.js';

function createQuestionPortMock() {
  const generations = new Map();
  const prepared = new Map();
  const exported = new Map();
  return {
    generations,
    prepared,
    exported,
    readResourceGeneration: resource => generations.get(resource) ?? 0,
    rotateResourceGeneration: (resource, previous) => {
      const next = (generations.get(resource) ?? 0) + 1;
      assert.equal(generations.get(resource) ?? 0, previous ?? 0);
      generations.set(resource, next);
      return next;
    },
    prepare: (exact, spec) => prepared.set(exact.runId, {exact, spec}),
    prepareExport: (exact, spec) => exported.set(exact.runId, {exact, spec}),
    currentRequirement: (exact, reqId) => {
      assert.ok(prepared.has(exact.runId) || exported.has(exact.runId), `missing requirement ${reqId}`);
    },
    authorizeExport: () => {},
    authorizeConsumedExport: () => {},
    assertConsumedResult: () => {},
  };
}

function makeScope(tool, args = {}, runId = crypto.randomUUID()) {
  return {
    taskId: 'task-gh-1',
    deadline: new Date(Date.now() + 30_000).toISOString(),
    signal: AbortSignal.timeout(10_000),
    authorizationRef: 'auth-grant-1',
    scopes: tool.descriptor.requiredScopes,
    runId,
    proposal: {
      proposalId: runId,
      toolName: tool.descriptor.name,
      toolVersion: tool.descriptor.version,
      arguments: args,
    },
  };
}

test('createGitHubConversationTools exposes 29 mainstream tools with fail-closed question gates and redaction', async t => {
  const token = 'ghp_SecretConversationToken1234567890';
  let binding = {
    accountRef: '11111111-1111-4111-8111-111111111111',
    secretRef: '22222222-2222-4222-8222-222222222222',
    revision: 1,
    authMode: 'pat',
    login: 'octocat',
    repositories: ['acme/app'],
  };
  const question = createQuestionPortMock();

  const fetchImpl = async (url, init = {}) => {
    const path = url.replace('https://api.github.com', '');
    if (path === '/user') {
      return new Response(JSON.stringify({login: 'octocat', name: 'Octo Cat', html_url: 'https://github.com/octocat'}), {status: 200});
    }
    if (path.startsWith('/user/repos?')) {
      return new Response(JSON.stringify([{full_name: 'acme/app', default_branch: 'main', private: true, html_url: 'https://github.com/acme/app'}]), {status: 200});
    }
    if (path === '/repos/acme/app') {
      return new Response(JSON.stringify({full_name: 'acme/app', default_branch: 'main', private: true, html_url: 'https://github.com/acme/app'}), {status: 200});
    }
    if (path === '/repos/acme/app/issues' && init.method === 'POST') {
      return new Response(JSON.stringify({number: 42, html_url: 'https://github.com/acme/app/issues/42'}), {status: 201});
    }
    if (path === '/repos/acme/app/contents/secret.txt') {
      return new Response(JSON.stringify({
        type: 'file', path: 'secret.txt', name: 'secret.txt', sha: 'a'.repeat(40), size: 30,
        html_url: 'https://github.com/acme/app/blob/main/secret.txt',
        content: Buffer.from(`token=${token}\n`).toString('base64'),
      }), {status: 200});
    }
    throw new Error(`Unexpected REST URL: ${url}`);
  };

  const host = createGitHubConversationTools({
    github: {
      binding: () => binding,
      readToken: () => token,
    },
    getApplication: () => ({
      runtime: {
        getTask: () => ({state: 'running', cancelRequested: false}),
        loadCheckpoint: () => undefined,
      },
      readPendingToolInvocation: () => undefined,
      readHostToolTask: () => ({task: {state: 'running'}}),
    }),
    resolveConversation: () => 'conv-1',
    confirmExport: async () => true,
    question,
    createGitHubProvider: options => new GitHubRestProvider({...options, fetchImpl}),
  });
  t.after(() => host.close());

  assert.equal(host.tools.length, 29);
  assert.ok(host.tools.some(x => x.descriptor.name === 'github.viewer.get'));
  assert.ok(host.tools.some(x => x.descriptor.name === 'github.pr.merge'));
  assert.ok(host.tools.some(x => x.descriptor.name === 'github.search.code'));
  assert.ok(!host.tools.some(x => x.descriptor.name === 'github.actions.repair.link'));
  assert.match(
    host.competitionToolAvailability.find(x => x.toolName === 'github.pr.comment')?.publicDescription ?? '',
    /无评论列表读取工具.*请勿在评论成功后调用 github\.issue\.get/,
  );
  assert.match(
    host.competitionToolAvailability.find(x => x.toolName === 'github.issue.get')?.publicDescription ?? '',
    /对 PR 编号调用会报 INVALID_ARGUMENT/,
  );
  assert.match(
    host.competitionToolAvailability.find(x => x.toolName === 'github.repo.list')?.publicDescription ?? '',
    /未提供 owner\/repo 时先调用此工具/,
  );

  // Missing binding keeps all tools unavailable and rejects preflight.
  const savedBinding = binding;
  binding = undefined;
  const viewerTool = host.tools.find(x => x.descriptor.name === 'github.viewer.get');
  assert.equal(host.competitionToolAvailability.find(x => x.toolName === 'github.viewer.get').available(makeScope(viewerTool)), false);
  await assert.rejects(() => host.prepareExport({...makeScope(viewerTool), phase: 'preflight'}), {code: 'UNAUTHORIZED'});

  // Restoring binding allows read + export through AsyncLocalStorage + GitHubService.
  binding = savedBinding;
  const viewerScope = makeScope(viewerTool, {});
  await host.prepareExport({...viewerScope, phase: 'preflight'});
  assert.ok(question.prepared.get(viewerScope.runId).spec.requirements[0].summary.includes('读取'));
  const viewerResult = await viewerTool.execute({}, viewerScope);
  assert.equal(viewerResult.login, 'octocat');
  const exportPolicy = host.competitionToolExports.find(x => x.toolName === 'github.viewer.get');
  assert.deepEqual(exportPolicy.project({taskId: viewerScope.taskId, proposalId: viewerScope.proposal.proposalId, result: viewerResult, signal: viewerScope.signal}), viewerResult);

  // Repository tools emit repo (never fullName) so PII egress checks allow cloud continuation.
  const repoListTool = host.tools.find(x => x.descriptor.name === 'github.repo.list');
  const repoListScope = makeScope(repoListTool, {sort: 'updated', perPage: 10, page: 1});
  await host.prepareExport({...repoListScope, phase: 'preflight'});
  const repoListResult = await repoListTool.execute({sort: 'updated', perPage: 10, page: 1}, repoListScope);
  assert.equal(repoListResult.items[0].repo, 'acme/app');
  assert.notEqual(classifyKnownEgressContent(JSON.stringify(repoListResult)), 'forbidden');
  const repoListExport = host.competitionToolExports.find(x => x.toolName === 'github.repo.list');
  const projectedRepos = repoListExport.project({taskId: repoListScope.taskId, proposalId: repoListScope.proposal.proposalId, result: repoListResult, signal: repoListScope.signal});
  assert.equal(repoListExport.accepts({taskId: repoListScope.taskId, proposalId: repoListScope.proposal.proposalId, arguments: {page: 1, perPage: 10, sort: 'updated'}, phase: 'final', projection: projectedRepos}), true);

  const repoGetTool = host.tools.find(x => x.descriptor.name === 'github.repo.get');
  const repoGetScope = makeScope(repoGetTool, {repo: 'acme/app'});
  await host.prepareExport({...repoGetScope, phase: 'preflight'});
  const repoGetResult = await repoGetTool.execute({repo: 'acme/app'}, repoGetScope);
  assert.equal(repoGetResult.fullName, 'acme/app');
  const repoGetExport = host.competitionToolExports.find(x => x.toolName === 'github.repo.get');
  const projectedRepoGet = repoGetExport.project({taskId: repoGetScope.taskId, proposalId: repoGetScope.proposal.proposalId, result: repoGetResult, signal: repoGetScope.signal});
  assert.equal(projectedRepoGet.repo, 'acme/app');
  assert.equal('fullName' in projectedRepoGet, false);
  assert.notEqual(classifyKnownEgressContent(JSON.stringify(projectedRepoGet)), 'forbidden');
  assert.equal(repoGetExport.accepts({taskId: repoGetScope.taskId, proposalId: repoGetScope.proposal.proposalId, arguments: {repo: 'acme/app'}, phase: 'final', projection: projectedRepoGet}), true);

  // External writes keep external_write + non-idempotent flags, omit standing ruleBindingDigest, and use card approval rather than hardware hotkey presence.
  const issueTool = host.tools.find(x => x.descriptor.name === 'github.issue.create');
  assert.equal(issueTool.descriptor.sideEffect, 'external_write');
  assert.equal(issueTool.descriptor.idempotencySupport, false);
  assert.equal(issueTool.descriptor.requiresPresence, false);
  const issueScope = makeScope(issueTool, {repo: 'acme/app', title: 'Track bug'});
  await host.prepareExport({...issueScope, phase: 'preflight'});
  assert.ok(question.prepared.get(issueScope.runId).spec.requirements[0].summary.includes('外部写入'));
  assert.equal(question.prepared.get(issueScope.runId).spec.requirements[0].ruleBindingDigest, undefined);
  const issueResult = await issueTool.execute({repo: 'acme/app', title: 'Track bug'}, issueScope);
  assert.equal(issueResult.externalId, '42');

  // Secrets in tool output are redacted before leaving provider.
  const contentsTool = host.tools.find(x => x.descriptor.name === 'github.repo.contents');
  const contentScope = makeScope(contentsTool, {repo: 'acme/app', path: 'secret.txt'});
  await host.prepareExport({...contentScope, phase: 'preflight'});
  const contentResult = await contentsTool.execute({repo: 'acme/app', path: 'secret.txt'}, contentScope);
  assert.ok(!contentResult.text.includes(token));
  assert.ok(contentResult.text.includes('[REDACTED]'));

  // Any leaked GH token pattern triggers export block.
  const exportContents = host.competitionToolExports.find(x => x.toolName === 'github.repo.contents');
  assert.throws(
    () => exportContents.project({
      taskId: contentScope.taskId,
      proposalId: contentScope.proposal.proposalId,
      result: {kind: 'file', path: 'secret.txt', text: 'ghp_AnotherRawLeakedToken1234567890'},
      signal: contentScope.signal,
    }),
    {code: 'UNAUTHORIZED'},
  );

  // Invalidate rotates resource generation and blocks prior prepared task.
  await host.invalidate();
  await assert.rejects(() => viewerTool.execute({}, viewerScope), {code: 'UNAUTHORIZED'});
});
