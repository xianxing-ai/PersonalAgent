import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createDesktopCodingToolHost, listPendingCodingHelpers, verifyWindowsRecoveryAcl} from '../electron/coding-tool-host.js';
import {createWorkspaceConfigHost} from '../electron/workspace-config-host.js';

function fixture(t) {
  const base = mkdtempSync(path.join(tmpdir(), "desktop-coding-host-中文 ' 👋-"));
  const workspaceRoot = path.join(base, 'workspace');
  const recoveryRootPath = path.join(base, 'recovery');
  mkdirSync(workspaceRoot);
  mkdirSync(recoveryRootPath);
  const powerShellPath = path.join(base, 'pwsh.exe');
  writeFileSync(powerShellPath, 'test fixture');
  t.after(() => rmSync(base, {recursive: true, force: true}));
  return {base, workspaceRoot, recoveryRootPath, powerShellPath};
}

const fakeFactory = options => ({descriptor: {name: 'workspace.apply_text_patch',
  version: '1.0.0', sideEffect: 'local_write'}, options,
execute: () => 'delegated'});
const options = value => ({...value, authorizedWorkspaceRoot: value.workspaceRoot,
  createWorkspacePatchApplyTool: fakeFactory, inspectAcl: () => {}});

test('external patch helper is forwarded, pinned, and never accepted inside workspace or recovery',
  {skip:process.platform!=='win32'},t=>{
    const paths=fixture(t),helperScriptPath=path.join(paths.base,'locked-apply.ps1');
    writeFileSync(helperScriptPath,'synthetic helper fixture');let received;
    const host=createDesktopCodingToolHost({...options(paths),helperScriptPath,
      createWorkspacePatchApplyTool:value=>{received=value;return fakeFactory(value);}});
    assert.equal(received.helperScriptPath,realpathSync.native(helperScriptPath));
    assert.equal(host.available(),true);
    writeFileSync(helperScriptPath,'changed synthetic helper fixture');
    assert.equal(host.available(),false);assert.throws(()=>host.tools[0].execute(),/closed|reconciliation/);
    for(const directory of [paths.workspaceRoot,paths.recoveryRootPath]) {
      const nested=path.join(directory,'locked-apply.ps1');writeFileSync(nested,'synthetic helper');
      assert.throws(()=>createDesktopCodingToolHost({...options(paths),helperScriptPath:nested}),/separate/);
    }
    host.close();
  });

test('repository-root Desktop host accepts only an external byte-identical bundled helper',
  {skip:process.platform!=='win32'},async t=>{
    const coding=await import('@personal-agent/coding-tools');
    const paths=fixture(t),workspaceRoot=fileURLToPath(new URL('../../../',import.meta.url));
    const powerShellPath=(process.env.PATH??'').split(path.delimiter)
      .filter(Boolean).map(directory=>path.join(directory.replace(/^"|"$/g,''),'pwsh.exe')).find(existsSync);
    assert.ok(powerShellPath,'PowerShell 7 must be present on the Windows test PATH');
    const helperScriptPath=path.join(paths.base,'locked-apply.ps1');
    // Test deployment of the reviewed package resource; production never copies a script.
    const bundled=readFileSync(new URL('../scripts/locked-apply.ps1',import.meta.resolve('@personal-agent/coding-tools')));
    writeFileSync(helperScriptPath,bundled);
    const opts={...options(paths),workspaceRoot,authorizedWorkspaceRoot:workspaceRoot,powerShellPath,
      createWorkspacePatchApplyTool:coding.createWorkspacePatchApplyTool};
    assert.throws(()=>createDesktopCodingToolHost(opts),/distinct trusted locations/);
    const host=createDesktopCodingToolHost({...opts,helperScriptPath});
    assert.equal(host.available(),true);assert.equal(host.tools[0].descriptor.name,'workspace.apply_text_patch');
    host.close();
    const configOptions={userData:path.join(paths.base,'user-data'),
      safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},
      selectDirectory:async()=>workspaceRoot};
    let workspace=createWorkspaceConfigHost(configOptions);
    await workspace.select();workspace.close();
    workspace=createWorkspaceConfigHost(configOptions);
    assert.equal(workspace.tools.some(tool=>tool.descriptor.name==='workspace.apply_text_patch'),false);
    workspace.close();
    workspace=createWorkspaceConfigHost({...configOptions,patchHelperScriptPath:helperScriptPath});
    try {
      assert.equal(workspace.tools.some(tool=>tool.descriptor.name==='workspace.apply_text_patch'),true);
      const recovery=path.join(configOptions.userData,'coding-recovery');
      const {readdirSync}=await import('node:fs');
      verifyWindowsRecoveryAcl(path.join(recovery,readdirSync(recovery)[0]),powerShellPath);
      assert.throws(()=>verifyWindowsRecoveryAcl(paths.recoveryRootPath,powerShellPath),/ACL/,
        'Unicode path support must still reject an inherited ACL');
      assert.equal(workspace.snapshot().writeAvailable,false,'helper configuration does not restore consent');
      await workspace.authorize({cloudExportAllowed:true,writeAllowed:true,commandAllowed:false});
      assert.equal(workspace.snapshot().writeAvailable,true);
    } finally {workspace.close();}
    writeFileSync(helperScriptPath,'unknown script');
    assert.throws(()=>createDesktopCodingToolHost({...opts,helperScriptPath}),/trusted bundled script/);
  });

