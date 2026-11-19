import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  ArtifactService,
  createArtifactService,
  planWindowsRecoveryArtifact,
  assertRecoveryArtifactBinding,
  assembleArtifactServiceTools,
  ARTIFACT_READ_TOOL_NAME,
  ARTIFACT_EXPIRE_TOOL_NAME,
  ARTIFACT_RELEASE_TOOL_NAME,
  ARTIFACT_GET_TOOL_NAME,
  ARTIFACT_LIST_TOOL_NAME,
  ARTIFACT_CREATE_TOOL_NAME,
} from '../dist/index.js';

const sha = text => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

async function createTempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pa-artifact-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}

test('ArtifactService: create, get, read, list, expire, and release (in-memory mode)', async () => {
  const service = createArtifactService();
  const content = 'diff --git a/file.ts b/file.ts\n+console.log("hello");';
  const expectedSha = sha(content);

  // 1. Create
  const created = await service.create({
    kind: 'workspace-patch',
    content,
    sessionId: 'session-123',
    runId: 'run-456',
    metadata: {author: 'test-agent'},
  });

  assert.ok(created.artifactId);
  assert.equal(created.kind, 'workspace-patch');
  assert.equal(created.sha256, expectedSha);
  assert.equal(created.byteLength, Buffer.byteLength(content, 'utf8'));
  assert.equal(created.status, 'active');
  assert.equal(created.sessionId, 'session-123');
  assert.equal(created.runId, 'run-456');
  assert.equal(created.metadata?.author, 'test-agent');

  // 2. Get
  const fetched = await service.get(created.artifactId);
  assert.deepEqual(fetched, created);

  // 3. Read
  const readResult = await service.read(created.artifactId);
  assert.deepEqual(readResult.record, created);
  assert.equal(readResult.content.toString('utf8'), content);

  // 4. List
  const listAll = await service.list();
  assert.equal(listAll.length, 1);
  assert.equal(listAll[0].artifactId, created.artifactId);

  const listByKind = await service.list({kind: 'workspace-patch'});
  assert.equal(listByKind.length, 1);

  const listByOtherKind = await service.list({kind: 'command-run'});
  assert.equal(listByOtherKind.length, 0);

  const listBySession = await service.list({sessionId: 'session-123'});
  assert.equal(listBySession.length, 1);

  // 5. Expire
  const expired = await service.expire(created.artifactId);
  assert.equal(expired.status, 'expired');

  // Reading expired artifact must fail
  await assert.rejects(
    async () => service.read(created.artifactId),
    error => error.code === 'PRECONDITION_FAILED' && error.message.includes('has expired'),
  );

  // List excludes expired by default
  const listActive = await service.list();
  assert.equal(listActive.length, 0);

  const listIncludeExpired = await service.list({includeExpired: true});
  assert.equal(listIncludeExpired.length, 1);

  // 6. Release
  const releaseFirst = await service.release(created.artifactId);
  assert.equal(releaseFirst.released, true);
  assert.equal(releaseFirst.alreadyReleased, false);

  const releasedRecord = await service.get(created.artifactId);
  assert.equal(releasedRecord.status, 'released');

  // Repeated release is idempotent
  const releaseSecond = await service.release(created.artifactId);
  assert.equal(releaseSecond.released, false);
  assert.equal(releaseSecond.alreadyReleased, true);

  // Reading released artifact must fail
  await assert.rejects(
    async () => service.read(created.artifactId),
    error => error.code === 'PRECONDITION_FAILED' && error.message.includes('has been released'),
  );
});

test('ArtifactService: disk-backed persistence in artifactsRoot', async t => {
  const artifactsRoot = await createTempDir(t);
  const service = new ArtifactService({artifactsRoot});

  const content = 'Verification output: 0 errors found';
  const relativePath = 'checks/run-1.log';

  const created = await service.create({
    kind: 'coding-repair-verification',
    content,
    relativePath,
    persist: true,
  });

  assert.equal(created.relativePath, relativePath);
  const fullDiskPath = join(artifactsRoot, 'checks', 'run-1.log');
  assert.ok(existsSync(fullDiskPath), 'File should be persisted on disk');

  const onDiskContent = await readFile(fullDiskPath, 'utf8');
  assert.equal(onDiskContent, content);

  // Read back via service
  const readBack = await service.read(created.artifactId);
  assert.equal(readBack.content.toString('utf8'), content);

  // Release purges file from disk
  const releaseResult = await service.release(created.artifactId);
  assert.equal(releaseResult.released, true);
  assert.equal(existsSync(fullDiskPath), false, 'Persisted file should be deleted upon release');
});

