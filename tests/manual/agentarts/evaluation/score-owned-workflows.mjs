/** Offline MOD-31 consumer. Never invokes a model, tool, database or platform. */
import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {projectOwnedReleaseEvidence} from '../../../../scripts/agentarts/export-owned-release-evidence.mjs';

// Digests of the existing ownedWorkflowFixtureInput/PublicFixture('F20') exports
// at 81dc72b6. Expectations stay outside the model's input. No duplicate fixture.
export const FIXED_WORKFLOW_CASE = Object.freeze({
  caseId: 'f20-public-api-docs-v1', workflowId: 'F20',
  harnessRevision: '81dc72b60240d761070c39515ce112032b6b22ca',
  inputSha256: 'd4dc22dd4cb6f5ac1be70a49dcea2f5c1ef4b01eee2ea2f1f923336084fbe16a',
  sourceSha256: '147a6469e4cd47c6730cd9fee51d1d2c4c216f64e935f10f924449a01341fbfb',
});
const PROFILE = 'huawei_ict_agentarts';
const SURFACES = {
  agentarts_cloud: ['cloudReceipt', 'cloudPublicFixture'],
  local_owned_image: ['imageWorkflowReceipt', 'imageWorkflowFixture'],
  local_owned_source_runtime: ['localRuntimeWorkflowReceipt', 'localRuntimeWorkflowFixture'],
};
const bad = () => {throw new TypeError('Invalid owned workflow evaluation input');};
const hash = value => createHash('sha256').update(value).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Snapshot JSON data without invoking getters/toJSON. Bounded before serialization.
function snapshot(value, depth = 0, budget = {nodes: 0, chars: 0}) {
  if (++budget.nodes > 100_000 || depth > 40) bad();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    budget.chars += value.length;
    if (budget.chars > 4_000_000) bad();
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') bad();
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype) bad();
  const keys = Reflect.ownKeys(value);
  if (keys.length > 100_001) bad();
  const result = array ? [] : {};
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) bad();
    if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) bad();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) bad();
    result[key] = snapshot(descriptor.value, depth + 1, budget);
  }
  if (array && (keys.length !== value.length + 1 || result.length !== value.length)) bad();
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
/** Canonical JSON hash; artifact text hashes elsewhere use exact UTF-8 bytes. */
export const workflowEvaluationDigest = value => hash(JSON.stringify(canonical(snapshot(value))));
function fields(value, required, optional = []) {
  if (!plain(value) || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) bad();
}
const verdict = value => value === true ? 'passed' : value === false ? 'failed' : 'unknown';

function assertPreCatalogFailure(record, inputIntegrity) {
  const {receipt, catalogDispatch} = record;
  // Supplied by the trusted host from its saved dispatch, never inferred from
  // a model's error, a filename or an absent catalog. The receipt digest above
  // and task/request associations below bind the attempted run without replay.
  fields(catalogDispatch, ['workflowId', 'taskId', 'requestId', 'querySha256']);
  if (inputIntegrity !== 'passed' || Object.hasOwn(receipt, 'catalog')
    || catalogDispatch.workflowId !== 'F20' || !id(catalogDispatch.taskId) || !id(catalogDispatch.requestId)
    || catalogDispatch.querySha256 !== hash(JSON.stringify({workflowVersion: '1.0.0', operation: 'catalog', workflowId: 'F20'}))
    || receipt.parentTask?.taskId !== catalogDispatch.taskId
    || !['failed', 'cancelled', 'waiting_reconciliation'].includes(receipt.parentTask?.state)
    || receipt.status !== 'failed_or_unknown' || !plain(receipt.failure)
    || !['catalog', 'response', 'execution'].includes(receipt.failure.stage)
    || typeof receipt.failure.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(receipt.failure.code)
    || receipt.scope?.contentSha256 !== FIXED_WORKFLOW_CASE.sourceSha256
    || ['tool', 'validationTool', 'validation', 'candidate', 'continuation', 'workflowCompletion']
      .some(key => Object.hasOwn(receipt, key))) bad();
  const requests = [];
  for (const key of ['network', 'unknown']) {
    if (!Array.isArray(receipt[key]) || receipt[key].length > 1) bad();
    requests.push(...receipt[key]);
  }
  if (!requests.length || requests.some(item => !plain(item) || item.stage !== 'catalog'
    || item.requestId !== catalogDispatch.requestId)) bad();
}

