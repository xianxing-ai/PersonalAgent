$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class PersonalAgentFileIdentity {
  [StructLayout(LayoutKind.Sequential)]
  public struct FileInformation {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint length, uint flags);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);

  public static string FinalPath(SafeFileHandle handle) {
    var path = new StringBuilder(32768);
    uint length = GetFinalPathNameByHandleW(handle, path, (uint)path.Capacity, 0);
    if (length == 0 || length >= path.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
    string result = path.ToString();
    if (result.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + result.Substring(8);
    if (result.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) return result.Substring(4);
    return result;
  }

  public static void RequireSingleRegularFile(SafeFileHandle handle) {
    FileInformation information;
    if (!GetFileInformationByHandle(handle, out information)) throw new Win32Exception(Marshal.GetLastWin32Error());
    if (information.NumberOfLinks != 1 || (information.Attributes & 0x400) != 0 || (information.Attributes & 0x10) != 0) {
      throw new InvalidOperationException("Source is not a single-link regular file");
    }
  }
}
'@

function Get-Sha256Hex([byte[]] $Bytes) {
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try { return [System.BitConverter]::ToString($algorithm.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}

function Read-Exactly([System.IO.FileStream] $Stream, [int] $Length) {
  $bytes = [byte[]]::new($Length)
  $position = 0
  while ($position -lt $Length) {
    $count = $Stream.Read($bytes, $position, $Length - $position)
    if ($count -eq 0) { throw 'Short source read' }
    $position += $count
  }
  return ,$bytes
}

function Invoke-LockedApply($Request) {
  $source = $null
  $backup = $null
  $before = $null
  $backupCreated = $false
  try {
    $after = [Convert]::FromBase64String([string]$Request.afterBase64)
    if ($after.Length -gt 1048576 -or (Get-Sha256Hex $after) -ne [string]$Request.afterSha256) {
      throw 'Invalid candidate bytes'
    }
    # FileShare.None holds the source against new read/write/delete opens from
    # the in-lock hash check through write and readback. It is not a crash-atomic rename.
    $source = [System.IO.FileStream]::new(
      [string]$Request.sourcePath,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None,
      4096,
      [System.IO.FileOptions]::WriteThrough
    )
    [PersonalAgentFileIdentity]::RequireSingleRegularFile($source.SafeFileHandle)
    $finalPath = [System.IO.Path]::GetFullPath([PersonalAgentFileIdentity]::FinalPath($source.SafeFileHandle))
    $expectedPath = [System.IO.Path]::GetFullPath([string]$Request.sourcePath)
    $root = [System.IO.Path]::GetFullPath([string]$Request.rootPath).TrimEnd('\')
    if (-not [string]::Equals($finalPath, $expectedPath, [StringComparison]::OrdinalIgnoreCase) -or
        -not $finalPath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Opened source is outside the authorized root'
    }
    if ($source.Length -gt 1048576) { throw 'Source byte limit exceeded' }
    $before = Read-Exactly $source ([int]$source.Length)
    if ((Get-Sha256Hex $before) -ne [string]$Request.beforeSha256) {
      return @{state = 'conflict'}
    }
    $backup = [System.IO.FileStream]::new(
      [string]$Request.backupPath,
      [System.IO.FileMode]::CreateNew,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None,
      4096,
      [System.IO.FileOptions]::WriteThrough
    )
    $backupCreated = $true
    $backup.Write($before, 0, $before.Length)
    $backup.Flush($true)
    $backup.Position = 0
    if ((Get-Sha256Hex (Read-Exactly $backup $before.Length)) -ne [string]$Request.beforeSha256) {
      throw 'Backup readback mismatch'
    }
    $backup.Dispose()
    $backup = $null

    $source.Position = 0
    $source.Write($after, 0, $after.Length)
    $source.SetLength($after.Length)
    $source.Flush($true)
    $source.Position = 0
    $readback = Read-Exactly $source ([int]$source.Length)
    if ((Get-Sha256Hex $readback) -ne [string]$Request.afterSha256) {
      throw 'In-lock readback mismatch'
    }
    if (-not [string]::Equals(
      [System.IO.Path]::GetFullPath([PersonalAgentFileIdentity]::FinalPath($source.SafeFileHandle)),
      $expectedPath,
      [StringComparison]::OrdinalIgnoreCase
    )) { throw 'Opened source path changed during apply' }
    try {
      [System.IO.File]::Delete([string]$Request.backupPath)
      return @{state = 'applied'; backupRetained = $false}
    } catch {
      return @{state = 'applied'; backupRetained = $true}
    }
  } catch {
    if ($null -eq $source -and -not $backupCreated) {
      return @{state = 'conflict'}
    }
    return @{state = 'unknown'; backupRetained = $backupCreated}
  } finally {
    if ($null -ne $backup) { $backup.Dispose() }
    if ($null -ne $source) { $source.Dispose() }
  }
}



function Invoke-LockedCreate($Request) {
  $source = $null
  try {
    $after = [Convert]::FromBase64String([string]$Request.afterBase64)
    if ($after.Length -gt 1048576 -or (Get-Sha256Hex $after) -ne [string]$Request.afterSha256) {
      throw 'Invalid candidate bytes'
    }
    try {
      $source = [System.IO.FileStream]::new(
        [string]$Request.sourcePath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::WriteThrough
      )
    } catch [System.IO.IOException] {
      if ([System.IO.File]::Exists([string]$Request.sourcePath)) { return @{state = 'exists'} }
      throw
    }
    [PersonalAgentFileIdentity]::RequireSingleRegularFile($source.SafeFileHandle)
    $finalPath = [System.IO.Path]::GetFullPath([PersonalAgentFileIdentity]::FinalPath($source.SafeFileHandle))
    $expectedPath = [System.IO.Path]::GetFullPath([string]$Request.sourcePath)
    $root = [System.IO.Path]::GetFullPath([string]$Request.rootPath).TrimEnd('\')
    if (-not [string]::Equals($finalPath, $expectedPath, [StringComparison]::OrdinalIgnoreCase) -or
        -not $finalPath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Opened source is outside the authorized root'
    }
    $source.Write($after, 0, $after.Length)
    $source.Flush($true)
    $source.Position = 0
    $readback = Read-Exactly $source ([int]$source.Length)
    if ((Get-Sha256Hex $readback) -ne [string]$Request.afterSha256) { throw 'In-lock readback mismatch' }
    if (-not [string]::Equals(
      [System.IO.Path]::GetFullPath([PersonalAgentFileIdentity]::FinalPath($source.SafeFileHandle)),
      $expectedPath,
      [StringComparison]::OrdinalIgnoreCase
    )) { throw 'Opened source path changed during create' }
    return @{state = 'created'}
  } catch {
    return @{state = 'unknown'}
  } finally {
    if ($null -ne $source) { $source.Dispose() }
  }
}

try {
  [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $process = [Diagnostics.Process]::GetCurrentProcess()
  try {
    $ticks = $process.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
    $ready = @{ type = 'ready'; pid = $process.Id; startTimeTicks = $ticks }
    [Console]::Out.WriteLine(($ready | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  } finally {
    $process.Dispose()
  }
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ([string]$request.operation -eq 'create') { $result = Invoke-LockedCreate $request }
  else { $result = Invoke-LockedApply $request }
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
} catch {
  [Console]::Out.WriteLine('{"state":"unknown","backupRetained":false}')
  [Console]::Out.Flush()
}
