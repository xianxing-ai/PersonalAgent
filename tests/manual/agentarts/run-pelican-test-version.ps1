param([Parameter(Mandatory)][string]$ConfigPath,[switch]$Live)
$ErrorActionPreference='Stop'
if (-not $Live) { throw 'Real image/model calls require -Live.' }
$configuration=Get-Content -LiteralPath (Resolve-Path -LiteralPath $ConfigPath) -Raw | ConvertFrom-Json -AsHashtable
if ($configuration.ContainsKey('model')) { throw 'Configure model roles in the image; direct model configuration is unsupported.' }
if (-not $configuration.image) { throw 'Configuration requires image.url.' }
if ($configuration.image.ContainsKey('token')) { throw 'Do not store token in configuration. Use an environment variable.' }
$tokenVariable=if ($configuration.image.tokenEnv) {$configuration.image.tokenEnv} else {'PA_AGENT_WSS_AUTH_TOKEN'}
$secret=[Environment]::GetEnvironmentVariable($tokenVariable)
if ([string]::IsNullOrWhiteSpace($secret)) { throw 'Required image token environment variable is absent.' }
$configuration.image.Remove('tokenEnv') | Out-Null
$configuration.image.token=$secret
$node=if ($configuration.nodePath) {$configuration.nodePath} else {'node'}
$configuration.Remove('nodePath') | Out-Null
$payload=$configuration | ConvertTo-Json -Depth 30 -Compress
try {
  $payload | & $node (Join-Path $PSScriptRoot 'pelican-test-version.mjs') --live
  if ($LASTEXITCODE -ne 0) { throw 'Pelican test failed; inspect its local report.' }
} finally { $secret=$null; $payload=$null; $configuration.image.token=$null }
