import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  classifyCiFailureStable, commentWriteAvailable, createGitHubWebhookServer, detectApiDocDrift, emptyTriggerState,
  indexKnowledgeFiles, initialCiLoop, loadSourcedCiEval, routeTrigger, runFixtureCiEval, runInjectedCiRepair, scanKnowledgeDirectory, stepCiLoop, summarizeDeveloperEval,
} from '../dist/index.js';

const sha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);

test('stable CI classification does not let a timeout hide a test assertion and flaky reruns once', () => {
  const mixed = classifyCiFailureStable({logExcerpt: 'AssertionError: expected 1\nThe runner timed out'});
  assert.equal(mixed.class, 'code');
  assert.equal(mixed.rerun.recommend, false);
  const flaky = classifyCiFailureStable({logExcerpt: 'Error: socket hang up', rerunCount: 0});
  assert.equal(flaky.class, 'flaky');
  assert.equal(flaky.rerun.recommend, true);
  assert.equal(classifyCiFailureStable({logExcerpt: 'Error: socket hang up', rerunCount: 1}).rerun.recommend, false);
});

test('webhook listener checks the signature and dedupes the same head', async () => {
  const seen = [];
  const server = await createGitHubWebhookServer({secret: 'top-secret', now: () => '2026-11-03T00:00:00.000Z', onEvent: event => seen.push(event)});
  const body = JSON.stringify({repository: {full_name: 'octo/repo'}, action: 'opened', pull_request: {number: 4, head: {sha}}});
  const sign = payload => `sha256=${createHmac('sha256', 'top-secret').update(payload).digest('hex')}`;
  const post = (payload, delivery, signature = sign(payload)) => fetch(server.url, {method: 'POST', headers: {
    'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-delivery': delivery, 'x-github-event': 'pull_request',
  }, body: payload});
  try {
    assert.equal((await post(body, 'd1', 'sha256=00')).status, 401);
    assert.equal((await post(body, 'd1')).status, 202);
    assert.equal(seen[0].headSha, sha);
    assert.notEqual(seen[0].receivedAt, '1970-01-01T00:00:00.000Z');
    assert.equal((await post(body, 'd2')).status, 200);
    assert.equal(seen.length, 1);
  } finally {await server.close();}
});

test('trigger routing dedupes a head, replans when the head changes, and ignores gaps', () => {
  const rule = {id: 'ci', source: 'check_run', match: {repo: 'octo/repo', conclusion: 'failure'}, action: {workflow: 'ci_fix'}, cooldownMs: 60_000, maxConcurrentPerRepo: 1};
  const event = extra => ({repo: 'octo/repo', source: 'check_run', deliveryId: 'd', number: 4, headSha: sha, conclusion: 'failure', ...extra});
  assert.equal(routeTrigger([rule], {...event(), gap: true}, emptyTriggerState(), 0).status, 'gap');
  const first = routeTrigger([rule], event(), emptyTriggerState(), 0);
  assert.equal(first.status, 'spawn');
  const state = {dispatched: [{dedupeKey: first.dedupeKey, taskId: 'goal-1', at: 0, headSha: sha, ruleId: 'ci'}], activeByRepo: {'octo/repo': 1}};
  assert.equal(routeTrigger([rule], event({deliveryId: 'd2'}), state, 10).status, 'deduped');
  assert.equal(routeTrigger([rule], event({deliveryId: 'd3', headSha: nextSha}), state, 10).status, 'busy');
  const idle = {...state, activeByRepo: {'octo/repo': 0}};
  const replanned = routeTrigger([rule], event({deliveryId: 'd3', headSha: nextSha}), idle, 10);
  assert.equal(replanned.status, 'spawn');
  assert.equal(replanned.supersededTaskId, 'goal-1');
});

