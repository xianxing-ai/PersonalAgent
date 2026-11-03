import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProtocolError} from '@personal-agent/contracts';
import {TaskRuntime} from '../dist/index.js';
import {commitDeveloperDutyStatusComment, commitPullRequestDutyComment, dutyPullCommentKey, developerDutyToolIntent, ingestDeveloperDutyPoll, queueDeveloperDutyNotification, recordDeveloperDutyConclusions, storeDeveloperDutyEvalSet} from '../dist/application.js';
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

for (const kind of ['status', 'pull']) {
  const key = kind === 'status' ? 'developer-duty-comment:v1' : dutyPullCommentKey('octo/repo', 4);
  const attemptOf = saved => kind === 'status' ? saved : saved?.attempt;
  const commit = (runtime, taskId, ports, body) => kind === 'status'
    ? commitDeveloperDutyStatusComment(runtime, taskId, ports, body)
    : commitPullRequestDutyComment(runtime, taskId, ports, {repo: 'octo/repo', number: 4, headSha: 'a'.repeat(40), ci: 'failure', conclusion: body});

  test(`${kind} comment persists before dispatch and restart never repeats a thrown write`, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'duty-comment-'));
    const database = join(directory, 'runtime.sqlite');
    let runtime = new TaskRuntime(database);
    t.after(() => {runtime.close(); rmSync(directory, {recursive: true, force: true});});
    const owner = task(runtime);
    let creates = 0;
    let edits = 0;
    let comments = [];
    let original;
    const ports = {listComments: async () => comments,
      createComment: async body => {
        creates += 1;
        original = attemptOf(runtime.loadCheckpoint(owner.taskId, key));
        assert.deepEqual(original, {outcome: 'unknown', body}, 'write intent is durable before the POST');
        throw new Error('connection lost after dispatch');
      },
      editComment: async (id, body) => {
        edits += 1;
        assert.deepEqual(attemptOf(runtime.loadCheckpoint(owner.taskId, key)), {outcome: 'unknown', commentId: id, body});
        comments = [{id, body}];
        return {state: 'confirmed'};
      }};
    await assert.rejects(commit(runtime, owner.taskId, ports, 'original'), /connection lost/);
    runtime.close();
    runtime = new TaskRuntime(database);
    await assert.rejects(commit(runtime, owner.taskId, ports, 'changed'), {code: 'RESULT_UNKNOWN'});
    assert.deepEqual(attemptOf(runtime.loadCheckpoint(owner.taskId, key)), original);
    assert.equal(creates, 1);
    assert.equal(edits, 0);
    comments = [{id: 7, body: original.body}];
    await commit(runtime, owner.taskId, ports, 'changed');
    assert.equal(creates, 1);
    assert.equal(edits, 1);
    assert.equal(attemptOf(runtime.loadCheckpoint(owner.taskId, key)).outcome, 'confirmed');
  });

  test(`${kind} concurrent comment commits serialize readback and create only once`, async t => {
    const runtime = new TaskRuntime(':memory:');
    t.after(() => runtime.close());
    const owner = task(runtime);
    let creates = 0;
    let reads = 0;
    let entered;
    let release;
    const started = new Promise(resolve => {entered = resolve;});
    const wait = new Promise(resolve => {release = resolve;});
    const comments = [];
    const ports = {listComments: async () => {reads += 1; return comments.slice();},
      createComment: async body => {
        creates += 1;
        entered();
        await wait;
        comments.push({id: 7, body});
        return {state: 'confirmed', id: 7};
      }, editComment: async () => {assert.fail('unchanged body must not be edited');}};
    const first = commit(runtime, owner.taskId, ports, 'same');
    const second = commit(runtime, owner.taskId, ports, 'same');
    await started;
    assert.equal(reads, 1, 'the second call must not inspect a still-inflight write');
    assert.equal(attemptOf(runtime.loadCheckpoint(owner.taskId, key)).outcome, 'unknown');
    release();
    await Promise.all([first, second]);
    assert.equal(creates, 1);
  });
}

test('an unavailable comment read does not persist an undispatched write', async t => {
  const runtime = new TaskRuntime(':memory:');
  t.after(() => runtime.close());
  const owner = task(runtime);
  let readable = false;
  let creates = 0;
  const ports = {listComments: async () => readable ? [] : 'unknown',
    createComment: async () => {creates += 1; return {state: 'confirmed', id: 7};},
    editComment: async () => {assert.fail('no existing comment');}};
  await assert.rejects(commitDeveloperDutyStatusComment(runtime, owner.taskId, ports, 'same'), {code: 'RESULT_UNKNOWN'});
  assert.equal(runtime.loadCheckpoint(owner.taskId, 'developer-duty-comment:v1'), undefined);
  readable = true;
  await commitDeveloperDutyStatusComment(runtime, owner.taskId, ports, 'same');
  assert.equal(creates, 1);
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