test('ArtifactService: path escape and sensitive path rejection', async t => {
  const artifactsRoot = await createTempDir(t);
  const service = new ArtifactService({artifactsRoot});

  // Path escape with '..'
  await assert.rejects(
    async () => service.create({
      kind: 'workspace-patch',
      content: 'malicious',
      relativePath: '../escaped.txt',
    }),
    error => error.code === 'INVALID_ARGUMENT',
  );

  // Absolute path
  await assert.rejects(
    async () => service.create({
      kind: 'workspace-patch',
      content: 'malicious',
      relativePath: '/etc/passwd',
    }),
    error => error.code === 'INVALID_ARGUMENT',
  );

  // Sensitive paths: .env, .git, id_rsa, credentials.json
  const sensitiveCandidates = [
    '.env',
    '.env.production',
    '.git/config',
    'id_rsa',
    'credentials.json',
    'secrets/key.pem',
  ];

  for (const path of sensitiveCandidates) {
    await assert.rejects(
      async () => service.create({
        kind: 'workspace-patch',
        content: 'secret',
        relativePath: path,
      }),
      error => error.code === 'SCOPE_DENIED' || error.code === 'INVALID_ARGUMENT',
      `Path '${path}' should be rejected as sensitive or invalid`,
    );
  }
});

test('ArtifactService: clock injection and automated expiration', async () => {
  let currentTime = 1000;
  const now = () => currentTime;

  const service = new ArtifactService({now, defaultTtlMs: 5000});

  const created = await service.create({
    kind: 'command-run',
    content: 'command output',
  });

  assert.equal(created.createdAt, new Date(1000).toISOString());
  assert.equal(created.expiresAt, new Date(6000).toISOString());
  assert.equal(created.status, 'active');

  // Still active at t=4000
  currentTime = 4000;
  const recordBeforeExpiry = await service.get(created.artifactId);
  assert.equal(recordBeforeExpiry.status, 'active');
  const readBeforeExpiry = await service.read(created.artifactId);
  assert.ok(readBeforeExpiry.content);

  // Expired at t=6001
  currentTime = 6001;
  const recordAfterExpiry = await service.get(created.artifactId);
  assert.equal(recordAfterExpiry.status, 'expired');

  await assert.rejects(
    async () => service.read(created.artifactId),
    error => error.code === 'PRECONDITION_FAILED',
  );

  const activeList = await service.list();
  assert.equal(activeList.length, 0);

  const allList = await service.list({includeExpired: true});
  assert.equal(allList.length, 1);
  assert.equal(allList[0].status, 'expired');
});

test('ArtifactService: release non-existent artifact throws NOT_FOUND', async () => {
  const service = new ArtifactService();
  await assert.rejects(
    async () => service.release('00000000-0000-0000-0000-000000000000'),
    error => error.code === 'NOT_FOUND',
  );
});

test('ArtifactService: digest verification rejects mismatched sha256', async () => {
  const service = new ArtifactService();
  const content = 'valid content';
  const wrongSha = '0000000000000000000000000000000000000000000000000000000000000000';

  await assert.rejects(
    async () => service.create({
      kind: 'command-run',
      content,
      sha256: wrongSha,
    }),
    error => error.code === 'INVALID_ARGUMENT' && error.message.includes('does not match'),
  );
});

