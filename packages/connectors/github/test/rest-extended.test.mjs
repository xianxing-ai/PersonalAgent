import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHubRestProvider,
  githubAllOperations,
  githubExtendedOperations,
  githubOperations,
  register,
  registerExtended,
} from '../dist/index.js';

const deadline = () => new Date(Date.now() + 60_000).toISOString();
const ctx = () => ({ signal: AbortSignal.timeout(10_000), deadline: deadline() });
const hostCtx = scopes => ({
  authorizationRef: 'auth-test-1',
  scopes,
  signal: AbortSignal.timeout(10_000),
  deadline: deadline(),
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('register keeps 14 default ops while registerExtended registers 29 mainstream ops', () => {
  const provider = new GitHubRestProvider({
    readToken: async () => 'ghp_secretToken12345678901234567890',
    fetchImpl: async () => jsonResponse({}),
  });
  const baseTools = new Map();
  const unregisterBase = register({ register: t => { baseTools.set(t.descriptor.name, t); return () => {}; } }, { provider });
  assert.equal(baseTools.size, 14);
  assert.equal(githubOperations.length, 14);
  unregisterBase();

  const extTools = new Map();
  const unregisterExt = registerExtended({ register: t => { extTools.set(t.descriptor.name, t); return () => {}; } }, { provider });
  assert.equal(extTools.size, 29);
  assert.equal(githubExtendedOperations.length, 15);
  assert.equal(githubAllOperations.length, 29);
  for (const op of githubAllOperations) {
    assert.ok(extTools.has(`github.${op}`), `missing tool github.${op}`);
  }
  assert.equal(extTools.get('github.branch.create').descriptor.requiresPresence, true);
  assert.equal(extTools.get('github.pr.merge').descriptor.requiresPresence, true);
  assert.equal(extTools.get('github.repo.contents').descriptor.requiresPresence, false);
  unregisterExt();
});

test('GitHubRestProvider executes mainstream read and write ops with redaction and CAS', async () => {
  const calls = [];
  const token = 'ghp_TestSecretToken1234567890abcdef';
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const path = url.replace('https://api.github.com', '');
    if (path === '/user') return jsonResponse({ login: 'octocat', name: 'Octo Cat', html_url: 'https://github.com/octocat' });
    if (path.startsWith('/user/repos?')) {
      return jsonResponse([{ full_name: 'acme/app', default_branch: 'main', private: true, html_url: 'https://github.com/acme/app' }]);
    }
    if (path === '/repos/acme/app/contents/README.md?ref=main') {
      return jsonResponse({
        type: 'file',
        path: 'README.md',
        name: 'README.md',
        sha: 'a'.repeat(40),
        size: 12,
        html_url: 'https://github.com/acme/app/blob/main/README.md',
        content: Buffer.from(`hello ${token}\n`).toString('base64'),
      });
    }
    if (path === '/repos/acme/app/contents/src') {
      return jsonResponse([
        { type: 'file', path: 'src/index.ts', name: 'index.ts', sha: 'b'.repeat(40), size: 42, html_url: 'https://github.com/acme/app/blob/main/src/index.ts' },
      ]);
    }
    if (path.startsWith('/repos/acme/app/branches?')) {
      return jsonResponse([{ name: 'main', commit: { sha: 'c'.repeat(40) }, protected: true }]);
    }
    if (path === '/repos/acme/app/git/refs' && init.method === 'POST') {
      return jsonResponse({ ref: 'refs/heads/feat/gh', object: { sha: 'c'.repeat(40) }, url: 'https://api.github.com/repos/acme/app/git/refs/heads/feat/gh' }, 201);
    }
    if (path.startsWith('/repos/acme/app/commits?')) {
      return jsonResponse([{ sha: 'c'.repeat(40), commit: { message: 'init', author: { name: 'Octo', date: '2026-11-24T00:00:00Z' } }, html_url: 'https://github.com/acme/app/commit/c' }]);
    }
    if (path === `/repos/acme/app/commits/${'c'.repeat(40)}`) {
      return jsonResponse({
        sha: 'c'.repeat(40),
        commit: { message: 'init', author: { name: 'Octo', date: '2026-11-24T00:00:00Z' } },
        html_url: 'https://github.com/acme/app/commit/c',
        files: [{ filename: 'README.md', status: 'modified', additions: 1, deletions: 0, patch: '+hi' }],
      });
    }
    if (path.startsWith('/search/code?')) {
      return jsonResponse({
        items: [{
          repository: { full_name: 'acme/app' },
          path: 'README.md',
          sha: 'd'.repeat(40),
          html_url: 'https://github.com/acme/app/blob/main/README.md',
          text_matches: [{ fragment: 'hello world' }],
        }],
      });
    }
    if (path.startsWith('/search/issues?')) {
      return jsonResponse({
        items: [{
          repository_url: 'https://api.github.com/repos/acme/app',
          number: 7,
          title: 'Bug report',
          state: 'open',
          labels: [{ name: 'bug' }],
          html_url: 'https://github.com/acme/app/issues/7',
          updated_at: '2026-11-24T00:00:00Z',
        }],
      });
    }
    if (path === '/repos/acme/app/issues' && init.method === 'POST') {
      return jsonResponse({ number: 12, html_url: 'https://github.com/acme/app/issues/12' }, 201);
    }
    if (path === '/repos/acme/app/issues/12' && (init.method ?? 'GET') === 'GET') {
      return jsonResponse({ number: 12, title: 'Old', body: '', state: 'open', labels: [], html_url: 'https://github.com/acme/app/issues/12', updated_at: '2026-11-24T01:00:00Z' });
    }
    if (path === '/repos/acme/app/issues/12' && init.method === 'PATCH') {
      return jsonResponse({ number: 12, html_url: 'https://github.com/acme/app/issues/12', state: 'closed' });
    }
    if (path.startsWith('/repos/acme/app/pulls?')) {
      return jsonResponse([{
        number: 9, title: 'PR 9', body: 'desc', state: 'open', draft: false,
        base: { ref: 'main', sha: 'e'.repeat(40) }, head: { ref: 'feat/x', sha: 'f'.repeat(40) },
        html_url: 'https://github.com/acme/app/pull/9',
      }]);
    }
    if (path === '/repos/acme/app/pulls/9') {
      return jsonResponse({
        number: 9, title: 'PR 9', body: 'desc', state: 'open', draft: false,
        base: { ref: 'main', sha: 'e'.repeat(40) }, head: { ref: 'feat/x', sha: 'f'.repeat(40) },
        html_url: 'https://github.com/acme/app/pull/9',
      });
    }
    if (path.startsWith('/repos/acme/app/pulls/9/files?')) {
      return jsonResponse([{ filename: 'a.ts', status: 'modified', additions: 2, deletions: 1, changes: 3 }]);
    }
    if (path === '/repos/acme/app/pulls/9/reviews' && init.method === 'POST') {
      return jsonResponse({ id: 55, html_url: 'https://github.com/acme/app/pull/9#pullrequestreview-55' }, 200);
    }
    if (path === '/repos/acme/app/pulls/9/merge' && init.method === 'PUT') {
      return jsonResponse({ sha: '9'.repeat(40), merged: true });
    }
    throw new Error(`Unexpected GitHub REST call: ${init.method ?? 'GET'} ${path}`);
  };

  const provider = new GitHubRestProvider({ readToken: async () => token, fetchImpl });
  const tools = new Map();
  registerExtended({ register: t => { tools.set(t.descriptor.name, t); return () => {}; } }, { provider });

  const viewer = await tools.get('github.viewer.get').execute({}, hostCtx(['github:read']));
  assert.equal(viewer.login, 'octocat');

  const repos = await tools.get('github.repo.list').execute({}, hostCtx(['github:read']));
  assert.equal(repos.items[0].fullName, 'acme/app');

  const file = await tools.get('github.repo.contents').execute({ repo: 'acme/app', path: 'README.md', ref: 'main' }, hostCtx(['github:read']));
  assert.equal(file.kind, 'file');
  assert.ok(!file.text.includes(token), 'token must be redacted from decoded file contents');
  assert.ok(file.text.includes('[REDACTED]'));

  const dir = await tools.get('github.repo.contents').execute({ repo: 'acme/app', path: 'src' }, hostCtx(['github:read']));
  assert.equal(dir.kind, 'dir');
  assert.equal(dir.entries[0].path, 'src/index.ts');

  const branches = await tools.get('github.branch.list').execute({ repo: 'acme/app' }, hostCtx(['github:read']));
  assert.equal(branches.items[0].protected, true);

  const createdBranch = await tools.get('github.branch.create').execute(
    { repo: 'acme/app', branch: 'feat/gh', fromSha: 'c'.repeat(40) },
    hostCtx(['github:write']),
  );
  assert.equal(createdBranch.state, 'confirmed');

  const commits = await tools.get('github.commit.list').execute({ repo: 'acme/app' }, hostCtx(['github:read']));
  assert.equal(commits.items[0].sha, 'c'.repeat(40));

  const commit = await tools.get('github.commit.get').execute({ repo: 'acme/app', sha: 'c'.repeat(40) }, hostCtx(['github:read']));
  assert.equal(commit.files[0].filename, 'README.md');

  const code = await tools.get('github.search.code').execute({ q: 'hello', repo: 'acme/app' }, hostCtx(['github:read']));
  assert.deepEqual(code.items[0].matchedLines, ['hello world']);

  const issues = await tools.get('github.search.issues').execute({ q: 'Bug' }, hostCtx(['github:read']));
  assert.equal(issues.items[0].repo, 'acme/app');
  assert.equal(issues.items[0].isPullRequest, false);

  const createdIssue = await tools.get('github.issue.create').execute({ repo: 'acme/app', title: 'New' }, hostCtx(['github:write']));
  assert.equal(createdIssue.externalId, '12');

  await assert.rejects(
    tools.get('github.issue.update').execute({ repo: 'acme/app', number: 12, expectedUpdatedAt: '2026-11-23T00:00:00Z', state: 'closed' }, hostCtx(['github:write'])),
    err => err.code === 'REVISION_CONFLICT',
  );

  const updatedIssue = await tools.get('github.issue.update').execute({ repo: 'acme/app', number: 12, expectedUpdatedAt: '2026-11-24T01:00:00Z', state: 'closed' }, hostCtx(['github:write']));
  assert.equal(updatedIssue.state, 'confirmed');

  const prs = await tools.get('github.pr.list').execute({ repo: 'acme/app', state: 'open' }, hostCtx(['github:read']));
  assert.equal(prs.items[0].number, 9);

  const files = await tools.get('github.pr.files').execute({ repo: 'acme/app', number: 9 }, hostCtx(['github:read']));
  assert.equal(files.items[0].filename, 'a.ts');

  const review = await tools.get('github.pr.review').execute({ repo: 'acme/app', number: 9, expectedHeadSha: 'f'.repeat(40), event: 'APPROVE', body: 'LGTM' }, hostCtx(['github:write']));
  assert.equal(review.externalId, '55');

  const merge = await tools.get('github.pr.merge').execute({ repo: 'acme/app', number: 9, expectedHeadSha: 'f'.repeat(40), mergeMethod: 'squash' }, hostCtx(['github:write']));
  assert.equal(merge.externalId, '9'.repeat(40));
  assert.ok(calls.length > 10);
});

test('GitHubRestProvider does not forward Authorization header on Actions log redirects and enforces scoped repos', async () => {
  const seenAuthHeaders = [];
  const fetchImpl = async (url, init = {}) => {
    seenAuthHeaders.push({ url, auth: init.headers?.Authorization ?? null });
    if (url === 'https://api.github.com/repos/acme/app/actions/jobs/5') {
      return jsonResponse({ id: 5, run_id: 2, conclusion: 'failure' });
    }
    if (url === 'https://api.github.com/repos/acme/app/actions/jobs/5/logs') {
      return new Response(null, { status: 302, headers: { location: 'https://pipelines.actions.githubusercontent.com/logs/5' } });
    }
    if (url === 'https://pipelines.actions.githubusercontent.com/logs/5') {
      return new Response('step failed line 1\n', { status: 200 });
    }
    throw new Error(`Unexpected url ${url}`);
  };
  const provider = new GitHubRestProvider({
    readToken: async () => 'ghp_1234567890123456789012345',
    repositories: ['acme/app'],
    fetchImpl,
  });

  const log = await provider.execute('actions.log.read', { repo: 'acme/app', runId: 2, jobId: 5 }, ctx());
  assert.equal(log.text, 'step failed line 1\n');
  assert.equal(seenAuthHeaders[2].url, 'https://pipelines.actions.githubusercontent.com/logs/5');
  assert.equal(seenAuthHeaders[2].auth, null);

  await assert.rejects(
    provider.execute('repo.get', { repo: 'other/repo' }, ctx()),
    err => err.code === 'SCOPE_DENIED',
  );
});
