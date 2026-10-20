import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as coding from '@personal-agent/coding-tools';
import {Client} from '@personal-agent/client';
import {
  createRuntimeApplication,
  createWindowsHostNotepadAdapter,
  createRuntimeWindowsHostAttemptStore,
} from '@personal-agent/runtime/application';
import {createDesktopNotepadHost} from '../electron/notepad-host.js';
import {createWorkspaceConfigHost} from '../electron/workspace-config-host.js';
import {createWorkspaceCommandRecipeTool} from '../electron/workspace-command-recipes.js';

async function until(predicate, maxTries = 200, delayMs = 5) {
  for (let n = 0; n < maxTries; n++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw Error('Expected state did not arrive in time');
}

test('coding capabilities in authorized synthetic workspace: restricted patch, command, and result readback', async t => {
  const baseDir = mkdtempSync(path.join(tmpdir(), 'pa-coding-synthetic-'));
  const workspaceRoot = path.join(baseDir, 'project');
  const userDataDir = path.join(baseDir, 'user-data');
  mkdirSync(workspaceRoot, {recursive: true});
  mkdirSync(userDataDir, {recursive: true});

  const testFile = path.join(workspaceRoot, 'sample.js');
  writeFileSync(testFile, 'const greeting = "Hello World";\nconsole.log(greeting);\n', 'utf8');

  t.after(() => {
    rmSync(baseDir, {recursive: true, force: true});
  });

  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: val => Buffer.from(val).reverse(),
    decryptString: buf => Buffer.from(buf).reverse().toString(),
  };

  const createCommandRecipeTool = options => createWorkspaceCommandRecipeTool({
    ...options,
    createWorkspaceCommandTool: coding.createWorkspaceCommandTool,
  });

  let host = createWorkspaceConfigHost({
    userData: userDataDir,
    safeStorage,
    selectDirectory: async () => workspaceRoot,
    selectNodeExecutable: async () => process.execPath,
    selectCheckFile: async () => testFile,
    createCommandRecipeTool,
  });

  // 1. 验证未授权前工具不可用
  assert.equal(host.snapshot().configured, false);
  await host.select();
  await host.selectNode();
  await host.selectCheckFile();
  assert.equal(host.snapshot().configured, true);
  assert.equal(host.snapshot().readAvailable, false);
  host.close();

  // 模拟应用重启装配持久化的工作区
  host = createWorkspaceConfigHost({
    userData: userDataDir,
    safeStorage,
    selectDirectory: async () => workspaceRoot,
    selectNodeExecutable: async () => process.execPath,
    selectCheckFile: async () => testFile,
    createCommandRecipeTool,
  });

  // 2. 授权工作区权限（读取、写入、受限命令与 AgentArts 出云导出）
  await host.authorize({
    cloudExportAllowed: true,
    writeAllowed: true,
    commandAllowed: true,
    projectCodeAllowed: false,
  });
  assert.equal(host.snapshot().readAvailable, true);
  assert.equal(host.snapshot().commandAvailable, true);

  // 3. 绑定 Runtime Application
  const runtimeDbPath = path.join(userDataDir, 'runtime.sqlite');
  const app = createRuntimeApplication({
    path: runtimeDbPath,
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'coding-test-user',
    tools: host.tools,
  });
  host.bindApplication(app);

  const submitted = app.runtime.submitTask({
    goal: 'Run workspace tools in authorized workspace',
    conversationId: 'desktop-workspace',
    idempotencyKey: 'coding-test-task-1',
  });
  const taskId = submitted.taskId;
  const signal = new AbortController().signal;
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const context = {
    taskId,
    runId: 'run-read-1',
    signal,
    deadline,
    authorizationRef: `auth-${taskId}`,
    scopes: ['workspace:read'],
  };

  // 必须先通过 availability 绑定当前 task
  const readAvailability = host.competitionToolAvailability.find(a => a.toolName === 'workspace.read_text');
  assert.ok(readAvailability);
  assert.equal(readAvailability.available({taskId, signal}), true);

  // 4. 执行受限 workspace.read_text 读取文件
  const readTool = host.tools.find(t => t.descriptor.name === 'workspace.read_text');
  assert.ok(readTool);
  const readResult = await readTool.execute({path: 'sample.js'}, context);
  assert.equal(readResult.path, 'sample.js');
  assert.match(readResult.content, /Hello World/);

  // 5. 校验敏感与越界读取被严格拒绝
  await assert.rejects(readTool.execute({path: '../outside.js'}, context), /越界|outside|invalid|denied|segments|canonical/i);

  // 6. 执行受限 workspace.preview_text_patch 预览文本补丁
  const previewTool = host.tools.find(t => t.descriptor.name === 'workspace.preview_text_patch');
  assert.ok(previewTool);
  const previewContext = {...context, runId: 'run-preview-1', scopes: ['workspace:read']};
  const previewResult = await previewTool.execute({
    path: 'sample.js',
    expectedSha256: createHash('sha256').update(readResult.content).digest('hex'),
    edits: [{
      oldText: '"Hello World"',
      newText: '"Hello PersonalAgent"',
    }],
  }, previewContext);
  assert.equal(previewResult.path, 'sample.js');
  assert.equal(previewResult.changed, true);
  assert.match(previewResult.previewText, /Hello PersonalAgent/);

  // 7. 执行受限 workspace.node_check 语法检查命令
  const nodeCheckAvailability = host.competitionToolAvailability.find(a => a.toolName === 'workspace.node_check');
  assert.ok(nodeCheckAvailability);
  assert.equal(nodeCheckAvailability.available({taskId, signal}), true);
  const nodeCheckTool = host.tools.find(t => t.descriptor.name === 'workspace.node_check');
  assert.ok(nodeCheckTool);
  const nodeCheckResult = await nodeCheckTool.execute({}, {
    ...context,
    runId: 'run-node-check-1',
    scopes: ['workspace:execute'],
  });
  assert.equal(nodeCheckResult.recipeId, 'node-check');
  assert.equal(nodeCheckResult.exitCode, 0);

  // 8. 校验通过 competitionToolExports 导出的脱敏投影结果
  const nodeExport = host.competitionToolExports.find(e => e.toolName === 'workspace.node_check');
  assert.ok(nodeExport);
  assert.equal(nodeExport.accepts({taskId}), true);
  const projectedNode = nodeExport.project({
    taskId,
    result: {...nodeCheckResult, stderr: `${workspaceRoot}\\private.js leaked`},
    signal,
  });
  assert.deepEqual(projectedNode, {recipeId: 'node-check', exitCode: 0, passed: true});

  // 9. 撤销授权后拒绝继续执行
  host.revoke();
  assert.equal(readAvailability.available({taskId, signal}), false);
  await assert.rejects(readTool.execute({path: 'sample.js'}, context), /工作区许可已撤销/);

  host.close();
  app.close();
});

