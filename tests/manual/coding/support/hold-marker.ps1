param(
    [Parameter(Mandatory=$true)][string]$MarkerPath,
    [Parameter(Mandatory=$true)][string]$ReadyPath,
    [Parameter(Mandatory=$true)][string]$ReleasePath
)
$ErrorActionPreference = 'Stop'
# Fault injection only: hold this freshly generated fixture marker read-only.
# Do not edit it, change its ACL, inspect other processes or touch the source.
$handle = [System.IO.FileStream]::new($MarkerPath, 'Open', 'Read', 'Read')
try {
    $ready = [System.IO.FileStream]::new($ReadyPath, 'CreateNew', 'Write', 'None')
    $ready.Dispose()
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while (-not [System.IO.File]::Exists($ReleasePath)) {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Fixture lock expired' }
        Start-Sleep -Milliseconds 20
    }
} finally {
    $handle.Dispose()
}
