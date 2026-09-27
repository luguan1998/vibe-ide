# Sample Vibe IDE per-process memory over time (Task Manager 口径 = private bytes).
# Independent of the IDE process tree, so it survives an IDE restart.
# Workflow (用来看"重启后引擎池如何回升"，见 docs/memory-analysis.md §9/§11):
#   1. 在 IDE 之外的 PowerShell 窗口里跑本脚本（在 IDE 终端里跑会被重启杀掉）
#   2. 保持它运行，然后重启 Vibe IDE，照常使用 30-60min
#   3. 日志（默认 %TEMP%\vibe-mem-timeseries.csv）= 重启前的值 → 掉到基线 → 随时间回升的斜率
# 判读：只看 privMB（wsMB 若做过内存转储则被污染，见 memory-analysis 方法论记忆）
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mem-timeseries.ps1 [-Minutes 60] [-IntervalSec 30] [-ProcName 'Vibe IDE.exe']
param(
  [int]$Minutes = 60,
  [int]$IntervalSec = 30,
  [string]$ProcName = 'Vibe IDE.exe',
  [string]$Out = ''
)
if (-not $Out) { $Out = Join-Path $env:TEMP 'vibe-mem-timeseries.csv' }

"sampling '$ProcName' every ${IntervalSec}s for $Minutes min -> $Out"
"columns: time, role, pid, privMB (= Task Manager memory column), wsMB (contaminated if a dump was taken)"
"roles: browser(main) / gpu-process / renderer1..n / utility"
""
$deadline = (Get-Date).AddMinutes($Minutes)
$rows = @()
while ((Get-Date) -lt $deadline) {
  $t = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $procs = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq $ProcName })
  $rIdx = 0
  $sumPriv = 0.0
  foreach ($pr in $procs) {
    $role = if ($pr.CommandLine -match '--type=([a-zA-Z-]+)') { $matches[1] } else { 'browser(main)' }
    if ($role -eq 'renderer') { $rIdx++; $role = "renderer$rIdx" }
    $p = Get-Process -Id $pr.ProcessId -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    $priv = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
    $ws = [math]::Round($p.WorkingSet64 / 1MB, 1)
    $sumPriv += $priv
    $rows += [pscustomobject]@{ time = $t; role = $role; pid = $pr.ProcessId; privMB = $priv; wsMB = $ws }
    "{0}  {1,-14} pid={2,-7} priv={3,8}MB  ws={4,8}MB" -f $t, $role, $pr.ProcessId, $priv, $ws
  }
  $shells = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('pwsh.exe', 'powershell.exe', 'cmd.exe') })
  $shellPriv = 0.0
  foreach ($s in $shells) {
    $sp = Get-Process -Id $s.ProcessId -ErrorAction SilentlyContinue
    if ($sp) { $shellPriv += $sp.PrivateMemorySize64 / 1MB }
  }
  if ($procs.Count -eq 0) {
    "{0}  (not running)" -f $t
    "{0}  shells: n={1} priv={2}MB (may include unrelated shells)" -f $t, $shells.Count, [math]::Round($shellPriv, 1)
  } else {
    "{0}  == app total priv={1}MB | shells: n={2} priv={3}MB (may include unrelated)" -f $t, [math]::Round($sumPriv, 1), $shells.Count, [math]::Round($shellPriv, 1)
  }
  ""
  $rows | Export-Csv -Path $Out -NoTypeInformation -Encoding UTF8
  Start-Sleep -Seconds $IntervalSec
}
"done -> $Out"
