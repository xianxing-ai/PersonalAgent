import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const WORKTREE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RECEIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const importFromWorktree = rel => import(pathToFileURL(path.join(WORKTREE, rel)).href);

const {Client} = await importFromWorktree('packages/client/dist/index.js');
const {GhCliProvider, GitHubService} = await importFromWorktree('packages/connectors/github/dist/index.js');
const {createRuntimeApplication} = await importFromWorktree('apps/runtime/dist/application.js');
const {createDesktopNotificationPort} = await importFromWorktree('apps/desktop/electron/desktop-notification-port.js');
const {createDesktopNotificationApplicationHost} = await importFromWorktree('apps/desktop/electron/notification-application-host.js');
const {createDesktopBusinessWorkflowHosts} = await importFromWorktree('apps/desktop/electron/business-workflow-hosts.js');

async function runHostAdapter(app, toolName, args, deadline) {
  const cmdId = `cmd-${toolName}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const prep = app.prepareHostToolTask({commandId: cmdId, toolName, toolVersion: '1.0.0', deadline});
  app.finalizeHostToolTask({commandId: cmdId, taskId: prep.taskId, expectedTaskRevision: prep.revision, arguments: args});
  const client = new Client(app);
  await client.connect();
  try {
    for (let i = 0; i < 40; i++) {
      const status = app.readHostToolTask(prep.taskId);
      if (status.approval?.state === 'pending' || ['succeeded', 'failed', 'cancelled'].includes(status.task.state)) break;
      await new Promise(r => setTimeout(r, 25));
    }
    const status = app.readHostToolTask(prep.taskId);
    if (status.approval?.state === 'pending') {
      await client.call('authorization.respond', {
        approvalId: status.approval.approvalId,
        expectedRevision: status.approval.revision,
        decision: 'allow_once',
      });
    }
    await app.waitForHostToolTask(prep.taskId);
    return app.readHostToolTask(prep.taskId);
  } finally {
    await client.close?.();
  }
}

// =========================================================================
// 1. S531-P2 Verification (F12 / #21 Notification Delivery, Click, Withdraw)
// =========================================================================
{
  const root = mkdtempSync(path.join(os.tmpdir(), 'pa-verify-s531p2-'));
  const dbPath = path.join(root, 'runtime.sqlite');
  const storageDir = path.join(root, 'notif');
  mkdirSync(storageDir, {recursive: true});

  const shownHandles = new Map();
  let autoShow = false;
  const notifier = {
    async isSupported() { return true; },
    async show(input, callbacks) {
      shownHandles.set(input.id, {callbacks, closed: false});
      if (autoShow) callbacks.onShow();
      return {close: () => { shownHandles.get(input.id).closed = true; }};
    },
  };

  let app, client, notifAppHost, channel;
  const open = async () => {
    channel = createDesktopNotificationPort({
      storageDir,
      notifier,
      onOutcome: outcome => notifAppHost?.receipt(outcome),
    });
    notifAppHost = createDesktopNotificationApplicationHost({namespace: 's531p2-user', channel});
    const hosts = createDesktopBusinessWorkflowHosts({
      getApplication: () => app,
      getNotificationHost: () => notifAppHost,
    });
    app = createRuntimeApplication({
      path: dbPath,
      profile: 'huawei_ict_agentarts',
      hostUserNamespace: 's531p2-user',
      tools: [...notifAppHost.tools, ...hosts.workflowHostTools],
      riskAutonomy: false,
    });
    client = new Client(app);
    await client.connect();
    notifAppHost.bindApplication(app, client);
  };

  try {
    await open();
    const cfg = await notifAppHost.configureSettings({
      operationId: 'verify-p2-policy',
      expectedRevision: 0,
      scope: {kind: 'global'},
      patch: {
        mode: 'normal', maxInterruptions: null, windowMinutes: 15, silentUntilUtc: null,
        preferredChannel: 'banner', allowUrgentBreakthrough: false, digestMode: 'on_return', quietHours: null,
      },
    });
    assert.equal(cfg.state, 'confirmed');
    const deadline = new Date(Date.now() + 60_000).toISOString();

    const policyTask = await runHostAdapter(app, 'workflow.host.f12_n02', {scope: {kind: 'global'}}, deadline);
    assert.equal(policyTask.task.state, 'succeeded');

    const nowIso = new Date().toISOString();
    notifAppHost.ingest([
      {source: 'mail', accountRef: 'a', externalId: 'm1', occurredAt: nowIso, fetchedAt: nowIso, contentRef: 'Ref-1', sensitivity: 'private', dedupeKey: 'k1'},
      {source: 'mail', accountRef: 'a', externalId: 'm2', occurredAt: nowIso, fetchedAt: nowIso, contentRef: 'Ref-2', sensitivity: 'private', dedupeKey: 'k2'},
    ], {scope: {kind: 'global'}});
    const drained = notifAppHost.drain();
    const batch1 = drained.batches[0].id;

    // Pending (autoShow=false) -> task fails/uncertain without marking delivered
    autoShow = false;
    const pendingTask = await runHostAdapter(app, 'workflow.host.f12_n04', {
      batchId: batch1, title: 'Pending Item', body: 'Await show', expiresAt: deadline,
    }, deadline);
    assert.equal(pendingTask.task.state, 'waiting_reconciliation');

    const pendingRecord = channel.list().find(r => r.title === 'Pending Item');
    const withdrawTask = await runHostAdapter(app, 'workflow.host.f12_n05', {
      action: 'withdraw', id: pendingRecord.id, reason: 'policy_superseded',
    }, deadline);
    assert.equal(withdrawTask.task.state, 'succeeded');
    assert.equal(withdrawTask.confirmed.result.withdrawn, true);

    // Delivered + Click (autoShow=true)
    notifAppHost.ingest([
      {source: 'mail', accountRef: 'a', externalId: 'm3', occurredAt: nowIso, fetchedAt: nowIso, contentRef: 'Ref-3', sensitivity: 'private', dedupeKey: 'k3'},
    ], {scope: {kind: 'global'}});
    const drained2 = notifAppHost.drain();
    const batch2 = drained2.batches.at(-1).id;
    autoShow = true;
    const deliverTask = await runHostAdapter(app, 'workflow.host.f12_n04', {
      batchId: batch2, title: 'Confirmed Item', body: 'Delivered body', expiresAt: deadline,
    }, deadline);
    assert.equal(deliverTask.task.state, 'succeeded', JSON.stringify(deliverTask.task.error));
    const confirmedRecord = channel.list().find(r => r.title === 'Confirmed Item');
    shownHandles.get(confirmedRecord.id).callbacks.onClick();

    // Restart SQLite & notification store -> verify persisted click + withdraw ledgers survive
    notifAppHost.dispose();
    await client.close?.();
    app.close();
    await open();

    const audit = notifAppHost.listChannelAuditReceipts();
    assert.equal(audit.clicks.some(c => c.id === confirmedRecord.id), true);
    assert.equal(audit.withdraws.some(w => w.id === pendingRecord.id), true);

    const receipt = {
      package: 'S531-P2',
      issues: ['#21', 'F12'],
      verifiedAt: new Date().toISOString(),
      checks: {
        f12PolicyTaskId: policyTask.task.taskId,
        pendingStaysWaitingReconciliation: pendingTask.task.taskId,
        withdrawTaskId: withdrawTask.task.taskId,
        confirmedDeliverTaskId: deliverTask.task.taskId,
        crossRestartAuditClicks: audit.clicks.length,
        crossRestartAuditWithdraws: audit.withdraws.length,
      },
    };
    writeFileSync(path.join(RECEIPT_DIR, 's531-p2-receipt.json'), JSON.stringify(receipt, null, 2), 'utf8');
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    notifAppHost?.dispose();
    await client?.close?.();
    app?.close();
    try { rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50}); } catch { /* noop */ }
  }
}

// =========================================================================
// 2. P-06 Verification (F16 & F19 CI Failure + Issue Repair Host Flow)
// =========================================================================
{
  const root = mkdtempSync(path.join(os.tmpdir(), 'pa-verify-p06-'));
  const dbPath = path.join(root, 'runtime.sqlite');
  let prMerged = true;
  let issueState = 'open';

  const ghProvider = new GhCliProvider({
    repositories: ['acme/agent'],
    readToken: async () => 'ghs_syntheticP06Token999',
    runner: {
      async run({args}) {
        const joined = args.join(' ');
        if (joined.includes('repos/acme/agent/actions/runs?')) {
          return {exitCode: 0, stderr: '', stdout: JSON.stringify({workflow_runs: [{id: 501, name: 'CI', status: 'completed', conclusion: 'failure', head_sha: '1'.repeat(40), html_url: 'https://github.com/acme/agent/actions/runs/501', created_at: '2026-11-20T01:00:00Z'}]})};
        }
        if (joined.includes('repos/acme/agent/actions/runs/501/jobs')) {
          return {exitCode: 0, stderr: '', stdout: JSON.stringify({jobs: [{id: 601, run_id: 501, name: 'unit', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/acme/agent/actions/runs/501/job/601'}]})};
        }
        if (joined.includes('repos/acme/agent/actions/jobs/601')) {
          return {exitCode: 0, stderr: '', stdout: JSON.stringify({id: 601, run_id: 501, conclusion: 'failure'})};
        }
        if (args[0] === 'run' && args[1] === 'view') {
          return {exitCode: 0, stderr: '', stdout: 'FAIL test/math.test.mjs\nAssertionError: 2 + 2 !== 5'};
        }
        if (joined.includes('repos/acme/agent/pulls/88')) {
          return {
            exitCode: 0, stderr: '',
            stdout: JSON.stringify({
              number: 88, title: 'Fix math', body: 'Closes #19', state: 'closed',
              base: {ref: 'main', sha: '2'.repeat(40)}, head: {ref: 'fix/19', sha: '3'.repeat(40)},
              html_url: 'https://github.com/acme/agent/pull/88', draft: false,
              merged: prMerged, merged_at: '2026-11-20T05:00:00Z',
            }),
          };
        }
        if (joined.includes('repos/acme/agent/issues/19/comments')) {
          return {exitCode: 0, stderr: '', stdout: JSON.stringify({id: 301, html_url: 'https://github.com/acme/agent/issues/19#comment-301'})};
        }
        if (joined.includes('repos/acme/agent/issues/19') && args.includes('PATCH')) {
          issueState = 'closed';
          return {exitCode: 0, stderr: '', stdout: JSON.stringify({number: 19, state: 'closed', html_url: 'https://github.com/acme/agent/issues/19'})};
        }
        if (joined.includes('repos/acme/agent/issues/19')) {
          return {
            exitCode: 0, stderr: '',
            stdout: JSON.stringify({
              number: 19, title: 'Math addition off by 1', body: 'Repro', state: issueState,
              labels: [{name: 'bug'}], html_url: 'https://github.com/acme/agent/issues/19',
              updated_at: '2026-11-20T02:00:00Z',
            }),
          };
        }
        return {exitCode: 1, stdout: '', stderr: 'HTTP 404 Not Found'};
      },
    },
  });
  const ghService = new GitHubService(ghProvider);
  let app;
  const hosts = createDesktopBusinessWorkflowHosts({
    getApplication: () => app,
    getGithubPort: () => ghService,
  });

  try {
    app = createRuntimeApplication({
      path: dbPath,
      profile: 'huawei_ict_agentarts',
      hostUserNamespace: 'p06-verify-user',
      tools: [...hosts.workflowHostTools],
      riskAutonomy: false,
    });
    const deadline = new Date(Date.now() + 60_000).toISOString();

    const f16Ci = await runHostAdapter(app, 'workflow.host.f16_n01', {owner: 'acme', repo: 'agent', commitSha: '1'.repeat(40)}, deadline);
    assert.equal(f16Ci.task.state, 'succeeded', JSON.stringify(f16Ci.task.error));
    assert.equal(f16Ci.confirmed.result.runId, 501);

    const f16Intent = await runHostAdapter(app, 'workflow.host.f16_n04', {patch: 'diff --git a/src/math.ts b/src/math.ts\n- return 5;\n+ return 4;'}, deadline);
    assert.equal(f16Intent.task.state, 'succeeded');
    assert.equal(f16Intent.confirmed.result.preserved, true);

    const f19Snap = await runHostAdapter(app, 'workflow.host.f19_n01', {owner: 'acme', repo: 'agent', number: 19}, deadline);
    assert.equal(f19Snap.task.state, 'succeeded');
    assert.equal(f19Snap.confirmed.result.state, 'open');

    const f19Enqueue = await runHostAdapter(app, 'workflow.host.f19_n03', {owner: 'acme', repo: 'agent', number: 19, linkedPrNumber: 88}, deadline);
    assert.equal(f19Enqueue.task.state, 'succeeded');
    const queuedRepairTask = app.runtime.getTask(f19Enqueue.confirmed.result.taskId);
    assert.equal(queuedRepairTask.conversationId, 'developer-issue-repair:acme/agent');

    const f19Merged = await runHostAdapter(app, 'workflow.host.f19_n04', {owner: 'acme', repo: 'agent', number: 19, repairPr: 88}, deadline);
    assert.equal(f19Merged.task.state, 'succeeded');
    assert.equal(f19Merged.confirmed.result.merged, true);

    const f19Close = await runHostAdapter(app, 'workflow.host.f19_n05', {
      owner: 'acme', repo: 'agent', number: 19, repairPr: 88, verifiedPassed: true,
      expectedUpdatedAt: '2026-11-20T02:00:00Z', comment: 'Closed after verified PR #88 merge',
    }, deadline);
    assert.equal(f19Close.task.state, 'succeeded', JSON.stringify(f19Close.task.error));
    assert.equal(f19Close.confirmed.result.closedSuccess, true);
    assert.equal(issueState, 'closed');

    const receipt = {
      package: 'P-06',
      workflows: ['F16', 'F19'],
      verifiedAt: new Date().toISOString(),
      checks: {
        f16CiFailureTaskId: f16Ci.task.taskId,
        f16RunId: f16Ci.confirmed.result.runId,
        f16TestIntentTaskId: f16Intent.task.taskId,
        f19IssueSnapshotTaskId: f19Snap.task.taskId,
        f19EnqueueRepairTaskId: f19Enqueue.task.taskId,
        f19SpawnedChildTaskId: f19Enqueue.confirmed.result.taskId,
        f19MergedReadbackTaskId: f19Merged.task.taskId,
        f19CloseIssueTaskId: f19Close.task.taskId,
        issueClosedState: issueState,
      },
    };
    writeFileSync(path.join(RECEIPT_DIR, 'p06-receipt.json'), JSON.stringify(receipt, null, 2), 'utf8');
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    ghService.dispose();
    app?.close();
    try { rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50}); } catch { /* noop */ }
  }
}
