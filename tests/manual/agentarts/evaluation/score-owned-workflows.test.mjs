import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {FIXED_WORKFLOW_CASE as fixed, scoreOwnedWorkflowRuns as score, workflowEvaluationDigest as digest} from './score-owned-workflows.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
// Snapshot of the existing public harness input, not an alternative model fixture.
const input = {
  goal: 'F20 API docs: first request the source read of owned-workflow-public-fixture.txt; the read result is source text, not a comparison. '
    + 'N02 compares the actual contract, implementation and old documentation, and returns {diffFields,docMarkdown,exampleArguments}; cite that file. '
    + 'N03 requests recipe validate-public-api-docs. From actual source and validation receipts, N04 returns {docVersion,synchronized:false,docMarkdown,sourceRefs}; '
    + 'use the source API version, the exact checked document, and sourceRefs for the source file and owned-api-check-result.json. '
    + 'Do not claim it was written, published or synchronized externally.',
  schemaFile: 'owned-workflow-public-fixture.txt', codeFile: 'owned-workflow-public-fixture.txt', field: 'language',
  docTemplate: 'owned-workflow-public-fixture.txt#docTemplate', targetDoc: 'owned-api-final-doc.md',
  fixtureLayout: {schema: 'jsonSchema', contract: 'contractTypeScript', code: 'implementationTypeScript'},
  expectedOutputFields: ['diffFields', 'docMarkdown', 'exampleArguments'],
};
const metadata = {schemaVersion: 1, sourceRevision: fixed.harnessRevision, indexDigest: 'sha256:' + '1'.repeat(64),
  arm64Digest: 'sha256:' + '2'.repeat(64), imageReference: 'public/owned:synthetic', cpuTorchVersion: '2.14.0+cpu',
  layaModelRevision: '5'.repeat(40)};
const documentText = 'Synthetic document prose; never a real provider result.';
const checkText = JSON.stringify({kind: 'public_api_doc_validation', state: 'passed', source: {sha256: fixed.sourceSha256},
  candidate: {sha256: 'a'.repeat(64), docSha256: sha(documentText), docMarkdown: documentText}, compiler: {exitCode: 0},
  checks: {typeCheckPassed: true, noPhantomFields: true, sourceDifferenceMatched: true}}) + '\n';
function record(variant = 'candidate', runIndex = 1) {
  const docSha256 = sha(documentText), candidateSha256 = 'a'.repeat(64), checkArtifactSha256 = sha(checkText);
  const sourceSha256 = fixed.sourceSha256;
  const receipt = {schemaVersion: 1, profile: 'huawei_ict_agentarts', status: 'passed_public_f20_documentation_workflow',
    startedAt: '2026-10-15T00:00:00.000Z', finishedAt: '2026-10-15T00:00:02.000Z',
    target: {runtime: `fixture-${variant}-${runIndex}`, requestedVersion: 'v1', invokeMode: 'published'},
    providers: {fakeSelector: false, fakeExecutionModel: false, cloud: 'real_agentarts_https', localTool: 'production_workspace.read_text',
      validationTool: 'production_workspace.run_allowed_command', compiler: 'real_typescript_noEmit'},
    catalog: {workflowCount: 28, selectedWorkflow: 'F20'},
    network: ['catalog', 'proposal', 'receipt_resume', 'validation_receipt_resume'].map((stage, i) =>
      ({stage, httpStatus: 200, transport: 'https', durationMs: 900, requestId: `req-${i}`})),
    tool: {toolName: 'workspace.read_text', executionCount: 1, policyDecision: 'allow', localState: 'succeeded', signedReceipt: true,
      runId: 'read-1', evidence: [{evidenceId: 'read-1', verification: 'conditional'}], independentlyReadContentSha256: sourceSha256},
    validationTool: {nodeId: 'F20_N03', toolName: 'workspace.run_allowed_command', actualSideEffect: 'local_write', executionCount: 1,
      policyDecision: 'allow', localState: 'succeeded', signedReceipt: true, runId: 'check-1', evidence: [{evidenceId: 'check-1', verification: 'conditional'}]},
    validation: {state: 'passed', compiler: {exitCode: 0}, checks: {typeCheckPassed: true, noPhantomFields: true},
      sourceSha256, candidateSha256, docSha256, checkArtifactSha256},
    candidate: {candidateSha256, docSha256},
    continuation: {receiptAccepted: true, originalToolNodeState: 'completed', graphState: 'settled', completedPostReceiptModelNodes: ['F20_N02', 'F20_N04']},
    workflowCompletion: {workflowId: 'F20', graphState: 'settled', allRequiredNodesCompleted: true,
      nodeStates: Object.fromEntries(['F20_N01', 'F20_N02', 'F20_N03', 'F20_N04'].map(id => [id, 'completed'])),
      sourceSha256, candidateSha256, docSha256, checkArtifactSha256, docVersion: 'public-fixture-1', synchronized: false,
      finalArtifactReadback: true, finalArtifactName: 'owned-api-final-doc.md', sourceRefs: ['owned-workflow-public-fixture.txt', 'owned-api-check-result.json']},
    parentTask: {state: 'succeeded', terminalAuthority: 'existing TaskRuntime.runTask', completionProducedByWorker: true, evidenceRefs: ['read-1', 'check-1']},
    persistence: {reopened: true, toolRecordCount: 1, evidenceCount: 1, additionalNetworkCalls: 0, additionalToolExecutions: 0,
      parentState: 'succeeded', validation: {localState: 'succeeded', toolRecordCount: 1, evidenceCount: 1}},
  };
  const configuration = {executionModel: 'fixture-model', selectorModel: 'fixture-selector', modelSettingsSha256: '6'.repeat(64), environmentId: 'fixture-cpu'};
  return {caseId: fixed.caseId, variant, runIndex, surface: 'agentarts_cloud', executionKind: 'synthetic', releaseMetadata: metadata,
    input: structuredClone(input), configuration, receipt,
    binding: {inputSha256: fixed.inputSha256, sourceSha256, receiptSha256: digest(receipt), configurationSha256: digest(configuration)},
    artifacts: {documentText, checkText}, review: {documentSha256: docSha256, reviewerId: 'fixture-reviewer', answerSupported: true, citationsSupported: true}};
}
const rebind = item => {item.binding.receiptSha256 = digest(item.receipt); return item;};

