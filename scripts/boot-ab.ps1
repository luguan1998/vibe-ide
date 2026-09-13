# Boot baseline A/B with EQUALIZED conditions: fresh profile -> inject identical sessions (loaded:false) -> reload -> sample.
# Usage: powershell -File scripts/boot-ab.ps1 -Exe <path> -Label <name> [-Runs 2] [-Cwd E:/ai/claudeui] [-Port 9241]
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Label,
  [int]$Runs = 2,
  [string]$Cwd = 'E:/ai/claudeui',
  [int]$Port = 9241
)
$ErrorActionPreference = 'Continue'

function Sample-Role([string]$profKey) {
  $sum = @{}
  $n = 0
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$profKey*" } | ForEach-Object {
    $typ = if ($_.CommandLine -match '--type=([a-z-]+)') { $matches[1] } else { 'main' }
    $gp = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    if (-not $gp) { return }
    $n++
    if (-not $sum.ContainsKey($typ)) { $sum[$typ] = 0 }
    $sum[$typ] += $gp.PrivateMemorySize64
  }
  return @{ sum = $sum; n = $n }
}

for ($r = 1; $r -le $Runs; $r++) {
  $key = "bootab-$Label-$r"
  $prof = Join-Path $env:TEMP $key
  Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $prof -Force | Out-Null
  $p = Start-Process -FilePath $Exe -ArgumentList '--no-sandbox', "--remote-debugging-port=$Port", "--user-data-dir=$prof" -PassThru
  Start-Sleep 13
  node E:\ai\claudeui\scripts\probe-cdp-inject.mjs $Port $Cwd 2>&1 | ForEach-Object { Write-Host "  [inject] $_" }
  Start-Sleep 13
  foreach ($at in 25, 30) {
    Start-Sleep $at
    $s = Sample-Role $key
    $parts = @()
    $tot = 0
    foreach ($k in ($s.sum.Keys | Sort-Object)) { $parts += ('{0}={1}MB' -f $k, [math]::Round($s.sum[$k] / 1MB)); $tot += $s.sum[$k] }
    $t = if (25 -eq $at) { '+25s' } else { '+55s' }
    Write-Host ("[{0} run{1} {2}] procs={3} {4} TOTAL={5}MB" -f $Label, $r, $t, $s.n, ($parts -join ' '), [math]::Round($tot / 1MB))
  }
  cmd /c "taskkill /PID $($p.Id) /T /F" 2>$null | Out-Null
  Start-Sleep 3
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$key*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue
}
Write-Host "$Label done"
