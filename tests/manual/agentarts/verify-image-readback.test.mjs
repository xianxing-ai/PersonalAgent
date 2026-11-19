import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { verifyImageReadback, verifyImageReadbackFiles } from './verify-image-readback.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'image-readback');

const EXPECTED_REPO = 'swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned';
const EXPECTED_DIGEST = 'sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004';
const EXPECTED_REVISION = 'a93734c195ceaff56d3e7a5654e320f3007b35f3';

test('verify-image-readback: rejects missing ping, wrong image and duplicate workflows', async () => {
  const load = async (name) => JSON.parse(await readFile(path.join(fixturesDir, name), 'utf8'));
  const manifestInspect = await load('valid-manifest-inspect.json');
  const imageInspect = await load('valid-image-inspect.json');
  const smoke = await load('valid-smoke-report.json');
  for (const mutate of [
    s => { delete s.pingStatus; },
    s => { s.imageId = `sha256:${'1'.repeat(64)}`; },
    s => { s.observed[1].workflowId = s.observed[0].workflowId; },
  ]) {
    const modified = structuredClone(smoke);
    mutate(modified);
    const result = verifyImageReadback({ manifestInspect, imageInspect, smokeOutput: modified,
      expectedRepository: EXPECTED_REPO, expectedDigest: EXPECTED_DIGEST, expectedRevision: EXPECTED_REVISION });
    assert.equal(result.verified, false);
    assert.equal(result.status, 'failed');
  }
});

test('verify-image-readback: positive case with all fields verified', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'valid-image-inspect.json'),
    smokeOutputPath: path.join(fixturesDir, 'valid-smoke-report.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST,
    expectedRevision: EXPECTED_REVISION
  });

  assert.equal(result.verified, true);
  assert.equal(result.status, 'verified');
  assert.equal(result.platform.manifestArm64Present, true);
  assert.equal(result.platform.inspectOs, 'linux');
  assert.equal(result.platform.inspectArchitecture, 'arm64');
  assert.equal(result.platform.verified, true);
  assert.equal(result.repoDigests.matched, true);
  assert.equal(result.repoDigests.matchedDigest, EXPECTED_DIGEST);
  assert.equal(result.sourceRevision.labelPresent, true);
  assert.equal(result.sourceRevision.revision, EXPECTED_REVISION);
  assert.equal(result.sourceRevision.matched, true);
  assert.equal(result.smoke.provided, true);
  assert.equal(result.smoke.verified, true);
  assert.equal(result.smoke.details?.workflowCount, 28);
  assert.equal(result.smoke.details?.nodeCount, 185);
  assert.equal(result.smoke.details?.architecture, 'arm64');
  assert.equal(result.smoke.details?.user, 1000);
  assert.equal(result.smoke.details?.embeddedLayaPathPresent, false);
  assert.deepEqual(result.failureReasons, []);
  assert.deepEqual(result.unverifiedReasons, []);
});

test('verify-image-readback: amd64 substitute in image inspect rejected', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'amd64-image-inspect.json'),
    smokeOutputPath: path.join(fixturesDir, 'valid-smoke-report.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST
  });

  assert.equal(result.verified, false);
  assert.equal(result.status, 'failed');
  assert.ok(result.failureReasons.some(r => r.includes("rejecting amd64 substitute")));
});

test('verify-image-readback: amd64-only manifest inspect rejected', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'amd64-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'valid-image-inspect.json'),
    smokeOutputPath: path.join(fixturesDir, 'valid-smoke-report.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST
  });

  assert.equal(result.verified, false);
  assert.equal(result.status, 'failed');
  assert.ok(result.failureReasons.some(r => r.includes("lacks required linux/arm64 entry (amd64 substitute rejected)")));
});

test('verify-image-readback: tag / latest reference rejected', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'valid-image-inspect.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: 'latest'
  });

  assert.equal(result.verified, false);
  assert.equal(result.status, 'failed');
  assert.ok(result.failureReasons.some(r => r.includes("tag/latest rejected")));
});

test('verify-image-readback: digest mismatch in RepoDigests rejected', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'digest-mismatch-image-inspect.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST
  });

  assert.equal(result.verified, false);
  assert.equal(result.status, 'failed');
  assert.ok(result.failureReasons.some(r => r.includes("RepoDigests digest mismatch")));
});

