import assert from 'node:assert/strict';
import test from 'node:test';
import {createOperatorBrake} from '../dist/index.js';

function clock(start = '2026-11-11T00:00:00.000Z') {
  let current = start;
  return {now: () => current, set: value => {current = value;}};
}

function memoryStore(initial) {
  let value = initial;
  return {load: () => value, save(record) {value = structuredClone(record);}, read: () => value};
}

function machine() {
  const tasks = new Map([['task-1', {id: 'task-1', kind: 'task', cursor: 1, status: 'running'}]]);
  const checkpoints = new Map();
  const events = [];
  let triggersHeld = false;
  return {
    tasks, checkpoints, events,
    triggersHeld: () => triggersHeld,
    ports(store, extensions, now) {
      return {
        now, store, extensions,
        listActive: () => [...tasks.values()].filter(task => task.status === 'running')
          .map(task => ({id: task.id, kind: task.kind, cursor: task.cursor})),
        checkpoint(run, marker) {
          checkpoints.set(run.id, structuredClone(marker));
          events.push('checkpoint:' + run.id);
        },
        abort(run) {
          const task = tasks.get(run.id);
          task.status = 'held';
          events.push('abort:' + run.id);
        },
        resume(run, marker) {
          const task = tasks.get(run.id);
          const saved = checkpoints.get(run.id);
          assert.equal(saved.cursor, 1);
          assert.equal(marker.cursor, 1);
          task.cursor = saved.cursor + 1;
          task.status = 'done';
          events.push('resume:' + run.id + ':' + task.cursor);
        },
        holdTriggers() {triggersHeld = true; events.push('hold-triggers');},
        releaseTriggers() {triggersHeld = false; events.push('release-triggers');},
      };
    },
  };
}

test('pause stops new work, aborts the current run at its checkpoint, and resume continues', async () => {
  const store = memoryStore();
  const world = machine();
  const time = clock();
  const extensions = {riskAutonomy: {hold() {world.events.push('risk-hold');}, release() {world.events.push('risk-release');}},
    sourceTriggers: {hold() {world.events.push('source-hold');}, release() {world.events.push('source-release');}},
    repair: {hold() {world.events.push('repair-hold');}, release() {world.events.push('repair-release');}}};
  const brake = createOperatorBrake(world.ports(store, extensions, time.now));
  assert.deepEqual(brake.admit('task'), {accepted: true});
  const paused = await brake.engage();
  assert.equal(paused.paused, true);
  assert.equal(world.tasks.get('task-1').status, 'held');
  assert.equal(world.checkpoints.get('task-1').cursor, 1);
  assert.deepEqual(brake.admit('schedule'), {accepted: false, reason: 'operator_paused'});
  assert.deepEqual(brake.admit('tool'), {accepted: false, reason: 'operator_paused'});
  assert.equal(world.triggersHeld(), true);
  assert.deepEqual(await brake.engage(), paused);
  const resumed = await brake.release();
  assert.equal(resumed.paused, false);
  assert.equal(world.tasks.get('task-1').status, 'done');
  assert.equal(world.tasks.get('task-1').cursor, 2);
  assert.equal(world.events.at(-1), 'resume:task-1:2');
  assert.deepEqual(brake.admit('workflow'), {accepted: true});
  assert.ok(world.events.includes('risk-hold') && world.events.includes('source-hold') && world.events.includes('repair-hold'));
  assert.ok(world.events.includes('risk-release') && world.events.includes('source-release') && world.events.includes('repair-release'));
});

test('a restarted brake keeps the pause and does not resume until release', async () => {
  const store = memoryStore();
  const world = machine();
  const time = clock();
  const first = createOperatorBrake(world.ports(store, undefined, time.now));
  await first.engage();
  const restarted = createOperatorBrake(world.ports(store, undefined, time.now));
  assert.equal(restarted.isPaused(), true);
  assert.equal(world.triggersHeld(), true);
  assert.equal(world.tasks.get('task-1').status, 'held');
  assert.deepEqual(restarted.admit('task'), {accepted: false, reason: 'operator_paused'});
  await restarted.release();
  assert.equal(world.tasks.get('task-1').cursor, 2);
  assert.equal(restarted.isPaused(), false);
});
