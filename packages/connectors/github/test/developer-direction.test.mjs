import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {
  classifyCiFailureStable, commentWriteAvailable, createGitHubWebhookServer, detectApiDocDrift, emptyTriggerState,
  initialCiLoop, routeTrigger, stepCiLoop, summarizeDeveloperEval,
} from '../dist/index.js';

const sha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);

test('stable CI classification does not let a timeout hide a test assertion and flaky reruns once', () => {
  const mixed = classifyCiFailureStable({logExcerpt: 'AssertionError: expected 1\nThe runner timed out'});
  assert.equal(mixed.class, 'code');
  assert.equal(mixed.rerun.recommend, false);
  const flaky = classifyCiFailureStable({logExcerpt: 'Error: socket hang up', rerunCount: 0});
  assert.equal(flaky.class, 'flaky');
  assert.equal(flaky.rerun.recommend, true);
  assert.equal(classifyCiFailureStable({logExcerpt: 'Error: socket hang up', rerunCount: 1}).rerun.recommend, false);
});

test('webhook listener checks the signature and dedupes the same head', async () => {
  const seen = [];
  const server = await createGitHubWebhookServer({secret: 'top-secret', now: () => '2026-11-03T00:00:00.000Z', onEvent: event => seen.push(event)});
  const body = JSON.stringify({repository: {full_name: 'octo/repo'}, action: 'opened', pull_request: {number: 4, head: {sha}}});
  const sign = payload => `sha256=${createHmac('sha256', 'top-secret').update(payload).digest('hex')}`;
  const post = (payload, delivery, signature = sign(payload)) => fetch(server.url, {method: 'POST', headers: {
    'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-delivery': delivery, 'x-github-event': 'pull_request',
  }, body: payload});
  try {
    assert.equal((await post(body, 'd1', 'sha256=00')).status, 401);
    assert.equal((await post(body, 'd1')).status, 202);
    assert.equal(seen[0].headSha, sha);
    assert.notEqual(seen[0].receivedAt, '1970-01-01T00:00:00.000Z');
    assert.equal((await post(body, 'd2')).status, 200);
    assert.equal(seen.length, 1);
  } finally {await server.close();}
});

test('trigger routing dedupes a head, replans when the head changes, and ignores gaps', () => {
  const rule = {id: 'ci', source: 'check_run', match: {repo: 'octo/repo', conclusion: 'failure'}, action: {workflow: 'ci_fix'}, cooldownMs: 60_000, maxConcurrentPerRepo: 1};
  const event = extra => ({repo: 'octo/repo', source: 'check_run', deliveryId: 'd', number: 4, headSha: sha, conclusion: 'failure', ...extra});
  assert.equal(routeTrigger([rule], {...event(), gap: true}, emptyTriggerState(), 0).status, 'gap');
  const first = routeTrigger([rule], event(), emptyTriggerState(), 0);
  assert.equal(first.status, 'spawn');
  const state = {dispatched: [{dedupeKey: first.dedupeKey, taskId: 'goal-1', at: 0, headSha: sha, ruleId: 'ci'}], activeByRepo: {'octo/repo': 1}};
  assert.equal(routeTrigger([rule], event({deliveryId: 'd2'}), state, 10).status, 'deduped');
  assert.equal(routeTrigger([rule], event({deliveryId: 'd3', headSha: nextSha}), state, 10).status, 'busy');
  const idle = {...state, activeByRepo: {'octo/repo': 0}};
  const replanned = routeTrigger([rule], event({deliveryId: 'd3', headSha: nextSha}), idle, 10);
  assert.equal(replanned.status, 'spawn');
  assert.equal(replanned.supersededTaskId, 'goal-1');
});

test('CI loop waits for the bound head, reruns flaky once, then stops', () => {
  let state = initialCiLoop({repo: 'octo/repo', number: 4, maxRounds: 2});
  for (const signal of ['diagnosed', 'patched', 'verified', 'pushed']) state = stepCiLoop(state, signal, signal === 'pushed' ? sha : undefined);
  assert.equal(state.phase, 'await_ci');
  assert.equal(stepCiLoop(state, 'ci_green', nextSha).note, 'ignored ci for a different head');
  state = stepCiLoop(state, 'ci_flaky', sha);
  assert.equal(state.flakyReruns, 1);
  state = stepCiLoop(state, 'ci_flaky', sha);
  assert.equal(state.phase, 'diagnose');
  state = stepCiLoop(stepCiLoop(stepCiLoop(stepCiLoop(state, 'diagnosed'), 'patched'), 'verified'), 'pushed', nextSha);
  state = stepCiLoop(state, 'ci_red', nextSha);
  assert.equal(state.phase, 'stopped');
  assert.equal(commentWriteAvailable({policyComment: true, autonomy: {allow: true, mode: 'auto', risk: 'reversible_write'}}), true);
  assert.equal(commentWriteAvailable({policyComment: true, autonomy: {allow: false, mode: 'deny', risk: 'irreversible'}}), false);
});

test('API drift and eval summaries only use the supplied rows', () => {
  const drift = detectApiDocDrift({implemented: ['GET /tasks'], documented: [], previousDigest: 'old'});
  assert.equal(drift.drift, true);
  assert.deepEqual(drift.missingInDocs, ['GET /tasks']);
  const summary = summarizeDeveloperEval({caseIds: ['a', 'b'], outcomes: [{id: 'a', fixed: true, rounds: 2, cost: 1}]});
  assert.deepEqual(summary.missing, ['b']);
  assert.equal(summary.fixRate, 1);
  assert.equal(summary.evidenceLevel, 'fixture');
});
