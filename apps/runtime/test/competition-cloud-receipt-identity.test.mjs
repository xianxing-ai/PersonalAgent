import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TaskRuntime} from '../dist/index.js';
import {recordCompetitionCloudAcceptance, recordCompetitionCloudReceipt} from '../dist/application/coordination.js';

const receipt = {sessionId: 'synthetic-session', requestId: 'synthetic-request',
  idempotencyKey: 'synthetic-request', payloadDigest: 'a'.repeat(64), accepted: false};
const instanceA = 'synthetic-instance-a', instanceB = 'synthetic-instance-b';

test('cloud receipts preserve instance binding while the first admission may strengthen a legacy send intent', async t => {
  const cases = [
    {name: 'first admission adds the instance', accept: true, allowed: true,
      before: receipt, after: {...receipt, accepted: true, serverInstanceId: instanceA}},
    {name: 'WSS admission retains its handshake instance', accept: true, allowed: true,
      before: {...receipt, serverInstanceId: instanceA}, after: {...receipt, accepted: true, serverInstanceId: instanceA}},
    {name: 'HTTPS admission remains without an instance', accept: true, allowed: true,
      before: receipt, after: {...receipt, accepted: true}},
    {name: 'HTTPS terminal remains without an instance', allowed: true,
      before: receipt, after: receipt},
    {name: 'known terminal keeps its instance', allowed: true,
      before: {...receipt, accepted: true, serverInstanceId: instanceA},
      after: {...receipt, accepted: true, serverInstanceId: instanceA}},
    {name: 'admission cannot change its handshake instance', accept: true,
      before: {...receipt, serverInstanceId: instanceA}, after: {...receipt, accepted: true, serverInstanceId: instanceB}},
    {name: 'admission cannot discard its handshake instance', accept: true,
      before: {...receipt, serverInstanceId: instanceA}, after: {...receipt, accepted: true}},
    {name: 'terminal cannot change the accepted instance',
      before: {...receipt, accepted: true, serverInstanceId: instanceA},
      after: {...receipt, accepted: true, serverInstanceId: instanceB}},
    {name: 'terminal cannot discard the accepted instance',
      before: {...receipt, accepted: true, serverInstanceId: instanceA}, after: {...receipt, accepted: true}},
    {name: 'unaccepted terminal cannot introduce an instance',
      before: receipt, after: {...receipt, serverInstanceId: instanceA}},
    {name: 'already accepted legacy intent cannot bind a later admission instance', accept: true,
      before: {...receipt, accepted: true}, after: {...receipt, accepted: true, serverInstanceId: instanceA}},
    {name: 'already accepted legacy intent cannot bind a later terminal instance',
      before: {...receipt, accepted: true}, after: {...receipt, accepted: true, serverInstanceId: instanceA}},
  ];
  for (const scenario of cases) await t.test(scenario.name, () => {
    const runtime = new TaskRuntime(':memory:');
    try {
      const task = runtime.submitTask({goal: 'Check synthetic cloud receipt identity',
        conversationId: 'receipt-identity', idempotencyKey: scenario.name});
      runtime.saveCheckpoint(task.taskId, 'competition-cloud-inflight', scenario.before);
      const record = scenario.accept ? recordCompetitionCloudAcceptance : recordCompetitionCloudReceipt;
      if (scenario.allowed) {
        record(runtime, task.taskId, scenario.after);
        if (scenario.accept) {
          assert.deepEqual(runtime.loadCheckpoint(task.taskId, 'competition-cloud-inflight'), scenario.after);
          recordCompetitionCloudReceipt(runtime, task.taskId, scenario.after);
        }
        assert.deepEqual(runtime.loadCheckpoint(task.taskId, 'competition-cloud-received'), scenario.after);
      } else {
        assert.throws(() => record(runtime, task.taskId, scenario.after), {code: 'RESULT_UNKNOWN'});
        assert.deepEqual(runtime.loadCheckpoint(task.taskId, 'competition-cloud-inflight'), scenario.before);
        assert.equal(runtime.loadCheckpoint(task.taskId, 'competition-cloud-received'), undefined);
      }
      assert.deepEqual(runtime.getTask(task.taskId), task);
      assert.equal(runtime.loadCheckpoint(task.taskId, 'competition-cloud-unknown'), undefined);
    } finally { runtime.close(); }
  });
});
