import test from 'node:test';
import assert from 'node:assert/strict';
import {currentTask, orbState, visualOrbState} from '../src/features/conversation/state.js';

test('desktop status follows an unfinished task when a newer turn has finished', () => {
  const tasks = [
    {taskId: 'first', state: 'waiting_approval'},
    {taskId: 'second', state: 'succeeded'},
  ];
  assert.equal(currentTask(tasks)?.taskId, 'first');
  assert.equal(orbState(currentTask(tasks)), 'waiting');
  assert.equal(currentTask([{taskId: 'older', state: 'running'}, ...tasks])?.taskId, 'first');
  assert.equal(currentTask([{taskId: 'done', state: 'succeeded'}])?.taskId, 'done');
  assert.equal(currentTask([]), undefined);
});

test('live speech follows volume unless the task is thinking, executing, or failed', () => {
  const live = {active: true, status: 'speaking'};
  assert.equal(visualOrbState({tasks: [], live}), 'listening');
  assert.equal(visualOrbState({tasks: [{taskId: 'run', state: 'running'}], live}), 'executing');
  assert.equal(visualOrbState({tasks: [{taskId: 'plan', state: 'planning'}], live}), 'thinking');
  assert.equal(visualOrbState({tasks: [{taskId: 'bad', state: 'failed'}], live}), 'error');
  assert.equal(visualOrbState({tasks: [], live: {active: true, status: 'working'}}), 'executing');
  assert.equal(visualOrbState({tasks: []}), 'idle');
});

test('Live speech and business work preserve task approval, reconciliation, and cancellation waits', () => {
  for (const state of ['waiting_approval', 'waiting_external', 'waiting_reconciliation', 'cancelling']) {
    for (const status of ['speaking', 'listening', 'connecting', 'reconnecting', 'working']) {
      const task = {taskId: 'waiting', state};
      assert.equal(visualOrbState({tasks: [task], live: {active: true, status}}), 'waiting', `${state}/${status}`);
      assert.equal(task.state, state);
    }
  }
});
