import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyRepairTrace} from '../dist/repair-policy.js';
import {
  applyRepairOperatorChoice, attachRepairTraceToReplay, confirmF13HostRecovery, planRuntimeTaskFailure, repairCardView,
} from '../dist/task-failure-repair.js';

const at = '2026-11-11T00:00:00.000Z';
const readNotice = {taskId: 'task-1', effect: 'read', outcome: 'failed', errorCode: 'TIMEOUT', occurredAt: at, evidenceRefs: ['read-1']};
const card = record => repairCardView(record);

test('a failed read is classified and can be retried without reopening the task', () => {
  const record = planRuntimeTaskFailure(readNotice);
  assert.equal(record.recovery.taskResumed, false);
  assert.equal(record.recovery.lockReleased, false);
  assert.equal(record.trace.attempts[0].strategy, 'backoff_retry');
  assert.equal(record.trace.attempts[0].sideEffectsEmitted, 0);
  const view = card(record);
  assert.equal(view.canRetryRead, true);
  assert.equal(view.canReplan, true);
  assert.equal(view.canAbandon, true);
  assert.equal(view.replay.actualToolCalls, 0);
  const retried = applyRepairOperatorChoice(record, {action: 'retry'}, at);
  assert.equal(retried.enqueueRead, true);
  assert.equal(retried.record.recovery.taskResumed, false);
});

test('an unknown write is reconciled by the host and is not blindly retried', () => {
  const record = planRuntimeTaskFailure({
    taskId: 'task-2', effect: 'write', outcome: 'unknown', errorCode: 'RESULT_UNKNOWN', occurredAt: at,
  });
  assert.equal(record.recovery.state, 'needs_reconcile');
  assert.equal(record.recovery.lockReleased, false);
  assert.equal(record.trace.attempts.some(attempt => attempt.strategy === 'backoff_retry'), false);
  assert.equal(applyRepairOperatorChoice(record, {action: 'retry'}, at).enqueueRead, false);
  const confirmed = confirmF13HostRecovery({effect: 'write', outcome: 'not_applied', evidenceRefs: ['host-readback']}, record.trace);
  assert.equal(confirmed.state, 'recovered');
  assert.equal(confirmed.lockReleased, true);
  assert.equal(confirmed.taskResumed, false);
  assert.equal(confirmF13HostRecovery({effect: 'write', outcome: 'unknown', evidenceRefs: ['host-readback']}, emptyRepairTrace()).state, 'needs_reconcile');
});

test('high-risk follow-up waits for approval and abandon stays available', () => {
  const record = planRuntimeTaskFailure({...readNotice, risk: 'high', effect: 'write', outcome: 'failed', reconciliationOutcome: 'not_applied'});
  const view = card(record);
  assert.equal(view.canRetryRead, false);
  assert.equal(view.canReplan, false);
  assert.equal(view.canAbandon, true);
  const blocked = applyRepairOperatorChoice(record, {action: 'replan'}, at);
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.enqueueRead, false);
  assert.equal(blocked.record.recovery.state, 'awaiting_approval');
  const abandoned = applyRepairOperatorChoice(record, {action: 'abandon'}, at);
  assert.equal(abandoned.accepted, true);
  assert.equal(abandoned.record.trace.attempts.at(-1).strategy, 'stop');
});

test('a repair trace can be viewed beside an existing replay without new execution', () => {
  const record = planRuntimeTaskFailure(readNotice);
  const replay = attachRepairTraceToReplay({
    timeline: [{recordId: 'historical', executedDuringReplay: false}],
    actualToolCalls: 0, actualWrites: 0,
  }, record.trace);
  assert.equal(replay.actualToolCalls, 0);
  assert.equal(replay.actualWrites, 0);
  assert.equal(replay.timeline[0].recordId, 'historical');
  assert.equal(replay.repairTimeline[0].kind, 'repair_decision');
  assert.equal(replay.repairTimeline[0].executedDuringReplay, false);
  assert.equal(replay.repairSummary.sideEffectsEmitted, 0);
});
