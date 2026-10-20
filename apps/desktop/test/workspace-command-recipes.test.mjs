import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, realpathSync, renameSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildWorkspaceCommandRecipes,
  createWorkspaceCommandRecipeTool,
  inferNpmCliFromNodeExecutable,
  sanitizeRecipeId,
} from '../electron/workspace-command-recipes.js';
import {buildNativeHelper, resolveRepoRoot} from '../../../packages/coding-tools/native/build-helper.mjs';

function createTempDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('candidate npm recipes use empty private config/cache/home and reject later config replacement',async t=>{
  const base=createTempDir('pa-isolated-npm-config-');t.after(()=>rmSync(base,{recursive:true,force:true}));
  const root=path.join(base,'candidate'),profile=path.join(base,'user-profile');mkdirSync(root);mkdirSync(profile);
  mkdirSync(path.join(root,'node_modules'));writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'fixture',scripts:{test:'node --test'}}));
  writeFileSync(path.join(profile,'.npmrc'),'explicit-account-fixture-do-not-read');
  const helper=path.join(base,process.platform==='win32'?'WindowsJobProcessHost.exe':'job-helper'),npm=path.join(base,'npm-cli.js');
  writeFileSync(helper,'explicit helper metadata fixture');writeFileSync(npm,'explicit npm metadata fixture');
  let executions=0;
  const options={workspaceRoot:root,nodeExecutable:process.execPath,jobHelperExecutable:helper,npmCliPath:npm,allowProjectScripts:true,
    projectScriptEnvSource:{APPDATA:profile,HOME:profile,PATH:path.dirname(process.execPath),NPM_TOKEN:'explicit-not-forwarded'},
    isolateNpmConfiguration:true,createWorkspaceCommandTool:()=>({descriptor:{},execute:async()=>{executions++;return {exitCode:0};}})};
  const recipe=createWorkspaceCommandRecipeTool(options),env=recipe.recipes.find(r=>r.id==='npm-test').env;
  assert.equal(env.NPM_CONFIG_OFFLINE,'true');assert.equal(env.NPM_CONFIG_IGNORE_SCRIPTS,'true');assert.equal(env.NPM_TOKEN,undefined);
  for(const key of['NPM_CONFIG_USERCONFIG','NPM_CONFIG_GLOBALCONFIG'])assert.equal(readFileSync(env[key],'utf8'),'');
  // The production recipe uses realpathSync.native; Windows temp paths may use
  // aliases/casing different from the original mkdtemp path spelling.
  const canonicalRoot=realpathSync.native(root);
  for(const key of['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','NPM_CONFIG_CACHE']){
    const confined=path.relative(canonicalRoot,realpathSync.native(env[key]));
    assert.ok(confined!==''&&confined!=='..'&&!confined.startsWith('..'+path.sep)&&!path.isAbsolute(confined),key);
  }
  assert.equal(readFileSync(path.join(profile,'.npmrc'),'utf8'),'explicit-account-fixture-do-not-read');
  assert.equal(recipe.available(),true);writeFileSync(env.NPM_CONFIG_USERCONFIG,'changed private npm config');
  assert.equal(recipe.available(),false);await assert.rejects(recipe.execute({recipeId:'npm-test'},{}),/mutated/);assert.equal(executions,0);
  const original=buildWorkspaceCommandRecipes({...options,isolateNpmConfiguration:false});
  assert.equal(original.recipes.find(r=>r.id==='npm-test').env.NPM_CONFIG_USERCONFIG,undefined);
});

test('registered command recipes reject workspace replacement but allow ordinary file edits', async t => {
  const parent = createTempDir('pa-cmd-root-replacement-');
  t.after(() => rmSync(parent, {recursive: true, force: true}));
  const root = path.join(parent, 'workspace');
  mkdirSync(root);
  writeFileSync(path.join(root, 'index.js'), '1;');
  let executions = 0;
  const recipe = createWorkspaceCommandRecipeTool({workspaceRoot: root, nodeExecutable: process.execPath,
    checkFiles: ['index.js'], createWorkspaceCommandTool: () => ({descriptor: {},
      execute: async () => {executions++; return {exitCode: 0};}})});
  writeFileSync(path.join(root, 'index.js'), '2;');
  writeFileSync(path.join(root, 'new-file.js'), '3;');
  assert.equal(recipe.available(), true);
  await recipe.execute({recipeId: 'node-check'}, {});
  assert.equal(executions, 1);
  renameSync(root, path.join(parent, 'original'));
  mkdirSync(root);
  writeFileSync(path.join(root, 'index.js'), '2;');
  assert.equal(recipe.available(), false);
  await assert.rejects(recipe.execute({recipeId: 'node-check'}, {}), /mutated/);
  assert.equal(executions, 1, 'replacement never reaches the command factory');
});

