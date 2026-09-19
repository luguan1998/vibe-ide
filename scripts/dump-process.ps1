# Full memory dump of a running process without admin rights (dbghelp MiniDumpWriteDump).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dump-process.ps1 -TargetPid <pid> -Out <file.dmp> [-Type 2050]
# Type 2050 = 0x802 = MiniDumpWithFullMemory | MiniDumpWithFullMemoryInfo (MemoryInfoListStream for dmp-peek --summary --scan)
param([int]$TargetPid, [string]$Out, [uint32]$Type = 2050)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MD {
  [DllImport("dbghelp.dll", SetLastError=true)] public static extern bool MiniDumpWriteDump(IntPtr h, uint pid, IntPtr f, uint t, IntPtr a, IntPtr b, IntPtr c);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint a, bool i, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
}
"@
$h = [MD]::OpenProcess(0x0410, $false, $TargetPid)
if ($h -eq [IntPtr]::Zero) {
  $e = [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
  "OpenProcess failed: " + $e.Message
  exit 1
}
$fs = [IO.File]::Create($Out)
$ok = [MD]::MiniDumpWriteDump($h, [uint32]$TargetPid, $fs.SafeFileHandle.DangerousGetHandle(), $Type, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
$fs.Close()
[MD]::CloseHandle($h) | Out-Null
if ($ok) { "dump ok: " + [math]::Round((Get-Item $Out).Length/1MB) + "MB" }
else { "MiniDumpWriteDump failed: " + [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message }