test('Windows Notepad capability: synthetic window verification, physical confirmation, write and readback', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pa-notepad-acceptance-'));
  const framesSent = [];
  let confirmationCallback;
  let client;
  let observedExpiresAt;

  t.after(async () => {
    await host.close();
    await until(() => app.activeTaskCount === 0);
    app.close();
    rmSync(directory, {recursive: true, force: true});
  });

  const host = createDesktopNotepadHost({
    createAdapter: createWindowsHostNotepadAdapter,
    createAttempts: createRuntimeWindowsHostAttemptStore,
    transport: {
      async openVerifiedConnection() {
        return {
          async send(frame) { framesSent.push(frame); },
          async close() {},
          async exchange(frame) {
            framesSent.push(frame);
            const base = {protocolVersion: frame.protocolVersion, requestId: frame.requestId, sessionId: frame.sessionId};
            if (frame.kind === 'hello') {
              return {...base, kind: 'hello_ack', clientNonce: frame.clientNonce, hostNonce: 'c'.repeat(32), sessionId: 'notepad-test-sess'};
            }
            if (frame.kind === 'observe') {
              observedExpiresAt = new Date(Date.now() + 30_000).toISOString();
              return {
                ...base,
                kind: 'observed',
                targetRef: 'target-synth-notepad-456',
                expiresAt: observedExpiresAt,
                source: 'windows-uia',
              };
            }
            if (frame.kind === 'target_ready') {
              return {...base, kind: 'target_ready_result', targetRef: frame.targetRef,
                ready: true, expiresAt: observedExpiresAt};
            }
            if (frame.kind === 'execute') {
              return {
                ...base,
                kind: 'result',
                taskId: frame.taskId,
                runId: frame.runId,
                toolName: frame.toolName,
                toolVersion: frame.toolVersion,
                argumentsDigest: frame.argumentsDigest,
                targetRef: frame.targetRef,
                state: 'verified',
                evidenceRef: 'evidence-notepad-456',
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
              };
            }
            throw Error('Unexpected frame in synthetic test transport');
          },
        };
      },
    },
    registerConfirmation: cb => {
      confirmationCallback = cb;
      return () => { confirmationCallback = undefined; };
    },
    openNotepad: async () => {},
    respond: payload => client.call('authorization.respond', payload),
    cancelTask: taskId => client.call('task.cancel', {taskId, reason: 'user cancelled'}),
  });

  const app = createRuntimeApplication({
    path: path.join(directory, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'notepad-test-user',
    tools: host.tools,
  });
  host.bind(app);

  client = new Client(app, Date.now);
  await client.connect();

  // 1. 提交写入任务
  const op = host.start({text: 'MVP Windows Notepad Automation Text'});
  assert.equal(host.snapshot().busy, true);
  await until(() => host.snapshot().state === 'waiting_confirmation');

  // 2. 验证物理手势（F9确认）前不会触发实际写入
  assert.equal(framesSent.some(f => f.kind === 'execute'), false);

  // 3. 触发确认
  assert.ok(typeof confirmationCallback === 'function');
  confirmationCallback();

  // 4. 等待完成
  await until(async () => {
    await host.refresh();
    return !host.snapshot().busy;
  });

  // 5. 校验执行终态与证据
  assert.equal(host.snapshot().state, 'succeeded');
  const executeFrames = framesSent.filter(f => f.kind === 'execute');
  assert.equal(executeFrames.length, 1);
  assert.equal(executeFrames[0].expectedText, '');
  assert.equal(executeFrames[0].replacementText, 'MVP Windows Notepad Automation Text');
  assert.ok(Array.isArray(host.snapshot().evidenceRefs) && host.snapshot().evidenceRefs.length > 0);

  // 6. 校验敏感正文未泄露在快照中
  assert.equal(JSON.stringify(host.snapshot()).includes('MVP Windows Notepad Automation Text'), false);
});
