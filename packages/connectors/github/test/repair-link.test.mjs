import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import {GhCliProvider, GitHubService, FakeGitHubProvider, register} from '../dist/index.js';
import {githubRepairCheckName, githubRepairOperations, registerGitHubRepairLinks} from '../dist/repair-link.js';
import {inputSchema} from '../dist/schemas.js';
import {outputSchema} from '../dist/output-schemas.js';

const repo = 'example/repository', token = 'ghp_syntheticrepaircredential0123456789';
const identity = {repo, runId: 31, expectedRunAttempt: 2, sourceSha: 'a'.repeat(40), repairPrNumber: 9,
  repairHeadSha: 'b'.repeat(40), workflowExecutionId: createHash('sha256').update('original-synthetic-tool-run').digest('hex')};
const context = () => ({signal: new AbortController().signal, deadline: new Date(Date.now()+5000).toISOString()});
const toolContext = (write = true) => ({...context(), taskId: 'synthetic-task', runId: 'synthetic-run', authorizationRef: 'synthetic-grant', scopes: [write ? 'github:write' : 'github:read']});
const failedRun = (overrides = {}) => ({id: identity.runId, repository: {full_name: repo}, run_attempt: 2, head_sha: identity.sourceSha, status: 'completed', conclusion: 'failure', ...overrides});
const openPull = (overrides = {}) => ({number: identity.repairPrNumber, state: 'open', base: {repo: {full_name: repo}}, head: {sha: identity.repairHeadSha, repo: {full_name: repo}}, html_url: `https://github.com/${repo}/pull/9`, ...overrides});
function checkRecord(input = identity, id = 101, overrides = {}) {
  const normalized = {...input, sourceSha: input.sourceSha.toLowerCase(), repairHeadSha: input.repairHeadSha.toLowerCase()};
  const name = githubRepairCheckName(input), digest = name.slice('PersonalAgent repair link / '.length);
  return {id, url: `https://api.github.com/repos/${repo}/check-runs/${id}`, html_url: `https://github.com/${repo}/runs/${id}`,
    name, external_id: `personalagent-repair-link-v1:${digest}`, head_sha: normalized.sourceSha,
    details_url: `https://github.com/${repo}/pull/${input.repairPrNumber}`, status: 'completed', conclusion: 'neutral',
    output: {title: 'Repair PR association; original CI result unchanged',
      summary: 'This neutral check only associates a repair pull request with the original failed run. It does not validate the repair or change the original CI result.\n\n'+JSON.stringify(normalized)}, ...overrides};
}
function provider(responses) {
  const calls = [], runner = {async run(command) {
    calls.push(command); const next = responses.shift(); assert.notEqual(next, undefined, 'unexpected GitHub request');
    if (next instanceof Error) throw next;
    const value = typeof next === 'function' ? await next(command) : next;
    return value.exitCode !== undefined ? value : {exitCode: 0, stdout: JSON.stringify(value), stderr: ''};
  }};
  return {calls, value: new GhCliProvider({runner, readToken: async () => token, repositories: [repo]})};
}
const method = command => command.args[command.args.indexOf('--method')+1];
const endpoint = command => command.args[command.args.indexOf('--method')+2];
const unknown = id => ({state: 'unknown', ...(id === undefined ? {} : {checkRunId: id, externalId: String(id), url: `https://github.com/${repo}/runs/${id}`}), evidenceRefs: []});