function earlyFailure(variant = 'candidate') {
  const item = record(variant);
  item.catalogDispatch = {workflowId: 'F20', taskId: `early-${variant}`, requestId: `catalog-${variant}`,
    querySha256: sha(JSON.stringify({workflowVersion: '1.0.0', operation: 'catalog', workflowId: 'F20'}))};
  for (const key of ['catalog', 'tool', 'validationTool', 'validation', 'candidate', 'continuation', 'workflowCompletion', 'persistence']) delete item.receipt[key];
  delete item.artifacts; delete item.review;
  item.receipt.status = 'failed_or_unknown';
  item.receipt.scope = {contentSha256: fixed.sourceSha256};
  item.receipt.parentTask = {taskId: item.catalogDispatch.taskId, state: 'waiting_reconciliation'};
  item.receipt.failure = {stage: 'catalog', code: 'HTTP_503'};
  item.receipt.network = [{stage: 'catalog', requestId: item.catalogDispatch.requestId, httpStatus: 503, durationMs: 2, transport: 'https'}];
  item.receipt.unknown = [{stage: 'catalog', requestId: item.catalogDispatch.requestId, code: 'HTTP_503'}];
  return rebind(item);
}

test('fully bound pre-catalog failures are observed unsuccessful attempts without fabricated results or pairs', () => {
  const item = earlyFailure(), report = score({records: [item]});
  const result = report.records[0];
  assert.equal(result.observationStage, 'before_catalog_readback');
  assert.equal(result.status, 'failed'); assert.equal(result.checks.workflow, 'failed');
  for (const key of ['artifactIntegrity', 'answer', 'citations', 'toolReadback']) assert.equal(result.checks[key], 'unknown');
  assert.deepEqual(report.counts, {observed: 1, passed: 0, failed: 1, unknown: 0});
  assert.equal(report.pairs[0].ready, false); assert.equal(report.pairs[0].reason, 'missing_baseline');
  assert.equal(report.caseCoverage[1].status, 'not_run');
  assert.ok(!JSON.stringify(report).includes(item.catalogDispatch.taskId));
  assert.ok(!JSON.stringify(report).includes(item.catalogDispatch.requestId));
});
test('pre-catalog transport and invalid-response failures retain only their original catalog association', () => {
  for (const stage of ['catalog', 'response', 'execution']) {
    const item = earlyFailure(); item.receipt.failure = {stage, code: 'SANITIZED_FAILURE'};
    item.receipt.network = []; // transport failure has only the original unknown request
    assert.equal(score({records: [rebind(item)]}).records[0].status, 'failed');
  }
  const invalidCatalog = earlyFailure(); invalidCatalog.receipt.network[0].httpStatus = 200;
  invalidCatalog.receipt.unknown = []; invalidCatalog.receipt.failure.code = 'INVALID_CATALOG';
  invalidCatalog.receipt.parentTask.state = 'failed';
  assert.equal(score({records: [rebind(invalidCatalog)]}).records[0].status, 'failed');
});
test('pre-catalog intake rejects missing binding and mismatched input, source, receipt, configuration or run identity', () => {
  const mutations = [x => {delete x.binding;}, x => {delete x.input;}, x => {delete x.configuration;},
    x => {delete x.catalogDispatch;}, x => {delete x.receipt.scope;},
    x => {x.input.goal += ' different';}, x => {x.binding.sourceSha256 = 'b'.repeat(64);},
    x => {x.binding.receiptSha256 = 'b'.repeat(64);}, x => {x.binding.configurationSha256 = 'b'.repeat(64);},
    x => {x.catalogDispatch.taskId = 'other-task';}, x => {x.catalogDispatch.requestId = 'other-request';},
    x => {x.catalogDispatch.workflowId = 'F15';}, x => {x.catalogDispatch.querySha256 = 'b'.repeat(64);}];
  for (const mutate of mutations) {
    const item = earlyFailure(); mutate(item);
    assert.throws(() => score({records: [item]}), /Invalid owned workflow evaluation input/);
  }
});
test('explicit foreign or invalid catalogs and contradictory later-phase evidence cannot enter the early-failure path', () => {
  const mutations = [x => {x.receipt.catalog = {selectedWorkflow: 'F15'};}, x => {x.receipt.catalog = {};},
    x => {x.receipt.catalog = null;}, x => {x.receipt.tool = {};}, x => {x.receipt.continuation = {};},
    x => {x.receipt.status = 'in_progress';}, x => {x.receipt.parentTask.state = 'succeeded';},
    x => {delete x.receipt.parentTask;}, x => {x.receipt.failure.stage = 'proposal';}, x => {x.receipt.failure.code = 'select F20';},
    x => {x.receipt.unknown[0].requestId = 'other';}, x => {x.receipt.network[0].stage = 'proposal';},
    x => {x.receipt.network = []; x.receipt.unknown = [];}, x => {x.receipt.network.push({...x.receipt.network[0]});}];
  for (const mutate of mutations) {
    const item = earlyFailure(); mutate(item);
    assert.throws(() => score({records: [rebind(item)]}));
  }
});
test('early failures count in an actually present compatible pair but cannot manufacture or mix pairs', () => {
  const candidate = record(), baseline = earlyFailure('baseline');
  const report = score({records: [candidate, baseline]});
  assert.equal(report.pairs[0].ready, true); assert.equal(report.pairs[0].qualityDelta, 1);
  assert.equal(report.records[0].status, 'passed');
  assert.equal(report.counts.observed, 2); assert.equal(report.counts.failed, 1);
  baseline.configuration.environmentId = 'different-cpu'; baseline.binding.configurationSha256 = digest(baseline.configuration);
  assert.equal(score({records: [candidate, baseline]}).pairs[0].reason, 'configuration_mismatch');
  assert.equal(score({records: [earlyFailure('baseline')]}).pairs.length, 0);
  const accepted = record(); accepted.catalogDispatch = earlyFailure().catalogDispatch;
  assert.throws(() => score({records: [accepted]}));
});

