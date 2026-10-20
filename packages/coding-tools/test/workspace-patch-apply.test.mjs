import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, realpathSync} from 'node:fs';
import {link, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway, toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {
  createWorkspacePatchApplyTool,
  registerWorkspacePatchApply,
  WORKSPACE_PATCH_APPLY_SCOPE,
  WORKSPACE_PATCH_APPLY_TOOL_NAME,
  WORKSPACE_PATCH_APPLY_TOOL_VERSION,
} from '../dist/index.js';
import {createWorkspacePatchApplyToolFromPreview} from '../dist/patch-apply.js';

const sha = text => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const bundledHelper = new URL('../scripts/locked-apply.ps1', import.meta.url);
const powerShellPath = process.env.PA_TEST_POWERSHELL
  ?? process.env.PA_TEST_PWSH
  ?? (process.env.PATH ?? '').split(delimiter).map(directory => join(directory, 'pwsh.exe')).find(existsSync)
  ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
const unavailable = process.platform !== 'win32' || !existsSync(powerShellPath)
  ? 'Windows PowerShell 7 helper is unavailable' : false;
const processIdentityHelperPath = process.env.PA_TEST_JOB_HOST_EXE
  ?? join(import.meta.dirname, '..', 'native', 'bin', 'Release', 'net8.0-windows', 'WindowsJobProcessHost.exe');
const nativeIdentityUnavailable = process.platform !== 'win32' || !existsSync(processIdentityHelperPath)
  ? 'WindowsJobProcessHost.exe is unavailable' : false;
const nativeIdentityOptions = nativeIdentityUnavailable ? {} : {processIdentityHelperPath};

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-apply-'));
  const root = join(base, '工作区');
  const recoveryRootPath = join(base, 'trusted-recovery');
  await mkdir(join(root, 'src'), {recursive: true});
  await mkdir(recoveryRootPath);
  const source = join(root, 'src', 'note.txt');
  await writeFile(source, 'before\n');
  t.after(() => rm(base, {recursive: true, force: true}));
  return {base, root, recoveryRootPath, source};
}

async function installSyntheticHelper(base) {
  const directory = join(base, 'trusted-helper');
  await mkdir(directory);
  const helperScriptPath = join(directory, 'locked-apply.ps1');
  await writeFile(helperScriptPath, await readFile(bundledHelper));
  return helperScriptPath;
}

test('repository-root workspace keeps default helper isolation and accepts explicit external bundled helper', {skip: unavailable}, async t => {
  const {base, recoveryRootPath} = await fixture(t);
  const rootPath = fileURLToPath(new URL('../../../', import.meta.url));
  assert.throws(() => createWorkspacePatchApplyTool({rootPath, recoveryRootPath, powerShellPath}), {code: 'INVALID_ARGUMENT'});
  const helperScriptPath = await installSyntheticHelper(base);
  const tool = createWorkspacePatchApplyTool({rootPath, recoveryRootPath, powerShellPath, ...nativeIdentityOptions, helperScriptPath});
  assert.equal(tool.descriptor.name, WORKSPACE_PATCH_APPLY_TOOL_NAME);
  assert.deepEqual(await readdir(recoveryRootPath), []);
});

test('explicit relocated helper applies only the approved patch through the public factory', {skip: unavailable}, async t => {
  const {base, root, recoveryRootPath, source} = await fixture(t);
  const helperScriptPath = await installSyntheticHelper(base);
  const tool = createWorkspacePatchApplyTool({rootPath: root, recoveryRootPath, powerShellPath, ...nativeIdentityOptions, helperScriptPath});
  await assert.rejects(tool.execute({...request(sha('before\n')), helperScriptPath: 'model-selected.ps1'}, context()),
    {code: 'INVALID_ARGUMENT'});
  assert.equal((await tool.execute(request(sha('before\n')), context())).applied, true);
  assert.equal(await readFile(source, 'utf8'), 'after\n');
  assert.deepEqual(await readdir(recoveryRootPath), []);
});

test('relocated helper rejects relative paths, workspace/recovery containment, unknown contents and hardlinks', {skip: unavailable}, async t => {
  const {base, root, recoveryRootPath, source} = await fixture(t);
  const options = {rootPath: root, recoveryRootPath, powerShellPath, ...nativeIdentityOptions};
  const helperScriptPath = await installSyntheticHelper(base);
  const workspaceHelper = join(root, 'helper.ps1');
  const recoveryHelper = join(recoveryRootPath, 'helper.ps1');
  const unknownHelper = join(base, 'unknown.ps1');
  await writeFile(workspaceHelper, await readFile(bundledHelper));
  await writeFile(recoveryHelper, await readFile(bundledHelper));
  await writeFile(unknownHelper, 'Write-Output unsafe');
  for (const path of ['relative-helper.ps1', workspaceHelper, recoveryHelper, unknownHelper]) {
    assert.throws(() => createWorkspacePatchApplyTool({...options, helperScriptPath: path}), {code: 'INVALID_ARGUMENT'});
  }
  await link(helperScriptPath, join(root, 'helper-hardlink.ps1'));
  assert.throws(() => createWorkspacePatchApplyTool({...options, helperScriptPath}), {code: 'INVALID_ARGUMENT'});
  assert.equal(await readFile(source, 'utf8'), 'before\n');
});

