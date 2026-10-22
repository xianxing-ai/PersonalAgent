import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(directory, '../..');
const fixtureBase = path.join(checkout, '.cache/laya-installer-tests');
const script = path.join(directory, 'install-windows.ps1');
const pwsh = process.env.PA_TEST_PWSH || 'C:/Program Files/PowerShell/7/pwsh.exe';
const quoted = value => "'" + value.replaceAll("'", "''") + "'";
const bytes = Buffer.from('known original model fixture');
const sha256 = createHash('sha256').update(bytes).digest('hex');

function run(body) {
  mkdirSync(fixtureBase, {recursive:true});
  const root = mkdtempSync(path.join(fixtureBase, 'case-'));
  try {
    const setup = `$ErrorActionPreference='Stop'; . ${quoted(script)}; $root=${quoted(root)}; ` +
      `$model=Join-Path $root 'model'; $asset=@{Path='weights.bin';Bytes=${bytes.length};SHA256='${sha256}'}; ` +
      `$fixture=[Convert]::FromBase64String('${bytes.toString('base64')}'); `;
    const result = spawnSync(pwsh, ['-NoProfile','-NonInteractive','-Command',setup+body],
      {encoding:'utf8',windowsHide:true,timeout:30_000});
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  } finally {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(fixtureBase)+path.sep));
    rmSync(resolved,{recursive:true,force:true});
  }
}

test('cached original asset is reused without a network call', () => run(`
  $null=New-Item -ItemType Directory -Path $model;
  [IO.File]::WriteAllBytes((Join-Path $model 'weights.bin'),$fixture);
  function Invoke-WebRequest {throw 'Unexpected network call'}
  Install-LayaAsset $root $model $asset 'fixed-revision';
  if(-not (Test-LayaAsset (Join-Path $model 'weights.bin') $asset)){throw 'Cache changed'}
`));

test('different existing file is preserved without downloading', () => run(`
  $null=New-Item -ItemType Directory -Path $model;
  $file=Join-Path $model 'weights.bin'; [IO.File]::WriteAllText($file,'existing original');
  function Invoke-WebRequest {throw 'Unexpected network call'}
  $failure=$null; try{Install-LayaAsset $root $model $asset 'fixed-revision'}catch{$failure=$_.Exception.Message}
  if($failure -notlike 'Existing model file failed verification*'){throw 'Missing preservation error'}
  if([IO.File]::ReadAllText($file) -ne 'existing original'){throw 'Existing file overwritten'}
`));

test('verified download is atomically published and leaves no partial', () => run(`
  function Invoke-WebRequest { [CmdletBinding()]param($Uri,$OutFile,$MaximumRedirection,$TimeoutSec)
    if($Uri -ne 'https://huggingface.co/convaiinnovations/laya/resolve/fixed-revision/multilingual/weights.bin'){throw 'Unexpected origin'}
    [IO.File]::WriteAllBytes($OutFile,$fixture)
  }
  Install-LayaAsset $root $model $asset 'fixed-revision';
  if(-not (Test-LayaAsset (Join-Path $model 'weights.bin') $asset)){throw 'Published file mismatch'}
  if(@(Get-ChildItem $model -Filter '*.partial.*').Count){throw 'Partial remains'}
`));

test('download hash failure removes only its partial and publishes nothing', () => run(`
  function Invoke-WebRequest { [CmdletBinding()]param($Uri,$OutFile,$MaximumRedirection,$TimeoutSec)
    [IO.File]::WriteAllBytes($OutFile,[byte[]]::new($asset.Bytes))
  }
  $failure=$null; try{Install-LayaAsset $root $model $asset 'fixed-revision'}catch{$failure=$_.Exception.Message}
  if($failure -notlike 'Downloaded model file failed SHA256*'){throw 'Missing hash rejection'}
  if(Test-Path (Join-Path $model 'weights.bin')){throw 'Invalid file published'}
  if(@(Get-ChildItem $model -Filter '*.partial.*').Count){throw 'Partial remains'}
`));

test('interrupted download removes its partial and preserves unrelated files', () => run(`
  $null=New-Item -ItemType Directory -Path $model;
  $keep=Join-Path $model 'unrelated'; [IO.File]::WriteAllText($keep,'keep');
  function Invoke-WebRequest { [CmdletBinding()]param($Uri,$OutFile,$MaximumRedirection,$TimeoutSec)
    [IO.File]::WriteAllText($OutFile,'partial'); throw 'Connection interrupted'
  }
  $failure=$null; try{Install-LayaAsset $root $model $asset 'fixed-revision'}catch{$failure=$_.Exception.Message}
  if($failure -ne 'Connection interrupted'){throw 'Unexpected failure'}
  if(Test-Path (Join-Path $model 'weights.bin')){throw 'Partial published'}
  if([IO.File]::ReadAllText($keep) -ne 'keep'){throw 'Unrelated file touched'}
  if(@(Get-ChildItem $model -Filter '*.partial.*').Count){throw 'Partial remains'}
`));

test('a junction cannot redirect new writes outside the project', () => run(`
  $outside=Join-Path $root 'outside'; $null=New-Item -ItemType Directory -Path $outside;
  $link=Join-Path $root 'link'; $null=New-Item -ItemType Junction -Path $link -Target $outside;
  $failure=$null; try{Assert-LayaWritePath $root (Join-Path $link 'weights.bin')}catch{$failure=$_.Exception.Message}
  if($failure -ne 'Refusing to write through a cache link or junction.'){throw 'Junction accepted'}
  if(@(Get-ChildItem $outside).Count){throw 'Outside directory changed'}
`));

test('verification of a missing environment fails without creating a cache', () => run(`
  $null=New-Item -ItemType Directory -Path (Join-Path $root 'scripts/laya') -Force;
  [IO.File]::WriteAllText((Join-Path $root 'scripts/laya/batch-server.py'),'# fixture');
  $ProjectRoot=$root; $VerifyOnly=$true;
  $failure=$null; try{Invoke-LayaWindowsInstall}catch{$failure=$_.Exception.Message}
  if($failure -ne 'The pinned Python 3.12/Laya environment is missing or differs.'){throw 'Missing environment accepted'}
  if(Test-Path (Join-Path $root '.cache')){throw 'Verify-only wrote cache'}
`));

test('installer has no PowerShell parse errors', () => {
  assert.ok(existsSync(pwsh),'PowerShell 7 test prerequisite missing');
  const result=spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',
    `$tokens=$null; $errors=$null; $null=[Management.Automation.Language.Parser]::ParseFile(${quoted(script)},[ref]$tokens,[ref]$errors); if($errors.Count){$errors | Out-String | Write-Error; exit 1}`],
    {encoding:'utf8',windowsHide:true,timeout:30_000});
  assert.ifError(result.error); assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
