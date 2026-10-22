$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows required; no cross-platform Windows validation substitute.' }
if (-not $env:RUNNER_TEMP) { throw 'Explicit existing RUNNER_TEMP required.' }
$project = Join-Path $PSScriptRoot 'WindowsStandardTokenLauncher.csproj'
$target = Join-Path $env:RUNNER_TEMP ('standard-token-smoke-' + [Guid]::NewGuid().ToString('N'))
$architectureProbe = Join-Path $PSScriptRoot '../../../packages/coding-tools/native/host-architecture.mjs'
$toolchainJson = & node $architectureProbe
if ($LASTEXITCODE -ne 0) { throw 'Native Node/dotnet/.NET 8 architecture preflight failed.' }
$toolchain = ($toolchainJson -join "`n") | ConvertFrom-Json
if ($toolchain.runtimeIdentifier -notin @('win-x64', 'win-arm64')) { throw 'Unsupported native launcher RID.' }
& dotnet publish $project --configuration Release --runtime $toolchain.runtimeIdentifier --self-contained false --output $target
if ($LASTEXITCODE -ne 0) { throw 'CI launcher compilation failed.' }
$launcher = Join-Path $target 'WindowsStandardTokenLauncher.exe'
$proofJson = & $launcher --architecture
if ($LASTEXITCODE -ne 0) { throw 'Native launcher architecture probe failed.' }
$proof = ($proofJson -join "`n") | ConvertFrom-Json
if ($proof.processArchitecture -ne $toolchain.architecture -or $proof.osArchitecture -ne $toolchain.architecture) {
  throw 'Launcher OS/process architecture mismatch; emulation is not native acceptance.'
}
# No run-check here. Only an actual successful smoke publishes the complete-check entrypoint.
& $launcher --smoke
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $launcher --compatibility
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($env:GITHUB_ENV) {
  "PA_CI_CHECK_LAUNCHER=$launcher" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
}
exit 0
