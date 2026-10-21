$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows required; no cross-platform Windows validation substitute.' }
if (-not $env:RUNNER_TEMP) { throw 'Explicit existing RUNNER_TEMP required.' }
$project = Join-Path $PSScriptRoot 'WindowsStandardTokenLauncher.csproj'
$target = Join-Path $env:RUNNER_TEMP ('standard-token-smoke-' + [Guid]::NewGuid().ToString('N'))
& dotnet publish $project --configuration Release --runtime win-x64 --self-contained false --output $target
if ($LASTEXITCODE -ne 0) { throw 'CI launcher compilation failed.' }
$launcher = Join-Path $target 'WindowsStandardTokenLauncher.exe'
# No run-check here. Only an actual successful smoke publishes the complete-check entrypoint.
& $launcher --smoke
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($env:GITHUB_ENV) {
  "PA_CI_CHECK_LAUNCHER=$launcher" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
}
exit 0