test('repair association creates one independent neutral CheckRun on the failed source SHA and reads back the same object', async () => {
  const record = checkRecord(), p = provider([failedRun(), openPull(), record, record]);
  const result = await p.value.execute('actions.repair.link', identity, context());
  assert.equal(result.state, 'confirmed');
  assert.deepEqual(Object.fromEntries(Object.keys(identity).map(key => [key, result[key]])), identity);
  assert.equal(result.checkRunId, 101); assert.equal(result.externalId, '101');
  assert.equal(result.detailsUrl, `https://github.com/${repo}/pull/9`); assert.equal(result.conclusion, 'neutral');
  assert.deepEqual(p.calls.map(c => [method(c), endpoint(c)]), [
    ['GET', `repos/${repo}/actions/runs/31`], ['GET', `repos/${repo}/pulls/9`],
    ['POST', `repos/${repo}/check-runs`], ['GET', `repos/${repo}/check-runs/101`]]);
  const body = JSON.parse(p.calls[2].stdin);
  assert.equal(body.head_sha, identity.sourceSha); assert.equal(body.status, 'completed'); assert.equal(body.conclusion, 'neutral');
  assert.equal(body.name, githubRepairCheckName(identity)); assert.equal(body.details_url, result.detailsUrl);
  assert.match(body.output.summary, /does not validate the repair/); assert.ok(!p.calls.some(c => method(c) === 'PATCH'));
  assert.ok(p.calls.every(c => !c.args.join(' ').includes(token))); assert.ok(!JSON.stringify(result).includes(token));
  validateToolValue(outputSchema('actions.repair.link'), result);
});

test('failed run fresh-read drift refuses all writes', async t => {
  for (const [name, change] of Object.entries({rerun: {run_attempt: 3}, sha: {head_sha: 'c'.repeat(40)},
    running: {status: 'in_progress'}, cancelled: {conclusion: 'cancelled'}, success: {conclusion: 'success'},
    wrongRun: {id: 32}, wrongRepo: {repository: {full_name: 'other/repository'}}})) await t.test(name, async () => {
    const p = provider([failedRun(change)]);
    await assert.rejects(p.value.execute('actions.repair.link', identity, context()), e => e.code === 'REVISION_CONFLICT');
    assert.equal(p.calls.length, 1); assert.ok(p.calls.every(c => method(c) === 'GET'));
  });
});

test('repair PR drift and cross-repository targets refuse all writes', async t => {
  for (const [name, change] of Object.entries({closed: {state: 'closed'}, head: {head: {sha: 'c'.repeat(40), repo: {full_name: repo}}},
    wrongNumber: {number: 10}, wrongBase: {base: {repo: {full_name: 'other/repository'}}},
    fork: {head: {sha: identity.repairHeadSha, repo: {full_name: 'other/repository'}}},
    wrongUrl: {html_url: 'https://github.com/other/repository/pull/9'}})) await t.test(name, async () => {
    const p = provider([failedRun(), openPull(change)]);
    await assert.rejects(p.value.execute('actions.repair.link', identity, context()), e => e.code === 'REVISION_CONFLICT');
    assert.equal(p.calls.length, 2); assert.ok(p.calls.every(c => method(c) === 'GET'));
  });
});

test('every fixed CheckRun readback field is verified after dispatch without POST retry', async t => {
  const good = checkRecord();
  for (const [name, change] of Object.entries({id: {id: 102}, name: {name: 'Existing CI'},
    external: {external_id: 'unrelated'}, sha: {head_sha: identity.repairHeadSha}, status: {status: 'in_progress'},
    conclusion: {conclusion: 'success'}, details: {details_url: 'https://github.com/other/repository/pull/9'},
    apiUrl: {url: 'https://api.github.com/repos/other/repository/check-runs/101'},
    htmlUrl: {html_url: good.html_url+'?unexpected=1'},
    title: {output: {...good.output, title: 'CI passed'}}, summary: {output: {...good.output, summary: 'unbound claim'}},
    missing: {output: undefined}})) await t.test(name, async () => {
    const p = provider([failedRun(), openPull(), good, checkRecord(identity, 101, change)]);
    assert.deepEqual(await p.value.execute('actions.repair.link', identity, context()), unknown(101));
    assert.equal(p.calls.length, 4); assert.equal(p.calls.filter(c => method(c) === 'POST').length, 1);
  });
});

