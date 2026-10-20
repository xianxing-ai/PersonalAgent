import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, realpathSync, writeFileSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {join, resolve, delimiter} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {openControlledVaultWriter, createKnowledgeWriteTool, KNOWLEDGE_WRITE_SCOPES} from '../dist/write.js';

const powerShellPath = process.env.PA_TEST_POWERSHELL ?? (process.env.PATH ?? '').split(delimiter)
  .map(directory => join(directory, 'pwsh.exe')).find(existsSync);
const windows = process.platform === 'win32' && Boolean(powerShellPath);
const processIdentityHelperPath = process.env.PA_TEST_JOB_HOST_EXE;
const nativeIdentity = process.platform === 'win32' && typeof processIdentityHelperPath === 'string'
  && existsSync(processIdentityHelperPath) ? processIdentityHelperPath : undefined;
const digest = value => createHash('sha256').update(value).digest('hex');
const inputDigest = input => {
  const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
    : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
      : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return digest(canonical(input));
};
const original = '\uFEFF---\r\nowner: demo\r\n---\r\n# 公开合成笔记\r\n保留 [[来源]] 与 [文档](target.md)\r\n待整理段落\r\n';
async function fixture(t, useNativeIdentity = nativeIdentity !== undefined) {
  const parent = fileURLToPath(new URL('../../../data/test-tmp/', import.meta.url));
  await mkdir(parent, {recursive: true});
  const base = await mkdtemp(join(parent, 'knowledge-write-'));
  const root = join(base, 'vault'), recovery = join(base, 'recovery');
  await mkdir(root); await mkdir(recovery);
  await writeFile(join(root, 'demo.md'), original, 'utf8');
  t.after(() => rm(base, {recursive: true, force: true}));
  let enabled = true;
  const options = {rootPath: root, recoveryRootPath: recovery, powerShellPath, sourceId: 'synthetic',
    configRevision: 1, allowedNotePaths: ['demo.md'], bindingCurrent: () => enabled,
    ...(useNativeIdentity && nativeIdentity ? {processIdentityHelperPath: nativeIdentity} : {})};
  const writer = openControlledVaultWriter(options);
  const input = {sourceId: 'synthetic', configRevision: 1, path: 'demo.md', expectedSha256: digest(original),
    edits: [{oldText: '待整理段落', newText: '已整理的合成段落'}]};
  const context = (overrides = {}) => ({taskId: 'task', runId: randomUUID(), authorizationRef: 'test-authorized',
    argumentsDigest: inputDigest(input), scopes: KNOWLEDGE_WRITE_SCOPES,
    deadline: new Date(Date.now() + 30000).toISOString(), signal: new AbortController().signal, ...overrides});
  return {root, recovery, writer, options, input, context, revoke: () => {enabled = false;}};
}

test('selected-note locked write preserves BOM/frontmatter/links and keeps a recoverable backup; replay cannot write', {skip: !windows}, async t => {
  const {root, recovery, writer, options, input, context} = await fixture(t);
  const authorized = context();
  const result = await createKnowledgeWriteTool(writer).execute(input, authorized);
  assert.equal(result.state, 'verified');
  assert.equal(await readFile(join(root, 'demo.md'), 'utf8'), original.replace('待整理段落', '已整理的合成段落'));
  assert.equal(await readFile(join(recovery, result.backupId), 'utf8'), original);
  assert.equal(digest(await readFile(join(root, 'demo.md'))), result.afterSha256);
  await assert.rejects(writer.apply(input, authorized), error => error.code === 'RESULT_UNKNOWN');
  await assert.rejects(openControlledVaultWriter(options).apply(input, authorized), error => error.code === 'RESULT_UNKNOWN');
  const reconciliation = await writer.reconcile({taskId: authorized.taskId, runId: authorized.runId,
    argumentsDigest: authorized.argumentsDigest}, authorized);
  assert.equal(reconciliation.state, 'applied');
  const reselected = openControlledVaultWriter({...options, sourceId: 'reselected', configRevision: 2});
  assert.equal((await reselected.reconcile({taskId: authorized.taskId, runId: authorized.runId,
    argumentsDigest: authorized.argumentsDigest}, authorized)).state, 'applied');
  assert.equal(JSON.stringify(result).includes(root), false);
});

