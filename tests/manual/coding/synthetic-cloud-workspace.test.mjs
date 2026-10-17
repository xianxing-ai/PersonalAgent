import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {acceptsSyntheticWorkspaceProposal, createSyntheticCloudWorkspace, projectSyntheticWorkspaceResult} from './synthetic-cloud-workspace.mjs';

test('synthetic acceptance rejects other paths, recipes and extra parameters', () => {
  assert.equal(acceptsSyntheticWorkspaceProposal('workspace.read_text', {path: 'demo.mjs'}), true);
  for (const input of [{path: '../secret'}, {path: 'demo.mjs', maxBytes: 2}, {}, null]) {
    assert.equal(acceptsSyntheticWorkspaceProposal('workspace.read_text', input), false);
  }
  assert.equal(acceptsSyntheticWorkspaceProposal('workspace.run_allowed_command', {recipeId: 'verify-synthetic-patch'}), true);
  assert.equal(acceptsSyntheticWorkspaceProposal('workspace.run_allowed_command', {recipeId: 'shell'}), false);
  assert.equal(acceptsSyntheticWorkspaceProposal('workspace.apply_text_patch', {path: 'demo.mjs', expectedSha256: '0'.repeat(64), edits: []}), false);
});

test('egress rejects changed content, hashes or command errors and strips local metadata', () => {
  const content = '\ufeffexport const status = "CLOUD_FIXTURE_BEFORE";\r\n';
  const read = {path: 'demo.mjs', encoding: 'utf-8', byteLength: Buffer.byteLength(content), content,
    sha256: createHash('sha256').update(content).digest('hex')};
  assert.deepEqual(projectSyntheticWorkspaceResult('workspace.read_text', {...read, privateMetadata: 'local-only'}), read);
  for (const changed of [{...read, content: 'unexpected content'}, {...read, sha256: '0'.repeat(64)}]) {
    assert.throws(() => projectSyntheticWorkspaceResult('workspace.read_text', changed), {code: 'UNAUTHORIZED'});
  }
  const command = {recipeId: 'verify-synthetic-patch', exitCode: 0, stdout: 'SYNTHETIC_PATCH_CONFIRMED', stderr: ''};
  assert.deepEqual(projectSyntheticWorkspaceResult('workspace.run_allowed_command', command), command);
  assert.throws(() => projectSyntheticWorkspaceResult('workspace.run_allowed_command', {...command, stderr: 'unexpected diagnostic'}), {code: 'UNAUTHORIZED'});
});

test('explicit Fake coordination drives the real bounded local tool loop; no cloud proof', {
  skip: process.platform !== 'win32',
}, async () => {
  const fixture = await createSyntheticCloudWorkspace({powerShellPath: 'C:/Program Files/PowerShell/7/pwsh.exe', nodeExecutable: process.execPath});
  let calls = 0;
  const app = createRuntimeApplication({...fixture.runtimeOptions, profile: 'huawei_ict_agentarts', coordination: {
    async execute(request) {
      calls++;
      const proposal = (toolName, args) => ({kind: 'tool_proposal', proposalId: 'synthetic-' + calls,
        toolName, toolVersion: '1.0.0', arguments: args, verification: 'mock'});
      if (calls === 1) return proposal('workspace.read_text', {path: 'demo.mjs'});
      if (calls === 2) return proposal('workspace.apply_text_patch', {path: 'demo.mjs',
        expectedSha256: request.continuation.result.sha256,
        edits: [{oldText: 'CLOUD_FIXTURE_BEFORE', newText: 'CLOUD_FIXTURE_AFTER_中文'}]});
      if (calls === 3) return proposal('workspace.run_allowed_command', {recipeId: 'verify-synthetic-patch'});
      assert.equal(request.continuation.result.stdout, 'SYNTHETIC_PATCH_CONFIRMED');
      return {kind: 'text', text: 'Synthetic tool loop completed', verification: 'mock'};
    },
  }});
  try {
    await assert.rejects(fixture.run(app, {deadline: new Date(Date.now() + 60_000).toISOString()}), {code: 'UNAUTHORIZED'});
    const receipt = await fixture.run(app, {deadline: new Date(Date.now() + 60_000).toISOString(), cloudConsent: true});
    assert.equal(receipt.localToolLoopVerified, true);
    assert.equal(receipt.remoteDeploymentAndTraceVerified, false);
    assert.equal(calls, 4);
  } finally {
    for (let i = 0; app.activeTaskCount && i < 400; i++) await new Promise(resolve => setTimeout(resolve, 25));
    app.close(); fixture.close();
  }
});

test('cancellation while approval is pending revokes execution and export even with no worker', {
  skip: process.platform !== 'win32',
}, async () => {
  const fixture = await createSyntheticCloudWorkspace({powerShellPath: 'C:/Program Files/PowerShell/7/pwsh.exe', nodeExecutable: process.execPath});
  const controller = new AbortController();
  const app = createRuntimeApplication({...fixture.runtimeOptions, profile: 'huawei_ict_agentarts', coordination: {
    async execute() { return {kind: 'tool_proposal', proposalId: 'pending-read', toolName: 'workspace.read_text',
      toolVersion: '1.0.0', arguments: {path: 'demo.mjs'}, verification: 'mock'}; },
  }});
  const send = app.send.bind(app);
  let cancelledAtApproval = false;
  app.send = async (request, signal) => {
    if (request.operation === 'approval.list') {
      assert.equal(app.runtime.getTask(request.payload.taskId).state, 'waiting_approval');
      assert.equal(app.activeTaskCount, 0);
      cancelledAtApproval = true;
      controller.abort();
    }
    return send(request, signal);
  };
  try {
    await assert.rejects(fixture.run(app, {deadline: new Date(Date.now() + 60_000).toISOString(),
      signal: controller.signal, cloudConsent: true}), {code: 'RESULT_UNKNOWN'});
    assert.equal(cancelledAtApproval, true);
    const failure = JSON.parse(await readFile(path.join(fixture.directory, 'failure.json'), 'utf8'));
    assert.equal(app.runtime.getTask(failure.taskId).state, 'cancelled');
    assert.deepEqual(failure.dispatchedTools, []);
    assert.equal(fixture.runtimeOptions.competitionToolAvailability[0].available({taskId: failure.taskId}), false);
    assert.equal(fixture.runtimeOptions.competitionToolExports[0].accepts({taskId: failure.taskId, arguments: {path: 'demo.mjs'}}), false);
    assert.throws(() => fixture.runtimeOptions.tools[0].execute({path: 'demo.mjs'}, {taskId: failure.taskId}), {code: 'UNAUTHORIZED'});
  } finally {
    app.close(); fixture.close();
  }
});