test('registered syntax-check targets are revalidated before command delegation', async t => {
  for (const mutation of ['direct-link', 'ancestor-link', 'missing', 'directory']) {
    await t.test(mutation, async t => {
      const parent = createTempDir('pa-cmd-check-replacement-');
      t.after(() => rmSync(parent, {recursive: true, force: true}));
      const root = path.join(parent, 'workspace'), external = path.join(parent, 'external');
      mkdirSync(root); mkdirSync(external); mkdirSync(path.join(root, 'src'));
      const target = path.join(root, 'src', 'index.js');
      writeFileSync(target, '1;'); writeFileSync(path.join(external, 'index.js'), '2;');
      let executions = 0;
      const recipe = createWorkspaceCommandRecipeTool({workspaceRoot: root, nodeExecutable: process.execPath,
        checkFiles: ['src/index.js'], createWorkspaceCommandTool: () => ({descriptor: {},
          execute: async () => {executions++; return {exitCode: 0};}})});
      assert.equal(recipe.available(), true);
      rmSync(mutation === 'ancestor-link' ? path.join(root, 'src') : target, {recursive: true});
      if (mutation.endsWith('link')) {
        try {
          symlinkSync(mutation === 'ancestor-link' ? external : path.join(external, 'index.js'),
            mutation === 'ancestor-link' ? path.join(root, 'src') : target,
            mutation === 'ancestor-link' ? 'junction' : 'file');
        } catch (error) {
          if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
            t.skip(`Host cannot create this link: ${error.code}`); return;
          }
          throw error;
        }
      } else if (mutation === 'directory') mkdirSync(target);
      assert.equal(recipe.available(), false);
      await assert.rejects(recipe.execute({recipeId: 'node-check'}, {}), /mutated/);
      assert.equal(executions, 0, 'unsafe target never reaches the command factory');
    });
  }
});

test('sanitizeRecipeId enforces lowercase alphanumeric pattern matching command.ts', () => {
  assert.equal(sanitizeRecipeId('node-check', 'index.js'), 'node-check-index.js');
  assert.equal(sanitizeRecipeId('node-check', 'src/App.Client.js'), 'node-check-src-app.client.js');
  assert.equal(sanitizeRecipeId('node-check', 'special!@#$%^&*()file.js'), 'node-check-special-file.js');
  assert.match(sanitizeRecipeId('node-check', 'foo/bar.js'), /^[a-z][a-z0-9._-]{0,63}$/u);
});

