# PowerShell 7; packages an existing image. No build, model call, login or push.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ContextDirectory,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [string]$Image='personal-agent:test-v3-final-local-laya',
  [Parameter(Mandatory)][string]$ExpectedImageId,
  [string]$DockerPath='docker',
  [string]$WorkflowResults='docs/competition/evidence/test-image-v3-20261015/full-workflow-results.json'
)
$ErrorActionPreference='Stop'
$paRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $paRoot
$paDocker=(Get-Command $DockerPath -ErrorAction Stop).Source
$paContext=(Resolve-Path -LiteralPath $ContextDirectory).Path
$paResults=Get-Content -LiteralPath $WorkflowResults -Raw|ConvertFrom-Json
$paInspection=(& $paDocker image inspect $Image|ConvertFrom-Json)
if($LASTEXITCODE -or $paInspection.Count -ne 1 -or $paInspection[0].Id -ne $ExpectedImageId -or $paInspection[0].Architecture -ne 'arm64'){throw 'Existing ARM64 image identity mismatch'}
# The context must be the allowlisted image-context.mjs export, not a source/cache tree.
if(-not (Test-Path -LiteralPath (Join-Path $paContext 'context-manifest.json') -PathType Leaf)){throw 'Generated context manifest required'}
$paContextFiles=@(Get-ChildItem -LiteralPath $paContext -Recurse -Force)
if($paContextFiles|Where-Object {$_.LinkType -or $_.Name -match '^\.env(\.|$)' -or $_.Name -in @('.git','.cache','node_modules')}){throw 'Context contains excluded or linked content'}
$paDelivery=Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) ('PersonalAgent-Test-V3-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
if(Test-Path -LiteralPath $paDelivery){throw 'Fresh output directory required'}
New-Item -ItemType Directory -Path $paDelivery|Out-Null
$paTar=Join-Path $paDelivery 'personal-agent-test-v3-arm64.tar'
& $paDocker image save --output $paTar $Image
if($LASTEXITCODE){throw 'Image export failed'}
[IO.Compression.ZipFile]::CreateFromDirectory($paContext,(Join-Path $paDelivery 'build-context.zip'),[IO.Compression.CompressionLevel]::Optimal,$false)
$paRoots=@('README.md','AGENTS.md','CONTRIBUTING.md','package.json','package-lock.json','tsconfig.base.json','.gitignore','.dockerignore','.node-version','.npmrc','.editorconfig')
$paPaths=@(& git -c core.quotepath=false ls-files --cached --others --exclude-standard|Where-Object {
  ($_ -match '^(apps|packages|scripts|tests|docs|\.github)/' -or $paRoots -contains $_) -and
  $_ -notmatch '(^|/)(node_modules|\.git|\.cache|\.codex|\.worktrees)/' -and
  (Split-Path $_ -Leaf) -notmatch '^\.env(\.|$)' -and
  $_ -ne 'docs/competition/evidence/test-image-v3-20261015/test-kit.json'
}|Sort-Object -Unique)
if($LASTEXITCODE){throw 'Git source listing failed'}
$paSource=[ordered]@{kind='source_snapshot';baseCommit=(& git rev-parse HEAD);branch=(& git branch --show-current);dirty=[bool](& git status --porcelain);imageId=$ExpectedImageId;files=@()}
$paSourceZip=[IO.Compression.ZipFile]::Open((Join-Path $paDelivery 'PersonalAgent-source.zip'),[IO.Compression.ZipArchiveMode]::Create)
try{
 foreach($paRelative in $paPaths){
  $paFile=[IO.Path]::GetFullPath((Join-Path $paRoot $paRelative))
  if(-not $paFile.StartsWith($paRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Source path escaped project'}
  $paItem=Get-Item -LiteralPath $paFile
  if($paItem.PSIsContainer -or $paItem.LinkType){throw 'Only regular source files are admitted'}
  # Run the repository's secret review before publication. No host credentials are read here.
  if([IO.File]::ReadAllText($paFile) -match '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{80,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'){throw ('Private key rejected: '+$paRelative)}
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($paSourceZip,$paFile,'PersonalAgent/'+$paRelative,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
  $paSource.files+=@{path=$paRelative;sha256=(Get-FileHash -LiteralPath $paFile -Algorithm SHA256).Hash.ToLowerInvariant()}
 }
 $paEntry=$paSourceZip.CreateEntry('PersonalAgent/source-snapshot.json')
 $paWriter=[IO.StreamWriter]::new($paEntry.Open(),[Text.UTF8Encoding]::new($false))
 try{$paWriter.Write(($paSource|ConvertTo-Json -Depth 8))}finally{$paWriter.Dispose()}
}finally{$paSourceZip.Dispose()}
Copy-Item -LiteralPath 'docs/competition/TEST_IMAGE_V3_RUN.md' -Destination (Join-Path $paDelivery 'RUN.md')
$paArtifacts=@(Get-ChildItem -LiteralPath $paDelivery -File|ForEach-Object {@{file=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}})
$paManifest=@{schemaVersion=1;createdAtUtc=[DateTime]::UtcNow.ToString('o');image=$Image;imageId=$ExpectedImageId;architecture='arm64';sourceFileCount=$paPaths.Count;sourceCommit=$paSource.baseCommit;sourceDirty=$paSource.dirty;artifacts=$paArtifacts;wukongStatus=$paResults.wukong.status;pelicanStatus=$paResults.pelican.status;verificationSource=$WorkflowResults;all28BusinessChainsVerified=$false;localLayaWeightsIncluded=$false;architectureFinalized=$false;packagingDoesNotPublish=$true;publicationEvidence='docs/competition/evidence/test-image-v3-20261015/owned-release.json'}
$paManifest|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $paDelivery 'MANIFEST.json') -Encoding utf8
$paArchive=$paDelivery+'.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($paDelivery,$paArchive,[IO.Compression.CompressionLevel]::Optimal,$false)
$paResult=@{bundle=@{file=[IO.Path]::GetFileName($paArchive);bytes=(Get-Item -LiteralPath $paArchive).Length;sha256=(Get-FileHash -LiteralPath $paArchive -Algorithm SHA256).Hash.ToLowerInvariant()};kit=$paManifest;localOutput=$paArchive}
$paResult|ConvertTo-Json -Depth 12|Set-Content -LiteralPath (Join-Path $paDelivery 'packaging-result.local.json') -Encoding utf8
$paResult|Select-Object bundle,localOutput|ConvertTo-Json -Depth 4
