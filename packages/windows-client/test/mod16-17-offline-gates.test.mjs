import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

test('non-Windows evidence capture refuses before creating a file or loading the provider', {
  skip: process.platform === 'win32' ? 'The refusal gate is the non-Windows path' : false,
}, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pa-mod17-evidence-'));
  const output = path.join(directory, 'evidence.json');
  const result = spawnSync(process.execPath, [
    path.join(packageRoot, 'scripts/capture-windows-evidence.mjs'),
    output,
  ], {encoding: 'utf8', timeout: 15_000, cwd: directory});
  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^UNSUPPORTED_PLATFORM: run in a Windows standard-user session\n$/);
    assert.equal(result.stdout, '');
    assert.equal(existsSync(output), false);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /hostname|username|credential|cpu|memory/i);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('Windows Host timing fixture builds and rejects pre-write races', {
  skip: process.platform !== 'win32'
    ? 'Windows-only .NET timing fixture; skipped here and not counted as UIA or device acceptance'
    : false,
  timeout: 300_000,
}, t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pa-windows-host-timing-'));
  t.after(() => rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}));
  const env = {...process.env, DOTNET_CLI_HOME: path.join(temporary, 'cli-home'),
    DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1',
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
    NUGET_XMLDOC_MODE: 'skip',
    DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: 'true'};
  const dotnet = (args, timeout, phase) => {
    const result = spawnSync('dotnet', args, {cwd: temporary, env, windowsHide: true,
      shell: false, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024});
    assert.ifError(result.error);
    const diagnostic = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-12_000);
    assert.equal(result.signal, null, `${phase} was interrupted: ${diagnostic}`);
    assert.equal(result.status, 0, `${phase} failed: ${diagnostic}`);
    return result.stdout;
  };

  const installed = dotnet(['--list-sdks'], 10_000, 'SDK discovery');
  const versions = [...installed.matchAll(/^8\.0\.(\d+)\s+\[[^\r\n]+\]\r?$/gm)]
    .map(match => Number(match[1])).sort((a, b) => b - a);
  assert.ok(versions.length > 0, 'Windows Host timing fixture requires an installed stable .NET 8 SDK');
  writeFileSync(path.join(temporary, 'global.json'), JSON.stringify({sdk: {
    version: `8.0.${versions[0]}`, rollForward: 'disable',
  }}));

  const artifacts = path.join(temporary, 'artifacts');
  dotnet(['build', path.join(repoRoot, 'apps/windows-host/test/WindowsHost.Timing.csproj'),
    '--configuration', 'Release', '--artifacts-path', artifacts, '--disable-build-servers',
    '--nologo', '--verbosity', 'quiet', '-m:1'], 240_000, 'Timing fixture build');
  const outputs = readdirSync(artifacts, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name === 'WindowsHost.Timing.dll')
    .map(entry => path.join(entry.parentPath, entry.name))
    .filter(file => existsSync(path.join(path.dirname(file), 'WindowsHost.Timing.runtimeconfig.json')));
  assert.equal(outputs.length, 1, 'Expected exactly one built Timing fixture output');
  const output = dotnet([outputs[0]], 30_000, 'Timing fixture execution');
  assert.match(output, /^PASS: prewrite input and target identity changes rejected\r?$/m,
    'Timing fixture exited without its refusal marker');
});
