import {execFile, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync, readdirSync, realpathSync, statSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

const ACL_CHECK = String.raw`
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
$acl = Get-Acl -LiteralPath $root
$self = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$owner = ([System.Security.Principal.NTAccount]$acl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value
$trusted = @($self, 'S-1-5-18', 'S-1-5-32-544')
$rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
$secure = $acl.AreAccessRulesProtected -and $owner -eq $self
foreach ($rule in $rules) {
  if ($rule.IsInherited -or ($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value)) {
    $secure = $false
  }
}
if ($secure) { [Console]::Out.Write('secure') } else { [Console]::Out.Write('unsafe') }
`;

function canonicalDirectory(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error(`${label} must be an absolute path`);
  const full = path.resolve(value);
  if (lstatSync(full).isSymbolicLink()) throw Error(`${label} must not be a link`);
  const canonical = realpathSync.native(full);
  if (!statSync(canonical).isDirectory()) throw Error(`${label} must be a directory`);
  return canonical;
}

function canonicalFile(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error(`${label} must be an absolute path`);
  const full = path.resolve(value);
  if (lstatSync(full).isSymbolicLink()) throw Error(`${label} must not be a link`);
  const canonical = realpathSync.native(full);
  if (!statSync(canonical).isFile()) throw Error(`${label} must be a file`);
  return canonical;
}

function atOrWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function identity(value, executable = false) {
  const file = statSync(value, {bigint: true});
  return {dev: file.dev, ino: file.ino, birthtimeNs: file.birthtimeNs,
    ...(executable ? {size: file.size, mtimeNs: file.mtimeNs} : {})};
}

function sameIdentity(left, right) {
  return Object.keys(left).every(key => left[key] === right[key]);
}

function aclArguments(recoveryRootPath) {
  if (process.platform !== 'win32') throw Error('Windows recovery ACL inspection is unavailable');
  // Redirected Console.In may use the Windows code page, even with Node's UTF-8 input.
  // Carry the path as data inside the UTF-16 EncodedCommand instead.
  const script = `$root=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(recoveryRootPath, 'utf8').toString('base64')}'))\n${ACL_CHECK}`;
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

/** Synchronous compatibility check. Never use this from a UI snapshot. */
export function verifyWindowsRecoveryAcl(recoveryRootPath, powerShellPath) {
  const output = execFileSync(powerShellPath, aclArguments(recoveryRootPath),
    {encoding: 'utf8', timeout: 10_000, maxBuffer: 4096, windowsHide: true});
  if (output !== 'secure') throw Error('Recovery directory ACL is not restricted to the current user');
}

/** Execution-time ACL inspection yields the main loop and retains the same fail-closed policy. */
export async function verifyWindowsRecoveryAclAsync(recoveryRootPath, powerShellPath, {signal} = {}) {
  const {stdout} = await execFileAsync(powerShellPath, aclArguments(recoveryRootPath),
    {encoding: 'utf8', timeout: 10_000, maxBuffer: 4096, windowsHide: true, signal});
  if (stdout !== 'secure') throw Error('Recovery directory ACL is not restricted to the current user');
}

/** Read-only startup inventory. An unresolved marker requires a separate trusted reconciliation. */
export function listPendingCodingHelpers(recoveryRootPath) {
  return readdirSync(recoveryRootPath).filter(name => name.endsWith('.inflight')).sort();
}

/** Bind only trusted main-process paths and factory. inspectAcl is for isolated host tests.
 * Policy and ToolGateway still own every execution decision and result state. */
export function createDesktopCodingToolHost({workspaceRoot, authorizedWorkspaceRoot,
  recoveryRootPath, powerShellPath, processIdentityHelperPath, helperScriptPath, createWorkspacePatchApplyTool,
  reconcileWorkspacePatchApply,
  inspectAcl = verifyWindowsRecoveryAcl,
  inspectAclAsync = inspectAcl === verifyWindowsRecoveryAcl ? verifyWindowsRecoveryAclAsync : inspectAcl}) {
  if (process.platform !== 'win32') throw Error('Coding patch host requires Windows');
  const root = canonicalDirectory(workspaceRoot, 'Workspace root');
  const authorized = canonicalDirectory(authorizedWorkspaceRoot, 'Authorized workspace root');
  if (root !== authorized) throw Error('Workspace root is outside the fixed Desktop authorization');
  const recovery = canonicalDirectory(recoveryRootPath, 'Recovery root');
  const powerShell = canonicalFile(powerShellPath, 'PowerShell 7 executable');
  const processIdentityHelper = processIdentityHelperPath === undefined
    ? undefined : canonicalFile(processIdentityHelperPath, 'Windows process identity helper');
  const helper = helperScriptPath===undefined?undefined:canonicalFile(helperScriptPath,'Patch helper script');
  if (path.basename(powerShell).toLowerCase() !== 'pwsh.exe') throw Error('PowerShell 7 executable is required');
  if (processIdentityHelper && path.basename(processIdentityHelper).toLowerCase() !== 'windowsjobprocesshost.exe') {
    throw Error('Windows process identity helper must be WindowsJobProcessHost.exe');
  }
  if (atOrWithin(root, recovery) || atOrWithin(recovery, root)
    || atOrWithin(root, powerShell) || atOrWithin(recovery, powerShell)
    || (processIdentityHelper && (atOrWithin(root, processIdentityHelper) || atOrWithin(recovery, processIdentityHelper)))
    || (helper && (atOrWithin(root,helper) || atOrWithin(recovery,helper)))) {
    throw Error('Coding host paths must be separate from the workspace and recovery root');
  }
  inspectAcl(recovery, powerShell);
  const pinned = [
    {source: workspaceRoot, canonical: root, directory: true, id: identity(root)},
    {source: recoveryRootPath, canonical: recovery, directory: true, id: identity(recovery)},
    {source: powerShellPath, canonical: powerShell, directory: false, id: identity(powerShell, true)},
    ...(processIdentityHelper ? [{source: processIdentityHelperPath, canonical: processIdentityHelper,
      directory: false, id: identity(processIdentityHelper, true)}] : []),
    ...(helper?[{source:helperScriptPath,canonical:helper,directory:false,id:identity(helper,true)}]:[]),
  ];
  const bindingId = createHash('sha256').update(JSON.stringify(pinned.map(entry => [entry.canonical,
    Object.entries(entry.id).map(([key, value]) => [key, String(value)])]))).digest('hex');
  const pendingHelpers = listPendingCodingHelpers(recovery);
  if (typeof createWorkspacePatchApplyTool !== 'function') throw Error('Public patch apply factory is unavailable');
  const implementation = createWorkspacePatchApplyTool({rootPath: root, recoveryRootPath: recovery,
    powerShellPath: powerShell,
    ...(processIdentityHelper ? {processIdentityHelperPath: processIdentityHelper} : {}),
    ...(helper?{helperScriptPath:helper}:{})});
  if (implementation?.descriptor?.name !== 'workspace.apply_text_patch'
    || implementation.descriptor.version !== '1.0.0'
    || implementation.descriptor.sideEffect !== 'local_write'
    || typeof implementation.execute !== 'function') {
    throw Error('Unexpected coding patch tool descriptor');
  }
  let active = true;
  const bindingCurrent = () => {
    if (!active) return false;
    try {
      for (const entry of pinned) {
        const current = entry.directory
          ? canonicalDirectory(entry.source, 'Pinned coding directory')
          : canonicalFile(entry.source, entry.source === processIdentityHelperPath
            ? 'Pinned Windows process identity helper' : 'Pinned PowerShell executable');
        if (current !== entry.canonical
          || !sameIdentity(entry.id, identity(current, !entry.directory))) return false;
      }
      return true;
    } catch { return false; }
  };
  // A readiness hint is not authorization. Rendering this hint must never launch PowerShell.
  const ready = () => {
    try {return bindingCurrent() && listPendingCodingHelpers(recovery).length === 0;}
    catch {return false;}
  };
  const available = () => {
    try {if (!ready()) return false;inspectAcl(recovery, powerShell);return ready();}
    catch {return false;}
  };
  const assertRecoveryBinding = async (context) => {
    if (!bindingCurrent()) throw Error('Coding patch host is closed or binding changed');
    context?.signal?.throwIfAborted();
    try {await inspectAclAsync(recovery, powerShell, {signal: context?.signal});}
    catch {
      context?.signal?.throwIfAborted();
      throw Error('Coding patch host is closed or requires helper reconciliation');
    }
    // Revoke, cancellation and file replacement can happen while the child process is running.
    context?.signal?.throwIfAborted();
    if (!bindingCurrent()) throw Error('Coding patch host is closed or binding changed');
  };
  const tool = {descriptor: implementation.descriptor, execute: async (input, context) => {
    if (!ready()) throw Error('Coding patch host is closed or requires helper reconciliation');
    await assertRecoveryBinding(context);
    if (!ready()) throw Error('Coding patch host is closed or requires helper reconciliation');
    return implementation.execute(input, context);
  }};
  const patchReconciliation = typeof reconcileWorkspacePatchApply === 'function'
    ? {bindingId, reconcile: async ({relativePath, expectedRunId, expectedArgumentsDigest,
      expectedBeforeSha256, retainMarker, signal}) => {
      await assertRecoveryBinding({signal});
      return reconcileWorkspacePatchApply({rootPath: root, recoveryRootPath: recovery,
        relativePath, expectedRunId, expectedArgumentsDigest, expectedBeforeSha256,
        retainMarker, powerShellPath: powerShell,
        ...(processIdentityHelper ? {processIdentityHelperPath: processIdentityHelper} : {})});
    }}
    : undefined;
  return {
    tools: [tool],
    pendingHelpers,
    available,
    ready,
    ...(patchReconciliation ? {patchReconciliation} : {}),
    close: () => { active = false; },
  };
}