test('helper mutation after registration stops before source write or inflight marker creation', {skip: unavailable}, async t => {
  const {base, root, recoveryRootPath, source} = await fixture(t);
  const helperScriptPath = await installSyntheticHelper(base);
  const tool = createWorkspacePatchApplyTool({rootPath: root, recoveryRootPath, powerShellPath, ...nativeIdentityOptions, helperScriptPath});
  await writeFile(helperScriptPath, 'Write-Output unsafe');
  await assert.rejects(tool.execute(request(sha('before\n')), context()), {code: 'INVALID_ARGUMENT'});
  assert.equal(await readFile(source, 'utf8'), 'before\n');
  assert.deepEqual(await readdir(recoveryRootPath), []);
});

const context = (overrides = {}) => ({
  taskId: 'task-apply-synthetic',
  runId: 'run-apply-synthetic',
  argumentsDigest: 'c'.repeat(64),
  authorizationRef: 'authorization-apply-synthetic',
  scopes: ['workspace:read', 'workspace:write', WORKSPACE_PATCH_APPLY_SCOPE],
  signal: new AbortController().signal,
  deadline: new Date(Date.now() + 60_000).toISOString(),
  ...overrides,
});

const request = expectedSha256 => ({
  path: 'src/note.txt', expectedSha256,
  edits: [{oldText: 'before', newText: 'after'}],
});

test('exclusive helper applies exact preview bytes and reads back before releasing the source', {skip: unavailable}, async t => {
  const {root, recoveryRootPath, source} = await fixture(t);
  const tool = createWorkspacePatchApplyTool({rootPath: root, recoveryRootPath, powerShellPath, ...nativeIdentityOptions});
  const result = await tool.execute(request(sha('before\n')), context());
  assert.deepEqual(result, {
    path: 'src/note.txt', beforeSha256: sha('before\n'), afterSha256: sha('after\n'),
    byteLength: Buffer.byteLength('after\n'), changed: true, applied: true,
  });
  assert.equal(await readFile(source, 'utf8'), 'after\n');
  assert.deepEqual(await readdir(recoveryRootPath), []);
});

test('exclusive helper can bind identity through the native process query helper', {
  skip: unavailable || nativeIdentityUnavailable,
}, async t => {
  const {root, recoveryRootPath, source} = await fixture(t);
  const tool = createWorkspacePatchApplyTool({rootPath: root, recoveryRootPath, powerShellPath,
    processIdentityHelperPath});
  const result = await tool.execute(request(sha('before\n')), context());
  assert.equal(result.applied, true);
  assert.equal(await readFile(source, 'utf8'), 'after\n');
  assert.deepEqual(await readdir(recoveryRootPath), []);
});

test('normal apply uses the helper READY handshake without an external identity query', {skip: unavailable}, async t => {
  const {root, recoveryRootPath, source} = await fixture(t);
  const tool = createWorkspacePatchApplyTool({rootPath: root, recoveryRootPath, powerShellPath});
  const result = await tool.execute(request(sha('before\n')), context());
  assert.equal(result.applied, true);
  assert.equal(await readFile(source, 'utf8'), 'after\n');
  assert.deepEqual(await readdir(recoveryRootPath), []);
});

test('stale source and an already open file are rejected without overwriting concurrent edits', {skip: unavailable}, async t => {
  const {root, recoveryRootPath, source} = await fixture(t);
  const tool = createWorkspacePatchApplyTool({rootPath: root, recoveryRootPath, powerShellPath, ...nativeIdentityOptions});
  await writeFile(source, 'user edit\n');
  await assert.rejects(tool.execute(request(sha('before\n')), context()), {code: 'REVISION_CONFLICT'});
  assert.equal(await readFile(source, 'utf8'), 'user edit\n');

  await writeFile(source, 'before\n');
  const held = await open(source, 'r');
  try {
    await assert.rejects(tool.execute(request(sha('before\n')), context()), {code: 'REVISION_CONFLICT'});
    assert.equal(await readFile(source, 'utf8'), 'before\n');
  } finally {
    await held.close();
  }
  assert.deepEqual(await readdir(recoveryRootPath), []);
});

