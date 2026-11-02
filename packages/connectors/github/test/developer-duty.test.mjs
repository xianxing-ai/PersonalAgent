import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptGitHubWebhook, assessDutyPush, assertDutyCredentialScope, bindHeadConclusions, buildOfflineEvalSet, buildPersonalView,
  classifyCiFailure, createStubRemoteDutyRunner, defaultRepoDutyPolicy, evaluateRepoDutyAction, executeStatusComment,
  interpretGitHubRateLimit, planStatusComment, reduceDutyPoll, DEVELOPER_DUTY_EVIDENCE_LEVEL, DUTY_STATUS_MARKER,
} from '../dist/index.js';

const event = (id, extra = {}) => ({id, repo: 'octo/repo', type: 'pull_request', deliveryId: id, receivedAt: '2026-11-02T00:00:00.000Z', ...extra});

test('a gap or disconnect is not treated as no change and does not advance the cursor', () => {
  const previous = {repo: 'octo/repo', deliveryId: 'd1'};
  const gap = reduceDutyPoll(previous, {repo: 'octo/repo', connected: false, gap: true, events: []});
  assert.equal(gap.status, 'gap');
  assert.equal(gap.noChange, false);
  assert.equal(gap.cursor.deliveryId, 'd1');
  const skipped = reduceDutyPoll(previous, {repo: 'octo/repo', connected: true, gap: false, previousDeliveryId: 'other', events: [], next: {repo: 'octo/repo', deliveryId: 'd9'}});
  assert.equal(skipped.status, 'gap');
  assert.equal(skipped.noChange, false);
  const empty = reduceDutyPoll(previous, {repo: 'octo/repo', connected: true, gap: false, previousDeliveryId: 'd1', events: []});
  assert.equal(empty.status, 'unchanged');
  assert.equal(empty.noChange, true);
  const advanced = reduceDutyPoll(previous, {repo: 'octo/repo', connected: true, gap: false, previousDeliveryId: 'd1', events: [event('d2')], next: {repo: 'octo/repo', deliveryId: 'd2'}});
  assert.equal(advanced.status, 'advanced');
  assert.equal(advanced.cursor.deliveryId, 'd2');
  assert.equal(DEVELOPER_DUTY_EVIDENCE_LEVEL, 'fixture');
});

test('webhook signature failure is not an event', () => {
  assert.equal(acceptGitHubWebhook({deliveryId: 'd', eventName: 'ping', payload: {repository: {full_name: 'octo/repo'}}, signatureOk: false}).accepted, false);
  const accepted = acceptGitHubWebhook({deliveryId: 'd', eventName: 'pull_request', signatureOk: true, payload: {repository: {full_name: 'octo/repo'}, action: 'opened', pull_request: {number: 4, head: {sha: 'a'.repeat(40)}}}});
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.event.headSha, 'a'.repeat(40));
});

test('repository policy forbids merge by default and refuses unknown branch protection', () => {
  const policy = {...defaultRepoDutyPolicy('octo/repo'), allowed: true, comment: true, pushBranches: ['dev']};
  assert.equal(policy.merge, false);
  assert.equal(evaluateRepoDutyAction(policy, 'merge').allowed, false);
  assert.equal(evaluateRepoDutyAction(policy, 'comment').allowed, true);
  assert.equal(evaluateRepoDutyAction(policy, 'push', 'main').allowed, false);
  assert.equal(assessDutyPush(policy, 'unknown', 'dev').allowed, false);
  assert.equal(assessDutyPush(policy, {branch: 'dev', protected: true, allowsForcePush: false, requiredReviews: 1, restrictsPushes: false}, 'dev', true).allowed, false);
  assert.equal(assessDutyPush(policy, {branch: 'dev', protected: true, allowsForcePush: false, requiredReviews: 1, restrictsPushes: false}, 'dev').allowed, true);
  assert.throws(() => assertDutyCredentialScope({repo: 'octo/repo', credentialRef: 'ghp_secret', policy}), {code: 'SCOPE_DENIED'});
  assert.equal(assertDutyCredentialScope({repo: 'octo/repo', credentialRef: 'credential:github:octo/repo', policy}).merge, false);
});

