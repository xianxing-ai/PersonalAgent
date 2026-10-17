// Imported by an explicitly authorized credential host; importing makes no calls.
// The host owns AgentArts credentials, application lifetime and remote receipts.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import * as coding from '@personal-agent/coding-tools';
import {createDesktopCodingToolHost} from '../../../apps/desktop/electron/coding-tool-host.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const before = '\ufeffexport const status = "CLOUD_FIXTURE_BEFORE";\r\n';
const after = before.replace('CLOUD_FIXTURE_BEFORE', 'CLOUD_FIXTURE_AFTER_中文');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const recipes = ['workspace.read_text', 'workspace.apply_text_patch', 'workspace.run_allowed_command'];
const expected = Object.freeze({
  [recipes[0]]: {path: 'demo.mjs'},
  [recipes[1]]: {path: 'demo.mjs', expectedSha256: sha(before),
    edits: [{oldText: 'CLOUD_FIXTURE_BEFORE', newText: 'CLOUD_FIXTURE_AFTER_中文'}]},
  [recipes[2]]: {recipeId: 'verify-synthetic-patch'},
});
const digests = Object.fromEntries(recipes.map(name => [name, toolArgumentsDigest(expected[name])]));
const outputs = Object.freeze({
  [recipes[0]]: {path: 'demo.mjs', encoding: 'utf-8', byteLength: Buffer.byteLength(before), content: before, sha256: sha(before)},
  [recipes[1]]: {path: 'demo.mjs', applied: true, beforeSha256: sha(before), afterSha256: sha(after)},
  [recipes[2]]: {recipeId: 'verify-synthetic-patch', exitCode: 0, stdout: 'SYNTHETIC_PATCH_CONFIRMED', stderr: ''},
});
const goal = '只处理本次公开合成工作区。必须依次调用 workspace.read_text，参数 {"path":"demo.mjs"}；'
  + '使用读取结果原样返回的 sha256 作为 expectedSha256，调用 workspace.apply_text_patch，path 为 demo.mjs，'
  + 'edits 严格为 [{"oldText":"CLOUD_FIXTURE_BEFORE","newText":"CLOUD_FIXTURE_AFTER_中文"}]；'
  + '然后调用 workspace.run_allowed_command，参数 {"recipeId":"verify-synthetic-patch"}。'
  + '每个工具只调用一次，收到最后的真实验证结果再回答。不要请求其他文件、编辑、命令或工具。';

/** Pure argument/egress allowlist. It grants neither execution nor cloud consent. */
export function acceptsSyntheticWorkspaceProposal(toolName, argumentsValue) {
  try { return recipes.includes(toolName) && toolArgumentsDigest(argumentsValue) === digests[toolName]; }
  catch { return false; }
}

/** Reject unexpected data before it can leave the trusted local host. */
export function projectSyntheticWorkspaceResult(toolName, result) {
  const allowed = outputs[toolName];
  if (!recipes.includes(toolName) || !result || typeof result !== 'object' || Array.isArray(result)
    || !Object.entries(allowed).every(([key, value]) => result[key] === value)) {
    throw new ProtocolError('UNAUTHORIZED', 'Tool output differs from the public synthetic fixture');
  }
  return structuredClone(allowed);
}

