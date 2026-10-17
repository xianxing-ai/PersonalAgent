param(
  [Parameter(Mandatory)][string]$ProxyConfiguration,
  [Parameter(Mandatory)][string]$PythonPath,
  [Parameter(Mandatory)][string]$ModelPath,
  [Parameter(Mandatory)][string]$BrowserPath,
  [string]$NodePath='node',[string]$DockerPath='docker',
  [string]$PythonModulePath='',
  [ValidateSet('cpu','cuda')][string]$Device='cpu',
  [ValidateRange(1,1024)][int]$TorchThreads=1,
  [ValidateRange(1024,65535)][int]$ImagePort=44173,
  [ValidateRange(1024,65535)][int]$LayaPort=44174,
  [int]$MaxSteps=24,[int]$TaskMinutes=20,[switch]$UseCurrentImageSources,
  [ValidateSet('wukong','pelican')][string]$Scenario='wukong',
  [string]$Image='personal-agent:test-v3-final-local-laya'
)
$ErrorActionPreference='Stop'
$paProject=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$paNode=(Get-Command $NodePath -ErrorAction Stop).Source
$paDocker=(Get-Command $DockerPath -ErrorAction Stop).Source
$paPython=(Resolve-Path -LiteralPath $PythonPath -ErrorAction Stop).Path
$paModel=(Resolve-Path -LiteralPath $ModelPath -ErrorAction Stop).Path
$paBrowser=(Resolve-Path -LiteralPath $BrowserPath -ErrorAction Stop).Path
if($ImagePort -eq $LayaPort){throw 'Image and Laya ports must be distinct'}
Set-Location -LiteralPath $paProject
$paTag=$Image
$paName='pa-'+$Scenario+'-v3-'+[DateTime]::UtcNow.ToString('HHmmss')
$paRunRoot=Join-Path $paProject ('.cache/'+$Scenario+'-launch-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
$paSecrets=@();$paSamples=[Collections.Generic.List[object]]::new();$paContainerStarted=$false;$paExit=1;$paTest=$null;$paSecureBytes=$null
$paStages=[Collections.Generic.List[object]]::new()
$paOverlays=@()
function Invoke-PaDocker([string[]]$Arguments,[hashtable]$Environment=@{}) {
  $paInfo=[Diagnostics.ProcessStartInfo]::new();$paInfo.FileName=$paDocker;$paInfo.UseShellExecute=$false;$paInfo.CreateNoWindow=$true
  $paInfo.RedirectStandardOutput=$true;$paInfo.RedirectStandardError=$true
  foreach($paArg in $Arguments){$paInfo.ArgumentList.Add($paArg)}
  foreach($paKey in $Environment.Keys){$paInfo.Environment[$paKey]=[string]$Environment[$paKey]}
  $paProcess=[Diagnostics.Process]::Start($paInfo);$paOutput=$paProcess.StandardOutput.ReadToEndAsync();$paError=$paProcess.StandardError.ReadToEndAsync()
  $paProcess.WaitForExit();$paValue=$paOutput.GetAwaiter().GetResult();$paErr=$paError.GetAwaiter().GetResult()
  if($paProcess.ExitCode -ne 0){throw ('Docker failed: '+$paErr)}
  return $paValue.Trim()
}
function Save-PaSafe([string]$Path,[string]$Value) {
  foreach($paSecret in $paSecrets){if($paSecret -and $Value.Contains($paSecret)){throw 'Secret projection rejected'}}
  Set-Content -LiteralPath $Path -Value $Value -Encoding utf8
}
function Invoke-PaStage([string]$Name,[scriptblock]$Action) {
  $paStart=[DateTime]::UtcNow.ToString('o');$paWatch=[Diagnostics.Stopwatch]::StartNew();$paState='failed'
  try{$paResult=& $Action;$paState='completed';return $paResult}finally{$paWatch.Stop();$paStages.Add(@{stage=$Name;startedAtUtc=$paStart;finishedAtUtc=[DateTime]::UtcNow.ToString('o');wallMs=$paWatch.Elapsed.TotalMilliseconds;status=$paState})}
}
try {
  New-Item -ItemType Directory -Path $paRunRoot|Out-Null
  Add-Type -AssemblyName System.Security
  $paEnvelope=Get-Content -LiteralPath $ProxyConfiguration -Raw|ConvertFrom-Json
  $paSecureBytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($paEnvelope.ciphertext),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $paCredentials=[Text.Encoding]::UTF8.GetString($paSecureBytes)|ConvertFrom-Json
  if(-not $paCredentials.proxyApiKey -or -not $paCredentials.proxyKeyHeader -or -not $paCredentials.proxyModel){throw 'AgentArts proxy binding is incomplete'}
  $paUrl=[Uri]$paCredentials.proxyBaseUrl
  if($paUrl.Scheme -ne 'https' -or $paUrl.AbsolutePath.TrimEnd('/') -ne '/inference/v1' -or $paUrl.UserInfo -or $paUrl.Query -or $paUrl.Fragment -or $paUrl.Host -match 'modelarts-maas'){throw 'Only the configured AgentArts inference proxy is allowed'}
  if($paCredentials.requestProfile -ne 'huawei-openai-v1'){throw 'Explicit AgentArts platform DeepSeek request profile required for this test'}
  $paToken=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
  $paSecrets=@($paToken,[string]$paCredentials.proxyApiKey)
  $paEnvironment=@{PA_AGENT_MODEL_BASE_URL=$paCredentials.proxyBaseUrl;PA_AGENT_MODEL=$paCredentials.proxyModel
    PA_AGENT_MODEL_API_KEY=$paCredentials.proxyApiKey;PA_AGENT_MODEL_PROXY_KEY_HEADER=$paCredentials.proxyKeyHeader
    PA_AGENT_MODEL_PROXY_KEY_PREFIX=$paCredentials.proxyKeyPrefix??''
    PA_AGENT_MODEL_ROUTE='agentarts-proxy';PA_AGENT_MODEL_REQUEST_PROFILE=$paCredentials.requestProfile;PA_AGENT_WSS_AUTH_TOKEN=$paToken
    PA_AGENT_TEST_VERSION='1';PA_AGENT_TIMEOUT_MS='60000';PA_AGENT_MAX_OUTPUT_TOKENS='8192'}
  $paDockerArgs=[Collections.Generic.List[string]]::new()
  foreach($paArg in @('run','--detach','--rm','--name',$paName,'--platform','linux/arm64','--publish',('127.0.0.1:'+$ImagePort+':8080'))){$paDockerArgs.Add($paArg)}
  foreach($paKey in $paEnvironment.Keys){$paDockerArgs.Add('--env');$paDockerArgs.Add($paKey)}
  if($UseCurrentImageSources){
   foreach($paRelative in @('apps/agentarts-runtime/src/model-proxy.mjs','apps/agentarts-runtime/src/test-version-controller.mjs','apps/agentarts-runtime/src/main.mjs')){
    $paOverlay=Join-Path $paProject $paRelative
    $paOverlayItem=Get-Item -LiteralPath $paOverlay
    if($paOverlayItem.LinkType){throw 'Test source overlay must be a regular project file'}
    $paOverlays+=@{path=$paRelative;sha256=(Get-FileHash -LiteralPath $paOverlay -Algorithm SHA256).Hash.ToLower()}
    $paDockerArgs.Add('--mount');$paDockerArgs.Add('type=bind,source='+$paOverlay.Replace('\','/')+',target=/opt/personal-agent/'+$paRelative+',readonly')
   }
  }
  $paDockerArgs.Add($paTag)
  $paId=Invoke-PaStage 'container.start' {Invoke-PaDocker $paDockerArgs.ToArray() $paEnvironment};$paContainerStarted=$true
  Invoke-PaStage 'container.health' {
    $paReadyUntil=[DateTime]::UtcNow.AddSeconds(60)
    while([DateTime]::UtcNow -lt $paReadyUntil){try{$null=Invoke-RestMethod ('http://127.0.0.1:'+$ImagePort+'/ping') -TimeoutSec 2;return}catch{Start-Sleep -Milliseconds 200}}
    throw 'Test image did not become healthy'
  }
  $paConfig=@{image=@{url=('http://127.0.0.1:'+$ImagePort+'/invocations');modelRef='plan';token=$paToken;reasoningEffort='none'}
    localLaya=@{modelPath=$paModel;port=$LayaPort;device=$Device;torchThreads=$TorchThreads}
    python=$paPython;browserPath=$paBrowser
    powerShellPath=(Join-Path $PSHOME 'pwsh.exe');maxSteps=$MaxSteps;faultInjection='pause_smil'
    modelRevision='55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851';deadline=[DateTime]::UtcNow.AddMinutes($TaskMinutes).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')}
  if($PythonModulePath){$paConfig.localLaya.pythonModulePath=(Resolve-Path -LiteralPath $PythonModulePath).Path}
  $paExistingPython=@(Get-Process -Name python -ErrorAction SilentlyContinue|ForEach-Object Id)
  $paInfo=[Diagnostics.ProcessStartInfo]::new();$paInfo.FileName=$paNode;$paInfo.ArgumentList.Add('tests/manual/agentarts/'+$Scenario+'-test-version.mjs');$paInfo.ArgumentList.Add('--live')
  $paInfo.WorkingDirectory=$paProject;$paInfo.UseShellExecute=$false;$paInfo.CreateNoWindow=$true;$paInfo.RedirectStandardInput=$true;$paInfo.RedirectStandardOutput=$true;$paInfo.RedirectStandardError=$true
  $paTest=[Diagnostics.Process]::Start($paInfo);$paOut=$paTest.StandardOutput.ReadToEndAsync();$paErr=$paTest.StandardError.ReadToEndAsync()
  $paTest.StandardInput.Write(($paConfig|ConvertTo-Json -Depth 20 -Compress));$paTest.StandardInput.Close()
  Save-PaSafe (Join-Path $paRunRoot 'launch.json') (@{startedAtUtc=[DateTime]::UtcNow.ToString('o');pid=$paTest.Id;container=$paName;image=$paTag;imageId=(Invoke-PaDocker @('image','inspect',$paTag,'--format','{{.Id}}'));sourceOverlays=$paOverlays;modelRoute='agentarts-proxy';modelSource='AgentArts enabled DeepSeek; platform backend recorded separately';requestedReasoningEffort=$paConfig.image.reasoningEffort;localDevice=$Device;torchThreads=$TorchThreads;deadline=$paConfig.deadline;maxSteps=$MaxSteps;publication='See registry release evidence; this launcher does not publish';resourceQuota=$false}|ConvertTo-Json -Depth 5)
  Write-Output ($Scenario+' test started: '+$paRunRoot)
  while(-not $paTest.WaitForExit(3000)){
    $paObserved=@(Get-Process -Id $paTest.Id -ErrorAction SilentlyContinue)
    $paObserved+=@(Get-Process -Name python -ErrorAction SilentlyContinue|Where-Object {$_.Id -notin $paExistingPython})
    foreach($paProcess in $paObserved){if($paProcess){try{$paSamples.Add(@{at=[DateTime]::UtcNow.ToString('o');pid=$paProcess.Id;name=$paProcess.ProcessName;cpuMs=$paProcess.TotalProcessorTime.TotalMilliseconds;rssBytes=$paProcess.WorkingSet64;peakRssBytes=$paProcess.PeakWorkingSet64;osThreads=$paProcess.Threads.Count})}catch{}}}
    Save-PaSafe (Join-Path $paRunRoot 'resources.json') ($paSamples|ConvertTo-Json -Depth 6)
  }
  $paText=$paOut.GetAwaiter().GetResult();$paErrorText=$paErr.GetAwaiter().GetResult()
  foreach($paOverlayRecord in $paOverlays){if((Get-FileHash -LiteralPath (Join-Path $paProject $paOverlayRecord.path) -Algorithm SHA256).Hash.ToLower() -ne $paOverlayRecord.sha256){throw 'Mounted test source changed during execution'}}
  Save-PaSafe (Join-Path $paRunRoot 'stdout.json') $paText;Save-PaSafe (Join-Path $paRunRoot 'stderr.txt') $paErrorText
  $paText;$paExit=$paTest.ExitCode
}catch{
  $paFailure=[string]$_.Exception.Message;foreach($paSecret in $paSecrets){if($paSecret){$paFailure=$paFailure.Replace($paSecret,'[redacted]')}}
  if(Test-Path -LiteralPath $paRunRoot){Save-PaSafe (Join-Path $paRunRoot 'launch-error.txt') $paFailure};[Console]::Error.WriteLine($paFailure)
}finally{
  if($paTest -and -not $paTest.HasExited){$paTest.Kill($true);$paTest.WaitForExit()}
  if($paContainerStarted){try{Save-PaSafe (Join-Path $paRunRoot 'container.jsonl') (Invoke-PaDocker @('logs',$paName))}catch{}
    try{Invoke-PaStage 'container.stop' {Invoke-PaDocker @('stop','--time','10',$paName)}|Out-Null}catch{[Console]::Error.WriteLine('Owned test container cleanup needs readback')}}
  if(Test-Path -LiteralPath $paRunRoot){Save-PaSafe (Join-Path $paRunRoot 'launcher-timings.json') ($paStages|ConvertTo-Json -Depth 5)}
  if($paSecureBytes){[Array]::Clear($paSecureBytes,0,$paSecureBytes.Length)};$paCredentials=$null;$paEnvironment=$null;$paConfig=$null;$paSecrets=@()
}
exit $paExit
