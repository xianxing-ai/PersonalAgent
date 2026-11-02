import assert from 'node:assert/strict';
import test from 'node:test';
import {DUTY_STATUS_MARKER} from '@personal-agent/github';
import {createGitHubDutyComments, readGitHubDutyPage, readGitHubPersonalView} from '../electron/developer-duty-github.js';
import {TaskRuntime} from '@personal-agent/runtime';
import {createDeveloperDutyTools} from '@personal-agent/runtime/application';

function response(status, body, headers = {}) {
  return {ok: status >= 200 && status < 300, status, headers: {get: name => headers[name.toLowerCase()]}, json: async () => body};
}

test('missing credential is not connected and a failure is a gap', async () => {
  const absent = await readGitHubDutyPage({repo: 'octo/repo', readCredential: () => undefined, fetchImpl: async () => {throw new Error('should not fetch');}});
  assert.equal(absent.connected, false);
  assert.equal(absent.gap, true);
  assert.equal(absent.reason, 'not connected');
  assert.equal(JSON.stringify(absent).includes('fixture'), false);
  let calls = 0;
  const failed = await readGitHubDutyPage({repo: 'octo/repo', readCredential: () => 'github-token-fixture', fetchImpl: async () => {calls += 1; return response(500, {});}});
  assert.equal(calls, 3);
  assert.equal(failed.gap, true);
  assert.equal(failed.connected, false);
  assert.equal(JSON.stringify(failed).includes('github-token-fixture'), false);
});

test('injected fetch reads events, writes one marked comment, and names the real login', async () => {
  const token = 'github-token-fixture';
  const store = [];
  const fetchImpl = async (url, init = {}) => {
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    if (url.endsWith('/user')) return response(200, {login: 'octocat'});
    if (url.includes('/issues?filter=assigned')) return response(200, [{number: 4, title: 'Fix docs', html_url: 'https://github.com/octo/repo/issues/4', repository_url: 'https://api.github.com/repos/octo/repo'}]);
    if (url.includes('/search/issues')) return response(200, {items: []});
    if (url.includes('/events')) return response(200, [{id: 9, type: 'PullRequestEvent', created_at: '2026-11-02T00:00:00.000Z', payload: {action: 'opened', pull_request: {number: 4, head: {sha: 'a'.repeat(40)}}}}], {etag: '"v1"'});
    if (url.includes('/pulls?')) return response(200, [{number: 4, updated_at: '2026-11-02T00:00:00.000Z', head: {sha: 'a'.repeat(40)}}]);
    if (url.includes('/actions/runs')) return response(200, {workflow_runs: [{id: 3, updated_at: '2026-11-02T00:00:00.000Z', head_sha: 'a'.repeat(40), conclusion: 'failure'}]});
    if (url.endsWith('/comments?per_page=100') && (!init.method || init.method === 'GET')) return response(200, store);
    if (init.method === 'POST') {
      const body = JSON.parse(init.body).body;
      store.push({id: 11, body});
      return response(201, {id: 11, body});
    }
    if (init.method === 'PATCH') return response(200, {});
    return response(404, {});
  };
  const page = await readGitHubDutyPage({repo: 'octo/repo', readCredential: () => token, fetchImpl});
  assert.equal(page.connected, true);
  assert.equal(page.gap, false);
  assert.equal(page.evidenceLevel, 'read');
  assert.equal(page.events.some(event => event.type === 'pull_request' && event.number === 4), true);
  assert.equal(page.events.some(event => event.type === 'workflow_run'), true);
  assert.equal(page.next.etag, '"v1"');
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '值班', idempotencyKey: 'duty-fetch'});
  const context = {taskId: parent.taskId, runId: 'run', signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: 'auth', scopes: ['agent:delegate']};
  const duty = createDeveloperDutyTools({getRuntime: () => runtime,
    readPage: (repo, cursor) => readGitHubDutyPage({repo, cursor, readCredential: () => token, fetchImpl}),
    createComments: ({repo, number}) => createGitHubDutyComments({repo, number, readCredential: () => token, fetchImpl}),
    readPersonal: () => readGitHubPersonalView({readCredential: () => token, fetchImpl})});
  const tool = name => duty.tools.find(item => item.descriptor.name === name);
  await tool('duty.watch').execute({repo: 'octo/repo'}, context);
  await tool('duty.policy.set').execute({repo: 'octo/repo', allowed: true, comment: false}, context);
  await duty.poll();
  assert.equal(store.length, 0, 'comment stays off until the repository policy allows it');
  await assert.rejects(tool('duty.policy.set').execute({repo: 'octo/repo', allowed: true, comment: true, merge: true}, context), {code: 'SCOPE_DENIED'});
  await tool('duty.policy.set').execute({repo: 'octo/repo', allowed: true, comment: true}, context);
  await duty.poll();
  assert.equal(store.length, 1);
  assert.match(store[0].body, new RegExp(`^${DUTY_STATUS_MARKER}`));
  await duty.poll();
  assert.equal(store.length, 1);
  const view = await tool('duty.personal.list').execute({}, context);
  assert.equal(view.login, 'octocat');
  assert.equal(view.connected, true);
  assert.equal(view.evidenceLevel, 'read');
  assert.equal(JSON.stringify(view).includes(token), false);
  const offline = await readGitHubPersonalView({readCredential: () => undefined, fetchImpl});
  assert.equal(offline.reason, 'not connected');
  assert.equal(offline.login, undefined);
  assert.equal(page.pullRequests.length, 1);
  assert.equal(page.pullRequests[0].number, 4);
  assert.equal(page.statusComment, undefined);
});

