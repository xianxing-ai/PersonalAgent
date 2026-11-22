import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyToolSurface,
  isToolAllowedOnSurface,
  projectBuiltinWorkers,
  resolveBuiltinWorker,
  FRONT_DESK_TOOL_NAMES,
  ASSISTANT_CHAT_TOOL_NAMES,
  DEFAULT_WORKERS,
} from '../dist/front-desk-worker.js';

test('front desk allows weather and worker dispatch only', () => {
  assert.equal(classifyToolSurface({hasAssistantTurn: false, hasSubtaskParent: false}), 'front_desk');
  assert.equal(isToolAllowedOnSurface('front_desk', 'weather.forecast'), true);
  assert.equal(isToolAllowedOnSurface('front_desk', 'subagent.dispatch'), true);
  assert.equal(isToolAllowedOnSurface('front_desk', 'workspace.apply_text_patch'), false);
  assert.ok(FRONT_DESK_TOOL_NAMES.has('assistant.message'));
});

test('assistant chat is peer messaging only', () => {
  assert.equal(classifyToolSurface({hasAssistantTurn: true, hasSubtaskParent: false}), 'assistant_chat');
  assert.equal(isToolAllowedOnSurface('assistant_chat', 'assistant.message'), true);
  assert.equal(isToolAllowedOnSurface('assistant_chat', 'subagent.dispatch'), false);
  assert.ok([...ASSISTANT_CHAT_TOOL_NAMES].every(name => typeof name === 'string'));
});

test('worker surface keeps full tool freedom at policy layer', () => {
  assert.equal(classifyToolSurface({hasAssistantTurn: false, hasSubtaskParent: true}), 'worker');
  assert.equal(isToolAllowedOnSurface('worker', 'workspace.apply_text_patch'), true);
});

test('resolveBuiltinWorker reuses fixed workers before asking the user', () => {
  assert.equal(resolveBuiltinWorker({role: 'coder'}).action, 'reuse');
  assert.equal(resolveBuiltinWorker({workerId: 'worker-coder'}).worker?.role, 'coder');
  assert.equal(resolveBuiltinWorker({role: 'unknown'}).action, 'missing');
  assert.equal(resolveBuiltinWorker({}).action, 'needs_user');
});

test('projectBuiltinWorkers is a read-only frontend projection', () => {
  const overlay = new Map([['worker-coder', {status: 'working', activeTaskId: 'task-1'}]]);
  const workers = projectBuiltinWorkers(overlay);
  assert.equal(workers.length, DEFAULT_WORKERS.length);
  const coder = workers.find(item => item.workerId === 'worker-coder');
  assert.equal(coder.status, 'working');
  assert.equal(coder.activeTaskId, 'task-1');
  assert.equal(coder.preferredDriver, 'codex');
});