test('selected-note locked write can use the trusted native process identity helper', {
  skip: !windows || nativeIdentity === undefined,
}, async t => {
  const {root, recovery, writer, input, context} = await fixture(t, true);
  const result = await createKnowledgeWriteTool(writer).execute(input, context());
  assert.equal(result.state, 'verified');
  assert.equal(await readFile(join(root, 'demo.md'), 'utf8'), original.replace('待整理段落', '已整理的合成段落'));
  assert.equal(existsSync(join(recovery, result.backupId)), true);
});

test('selected-note locked write keeps the explicit PowerShell identity fallback', {skip: !windows}, async t => {
  const {root, recovery, writer, input, context} = await fixture(t, false);
  const result = await createKnowledgeWriteTool(writer).execute(input, context());
  assert.equal(result.state, 'verified');
  assert.equal(await readFile(join(root, 'demo.md'), 'utf8'), original.replace(String.fromCodePoint(0x5f85, 0x6574, 0x7406, 0x6bb5, 0x843d), String.fromCodePoint(0x5df2, 0x6574, 0x7406, 0x7684, 0x5408, 0x6210, 0x6bb5, 0x843d)));
  assert.equal(existsSync(join(recovery, result.backupId)), true);
});

test('baseline conflict preserves user edit and produces no backup or write', {skip: !windows}, async t => {
  const {root, recovery, writer, input, context} = await fixture(t);
  const edited = original + '用户刚刚修改\r\n';
  await writeFile(join(root, 'demo.md'), edited);
  await assert.rejects(writer.apply(input, context()), error => error.code === 'REVISION_CONFLICT');
  assert.equal(await readFile(join(root, 'demo.md'), 'utf8'), edited);
  assert.deepEqual(await readdir(recovery), []);
});

test('metadata, link removal, unselected paths and substituted source/revision fail before a write', {skip: !windows}, async t => {
  const {root, recovery, writer, input, context} = await fixture(t);
  for (const edits of [[{oldText: 'owner: demo', newText: 'owner: changed'}],
    [{oldText: '[[来源]]', newText: '来源'}], [{oldText: '[文档](target.md)', newText: '文档'}]]) {
    const changed = {...input, edits};
    await assert.rejects(writer.apply(changed, context({argumentsDigest: inputDigest(changed)})), error => error.code === 'SCOPE_DENIED');
  }
  for (const path of ['../outside.md', 'other.md', 'D:/outside.md']) {
    await assert.rejects(writer.apply({...input, path}, context()));
  }
  await assert.rejects(writer.apply({...input, configRevision: 2}, context()), error => error.code === 'REVISION_CONFLICT');
  await assert.rejects(writer.apply({...input, sourceId: 'other'}, context()), error => error.code === 'REVISION_CONFLICT');
  assert.equal(await readFile(join(root, 'demo.md'), 'utf8'), original);
  assert.deepEqual(await readdir(recovery), []);
});

test('revocation, missing scope, cancellation and deadline stop before helper dispatch', {skip: !windows}, async t => {
  const {root, recovery, writer, input, context, revoke} = await fixture(t);
  await assert.rejects(writer.apply(input, context({scopes: ['knowledge:write']})), error => error.code === 'SCOPE_DENIED');
  await assert.rejects(writer.apply(input, context({signal: AbortSignal.abort()})), error => error.code === 'CANCELLED');
  await assert.rejects(writer.apply(input, context({deadline: '2000-01-01T00:00:00.000Z'})), error => error.code === 'TIMEOUT');
  revoke(); await assert.rejects(writer.apply(input, context()), error => error.code === 'SCOPE_DENIED');
  assert.equal(await readFile(join(root, 'demo.md'), 'utf8'), original);
  assert.deepEqual(await readdir(recovery), []);
});

