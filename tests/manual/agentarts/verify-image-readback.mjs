#!/usr/bin/env node
// Pure offline, read-only Docker inspect & manifest readback verification.
// Performs NO network calls, NO Docker commands, NO credential access.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA256_RE = /^sha256:[a-f0-9]{64}$/i;
const HEX64_RE = /^[a-f0-9]{64}$/i;

/**
 * Verify docker manifest inspect, docker image inspect, and optional catalog smoke output offline.
 *
 * @param {object} options
 * @param {unknown} options.manifestInspect - Parsed JSON from docker manifest inspect
 * @param {unknown} options.imageInspect - Parsed JSON from docker image inspect (array or object)
 * @param {unknown} [options.smokeOutput] - Optional parsed JSON from local-image-catalog-smoke
 * @param {string} options.expectedRepository - Expected repository name (without tag/digest)
 * @param {string} options.expectedDigest - Expected sha256 digest
 * @param {string} [options.expectedRevision] - Optional expected git commit hash for OCI revision
 * @returns {object} Comprehensive verification result
 */
export function verifyImageReadback({
  manifestInspect,
  imageInspect,
  smokeOutput,
  expectedRepository,
  expectedDigest,
  expectedRevision
}) {
  const failureReasons = [];
  const unverifiedReasons = [];

  // 1. Validate inputs
  if (typeof expectedRepository !== 'string' || !expectedRepository.trim() || expectedRepository.includes('@') || expectedRepository.includes(':')) {
    failureReasons.push(`Invalid expected repository: '${expectedRepository}' (must be a clean repository without tag or digest)`);
  }
  const cleanRepo = typeof expectedRepository === 'string' ? expectedRepository.trim() : '';

  if (typeof expectedDigest !== 'string' || !SHA256_RE.test(expectedDigest.trim())) {
    failureReasons.push(`Invalid expected digest: '${expectedDigest}' (must be exact sha256:64hex, tag/latest rejected)`);
  }
  const cleanDigest = typeof expectedDigest === 'string' ? expectedDigest.trim().toLowerCase() : '';

  const expectedReference = cleanRepo && cleanDigest ? `${cleanRepo}@${cleanDigest}` : '';

  // 2. Validate manifest inspect platforms
  const manifestPlatforms = [];
  let manifestArm64Present = false;
  if (!manifestInspect || (typeof manifestInspect !== 'object')) {
    failureReasons.push('Manifest inspect is missing or not a valid JSON object/array');
  } else {
    if (Array.isArray(manifestInspect)) {
      for (const item of manifestInspect) {
        const p = item?.Descriptor?.platform || item?.platform;
        if (p && typeof p === 'object') manifestPlatforms.push(p);
      }
    } else {
      if (Array.isArray(manifestInspect.manifests)) {
        for (const m of manifestInspect.manifests) {
          if (m?.platform && typeof m.platform === 'object') manifestPlatforms.push(m.platform);
        }
      } else if (manifestInspect.platform && typeof manifestInspect.platform === 'object') {
        manifestPlatforms.push(manifestInspect.platform);
      }
    }

    manifestArm64Present = manifestPlatforms.some(
      p => String(p.os || '').toLowerCase() === 'linux' && String(p.architecture || '').toLowerCase() === 'arm64'
    );

    if (!manifestArm64Present) {
      const hasAmd64Only = manifestPlatforms.some(
        p => String(p.os || '').toLowerCase() === 'linux' && String(p.architecture || '').toLowerCase() === 'amd64'
      );
      if (hasAmd64Only) {
        failureReasons.push('Manifest inspect contains linux/amd64 but lacks required linux/arm64 entry (amd64 substitute rejected)');
      } else {
        failureReasons.push('Manifest inspect missing linux/arm64 platform entry');
      }
    }
  }

  // 3. Validate image inspect (RepoDigests, Os, Architecture, Labels)
  let repoDigestsMatched = false;
  let matchedDigest = null;
  let actualRepoDigests = [];
  let inspectOs = '';
  let inspectArch = '';
  let sourceRevision = 'unknown';
  let labelPresent = false;
  let revisionMatched = false;

  const img = Array.isArray(imageInspect) ? imageInspect[0] : imageInspect;
  if (!img || typeof img !== 'object') {
    failureReasons.push('Image inspect is missing or not a valid JSON object/array');
  } else {
    // RepoDigests check
    const rd = Array.isArray(img.RepoDigests) ? img.RepoDigests : (Array.isArray(img.repoDigests) ? img.repoDigests : []);
    actualRepoDigests = rd.filter(entry => typeof entry === 'string');

    if (actualRepoDigests.length === 0) {
      failureReasons.push('Image inspect RepoDigests is empty or missing');
    } else if (expectedReference) {
      const exactMatch = actualRepoDigests.find(entry => entry.toLowerCase() === expectedReference.toLowerCase());
      if (exactMatch) {
        repoDigestsMatched = true;
        matchedDigest = cleanDigest;
      } else {
        // Find if repo exists with different digest
        const repoMatches = actualRepoDigests.filter(entry => entry.toLowerCase().startsWith(`${cleanRepo.toLowerCase()}@`));
        if (repoMatches.length > 0) {
          failureReasons.push(`RepoDigests digest mismatch: repository '${cleanRepo}' found with differing digest(s): ${repoMatches.join(', ')}`);
        } else {
          // Find if digest exists with different repo
          const digestMatches = actualRepoDigests.filter(entry => entry.toLowerCase().endsWith(`@${cleanDigest}`));
          if (digestMatches.length > 0) {
            failureReasons.push(`RepoDigests repository mismatch: digest '${cleanDigest}' found under differing repository: ${digestMatches.join(', ')}`);
          } else {
            failureReasons.push(`RepoDigests does not contain expected reference '${expectedReference}'`);
          }
        }
      }
    }

    // Os & Architecture check
    inspectOs = String(img.Os || img.os || '').toLowerCase();
    inspectArch = String(img.Architecture || img.architecture || '').toLowerCase();

    if (inspectOs !== 'linux') {
      failureReasons.push(`Image inspect Os is '${inspectOs || 'empty'}', expected 'linux'`);
    }

    if (inspectArch === 'amd64') {
      failureReasons.push("Image inspect Architecture is 'amd64', rejecting amd64 substitute for required 'arm64'");
    } else if (inspectArch !== 'arm64') {
      failureReasons.push(`Image inspect Architecture is '${inspectArch || 'empty'}', expected 'arm64'`);
    }

    // OCI Revision Label check
    const labels = img.Config?.Labels || img.Config?.labels || img.labels || {};
    const revisionVal = labels['org.opencontainers.image.revision'];
    if (typeof revisionVal === 'string' && revisionVal.trim().length > 0) {
      sourceRevision = revisionVal.trim();
      labelPresent = true;
      if (expectedRevision) {
        const cleanExpectedRev = expectedRevision.trim().toLowerCase();
        if (sourceRevision.toLowerCase() === cleanExpectedRev) {
          revisionMatched = true;
        } else {
          revisionMatched = false;
          failureReasons.push(`Source revision mismatch: expected '${expectedRevision}', got '${sourceRevision}'`);
        }
      } else {
        revisionMatched = false;
        unverifiedReasons.push('source_revision_not_compared: no expected revision supplied; label alone does not prove source identity');
      }
    } else {
      sourceRevision = 'unknown';
      labelPresent = false;
      revisionMatched = false;
      if (expectedRevision) {
        failureReasons.push(`Expected revision '${expectedRevision}', but org.opencontainers.image.revision label is missing`);
      } else {
        unverifiedReasons.push('source_revision_unknown: missing org.opencontainers.image.revision label');
      }
    }
  }

  // 4. Validate Directory Smoke Output (Optional)
  let smokeProvided = false;
  let smokeVerified = false;
  let smokeDetails = undefined;

  if (smokeOutput !== undefined && smokeOutput !== null) {
    smokeProvided = true;
    const s = typeof smokeOutput === 'string' ? JSON.parse(smokeOutput) : smokeOutput;
    if (!s || typeof s !== 'object') {
      failureReasons.push('Smoke output is not a valid JSON object');
    } else {
      const smokeWfCount = s.workflowCount;
      const smokeNodeCount = s.nodeCount;
      const smokeArch = String(s.architecture || '').toLowerCase();
      const smokeUser = s.user;
      const smokeLaya = s.embeddedLayaPathPresent;
      const smokePing = s.pingStatus;

      let allDigestsValid = true;
      let observedNodesSum = 0;

      if (smokeWfCount !== 28) {
        failureReasons.push(`Smoke workflowCount is ${smokeWfCount}, expected 28`);
      }
      if (smokeNodeCount !== 185) {
        failureReasons.push(`Smoke nodeCount is ${smokeNodeCount}, expected 185`);
      }
      if (smokeArch === 'amd64') {
        failureReasons.push("Smoke architecture is 'amd64', rejecting amd64 substitute");
      } else if (smokeArch !== 'arm64') {
        failureReasons.push(`Smoke architecture is '${smokeArch || 'empty'}', expected 'arm64'`);
      }
      if (smokeUser !== 1000) {
        failureReasons.push(`Smoke user UID is ${smokeUser}, expected 1000`);
      }
      if (smokeLaya !== false) {
        failureReasons.push(`Smoke reported embeddedLayaPathPresent: ${smokeLaya}, embedded Laya must be false`);
      }
      if (smokePing !== undefined && smokePing !== 200) {
        failureReasons.push(`Smoke pingStatus is ${smokePing}, expected 200`);
      }

      if (!Array.isArray(s.observed)) {
        failureReasons.push('Smoke observed array is missing or invalid');
      } else {
        if (s.observed.length !== 28) {
          failureReasons.push(`Smoke observed workflows count is ${s.observed.length}, expected 28`);
        }
        for (const wf of s.observed) {
          if (!wf || typeof wf !== 'object' || !wf.workflowId) {
            failureReasons.push('Smoke observed item missing workflowId');
            break;
          }
          const rawDigest = String(wf.templateDigest || '').replace(/^sha256:/i, '');
          if (!HEX64_RE.test(rawDigest)) {
            allDigestsValid = false;
          }
          if (typeof wf.nodeCount === 'number') {
            observedNodesSum += wf.nodeCount;
          }
        }
        if (!allDigestsValid) {
          failureReasons.push('Smoke observed workflows contains missing or non-sha256 templateDigest');
        }
        if (observedNodesSum !== 185) {
          failureReasons.push(`Smoke observed workflows nodeCount sum is ${observedNodesSum}, expected 185`);
        }
      }

      if (s.designCoverage && typeof s.designCoverage === 'object') {
        if (s.designCoverage.workflowCount !== undefined && s.designCoverage.workflowCount !== 28) {
          failureReasons.push(`Smoke designCoverage workflowCount is ${s.designCoverage.workflowCount}, expected 28`);
        }
        if (s.designCoverage.nodeCount !== undefined && s.designCoverage.nodeCount !== 185) {
          failureReasons.push(`Smoke designCoverage nodeCount is ${s.designCoverage.nodeCount}, expected 185`);
        }
      }

      smokeDetails = {
        workflowCount: smokeWfCount,
        nodeCount: smokeNodeCount,
        observedWorkflowsCount: Array.isArray(s.observed) ? s.observed.length : 0,
        allTemplateDigestsPresent: allDigestsValid,
        architecture: smokeArch,
        user: smokeUser,
        embeddedLayaPathPresent: smokeLaya,
        pingStatus: smokePing
      };

      if (failureReasons.length === 0) {
        smokeVerified = true;
      }
    }
  } else {
    smokeProvided = false;
    unverifiedReasons.push('smoke_output_not_provided: directory smoke receipt not provided');
  }

  // 5. Overall verdict
  const verified = failureReasons.length === 0 && unverifiedReasons.length === 0;
  const status = failureReasons.length > 0 ? 'failed' : (unverifiedReasons.length > 0 ? 'unverified' : 'verified');

  let summary = '';
  if (status === 'verified') {
    summary = `Verified: Image ${cleanRepo}@${cleanDigest} matches linux/arm64 manifest & inspect, RepoDigests, OCI revision (${sourceRevision}), and smoke output (28 workflows / 185 nodes).`;
  } else if (status === 'unverified') {
    summary = `Unverified: Image structure passed basic checks, but missing full evidence (${unverifiedReasons.join('; ')}).`;
  } else {
    summary = `Failed: Image verification failed with ${failureReasons.length} error(s): ${failureReasons.join('; ')}`;
  }

  return {
    verified,
    status,
    repository: cleanRepo,
    digest: cleanDigest,
    platform: {
      manifestArm64Present,
      manifestPlatforms,
      inspectOs,
      inspectArchitecture: inspectArch,
      verified: manifestArm64Present && inspectOs === 'linux' && inspectArch === 'arm64'
    },
    repoDigests: {
      matched: repoDigestsMatched,
      matchedDigest,
      actual: actualRepoDigests
    },
    sourceRevision: {
      labelPresent,
      revision: sourceRevision,
      expected: expectedRevision || null,
      matched: revisionMatched
    },
    smoke: {
      provided: smokeProvided,
      verified: smokeVerified,
      details: smokeDetails
    },
    failureReasons,
    unverifiedReasons,
    summary
  };
}

