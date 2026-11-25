import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {locateTestFailures} from '@personal-agent/coding-tools';
import {locateFailureText, projectNodeCheckDiagnostics} from '../electron/node-check-diagnostics.js';

test('failed node_check stderr is projected for locate without requiring cloud export fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'node-check-diag-'));
  try {
    writeFileSync(join(root, 'broken.mjs'), 'function broken( {\n');
    const execution = spawnSync(process.execPath, ['--check', 'broken.mjs'], {cwd: root, encoding: 'utf8'});
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /SyntaxError/);
    const runId = 'node-check-run-1';
    const task = {
      taskId: 'task-node-check',
      state: 'failed',
      error: {code: 'TOOL_FAILED', message: 'node check failed'},
    };
    const runtime = {
      readToolExecutions() {
        return [{
          evidenceId: runId,
          toolName: 'workspace.node_check',
          toolVersion: '1.0.0',
          state: 'confirmed',
          executionStarted: true,
          policyDecision: 'allow',
          inputDigest: 'digest',
          protocolVersion: '1.0.0',
          requestId: runId,
          taskId: task.taskId,
          startedAt: '2026-11-20T00:00:00.000Z',
          finishedAt: '2026-11-20T00:00:01.000Z',
        }];
      },
      loadCheckpoint(_taskId, key) {
        if (key === `tool-result-${runId}`) {
          return {result: {recipeId: 'node-check', exitCode: 1, stdout: '', stderr: execution.stderr}};
        }
        return undefined;
      },
    };
    const diagnostics = projectNodeCheckDiagnostics(runtime, task);
    assert.equal(diagnostics.toolName, 'workspace.node_check');
    assert.equal(diagnostics.recipeId, 'node-check');
    assert.equal(diagnostics.exitCode, 1);
    assert.match(diagnostics.stderr, /SyntaxError/);
    const projected = {...task, resultMetadata: {diagnostics}};
    assert.equal(locateFailureText(projected), execution.stderr);
    const report = locateTestFailures(projected.resultMetadata.diagnostics.stderr, {
      root,
      allowedPaths: [],
      maxSnippetReads: 0,
      contextLines: 2,
    });
    assert.equal(report.totalFailures, 1);
    assert.equal(report.failures[0].reporter, 'node-check');
    assert.ok(report.failures[0].frames[0].line > 0);
    assert.equal(projectNodeCheckDiagnostics(runtime, {...task, state: 'succeeded'}), undefined);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