test('host-fixed recipes and factory delegation: helper generates bounded recipes and delegates to factory', () => {
  const root = createTempDir('pa-cmd-fixed-input-');
  try {
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'app.js'), 'console.log("app");\n');
    writeFileSync(path.join(root, 'index.js'), 'console.log("index");\n');

    let capturedOptions = null;
    const fakeFactory = options => {
      capturedOptions = options;
      return {
        descriptor: {
          name: 'workspace.run_allowed_command',
          version: '1.0.0',
          sideEffect: 'local_write',
          requiredScopes: ['workspace:execute'],
          inputSchema: {
            type: 'object',
            required: ['recipeId'],
            additionalProperties: false,
            properties: {
              recipeId: {type: 'string', enum: options.recipes.map(r => r.id)},
            },
          },
        },
        execute: async ({recipeId}) => {
          const found = options.recipes.find(r => r.id === recipeId);
          if (!found) throw Error(`Unknown recipe: ${recipeId}`);
          return {recipeId, exitCode: 0, stdout: '', stderr: ''};
        },
      };
    };

    // Fails closed if createWorkspaceCommandTool is missing or not a function
    assert.throws(() => createWorkspaceCommandRecipeTool({
      workspaceRoot: root,
      nodeExecutable: process.execPath,
      checkFiles: ['index.js'],
    }), /Public createWorkspaceCommandTool factory is required/);

    const {tool, recipes} = createWorkspaceCommandRecipeTool({
      workspaceRoot: root,
      nodeExecutable: process.execPath,
      checkFiles: ['index.js', 'src/app.js'],
      createWorkspaceCommandTool: fakeFactory,
    });

    assert.equal(recipes.length, 2);
    assert.deepEqual(recipes.map(r => r.id), ['node-check-index.js', 'node-check-src-app.js']);
    assert.ok(recipes.every(r => r.args[0] === '--check'));

    // Helper pre-constructs fixed recipes and passes them to factory.
    // The public command.ts contract enforces that input is strictly constrained to recipeId.
    const enumValues = tool.descriptor.inputSchema.properties.recipeId.enum;
    assert.deepEqual(enumValues, ['node-check-index.js', 'node-check-src-app.js']);
    assert.equal(capturedOptions.rootPath, realpathSync.native(root));
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('nodeExecutable requires explicit injection, basename verification, and workspace separation', t => {
  const root = createTempDir('pa-cmd-node-check-');
  const externalDir = createTempDir('pa-cmd-node-ext-');
  t.after(() => {
    rmSync(root, {recursive: true, force: true});
    rmSync(externalDir, {recursive: true, force: true});
  });

  const validJs = path.join(root, 'index.js');
  writeFileSync(validJs, 'console.log("ok");\n');

  // 1. Missing nodeExecutable throws immediately (no PATH/where.exe search fallback)
  assert.throws(() => buildWorkspaceCommandRecipes({
    workspaceRoot: root,
    checkFiles: ['index.js'],
  }), /Trusted absolute node\.exe executable path is required/i);

  // 2. Relative nodeExecutable throws
  assert.throws(() => buildWorkspaceCommandRecipes({
    workspaceRoot: root,
    nodeExecutable: 'node.exe',
    checkFiles: ['index.js'],
  }), /Trusted absolute node\.exe executable path is required/i);

  // 3. Binary with non-node basename is rejected
  const fakeCmd = path.join(externalDir, 'cmd.exe');
  writeFileSync(fakeCmd, 'fake');
  assert.throws(() => buildWorkspaceCommandRecipes({
    workspaceRoot: root,
    nodeExecutable: fakeCmd,
    checkFiles: ['index.js'],
  }), /Node executable must be named/i);

  // 4. Node executable inside writable workspace is rejected
  const internalNodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  const internalNode = path.join(root, internalNodeName);
  writeFileSync(internalNode, 'fake');
  assert.throws(() => buildWorkspaceCommandRecipes({
    workspaceRoot: root,
    nodeExecutable: internalNode,
    checkFiles: ['index.js'],
  }), /outside the writable workspace/i);
});

test('out-of-bounds, traversal, symlink, and invalid file rejection', t => {
  const root = createTempDir('pa-cmd-security-');
  const externalDir = createTempDir('pa-cmd-external-');
  t.after(() => {
    rmSync(root, {recursive: true, force: true});
    rmSync(externalDir, {recursive: true, force: true});
  });

  const validFile = path.join(root, 'valid.js');
  writeFileSync(validFile, 'const x = 1;\n');

  // 1. Path traversal escape rejected
  assert.throws(() => buildWorkspaceCommandRecipes({
    workspaceRoot: root,
    nodeExecutable: process.execPath,
    checkFiles: ['../escape.js'],
  }), /escape/i);

  // 2. Absolute path rejected
  assert.throws(() => buildWorkspaceCommandRecipes({
    workspaceRoot: root,
    nodeExecutable: process.execPath,
    checkFiles: [path.join(externalDir, 'secret.js')],
  }), /workspace-relative/i);

  // 3. Symbolic link inside workspace rejected
  const linkFile = path.join(root, 'link.js');
  let symlinksSupported = true;
  try {
    symlinkSync(validFile, linkFile);
  } catch {
    symlinksSupported = false;
  }
  if (symlinksSupported) {
    assert.throws(() => buildWorkspaceCommandRecipes({
      workspaceRoot: root,
      nodeExecutable: process.execPath,
      checkFiles: ['link.js'],
    }), /symbolic link/i);
  }

  // 4. Authorized workspace root mismatch rejected
  assert.throws(() => buildWorkspaceCommandRecipes({
    workspaceRoot: root,
    authorizedWorkspaceRoot: externalDir,
    nodeExecutable: process.execPath,
    checkFiles: ['valid.js'],
  }), /outside the fixed Desktop authorization/i);
});

test('project scripts gatekeeping: npm build/test recipes require all conditions to be satisfied', t => {
  const root = createTempDir('pa-cmd-npm-gate-');
  const externalDir = createTempDir('pa-cmd-npm-ext-');
  t.after(() => {
    rmSync(root, {recursive: true, force: true});
    rmSync(externalDir, {recursive: true, force: true});
  });

  const fakeHelperName = process.platform === 'win32' ? 'WindowsJobProcessHost.exe' : 'job-helper';
  const externalHelper = path.join(externalDir, fakeHelperName);
  writeFileSync(externalHelper, 'fake-helper');

  const externalNpmCli = path.join(externalDir, 'npm-cli.js');
  writeFileSync(externalNpmCli, 'console.log("fake npm cli");');

  writeFileSync(path.join(root, 'index.js'), 'console.log(1);\n');

  // Case 1: allowProjectScripts is false (default) -> no npm recipes
  {
    const {recipes, diagnostics} = buildWorkspaceCommandRecipes({
      workspaceRoot: root,
      nodeExecutable: process.execPath,
      checkFiles: ['index.js'],
      allowProjectScripts: false,
    });
    assert.equal(recipes.length, 1);
    assert.equal(recipes[0].id, 'node-check');
    assert.equal(diagnostics.projectScriptsAllowed, false);
    assert.equal(diagnostics.projectScriptsExposed, false);
  }

  // Case 2: allowProjectScripts is true, but no helper -> job_helper_missing
  {
    const {recipes, diagnostics} = buildWorkspaceCommandRecipes({
      workspaceRoot: root,
      nodeExecutable: process.execPath,
      checkFiles: ['index.js'],
      allowProjectScripts: true,
    });
    assert.equal(recipes.length, 1);
    assert.equal(diagnostics.projectScriptsAllowed, true);
    assert.equal(diagnostics.projectScriptsExposed, false);
    assert.ok(diagnostics.reasons.some(r => r.startsWith('job_helper_missing')));
  }

  // Case 3: helper provided, but no npmCliPath and cannot be inferred -> npm_cli_missing
  {
    const externalFakeNode = path.join(externalDir, process.platform === 'win32' ? 'node.exe' : 'node');
    writeFileSync(externalFakeNode, 'fake-node-binary');
    const {recipes, diagnostics} = buildWorkspaceCommandRecipes({
      workspaceRoot: root,
      nodeExecutable: externalFakeNode,
      jobHelperExecutable: externalHelper,
      checkFiles: ['index.js'],
      allowProjectScripts: true,
    });
    assert.equal(recipes.length, 1);
    assert.equal(diagnostics.projectScriptsExposed, false);
    assert.ok(diagnostics.reasons.some(r => r.startsWith('npm_cli_missing')));
  }

  // Case 3b: inferNpmCliFromNodeExecutable infers npm-cli if present in installation
  {
    const inferred = inferNpmCliFromNodeExecutable(process.execPath);
    if (inferred) {
      assert.ok(path.isAbsolute(inferred));
      assert.ok(existsSync(inferred));
      const {diagnostics} = buildWorkspaceCommandRecipes({
        workspaceRoot: root,
        nodeExecutable: process.execPath,
        jobHelperExecutable: externalHelper,
        checkFiles: ['index.js'],
        allowProjectScripts: true,
      });
      assert.equal(diagnostics.inferredNpmCli, true);
      assert.equal(diagnostics.npmCliPath, inferred);
    }
  }

  // Case 4: helper and npmCli provided, but no package.json -> package_json_missing
  {
    const {recipes, diagnostics} = buildWorkspaceCommandRecipes({
      workspaceRoot: root,
      nodeExecutable: process.execPath,
      jobHelperExecutable: externalHelper,
      npmCliPath: externalNpmCli,
      checkFiles: ['index.js'],
      allowProjectScripts: true,
    });
    assert.equal(recipes.length, 1);
    assert.equal(diagnostics.projectScriptsExposed, false);
    assert.ok(diagnostics.reasons.some(r => r.startsWith('package_json_missing')));
  }

  // Add package.json with build and test scripts
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'test-app',
    scripts: {
      build: 'echo build',
      test: 'echo test',
    },
  }));

  // Case 5: package.json exists, but node_modules missing -> dependencies_missing
  {
    const {recipes, diagnostics} = buildWorkspaceCommandRecipes({
      workspaceRoot: root,
      nodeExecutable: process.execPath,
      jobHelperExecutable: externalHelper,
      npmCliPath: externalNpmCli,
      checkFiles: ['index.js'],
      allowProjectScripts: true,
    });
    assert.equal(recipes.length, 1);
    assert.equal(diagnostics.projectScriptsExposed, false);
    assert.ok(diagnostics.reasons.some(r => r.startsWith('dependencies_missing')));
  }

  // Add node_modules directory
  mkdirSync(path.join(root, 'node_modules'));

  // Case 6: ALL gates satisfied -> generates npm-build and npm-test recipes
  {
    const mockEnv = {
      PATH: 'C:\\Windows\\System32;C:\\Program Files\\nodejs',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      SECRET_TOKEN: 'leak_attempt',
      GITHUB_KEY: 'leak_attempt',
    };
    const {recipes, diagnostics} = buildWorkspaceCommandRecipes({
      workspaceRoot: root,
      nodeExecutable: process.execPath,
      jobHelperExecutable: externalHelper,
      npmCliPath: externalNpmCli,
      checkFiles: ['index.js'],
      allowProjectScripts: true,
      projectScriptEnvSource: mockEnv,
    });
    assert.equal(diagnostics.projectScriptsAllowed, true);
    assert.equal(diagnostics.projectScriptsExposed, true);
    assert.equal(recipes.length, 3); // node-check, npm-build, npm-test

    const buildRecipe = recipes.find(r => r.id === 'npm-build');
    assert.ok(buildRecipe, 'npm-build recipe created');
    assert.ok(path.isAbsolute(buildRecipe.executable));
    assert.deepEqual(buildRecipe.args.slice(-2), ['run', 'build']);
    assert.equal(buildRecipe.args[buildRecipe.args.length - 3], realpathSync.native(externalNpmCli));
    assert.equal(buildRecipe.args[buildRecipe.args.length - 4], '--');
    assert.equal(buildRecipe.args[0], '--cwd');
    assert.equal(buildRecipe.args[2], '--exe');

    const testRecipe = recipes.find(r => r.id === 'npm-test');
    assert.ok(testRecipe, 'npm-test recipe created');
    assert.deepEqual(testRecipe.args.slice(-2), ['run', 'test']);
    assert.equal(testRecipe.args[testRecipe.args.length - 3], realpathSync.native(externalNpmCli));
    assert.equal(testRecipe.args[testRecipe.args.length - 4], '--');

    // Check safe environment filtering:
    assert.equal(buildRecipe.env.PATH, mockEnv.PATH);
    assert.equal(buildRecipe.env.SystemRoot, process.platform === 'win32' ? mockEnv.SystemRoot : undefined);
    assert.equal(buildRecipe.env.ComSpec, process.platform === 'win32' ? mockEnv.ComSpec : undefined);
    assert.equal(buildRecipe.env.SECRET_TOKEN, undefined);
    assert.equal(buildRecipe.env.GITHUB_KEY, undefined);
  }

  // Case 7: Security: jobHelper inside workspace is rejected
  const internalHelper = path.join(root, fakeHelperName);
  writeFileSync(internalHelper, 'fake');
  assert.throws(() => buildWorkspaceCommandRecipes({
    workspaceRoot: root,
    nodeExecutable: process.execPath,
    jobHelperExecutable: internalHelper,
    npmCliPath: externalNpmCli,
    allowProjectScripts: true,
  }), /outside the writable workspace/i);

  // Case 8: Security: npmCli inside workspace is rejected
  const internalNpmCli = path.join(root, 'npm-cli.js');
  writeFileSync(internalNpmCli, 'fake');
  assert.throws(() => buildWorkspaceCommandRecipes({
    workspaceRoot: root,
    nodeExecutable: process.execPath,
    jobHelperExecutable: externalHelper,
    npmCliPath: internalNpmCli,
    allowProjectScripts: true,
  }), /outside the writable workspace/i);

  // Case 9: Security: package.json as a symbolic link pointing outside workspace is rejected
  const symlinkRoot = createTempDir('pa-cmd-symlink-root-');
  t.after(() => rmSync(symlinkRoot, {recursive: true, force: true}));
  const externalPkg = path.join(externalDir, 'secret-package.json');
  writeFileSync(externalPkg, JSON.stringify({name: 'secret', scripts: {build: 'echo secret'}}));
  let fileSymlinkCreated = true;
  try {
    symlinkSync(externalPkg, path.join(symlinkRoot, 'package.json'), 'file');
  } catch {
    fileSymlinkCreated = false;
  }
  if (fileSymlinkCreated) {
    const {recipes, diagnostics} = buildWorkspaceCommandRecipes({
      workspaceRoot: symlinkRoot,
      nodeExecutable: process.execPath,
      jobHelperExecutable: externalHelper,
      npmCliPath: externalNpmCli,
      allowProjectScripts: true,
    });
    assert.equal(diagnostics.projectScriptsExposed, false);
    assert.ok(diagnostics.reasons.some(r => r.includes('package.json must not be a symbolic link')));
  }

  // Case 10: Security: node_modules as a symbolic link/junction pointing outside workspace is rejected
  const junctionRoot = createTempDir('pa-cmd-junction-root-');
  t.after(() => rmSync(junctionRoot, {recursive: true, force: true}));
  writeFileSync(path.join(junctionRoot, 'package.json'), JSON.stringify({name: 'app', scripts: {build: 'echo 1'}}));
  const externalModules = path.join(externalDir, 'external_node_modules');
  mkdirSync(externalModules);
  let junctionCreated = true;
  try {
    symlinkSync(externalModules, path.join(junctionRoot, 'node_modules'), 'junction');
  } catch {
    junctionCreated = false;
  }
  if (junctionCreated) {
    const {recipes, diagnostics} = buildWorkspaceCommandRecipes({
      workspaceRoot: junctionRoot,
      nodeExecutable: process.execPath,
      jobHelperExecutable: externalHelper,
      npmCliPath: externalNpmCli,
      allowProjectScripts: true,
    });
    assert.equal(diagnostics.projectScriptsExposed, false);
    assert.ok(diagnostics.reasons.some(r => r.includes('dependencies_missing')));
  }
});