test('an interrupted durable operation requires readback; neither same-run nor another write repeats it', {skip: !windows}, async t => {
  const {root, recovery, writer, options, input, context} = await fixture(t);
  const controller = new AbortController();
  const authorized = context({signal: controller.signal});
  const operationId = digest(authorized.taskId + '\n' + authorized.runId);
  const timer = setInterval(() => {
    if (existsSync(join(recovery, operationId + '.knowledge-operation.json'))) controller.abort();
  }, 5);
  t.after(() => clearInterval(timer));
  await assert.rejects(writer.apply(input, authorized), error => ['RESULT_UNKNOWN', 'CANCELLED'].includes(error.code));
  clearInterval(timer);
  assert.equal(existsSync(join(recovery, operationId + '.knowledge-operation.json')), true);
  const restarted = openControlledVaultWriter(options);
  await assert.rejects(restarted.apply(input, context()), error => error.code === 'RESULT_UNKNOWN');
  const readback = await restarted.reconcile({taskId: authorized.taskId, runId: authorized.runId,
    argumentsDigest: authorized.argumentsDigest}, context());
  assert.ok(['applied', 'not_applied'].includes(readback.state));
  const source = await readFile(join(root, 'demo.md'), 'utf8');
  assert.equal(source, readback.state === 'applied' ? original.replace('待整理段落', '已整理的合成段落') : original);
  await assert.rejects(restarted.apply(input, context({...authorized, signal: new AbortController().signal})), error => error.code === 'RESULT_UNKNOWN');
});

test('a selected note replaced with a symlink cannot redirect a write', {skip: !windows}, async t => {
  const {root, recovery, writer, input, context} = await fixture(t);
  const outside = resolve(root, '..', 'outside.md'); await writeFile(outside, original);
  await rm(join(root, 'demo.md'));
  try {await symlink(outside, join(root, 'demo.md'), 'file');}
  catch (error) {if (error.code === 'EPERM') {t.skip('Windows file symlink privilege unavailable'); return;} throw error;}
  await assert.rejects(writer.apply(input, context()));
  assert.equal(await readFile(outside, 'utf8'), original);
  assert.deepEqual(await readdir(recovery), []);
});

test('nested, escaped and shortcut links cannot be altered by a paragraph patch', {skip: !windows}, async t => {
  const {root, recovery, writer, input, context} = await fixture(t);
  for (const [before, after] of [
    ['[guide](https://example.com/a(b)c)', '[guide](https://example.com/a(b)evil)'],
    ['[guide](https://example.com/a\\(b\\)c)', '[guide](https://example.com/a\\(b\\)evil)'],
    ['[shortcut]', '[changed]']
  ]) {
    const content = before + '\n待整理段落\n'; await writeFile(join(root, 'demo.md'), content);
    const patch = {...input, expectedSha256: digest(content), edits: [{oldText: before, newText: after}]};
    await assert.rejects(writer.apply(patch, context({argumentsDigest: inputDigest(patch)})), error => error.code === 'SCOPE_DENIED');
    assert.equal(await readFile(join(root, 'demo.md'), 'utf8'), content);
  }
  assert.deepEqual(await readdir(recovery), []);
});

test('empty frontmatter remains byte-for-byte intact when the selected body paragraph is written and read back', {skip: !windows}, async t => {
  const {root, writer, input, context} = await fixture(t);
  const content = '---\n---\n正文\n待整理段落\n'; await writeFile(join(root, 'demo.md'), content);
  const patch = {...input, expectedSha256: digest(content)};
  const receipt = await writer.apply(patch, context({argumentsDigest: inputDigest(patch)}));
  assert.equal(receipt.state, 'verified');
  assert.equal(await readFile(join(root, 'demo.md'), 'utf8'), content.replace('待整理段落', '已整理的合成段落'));
});

