# Requires PowerShell 7, Docker and the repository Node/npm toolchain on PATH.
[CmdletBinding()]
param(
  [string]$Image='personal-agent:test-v3-final-local-laya',
  [string]$RegistryReference='',
  [string]$ExpectedImageId='',
  [string]$ExpectedSourceRevision='',
  [switch]$Build,[switch]$Push,
  [string]$DockerPath='docker',[string]$NodePath='node',
  [string]$OutputDirectory='.cache/owned-image-release'
)
$ErrorActionPreference='Stop'
$paRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $paRoot
$paDocker=(Get-Command $DockerPath -ErrorAction Stop).Source
$paNode=(Get-Command $NodePath -ErrorAction Stop).Source
function Assert-PaReleaseSource {
  if($ExpectedSourceRevision -and ((& git rev-parse HEAD) -ne $ExpectedSourceRevision -or (& git status --porcelain --untracked-files=all -- package.json package-lock.json tsconfig.base.json packages/contracts packages/coordination packages/models packages/agentarts apps/agentarts-runtime scripts/agentarts/release-owned-image.ps1))){throw 'Original release source changed'}
}
Assert-PaReleaseSource
$paOutput=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $paOutput -Force|Out-Null
$paStages=[Collections.Generic.List[object]]::new()
function Invoke-PaReleaseDocker([string]$Stage,[string[]]$Arguments,[switch]$PlatformOnly){
  $paStart=[DateTime]::UtcNow.ToString('o')
  $paWatch=[Diagnostics.Stopwatch]::StartNew()
  $paText=(& $paDocker @Arguments 2>&1|Out-String)
  $paCode=$LASTEXITCODE
  $paWatch.Stop()
  if($PlatformOnly){
    if($paCode){$paText='Remote image platform read failed'}
    else{try{$paPlatform=$paText|ConvertFrom-Json;$paText=@{os=$paPlatform.os;architecture=$paPlatform.architecture}|ConvertTo-Json -Compress}catch{throw 'Remote image platform response is invalid'}}
  }
  $paLog=Join-Path $paOutput ($Stage+'.log')
  $paText|Set-Content -LiteralPath $paLog -Encoding utf8
  $paStages.Add(@{stage=$Stage;startedAtUtc=$paStart;finishedAtUtc=[DateTime]::UtcNow.ToString('o');wallMs=$paWatch.Elapsed.TotalMilliseconds;exitCode=$paCode;logSha256=(Get-FileHash -LiteralPath $paLog -Algorithm SHA256).Hash.ToLowerInvariant()})
  if($paCode){throw ('Docker '+$Stage+' failed; inspect the local log')}
  return $paText
}
$paContext=$null
if($Build){
  & npm run build:owned-agent
  if($LASTEXITCODE){throw 'Owned workspaces build failed'}
  $paExport=& $paNode apps/agentarts-runtime/scripts/image-context.mjs
  if($LASTEXITCODE){throw 'Context export failed'}
  $paContext=($paExport|Select-Object -Last 1|ConvertFrom-Json).context
  Assert-PaReleaseSource
  # Fixed releases must not acquire a different index digest from timestamped provenance on a cached rebuild.
  $null=Invoke-PaReleaseDocker 'build' @('build','--platform','linux/arm64','--provenance=false','--tag',$Image,$paContext)
}
$paInspect=(& $paDocker image inspect $Image|ConvertFrom-Json)
if($LASTEXITCODE -or $paInspect.Count -ne 1 -or $paInspect[0].Architecture -ne 'arm64'){throw 'An existing ARM64 image is required'}
$paImageId=$paInspect[0].Id
if($ExpectedImageId -and $ExpectedImageId -ne $paImageId){throw 'Image identity mismatch'}
$paRegistryDigest=$null
if($Push){
  Assert-PaReleaseSource
  if(-not $RegistryReference -or $RegistryReference -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._:/-]+$'){throw 'Explicit registry reference required'}
  # Authenticate with docker login beforehand; credentials never enter this script.
  $null=Invoke-PaReleaseDocker 'tag' @('tag',$Image,$RegistryReference)
  $paPushOutput=Invoke-PaReleaseDocker 'push' @('push',$RegistryReference)
  $paPublishedMatches=[regex]::Matches($paPushOutput,'digest:\s*(sha256:[a-f0-9]{64})')
  if(-not $paPublishedMatches.Count){throw 'Docker push did not report its published manifest digest'}
  $paRegistryDigest=$paPublishedMatches[$paPublishedMatches.Count-1].Groups[1].Value
  $paRemote=Invoke-PaReleaseDocker 'remote-inspect' @('buildx','imagetools','inspect',$RegistryReference,'--format','{{json .Manifest}}')|ConvertFrom-Json
  # Local Id can be a config digest or an index digest depending on the engine.
  # Compare remote manifest identity with Docker's actual push result, not Id.
  if($paRemote.digest -ne $paRegistryDigest){throw 'Remote image identity mismatch'}
  $paPlatformDigest=$paRegistryDigest
  if($null -ne $paRemote.manifests){
    $paArm64=@($paRemote.manifests|Where-Object {$_.platform.os -eq 'linux' -and $_.platform.architecture -eq 'arm64'})
    if($paArm64.Count -ne 1 -or $paArm64[0].digest -notmatch '^sha256:[a-f0-9]{64}$'){throw 'Remote ARM64 manifest is not unique'}
    $paPlatformDigest=$paArm64[0].digest
  }
  $paPlatformReference=($RegistryReference -replace ':[^/:]+$','')+'@'+$paPlatformDigest
  $paPlatform=Invoke-PaReleaseDocker 'remote-platform' @('buildx','imagetools','inspect',$paPlatformReference,'--format','{{json .Image}}') -PlatformOnly|ConvertFrom-Json
  if($paPlatform.os -ne 'linux' -or $paPlatform.architecture -ne 'arm64'){throw 'Remote image architecture mismatch'}
}
Assert-PaReleaseSource
$paReceipt=@{schemaVersion=1;image=$Image;imageId=$paImageId;imageSizeBytes=$paInspect[0].Size;architecture='arm64';sourceRevision=(& git rev-parse HEAD);sourceDirty=[bool](& git status --porcelain);built=$Build.IsPresent;context=$paContext;published=$Push.IsPresent;registryReference=$RegistryReference;registryManifestDigest=$paRegistryDigest;remoteReadbackVerified=$Push.IsPresent;runtimeDeploymentVerified=$false;stages=$paStages;recordedAtUtc=[DateTime]::UtcNow.ToString('o')}
$paReceipt|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $paOutput 'release.json') -Encoding utf8
$paReceipt|Select-Object image,imageId,architecture,built,published,remoteReadbackVerified,runtimeDeploymentVerified|ConvertTo-Json
