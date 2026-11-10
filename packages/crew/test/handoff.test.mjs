import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CrewKernel,
  CrewStore,
  CREW_PARENT_AGENT_ID,
  MAX_HANDOFF_FILE_BYTES,
} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));

function open() {
  let clock = 1700000000000;
  const now = () => (clock += 1000);
  const workspaceRoot = join(mkdtempSync(join(root, 'ho-')), 'workspaces');
  const kernel = CrewKernel.open(join(mkdtempSync(join(root, 'ho-')), 'crew.sqlite'), {workspaceRoot, now});
  kernel.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: '编码。', workspacePath: '/w/coder-x'});
  kernel.registerAgent({agentId: 'reviewer-y', displayName: '评审者', driver: 'opencode', instructions: '评审。', workspacePath: '/w/reviewer-y'});
  return kernel;
}

function publishPatch(kernel, content, overrides = {}) {
  const filePath = 'patches/fix-0001.diff';
  const absolutePath = kernel.resolveHandoffPath({actorId: 'coder-x', relativePath: filePath});
  mkdirSync(join(absolutePath, '..'), {recursive: true});
  writeFileSync(absolutePath, content);
  return kernel.publishHandoff({
    actorId: 'coder-x',
    handoffId: 'handoff:patch-0001',
    filePath,
    taskId: 't1',
    rootRequestId: 'root-1',
    ...overrides,
  });
}

test('publish computes size and sha256 from the real bytes and registers the manifest', () => {
  const kernel = open();
  try {
    const content = 'diff --git a/app.ts b/app.ts\n+const answer = 42;\n';
    const record = publishPatch(kernel, content);
    assert.equal(record.handoffId, 'handoff:patch-0001');
    assert.equal(record.filePath, 'patches/fix-0001.diff');
    assert.equal(record.fromAgentId, 'coder-x');
    assert.equal(record.taskId, 't1');
    assert.equal(record.sizeBytes, Buffer.byteLength(content));
    assert.equal(record.sha256, createHash('sha256').update(content).digest('hex'), 'manifest digest comes from the real bytes');
    const fetched = kernel.getHandoff({actorId: 'reviewer-y', handoffId: 'handoff:patch-0001'});
    assert.deepEqual({...fetched}, {...record});
    // 清单 id 可作为消息 attachmentRef / evidenceRef 传递。
    kernel.sendMessage({actorId: 'coder-x', fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '请审查补丁', attachmentRefs: [record.handoffId]});
    const inbox = kernel.receiveMessages('reviewer-y');
    assert.deepEqual([...inbox[0].attachmentRefs], ['handoff:patch-0001']);
  } finally { kernel.close(); }
});

test('duplicate registrations are rejected: same handoff id or same file path', () => {
  const kernel = open();
  try {
    publishPatch(kernel, 'v1');
    assert.throws(
      () => publishPatch(kernel, 'v1'),
      error => error instanceof CrewError && error.code === 'CONFLICT',
      'the same handoff id must not be registered twice',
    );
    assert.throws(
      () => kernel.publishHandoff({actorId: 'coder-x', handoffId: 'handoff:patch-0002', filePath: 'patches/fix-0001.diff'}),
      error => error instanceof CrewError && error.code === 'CONFLICT',
      'the same file path must not be registered twice',
    );
    assert.equal(kernel.getHandoff({actorId: CREW_PARENT_AGENT_ID, handoffId: 'handoff:patch-0002'}), undefined, 'rejected registrations leave no manifest');
  } finally { kernel.close(); }
});

test('receiving verifies the shared file against the manifest before handing out a path', () => {
  const kernel = open();
  try {
    const content = 'patch body v1';
    publishPatch(kernel, content);
    const delivery = kernel.receiveHandoff({actorId: 'reviewer-y', handoffId: 'handoff:patch-0001'});
    assert.equal(delivery.handoff.sha256, createHash('sha256').update(content).digest('hex'));
    assert.equal(readFileSync(delivery.absolutePath, 'utf8'), content);
    // 父也可以接收（例如汇总阶段读附件）。
    const parentDelivery = kernel.receiveHandoff({actorId: CREW_PARENT_AGENT_ID, handoffId: 'handoff:patch-0001'});
    assert.equal(parentDelivery.absolutePath, delivery.absolutePath);
  } finally { kernel.close(); }
});