/**
 * Read JSON files and verify image readback.
 *
 * @param {object} options
 * @param {string} options.manifestInspectPath - Path to docker manifest inspect JSON
 * @param {string} options.imageInspectPath - Path to docker image inspect JSON
 * @param {string} [options.smokeOutputPath] - Path to smoke output JSON
 * @param {string} options.expectedRepository - Expected repository
 * @param {string} options.expectedDigest - Expected digest
 * @param {string} [options.expectedRevision] - Expected git commit revision
 * @param {string} [options.outputPath] - Optional file path to write results
 * @returns {Promise<object>} Result object
 */
export async function verifyImageReadbackFiles({
  manifestInspectPath,
  imageInspectPath,
  smokeOutputPath,
  expectedRepository,
  expectedDigest,
  expectedRevision,
  outputPath
}) {
  const manifestRaw = await readFile(resolve(manifestInspectPath), 'utf8');
  const manifestInspect = JSON.parse(manifestRaw);

  const imageRaw = await readFile(resolve(imageInspectPath), 'utf8');
  const imageInspect = JSON.parse(imageRaw);

  let smokeOutput = undefined;
  if (smokeOutputPath) {
    const smokeRaw = await readFile(resolve(smokeOutputPath), 'utf8');
    smokeOutput = JSON.parse(smokeRaw);
  }

  const result = verifyImageReadback({
    manifestInspect,
    imageInspect,
    smokeOutput,
    expectedRepository,
    expectedDigest,
    expectedRevision
  });

  if (outputPath) {
    await writeFile(resolve(outputPath), JSON.stringify(result, null, 2) + '\n', 'utf8');
  }

  return result;
}