test('CI loop waits for the bound head, reruns flaky once, then stops', () => {
  let state = initialCiLoop({repo: 'octo/repo', number: 4, maxRounds: 2});
  for (const signal of ['diagnosed', 'patched', 'verified', 'pushed']) state = stepCiLoop(state, signal, signal === 'pushed' ? sha : undefined);
  assert.equal(state.phase, 'await_ci');
  assert.equal(stepCiLoop(state, 'ci_green', nextSha).note, 'ignored ci for a different head');
  state = stepCiLoop(state, 'ci_flaky', sha);
  assert.equal(state.flakyReruns, 1);
  state = stepCiLoop(state, 'ci_flaky', sha);
  assert.equal(state.phase, 'diagnose');
  state = stepCiLoop(stepCiLoop(stepCiLoop(stepCiLoop(state, 'diagnosed'), 'patched'), 'verified'), 'pushed', nextSha);
  state = stepCiLoop(state, 'ci_red', nextSha);
  assert.equal(state.phase, 'stopped');
  assert.equal(commentWriteAvailable({policyComment: true, autonomy: {allow: true, mode: 'auto', risk: 'reversible_write'}}), true);
  assert.equal(commentWriteAvailable({policyComment: true, autonomy: {allow: false, mode: 'deny', risk: 'irreversible'}}), false);
});

test('knowledge scan ignores heavy directories, skips oversized files, and reuses unchanged digests', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'knowledge-scan-'));
  try {
    writeFileSync(path.join(root, 'AGENTS.md'), '# build\nexport function notCode\n');
    writeFileSync(path.join(root, 'api.ts'), 'export function listTasks() {}\n');
    mkdirSync(path.join(root, 'node_modules', 'pkg'), {recursive: true});
    writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'export function hidden() {}');
    writeFileSync(path.join(root, 'big.log'), 'x'.repeat(400));
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({scripts: {build: 'tsc', test: 'node --test'}}));
    const policy = {maxFileBytes: 200, maxTotalBytes: 8_000_000, maxFiles: 50, ignore: ['node_modules', 'dist', '.git']};
    const first = scanKnowledgeDirectory({repo: 'octo/repo', root, policy});
    assert.equal(first.evidenceLevel, 'local-scan');
    assert.ok(first.skipped.some(item => item.path.includes('node_modules') || item.reason === 'ignored' || item.path.endsWith('big.log')));
    assert.ok(first.implemented.includes('listTasks'));
    assert.ok(first.buildRecipes.includes('build'));
    const second = scanKnowledgeDirectory({repo: 'octo/repo', root, previous: first, policy});
    assert.equal(second.files.find(file => file.path === 'api.ts')?.reused, true);
    assert.equal(second.digest, first.digest);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('fixture CI eval uses the recorded excerpt and injected repair reruns flaky once', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/developer-duty-github.json', import.meta.url), 'utf8'));
  const sourcePath = 'packages/connectors/github/test/fixtures/developer-duty-github.json';
  const evaluated = runFixtureCiEval([{id: 'duty-log', sourcePath, excerpt: fixture.logExcerpt}]);
  assert.equal(evaluated.evidenceLevel, 'fixture');
  assert.equal(evaluated.results[0].sourcePath, sourcePath);
  assert.equal(evaluated.results[0].observedClass, 'environment');
  assert.equal(evaluated.labeled, 0);
  const reruns = [];
  const calls = [];
  let ciReads = 0;
  const repair = await runInjectedCiRepair({repo: 'octo/repo', number: 4, ports: {
    diagnose: async () => {calls.push('diagnose'); return 'flaky';},
    patch: async () => {calls.push('patch');},
    verify: async () => {calls.push('verify'); return true;},
    push: async () => {calls.push('push'); return 'a'.repeat(40);},
    rerun: async headSha => {reruns.push(headSha);},
    readCi: async () => {ciReads += 1; return ciReads === 1 ? 'flaky' : 'green';},
  }});
  assert.deepEqual(reruns, ['a'.repeat(40)]);
  assert.equal(repair.state.phase, 'green');
  assert.equal(repair.evidenceLevel, 'fixture');
  assert.ok(calls.includes('verify'));
});

