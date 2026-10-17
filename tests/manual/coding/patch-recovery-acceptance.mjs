// Opt-in Windows acceptance with REAL helper markers/process identities.
// Cases: pre-dispatch worker exit, and post-write marker-cleanup failure.
// This does not simulate power loss or claim write-in-progress atomicity.
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as coding from '@personal-agent/coding-tools';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopCodingToolHost} from '../../../apps/desktop/electron/coding-tool-host.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const before = '\ufeffexport const value = "RECOVERY_BEFORE";\r\n';
const after = before.replace('RECOVERY_BEFORE', 'RECOVERY_AFTER_中文');
const minimalEnv = {SystemRoot: process.env.SystemRoot ?? 'C:\\Windows'};
let phase = 'setup', activeDirectory;
async function until(predicate, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw Error('Acceptance deadline expired');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
function observeExit(child, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    let timedOut = false, stopTimer;
    const clearTimers = () => { clearTimeout(timer); clearTimeout(stopTimer); };
    // Only the exact child launched by this runner may be stopped on failure.
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* preserve the fixture for reconciliation */ }
      stopTimer = setTimeout(() => reject(Error('Fixture child exit is unconfirmed; preserve its recovery marker')), 2_000);
    }, timeout);
    child.once('error', error => { clearTimers(); reject(error); });
    child.once('close', code => {
      clearTimers();
      if (timedOut) reject(Error('Fixture child timed out; worker exit confirmed, helper recovery still required'));
      else resolve(code);
    });
  });
}
function makeHost(directory, powerShellPath, now) {
  const root = path.join(directory, '工作区');
  const host = createDesktopCodingToolHost({workspaceRoot: root, authorizedWorkspaceRoot: root,
    recoveryRootPath: path.join(directory, 'recovery'), powerShellPath,
    createWorkspacePatchApplyTool: options => coding.createWorkspacePatchApplyTool({...options, ...(now ? {now} : {})}),
    reconcileWorkspacePatchApply: coding.reconcileWorkspacePatchApply});
  const provider = host.tools[0];
  const tools = [{descriptor: provider.descriptor, execute(input, context) {
    appendFileSync(path.join(directory, 'dispatch.jsonl'), JSON.stringify({runId: context.runId,
      argumentsDigest: context.argumentsDigest}) + '\n');
    return provider.execute(input, context);
  }}];
  return {host, options: {path: path.join(directory, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts', hostUserNamespace: 'mod18-recovery-acceptance', tools,
    workspacePatchReconciliation: host.patchReconciliation}};
}
async function worker(directory, powerShellPath, scenario) {
  // The parent creates this fixture. Never accept an arbitrary existing project.
  const canonical = realpathSync.native(directory);
  assert.equal(path.dirname(canonical), realpathSync.native(path.join(repository, '.cache')));
  assert.match(path.basename(canonical), /^mod18-recovery-/);
  const fixture = JSON.parse(await readFile(path.join(directory, 'fixture.json'), 'utf8'));
  assert.equal(fixture.scenario, scenario);
  assert.ok(['before-dispatch', 'marker-cleanup'].includes(scenario));
  let injected = false, locker, lockerExit;
  const releasePath = path.join(directory, 'locker-release');
  const readyPath = path.join(directory, 'locker-ready');
  const now = () => {
    const markers = readdirSync(path.join(directory, 'recovery')).filter(name => name.endsWith('.inflight'));
    if (!injected && markers.length) {
      assert.equal(markers.length, 1);
      const markerPath = path.join(directory, 'recovery', markers[0]);
      const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
      const dispatch = JSON.parse(readFileSync(path.join(directory, 'dispatch.jsonl'), 'utf8').trim());
      assert.equal(marker.runId, dispatch.runId);
      assert.equal(marker.argumentsDigest, dispatch.argumentsDigest);
      assert.equal(marker.beforeSha256, sha(before));
      assert.equal(marker.afterSha256, sha(after));
      assert.ok(Number.isSafeInteger(marker.pid) && marker.pid > 0);
      assert.match(marker.startTimeTicks, /^[1-9]\d+$/);
      // This metadata is observed from production output, never a fabricated marker.
      writeFileSync(path.join(directory, 'fault-observed.json'), JSON.stringify({scenario,
        markerGeneratedByProduction: true, runId: marker.runId,
        argumentsDigest: marker.argumentsDigest, sourceBeforeDispatch: sha(readFileSync(path.join(directory, '工作区', 'demo.mjs')))}), {flag: 'wx'});
      injected = true;
      if (scenario === 'before-dispatch') process.exit(73); // Deliberate exit of THIS worker only.
      locker = spawn(powerShellPath, ['-NoProfile', '-NonInteractive', '-File',
        fileURLToPath(new URL('./support/hold-marker.ps1', import.meta.url)),
        '-MarkerPath', markerPath, '-ReadyPath', readyPath, '-ReleasePath', releasePath],
      {env: minimalEnv, windowsHide: true, shell: false, stdio: 'ignore'});
      lockerExit = observeExit(locker);
      // Suppress premature rejection reporting; finally still awaits the result.
      void lockerExit.catch(() => {});
      const stop = Date.now() + 10_000;
      while (!existsSync(readyPath)) {
        if (Date.now() >= stop) throw Error('Fixture marker lock was not ready');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
    return Date.now();
  };
  const {host, options} = makeHost(directory, powerShellPath, now);
  const app = createRuntimeApplication(options);
  try {
    const client = new Client(app); await client.connect();
    const submitted = app.submitHostToolTask(fixture.request);
    await until(() => app.runtime.getTask(submitted.task.taskId).state === 'waiting_approval');
    assert.equal(existsSync(path.join(directory, 'dispatch.jsonl')), false);
    const pending = app.readHostToolTask(submitted.task.taskId);
    writeFileSync(path.join(directory, 'task.json'), JSON.stringify({taskId: submitted.task.taskId}), {flag: 'wx'});
    await client.call('authorization.respond', {approvalId: pending.approval.approvalId,
      expectedRevision: pending.approval.revision, decision: 'allow_once'});
    await until(() => app.activeTaskCount === 0);
    assert.equal(injected, true);
    assert.equal(app.runtime.getTask(submitted.task.taskId).state, 'waiting_reconciliation');
    assert.equal(app.runtime.getTask(submitted.task.taskId).error.code, 'RESULT_UNKNOWN');
    assert.equal(await readFile(path.join(directory, '工作区', 'demo.mjs'), 'utf8'), after);
  } finally {
    try {
      if (locker) {
        writeFileSync(releasePath, '', {flag: 'wx'});
        assert.equal(await lockerExit, 0);
      }
    } finally {
      try { await until(() => app.activeTaskCount === 0); }
      finally { try { app.close(); } finally { host.close(); } }
    }
  }
}
async function run(powerShellPath) {
  assert.ok(path.isAbsolute(powerShellPath));
  await mkdir(path.join(repository, '.cache'), {recursive: true});
  const receipts = [];
  for (const scenario of ['before-dispatch', 'marker-cleanup']) {
    phase = `${scenario}:fixture`;
    const directory = await mkdtemp(path.join(repository, '.cache', 'mod18-recovery-'));
    activeDirectory = directory;
    const root = path.join(directory, '工作区');
    const recovery = path.join(directory, 'recovery');
    await mkdir(root); await mkdir(recovery);
    const protect = String.raw`$ErrorActionPreference='Stop'
$target=[Console]::In.ReadToEnd()
$self=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($self)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($self,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
Set-Acl -LiteralPath $target -AclObject $acl`;
    execFileSync(powerShellPath, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(protect, 'utf16le').toString('base64')],
      {input: recovery, windowsHide: true, timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe']});
    await writeFile(path.join(root, 'demo.mjs'), before, {flag: 'wx'});
    const request = {commandId: randomUUID(), toolName: 'workspace.apply_text_patch', toolVersion: '1.0.0',
      arguments: {path: 'demo.mjs', expectedSha256: sha(before), edits: [{oldText: 'RECOVERY_BEFORE', newText: 'RECOVERY_AFTER_中文'}]},
      deadline: new Date(Date.now() + 60_000).toISOString()};
    await writeFile(path.join(directory, 'fixture.json'), JSON.stringify({scenario, request}), {flag: 'wx'});
    phase = `${scenario}:worker`;
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', directory, powerShellPath, scenario],
      {env: minimalEnv, windowsHide: true, shell: false, stdio: 'ignore'});
    const exitCode = await observeExit(child);
    assert.equal(exitCode, scenario === 'before-dispatch' ? 73 : 0);
    const fault = JSON.parse(await readFile(path.join(directory, 'fault-observed.json'), 'utf8'));
    assert.equal(fault.sourceBeforeDispatch, sha(before));
    const {taskId} = JSON.parse(await readFile(path.join(directory, 'task.json'), 'utf8'));
    const dispatchBytes = await readFile(path.join(directory, 'dispatch.jsonl'), 'utf8');
    assert.equal(dispatchBytes.trim().split('\n').length, 1);
    const markers = (await readdir(recovery)).filter(name => name.endsWith('.inflight'));
    assert.equal(markers.length, 1);
    const {host, options} = makeHost(directory, powerShellPath);
    let app, acknowledgedPersistedOutcome = false;
    const realPort = host.patchReconciliation;
    options.workspacePatchReconciliation = {bindingId: realPort.bindingId, async reconcile(input) {
      if (!input.retainMarker) {
        // Observe the persistence/acknowledgement boundary, not just final state.
        const record = app.runtime.readToolExecutions(taskId).find(item => item.evidenceId === input.expectedRunId);
        const checkpoint = app.runtime.loadCheckpoint(taskId, 'tool-reconciliation-' + input.expectedRunId);
        assert.ok(record?.reconciliationOutcome);
        assert.equal(checkpoint?.result?.outcome, record.reconciliationOutcome);
        assert.equal(checkpoint.result.runId, input.expectedRunId);
        assert.equal(checkpoint.result.argumentsDigest, input.expectedArgumentsDigest);
        acknowledgedPersistedOutcome = true;
      }
      const result = await realPort.reconcile(input);
      if (input.retainMarker) assert.ok(existsSync(path.join(recovery, markers[0])));
      return result;
    }};
    app = createRuntimeApplication(options);
    try {
      phase = `${scenario}:reconcile`;
      // Resuming the same persisted intent must enter reconciliation, not execute.
      const restored = app.submitHostToolTask(request);
      assert.equal(restored.task.taskId, taskId);
      assert.equal(restored.task.state, 'waiting_reconciliation');
      let readback;
      await until(async () => {
        readback = await app.reconcileWorkspacePatchTask(taskId);
        return readback.result.state !== 'in_progress';
      });
      assert.equal(readback.result.state, 'reconciled');
      assert.equal(readback.result.outcome, scenario === 'before-dispatch' ? 'not_applied' : 'applied');
      assert.equal(readback.result.runId, fault.runId);
      assert.equal(readback.result.argumentsDigest, fault.argumentsDigest);
      assert.equal(readback.task.state, scenario === 'before-dispatch' ? 'failed' : 'succeeded');
      assert.equal(acknowledgedPersistedOutcome, true);
      assert.deepEqual(await readdir(recovery), []);
      assert.equal(await readFile(path.join(root, 'demo.mjs'), 'utf8'), scenario === 'before-dispatch' ? before : after);
      const records = app.runtime.readToolExecutions(taskId);
      const evidence = app.runtime.readEvidence(taskId);
      assert.equal(records.length, 1);
      assert.equal(records[0].executionStarted, true);
      assert.equal(records[0].policyDecision, 'allow');
      assert.ok(evidence.length > 0);
      assert.equal(app.runtime.policy.get(fault.runId).usesRemaining, 0);
      // Repeat recovery, then reopen once more: no extra tool dispatch or grant.
      assert.deepEqual((await app.reconcileWorkspacePatchTask(taskId)).result, readback.result);
      app.close(); app = createRuntimeApplication(options);
      assert.deepEqual((await app.reconcileWorkspacePatchTask(taskId)).result, readback.result);
      assert.deepEqual(app.runtime.readToolExecutions(taskId), records);
      assert.deepEqual(app.runtime.readEvidence(taskId), evidence);
      assert.equal(await readFile(path.join(directory, 'dispatch.jsonl'), 'utf8'), dispatchBytes);
      const receipt = {profile: 'huawei_ict_agentarts', scenario, nodeVersion: process.version,
        taskId, runId: fault.runId, workerExitCode: exitCode, realHelperIdentity: true,
        realMarker: true, faultInjection: scenario, recoveryOutcome: readback.result.outcome,
        taskState: readback.task.state, sourceReadbackMatched: true,
        originalExecutionCount: records.length, toolDispatchCount: 1, grantConsumed: true,
        repeatRecoveryStable: true, runtimeReopenReadbackStable: true, markerClearedAfterPersistence: true,
        evidence: evidence.map(item => ({evidenceId: item.evidenceId, verification: item.verification})),
        desktopUiVerified: false, agentArtsVerified: false, midWriteCrashVerified: false};
      await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
      receipts.push({receiptDirectory: path.relative(repository, directory), ...receipt});
    } finally {
      try { await until(() => app.activeTaskCount === 0); }
      finally { try { app.close(); } finally { host.close(); } }
    }
  }
  console.log(JSON.stringify({state: 'passed', receipts}));
}

try {
  assert.equal(process.platform, 'win32');
  if (process.argv[2] === '--worker') await worker(process.argv[3], process.argv[4], process.argv[5]);
  else { assert.equal(process.argv.length, 3); await run(process.argv[2]); }
} catch {
  console.error(JSON.stringify({state: 'failed', phase,
    ...(activeDirectory ? {fixtureDirectory: path.relative(repository, activeDirectory)} : {}),
    message: 'Preserve the fixture and reconcile any pending helper identity; do not retry the patch'}));
  process.exitCode = 1;
}