test('a user edit between reconciliation reads returns unknown and retains both durable markers', {skip: !windows}, async t => {
  const {root, recovery, writer, options, input, context} = await fixture(t);
  const authorized = context(), receipt = await writer.apply(input, authorized);
  const canonicalRoot = realpathSync.native(root);
  const helperMarker = join(recovery, digest(canonicalRoot + '\ndemo.md').slice(0, 32) + '.inflight');
  const knowledgeMarker = join(recovery, digest(canonicalRoot + '\ndemo.md') + '.knowledge-pending');
  await writeFile(helperMarker, JSON.stringify({runId: authorized.runId, argumentsDigest: authorized.argumentsDigest,
    pid: 2147483647, startTimeTicks: '1', beforeSha256: receipt.beforeSha256, afterSha256: receipt.afterSha256}));
  await writeFile(knowledgeMarker, receipt.operationId);
  const userEdited = original.replace('待整理段落', '用户在读回中修改');
  let checks = 0;
  options.bindingCurrent = () => {if (++checks === 3) writeFileSync(join(root, 'demo.md'), userEdited); return true;};
  const readback = await writer.reconcile({taskId: authorized.taskId, runId: authorized.runId,
    argumentsDigest: authorized.argumentsDigest}, context());
  assert.equal(readback.state, 'unknown'); assert.equal(readback.lockRetained, true);
  assert.equal(readback.currentSha256, digest(userEdited));
  assert.equal(existsSync(helperMarker), true); assert.equal(existsSync(knowledgeMarker), true);
  assert.equal(await readFile(join(root, 'demo.md'), 'utf8'), userEdited);
  const retry = {...input, expectedSha256: digest(userEdited)};
  await assert.rejects(writer.apply(retry, context({argumentsDigest: inputDigest(retry)})), error => error.code === 'RESULT_UNKNOWN');
});

test('normal write tail revocation retains the original operation without a success receipt or retry', {skip: !windows}, async t => {
  const {root, recovery, writer, options, input, context} = await fixture(t);
  const authorized = context(), operationId = digest(authorized.taskId + '\n' + authorized.runId);
  const marker = join(recovery, digest(realpathSync.native(root) + '\ndemo.md') + '.knowledge-pending');
  // The host lease expires exactly when the final awaited readback returns.
  let guards = 0;
  options.bindingCurrent = () => ++guards < 5;
  await assert.rejects(writer.apply(input, authorized), error => error.code === 'RESULT_UNKNOWN');
  assert.equal(existsSync(marker), true);
  assert.equal(await readFile(marker, 'utf8'), operationId);
  const stored = JSON.parse(await readFile(join(recovery, operationId + '.knowledge-operation.json'), 'utf8'));
  assert.equal(stored.receipt, undefined);
  assert.equal(await readFile(join(recovery, stored.backupId), 'utf8'), original);
  assert.equal(await readFile(join(root, 'demo.md'), 'utf8'), original.replace('待整理段落', '已整理的合成段落'));
  options.bindingCurrent = () => true;
  await assert.rejects(writer.apply(input, authorized), error => error.code === 'RESULT_UNKNOWN');
});

test('late binding revocation after the final readback cannot report applied or release the pending note', {skip: !windows}, async t => {
  const {root, recovery, writer, options, input, context} = await fixture(t);
  const authorized = context(), receipt = await writer.apply(input, authorized);
  const marker = join(recovery, digest(realpathSync.native(root) + '\ndemo.md') + '.knowledge-pending');
  await writeFile(marker, receipt.operationId);
  // Deterministic host lifetime fault: the final tail guard observes a newly revoked binding.
  let guards = 0;
  options.bindingCurrent = () => ++guards < 5;
  await assert.rejects(writer.reconcile({taskId: authorized.taskId, runId: authorized.runId,
    argumentsDigest: authorized.argumentsDigest}, context()), error => error.code === 'SCOPE_DENIED');
  assert.equal(existsSync(marker), true);
  assert.equal(digest(await readFile(join(root, 'demo.md'))), receipt.afterSha256);
});