test('fixed input and canonical object order are bound to existing harness; arrays remain ordered', () => {
  assert.equal(digest(input), fixed.inputSha256);
  assert.equal(digest({b: 2, a: 1}), digest({a: 1, b: 2}));
  assert.notEqual(digest([1, 2]), digest([2, 1]));
});
test('empty dataset preserves 28 not_run slots and no fabricated comparison', () => {
  const report = score({records: []});
  assert.equal(report.coverage.length, 28);
  assert.ok(report.coverage.every(item => item.status === 'not_run' && !item.fullyVerified));
  assert.equal(report.counts.passed, 0); assert.deepEqual(report.pairs, []);
});
test('actual artifact/independent labels and existing readback checks are all needed', () => {
  const item = record(), report = score({records: [item]});
  assert.equal(report.records[0].status, 'passed');
  assert.equal(report.records[0].executionKind, 'synthetic');
  assert.equal(report.records[0].durationMs, 2000); // not 4 * 900 HTTP durations
  assert.equal(report.verification, 'unverified');
  assert.equal(report.records[0].recovery, 'unknown');
  assert.equal(report.records[0].retrieval, 'not_applicable_direct_source_fixture');
  for (const key of ['review', 'artifacts', 'binding']) {
    const missing = record(); delete missing[key];
    assert.equal(score({records: [missing]}).records[0].status, 'unknown');
  }
  const resultText = JSON.stringify(report);
  for (const secret of [documentText, 'fixture-reviewer', input.goal]) assert.ok(!resultText.includes(secret));
});
test('independent negative answer/citation labels fail quality even for completed graph', () => {
  for (const field of ['answerSupported', 'citationsSupported']) {
    const item = record(); item.review[field] = false;
    assert.equal(score({records: [item]}).records[0].status, 'failed');
  }
});
test('changed input, source, swapped receipt, document and check bytes cannot be accepted', () => {
  const mutations = [x => {x.input.goal += ' changed';}, x => {x.binding.sourceSha256 = 'b'.repeat(64);},
    x => {x.receipt.finishedAt = '2026-10-15T00:00:03.000Z';}, x => {x.artifacts.documentText += ' changed';},
    x => {x.artifacts.checkText += ' ';}];
  for (const mutate of mutations) {
    const item = record(); mutate(item);
    assert.equal(score({records: [item]}).records[0].status, 'failed');
  }
  const item = record(); item.review.documentSha256 = 'b'.repeat(64);
  assert.equal(score({records: [item]}).records[0].checks.answer, 'unknown');
});
test('missing or mismatched source receipt and failed persisted task cannot count as completion', () => {
  for (const mutate of [x => {x.receipt.tool.signedReceipt = false;},
    x => {x.receipt.tool.evidence[0].evidenceId = 'wrong';},
    x => {x.receipt.persistence.parentState = 'failed';}, x => {x.receipt.providers.fakeSelector = true;}]) {
    const item = record(); mutate(item); rebind(item);
    assert.notEqual(score({records: [item]}).records[0].status, 'passed');
  }
});
test('paired runs need same input/settings/surface and distinct receipts, not merely matching indexes', () => {
  const candidate = record(), baseline = record('baseline');
  assert.equal(score({records: [candidate, baseline]}).pairs[0].ready, true);
  const changed = record('baseline'); changed.configuration.environmentId = 'other-cpu';
  changed.binding.configurationSha256 = digest(changed.configuration);
  assert.equal(score({records: [candidate, changed]}).pairs[0].reason, 'configuration_mismatch');
  delete changed.binding;
  assert.equal(score({records: [candidate, changed]}).pairs[0].reason, 'input_binding_incomplete');
  const incomplete = record('baseline'); delete incomplete.artifacts;
  assert.equal(score({records: [candidate, incomplete]}).pairs[0].qualityDelta, null);
  const tampered = record('baseline'); tampered.artifacts.documentText += ' changed';
  assert.equal(score({records: [candidate, tampered]}).pairs[0].reason, 'artifact_integrity_mismatch');
  const otherKind = record('baseline'); otherKind.executionKind = 'real_provider_public_fixture';
  assert.equal(score({records: [candidate, otherKind]}).pairs[0].reason, 'execution_surface_mismatch');
  const replay = record(); replay.variant = 'baseline';
  assert.throws(() => score({records: [candidate, replay]}));
  assert.throws(() => score({records: [candidate, candidate]}));
});
test('ordinary failures stay in paired quality denominator, absent baseline is not a loss', () => {
  const failed = record('baseline'); failed.receipt.parentTask.state = 'failed'; failed.receipt.failure = {code: 'TIMEOUT'}; rebind(failed);
  const report = score({records: [record(), failed]});
  assert.equal(report.pairs[0].ready, true); assert.equal(report.pairs[0].qualityDelta, 1);
  assert.equal(report.counts.failed, 1);
  assert.equal(score({records: [record()]}).pairs[0].qualityDelta, null);
});
test('an unresolved transport failure stays unknown and cannot enter a quality pair', () => {
  const candidate = record(), pending = record('baseline');
  pending.receipt.status = 'failed_or_unknown';
  pending.receipt.parentTask.state = 'waiting_reconciliation';
  pending.receipt.persistence.parentState = 'waiting_reconciliation';
  pending.receipt.unknown = [{stage:'validation_receipt_resume', requestId:'req-3', code:'TRANSPORT_OR_RESPONSE_UNKNOWN'}];
  pending.receipt.failure = {stage:'validation_receipt_resume', code:'TRANSPORT_OR_RESPONSE_UNKNOWN'};
  delete pending.receipt.workflowCompletion;
  delete pending.artifacts;
  delete pending.review;
  rebind(pending);
  const report = score({records:[candidate,pending]});
  assert.equal(report.records[1].checks.workflow, 'unknown');
  assert.equal(report.records[1].status, 'unknown');
  assert.equal(report.counts.unknown, 1);
  assert.equal(report.counts.failed, 0);
  assert.equal(report.pairs[0].ready, false);
  assert.equal(report.pairs[0].reason, 'quality_evidence_incomplete');
  assert.equal(report.pairs[0].qualityDelta, null);
});

