// Opt-in Windows acceptance. Creates a fresh project and database under .cache;
// uses real Runtime / Policy / ToolGateway and public coding factories, no grants
// or authorization references fabricated by this runner. No cloud calls.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as coding from '@personal-agent/coding-tools';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopCodingToolHost} from '../../../apps/desktop/electron/coding-tool-host.js';

if (process.platform !== 'win32') throw Error('Windows acceptance only');
const powerShellPath = process.argv[2];
const casOnly = process.argv[3] === '--cas-only';
if (!powerShellPath || !path.isAbsolute(powerShellPath)) throw Error('Pass trusted PowerShell 7 executable');
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const cache = path.join(repository, '.cache');
await mkdir(cache, {recursive: true});
const base = await mkdtemp(path.join(cache, 'p6-runtime-'));
const root = path.join(base, '工作区');
const recovery = path.join(base, 'recovery');
await mkdir(root);
await mkdir(recovery);
const aclScript = String.raw`$ErrorActionPreference='Stop'
$target=[Console]::In.ReadToEnd()
$self=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($self)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($self,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
Set-Acl -LiteralPath $target -AclObject $acl`;
execFileSync(powerShellPath, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
  Buffer.from(aclScript, 'utf16le').toString('base64')],
{input: recovery, windowsHide: true, timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe']});

const source = path.join(root, 'demo.mjs');
const newline = casOnly ? '\r\n' : '\n';
const before = `${casOnly ? '\ufeff' : ''}export const greeting = "P6_BEFORE";${newline}console.log(greeting);${newline}`;
const after = before.replace('P6_BEFORE', 'P6_AFTER_中文');
const sha = value => createHash('sha256').update(value).digest('hex');
await writeFile(source, before, {flag: 'wx'});
const patchHost = createDesktopCodingToolHost({workspaceRoot: root, authorizedWorkspaceRoot: root,
  recoveryRootPath: recovery, powerShellPath,
  createWorkspacePatchApplyTool: coding.createWorkspacePatchApplyTool,
  reconcileWorkspacePatchApply: coding.reconcileWorkspacePatchApply});
const tools = [coding.createWorkspaceReadTool({rootPath: root}),
  coding.createWorkspacePatchPreviewTool({rootPath: root}),
  ...patchHost.tools,
  coding.createWorkspaceCommandTool({rootPath: root,
    recipes: [{id: 'run-demo', executable: process.execPath, args: ['demo.mjs']}]}),
];
const config = {path: path.join(base, 'runtime.sqlite'), profile: 'huawei_ict_agentarts',
  hostUserNamespace: 'p6-manual-acceptance', tools,
  workspacePatchReconciliation: patchHost.patchReconciliation};
let app = createRuntimeApplication(config);
let client;
const receipts = [];
async function connect() { client = new Client(app, Date.now); await client.connect(); }
async function until(predicate) {
  const stop = Date.now() + 60_000;
  while (!predicate()) {
    if (Date.now() >= stop) throw Error('Runtime acceptance deadline expired');
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}
function request(toolName, argumentsValue, commandId = randomUUID()) {
  return {commandId, toolName, toolVersion: '1.0.0', arguments: argumentsValue,
    deadline: new Date(Date.now() + 60_000).toISOString()};
}
async function execute(input) {
  const {task} = app.submitHostToolTask(input);
  await until(() => app.runtime.getTask(task.taskId).state === 'waiting_approval');
  const pending = app.readHostToolTask(task.taskId);
  assert.equal(pending.approval.state, 'pending');
  assert.equal(pending.confirmed, undefined);
  await client.call('authorization.respond', {approvalId: pending.approval.approvalId,
    expectedRevision: pending.approval.revision, decision: 'allow_once'});
  await until(() => ['succeeded', 'failed', 'cancelled', 'waiting_reconciliation']
    .includes(app.runtime.getTask(task.taskId).state));
  await until(() => app.activeTaskCount === 0);
  const result = app.readHostToolTask(task.taskId);
  receipts.push({taskId: task.taskId, toolName: input.toolName, state: result.task.state,
    evidenceRefs: result.task.evidenceRefs,
    execution: app.runtime.readToolExecutions(task.taskId).map(record => ({
      runId: record.evidenceId, state: record.state, argumentsDigest: record.inputDigest,
      executionStarted: record.executionStarted,
    })),
    evidence: app.runtime.readEvidence(task.taskId).map(item => ({
      evidenceId: item.evidenceId, verification: item.verification,
    })),
  });
  return result;
}
try {
  await connect();
  const handshake = await client.call('system.handshake', {supportedMajor: 1, clientCapabilities: []});
  assert.ok(handshake.capabilities.includes('tool.invoke'));
  const registered = await client.call('capability.list', {});
  assert.ok(registered.manifests.some(tool => tool.name === 'workspace.apply_text_patch'));
  const read = await execute(request('workspace.read_text', {path: 'demo.mjs'}));
  assert.equal(read.task.state, 'succeeded');
  assert.equal(read.confirmed.result.content, before);
  assert.ok(read.confirmed.result.content.includes('P6_BEFORE')); // Local search of selected file.
  assert.equal(read.confirmed.result.sha256, sha(await readFile(source)));
  const patch = {path: read.confirmed.result.path, expectedSha256: read.confirmed.result.sha256,
    edits: [{oldText: 'P6_BEFORE', newText: 'P6_AFTER_中文'}]};
  const preview = await execute(request('workspace.preview_text_patch', patch));
  assert.equal(preview.task.state, 'succeeded');
  assert.equal(preview.confirmed.result.previewText, after);
  assert.equal(await readFile(source, 'utf8'), before);
  const applyRequest = request('workspace.apply_text_patch', patch);
  const applied = await execute(applyRequest);
  assert.equal(applied.task.state, 'succeeded');
  assert.equal(applied.confirmed.result.applied, true);
  assert.equal(applied.confirmed.result.beforeSha256, sha(before));
  assert.equal(applied.confirmed.result.afterSha256, sha(after));
  assert.equal(await readFile(source, 'utf8'), after);
  assert.ok(applied.confirmed.evidenceRefs.length > 0);
  if (casOnly) {
    const reread = await execute(request('workspace.read_text', {path: patch.path}));
    assert.equal(reread.confirmed.result.content, after);
    assert.equal(reread.confirmed.result.sha256, applied.confirmed.result.afterSha256);
    assert.deepEqual(await readFile(source), Buffer.from(after));
    const stalePreview = await execute(request('workspace.preview_text_patch', patch));
    assert.equal(stalePreview.task.state, 'failed');
    assert.equal(stalePreview.task.error.code, 'REVISION_CONFLICT');
    const staleApply = await execute(request('workspace.apply_text_patch', patch));
    assert.equal(staleApply.task.state, 'waiting_reconciliation');
    assert.equal(staleApply.task.error.code, 'RESULT_UNKNOWN');
    assert.equal(staleApply.confirmed, undefined);
    assert.deepEqual(await readFile(source), Buffer.from(after));
    assert.deepEqual(await readdir(recovery), []);
    const summary = {profile: 'huawei_ict_agentarts', mode: 'cas-only', realLocalExecution: true,
      desktopVerified: false, cloudVerified: false, bomAndCrlfPreserved: true,
      beforeSha256: read.confirmed.result.sha256, afterSha256: reread.confirmed.result.sha256,
      stalePreviewCode: stalePreview.task.error.code, staleApplyState: staleApply.task.state, receipts};
    await writeFile(path.join(base, 'receipt.json'), JSON.stringify(summary, null, 2), {flag: 'wx'});
    console.log(JSON.stringify({state: 'passed', mode: 'cas-only', receiptDirectory: path.relative(repository, base),
      beforeSha256: summary.beforeSha256, afterSha256: summary.afterSha256, taskIds: receipts.map(item => item.taskId)}));
  } else {
  const command = await execute(request('workspace.run_allowed_command', {recipeId: 'run-demo'}));
  assert.equal(command.task.state, 'succeeded');
  assert.deepEqual(command.confirmed.result, {recipeId: 'run-demo', exitCode: 0,
    stdout: 'P6_AFTER_中文\n', stderr: ''});
  const reread = await execute(request('workspace.read_text', {path: 'demo.mjs'}));
  assert.equal(reread.confirmed.result.content, after);

  // The old expected hash cannot overwrite the already changed file. The
  // Gateway conservatively maps a local-write failure to reconciliation.
  const stale = await execute(request('workspace.apply_text_patch', patch));
  assert.equal(stale.task.state, 'waiting_reconciliation');
  assert.equal(stale.task.error.code, 'RESULT_UNKNOWN');
  assert.equal(stale.confirmed, undefined);
  assert.equal(await readFile(source, 'utf8'), after);
  assert.deepEqual(await readdir(recovery), []);

  const cancelledInput = request('workspace.apply_text_patch', {
    path: 'demo.mjs', expectedSha256: sha(after),
    edits: [{oldText: 'P6_AFTER_中文', newText: 'NEVER_APPLIED'}],
  });
  const cancelled = app.submitHostToolTask(cancelledInput).task;
  await until(() => app.runtime.getTask(cancelled.taskId).state === 'waiting_approval');
  await client.call('task.cancel', {taskId: cancelled.taskId, reason: 'acceptance cancellation'});
  await until(() => app.runtime.getTask(cancelled.taskId).state === 'cancelled');
  await until(() => app.activeTaskCount === 0);
  assert.equal(await readFile(source, 'utf8'), after);
  assert.ok(app.runtime.readToolExecutions(cancelled.taskId).every(record => !record.executionStarted));

  // Crash/restart receipt semantics: reopening the completed command cannot write again.
  const originalRecords = app.runtime.readToolExecutions(applied.task.taskId);
  app.close();
  app = createRuntimeApplication(config);
  await connect();
  const restored = app.submitHostToolTask(applyRequest);
  assert.equal(restored.task.taskId, applied.task.taskId);
  assert.equal(restored.task.state, 'succeeded');
  assert.deepEqual(app.runtime.readToolExecutions(applied.task.taskId), originalRecords);
  assert.deepEqual(app.readHostToolTask(applied.task.taskId).confirmed, applied.confirmed);
  assert.equal(app.readHostToolTask(stale.task.taskId).task.state, 'waiting_reconciliation');
  assert.throws(() => app.submitHostToolTask({...applyRequest, arguments: {...patch,
    edits: [{oldText: 'P6_AFTER_中文', newText: 'REPLACED_INPUT'}]}}), {code: 'REVISION_CONFLICT'});
  assert.equal(await readFile(source, 'utf8'), after);
  assert.deepEqual(await readdir(recovery), []);
  const summary = {profile: 'huawei_ict_agentarts', realLocalExecution: true,
    desktopVerified: false, cloudVerified: false, beforeSha256: sha(before), afterSha256: sha(after),
    command: command.confirmed.result, cancelledTaskId: cancelled.taskId,
    staleTaskId: stale.task.taskId, staleSourceRejected: true,
    restartSameTask: true, restartNoReplay: true, changedArgumentsRejected: true, receipts};
  await writeFile(path.join(base, 'receipt.json'), JSON.stringify(summary, null, 2), {flag: 'wx'});
  console.log(JSON.stringify({state: 'passed', receiptDirectory: path.relative(repository, base),
    beforeSha256: sha(before), afterSha256: sha(after), taskIds: receipts.map(item => item.taskId)}));
  }
} finally {
  try { await until(() => app.activeTaskCount === 0); }
  finally { try { app.close(); } finally { patchHost.close(); } }
}