test('planWindowsRecoveryArtifact & assertRecoveryArtifactBinding: strictly available=false on Linux', async () => {
  const input = {
    rootPath: '/home/user/repo',
    recoveryRootPath: '/home/user/recovery',
    relativePath: 'src/file.ts',
    runId: 'run-recovery-999',
    argumentsDigest: 'a'.repeat(64),
    beforeSha256: 'b'.repeat(64),
    afterSha256: 'c'.repeat(64),
  };

  const plan = planWindowsRecoveryArtifact(input);

  if (process.platform !== 'win32') {
    assert.equal(plan.available, false, 'Must never fake success on non-Windows environment');
    assert.equal(plan.reason, 'unavailable');
    assert.equal(plan.platform, process.platform);
    assert.ok(plan.bindingDigest.length === 64);
    assert.ok(plan.markerFileName.endsWith('.inflight'));
    assert.ok(plan.message.includes('requires Windows'));

    const asserted = assertRecoveryArtifactBinding(input);
    assert.equal(asserted.available, false);
    assert.equal(asserted.reason, 'unavailable');
  } else {
    // If running on Windows without helper
    if (!input.powerShellPath && !input.processIdentityHelperPath) {
      assert.equal(plan.available, false);
      assert.equal(plan.reason, 'unavailable');
    }
  }
});

test('assembleArtifactServiceTools: provides unattached tools without auto-registration', async () => {
  const service = createArtifactService();
  const tools = assembleArtifactServiceTools(service);

  assert.equal(tools.length, 6);
  const names = tools.map(t => t.descriptor.name);
  assert.ok(names.includes(ARTIFACT_GET_TOOL_NAME));
  assert.ok(names.includes(ARTIFACT_LIST_TOOL_NAME));
  assert.ok(names.includes(ARTIFACT_CREATE_TOOL_NAME));
  assert.ok(names.includes(ARTIFACT_READ_TOOL_NAME));
  assert.ok(names.includes(ARTIFACT_EXPIRE_TOOL_NAME));
  assert.ok(names.includes(ARTIFACT_RELEASE_TOOL_NAME));
  assert.equal(tools.every(tool => tool.descriptor.requiredScopes.includes('artifact:manage')), true);

  // Verify create tool works through standard execute interface
  const createTool = tools.find(t => t.descriptor.name === ARTIFACT_CREATE_TOOL_NAME);
  const mockContext = {
    taskId: 'task-1',
    runId: 'run-1',
    argumentsDigest: 'd'.repeat(64),
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
    scopes: ['artifact:manage'],
  };

  const toolCreated = await createTool.execute({
    kind: 'command-run',
    content: 'echo test',
  }, mockContext);

  assert.ok(toolCreated.artifactId);
  assert.equal(toolCreated.kind, 'command-run');

  // Verify get tool works
  const getTool = tools.find(t => t.descriptor.name === ARTIFACT_GET_TOOL_NAME);
  const toolFetched = await getTool.execute({artifactId: toolCreated.artifactId}, mockContext);
  assert.equal(toolFetched.artifactId, toolCreated.artifactId);

  const readTool = tools.find(t => t.descriptor.name === ARTIFACT_READ_TOOL_NAME);
  const loaded = await readTool.execute({artifactId: toolCreated.artifactId}, mockContext);
  assert.equal(loaded.encoding, 'utf8');
  assert.equal(loaded.content, 'echo test');
  await assert.rejects(
    readTool.execute({artifactId: toolCreated.artifactId, extra: true}, mockContext),
    /artifactId must be the only/,
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    readTool.execute({artifactId: toolCreated.artifactId}, {...mockContext, signal: aborted.signal}),
    /cancelled/i,
  );

  const expireTool = tools.find(t => t.descriptor.name === ARTIFACT_EXPIRE_TOOL_NAME);
  const expired = await expireTool.execute({artifactId: toolCreated.artifactId}, mockContext);
  assert.equal(expired.status, 'expired');
  await assert.rejects(readTool.execute({artifactId: toolCreated.artifactId}, mockContext), /expired/i);

  const releaseTool = tools.find(t => t.descriptor.name === ARTIFACT_RELEASE_TOOL_NAME);
  const released = await releaseTool.execute({artifactId: toolCreated.artifactId}, mockContext);
  assert.equal(released.released, true);
  assert.equal(released.alreadyReleased, false);
  const again = await releaseTool.execute({artifactId: toolCreated.artifactId}, mockContext);
  assert.equal(again.alreadyReleased, true);
  assert.equal(again.released, false);
});
