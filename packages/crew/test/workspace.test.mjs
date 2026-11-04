import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CrewKernel,
  CREW_PARENT_AGENT_ID,
} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));

function openWorkspace(options = {}) {
  let clock = 1700000000000;
  const now = () => (clock += 1000);
  const workspaceRoot = join(mkdtempSync(join(root, 'ws-')), 'workspaces');
  const kernel = CrewKernel.open(join(mkdtempSync(join(root, 'ws-')), 'crew.sqlite'), {
    ...options,
    workspaceRoot: options.workspaceRoot ?? workspaceRoot,
    now: options.now ?? now,
  });
  return {kernel, workspaceRoot};
}

function openPlain() {
  let clock = 1700000000000;
  const now = () => (clock += 1000);
  return CrewKernel.open(join(mkdtempSync(join(root, 'ws-')), 'crew.sqlite'), {now});
}

function crew(kernel) {
  kernel.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: '编码。', workspacePath: '/workspace/crew/coder-x'});
  kernel.registerAgent({agentId: 'reviewer-y', displayName: '评审者', driver: 'opencode', instructions: '评审。', workspacePath: '/workspace/crew/reviewer-y'});
}

test('without a workspaceRoot the workspace and handoff surfaces stay unavailable', () => {
  const kernel = openPlain();
  try {
    crew(kernel);
    const unavailable = [
      () => kernel.ensureAgentWorkspace({actorId: CREW_PARENT_AGENT_ID, agentId: 'coder-x'}),
      () => kernel.resolveAgentPath({actorId: 'coder-x', agentId: 'coder-x', relativePath: 'a.txt'}),
      () => kernel.resolveHandoffPath({actorId: 'coder-x', relativePath: 'a.txt'}),
      () => kernel.publishHandoff({actorId: 'coder-x', handoffId: 'handoff:1', filePath: 'a.txt'}),
      () => kernel.receiveHandoff({actorId: 'reviewer-y', handoffId: 'handoff:1'}),
      () => kernel.getHandoff({actorId: CREW_PARENT_AGENT_ID, handoffId: 'handoff:1'}),
    ];
    for (const call of unavailable) {
      assert.throws(call, error => error instanceof CrewError && error.code === 'UNSUPPORTED');
    }
    // 工作区未配置时内核其余行为不受影响。
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '普通任务'});
    assert.equal(kernel.claimNextTask('coder-x').taskId, 't1');
  } finally { kernel.close(); }
});

test('registering an agent materializes its own isolated workspace directory', () => {
  const {kernel, workspaceRoot} = openWorkspace();
  try {
    const coder = kernel.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: '编码。', workspacePath: '/workspace/crew/coder-x'});
    const reviewer = kernel.registerAgent({agentId: 'reviewer-y', displayName: '评审者', driver: 'opencode', instructions: '评审。', workspacePath: '/workspace/crew/reviewer-y'});
    const coderDir = kernel.ensureAgentWorkspace({actorId: CREW_PARENT_AGENT_ID, agentId: coder.agentId}).absolutePath;
    const reviewerDir = kernel.ensureAgentWorkspace({actorId: reviewer.agentId, agentId: reviewer.agentId}).absolutePath;
    assert.equal(coderDir, join(workspaceRoot, 'agents', 'coder-x'));
    assert.equal(reviewerDir, join(workspaceRoot, 'agents', 'reviewer-y'));
    assert.notEqual(coderDir, reviewerDir, 'each agent gets its own workspace directory');
    for (const dir of [coderDir, reviewerDir]) {
      assert.equal(existsSync(dir), true, 'registration creates the workspace directory');
      assert.equal(statSync(dir).isDirectory(), true);
    }
    // 幂等：重复创建返回同一目录。
    assert.equal(kernel.ensureAgentWorkspace({actorId: CREW_PARENT_AGENT_ID, agentId: 'coder-x'}).absolutePath, coderDir);
  } finally { kernel.close(); }
});

test('agent ids that cannot map to a workspace directory are rejected at registration', () => {
  const kernel = openPlain();
  try {
    const bad = ['a/b', 'a\\b', '../escape', '..', 'CON', 'trailing.', 'colon:disk', 'x\0y'];
    for (const agentId of bad) {
      assert.throws(
        () => kernel.registerAgent({agentId, displayName: 'x', driver: 'codex', instructions: 'x', workspacePath: '/w'}),
        error => error instanceof CrewError && error.code === 'INVALID_INPUT',
        `agentId ${JSON.stringify(agentId)} must be rejected`,
      );
    }
    assert.deepEqual(kernel.listAgents(CREW_PARENT_AGENT_ID), [], 'rejected registrations must not create agents');
  } finally { kernel.close(); }
});

test('children resolve paths only inside their own workspace; traversal and escapes are rejected', () => {
  const {kernel} = openWorkspace();
  try {
    crew(kernel);
    const own = kernel.resolveAgentPath({actorId: 'coder-x', agentId: 'coder-x', relativePath: 'sub/patch.diff'});
    assert.ok(own.startsWith(join(root, 'ws-')), 'resolved path stays inside the workspace root');
    assert.ok(own.endsWith(join('sub', 'patch.diff')));
    assert.throws(
      () => kernel.resolveAgentPath({actorId: 'coder-x', agentId: 'reviewer-y', relativePath: 'steal.txt'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
      'a child may not resolve another agent workspace',
    );
    const parentResolved = kernel.resolveAgentPath({actorId: CREW_PARENT_AGENT_ID, agentId: 'reviewer-y', relativePath: 'report.md'});
    assert.ok(parentResolved.includes(join('agents', 'reviewer-y')), 'the parent may resolve any registered workspace');
    const escapes = [
      '/etc/passwd',
      '\\\\server\\share\\x',
      'C:\\temp\\x',
      '..',
      '../outside',
      'sub/../../outside',
      './hidden',
      'sub//double',
      'sub/./x',
      'trailing./x',
      'CON/keyboard',
      'a\0b',
    ];
    for (const relativePath of escapes) {
      assert.throws(
        () => kernel.resolveAgentPath({actorId: 'coder-x', agentId: 'coder-x', relativePath}),
        error => error instanceof CrewError && error.code === 'INVALID_INPUT',
        `relativePath ${JSON.stringify(relativePath)} must be rejected`,
      );
    }
    assert.throws(
      () => kernel.resolveAgentPath({actorId: CREW_PARENT_AGENT_ID, agentId: 'ghost', relativePath: 'x'}),
      error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT',
    );
    assert.throws(
      () => kernel.ensureAgentWorkspace({actorId: 'coder-x', agentId: 'ghost'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
  } finally { kernel.close(); }
});
