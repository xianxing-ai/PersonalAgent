#requires -Version 7.2
[CmdletBinding()]
param(
  [string]$ProjectRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [switch]$VerifyOnly
)

# The five original assets were read and hashed locally; no model is trained or
# changed by this installer. Keep the revision and hashes together when updating.
$LayaRevision = '55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851'
$LayaAssets = @(
  @{ Path='model.safetensors'; Bytes=643835514; SHA256='9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204' },
  @{ Path='rl_agent_config.json'; Bytes=472; SHA256='25061739243b617ad88d1219ba6f8a9c86c5881ca28df024fa2d9b3b2fcc30c6' },
  @{ Path='encoder/config.json'; Bytes=1938; SHA256='83f6916d13ef0f556ac461f28308dc2bffa7ebeadee8ec9e2db5812020ea5bb4' },
  @{ Path='tokenizer/tokenizer_config.json'; Bytes=524; SHA256='6c6b2d8e3c84ce0e671c129cd6b374b235d6f9863042a5836358d00a89bbb5a1' },
  @{ Path='tokenizer/tokenizer.json'; Bytes=34363188; SHA256='609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f' }
)
$LayaPackages = [ordered]@{
  laya='0.3.20'; torch='2.14.0+cpu'; transformers='5.17.0'; numpy='2.5.3';
  tokenizers='0.23.2'; safetensors='0.8.0'; 'huggingface-hub'='1.33.0';
  fastapi='0.141.1'; uvicorn='0.53.0'; pydantic='2.13.5'
}

function Test-LayaAsset([string]$File, [hashtable]$Asset) {
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
  $stream = [IO.File]::OpenRead($File)
  try { if ($stream.Length -ne $Asset.Bytes) { return $false } }
  finally { $stream.Dispose() }
  return (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -eq $Asset.SHA256
}

function Assert-LayaWritePath([string]$Root, [string]$Destination) {
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $candidate = [IO.Path]::GetFullPath($Destination)
  if (-not $candidate.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Installer destination is outside the selected project.'
  }
  for ($parent = $candidate; $parent -ne $rootPath; $parent = Split-Path $parent -Parent) {
    if ((Test-Path -LiteralPath $parent) -and
        ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Refusing to write through a cache link or junction.'
    }
  }
}

function Install-LayaAsset([string]$Root, [string]$Model, [hashtable]$Asset, [string]$Revision) {
  $destination = Join-Path $Model $Asset.Path
  if (Test-LayaAsset $destination $Asset) { Write-Host "Verified $($Asset.Path)"; return }
  if (Test-Path -LiteralPath $destination) { throw "Existing model file failed verification; preserved: $($Asset.Path)" }
  Assert-LayaWritePath $Root $destination
  $null = New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force
  $partial = "$destination.partial.$([guid]::NewGuid().ToString('N'))"
  try {
    $uri = "https://huggingface.co/convaiinnovations/laya/resolve/$Revision/multilingual/$($Asset.Path)"
    Write-Host "Downloading $($Asset.Path) ($($Asset.Bytes) bytes)"
    Invoke-WebRequest -Uri $uri -OutFile $partial -MaximumRedirection 10 -TimeoutSec 900 -ErrorAction Stop
    if (-not (Test-LayaAsset $partial $Asset)) { throw "Downloaded model file failed SHA256/size verification: $($Asset.Path)" }
    # Recheck the boundary and never overwrite a file another process installed.
    Assert-LayaWritePath $Root $destination
    [IO.File]::Move($partial, $destination)
  }
  finally {
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -ErrorAction Stop }
  }
}

function Test-LayaEnvironment([string]$Python) {
  if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) { return $false }
  $code = 'import sys,json,importlib.metadata as m; print(json.dumps({"python":"%d.%d"%sys.version_info[:2],"packages":{n:m.version(n) for n in ("laya","torch","transformers","numpy","tokenizers","safetensors","huggingface-hub","fastapi","uvicorn","pydantic")}}))'
  $result = @(& $Python -c $code 2>$null)
  if ($LASTEXITCODE -ne 0) { return $false }
  try { $metadata = ($result -join "`n") | ConvertFrom-Json -AsHashtable }
  catch { return $false }
  if ($metadata.python -ne '3.12') { return $false }
  foreach ($name in $LayaPackages.Keys) {
    if ($metadata.packages[$name] -ne $LayaPackages[$name]) { return $false }
  }
  return $true
}

function Invoke-LayaWindowsInstall {
  $ErrorActionPreference = 'Stop'
  if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [Runtime.InteropServices.Architecture]::X64) {
    throw 'Windows x64 is required.'
  }
  $root = (Resolve-Path -LiteralPath $ProjectRoot).Path
  if (-not (Test-Path -LiteralPath (Join-Path $root 'scripts/laya/batch-server.py') -PathType Leaf)) {
    throw 'Select a PersonalAgent source checkout containing scripts/laya/batch-server.py.'
  }
  $cache = Join-Path $root '.cache/laya'
  $python = Join-Path $cache 'venv/Scripts/python.exe'
  $model = Join-Path $cache "hf/hub/models--convaiinnovations--laya/snapshots/$LayaRevision/multilingual"
  if ($VerifyOnly) {
    if (-not (Test-LayaEnvironment $python)) { throw 'The pinned Python 3.12/Laya environment is missing or differs.' }
    foreach ($asset in $LayaAssets) {
      if (-not (Test-LayaAsset (Join-Path $model $asset.Path) $asset)) { throw "Missing or different model file: $($asset.Path)" }
    }
    Write-Host "Verified Python dependencies and all five original model assets ($LayaRevision). No model was started."
    return
  }
  if (-not (Test-LayaEnvironment $python)) {
    Assert-LayaWritePath $root $python
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
      $launcher = Get-Command py -ErrorAction SilentlyContinue
      if (-not $launcher) { throw 'Install 64-bit Python 3.12 with its py launcher, then rerun this command.' }
      & $launcher.Source -3.12 -m venv (Join-Path $cache 'venv')
      if ($LASTEXITCODE -ne 0) { throw 'Creating the Python 3.12 virtual environment failed.' }
    }
    & $python -c 'import sys,struct; sys.exit(0 if sys.version_info[:2]==(3,12) and struct.calcsize("P")==8 else 1)'
    if ($LASTEXITCODE -ne 0) { throw 'Existing virtual environment is not 64-bit Python 3.12; preserved without installing dependencies.' }
    Assert-LayaWritePath $root (Join-Path $cache 'venv/Lib/site-packages')
    & $python -m pip install --index-url https://download.pytorch.org/whl/cpu 'torch==2.14.0+cpu'
    if ($LASTEXITCODE -ne 0) { throw 'Installing pinned CPU Torch failed.' }
    $requirements = @('laya[serve]==0.3.20') + @($LayaPackages.Keys | Where-Object { $_ -notin @('laya','torch') } | ForEach-Object { "$_==$($LayaPackages[$_])" })
    & $python -m pip install --index-url https://pypi.org/simple @requirements
    if ($LASTEXITCODE -ne 0 -or -not (Test-LayaEnvironment $python)) { throw 'The pinned Python dependencies could not be verified.' }
  }
  foreach ($asset in $LayaAssets) { Install-LayaAsset $root $model $asset $LayaRevision }
  Write-Host 'Laya assets installed and verified. Open PersonalAgent settings and select Start local model.'
  Write-Host 'The application still checks available memory and owns service startup; this installer starts no model.'
}

# Dot-sourcing is reserved for the small installer regression tests.
if ($MyInvocation.InvocationName -ne '.') { Invoke-LayaWindowsInstall }
