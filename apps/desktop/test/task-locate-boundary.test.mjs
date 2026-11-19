import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {locateTestFailures} from '@personal-agent/coding-tools';
import {TaskRuntime} from '@personal-agent/runtime';
import {collectTrustedTaskCommandDiagnostics, resolveTaskLocateInput} from '../electron/task-locate-diagnostics.js';

test('actual task.locate route classifies private stack paths without opening any source file',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'task-locate-boundary-'));
  const file=path.join(root,'private.js');fs.writeFileSync(file,'const privateMarker = "must-not-leave-the-host";\n');
  const source=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  let route;function visit(node){if(ts.isIfStatement(node)&&node.expression.getText(ast)==="name === 'task.locate'")route=node;
    ts.forEachChild(node,visit);}visit(ast);assert.ok(route);
  const panel={},context=vm.createContext({panel,admin:{},workspace:{},repoRootForLocate:()=>root,codingPorts:{locateTestFailures}});
  const invoke=vm.runInContext(`(async function(sender,name,payload){${route.getText(ast).replace("await import('@personal-agent/coding-tools')",'codingPorts')}})`,context);
  const original=fs.openSync;let reads=0;
  fs.openSync=(...args)=>{if(String(args[0])===file)reads++;return original(...args);};syncBuiltinESMExports();
  try {
    const result=await invoke(panel,'task.locate',{text:`✖ synthetic failure (1ms)\n  Error: synthetic\n      at fn (${file}:1:1)`});
    assert.equal(result.totalFailures,1);assert.equal(result.failures[0].frames[0].file,'private.js');
    assert.equal(result.failures[0].frames[0].snippet,null);assert.equal(reads,0);
    assert.equal(JSON.stringify(result).includes('must-not-leave-the-host'),false);
    await assert.rejects(invoke({},'task.locate',{text:'✖ untrusted'}));
  } finally {fs.openSync=original;syncBuiltinESMExports();fs.rmSync(root,{recursive:true,force:true});}
});

test('task.locate collects allowlisted workspace.node_check stderr from TaskRuntime checkpoints without reading source files (L-06 #649)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-locate-runtime-'));
  const targetFile = path.join(root, 'broken.js');
  fs.writeFileSync(targetFile, 'const ok = 1;\nconst alsoOk = 2;\nfunction broken( { return 3; }\n');
  const runtime = new TaskRuntime(path.join(root, 'runtime.sqlite'));
  const source = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let route;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(ast) === "name === 'task.locate'") route = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(route);

  const original = fs.openSync;
  let reads = 0;
  fs.openSync = (...args) => { if (String(args[0]) === targetFile) reads++; return original(...args); };
  syncBuiltinESMExports();

  try {
    const task = runtime.submitTask({goal: '检查 broken.js 语法', conversationId: 'panel-conv', idempotencyKey: 'locate-node-check'});
    runtime.saveCheckpoint(task.taskId, 'tool-result-ev-node-check-1', {
      result: {
        recipeId: 'node_check',
        exitCode: 1,
        passed: false,
        stderr: `${targetFile}:3\nfunction broken( { return 3; }\n                 ^\n\nSyntaxError: Unexpected token '{'\n    at checkSyntax (node:internal/main/check_syntax:78:5)\n\nNode.js v24.22.1\n`,
      },
    });
    // Non-allowlisted private tool stderr must never be read into locate diagnostics.
    runtime.saveCheckpoint(task.taskId, 'tool-result-ev-mail-1', {
      result: {
        stderr: `Error: private mail body\n    at secret (${path.join(root, 'secret-mail.js')}:9:1)`,
      },
    });
    const runtimeView = {
      getTask: id => runtime.getTask(id),
      loadCheckpoint: (id, key) => runtime.loadCheckpoint(id, key),
      readToolExecutions: id => id === task.taskId
        ? [
          {taskId: task.taskId, toolName: 'workspace.node_check', evidenceId: 'ev-node-check-1', state: 'confirmed'},
          {taskId: task.taskId, toolName: 'mail.inbox', evidenceId: 'ev-mail-1', state: 'failed'},
        ]
        : [],
    };

    const diagnostics = collectTrustedTaskCommandDiagnostics(runtimeView, task.taskId);
    assert.match(diagnostics, /broken\.js:3/);
    assert.equal(diagnostics.includes('secret-mail.js'), false);

    const panel = {};
    const workspace = {};
    const admin = {};
    const tasks = new Map([[task.taskId, {taskId: task.taskId, surface: 'panel', bodyWithheld: false}]]);
    const context = vm.createContext({
      panel, admin, workspace, tasks,
      taskSurface: item => item.surface,
      runtimeClosed: false,
      runtimeApplication: {runtime: runtimeView, readSubagentTasks: () => []},
      resolveTaskLocateInput,
      repoRootForLocate: () => root,
      codingPorts: {locateTestFailures},
    });
    const invoke = vm.runInContext(
      `(async function(sender,name,payload){${route.getText(ast).replace("await import('@personal-agent/coding-tools')", 'codingPorts')}})`,
      context,
    );

    // Even with generic summary text, taskId pulls the allowlisted node_check stderr and locates line 3.
    const report = await invoke(panel, 'task.locate', {taskId: task.taskId, text: '命令检查失败'});
    assert.equal(report.totalFailures, 1);
    assert.equal(report.failures[0].frames[0].file, 'broken.js');
    assert.equal(report.failures[0].frames[0].line, 3);
    assert.equal(report.failures[0].frames[0].snippet, null);
    assert.equal(reads, 0);

    // Cross-surface request or bodyWithheld task must not expose command diagnostics.
    assert.equal(
      resolveTaskLocateInput({
        payload: {taskId: task.taskId, text: ''},
        sender: workspace,
        panel, admin, workspace, tasks,
        taskSurface: item => item.surface,
        runtime: runtimeView,
      }),
      '',
    );
    tasks.set(task.taskId, {taskId: task.taskId, surface: 'panel', bodyWithheld: true});
    assert.equal(
      resolveTaskLocateInput({
        payload: {taskId: task.taskId, text: ''},
        sender: panel,
        panel, admin, workspace, tasks,
        taskSurface: item => item.surface,
        runtime: runtimeView,
      }),
      '',
    );
  } finally {
    fs.openSync = original;
    syncBuiltinESMExports();
    runtime.close();
    fs.rmSync(root, {recursive: true, force: true});
  }
});