test('verify-image-readback: repository mismatch in RepoDigests rejected', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'repo-mismatch-image-inspect.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST
  });

  assert.equal(result.verified, false);
  assert.equal(result.status, 'failed');
  assert.ok(result.failureReasons.some(r => r.includes("RepoDigests repository mismatch")));
});

test('verify-image-readback: missing revision label yields unknown and unverified (no speculation)', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'no-label-image-inspect.json'),
    smokeOutputPath: path.join(fixturesDir, 'valid-smoke-report.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST
    // expectedRevision intentionally omitted
  });

  assert.equal(result.verified, false);
  assert.equal(result.status, 'unverified');
  assert.equal(result.sourceRevision.labelPresent, false);
  assert.equal(result.sourceRevision.revision, 'unknown');
  assert.deepEqual(result.failureReasons, []);
  assert.ok(result.unverifiedReasons.some(r => r.includes("source_revision_unknown: missing org.opencontainers.image.revision label")));
});

test('verify-image-readback: revision mismatch when expectedRevision given causes failure', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'valid-image-inspect.json'),
    smokeOutputPath: path.join(fixturesDir, 'valid-smoke-report.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST,
    expectedRevision: 'db936167e1f6d5cf546d3558a2b3a98cb135a529' // different revision
  });

  assert.equal(result.verified, false);
  assert.equal(result.status, 'failed');
  assert.ok(result.failureReasons.some(r => r.includes("Source revision mismatch")));
});

test('verify-image-readback: missing revision label when expectedRevision given causes failure', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'no-label-image-inspect.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST,
    expectedRevision: EXPECTED_REVISION
  });

  assert.equal(result.verified, false);
  assert.equal(result.status, 'failed');
  assert.ok(result.failureReasons.some(r => r.includes(`Expected revision '${EXPECTED_REVISION}', but org.opencontainers.image.revision label is missing`)));
});

test('verify-image-readback: smoke count mismatch (27 workflows / 180 nodes) rejected', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'valid-image-inspect.json'),
    smokeOutputPath: path.join(fixturesDir, 'invalid-count-smoke-report.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST
  });

  assert.equal(result.verified, false);
  assert.equal(result.status, 'failed');
  assert.ok(result.failureReasons.some(r => r.includes("Smoke workflowCount is 27, expected 28")));
  assert.ok(result.failureReasons.some(r => r.includes("Smoke nodeCount is 180, expected 185")));
});

test('verify-image-readback: smoke embedded laya present rejected', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'valid-image-inspect.json'),
    smokeOutputPath: path.join(fixturesDir, 'laya-present-smoke-report.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST
  });

  assert.equal(result.verified, false);
  assert.equal(result.status, 'failed');
  assert.ok(result.failureReasons.some(r => r.includes("embeddedLayaPathPresent: true, embedded Laya must be false")));
});

test('verify-image-readback: smoke output omitted records unverified', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'valid-image-inspect.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST,
    expectedRevision: EXPECTED_REVISION
  });

  assert.equal(result.verified, false);
  assert.equal(result.status, 'unverified');
  assert.equal(result.smoke.provided, false);
  assert.equal(result.smoke.verified, false);
  assert.deepEqual(result.failureReasons, []);
  assert.ok(result.unverifiedReasons.some(r => r.includes("smoke_output_not_provided")));
});

test('verify-image-readback: outputPath writes JSON file cleanly', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'verify-readback-test-'));
  const outputPath = path.join(tempDir, 'output.json');
  try {
    const result = await verifyImageReadbackFiles({
      manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
      imageInspectPath: path.join(fixturesDir, 'valid-image-inspect.json'),
      smokeOutputPath: path.join(fixturesDir, 'valid-smoke-report.json'),
      expectedRepository: EXPECTED_REPO,
      expectedDigest: EXPECTED_DIGEST,
      expectedRevision: EXPECTED_REVISION,
      outputPath
    });

    assert.equal(result.verified, true);
    const written = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(written.verified, true);
    assert.equal(written.status, 'verified');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('verify-image-readback: CLI invocation with flags', async () => {
  const scriptPath = path.join(__dirname, 'verify-image-readback.mjs');
  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    '--manifest', path.join(fixturesDir, 'valid-manifest-inspect.json'),
    '--image-inspect', path.join(fixturesDir, 'valid-image-inspect.json'),
    '--smoke', path.join(fixturesDir, 'valid-smoke-report.json'),
    '--expected-repo', EXPECTED_REPO,
    '--expected-digest', EXPECTED_DIGEST,
    '--expected-revision', EXPECTED_REVISION
  ]);

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.verified, true);
  assert.equal(parsed.status, 'verified');
  assert.equal(parsed.platform.verified, true);
});