test('contradictory or malformed creation and readback are unknown, preserving only a known original identifier', async t => {
  for (const [name, response, id] of [
    ['contradiction', checkRecord(identity, 101, {conclusion: 'success'}), 101],
    ['missing ID', {name: 'no id'}, undefined],
    ['malformed JSON', {exitCode: 0, stdout: 'invalid '+token, stderr: ''}, undefined],
    ['POST timeout', new ProtocolError('TIMEOUT', token), undefined],
    ['POST rejected', {exitCode: 1, stdout: '', stderr: 'HTTP 403 '+token}, undefined]]) await t.test(name, async () => {
    const p = provider([failedRun(), openPull(), response]);
    const result = await p.value.execute('actions.repair.link', identity, context());
    assert.deepEqual(result, unknown(id)); assert.equal(p.calls.length, 3); assert.ok(!JSON.stringify(result).includes(token));
  });
  const p = provider([failedRun(), openPull(), checkRecord(), new ProtocolError('NOT_FOUND', token)]);
  assert.deepEqual(await p.value.execute('actions.repair.link', identity, context()), unknown(101));
  assert.equal(p.calls.length, 4);
});

test('independent reconciliation reads exactly the original known CheckRun, with no mutable run/PR lookup or write', async () => {
  const p = provider([checkRecord()]);
  const receipt = await p.value.execute('actions.repair.get', {...identity, checkRunId: 101}, context());
  assert.equal(Object.hasOwn(receipt, 'state'), false); assert.equal(receipt.checkRunId, 101);
  validateToolValue(outputSchema('actions.repair.get'), receipt);
  assert.deepEqual(p.calls.map(c => [method(c), endpoint(c)]), [['GET', `repos/${repo}/check-runs/101`]]);
  const wrong = provider([checkRecord()]);
  await assert.rejects(wrong.value.execute('actions.repair.get', {...identity, workflowExecutionId: 'c'.repeat(64), checkRunId: 101}, context()), e => e.code === 'EXTERNAL_FAILURE');
  assert.equal(wrong.calls.length, 1);
});

test('CheckRun focus URL compatibility preserves the safe URL and refuses arbitrary query, fragment and origin', async t => {
  const url = `https://github.com/${repo}/runs/101?check_suite_focus=true`, record = checkRecord(identity, 101, {html_url: url});
  const p = provider([failedRun(), openPull(), record, record]);
  assert.equal((await p.value.execute('actions.repair.link', identity, context())).url, url);
  const read = provider([record]);assert.equal((await read.value.execute('actions.repair.get', {...identity, checkRunId: 101}, context())).url, url);
  for (const bad of [url+'&extra=1', url+'#fragment', url.replace('github.com', 'evil.example'),
    url.replace('https://', 'https://user@'), url.replace('/runs/101', '/runs/102'), url.replace('true', 'false')]) await t.test(bad, async () => {
    const invalid = provider([checkRecord(identity, 101, {html_url: bad})]);
    await assert.rejects(invalid.value.execute('actions.repair.get', {...identity, checkRunId: 101}, context()), e => e.code === 'EXTERNAL_FAILURE');
    assert.equal(invalid.calls.length, 1);
  });
});

test('repair input identity is strict, bounded and rejected before credential or network access', async t => {
  for (const [name, change] of Object.entries({unsafeRun: {runId: Number.MAX_SAFE_INTEGER+1}, zeroAttempt: {expectedRunAttempt: 0},
    invalidSha: {sourceSha: 'not-a-sha'}, unsafePr: {repairPrNumber: -1}, invalidHead: {repairHeadSha: 'b'.repeat(41)},
    unhashedWorkflow: {workflowExecutionId: 'model-supplied-id'}, arbitraryName: {name: 'Existing CI'}, arbitraryUrl: {detailsUrl: 'https://evil.example'},
    arbitraryConclusion: {conclusion: 'success'}})) await t.test(name, async () => {
    let credentials = 0;const p = new GhCliProvider({runner: {run() {assert.fail('must not dispatch');}}, readToken: async () => {credentials++;return token;}, repositories: [repo]});
    await assert.rejects(p.execute('actions.repair.link', {...identity, ...change}, context()), e => e.code === 'INVALID_ARGUMENT');
    assert.equal(credentials, 0);
  });
  assert.throws(() => validateToolValue(inputSchema('actions.repair.get'), identity));
});

