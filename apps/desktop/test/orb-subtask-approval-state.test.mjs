import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {orbStatusLabel, visualOrbState} from '../src/features/conversation/state.js';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const FUTURE = new Date(NOW + 60_000).toISOString();
const PAST = new Date(NOW - 60_000).toISOString();

test('orb switches to waiting / 等待授权 when parent task runs and a child task awaits approval (#669 / L-06)', () => {
  const base = {tasks: [{taskId: 'parent-1', state: 'running'}]};
  assert.equal(visualOrbState(base, NOW), 'executing');
  assert.equal(orbStatusLabel(base, NOW), '执行中');

  const childWaiting = {
    ...base,
    subagentTasks: [{taskId: 'child-1', parentTaskId: 'parent-1', state: 'waiting_approval'}],
  };
  assert.equal(visualOrbState(childWaiting, NOW), 'waiting');
  assert.equal(orbStatusLabel(childWaiting, NOW), '等待授权');

  const questionWaiting = {
    ...base,
    conversationState: {activeId: 'desktop-panel'},
    authorizationQuestions: [{questionId: 'q-1', taskId: 'child-2', conversationId: 'desktop-panel', state: 'pending', expiresAt: FUTURE}],
  };
  assert.equal(visualOrbState(questionWaiting, NOW), 'waiting');
  assert.equal(orbStatusLabel(questionWaiting, NOW), '等待授权');

  const approvalWaiting = {
    ...base,
    subagentTasks: [{taskId: 'child-3', parentTaskId: 'parent-1', state: 'running'}],
    approvals: [{approvalId: 'a-1', taskId: 'child-3', state: 'pending', expiresAt: FUTURE}],
  };
  assert.equal(visualOrbState(approvalWaiting, NOW), 'waiting');
  assert.equal(orbStatusLabel(approvalWaiting, NOW), '等待授权');

  const hostFlagWaiting = {...base, hasPendingApproval: true};
  assert.equal(visualOrbState(hostFlagWaiting, NOW), 'waiting');
  assert.equal(orbStatusLabel(hostFlagWaiting, NOW), '等待授权');
});

test('orb does not falsely report waiting for expired approvals, unrelated children, or terminal parent tasks', () => {
  const expired = {
    tasks: [{taskId: 'parent-1', state: 'running'}],
    approvals: [{approvalId: 'a-old', taskId: 'parent-1', state: 'pending', expiresAt: PAST}],
    authorizationQuestions: [{questionId: 'q-old', taskId: 'parent-1', state: 'pending', expiresAt: PAST}],
  };
  assert.equal(visualOrbState(expired, NOW), 'executing');
  assert.equal(orbStatusLabel(expired, NOW), '执行中');

  const unrelatedChild = {
    tasks: [{taskId: 'parent-1', state: 'running'}],
    subagentTasks: [{taskId: 'other-child', parentTaskId: 'other-parent', state: 'waiting_approval'}],
  };
  assert.equal(visualOrbState(unrelatedChild, NOW), 'executing');
  assert.equal(orbStatusLabel(unrelatedChild, NOW), '执行中');

  const terminalParent = {
    tasks: [{taskId: 'parent-1', state: 'succeeded'}],
    hasPendingApproval: true,
    subagentTasks: [{taskId: 'child-1', parentTaskId: 'parent-1', state: 'waiting_approval'}],
  };
  assert.equal(visualOrbState(terminalParent, NOW), 'idle');
  assert.equal(orbStatusLabel(terminalParent, NOW), '已完成');

  const manualOverride = {
    tasks: [{taskId: 'parent-1', state: 'running'}],
    hasPendingApproval: true,
    orbStateOverride: 'thinking',
  };
  assert.equal(visualOrbState(manualOverride, NOW), 'thinking');
});

test('main.js orbSnapshot projects active child task states and pending approval flag to the orb window', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /function orbSnapshot\(\)[\s\S]*?readSubagentTasks\?\.\(task\.taskId\)[\s\S]*?hasPendingApproval/);
});