test('verify-image-readback: CLI invocation exit code 1 on failure', async () => {
  const scriptPath = path.join(__dirname, 'verify-image-readback.mjs');
  let err;
  try {
    await execFileAsync(process.execPath, [
      scriptPath,
      '--manifest', path.join(fixturesDir, 'amd64-manifest-inspect.json'),
      '--image-inspect', path.join(fixturesDir, 'valid-image-inspect.json'),
      '--expected-repo', EXPECTED_REPO,
      '--expected-digest', EXPECTED_DIGEST
    ]);
  } catch (error) {
    err = error;
  }

  assert.ok(err, 'Expected CLI to exit with error code 1');
  assert.equal(err.code, 1);
  const parsed = JSON.parse(err.stdout);
  assert.equal(parsed.status, 'failed');
  assert.equal(parsed.verified, false);
});

test('verify-image-readback: CLI invocation with stdin config', async () => {
  const scriptPath = path.join(__dirname, 'verify-image-readback.mjs');
  const stdinPayload = JSON.stringify({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'valid-image-inspect.json'),
    smokeOutputPath: path.join(fixturesDir, 'valid-smoke-report.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST,
    expectedRevision: EXPECTED_REVISION
  });

  const child = execFile(process.execPath, [scriptPath], { windowsHide: true });
  child.stdin.write(stdinPayload);
  child.stdin.end();

  const chunks = [];
  for await (const chunk of child.stdout) {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  }
  const stdout = chunks.join('');
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.verified, true);
  assert.equal(parsed.status, 'verified');
});

test('verify-image-readback: matches historical #459 evidence receipt (unverified due to missing OCI label)', async () => {
  const receiptPath = path.resolve(__dirname, '../../../docs/competition/evidence/ARM64_EXISTING_IMAGE_459_20261021.receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));

  const result = verifyImageReadback({
    manifestInspect: receipt.image.index,
    imageInspect: receipt.image.localInspect,
    smokeOutput: receipt.catalog.receipt,
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST
  });

  assert.equal(result.platform.verified, true);
  assert.equal(result.repoDigests.matched, true);
  assert.equal(result.sourceRevision.revision, 'unknown');
  assert.equal(result.sourceRevision.labelPresent, false);
  assert.equal(result.smoke.verified, true);
  assert.equal(result.smoke.details?.workflowCount, 28);
  assert.equal(result.smoke.details?.nodeCount, 185);
  // Status is unverified because org.opencontainers.image.revision label is absent on target image
  assert.equal(result.status, 'unverified');
  assert.equal(result.verified, false);
  assert.deepEqual(result.failureReasons, []);
  assert.ok(result.unverifiedReasons.some(r => r.includes("missing org.opencontainers.image.revision label")));
});

test('verify-image-readback: label present but no expected revision stays unverified (label alone is not source identity)', async () => {
  const result = await verifyImageReadbackFiles({
    manifestInspectPath: path.join(fixturesDir, 'valid-manifest-inspect.json'),
    imageInspectPath: path.join(fixturesDir, 'valid-image-inspect.json'),
    smokeOutputPath: path.join(fixturesDir, 'valid-smoke-report.json'),
    expectedRepository: EXPECTED_REPO,
    expectedDigest: EXPECTED_DIGEST
  });
  assert.equal(result.verified, false);
  assert.equal(result.status, 'unverified');
  assert.equal(result.sourceRevision.labelPresent, true);
  assert.equal(result.sourceRevision.matched, false);
  assert.deepEqual(result.failureReasons, []);
  assert.ok(result.unverifiedReasons.some(r => r.startsWith('source_revision_not_compared')));
});
