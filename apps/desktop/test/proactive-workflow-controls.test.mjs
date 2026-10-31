import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mountProactiveWorkflowControls,
  proactiveWorkflowSessions,
  workflowControlActions,
} from '../src/app/proactive-workflow-controls.js';
import {authorizationDom} from '../test-support/authorization-dom.mjs';

const session = (extra = {}) => ({
  taskId: 'workflow-task-1',
  sourceTaskId: 'source-task-1',
  sessionId: 'proactive-session',
  controlRevision: 0,
  taskState: 'running',
  ...extra,
});

async function click(root, action) {
  const button = root.querySelector(`button[data-action="${action}"]`);
  assert.ok(button, `missing button ${action}`);
  assert.equal(button.disabled, false);
  await button.fire('click', button);
  return button;
}

test('proactiveWorkflowSessions keeps only control-ready sessions', () => {
  assert.deepEqual(proactiveWorkflowSessions({state: 'unavailable', sessions: [session()]}), []);
  assert.equal(proactiveWorkflowSessions({
    state: 'configured_not_verified',
    sessions: [session(), session({taskId: '', sourceTaskId: 'x'}), session({controlRevision: -1})],
  }).length, 1);
});

test('workflowControlActions defaults to leave while attended and return while unattended', () => {
  assert.deepEqual(workflowControlActions(session()).actions.map(item => item.action),
    ['enter_unattended', 'pause', 'cancel']);
  assert.deepEqual(workflowControlActions(session({mode: 'unattended'})).actions.map(item => item.action),
    ['return', 'cancel']);
  assert.deepEqual(workflowControlActions(session({mode: 'paused'})).actions.map(item => item.action),
    ['resume', 'enter_unattended', 'cancel']);
  assert.deepEqual(workflowControlActions(session({taskState: 'succeeded'})).actions, []);
});

test('leave and return invoke proactive.workflow.control with revision and never notifications.digest', async () => {
  const {root} = authorizationDom();
  const calls = [];
  let revision = 0;
  const controls = mountProactiveWorkflowControls(root, async (name, payload) => {
    calls.push({name, payload});
    assert.equal(name, 'proactive.workflow.control');
    assert.equal(payload.expectedControlRevision, revision);
    assert.equal(payload.sourceTaskId, 'source-task-1');
    assert.match(payload.commandId, /^ui-control-/);
    revision += 1;
    return {
      mode: payload.action === 'enter_unattended' ? 'unattended' : 'attended',
      controlRevision: revision,
      ...(payload.action === 'return'
        ? {returnSummary: {done: [], changed: ['a'], pending: [], blocked: []}}
        : {}),
    };
  });

  controls.render({state: 'configured_not_verified', sessions: [session()]});
  assert.ok(root.querySelector('button[data-action="enter_unattended"]'));
  assert.equal(root.querySelector('button[data-action="return"]'), null);

  await click(root, 'enter_unattended');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.action, 'enter_unattended');
  assert.equal(calls.some(call => call.name === 'notifications.digest'), false);
  assert.ok(root.querySelector('button[data-action="return"]'), 'after leave, return becomes available');
  assert.equal(root.querySelector('button[data-action="enter_unattended"]'), null);

  await click(root, 'return');
  assert.equal(calls.at(-1).payload.action, 'return');
  assert.equal(calls.at(-1).payload.expectedControlRevision, 1);
  assert.match(root.querySelector('[data-workflow-status]').textContent, /已归来/);
  assert.equal(calls.some(call => call.name === 'notifications.digest'), false);
  controls.close();
});
