import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, realpathSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import test from 'node:test';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {
  createWorkspaceCreateTextTool,
  reconcileWorkspaceCreateText,
  WORKSPACE_CREATE_TEXT_TOOL_NAME,
} from '../dist/index.js';

const powerShellPath = process.env.PA_TEST_POWERSHELL
  ?? process.env.PA_TEST_PWSH
  ?? (process.env.PATH ?? '').split(delimiter).map(directory => join(directory, 'pwsh.exe')).find(existsSync)
  ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
const unavailable = process.platform !== 'win32' || !existsSync(powerShellPath)
  ? 'Windows PowerShell 7 helper is unavailable' : false;
const bundledHelper = new URL('../scripts/locked-apply.ps1', import.meta.url);

const sha = text => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-create-'));
  const root = join(base, 'workspace');
  const recoveryRootPath = join(base, 'trusted-recovery');
  await mkdir(join(root, 'src'), {recursive: true});
  await mkdir(recoveryRootPath);
  const helperScriptPath = join(base, 'locked-apply.ps1');
  await writeFile(helperScriptPath, await readFile(bundledHelper));
  t.after(() => rm(base, {recursive: true, force: true}));
  return {base, root, recoveryRootPath, helperScriptPath};
}

function context(input, overrides = {}) {
  return {
    taskId: 'create-task', runId: 'create-run-1', argumentsDigest: toolArgumentsDigest(input),
    deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal,
    scopes: ['workspace:read', 'workspace:write', 'workspace:create'], ...overrides,
  };
}

test('creates a new UTF-8 file through the locked helper and refuses to overwrite it', {skip: unavailable}, async t => {
  const {root, recoveryRootPath, helperScriptPath} = await fixture(t);
  const tool = createWorkspaceCreateTextTool({rootPath: root, recoveryRootPath, powerShellPath, helperScriptPath});
  assert.equal(tool.descriptor.name, WORKSPACE_CREATE_TEXT_TOOL_NAME);
  const input = {path: 'src/hello.txt', content: 'hello 世界\n'};
  const result = await tool.execute(input, context(input));
  assert.deepEqual(result, {path: 'src/hello.txt', encoding: 'utf-8', byteLength: Buffer.byteLength(input.content), sha256: sha(input.content), created: true});
  assert.equal(await readFile(join(root, 'src', 'hello.txt'), 'utf8'), input.content);
  await assert.rejects(tool.execute(input, context(input)), {code: 'REVISION_CONFLICT'});
  assert.equal(await readFile(join(root, 'src', 'hello.txt'), 'utf8'), input.content);
});

test('rejects missing parents, path escapes, sensitive paths and missing scopes without writing', {skip: unavailable}, async t => {
  const {root, recoveryRootPath, helperScriptPath} = await fixture(t);
  const tool = createWorkspaceCreateTextTool({rootPath: root, recoveryRootPath, powerShellPath, helperScriptPath});
  for (const path of ['missing/hello.txt', '../outside.txt', 'C:/Windows/x.txt', '.ssh/id_rsa', 'src/../x.txt']) {
    await assert.rejects(tool.execute({path, content: 'x'}, context({path, content: 'x'})));
  }
  const input = {path: 'src/denied.txt', content: 'x'};
  await assert.rejects(tool.execute(input, context(input, {scopes: ['workspace:read', 'workspace:write']})), {code: 'SCOPE_DENIED'});
  await assert.rejects(readFile(join(root, 'src', 'denied.txt'), 'utf8'));
});

test('reconcile clears a matching marker and distinguishes created, not_created and unknown', {skip: unavailable}, async t => {
  const {root, recoveryRootPath, helperScriptPath} = await fixture(t);
  const tool = createWorkspaceCreateTextTool({rootPath: root, recoveryRootPath, powerShellPath, helperScriptPath});
  const input = {path: 'src/reconcile.txt', content: 'expected\n'};
  const digest = toolArgumentsDigest(input);
  await tool.execute(input, context(input));
  assert.equal(reconcileWorkspaceCreateText({rootPath: root, recoveryRootPath, relativePath: input.path,
    expectedRunId: 'create-run-1', expectedArgumentsDigest: digest, expectedSha256: sha(input.content)}).state, 'clear');

  const marker = join(recoveryRootPath, createMarkerName(root, input.path));
  const writeMarker = () => writeFile(marker, JSON.stringify({operation: 'create', runId: 'create-run-1',
    argumentsDigest: digest, pid: 1, startTimeTicks: '1', beforeSha256: null, afterSha256: sha(input.content)}));
  await writeMarker();
  const created = reconcileWorkspaceCreateText({rootPath: root, recoveryRootPath, relativePath: input.path,
    expectedRunId: 'create-run-1', expectedArgumentsDigest: digest, expectedSha256: sha(input.content)});
  assert.equal(created.state, 'reconciled');
  assert.equal(created.outcome, 'created');
  assert.equal(existsSync(marker), false);

  await writeMarker();
  await rm(join(root, 'src', 'reconcile.txt'));
  const notCreated = reconcileWorkspaceCreateText({rootPath: root, recoveryRootPath, relativePath: input.path,
    expectedRunId: 'create-run-1', expectedArgumentsDigest: digest, expectedSha256: sha(input.content),
    isProcessAlive: () => false});
  assert.equal(notCreated.state, 'reconciled');
  assert.equal(notCreated.outcome, 'not_created');

  await writeMarker();
  await writeFile(join(root, 'src', 'reconcile.txt'), 'different\n');
  const unknown = reconcileWorkspaceCreateText({rootPath: root, recoveryRootPath, relativePath: input.path,
    expectedRunId: 'create-run-1', expectedArgumentsDigest: digest, expectedSha256: sha(input.content)});
  assert.equal(unknown.state, 'reconciled');
  assert.equal(unknown.outcome, 'unknown');
  assert.equal(existsSync(marker), true, 'an unknown outcome retains its marker');
});

function createMarkerName(root, relativePath) {
  // Mirrors workspacePatchInflightPathFromCanonical without importing a private helper.
  const key = createHash('sha256').update(`${realpathSync.native(root)}\n${relativePath}`, 'utf8').digest('hex').slice(0, 32);
  return `${key}.inflight`;
}