test('SHA formats accept 40 or 64 hex and normalize case without fallback to another API', async () => {
  const input = {...identity, sourceSha: 'A'.repeat(64), repairHeadSha: 'B'.repeat(64)};
  const record = checkRecord(input), p = provider([failedRun({head_sha: 'a'.repeat(64)}), openPull({head: {sha: 'b'.repeat(64), repo: {full_name: repo}}}), record, record]);
  const result = await p.value.execute('actions.repair.link', input, context());
  assert.equal(result.state, 'confirmed');assert.equal(result.sourceSha, 'a'.repeat(64));assert.equal(JSON.parse(p.calls[2].stdin).head_sha, 'a'.repeat(64));
  const rejected = provider([failedRun({head_sha: 'a'.repeat(64)}), openPull({head: {sha: 'b'.repeat(64), repo: {full_name: repo}}}), {exitCode: 1, stdout: '', stderr: 'HTTP 422 unsupported SHA'}]);
  assert.deepEqual(await rejected.value.execute('actions.repair.link', input, context()), unknown());assert.equal(rejected.calls.length, 3);
});

test('repair schemas validate confirmed/unknown oneOf and reject incomplete or success-shaped receipts', () => {
  validateToolValue(outputSchema('actions.repair.link'), unknown());validateToolValue(outputSchema('actions.repair.link'), unknown(101));
  const receipt = {...identity, checkRunId: 101, externalId: '101', url: `https://github.com/${repo}/runs/101`, name: githubRepairCheckName(identity),
    detailsUrl: `https://github.com/${repo}/pull/9`, status: 'completed', conclusion: 'neutral', evidenceRefs: []};
  validateToolValue(outputSchema('actions.repair.link'), {state: 'confirmed', ...receipt});
  assert.throws(() => validateToolValue(outputSchema('actions.repair.link'), {state: 'confirmed', evidenceRefs: []}));
  assert.throws(() => validateToolValue(outputSchema('actions.repair.link'), {state: 'confirmed', ...receipt, conclusion: 'success'}));
  assert.throws(() => validateToolValue(outputSchema('actions.repair.link'), {...unknown(), detailsUrl: 'https://evil.example'}));
  assert.throws(() => validateToolValue(outputSchema('actions.repair.get'), {state: 'confirmed', ...receipt}));
});

test('pre-cancelled and expired repair calls dispatch nothing; cancellation after POST remains unknown', async () => {
  const pre = provider([]), controller = new AbortController();controller.abort();
  await assert.rejects(pre.value.execute('actions.repair.link', identity, {...context(), signal: controller.signal}), e => e.code === 'CANCELLED');
  await assert.rejects(pre.value.execute('actions.repair.get', {...identity, checkRunId: 101}, {...context(), deadline: '2000-01-01T00:00:00Z'}), e => e.code === 'TIMEOUT');
  assert.equal(pre.calls.length, 0);
  const cancelled = new AbortController();
  const post = provider([failedRun(), openPull(), () => {cancelled.abort(); return checkRecord();}]);
  assert.deepEqual(await post.value.execute('actions.repair.link', identity, {...context(), signal: cancelled.signal}), unknown());assert.equal(post.calls.length, 3);
  const readbackCancelled = new AbortController();
  const after = provider([failedRun(), openPull(), checkRecord(), () => {readbackCancelled.abort(); return checkRecord();}]);
  assert.deepEqual(await after.value.execute('actions.repair.link', identity, {...context(), signal: readbackCancelled.signal}), unknown(101));assert.equal(after.calls.length, 4);
});

test('service bounds non-cooperating repair write/read providers and keeps unknown writes unconfirmed', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: Date.parse('2026-10-05T00:00:00Z')});
  const service = new GitHubService({verification: 'mock', execute: () => new Promise(() => {})});
  const write = service.execute('actions.repair.link', identity, context());t.mock.timers.tick(5000);assert.deepEqual(await write, unknown());
  const read = service.execute('actions.repair.get', {...identity, checkRunId: 101}, context());
  const rejected = assert.rejects(read, e => e.code === 'TIMEOUT');t.mock.timers.tick(5000);await rejected;service.dispose();
});