test('each open pull request gets its own comment and an unchanged head is not written again', async () => {
  const token = 'github-token-fixture';
  const sha4 = 'a'.repeat(40);
  const sha9 = 'b'.repeat(40);
  const next4 = 'c'.repeat(40);
  let head4 = sha4;
  let ci4 = 'failure';
  let gap = false;
  const threads = new Map();
  const writes = [];
  let ids = 20;
  const fetchImpl = async (url, init = {}) => {
    if (gap) return response(503, {});
    if (url.includes('/events')) return response(200, [], {etag: '"v1"'});
    if (url.includes('/pulls?')) return response(200, [{number: 4, head: {sha: head4}}, {number: 9, head: {sha: sha9}}]);
    if (url.includes('/actions/runs')) return response(200, {workflow_runs: [{head_sha: head4, status: 'completed', conclusion: ci4}, {head_sha: sha9, status: 'completed', conclusion: 'success'}]});
    const listed = url.match(/\/issues\/(\d+)\/comments/);
    if (listed && (!init.method || init.method === 'GET')) return response(200, threads.get(Number(listed[1])) ?? []);
    if (init.method === 'POST') {
      const number = Number(url.match(/\/issues\/(\d+)\/comments/)[1]);
      const body = JSON.parse(init.body).body;
      const comment = {id: ++ids, body};
      threads.set(number, [...(threads.get(number) ?? []), comment]);
      writes.push({method: 'POST', number, body});
      return response(201, comment);
    }
    if (init.method === 'PATCH') {
      const id = Number(url.match(/\/comments\/(\d+)/)[1]);
      const body = JSON.parse(init.body).body;
      for (const [number, items] of threads) {
        const current = items.find(item => item.id === id);
        if (!current) continue;
        current.body = body;
        writes.push({method: 'PATCH', number, body});
      }
      return response(200, {});
    }
    return response(404, {});
  };
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '值班', idempotencyKey: 'duty-prs'});
  const context = {taskId: parent.taskId, runId: 'run', signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: 'auth', scopes: ['agent:delegate']};
  const duty = createDeveloperDutyTools({getRuntime: () => runtime,
    readPage: (repo, cursor) => readGitHubDutyPage({repo, cursor, readCredential: () => token, fetchImpl}),
    createComments: ({repo, number}) => createGitHubDutyComments({repo, number, readCredential: () => token, fetchImpl})});
  const tool = name => duty.tools.find(item => item.descriptor.name === name);
  await tool('duty.watch').execute({repo: 'octo/repo'}, context);
  await tool('duty.policy.set').execute({repo: 'octo/repo', allowed: true, comment: true}, context);
  await duty.poll();
  assert.deepEqual(writes.map(item => [item.method, item.number]), [['POST', 4], ['POST', 9]]);
  assert.match(threads.get(4)[0].body, new RegExp(`${DUTY_STATUS_MARKER}\\n[\\s\\S]*pull: 4\\nhead: ${sha4}\\nci: failure`));
  assert.match(threads.get(9)[0].body, new RegExp(`pull: 9\\nhead: ${sha9}\\nci: success`));
  const owner = runtime.findTaskByIdempotencyKey('developer-duty-registry:v1');
  assert.equal(runtime.loadCheckpoint(owner.taskId, `developer-duty-pr-comment:v1:octo/repo#4`).headSha, sha4);
  await duty.poll();
  assert.equal(writes.length, 2);
  head4 = next4;
  ci4 = 'success';
  await duty.poll();
  assert.equal(writes.length, 3);
  assert.equal(writes[2].method, 'PATCH');
  assert.equal(writes[2].number, 4);
  assert.match(writes[2].body, new RegExp(`head: ${next4}\\nci: success`));
  assert.equal(threads.get(9).length, 1);
  gap = true;
  await duty.poll();
  assert.equal(writes.length, 3);
});
