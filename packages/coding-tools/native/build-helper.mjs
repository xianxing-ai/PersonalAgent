#!/usr/bin/env node
/**
 * @file packages/coding-tools/native/build-helper.mjs
 *
 * Bounded development build helper for WindowsJobProcessHost.exe.
 * Publishes the .NET 8 Win32 Job Object host into an explicit, trusted host-specified directory
 * (e.g. Desktop Main app userData/native-helper).
 *
 * Invariants:
 * 1. Requires explicit target directory; rejects defaults to workspace or repo directory.
 * 2. Requires pre-installed .NET 8 SDK; never automatically downloads or installs SDKs.
 * 3. Never uses ExecutionPolicy bypass or shell scripts.
 * 4. Outputs canonical path to the published executable.
 */

import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync} from 'node:fs';
import path from 'node:path';
import {nativePublishArguments,probeNativeToolchain,requirePeArchitecture} from './host-architecture.mjs';

export function resolveRepoRoot() {
  return realpathSync.native(path.resolve(import.meta.dirname, '..', '..', '..'));
}

export function buildNativeHelper({targetDir, configuration = 'Release'} = {}) {
  if (process.platform !== 'win32') {
    throw Error('WindowsJobProcessHost is only supported on Windows');
  }

  if (typeof targetDir !== 'string' || !path.isAbsolute(targetDir) || targetDir.startsWith('\\\\')) {
    throw Error('Explicit local absolute target directory is required');
  }

  const repoRoot = resolveRepoRoot();
  const resolvedTarget = path.resolve(targetDir);

  // Security: Target directory MUST reside outside the repository / workspace
  const fromRepo = path.relative(repoRoot, resolvedTarget);
  if (fromRepo === '' || (!fromRepo.startsWith('..') && !path.isAbsolute(fromRepo))) {
    throw Error(`Target directory must reside outside the PersonalAgent repository root (${repoRoot})`);
  }

  if (!existsSync(resolvedTarget)) {
    mkdirSync(resolvedTarget, {recursive: true});
  }

  if (lstatSync(resolvedTarget).isSymbolicLink()) {
    throw Error('Target directory must not be a symbolic link');
  }

  const canonicalTarget = realpathSync.native(resolvedTarget);
  if (!statSync(canonicalTarget).isDirectory()) {
    throw Error('Target directory must be a directory');
  }

  // Native Node, OS and dotnet host must agree. Preinstalled .NET 8 only; no emulation/download fallback.
  const toolchain=probeNativeToolchain();

  const csprojPath = path.join(import.meta.dirname, 'WindowsJobProcessHost.csproj');
  if (!existsSync(csprojPath)) {
    throw Error(`WindowsJobProcessHost.csproj not found at ${csprojPath}`);
  }

  // 2. Publish project to target directory
  const publishArgs = nativePublishArguments(csprojPath,canonicalTarget,configuration,toolchain.architecture);

  const publishResult = spawnSync('dotnet', publishArgs, {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });

  if (publishResult.status !== 0) {
    const errOutput = publishResult.stderr?.trim() || publishResult.stdout?.trim() || 'Unknown build failure';
    throw Error(`Failed to build WindowsJobProcessHost: ${errOutput}`);
  }

  const expectedExe = path.join(canonicalTarget, 'WindowsJobProcessHost.exe');
  if (!existsSync(expectedExe)) {
    throw Error(`Expected output executable was not found at ${expectedExe}`);
  }

  const canonicalExe = realpathSync.native(expectedExe);
  requirePeArchitecture(canonicalExe,toolchain.architecture);
  const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  const helperFilesSha256 = Object.fromEntries(['WindowsJobProcessHost.dll','WindowsJobProcessHost.deps.json','WindowsJobProcessHost.runtimeconfig.json']
    .map(name => [name,hash(path.join(canonicalTarget,name))]));
  // No source cache: every publish compiles the project, including all current C# inputs.
  const sourceSha256 = {};
  function sources(directory, prefix='') {
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      if(entry.name==='obj'||entry.name==='bin')continue;
      const relative=prefix+entry.name, full=path.join(directory,entry.name);
      if(entry.isDirectory())sources(full,relative+'/');
      else if(entry.isFile()&&/\.(cs|csproj)$/u.test(entry.name))sourceSha256[relative]=hash(full);
    }
  }
  sources(import.meta.dirname);
  return {
    helperPath: canonicalExe,
    helperSha256: hash(canonicalExe), helperFilesSha256, sourceSha256,
    targetDir: canonicalTarget,
    configuration,
    toolchain,
  };
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  let targetDir = null;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--target-dir' || args[i] === '--output-dir') && i + 1 < args.length) {
      targetDir = args[++i];
    }
  }

  if (!targetDir) {
    console.error('Usage: node build-helper.mjs --target-dir <external-directory>');
    process.exit(1);
  }

  try {
    const result = buildNativeHelper({targetDir});
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`build-helper error: ${err.message}`);
    process.exit(1);
  }
}