async function finalizationFixture(t) {
  const f = await fixture(t), authorized = f.context();
  const receipt = await f.writer.apply(f.input, authorized);
  const sourceKey = digest(realpathSync.native(f.root) + '\ndemo.md');
  const sharedMarker = join(f.recovery, sourceKey.slice(0, 32) + '.inflight');
  const knowledgeMarker = join(f.recovery, sourceKey + '.knowledge-pending');
  const shared = {runId: authorized.runId, argumentsDigest: authorized.argumentsDigest, pid: 2147483647,
    startTimeTicks: '1', beforeSha256: receipt.beforeSha256, afterSha256: receipt.afterSha256};
  await writeFile(sharedMarker, JSON.stringify(shared)); await writeFile(knowledgeMarker, receipt.operationId);
  const accepted = {taskId: authorized.taskId, runId: authorized.runId, toolName: 'knowledge.apply_note_patch',
    toolVersion: '1.0.0', argumentsDigest: authorized.argumentsDigest, operationId: receipt.operationId,
    originalInput: f.input, outcome: 'applied', currentSha256: receipt.afterSha256,
    executionRecordId: 'synthetic-original-execution', readbackEvidenceRefs: ['synthetic-trusted-readback']};
  return {...f, receipt, authorized, sharedMarker, knowledgeMarker, shared, accepted};
}

test('trusted original execution finalization clears matching stopped-helper markers under source lock without another write', {skip: !windows}, async t => {
  const f = await finalizationFixture(t);
  const before = await readFile(join(f.root, 'demo.md'));
  const operationPath = join(f.recovery, f.receipt.operationId + '.knowledge-operation.json');
  const originalJournal = await readFile(operationPath);
  const result = await f.writer.finalize(f.accepted, f.context());
  assert.deepEqual(result, {state: 'finalized', operationId: f.receipt.operationId,
    outcome: 'applied', currentSha256: f.receipt.afterSha256});
  assert.equal(existsSync(f.sharedMarker), false); assert.equal(existsSync(f.knowledgeMarker), false);
  assert.deepEqual(await readFile(join(f.root, 'demo.md')), before);
  assert.equal(await readFile(join(f.recovery, f.receipt.backupId), 'utf8'), original);
  assert.deepEqual(await readFile(operationPath), originalJournal);
  const finalizationPath = join(f.recovery, f.receipt.operationId + '.knowledge-finalization.json');
  const stored = {finalization: JSON.parse(await readFile(finalizationPath, 'utf8'))};
  assert.equal(stored.finalization.executionRecordId, f.accepted.executionRecordId);
  assert.deepEqual(stored.finalization.readbackEvidenceRefs, f.accepted.readbackEvidenceRefs);
  assert.equal((await f.writer.finalize(f.accepted, f.context())).state, 'finalized');
  assert.deepEqual(await readFile(operationPath), originalJournal);
  await writeFile(finalizationPath, JSON.stringify({...stored.finalization, executionRecordId: 'other-execution'}));
  assert.equal((await f.writer.finalize(f.accepted, f.context())).state, 'still_unknown');
  assert.deepEqual(await readFile(operationPath), originalJournal);
  await assert.rejects(f.writer.apply(f.input, f.authorized), error => error.code === 'RESULT_UNKNOWN');
});

test('finalization rejects mismatched original markers and unknown user edits while preserving both locks and all bytes', {skip: !windows}, async t => {
  const f = await finalizationFixture(t);
  await writeFile(f.sharedMarker, JSON.stringify({...f.shared, argumentsDigest: 'f'.repeat(64)}));
  assert.equal((await f.writer.finalize(f.accepted, f.context())).state, 'still_unknown');
  assert.equal(existsSync(f.sharedMarker), true); assert.equal(existsSync(f.knowledgeMarker), true);
  await writeFile(f.sharedMarker, JSON.stringify(f.shared));
  const userEdited = original + '用户的并发改动\r\n'; await writeFile(join(f.root, 'demo.md'), userEdited);
  assert.equal((await f.writer.finalize(f.accepted, f.context())).state, 'still_unknown');
  assert.equal(existsSync(f.sharedMarker), true); assert.equal(existsSync(f.knowledgeMarker), true);
  assert.equal(await readFile(join(f.root, 'demo.md'), 'utf8'), userEdited);
  const stored = JSON.parse(await readFile(join(f.recovery, f.receipt.operationId + '.knowledge-operation.json'), 'utf8'));
  assert.equal(stored.finalization, undefined);
});