test('public command contract validation: recipe limits and properties', async t => {
  const root = createTempDir('pa-cmd-contract-');
  t.after(() => rmSync(root, {recursive: true, force: true}));

  const validFile = path.join(root, 'valid.js');
  const badSyntaxFile = path.join(root, 'bad.js');
  writeFileSync(validFile, 'const a = 1; console.log(a);\n');
  writeFileSync(badSyntaxFile, 'const a = ;\n');

  // Verify bounded recipes requirement
  assert.throws(() => createWorkspaceCommandRecipeTool({
    workspaceRoot: root,
    nodeExecutable: process.execPath,
    checkFiles: [],
    createWorkspaceCommandTool: () => {},
  }), /No approved command recipes/);

  const {recipes} = buildWorkspaceCommandRecipes({
    workspaceRoot: root,
    nodeExecutable: process.execPath,
    checkFiles: ['valid.js', 'bad.js'],
  });

  assert.equal(recipes.length, 2);
  for (const recipe of recipes) {
    assert.match(recipe.id, /^[a-z][a-z0-9._-]{0,63}$/u);
    assert.ok(path.isAbsolute(recipe.executable));
    assert.ok(Array.isArray(recipe.args));
    assert.ok(recipe.args.length <= 32);
    assert.ok(recipe.args.every(arg => typeof arg === 'string' && arg.length <= 4096 && !arg.includes('\0')));
  }
});

