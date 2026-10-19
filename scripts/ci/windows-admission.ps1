$ErrorActionPreference = 'Stop'
# Read only: host owners install/manage the hooks and policy outside this checkout.
if ($env:RUNNER_OS -ne 'Windows' -or $env:PA_CI_JOB_ID -notmatch '^[a-f0-9]{32}$') {
    throw 'Windows ECS automatic PreJob admission was not observed. Ask the host owner to finish setup, or explicitly route this PR to GitHub Windows.'
}
$resourceRoot = 'C:\ProgramData\PersonalAgentCI'
$context = Get-Content -LiteralPath (Join-Path $resourceRoot "records\context-$env:PA_CI_JOB_ID.json") -Raw | ConvertFrom-Json
$gate = Get-Content -LiteralPath (Join-Path $resourceRoot 'state\resource-gate.json') -Raw | ConvertFrom-Json
if ($context.fixture -ne $false -or $context.id -ne $env:PA_CI_JOB_ID -or $gate.id -ne $context.id -or
    $context.runId -ne $env:GITHUB_RUN_ID -or $context.runAttempt -ne $env:GITHUB_RUN_ATTEMPT -or $context.job -ne $env:GITHUB_JOB) {
    throw 'Resource admission is missing, synthetic, stale or belongs to another job.'
}
$worker = Get-Process -Id $context.processId
if ($worker.ProcessName -ne 'Runner.Worker' -or $worker.StartTime.ToUniversalTime().ToString('o') -ne $context.processStartUtc -or
    $worker.ProcessorAffinity.ToInt64() -ne 1 -or $context.initial.freeMemoryBytes -lt $context.required.memory -or
    $context.initial.freeDiskBytes -lt $context.required.disk) {
    throw 'The admitted Windows worker or capacity evidence does not match this job.'
}
if ($env:NODE_OPTIONS -notmatch '--max-old-space-size=1536' -or $env:DOTNET_PROCESSOR_COUNT -ne '1') {
    throw 'Expected inherited ECS resource controls are missing.'
}
$parallelism = & node -p "require('node:os').availableParallelism()"
if ($LASTEXITCODE -ne 0 -or $parallelism -ne '1') { throw 'ECS child process did not inherit single-core affinity.' }
$receipt = [ordered]@{
    runner = $env:RUNNER_NAME
    runId = $context.runId
    runAttempt = $context.runAttempt
    preJob = 'observed_real_job'
    freeMemoryAtAdmission = $context.initial.freeMemoryBytes
    freeDiskAtAdmission = $context.initial.freeDiskBytes
    nodeAvailableParallelism = 1
    aggregateMemoryHardLimit = 'not_configured'
}
$receipt | ConvertTo-Json -Compress
"Windows ECS real PreJob admission verified on $env:RUNNER_NAME. Per-process Node heap is not an aggregate memory cap." | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