test('host fixes all patch paths and closes availability', {skip: process.platform !== 'win32'}, t => {
  const paths = fixture(t);
  const host = createDesktopCodingToolHost(options(paths));
  assert.equal(host.tools.length, 1);
  assert.equal(host.tools[0].execute(), 'delegated');
  assert.equal(host.available(), true);
  host.close();
  assert.equal(host.available(), false);
  assert.throws(() => host.tools[0].execute(), /closed/);
});

test('host rejects workspace changes, nested recovery roots and unresolved helpers', {skip: process.platform !== 'win32'}, t => {
  const paths = fixture(t);
  const host = createDesktopCodingToolHost(options(paths));
  const other = path.join(paths.base, 'other');
  mkdirSync(other);
  assert.throws(() => createDesktopCodingToolHost({...options(paths), authorizedWorkspaceRoot: other}),
    /fixed Desktop authorization/);
  const nested = path.join(paths.workspaceRoot, 'recovery');
  mkdirSync(nested);
  assert.throws(() => createDesktopCodingToolHost({...options(paths), recoveryRootPath: nested}),
    /separate/);
  writeFileSync(path.join(paths.recoveryRootPath, 'unknown.inflight'), 'unresolved');
  assert.deepEqual(listPendingCodingHelpers(paths.recoveryRootPath), ['unknown.inflight']);
  assert.equal(host.available(), false);
  assert.throws(() => host.tools[0].execute(), /reconciliation/);
  const recoveryHost = createDesktopCodingToolHost(options(paths));
  assert.deepEqual(recoveryHost.pendingHelpers, ['unknown.inflight']);
  assert.equal(recoveryHost.available(), false);
  assert.throws(() => recoveryHost.tools[0].execute(), /reconciliation/);
});

test('host refuses an unverified ACL and unexpected public tool', {skip: process.platform !== 'win32'}, t => {
  const paths = fixture(t);
  assert.throws(() => createDesktopCodingToolHost({...options(paths), inspectAcl: () => {throw Error('unsafe');}}),
    /unsafe/);
  assert.throws(() => createDesktopCodingToolHost({...options(paths),
    createWorkspacePatchApplyTool: () => ({descriptor: {name: 'other'}})}),
  /Unexpected coding patch tool/);
});

test('ACL drift and replacement of pinned recovery or PowerShell paths stop invocation',
  {skip: process.platform !== 'win32'}, t => {
    const paths = fixture(t);
    let aclSecure = true;
    const host = createDesktopCodingToolHost({...options(paths),
      inspectAcl: () => { if (!aclSecure) throw Error('ACL changed'); }});
    aclSecure = false;
    assert.equal(host.available(), false);
    assert.throws(() => host.tools[0].execute(), /reconciliation/);
    aclSecure = true;
    renameSync(paths.recoveryRootPath, `${paths.recoveryRootPath}-old`);
    mkdirSync(paths.recoveryRootPath);
    assert.equal(host.available(), false);

    const next = fixture(t);
    const second = createDesktopCodingToolHost(options(next));
    renameSync(next.powerShellPath, `${next.powerShellPath}.old`);
    writeFileSync(next.powerShellPath, 'replacement');
    assert.equal(second.available(), false);
    assert.throws(() => second.tools[0].execute(), /reconciliation/);

    const thirdPaths = fixture(t);
    const third = createDesktopCodingToolHost(options(thirdPaths));
    renameSync(thirdPaths.workspaceRoot, `${thirdPaths.workspaceRoot}-old`);
    mkdirSync(thirdPaths.workspaceRoot);
    assert.equal(third.available(), false);
  });