test('apply has a separate scope and cannot modify the file after cancellation', {skip: unavailable}, async t => {
  const {root, recoveryRootPath, source} = await fixture(t);
  const tool = createWorkspacePatchApplyTool({rootPath: root, recoveryRootPath, powerShellPath, ...nativeIdentityOptions});
  await assert.rejects(tool.execute(request(sha('before\n')), context({scopes: ['workspace:read', 'workspace:write']})), {code: 'SCOPE_DENIED'});
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(tool.execute(request(sha('before\n')), context({signal: controller.signal})), {code: 'CANCELLED'});
  await link(source, join(root, 'src', 'hardlink.txt'));
  await assert.rejects(tool.execute(request(sha('before\n')), context()), {code: 'SCOPE_DENIED'});
  assert.equal(await readFile(source, 'utf8'), 'before\n');
  assert.deepEqual(await readdir(recoveryRootPath), []);
});

test('failed durable backup creation cannot reach the first source write', {skip: unavailable}, async t => {
  const {root, recoveryRootPath, source} = await fixture(t);
  const tool = createWorkspacePatchApplyTool({rootPath: root, recoveryRootPath, powerShellPath, ...nativeIdentityOptions});
  await rm(recoveryRootPath, {recursive: true});
  await assert.rejects(tool.execute(request(sha('before\n')), context()), {code: 'RESULT_UNKNOWN'});
  assert.equal(await readFile(source, 'utf8'), 'before\n');
});

test('Policy and ToolGateway require a parameter-bound one-use apply grant', {skip: unavailable}, async t => {
  const {root, recoveryRootPath, source} = await fixture(t);
  const policy = new InMemoryAuthorizationPolicy();
  const gateway = new ToolGateway({policy});
  const dispose = registerWorkspacePatchApply(gateway, {rootPath: root, recoveryRootPath, powerShellPath, ...nativeIdentityOptions});
  const argumentsValue = request(sha('before\n'));
  const invocation = {
    toolName: WORKSPACE_PATCH_APPLY_TOOL_NAME,
    toolVersion: WORKSPACE_PATCH_APPLY_TOOL_VERSION,
    arguments: argumentsValue,
    taskId: 'task-apply-synthetic', runId: 'run-apply-gateway',
    authorizationRef: 'authorization-apply-gateway',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };
  await assert.rejects(gateway.invoke(invocation), {code: 'UNAUTHORIZED'});
  assert.equal(await readFile(source, 'utf8'), 'before\n');
  policy.grant({
    authorizationRef: invocation.authorizationRef,
    taskId: invocation.taskId,
    toolName: invocation.toolName,
    scopes: ['workspace:read', 'workspace:write', WORKSPACE_PATCH_APPLY_SCOPE],
    argumentsDigest: toolArgumentsDigest(argumentsValue),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    maxUses: 1,
  });
  await assert.rejects(gateway.invoke({...invocation, arguments: {...argumentsValue, path: 'src/other.txt'}}), {code: 'SCOPE_DENIED'});
  assert.equal((await gateway.invoke(invocation)).applied, true);
  await assert.rejects(gateway.invoke(invocation), {code: 'UNAUTHORIZED'});
  dispose();
  await assert.rejects(gateway.invoke(invocation), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.equal(await readFile(source, 'utf8'), 'after\n');
});

test('an unresolved helper marker prevents another apply to the same source', {skip: unavailable}, async t => {
  const {root, recoveryRootPath, source} = await fixture(t);
  const tool = createWorkspacePatchApplyTool({rootPath: root, recoveryRootPath, powerShellPath, ...nativeIdentityOptions});
  const sourceKey = sha(`${realpathSync.native(root)}\nsrc/note.txt`).slice(0, 32);
  const marker = join(recoveryRootPath, `${sourceKey}.inflight`);
  await writeFile(marker, 'unresolved synthetic helper');
  await assert.rejects(tool.execute(request(sha('before\n')), context()), {code: 'RESULT_UNKNOWN'});
  assert.equal(await readFile(source, 'utf8'), 'before\n');
  assert.equal(await readFile(marker, 'utf8'), 'unresolved synthetic helper');
});


test('deadline expiring before helper request dispatch stops before sending patch bytes', {skip: unavailable}, async t => {
  const {root, recoveryRootPath, source} = await fixture(t);
  const deadlineMs = Date.now() + 60_000;
  let nowCalls = 0;
  const preview = {
    descriptor: {inputSchema: {type: 'object'}},
    execute: async () => ({
      path: 'src/note.txt',
      previewText: 'after\n',
      beforeSha256: sha('before\n'),
      afterSha256: sha('after\n'),
      changed: true,
    }),
  };
  const tool = createWorkspacePatchApplyToolFromPreview({
    rootPath: root,
    recoveryRootPath,
    powerShellPath,
    ...nativeIdentityOptions,
    preview,
    now: () => {
      nowCalls += 1;
      return nowCalls >= 4 ? deadlineMs : deadlineMs - 1;
    },
  });
  await assert.rejects(
    tool.execute({}, context({deadline: new Date(deadlineMs).toISOString()})),
    {code: 'TIMEOUT'},
  );
  assert.ok(nowCalls >= 3)
  assert.equal(await readFile(source, 'utf8'), 'before\n');
  assert.deepEqual(await readdir(recoveryRootPath), []);
});