test('late POST or same-object readback cannot confirm a repair association after its deadline', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: Date.parse('2026-10-05T00:00:00Z')});
  for (const during of ['POST', 'readback']) await t.test(during, async () => {
    const late = () => {t.mock.timers.setTime(Date.now()+5001);return checkRecord();};
    const responses = during === 'POST' ? [failedRun(), openPull(), late] : [failedRun(), openPull(), checkRecord(), late];
    const p = provider(responses);
    assert.deepEqual(await p.value.execute('actions.repair.link', identity, context()), unknown(during === 'POST' ? undefined : 101));
    assert.equal(p.calls.filter(c => method(c) === 'POST').length, 1);
  });
});

test('repair read errors and untrusted response text never expose credentials', async () => {
  const failed = provider([{exitCode: 1, stdout: '', stderr: 'HTTP 403 '+token}]);
  await assert.rejects(failed.value.execute('actions.repair.get', {...identity, checkRunId: 101}, context()), e => e.code === 'SCOPE_DENIED' && !e.message.includes(token));
  const malformed = provider([checkRecord(identity, 101, {output: {title: token, summary: token}})]);
  await assert.rejects(malformed.value.execute('actions.repair.get', {...identity, checkRunId: 101}, context()), e => e.code === 'EXTERNAL_FAILURE' && !e.message.includes(token));
  for (const key of ['runId', 'expectedRunAttempt', 'repairPrNumber']) assert.notEqual(githubRepairCheckName({...identity, [key]: identity[key]+1}), githubRepairCheckName(identity));
  assert.notEqual(githubRepairCheckName({...identity, workflowExecutionId: 'c'.repeat(64)}), githubRepairCheckName(identity));
});

test('default Fake registration remains fourteen tools and missing repair fixtures are unsupported', async () => {
  const tools = new Map(), fake = new FakeGitHubProvider({});
  const dispose = register({register(tool) {tools.set(tool.descriptor.name, tool);return () => tools.delete(tool.descriptor.name);}}, {provider: fake});
  assert.equal(tools.size, 14);assert.equal(tools.has('github.actions.repair.link'), false);
  await assert.rejects(fake.execute('actions.repair.get', {...identity, checkRunId: 101}, context()), e => e.code === 'UNSUPPORTED_CAPABILITY');
  dispose();
});

test('optional registration binds approval scope/presence, propagates unknown, and never disposes a caller-owned provider', async () => {
  const tools = new Map();let disposed = 0;
  const fake = new FakeGitHubProvider({'actions.repair.link': unknown()});fake.dispose = () => {disposed++;};
  const host = {register(tool) {tools.set(tool.descriptor.name, tool);return () => tools.delete(tool.descriptor.name);}};
  const disposeDefault = register(host, {provider: fake}), disposeRepair = registerGitHubRepairLinks(host, {provider: fake});
  assert.equal(tools.size, 16);assert.deepEqual(githubRepairOperations, ['actions.repair.link', 'actions.repair.get']);
  const write = tools.get('github.actions.repair.link'), read = tools.get('github.actions.repair.get');
  assert.equal(write.descriptor.sideEffect, 'external_write');assert.deepEqual(write.descriptor.requiredScopes, ['github:write']);
  assert.equal(write.descriptor.requiresPresence, true);assert.equal(write.descriptor.idempotencySupport, false);assert.equal(write.descriptor.recoverySupport, false);
  assert.equal(read.descriptor.sideEffect, 'read');assert.deepEqual(read.descriptor.requiredScopes, ['github:read']);
  assert.equal(read.descriptor.requiresPresence, false);assert.equal(read.descriptor.idempotencySupport, true);assert.equal(read.descriptor.recoverySupport, true);
  await assert.rejects(write.execute(identity, {...toolContext(), authorizationRef: ''}), e => e.code === 'SCOPE_DENIED');
  await assert.rejects(write.execute(identity, toolContext(false)), e => e.code === 'SCOPE_DENIED');assert.equal(fake.calls.length, 0);
  await assert.rejects(write.execute(identity, toolContext()), e => e.code === 'RESULT_UNKNOWN');assert.equal(fake.calls.length, 1);
  disposeRepair();disposeRepair();assert.equal(tools.size, 14);assert.equal(disposed, 0);
  await assert.rejects(fake.execute('repo.get', {repo}, context()), e => e.code === 'UNSUPPORTED_CAPABILITY');
  disposeDefault();assert.equal(disposed, 1);assert.equal(tools.size, 0);
});

