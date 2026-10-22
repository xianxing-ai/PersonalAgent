# Read-only process identity and window metadata. Never a title, label or value.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class PublicNotepadIdentityProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool QueryFullProcessImageName(nint handle,uint flags,StringBuilder name,ref uint size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetPackageFamilyName(nint handle,ref uint length,StringBuilder family);
  [DllImport("user32.dll")] public static extern nint GetForegroundWindow();
}
'@
$items = @()
foreach ($process in [Diagnostics.Process]::GetProcessesByName('notepad')) {
  try {
    $buffer = [Text.StringBuilder]::new(32768)
    [uint32]$size = $buffer.Capacity
    $handle = $process.SafeHandle.DangerousGetHandle()
    $imageOk = [PublicNotepadIdentityProbe]::QueryFullProcessImageName($handle,0,$buffer,[ref]$size)
    [uint32]$length = 0
    $code = [PublicNotepadIdentityProbe]::GetPackageFamilyName($handle,[ref]$length,$null)
    $family = [Text.StringBuilder]::new([Math]::Max(1,$length))
    if ($code -eq 122) { $code = [PublicNotepadIdentityProbe]::GetPackageFamilyName($handle,[ref]$length,$family) }
    $window = $process.MainWindowHandle
    $items += [pscustomobject]@{imageQuerySucceeded=$imageOk;packageWin32Code=$code
      system32Image=($imageOk -and $buffer.ToString() -ieq (Join-Path ([Environment]::GetFolderPath('Windows')) 'System32/notepad.exe'))
      expectedPackage=($code -eq 0 -and $family.ToString() -eq 'Microsoft.WindowsNotepad_8wekyb3d8bbwe')
      hasWindow=($window -ne 0);foreground=($window -ne 0 -and $window -eq [PublicNotepadIdentityProbe]::GetForegroundWindow())
      exited=$process.HasExited}
  } catch { $items += [pscustomobject]@{identityUnavailable=$true} }
  finally { $process.Dispose() }
}
[pscustomobject]@{processCount=$items.Count;items=$items} | ConvertTo-Json -Depth 4 -Compress