test('a tampered shared file is rejected with a clear error', () => {
  const kernel = open();
  try {
    publishPatch(kernel, 'patch body v1');
    const sharedPath = kernel.resolveHandoffPath({actorId: 'coder-x', relativePath: 'patches/fix-0001.diff'});
    writeFileSync(sharedPath, 'patch body TAMPERED');
    assert.throws(
      () => kernel.receiveHandoff({actorId: 'reviewer-y', handoffId: 'handoff:patch-0001'}),
      error => error instanceof CrewError && error.code === 'HANDOFF_REJECTED' && /sha256 mismatch/.test(error.message),
    );
    writeFileSync(sharedPath, 'patch body v1 plus appended noise');
    assert.throws(
      () => kernel.receiveHandoff({actorId: 'reviewer-y', handoffId: 'handoff:patch-0001'}),
      error => error instanceof CrewError && error.code === 'HANDOFF_REJECTED' && /bytes/.test(error.message),
      'a size change alone must also be rejected',
    );
  } finally { kernel.close(); }
});

test('a shared file that went missing after registration is rejected', () => {
  const kernel = open();
  try {
    publishPatch(kernel, 'patch body v1');
    const sharedPath = kernel.resolveHandoffPath({actorId: 'coder-x', relativePath: 'patches/fix-0001.diff'});
    renameSync(sharedPath, `${sharedPath}.moved`);
    assert.throws(
      () => kernel.receiveHandoff({actorId: 'reviewer-y', handoffId: 'handoff:patch-0001'}),
      error => error instanceof CrewError && error.code === 'HANDOFF_REJECTED' && /missing/.test(error.message),
    );
    assert.throws(
      () => kernel.receiveHandoff({actorId: 'reviewer-y', handoffId: 'handoff:missing'}),
      error => error instanceof CrewError && error.code === 'NOT_FOUND',
    );
  } finally { kernel.close(); }
});

test('publish input rules: file must exist, be a regular file, stay inside the shared directory', () => {
  const kernel = open();
  try {
    assert.throws(
      () => kernel.publishHandoff({actorId: 'coder-x', handoffId: 'handoff:ghost', filePath: 'patches/never-written.diff'}),
      error => error instanceof CrewError && error.code === 'INVALID_INPUT' && /does not exist/.test(error.message),
    );
    const dirPath = kernel.resolveHandoffPath({actorId: 'coder-x', relativePath: 'patches'});
    mkdirSync(dirPath, {recursive: true});
    assert.throws(
      () => kernel.publishHandoff({actorId: 'coder-x', handoffId: 'handoff:dir', filePath: 'patches'}),
      error => error instanceof CrewError && error.code === 'INVALID_INPUT' && /regular file/.test(error.message),
    );
    for (const filePath of ['../outside.txt', '/etc/passwd', 'sub/../../x', 'a\0b']) {
      assert.throws(
        () => kernel.publishHandoff({actorId: 'coder-x', handoffId: 'handoff:escape', filePath}),
        error => error instanceof CrewError && error.code === 'INVALID_INPUT',
        `filePath ${JSON.stringify(filePath)} must be rejected`,
      );
    }
    assert.throws(
      () => kernel.publishHandoff({actorId: CREW_PARENT_AGENT_ID, handoffId: 'handoff:parent', filePath: 'x.txt'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
      'the parent does not publish handoffs',
    );
    assert.throws(
      () => kernel.publishHandoff({actorId: 'ghost', handoffId: 'handoff:ghost', filePath: 'x.txt'}),
      error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT',
    );
  } finally { kernel.close(); }
});

test('the store rejects malformed registrations before any write', () => {
  const store = CrewStore.open(join(mkdtempSync(join(root, 'ho-')), 'crew.sqlite'), {now: () => 1700000000000});
  try {
    store.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: 'x', workspacePath: '/w'});
    const valid = {handoffId: 'handoff:1', filePath: 'a.txt', sizeBytes: 3, sha256: createHash('sha256').update('abc').digest('hex'), fromAgentId: 'coder-x'};
    assert.equal(store.registerHandoff(valid).handoffId, 'handoff:1');
    assert.throws(() => store.registerHandoff({...valid, handoffId: 'handoff:2', sha256: 'ABCDEF'}), /sha256/);
    assert.throws(() => store.registerHandoff({...valid, handoffId: 'handoff:3', sizeBytes: -1}), /sizeBytes/);
    assert.throws(() => store.registerHandoff({...valid, handoffId: 'handoff:4', fromAgentId: 'ghost'}), error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT');
  } finally { store.close(); }
});

test('MAX_HANDOFF_FILE_BYTES follows the 100MB design limit', () => {
  assert.equal(MAX_HANDOFF_FILE_BYTES, 100 * 1024 * 1024);
});