// CLI handler
function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--manifest' && i + 1 < args.length) parsed.manifestInspectPath = args[++i];
    else if (arg === '--image-inspect' && i + 1 < args.length) parsed.imageInspectPath = args[++i];
    else if (arg === '--smoke' && i + 1 < args.length) parsed.smokeOutputPath = args[++i];
    else if (arg === '--expected-repo' && i + 1 < args.length) parsed.expectedRepository = args[++i];
    else if (arg === '--expected-digest' && i + 1 < args.length) parsed.expectedDigest = args[++i];
    else if (arg === '--expected-revision' && i + 1 < args.length) parsed.expectedRevision = args[++i];
    else if (arg === '--output' && i + 1 < args.length) parsed.outputPath = args[++i];
    else if (arg === '--strict') parsed.strict = true;
  }
  return parsed;
}

async function runCli() {
  const argv = process.argv.slice(2);
  let config = parseArgs(argv);

  if (!config.manifestInspectPath && !config.imageInspectPath && !process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const stdinStr = Buffer.concat(chunks).toString('utf8').trim();
    if (stdinStr) {
      const stdinConfig = JSON.parse(stdinStr);
      config = { ...stdinConfig, ...config };
    }
  }

  if (!config.manifestInspectPath || !config.imageInspectPath || !config.expectedRepository || !config.expectedDigest) {
    console.error('Usage: node verify-image-readback.mjs --manifest <path> --image-inspect <path> --expected-repo <repo> --expected-digest <digest> [--smoke <path>] [--expected-revision <rev>] [--output <path>] [--strict]');
    process.exit(1);
  }

  const result = await verifyImageReadbackFiles(config);
  console.log(JSON.stringify(result, null, 2));

  if (result.status === 'failed') {
    process.exitCode = 1;
  } else if (config.strict && !result.verified) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && (import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1].endsWith('verify-image-readback.mjs'))) {
  runCli().catch(err => {
    console.error('Execution error:', err.message);
    process.exit(1);
  });
}
