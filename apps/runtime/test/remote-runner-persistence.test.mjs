import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {handleRunnerFileJob, handleRunnerJob, loadRunnerState, signJob} from '../../../scripts/remote-runner/remote-runner-service.mjs';

const token = 'explicit-fixture-runner-token';
const signed = overrides => {
  const job = {v: 1, id: 'job-1', idempotencyKey: 'original-operation', kind: 'async-subagent', payload: {goal: 'write once'}, ...overrides};
  return {...job, signature: signJob(job, token)};
};

test('the file host persists the original operation before execution and serializes independent hosts', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-persistence-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const file = join(directory, 'state.json');
  let executions = 0;
  let release;
  let entered;
  const started = new Promise(resolve => {entered = resolve;});
  const options = {token, modelCommand: {command: ['fixture-agent'], timeoutMs: 1000}, spawnImpl: async () => {
    executions += 1;
    assert.equal(loadRunnerState(file).jobs['original-operation'].state, 'unknown');
    entered();
    await new Promise(resolve => {release = resolve;});
    return {code: 0, stdout: 'done'};
  }};
  const first = handleRunnerFileJob(file, signed(), options);
  await started;
  assert.equal((await handleRunnerFileJob(file, signed(), options)).state, 'unknown');
  assert.equal((await handleRunnerFileJob(file, signed({id: 'new-id'}), options)).state, 'unknown');
  assert.equal((await handleRunnerFileJob(file, signed({payload: {goal: 'replace'}}), options)).state, 'rejected');
  assert.equal((await handleRunnerFileJob(file, signed({kind: 'cancel'}), options)).state, 'unknown');
  // Loading the durable checkpoint cannot turn an unfinished operation into a new execution.
  assert.equal((await handleRunnerJob(loadRunnerState(file), signed(), options)).state, 'unknown');
  release();
  assert.equal((await first).state, 'succeeded');
  assert.equal((await handleRunnerFileJob(file, signed(), options)).state, 'succeeded');
  assert.equal(executions, 1);
});

test('a crashed writer lock and corrupt state fail closed instead of resetting operation history', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-corruption-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const file = join(directory, 'state.json');
  writeFileSync(`${file}.lock`, '');
  const result = await handleRunnerFileJob(file, signed(), {token, spawnImpl: () => {throw new Error('must not execute');}});
  assert.equal(result.state, 'rejected');
  assert.equal(result.redo, false);
  writeFileSync(file, '{broken');
  assert.throws(() => loadRunnerState(file));
});

test('expired admission does not execute and command timeout remains unknown', async () => {
  const state = {version: 1, jobs: {}, cursors: {}, comments: {}, recent: []};
  let executions = 0;
  const options = {token, modelCommand: {command: ['fixture-agent'], timeoutMs: 1000}, spawnImpl: async () => {
    executions += 1; return {code: null, timedOut: true, stdout: ''};
  }};
  assert.equal((await handleRunnerJob(state, signed({deadline: '2000-01-01T00:00:00Z'}), options)).state, 'rejected');
  assert.equal(executions, 0);
  assert.equal((await handleRunnerJob(state, signed(), options)).state, 'unknown');
  assert.equal((await handleRunnerJob(state, signed(), options)).state, 'unknown');
  assert.equal(executions, 1);
});