export async function createSyntheticCloudWorkspace({powerShellPath, nodeExecutable}) {
  if (process.platform !== 'win32' || !path.isAbsolute(powerShellPath ?? '') || !path.isAbsolute(nodeExecutable ?? '')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Trusted Windows PowerShell and Node executable paths are required');
  }
  await mkdir(path.join(repository, '.cache'), {recursive: true});
  const directory = await mkdtemp(path.join(repository, '.cache', 'mod18-cloud-workspace-'));
  const root = path.join(directory, '工作区'), recovery = path.join(directory, 'recovery');
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
  const patchHost = createDesktopCodingToolHost({workspaceRoot: root, authorizedWorkspaceRoot: root,
    recoveryRootPath: recovery, powerShellPath, createWorkspacePatchApplyTool: coding.createWorkspacePatchApplyTool,
    reconcileWorkspacePatchApply: coding.reconcileWorkspacePatchApply});
  const providers = [coding.createWorkspaceReadTool({rootPath: root}), ...patchHost.tools,
    coding.createWorkspaceCommandTool({rootPath: root, recipes: [{id: 'verify-synthetic-patch',
      executable: nodeExecutable, args: ['-e',
        `const fs=require('node:fs');if(fs.readFileSync('demo.mjs','utf8')!==${JSON.stringify(after)})process.exit(2);process.stdout.write('SYNTHETIC_PATCH_CONFIRMED');`]}]})];
  let active = true, started = false, taskId, application;
  const dispatches = [];
  const sameTask = candidate => active && candidate === taskId;
  const tools = providers.map(provider => ({descriptor: provider.descriptor, execute(input, context) {
    const name = provider.descriptor.name;
    if (!sameTask(context.taskId) || !acceptsSyntheticWorkspaceProposal(name, input)
      || recipes[dispatches.length] !== name) {
      throw new ProtocolError('UNAUTHORIZED', 'Synthetic acceptance allows only the original ordered operations');
    }
    dispatches.push({toolName: name, runId: context.runId});
    return provider.execute(input, context);
  }}));
  const runtimeOptions = {path: path.join(directory, 'runtime.sqlite'), hostUserNamespace: 'mod18-synthetic-cloud',
    initialRequestMode: 'goal-with-tools-json', responseMode: 'tool-proposal-json', tools,
    workspacePatchReconciliation: patchHost.patchReconciliation,
    competitionToolAvailability: providers.map(({descriptor}) => ({toolName: descriptor.name, toolVersion: descriptor.version,
      ...(descriptor.name === recipes[2] ? {publicEnumPaths: ['/recipeId']} : {}),
      available(input) {
        // A fresh application belongs to this one task; bind before initial dispatch.
        if (!active || !started) return false;
        taskId ??= input.taskId;
        return sameTask(input.taskId);
      }})),
    competitionToolExports: providers.map(({descriptor}) => ({toolName: descriptor.name, toolVersion: descriptor.version,
      exportPolicyVersion: 'public-synthetic-workspace-v1',
      accepts: input => sameTask(input.taskId) && acceptsSyntheticWorkspaceProposal(descriptor.name, input.arguments)
        && (input.phase !== 'final' || isDeepStrictEqual(input.projection, outputs[descriptor.name])),
      project: input => {
        if (!sameTask(input.taskId) || input.signal.aborted) throw new ProtocolError('UNAUTHORIZED', 'Synthetic export is no longer active');
        return projectSyntheticWorkspaceResult(descriptor.name, input.result);
      }})),
  };
  return {directory, runtimeOptions, goal,
    async run(app, {deadline, signal = new AbortController().signal, cloudConsent}) {
      if (cloudConsent !== true || started || !active || signal.aborted
        || !Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= Date.now()) {
        throw new ProtocolError('UNAUTHORIZED', 'Explicit synthetic cloud consent and a live deadline are required');
      }
      started = true; application = app;
      const client = new Client(app);
      const remaining = () => {
        if (signal.aborted) throw new ProtocolError('CANCELLED', 'Synthetic cloud acceptance cancelled');
        const ms = Date.parse(deadline) - Date.now();
        if (ms <= 0) throw new ProtocolError('TIMEOUT', 'Synthetic cloud acceptance deadline expired');
        return ms;
      };
      try {
        await client.connect();
        const submitted = await client.call('task.submit', {goal, conversationId: 'mod18-synthetic-cloud'},
          {idempotencyKey: randomUUID(), timeoutMs: remaining(), signal});
        assert.equal(submitted.taskId, taskId);
        while (true) {
          remaining();
          const task = app.runtime.getTask(taskId);
          if (['succeeded', 'failed', 'cancelled', 'waiting_reconciliation'].includes(task.state) && app.activeTaskCount === 0) break;
          if (task.state === 'waiting_approval') {
            const list = await client.call('approval.list', {taskId, state: 'pending'}, {timeoutMs: remaining(), signal});
            for (const item of list.items) {
              const approval = app.runtime.getApproval(item.approvalId);
              const allowed = approval.taskId === taskId && recipes[dispatches.length] === approval.toolName
                && approval.argumentsDigest === digests[approval.toolName]
                && providers.find(provider => provider.descriptor.name === approval.toolName)?.descriptor.requiredScopes
                  .every(scope => approval.scopes.includes(scope));
              await client.call('authorization.respond', {approvalId: item.approvalId,
                expectedRevision: item.revision, decision: allowed ? 'allow_once' : 'deny'}, {timeoutMs: remaining(), signal});
              if (!allowed) throw new ProtocolError('UNAUTHORIZED', 'Cloud proposal differs from the synthetic acceptance allowlist');
            }
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        const task = app.runtime.getTask(taskId);
        assert.equal(task.state, 'succeeded');
        assert.deepEqual(dispatches.map(item => item.toolName), recipes);
        assert.deepEqual(await readFile(path.join(root, 'demo.mjs')), Buffer.from(after));
        const loop = app.runtime.loadCheckpoint(taskId, 'competition-loop');
        const records = app.runtime.readToolExecutions(taskId);
        assert.equal(loop.receipts.length, recipes.length);
        for (const dispatch of dispatches) {
          const record = records.find(item => item.evidenceId === dispatch.runId);
          assert.equal(record?.state, 'confirmed');
          assert.equal(record.policyDecision, 'allow'); assert.equal(record.executionStarted, true);
          const saved = loop.receipts.find(item => item.runId === dispatch.runId && item.proposal.toolName === dispatch.toolName);
          assert.ok(saved);
          assert.equal(app.runtime.matchesToolExecutionInput(record, {arguments: saved.proposal.arguments, scopeRef: dispatch.runId}), true);
          assert.equal(app.runtime.policy.get(dispatch.runId).usesRemaining, 0);
        }
        const commandResult = app.runtime.loadCheckpoint(taskId, 'tool-result-' + dispatches[2].runId).result;
        assert.deepEqual(commandResult, outputs[recipes[2]]);
        const receipt = {profile: 'huawei_ict_agentarts', dataClass: 'synthetic', taskId,
          taskState: task.state, localToolLoopVerified: true, orderedDispatches: dispatches,
          patchReadbackMatched: true, fixedCommandVerified: true, grantUsesExhausted: true,
          evidence: app.runtime.readEvidence(taskId).map(item => ({evidenceId: item.evidenceId, verification: item.verification})),
          remoteDeploymentAndTraceVerified: false, desktopUiVerified: false};
        await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
        return receipt;
      } catch {
        // Never expose cloud errors/credentials or automatically resend a task.
        active = false;
        if (taskId && !['succeeded', 'failed', 'cancelled'].includes(app.runtime.getTask(taskId).state)) {
          try { await client.call('task.cancel', {taskId, reason: 'Synthetic acceptance stopped'}); } catch { /* host must reconcile */ }
        }
        const failure = {state: 'failed_or_unknown', taskId: taskId ?? null,
          fixtureDirectory: path.relative(repository, directory), taskState: taskId ? app.runtime.getTask(taskId).state : 'not_created',
          dispatchedTools: dispatches, automaticRetry: false};
        await writeFile(path.join(directory, 'failure.json'), JSON.stringify(failure, null, 2) + '\n', {flag: 'wx'});
        throw new ProtocolError('RESULT_UNKNOWN', 'Synthetic acceptance did not complete; inspect the preserved task, do not retry');
      }
    },
    close() {
      if (application?.activeTaskCount > 0) throw new ProtocolError('REVISION_CONFLICT', 'Wait for the original application workers before releasing the fixture');
      active = false; patchHost.close();
    },
  };
}
