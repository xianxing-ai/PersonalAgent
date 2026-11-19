# Requires PowerShell 7, Docker and the repository Node/npm toolchain on PATH.
[CmdletBinding()]
param(
  [string]$Image='personal-agent:test-v3-final-local-laya',
  [string]$RegistryReference='',
  [string]$ExpectedImageId='',
  [switch]$Build,[switch]$Push,
  [string]$DockerPath='docker',[string]$NodePath='node',
  [string]$OutputDirectory='.cache/owned-image-release'
)
$ErrorActionPreference='Stop'
$paRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $paRoot
$paSource=(& git rev-parse --verify HEAD)
if($LASTEXITCODE -or $paSource -notmatch '^[a-f0-9]{40}$'){throw 'Cannot read the release source revision'}
$paDirty=[bool](& git status --porcelain)
if($LASTEXITCODE){throw 'Cannot read the release working tree'}
if($Push -and $paDirty){throw 'Publishing requires an image built from the clean release revision'}
$paDocker=(Get-Command $DockerPath -ErrorAction Stop).Source
$paNode=(Get-Command $NodePath -ErrorAction Stop).Source
$paOutput=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $paOutput -Force|Out-Null
$paStages=[Collections.Generic.List[object]]::new()
function Invoke-PaReleaseDocker([string]$Stage,[string[]]$Arguments){
  $paStart=[DateTime]::UtcNow.ToString('o')
  $paWatch=[Diagnostics.Stopwatch]::StartNew()
  $paText=(& $paDocker @Arguments 2>&1|Out-String)
  $paCode=$LASTEXITCODE
  $paWatch.Stop()
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
  $null=Invoke-PaReleaseDocker 'build' @('build','--platform','linux/arm64','--tag',$Image,
    '--label',"org.opencontainers.image.revision=$paSource",
    '--label',"io.personalagent.source.dirty=$($paDirty.ToString().ToLowerInvariant())",$paContext)
}
$paInspect=(& $paDocker image inspect $Image|ConvertFrom-Json)
if($LASTEXITCODE -or $paInspect.Count -ne 1 -or $paInspect[0].Architecture -ne 'arm64'){throw 'An existing ARM64 image is required'}
$paImageId=$paInspect[0].Id
if($ExpectedImageId -and $ExpectedImageId -ne $paImageId){throw 'Image identity mismatch'}
$paLabels=$paInspect[0].Config.Labels
$paImageSource=$paLabels.'org.opencontainers.image.revision'
$paImageDirty=switch($paLabels.'io.personalagent.source.dirty'){'true'{$true};'false'{$false};default{$null}}
$paRegistryDigest=$null
if($Push){
  if(-not $RegistryReference -or $RegistryReference -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._:/-]+$'){throw 'Explicit registry reference required'}
  $paHead=(& git rev-parse --verify HEAD)
  if($LASTEXITCODE -or $paHead -ne $paSource -or $paImageSource -ne $paSource -or $paImageDirty -ne $false){
    throw 'Image source does not match the clean release revision; rebuild the ARM64 image'
  }
  $paReleaseChanges=(& git status --porcelain)
  if($LASTEXITCODE -or $paReleaseChanges){throw 'Release source changed before publishing'}
  # Authenticate with docker login beforehand; credentials never enter this script.
  $null=Invoke-PaReleaseDocker 'tag' @('tag',$Image,$RegistryReference)
  $paPushOutput=Invoke-PaReleaseDocker 'push' @('push',$RegistryReference)
  $paPublishedMatches=[regex]::Matches($paPushOutput,'digest:\s*(sha256:[a-f0-9]{64})')
  if(-not $paPublishedMatches.Count){throw 'Docker push did not report its published manifest digest'}
  $paRegistryDigest=$paPublishedMatches[$paPublishedMatches.Count-1].Groups[1].Value
  $paRemote=Invoke-PaReleaseDocker 'remote-inspect' @('buildx','imagetools','inspect',$RegistryReference)
  # Local Id can be a config digest or an index digest depending on the engine.
  # Compare remote manifest identity with Docker's actual push result, not Id.
  if($paRemote -notmatch [regex]::Escape($paRegistryDigest) -or $paRemote -notmatch 'linux/arm64'){throw 'Remote image identity or architecture mismatch'}
}
$paReceipt=@{schemaVersion=1;image=$Image;imageId=$paImageId;architecture='arm64';sourceRevision=$paImageSource;sourceDirty=$paImageDirty;built=$Build.IsPresent;context=$paContext;published=$Push.IsPresent;registryReference=$RegistryReference;registryManifestDigest=$paRegistryDigest;remoteReadbackVerified=$Push.IsPresent;runtimeDeploymentVerified=$false;stages=$paStages;recordedAtUtc=[DateTime]::UtcNow.ToString('o')}
$paReceipt|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $paOutput 'release.json') -Encoding utf8
$paReceipt|Select-Object image,imageId,architecture,built,published,remoteReadbackVerified,runtimeDeploymentVerified|ConvertTo-Json
