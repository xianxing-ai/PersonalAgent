import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  WORKSPACE_PATCH_SCOPE_SCOPE,
  WORKSPACE_PATCH_SCOPE_TOOL_NAME,
  WORKSPACE_PATCH_SCOPE_TOOL_VERSION,
  codingVerificationArtifactDigest,
  createWorkspacePatchScopeTool,
} from '../dist/index.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const context = (overrides = {}) => ({
  taskId: 'task-synthetic',
  runId: 'run-synthetic',
  authorizationRef: 'authorization-synthetic',
  scopes: [WORKSPACE_PATCH_SCOPE_SCOPE],
  signal: new AbortController().signal,
  deadline: new Date(Date.now() + 60_000).toISOString(),
  ...overrides,
});
const scopeDigest = fields => createHash('sha256').update(JSON.stringify({
  version: 1,
  kind: 'workspace-patch-scope',
  path: fields.path,
  expectedSha256: fields.expectedSha256,
  observedSha256: fields.observedSha256,
  afterSha256: fields.afterSha256,
  verificationStatus: fields.verificationStatus,
  behaviorReviewed: false,
})).digest('hex');

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-patch-scope-'));
  const root = join(base, 'workspace');
  await mkdir(join(root, 'src'), {recursive: true});
  const file = join(root, 'src', 'note.txt');
  const body = 'SECRET_BODY before\n';
  await writeFile(file, body);
  t.after(() => rm(base, {recursive: true, force: true}));
  return {root, file, body};
}

test('authorized exact preview reports scope readiness without writing or reviewing behavior', async t => {
  const {root, file, body} = await fixture(t);
  const paths = ['src/note.txt'];
  const tool = createWorkspacePatchScopeTool({rootPath: root, allowedPaths: paths});
  paths.push('src/other.txt');
  assert.equal(tool.descriptor.name, WORKSPACE_PATCH_SCOPE_TOOL_NAME);
  assert.equal(tool.descriptor.version, WORKSPACE_PATCH_SCOPE_TOOL_VERSION);
  assert.equal(tool.descriptor.sideEffect, 'read');
  assert.deepEqual(tool.descriptor.requiredScopes, [WORKSPACE_PATCH_SCOPE_SCOPE]);
  const result = await tool.execute({
    path: 'src/note.txt', expectedSha256: hash(body), edits: [{oldText: 'before', newText: 'after'}],
  }, context());
  assert.equal(result.verificationStatus, 'matched');
  assert.equal(result.scopeReady, true);
  assert.equal(result.behaviorReviewed, false);
  assert.equal(result.userChangesPreserved, true);
  assert.equal(result.withinAuthorizedScope, true);
  assert.equal(result.changed, true);
  assert.equal(result.afterSha256, hash('SECRET_BODY after\n'));
  assert.equal(result.artifactDigest, scopeDigest(result));
  assert.equal(JSON.stringify(result).includes('SECRET_BODY'), false);
  assert.equal(await readFile(file, 'utf8'), body);
  await assert.rejects(tool.execute({
    path: 'src/other.txt', expectedSha256: hash(body), edits: [{oldText: 'before', newText: 'after'}],
  }, context()), {code: 'SCOPE_DENIED'});
});

test('a changed user file is a conflict and stays unchanged', async t => {
  const {root, file, body} = await fixture(t);
  const tool = createWorkspacePatchScopeTool({rootPath: root, allowedPaths: ['src/note.txt']});
  const edited = 'SECRET_BODY user edit\n';
  await writeFile(file, edited);
  const result = await tool.execute({
    path: 'src/note.txt', expectedSha256: hash(body), edits: [{oldText: 'before', newText: 'after'}],
  }, context());
  assert.equal(result.verificationStatus, 'conflict');
  assert.equal(result.scopeReady, false);
  assert.equal(result.behaviorReviewed, false);
  assert.equal(result.userChangesPreserved, true);
  assert.equal(result.observedSha256, hash(edited));
  assert.equal(result.afterSha256, null);
  assert.equal(result.artifactDigest, scopeDigest(result));
  assert.equal(JSON.stringify(result).includes('SECRET_BODY'), false);
  assert.equal(await readFile(file, 'utf8'), edited);
});

test('scope allowlist rejects sensitive paths and does not read outside the authorized file', async t => {
  const {root, file, body} = await fixture(t);
  assert.throws(() => createWorkspacePatchScopeTool({rootPath: root, allowedPaths: ['.env']}), {code: 'INVALID_ARGUMENT'});
  const tool = createWorkspacePatchScopeTool({rootPath: root, allowedPaths: ['src/note.txt']});
  await assert.rejects(tool.execute({
    path: '../sibling.txt', expectedSha256: hash(body), edits: [{oldText: 'before', newText: 'after'}],
  }, context()), {code: 'SCOPE_DENIED'});
  await assert.rejects(tool.execute({
    path: 'src/note.txt', expectedSha256: hash(body), edits: [{oldText: 'before', newText: 'after'}],
  }, context({scopes: []})), {code: 'SCOPE_DENIED'});
  assert.equal(await readFile(file, 'utf8'), body);
});

test('verification artifact digest ignores diagnostic text and file bodies', () => {
  const files = [{path: 'src/note.txt', sha256: 'a'.repeat(64), content: 'SECRET_BODY'}];
  const first = codingVerificationArtifactDigest({
    sessionId: 'session', runId: 'run', recipeId: 'node-test', packageIds: ['root'],
    inputSnapshotId: 'snapshot', files, exitCode: 1,
  });
  const second = codingVerificationArtifactDigest({
    sessionId: 'session', runId: 'run', recipeId: 'node-test', packageIds: ['root'],
    inputSnapshotId: 'snapshot', files: [{...files[0], content: 'other body'}], exitCode: 1,
  });
  assert.equal(first, second);
  assert.notEqual(first, codingVerificationArtifactDigest({
    sessionId: 'session', runId: 'run', recipeId: 'node-test', packageIds: ['root'],
    inputSnapshotId: 'snapshot', files, exitCode: 0,
  }));
  assert.equal(first.includes('SECRET'), false);
});
