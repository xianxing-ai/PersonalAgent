import assert from 'node:assert/strict';
import test from 'node:test';
import {ProtocolError} from '@personal-agent/contracts';
import {TaskRuntime} from '../dist/index.js';
import {commitDeveloperDutyStatusComment, developerDutyToolIntent, ingestDeveloperDutyPoll, queueDeveloperDutyNotification, recordDeveloperDutyConclusions, storeDeveloperDutyEvalSet} from '../dist/application.js';
import {defaultRepoDutyPolicy, DUTY_STATUS_MARKER} from '@personal-agent/github';

const task = runtime => runtime.submitTask({conversationId: 'desktop-panel', goal: '值班', idempotencyKey: 'duty-'+Math.random()});
const page = (extra) => ({repo: 'octo/repo', connected: true, gap: false, events: [], ...extra});

test('F09 projection refuses to treat a gap as an empty feed', () => {
  const runtime = new TaskRuntime(':memory:');
  const owner = task(runtime);
  const previous = {repo: 'octo/repo', deliveryId: 'd1'};
  const gap = ingestDeveloperDutyPoll(runtime, owner.taskId, previous, page({connected: false, gap: true}));
  assert.equal(gap.advanced, false);
  assert.equal(gap.receipt, undefined);
  assert.equal(runtime.loadCheckpoint(owner.taskId, 'developer-duty-feed:v1'), undefined);
  assert.equal(runtime.loadCheckpoint(owner.taskId, 'developer-duty-gap:v1').noChange, false);
  const advanced = ingestDeveloperDutyPoll(runtime, owner.taskId, previous, page({previousDeliveryId: 'd1', next: {repo: 'octo/repo', deliveryId: 'd2'},
    events: [{id: 'd2', repo: 'octo/repo', type: 'pull_request', deliveryId: 'd2', receivedAt: '2026-11-02T00:00:00.000Z', number: 4, headSha: 'a'.repeat(40)}]}));
  assert.equal(advanced.advanced, true);
  assert.equal(advanced.receipt.kind, 'feeds.collect');
  assert.equal(runtime.loadCheckpoint(owner.taskId, 'developer-duty-cursor:v1').deliveryId, 'd2');
});

test('status comment unknown is stored and the next attempt reads back instead of posting', async () => {
  const runtime = new TaskRuntime(':memory:');
  const owner = task(runtime);
  let creates = 0;
  const comments = [];
  const ports = {listComments: async () => comments.map(item => ({...item})),
    createComment: async body => {creates += 1; comments.push({id: 3, body}); return {state: 'unknown'};},
    editComment: async () => ({state: 'confirmed'})};
  await assert.rejects(commitDeveloperDutyStatusComment(runtime, owner.taskId, ports, '失败'), (error) => error instanceof ProtocolError && error.code === 'RESULT_UNKNOWN');
  assert.equal(creates, 1);
  comments[0].body = `${DUTY_STATUS_MARKER}\n失败`;
  const confirmed = await commitDeveloperDutyStatusComment(runtime, owner.taskId, ports, '失败');
  assert.equal(creates, 1);
  assert.equal(confirmed.outcome, 'confirmed');
});

test('head conclusions, notification intent, eval set and merge refusal stay on existing chains', () => {
  const runtime = new TaskRuntime(':memory:');
  const owner = task(runtime);
  recordDeveloperDutyConclusions(runtime, owner.taskId, {repo: 'octo/repo', number: 4, headSha: 'a'.repeat(40), conclusion: '旧结论'});
  const next = recordDeveloperDutyConclusions(runtime, owner.taskId, {repo: 'octo/repo', number: 4, headSha: 'b'.repeat(40), conclusion: '新结论'});
  assert.equal(next[0].state, 'superseded');
  const first = queueDeveloperDutyNotification(runtime, owner.taskId, 'CI 失败', 'octo/repo#4');
  const duplicate = queueDeveloperDutyNotification(runtime, owner.taskId, 'CI 失败', 'octo/repo#4');
  assert.equal(first.channel, 'f12');
  assert.equal(first.delivered, false);
  assert.equal(duplicate.duplicate, true);
  const policy = {...defaultRepoDutyPolicy('octo/repo'), allowed: true, comment: true};
  assert.equal(developerDutyToolIntent(policy, 'comment').toolName, 'github.pr.comment');
  assert.equal(developerDutyToolIntent(policy, 'merge').allowed, false);
  assert.equal(developerDutyToolIntent(policy, 'merge').mergeInvoked, false);
  const dataset = storeDeveloperDutyEvalSet(runtime, owner.taskId, [{id: 'case-1', repo: 'octo/repo', headSha: 'b'.repeat(40), failureClass: 'environment', excerpt: 'no space left', expectedClass: 'environment', source: 'historical_ci'}]);
  assert.equal(dataset.evidenceLevel, 'fixture');
  assert.equal(dataset.kind, 'evaluation.dataset_snapshot');
});