function scoreRecord(record) {
  fields(record, ['caseId', 'variant', 'runIndex', 'surface', 'executionKind', 'receipt', 'releaseMetadata'],
    ['input', 'configuration', 'binding', 'artifacts', 'review', 'catalogDispatch']);
  if (record.caseId !== FIXED_WORKFLOW_CASE.caseId || !['candidate', 'baseline'].includes(record.variant)
    || !Number.isSafeInteger(record.runIndex) || record.runIndex < 1 || record.runIndex > 1000
    || !Object.hasOwn(SURFACES, record.surface)
    || !['real_provider_public_fixture', 'synthetic'].includes(record.executionKind)) bad();
  const receiptSha256 = workflowEvaluationDigest(record.receipt);
  const [argument, phase] = SURFACES[record.surface];
  // Reuse the existing read/compile/resume/persistence checks, not a second scorer.
  const projected = projectOwnedReleaseEvidence({metadata: record.releaseMetadata, [argument]: record.receipt}).phases[phase];
  const preCatalogFailure = projected.selectedWorkflow !== 'F20';
  let inputIntegrity = 'unknown', configurationSha256 = null;
  if (record.configuration !== undefined) {
    fields(record.configuration, ['executionModel', 'selectorModel', 'modelSettingsSha256', 'environmentId']);
    if (!['executionModel', 'selectorModel', 'environmentId'].every(key => id(record.configuration[key]))
      || !sha(record.configuration.modelSettingsSha256)) bad();
    configurationSha256 = workflowEvaluationDigest(record.configuration);
  }
  if (record.binding !== undefined) {
    fields(record.binding, ['inputSha256', 'sourceSha256', 'receiptSha256', 'configurationSha256']);
    if (!Object.values(record.binding).every(sha)) bad();
    inputIntegrity = verdict(record.input !== undefined && configurationSha256 !== null
      && workflowEvaluationDigest(record.input) === FIXED_WORKFLOW_CASE.inputSha256
      && record.binding.inputSha256 === FIXED_WORKFLOW_CASE.inputSha256
      && record.binding.sourceSha256 === FIXED_WORKFLOW_CASE.sourceSha256
      && record.binding.receiptSha256 === receiptSha256
      && record.binding.configurationSha256 === configurationSha256);
  }
  if (preCatalogFailure) assertPreCatalogFailure(record, inputIntegrity);
  else if (Object.hasOwn(record, 'catalogDispatch')) bad();
  const completion = projected.workflowCompletion;
  let artifactIntegrity = 'unknown', answer = 'unknown', citations = 'unknown';
  let documentSha256 = null;
  if (record.artifacts !== undefined) {
    fields(record.artifacts, ['documentText', 'checkText']);
    if (typeof record.artifacts.documentText !== 'string' || typeof record.artifacts.checkText !== 'string') bad();
    documentSha256 = hash(record.artifacts.documentText);
    let check;
    try {check = JSON.parse(record.artifacts.checkText);} catch {check = null;}
    artifactIntegrity = verdict(completion !== null && completion !== undefined
      && completion.docSha256 === documentSha256
      && completion.checkArtifactSha256 === hash(record.artifacts.checkText)
      && completion.sourceSha256 === FIXED_WORKFLOW_CASE.sourceSha256
      && projected.tool?.contentSha256 === FIXED_WORKFLOW_CASE.sourceSha256
      && check?.kind === 'public_api_doc_validation' && check.state === 'passed'
      && check.source?.sha256 === FIXED_WORKFLOW_CASE.sourceSha256
      && check.candidate?.sha256 === completion.candidateSha256
      && check.candidate?.docSha256 === documentSha256
      && check.candidate?.docMarkdown === record.artifacts.documentText
      && check.compiler?.exitCode === 0 && check.checks?.typeCheckPassed === true
      && check.checks?.noPhantomFields === true && check.checks?.sourceDifferenceMatched === true);
  }
  if (record.review !== undefined) {
    fields(record.review, ['documentSha256', 'reviewerId', 'answerSupported', 'citationsSupported']);
    if (!sha(record.review.documentSha256) || !id(record.review.reviewerId)
      || !['answerSupported', 'citationsSupported'].every(key => [true, false, null].includes(record.review[key]))) bad();
    // Missing or mismatched actual prose cannot inherit a positive manual label.
    if (artifactIntegrity === 'passed' && record.review.documentSha256 === documentSha256) {
      answer = verdict(record.review.answerSupported);
      citations = verdict(record.review.citationsSupported);
    }
  }
  const workflow = preCatalogFailure || record.receipt.parentTask?.state === 'failed' || record.receipt.failure ? 'failed'
    : record.receipt.unknown?.length ? 'unknown' : projected.workflowVerified ? 'passed' : 'unknown';
  const toolReadback = projected.publicReadVerified && projected.publicValidationVerified ? 'passed' : 'unknown';
  const reviewSelected = projected.laya.records.some(item => item.candidateId === 'owned-review');
  const duration = Date.parse(record.receipt.finishedAt) - Date.parse(record.receipt.startedAt);
  const durationMs = Number.isFinite(duration) && duration >= 0 ? duration : null;
  const checks = {inputIntegrity, artifactIntegrity, answer, citations, toolReadback, workflow};
  const status = Object.values(checks).includes('failed') ? 'failed'
    : Object.values(checks).every(value => value === 'passed') ? 'passed' : 'unknown';
  return {caseId: record.caseId, workflowId: 'F20', variant: record.variant, runIndex: record.runIndex,
    surface: record.surface, executionKind: record.executionKind, receiptSha256, configurationSha256,
    ...(preCatalogFailure ? {observationStage: 'before_catalog_readback'} : {}),
    status, checks, retrieval: 'not_applicable_direct_source_fixture', recovery: 'unknown',
    abstention: reviewSelected ? 'review_observed' : 'unknown',
    abstentionCorrectness: 'unknown', durationMs, durationScope: 'recorded_harness_wall_time',
    evidenceAuthenticity: 'requires_independent_host_review'};
}