test('incremental index keeps recipes from unchanged package files', () => {
  const first = indexKnowledgeFiles({repo: 'octo/repo', evidenceLevel: 'fixture', files: [
    {path: 'a/package.json', text: JSON.stringify({scripts: {build: 'tsc'}})},
    {path: 'b/package.json', text: JSON.stringify({scripts: {test: 'node --test'}})},
    {path: 'node_modules/pkg/index.js', text: 'export function hidden() {}'},
  ]});
  assert.equal(first.files.some(file => file.path.includes('node_modules')), false);
  assert.ok(first.skipped.some(item => item.reason === 'ignored'));
  const second = indexKnowledgeFiles({repo: 'octo/repo', previous: first, files: [
    {path: 'a/package.json', text: JSON.stringify({scripts: {build: 'tsc'}})},
    {path: 'b/package.json', text: JSON.stringify({scripts: {check: 'node --test test/*.mjs'}})},
  ]});
  assert.equal(second.files.find(file => file.path === 'a/package.json')?.reused, true);
  assert.ok(second.buildRecipes.includes('build'));
  assert.ok(second.testRecipes.includes('check'));
  assert.equal(second.testRecipes.includes('test'), false);
  const capped = indexKnowledgeFiles({repo: 'octo/repo', policy: {maxFileBytes: 100, maxTotalBytes: 30, maxFiles: 5}, files: [
    {path: 'one.ts', text: 'export function one() {}'},
    {path: 'two.ts', text: 'export function two() {}'},
  ]});
  assert.equal(capped.truncated, true);
  assert.ok(capped.skipped.some(item => item.reason === 'total size'));
});

test('sourced CI eval only classifies excerpts present in the cited files', () => {
  const root = fileURLToPath(new URL('../../../..', import.meta.url));
  const manifestPath = fileURLToPath(new URL('../fixtures/historical-ci-eval.json', import.meta.url));
  const loaded = loadSourcedCiEval({root, manifestPath});
  assert.equal(loaded.sourcesVerified, true);
  assert.equal(loaded.evidenceLevel, 'fixture');
  assert.equal(loaded.evaluation.labeled, 0);
  const byId = Object.fromEntries(loaded.evaluation.results.map(item => [item.id, item.observedClass]));
  assert.equal(byId['duty-fixture-log'], 'environment');
  assert.equal(byId['wiring-pr-39172889704'], 'unknown');
  assert.equal(byId['wiring-push-39172886287'], 'unknown');
  assert.equal(loaded.cases.find(item => item.id === 'wiring-pr-39172889704')?.recordedRunId, 39172889704);
  assert.throws(() => loadSourcedCiEval({root, manifestPath: manifestPath.replace('historical-ci-eval.json', 'missing.json')}));
});

test('injected CI repair reruns a flaky head and does not patch an environment failure', async () => {
  const head = 'b'.repeat(40);
  let reads = 0;
  let patched = false;
  const flaky = await runInjectedCiRepair({repo: 'octo/repo', number: 4, currentHead: head, ports: {
    diagnose: async () => 'flaky',
    patch: async () => {patched = true;},
    verify: async () => true,
    push: async () => 'c'.repeat(40),
    rerun: async () => {},
    readCi: async () => {
      reads += 1;
      return reads === 1 ? {status: 'red', logExcerpt: 'Error: socket hang up'} : {status: 'green', logExcerpt: 'passed'};
    },
  }});
  assert.equal(patched, false);
  assert.deepEqual(flaky.reruns, [head]);
  assert.equal(flaky.state.phase, 'green');
  assert.equal(flaky.evidenceLevel, 'fixture');
  const environment = await runInjectedCiRepair({repo: 'octo/repo', number: 4, ports: {
    diagnose: async () => 'environment',
    patch: async () => {patched = true;},
    verify: async () => true,
    push: async () => head,
    rerun: async () => {},
    readCi: async () => ({status: 'red', logExcerpt: 'Error: connect ECONNRESET while downloading actions/setup-node'}),
  }});
  assert.equal(environment.state.phase, 'stopped');
  assert.equal(environment.state.note, 'environment failure is not patched');
  assert.equal(patched, false);
});

test('API drift and eval summaries only use the supplied rows', () => {
  const drift = detectApiDocDrift({implemented: ['GET /tasks'], documented: [], previousDigest: 'old'});
  assert.equal(drift.drift, true);
  assert.deepEqual(drift.missingInDocs, ['GET /tasks']);
  const summary = summarizeDeveloperEval({caseIds: ['a', 'b'], outcomes: [{id: 'a', fixed: true, rounds: 2, cost: 1}]});
  assert.deepEqual(summary.missing, ['b']);
  assert.equal(summary.fixRate, 1);
  assert.equal(summary.evidenceLevel, 'fixture');
});
