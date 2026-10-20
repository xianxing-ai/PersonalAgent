import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOverLimitRenderer, createMemoryWatchdog, DEFAULT_MEMORY_LIMIT_BYTES} from '../electron/memory-watchdog.js';

/** Electron reports workingSetSize in kilobytes. */
const megabytes = value => value * 1024;
const limit = 1.5 * 1024 ** 3;

test('selects only the heaviest renderer above the limit', () => {
  const metrics = [
    {pid: 1, type: 'Tab', memory: {workingSetSize: megabytes(900)}},
    {pid: 2, type: 'Tab', memory: {workingSetSize: megabytes(2000)}},
    {pid: 3, type: 'Tab', memory: {workingSetSize: megabytes(1700)}},
    {pid: 4, type: 'Browser', memory: {workingSetSize: megabytes(3000)}},
  ];
  assert.deepEqual(selectOverLimitRenderer(metrics, limit), {pid: 2, bytes: megabytes(2000) * 1024});
});

test('healthy or malformed metrics never trigger a reload', () => {
  assert.equal(selectOverLimitRenderer([{pid: 1, type: 'Tab', memory: {workingSetSize: megabytes(800)}}], limit), undefined);
  assert.equal(selectOverLimitRenderer([], limit), undefined);
  assert.equal(selectOverLimitRenderer(undefined, limit), undefined);
  assert.equal(selectOverLimitRenderer([{pid: 1, type: 'Tab', memory: {workingSetSize: 'big'}}], limit), undefined);
  assert.equal(selectOverLimitRenderer([{pid: 1, type: 'Tab', memory: {workingSetSize: -1}}], limit), undefined);
  assert.equal(DEFAULT_MEMORY_LIMIT_BYTES, 1.5 * 1024 ** 3);
});

test('reloads once, honours the cooldown and never reloads while work is running', () => {
  let reloads = 0, busy = false, now = 1_000;
  const contents = {isDestroyed: () => false, reload: () => {reloads++;}};
  const watchdog = createMemoryWatchdog({
    getMetrics: () => [{pid: 9, type: 'Tab', memory: {workingSetSize: megabytes(2_000)}}],
    resolveTarget: pid => pid === 9 ? contents : undefined,
    isBusy: () => busy, now: () => now, cooldownMs: 1_000,
    intervalMs: 60_000, setInterval: () => 0, clearInterval: () => {},
  });
  assert.deepEqual(watchdog.tick(), {pid: 9, bytes: megabytes(2_000) * 1024});
  assert.equal(reloads, 1);
  assert.equal(watchdog.tick(), undefined, 'the cooldown prevents a reload loop');
  now += 1_001;
  busy = true;
  assert.equal(watchdog.tick(), undefined, 'an active task suppresses reclamation');
  assert.equal(reloads, 1);
  busy = false;
  assert.equal(watchdog.tick().pid, 9);
  assert.equal(reloads, 2);
});

test('a pid that is not one of our windows is never reloaded', () => {
  let reloads = 0;
  const watchdog = createMemoryWatchdog({
    getMetrics: () => [{pid: 7, type: 'Tab', memory: {workingSetSize: megabytes(2_000)}}],
    resolveTarget: () => undefined,
    now: () => 1_000, setInterval: () => 0, clearInterval: () => {},
  });
  assert.equal(watchdog.tick(), undefined);
  assert.equal(reloads, 0);
});

test('a destroyed renderer is skipped instead of throwing', () => {
  const watchdog = createMemoryWatchdog({
    getMetrics: () => [{pid: 8, type: 'Tab', memory: {workingSetSize: megabytes(2_000)}}],
    resolveTarget: () => ({isDestroyed: () => true, reload: () => {throw Error('must not reload');}}),
    now: () => 1_000, setInterval: () => 0, clearInterval: () => {},
  });
  assert.equal(watchdog.tick(), undefined);
});