/** Existing public release projections are observations, never newly scored runs. */
function observeHistorical(artifact) {
  if (artifact?.schemaVersion !== 1 || artifact.profile !== PROFILE
    || artifact.evidenceKind !== 'personal-agent-owned-release-public' || !plain(artifact.phases)) bad();
  return {artifactSha256: workflowEvaluationDigest(artifact), workflowId: 'F20', status: 'unknown',
    reason: 'fixed_input_actual_answer_and_independent_review_not_bound',
    surfaces: Object.entries(SURFACES).flatMap(([surface, [, phase]]) => {
      const value = artifact.phases[phase];
      if (!value || value.status === 'not_provided' || value.selectedWorkflow !== 'F20') return [];
      return [{surface, recordedRead: value.publicReadVerified === true,
        recordedCompletion: value.workflowVerified === true,
        actualAnswer: 'unknown', fixedInputIntegrity: 'unknown', recovery: 'unknown', durationMs: null}];
    })};
}

export function scoreOwnedWorkflowRuns(input) {
  input = snapshot(input);
  fields(input, ['records'], ['historicalEvidence']);
  if (!Array.isArray(input.records) || input.records.length > 1000
    || (input.historicalEvidence !== undefined && (!Array.isArray(input.historicalEvidence) || input.historicalEvidence.length > 32))) bad();
  const records = input.records.map(scoreRecord), identities = new Set(), receipts = new Set();
  for (const item of records) {
    const identity = JSON.stringify([item.caseId, item.variant, item.runIndex]);
    if (identities.has(identity) || receipts.has(item.receiptSha256)) bad();
    identities.add(identity); receipts.add(item.receiptSha256);
  }
  const pairs = [];
  for (const candidate of records.filter(item => item.variant === 'candidate')) {
    const baseline = records.find(item => item.variant === 'baseline' && item.runIndex === candidate.runIndex);
    let reason = 'missing_baseline';
    if (baseline) reason = [candidate, baseline].some(item => item.checks.inputIntegrity !== 'passed') ? 'input_binding_incomplete'
      : [candidate, baseline].some(item => item.checks.artifactIntegrity === 'failed') ? 'artifact_integrity_mismatch'
      : candidate.configurationSha256 !== baseline.configurationSha256 ? 'configuration_mismatch'
      : candidate.surface !== baseline.surface || candidate.executionKind !== baseline.executionKind ? 'execution_surface_mismatch'
      : [candidate, baseline].some(item => item.status === 'unknown') ? 'quality_evidence_incomplete' : null;
    pairs.push({runIndex: candidate.runIndex, surface: candidate.surface, executionKind: candidate.executionKind,
      ready: reason === null, reason,
      qualityDelta: reason === null ? Number(candidate.status === 'passed') - Number(baseline.status === 'passed') : null,
      durationDeltaMs: reason === null && candidate.durationMs !== null && baseline.durationMs !== null
        ? candidate.durationMs - baseline.durationMs : null});
  }
  const historicalObservations = (input.historicalEvidence ?? []).map(observeHistorical);
  return {schemaVersion: 1, profile: PROFILE, verification: 'unverified',
    fixedCases: [FIXED_WORKFLOW_CASE], records, pairs, historicalObservations,
    countScope: 'supplied_fixture_records_not_business_successes',
    counts: {observed: records.length, passed: records.filter(item => item.status === 'passed').length,
      failed: records.filter(item => item.status === 'failed').length, unknown: records.filter(item => item.status === 'unknown').length},
    caseCoverage: ['candidate', 'baseline'].map(variant => ({caseId: FIXED_WORKFLOW_CASE.caseId, variant,
      status: records.some(item => item.variant === variant) ? 'observed' : 'not_run'})),
    coverage: Array.from({length: 28}, (_, index) => {
      const workflowId = 'F' + String(index + 1).padStart(2, '0');
      return {workflowId, status: workflowId === 'F20' && records.length ? 'observed'
        : workflowId === 'F20' && historicalObservations.some(item => item.surfaces.length) ? 'historical_unscored' : 'not_run',
      fullyVerified: false};
    }),
    nativePlatformEvaluation: 'unavailable_not_connected',
    limitations: ['Hashes establish supplied artifact consistency, not provenance or execution authenticity.',
      'Independent answer/citation labels are required; hashes and template counts are not semantic scores.',
      'Recovery and abstention correctness require separate labeled failure cases; this fixture cannot establish them.',
      'Partial and missing observations are not successes. No multi-agent benefit or statistical significance is inferred.',
      'Public fixture results do not complete any of the 28 business workflows or verify a deployment.']};
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length !== 2 || argv[0] !== '--input') bad();
    const file = await open(argv[1], 'r');
    let bytes;
    try {
      if (!(await file.stat()).isFile()) bad();
      const buffer = Buffer.alloc(4_000_001); let used = 0;
      while (used < buffer.length) {
        const result = await file.read(buffer, used, buffer.length - used, null);
        if (!result.bytesRead) break;
        used += result.bytesRead;
      }
      if (used > 4_000_000) bad();
      bytes = buffer.subarray(0, used);
    } finally {await file.close();}
    const input = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    process.stdout.write(JSON.stringify(scoreOwnedWorkflowRuns(input), null, 2) + '\n');
  } catch {
    process.stderr.write('Invalid or unreadable owned workflow evaluation input\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