test('optional registration rejects malformed provider success and rolls back only its own partial registration', async () => {
  let disposed = 0;const provider = {verification: 'mock', execute: async () => ({state: 'confirmed', evidenceRefs: []}), dispose() {disposed++;}};
  const tools = new Map(), unregister = registerGitHubRepairLinks({register(tool) {tools.set(tool.descriptor.name, tool);return () => tools.delete(tool.descriptor.name);}}, {provider});
  await assert.rejects(tools.get('github.actions.repair.link').execute(identity, toolContext()), e => e.code === 'RESULT_UNKNOWN');
  await assert.rejects(tools.get('github.actions.repair.get').execute({...identity, checkRunId: 101}, toolContext(false)), e => e.code === 'EXTERNAL_FAILURE');
  unregister();assert.equal(disposed, 0);
  const original = new Map([['github.repo.get', 'owned elsewhere']]);let count = 0;
  assert.throws(() => registerGitHubRepairLinks({register(tool) {if (++count === 2) throw Error('synthetic registration failure');original.set(tool.descriptor.name, tool);return () => original.delete(tool.descriptor.name);}}, {provider}));
  assert.deepEqual([...original], [['github.repo.get', 'owned elsewhere']]);assert.equal(disposed, 0);
});

test('unknown observer preserves the original partial CheckRun identifier and full execution context without another POST', async () => {
  const p = provider([failedRun(), openPull(), checkRecord(), new ProtocolError('NOT_FOUND', 'synthetic readback failure')]);
  const execute = p.value.execute.bind(p.value);let providerResult;
  p.value.execute = async (...args) => {providerResult = await execute(...args);return providerResult;};
  const tools = new Map(), actualInput = structuredClone(identity), actualContext = toolContext(), observations = [];
  const dispose = registerGitHubRepairLinks({register(tool) {tools.set(tool.descriptor.name, tool);return () => tools.delete(tool.descriptor.name);}}, {
    provider: p.value, observeUnknown(input, result, context) {
      observations.push({input: structuredClone(input), result: structuredClone(result), context,
        sharedInput: input === actualInput, sharedResult: result === providerResult});
      input.runId = 999;result.checkRunId = 999;result.evidenceRefs.push('observer-local-only');
      return undefined;
    },
  });
  try {
    await assert.rejects(tools.get('github.actions.repair.link').execute(actualInput, actualContext), e => e.code === 'RESULT_UNKNOWN' && !e.retryable);
    assert.equal(observations.length, 1);assert.deepEqual(observations[0].input, identity);assert.deepEqual(observations[0].result, unknown(101));
    assert.equal(observations[0].context, actualContext);assert.equal(observations[0].sharedInput, false);assert.equal(observations[0].sharedResult, false);
    assert.deepEqual(actualInput, identity);assert.deepEqual(providerResult, unknown(101));
    assert.equal(p.calls.filter(c => method(c) === 'POST').length, 1);assert.equal(p.calls.length, 4);
  } finally {dispose();}
});