test('runtime pinning in createWorkspaceCommandRecipeTool: any mutation of executables, package.json, or workspace fails closed', async t => {
  const root = createTempDir('pa-cmd-pin-root-');
  const externalDir = createTempDir('pa-cmd-pin-ext-');
  t.after(() => {
    rmSync(root, {recursive: true, force: true});
    rmSync(externalDir, {recursive: true, force: true});
  });

  const validFile = path.join(root, 'index.js');
  writeFileSync(validFile, 'console.log("hello");\n');

  const pkgJsonPath = path.join(root, 'package.json');
  const initialPkg = JSON.stringify({name: 'pin-test', scripts: {build: 'echo 1', test: 'echo 2'}});
  writeFileSync(pkgJsonPath, initialPkg);

  mkdirSync(path.join(root, 'node_modules'));

  const fakeHelperName = process.platform === 'win32' ? 'WindowsJobProcessHost.exe' : 'job-helper';
  const helperPath = path.join(externalDir, fakeHelperName);
  writeFileSync(helperPath, 'initial-helper-binary');

  const npmCliPath = path.join(externalDir, 'npm-cli.js');
  writeFileSync(npmCliPath, 'console.log("initial npm cli");');

  const fakeFactory = options => ({
    descriptor: {
      name: 'workspace.run_allowed_command',
      version: '1.0.0',
      sideEffect: 'local_write',
      requiredScopes: ['workspace:execute'],
      inputSchema: {type: 'object', required: ['recipeId'], properties: {recipeId: {type: 'string'}}},
    },
    execute: async ({recipeId}) => ({recipeId, exitCode: 0, stdout: 'ok', stderr: ''}),
  });

  const toolWrapper = createWorkspaceCommandRecipeTool({
    workspaceRoot: root,
    nodeExecutable: process.execPath,
    jobHelperExecutable: helperPath,
    npmCliPath: npmCliPath,
    checkFiles: ['index.js'],
    allowProjectScripts: true,
    createWorkspaceCommandTool: fakeFactory,
  });

  // Initially all pins are valid
  assert.equal(toolWrapper.available(), true);
  const initialExec = await toolWrapper.execute({recipeId: 'npm-build'}, {});
  assert.equal(initialExec.exitCode, 0);

  // 1. Mutate package.json -> available() returns false and execute rejects
  writeFileSync(pkgJsonPath, JSON.stringify({name: 'pin-test', scripts: {build: 'echo mutated'}}));
  assert.equal(toolWrapper.available(), false);
  await assert.rejects(toolWrapper.execute({recipeId: 'npm-build'}, {}), /mutated after registration/i);
  await assert.rejects(toolWrapper.tool.execute({recipeId: 'npm-build'}, {}), /mutated after registration/i);

  // Restore package.json -> available() returns true again
  writeFileSync(pkgJsonPath, initialPkg);
  assert.equal(toolWrapper.available(), true);

  // 2. Mutate jobHelper executable -> available() returns false and execute rejects
  writeFileSync(helperPath, 'mutated-helper-binary');
  assert.equal(toolWrapper.available(), false);
  await assert.rejects(toolWrapper.execute({recipeId: 'npm-build'}, {}), /mutated after registration/i);

  // Restore jobHelper
  writeFileSync(helperPath, 'initial-helper-binary');
  assert.equal(toolWrapper.available(), true);

  // 3. Remove node_modules -> available() returns false and execute rejects
  rmSync(path.join(root, 'node_modules'), {recursive: true, force: true});
  assert.equal(toolWrapper.available(), false);
  await assert.rejects(toolWrapper.execute({recipeId: 'npm-build'}, {}), /mutated after registration/i);
});

test('buildNativeHelper compiles WindowsJobProcessHost to external directory and rejects repo-internal targets', {
  skip: process.platform !== 'win32' ? 'Windows only test' : false,
}, async t => {
  const repoRoot = resolveRepoRoot();
  const buildTempDir = createTempDir('pa-native-build-');
  t.after(() => rmSync(buildTempDir, {recursive: true, force: true}));

  // 1. Target directory inside repository is rejected
  assert.throws(() => buildNativeHelper({
    targetDir: path.join(repoRoot, 'some-internal-dir'),
  }), /must reside outside the PersonalAgent repository root/i);

  // 2. Build to external directory succeeds
  const {helperPath, targetDir} = buildNativeHelper({targetDir: buildTempDir});
  assert.equal(targetDir, realpathSync.native(buildTempDir));
  assert.ok(existsSync(helperPath));
  assert.equal(path.basename(helperPath).toLowerCase(), 'windowsjobprocesshost.exe');

  // 3. Verify the published executable is runnable (not just a dummy file)
  const probe = spawnSync(helperPath, ['--exe', 'nonexistent_test_exe_path'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(probe.status, 1);
  assert.match(probe.stderr, /Target executable does not exist/i);
});
