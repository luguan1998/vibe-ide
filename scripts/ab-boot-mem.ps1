# Clean-boot memory A/B: v0.11.8 vs HEAD, 2 runs each, no sessions injected.
$builds = @(
  @{ name = 'v0118'; exe = 'E:\ai\claudeui-b118\node_modules\electron\dist\electron.exe'; app = 'E:\ai\claudeui-b118' },
  @{ name = 'head';  exe = 'E:\ai\claudeui\node_modules\electron\dist\electron.exe';     app = 'E:\ai\claudeui' }
)

foreach ($run in 1..2) {
  foreach ($b in $builds) {
    $dir = "C:\Users\luguan\AppData\Local\Temp\ab-$($b.name)-$run"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $p = Start-Process -FilePath $b.exe -ArgumentList "--no-sandbox", "--user-data-dir=$dir", $b.app -PassThru
    foreach ($wait in 25, 30) {
      Start-Sleep $wait
      $procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like "*ab-$($b.name)-$run*" }
      $tot = 0
      foreach ($pr in $procs) {
        $gp = Get-Process -Id $pr.ProcessId -ErrorAction SilentlyContinue
        if (-not $gp) { continue }
        $tot += $gp.PrivateMemorySize64
      }
      $n = ($procs | Measure-Object).Count
      Write-Host ("{0} run{1} +{2}s: procs={3} TOTAL_private={4}MB" -f $b.name, $run, $wait, $n, [math]::Round($tot / 1MB, 0))
    }
    taskkill /pid $p.Id /t /f 2>$null | Out-Null
    Start-Sleep 5
  }
}
Write-Host 'done'