test('unknown observer sees missing-ID candidates but never invalid, unauthorized, confirmed or read results', async () => {
  const tools = new Map(), observations = [];let output = unknown(), providerCalls = 0;
  const readReceipt = {...identity, checkRunId: 101, externalId: '101', url: `https://github.com/${repo}/runs/101`, name: githubRepairCheckName(identity),
    detailsUrl: `https://github.com/${repo}/pull/9`, status: 'completed', conclusion: 'neutral', evidenceRefs: []};
  const dispose = registerGitHubRepairLinks({register(tool) {tools.set(tool.descriptor.name, tool);return () => tools.delete(tool.descriptor.name);}}, {
    provider: {verification: 'mock', execute: async () => {providerCalls++;return output;}},
    observeUnknown(input, result, context) {observations.push({input, result, context});return undefined;},
  });
  try {
    const write = tools.get('github.actions.repair.link');
    await assert.rejects(write.execute(identity, {...toolContext(), authorizationRef: ''}), e => e.code === 'SCOPE_DENIED');
    await assert.rejects(write.execute(identity, toolContext(false)), e => e.code === 'SCOPE_DENIED');
    await assert.rejects(write.execute({...identity, arbitrary: 'invalid'}, toolContext()), e => e.code === 'INVALID_ARGUMENT');
    assert.equal(observations.length, 0);assert.equal(providerCalls, 0);
    for (output of [{state: 'unknown', evidenceRefs: [], checkRunId: 0}, {state: 'unknown', evidenceRefs: [], arbitrary: 'invalid'}, {state: 'unknown'}]) {
      await assert.rejects(write.execute(identity, toolContext()), e => e.code === 'RESULT_UNKNOWN');assert.equal(observations.length, 0);
    }
    output = {state: 'confirmed', ...readReceipt};assert.equal((await write.execute(identity, toolContext())).state, 'confirmed');assert.equal(observations.length, 0);
    output = readReceipt;await tools.get('github.actions.repair.get').execute({...identity, checkRunId: 101}, toolContext(false));assert.equal(observations.length, 0);
    output = unknown();const actualContext = toolContext();await assert.rejects(write.execute(identity, actualContext), e => e.code === 'RESULT_UNKNOWN');assert.equal(observations.length, 1);
    assert.deepEqual(observations[0].input, identity);assert.deepEqual(observations[0].result, unknown());assert.equal(observations[0].context, actualContext);
  } finally {dispose();}
});

test('observer persistence failure retains fixed non-retryable unknown and never authorizes a second write', async () => {
  const tools = new Map(), fake = new FakeGitHubProvider({'actions.repair.link': unknown(101)});let observed = 0;
  const dispose = registerGitHubRepairLinks({register(tool) {tools.set(tool.descriptor.name, tool);return () => tools.delete(tool.descriptor.name);}}, {
    provider: fake, observeUnknown() {observed++;throw Error('private persistence path synthetic-secret');},
  });
  try {
    await assert.rejects(tools.get('github.actions.repair.link').execute(identity, toolContext()), e => e.code === 'RESULT_UNKNOWN' && !e.retryable && !/private|synthetic-secret/.test(e.message));
    assert.equal(observed, 1);assert.equal(fake.calls.length, 1);
  } finally {dispose();}
});

test('accidental asynchronous observers cannot hold the tool or leak an unhandled rejection', async t => {
  const unhandled = [], record = error => unhandled.push(error);process.on('unhandledRejection', record);t.after(() => process.off('unhandledRejection', record));
  for (const [name, hook] of [['rejecting promise', () => Promise.reject(Error('synthetic observer rejection'))],
    ['never-settling promise', () => new Promise(() => {})], ['rejecting thenable', () => ({then(_resolve, reject) {reject(Error('synthetic thenable rejection'));}})]]) await t.test(name, {timeout: 1000}, async () => {
    const tools = new Map(), fake = new FakeGitHubProvider({'actions.repair.link': unknown(101)});let observed = 0;
    const dispose = registerGitHubRepairLinks({register(tool) {tools.set(tool.descriptor.name, tool);return () => tools.delete(tool.descriptor.name);}}, {
      provider: fake, observeUnknown(...args) {observed++;return hook(...args);},
    });
    try {
      await assert.rejects(tools.get('github.actions.repair.link').execute(identity, toolContext()), e => e.code === 'RESULT_UNKNOWN' && !e.retryable);
      await new Promise(resolve => setImmediate(resolve));assert.equal(observed, 1);assert.equal(fake.calls.length, 1);assert.deepEqual(unhandled, []);
    } finally {dispose();}
  });
});