test('review selection is an observation; no abstention quality or recovery success is invented', () => {
  const item = record(); item.receipt.laya = {records: [{event: 'laya_choice', model: 'multilingual', requestId: 'req-1', candidateId: 'owned-review', durationMs: 2}]};
  item.receipt.parentTask.state = 'failed'; rebind(item);
  const value = score({records: [item]}).records[0];
  assert.equal(value.abstention, 'review_observed'); assert.equal(value.abstentionCorrectness, 'unknown');
  assert.equal(value.recovery, 'unknown'); assert.equal(value.status, 'failed');
});
test('historical real public Evidence remains unscored and separate from synthetic or measured pairs', async () => {
  const artifact = JSON.parse(await readFile(new URL('../../../../docs/competition/evidence/OWNED_LAYA_20261014.json', import.meta.url), 'utf8'));
  const report = score({records: [], historicalEvidence: [artifact]});
  assert.equal(report.counts.observed, 0); assert.deepEqual(report.pairs, []);
  assert.equal(report.historicalObservations[0].status, 'unknown');
  assert.equal(report.coverage[19].status, 'historical_unscored');
  assert.equal(report.historicalObservations[0].surfaces[0].recordedCompletion, false);
  const catalogOnly = {schemaVersion: 1, profile: 'huawei_ict_agentarts', evidenceKind: 'personal-agent-owned-release-public',
    phases: {imageAcceptance: {workflowCatalog: {templates: 28}}}};
  assert.ok(score({records: [], historicalEvidence: [catalogOnly]}).coverage.every(item => item.status === 'not_run'));
});
test('invalid dates remain unknown and no output contains arbitrary failure text', () => {
  const item = record(); item.receipt.startedAt = 'bad'; item.receipt.failure = {code: 'private-error-text'}; rebind(item);
  const report = score({records: [item]});
  assert.equal(report.records[0].durationMs, null); assert.ok(!JSON.stringify(report).includes('private-error-text'));
  assert.equal(report.records[0].status, 'failed');
});
test('check artifact content must bind actual selected document, source and check outcomes', () => {
  for (const mutate of [x => {x.candidate.docMarkdown = 'other';}, x => {x.checks.sourceDifferenceMatched = false;},
    x => {x.source.sha256 = 'b'.repeat(64);}, x => {x.compiler.exitCode = 1;}]) {
    const item = record(), check = JSON.parse(checkText); mutate(check);
    item.artifacts.checkText = JSON.stringify(check);
    item.receipt.validation.checkArtifactSha256 = sha(item.artifacts.checkText);
    item.receipt.workflowCompletion.checkArtifactSha256 = sha(item.artifacts.checkText); rebind(item);
    assert.equal(score({records: [item]}).records[0].checks.artifactIntegrity, 'failed');
  }
  const unknown = record(); unknown.receipt.unknown = [{stage: 'resume'}]; rebind(unknown);
  assert.equal(score({records: [unknown]}).records[0].status, 'unknown');
});
test('bounded JSON admission rejects accessors, sparse/cyclic input and unknown fields without executing getters', () => {
  let calls = 0; const hostile = {get records() {calls++; return [];}};
  assert.throws(() => score(hostile)); assert.equal(calls, 0);
  const cyclic = {}; cyclic.x = cyclic;
  for (const value of [{records: new Array(3)}, {records: [], extra: true}, cyclic, {records: 'wrong'}]) assert.throws(() => score(value));
  const item = record(); item.receipt.authorization = 'secret'; assert.throws(() => score({records: [item]}));
});