test('status comments are edited in place and an unknown write is not posted again', async () => {
  let creates = 0;
  let edits = 0;
  const comments = [];
  const ports = {listComments: async () => comments.slice(), createComment: async body => {creates += 1; comments.push({id: 7, body}); return {state: 'unknown'};},
    editComment: async (id, body) => {edits += 1; const found = comments.find(item => item.id === id); if (found) found.body = body; return {state: 'confirmed'};}};
  const first = await executeStatusComment(ports, 'CI red');
  assert.equal(first.outcome, 'unknown');
  assert.equal(creates, 1);
  assert.match(comments[0].body, new RegExp(DUTY_STATUS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  comments.splice(0, comments.length);
  const missing = await executeStatusComment(ports, 'CI red', first);
  assert.equal(creates, 1);
  assert.equal(missing.outcome, 'unknown');
  comments.push({id: 7, body: `${DUTY_STATUS_MARKER}\nCI red`});
  const reread = await executeStatusComment(ports, 'CI red', first);
  assert.equal(creates, 1);
  assert.equal(reread.outcome, 'confirmed');
  comments[0].body = `${DUTY_STATUS_MARKER}\nold`;
  const third = await executeStatusComment(ports, 'CI green', {...first, outcome: 'unknown'});
  assert.equal(creates, 1);
  assert.equal(edits, 0, 'a different visible body does not reconcile the original unknown write');
  assert.deepEqual(third, first, 'retain the original operation instead of replacing it with the new body');
  comments[0].body = first.body;
  const wrongId = await executeStatusComment(ports, 'CI green', {...first, commentId: 8});
  assert.equal(wrongId.outcome, 'unknown');
  assert.equal(edits, 0);
  const updated = await executeStatusComment(ports, 'CI green', {...first, commentId: 7});
  assert.equal(edits, 1, 'a new body may be edited only after the original write is confirmed');
  assert.equal(updated.outcome, 'confirmed');
  const duplicate = planStatusComment({desiredBody: 'x', existing: [{id: 1, body: DUTY_STATUS_MARKER}, {id: 2, body: DUTY_STATUS_MARKER}]});
  assert.equal(duplicate.action, 'refuse');
});

test('head changes supersede older conclusions and CI class keeps an excerpt', () => {
  const first = bindHeadConclusions([], {repo: 'octo/repo', number: 4, headSha: 'a'.repeat(40), conclusion: 'needs tests'});
  const second = bindHeadConclusions(first, {repo: 'octo/repo', number: 4, headSha: 'b'.repeat(40), conclusion: 'tests added'});
  assert.equal(second.find(item => item.headSha.startsWith('a')).state, 'superseded');
  assert.equal(second.find(item => item.headSha.startsWith('b')).state, 'current');
  const classified = classifyCiFailure({logExcerpt: 'Error: connect ECONNRESET while downloading actions/setup-node'});
  assert.equal(classified.class, 'flaky');
  assert.match(classified.evidenceExcerpt, /ECONNRESET/);
  assert.equal(interpretGitHubRateLimit({status: 429, headers: {'retry-after': '30'}}).limited, true);
  assert.equal(interpretGitHubRateLimit({status: 200, transportError: true}).treatAsNoChange, false);
  assert.equal(interpretGitHubRateLimit({status: 403, headers: {}}).limited, true);
});

test('personal view, offline eval set and remote runner stay fixture-level', async () => {
  const view = buildPersonalView({login: 'me', assigned: [{repo: 'octo/repo', number: 1, title: 'Bug', url: 'https://github.com/octo/repo/issues/1'}],
    reviewRequested: [{repo: 'octo/other', number: 2, title: 'PR', url: 'https://github.com/octo/other/pull/2'}],
    failing: [{repo: 'octo/repo', number: 3, title: 'Mine', url: 'https://github.com/octo/repo/pull/3', headSha: 'c'.repeat(40), author: 'me'},
      {repo: 'octo/repo', number: 4, title: 'Theirs', url: 'https://github.com/octo/repo/pull/4', headSha: 'd'.repeat(40), author: 'other'}]});
  assert.deepEqual(view.map(item => item.kind), ['assigned', 'review_requested', 'failing_pr']);
  const dataset = buildOfflineEvalSet([{id: 'case-1', repo: 'octo/repo', headSha: 'c'.repeat(40), failureClass: 'code', excerpt: 'AssertionError', expectedClass: 'code', source: 'historical_ci'}]);
  assert.equal(dataset.kind, 'evaluation.dataset_snapshot');
  assert.equal(dataset.evidenceLevel, 'fixture');
  assert.equal(dataset.contentSha256.length, 64);
  const runner = createStubRemoteDutyRunner();
  assert.equal(runner.describe().runsWhenLocalMachineOff, false);
  assert.deepEqual(await runner.submit({repo: 'octo/repo'}), {accepted: false, reason: 'stub'});
});
